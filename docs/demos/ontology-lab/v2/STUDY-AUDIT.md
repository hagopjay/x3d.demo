# Semantic Twin Lab study audit

The supplied lab already has a strong experimental structure: a pinned scene, an RDF twin, editable queries and shapes, deliberate faults, independently computed expected answers, and disclosed engine disagreements. The next advance should make evidence scope as visible as the scene. A checked file hash, a replayed result, a fresh browser run, and a rerun of the complete source pipeline support different claims.

This audit concerns the supplied `Semantic Twin Lab.zip` and its companion design study and tool findings. It preserves historical receipts. It does not certify the current external `x3d_mcp` repository or repeat its recorded stdio sessions.

## What the supplied bytes establish

| Observation | Evidence inspected | Interpretation |
| --- | --- | --- |
| 38 stations are shipped. | `data/stations.json` → `stations` | The design document's approximately 28 stations was a plan, not the final inventory. |
| Every one of the 58 files listed by the original manifest exists and matches its listed published SHA-256. | Recomputed each `data/manifest.json` → `files[*].sha256` | File integrity against the shipped manifest passes. This does not authenticate the author or rerun the experiments. |
| Seven manifest entries have different published and source hashes. | `stations`, `parity`, `validation`, `mcp-calls`, `make_all`, `fork-facts`, `transcripts` | The manifest's statement that all files are equal byte copies is false. The differing hashes are recorded, so this is a provenance-description issue, not unexplained hash corruption. |
| X_ITE is 16.5.1. | Bundled JS header and manifest hash | This agrees with this study's pin. Other projects' X_ITE versions must not be substituted into its historical evidence. |
| Browser RDF stack metadata matches the supplied bundle. | `vendor/lab-stack.json` and `vendor/lab-stack.js` | N3 2.13.12, Comunica 5.4.1 and shacl-engine 1.1.3 are the relevant bundled versions. The bundle also documents a local shacl-engine query-engine reuse patch. |
| Historical parity contains qualified outcomes. | `data/receipts/parity.json` → `summary` | 162 jobs: 143 equal, 11 expected differences, 8 Python-only. Station Python/JS parity: 35 equal, 1 explained difference, 2 not applicable. Do not summarize this as universal three-engine equality. |
| The third SHACL engine did not run every full shapes graph. | `parity.json` → `shacl_three_engines` | Of 38 full cases, rdf-validate-shacl refused 27; the 27 reduced Core-only cases matched. Full and reduced cases must remain separately labelled. |
| Recorded session caveats are already substantive. | `data/sessions/transcripts.json` → `caveats` | Keep the shim, partly blind S4, omitted diagnostic calls, path shortening, and absence of a bare-versus-grounded trial visible. |

The manifest covers published content and selected vendor assets; it is not a complete integrity inventory of every executable root file. The updated package should inventory its own new sources separately without changing historical hashes to make old receipts appear fresh.

## The most useful semantic distinction

Two superficially conflicting observations are both true:

1. **Placement-map matching asks which existing class hierarchy matches a property's range.** In the supplied slice, Box has the named superclasses `Box`, `X3DGeometryNode`, and `X3DNode`. The only named `hasChildren` range among them is `X3DNode`. The T4.5 query deliberately excludes that generic range, so its Box map does not contain Transform.children. ImageTexture is a different case: its `X3DUrlObject` ancestry matches another pooled range.
2. **RDFS entailment types an object after a property is used.** `hasChildren` also declares `X3DChildNode` as a range. Once the illegal Box is the object of a `hasChildren` triple, range entailment adds that type regardless of its original hierarchy. S7 can therefore stop detecting it after entailment.

I reproduced both observations locally with the shipped N3 parser, store and reasoner, `slice.ttl.txt`, `fault-F5.ttl.txt`, and `rdfs.n3.txt`. The F5 Box begins with Box and owl:NamedIndividual types; after the shipped rules it has X3DChildNode among the derived types. This confirms T3.4's main causal explanation. The correction in TOOL-FINDINGS about X3DNode applies to inverse placement-map matching, not to the range-entailment rule. Changing T3.4 to an indirect-domain-only explanation would introduce an error.

The study should show these as two adjacent experiments. One reads a schema-like map; the other changes the facts a validator sees. That difference explains why a map can exclude a placement while inference still hides its violation.

## Keep SHACL sets and SPARQL result multiplicity distinct

T1.7 already uses fixed list positions to read RGB, and T4.3 explicitly teaches SHACL value-node set semantics. Those are correct. Do not generalize the recorded server observation in TOOL-FINDINGS F-08 into a claim that every plain SPARQL SELECT discards repeated component bindings. The engine review for this edition measured the bundled Comunica query returning Pearl’s value 1 three times; DISTINCT collapses those projected bindings. The shared problem is that a member-value table alone does not identify RGB positions. Preserve the historically recorded server result and the current browser result with their separate instruments.

## Corrections and qualifications

| Location | Issue | Recommended presentation |
| --- | --- | --- |
| T3.1 | “Small, safe and predictable” can imply a universal safety guarantee. | Subclass closure excludes domain/range rules and is smaller on this pinned hierarchy. Incorrect asserted types still propagate. |
| T3.4 | A disappearing S7 finding can be mistaken for whole-report conformance or repair. | Say exactly which check disappeared. Preserve the original XML and report separately; additional shapes may still fail. |
| T4.5 | The story omits the query's explicit exclusion of `X3DNode`. | Display the complete counting rule: named range, matching superclass, generic X3DNode excluded, union expressions not expanded. Call the result a candidate map rather than an authorization. |
| T4.6 and T5.7 | “Editors' draft” understates the present publication status. | As checked 14 November 2026, SHACL 1.2 Core is a W3C Working Draft dated 10 November 2026. It remains a draft, not a Recommendation. Pin the dated document. |
| T5.1 | “An LLM meets an MCP server through its tool list and nothing else” is too strong. | Tools, prompts, resources, client instructions and prior context all affect the information available to a model. Compare tool lists without treating them as its entire context. |
| T5.8 | “Every verdict carries” an instrument conflicts with TOOL-FINDINGS F-12 and can blur live versus recorded results. | Require an instrument for a reproducible verdict; display whether one is present. Describe legacy omissions rather than retroactively filling them with a newer pin. |
| T2.2 and T5.6 | The weighted stored colour components can be read as measured scene luminance. | Call Y a weighted diffuse-colour score or luminance proxy. It excludes lighting, emission, exposure, material response and camera presentation. |
| T4.8 | Passing checks is stated as saying “nothing” about visibility. | Passing the selected checks does not guarantee visibility from the active viewpoint. A render test needs a stated camera, dimensions and observation rule. |

SHACL 1.2's `sh:agentInstruction` is a non-validating annotation. The draft can guide an agent-facing workflow, but the text itself does not implement a validator or grant authority to execute external actions. Keep the formal constraint and the instructional sentence separately inspectable.

## Evidence that cannot be independently reconstructed from this ZIP

The archive contains the browser app, the teaching ontology slice, data, and receipts. It does not contain the full pinned ontology, XSLT, DTD set, XSD/X3DUOM validators, external server source, original raw session logs, complete claims ledger, or the original `build/make_all.py` pipeline.

Consequently:

- A learner can rerun the browser's local query, reasoning and supported shape jobs against the shipped graphs.
- A learner can verify hashes of included files against the published-copy manifest.
- A learner cannot rerun the original complete Python/Saxon pipeline or original stdio transport experiment from this archive alone.
- The historical ledger head and “claims_verify passed” result are recorded evidence. The complete original hash chain cannot be recomputed without its records.
- Recorded result hashes often cover raw payloads, while the archive presents excerpts and path-shortened published copies. Hashing an excerpt does not verify the original payload hash.
- Recorded XML session inputs have hashes different from the shipped XML teaching scenes. For example, recorded cabinet XML is `accb1cb6…`, shipped cabinet XML is `0fbaac5a…`; recorded fault F5 is `0777113c…`, shipped F5 is `9dbe2e8b…`. The faithful Cabinet Turtle hash does match. Keep the source identities distinct; matching scene names do not prove matching bytes.

A useful evidence badge should therefore have states such as **computed here**, **included and hash checked**, **historically recorded**, **explained difference**, and **source not packaged**. “Confirmed” alone is insufficient.

## Practical development priorities

1. **Preserve asserted and inferred graphs separately.** Keep source triples immutable. Store a derived graph with the rule-set hash and the input identity. Run validation on explicitly selected graph roles and compare check signatures, not merely total finding counts.
2. **Separate three identities.** A text hash identifies bytes; a canonical graph hash identifies graph structure up to blank-node renaming; a source witness identifies a location in a particular document version. None can replace the other two.
3. **Make repairs inspectable.** A minimal attribute patch should name the expected source hash, target, old value, proposed value and post-edit checks. Preserve the DOCTYPE and lexical layout where possible. A stale hash should stop the patch.
4. **Treat result data as RDF terms.** Preserve datatype, language tag, blank-node identity and unbound status. An abbreviated table can be a view of structured terms; it should not be the only retained answer.
5. **Treat disagreements as a corpus.** Pin graph roles, constraint coverage and transformation adapters. A reduced Core-only test is a different case from the original full shapes graph. Use exact examples as regression witnesses.
6. **Package the reproduction boundary.** Ship a local audit command for included bytes, an inventory of unavailable dependencies, and commands that fail clearly when an external tool is missing. Avoid a “rebuild everything” button that silently reuses historical output.

## A more revealing learner journey

Begin with one witnessed node, such as Pearl. Read its three colour-list cells in order, including repeated values. Compare byte identity with graph identity after harmless serialization changes. Next, insert an unnamed node and observe positional-IRI movement while a source hash invalidates the old locator.

Then move to F5: predict the raw S7 report, materialize a separate inference layer, and inspect the exact `hasChildren` range witness that changes the verdict. Follow with a minimal source repair and rerun the raw-data checks. Finally, build an agent-facing contract that carries a bounded query, supported constraint subset, expected source identity, and a compact evidence record. The capstone asks the learner to explain what was observed, what was inferred, what was repaired, and which claims still depend on unavailable historical evidence.

## Primary specification check

Checked 14 November 2026: [SHACL 1.2 Core Working Draft 10 November 2026](https://www.w3.org/TR/2026/WD-shacl12-core-20261110/) identifies itself as a Working Draft, includes `sh:agentInstruction` under non-validating shape characteristics, and discusses `subClassOfInShapesGraph` as a parameter for consulting shape-graph subclass triples in addition to data-graph triples. This does not make the bundled SHACL 1.0-era engines conformant implementations of every SHACL 1.2 feature.
