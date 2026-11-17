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
  let fetchText = null, manifest = null;
  const textCache = new Map(), quadCache = new Map();

  function short(t) {
    if (!t) return null;
    if (t.termType === 'NamedNode') { for (const [p, s] of PREFIXES) if (t.value.startsWith(p)) return s + t.value.slice(p.length); return t.value; }
    if (t.termType === 'BlankNode') return '_:b';
    if (t.termType === 'Literal') {
      const dt = t.datatype ? t.datatype.value : '';
      if (/#(decimal|double|float|integer|int|long)$/.test(dt)) return Number(t.value);
      if (dt.endsWith('#boolean')) return t.value === 'true';
      return t.value;
    }
    return t.value;
  }
  async function text(file) { if (!textCache.has(file)) textCache.set(file, fetchText(file)); return textCache.get(file); }
  async function quadsOfGraph(g) {
    const file = manifest.graphs[g]; if (!file) throw new Error('unknown graph ' + g);
    if (!quadCache.has(g)) quadCache.set(g, text(file).then(t => new L.Parser().parse(t)));
    return quadCache.get(g);
  }
  async function storeOf(graphs) { const s = new L.Store(); for (const g of graphs) s.addQuads(await quadsOfGraph(g)); return s; }

  const engine = new L.QueryEngine();
  async function select(store, query) {
    const r = await engine.query(query, { sources: [store] });
    if (r.resultType === 'boolean') return { ask: await r.execute() };
    if (r.resultType !== 'bindings') throw new Error('only SELECT and ASK run here (got ' + r.resultType + ')');
    const bs = await (await r.execute()).toArray();
    const meta = await r.metadata();
    const vars = meta.variables.map(v => (v.variable || v).value);
    return { vars, count: bs.length, rows: bs.map(b => Object.fromEntries(vars.map(v => [v, short(b.get(v))]))) };
  }

  function x3doTypesOnScene(store) {
    const out = new Set();
    for (const q of store.match(null, nn(RDF_TYPE), null))
      if (q.subject.termType === 'NamedNode' && q.subject.value.startsWith(BASE) && q.object.value.startsWith(X3DO)) out.add(q.subject.value + ' ' + q.object.value);
    return out;
  }
  function reasonInPlace(store, rulesText) { new L.Reasoner(store).reason(new L.Store(new L.Parser({ format: 'text/n3' }).parse(rulesText))); }

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
    const t0 = now(); let out;
    switch (job.kind) {
      case 'count': {
        if (editText != null && job.edit_lang === 'turtle') {      // T1.1: count the triples of the snippet AND of the twin
          let snippet = null; try { snippet = new L.Parser().parse(PREFIX_TTL + editText).length; } catch (e) { snippet = 'parse error: ' + String(e.message || e).slice(0, 160); }
          out = { triples: (await storeOf(job.graph)).size, snippet_triples: snippet }; break; }
        out = { triples: (await storeOf(job.graph)).size }; break; }
      case 'sha256': {
        const file = manifest.content_paths[job.file] || job.file; const buf = new TextEncoder().encode(await text(file));
        const h = await crypto.subtle.digest('SHA-256', buf); out = { sha256: [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''), file, bytes: buf.length }; break; }
      case 'select': case 'ask': out = await select(await storeOf(job.graph), editText != null ? editText : job.query); break;
      case 'diff': {
        const q = editText != null ? editText : job.query;
        const vals = async g => new Set((await select(await storeOf(g), q)).rows.map(r => String(r[job.var])));
        const a = await vals(job.graph_a), b = await vals(job.graph_b); const d = [...a].filter(x => !b.has(x)).sort();
        out = { count_a: a.size, count_b: b.size, count: d.length, values: d }; break; }
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
        out = { added_x3do_types_on_scene_iris: added.length, x3do_types_on_scene_iris_after: after.size, n3_store_growth_triples: st.size - n0, n3_reason_ms: ms, focus, per_class: perClass, sample };
        break; }
      case 'shacl': {
        const st = await storeOf(job.graph); let reason_ms = null;
        if (job.inference === 'rdfs') { const t = now(); reasonInPlace(st, await text(manifest.content_paths['rules/rdfs.n3'])); reason_ms = +(now() - t).toFixed(1); }
        let shapesText = editText != null ? editText : job.shapes_ttl;
        if (shapesText == null && job.shapes_file) shapesText = await text(manifest.content_paths[job.shapes_file]);
        let shapes = new L.Store(new L.Parser().parse(shapesText));
        if (job.only_ids) shapes = filterShapes(shapes, job.only_ids);
        out = await shacl(st, shapes, { skipGroupBy: !!job.js_skip_group_by });
        if (reason_ms !== null) out.n3_rdfs_ms = reason_ms;
        if (job.js_also_unfixed) { const u = await shacl(st, shapes, { fix: false }); out.unfixed = { conforms: u.conforms, count: u.count, ms: u.ms_shacl_engine }; }
        out.shapes_run = shapes.getSubjects(nn(RDF_TYPE), nn(SH + 'NodeShape'), null).length;
        out.sparql_constraints = shapes.getQuads(null, nn(SH + 'sparql'), null, null).length;
        break; }
      default: throw new Error('this job runs at build time only: ' + job.kind);
    }
    out._ms = +(now() - t0).toFixed(1);
    return out;
  }
  const PREFIX_TTL = '@prefix : <' + BASE + '> .\n@prefix x3do: <' + X3DO + '> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <' + RDF + '> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n';

  G.LabEngine = {
    init(fetcher, man) { fetchText = fetcher; manifest = man; },
    run, warm: async () => { const t = now(); await select(await storeOf(['cabinet', 'slice']), 'PREFIX x3do: <' + X3DO + '>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT ?m WHERE { ?m a/rdfs:subClassOf* x3do:X3DMaterialNode } LIMIT 3'); return +(now() - t).toFixed(1); },
    preload: async graphs => { for (const g of graphs) await quadsOfGraph(g); },
  };
})(typeof self !== 'undefined' ? self : globalThis);
