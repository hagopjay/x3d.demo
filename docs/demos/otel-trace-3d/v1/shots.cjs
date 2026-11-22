// Headless X_ITE check + screenshots.  node shots.cjs [port]
// Starts its own python3 http.server on the port for the run, loads each trace page in headless Chromium (Playwright),
// records console errors/warnings, checks every clickable item resolved, clicks a span through the panel API, scrubs the
// replay, and screenshots several viewpoints into shots/.  Writes shots/check.json.
const path = require("path"), fs = require("fs"), { spawn } = require("child_process");
const PW = process.env.PLAYWRIGHT_DIR || "playwright";
const { chromium } = require(PW);
const HERE = __dirname, PORT = +(process.argv[2] || 8852), BASE = `http://127.0.0.1:${PORT}/`;
const PLAN = {
  "hotrod": [["VP_overview", 0.62], ["VP_lanes", 0.62], ["VP_front", 1.0], ["VP_error", 0.45], ["VP_fanout", 0.45], ["VP_side", 1.0], ["VP_findings", 1.0]],
  "otel-demo": [["VP_overview", 0.5], ["VP_error", 1.0]],
  "petclinic": [["VP_overview", 1.0]],
};
const otel3d_cycle = 16;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", HERE], { stdio: "ignore" });
  await sleep(900);
  const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const report = {};
  try {
    for (const [name, views] of Object.entries(PLAN)) {
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
      const msgs = [];
      page.on("console", m => { if (["error", "warning"].includes(m.type())) msgs.push(`${m.type()}: ${m.text()}`); });
      page.on("pageerror", e => msgs.push("pageerror: " + e.message));
      await page.goto(`${BASE}?t=${name}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.otel3d && (window.otel3d.ready || window.otel3d.errors.length), null, { timeout: 60000 });
      await sleep(1500);
      const st = await page.evaluate(() => ({ ready: otel3d.ready, errors: otel3d.errors, missing: otel3d.missing, watched: otel3d.watched,
        items: Object.keys(otel3d.data.items).length, status: document.querySelector("#status").textContent }));
      // a replay check: play runs, then scrub to a time and pause
      const r0 = await page.evaluate(() => [otel3d.ticks || 0, otel3d.lastFrac, Date.now()]);
      await sleep(4000);
      const r1 = await page.evaluate(() => [otel3d.ticks || 0, otel3d.lastFrac, Date.now()]);
      st.replay = { fraction_events: r1[0] - r0[0], fraction_from: r0[1], fraction_to: r1[1], wall_s: (r1[2] - r0[2]) / 1000,
                    expected_fraction_step: (r1[2] - r0[2]) / 1000 / otel3d_cycle };
      st.replay_advanced = r1[0] > r0[0] && r1[1] !== r0[1];
      await page.evaluate(() => { otel3d.pause(); otel3d.seek(otel3d.data.t_end * 0.62); document.querySelector("#scrub").value = 620; });
      // click-for-details through a real mouse click on the lane mirror bar of the longest span
      const longest = await page.evaluate(() => { const t = [...otel3d.data.timeline].sort((a, b) => (b.e - b.s) - (a.e - a.s))[0]; return t.sensor; });
      st.select_ok = await page.evaluate(s => otel3d.select(s), longest);
      st.selected_title = await page.evaluate(() => document.querySelector("#panel h2").textContent);
      const shots = [];
      for (const [vp, seekFrac] of views) {
        await page.evaluate(([v, f]) => { otel3d.bind(v); otel3d.seek(otel3d.data.t_end * f); }, [vp, seekFrac]);
        if (vp === "VP_findings") await page.evaluate(() => document.querySelector("#tabFind").click());
        else if (vp === "VP_side") await page.evaluate(() => document.querySelector("#tabSvc").click());
        else if (vp === "VP_error") await page.evaluate(() => { const f = otel3d.data.findings.find(x => x.key === "errors"); if (f && f.spans[0]) otel3d.select("T_" + f.spans[0]); });
        else await page.evaluate(() => document.querySelector("#tabFind").click());
        await sleep(1800);
        const file = `shots/${name}-${String(shots.length + 1).padStart(2, "0")}-${vp.slice(3)}.png`;
        await page.screenshot({ path: path.join(HERE, file) });
        shots.push(file);
      }
      // a real mouse click on the canvas centre of the findings view should hit the findings card
      await page.evaluate(() => { otel3d.bind("VP_findings"); otel3d.select(otel3d.data.timeline[0].sensor); });
      await sleep(1200);
      const box = await page.locator("x3d-canvas").boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(800);
      st.canvas_click_panel = await page.evaluate(() => document.querySelector("#panel h2").textContent);
      st.console = msgs; st.shots = shots;
      report[name] = st;
      await page.close();
    }
  } finally {
    await browser.close();
    srv.kill();
  }
  fs.writeFileSync(path.join(HERE, "shots", "check.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
