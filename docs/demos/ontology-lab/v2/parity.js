/* Live-vs-oracle comparison. Legacy station receipts use projected display values;
   new receipts may include lossless `terms` rows. Unordered SELECT answers are bags,
   not sets. Opt into sequence comparison with expected.ordered or options.ordered. */
(function (G) {
  'use strict';
  const DEFAULT_TOLERANCE = 1e-6;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const sev = s => String(s || '').replace(/^sh:/, '');
  const multiset = arr => { const m = new Map(); for (const k of arr) m.set(k, (m.get(k) || 0) + 1); return m; };
  const sameMulti = (a, b) => { if (a.length !== b.length) return false; const A = multiset(a), B = multiset(b); for (const [k, v] of A) if (B.get(k) !== v) return false; return true; };
  const validCount = n => Number.isSafeInteger(n) && n >= 0;
  function valueEqual(a, b, tolerance) {
    if (a === b) return typeof a !== 'number' || Number.isFinite(a);
    if (typeof a !== typeof b) return false;
    if (typeof a === 'number') return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b));
    return false;
  }
  function sameVars(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && sameMulti(a, b); }
  const termType = t => t && (t.termType || ({ uri: 'NamedNode', iri: 'NamedNode', bnode: 'BlankNode', literal: 'Literal' })[t.type] || t.type);
  function termEqual(a, b, forward, reverse) {
    if (a == null || b == null) return a == null && b == null;
    if (typeof a !== 'object' || typeof b !== 'object') return a === b;
    const ta = termType(a), tb = termType(b); if (ta !== tb) return false;
    if (ta === 'BlankNode') {
      if (forward.has(a.value)) return forward.get(a.value) === b.value;
      if (reverse.has(b.value)) return false;
      forward.set(a.value, b.value); reverse.set(b.value, a.value); return true;
    }
    if (a.value !== b.value) return false;
    if (ta === 'Literal') {
      const da = a.datatype && (a.datatype.value || a.datatype), db = b.datatype && (b.datatype.value || b.datatype);
      return (da || '') === (db || '') && String(a.language || '').toLowerCase() === String(b.language || '').toLowerCase();
    }
    return ta === 'NamedNode' || ta === 'DefaultGraph' || ta === 'Variable';
  }
  function compareRows(live, expected, vars, { typed, ordered, truncated, tolerance, legacyBlanks }) {
    const values = row => vars.map(v => row[v] === undefined ? null : row[v]);
    const L = live.map(values), E = expected.map(values);
    const rowMatches = (a, b, forward, reverse) => a.every((v, i) => typed ? termEqual(v, b[i], forward, reverse) : valueEqual(
      legacyBlanks && typeof v === 'string' && /^_:/.test(v) ? '_:b' : v,
      legacyBlanks && typeof b[i] === 'string' && /^_:/.test(b[i]) ? '_:b' : b[i], tolerance));
    if (ordered) {
      if ((!truncated && L.length !== E.length) || E.length > L.length) return { equal: false };
      const forward = new Map(), reverse = new Map();
      return { equal: E.every((row, i) => rowMatches(L[i], row, forward, reverse)) };
    }
    if ((!truncated && L.length !== E.length) || E.length > L.length) return { equal: false };
    // A shared bijection is necessary: independent matching would claim that one
    // repeated blank node equals two different blank nodes in an oracle answer.
    // Backtracking is bounded; an inconclusive match never receives an equal badge.
    let attempts = 0; const maxAttempts = 50000;
    const used = new Set();
    function match(index, forward, reverse) {
      if (index === E.length) return true;
      for (let i = 0; i < L.length; i++) {
        if (used.has(i)) continue;
        if (++attempts > maxAttempts) return null;
        const f = new Map(forward), r = new Map(reverse);
        if (!rowMatches(L[i], E[index], f, r)) continue;
        used.add(i); const yes = match(index + 1, f, r); used.delete(i);
        if (yes !== false) return yes;
      }
      return false;
    }
    const equal = match(0, new Map(), new Map());
    return equal === null ? { equal: false, inconclusive: true, why: 'comparison budget exhausted; no equality claim made' } : { equal };
  }
  function compare(kind, live, exp, options = {}) {
    if (!exp || !live) return { equal: false, why: 'no oracle for this text' };
    switch (kind) {
      case 'count': return { equal: validCount(live.triples) && live.triples === exp.triples, live: live.triples, oracle: exp.triples };
      case 'sha256': { const a = String(live.sha256 || ''), b = String(exp.sha256 || ''); return { equal: /^[a-f0-9]{64}$/i.test(a) && a === b, live: a.slice(0, 12), oracle: b.slice(0, 12) }; }
      case 'ask': case 'select': {
        if ('ask' in exp) return { equal: typeof live.ask === 'boolean' && live.ask === exp.ask, live: String(live.ask), oracle: String(exp.ask) };
        const vars = exp.vars || live.vars || [];
        const typed = Array.isArray(live.terms) && Array.isArray(exp.terms);
        const lr = typed ? live.terms : live.rows, er = typed ? exp.terms : exp.rows;
        const ordered = own(options, 'ordered') ? !!options.ordered : exp.ordered === true;
        const truncated = Array.isArray(er) && er.length < exp.count;
        const scope = truncated ? 'sample-and-count' : typed ? 'structured-terms' : 'legacy-projection';
        const base = { equal: false, truncated, scope, ordered, live: live.count + (live.count === 1 ? ' row' : ' rows'), oracle: exp.count + (exp.count === 1 ? ' row' : ' rows') };
        if (!validCount(live.count) || !validCount(exp.count) || live.count !== exp.count) return { ...base, why: 'result counts differ or are invalid' };
        if (!Array.isArray(lr) || !Array.isArray(er) || lr.length !== live.count || er.length > exp.count) return { ...base, why: 'live answer incomplete or row count inconsistent' };
        if (!sameVars(live.vars || vars, vars)) return { ...base, why: 'projected variables differ' };
        const tolerance = Number.isFinite(options.numericTolerance) && options.numericTolerance >= 0 ? options.numericTolerance : DEFAULT_TOLERANCE;
        const legacyBlanks = !typed && er.some(row => vars.some(v => row[v] === '_:b'));
        return { ...base, ...compareRows(lr, er, vars, { typed, ordered, truncated, tolerance, legacyBlanks }),
          ...(typed ? { termEquality: 'lexical datatype language and result-local blank-node bijection' } : { projectionNote: 'Legacy oracle omits RDF datatypes and distinct blank identities; equality does not certify those features.' }) };
      }
      case 'diff': { const eq = live.count === exp.count && live.count_a === exp.count_a && live.count_b === exp.count_b && Array.isArray(live.values) && Array.isArray(exp.values) && sameMulti(live.values, exp.values);
        return { equal: eq, live: live.count, oracle: exp.count }; }
      case 'reason': { let eq = live.added_x3do_types_on_scene_iris === exp.added_x3do_types_on_scene_iris && live.x3do_types_on_scene_iris_after === exp.x3do_types_on_scene_iris_after;
        for (const [k, f] of Object.entries(exp.focus || {})) if (!live.focus || !live.focus[k] || live.focus[k].count !== f.count) eq = false;
        return { equal: eq, scope: 'counts-and-focus', live: '+' + live.added_x3do_types_on_scene_iris, oracle: '+' + exp.added_x3do_types_on_scene_iris }; }
      case 'shacl': { const key = r => JSON.stringify([r.focus, r.shape, sev(r.severity)]);
        const eq = live.conforms === exp.conforms && live.count === exp.count && Array.isArray(live.results) && Array.isArray(exp.results) && sameMulti(live.results.map(key), exp.results.map(key));
        return { equal: eq, scope: 'focus-shape-severity', live: live.count + (live.count === 1 ? ' result' : ' results'), oracle: exp.count + (exp.count === 1 ? ' result' : ' results') }; }
    }
    return { equal: false, why: 'kind ' + kind };
  }
  G.LabParity = { compare };
})(typeof self !== 'undefined' ? self : globalThis);
