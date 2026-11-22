// SPDX-License-Identifier: GPL-3.0-or-later
// Drives the three Wire Lab worlds in headless Chromium + X_ITE with real mouse events, and solves one challenge per
// world by editing the graph the way a visitor would (through the page's own Graph object, then the page reloads X_ITE).
//   NODE_PATH=$(npm root -g) node build/test_page.cjs [shots dir]
// Software GL: only event order and field values are claims, never a frame rate.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const here = path.resolve(__dirname, '..'), root = path.resolve(here, '..', '..'), base = '/' + path.relative(root, here).split(path.sep).join('/') + '/', shots = process.argv[2] || path.join(here, 'shots');
fs.mkdirSync(shots, { recursive: true });
const types = { '.js': 'text/javascript', '.css': 'text/css', '.x3d': 'model/x3d+xml', '.html': 'text/html', '.json': 'application/json' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  fs.readFile(path.join(root, u), (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(u)] || 'application/octet-stream' }); r.end(d); }); }).listen(0);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const results = [];
const ok = (cond, label, extra) => { cond ? pass++ : fail++; results.push({ ok: !!cond, label, ...(extra !== undefined ? { got: extra } : {}) }); console.log(cond ? 'ok  ' : 'FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const open = async world => {
    const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
    p.on('pageerror', e => errors.push(`${world}: ${e.message}`)); p.on('console', m => { if (m.type() === 'error') errors.push(`${world}: ${m.text()}`); });
    p.on('response', r => { if (r.status() >= 400) errors.push(`${world}: ${r.status()} ${r.url()}`); });
    await p.goto(`http://localhost:${srv.address().port}${base}?world=${world}`);
    await p.waitForFunction(() => window.__wirelab && window.__wirelab.loaded >= 1, null, { timeout: 90000 });
    await sleep(2500);
    return p;
  };
  const field = (p, def, name) => p.evaluate(([d, n]) => { const v = window.__wirelab.scene.getNamedNode(d)[n]; return typeof v === 'object' ? String(v) : v; }, [def, name]);
  const centre = (p, def) => p.evaluate(d => { const B = X3D.getBrowser(document.getElementById('x3d')), box = document.getElementById('x3d').getBoundingClientRect();
    const n = window.__wirelab.scene.getNamedNode(d); let m = n.getValue().getMatrix?.() ; const t = n.translation; return null; }, def).catch(() => null);
  const click = async (p, x, y) => { await p.mouse.move(x - 5, y - 5); await sleep(200); await p.mouse.move(x, y, { steps: 4 }); await sleep(350); await p.mouse.down(); await sleep(90); await p.mouse.up(); };
  const stage = p => p.evaluate(() => { const r = document.getElementById('x3d').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const edit = async (p, fn) => { const g = await p.evaluate(() => window.__wirelab.loaded); await p.evaluate(fn); await p.evaluate(() => { window.__wirelab.changed(); document.getElementById('tidy').click(); });
    await p.waitForFunction(n => window.__wirelab.loaded > n, g, { timeout: 60000 }); await sleep(1500); };
  const tape = p => p.evaluate(() => [...document.querySelectorAll('#tape div')].map(d => d.textContent));
  // find a sensor's shape on screen: move the real mouse until the sensor itself reports isOver
  const findSensor = async (p, s, sensor, xs, ys) => { for (const fy of ys) for (const fx of xs) { const x = s.x + s.w * fx, y = s.y + s.h * fy;
      await p.mouse.move(x - 4, y - 4); await p.mouse.move(x, y, { steps: 3 }); await sleep(300);
      if (await field(p, sensor, 'isOver') === true) return { x, y, fx, fy }; } return null; };

  // ---- world 1: the door ----
  { const p = await open('door'), s = await stage(p);
    ok((await p.evaluate(() => document.querySelectorAll('#nodes .node').length)) >= 4, 'door: graph drawn');
    const y0 = (await field(p, 'Door', 'translation')).split(' ')[1];
    const hit = await findSensor(p, s, 'Click', [0.2, 0.24, 0.28, 0.32, 0.16], [0.5, 0.56, 0.62, 0.44]);
    ok(!!hit, 'door: red button found under the pointer', hit && { fx: hit.fx, fy: hit.fy });
    await p.screenshot({ path: path.join(shots, '01-door-start.png') });
    if (hit) { await click(p, hit.x, hit.y); await sleep(1300);
      const y1 = (await field(p, 'Door', 'translation')).split(' ')[1];
      ok(Number(y1) > Number(y0) + 0.3, 'door: a real click moved the door up', { before: y0, during: y1 });
      ok((await field(p, 'Timer', 'isActive')) === true, 'door: Timer is running after the click');
      await p.screenshot({ path: path.join(shots, '02-door-opening.png') });
      const t = await tape(p); ok(t.some(l => l.startsWith('Click.touchTime')) && t.some(l => l.startsWith('Slide.value_changed')), 'door: the event tape shows the click and the slide', t.length);
      await sleep(3200); ok(Math.abs(Number((await field(p, 'Door', 'translation')).split(' ')[1]) - 1.2) < 0.05, 'door: door is back down after the cycle'); }
    // the refused wire, through the UI path
    const refused = await p.evaluate(() => { try { window.__wirelab.graph.route('Click', 'isOver', 'Timer', 'startTime'); return 'accepted'; } catch (e) { return e.code; } });
    ok(refused === 'type-mismatch', 'door: isOver to startTime is refused', refused);
    // drag a real wire: Click.isActive -> Timer.enabled (both SFBool) after expanding Timer
    const pt0 = await p.evaluate(() => { const r = document.querySelector('[data-more="Timer"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.click(pt0.x, pt0.y); await sleep(300);
    const pt = sel => p.evaluate(q => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    const a = await pt('.sock.out[data-node="Click"][data-field="isActive"]'), z = await pt('.sock.in[data-node="Timer"][data-field="enabled"]');
    await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps: 5 });
    const lit = await p.evaluate(() => [document.querySelectorAll('.sock.can').length, document.querySelectorAll('.sock.cannot').length]);
    await p.screenshot({ path: path.join(shots, '03-door-dragging-a-wire.png') });
    await p.mouse.move(z.x, z.y, { steps: 5 }); await p.mouse.up(); await sleep(600);
    ok(lit[0] >= 1 && lit[1] > lit[0], 'door: while dragging, only same-type inputs light up', { can: lit[0], cannot: lit[1] });
    ok(await p.evaluate(() => window.__wirelab.graph.routes.some(r => r.join() === 'Click,isActive,Timer,enabled')), 'door: a dragged wire became a ROUTE');
    // drag a wrong wire: Click.isOver -> Timer.startTime -> toast
    const a2 = await pt('.sock.out[data-node="Click"][data-field="isOver"]'), z2 = await pt('.sock.in[data-node="Timer"][data-field="startTime"]');
    await p.mouse.move(a2.x, a2.y); await p.mouse.down(); await p.mouse.move(z2.x, z2.y, { steps: 6 }); await p.mouse.up(); await sleep(300);
    const toast = await p.evaluate(() => getComputedStyle(document.getElementById('toast')).display !== 'none' ? document.getElementById('toast').textContent : '');
    ok(toast.includes('refuses') && toast.includes('TimeTrigger'), 'door: a wrong wire is refused with the reason and a way forward', toast.slice(0, 90));
    await p.screenshot({ path: path.join(shots, '04-door-refused-wire.png') });
    // solve challenge 1 the way the hint says, then hover (no click) and watch the door move
    await p.evaluate(() => document.getElementById('reset').click()); await sleep(2500);
    await edit(p, () => { const g = window.__wirelab.graph, t = g.add('TimeTrigger', 'Hover', { position: [300, -260] }); g.route('Click', 'isOver', 'Hover', 'set_boolean'); g.route('Hover', 'triggerTime', 'Timer', 'startTime'); });
    ok(await p.evaluate(() => document.querySelectorAll('.ch.done').length) === 1, 'door: challenge 1 ticks itself when the graph satisfies it');
    await p.mouse.move(s.x + s.w * 0.9, s.y + s.h * 0.1); await sleep(400);
    await p.mouse.move(hit.x - 4, hit.y - 4); await p.mouse.move(hit.x, hit.y, { steps: 3 }); await sleep(1400);
    ok(Number((await field(p, 'Door', 'translation')).split(' ')[1]) > 1.5, 'door: after the rewire, hovering alone opens the door', await field(p, 'Door', 'translation'));
    await p.screenshot({ path: path.join(shots, '05-door-hover-solved.png') });
    await p.evaluate(() => document.getElementById('reset').click()); await p.close(); }

  // ---- world 2: the ripple counter ----
  { const p = await open('counter'), s = await stage(p);
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
    for (let i = 0; i < 17; i++) { await click(p, hit.x, hit.y); await sleep(420); more.push(await value()); if (i === 10) await p.screenshot({ path: path.join(shots, '06-counter-eleven.png') }); }
    ok(more.join() === '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0,1', 'counter: with four bits, seventeen clicks count 0 to 15 and wrap', more);
    ok((await p.evaluate(() => document.getElementById('readout').textContent)) === '= 1', 'counter: the readout shows the number');
    // count down: swap inputNegate for inputTrue on every carry
    await edit(p, () => { const g = window.__wirelab.graph; g.routes.forEach(r => { if (r[1] === 'inputNegate') r[1] = 'inputTrue'; }); });
    const down = [await value()];
    for (let i = 0; i < 4; i++) { await click(p, hit.x, hit.y); await sleep(420); down.push(await value()); }
    ok(down.join() === '0,15,14,13,12', 'counter: inputTrue in place of inputNegate counts down', down);
    // a clock presses the button
    await edit(p, () => { const g = window.__wirelab.graph; g.add('TimeSensor', 'Tick', { fields: { loop: 'true', cycleInterval: '0.5' }, position: [0, -300] }); g.add('BooleanTrigger', 'Yes', { position: [300, -300] });
      g.route('Tick', 'cycleTime', 'Yes', 'set_triggerTime'); g.route('Yes', 'triggerTrue', 'Flip0', 'set_boolean'); });
    const v0 = await value(); await sleep(2600); const v1 = await value();
    ok(v0 !== v1, 'counter: with a TimeSensor and a BooleanTrigger it counts by itself', { v0, v1 });
    ok(await p.evaluate(() => document.querySelectorAll('.ch.done').length) === 3, 'counter: all three challenges tick');
    await p.screenshot({ path: path.join(shots, '07-counter-self-running.png') });
    await p.evaluate(() => document.getElementById('reset').click()); await p.close(); }

  // ---- world 3: the follower ----
  { const p = await open('snake'), s = await stage(p);
    const pos = async d => (await field(p, d, 'translation')).split(' ').map(Number);
    await sleep(1500);
    const h1 = await pos('Head'), a1 = await pos('Seg1'), b1 = await pos('Seg2'), c1 = await pos('Seg3');
    await sleep(1200); const h2 = await pos('Head'), a2 = await pos('Seg1');
    const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
    ok(dist(h1, h2) > 0.2 && dist(a1, a2) > 0.1, 'follower: head and first bead are moving', { head: dist(h1, h2).toFixed(2), bead: dist(a1, a2).toFixed(2) });
    ok(dist(h1, a1) > 0.05 && dist(a1, b1) > 0.05, 'follower: each bead lags the one in front', { headToBead1: dist(h1, a1).toFixed(2), bead1ToBead2: dist(a1, b1).toFixed(2) });
    ok(c1.join() === '-3,0.5,0', 'follower: unwired bead 3 rests on the floor', c1);
    await p.screenshot({ path: path.join(shots, '08-follower-start.png') });
    await edit(p, () => { const g = window.__wirelab.graph;
      g.add('PositionDamper', 'Follow3', { fields: { tau: '0.25', order: '2', initialValue: '-3 0.5 0', initialDestination: '-3 0.5 0' }, position: [900, -420] });
      g.add('PositionDamper', 'Follow4', { fields: { tau: '0.4', order: '2', initialValue: '-4 0.5 0', initialDestination: '-4 0.5 0' }, position: [1500, -420] });
      g.route('Seg2', 'translation', 'Follow3', 'set_destination'); g.route('Follow3', 'value_changed', 'Seg3', 'translation');
      g.route('Seg3', 'translation', 'Follow4', 'set_destination'); g.route('Follow4', 'value_changed', 'Seg4', 'translation'); g.route('Follow4', 'isActive', 'Beacon', 'visible'); });
    await sleep(2500);
    const c2 = await pos('Seg3'), d2 = await pos('Seg4');
    ok(c2[1] > 0.7 && d2[1] > 0.7, 'follower: after wiring, beads 3 and 4 leave the floor and follow', { seg3: c2.map(x => +x.toFixed(2)), seg4: d2.map(x => +x.toFixed(2)) });
    ok((await field(p, 'Beacon', 'visible')) === true, 'follower: the beacon is on while the last damper is still moving');
    await p.screenshot({ path: path.join(shots, '09-follower-four-beads.png') });
    // take the wheel: PlaneSensor in Rig drives Head; cut Path
    await edit(p, () => { const g = window.__wirelab.graph; g.routes = g.routes.filter(r => !(r[0] === 'Path' && r[2] === 'Head'));
      g.add('PlaneSensor', 'Grab', { parent: 'Rig', fields: { offset: '0 2.2 0' }, position: [0, -420] }); g.route('Grab', 'translation_changed', 'Head', 'translation'); });
    const grab = await findSensor(p, s, 'Grab', [0.5, 0.47, 0.53], [0.42, 0.38, 0.46, 0.34, 0.5]);
    ok(!!grab, 'follower: the head can be found under the pointer after adding a PlaneSensor', grab && { fx: grab.fx, fy: grab.fy });
    if (grab) { const before = await pos('Head'); await p.mouse.down(); await p.mouse.move(grab.x + 160, grab.y - 60, { steps: 12 }); await sleep(500); const after = await pos('Head');
      await p.screenshot({ path: path.join(shots, '10-follower-dragged.png') }); await p.mouse.up();
      ok(after[0] - before[0] > 0.5 && after[1] - before[1] > 0.1, 'follower: a real mouse drag moves the head right and up', { before: before.map(x => +x.toFixed(2)), after: after.map(x => +x.toFixed(2)) });
      await sleep(9000); ok((await field(p, 'Beacon', 'visible')) === false, 'follower: the beacon goes out once the tail has arrived');
      const tail = await pos('Seg4'); ok(dist(tail, after) < 0.2, 'follower: the last bead ends where the head was dropped', dist(tail, after).toFixed(3)); }
    ok(await p.evaluate(() => document.querySelectorAll('.ch.done').length) === 3, 'follower: all three challenges tick');
    await p.evaluate(() => document.getElementById('reset').click()); await p.close(); }

  await b.close(); srv.close();
  fs.writeFileSync(path.join(here, 'build', 'page-test-receipt.json'), JSON.stringify({ pass, fail, errors, results }, null, 1));
  console.log(`${pass} passed, ${fail} failed; page errors: ${errors.length}`); errors.slice(0, 8).forEach(e => console.log('  ', e));
  process.exit(fail || errors.length ? 1 : 0);
})();
