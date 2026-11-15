// Shared by both engine panes. The parent page talks to this by postMessage:
//   {cmd:'load', xml, mode}      replace the world (mode 'conductor': the clock is frozen and the parent sends fractions; 'auto': the file's own TimeSensor runs)
//   {cmd:'frac', f, ghost}       set_fraction on every interpolator; ghost = {on, t:[x,y,z], s:[x,y,z], r:[x,y,z,a]} for the Ghost node
//   {cmd:'mode', mode}           switch between the two without reloading
// The pane answers {ready}, {loaded, nodes}, {fps} and {error}.
(function () {
  const post = (m) => parent.postMessage({ pane: window.ENGINE.name, ...m }, '*');
  let sc = null, interps = [], clock = null, ghost = null, sw = null, frames = 0, last = performance.now(), mode = 'conductor';
  const V3 = (a) => new X3D.SFVec3f(a[0], a[1], a[2]);
  async function load(xml, m) {
    mode = m || 'conductor'; sc = await ENGINE.load(xml);
    interps = [...xml.matchAll(/DEF='(I_[^']+)'/g)].map((x) => sc.getNamedNode(x[1])); const ck = xml.match(/DEF='(Clock_[^']+)'/); clock = ck ? sc.getNamedNode(ck[1]) : null;
    try { ghost = sc.getNamedNode('Ghost'); sw = sc.getNamedNode('GhostSw'); } catch (e) { ghost = sw = null; }
    setMode(mode); post({ loaded: true, interpolators: interps.length });
  }
  function setMode(m) { mode = m; if (!clock) return; if (m === 'auto') { clock.enabled = true; clock.startTime = Date.now() / 1000; } else clock.enabled = false; }
  window.addEventListener('message', async (e) => { const m = e.data || {}; try {
    if (m.cmd === 'hello') { if (window.__readyInfo) post(window.__readyInfo); }
    else if (m.cmd === 'load') await load(m.xml, m.mode);
    else if (m.cmd === 'mode') setMode(m.mode);
    else if (m.cmd === 'frac' && sc) { for (const ip of interps) ip.set_fraction = m.f; const g = m.ghost; if (sw) { sw.whichChoice = g && g.on ? 0 : -1; if (g && g.on && ghost) { ghost.translation = V3(g.t); ghost.scale = V3(g.s); if (g.r) ghost.rotation = new X3D.SFRotation(g.r[0], g.r[1], g.r[2], g.r[3]); } } }
  } catch (err) { post({ error: String(err && err.message || err) }); } });
  (function tick() { frames++; const n = performance.now(); if (n - last > 1000) { post({ fps: Math.round(frames * 1000 / (n - last)) }); frames = 0; last = n; } requestAnimationFrame(tick); })();
  window.__panePost = (m) => { if (m.ready) window.__readyInfo = m; post(m); };
})();
