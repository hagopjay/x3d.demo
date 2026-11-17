# Integrating the findings into x3d_mcp

This package contains a local reference implementation and reproducible teaching experiments. The upstream server source, raw stdio session logs, complete schemas, and full ontology are not in the supplied archive. None of the following work has been pushed, merged, or represented as an upstream fix.

## The first bounded increment

Make a tool answer preserve its meaning before expanding the tool list. Start with typed RDF results, operation status, and a versioned evidence contract. Keep the source bytes, semantic graph, validation profile, and instrument as separate identities.

| Finding from TOOL-FINDINGS | Local evidence or implementation | Upstream increment and completion test |
| --- | --- | --- |
| F01 forked stdio worker hangs | Historical report retained; raw transport repro is not packaged. The browser uses a terminating worker watchdog. | Reproduce through the real stdio transport with an idle reader, choose an explicit process lifecycle, and test repeated successful queries plus enforced deadline cleanup. Do not ship the historical monkeypatch as an unqualified permanent fix. |
| F02 failure lacks MCP error flag | Local operations reject on execution failure; scene findings remain successful computations with explicit counts. | Separate transport/tool failure from `clean`/`conforms`; assert both flags at the protocol boundary. |
| F03 query order and literal types | Engine retains ORDER BY and adds structured RDF terms. Tests include 2 versus 11 and large exact literals. | Retain query sequence; preserve datatype, lexical value, language, and unbound values. Define pagination over the retained sequence. |
| F04 blank and unbound flattening | Answer-local blank labels retain co-reference; unbound is distinct from empty text. | Compare typed result graphs with consistent blank-node renaming, not one shared placeholder. |
| F05 global XML rewrite | Companion performs guarded, byte-preserving attribute edits. | Require source hash plus a unique source locator; preserve untouched bytes and DOCTYPE when present. Refuse stale or ambiguous edits. |
| F06 expensive inferred SHACL | Browser profile, scope, budgets and cancellation are explicit. | Add an operation-specific budget and diagnostic; test SHACL deadlines separately from SPARQL and distinguish timeout from nonconformance. |
| F07 text hash versus graph hash | Companion returns both, with an explicitly bounded project algorithm. | Retain the original byte digest. Add an algorithm-labelled semantic identity; adopt RDFC-1.0 only through an actual conformant implementation and test suite. |
| F08 list example | New local query shows SELECT bag multiplicity, DISTINCT collapse, and ordered traversal separately. | Fix documentation with a positional query and an explicit multiplicity contract. Reproduce the recorded server observation before attributing its flattening to SPARQL itself. |
| F09 no source location | Companion witnesses carry exact source hash, byte span, line, path and related witness. | Include parent/field/DEF and a hash-bound source locator where available. Do not invent an XML location for every inferred triple. |
| F10 extra shapes absent from instrument | Workbench S1/S7 receipts hash the exact shapes text. | Include extra shape digests and preserve full shape identity or an explicitly defined local identifier. |
| F11 execution success confused with clean | Companion distinguishes successful audit execution from source findings. | Introduce `clean`, severity counts, and bounded error-first summaries; keep full findings separately retrievable. |
| F12 missing release identity | Receipts identify the installed slice and engine code; historical pins remain historical. | Apply one instrument contract consistently to ontology and scene tools. |
| F13 inconclusive placement pairs | Study separates candidate maps, entailment and validators. | Probe inconclusive pairs through the pinned XSD within a stated corpus/budget. Report the actual gate response, including uncertainty. |
| F14 repeated full ledger | Companion deduplicates instruments and supports an external head/length anchor. | Add durable local ledger storage with bounded reads and an explicit retention model; verify truncation against an independently retained anchor. |
| F15 SDK version mistaken for server version | Companion has an explicit implementation version. | Return application version and commit separately from SDK version. |
| F16 absolute local paths in receipts | Companion output uses source basename and hash. | Test summaries and exported receipts for unwanted machine-specific path exposure. |
| F17 render verification unavailable | A visible result is a separate rung; semantic success does not imply a render. | Add an optional pinned render runner and record actual execution, browser/GPU, camera and output digest. Leave it unrun when unavailable. |

## A verdict contract

A useful response has separate fields for whether the operation executed, whether the checked policy passed, and what evidence produced the answer:

```json
{
  "schema": "proposed-semantic-verdict/v1",
  "execution": {"status": "completed", "operation": "shacl"},
  "policy": {"profile": "asserted-data", "shape_set": "S7", "conforms": false},
  "inputs": {"source_sha256": "...", "graph_hash": {"algorithm": "...", "value": "..."}},
  "instrument_id": "sha256:...",
  "findings": [{"severity": "Violation", "focus": "...", "source_witness": null}],
  "scope": {"xsd_rerun": false, "render_rerun": false}
}
```

This is a proposal, not a declaration that an upstream endpoint already implements it. Execution failure must not be encoded as a clean scene. A policy that tests only S7 must not imply that other constraints, lexical order, or rendering were checked.

## The strongest new regression witness

The supplied Cabinet and F6 Turtle graphs have the same bounded graph fingerprint. The two XML sources have different hashes; the lexical source audit detects the forward USE in F6. Both observations are correct because they inspect different representations. A graph-only validator cannot recover ordering that the mapping discarded.

This suggests a practical authoring architecture: retain an immutable source witness index beside the semantic projection, keep inferred facts in a separate derived layer, and require a repair to name which source bytes it changes. Reproject and rerun the relevant gates after the edit. A type inferred from an invalid placement is not a placement repair.

## Creative next increment

Link a SHACL focus node to its actual XML opening tag and the corresponding object in the 3D Cabinet. Add a toggle for asserted and derived types with a derivation witness and an explicit rule profile. Preserve the original source-order witness beside the graph. Measure learning or agent improvement only after defining a controlled comparison, a task corpus, and independent correctness criteria.
