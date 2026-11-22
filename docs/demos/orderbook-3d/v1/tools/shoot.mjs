// Headless X_ITE check + screenshots. Serves the folder through page.route (no server process).
//   node tools/shoot.mjs
import { chromium } from "playwright";   // npm i playwright (any 1.5x)
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://orderbook.localhost";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
               ".x3d": "model/x3d+xml", ".wasm": "application/wasm", ".png": "image/png", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const log = [], out = { console: log, shots: [], clicks: [] };

const browser = await chromium.launch({ executablePath: process.env.OB_CHROME || undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
page.on("console", m => { if (["error", "warning"].includes(m.type())) log.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", e => log.push("pageerror: " + e.message));
await page.route(ORIGIN + "/**", async r => {
  const p = decodeURIComponent(new URL(r.request().url()).pathname);
  try { await r.fulfill({ body: await readFile(join(ROOT, p === "/" ? "index.html" : p)), contentType: MIME[extname(p)] || "application/octet-stream" }); }
  catch { await r.fulfill({ status: 404, body: "" }); }
});
await page.goto(ORIGIN + "/index.html");
await page.waitForFunction(() => window.ob && (window.ob.ready || window.ob.errors.length), null, { timeout: 120000 });
out.state = await page.evaluate(() => ({ ready: ob.ready, errors: ob.errors, missing: ob.missing.length, status: document.querySelector("#status").textContent }));
await mkdir(join(ROOT, "shots"), { recursive: true });
const shot = async (name) => { await page.waitForTimeout(1800); await page.screenshot({ path: join(ROOT, "shots", name) }); out.shots.push(name); };
const view = async (vp) => { await page.click(`[data-vp="${vp}"]`); };

// Hover-scan the canvas for a target, then click it with a real mouse event and read the panel.
async function findAndClick(re, label, [fx0, fy0, fx1, fy1] = [0.1, 0.1, 0.9, 0.9], step = 26) {
  const box = await page.locator("#stage").boundingBox(), t0 = Date.now();
  for (let y = box.y + fy0 * box.height; y < box.y + fy1 * box.height; y += step) for (let x = box.x + fx0 * box.width; x < box.x + fx1 * box.width; x += step) {
    if (Date.now() - t0 > 120000) { out.clicks.push({ label, found: false, reason: "scan budget 120 s" }); return false; }
    await page.mouse.move(x, y);
    const h = await page.evaluate(() => document.querySelector("#hover").textContent);
    if (re.test(h)) {
      await page.mouse.click(x, y); await page.waitForTimeout(250);
      const title = await page.evaluate(() => document.querySelector("#panel h2")?.textContent);
      out.clicks.push({ label, at: [Math.round(x), Math.round(y)], hover: h, panel: title }); return true;
    }
  }
  out.clicks.push({ label, found: false }); return false;
}

await view("VP_terrain"); await shot("01-terrain-oblique.png");
await view("VP_front"); await shot("02-front-heatmap.png");
await view("VP_ask"); await shot("03-terrain-from-asks.png");
await view("VP_canyon"); await shot("04-spread-canyon.png");
await view("VP_side"); await shot("05-side-depth-ladder.png");
await view("VP_now"); await page.waitForTimeout(1500);
await findAndClick(/^(buy|sell) /, "trade cluster", [0.3, 0.25, 0.8, 0.75], 14); await shot("06-last-minute-trade-clicked.png");
await view("VP_terrain"); await page.waitForTimeout(1500);
await findAndClick(/ wall /, "wall", [0.05, 0.2, 0.75, 0.75], 22); await shot("07-wall-clicked.png");
// replay: scrub to 45 %, check what the card says and that later chunks are hidden
await page.evaluate(() => ob.seek(0.45));
out.replay45 = await page.evaluate(() => ({ clock: document.querySelector("#clock").textContent, card: document.querySelector("#now .t").textContent,
  hiddenChunks: ob.data.chunks.filter(c => { const s = X3D.getBrowser(document.querySelector("#world")).currentScene.getNamedNode(c.name + "_grow").scale; return s.x < 0.01; }).length,
  totalChunks: ob.data.chunks.length }));
await shot("08-replay-45pct.png");
// play for 2 s from 45 %
await page.click("#play"); await page.waitForTimeout(2000);
out.play = await page.evaluate(() => document.querySelector("#clock").textContent); await page.click("#play");
await writeFile(join(ROOT, "shots", "check.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
