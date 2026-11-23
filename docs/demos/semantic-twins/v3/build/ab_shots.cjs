// SPDX-License-Identifier: GPL-3.0-or-later
// Before/after frames for the x3d.demo Blenderizer upgrades, shot the same way for the old and the new version.
// usage: node ab_shots.cjs PLAN.json
// PLAN: { docs, out, port?, width?, height?, wait_ms?, pages: { before: {url, canvas?, element?, setup?}, after: {...} },
//         timer?: "SceneTimer", shots: [ {name, t?} | {name, position:[x,y,z], orientation:[x,y,z,a], fov?} ] }
// Timeline shots stop the TimeSensor and set every interpolator routed from it to t / cycleInterval (SAI). Viewpoint shots
// add one Viewpoint with the given pose to the loaded scene and bind it (the old and new scenes share one frame).
// Writes OUT/<tag>-<name>.png and OUT/check.json (console errors and warnings, load time, frame times with the scene running).
const path = require("path"), fs = require("fs"), { spawn } = require("child_process");
const { chromium } = require(process.env.PLAYWRIGHT_DIR || "/Users/handshake/Projects/x3d/work/x3d-physx-bridge/node_modules/playwright");
const P = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = P.port || 8873;
(async () => {
  fs.mkdirSync(P.out, { recursive: true });
  const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", P.docs], { stdio: "ignore" });
  await sleep(900);
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const report = { rig: "Playwright headless Chromium " + browser.version() + ", SwiftShader (no GPU)", pages: {} };
  try {
    for (const [tag, pg] of Object.entries(P.pages)) {
      const page = await browser.newPage({ viewport: { width: P.width || 1600, height: P.height || 1000 }, deviceScaleFactor: 1 });
      const msgs = [];
      page.on("console", (m) => { if (["error", "warning"].includes(m.type())) msgs.push(m.type() + ": " + m.text().slice(0, 240)); });
      page.on("pageerror", (e) => msgs.push("pageerror: " + e.message));
      const t0 = Date.now();
      await page.goto(`http://127.0.0.1:${PORT}/${pg.url}`, { waitUntil: "load" });
      if (pg.setup) await page.evaluate(pg.setup);
      const sel = pg.canvas || "x3d-canvas";
      await page.waitForFunction((sel) => { const c = document.querySelector(sel); return c && c.browser && c.browser.currentScene && c.browser.currentScene.rootNodes.length > 0; }, sel, { timeout: 240000 });
      await sleep(P.wait_ms || 4000);
      const load_s = (Date.now() - t0) / 1000;
      const frame = await page.evaluate(() => new Promise((res) => {
        const ts = []; const t0 = performance.now();
        const f = (t) => { ts.push(t); if (t - t0 < 3000) requestAnimationFrame(f); else {
          const d = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b);
          res({ frames: d.length, median_ms: +d[Math.floor(d.length / 2)].toFixed(1), p95_ms: +d[Math.floor(d.length * 0.95)].toFixed(1) }); } };
        requestAnimationFrame(f);
      }));
      const version = await page.evaluate((sel) => document.querySelector(sel).browser.version, sel);
      const shots = [];
      for (const s of P.shots) {
        await page.evaluate(([sel, s, timer]) => {
          const B = document.querySelector(sel).browser, S = B.currentScene;
          if (!s.bind && s.t === undefined && !s.position) {
            /* the page's own current view */
          } else if (s.bind) {
            S.getNamedNode(s.bind).set_bind = true;
          } else if (s.t !== undefined) {
            const TS = S.getNamedNode(timer);
            TS.enabled = false;
            const f = s.t / TS.cycleInterval;
            for (const r of S.routes) if (r.sourceNode.getNodeName() === timer && r.sourceField === "fraction_changed") r.destinationNode.set_fraction = f;
            if (typeof onTime === "function") try { onTime(s.t); } catch (e) { /* page helper */ }
          } else {
            const vp = S.createNode("Viewpoint");
            vp.position = new X3D.SFVec3f(...s.position);
            vp.orientation = new X3D.SFRotation(...s.orientation);
            if (s.fov) vp.fieldOfView = s.fov;
            vp.description = "";
            S.addRootNode(vp);
            vp.set_bind = true;
          }
        }, [sel, s, P.timer || "SceneTimer"]);
        await sleep(2500);
        const file = path.join(P.out, `${tag}-${s.name}.png`);
        await page.locator(pg.element || sel).screenshot({ path: file });
        shots.push(path.basename(file));
      }
      report.pages[tag] = { url: pg.url, x_ite: version, load_s, frame_time_running: frame, console: msgs,
        console_errors: msgs.filter((m) => !m.startsWith("warning")).length, shots };
      await page.close();
    }
  } finally {
    await browser.close();
    srv.kill();
  }
  fs.writeFileSync(path.join(P.out, "check.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, (k, v) => (k === "shots" ? v.length : k === "console" ? v.slice(0, 4) : v), 1));
})().catch((e) => { console.error(e); process.exit(1); });
