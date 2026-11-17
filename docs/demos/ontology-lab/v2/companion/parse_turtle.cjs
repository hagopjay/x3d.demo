/* Local parser bridge. Reads Turtle from stdin; no fetch, imports or RDF dereferencing. */
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
try {
  const stack = path.join(__dirname, '..', 'vendor', 'lab-stack.js');
  const L = vm.runInThisContext(fs.readFileSync(stack, 'utf8') + ';E_lab_stack', {timeout: 10000, filename: stack});
  const term = t => {
    if (t.termType === 'Literal') return {termType: t.termType, value: t.value, language: t.language || '', datatype: t.datatype.value};
    if (!['NamedNode','BlankNode','DefaultGraph'].includes(t.termType)) throw new Error('unsupported RDF term: ' + t.termType);
    return {termType: t.termType, value: t.value};
  };
  const input = fs.readFileSync(0);
  if (input.byteLength > 16 * 1024 * 1024) throw new Error('Turtle input exceeds 16 MiB');
  // Buffer.toString would silently replace malformed bytes, making the graph
  // describe a different Unicode document from the one the caller supplied.
  const text = new TextDecoder('utf-8', {fatal:true}).decode(input);
  const quads = new L.Parser({format:'text/turtle', baseIRI:'urn:semantic-twin:input:'}).parse(text);
  if (quads.length > 50000) throw new Error('graph exceeds 50000 triple limit');
  if (quads.some(q => q.graph.termType !== 'DefaultGraph')) throw new Error('only one default RDF graph is supported');
  process.stdout.write(JSON.stringify({parser:'bundled N3.js', triples:quads.map(q => [term(q.subject),term(q.predicate),term(q.object)])}));
} catch (error) { process.stderr.write(String(error.message || error) + '\n'); process.exitCode = 2; }
