/* Live-vs-oracle comparison used by the station panel (and by work/station_test.mjs). Numbers compare to 1e-6
   relative; row order is ignored (a multiset compare), the same rule as the content parity receipts. */
(function (G) {
  'use strict';
  const nrm = v => (typeof v === 'number' ? (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(6)) : v);
  const rowKey = (r, vars) => JSON.stringify(vars.map(v => nrm(r[v] === undefined ? null : r[v])));
  const multiset = arr => { const m = new Map(); for (const k of arr) m.set(k, (m.get(k) || 0) + 1); return m; };
  const sameMulti = (a, b) => { if (a.length !== b.length) return false; const A = multiset(a), B = multiset(b); for (const [k, v] of A) if (B.get(k) !== v) return false; return true; };
  const sev = s => String(s || '').replace(/^sh:/, '');
  function compare(kind, live, exp) {
    if (!exp || !live) return { equal: false, why: 'no oracle for this text' };
    switch (kind) {
      case 'count': return { equal: live.triples === exp.triples, live: live.triples, oracle: exp.triples };
      case 'sha256': return { equal: live.sha256 === exp.sha256, live: live.sha256.slice(0, 12), oracle: exp.sha256.slice(0, 12) };
      case 'ask': case 'select':
        if ('ask' in exp) return { equal: live.ask === exp.ask, live: String(live.ask), oracle: String(exp.ask) };
        { const vars = exp.vars || live.vars || []; const L = (live.rows || []).map(r => rowKey(r, vars)), E = (exp.rows || []).map(r => rowKey(r, vars));
          // the stations file keeps at most 60 oracle rows: then every kept row must be among the live rows
          const truncated = E.length < exp.count; const eq = live.count === exp.count && (truncated ? E.every(k => L.includes(k)) : sameMulti(L, E));
          return { equal: eq, truncated, live: live.count + (live.count === 1 ? ' row' : ' rows'), oracle: exp.count + (exp.count === 1 ? ' row' : ' rows') }; }
      case 'diff': { const eq = live.count === exp.count && live.count_a === exp.count_a && live.count_b === exp.count_b && sameMulti(live.values, exp.values);
        return { equal: eq, live: live.count, oracle: exp.count }; }
      case 'reason': { let eq = live.added_x3do_types_on_scene_iris === exp.added_x3do_types_on_scene_iris && live.x3do_types_on_scene_iris_after === exp.x3do_types_on_scene_iris_after;
        for (const [k, f] of Object.entries(exp.focus || {})) if (!live.focus[k] || live.focus[k].count !== f.count) eq = false;
        return { equal: eq, live: '+' + live.added_x3do_types_on_scene_iris, oracle: '+' + exp.added_x3do_types_on_scene_iris }; }
      case 'shacl': { const key = r => [r.focus, r.shape, sev(r.severity)].join('|');
        const eq = live.conforms === exp.conforms && live.count === exp.count && sameMulti(live.results.map(key), exp.results.map(key));
        return { equal: eq, live: live.count + (live.count === 1 ? ' result' : ' results'), oracle: exp.count + (exp.count === 1 ? ' result' : ' results') }; }
    }
    return { equal: false, why: 'kind ' + kind };
  }
  G.LabParity = { compare };
})(typeof self !== 'undefined' ? self : globalThis);
