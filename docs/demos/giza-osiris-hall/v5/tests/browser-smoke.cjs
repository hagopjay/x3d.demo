/* Run: node tests/browser-smoke.cjs
 * Starts an ephemeral local static server unless GIZA_BASE_URL is supplied.
 * Screenshots are opt-in via
 * GIZA_SCREENSHOTS=1 and are internal test artifacts, not deliverables.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
let chromium;
try {
  ({ chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright')));
} catch {
  ({ chromium } = require('playwright'));
}

let base = process.env.GIZA_BASE_URL;
let localServer;
const screenshotDirectory = process.env.GIZA_ARTIFACT_DIR || path.resolve(process.cwd(), 'test-artifacts');
const passed = [];
const pageErrors = [];
const check = async (name, task) => {
  await task();
  passed.push(name);
  process.stdout.write(`PASS ${name}\n`);
};

(async () => {
  if (!base) {
    const root = path.resolve(__dirname, '../../../..');
    const types = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.x3d': 'model/x3d+xml', '.json': 'application/json' };
    localServer = http.createServer(async (request, reply) => {
      try {
        let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (pathname.endsWith('/')) pathname += 'index.html';
        const file = path.resolve(root, '.' + pathname);
        if (path.relative(root, file).startsWith('..')) throw new Error('Invalid path');
        const bytes = await fs.readFile(file);
        reply.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        reply.end(bytes);
      } catch {
        reply.writeHead(404); reply.end('Not found');
      }
    });
    await new Promise(resolve => localServer.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${localServer.address().port}/demos/giza-osiris-hall/v5/`;
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.GIZA_CHROMIUM || (require('node:fs').existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await check('X_ITE scene and required nodes become ready', async () => {
      await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', undefined, { timeout: 60000 });
      assert.equal(await page.locator('#failure').isVisible(), false);
      const state = await page.evaluate(() => window.GizaHorizon.state);
      assert.equal(state.ready, true);
      assert.equal(await page.evaluate(() => {
        const scene = document.getElementById('world').browser.currentScene;
        return ['V_Overview', 'V_Cutaway', 'V_Chamber', 'V_Ritual', 'V_Stars', 'V_Witness', 'V_Immersive',
          'V_Tesla', 'V_Regional', 'V_Atmosphere', 'V_Earth',
          'SW_FIELD', 'SW_QUARTZ', 'SW_DEVICE', 'SW_ROYAL_BODY', 'SW_MACHINERY', 'SW_CRAFT', 'SW_BEINGS', 'SW_WAS_AURA',
          'SW_TESLA', 'SW_ARCS', 'SW_SKY_ELECTRODE', 'SW_REGIONAL', 'SW_EARTH_CIRCUIT']
          .every(name => !!scene.getNamedNode(name));
      }), true);
    });

    await check('interpretation lenses expose distinct evidence status', async () => {
      await page.locator('[data-lens="archaeology"]').click();
      assert.equal(await page.locator('#tier').innerText(), 'SCHEMATIC ARCHAEOLOGY');
      await page.locator('[data-lens="mythic"]').click();
      assert.equal(await page.locator('#tier').innerText(), 'SPECULATIVE FICTION');
      await page.locator('[data-lens="lab"]').click();
      assert.equal(await page.locator('#tier').innerText(), 'ILLUSTRATIVE MODEL');
    });

    await check('Tesla perspectives, layer switches and the potential-reference preset remain distinct', async () => {
      await page.locator('[data-tesla-preset="mythic"]').click();
      await page.waitForFunction(() => window.GizaHorizon.state.reservoir.deliveredArcW > 0);
      assert.equal(await page.evaluate(() => Number(document.getElementById('world').browser.currentScene.getNamedNode('SW_ARCS').whichChoice)), 0);
      for (const view of ['V_Tesla', 'V_Regional', 'V_Atmosphere', 'V_Earth']) {
        await page.locator(`[data-view="${view}"]`).click();
        assert.equal(await page.evaluate(() => window.GizaHorizon.state.view), view);
      }
      await page.locator('#tesla-enabled').uncheck();
      assert.deepEqual(await page.evaluate(() => {
        const scene = document.getElementById('world').browser.currentScene;
        return ['SW_TESLA', 'SW_ARCS', 'SW_SKY_ELECTRODE', 'SW_REGIONAL', 'SW_EARTH_CIRCUIT'].map(name => Number(scene.getNamedNode(name).whichChoice));
      }), [-1, -1, -1, -1, -1]);
      await page.locator('[data-tesla-preset="reference"]').click();
      const reference = await page.evaluate(() => window.GizaHorizon.state);
      assert.equal(reference.tesla.mode, 'reference'); assert.equal(reference.tesla.voltageMV, 0.25);
      assert.equal(reference.tesla.standingArcs, false); assert.equal(reference.tesla.supplyMW, 0.000001);
      assert.ok(Math.abs(reference.reservoir.initialEnergyJ - 312.5) < 1e-9);
      assert.equal(await page.evaluate(() => Number(document.getElementById('world').browser.currentScene.getNamedNode('SW_ARCS').whichChoice)), -1);
    });

    await check('finite precharge pays for arcs and depleted banks cannot leave stale power or luminous channels', async () => {
      await page.locator('[data-tesla-preset="mythic"]').click();
      await page.locator('#circuit-play').click();
      const before = await page.evaluate(() => window.GizaHorizon.state.reservoir);
      await page.locator('[data-tesla-preset="dark"]').click();
      assert.deepEqual(await page.evaluate(() => window.GizaHorizon.state.reservoir), before);
      await page.locator('#tesla-assumptions').evaluate(element => { element.open = true; });
      for (const [id, value] of [['tesla-voltage', 1], ['tesla-capacitance', 0.01], ['tesla-arc', 5000], ['tesla-duty', 1], ['tesla-leakage', 0]]) {
        await page.locator('#' + id).evaluate((element, next) => { element.value = String(next); element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
      }
      await page.locator('#circuit-reset').click();
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.reservoir.energyJ), 0);
      await page.locator('#charge-bank').click();
      const precharge = await page.evaluate(() => window.GizaHorizon.state.reservoir);
      assert.equal(precharge.energyJ, 5000); assert.equal(precharge.initialEnergyJ, 5000); assert.equal(precharge.suppliedJ, 0);
      await page.locator('#circuit-play').click();
      await page.waitForFunction(() => {
        const state = window.GizaHorizon.state;
        return state.reservoir.energyJ === 0 && state.reservoir.deliveredArcW === 0 && document.getElementById('arc-power').textContent === '0';
      });
      const empty = await page.evaluate(() => window.GizaHorizon.state);
      assert.equal(empty.playing, false); assert.equal(empty.circuitRunning, true);
      const bank = empty.reservoir;
      assert.ok(Math.abs(bank.initialEnergyJ + bank.suppliedJ - bank.energyJ - bank.arcJ - bank.dissipatedJ - bank.spilledJ) < 1e-8);
      assert.equal(await page.locator('#stored-energy-tesla').innerText(), '0');
      assert.equal(await page.locator('#energy-residual').innerText(), '0 J');
      assert.deepEqual(await page.evaluate(() => {
        const scene = document.getElementById('world').browser.currentScene;
        return ['SW_ARCS', 'SW_REGIONAL'].map(name => Number(scene.getNamedNode(name).whichChoice));
      }), [-1, -1]);
      await page.locator('[data-tesla-preset="mythic"]').click();
      await page.locator('#rf-lab').evaluate(element => { element.open = true; });
    });

    await check('external source off gives exactly zero RF response', async () => {
      await page.locator('[data-preset="off"]').click();
      assert.equal(await page.locator('#gain').innerText(), '0.00×');
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.settings.drive), 0);
      assert.equal(await page.evaluate(() => Number(document.getElementById('world').browser.currentScene.getNamedNode('SW_FIELD').whichChoice)), -1);
    });

    await check('peak tuning and crystal controls update the actual scene', async () => {
      await page.locator('[data-preset="baseline"]').click();
      await page.locator('#frequency').evaluate(element => {
        element.value = '0.51'; element.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.locator('#tune').click();
      const tuned = await page.evaluate(() => window.GizaHorizon.state.settings.frequency);
      assert.ok(tuned > 0.93 && tuned < 0.96, `unexpected tuned frequency ${tuned}`);
      await page.locator('[data-preset="quartz"]').click();
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.settings.crystals), true);
      assert.equal(await page.evaluate(() => Number(document.getElementById('world').browser.currentScene.getNamedNode('SW_QUARTZ').whichChoice)), 0);
      await page.locator('summary').filter({ hasText: 'Change the assumptions' }).click();
      await page.locator('#crystals').uncheck();
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.settings.crystals), false);
      assert.equal(await page.evaluate(() => Number(document.getElementById('world').browser.currentScene.getNamedNode('SW_QUARTZ').whichChoice)), -1);
    });

    await check('journey seeks exact endpoints and changes captions during playback', async () => {
      const setTime = seconds => page.locator('#timeline').evaluate((element, value) => {
        element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true }));
      }, seconds);
      await setTime(108);
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.seconds), 108);
      assert.equal(await page.locator('#time').innerText(), '01:48 / 01:48');
      assert.equal(await page.locator('#chapter-title').innerText(), 'Return with a witness');
      await setTime(0);
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.seconds), 0);
      assert.equal(await page.locator('#time').innerText(), '00:00 / 01:48');
      const firstCaption = await page.locator('#caption').innerText();
      await setTime(54);
      assert.equal(await page.locator('#chapter-title').innerText(), 'Heart and horizon');
      assert.notEqual(await page.locator('#caption').innerText(), firstCaption);
      await page.locator('#play').click();
      await page.waitForFunction(() => window.GizaHorizon.state.seconds > 54.2, undefined, { timeout: 15000 });
      await page.locator('#play').click();
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.playing), false);
      assert.ok((await page.evaluate(() => window.GizaHorizon.state.seconds)) > 54);
      await page.locator('#reset').click();
    });

    await check('witness and first-person switch at the same time with a fixed was-sceptre', async () => {
      await page.locator('[data-time="90"]').click();
      await page.locator('[data-camera="first-person"]').click();
      const immersive = await page.evaluate(() => {
        const scene = document.getElementById('world').browser.currentScene;
        const view = scene.getNamedNode('V_Immersive');
        return {
          state: window.GizaHorizon.state,
          position: [view.position.x, view.position.y, view.position.z].map(Number),
          target: [view.centerOfRotation.x, view.centerOfRotation.y, view.centerOfRotation.z].map(Number),
          body: Number(scene.getNamedNode('SW_ROYAL_BODY').whichChoice),
          device: Number(scene.getNamedNode('SW_DEVICE').whichChoice),
        };
      });
      assert.equal(immersive.state.seconds, 90);
      assert.equal(immersive.state.cameraMode, 'first-person');
      assert.equal(immersive.state.view, 'V_Immersive');
      assert.equal(immersive.state.directed, true);
      assert.deepEqual(immersive.position, [0, 187, 8]);
      assert.deepEqual(immersive.target, [0, 197, -40]);
      assert.equal(immersive.body, -1);
      assert.equal(immersive.device, 0);
      await page.locator('[data-camera="witness"]').click();
      const witness = await page.evaluate(() => ({
        state: window.GizaHorizon.state,
        body: Number(document.getElementById('world').browser.currentScene.getNamedNode('SW_ROYAL_BODY').whichChoice),
      }));
      assert.equal(witness.state.seconds, 90);
      assert.equal(witness.state.cameraMode, 'witness');
      assert.equal(witness.state.view, 'V_Witness');
      assert.equal(witness.body, 0);
    });

    await check('encounter caps gate machinery, craft and beings at the full reveal', async () => {
      await page.locator('#encounter').evaluate(element => { element.closest('details').open = true; });
      const revealed = () => page.evaluate(() => {
        const scene = document.getElementById('world').browser.currentScene;
        return ['SW_COSMIC', 'SW_MACHINERY', 'SW_CRAFT', 'SW_BEINGS'].map(name => Number(scene.getNamedNode(name).whichChoice));
      });
      await page.locator('#encounter').selectOption('geometry');
      assert.deepEqual(await revealed(), [0, -1, -1, -1]);
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.seconds), 90);
      await page.locator('#encounter').selectOption('craft');
      assert.deepEqual(await revealed(), [0, 0, 0, -1]);
      await page.locator('#encounter').selectOption('beings');
      assert.deepEqual(await revealed(), [0, 0, 0, 0]);
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.seconds), 90);
      await page.locator('[data-camera="first-person"]').click();
    });

    await check('continuous cameras advance and reduced motion holds until explicit reframing', async () => {
      const position = () => page.evaluate(() => {
        const view = document.getElementById('world').browser.currentScene.getNamedNode('V_Immersive');
        return [view.position.x, view.position.y, view.position.z].map(Number);
      });
      await page.locator('#timeline').evaluate(element => {
        element.value = '73'; element.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const initial = await position();
      await page.locator('#play').click();
      await page.waitForFunction(() => window.GizaHorizon.state.seconds > 73.3, undefined, { timeout: 15000 });
      await page.locator('#play').click();
      assert.notDeepEqual(await position(), initial);
      await page.locator('[data-time="90"]').click();
      await page.locator('#motion').check();
      const held = await position();
      await page.locator('#play').click();
      await page.waitForFunction(() => window.GizaHorizon.state.seconds > 90.3, undefined, { timeout: 15000 });
      await page.locator('#play').click();
      assert.deepEqual(await position(), held);
      await page.locator('[data-time="72"]').click();
      assert.deepEqual(await position(), [0, 55, 5]);
      await page.locator('#motion').uncheck();
      await page.locator('[data-time="90"]').click();
    });

    await check('source modal contains all twelve evidence cards and closes', async () => {
      await page.locator('#sources-open').click();
      await page.waitForFunction(() => document.querySelectorAll('#evidence-cards .evidence-card').length === 12);
      assert.equal(await page.locator('#evidence').evaluate(element => element.open), true);
      assert.equal(await page.locator('#evidence-cards .evidence-card').count(), 12);
      await page.locator('#sources-close').click();
      assert.equal(await page.locator('#evidence').evaluate(element => element.open), false);
    });

    await check('experiment exports and imports a complete bounded session', async () => {
      // Lower controls live in the scrollable instrument panel.
      await page.locator('#export').scrollIntoViewIfNeeded();
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#export').click();
      const download = await downloadPromise;
      const bytes = await fs.readFile(await download.path());
      const saved = JSON.parse(bytes.toString('utf8'));
      assert.equal(saved.schema, 'giza-tesla/1');
      assert.equal(saved.seconds, 90);
      assert.equal(saved.cameraMode, 'first-person');
      assert.equal(saved.encounterLevel, 'beings');
      assert.equal(saved.view, 'V_Immersive');
      assert.equal(saved.stage.device, 0);
      assert.equal(saved.settings.crystals, false);
      assert.ok(saved.tesla && saved.tesla.enabled); assert.equal(Object.hasOwn(saved, 'reservoir'), false);
      const validated = await page.evaluate(value => window.GizaHorizon.validateSession(value), saved);
      assert.deepEqual(validated.settings, saved.settings);
      const failures = await page.evaluate(value => {
        const invalids = [
          { ...value, seconds: 109 },
          { ...value, settings: { ...value.settings, drive: 2 } },
          { ...value, stage: { ...value.stage, water: 4 } },
          { ...value, view: 'V_Invented' },
          { ...value, cameraMode: 'witness' },
          { ...value, encounterLevel: 'unknown' },
        ];
        return invalids.map(invalid => {
          try { window.GizaHorizon.validateSession(invalid); return false; } catch { return true; }
        });
      }, saved);
      assert.deepEqual(failures, [true, true, true, true, true, true]);
      await page.locator('[data-preset="off"]').click();
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.settings.drive), 0);
      await page.locator('#session-file').setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: bytes });
      await page.waitForFunction(drive => window.GizaHorizon.state.settings.drive === drive, saved.settings.drive);
      assert.deepEqual(await page.evaluate(() => window.GizaHorizon.state.settings), saved.settings);
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.cameraMode), 'first-person');
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.encounterLevel), 'beings');
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.seconds), 90);
      assert.equal(await page.locator('#change-note').innerText(), 'Experiment restored. Circuit held with an empty bank; use Run or Precharge explicitly. Audio stays under your control.');
      const restored = await page.evaluate(() => window.GizaHorizon.state);
      assert.deepEqual(restored.tesla, saved.tesla); assert.equal(restored.circuitRunning, false);
      assert.equal(restored.reservoir.energyJ, 0); assert.equal(restored.reservoir.initialEnergyJ, 0); assert.equal(restored.reservoir.arcJ, 0);
      assert.equal(await page.evaluate(() => Number(document.getElementById('world').browser.currentScene.getNamedNode('SW_ARCS').whichChoice)), -1);
      const migrations = await page.evaluate(value => [false, true].map(contact => {
        const legacy = {
          ...value, schema: 'giza-horizon/1', view: 'V_Chamber',
          stage: { ...value.stage, device: 2, contact },
        };
        delete legacy.cameraMode; delete legacy.encounterLevel;
        return window.GizaHorizon.validateSession(legacy);
      }), saved);
      assert.deepEqual(migrations.map(value => value.schema), ['giza-tesla/1', 'giza-tesla/1']);
      assert.deepEqual(migrations.map(value => value.cameraMode), ['witness', 'witness']);
      assert.deepEqual(migrations.map(value => value.encounterLevel), ['geometry', 'beings']);
      assert.deepEqual(migrations.map(value => value.stage.device), [0, 0]);
      assert.deepEqual(migrations.map(value => value.tesla.enabled), [false, false]);
      assert.equal((await page.evaluate(value => window.GizaHorizon.validateSession({ ...value, schema: 'giza-horizon/2' }), saved)).tesla.enabled, false);
      await page.locator('#session-file').setInputFiles({
        name: 'legacy-v1.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({
          ...saved, schema: 'giza-horizon/1', view: 'V_Chamber',
          stage: { ...saved.stage, device: 1, contact: false },
        })),
      });
      await page.waitForFunction(() => window.GizaHorizon.state.encounterLevel === 'geometry');
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.cameraMode), 'witness');
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.view), 'V_Chamber');
      assert.equal(await page.evaluate(() => Number(document.getElementById('world').browser.currentScene.getNamedNode('SW_DEVICE').whichChoice)), 0);
      // Restore the Tesla export so later screenshots show the accepted full encounter.
      await page.locator('#session-file').setInputFiles({ name: 'tesla-scenario.json', mimeType: 'application/json', buffer: bytes });
      await page.waitForFunction(() => window.GizaHorizon.state.cameraMode === 'first-person');
    });

    if (process.env.GIZA_SCREENSHOTS === '1') {
      await fs.mkdir(screenshotDirectory, { recursive: true });
      await page.locator('[data-tesla-preset="mythic"]').click();
      await page.waitForFunction(() => window.GizaHorizon.state.reservoir.deliveredArcW > 0);
      await page.screenshot({ path: path.join(screenshotDirectory, 'giza-v5-desktop.png') });
      if (await page.locator('#panels-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#panels-toggle').click();
      await page.locator('#intro-toggle').click();
      for (const [view, name] of [['V_Tesla', 'tesla'], ['V_Regional', 'regional'], ['V_Atmosphere', 'atmosphere'], ['V_Earth', 'earth'], ['V_Overview', 'overview'], ['V_Chamber', 'chamber'], ['V_Ritual', 'ritual']]) {
        await page.locator(`[data-view="${view}"]`).click();
        await page.waitForTimeout(2300); // Let the renderer's deliberate camera transition settle.
        await page.screenshot({ path: path.join(screenshotDirectory, `giza-v5-${name}.png`) });
      }
      await page.locator('#timeline').evaluate(element => {
        element.value = '90'; element.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(2300);
      await page.screenshot({ path: path.join(screenshotDirectory, 'giza-v5-cosmic.png') });
      await page.locator('[data-camera="first-person"]').click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(screenshotDirectory, 'giza-v5-first-person-encounter.png') });
    }

    await check('390px mobile layout keeps footer controls within the viewport', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      if (await page.locator('#panels-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#panels-toggle').click();
      await page.locator('#instrument').evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
      const measurements = await page.evaluate(() => {
        const bounds = selector => {
          const box = document.querySelector(selector).getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
        };
        return {
          width: innerWidth, height: innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          buttons: ['#play', '#reset', '#timeline', '#panels-toggle', '[data-time="0"]', '[data-time="90"]'].map(bounds),
        };
      });
      assert.ok(measurements.scrollWidth <= measurements.width, JSON.stringify(measurements));
      for (const box of measurements.buttons) {
        assert.ok(box.width > 0 && box.height > 0, JSON.stringify(box));
        assert.ok(box.left >= -1 && box.right <= measurements.width + 1 && box.top >= 0 && box.bottom <= measurements.height + 1,
          `Mobile control out of viewport: ${JSON.stringify(box)}`);
      }
      await page.locator('[data-time="90"]').click();
      assert.equal(await page.locator('#chapter-title').innerText(), 'Return with a witness');
      await page.locator('#reset').click();
      assert.equal(await page.evaluate(() => window.GizaHorizon.state.seconds), 0);
      if (process.env.GIZA_SCREENSHOTS === '1') await page.screenshot({ path: path.join(screenshotDirectory, 'giza-v5-mobile.png') });
    });

    assert.deepEqual(pageErrors, [], `Unexpected browser errors: ${pageErrors.join('; ')}`);
    process.stdout.write(JSON.stringify({ passed: passed.length, pageErrors, base }) + '\n');
    await context.close();
  } finally {
    await browser.close();
    if (localServer) await new Promise(resolve => localServer.close(resolve));
  }
})().catch(error => {
  if (localServer) localServer.close();
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
