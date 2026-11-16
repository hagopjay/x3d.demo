// node test/check.test.cjs <demo dir>: the live checker must agree with the recorded Python report on every claim whose text is unchanged
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const dir = process.argv[2] || path.resolve(__dirname, '..');
const C = require(path.join(dir, 'check.js'));
const cj = JSON.parse(fs.readFileSync(path.join(dir, 'data/claims.json'), 'utf8'));
let n = 0, agree = 0, shaOk = 0, spanOk = 0, spanN = 0, exactOk = 0; const diffs = [];
for (const s of cj.sets) {
  const rep = JSON.parse(fs.readFileSync(path.join(dir, `data/report-${s.id}-default.json`), 'utf8'));
  const texts = {}; for (const src of s.sources) texts[src.id] = fs.readFileSync(path.join(dir, 'data', src.file), 'utf8');
  for (const f of rep.source_files) { assert.equal(crypto.createHash('sha256').update(texts[f.id], 'utf8').digest('hex'), f.sha256, 'sha ' + f.id); shaOk++; }
  s.claims.forEach((c, i) => {
    const it = rep.sources[i], L = C.live(texts[c.source] || '', c); n++;
    if (L.verdict === it.verdict) agree++; else diffs.push([s.id, i, c.statement, 'py ' + it.verdict, 'js ' + L.verdict]);
    if (it.span && L.places.length) { spanN++; if (L.places.some(p => p.s <= it.span[0] && it.span[1] <= p.e)) spanOk++; if (L.places.some(p => p.s === it.span[0] && p.e === it.span[1])) exactOk++; else diffs.push([s.id, i, c.statement, 'span py', it.span, 'js', L.places.map(p => p.s)]); }
  });
}
console.log(JSON.stringify({ claims: n, verdict_agree: agree, sha_checks: shaOk, span_checked: spanN, span_inside_live_match: spanOk, span_identical: exactOk, diffs }, null, 1));
assert.equal(agree, n); assert.equal(spanOk, spanN);
// unit vectors
assert.deepEqual(C.findAll('a intensity="120" b', 'intensity="12"'), []);
assert.equal(C.findAll('x 1.55 y', '1.5').length, 0);
assert.equal(C.findAll('x 1.5 y', '1.5').length, 1);
assert.equal(C.findAll('a  b\n c', 'a b c').length, 1);
assert.equal(C.versionInQuote('5.8.4', 'Engine 5.8.4-58902052+++UE5'), true);
for (const q of ['5.8.40', '15.8.4', '5.8.4.1', '4.8.5', '1.5.8.4']) assert.equal(C.versionInQuote('5.8.4', q), false, q);
assert.equal(C.versionInQuote('16.7.0', 'X_ITE v16.7.0'), true);
assert.equal(C.compareValue(36.87, 'fieldOfView="0.6435"'), 'mismatch');
assert.equal(C.compareValue([0, 1, 0, 0.3], 'rotation="0 1 0 0.30"'), 'match');
assert.equal(C.compareValue([0.63, 0.065, 0.05], 'baseColor="0.14 0.45 0.091"'), 'mismatch');
console.log('unit vectors ok');
