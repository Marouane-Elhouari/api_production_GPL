import logging
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import pandas as pd
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.schemas import (ApiModelInfo, BatchRequest, BatchResponse, ModelInfo,
                         PredictRequest, PredictResponse)

logger = logging.getLogger("duty-api")
logging.basicConfig(level=logging.INFO)

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_TARGET_RANGE = [7000.0, 8000.0]
GNN_NOTE = "Le modèle GNN n'est pas déployé dans cette API."

state = {}


def env_bool(name, default):
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes")


@asynccontextmanager
async def lifespan(app):
    path = os.getenv("MODEL_PATH", "models/duty_model.joblib")
    if not os.path.exists(path):
        raise RuntimeError(f"Modele introuvable: {path}")
    state["artifact"] = joblib.load(path)
    art = state["artifact"]
    logger.info("Modele charge: %s (%s) | %d features", art["model_name"], art["version"], len(art["features"]))
    if not os.getenv("API_KEY"):
        logger.warning("API_KEY non definie : /api/predict est ouvert a tous (mode developpement).")
    yield
    state.clear()


app = FastAPI(
    title="API d'estimation du duty de HT-1 (capteur virtuel)",
    description="Estime le duty de l'echangeur HT-1 a partir des mesures du procede (chaine GPL, simulation DWSIM).",
    version="1.1.0",
    lifespan=lifespan,
)


app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


def artifact():
    art = state.get("artifact")
    if art is None:
        raise HTTPException(status_code=503, detail="Modele non charge")
    return art


def check_row(row, art):
    errors, warnings = [], []
    strict = env_bool("STRICT_RANGES", True)
    margin = float(os.getenv("RANGE_MARGIN", "0.05"))

    unknown = sorted(set(row) - set(art["features"]))
    if unknown:
        warnings.append(f"features ignorees (inconnues du modele): {unknown}")
    missing = [f for f in art["features"] if f not in row]
    if missing:
        errors.append(f"features manquantes: {missing}")

    for feat in art["features"]:
        if feat not in row:
            continue
        value = row[feat]
        lo, hi = art["ranges"][feat]
        tol = margin * (hi - lo)
        if not (lo - tol <= value <= hi + tol):
            msg = f"'{feat}'={value} hors du domaine d'entrainement [{lo:.4g}, {hi:.4g}]"
            (errors if strict else warnings).append(msg)
    return errors, warnings


def to_frame(rows, art):
    return pd.DataFrame([{f: r[f] for f in art["features"]} for r in rows], columns=art["features"])


@app.get("/health")
def health():
    art = artifact()
    return {"status": "ok", "model_version": art["version"]}


@app.get("/model-info", response_model=ModelInfo)
def model_info():
    art = artifact()
    return ModelInfo(model_name=art["model_name"], model_version=art["version"],
                     target=art["target"], features=art["features"],
                     ranges=art["ranges"], example=art["example"], metrics=art["metrics"])


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    art = artifact()
    errors, warnings = check_row(req.features, art)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    duty = float(art["model"].predict(to_frame([req.features], art))[0])
    return PredictResponse(
        duty_HT1_kW=round(duty, 2),
        model_name=art["model_name"],
        model_version=art["version"],
        test_r2=round(art["metrics"]["test_r2"], 5),
        test_mae_kW=round(art["metrics"]["test_mae_kw"], 2),
        warnings=warnings,
    )


@app.post("/predict/batch", response_model=BatchResponse)
def predict_batch(req: BatchRequest):
    art = artifact()
    all_errors = []
    for i, row in enumerate(req.items):
        errors, _ = check_row(row, art)
        all_errors += [f"ligne {i}: {e}" for e in errors]
    if all_errors:
        raise HTTPException(status_code=422, detail=all_errors[:50])
    preds = art["model"].predict(to_frame(req.items, art))
    return BatchResponse(duty_HT1_kW=[round(float(p), 2) for p in preds], model_version=art["version"])




def require_api_key(x_api_key: str = Header(default="")):

    expected = os.getenv("API_KEY", "")
    if expected and not secrets.compare_digest(x_api_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Cle API absente ou invalide")


api = APIRouter(prefix="/api")


@api.get("/model-info", response_model=ApiModelInfo)
def api_model_info():
    art = artifact()
    return ApiModelInfo(
        models=[{"key": "ridge", "model_name": art["model_name"], "model_version": art["version"]}],
        target=art["target"],
        features=art["features"],
        ranges=art["ranges"],
        example=art["example"],
        metrics=art["metrics"],
        range_margin=float(os.getenv("RANGE_MARGIN", "0.05")),
        strict_ranges=env_bool("STRICT_RANGES", True),
        target_range=art.get("target_range", DEFAULT_TARGET_RANGE),
        auth_required=bool(os.getenv("API_KEY")),
        gnn_note=GNN_NOTE,
    )


@api.post("/predict", response_model=PredictResponse, dependencies=[Depends(require_api_key)])
def api_predict(req: PredictRequest, model: str = "ridge"):
    if model != "ridge":
        raise HTTPException(status_code=404, detail=f"Modèle '{model}' indisponible. {GNN_NOTE}")
    return predict(req)


app.include_router(api)


@app.get("/", include_in_schema=False)
def index(request: Request):
    prefill = env_bool("PREFILL_API_KEY", False)
    return templates.TemplateResponse(request, "index.html", {"api_key": os.getenv("API_KEY", "") if prefill else ""})
