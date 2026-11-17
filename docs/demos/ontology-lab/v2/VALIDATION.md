# Validation of the evidence edition

Completed on 16 November 2026. These checks concern this enhancement and the available inputs. They do not rerun the absent upstream MCP server, its complete source pipeline, or the original raw sessions.

## Automated checks actually run

| Check | Result |
| --- | --- |
| `node --test tests/*.js` | **117 Node subtests passed**, zero failures. |
| `python3 -m unittest discover -s tests -p 'test_*.py'` | **32 Python tests passed**, zero failures. |
| Shipped lesson jobs | 39 runnable jobs re-executed and compared with their recorded Python projections. |
| Try edits | 34 jobs re-executed; 33 compare equal, and T4.6 retains its documented engine disagreement and matches the recorded JavaScript behavior. |
| Query/parity regressions | Typed terms, large exact literals, blank co-reference, unbound values, ORDER BY, bag multiplicity, bounded results and local-only query policy covered. The parity wrapper also contains 24 explicit assertions. |
| Worker lifecycle | Hard deadline termination, cancellation, error propagation, and fresh-worker recovery covered. |
| Companion | Graph identity, source guards, XML witnesses, minimal edits, ledger integrity, and external-anchor status covered. |
| JavaScript and shell syntax | Root scripts and `start-lab.sh` checked. |
| Source patch | Checked with `git apply --check` against a separate extraction of the supplied ZIP. |
| Original manifest | All 58 named files retain their original expected byte hashes. |

## Browser checks actually performed

The new workbench ran in Chromium without WebGL. Desktop and a 390-pixel iframe viewport were inspected; the narrow document had no horizontal overflow. The list strip and evidence table retain their own intentional overflow where needed.

1. **F5 counterfactual:** on the selected supplied graph, the no-inference S7 result count is 1. The installed RDFS rule subset changes it to 0 while source edits remain 0. The subclass-only profile keeps the count at 1. Counts are for this installed scene/slice/rule combination, not a new measurement of the complete public ontology.
2. **Pearl list:** ordered traversal has three cells, plain SELECT produces three `1` solutions, and DISTINCT produces one value. Typed terms and the actual queries remain in the receipt.
3. **Integrity:** all 58 shipped manifest entries match; seven recorded source hashes differ from their published-copy hashes. No absent source or upstream execution is marked reproduced.
4. **F1 repair:** the source witness locates Ruby's diffuseColor at line 145 and byte span `[7576, 7589)`. A one-attribute edit replaces `1.5 0.08 0.16` with `0.85 0.08 0.16`. S1 changes from one result to zero when those same RGB values are explicitly applied to the existing RDF list.
5. **Exports:** notebook and repaired X3D downloaded successfully. Downloaded repair bytes matched exactly the expected one-value replacement. Every receipt digest and the notebook digest were independently verified.
6. **Original 3D integration:** the Cabinet and its twin/ontology strata rendered in native Chromium using software rendering with the bundled X_ITE 16.5.1. Running T3.4 reported one live result equal to the recorded oracle and displayed the correct F5 violation callout. This is a startup/functional observation, not a GPU benchmark.
7. **Guide:** rendered and local/internal links checked.

A fresh four-experiment browser notebook is included at `evidence/browser-workbench-notebook.json`. It records current code/input hashes and execution scopes. Verify it with:

```bash
node verify-notebook.js evidence/browser-workbench-notebook.json
```

The verifier checks JSON integrity. It does not authenticate its author or rerun the computations. The record is not a signature or a completeness anchor.

## Source and representation limits

- The browser's Ruby edit is deliberately scoped to the supplied fixture. The Python companion supplies the more general tested source-edit primitive. Neither is a complete X3D validator or XML-to-RDF converter.
- The F1 browser check updates an existing RDF colour list explicitly; it is **not independent source-to-RDF regeneration**. The packaged XML fixture has no DOCTYPE. Separate synthetic tests verify that a present DOCTYPE and surrounding bytes are retained.
- The new reasoning comparison uses the installed N3 rule subset and ontology slice. It is not a complete RDFS/OWL conformance test. Asserted source stores remain unchanged.
- The graph fingerprint algorithm is `semantic-twin-graph-c14n/v1`, with a stated permutation budget. It is **not RDFC-1.0**. Source/XML and Turtle audits are independent: `correspondence_verified` remains false.
- The original tool findings describe recorded upstream behavior. No upstream source was patched, no live MCP account was accessed, and no controlled LLM improvement trial was run.
- The complete pinned ontology, XSLT/DTD/schema environment, raw session logs and original ledger are not all included. A quoted historic digest does not make those bytes available.
- The Windows batch launcher was inspected, not executed on Windows. Use the shell launcher in WSL or run `py -3 serve.py` in Windows with Python installed.

## Study corrections

Eight exact editorial overlays are applied in memory after checking the original station file hash and each original text value. This keeps the original station and receipt bytes intact. They clarify the placement-map counting rule, SHACL 1.2 draft status, MCP discovery, evidence scope, and list/SELECT distinctions. See `data/study-corrections.json` and `STUDY-AUDIT.md`.
