VALID = {
    "reflux_ratio": 2.6,
    "feed_total_kg_h": 185200.0,
    "P_cond_barg": 18.5,
    "T16_C": 144.0,
    "Q_cond_kW": 21000.0,
    "Q_reb_kW": 11000.0,
}


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_model_info(client):
    r = client.get("/model-info")
    assert r.status_code == 200
    body = r.json()
    assert "T16_C" in body["features"]
    assert set(body["example"]) == set(body["features"])


def test_predict_ok(client):
    r = client.post("/predict", json={"features": VALID})
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["duty_HT1_kW"], float)
    assert body["model_version"] == "test-0001"


def test_predict_missing_feature(client):
    bad = dict(VALID)
    bad.pop("Q_cond_kW")
    r = client.post("/predict", json={"features": bad})
    assert r.status_code == 422
    assert "Q_cond_kW" in str(r.json())


def test_predict_out_of_range(client):
    r = client.post("/predict", json={"features": {**VALID, "T16_C": 400.0}})
    assert r.status_code == 422


def test_predict_unknown_feature_warns(client):
    r = client.post("/predict", json={"features": {**VALID, "foo": 1.0}})
    assert r.status_code == 200
    assert any("foo" in w for w in r.json()["warnings"])


def test_predict_batch(client):
    r = client.post("/predict/batch", json={"items": [VALID, {**VALID, "T16_C": 146.0}]})
    assert r.status_code == 200
    preds = r.json()["duty_HT1_kW"]
    assert len(preds) == 2 and preds[1] > preds[0]


def test_index_page_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "btn-key-toggle" in r.text
    assert "{{" not in r.text  # le gabarit est bien rendu


def test_static_assets_served(client):
    for path in ("/static/css/style.css", "/static/js/app.js", "/static/js/process.js"):
        assert client.get(path).status_code == 200


def test_api_model_info_has_front_fields(client):
    body = client.get("/api/model-info").json()
    assert body["models"][0]["key"] == "ridge"
    assert body["range_margin"] == 0.05
    assert body["strict_ranges"] is True
    assert len(body["target_range"]) == 2
    assert body["auth_required"] is False


def test_api_predict_without_key_when_auth_disabled(client):
    r = client.post("/api/predict?model=ridge", json={"features": VALID})
    assert r.status_code == 200


def test_api_predict_requires_key_when_configured(client, monkeypatch):
    monkeypatch.setenv("API_KEY", "secret")
    assert client.get("/api/model-info").json()["auth_required"] is True
    assert client.post("/api/predict", json={"features": VALID}).status_code == 401
    bad = client.post("/api/predict", json={"features": VALID}, headers={"X-API-Key": "nope"})
    assert bad.status_code == 401
    ok = client.post("/api/predict", json={"features": VALID}, headers={"X-API-Key": "secret"})
    assert ok.status_code == 200


def test_api_predict_unknown_model(client):
    r = client.post("/api/predict?model=gnn", json={"features": VALID})
    assert r.status_code == 404


def test_api_predict_out_of_range_still_422(client):
    r = client.post("/api/predict", json={"features": {**VALID, "T16_C": 400.0}})
    assert r.status_code == 422


def test_prefill_key_is_opt_in(client, monkeypatch):
    monkeypatch.setenv("API_KEY", "s3cr3t-demo")
    assert "s3cr3t-demo" not in client.get("/").text
    monkeypatch.setenv("PREFILL_API_KEY", "true")
    assert "s3cr3t-demo" in client.get("/").text
