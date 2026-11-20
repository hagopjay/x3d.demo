// usage: node finalcheck.cjs OUTDIR  -> walks the page like a visitor at 1366 px and 390 px, prints a JSON report
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:8811/demos/blender-giza-numbers/v4/';
(async () => {
  const b = await chromium.launch(); const report = { chromium: b.version(), runs: [] };
  for (const [name, W, H] of [['desktop', 1366, 768], ['phone', 390, 844]]) {
    const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const msgs = [], bad = [];
    p.on('console', m => { const t = m.text(); if (!/GL Driver|GPU stall/.test(t) && m.type() !== 'log' && m.type() !== 'info') msgs.push(m.type() + ': ' + t.slice(0, 300)); });
    p.on('pageerror', e => msgs.push('PAGEERR ' + e.message)); p.on('requestfailed', r => bad.push('FAIL ' + r.url()));
    p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
    await p.goto(base); await p.waitForFunction('window.gizaAtlas', null, { timeout: 60000 });
    const run = { name, width: W, steps: {} };
    run.steps.cards = await p.evaluate('document.querySelectorAll("#cards .card").length');
    run.steps.state0 = await p.evaluate('document.querySelector("#stage").dataset.state');
    if (name === 'phone') { await p.click('#enter'); }
    await p.waitForFunction('document.querySelector("#stage").dataset.state === "live"', null, { timeout: 90000 });
    await p.evaluate('window.gizaStage.skyReady');
    run.steps.live = true;
    for (const go of ['night', 'shafts', 'thuban', 'belt', 'plan', 'xray', 'hero']) {
      await p.evaluate(`window.gizaAtlas.GO.${go}()`); await p.waitForTimeout(3500);
      await p.screenshot({ path: `${process.argv[2]}/${name}-${go}.png` });
    }
    // every claim's proof must run without an exception
    run.steps.claims = await p.evaluate(`(async () => { let n = 0; for (const c of window.gizaAtlas.atlas.claims) { await window.gizaAtlas.showClaim(c.id, { scroll: false, seconds: 0 }); n++; } return n; })()`);
    await p.waitForTimeout(1500);
    // the year slider and the label slider
    await p.evaluate(`(() => { const y = document.querySelector('#year'); y.value = -10499; y.dispatchEvent(new Event('input', { bubbles: true })); const l = document.querySelector('#labelcount'); l.value = 800; l.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await p.evaluate('window.gizaAtlas.GO.belt()'); await p.waitForTimeout(4000);
    run.steps.labels_placed_at_800 = await p.evaluate('window.gizaStage.state.placed');
    await p.screenshot({ path: `${process.argv[2]}/${name}-labels800.png` });
    await p.evaluate('window.gizaAtlas.GO.fly()'); await p.waitForTimeout(16000);
    run.steps.cosmos = await p.evaluate('window.gizaStage.state.world');
    await p.screenshot({ path: `${process.argv[2]}/${name}-fly.png` });
    await p.evaluate('window.gizaAtlas.GO.home()'); await p.waitForTimeout(3000);
    run.steps.home = await p.evaluate('window.gizaStage.state.world');
    // the tour starts and stops
    // the tour starts and stops; on the desktop it is also played to its end (about four minutes)
    await p.evaluate('void window.gizaAtlas.playTour()'); await p.waitForTimeout(9000);
    run.steps.touring = await p.evaluate('document.querySelector("#stage").classList.contains("touring")');
    await p.evaluate('window.gizaAtlas.stopTour()'); await p.waitForTimeout(800);
    run.steps.tour_stopped = await p.evaluate('!document.querySelector("#stage").classList.contains("touring")');
    if (name === 'desktop') { await p.evaluate('window.gizaAtlas.playTour()'); run.steps.tour_played_to_end = true; }
    // filter and search
    await p.fill('#search', 'Orion'); await p.waitForTimeout(400);
    run.steps.search_orion = await p.evaluate('document.querySelectorAll("#cards .card").length');
    await p.fill('#search', ''); await p.waitForTimeout(300);
    run.steps.overflow_px = await p.evaluate('document.documentElement.scrollWidth - window.innerWidth');
    await p.evaluate('window.gizaAtlas.GO.hero()'); await p.waitForTimeout(2500);
    await p.evaluate('window.scrollTo(0,0)'); await p.screenshot({ path: `${process.argv[2]}/${name}-full.png`, fullPage: true });
    run.console = msgs; run.requests = bad; report.runs.push(run); await p.close();
  }
  console.log(JSON.stringify(report, null, 1)); await b.close();
})();
