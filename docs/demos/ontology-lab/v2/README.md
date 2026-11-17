# Semantic Twin Lab Evidence Edition

An enhanced local X3D ontology study: the original 38-station, three-strata lab plus a separate Evidence Workbench for reasoning, RDF lists, file integrity, and source repair witnesses.

The useful distinction is between **source bytes, asserted facts, derived facts, validation policy, and evidence**. This edition makes those boundaries inspectable. It preserves the supplied historical receipts and separates them from new local computations.

## Run locally

```bash
python3 serve.py
```

Open the address printed by the server. The default is:

- `http://127.0.0.1:8790/workbench.html` — evidence experiments, usable without WebGL.
- `http://127.0.0.1:8790/index.html` — the original X3D lab, with a link to the workbench.
- `http://127.0.0.1:8790/ONTOLOGY-FIELD-GUIDE.html` — the technical and learning guide.

On Windows, `py -3 serve.py` is an alternative. If the port is occupied, use `python3 serve.py --port 8791`.

Python 3.10+ is sufficient for the local server and companion. The optional companion's Turtle parsing and JavaScript tests require Node 18+; they use the bundled N3 implementation and do not install packages. The original 3D view needs a WebGL-capable browser. Runtime browser dependencies are bundled.

Do not open `index.html` directly from the file system: the lab uses local fetches and workers. The server binds to loopback and has no write endpoint or external API integration.

## Version 2 on the demo site (17 Nov 2026)

This folder is the Evidence Edition, published as Semantic Twin Lab v2. Version 1 stays unchanged at `../v1/`. Three changes since the edition was written:

- **x3d_mcp gained the companion's best primitives as server tools:**
  - `source_witness_audit`: byte-located DEF/USE/ROUTE witnesses.
  - `patch_x3d_attribute`: a guarded, byte-preserving edit that also re-runs the XSD and `validate_semantic` on the result.
  - `shacl_counterfactual`: the asserted graph against the inferred graph; it lists what was hidden and what was added.
- **The F5 counterfactual was re-measured with a second engine.** In pyshacl 0.40.2 with full RDFS (owlrl 7.6.2), the one real S7 result disappears, and 57,769 new results appear on 142 focus nodes. See the guide's reasoning section.
- **The edition's claims were re-run here:**
  - 117 of 117 Node tests and 32 of 32 Python tests pass.
  - All 58 manifest files match their digests, and 7 recorded source hashes differ from their published copies, as stated.
  - Plain SELECT returns Pearl's `1` three times; DISTINCT returns it once.

## What to explore

| View | Useful experiment | Boundary to notice |
| --- | --- | --- |
| Original X3D lab | Follow the stations and planted faults through the scene, twin, and ontology. | A visible or well-formed scene is not a complete semantic verdict. |
| Reasoning | Compare asserted data and a separately derived layer, then examine why a constraint changes its result. | Inference changes the interpreted graph; it does not repair the XML source. |
| Ordered lists | Compare plain SELECT, SELECT DISTINCT, and indexed RDF list cells. | Multiplicity, cell position, and display order are different properties. |
| Evidence integrity | Verify available bytes against the shipped manifest and inspect historical references. | A matching digest does not reproduce an absent source or authenticate its author. |
| Repair witness | Inspect a minimal F1 colour repair and its before/after source witness. | The source edit and the RDF repair fixture are separately evaluated; no general XML-to-RDF regeneration is implied. |

The original learning path remains intact. Browser-computed query, reasoning, and validation results should be read alongside their inputs and limits. The recorded MCP sessions remain historical observations on the versions named in their receipts, not new calls to a live server.

## Two study corrections worth retaining

**List multiplicity:** in the currently bundled engine, plain `SELECT ?m ?c` over the colour-list path returns Pearl's value `1` three times. Adding `DISTINCT` collapses the equal projected values. A result without a list index still does not tell you RGB position. The historical F-08 server observation must not be generalized into a claim that every SPARQL list-path query removes duplicates.

**Placement versus entailment:** a reverse placement-map query asks which declared ranges already subsume a class, under a stated counting rule. A forward RDFS derivation asks what type follows after a property is used. These are different operations. In the supplied slice, a `hasChildren` range can infer a child-node type for an invalidly placed Box; that does not establish that the original X3D placement was legal.

See `STUDY-AUDIT.md` for the detailed source-grounded audit and corrections, and `UPSTREAM-PLAN.md` for a bounded integration plan.

## Local companion

This is a bounded reference implementation of useful primitives, not a patch to the absent upstream `x3d_mcp` repository.

```bash
# Inspect source references and the supplied RDF graph independently.
python3 -m companion audit data/scenes/cabinet.xml \
  --ttl data/ttl/cabinet.ttl.txt --out source-audit.json

# Compare Turtle byte identity and a bounded canonical graph fingerprint.
python3 -m companion graph data/ttl/cabinet.ttl.txt

# Add an audit receipt to an instrument-deduplicated local ledger.
python3 -m companion audit data/scenes/cabinet.xml \
  --out source-audit.json --ledger evidence-ledger.json

# Verify the chain, optionally against a head and length saved elsewhere.
python3 -m companion verify evidence-ledger.json
```

The graph fingerprint uses an explicitly named project algorithm with a permutation budget. It is not RDFC-1.0 and fails closed when its bounds are exceeded. RDF graph equivalence is different from document equivalence and from datatype-value equivalence.

A guarded edit writes a separate file and requires an exact source hash:

```bash
python3 -m companion patch data/scenes/fault-F1.xml \
  --def Ruby --attribute diffuseColor \
  --expected-value '1.5 0.08 0.16' --value '0.82 0.08 0.16' \
  --expected-sha256 FULL_INPUT_SHA256 --out repaired-F1.x3d
```

Replace `FULL_INPUT_SHA256` with the input digest reported by the audit command or workbench. The edit resolves a unique DEF and an existing attribute. It preserves surrounding source bytes and a DOCTYPE when present, performs no external entity fetch, and reports a witness. It does **not** restore an absent DOCTYPE, inject DTD defaults, run XSD validation, or regenerate Turtle. Run those gates separately in a complete authoring pipeline.

Browser notebook exports can be independently checked with `node verify-notebook.js PATH_TO_NOTEBOOK.json`. This checks internal consistency, not authenticity or whether a recorded computation happened.

The ledger supports integrity checking. Authenticity requires an independently trusted identity or signature channel. Detecting truncation requires an expected head and length retained outside the edited ledger.

## Reproduce the automated checks

From the project root:

```bash
node --test tests/*.js
python3 -m unittest discover -s tests -p 'test_*.py'
```

The JavaScript checks use bundled engines and local inputs. Python checks cover the companion and source witnesses. Consult the package validation notes for the exact checks actually executed and their limitations. Historical receipt counts and timings do not represent these new runs.

## Evidence scope

The archive contains scene and Turtle variants, a browser ontology slice, shapes and rule files, layout data, historical receipts, and recorded session transcripts. It does not include every item referenced by those records. In particular, the full pinned ontology, upstream converter and schema environment, raw stdio session logs, original ledger files, and complete build toolchain may be absent.

The manifest distinguishes shipped bytes from source identities where those differ. A verified shipped hash establishes that available bytes match that expected value. It does not independently verify the missing upstream source or the transformation that produced the shipped copy.

This edition adds local computations while preserving the historical record. It does not publish the study, send findings, modify a remote repository, or claim that tool grounding improved an LLM without a controlled comparison.

## Standards status

Primary W3C sources were checked on 14 November 2026; the cited SHACL draft was rechecked on 16 November 2026. SHACL 1.2 Core is a **Working Draft dated 10 November 2026**; `sh:agentInstruction` is a non-validating annotation for natural-language guidance. It is not an executable constraint or permission grant, and support by the bundled engines is not assumed. RDFC-1.0 is a W3C Recommendation dated 21 May 2024. Exact source links and semantic explanations are in the field guide.

## Project map

| File or folder | Responsibility |
| --- | --- |
| `index.html`, `app.js` | Original three-strata learning experience and integration link |
| `engine.js`, `engine-worker.js`, `parity.js` | Local semantic jobs, worker protocol, and result comparison |
| `workbench.html` and its supporting scripts | Focused evidence experiments |
| `companion/` | Local source audits, guarded edits, graph fingerprints, and compact ledger |
| `data/` | Supplied variants, ontology slice, shapes, rules, layout, and historical receipts |
| `vendor/` | Bundled third-party browser assets with their existing licences |
| `tests/` | New semantic, witness, and companion regressions |
| `ONTOLOGY-FIELD-GUIDE.html` | Technical and practical learning guide |
| `STUDY-AUDIT.md` | Findings grounded in the supplied package |
| `serve.py` | Loopback-only read-only local server |

Third-party assets retain their licences. No new licence for the original study or application is implied by this enhancement.
