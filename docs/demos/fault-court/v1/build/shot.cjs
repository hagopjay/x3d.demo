const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
 const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) });
 await p.goto('file://' + process.argv[2]); await p.waitForTimeout(500);
 await p.screenshot({ path: process.argv[3] + '/top.png' });
 await p.screenshot({ path: process.argv[3] + '/full.png', fullPage: true });
 console.log(JSON.stringify({ errors: errs })); await b.close(); })();
