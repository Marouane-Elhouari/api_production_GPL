(() => {
  "use strict";

  const FEATURE_GROUPS = [
    {
      title: "Conditions opératoires et débits",
      open: true,
      features: [
        { key: "feed_total_kg_h", label: "Débit d’alimentation total", unit: "kg/h", step: 100 },
        { key: "F16_kg_h", label: "Débit du flux 16 (entrée T101)", unit: "kg/h", step: 100 },
        { key: "reflux_ratio", label: "Taux de reflux (L/D)", unit: "", step: 0.05 },
        { key: "P_cond_barg", label: "Pression au condenseur", unit: "barg", step: 0.1 },
      ],
    },
    {
      title: "Températures et énergies",
      open: true,
      features: [
        { key: "T15a_C", label: "Température du flux 15a (entrée HT-1)", unit: "°C", step: 0.5 },
        { key: "T16_C", label: "Température du flux 16 (sortie HT-1)", unit: "°C", step: 0.5 },
        { key: "TOP_T_C", label: "Température de tête (flux 17)", unit: "°C", step: 0.5 },
        { key: "BOT_T_C", label: "Température de fond (flux 18)", unit: "°C", step: 0.5 },
        { key: "Q_cond_kW", label: "Duty du condenseur (E5)", unit: "kW", step: 50 },
        { key: "Q_reb_kW", label: "Duty du rebouilleur (E6)", unit: "kW", step: 50 },
      ],
    },
    {
      title: "Compositions de tête (flux 17)",
      open: false,
      features: [
        { key: "TOP_Ethane", label: "Éthane (C2)", unit: "% mol", factor: 100, step: 0.01 },
        { key: "TOP_Propane", label: "Propane (C3)", unit: "% mol", factor: 100, step: 0.1 },
        { key: "TOP_Isobutane", label: "Isobutane (i-C4)", unit: "% mol", factor: 100, step: 0.1 },
        { key: "TOP_N-butane", label: "n-Butane (n-C4)", unit: "% mol", factor: 100, step: 0.1 },
        { key: "TOP_Isopentane", label: "Isopentane (i-C5)", unit: "% mol", factor: 100, step: 0.01 },
        { key: "TOP_N-pentane", label: "n-Pentane (n-C5)", unit: "% mol", factor: 100, step: 0.01 },
        { key: "TOP_N-hexane", label: "n-Hexane (n-C6)", unit: "% mol", factor: 100, step: 0.01 },
      ],
    },
    {
      title: "Compositions de fond (flux 18)",
      open: false,
      features: [
        { key: "BOT_Ethane", label: "Éthane (C2)", unit: "% mol", factor: 100, step: 0.01 },
        { key: "BOT_Propane", label: "Propane (C3)", unit: "% mol", factor: 100, step: 0.05 },
        { key: "BOT_Isobutane", label: "Isobutane (i-C4)", unit: "% mol", factor: 100, step: 0.1 },
        { key: "BOT_N-butane", label: "n-Butane (n-C4)", unit: "% mol", factor: 100, step: 0.1 },
        { key: "BOT_Isopentane", label: "Isopentane (i-C5)", unit: "% mol", factor: 100, step: 0.1 },
        { key: "BOT_N-pentane", label: "n-Pentane (n-C5)", unit: "% mol", factor: 100, step: 0.1 },
        { key: "BOT_N-hexane", label: "n-Hexane (n-C6)", unit: "% mol", factor: 100, step: 0.1 },
      ],
    },
  ];

  const KEY_STORAGE = "duty_api_key";
  const state = {
    info: null,
    values: {},
    model: "ridge",
    results: {},
    history: [],
    seq: 0,
    flowing: true,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    key: $("api-key"),
    keyToggle: $("btn-key-toggle"),
    status: $("status"),
    modelSwitch: $("model-switch"),
    ridgeLabel: $("ridge-label"),
    gnnOpt: $("gnn-opt"),
    btnExample: $("btn-example"),
    btnFlow: $("btn-flow"),
    btnEstimate: $("btn-estimate"),
    toolbarResult: $("toolbar-result"),
    paramsBody: $("params-body"),
    paramsCount: $("params-count"),
    resultBody: $("result-body"),
    pfd: $("pfd"),
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (x, d) => window.Pfd.fmt(x, d);
  const hasGnn = () => !!(state.info && state.info.models.some((m) => m.key === "gnn"));
  const modelEntry = (key) => state.info.models.find((m) => m.key === key);
  const getKey = () => els.key.value.trim();
  const authRequired = () => !state.info || state.info.auth_required !== false;

  /* sessionStorage peut lever une exception (navigation privée, cookies bloqués) */
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* ignoré */ } },
  };

  function setStatus(kind, message) {
    els.status.dataset.state = kind;
    els.status.textContent = message;
  }

  function decimalsFor(span) {
    if (!(span > 0)) return 2;
    return Math.max(0, Math.min(6, Math.ceil(2 - Math.log10(span))));
  }

  class ApiError extends Error {
    constructor(status, messages) {
      super(messages[0] || `Erreur ${status}`);
      this.status = status;
      this.messages = messages;
    }
  }

  async function readError(res) {
    let detail = null;
    try { detail = (await res.json()).detail; } catch (_) { /* corps vide ou non JSON */ }
    if (Array.isArray(detail)) {
      return detail.map((d) => (typeof d === "string" ? d : d.msg || JSON.stringify(d)));
    }
    return [detail || `Erreur serveur (${res.status})`];
  }

  /* Toute erreur réseau (fetch qui lève un TypeError) devient une ApiError :
     le reste du code peut ainsi compter sur `status` et `messages`. */
  async function request(url, options) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      throw new ApiError(0, ["Serveur injoignable. Vérifiez la connexion et l’état de l’API."]);
    }
    if (!res.ok) throw new ApiError(res.status, await readError(res));
    return res.json();
  }

  function loadInfo() {
    return request("/api/model-info");
  }

  function predict(model) {
    const headers = { "Content-Type": "application/json" };
    if (getKey()) headers["X-API-Key"] = getKey();
    return request(`/api/predict?model=${encodeURIComponent(model)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ features: state.values }),
    });
  }

  /* Formulaire des mesures */

  function groupFeatures() {
    const known = new Set();
    const groups = FEATURE_GROUPS.map((g) => {
      const items = g.features.filter((f) => state.info.features.includes(f.key));
      items.forEach((f) => known.add(f.key));
      return { title: g.title, open: g.open, items };
    });
    const rest = state.info.features.filter((k) => !known.has(k)).map((key) => ({ key, label: key, unit: "", step: 0.1 }));
    if (rest.length) groups.push({ title: "Autres mesures", open: false, items: rest });
    return groups.filter((g) => g.items.length);
  }

  function rangeState(key, value) {
    const range = state.info.ranges[key];
    if (!Number.isFinite(value)) return { state: "invalid", hint: "Valeur requise." };
    if (!range) return { state: "", hint: "" };
    const [lo, hi] = range;
    if (value >= lo && value <= hi) return { state: "", hint: "" };
    const tol = state.info.range_margin * (hi - lo);
    const beyond = value < lo - tol || value > hi + tol;
    if (beyond && state.info.strict_ranges) {
      return { state: "invalid", hint: "Hors plage : l’API refusera cette valeur." };
    }
    return { state: "out", hint: "Hors de la plage d’entraînement : estimation moins fiable." };
  }

  function applyRowState(row, key) {
    const r = rangeState(key, state.values[key]);
    if (r.state) row.dataset.state = r.state; else row.removeAttribute("data-state");
    row.querySelector(".row__hint").textContent = r.hint;
  }

  function createRow(f) {
    const range = state.info.ranges[f.key];
    const factor = f.factor || 1;
    const lo = range ? range[0] * factor : 0;
    const hi = range ? range[1] * factor : 100;
    const dec = decimalsFor(hi - lo);
    const current = state.values[f.key];
    const shown = Number.isFinite(current) ? current * factor : (lo + hi) / 2;
    const id = "in-" + f.key;
    const rangeText = range ? `Plage : ${fmt(lo, dec)} à ${fmt(hi, dec)}${f.unit ? " " + f.unit : ""}` : (f.unit || "");

    const row = document.createElement("div");
    row.className = "row";
    row.dataset.feature = f.key;
    row.innerHTML = `
      <div class="row__label">
        <label for="${esc(id)}">${esc(f.label)}</label>
        <span class="row__unit">${esc(rangeText)}</span>
        <span class="row__hint" aria-live="polite"></span>
      </div>
      <input type="range" aria-label="${esc(f.label)}" min="${lo}" max="${hi}" step="${(hi - lo) / 500 || 0.01}" value="${shown}">
      <input type="number" class="num" id="${esc(id)}" step="${f.step || "any"}" value="${shown.toFixed(dec)}">`;

    const slider = row.querySelector('input[type="range"]');
    const number = row.querySelector(".num");

    const commit = (displayValue, source) => {
      const v = parseFloat(displayValue);
      state.values[f.key] = Number.isFinite(v) ? v / factor : NaN;
      if (source === "slider") number.value = v.toFixed(dec);
      if (source === "number" && Number.isFinite(v)) slider.value = v;
      applyRowState(row, f.key);
      onValuesChanged();
    };
    slider.addEventListener("input", () => commit(slider.value, "slider"));
    number.addEventListener("input", () => commit(number.value, "number"));
    number.addEventListener("keydown", (e) => { if (e.key === "Enter") estimate(); });

    applyRowState(row, f.key);
    return row;
  }

  function renderParams() {
    els.paramsBody.innerHTML = "";
    const groups = groupFeatures();
    groups.forEach((g) => {
      const details = document.createElement("details");
      details.className = "group";
      details.open = g.open;
      const summary = document.createElement("summary");
      summary.innerHTML = `<span>${esc(g.title)}</span><span class="group__count">${g.items.length} mesures</span>`;
      details.appendChild(summary);
      g.items.forEach((f) => details.appendChild(createRow(f)));
      els.paramsBody.appendChild(details);
    });
    els.paramsCount.textContent = `${state.info.features.length} mesures attendues par le modèle`;
  }

  function onValuesChanged() {
    window.Pfd.update(state.values, { ranges: state.info.ranges });
    if (Object.keys(state.results).length) {
      window.Pfd.markStale(true);
      const sel = state.results[state.model];
      if (sel && sel.ok) {
        els.toolbarResult.innerHTML = `${esc(fmt(sel.data.duty_HT1_kW, 2))} kW <span class="muted">(mesures modifiées)</span>`;
      }
    }
  }

  /* Estimation */

  function modelLabel(key) {
    const m = state.info && modelEntry(key);
    if (!m) return key.toUpperCase();
    return key === "gnn" ? "GNN" : m.model_name;
  }

  function setBusy(busy) {
    els.btnEstimate.dataset.busy = busy ? "true" : "false";
    els.btnEstimate.textContent = busy ? "Calcul en cours" : "Estimer le duty";
    els.btnEstimate.disabled = busy;
  }

  async function estimate() {
    if (!state.info || els.btnEstimate.dataset.busy === "true") return;
    if (authRequired() && !getKey()) {
      setStatus("error", "Clé API manquante");
      showError(["Saisissez la clé API en haut de la page pour lancer une estimation."]);
      els.key.focus();
      return;
    }
    const missing = state.info.features.filter((f) => !Number.isFinite(state.values[f]));
    if (missing.length) {
      showError([`Mesures manquantes : ${missing.join(", ")}`]);
      return;
    }

    const seq = ++state.seq;
    setBusy(true);
    const keys = hasGnn() ? ["ridge", "gnn"] : ["ridge"];
    const settled = await Promise.allSettled(keys.map((k) => predict(k)));
    if (seq !== state.seq) return;
    setBusy(false);

    state.results = {};
    settled.forEach((s, i) => {
      state.results[keys[i]] = s.status === "fulfilled"
        ? { ok: true, data: s.value }
        : { ok: false, error: s.reason };
    });

    const unauthorized = settled.find((s) => s.status === "rejected" && s.reason.status === 401);
    if (unauthorized) {
      setStatus("error", "Clé API refusée");
      showError(["La clé API est absente ou invalide. Corrigez-la en haut de la page."]);
      state.results = {};
      els.key.focus();
      return;
    }

    const first = settled.find((s) => s.status === "fulfilled");
    if (first) {
      setStatus("");
      state.history.unshift({
        time: new Date().toLocaleTimeString("fr-FR"),
        duty: first.value.duty_HT1_kW,
        model: state.results[state.model] && state.results[state.model].ok ? state.model : keys[settled.indexOf(first)],
      });
      state.history = state.history.slice(0, 5);
    } else if (settled.every((s) => s.reason.status === 0)) {
      setStatus("error", "Serveur injoignable");
    }
    renderResults();
  }

  function markInvalidRows(messages) {
    messages.forEach((m) => {
      const hit = /'([^']+)'/.exec(m);
      if (!hit) return;
      const row = els.paramsBody.querySelector(`.row[data-feature="${CSS.escape(hit[1])}"]`);
      if (!row) return;
      row.dataset.state = "invalid";
      row.querySelector(".row__hint").textContent = "Refusée par l’API : hors du domaine d’entraînement.";
      const details = row.closest("details");
      if (details) details.open = true;
    });
  }

  function showError(messages) {
    const list = Array.isArray(messages) && messages.length ? messages : ["Réponse inattendue du serveur."];
    markInvalidRows(list);
    els.resultBody.innerHTML = `
      <div class="alert" role="alert">
        <strong>L’estimation n’a pas abouti</strong>
        <ul>${list.slice(0, 8).map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
      </div>`;
  }

  function renderResults() {
    const sel = state.results[state.model] && state.results[state.model].ok ? state.results[state.model] : null;
    const fallbackKey = Object.keys(state.results).find((k) => state.results[k].ok);

    if (!sel && !fallbackKey) {
      const first = Object.values(state.results)[0];
      showError(first && first.error ? first.error.messages : null);
      return;
    }
    const shownKey = sel ? state.model : fallbackKey;
    const data = state.results[shownKey].data;
    const duty = data.duty_HT1_kW;

    window.Pfd.setDuty(duty, state.info.target_range);
    els.toolbarResult.innerHTML = `<b>${esc(fmt(duty, 2))}</b> kW`;

    const target = state.info.target_range || [7000, 8000];
    const pct = Math.min(100, Math.max(0, ((duty - target[0]) / (target[1] - target[0])) * 100));

    const facts = [`<dt>Modèle</dt><dd>${esc(data.model_name)}</dd>`];


    let compare = "";
    const entries = Object.entries(state.results);
    if (entries.length > 1) {
      const rows = entries.map(([k, r]) => {
        if (!r.ok) return `<tr><td>${esc(modelLabel(k))}</td><td colspan="2">${esc(r.error.messages[0])}</td></tr>`;
        const gap = r.data.duty_HT1_kW - duty;
        const gapText = k === shownKey ? "référence" : `${gap > 0 ? "+" : ""}${fmt(gap, 2)} kW`;
        return `<tr><td>${esc(modelLabel(k))}</td><td>${esc(fmt(r.data.duty_HT1_kW, 2))} kW</td><td>${esc(gapText)}</td></tr>`;
      }).join("");
      compare = `<table class="compare"><thead><tr><th>Modèle</th><th>Duty</th><th>Écart</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    const warnings = (data.warnings || []).length
      ? `<div class="alert alert--warn"><strong>À noter</strong><ul>${data.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`
      : "";
    const fell = !sel
      ? `<div class="alert alert--warn" role="alert"><strong>Le modèle choisi n’a pas répondu</strong><ul><li>${esc(state.results[state.model].error.messages[0])}</li></ul></div>`
      : "";

    const history = state.history
      .map((h) => `<li><span>${esc(h.time)}, ${esc(modelLabel(h.model))}</span><b>${esc(fmt(h.duty, 2))} kW</b></li>`)
      .join("");

    els.resultBody.innerHTML = `
      <p class="result__figure">${esc(fmt(duty, 2))}<small>kW</small></p>
      <p class="result__sub">soit ${esc(fmt(duty / 1000, 3))} MW pour les mesures saisies</p>
      <div class="gauge" role="img" aria-label="Position du duty dans la plage ${esc(fmt(target[0], 0))} à ${esc(fmt(target[1], 0))} kW">
        <div class="gauge__mark" style="left:${pct.toFixed(1)}%"></div>
      </div>
      <div class="gauge__scale"><span>${esc(fmt(target[0], 0))} kW</span><span>${esc(fmt(target[1], 0))} kW</span></div>
      <dl class="facts">${facts.join("")}</dl>
      ${compare}${fell}${warnings}
      <div class="history"><h3>Dernières estimations</h3><ol>${history}</ol></div>`;
  }

  /* Initialisation */

  function setModel(key) {
    state.model = key;
    const entry = state.info && modelEntry(key);
    window.Pfd.setModelLabel(entry ? `${modelLabel(key)} (${String(entry.model_version).split("-")[0]})` : key);
    if (state.results[key] && state.results[key].ok) {
      window.Pfd.setDuty(state.results[key].data.duty_HT1_kW, state.info.target_range);
      renderResults();
    }
  }

  function bindEvents() {
    els.key.addEventListener("change", () => {
      store.set(KEY_STORAGE, getKey());
      if (state.info && (getKey() || !authRequired())) estimate();
    });
    els.keyToggle.addEventListener("click", () => {
      const show = els.key.type === "password";
      els.key.type = show ? "text" : "password";
      els.keyToggle.textContent = show ? "Masquer" : "Afficher";
      els.keyToggle.setAttribute("aria-pressed", String(show));
    });
    els.btnEstimate.addEventListener("click", estimate);
    els.btnExample.addEventListener("click", () => {
      state.values = Object.assign({}, state.info.example);
      renderParams();
      onValuesChanged();
    });
    els.btnFlow.addEventListener("click", () => {
      state.flowing = !state.flowing;
      window.Pfd.setPlaying(state.flowing);
      els.btnFlow.setAttribute("aria-pressed", String(state.flowing));
      els.btnFlow.textContent = state.flowing ? "Arrêter l’animation" : "Reprendre l’animation";
    });
    els.modelSwitch.addEventListener("change", (e) => {
      if (e.target.name === "model") setModel(e.target.value);
    });
    window.addEventListener("pfd:focus", (e) => {
      const input = document.getElementById("in-" + e.detail);
      if (!input) return;
      const details = input.closest("details");
      if (details) details.open = true;
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      input.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
      input.focus();
      input.select();
    });
  }

  async function start() {
    window.Pfd.init(els.pfd);
    bindEvents();

    /* Clé préremplie par le serveur (option PREFILL_API_KEY). Un gabarit non rendu
       ("{{ api_key }}") ne doit jamais être pris pour une vraie clé. */
    const meta = document.querySelector('meta[name="prefill-key"]');
    const prefill = meta && meta.content && !meta.content.includes("{{") ? meta.content : "";
    els.key.value = prefill || store.get(KEY_STORAGE) || "";

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      state.flowing = false;
      window.Pfd.setPlaying(false);
      els.btnFlow.setAttribute("aria-pressed", "false");
      els.btnFlow.textContent = "Reprendre l’animation";
    }

    try {
      state.info = await loadInfo();
    } catch (err) {
      setStatus("error", "Serveur injoignable");
      els.paramsBody.innerHTML = `<div class="alert" role="alert"><strong>Impossible de charger le modèle</strong><ul><li>${esc(err.message)}</li></ul></div>`;
      return;
    }

    state.values = Object.assign({}, state.info.example);
    if (els.gnnOpt) {
      const gnnInput = els.gnnOpt.querySelector("input");
      if (gnnInput) gnnInput.disabled = !hasGnn();
      els.gnnOpt.title = hasGnn() ? "Réseau de neurones sur graphe" : (state.info.gnn_note || "GNN indisponible");
    }
    els.ridgeLabel.textContent = modelLabel("ridge");

    renderParams();
    window.Pfd.update(state.values, { ranges: state.info.ranges });
    setModel("ridge");
    els.btnEstimate.disabled = false;
    els.btnExample.disabled = false;

    if (getKey() || !authRequired()) {
      setStatus("loading", "Première estimation");
      estimate();
    } else {
      setStatus("loading", "Saisissez la clé API");
    }
  }

  start();
})();
