/* Run: node --test tests/test-engine.js tests/test-engine-parity.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
vm.runInThisContext(fs.readFileSync(path.join(root, 'vendor/lab-stack.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'engine.js'), 'utf8'));
const E = globalThis.LabEngine;
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const prefix = '@prefix : <urn:fixture:> . @prefix xsd: <' + XSD + '> .\n';
function memory(graphs) {
  const manifest = { files: {}, graphs: {}, content_paths: {} }, files = {};
  for (const [name, text] of Object.entries(graphs)) {
    const file = 'data/' + name + '.ttl'; manifest.graphs[name] = file; manifest.files[file] = {}; files[file] = prefix + text;
  }
  E.init(async file => { assert.ok(Object.hasOwn(files, file), 'no unlisted fetch'); return files[file]; }, manifest);
}
function query(q, graph = ['g']) { return E.run({ kind: 'select', graph, query: q }); }
function bundled() { E.init(async file => fs.readFileSync(path.join(root, file), 'utf8'), JSON.parse(fs.readFileSync(path.join(root, 'data/manifest.json'), 'utf8'))); }

test('blank node labels preserve co-reference and are distinct within one answer', async () => {
  memory({ g: '_:a :p _:a . _:b :p _:a .' });
  const result = await query('SELECT ?s ?o WHERE {?s <urn:fixture:p> ?o}');
  assert.equal(new Set(result.rows.map(r => r.s)).size, 2);
  assert.ok(result.rows.every(r => /^_:b\d+$/.test(r.s)));
  const reflexive = result.rows.find(r => r.s === r.o); assert.ok(reflexive);
  assert.ok(result.terms.every(r => r.s.termType === 'BlankNode'));
  assert.match(result.blank_node_scope, /this answer only/);
});

test('separate graph blank-node labels do not merge in a union', async () => {
  memory({ a: '_:same :p "a" .', b: '_:same :p "b" .' });
  const result = await query('SELECT ?s ?o WHERE {?s <urn:fixture:p> ?o}', ['a', 'b']);
  assert.equal(result.count, 2); assert.equal(new Set(result.rows.map(r => r.s)).size, 2);
});

test('large integers and long decimals keep exact values rather than unsafe Number coercion', async () => {
  memory({ g: ':a :p "9007199254740993"^^xsd:integer . :b :p "0.1234567890123456789"^^xsd:decimal .' });
  const result = await query('SELECT ?v WHERE {?s <urn:fixture:p> ?v}');
  assert.deepEqual(new Set(result.rows.map(r => r.v)), new Set(['9007199254740993', '0.1234567890123456789']));
  assert.ok(result.terms.some(r => r.v.value === '9007199254740993' && r.v.datatype === XSD + 'integer'));
});

test('boolean lexical 1 is true, 0 is false, and custom datatypes are not numerically coerced', async () => {
  memory({ g: ':a :p "1"^^xsd:boolean . :b :p "0"^^xsd:boolean . :c :p "2"^^<urn:custom#integer> .' });
  const result = await query('SELECT ?v WHERE {?s <urn:fixture:p> ?v}');
  assert.deepEqual(new Set(result.rows.map(r => r.v)), new Set([true, false, '2']));
});

test('unbound variables differ from empty strings and language/datatype information survives', async () => {
  memory({ g: ':a :p "" . :b :p "bonjour"@fr .' });
  const result = await query('SELECT ?v ?missing WHERE {?s <urn:fixture:p> ?v OPTIONAL {?s <urn:absent> ?missing}}');
  assert.ok(result.rows.some(r => r.v === '' && r.missing === null));
  assert.ok(result.terms.some(r => r.v.language === 'fr' && r.v.value === 'bonjour'));
});

test('ORDER BY output sequence is retained without lexical row re-sorting', async () => {
  memory({ g: ':a :p 1 .' });
  const result = await query('SELECT ?n WHERE { VALUES ?n { 2 11 1 } } ORDER BY DESC(?n)');
  assert.deepEqual(result.rows.map(r => r.n), [11, 2, 1]);
  assert.deepEqual(result.order, { requested: 'query', preserved: true });
});

test('query keyword policy permits keywords in strings, comments, IRIs and variable names', async () => {
  memory({ g: ':a :p 1 .' });
  const q = 'PREFIX service: <urn:SERVICE:>\nSELECT ?FROM WHERE { BIND("SERVICE FROM ORDER BY" AS ?FROM) } # FROM <http://invalid.example>\n';
  const result = await query(q); assert.equal(result.rows[0].FROM, 'SERVICE FROM ORDER BY');
  assert.equal(result.order.requested, 'unspecified');
});

test('remote SERVICE and FROM are rejected before any query fetch', async () => {
  memory({ g: ':a :p 1 .' });
  for (const q of ['SELECT * WHERE {SERVICE <https://invalid.example/sparql> {?s ?p ?o}}', 'SELECT * FROM <https://invalid.example/data> WHERE {?s ?p ?o}'])
    await assert.rejects(query(q), { code: 'LAB_QUERY_REMOTE' });
});

test('updates and CONSTRUCT are refused as non-read-only result forms', async () => {
  memory({ g: ':a :p 1 .' });
  for (const q of ['INSERT DATA {<urn:a> <urn:b> <urn:c>}', 'CONSTRUCT {?s ?p ?o} WHERE {?s ?p ?o}']) await assert.rejects(query(q), { code: 'LAB_QUERY_READ_ONLY' });
});

test('query result collection has a row ceiling and fails explicitly rather than certifying a truncated answer', async () => {
  memory({ g: ':a :p 1 .' });
  const a = Array.from({length: 201}, (_, i) => i).join(' '), b = Array.from({length: 100}, (_, i) => i).join(' ');
  await assert.rejects(query(`SELECT ?a ?b WHERE { VALUES ?a {${a}} VALUES ?b {${b}} }`), { code: 'LAB_RESULT_LIMIT' });
});

test('reinitializing clears cached graph contents', async () => {
  memory({ g: ':a :p 1 .' }); assert.equal((await E.run({kind:'count',graph:['g']})).triples, 1);
  memory({ g: ':a :p 1 . :b :p 2 .' }); assert.equal((await E.run({kind:'count',graph:['g']})).triples, 2);
});

test('failed graph fetches can be retried rather than becoming permanently cached rejections', async () => {
  let calls = 0; E.init(async () => { if (++calls === 1) throw new Error('temporary failure'); return prefix + ':a :p 1 .'; }, { files:{'data/g.ttl':{}},graphs:{g:'data/g.ttl'},content_paths:{} });
  await assert.rejects(E.run({kind:'count',graph:['g']}), /temporary/);
  assert.equal((await E.run({kind:'count',graph:['g']})).triples, 1);
});

test('file and graph scope reject arbitrary paths, inherited keys and remote manifests', async () => {
  memory({ g: ':a :p 1 .' });
  await assert.rejects(E.run({kind:'sha256',file:'https://invalid.example/private'}), {code:'LAB_FILE_SCOPE'});
  await assert.rejects(E.run({kind:'count',graph:['toString']}), {code:'LAB_GRAPH_SCOPE'});
  assert.throws(() => E.init(async () => '', {graphs:{g:'https://invalid.example/data'},content_paths:{}}), {code:'LAB_MANIFEST_SCOPE'});
});

test('typed set difference does not flatten a literal into a named node with the same display text', async () => {
  memory({ a: ':x :p <urn:same> .', b: ':x :p "urn:same" .' });
  const r=await E.run({kind:'diff',graph_a:['a'],graph_b:['b'],var:'v',query:'SELECT ?v WHERE {?s <urn:fixture:p> ?v}'});
  assert.equal(r.count,1);assert.equal(r.terms[0].termType,'NamedNode');
});

test('set difference refuses cross-answer blank-node identity guesses', async () => {
  memory({ a: '_:x :p 1 .', b: '_:x :p 1 .' });
  await assert.rejects(E.run({kind:'diff',graph_a:['a'],graph_b:['b'],var:'s',query:'SELECT ?s WHERE {?s <urn:fixture:p> ?v}'}), {code:'LAB_DIFF_BLANK_NODE'});
});

test('SHACL embedded queries cannot use network SERVICE clauses', async () => {
  memory({ g: ':a :p 1 .' });
  const shapes='@prefix sh:<http://www.w3.org/ns/shacl#>. <urn:shape> a sh:NodeShape; sh:targetNode <urn:fixture:a>; sh:sparql [sh:select "SELECT $this WHERE {SERVICE <https://invalid.example/sparql> {$this ?p ?o}}"].';
  await assert.rejects(E.run({kind:'shacl',graph:['g'],shapes_ttl:shapes,inference:'none'}), {code:'LAB_QUERY_REMOTE'});
});

test('actual bundled list traversal retains duplicate white components; DISTINCT collapses them', async () => {
  bundled();
  const prefix='PREFIX x3do:<https://www.web3d.org/specifications/X3dOntology4.1#> PREFIX rdf:<http://www.w3.org/1999/02/22-rdf-syntax-ns#> ';
  const body='?c WHERE {<https://semantic-twin-lab.example/TheCabinet.ttl#Pearl> x3do:diffuseColor ?l. ?l rdf:rest*/rdf:first ?c}';
  const plain=await query(prefix+'SELECT '+body,['cabinet']), distinct=await query(prefix+'SELECT DISTINCT '+body,['cabinet']);
  assert.deepEqual(plain.rows.map(r=>r.c),[1,1,1]);assert.deepEqual(distinct.rows.map(r=>r.c),[1]);
});

test('provenance-separated reasoning reports a derived delta without modifying the base graph', async () => {
  bundled(); const before=await E.run({kind:'count',graph:['cabinet']});
  const report=await E.inspectReasoning({graphs:['cabinet','slice'],profile:'subclass',focus:[':Gilt']});
  assert.equal(report.assertedSceneTriples,before.triples);assert.ok(report.derivedTriples>0);assert.ok(report.focus[0].assertedTypes.includes('https://www.web3d.org/specifications/X3dOntology4.1#PhysicalMaterial'));assert.ok(report.focus[0].derivedTypes.length>0);
  assert.equal((await E.run({kind:'count',graph:['cabinet']})).triples,before.triples);assert.equal(report.baseGraphUnchanged,true);
  assert.equal(report.closureTriples,report.assertedSceneTriples+report.ontologySliceTriples+report.derivedTriples);
});

test('none reasoning profile reports zero derived triples', async () => {
  bundled();const r=await E.inspectReasoning({graphs:['cabinet','slice'],profile:'none',focus:[':Gilt']});assert.equal(r.derivedTriples,0);assert.deepEqual(r.focus[0].derivedTypes,[]);
});

test('subclass SHACL profile is supported and unknown profiles fail explicitly', async () => {
  bundled();const shapes='@prefix sh:<http://www.w3.org/ns/shacl#>. <urn:shape> a sh:NodeShape; sh:targetNode <https://semantic-twin-lab.example/TheCabinet.ttl#Gilt>; sh:class <https://www.web3d.org/specifications/X3dOntology4.1#X3DMaterialNode>.';
  const r=await E.run({kind:'shacl',graph:['cabinet','slice'],shapes_ttl:shapes,inference:'subclass'});assert.equal(r.conforms,true);assert.equal(r.inference_profile,'subclass');
  await assert.rejects(E.run({kind:'shacl',graph:['cabinet'],shapes_ttl:shapes,inference:'owl-rl'}),{code:'LAB_INFERENCE_PROFILE'});
});


test('reasoning sample term labels preserve distinct blank objects across the answer', async () => {
  const files = {'data/g.ttl':prefix + ':a :p _:x . :b :p _:y .', 'data/rules.n3':prefix + '{?s :p ?o} => {?s :q ?o}.'};
  E.init(async file => files[file], {files:{'data/g.ttl':{},'data/rules.n3':{}},graphs:{g:'data/g.ttl'},content_paths:{'rules/subclass.n3':'data/rules.n3'}});
  const report = await E.inspectReasoning({graphs:['g'],profile:'subclass'});
  assert.equal(report.sample.length,2);
  assert.equal(new Set(report.sample.map(q=>q.objectTerm.value)).size,2);
  assert.ok(report.sample.every(q=>q.objectTerm.termType==='BlankNode'));
});
