# Local evidence companion

This reference implementation gives the study a repeatable local path for three
questions: whether source bytes changed, whether two default RDF graphs are
isomorphic under a stated bounded algorithm, and whether a compact evidence
chain remains internally consistent. It does not patch the absent x3d_mcp
server or certify an X3D scene as schema-valid.

Run commands from the extracted lab folder. Python 3.11 or newer is required.
Graph commands also require Node.js and use the already-bundled N3 parser; no
Python package installation, external graph retrieval, or API key is needed.

```bash
python3 -m companion --help
python3 -m companion audit data/scenes/cabinet.xml --ttl data/ttl/cabinet.ttl.txt
python3 -m companion audit data/scenes/fault-F6.xml --ttl data/ttl/fault-F6.ttl.txt
python3 -m companion graph data/ttl/cabinet.ttl.txt
```

`audit` distinguishes `ok` (the bounded inspector ran) from `clean` (its checks
found no errors). Exit status is 0 for clean, 1 for findings, and 2 for an
operation error. It checks lexical Scene/ProtoBody DEF scopes, USE order/type,
and missing ROUTE endpoints. It does not load external DTDs, expand PROTOs,
resolve imported scenes, or perform XSD, container-field, rendering, or full
semantic validation. XML and supplied Turtle are inspected independently;
`rdf.correspondence_verified` therefore remains false.

## Source witnesses and one-attribute repair

Witnesses name a source SHA-256, opening-tag byte span, source line/column,
lexical XML path, element type, and DEF. They locate a revision; they do not
promise an identifier that survives later edits.

The following command repairs the bundled F1 fixture to a separate output:

```bash
python3 -m companion patch data/scenes/fault-F1.xml --def Ruby --attribute diffuseColor --value "0.85 0.08 0.16" --expected-sha256 54fd9344db6e912e47da1603d5e95ca2f6f47f4da2a76a60c8d45cd1350d660c --expected-value "1.5 0.08 0.16" --out ruby-repaired.x3d
```

The source is never overwritten. The command refuses an existing output,
ambiguous DEF, missing field, identity/namespace edit, changed input hash, or
changed expected value. It replaces only the attribute value bytes, preserving
all untouched bytes, quote style, DOCTYPE, and newline style. The bundled F1
XML itself has no DOCTYPE; preservation is also tested with a synthetic external
DOCTYPE fixture without loading that DTD.

A successful patch establishes well-formed XML, not X3D field validity. Rebuild
the RDF projection and run independent XSD, semantic, and SHACL checks before
calling a general scene repair complete. The browser workbench's projected RGB
check is a narrower field experiment.

## Graph identity and source order

`semantic-twin-graph-c14n/v1` is a project algorithm, **not W3C RDFC-1.0 or
URDNA2015**. It retains RDF literal lexical forms, datatype IRIs, and language
tags, refines blank-node partitions, then enumerates remaining admissible label
permutations. It refuses when its node, refinement, labeling, or serialization
budgets would be exceeded. It never substitutes a text hash when it cannot
complete the exact search. Only one default RDF graph is accepted.

The Turtle parser uses the explicit base IRI `urn:semantic-twin:input:` for
relative IRIs. The report records that base. Malformed UTF-8 is rejected rather
than replaced by a different Unicode document.

The actual Cabinet and F6 Turtle fixtures have the same bounded canonical graph
hash, while their XML source hashes differ. The source audit detects F6's USE
before DEF. Thus graph identity cannot witness a source-order fact omitted by
the supplied RDF projection. It does not follow that every duplicate DEF or
source edit leaves a graph unchanged: F7's graph hash differs in this corpus.

## Compact local evidence chain

```bash
python3 -m companion audit data/scenes/cabinet.xml --ttl data/ttl/cabinet.ttl.txt --out cabinet-report.json --ledger local-ledger.json
python3 -m companion verify local-ledger.json
python3 -m companion verify companion/examples/evidence-ledger.json
```

Instruments are stored once by content hash. Each record carries a sequence,
previous-record hash, instrument reference, claim, and evidence. Verification
detects changes to claims, instruments, sequence, parent links, or recorded
hashes. It does not establish the truth of a claim, authorship, or an exhaustive
history. A chain can be recomputed; truncation is detectable only against an
independently retained head **and** length. Use `verify --head HEX --length N`
with such an external commitment. The adjacent example anchor demonstrates the
format and is explicitly not an independently trusted commitment.

## Reproduce the supplied examples

```bash
python3 -m companion.build_examples
python3 -m unittest tests/test_companion.py tests/test_xml_witness.py
```

The build command rewrites only the known example files under
`companion/examples/`. It does not call an upstream server or rerun the original
XML-to-RDF pipeline. The reports, repair receipt/diff, four-record ledger, and
example anchor are deterministic for the bundled inputs and this implementation.
