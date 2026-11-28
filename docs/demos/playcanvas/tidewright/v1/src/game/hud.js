// TIDEWRIGHT HUD charts, drawn on 2D canvases in KANSEI's palette: the forecast hydrograph (inflow against time)
// and the town gauge (stage against time) with the levee's crest, the low spot, the lowest house floor, the
// player's predicted peak and the coarse CPU reference.
const C = { washi: '#efe8da', mute: '#8f96ad', dim: '#5d6480', beni: '#ff3d7f', cyan: '#33e1ff', gold: '#ffc84a', good: '#3ef0a0', bad: '#ff5b5b', line: 'rgba(236,228,214,.16)' };

function fit(cv) {
  const r = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
  const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}
const mins = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

export function drawForecast(cv, level, t) {
  const { g, w, h } = fit(cv);
  const H = level.hydrograph, T = level.duration, qmax = Math.max(...H.map((p) => p[1])) * 1.15;
  const L = 34, R = 10, Tp = 22, B = 18, X = (s) => L + ((w - L - R) * s) / T, Y = (q) => h - B - ((h - B - Tp) * q) / qmax;
  g.font = '600 10px "Chakra Petch", monospace'; g.fillStyle = C.beni; g.fillText('FORECAST · INFLOW m³/s', L, 13);
  g.strokeStyle = C.line; g.lineWidth = 1;
  for (const q of [100, 200, 300]) if (q < qmax) { g.beginPath(); g.moveTo(L, Y(q)); g.lineTo(w - R, Y(q)); g.stroke(); g.fillStyle = C.dim; g.fillText(String(q), 6, Y(q) + 3); }
  g.fillStyle = C.dim; for (let s = 0; s <= T; s += 1800) g.fillText(mins(s), X(s) - 10, h - 4);
  g.beginPath(); H.forEach(([s, q], k) => (k ? g.lineTo(X(s), Y(q)) : g.moveTo(X(s), Y(q)))); g.lineTo(X(T), Y(H[H.length - 1][1]));
  g.strokeStyle = C.cyan; g.lineWidth = 2; g.stroke();
  g.lineTo(X(T), Y(0)); g.lineTo(X(0), Y(0)); g.closePath(); g.fillStyle = 'rgba(51,225,255,.10)'; g.fill();
  const pk = H.reduce((a, b) => (b[1] > a[1] ? b : a));
  g.fillStyle = C.gold; g.fillText(`peak ${pk[1]} m³/s at ${mins(pk[0])}`, X(pk[0]) + 6, Y(pk[1]) + 4);
  if (t != null) { g.strokeStyle = C.beni; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(t), Tp - 4); g.lineTo(X(t), h - B); g.stroke(); }
}

/** lines: { crest, low, floor } (m); series: [[t, stage, refStage, freeboard, Q]]; prediction: { call, peak }. */
export function gaugeScale(level, lines) { const lo = Math.min(lines.floor, lines.low) - 2.4, hi = Math.max(lines.crest, lines.low) + 0.8; return { lo, hi }; }
export function drawGauge(cv, level, series, lines, prediction, opts = {}) {
  const { g, w, h } = fit(cv);
  const T = level.duration, { lo, hi } = gaugeScale(level, lines);
  const L = 40, R = 10, Tp = 22, B = 18, X = (s) => L + ((w - L - R) * s) / T, Y = (v) => h - B - ((h - B - Tp) * (v - lo)) / (hi - lo);
  g.font = '600 10px "Chakra Petch", monospace'; g.fillStyle = C.beni; g.fillText('TOWN GAUGE · STAGE m', L, 13);
  g.fillStyle = C.dim; for (let s = 0; s <= T; s += 1800) g.fillText(mins(s), X(s) - 10, h - 4);
  // horizontal lines, then their labels pushed apart so none overlap
  const marks = [[lines.crest, C.washi, 'LEVEE CREST', null], [lines.low, C.gold, 'LOW SPOT', null], [lines.floor, C.bad, 'LOWEST FLOOR', [2, 3]]];
  if (prediction && prediction.peak != null) marks.push([prediction.peak, C.beni, `YOUR PEAK · ${prediction.call.toUpperCase()}`, [6, 4]]);
  for (const [v, col, , dash] of marks) { g.setLineDash(dash || []); g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke(); }
  g.setLineDash([]);
  const placed = marks.map((m) => ({ m, y: Y(m[0]) - 3 })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < placed.length; k++) if (placed[k].y - placed[k - 1].y < 11) placed[k].y = placed[k - 1].y + 11;
  for (const { m: [v, col, label], y } of placed) { g.fillStyle = col; g.fillText(label, w - R - g.measureText(label).width, y); g.fillText(v.toFixed(2), 2, y + 6); }
  if (series.length > 1) {
    g.strokeStyle = 'rgba(143,150,173,.8)'; g.lineWidth = 1.2; g.beginPath(); series.forEach((p, k) => (k ? g.lineTo(X(p[0]), Y(p[2])) : g.moveTo(X(p[0]), Y(p[2])))); g.stroke();
    g.strokeStyle = opts.bad ? C.bad : C.cyan; g.lineWidth = 2.2; g.beginPath(); series.forEach((p, k) => (k ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke();
    const p = series[series.length - 1]; g.fillStyle = opts.bad ? C.bad : C.cyan; g.beginPath(); g.arc(X(p[0]), Y(p[1]), 3.5, 0, 7); g.fill();
    g.fillStyle = C.mute; g.fillText('grey: coarse CPU reference', L + 4, Tp + 10);
  }
  return { Y, lo, hi, L, Tp, B, h };
}

export { C as COLORS, mins };
