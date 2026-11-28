// shot.js: takes shot.png of the page in headless Chromium at device scale factor 2.
//   node tools/shot.js        (needs playwright with Chromium)
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../tests/static-server.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await serve(path.resolve(here, '../../../..'), 0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1080 }, deviceScaleFactor: 2 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));
// start the script at a moment where, ten seconds later, the helicopter is flying and the aircraft is transmitting
const shift = 25 - ((Date.now() / 1000) % 80);
await page.goto(`http://127.0.0.1:${server.port}/demos/live-dis/v1/index.html?shift=${shift.toFixed(3)}`);
await page.waitForFunction(() => window.liveDis && window.liveDis.nodes.TX.transmitState === 2 && window.liveDis.state.scope.length > 8, null, { timeout: 60000 });
await page.waitForTimeout(700);
await page.screenshot({ path: path.resolve(here, '../shot.png') });
console.log(`shot.png written with ${browser.version()}; console errors: ${problems.length}`);
await browser.close(); await server.close();
