/* Semantic Twin Lab engine: runs a station job with the in-page engines (N3.js 2.13.12, Comunica rdfjs-lite 5.4.1,
   shacl-engine 1.1.3 with its SHACL-SPARQL plugin). Same logic as the content cross-check (content/build/js_check.mjs),
   so a live answer can be compared with the Python oracle. Runs inside engine-worker.js, or on the main thread if a
   Worker cannot start. Needs the global E_lab_stack (vendor/lab-stack.js). */
(function (G) {
  'use strict';
  const L = G.E_lab_stack, DF = L.DataFactory, nn = DF.namedNode;
  const BASE = 'https://semantic-twin-lab.example/TheCabinet.ttl#';
  const X3DO = 'https://www.web3d.org/specifications/X3dOntology4.1#';
  const LAB = 'https://semantic-twin-lab.example/shapes#';
  const SH = 'http://www.w3.org/ns/shacl#';
  const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  const RDF_TYPE = RDF + 'type';
  const SC = nn('http://www.w3.org/2000/01/rdf-schema#subClassOf');
  const PREFIXES = [[BASE, ':'], [X3DO, 'x3do:'], [LAB, 'lab:'], ['http://www.w3.org/2002/07/owl#', 'owl:'], ['http://www.w3.org/2000/01/rdf-schema#', 'rdfs:'],
    [RDF, 'rdf:'], [SH, 'sh:'], ['http://www.w3.org/2001/XMLSchema#', 'xsd:'], ['urn:x3d-mcp:shapes:x3d-core#', 'core:']];
  const now = () => (G.performance ? performance.now() : Date.now());
  let fetchText = null, manifest = null, allowedFiles = new Set();
  const LIMITS = Object.freeze({ query_chars: 100000, edit_chars: 200000, result_rows: 20000, graph_quads: 100000, union_quads: 300000, graph_count: 16, reasoning_derivations: 150000, rule_premise_depth: 32 });
  function fail(code, message) { const err = new Error(message); err.code = code; throw err; }
  const textCache = new Map(), quadCache = new Map();

  function short(t, blanks) {
    if (!t) return null;
    if (t.termType === 'NamedNode') { for (const [p, s] of PREFIXES) if (t.value.startsWith(p)) return s + t.value.slice(p.length); return t.value; }
    if (t.termType === 'BlankNode') {
      if (!blanks) return '_:' + t.value;
      if (!blanks.has(t.value)) blanks.set(t.value, 'b' + blanks.size);
      return '_:' + blanks.get(t.value);
    }
    if (t.termType === 'Literal') {
      const dt = t.datatype ? t.datatype.value : '';
      if (!dt.startsWith('http://www.w3.org/2001/XMLSchema#')) return t.value;
      // Display values are convenient primitives only when conversion is bounded.
      // `terms` always retains the exact lexical form, datatype and language.
      if (/#(?:integer|int|long|short|byte|nonNegativeInteger|positiveInteger|nonPositiveInteger|negativeInteger|unsignedLong|unsignedInt|unsignedShort|unsignedByte)$/.test(dt)) {
        const n = Number(t.value); return /^[-+]?\d+$/.test(t.value) && Number.isSafeInteger(n) ? n : t.value;
      }
      if (/#(?:decimal|double|float)$/.test(dt)) {
        const n = Number(t.value), significant = t.value.replace(/^[+-]?0*|[.eE+-]/g, '').replace(/0+$/, '').length;
        return Number.isFinite(n) && significant <= 15 ? n : t.value;
      }
      if (dt.endsWith('#boolean')) return /^(?:true|1)$/.test(t.value) ? true : /^(?:false|0)$/.test(t.value) ? false : t.value;
      return t.value;
    }
    return t.value;
  }
  function termJSON(t, blanks) {
    if (!t) return null;
    if (t.termType === 'BlankNode') return { termType: t.termType, value: short(t, blanks).slice(2) };
    if (t.termType === 'Literal') return { termType: t.termType, value: t.value, datatype: t.datatype && t.datatype.value || '', language: t.language || '' };
    return { termType: t.termType, value: t.value };
  }
  // Mask comments, quoted strings and IRI tokens before inspecting query keywords.
  // A string containing SERVICE/FROM is data and must remain a legal teaching query.
  function maskedSparql(query) {
    let out = '', i = 0;
    while (i < query.length) {
      const c = query[i];
      if (c === '#') { while (i < query.length && query[i] !== '\n') { out += ' '; i++; } continue; }
      if (c === '"' || c === "'") {
        const quote = query.slice(i, i + 3) === c.repeat(3) ? c.repeat(3) : c;
        out += ' '.repeat(quote.length); i += quote.length;
        while (i < query.length) {
          if (query[i] === '\\') { out += '  '; i += 2; continue; }
          if (query.slice(i, i + quote.length) === quote) { out += ' '.repeat(quote.length); i += quote.length; break; }
          out += query[i] === '\n' ? '\n' : ' '; i++;
        }
        continue;
      }
      if (c === '<') {
        const end = query.indexOf('>', i + 1), candidate = end < 0 ? '' : query.slice(i + 1, end);
        if (end >= 0 && !/[\s<>"{}|^`\\]/.test(candidate)) { out += ' '.repeat(end - i + 1); i = end + 1; continue; }
      }
      out += c; i++;
    }
    return out;
  }
  function queryPolicy(query) {
    if (typeof query !== 'string' || !query.trim()) fail('LAB_QUERY_TYPE', 'A nonempty SELECT or ASK query is required.');
    if (query.length > LIMITS.query_chars) fail('LAB_QUERY_LIMIT', 'The query exceeds the local text budget.');
    const masked = maskedSparql(query);
    const lead = masked.replace(/^\s*(?:(?:PREFIX\s+[^\s:]*:\s*)|(?:BASE\s*))*/i, '').trimStart();
    if (!/^(?:SELECT|ASK)\b/i.test(lead)) fail('LAB_QUERY_READ_ONLY', 'Only local SELECT and ASK queries run in this lab.');
    if (/(?:^|[^\w?:$])(?:SERVICE|FROM)\b(?!:)/i.test(masked)) fail('LAB_QUERY_REMOTE', 'SERVICE and FROM are disabled; select installed graphs instead.');
    return { requested: /\bORDER\s+BY\b/i.test(masked) ? 'query' : 'unspecified', preserved: true };
  }
  async function text(file) {
    if (typeof file !== 'string' || !allowedFiles.has(file)) fail('LAB_FILE_SCOPE', 'Only files listed in the installed manifest can be read.');
    if (!textCache.has(file)) {
      const fetcher = fetchText;
      const pending = Promise.resolve().then(() => fetcher(file)).catch(err => { if (textCache.get(file) === pending) textCache.delete(file); throw err; });
      textCache.set(file, pending);
    }
    return textCache.get(file);
  }
  async function quadsOfGraph(g) {
    if (!manifest) fail('LAB_NOT_INITIALIZED', 'Initialize the local engine before submitting a job.');
    if (typeof g !== 'string' || !Object.hasOwn(manifest.graphs, g)) fail('LAB_GRAPH_SCOPE', 'Unknown installed graph: ' + String(g).slice(0, 100));
    const file = manifest.graphs[g];
    if (!quadCache.has(g)) {
      const pending = text(file).then(t => { const quads = new L.Parser({ blankNodePrefix: 'g' + Object.keys(manifest.graphs).indexOf(g) + '_' }).parse(t);
        if (quads.length > LIMITS.graph_quads) fail('LAB_GRAPH_LIMIT', 'The graph exceeds the local quad budget.'); return quads;
      }).catch(err => { if (quadCache.get(g) === pending) quadCache.delete(g); throw err; });
      quadCache.set(g, pending);
    }
    return quadCache.get(g);
  }
  async function storeOf(graphs) {
    if (!Array.isArray(graphs) || !graphs.length || graphs.length > LIMITS.graph_count) fail('LAB_GRAPH_TYPE', 'Select between one and ' + LIMITS.graph_count + ' installed graph names.');
    const s = new L.Store();
    for (const g of graphs) { s.addQuads(await quadsOfGraph(g)); if (s.size > LIMITS.union_quads) fail('LAB_GRAPH_LIMIT', 'The graph union exceeds the local quad budget.'); }
    return s;
  }

  const engine = new L.QueryEngine();
  async function select(store, query) {
    const order = queryPolicy(query);
    const r = await engine.query(query, { sources: [store], fetch: async () => fail('LAB_QUERY_REMOTE', 'Network access is disabled for local queries.') });
    if (r.resultType === 'boolean') return { ask: await r.execute(), order };
    if (r.resultType !== 'bindings') fail('LAB_QUERY_READ_ONLY', 'Only SELECT and ASK run here (got ' + r.resultType + ').');
    const stream = await r.execute(), bs = [];
    try { for await (const binding of stream) { if (bs.length >= LIMITS.result_rows) fail('LAB_RESULT_LIMIT', 'The result exceeds ' + LIMITS.result_rows + ' rows; add LIMIT or narrow the query.'); bs.push(binding); } }
    finally { if (!stream.ended && typeof stream.destroy === 'function') stream.destroy(); }
    const meta = await r.metadata();
    const vars = meta.variables.map(v => (v.variable || v).value), blanks = new Map();
    const terms = bs.map(b => Object.fromEntries(vars.map(v => [v, termJSON(b.get(v), blanks)])));
    const rows = bs.map(b => Object.fromEntries(vars.map(v => [v, short(b.get(v), blanks)])));
    return { vars, count: bs.length, rows, terms, order, blank_node_scope: 'this answer only; labels are not cross-answer identifiers', truncated: false };
  }

  function x3doTypesOnScene(store) {
    const out = new Set();
    for (const q of store.match(null, nn(RDF_TYPE), null))
      if (q.subject.termType === 'NamedNode' && q.subject.value.startsWith(BASE) && q.object.value.startsWith(X3DO)) out.add(q.subject.value + ' ' + q.object.value);
    return out;
  }
  function reasonInPlace(store, rulesText) { new L.Reasoner(store, { maxDerivations: LIMITS.reasoning_derivations, maxPremiseDepth: LIMITS.rule_premise_depth }).reason(new L.Store(new L.Parser({ format: 'text/n3' }).parse(rulesText))); }

  // Comunica refuses GROUP BY over a pre-bound $this: such constraints are removed and listed (content P10 notes).
  function dropGroupBy(shapes) {
    const skipped = [];
    for (const q of shapes.match(null, nn(SH + 'select'), null)) if (/GROUP\s+BY/i.test(q.object.value))
      for (const owner of shapes.getSubjects(nn(SH + 'sparql'), q.subject, null)) { shapes.removeQuad(DF.quad(owner, nn(SH + 'sparql'), q.subject)); skipped.push(short(owner)); }
    return skipped;
  }
  // P10: a shape with more than one sh:sparql constraint is split into clones (same targets and severity).
  const KEEP = ['targetClass', 'targetNode', 'targetSubjectsOf', 'targetObjectsOf', 'target', 'severity', 'deactivated'].map(x => SH + x).concat([RDF_TYPE]);
  function splitMultiSparql(shapes) {
    const origin = new Map(); let n = 0; const SPARQL = nn(SH + 'sparql'); const owners = new Map();
    for (const q of shapes.match(null, SPARQL, null)) { const k = q.subject.termType + ':' + q.subject.value; if (!owners.has(k)) owners.set(k, q.subject); }
    for (const owner of owners.values()) for (const c of shapes.getObjects(owner, SPARQL, null).slice(1)) {
      const clone = DF.blankNode('p10_' + (n++));
      for (const q of shapes.match(owner, null, null)) if (KEEP.includes(q.predicate.value)) shapes.add(DF.quad(clone, q.predicate, q.object));
      shapes.add(DF.quad(clone, SPARQL, c)); shapes.removeQuad(DF.quad(owner, SPARQL, c)); origin.set(clone.value, owner);
    }
    return origin;
  }
  // keep only the shapes whose lab:id is listed (and everything reachable from them through blank nodes, plus sh:declare)
  function filterShapes(all, ids) {
    const out = new L.Store(); const ID = nn(LAB + 'id'); const seen = new Set();
    const pull = t => { const k = t.termType + t.value; if (seen.has(k)) return; seen.add(k);
      for (const q of all.match(t, null, null)) { out.add(q); if (q.object.termType === 'BlankNode') pull(q.object); if (q.predicate.value === SH + 'prefixes') pull(q.object); } };
    for (const q of all.match(null, ID, null)) if (ids.includes(q.object.value)) pull(q.subject);
    return out;
  }
  async function shacl(dataStore, shapesStore, { fix = true, skipGroupBy = false } = {}) {
    const shapes = new L.Store(shapesStore.getQuads(null, null, null, null));
    const skipped = skipGroupBy ? dropGroupBy(shapes) : [];
    const origin = fix ? splitMultiSparql(shapes) : new Map();
    if (fix) for (const q of dataStore.match(null, SC, null)) shapes.add(q);   // P1: the hierarchy must be in the shapes graph
    for (const q of shapes.match(null, nn(SH + 'select'), null)) queryPolicy(q.object.value);
    const t = now();
    const rep = await new L.Validator(shapes, { factory: DF, validations: L.sparqlValidations }).validate({ dataset: dataStore });
    const ms = +(now() - t).toFixed(1);
    const ID = nn(LAB + 'id'), PROP = nn(SH + 'property'), FIX = nn(LAB + 'fixHint'), MSG = nn(SH + 'message'), PATH = nn(SH + 'path');
    const resolve = t0 => (t0 && t0.termType === 'BlankNode' && origin.has(t0.value)) ? origin.get(t0.value) : t0;
    const shapeId = t0 => { const term = resolve(t0);
      const own = shapes.getObjects(term, ID, null)[0]; if (own) return own.value;
      const parent = shapes.getSubjects(PROP, term, null)[0];
      if (parent) { const pid = shapes.getObjects(parent, ID, null)[0]; return pid ? pid.value : short(parent); }
      return short(term); };
    const fixOf = t0 => { const term = resolve(t0); let f = shapes.getObjects(term, FIX, null)[0]; if (!f) { const parent = shapes.getSubjects(PROP, term, null)[0]; if (parent) f = shapes.getObjects(parent, FIX, null)[0]; } return f ? f.value : null; };
    const pathOf = t0 => { const term = resolve(t0); const p = shapes.getObjects(term, PATH, null)[0]; if (!p) return null; if (p.termType === 'NamedNode') return short(p);
      const out = []; let n = p, g = 0; while (n && n.value !== RDF + 'nil' && g++ < 20) { const f = shapes.getObjects(n, nn(RDF + 'first'), null)[0]; if (!f) break;
        if (f.termType === 'NamedNode') out.push(short(f)); else { const z = shapes.getObjects(f, nn(SH + 'zeroOrMorePath'), null)[0]; const o = shapes.getObjects(f, nn(SH + 'oneOrMorePath'), null)[0]; const iv = shapes.getObjects(f, nn(SH + 'inversePath'), null)[0];
          out.push(z ? short(z) + '*' : o ? short(o) + '+' : iv ? '^' + short(iv) : '…'); } n = shapes.getObjects(n, nn(RDF + 'rest'), null)[0]; }
      return out.length ? out.join(' / ') : '(complex path)'; };
    const results = rep.results.map(r => {
      const st = r.shape && r.shape.ptr ? r.shape.ptr.term : null;
      // shacl-engine writes a substituted literal with its quotes ("Ghost"); pyshacl writes the bare value: match pyshacl
      let msg = (r.message || []).map(m => m.value.replace(/"([^"\n]*)"/g, '$1')).join(' | ');
      if (!msg && st) { const m = shapes.getObjects(resolve(st), MSG, null)[0]; if (m) msg = m.value; }
      return { focus: short(r.focusNode && r.focusNode.term), shape: shapeId(st), severity: short(r.severity), component: short(r.constraintComponent),
        message: msg, value: r.value ? short(r.value.term) : null, path: st ? pathOf(st) : null, fix: st ? fixOf(st) : null };
    }).sort((a, b) => (a.shape + a.focus + a.severity).localeCompare(b.shape + b.focus + b.severity));
    const out = { conforms: rep.conforms, count: results.length, results, ms_shacl_engine: ms };
    if (skipGroupBy) out.skipped_constraints = skipped;
    return out;
  }

  // the job text the learner edits: query (SPARQL), shapes_ttl (Turtle shapes) or rules (N3)
  async function run(job, editText) {
    if (!manifest) fail('LAB_NOT_INITIALIZED', 'Initialize the local engine before submitting a job.');
    if (!job || typeof job !== 'object' || Array.isArray(job)) fail('LAB_JOB_TYPE', 'A station job object is required.');
    if (editText != null && (typeof editText !== 'string' || editText.length > LIMITS.edit_chars)) fail('LAB_EDIT_LIMIT', 'The editable text exceeds the local budget or is not text.');
    if (job.kind === 'shacl' && !['none', 'subclass', 'rdfs', undefined].includes(job.inference)) fail('LAB_INFERENCE_PROFILE', 'This browser adapter supports inference none, subclass or rdfs; choose a supported profile explicitly.');
    const t0 = now(); let out;
    switch (job.kind) {
      case 'count': {
        if (editText != null && job.edit_lang === 'turtle') {      // T1.1: count the triples of the snippet AND of the twin
          let snippet = null; try { snippet = new L.Parser().parse(PREFIX_TTL + editText).length; } catch (e) { snippet = 'parse error: ' + String(e.message || e).slice(0, 160); }
          out = { triples: (await storeOf(job.graph)).size, snippet_triples: snippet }; break; }
        out = { triples: (await storeOf(job.graph)).size }; break; }
      case 'sha256': {
        const file = Object.hasOwn(manifest.content_paths, job.file) ? manifest.content_paths[job.file] : job.file; const buf = new TextEncoder().encode(await text(file));
        const h = await crypto.subtle.digest('SHA-256', buf); out = { sha256: [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''), file, bytes: buf.length }; break; }
      case 'select': case 'ask': out = await select(await storeOf(job.graph), editText != null ? editText : job.query); break;
      case 'diff': {
        const q = editText != null ? editText : job.query;
        const vals = async g => { const result = await select(await storeOf(g), q), values = new Map();
          if (!result.vars.includes(job.var)) fail('LAB_DIFF_VARIABLE', 'The difference variable must occur in the query result.');
          result.terms.forEach((row, i) => { const term = row[job.var]; if (term && term.termType === 'BlankNode') fail('LAB_DIFF_BLANK_NODE', 'Blank-node labels are answer-local; use named witnesses or a graph-isomorphism comparison.'); values.set(JSON.stringify(term), { term, value: result.rows[i][job.var] }); }); return values; };
        const a = await vals(job.graph_a), b = await vals(job.graph_b); const d = [...a.keys()].filter(x => !b.has(x)).sort();
        out = { count_a: a.size, count_b: b.size, count: d.length, values: d.map(k => a.get(k).value), terms: d.map(k => a.get(k).term) }; break; }
      case 'reason': {
        const st = await storeOf(job.graph); const before = x3doTypesOnScene(st); const n0 = st.size;
        const rules = editText != null ? editText : await text(manifest.content_paths[job.rules_file]);
        const t = now(); reasonInPlace(st, rules); const ms = +(now() - t).toFixed(1);
        const after = x3doTypesOnScene(st); const focus = {};
        for (const k of (Array.isArray(job.focus) ? job.focus : Object.keys(job.focus || {}))) {
          const iri = k.startsWith(':') ? BASE + k.slice(1) : k;
          const types = [...after].filter(x => x.startsWith(iri + ' ')).map(x => x.split('#').pop()).sort();
          focus[k] = { count: types.length, types };
        }
        const added = [...after].filter(x => !before.has(x));
        const perClass = {}; for (const x of added) { const c = x.split(' ')[1]; perClass[c] = (perClass[c] || 0) + 1; }
        // a deterministic sample of the new type edges for the gold layer (the page caps the visible rays)
        const sample = added.filter((_, i) => i % Math.max(1, Math.floor(added.length / 600)) === 0).slice(0, 600).map(x => x.split(' '));
        out = { asserted_triples: n0, derived_triples: st.size - n0, inference_profile: editText != null ? 'edited-n3-rules' : job.rules, base_graph_unchanged: true, added_x3do_types_on_scene_iris: added.length, x3do_types_on_scene_iris_after: after.size, n3_store_growth_triples: st.size - n0, n3_reason_ms: ms, focus, per_class: perClass, sample };
        break; }
      case 'shacl': {
        const st = await storeOf(job.graph); let reason_ms = null;
        if (job.inference === 'rdfs' || job.inference === 'subclass') { const t = now(); reasonInPlace(st, await text(manifest.content_paths['rules/' + job.inference + '.n3'])); reason_ms = +(now() - t).toFixed(1); }
        let shapesText = editText != null ? editText : job.shapes_ttl;
        if (shapesText == null && job.shapes_file) shapesText = await text(manifest.content_paths[job.shapes_file]);
        let shapes = new L.Store(new L.Parser().parse(shapesText));
        if (job.only_ids) shapes = filterShapes(shapes, job.only_ids);
        out = await shacl(st, shapes, { skipGroupBy: !!job.js_skip_group_by });
        if (reason_ms !== null) out[job.inference === 'rdfs' ? 'n3_rdfs_ms' : 'n3_subclass_ms'] = reason_ms;
        out.inference_profile = job.inference || 'none';
        if (job.js_also_unfixed) { const u = await shacl(st, shapes, { fix: false }); out.unfixed = { conforms: u.conforms, count: u.count, ms: u.ms_shacl_engine }; }
        out.shapes_run = shapes.getSubjects(nn(RDF_TYPE), nn(SH + 'NodeShape'), null).length;
        out.sparql_constraints = shapes.getQuads(null, nn(SH + 'sparql'), null, null).length;
        break; }
      default: throw new Error('this job runs at build time only: ' + job.kind);
    }
    out._ms = +(now() - t0).toFixed(1);
    return out;
  }
  async function inspectReasoning({ graphs = ['cabinet', 'slice'], profile = 'subclass', focus = [] } = {}) {
    if (!['none', 'subclass', 'rdfs'].includes(profile)) fail('LAB_INFERENCE_PROFILE', 'Choose none, subclass or rdfs.');
    const store = await storeOf(graphs), asserted = new L.Store(store.getQuads(null, null, null, null));
    const key = q => JSON.stringify([q.subject.id, q.predicate.id, q.object.id, q.graph.id]);
    const before = new Set(asserted.getQuads(null, null, null, null).map(key));
    if (profile !== 'none') reasonInPlace(store, await text(manifest.content_paths['rules/' + profile + '.n3']));
    const derived = store.getQuads(null, null, null, null).filter(q => !before.has(key(q)));
    const scene = new L.Store(), ontology = new L.Store();
    for (const g of graphs) (g === 'slice' ? ontology : scene).addQuads(await quadsOfGraph(g));
    const selected = Array.isArray(focus) && focus.length ? [...new Set(focus.filter(x => typeof x === 'string').map(x => x.startsWith(':') ? BASE + x.slice(1) : x))].slice(0, 12)
      : [...new Set(scene.getSubjects(nn(RDF_TYPE), null, null).filter(t => t.termType === 'NamedNode' && t.value.startsWith(BASE)).map(t => t.value))].sort().slice(0, 12);
    const rdfType = nn(RDF_TYPE), types = (dataset, iri) => dataset.getObjects(nn(iri), rdfType, null).filter(t => t.termType === 'NamedNode').map(t => t.value).sort();
    const value = t => t.termType === 'BlankNode' ? '_:' + t.value : t.value;
    const sampleBlanks = new Map();
    return { assertedSceneTriples: scene.size, ontologySliceTriples: ontology.size, closureTriples: store.size, derivedTriples: derived.length, profile,
      focus: selected.map(iri => { const assertedTypes = types(asserted, iri), known = new Set(assertedTypes); return { iri, assertedTypes, derivedTypes: types(store, iri).filter(t => !known.has(t)) }; }),
      sample: derived.slice(0, 80).map(q => ({ subject: value(q.subject), predicate: q.predicate.value, object: value(q.object), objectTerm: termJSON(q.object, sampleBlanks), origin: 'derived' })),
      sampleLimit: 80, baseGraphUnchanged: true, evidence: 'Computed from the installed scene graph(s) plus the installed ontology slice; not the full published ontology.' };
  }
  const PREFIX_TTL = '@prefix : <' + BASE + '> .\n@prefix x3do: <' + X3DO + '> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <' + RDF + '> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n';

  G.LabEngine = {
    init(fetcher, man) {
      if (typeof fetcher !== 'function' || !man || !man.graphs || typeof man.graphs !== 'object' || Array.isArray(man.graphs) || !man.content_paths || typeof man.content_paths !== 'object' || Array.isArray(man.content_paths)) fail('LAB_MANIFEST_TYPE', 'A fetch function and installed graph manifest are required.');
      const files = [...Object.keys(man.files || {}), ...Object.values(man.graphs), ...Object.values(man.content_paths)];
      if (files.some(file => typeof file !== 'string' || /^(?:[\/]|[a-z][a-z\d+.-]*:)/i.test(file) || /[\\%?#]/.test(file) || file.split('/').includes('..'))) fail('LAB_MANIFEST_SCOPE', 'Manifest assets must be relative local paths.');
      fetchText = fetcher; manifest = man; textCache.clear(); quadCache.clear(); allowedFiles = new Set(files);
    },
    limits: LIMITS, queryPolicy, inspectReasoning,
    run, warm: async () => { const t = now(); await select(await storeOf(['cabinet', 'slice']), 'PREFIX x3do: <' + X3DO + '>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT ?m WHERE { ?m a/rdfs:subClassOf* x3do:X3DMaterialNode } LIMIT 3'); return +(now() - t).toFixed(1); },
    preload: async graphs => { for (const g of graphs) await quadsOfGraph(g); },
  };
})(typeof self !== 'undefined' ? self : globalThis);
