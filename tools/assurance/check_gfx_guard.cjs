// Browser check for docs/lib/gfx-guard*.js (second external review, 18 Nov 2026, defect 10).
// node tools/assurance/check_gfx_guard.cjs [docs/lib/gfx-guard-v2.js] -> JSON rows; exit 1 if any case fails.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const lib = path.resolve(process.argv[2] || path.join(__dirname, '../../docs/lib/gfx-guard-v2.js'));
const src = fs.readFileSync(lib, 'utf8');
const page = (pre, call) => `<!doctype html><html><body><div id="boot"><b>LOADING</b></div><script>${pre}</script><script>${src}</script><script>${call}</script></body></html>`;
const opts = `{api:'webgl',bootId:'boot',readyClass:'done',timeoutMs:300,title:'Demo',fallbacks:[{href:'../v6/',label:'Text ledger'},{href:'javascript:alert(1)',label:'Bad'}]}`;
const noGL = `HTMLCanvasElement.prototype.getContext=function(){return null};`;
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const rows = [];
  async function run(name, html, wait, probe, want) {
    const p = await b.newPage();
    await p.setContent(html); await p.waitForTimeout(wait);
    const got = await p.evaluate(probe);
    const ok = want(got);
    rows.push({ case: name, ok, got }); await p.close();
  }
  const look = () => ({ outcome: GfxGuard.state.outcome, alert: !!document.querySelector('[role=alert]'),
    text: (document.querySelector('[role=alert]') || {}).innerText || '',
    links: [...document.querySelectorAll('.gfx-guard a')].map(a => a.getAttribute('href')) });
  await run('slow: alert with title and safe links appears after timeoutMs', page('', `GfxGuard.require(${opts})`), 700, look,
    g => g.outcome === 'slow' && g.alert && /taking longer/.test(g.text) && g.links.join() === '../v6/');
  await run('slow then ready: the note is removed', page('', `GfxGuard.require(${opts});setTimeout(()=>document.getElementById('boot').classList.add('done'),600)`), 900, look,
    g => g.outcome === 'ready' && !g.alert);
  await run('no WebGL: failure panel with reason, javascript: link dropped', page(noGL, `GfxGuard.require(${opts})`), 200, look,
    g => g.outcome === 'failed' && g.alert && /not available/.test(g.text) && g.links.join() === '../v6/');
  await run('start-up error: failure panel', page('', `GfxGuard.require(${opts});setTimeout(()=>{throw new Error('boom')},50)`), 250, look,
    g => g.outcome === 'failed' && /boom/.test(g.text));
  await b.close();
  const out = { schema: 'x3d.demo.gfx-guard-check/1', lib: path.relative(process.cwd(), lib), playwright: require('playwright/package.json').version,
    failed: rows.filter(r => !r.ok).length, rows };
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.failed ? 1 : 0);
})();
