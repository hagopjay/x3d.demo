// SPDX-License-Identifier: GPL-3.0-or-later
// Giza Crawl v2: before/after frames and the live check. Usage (from the repository's docs/ folder):
//   node shots.cjs DOCS_DIR OUT_DIR [chapters=0,3,...] [port]
// For v1 and v2 pages: load in headless Chromium (SwiftShader), stop the SceneTimer, and for each chapter set every
// interpolator routed from SceneTimer.fraction_changed to the chapter's moment (mid-chapter, at most 6 s in), then
// screenshot the .view element. v2 frames also get the chapter's Fog. Records console errors and warnings, load time and a
// frame-time sample (requestAnimationFrame over 3 s with the timer running) into OUT_DIR/check.json.
const path = require("path"), fs = require("fs"), { spawn } = require("child_process");
const PW = process.env.PLAYWRIGHT_DIR || "/Users/handshake/Projects/x3d/work/x3d-physx-bridge/node_modules/playwright";
const { chromium } = require(PW);
const [docs, out, chArg, portArg] = process.argv.slice(2);
const CH = (chArg || "0,3,6,7,13,17,21,23,25,26,27").split(",").map(Number);
const PORT = +(portArg || 8871);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES = { before: "demos/blender-giza-crawl/v1/", after: "demos/blender-giza-crawl/v2/" };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", docs], { stdio: "ignore" });
  await sleep(900);
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const report = { rig: "", pages: {} };
  try {
    for (const [tag, url] of Object.entries(PAGES)) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
      const msgs = [];
      page.on("console", (m) => { if (["error", "warning"].includes(m.type())) msgs.push(m.type() + ": " + m.text().slice(0, 240)); });
      page.on("pageerror", (e) => msgs.push("pageerror: " + e.message));
      report.rig = "Playwright headless Chromium " + browser.version() + ", SwiftShader";
      const t0 = Date.now();
      await page.goto(`http://127.0.0.1:${PORT}/${url}`, { waitUntil: "load" });
      await page.waitForFunction(() => typeof TS !== "undefined" && TS && S && R, null, { timeout: 240000 });
      const load_s = (Date.now() - t0) / 1000;
      await sleep(3000);
      // frame time with the tour running
      const frame = await page.evaluate(() => new Promise((res) => {
        const ts = []; const t0 = performance.now();
        const f = (t) => { ts.push(t); if (t - t0 < 3000) requestAnimationFrame(f); else {
          const d = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b);
          res({ frames: d.length, median_ms: +d[Math.floor(d.length / 2)].toFixed(1), p95_ms: +d[Math.floor(d.length * 0.95)].toFixed(1) }); } };
        requestAnimationFrame(f);
      }));
      const info = await page.evaluate(() => ({ version: B.version, seconds: R.seconds, chapters: R.chapters.length }));
      await page.evaluate(() => { TS.enabled = false; });
      const shots = [];
      for (const i of CH) {
        const t = await page.evaluate((i) => {
          const c = R.chapters, a = c[i].t, b = i + 1 < c.length ? c[i + 1].t : R.seconds;
          return a + Math.min(6, (b - a) * 0.5);
        }, i);
        await page.evaluate(([t, i]) => {
          const f = t / TS.cycleInterval;
          for (const r of S.routes) if (r.sourceNode.getNodeName() === "SceneTimer" && r.sourceField === "fraction_changed") r.destinationNode.set_fraction = f;
          if (typeof onTime === "function") onTime(t);
          if (window.crawl && crawl.setFog) { const fg = crawl.FOG[i]; if (fg) crawl.setFog(fg[0], fg[1]); }
        }, [t, i]);
        await sleep(2200);
        const n = String(i).padStart(2, "0");
        const png = path.join(out, `${tag}-ch${n}.png`);
        await page.locator("#view").screenshot({ path: png });
        shots.push({ chapter: i, t: +t.toFixed(2), file: path.basename(png) });
      }
      report.pages[tag] = { url, load_s, x_ite: info.version, route_seconds: info.seconds, chapters: info.chapters, frame_time_running: frame,
        console: msgs, console_errors: msgs.filter((m) => !m.startsWith("warning")).length, shots };
      await page.close();
    }
  } finally {
    await browser.close();
    srv.kill();
  }
  fs.writeFileSync(path.join(out, "check.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, (k, v) => (k === "shots" ? v.length : v), 1));
})().catch((e) => { console.error(e); process.exit(1); });
