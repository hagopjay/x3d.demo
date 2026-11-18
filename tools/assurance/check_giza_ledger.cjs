// No-graphics ledger check for Giza VI.1 / VI.2 (second external review, 18 Nov 2026, defect 7).
// node tools/assurance/check_giza_ledger.cjs demos/giza-osiris-hall/v6.2/index.html  (path under docs/)
// Serves docs/ on a local port, opens the page with WebGL disabled, and compares every rendered ledger row with
// story.mjs field by field: id, grade letter and name, claim, from, source text and link. Exit 1 on any mismatch.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../../docs'), rel = process.argv[2] || 'demos/giza-osiris-hall/v6.2/index.html';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const srv = http.createServer((q, s) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
srv.listen(0, async () => {
  const port = srv.address().port;
  const story = await import(path.join(root, path.dirname(rel), '../v6/story.mjs'));
  const b = await chromium.launch({ args: ['--disable-webgl', '--disable-webgl2', '--disable-gpu'] });
  const p = await b.newPage(); const con = []; p.on('console', m => con.push(m.text()));
  await p.goto(`http://127.0.0.1:${port}/${rel}`); await p.waitForTimeout(1500);
  const got = await p.evaluate(() => {
    const t = document.querySelector('#boot .gfx-guard table'); if (!t) return { rows: [] };
    return { outcome: GfxGuard.state.outcome, rows: [...t.querySelectorAll('tbody tr, tr')].filter(tr => tr.querySelector('td')).map(tr => {
      const td = [...tr.querySelectorAll('td')]; const a = tr.querySelector('a');
      return { cells: td.map(x => x.textContent), href: a ? a.getAttribute('href') : null, html: tr.innerHTML };
    }) };
  });
  await b.close(); srv.close();
  const mism = [];
  story.LEDGER.forEach((L, i) => {
    const r = got.rows[i]; if (!r) return mism.push({ id: L.id, problem: 'row missing' });
    const want = [L.id, `${L.g} · ${story.GRADES[L.g].name}`, L.claim, L.from, L.src];
    want.forEach((w, k) => { if ((r.cells[k] || '') !== w) mism.push({ id: L.id, field: ['id', 'grade', 'claim', 'from', 'src'][k], want: w, got: r.cells[k] }); });
    if ((L.url || null) !== (r.href || null)) mism.push({ id: L.id, field: 'url', want: L.url || null, got: r.href });
  });
  const out = { schema: 'x3d.demo.giza-ledger-check/1', page: rel, playwright: require('playwright/package.json').version,
    browser: 'chromium headless, --disable-webgl --disable-webgl2 --disable-gpu', outcome: got.outcome, ledger_rows: story.LEDGER.length,
    rendered_rows: got.rows.length, undefined_cells: got.rows.reduce((n, r) => n + r.cells.filter(c => c.includes('undefined')).length, 0),
    links_expected: story.LEDGER.filter(L => L.url).length, links_rendered: got.rows.filter(r => r.href).length,
    mismatches: mism.length, first_mismatches: mism.slice(0, 5), console: con.filter(c => c.includes('gfx-guard')) };
  out.status = out.outcome === 'failed' && out.rendered_rows === out.ledger_rows && !out.undefined_cells && !out.mismatches ? 'pass' : 'fail';
  console.log(JSON.stringify(out, null, 1)); process.exit(out.status === 'pass' ? 0 : 1);
});
