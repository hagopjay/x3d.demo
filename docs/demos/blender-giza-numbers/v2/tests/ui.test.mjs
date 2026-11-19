// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Optional DOM integration checks, with the real app and a mocked X3D SAI.
 * Dependency: linkedom 0.18.12 (not required by the production application).
 *   npm install --prefix /tmp/pyramid-ui-test linkedom@0.18.12
 *   LINKEDOM_PATH=/tmp/pyramid-ui-test/node_modules/linkedom/esm/index.js \
 *     node --test tests/ui.test.mjs
 * This checks event wiring and numerical/UI integration, not GPU rendering,
 * native input sanitization, WebGL or browser layout/accessibility behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { targets, geometry, solarPosition } from '../lab-math.mjs';

let parseHTML;
try {
  ({ parseHTML } = await import(process.env.LINKEDOM_PATH ? pathToFileURL(resolve(process.env.LINKEDOM_PATH)).href : 'linkedom'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const domTest = parseHTML ? test : (name, fn) => test(name, {skip:'Install optional linkedom@0.18.12 and set LINKEDOM_PATH; see file header.'}, fn);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const receipt = JSON.parse(await readFile(resolve(root, '../v1/receipts/claims.json'), 'utf8'));
const enhancedDefs = new Set([...((await readFile(resolve(root, 'assets/observatory.x3d'), 'utf8')).matchAll(/\bDEF="([^"]+)"/g))].map(match => match[1]));
const legacyDefs = new Set([...((await readFile(resolve(root, '../v1/assets/numbers.x3d'), 'utf8')).matchAll(/\bDEF="([^"]+)"/g))].map(match => match[1]));
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
let fixtureId = 0;

async function fixture({ failRenderer = false, failReceipt = false } = {}) {
  const { window, document } = parseHTML(html);
  // Linkedom omits default-selection and checked IDL state; initialize only
  // those standard DOM properties. Its range inputs do not emulate sanitizing.
  for (const input of document.querySelectorAll('input[type="checkbox"]')) input.checked = input.hasAttribute('checked');
  for (const select of document.querySelectorAll('select')) {
    if (!select.querySelector('option[selected]')) select.querySelector('option').selected = true;
  }
  class Vec3 extends Array { constructor(...values) { super(...values); } }
  class Multi extends Array { constructor(...values) { super(...values); } }
  const makeScene = names => {
    const nodes = new Map([...names].map(name => [name, {}]));
    return { nodes, getNamedNode(name) { if (!nodes.has(name)) throw new Error('Unknown SAI node: ' + name); return nodes.get(name); } };
  };
  const enhanced = makeScene(enhancedDefs), legacy = makeScene(legacyDefs), loads = [];
  const browser = { version:'MOCK-TEST', currentScene:enhanced, async loadURL(urls) {
    const url = urls[0]; loads.push(url); this.currentScene = url.includes('numbers.x3d') ? legacy : enhanced;
  } };
  const runtime = async () => {};
  runtime.getBrowser = () => { if (failRenderer) throw new Error('Simulated WebGL initialization failure'); return browser; };
  Object.assign(runtime, {SFVec3f:Vec3, MFVec3f:Multi, MFString:Multi, SFRotation:Multi});
  window.X3D = runtime;
  Object.assign(globalThis, {
    window, document, X3D:runtime,
    customElements:{whenDefined:async tag => assert.equal(tag, 'x3d-canvas')},
    matchMedia:() => ({matches:false, addEventListener() {}, removeEventListener() {}}),
    requestAnimationFrame:() => 1,
    cancelAnimationFrame:() => {},
    fetch:async url => {
      assert.equal(url, '../v1/receipts/claims.json');
      return {ok:!failReceipt, status:failReceipt?503:200, json:async () => structuredClone(receipt)};
    },
  });
  await import(pathToFileURL(resolve(root, 'observatory.mjs')).href + '?ui-test=' + ++fixtureId);
  await settle();
  const $ = id => document.getElementById(id);
  const input = (id, value) => {
    $(id).value = String(value);
    $(id).dispatchEvent(new window.Event('input', {bubbles:true}));
  };
  const select = (id, value) => {
    for (const option of $(id).querySelectorAll('option')) option.removeAttribute('selected');
    $(id).querySelector(`option[value="${value}"]`).selected = true;
    assert.equal($(id).value, value, 'DOM harness selected the requested option');
    $(id).dispatchEvent(new window.Event('input', {bubbles:true}));
  };
  const click = async selector => { document.querySelector(selector).click(); await settle(); };
  return {window, document, $, input, select, click, enhanced, legacy, loads};
}

domTest('starts the real app with all charts, evidence rows and named-node SAI writes', async () => {
  const {$, document, enhanced, loads} = await fixture();
  assert.match($('renderStatus').textContent, /LIVE X3D/);
  assert.deepEqual(loads, ['assets/observatory.x3d']);
  assert.equal($('ledger').querySelectorAll('tr').length, receipt.claims.length);
  for (const id of ['residualChart','slopeChart','surveyChart','latitudeChart','solarChart','uncertaintyChart']) {
    assert.ok($(id).childElementCount > 0, id + ' is populated');
  }
  assert.equal(enhanced.nodes.get('OverlayPi').whichChoice, 0);
  assert.equal(enhanced.nodes.get('CA_Overview').set_bind, true);
  assert.ok(enhanced.nodes.get('ShadowCoordinate').point.length === 5);
  assert.ok(enhanced.nodes.get('SolarPathCoordinates').point.length === 91);
  assert.doesNotMatch([...document.querySelectorAll('svg')].map(s => s.innerHTML).join(''), /NaN|Infinity/);
});

domTest('geometry controls update measured ratios and the scene, with unit-free ratios preserved under scale', async () => {
  const {$, input, enhanced} = await fixture();
  const originalPi = $('ratioPi').textContent;
  input('base', 232);
  assert.equal($('ratioPi').textContent, originalPi);
  assert.match($('metricBase').textContent, /232\.000/);
  assert.ok(enhanced.nodes.get('Monument').scale[0] > 1);
  input('slope', 52);
  const expected = geometry(232, 116 * Math.tan(52 * Math.PI / 180));
  assert.equal($('ratioPi').textContent, expected.pi.toFixed(6));
  assert.equal($('ratioPhi').textContent, expected.phi.toFixed(6));
  assert.match($('modelStatus').textContent, /EXPERIMENT/);
  assert.match(enhanced.nodes.get('SurveyBaseText').string[0], /232\.000 m/);
});

domTest('ideal presets satisfy exact geometric definitions within displayed precision', async () => {
  const {$, click} = await fixture();
  for (const key of ['pi','phi','seked']) {
    await click(`[data-preset="${key}"]`);
    assert.ok(Math.abs(Number($('slope').value) - targets[key].slopeDeg) < 1e-12);
    if (key === 'pi') assert.equal($('ratioPi').textContent, Math.PI.toFixed(6));
    if (key === 'phi') assert.equal($('ratioPhi').textContent, ((1 + Math.sqrt(5)) / 2).toFixed(6));
    if (key === 'seked') assert.equal($('ratioPi').textContent, (22 / 7).toFixed(6));
  }
  await click('[data-preset="survey"]');
  assert.match($('modelStatus').textContent, /REFERENCE/);
});

domTest('mode, camera and layer controls expose independent analytical scene layers', async () => {
  const {$, window, click, enhanced} = await fixture();
  await click('[data-mode="latitude"]');
  assert.equal(enhanced.nodes.get('OverlayLatitude').whichChoice, 0);
  assert.equal(enhanced.nodes.get('OverlayInterior').whichChoice, 0);
  assert.equal(enhanced.nodes.get('OverlayPi').whichChoice, -1);
  assert.ok(Math.abs(enhanced.nodes.get('Casing').transparency - .82) < 1e-12);
  await click('[data-camera="CA_Interior"]');
  assert.equal(enhanced.nodes.get('CA_Interior').set_bind, true);
  assert.equal($('opacity').value, '10');
  $('layerCourses').checked = false;
  $('layerCourses').dispatchEvent(new window.Event('input'));
  assert.equal(enhanced.nodes.get('OverlayCourses').whichChoice, -1);
});

domTest('search and classification filters retain matching evidence and handle an empty result', async () => {
  const {$, input, select} = await fixture();
  input('search', 'latitude');
  assert.ok($('ledger').querySelectorAll('tr').length > 0);
  assert.match($('ledger').textContent, /datum/i);
  input('search', '');
  select('classFilter', 'contradicted');
  assert.equal($('ledger').querySelectorAll('tr').length, 1);
  assert.match($('ledger').textContent, /Earth rotates 400/);
  select('classFilter', 'all');
  select('sectionFilter', 'Constants');
  assert.equal($('ledger').querySelectorAll('tr').length, 3);
  input('search', 'no matching claim for this query');
  assert.equal($('ledger').querySelectorAll('tr').length, 0);
  assert.equal($('noResults').hidden, false);
});

domTest('solar controls extinguish below-horizon lighting and the layer checkbox hides its projection', async () => {
  const {$, input, click, window, enhanced} = await fixture();
  await click('[data-mode="solar"]');
  input('declination', -23.44);
  input('solarTime', 6);
  assert.ok(solarPosition(29.979175, -23.44, -90).altitudeDeg < 0);
  assert.equal(enhanced.nodes.get('Sun').intensity, 0);
  assert.equal(enhanced.nodes.get('OverlayShadow').whichChoice, -1);
  assert.match($('solarShadow').textContent, /below horizon/);
  input('solarTime', 12);
  assert.equal(enhanced.nodes.get('Sun').intensity, .95);
  assert.equal(enhanced.nodes.get('OverlayShadow').whichChoice, 0);
  assert.ok(enhanced.nodes.get('ShadowCoordinate').point.flat().every(Number.isFinite));
  assert.doesNotMatch($('solarChart').innerHTML, /NaN|Infinity/);
  $('layerSolar').checked = false;
  $('layerSolar').dispatchEvent(new window.Event('input'));
  assert.equal(enhanced.nodes.get('OverlaySolar').whichChoice, -1);
  assert.equal(enhanced.nodes.get('OverlayShadow').whichChoice, -1);
  // A subsequent lighting update must continue to respect the hidden layer.
  input('solarTime', 13);
  assert.equal(enhanced.nodes.get('OverlayShadow').whichChoice, -1);
});

domTest('reset restores pi selection and the authored overview after orbit changes the camera', async () => {
  const {$, click, document, enhanced} = await fixture();
  const camera = enhanced.nodes.get('CA_Overview');
  const authoredPosition = [...camera.position];
  const authoredOrientation = [...camera.orientation];
  await click('[data-ratio="phi"]');
  assert.equal(document.querySelector('[data-ratio="phi"]').getAttribute('aria-pressed'), 'true');
  await click('#orbit');
  camera.position = [100, 200, 300];
  camera.orientation = [0, 1, 0, 1];
  await click('#reset');
  assert.deepEqual([...camera.position], authoredPosition);
  assert.deepEqual([...camera.orientation], authoredOrientation);
  assert.equal($('orbit').getAttribute('aria-pressed'), 'false');
  const selected = [...document.querySelectorAll('[data-ratio].selected')];
  assert.equal(selected.length, 1);
  assert.equal(selected[0].dataset.ratio, 'pi');
  assert.equal(selected[0].getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('[data-camera="CA_Overview"]').classList.contains('active'), true);
});

domTest('residual chart remains finite and keeps measurement labels inside its viewport at slider extremes', async () => {
  const {$, input, document} = await fixture();
  for (const [base, slope] of [[228,50],[228,54],[233,50],[233,54]]) {
    input('base', base); input('slope', slope);
    const chart = $('residualChart');
    const [, , width, height] = chart.getAttribute('viewBox').split(/\s+/).map(Number);
    assert.doesNotMatch([...document.querySelectorAll('svg')].map(svg => svg.innerHTML).join(''), /NaN|Infinity/);
    const labels = [...chart.querySelectorAll('text')].filter(node => /[+−][\d.,]+ m$/.test(node.textContent));
    assert.equal(labels.length, 3);
    assert.equal(new Set(labels.map(node => node.getAttribute('x'))).size, 1, 'measurement labels share a stable reading column');
    for (const label of labels) {
      assert.equal(label.getAttribute('text-anchor'), 'end');
      assert.ok(Number(label.getAttribute('x')) <= width && Number(label.getAttribute('x')) > width / 2);
      assert.ok(Number(label.getAttribute('y')) > 0 && Number(label.getAttribute('y')) <= height);
    }
    for (const marker of chart.querySelectorAll('circle')) {
      assert.ok(Number(marker.getAttribute('cx')) >= 0 && Number(marker.getAttribute('cx')) <= width);
      assert.ok(Number(marker.getAttribute('cy')) >= 0 && Number(marker.getAttribute('cy')) <= height);
    }
  }
});

domTest('original Blender scene toggles back to deformable enhanced scene', async () => {
  const {$, click, loads, legacy, enhanced} = await fixture();
  await click('#sourceScene');
  assert.equal(loads.at(-1), '../v1/assets/numbers.x3d');
  assert.equal($('sourceScene').getAttribute('aria-pressed'), 'true');
  assert.match($('sceneState').textContent, /FIXED BLENDER/);
  assert.ok(legacy.nodes.get('CA_Overview').set_bind);
  assert.equal($('orbit').disabled, true);
  await click('#sourceScene');
  assert.equal(loads.at(-1), 'assets/observatory.x3d');
  assert.equal($('sourceScene').getAttribute('aria-pressed'), 'false');
  assert.equal($('orbit').disabled, false);
  assert.ok(enhanced.nodes.get('Monument').scale.every(Number.isFinite));
});

domTest('renderer failure exposes fallback while geometry, search and reset continue working', async () => {
  const {$, input, click} = await fixture({failRenderer:true});
  assert.equal($('fallback').hidden, false);
  assert.equal($('scene').hidden, true);
  assert.match($('fallbackMessage').textContent, /Simulated WebGL initialization failure/);
  input('slope', 53);
  assert.match($('modelStatus').textContent, /EXPERIMENT/);
  assert.ok(Number($('ratioPi').textContent) < 3.1);
  input('search', 'seked');
  assert.ok($('ledger').querySelectorAll('tr').length > 0);
  await click('#reset');
  assert.match($('modelStatus').textContent, /REFERENCE/);
  assert.doesNotMatch($('uncertaintyChart').innerHTML, /NaN|Infinity/);
});

domTest('receipt failure is isolated from analytical instruments and renderer', async () => {
  const {$, input} = await fixture({failReceipt:true});
  assert.match($('ledgerCount').textContent, /Data unavailable/);
  assert.match($('noResults').textContent, /HTTP 503/);
  assert.match($('renderStatus').textContent, /LIVE X3D/);
  input('probe', 0);
  assert.equal($('probeLatitude').textContent, '29.9791750° N');
  input('rho', .99);
  assert.match($('uncertaintySummary').textContent, /ρ = 0\.99/);
  assert.doesNotMatch($('uncertaintyChart').innerHTML, /NaN|Infinity/);
});
