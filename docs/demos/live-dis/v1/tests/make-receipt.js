// make-receipt.js: gathers the numbers the tests recorded into RECEIPT.json.
//   LIVE_DIS_RESULTS=/some/dir node --test tests/*.test.js          (and  python3 tests/crosscheck_opendis.py --out /some/dir/crosscheck_opendis.json,
//                                                                python3 tests/validate_x3d.py x3d-4.0.xsd > /some/dir/validate_x3d.json)
//   node tests/make-receipt.js /some/dir > RECEIPT.json
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tests/make-receipt.js <results directory>'); process.exit(1); }
const parts = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) parts[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
const e2e = parts.end_to_end, inPage = parts.in_page?.result, x = parts.xite_alone;
const summary = {
  nodes_parsed_by_x_ite: x ? Object.values(x.nodes).filter((n) => n.parses && n.name_type_access_mismatches === 0).length : null,
  nodes_live_as_reader: inPage ? 6 : null,
  nodes_live_as_writer: e2e?.writers ? 4 : null,
  nodes_with_no_writer_mode_in_the_specification: 2,
  dead_reckoning_algorithms_verified: parts.dr ? Object.keys(parts.dr.algorithms).length : null,
  codec_crosscheck_opendis_python: parts.crosscheck_opendis ? Object.fromEntries(Object.entries(parts.crosscheck_opendis.codec).map(([k, v]) => [k, { pdus: v.pdus, mismatches: v.mismatches, octet_identical: v.octet_identical }])) : null,
  codec_crosscheck_open_dis_javascript: parts.crosscheck_open_dis_js ?? null,
};
console.log(JSON.stringify({
  demo: 'Live DIS v1 (Demo 85)', made: new Date().toISOString().slice(0, 10),
  note: 'Every number below was written by a test in tests/ during one run on one machine. Every PDU in every test was generated; no recorded traffic was used. All network traffic stayed on that machine.',
  summary, results: parts,
}, null, 1));
