// HAUL heads-up display, drawn on 2D canvases over the PlayCanvas view (KANSEI's palette and type).
//   - the tach: rpm arc with the redline, gear, speed, grade, torque, boost (diesel) or motor heat (EV)
//   - the friction circles: every tyre seen from above, its circle as big as its grip (mu Fz), the dot where its
//     force is (inside: gripping; on the rim: at the limit; red: sliding)
//   - the climb: the level's elevation profile, each pitch coloured by its traction margin, the truck on it, the rain
import { DIESEL } from '../sim/spec.js';

const C = { washi: '#efe8da', mute: '#8f96ad', dim: '#5d6480', beni: '#ff3d7f', cyan: '#33e1ff', gold: '#ffc84a', good: '#3ef0a0', bad: '#ff5b5b', ink: 'rgba(9,11,22,0.78)' };

function hiDPI(canvas) {
  const r = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * r) || canvas.height !== Math.round(h * r)) { canvas.width = Math.round(w * r); canvas.height = Math.round(h * r); }
  const g = canvas.getContext('2d'); g.setTransform(r, 0, 0, r, 0, 0);
  return { g, w, h };
}

export function drawTach(canvas, sim) {
  const { g, w, h } = hiDPI(canvas);
  g.clearRect(0, 0, w, h);
  const e = sim.engine, diesel = sim.setup.power === 'diesel';
  const cx = w / 2, cy = h * 0.62, R = Math.min(w, h * 1.4) * 0.42;
  const max = diesel ? 2400 : 8000, red = diesel ? DIESEL.redline : 7200;
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
  const ang = (v) => a0 + (a1 - a0) * Math.min(1, Math.max(0, v / max));
  g.lineCap = 'round';
  g.lineWidth = 7; g.strokeStyle = 'rgba(236,228,214,0.12)'; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
  g.strokeStyle = 'rgba(255,61,127,0.55)'; g.beginPath(); g.arc(cx, cy, R, ang(red), a1); g.stroke();
  g.lineWidth = 7; g.strokeStyle = e.rpm > red ? C.beni : C.cyan; g.beginPath(); g.arc(cx, cy, R, a0, ang(e.rpm)); g.stroke();
  g.fillStyle = C.mute; g.font = '600 10px "Chakra Petch", monospace'; g.textAlign = 'center';
  for (let v = 0; v <= max; v += diesel ? 400 : 2000) { const a = ang(v); g.fillText(String(v / (diesel ? 100 : 1000)), cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16) + 3); }
  const speed = Math.abs(sim.speed * 3.6);
  g.fillStyle = C.washi; g.font = '700 34px "Chakra Petch", monospace'; g.fillText(speed.toFixed(0), cx, cy + 4);
  g.font = '600 10px "Chakra Petch", monospace'; g.fillStyle = C.mute; g.fillText('km/h', cx, cy + 18);
  const gear = diesel ? (e.reverse ? 'R' : String(e.gear + 1)) + (sim.setup.auto ? '' : 'M') : (e.reverse ? 'R' : 'D');
  g.fillStyle = C.gold; g.font = '700 22px "Dela Gothic One", sans-serif'; g.fillText(gear, cx, cy - R * 0.42);
  g.font = '600 9px "Chakra Petch", monospace'; g.fillStyle = e.locked ? C.good : C.dim; if (diesel) g.fillText(e.locked ? 'LOCKUP' : `TC x${e.tr.toFixed(2)}`, cx, cy - R * 0.42 + 13);
  // bars: torque, and boost (diesel) or heat (EV)
  const bar = (y, label, v, col) => {
    g.fillStyle = C.dim; g.textAlign = 'left'; g.fillText(label, 10, y + 7);
    g.fillStyle = 'rgba(236,228,214,0.1)'; g.fillRect(52, y, w - 62, 8);
    g.fillStyle = col; g.fillRect(52, y, (w - 62) * Math.max(0, Math.min(1, v)), 8);
  };
  const tmax = diesel ? 3000 : 65000;
  bar(h - 34, diesel ? 'TORQUE' : 'WHEEL T', Math.abs(e.torque) / tmax, C.cyan);
  if (diesel) bar(h - 18, 'BOOST', e.boost, e.boost < 0.6 && sim.throttle > 0.6 ? C.gold : C.good);
  else bar(h - 18, e.derate < 0.99 ? 'DERATE' : 'HEAT', e.heat, e.heat > 0.72 ? C.bad : C.good);
}

/** Tyres from above: truck (6) and trailer (4). */
export function drawGrip(canvas, sim) {
  const { g, w, h } = hiDPI(canvas);
  g.clearRect(0, 0, w, h);
  const wheels = sim.wheels.concat(sim.trailer ? sim.trailer.wheels : []);
  const scale = h / 18;
  const xs = (w / 2);
  const ytruck = (x) => h * 0.12 + (3.2 - x) * scale;            // forward is up
  const ytrailer = (k) => ytruck(-2.3) + (5 + (k < 2 ? 3.6 : 4.9)) * scale * 0.82;
  const cap = Math.max(...wheels.map((wl) => wl.mu * wl.fz), 1);
  // outlines
  g.strokeStyle = 'rgba(236,228,214,0.18)'; g.lineWidth = 1;
  g.strokeRect(xs - 1.2 * scale, ytruck(4.9), 2.4 * scale, 9.5 * scale);
  if (sim.trailer) g.strokeRect(xs - 1.25 * scale, ytruck(-2.3), 2.5 * scale, 9.5 * scale * 0.82);
  wheels.forEach((wl, k) => {
    const onTr = wl.onTrailer;
    const y = onTr ? ytrailer(k - sim.wheels.length) : ytruck(wl.hub.x);
    const x = xs + (wl.side > 0 ? -1 : 1) * 1.55 * scale;
    const rad = Math.max(3, Math.sqrt((wl.mu * wl.fz) / cap) * scale * 0.9);
    const u = wl.usage, sliding = wl.contact && Math.abs(wl.slip) > 1.5;
    g.strokeStyle = !wl.contact ? C.dim : sliding ? C.bad : u > 0.9 ? C.gold : 'rgba(62,240,160,0.8)';
    g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.stroke();
    if (wl.contact && wl.mu * wl.fz > 0) {
      const lim = wl.mu * wl.fz;
      const dx = -(wl.fy / lim) * rad, dy = -(wl.fx / lim) * rad;
      g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(x + dx, y + dy, 3, 0, Math.PI * 2); g.fill();
    }
    if (wl.drive !== 0 && !onTr) { g.fillStyle = C.cyan; g.fillRect(x + (wl.side > 0 ? -rad - 5 : rad + 2), y - 4, 3, 8); }
  });
  g.fillStyle = C.mute; g.font = '600 9px "Chakra Petch", monospace'; g.textAlign = 'center';
  g.fillText('GRIP  mu Fz', xs, h - 4);
}

/** The climb: elevation profile, pitch margins, the truck, the rain. */
export function drawClimb(canvas, sim, best) {
  const { g, w, h } = hiDPI(canvas);
  g.clearRect(0, 0, w, h);
  const L = sim.level, prof = L.profile;
  let ymin = Infinity, ymax = -Infinity;
  for (const y of prof) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const px = (x) => 8 + (x / L.length) * (w - 16);
  const py = (y) => h - 14 - ((y - ymin) / Math.max(1, ymax - ymin)) * (h - 30);
  // pitches coloured by the margin of the setup now (naive / best as the guide)
  for (const p of L.pitches) {
    const m = best ? p.best : p.naive;
    g.fillStyle = m > 0.3 ? 'rgba(62,240,160,0.18)' : m > 0.05 ? 'rgba(255,200,74,0.22)' : 'rgba(255,91,91,0.25)';
    g.fillRect(px(p.x0), 6, px(p.x1) - px(p.x0), h - 20);
    g.fillStyle = C.mute; g.font = '600 9px "Chakra Petch", monospace'; g.textAlign = 'center';
    g.fillText((p.g * 100).toFixed(0) + '%', (px(p.x0) + px(p.x1)) / 2, 14);
  }
  g.strokeStyle = C.washi; g.lineWidth = 1.5; g.beginPath();
  for (let i = 0; i < prof.length; i += 4) { const x = px(i * L.dx), y = py(prof[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  g.fillStyle = C.beni; g.beginPath(); g.arc(px(L.summit), py(prof[Math.min(prof.length - 1, Math.round(L.summit / L.dx))]), 4, 0, Math.PI * 2); g.fill();
  const tx = Math.max(0, Math.min(L.length, sim.out.pos.x));
  g.fillStyle = C.gold; g.beginPath(); g.arc(px(tx), py(prof[Math.min(prof.length - 1, Math.round(tx / L.dx))]), 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.mute; g.textAlign = 'left';
  g.fillText(`WET ${(sim.wetness * 100).toFixed(0)}%`, 8, h - 2);
  g.fillStyle = 'rgba(51,225,255,0.7)'; g.fillRect(56, h - 9, (w - 64) * sim.wetness, 5);
}
