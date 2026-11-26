// SPDX-License-Identifier: GPL-3.0-or-later
// Drives the three Wire Lab worlds in headless Chromium + X_ITE with real mouse events, and solves one challenge per
// world by editing the graph the way a visitor would (through the page's own Graph object, then the page reloads X_ITE).
// v3 adds: real events on the wires (counts equal callbacks), the HUD, the flywheel view, the Blender lane.
//   NODE_PATH=$(npm root -g) node build/test_page.cjs [shots dir]
// Software GL: only event order, counts and field values are claims, never a frame rate.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const here = path.resolve(__dirname, '..'), root = path.resolve(here, '..', '..'), base = '/' + path.relative(root, here).split(path.sep).join('/') + '/';
const v2base = base.replace('/v3/', '/v2/');
const shots = process.argv[2] || path.join(here, 'shots'), full = process.env.FULL_SHOTS || path.join(require('os').tmpdir(), 'wirelab3-full-shots');
fs.mkdirSync(shots, { recursive: true }); fs.mkdirSync(full, { recursive: true });
const types = { '.js': 'text/javascript', '.css': 'text/css', '.x3d': 'model/x3d+xml', '.html': 'text/html', '.json': 'application/json' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  fs.readFile(path.join(root, u), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(u)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null, want = n => !only || only.includes(n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const results = [];
const ok = (cond, label, extra) => { cond ? pass++ : fail++; results.push({ ok: !!cond, label, ...(extra !== undefined ? { got: extra } : {}) }); console.log(cond ? 'ok  ' : 'FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); };
const shot = async (p, name, opts = {}) => { const file = path.join(full, name + '.png'); if (opts.el) await p.locator(opts.el).screenshot({ path: file }); else await p.screenshot({ path: file, fullPage: !!opts.fullPage }); };
// independent cycle finder for the test: a node is on a cycle when it can reach itself; mutual reachability groups them
const cycleGroups = routes => {
  const ids = [...new Set(routes.flatMap(r => [r[0], r[2]]))], reach = a => { const seen = new Set(), st = [a]; while (st.length) { const v = st.pop(); for (const r of routes) if (r[0] === v && !seen.has(r[2])) { seen.add(r[2]); st.push(r[2]); } } return seen; };
  const R = Object.fromEntries(ids.map(i => [i, reach(i)])), groups = [];
  for (const i of ids.filter(i => R[i].has(i))) { const g = groups.find(g => R[g[0]].has(i) && R[i].has(g[0])); g ? g.push(i) : groups.push([i]); }
  return groups;
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const open = async (world, { w = 1500, h = 1000, dsf = 2, v = 'v3' } = {}) => {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
    if (v === 'v3') { p.on('pageerror', e => errors.push(`${world}: ${e.message}`)); p.on('console', m => { if (m.type() === 'error') errors.push(`${world}: ${m.text()}`); });
      p.on('response', r => { if (r.status() >= 400) errors.push(`${world}: ${r.status()} ${r.url()}`); }); }
    await p.goto(`http://localhost:${srv.address().port}${v === 'v3' ? base : v2base}?world=${world}`);
    await p.waitForFunction(() => window.__wirelab && window.__wirelab.loaded >= 1, null, { timeout: 90000 });
    await sleep(2500);
    return p;
  };
  const field = (p, def, name) => p.evaluate(([d, n]) => { const v = window.__wirelab.scene.getNamedNode(d)[n]; return typeof v === 'object' ? String(v) : v; }, [def, name]);
  const click = async (p, x, y) => { await p.mouse.move(x - 5, y - 5); await sleep(200); await p.mouse.move(x, y, { steps: 4 }); await sleep(350); await p.mouse.down(); await sleep(90); await p.mouse.up(); };
  const stage = p => p.evaluate(() => { const r = document.getElementById('x3d').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const edit = async (p, fn) => { const g = await p.evaluate(() => window.__wirelab.loaded); await p.evaluate(fn); await p.evaluate(() => { window.__wirelab.changed(); document.getElementById('tidy').click(); });
    await p.waitForFunction(n => window.__wirelab.loaded > n, g, { timeout: 60000 }); await sleep(1500); };
  const tape = p => p.evaluate(() => [...document.querySelectorAll('#stream .ln .rt')].map(d => d.textContent));
  const findSensor = async (p, s, sensor, xs, ys) => { for (const fy of ys) for (const fx of xs) { const x = s.x + s.w * fx, y = s.y + s.h * fy;
      await p.mouse.move(x - 4, y - 4); await p.mouse.move(x, y, { steps: 3 }); await sleep(300);
      if (await field(p, sensor, 'isOver') === true) return { x, y, fx, fy }; } return null; };
  // independent callbacks: the test's own listeners on the same ROUTE source fields, counting separately from the page
  const probeOn = p => p.evaluate(() => { const w = window.__wirelab; window.__probe = w.graph.routes.map(() => 0);
    w.graph.routes.forEach((r, i) => w.scene.getNamedNode(r[0]).addFieldCallback('test-probe-' + i, r[1], () => { window.__probe[i]++; })); return window.__probe.length; });
  const counts = p => p.evaluate(() => ({ page: window.__wirelab.flow.wires.map(x => x.count), probe: window.__probe.slice(), log: window.__wirelab.graph.routes.map((_, i) => window.__wirelab.flow.log.filter(e => e.index === i).length), total: window.__wirelab.flow.total, taps: window.__wirelab.taps(), routes: window.__wirelab.graph.routes.length }));
  const same = (a, c) => a.length === c.length && a.every((x, i) => x === c[i]);

  // ---- world 1: the door ----
  if (want('door')) { const p = await open('door'), s = await stage(p);
    ok((await p.evaluate(() => document.querySelectorAll('#nodes .node').length)) >= 4, 'door: graph drawn');
    // v3 check 1: before any click nothing has been sent and nothing is drawn
    const idle = await p.evaluate(() => { const w = window.__wirelab, c = document.getElementById('fx'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let a = 0; for (let i = 3; i < d.length; i += 4) a += d[i];
      return { total: w.flow.total, packets: w.hub.packets.length, launched: w.hub.launched, ghost: w.ghost.total, fxAlpha: a, odo: document.getElementById('oTotal').textContent, stream: document.querySelectorAll('#stream .ln').length, badges: [...document.querySelectorAll('.badge')].filter(x => x.style.display !== 'none').length }; });
    ok(idle.total === 0 && idle.packets === 0 && idle.launched === 0 && idle.fxAlpha === 0 && idle.odo === '0' && idle.stream === 0 && idle.badges === 0 && idle.ghost === 0, 'door: before any click the event count is 0 and no packet, glow, badge or stream line is drawn', idle);
    await sleep(1500); ok((await p.evaluate(() => window.__wirelab.flow.total)) === 0 && (await p.evaluate(() => window.__wirelab.hub.launched)) === 0, 'door: a still scene stays still (still 0 events, 0 packets after 1.5 s more)');
    await shot(p, '01-door-idle');
    const taps0 = await probeOn(p); ok(taps0 === 3, 'door: three ROUTEs, three independent test callbacks installed', taps0);
    const y0 = (await field(p, 'Door', 'translation')).split(' ')[1];
    const hit = await findSensor(p, s, 'Click', [0.2, 0.24, 0.28, 0.32, 0.16], [0.5, 0.56, 0.62, 0.44]);
    ok(!!hit, 'door: red button found under the pointer', hit && { fx: hit.fx, fy: hit.fy });
    if (hit) { await p.evaluate(() => { window.__probe.fill(0); });   // count from here: hover callbacks are not ROUTE sources
      await click(p, hit.x, hit.y); await sleep(1300);
      const y1 = (await field(p, 'Door', 'translation')).split(' ')[1];
      ok(Number(y1) > Number(y0) + 0.3, 'door: a real click moved the door up', { before: y0, during: y1 });
      ok((await field(p, 'Timer', 'isActive')) === true, 'door: Timer is running after the click');
      const mid = await p.evaluate(() => ({ launched: window.__wirelab.hub.launched, packets: window.__wirelab.hub.packets.length, total: window.__wirelab.flow.total, odo: document.getElementById('oTotal').textContent, glow: [...window.__wirelab.hub.glow.keys()] }));
      ok(mid.total > 0 && mid.launched > 0, 'door: after the click the event count is greater than 0 and packets were launched', mid);
      await shot(p, '02-door-mid-swing');
      const t = await tape(p);
      ok(t.some(l => l.startsWith('Click.touchTime') && l.includes('Timer.startTime')), 'door: the stream lists Click.touchTime → Timer.startTime', t.slice(-3));
      ok(t.some(l => l.startsWith('Slide.value_changed')), 'door: the stream lists the slide');
      await sleep(3600); ok(Math.abs(Number((await field(p, 'Door', 'translation')).split(' ')[1]) - 1.2) < 0.05, 'door: door is back down after the cycle');
      const c = await counts(p);
      ok(same(c.page, c.probe), 'door: each wire\'s count equals the callbacks the test heard on its own', { page: c.page, probe: c.probe });
      ok(same(c.page, c.log), 'door: each wire\'s count equals the entries in the page\'s own event log', { page: c.page, log: c.log });
      ok(c.total === c.page.reduce((x, y) => x + y, 0) && c.page[0] === 1 && c.page[1] > 5 && c.page[1] === c.page[2], 'door: one click = one touchTime, and the same number of fractions and slides', c.page);
      const shown = await p.evaluate(() => [...document.querySelectorAll('#wireTable .wr .n')].map(x => Number(x.textContent.replace(/,/g, ''))));
      ok(same(shown, c.page), 'door: the per-wire panel shows those counts', shown);
      ok((await p.evaluate(() => Number(document.getElementById('oTotal').textContent.replace(/,/g, '')))) === c.total, 'door: the odometer equals the callbacks received', c.total);
      const cas = await p.evaluate(() => ({ deepest: window.__wirelab.flow.deepest, sharing: window.__wirelab.flow.sharing }));
      ok(cas.deepest >= 1 && cas.sharing >= cas.deepest, 'door: cascade numbers are computed from real timestamps', cas); }
    // the refused wire, through the UI path
    const refused = await p.evaluate(() => { try { window.__wirelab.graph.route('Click', 'isOver', 'Timer', 'startTime'); return 'accepted'; } catch (e) { return e.code; } });
    ok(refused === 'type-mismatch', 'door: isOver to startTime is refused', refused);
    const pt0 = await p.evaluate(() => { const r = document.querySelector('[data-more="Timer"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.click(pt0.x, pt0.y); await sleep(300);
    const pt = sel => p.evaluate(q => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    const a = await pt('.sock.out[data-node="Click"][data-field="isActive"]'), z = await pt('.sock.in[data-node="Timer"][data-field="enabled"]');
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps: 5 });
    const lit = await p.evaluate(() => [document.querySelectorAll('.sock.can').length, document.querySelectorAll('.sock.cannot').length]);
    await shot(p, '03-door-dragging-a-wire');
    await p.mouse.move(z.x, z.y, { steps: 5 }); await p.mouse.up(); await sleep(600);
    ok(lit[0] >= 1 && lit[1] > lit[0], 'door: while dragging, only same-type inputs light up', { can: lit[0], cannot: lit[1] });
    ok(await p.evaluate(() => window.__wirelab.graph.routes.some(r => r.join() === 'Click,isActive,Timer,enabled')), 'door: a dragged wire became a ROUTE');
    const a2 = await pt('.sock.out[data-node="Click"][data-field="isOver"]'), z2 = await pt('.sock.in[data-node="Timer"][data-field="startTime"]');
    await p.mouse.move(a2.x, a2.y); await p.mouse.down(); await p.mouse.move(z2.x, z2.y, { steps: 6 }); await p.mouse.up(); await sleep(300);
    const toast = await p.evaluate(() => getComputedStyle(document.getElementById('toast')).display !== 'none' ? document.getElementById('toast').textContent : '');
    ok(toast.includes('refuses') && toast.includes('TimeTrigger'), 'door: a wrong wire is refused with the reason and a way forward', toast.slice(0, 90));
    await shot(p, '04-door-refused-wire');
    // solve challenge 1 the way the hint says, then hover (no click) and watch the door move
    await p.evaluate(() => document.getElementById('reset').click()); await sleep(2500);
    await edit(p, () => { const g = window.__wirelab.graph, t = g.add('TimeTrigger', 'Hover', { position: [300, -260] }); g.route('Click', 'isOver', 'Hover', 'set_boolean'); g.route('Hover', 'triggerTime', 'Timer', 'startTime'); });
    ok(await p.evaluate(() => document.querySelectorAll('.ch.done').length) === 1, 'door: challenge 1 ticks itself when the graph satisfies it');
    await p.mouse.move(s.x + s.w * 0.9, s.y + s.h * 0.1); await sleep(400);
    await p.mouse.move(hit.x - 4, hit.y - 4); await p.mouse.move(hit.x, hit.y, { steps: 3 }); await sleep(1400);
    ok(Number((await field(p, 'Door', 'translation')).split(' ')[1]) > 1.5, 'door: after the rewire, hovering alone opens the door', await field(p, 'Door', 'translation'));
    await shot(p, '05-door-hover-solved');
    await p.evaluate(() => document.getElementById('reset').click()); await sleep(2500);

    // v3 check 3: editing the graph re-attaches the taps; old wires are not counted twice
    await edit(p, () => { const g = window.__wirelab.graph; g.route('Timer', 'isActive', 'Lamp', 'visible'); });
    const t3 = await p.evaluate(() => ({ taps: window.__wirelab.taps(), routes: window.__wirelab.graph.routes.length, total: window.__wirelab.flow.total }));
    ok(t3.taps === 4 && t3.routes === 4 && t3.total === 0, 'door edit: after adding a wire the page re-tapped all 4 ROUTEs and the counts started again from 0', t3);
    await probeOn(p);
    const hit2 = await findSensor(p, s, 'Click', [0.28, 0.24, 0.32, 0.2, 0.36], [0.5, 0.56, 0.62, 0.44]);
    if (hit2) { await p.evaluate(() => { window.__probe.fill(0); }); await click(p, hit2.x, hit2.y); await sleep(4600);
      const c = await counts(p);
      ok(same(c.page, c.probe) && same(c.page, c.log), 'door edit: after one click every wire\'s count equals the callbacks the test heard and the page\'s log (nothing double counted)', { page: c.page, probe: c.probe });
      ok(c.page[0] === 1 && c.page[3] === 2, 'door edit: the old touchTime wire counted exactly 1; the new Timer.isActive → Lamp.visible wire counted 2 (on, off)', c.page);
      ok((await field(p, 'Lamp', 'visible')) === false, 'door edit: the lamp (hidden by the last event, Timer.isActive false) is off after the timer ended'); }
    // v3 check 5: the flywheel view and the wire panel show the same graph
    const before = await p.evaluate(() => ({ editor: document.querySelectorAll('#wires .wire').length, wheel: window.__wirelab.wheel.model.wires.length, view: window.__wirelab.view() }));
    ok(before.editor === 4 && before.view === 'editor', 'views: editor shows 4 wires', before);
    await p.keyboard.press('f'); await sleep(500);
    const wv = await p.evaluate(() => ({ view: window.__wirelab.view(), wires: window.__wirelab.wheel.model.wires.length, mode: window.__wirelab.wheel.model.mode, editorHidden: getComputedStyle(document.getElementById('graph')).display === 'none', wheelShown: getComputedStyle(document.getElementById('wheel')).display !== 'none' }));
    ok(wv.view === 'wheel' && wv.wires === 4 && wv.editorHidden && wv.wheelShown, 'views: key F switches to the flywheel view, which holds the same 4 wires', wv);
    await p.evaluate(() => document.querySelector('#wireTable [data-cut="3"]').click()); await sleep(900);
    const cut = await p.evaluate(() => ({ routes: window.__wirelab.graph.routes.length, wheel: window.__wirelab.wheel.model.wires.length }));
    ok(cut.routes === 3 && cut.wheel === 3, 'views: a wire cut from the flywheel view\'s panel leaves 3 wires in the graph and in the wheel', cut);
    await p.keyboard.press('f'); await sleep(400);
    ok((await p.evaluate(() => ({ view: window.__wirelab.view(), wires: document.querySelectorAll('#wires .wire').length }))).wires === 3, 'views: back in the editor, the cut shows as 3 wires');
    // key H hides and shows the HUD
    const hudOn = () => p.evaluate(() => ['hud', 'stream', 'wireTable', 'live', 'bl', 'dev'].map(id => !!document.getElementById(id).offsetParent));
    ok((await hudOn()).every(Boolean), 'HUD: visible at the start');
    await p.keyboard.press('h'); await sleep(300); const off = await hudOn();
    ok(off.every(x => !x) && (await p.evaluate(() => document.getElementById('bHud').getAttribute('aria-pressed'))) === 'false', 'HUD: key H hides every HUD panel', off);
    await sleep(200); await shot(p, '06-door-hud-hidden');
    await p.keyboard.press('h'); await sleep(300); ok((await hudOn()).every(Boolean), 'HUD: key H shows them again');
    await p.evaluate(() => document.getElementById('reset').click()); await p.close(); }

  // ---- world 2: the ripple counter ----
  if (want('counter')) { const p = await open('counter'), s = await stage(p);
    const value = () => p.evaluate(() => ['Bit0', 'Bit1', 'Bit2', 'Bit3'].reduce((n, b, i) => n + (window.__wirelab.scene.getNamedNode(b).visible ? 1 << i : 0), 0));
    const hit = await findSensor(p, s, 'Press', [0.5, 0.46, 0.54], [0.8, 0.76, 0.84, 0.72, 0.88]);
    ok(!!hit, 'counter: button found under the pointer', hit && { fx: hit.fx, fy: hit.fy });
    const seen = [await value()];
    for (let i = 0; i < 5; i++) { await click(p, hit.x, hit.y); await sleep(500); seen.push(await value()); }
    ok(seen.join() === '0,1,2,3,0,1', 'counter: five real clicks count 0 1 2 3 0 1 on two wired bits', seen);
    await edit(p, () => { const g = window.__wirelab.graph;
      g.add('BooleanFilter', 'Carry1', { position: [900, -300] }); g.add('BooleanToggle', 'Flip2', { position: [1200, -300] }); g.add('BooleanFilter', 'Carry2', { position: [1500, -300] }); g.add('BooleanToggle', 'Flip3', { position: [1800, -300] });
      g.route('Flip1', 'toggle', 'Carry1', 'set_boolean'); g.route('Carry1', 'inputNegate', 'Flip2', 'set_boolean'); g.route('Flip2', 'toggle', 'Bit2', 'visible');
      g.route('Flip2', 'toggle', 'Carry2', 'set_boolean'); g.route('Carry2', 'inputNegate', 'Flip3', 'set_boolean'); g.route('Flip3', 'toggle', 'Bit3', 'visible'); });
    ok(await p.evaluate(() => document.querySelector('.ch').classList.contains('done')), 'counter: challenge 1 solved by copying the pattern');
    const more = [await value()];
    for (let i = 0; i < 17; i++) { await click(p, hit.x, hit.y); await sleep(420); more.push(await value()); if (i === 10) await shot(p, '07-counter-eleven'); }
    ok(more.join() === '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0,1', 'counter: with four bits, seventeen clicks count 0 to 15 and wrap', more);
    ok((await p.evaluate(() => document.getElementById('readout').textContent)) === '= 1', 'counter: the readout shows the number');
    await edit(p, () => { const g = window.__wirelab.graph; g.routes.forEach(r => { if (r[1] === 'inputNegate') r[1] = 'inputTrue'; }); });
    const down = [await value()];
    for (let i = 0; i < 4; i++) { await click(p, hit.x, hit.y); await sleep(420); down.push(await value()); }
    ok(down.join() === '0,15,14,13,12', 'counter: inputTrue in place of inputNegate counts down', down);
    // a clock presses the button
    await edit(p, () => { const g = window.__wirelab.graph; g.add('TimeSensor', 'Tick', { fields: { loop: 'true', cycleInterval: '0.5' }, position: [0, -300] }); g.add('BooleanTrigger', 'Yes', { position: [300, -300] });
      g.route('Tick', 'cycleTime', 'Yes', 'set_triggerTime'); g.route('Yes', 'triggerTrue', 'Flip0', 'set_boolean'); });
    await probeOn(p); await p.evaluate(() => { window.__probe.fill(0); window.__wirelab.flow.reset(window.__wirelab.flow.routes, performance.now()); });
    const v0 = await value(); await sleep(2600); const v1 = await value();
    ok(v0 !== v1, 'counter: with a TimeSensor and a BooleanTrigger it counts by itself', { v0, v1 });
    ok(await p.evaluate(() => document.querySelectorAll('.ch.done').length) === 3, 'counter: all three challenges tick');
    // v3 check 4: the flywheel shows a hoop if and only if the graph has a cycle (cycles found independently of the page)
    const info = () => p.evaluate(() => { const w = window.__wirelab; return { routes: w.graph.toJSON().routes, hoops: w.wheel.model.hoops.length, mode: w.wheel.model.mode, caption: document.getElementById('caption').textContent, hoopNodes: w.wheel.model.hoops.map(h => h.nodes.slice().sort()) }; });
    await p.keyboard.press('f'); await sleep(700);
    let inf = await info(), cg = cycleGroups(inf.routes);
    ok(cg.length === 0 && inf.hoops === 0 && inf.mode === 'pipeline' && /pipeline, not yet a wheel/i.test(inf.caption), 'counter, clocked: no ROUTE cycle in the graph (computed independently), so no hoop: "a pipeline, not yet a wheel"', { cycles: cg.length, hoops: inf.hoops });
    await shot(p, '08-counter-pipeline');
    // close the loop (the page's one-click edit adds Flip1.toggle → Flip0.set_boolean) and a hoop must appear
    await p.keyboard.press('f'); await sleep(300);
    await edit(p, () => { document.getElementById('closeLoop').click(); });
    await p.keyboard.press('f'); await sleep(900);
    inf = await info(); cg = cycleGroups(inf.routes);
    ok(cg.length >= 1 && inf.hoops === cg.length && inf.mode === 'wheel' && JSON.stringify(cg.map(g => g.slice().sort()).sort()) === JSON.stringify(inf.hoopNodes.slice().sort()), 'counter + feedback: the flywheel shows exactly the hoops the independent search finds, with the same stations', { independent: cg, hoops: inf.hoopNodes });
    await probeOn(p); await p.evaluate(() => { window.__probe.fill(0); window.__wirelab.flow.reset(window.__wirelab.flow.routes, performance.now()); });
    await sleep(2600);
    const cc = await counts(p);
    ok(cc.total > 0 && same(cc.page, cc.probe), 'counter + feedback, clocked: every wire\'s count equals the callbacks the test heard on its own', { total: cc.total, page: cc.page, probe: cc.probe });
    const ink = await p.evaluate(() => { const c = document.getElementById('wheel'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return n / (d.length / 4); });
    ok(ink > 0.002, 'counter + feedback: the flywheel canvas is lit (non-dark pixels)', +ink.toFixed(4));
    await shot(p, '09-counter-flywheel-running');
    const nLoad = await p.evaluate(() => window.__wirelab.loaded); await p.evaluate(() => document.getElementById('reset').click()); await p.waitForFunction(k => window.__wirelab.loaded > k, nLoad, { timeout: 60000 }); await sleep(800);
    inf = await info(); cg = cycleGroups(inf.routes); ok(cg.length === 0 && inf.hoops === 0, 'counter, starter graph: no cycle, no hoop', { cycles: cg.length, hoops: inf.hoops });
    await p.evaluate(() => document.getElementById('reset').click()); await p.close(); }

  // ---- the door with its timer loop: a real wheel ----
  if (want('loop')) { const p = await open('door'), s = await stage(p);
    const info = () => p.evaluate(() => { const w = window.__wirelab; return { routes: w.graph.toJSON().routes, hoops: w.wheel.model.hoops.length, hoopNodes: w.wheel.model.hoops.map(h => h.nodes.slice().sort()) }; });
    let inf = await info(); ok(cycleGroups(inf.routes).length === 0 && inf.hoops === 0, 'door, starter graph: no cycle, no hoop', { hoops: inf.hoops });
    await edit(p, () => { document.getElementById('closeLoop').click(); });
    await p.keyboard.press('f'); await sleep(700);
    inf = await info(); const cg = cycleGroups(inf.routes);
    ok(cg.length === 1 && cg[0].length === 3 && inf.hoops === 1 && JSON.stringify(inf.hoopNodes[0]) === JSON.stringify(cg[0].slice().sort()), 'door + timer loop: one hoop of three stations (Timer, Rewind, Again), as the independent search says', { cycle: cg, hoop: inf.hoopNodes });
    await probeOn(p);
    const hit = await findSensor(p, s, 'Click', [0.28, 0.24, 0.32, 0.2, 0.36], [0.5, 0.56, 0.62, 0.44]);
    if (hit) { await p.evaluate(() => { window.__probe.fill(0); }); await click(p, hit.x, hit.y); await sleep(5200);
      const c = await counts(p);
      ok(same(c.page, c.probe) && c.page[3] >= 3, 'door + timer loop: the timer restarts itself (Timer.isActive fired 3 or more times after one click) and every count equals the callbacks heard', c.page);
      await shot(p, '10-door-wheel-running'); }
    await p.close(); }

  // ---- the Blender lane ----
  if (want('blender')) { const p = await open('door'), s = await stage(p);
    const rec = JSON.parse(fs.readFileSync(path.join(here, 'worlds', 'door.blender-trace.json'), 'utf8'));
    ok(rec.events.length === rec.count && rec.route_counts.reduce((x, y) => x + y, 0) === rec.count && rec.addon_commit.length === 40, 'blender lane: the recording file is consistent (events = count = sum of per-ROUTE counts) and names the add-on commit', { count: rec.count, commit: rec.addon_commit.slice(0, 7), version: rec.addon_version });
    ok(await p.evaluate(() => document.querySelectorAll('#blstream .ln').length) === 0 && (await p.evaluate(() => window.__wirelab.ghost.total)) === 0, 'blender lane: nothing is replayed until the button is pressed');
    await p.selectOption('#blSpeed', '4'); await p.click('#blReplay'); await sleep(900);
    await shot(p, '.tmp-lane-mid');
    await p.waitForFunction(() => document.getElementById('blReplay').textContent.startsWith('Replay the'), null, { timeout: 20000 }); await sleep(300);
    const lane = await p.evaluate(() => ({ shown: document.getElementById('blCount').textContent.replace(/,/g, ''), total: window.__wirelab.ghost.total, traceCount: window.__wirelab.trace.count, perRoute: window.__wirelab.ghost.wires.map(w => w.count), expect: window.__wirelab.trace.route_counts }));
    ok(Number(lane.shown) === rec.count && lane.total === rec.count && same(lane.perRoute, lane.expect), 'blender lane: the lane says it replayed exactly the recording\'s event count, per ROUTE as well', lane);
    // the same stimulus in X_ITE, then the comparison; the table's X_ITE column must equal the page's own callback log
    await p.click('#blRun'); await p.waitForFunction(() => !document.getElementById('blRun').disabled, null, { timeout: 40000 }); await sleep(600);
    const cmp = await p.evaluate(() => { const w = window.__wirelab, c = w.compare.length !== undefined && document.querySelectorAll('#blTable tbody tr').length ? [...document.querySelectorAll('#blTable tbody tr')].map(tr => [...tr.children].map(td => td.textContent)) : [];
      return { rows: c, log: w.graph.routes.map((_, i) => w.flow.log.filter(e => e.index === i).length), page: w.flow.wires.map(x => x.count), note: document.getElementById('blNote').textContent }; });
    const xcol = cmp.rows.slice(0, 3).map(r => Number(r[2].replace(/,/g, '')));
    ok(same(xcol, cmp.log) && same(xcol, cmp.page), 'blender lane: the comparison table\'s X_ITE column equals the page\'s own callback log (and its counters)', { table: xcol, log: cmp.log });
    const bcol = cmp.rows.slice(0, 3).map(r => Number(r[1].replace(/,/g, ''))); ok(same(bcol, rec.route_counts), 'blender lane: the table\'s Blender column equals the recording\'s per-ROUTE counts', bcol);
    ok(/Order of first events per ROUTE: (the same|different|not comparable)/.test(cmp.note) && /different clocks|frame rate/.test(cmp.note), 'blender lane: the caption states the order verdict and that these are different clocks', cmp.note.slice(0, 160));
    console.log('     comparison:', JSON.stringify(cmp.rows), '|', cmp.note.slice(0, 220));
    await shot(p, '11-door-blender-lane', { el: '#bl' });
    await shot(p, '11b-door-blender-view');
    // independent callbacks vs the table after a manual real click and "Compare now"
    const n0 = await p.evaluate(() => window.__wirelab.loaded); await p.evaluate(() => document.getElementById('reset').click()); await p.waitForFunction(n => window.__wirelab.loaded > n, n0, { timeout: 60000 }); await sleep(1800); await p.evaluate(() => window.scrollTo(0, 0)); await sleep(200); const s2 = await stage(p);
    await probeOn(p); const hit = await findSensor(p, s2, 'Click', [0.28, 0.24, 0.32, 0.2, 0.36], [0.5, 0.56, 0.62, 0.44]);
    ok(!!hit, 'blender lane: the red button is found again for the manual comparison');
    if (hit) { await p.evaluate(() => { window.__probe.fill(0); }); await click(p, hit.x, hit.y); await sleep(4300); await p.click('#blCompare'); await sleep(300);
      const t = await p.evaluate(() => ({ probe: window.__probe.slice(), col: [...document.querySelectorAll('#blTable tbody tr')].slice(0, 3).map(tr => Number(tr.children[2].textContent.replace(/,/g, ''))) }));
      ok(same(t.probe, t.col), 'blender lane: after a real click and "Compare now", the X_ITE column equals the test\'s own callbacks', t); }
    await p.close(); }

  // ---- world 3: the follower ----
  if (want('snake')) { const p = await open('snake'), s = await stage(p);
    const pos = async d => (await field(p, d, 'translation')).split(' ').map(Number);
    await sleep(1500);
    const h1 = await pos('Head'), a1 = await pos('Seg1'), b1 = await pos('Seg2'), c1 = await pos('Seg3');
    await sleep(1200); const h2 = await pos('Head'), a2 = await pos('Seg1');
    const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
    ok(dist(h1, h2) > 0.2 && dist(a1, a2) > 0.1, 'follower: head and first bead are moving', { head: dist(h1, h2).toFixed(2), bead: dist(a1, a2).toFixed(2) });
    ok(dist(h1, a1) > 0.05 && dist(a1, b1) > 0.05, 'follower: each bead lags the one in front', { headToBead1: dist(h1, a1).toFixed(2), bead1ToBead2: dist(a1, b1).toFixed(2) });
    ok(c1.join() === '-3,0.5,0', 'follower: unwired bead 3 rests on the floor', c1);
    const fl = await p.evaluate(() => ({ total: window.__wirelab.flow.total, rate: document.getElementById('oRate').textContent, cont: document.querySelectorAll('#stream .ln.cont').length, launched: window.__wirelab.hub.launched }));
    ok(fl.total > 50 && fl.cont >= 1 && fl.launched > 5, 'follower: a running clock becomes a steady flow (continuous stream lines with a rate, many packets), all counted from real callbacks', fl);
    await shot(p, '12-follower-flowing');
    await edit(p, () => { const g = window.__wirelab.graph;
      g.add('PositionDamper', 'Follow3', { fields: { tau: '0.25', order: '2', initialValue: '-3 0.5 0', initialDestination: '-3 0.5 0' }, position: [900, -420] });
      g.add('PositionDamper', 'Follow4', { fields: { tau: '0.4', order: '2', initialValue: '-4 0.5 0', initialDestination: '-4 0.5 0' }, position: [1500, -420] });
      g.route('Seg2', 'translation', 'Follow3', 'set_destination'); g.route('Follow3', 'value_changed', 'Seg3', 'translation');
      g.route('Seg3', 'translation', 'Follow4', 'set_destination'); g.route('Follow4', 'value_changed', 'Seg4', 'translation'); g.route('Follow4', 'isActive', 'Beacon', 'visible'); });
    await sleep(2500);
    const c2 = await pos('Seg3'), d2 = await pos('Seg4');
    ok(c2[1] > 0.7 && d2[1] > 0.7, 'follower: after wiring, beads 3 and 4 leave the floor and follow', { seg3: c2.map(x => +x.toFixed(2)), seg4: d2.map(x => +x.toFixed(2)) });
    ok((await field(p, 'Beacon', 'visible')) === true, 'follower: the beacon is on while the last damper is still moving');
    await shot(p, '13-follower-four-beads');
    await edit(p, () => { const g = window.__wirelab.graph; g.routes = g.routes.filter(r => !(r[0] === 'Path' && r[2] === 'Head'));
      g.add('PlaneSensor', 'Grab', { parent: 'Rig', fields: { offset: '0 2.2 0' }, position: [0, -420] }); g.route('Grab', 'translation_changed', 'Head', 'translation'); });
    const grab = await findSensor(p, s, 'Grab', [0.5, 0.47, 0.53], [0.42, 0.38, 0.46, 0.34, 0.5]);
    ok(!!grab, 'follower: the head can be found under the pointer after adding a PlaneSensor', grab && { fx: grab.fx, fy: grab.fy });
    if (grab) { const before = await pos('Head'); await p.mouse.down(); await p.mouse.move(grab.x + 160, grab.y - 60, { steps: 12 }); await sleep(500); const after = await pos('Head');
      await p.mouse.up();
      ok(after[0] - before[0] > 0.5 && after[1] - before[1] > 0.1, 'follower: a real mouse drag moves the head right and up', { before: before.map(x => +x.toFixed(2)), after: after.map(x => +x.toFixed(2)) });
      await sleep(9000); ok((await field(p, 'Beacon', 'visible')) === false, 'follower: the beacon goes out once the tail has arrived');
      const tail = await pos('Seg4'); ok(dist(tail, after) < 0.2, 'follower: the last bead ends where the head was dropped', dist(tail, after).toFixed(3)); }
    ok(await p.evaluate(() => document.querySelectorAll('.ch.done').length) === 3, 'follower: all three challenges tick');
    const quiet = await p.evaluate(() => ({ cyc: window.__wirelab.cycles().cyclic.length })); ok(quiet.cyc === 0, 'follower: the follower chain is a pipeline (no ROUTE cycle)', quiet);
    await p.evaluate(() => document.getElementById('reset').click()); await p.close(); }

  // ---- "the graph wires itself": a recorded search played back; counts shown equal the file's ----
  if (want('search')) for (const w of ['door', 'counter']) {
    const rec = JSON.parse(fs.readFileSync(path.join(here, 'data', w + '.trace.json'), 'utf8')), n = rec.candidates.length;
    const p = await open(w), s = await stage(p);
    const pre = await p.evaluate(() => ({ k: window.__search.k(), kTxt: document.getElementById('scK').textContent, nTxt: document.getElementById('scN').textContent }));
    ok(pre.k === 0 && pre.kTxt === '0' && Number(pre.nTxt) === n, `search ${w}: before Watch, nothing is shown and the page says ${n} candidates (the file's count)`, pre);
    await p.evaluate(() => { document.getElementById('scSpeed').value = '110'; }); await p.evaluate(() => document.getElementById('sc').scrollIntoView({ block: 'center' })); await sleep(300);
    await p.click('#scPlay'); await sleep(1400); await shot(p, `17-${w}-search-midway`, { el: '#sc' });
    await p.waitForFunction(k => window.__search.k() === k, n, { timeout: 90000 }); await sleep(900);
    const end = await p.evaluate(() => { const q = window.__search; return { shown: q.shown(), k: document.getElementById('scK').textContent, runs: document.getElementById('scRuns').textContent, verdict: document.getElementById('scVerdict').className, ids: q.drawnIds(), note: document.getElementById('scNote').textContent, load: !document.getElementById('scLoad').hidden }; });
    ok(end.shown.length === n && end.shown.every((v, i) => v === i + 1), `search ${w}: the replay showed exactly candidates.length = ${n} steps, in order`, { shown: end.shown.length });
    ok(Number(end.k) === n && Number(end.runs) === rec.runs && Number(end.runs) === rec.candidates[n - 1].runs_so_far, `search ${w}: it ends on candidate ${n} with ${rec.runs} simulator runs, as in the file`, end.runs);
    const winIds = new Set(rec.winner.nodes.map(x => x.id).concat(rec.winner.routes.flatMap(r => [r[0], r[2]])));
    ok(end.verdict === 'match' && rec.candidates[n - 1].verdict === 'match' && end.ids.length === winIds.size && end.ids.every(i => winIds.has(i)), `search ${w}: the last step is the match and draws exactly the winner's nodes`, end.ids);
    ok(/no language model/i.test(end.note) && /wiring only/.test(end.note) && /not a live one/.test(end.note) && end.note.includes(rec.simulator) && end.load, `search ${w}: the caption says recorded, no language model, names the simulator commit; the winner can be loaded`, end.note.slice(0, 120));
    await shot(p, `18-${w}-search-winner`, { el: '#sc' });
    const mid = Math.floor(n / 3);
    await p.evaluate(m => { const r = document.getElementById('scScrub'); r.value = m; r.dispatchEvent(new Event('input', { bubbles: true })); }, mid); await sleep(300);
    const sc = await p.evaluate(() => ({ k: document.getElementById('scK').textContent, runs: document.getElementById('scRuns').textContent, v: document.getElementById('scVerdict').className, hidden: document.getElementById('scLoad').hidden }));
    ok(Number(sc.k) === mid && Number(sc.runs) === rec.candidates[mid - 1].runs_so_far && sc.v === rec.candidates[mid - 1].verdict && sc.hidden, `search ${w}: the scrubber at ${mid} shows that candidate's runs-so-far and verdict from the file`, sc);
    await p.evaluate(m => { const r = document.getElementById('scScrub'); r.value = m; r.dispatchEvent(new Event('input', { bubbles: true })); }, n); await sleep(200);
    // load the winner and prove it works in X_ITE with a real click
    const n0 = await p.evaluate(() => window.__wirelab.loaded); await p.click('#scLoad'); await p.waitForFunction(k => window.__wirelab.loaded > k, n0, { timeout: 60000 }); await sleep(2200);
    await p.evaluate(() => window.scrollTo(0, 0)); await sleep(200); const s2 = await stage(p);
    const loaded = await p.evaluate(() => ({ routes: window.__wirelab.graph.routes, plan: window.__search.plan.routes, taps: window.__wirelab.taps() }));
    ok(same(loaded.routes.map(r => r.join(' ')), loaded.plan.map(r => r.join(' '))) && loaded.taps === loaded.routes.length, `search ${w}: loading the winner gives exactly the winner's ROUTEs, all tapped`, { routes: loaded.routes.length, taps: loaded.taps });
    await probeOn(p); const sensor = await p.evaluate(() => window.__search.plan.alias.Touch_Button);
    const hit = await findSensor(p, s2, sensor, [0.28, 0.5, 0.24, 0.32, 0.36, 0.2, 0.7], [0.5, 0.72, 0.56, 0.62, 0.44, 0.35]);
    ok(!!hit, `search ${w}: the loaded winner's sensor ${sensor} is found under the pointer`);
    if (hit) { await p.evaluate(() => window.__probe.fill(0)); await click(p, hit.x, hit.y); await sleep(2500);
      const c = await counts(p);
      ok(c.total > 0 && same(c.page, c.probe) && same(c.page, c.log), `search ${w}: after a real click the loaded winner's counts equal the independent callbacks`, c); }
    await p.close();
  }

  // ---- layout: phone width, a wide screen, the development flywheel ----
  if (want('phone')) { const p = await open('door', { w: 390, h: 844 });
    const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    ok(ov.sw <= ov.iw + 1, 'phone: no horizontal page scroll at 390 px wide', ov);
    await shot(p, '14-door-phone'); await shot(p, '.tmp-phone-full', { fullPage: true }); await p.close(); }
  if (want('wide')) { const p = await open('door', { w: 1920, h: 1080, dsf: 1 });
    const clip = await p.evaluate(() => { const bad = []; for (const sel of ['#hud', '.card', '.odo']) for (const e of document.querySelectorAll(sel)) { if (!e.offsetParent) continue; const r = e.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) bad.push(sel + ':' + Math.round(r.right)); }
      const small = [...document.querySelectorAll('body *')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11 && e.offsetParent).map(e => e.tagName + '.' + e.className + ':' + getComputedStyle(e).fontSize).slice(0, 6); return { bad, small, sw: document.documentElement.scrollWidth }; });
    ok(clip.bad.length === 0 && clip.sw <= 1921, 'wide: nothing clipped at 1920 x 1080', clip);
    ok(clip.small.length === 0, 'type: no HTML text under 11 px', clip.small);
    await shot(p, '15-door-1920'); await p.close(); }
  if (want('dev')) { const p = await open('door');
    await shot(p, '16-development-flywheel', { el: '#dev' });
    const dv = await p.evaluate(() => ({ rows: document.querySelectorAll('#devRail .st').length, links: [...document.querySelectorAll('#devRail a')].map(a => a.href), foot: document.getElementById('devFoot').textContent }));
    ok(dv.rows === 7 && dv.links.length === 8 && dv.links.every(h => /^https:\/\/github\.com\/hagopjay\/[\w.-]+\/pull\/\d+$/.test(h)) && /without a person: 0/.test(dv.foot), 'development flywheel: 7 stages from flywheel.json, 8 source links to hagopjay pull requests, "turns ... without a person: 0"', { rows: dv.rows, links: dv.links.length });
    await p.close(); }

  // ---- before / after: the same world and state in v2 and v3 ----
  if (want('before')) { const p = await open('door', { v: 'v2' }), s = await stage(p);
    await shot(p, '01-door-idle--before-v2');
    const hit = await findSensor(p, s, 'Click', [0.2, 0.24, 0.28, 0.32, 0.16], [0.5, 0.56, 0.62, 0.44]);
    if (hit) { await click(p, hit.x, hit.y); await sleep(1300); await shot(p, '02-door-mid-swing--before-v2'); }
    await p.close(); }

  await b.close(); srv.close();
  fs.writeFileSync(path.join(here, 'build', 'page-test-receipt.json'), JSON.stringify({ pass, fail, errors, results, browser: 'headless Chromium ' + b.version(), x_ite: '16.7.1', date: new Date().toISOString().slice(0, 10) }, null, 1));
  // halve the 2x shots to 1500 x 1000 (phone: 390 x 844) PNGs under 600 KB
  const r = spawnSync('python3', [path.join(__dirname, 'halve_shots.py'), full, shots], { stdio: 'inherit' });
  console.log(`${pass} passed, ${fail} failed; page errors: ${errors.length}`); errors.slice(0, 8).forEach(e => console.log('  ', e));
  process.exit(fail || errors.length || r.status ? 1 : 0);
})();
