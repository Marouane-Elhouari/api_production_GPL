(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const FEED1_SHARE = 0.6;

  /* Tuyauterie fidèle au schéma DWSIM : coordonnées 1024x380 */
  const PIPES = [
    { id: "feed1", d: "M 42 55 H 84 V 92 H 98", kind: "liq", port: "start" },
    { id: "feed2", d: "M 42 113 H 70 V 98 H 98", kind: "liq", port: "start" },
    { id: "s5", d: "M 118 96 H 127 V 118 H 213", kind: "liq", arrowAt: [170, 118, 1, 0] },
    { id: "s6", d: "M 227 88 V 76 H 338 V 130", kind: "vap", arrowAt: [280, 76, 1, 0] },
    { id: "s9", d: "M 348 142 H 392", kind: "vap", port: "end" },
    { id: "s7", d: "M 241 124 H 312 V 186 H 198 V 232", kind: "liq", arrowAt: [270, 124, 1, 0] },
    { id: "s10", d: "M 208 242 H 286", kind: "liq", arrowAt: [248, 242, 1, 0] },
    { id: "s11", d: "M 314 242 H 390 V 208 H 414", kind: "liq", arrowAt: [352, 242, 1, 0] },
    { id: "s13", d: "M 428 208 H 456 V 236 H 538", kind: "liq", arrowAt: [498, 236, 1, 0] },
    { id: "s15a", d: "M 566 236 H 632 V 240 H 680", kind: "liq", arrowAt: [605, 236, 1, 0] },
    { id: "s16", d: "M 704 240 H 778 V 180 H 814", kind: "hot", heat: "t16", arrowAt: [742, 240, 1, 0] },
    { id: "top", d: "M 825 156 V 146 H 869 V 159", kind: "vap" },
    { id: "s17", d: "M 880 170 H 960", kind: "cold", port: "end" },
    { id: "reflux", d: "M 869 181 V 188 H 836", kind: "cold" },
    { id: "to-reb", d: "M 825 254 V 262 H 869 V 249", kind: "hot", heat: "reb" },
    { id: "from-reb", d: "M 869 227 V 222 H 836", kind: "hot", heat: "reb" },
    { id: "s18", d: "M 869 249 V 285 H 890 V 320", kind: "hot", heat: "bot", port: "end" },
    { id: "lp-in", d: "M 510 260 H 536 V 245", kind: "steam", port: "start" },
    { id: "lp-out", d: "M 552 250 V 278 H 580", kind: "steam", port: "end" },
    { id: "e1", d: "M 338 202 V 158", kind: "energy", port: "start" },
    { id: "e2", d: "M 168 266 H 188 V 247", kind: "energy", port: "start" },
    { id: "e3", d: "M 300 246 V 280", kind: "energy", port: "end" },
    { id: "e4", d: "M 692 300 V 252", kind: "energy", port: "start" },
    { id: "e5", d: "M 869 159 V 140 H 896", kind: "energy", port: "end" },
    { id: "e6", d: "M 869 249 V 270 H 896", kind: "energy", port: "start" },
  ];

  /* Instruments / bulles de mesure.
     anchor "start"  : bulle sur x, texte à droite
     anchor "end"    : bulle sur x, texte à gauche
     anchor "middle" : bulle à gauche de x, texte à droite (évite que le texte recouvre la bulle) */
  const READOUTS = [
    { id: "feed1", kind: "FI", x: 62, y: 30, anchor: "start", feature: "feed_total_kg_h", digits: 0, unit: "kg/h",
      value: (v) => v.feed_total_kg_h * FEED1_SHARE, tip: "Débit de feed1 : 60 % du total" },
    { id: "feed2", kind: "FI", x: 62, y: 140, anchor: "start", feature: "feed_total_kg_h", digits: 0, unit: "kg/h",
      value: (v) => v.feed_total_kg_h * (1 - FEED1_SHARE), tip: "Débit de feed2 : 40 % du total" },
    { id: "t16", kind: "TI", x: 742, y: 214, anchor: "middle", feature: "T16_C", digits: 1, unit: "°C",
      value: (v) => v.T16_C, tip: "Température du flux 16 sortie HT-1" },
    { id: "f16", kind: "FI", x: 742, y: 262, anchor: "middle", feature: "F16_kg_h", digits: 0, unit: "kg/h",
      value: (v) => v.F16_kg_h, tip: "Débit du flux 16" },
    { id: "pc", kind: "PI", x: 800, y: 136, anchor: "end", feature: "P_cond_barg", digits: 2, unit: "barg",
      value: (v) => v.P_cond_barg, tip: "Pression au condenseur" },
    { id: "rr", kind: "FFI", x: 800, y: 154, anchor: "end", feature: "reflux_ratio", digits: 2, unit: "",
      value: (v) => v.reflux_ratio, tip: "Taux de reflux" },
    { id: "t17", kind: "TI", x: 965, y: 194, anchor: "end", feature: "TOP_T_C", digits: 1, unit: "°C",
      value: (v) => v.TOP_T_C, tip: "Température tête (17)" },
    { id: "t18", kind: "TI", x: 920, y: 310, anchor: "start", feature: "BOT_T_C", digits: 1, unit: "°C",
      value: (v) => v.BOT_T_C, tip: "Température fond (18)" },
  ];

  const state = {
    svg: null,
    pipesByHeat: {},
    readouts: [],
    dutyShown: null,
    anim: null,
  };
  const nfCache = {};

  const isNum = (x) => typeof x === "number" && Number.isFinite(x);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function fmt(x, digits) {
    if (!isNum(x)) return "—";
    if (!nfCache[digits]) {
      nfCache[digits] = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    return nfCache[digits].format(x);
  }

  function el(name, attrs = {}, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0")).join("");
  }
  function mix(a, b, t) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    return rgbToHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
  }
  function heatColor(t) {
    t = clamp(t, 0, 1);
    return t < 0.5 ? mix("#2f5f9e", "#c58b00", t / 0.5) : mix("#c58b00", "#d9480f", (t - 0.5) / 0.5);
  }
  function fraction(value, range) {
    if (!isNum(value) || !range || range[1] === range[0]) return null;
    return clamp((value - range[0]) / (range[1] - range[0]), 0, 1);
  }

  function parsePoints(d) {
    const tokens = d.trim().split(/\s+/);
    const pts = [];
    let x = 0, y = 0, i = 0;
    while (i < tokens.length) {
      const c = tokens[i++];
      if (c === "M" || c === "L") { x = +tokens[i++]; y = +tokens[i++]; }
      else if (c === "H") { x = +tokens[i++]; }
      else if (c === "V") { y = +tokens[i++]; }
      pts.push([x, y]);
    }
    return pts;
  }

  /* Pointe de flèche dont la pointe est en `tip`, orientée selon le vecteur `dir`. */
  function addArrow(group, tip, dir) {
    const len = Math.hypot(dir[0], dir[1]) || 1;
    const ux = dir[0] / len, uy = dir[1] / len;
    const bx = tip[0] - ux * 8, by = tip[1] - uy * 8;
    const nx = -uy * 4, ny = ux * 4;
    el("polygon", { class: "mark-arrow", points: `${tip[0]},${tip[1]} ${bx + nx},${by + ny} ${bx - nx},${by - ny}` }, group);
  }

  function addPort(group, at, dir, energy) {
    const angle = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
    el("polygon", {
      class: "port" + (energy ? " port--energy" : ""),
      points: "-14,-4 -5,-4 0,0 -5,4 -14,4",
      transform: `translate(${at[0]} ${at[1]}) rotate(${angle})`,
    }, group);
  }

  function buildPipes() {
    const layer = state.svg.querySelector("#layer-pipes");
    layer.innerHTML = "";
    PIPES.forEach((p) => {
      const g = el("g", { class: `pipe pipe--${p.kind}`, "data-pipe": p.id }, layer);
      el("path", { class: "pipe-base", d: p.d }, g);
      if (p.kind !== "energy") el("path", { class: "pipe-flow", d: p.d }, g);
      const pts = parsePoints(p.d);
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      const first = pts[0], second = pts[1];
      const energy = p.kind === "energy";
      if (p.port === "end") {
        const dir = [last[0] - prev[0], last[1] - prev[1]];
        const len = Math.hypot(dir[0], dir[1]) || 1;
        const u = [dir[0] / len, dir[1] / len];
        addPort(g, [last[0] + u[0] * 14, last[1] + u[1] * 14], u, energy);
      } else {
        addArrow(g, last, [last[0] - prev[0], last[1] - prev[1]]);
      }
      if (p.port === "start") {
        const dir = [second[0] - first[0], second[1] - first[1]];
        const len = Math.hypot(dir[0], dir[1]) || 1;
        addPort(g, first, [dir[0] / len, dir[1] / len], energy);
      }
      if (p.arrowAt) addArrow(g, [p.arrowAt[0], p.arrowAt[1]], [p.arrowAt[2], p.arrowAt[3]]);
      if (p.heat) (state.pipesByHeat[p.heat] = state.pipesByHeat[p.heat] || []).push(g);
    });
  }

  function focusFeature(feature) {
    window.dispatchEvent(new CustomEvent("pfd:focus", { detail: feature }));
  }

  function makeClickable(node, feature) {
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.dataset.feature = feature;
    node.addEventListener("click", () => focusFeature(feature));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focusFeature(feature); }
    });
  }

  function buildReadouts() {
    const layer = state.svg.querySelector("#layer-readouts");
    if (!layer) return;
    layer.innerHTML = "";
    state.readouts = [];
    READOUTS.forEach((r) => {
      const g = el("g", { class: "readout is-off" }, layer);
      el("title", {}, g).textContent = r.tip + ". Cliquez pour modifier la valeur.";
      const mid = r.anchor === "middle";
      const bx = mid ? r.x - 26 : r.x;
      const tx = mid ? r.x - 14 : (r.anchor === "end" ? r.x - 12 : r.x + 12);
      const ta = mid ? "start" : r.anchor;
      el("circle", { class: "bubble", cx: bx, cy: r.y, r: 8 }, g);
      el("text", { class: "bubble-text", x: bx, y: r.y + 2.5 }, g).textContent = r.kind;
      const text = el("text", { class: "readout-value", x: tx, y: r.y + 4, "text-anchor": ta }, g);
      const valueSpan = el("tspan", {}, text);
      const unitSpan = el("tspan", { class: "readout-unit", dx: 3 }, text);
      makeClickable(g, r.feature);
      state.readouts.push({ def: r, g, valueSpan, unitSpan });
    });
  }

  function init(svg) {
    if (!svg) return;
    state.svg = svg;
    state.pipesByHeat = {};
    buildPipes();
    buildReadouts();
  }

  function setPlaying(playing) {
    if (state.svg) state.svg.classList.toggle("is-paused", !playing);
  }

  function setModelLabel(text) {
    if (!state.svg) return;
    const node = state.svg.querySelector("#tb-model");
    if (node) node.textContent = text;
  }

  function applyHeat(key, t) {
    const color = heatColor(t == null ? 0 : t);
    (state.pipesByHeat[key] || []).forEach((g) => {
      g.style.setProperty("--pipe-dot", color);
      g.style.setProperty("--pipe-base", mix(color, "#ffffff", 0.62));
    });
  }

  function update(values, ctx = {}) {
    if (!state.svg || !values) return;
    const ranges = ctx.ranges || {};

    let duration = 1.6;
    const feed = values.feed_total_kg_h;
    const fr = ranges.feed_total_kg_h;
    if (isNum(feed) && feed > 0 && fr) duration = clamp((1.6 * (fr[0] + fr[1])) / 2 / feed, 0.9, 3.0);
    state.svg.style.setProperty("--flow-dur", duration.toFixed(2) + "s");

    state.readouts.forEach((item) => {
      const raw = item.def.value(values);
      const ok = isNum(raw);
      item.g.classList.toggle("is-off", !ok);
      if (!ok) return;
      item.valueSpan.textContent = fmt(raw, item.def.digits);
      item.unitSpan.textContent = item.def.unit || "";
    });

    applyHeat("t16", fraction(values.T16_C, ranges.T16_C));
    applyHeat("reb", fraction(values.Q_reb_kW, ranges.Q_reb_kW));
    applyHeat("bot", fraction(values.BOT_T_C, ranges.BOT_T_C));

    const cond = fraction(values.Q_cond_kW, ranges.Q_cond_kW);
    const reb = fraction(values.Q_reb_kW, ranges.Q_reb_kW);
    const condBody = state.svg.querySelector("#cond-body");
    const rebBody = state.svg.querySelector("#reb-body");
    if (condBody) condBody.style.fill = mix("#e3edf8", "#8fd3d1", cond == null ? 0 : cond);
    if (rebBody) rebBody.style.fill = mix("#e3edf8", "#f4a27a", reb == null ? 0 : reb);

    /* Étiquettes d'énergie E5 (condenseur) et E6 (rebouilleur) */
    const e5Node = state.svg.querySelector("#e5-energy-val");
    if (e5Node && isNum(values.Q_cond_kW)) e5Node.textContent = fmt(values.Q_cond_kW, 2) + " kW";
    const e6Node = state.svg.querySelector("#e6-energy-val");
    if (e6Node && isNum(values.Q_reb_kW)) e6Node.textContent = fmt(values.Q_reb_kW, 2) + " kW";
  }

  function showDutyText(duty) {
    if (!state.svg) return;
    const big = state.svg.querySelector("#duty-big");
    if (big) big.textContent = isNum(duty) ? fmt(duty, 2) : "—";
    const e4Val = state.svg.querySelector("#e4-energy-val");
    if (e4Val) e4Val.textContent = isNum(duty) ? fmt(duty, 2) + " kW" : "—";
  }

  function setDuty(duty, targetRange) {
    if (!state.svg) return;
    const range = targetRange || [7000, 8000];
    const t = fraction(duty, range);
    const body = state.svg.querySelector("#ht1-body");
    const glow = state.svg.querySelector("#ht1-glow");
    if (body) body.style.fill = mix("#e3edf8", "#f4a27a", t == null ? 0 : t);
    if (glow) {
      const rest = 0.2 + 0.45 * (t == null ? 0 : t);
      glow.style.fill = heatColor(t == null ? 0 : t);
      glow.style.setProperty("--glow-rest", rest.toFixed(2));
      glow.style.opacity = rest.toFixed(2);
      glow.classList.remove("is-pulse");
      void glow.getBoundingClientRect();
      if (!reduceMotion()) {
        glow.classList.add("is-pulse");
        glow.addEventListener("animationend", () => glow.classList.remove("is-pulse"), { once: true });
      }
    }

    if (state.anim) cancelAnimationFrame(state.anim);
    const from = isNum(state.dutyShown) ? state.dutyShown : duty;
    state.dutyShown = duty;
    markStale(false);
    if (reduceMotion() || !isNum(from) || Math.abs(from - duty) < 0.005) {
      showDutyText(duty);
      return;
    }
    const start = performance.now();
    const span = 650;
    const step = (now) => {
      const k = clamp((now - start) / span, 0, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      showDutyText(from + (duty - from) * eased);
      if (k < 1) state.anim = requestAnimationFrame(step);
      else showDutyText(duty);
    };
    state.anim = requestAnimationFrame(step);
  }

  function clearDuty() {
    if (state.anim) cancelAnimationFrame(state.anim);
    state.dutyShown = null;
    showDutyText(null);
    if (!state.svg) return;
    const body = state.svg.querySelector("#ht1-body");
    const glow = state.svg.querySelector("#ht1-glow");
    if (body) body.style.fill = "";
    if (glow) glow.style.opacity = 0;
    markStale(false);
  }

  function markStale(stale) {
    if (!state.svg) return;
    const callout = state.svg.querySelector("#callout");
    if (callout) callout.classList.toggle("is-stale", !!stale);
  }

  window.Pfd = { init, update, setDuty, clearDuty, markStale, setPlaying, setModelLabel, fmt };
})();
