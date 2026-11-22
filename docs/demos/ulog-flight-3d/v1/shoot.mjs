// Headless X_ITE check: serves this folder on an ephemeral port, loads index.html, records console output,
// takes screenshots from several viewpoints, scans hover picking, and tests Play. Usage: node shoot.mjs
import { createRequire } from "module";
import http from "http"; import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const require = createRequire(process.env.PLAYWRIGHT_HOME || import.meta.url)  // a folder where playwright is installed;
const { chromium } = require("playwright");
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".x3d": "model/x3d+xml", ".png": "image/png", ".woff2": "font/woff2", ".ttf": "font/ttf", ".svg": "image/svg+xml" };
const srv = http.createServer((q, r) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(q.url, "http://x").pathname));
  if (!p.startsWith(ROOT)) { r.writeHead(403); return r.end(); }
  fs.readFile(p.endsWith("/") ? p + "index.html" : p, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }); r.end(b); });
}).listen(0, "127.0.0.1");
await new Promise(r => srv.on("listening", r));
const url = `http://127.0.0.1:${srv.address().port}/index.html`;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const log = [];
page.on("console", m => log.push([m.type(), m.text()])); page.on("pageerror", e => log.push(["pageerror", String(e)]));
page.on("requestfailed", r => log.push(["requestfailed", r.url()]));
await page.goto(url); await page.waitForFunction(() => window.ul && (window.ul.ready || window.ul.errors.length), null, { timeout: 60000 });
const st = await page.evaluate(() => ({ ready: ul.ready, errors: ul.errors, missing: ul.missing, status: document.querySelector("#status").textContent }));
console.log(JSON.stringify(st));
const shot = async (name, fn) => { await page.evaluate(fn); await page.waitForTimeout(1800); await page.screenshot({ path: `shots/${name}.png` }); console.log("shot", name); };
fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });
await shot("01-overview-by-mode", () => { ul.bind("VP_overview", document.querySelector('[data-vp="VP_overview"]')); ul.pause(); ul.seek(ul.data.replay.duration); ul.select("F_kill"); });
await shot("02-top-down-by-speed", () => { ul.colour(1); ul.bind("VP_top", document.querySelector('[data-vp="VP_top"]')); ul.select("F_speed"); });
await shot("03-side-ghost-and-glyphs", () => { ul.colour(0); ul.bind("VP_side", document.querySelector('[data-vp="VP_side"]')); ul.select("F_alt"); });
await shot("04-chase-at-30s-mission", () => { ul.seek(30); ul.bind("VP_chase", document.querySelector('[data-vp="VP_chase"]')); ul.select("S_15"); });
await shot("05-wall-at-98s-takeover", () => { ul.seek(98.2); ul.bind("VP_wall", document.querySelector('[data-vp="VP_wall"]')); ul.select("F_battery"); });
await shot("06-home-kill-at-126s", () => { ul.seek(126.4); ul.bind("VP_home", document.querySelector('[data-vp="VP_home"]')); ul.select("E_6"); });
// hover scan over the canvas in the side view: proves picking reaches TouchSensors
await page.evaluate(() => { ul.bind("VP_side", document.querySelector('[data-vp="VP_side"]')); }); await page.waitForTimeout(1200);
const box = await page.locator("x3d-canvas").boundingBox(); const hits = new Set(); let clicked = null;
for (let y = 0.2; y < 0.9 && hits.size < 12; y += 0.06) for (let x = 0.05; x < 0.95; x += 0.04) {
  await page.mouse.move(box.x + x * box.width, box.y + y * box.height);
  const h = await page.$eval("#hover", e => e.textContent); if (h) { hits.add(h); if (!clicked && /^sample/.test(h)) { await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(300); clicked = [h, await page.$eval("#panel h2", e => e.textContent)]; } }
}
console.log("hover hits", hits.size, [...hits].slice(0, 12)); console.log("real click", JSON.stringify(clicked));
// play test
await page.evaluate(() => { ul.seek(40); document.querySelector("#scrub").value = Math.round(40 / ul.data.replay.duration * 1000); document.querySelector("#play").click(); });
const t0 = await page.evaluate(() => ul.t); await page.waitForTimeout(3000); const t1 = await page.evaluate(() => ul.t);
console.log("play: t", t0.toFixed(2), "->", t1.toFixed(2), "in 3 s wall time");
const bad = log.filter(([k]) => ["error", "warning", "pageerror", "requestfailed"].includes(k));
console.log("console:", log.length, "messages,", bad.length, "errors/warnings"); for (const b of bad.slice(0, 20)) console.log("  ", b.join(": ").slice(0, 300));
await browser.close(); srv.close();
