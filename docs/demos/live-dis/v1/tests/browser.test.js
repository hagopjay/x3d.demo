// browser.test.js: the tests that need a browser. Headless Chromium through Playwright.
//
//   1. What X_ITE does with the six DIS nodes on its own (no runtime loaded).
//   2. The page with its in-page source: every one of the six nodes is "live" as a reader (definition in README.md).
//   3. End to end over UDP on this machine: sender to UDP to gateway to WebSocket to page to X3D node fields,
//      with the Node sender (all nine algorithms), an opendis (Python) sender, and the writer nodes of the page
//      heard by an opendis (Python) receiver.
//
// Needs: playwright with Chromium, the "ws" package, python3 with opendis. Run (about two minutes):
//   node --test tests/browser.test.js
// It uses UDP port 3000 and group 239.1.2.3 on this machine; do not run another DIS sender there at the same time.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './static-server.js';
import { startGateway } from '../gateway/gateway.js';
import { startSender } from '../gateway/send-exercise.js';
import { muLawEncode } from '../src/dis-signal.js';
import { ScriptedExercise } from '../src/dis-exercise.js';
import { DRM_NAME } from '../src/dis-dr.js';
import { record } from './results.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, '../../../..');           // the folder GitHub Pages serves
const demoPath = '/demos/live-dis/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uom = JSON.parse(readFileSync(path.join(here, 'fixtures/uom-dis-fields.json'), 'utf8')).nodes;

let server, browser, rig = {};

function watch(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('page error: ' + e.message));
  page.on('requestfailed', (r) => problems.push('request failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()} ${r.url()}`); });
  return problems;
}

function python(script, args, { waitFor } = {}) {
  // cwd is a neutral directory: the opendis package has a types.py that must never be on the import path first
  const child = spawn('python3', [path.join(here, script), ...args], { cwd: tmpdir() });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve, reject) => child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${script} exited ${code}: ${err}`)))));
  const ready = waitFor ? new Promise((resolve) => { const t = setInterval(() => { if (out.includes(waitFor)) { clearInterval(t); resolve(); } }, 20); }) : Promise.resolve();
  return { done, ready };
}

before(async () => {
  server = await serve(docsRoot, 0);
  browser = await chromium.launch();
  rig = { chromium: browser.version(), playwright: require('playwright/package.json').version, node: process.version, ws: require('ws/package.json').version };
});
after(async () => { await browser?.close(); await server?.close(); });

// ---------------------------------------------------------------------------------------------------------------------
test('1. X_ITE alone: parses the six DIS nodes with every field, and implements none of their behaviour', async () => {
  const page = await browser.newPage({ viewport: { width: 420, height: 320 } });
  const problems = watch(page); let sockets = 0; page.on('websocket', () => sockets++);
  await page.goto(`http://127.0.0.1:${server.port}${demoPath}/tests/fixtures/probe.html`);
  await page.waitForFunction(() => window.X3D && X3D.getBrowser(document.getElementById('c')).currentScene.rootNodes.length > 0, null, { timeout: 30000 });
  await sleep(2500);
  const r = await page.evaluate(async () => {
    const b = X3D.getBrowser(document.getElementById('c')), sc = b.currentScene, C = X3D.X3DConstants;
    const gl = document.createElement('canvas').getContext('webgl2'), ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const typeName = {}, accessName = { [C.initializeOnly]: 'initializeOnly', [C.inputOnly]: 'inputOnly', [C.outputOnly]: 'outputOnly', [C.inputOutput]: 'inputOutput' };
    for (const k of Object.keys(X3D)) if (/^[SM]F[A-Z]/.test(k) && X3D[k].typeName) typeName[C[k]] = k;
    const nodes = {};
    for (const def of ['MGR', 'MAP', 'ESPDU', 'TX', 'SIG', 'RX']) {
      const n = sc.getNamedNode(def), defs = n.getFieldDefinitions(), fields = [];
      for (let i = 0; i < defs.length; i++) fields.push([defs[i].name, typeName[defs[i].dataType] ?? String(defs[i].dataType), accessName[defs[i].accessType]]);
      nodes[n.getNodeTypeName()] = fields;
    }
    const e = sc.getNamedNode('ESPDU'), out = { version: b.version, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', nodes };
    out.afterIdle = { isActive: [e.isActive, sc.getNamedNode('TX').isActive, sc.getNamedNode('SIG').isActive, sc.getNamedNode('RX').isActive], isNetworkReader: e.isNetworkReader, timestamp: e.timestamp, addedEntities: sc.getNamedNode('MGR').addedEntities.length };
    // the SAI node object refuses to set an outputOnly field
    e.isActive = true; await new Promise((res) => setTimeout(res, 100)); out.isActiveAfterSaiSet = e.isActive;
    out.translation = e.translation.toString();
    return out;
  });
  // Where is the red box drawn? It was authored at translation 6 0 0. Find the centre of the red pixels.
  const png = (await page.locator('#c').screenshot()).toString('base64');
  const red = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let sx = 0, n = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) { sx += x; n++; } }
    return { pixels: n, centreX: n ? sx / n : null, width: c.width };
  }, png);
  await page.close();

  const perNode = {};
  for (const [name, want] of Object.entries(uom)) {
    const got = r.nodes[name]; assert.ok(got, `${name} is in the scene X_ITE built`);
    const key = (f) => f.join(' ');
    const missing = want.map(key).filter((k) => !got.map(key).includes(k)), extra = got.map(key).filter((k) => !want.map(key).includes(k));
    perNode[name] = { parses: true, fields_in_specification: want.length, fields_in_x_ite: got.length, name_type_access_mismatches: missing.length + extra.length, first_mismatches: [...missing.slice(0, 3), ...extra.slice(0, 3)] };
  }
  console.log(`X_ITE ${r.version} on ${rig.chromium}, ${r.renderer}`);
  for (const [k, v] of Object.entries(perNode)) console.log(`  ${k}: parses, ${v.fields_in_x_ite} of ${v.fields_in_specification} fields, ${v.name_type_access_mismatches} mismatches of name, type or access ${v.first_mismatches.join(' | ')}`);
  console.log(`  after 2.5 s with networkMode="networkReader": isActive ${JSON.stringify(r.afterIdle.isActive)}, isNetworkReader ${r.afterIdle.isNetworkReader}, WebSockets opened ${sockets}; red box centre at x = ${red.centreX?.toFixed(1)} of ${red.width} (translation ${r.translation})`);
  record('xite_alone', { instrument: { x_ite: r.version, ...rig, renderer: r.renderer }, nodes: perNode, behaviour: { ...r.afterIdle, isActive_after_setting_it_through_the_SAI_node: r.isActiveAfterSaiSet, websockets_opened: sockets, authored_translation: r.translation, red_box_centre_x_px: red.centreX, canvas_width_px: red.width, red_pixels: red.pixels }, console_problems: problems });
  assert.equal(r.version, '16.8.1');
  assert.deepEqual(problems, []);
  for (const v of Object.values(perNode)) assert.equal(v.fields_in_x_ite, v.fields_in_specification);
  assert.deepEqual(r.afterIdle.isActive, [false, false, false, false]);
  assert.equal(r.afterIdle.isNetworkReader, false, 'X_ITE does not act on networkMode');
  assert.equal(sockets, 0);
  assert.ok(red.pixels > 50 && Math.abs(red.centreX - red.width / 2) < 4, 'the child is drawn at the origin: X_ITE ignores the translation of EspduTransform');
});

// ---------------------------------------------------------------------------------------------------------------------
test('2. In-page source: the six nodes are live as readers, the writer nodes emit PDUs, zero console errors', async () => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const problems = watch(page);
  // Start the script 8 s before the helicopter falls silent; with a 3 s time-out it is removed about 11 s in,
  // and the aircraft keys its radio 10 s in.
  const shift = 40 - ((Date.now() / 1000) % 80);
  await page.goto(`http://127.0.0.1:${server.port}${demoPath}/index.html?shift=${shift.toFixed(3)}&timeout=3&rate=1`);
  await page.waitForFunction(() => window.liveDis && window.liveDis.runtime.stats.decoded > 0, null, { timeout: 30000 });
  const r = await page.evaluate(async (seconds) => {
    const L = window.liveDis, R = L.runtime, N = L.nodes, sc = R.scene, { angleBetween } = await import('./src/dis-dr.js'), { axisAngleToMatrix } = await import('./src/dis-geo.js');
    const o = { samples: 0, txStates: new Set(), rxStates: new Set(), txSwitchMismatch: 0, rxSwitchMismatch: 0, buoyRxMismatch: 0, maxTranslationVsDr: 0, maxRotationVsDr: 0, maxOrientationError: 0, maxTurretVsValue: 0, signalDataMatches: 0, signalDataChecks: 0, maxRxPowerDiff: 0, isActive: {}, maxTimestampAge: 0, heloActiveSeen: false, heloInScene: [], articulation: null };
    const t0 = performance.now();
    while (performance.now() - t0 < seconds * 1000) {
      await new Promise((res) => requestAnimationFrame(res));
      o.samples++;
      const a = R.entityRecord(1, 1, 1), A = N.AIRCRAFT;
      if (a.drEcef) {
        const p = R.frame.ecefToLocal(a.drEcef), tr = A.translation;
        o.maxTranslationVsDr = Math.max(o.maxTranslationVsDr, Math.hypot(tr.x - p[0], tr.y - p[1], tr.z - p[2]));
        const ro = A.rotation, M = axisAngleToMatrix([ro.x, ro.y, ro.z, ro.angle]);
        o.maxRotationVsDr = Math.max(o.maxRotationVsDr, angleBetween(M, R.frame.modelToSceneMatrix(a.drMatrix)));
        o.maxOrientationError = Math.max(o.maxOrientationError, angleBetween(a.drMatrix, L.exercise.truth(1, a.tRef + a.drAge).worldToBody));
        o.maxTimestampAge = Math.max(o.maxTimestampAge, Math.abs(L.now() - A.timestamp));
      }
      o.txStates.add(N.TX.transmitState); o.rxStates.add(N.RX.receiverState); if (N.SIG.isActive) o.sigActiveSeen = true;
      if (sc.getNamedNode('TX_SWITCH').whichChoice !== N.TX.transmitState) o.txSwitchMismatch++;
      if (sc.getNamedNode('RX_SWITCH').whichChoice !== N.RX.receiverState) o.rxSwitchMismatch++;
      if (N.BUOY_RX.receiverState !== N.TX.transmitState) o.buoyRxMismatch++;
      const rover = R.entityRecord(1, 1, 2);
      if (rover.lastPdu) {
        const v0 = N.ROVER.articulationParameterValue0_changed, tu = sc.getNamedNode('TURRET').rotation;
        const lag = Math.abs(Math.abs(tu.angle) - Math.abs(v0)); o.turretChecks = (o.turretChecks ?? 0) + 1; if (lag > 1e-6) o.turretLagFrames = (o.turretLagFrames ?? 0) + 1; o.maxTurretVsValue = Math.max(o.maxTurretVsValue, lag); o.turretNow = lag;
        o.articulation = { count: N.ROVER.articulationParameterCount, types: Array.from(N.ROVER.articulationParameterTypeArray), values: Array.from(N.ROVER.articulationParameterArray), pdu: rover.lastPdu.variableParameters.map((p) => [p.parameterType, p.parameterValue]), turretAxis: [tu.x, tu.y, tu.z], gunAngle: sc.getNamedNode('GUN').rotation.angle, value1: N.ROVER.articulationParameterValue1_changed };
      }
      const sig = R.lastPdu[26];
      if (sig && N.SIG.data.length) { o.signalDataChecks++; const d = Array.from(N.SIG.data); if (d.length === sig.pdu.data.length && d.every((x, i) => x === sig.pdu.data[i])) o.signalDataMatches++; }
      const rx = R.radioRecord('ReceiverPdu', 2);
      if (rx.lastPdu) o.maxRxPowerDiff = Math.max(o.maxRxPowerDiff, Math.abs(N.RX.receivedPower - rx.lastPdu.receivedPower));
      const helo = R.entityRecord(1, 1, 4); if (helo && helo.active) o.heloActiveSeen = true;
    }
    const a = R.entityRecord(1, 1, 1), A = N.AIRCRAFT, ship = R.entityRecord(1, 1, 3), tx = R.radioRecord('TransmitterPdu', 1).lastPdu, kids = N.ENTITIES.children;
    const urlOf = (e) => { const w = e.children[0]; const inl = w.children[0]; return inl.getNodeTypeName() + ' ' + inl.url[0]; };
    return {
      ...o, txStates: [...o.txStates], rxStates: [...o.rxStates], found: L.found, stats: R.stats, mode: L.state.mode, sourceBadge: document.getElementById('source').textContent,
      errors: Object.fromEntries([...L.state.errors].map(([k, v]) => [k, { worst: v.worst, mean: v.sum / v.n }])),
      aircraft: { isActive: A.isActive, isNetworkReader: A.isNetworkReader, marking: A.marking, pduMarking: a.lastPdu.marking.text, type: [A.entityKind, A.entityDomain, A.entityCountry, A.entityCategory, A.entitySubcategory, A.entitySpecific, A.entityExtra], pduType: Object.values(a.lastPdu.entityType), forceID: A.forceID, pduForceID: a.lastPdu.forceID, deadReckoning: A.deadReckoning, pduAlgorithm: a.lastPdu.deadReckoning.algorithm, geoCoords: [A.geoCoords.x, A.geoCoords.y, A.geoCoords.z], pdus: a.pdus },
      manager: { added: L.events.added.map((e) => e.marking), removed: L.events.removed.map((e) => e.marking), childrenOfGroup: kids.length, groupMarkings: Array.from(kids, (k) => k.marking), shipModel: ship ? urlOf(ship.node) : null, shipMapping: ship?.mapping?.getNodeName(), heloMappingAtAdd: null, heloStillRegistered: !!R.entityRecord(1, 1, 4) },
      tx: { isActive: N.TX.isActive, frequency: N.TX.frequency, pduFrequency: tx.frequency, power: N.TX.power, pduPower: tx.power, bandwidth: N.TX.transmitFrequencyBandwidth, major: N.TX.modulationTypeMajor, radioKind: N.TX.radioEntityTypeKind, antenna: [N.TX.antennaLocation.x, N.TX.antennaLocation.y, N.TX.antennaLocation.z], antennaFromPdu: R.frame.ecefToLocal(tx.antennaLocation), pdus: R.radioRecord('TransmitterPdu', 1).pdus },
      sig: { isActive: N.SIG.isActive, encodingScheme: N.SIG.encodingScheme, sampleRate: N.SIG.sampleRate, samples: N.SIG.samples, dataLength: N.SIG.dataLength, dataValues: N.SIG.data.length, scopeFrames: L.state.scope.length, pdus: R.radioRecord('SignalPdu', 1).pdus },
      rx: { isActive: N.RX.isActive, transmitter: [N.RX.transmitterSiteID, N.RX.transmitterApplicationID, N.RX.transmitterEntityID, N.RX.transmitterRadioID], pdus: R.radioRecord('ReceiverPdu', 2).pdus },
      buoy: { isNetworkWriter: N.BUOY.isNetworkWriter, isActive: N.BUOY.isActive, written: R.entityRecord(1, 1, 9).written },
    };
  }, 22);
  await page.screenshot({ path: path.join(tmpdir(), 'live-dis-test-2.png') });
  await page.close();
  console.log(`in-page source, ${r.samples} frames sampled over 22 s on ${rig.chromium}`);
  console.log(`  decoded ${r.stats.decoded} PDUs ${JSON.stringify(r.stats.byType)}, errors ${r.stats.errors}, unmatched ${r.stats.unmatched}; writer nodes sent ${JSON.stringify(r.stats.sentByType)}`);
  console.log(`  EspduTransform: translation equals the dead-reckoned position within ${r.maxTranslationVsDr.toExponential(1)} m, rotation within ${r.maxRotationVsDr.toExponential(1)} rad; error against truth ${JSON.stringify(r.errors)}`);
  console.log(`  DISEntityManager: added ${JSON.stringify(r.manager.added)}, removed ${JSON.stringify(r.manager.removed)}; ship model ${r.manager.shipModel} via ${r.manager.shipMapping}`);
  console.log(`  ROUTE lag: frames where the far end had not yet caught up: TX_SWITCH ${r.txSwitchMismatch}, RX_SWITCH ${r.rxSwitchMismatch}, BUOY_RX ${r.buoyRxMismatch} of ${r.samples}`);
  console.log(`  radio: transmitState seen ${r.txStates}, receiverState seen ${r.rxStates}, SignalPdu.data equal to PDU data in ${r.signalDataMatches} of ${r.signalDataChecks} checks`);
  record('in_page', { instrument: rig, seconds: 22, result: r, console_problems: problems });

  assert.deepEqual(problems, [], 'no console error, page error, failed request or HTTP error');
  assert.equal(r.mode, 'local'); assert.match(r.sourceBadge, /in-page/);
  assert.equal(r.stats.errors, 0); assert.equal(r.stats.unmatched, 0);
  // EspduTransform
  assert.ok(r.aircraft.isActive && r.aircraft.isNetworkReader);
  assert.equal(r.aircraft.marking, 'KITE 01'); assert.deepEqual(r.aircraft.type, r.aircraft.pduType); assert.equal(r.aircraft.deadReckoning, r.aircraft.pduAlgorithm); assert.equal(r.aircraft.forceID, r.aircraft.pduForceID);
  assert.ok(r.maxTranslationVsDr < 1e-3 && r.maxRotationVsDr < 1e-3, 'the node fields carry the dead-reckoned pose (float32 precision)');
  // the aircraft can be up to 5.7 m off for a moment when a turn begins between two PDUs (see exercise.test.js)
  assert.ok(r.errors[1].worst < 8 && r.errors[2].worst < 1 && r.errors[3].worst < 1, 'dead reckoning stays near the truth at 1 PDU per second');
  // rolling into a 60 degree bank between two PDUs, the dead-reckoned attitude can lag by most of that for a moment
  assert.ok(r.maxOrientationError < 1.3); assert.ok(r.maxTimestampAge < 2.5);
  assert.ok(Math.abs(r.aircraft.geoCoords[0] - 36.6) < 0.05 && Math.abs(r.aircraft.geoCoords[2] - 600) < 5);
  assert.equal(r.articulation.count, 2); assert.deepEqual(r.articulation.types, [4107, 4429]);
  assert.deepEqual(r.articulation.values, r.articulation.pdu.map((p) => p[1])); console.log(`  turret: ${r.turretLagFrames ?? 0} of ${r.turretChecks} frames where the Script output had not yet caught up with the articulation value (largest gap ${r.maxTurretVsValue.toExponential(1)} rad)`);
  assert.ok((r.turretLagFrames ?? 0) <= 0.1 * r.turretChecks, 'the ROUTE through the Script turns the turret by the articulation value');
  // DISEntityManager and DISEntityTypeMapping
  assert.ok(r.manager.added.includes('CUTTER 03') && r.manager.added.includes('HAWK 04'));
  assert.deepEqual(r.manager.removed, ['HAWK 04'], 'the helicopter fell silent and was reported removed');
  assert.ok(r.heloActiveSeen); assert.equal(r.manager.heloStillRegistered, false);
  assert.deepEqual(r.manager.groupMarkings, ['CUTTER 03'], 'the ROUTEs added both to the Group and removed the helicopter again');
  assert.equal(r.manager.shipModel, 'Inline models/ship.x3d'); assert.equal(r.manager.shipMapping, 'MAP_SHIP');
  // TransmitterPdu, SignalPdu, ReceiverPdu
  assert.ok(r.tx.isActive && r.txStates.includes(1) && r.txStates.includes(2)); // A value set from outside X_ITE reaches the far end of a ROUTE on X_ITE's next frame, so a sample taken in between sees the old value.
  assert.ok(r.txSwitchMismatch <= 0.02 * r.samples, 'ROUTE transmitState -> Switch.whichChoice');
  assert.equal(r.tx.frequency, 305000000); assert.equal(r.tx.frequency, r.tx.pduFrequency); assert.equal(r.tx.power, r.tx.pduPower); assert.equal(r.tx.bandwidth, 25000); assert.equal(r.tx.radioKind, 7);
  assert.ok(Math.hypot(...r.tx.antenna.map((x, i) => x - r.tx.antennaFromPdu[i])) < 1e-3);
  // isActive of the SignalPdu node goes true while the tone is sent and false again 3 s after it ends (the time-out of this test)
  assert.ok(r.sigActiveSeen && r.sig.pdus > 50); assert.equal(r.sig.encodingScheme, 1); assert.equal(r.sig.sampleRate, 8000); assert.equal(r.sig.samples, 160); assert.equal(r.sig.dataLength, 1280); assert.equal(r.sig.dataValues, 160);
  assert.ok(r.signalDataChecks > 0 && r.signalDataMatches === r.signalDataChecks); assert.ok(r.sig.scopeFrames > 0, 'the trace on the page was fed from the node');
  assert.ok(r.rx.isActive && r.rxStates.includes(1) && r.rxStates.includes(2)); assert.ok(r.rxSwitchMismatch <= 0.02 * r.samples, 'ROUTE receiverState -> Switch.whichChoice');
  assert.deepEqual(r.rx.transmitter, [1, 1, 1, 1]); assert.equal(r.maxRxPowerDiff, 0);
  // writers (in-page mode: the PDUs are encoded and counted; nothing listens)
  assert.ok(r.buoy.isNetworkWriter && r.buoy.isActive && r.buoy.written >= 15); assert.ok(r.buoyRxMismatch <= 0.02 * r.samples, 'ROUTE from a reader node into a writer node');
  assert.ok(r.stats.sentByType[25] >= 8 && r.stats.sentByType[27] >= 8);
});

// ---------------------------------------------------------------------------------------------------------------------
test('3. End to end over UDP: senders through gateway and WebSocket to node fields, and writer nodes to opendis', async () => {
  const gw = startGateway({ wsPort: 0, log: () => {} });
  const wsPort = await gw.listening;
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const problems = watch(page);
  await page.goto(`http://127.0.0.1:${server.port}${demoPath}/index.html?gateway=ws://127.0.0.1:${wsPort}`);
  await page.waitForFunction(() => window.liveDis && window.liveDis.state.mode === 'gateway', null, { timeout: 30000 });
  const out = { instrument: { ...rig, transport: 'UDP multicast 239.1.2.3:3000 on one Linux machine, gateway and page on 127.0.0.1' } };

  // --- 3a. writer nodes: page to WebSocket to gateway to UDP to opendis ---------------------------------------------
  await page.evaluate(() => {
    const L = window.liveDis, R = L.runtime, N = L.nodes; window.sentLog = [];
    const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    R.listeners.push((pdu, bytes, dir) => {
      if (dir !== 'sent') return;
      const e = { type: pdu.header.pduType, hex: hex(bytes) };
      if (pdu.header.pduType === 1) { const p = R.frame.ecefToLocal(pdu.location), t = N.BUOY.translation; e.fieldVsPdu = Math.hypot(t.x - p[0], t.y - p[1], t.z - p[2]); e.marking = N.BUOY.marking; }
      if (pdu.header.pduType === 25) { e.nodeState = N.BUOY_TX.transmitState; e.nodeFrequency = N.BUOY_TX.frequency; e.nodePower = N.BUOY_TX.power; const p = R.frame.ecefToLocal(pdu.antennaLocation), t = N.BUOY_TX.antennaLocation; e.fieldVsPdu = Math.hypot(t.x - p[0], t.y - p[1], t.z - p[2]); }
      if (pdu.header.pduType === 26) e.nodeData = Array.from(N.BUOY_SIG.data);
      if (pdu.header.pduType === 27) e.nodeState = N.BUOY_RX.receiverState;
      window.sentLog.push(e);
    });
  });
  const rx = python('opendis_receiver.py', ['239.1.2.3', '3000', '7'], { waitFor: 'READY' });
  await rx.ready; await sleep(300);
  await page.evaluate(() => { window.sentLog.length = 0; });
  await sleep(1500);
  await page.evaluate(() => window.liveDis.keyBuoy());
  const heard = JSON.parse((await rx.done).split('\n').filter((l) => l.startsWith('{')).pop());
  const sentLog = await page.evaluate(() => window.sentLog);
  const byHex = new Map(sentLog.map((e) => [e.hex, e]));
  const w = { opendis: heard.instrument, heard: heard.pdus.length, sent_by_page: sentLog.length, by_type: {}, octets_matched: 0, checks: {} };
  const expectTone = Array.from({ length: 160 }, (_, i) => muLawEncode(9000 * Math.sin(2 * Math.PI * 440 * i / 8000)));
  let espduFieldVsPdu = 0, txStates = new Set(), rxStatesHeard = new Set();
  for (const p of heard.pdus) {
    w.by_type[p.type] = (w.by_type[p.type] ?? 0) + 1;
    const mine = byHex.get(p.hex);
    if (mine) w.octets_matched++;
    assert.deepEqual(p.entity, [1, 1, 9]); assert.equal(p.version, 7);
    if (p.type === 1) { assert.equal(p.marking, 'BUOY 09'); assert.equal(p.algorithm, 2); assert.equal(p.kind, 1); assert.equal(p.domain, 3); assert.equal(p.category, 61); assert.equal(p.forceID, 3); assert.equal(p.octets, 144); if (mine) espduFieldVsPdu = Math.max(espduFieldVsPdu, mine.fieldVsPdu); }
    if (p.type === 25) { assert.equal(p.frequency, 156800000); assert.equal(p.power, 30); assert.equal(p.bandwidth, 25000); assert.equal(p.radioKind, 7); assert.equal(p.major, 3); assert.equal(p.inputSource, 2); assert.equal(p.radioID, 1); txStates.add(p.transmitState); if (mine) assert.equal(p.transmitState, mine.nodeState); }
    if (p.type === 26) { assert.equal(p.encodingScheme, 1); assert.equal(p.sampleRate, 8000); assert.equal(p.samples, 160); assert.deepEqual(p.data, expectTone); }
    if (p.type === 27) { assert.deepEqual(p.transmitter, [1, 1, 1]); assert.equal(p.transmitterRadioID, 1); assert.equal(p.radioID, 1); assert.equal(p.octets, 36); rxStatesHeard.add(p.receiverState); }
  }
  w.checks = { espdu_translation_field_vs_pdu_location_m: espduFieldVsPdu, transmit_states_heard: [...txStates], receiver_states_heard: [...rxStatesHeard] };
  out.writers = w;
  console.log(`writer nodes -> ${heard.instrument}: heard ${w.heard} PDUs ${JSON.stringify(w.by_type)}, ${w.octets_matched} octet-identical to what the page logged; translation field vs PDU location ${espduFieldVsPdu.toExponential(1)} m; transmit states ${[...txStates]}`);
  assert.ok(w.by_type[1] >= 5 && w.by_type[25] >= 2 && w.by_type[26] === 1 && w.by_type[27] >= 2);
  assert.equal(w.octets_matched, w.heard);
  assert.ok(espduFieldVsPdu < 1e-3); assert.ok(txStates.has(2), 'keying the node was heard on UDP');

  // --- 3b. an opendis sender: opendis to UDP to gateway to WebSocket to page ---------------------------------------------
  const before = await page.evaluate(() => ({ ...window.liveDis.runtime.stats }));
  const tx = python('opendis_sender.py', ['239.1.2.3', '3000', '5', '5']);
  const sampler = page.evaluate(async () => {
    const L = window.liveDis, R = L.runtime; const o = { samples: [], seen: false };
    const t0 = performance.now();
    while (performance.now() - t0 < 6500) {
      await new Promise((res) => requestAnimationFrame(res));
      const rec = R.entityRecord(1, 1, 21);
      if (rec && rec.drEcef) { o.seen = true; o.samples.push([rec.tRef + rec.drAge, ...rec.drEcef]); o.last = { location: rec.lastPdu.location, timestamp: rec.lastPdu.header.timestamp, pdus: rec.pdus, marking: rec.node.marking, type: [rec.node.entityKind, rec.node.entityDomain, rec.node.entityCountry, rec.node.entityCategory, 0, 0, 0], mapping: rec.mapping?.getNodeName(), algorithm: rec.node.deadReckoning, velocity: rec.lastPdu.linearVelocity, orientation: Object.values(rec.lastPdu.orientation), translation: [rec.node.translation.x, rec.node.translation.y, rec.node.translation.z], isActive: rec.node.isActive }; }
    }
    return o;
  });
  const sent = JSON.parse(await tx.done);
  const got = await sampler;
  let worst = 0;
  for (const [t, x, y, z] of got.samples) { const dt = t - sent.t0; if (dt < 0 || t > sent.last.t + 0.5) continue; worst = Math.max(worst, Math.hypot(x - (sent.p0[0] + sent.velocity[0] * dt), y - (sent.p0[1] + sent.velocity[1] * dt), z - (sent.p0[2] + sent.velocity[2] * dt))); }
  const afterPy = await page.evaluate(() => ({ ...window.liveDis.runtime.stats }));
  out.opendis_sender = { instrument: sent.instrument, pdus_sent: sent.count, pdus_received_by_node: got.last.pdus, decoded_by_page: afterPy.decoded - before.decoded, last_location_sent: sent.last.location, last_location_decoded: got.last.location, location_difference_m: Math.hypot(...sent.last.location.map((x, i) => x - got.last.location[i])), marking: got.last.marking, mapping: got.last.mapping, dead_reckoned_samples: got.samples.length, worst_dead_reckoning_error_m: worst };
  console.log(`${sent.instrument} sender: ${sent.count} PDUs sent, ${got.last.pdus} reached the node; last location differs by ${out.opendis_sender.location_difference_m} m; dead-reckoned position against p0 + v t over ${got.samples.length} frames: worst ${worst.toExponential(2)} m`);
  assert.equal(got.last.pdus, sent.count); assert.equal(got.last.marking, 'PYTHON 21'); assert.deepEqual(got.last.type, sent.type); assert.equal(got.last.mapping, 'MAP_ANY');
  assert.deepEqual(got.last.location, sent.last.location); assert.equal(got.last.timestamp, sent.last.timestamp); assert.deepEqual(got.last.velocity, sent.velocity); assert.equal(got.last.algorithm, 2);
  assert.ok(worst < 0.01, 'a constant-velocity entity is dead-reckoned to within a centimetre');

  // --- 3c. the Node sender, all nine algorithms ---------------------------------------------------------------------------------
  await page.evaluate(() => {
    const L = window.liveDis, R = L.runtime; window.pduTruth = { n: 0, worst: 0 };
    R.listeners.push((pdu, bytes, dir) => { if (dir === 'received' && pdu.header.pduType === 1 && (pdu.entityID.entity <= 4 || pdu.entityID.entity > 100)) { const t = R._pduTime(pdu, L.now()), k = L.exercise.truth(pdu.entityID.entity > 100 ? 1 : pdu.entityID.entity, t).ecef; window.pduTruth.n++; window.pduTruth.worst = Math.max(window.pduTruth.worst, Math.hypot(k[0] - pdu.location[0], k[1] - pdu.location[1], k[2] - pdu.location[2])); } });
  });
  const base = await page.evaluate(() => ({ ...window.liveDis.runtime.stats, byType: { ...window.liveDis.runtime.stats.byType } }));
  const gwBase = { ...gw.stats };
  const sender = startSender({ address: '239.1.2.3', port: 3000, rate: 1, algorithm: 0 });
  await sender.ready;
  // Nine copies of the aircraft, entities 101 to 109, each sent with one of the nine algorithms at the same instants,
  // so that all nine are measured over the same 40 s of flight (a straight and a banked turn).
  const ex = new ScriptedExercise(), clones = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise((r) => clones.bind(0, r));
  const wall = () => (performance.timeOrigin + performance.now()) / 1000;
  let cloneSent = 0, lastClone = 0;
  const cloneTimer = setInterval(() => {
    const t = wall(); if (t - lastClone < 1) return; lastClone = t;
    for (let alg = 1; alg <= 9; alg++) {
      const bytes = ex.entityStatePdu(1, t, alg), v = new DataView(bytes.buffer);
      v.setUint16(16, 100 + alg); Array.from(`KITE DRM ${alg}`).forEach((c, i) => v.setUint8(129 + i, c.charCodeAt(0)));
      clones.send(bytes, 3000, '239.1.2.3'); cloneSent++;
    }
  }, 10);
  await sleep(2500);
  const table = await page.evaluate(async (seconds) => {
    const L = window.liveDis, R = L.runtime, acc = {};
    const t0 = performance.now();
    while (performance.now() - t0 < seconds * 1000) {
      await new Promise((res) => requestAnimationFrame(res));
      for (let alg = 1; alg <= 9; alg++) {
        const rec = R.entityRecord(1, 1, 100 + alg); if (!rec || !rec.drEcef) continue;
        const k = L.exercise.truth(1, rec.tRef + rec.drAge).ecef, e = Math.hypot(k[0] - rec.drEcef[0], k[1] - rec.drEcef[1], k[2] - rec.drEcef[2]);
        const a = acc[alg] ??= { sum: 0, frames: 0, worst: 0, field: rec.node.deadReckoning, marking: rec.node.marking, pdus: 0 };
        a.sum += e; a.frames++; a.worst = Math.max(a.worst, e); a.pdus = rec.pdus;
      }
    }
    const scripted = Object.fromEntries([...L.state.errors].map(([k, v]) => [k, { worst_m: v.worst, mean_m: v.sum / v.n }]));
    return { clones: Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, { mean_m: a.sum / a.frames, worst_m: a.worst, frames: a.frames, deadReckoning_field: a.field, marking: a.marking, pdus: a.pdus }])), scripted };
  }, 40);
  clearInterval(cloneTimer); clones.close();
  for (let alg = 1; alg <= 9; alg++) {
    const c = table.clones[alg];
    assert.equal(c.deadReckoning_field, alg, 'the deadReckoning field of the node follows the PDUs');
    console.log(`  algorithm ${alg} ${DRM_NAME[alg].padEnd(6)} at 1 PDU/s, same 40 s of flight: mean ${c.mean_m.toFixed(3)} m, worst ${c.worst_m.toFixed(3)} m over ${c.frames} frames (${c.pdus} PDUs)`);
  }
  console.log(`  scripted entities over the same time: ${JSON.stringify(table.scripted)}`);
  sender.stop();
  await sleep(500);
  const end = await page.evaluate(() => ({ stats: window.liveDis.runtime.stats, pduTruth: window.pduTruth, badge: document.getElementById('source').textContent }));
  const counts = { sent_by_sender: sender.sent + cloneSent, sent_scripted: sender.sent, sent_clones: cloneSent, sender_by_type: sender.source.counts, gateway_udp_in: gw.stats.udpIn - gwBase.udpIn, gateway_ws_out: gw.stats.wsOut - gwBase.wsOut, page_received: end.stats.received - base.received, page_decoded: end.stats.decoded - base.decoded, page_decode_errors: end.stats.errors, page_by_type: Object.fromEntries([1, 25, 26, 27].map((t) => [t, end.stats.byType[t] - base.byType[t]])), pdu_location_vs_truth: { pdus: end.pduTruth.n, worst_m: end.pduTruth.worst } };
  out.node_sender = { seconds: 40, rate_hz: 1, counts, dead_reckoning_error_same_flight: table.clones, scripted_entities_error: table.scripted };
  console.log(`Node sender: ${counts.sent_by_sender} PDUs sent, gateway took in ${counts.gateway_udp_in} and relayed ${counts.gateway_ws_out}, page received ${counts.page_received} and decoded ${counts.page_decoded}; PDU location against truth at the PDU timestamp, worst ${end.pduTruth.worst.toExponential(2)} m over ${end.pduTruth.n} PDUs`);
  out.console_problems = problems; out.source_badge = end.badge;
  record('end_to_end', out);
  await page.close(); await gw.close();

  assert.deepEqual(problems, []);
  assert.match(end.badge, /UDP 239\.1\.2\.3:3000 through gateway/);
  assert.equal(counts.gateway_udp_in, counts.sent_by_sender); assert.equal(counts.page_received, counts.sent_by_sender); assert.equal(counts.page_decoded, counts.sent_by_sender); assert.equal(counts.page_decode_errors, 0);
  assert.ok(end.pduTruth.worst < 0.01);
  const c = out.node_sender.dead_reckoning_error_same_flight;
  assert.ok(c[1].worst_m > 50, 'Static leaves a 100 m/s aircraft far behind');
  assert.ok(c[4].mean_m < c[2].mean_m && c[8].mean_m < c[2].mean_m, 'with acceleration and rotation the turning aircraft is tracked better than with constant velocity');
});
