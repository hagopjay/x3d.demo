// THERMAL's instruments, drawn on 2D canvases: the variometer, the energy-height tape and the speed-to-fly director.
const C = { ink: '#07080d', washi: '#efe8da', mute: '#8f96ad', dim: '#5d6480', beni: '#ff3d7f', cyan: '#33e1ff', gold: '#ffc84a', good: '#3ef0a0', bad: '#ff5b5b', line: 'rgba(236,228,214,.18)' };
const NUM = "600 12px 'Chakra Petch', ui-monospace, monospace";

function prep(cv) {
  const r = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
  const g = cv.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}

/** The variometer: a dial from -5 to +5 m/s, TE (or the uncompensated reading when that twin is on). */
export function drawVario(cv, s) {
  const { g, w, h } = prep(cv);
  const cx = w / 2, cy = h / 2 + 4, R = Math.min(w, h) / 2 - 16;
  g.lineWidth = 2; g.strokeStyle = C.line; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  const ang = (v) => Math.PI + (Math.max(-5, Math.min(5, v)) / 5) * (Math.PI * 0.8);
  for (let v = -5; v <= 5; v++) {
    const a = ang(v), r0 = v % 5 === 0 ? R - 14 : R - 8;
    g.strokeStyle = v > 0 ? C.good : v < 0 ? C.mute : C.washi;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
    if (v % 1 === 0 && Math.abs(v) % 1 === 0) { g.fillStyle = C.dim; g.font = NUM; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(Math.abs(v)), cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); }
  }
  // the MacCready ring mark
  const am = ang(s.mc); g.fillStyle = C.gold; g.beginPath(); g.arc(cx + Math.cos(am) * (R + 6), cy + Math.sin(am) * (R + 6), 4, 0, 7); g.fill();
  const a = ang(s.vario);
  g.strokeStyle = s.raw ? C.bad : C.cyan; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); g.stroke();
  g.fillStyle = C.washi; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill();
  g.textAlign = 'center'; g.fillStyle = s.raw ? C.bad : C.washi; g.font = "700 22px 'Chakra Petch', monospace";
  g.fillText((s.vario >= 0 ? '+' : '') + s.vario.toFixed(1), cx, cy + R * 0.32);
  g.font = NUM; g.fillStyle = s.raw ? C.bad : C.mute;
  g.fillText(s.raw ? 'RAW dh/dt · STICK THERMALS' : 'TE  d/dt(h + v²/2g)', cx, cy + R + 10);
  g.fillStyle = C.mute; g.textAlign = 'left'; g.fillText('m/s', 10, 16); g.textAlign = 'right'; g.fillStyle = C.gold; g.fillText('MC ' + s.mc.toFixed(1), w - 10, 16);
}

/**
 * The energy-height tape: altitude, energy height (h + v^2/2g), the ground below, the ridge crest, the condensation
 * level, and the predicted arrival heights at the next turnpoint and at the finish.
 */
export function drawTape(cv, s) {
  const { g, w, h } = prep(cv);
  const span = 1200, top = 18, bot = h - 18, mid = (top + bot) / 2;
  const Y = (z) => mid - ((z - s.z) / span) * (bot - top);
  g.font = NUM; g.textBaseline = 'middle';
  for (let z = Math.ceil((s.z - span / 2) / 100) * 100; z <= s.z + span / 2; z += 100) {
    const y = Y(z); if (y < top || y > bot) continue;
    g.strokeStyle = C.line; g.beginPath(); g.moveTo(48, y); g.lineTo(z % 500 === 0 ? 66 : 58, y); g.stroke();
    if (z % 500 === 0) { g.fillStyle = C.dim; g.textAlign = 'right'; g.fillText(String(z), 44, y); }
  }
  const band = (z, col, label, right = true) => {
    const y = Y(z); if (y < top || y > bot) return;
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(48, y); g.lineTo(w - 6, y); g.stroke(); g.lineWidth = 1;
    g.fillStyle = col; g.textAlign = right ? 'right' : 'left'; g.fillText(label, right ? w - 8 : 70, y - 8);
  };
  // ground under the glider, filled
  const yg = Y(s.ground); if (yg < bot) { g.fillStyle = 'rgba(255,91,91,.16)'; g.fillRect(48, Math.max(top, yg), w - 54, bot - Math.max(top, yg)); }
  band(s.ground, C.bad, 'GROUND ' + Math.round(s.z - s.ground) + ' m');
  band(s.crest, C.mute, 'CREST', false);
  band(s.lcl, C.washi, 'CLOUD BASE');
  if (s.arriveNext != null && Number.isFinite(s.arriveNext)) band(s.groundNext + s.arriveNext, C.gold, 'ARRIVE ' + (s.nextName || 'TP') + ' ' + (s.arriveNext >= 0 ? '+' : '') + Math.round(s.arriveNext));
  if (s.arriveFinish != null && Number.isFinite(s.arriveFinish)) band(s.groundFinish + s.arriveFinish, s.arriveFinish > 0 ? C.good : C.bad, 'HOME ' + (s.arriveFinish >= 0 ? '+' : '') + Math.round(s.arriveFinish), false);
  band(s.eh, C.cyan, 'ENERGY ' + Math.round(s.eh), false);
  // the pointer
  g.fillStyle = C.beni; g.beginPath(); g.moveTo(48, mid); g.lineTo(36, mid - 7); g.lineTo(36, mid + 7); g.fill();
  g.fillStyle = C.washi; g.textAlign = 'left'; g.font = "700 16px 'Chakra Petch', monospace"; g.fillText(Math.round(s.z) + ' m', 70, mid);
}

/** The speed-to-fly director: chevrons point the stick's way (up: pull, slow down; down: push, speed up). */
export function drawDirector(cv, s) {
  const { g, w, h } = prep(cv);
  const d = s.airspeed - s.stf;           // km/h fast (+) or slow (-)
  const n = Math.min(4, Math.floor(Math.abs(d) / 5));
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = "700 30px 'Chakra Petch', monospace"; g.fillStyle = C.washi; g.fillText(Math.round(s.airspeed), w / 2, h / 2);
  g.font = NUM; g.fillStyle = C.mute; g.fillText('km/h · STF ' + Math.round(s.stf), w / 2, h / 2 + 24);
  for (let k = 0; k < 4; k++) {
    const on = k < n, up = d > 0;
    g.strokeStyle = on ? (up ? C.gold : C.cyan) : C.line; g.lineWidth = 3;
    const y = up ? h / 2 - 30 - k * 9 : h / 2 + 42 + k * 9, dy = up ? -7 : 7;
    g.beginPath(); g.moveTo(w / 2 - 22, y - dy / 2); g.lineTo(w / 2, y + dy / 2); g.lineTo(w / 2 + 22, y - dy / 2); g.stroke();
  }
  g.font = NUM; g.fillStyle = Math.abs(d) < 5 ? C.good : C.mute; g.fillText(Math.abs(d) < 5 ? 'ON SPEED' : d > 0 ? 'PULL · SLOWER' : 'PUSH · FASTER', w / 2, 12);
}
