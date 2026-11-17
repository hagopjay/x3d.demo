# x3d_mcp tool findings from the recorded LLM sessions

These findings come from five recorded MCP stdio sessions (S1 to S5) in which an LLM picked every call. They go back to the fork.

- Server: `hagopjay/x3d_mcp`, commit `7d3f1d5dca06cca9913f16cff6f88728c51df864`, branch `claude/project-thread-3ct7ww`. The tree was clean at the start and at the end.
- Software: mcp 1.30.0 (client and server), Python 3.13.18, rdflib 7.6.0, pyshacl 0.40.2, owlrl 7.6.2.
- Evidence: every finding names its raw log under `sessions/raw/`. "S3 call 16" means `raw/S3/16_call_*.json`. Grades: C = confirmed by a tool result or a repro; L = follows from one.
- Placeholders in the repro arguments:
  - `<cabinet>` stands for `sessions/inputs/cabinet.x3d` (sha256 `accb1cb6...`).
  - `<stranger>` stands for `sessions/inputs/stranger.x3d` (= fault-F5.x3d, sha256 `0777113c...`).

## Bugs

### F-01 (high, C): the forked query worker deadlocks under the stdio transport
- **Tools affected:** `sparql_scene`, `shacl_validate` and `rdf_infer` (rdfs / owl-rl). All of them go through `x3d_utils/ontology_guard.run_bounded`.
- **What happens:**
  - The worker is a `multiprocessing` fork child.
  - The child's bootstrap runs `multiprocessing.util._close_stdin()`, which calls `sys.stdin.close()`.
  - That close waits on the lock of `sys.stdin.buffer`. The lock is held by the stdio transport's reader thread, which sits blocked reading the next request.
  - The child hangs in `futex_wait` until the deadline. The answer is then `"query ran past 20 s and was stopped (X3D_MCP_SPARQL_TIMEOUT)"`.
- **Measured:**
  - Session S1 on the stock server: 9 of 15 `sparql_scene` calls timed out, costing 180.9 s (`raw/S1/calls.jsonl`).
  - The same queries take 0.02 to 0.08 s in-process.
  - Repeat runs with `X3D_MCP_SPARQL_TIMEOUT=4` and 0.5 s gaps: stock server 3 of 25 timed out, launcher shim 0 of 25 (`raw/debug/F01_repro_results.txt`).
  - Traceback of a hung child, taken with `python -X faulthandler` plus `SIGABRT`: `multiprocessing/util.py:486 _close_stdin` ← `process.py:299 _bootstrap` ← `ontology_guard.py:128 run_bounded` ← `semantic_web.py:351 sparql` (`raw/debug/faulthandler_child_traceback.log`).
  - `ps` during a hang: child state S, wchan `futex_do_wait`, 1 thread (`raw/debug/dbg.py`).
- **Repro:**
  1. Start `python src/server.py` over stdio.
  2. Call `scene_to_rdf(path=<cabinet>, return_mode="summary")`.
  3. Call `sparql_scene(graph_id=<id>, include_ontology=false, sparql="SELECT ?n WHERE { ?n a x3do:TimeSensor }")` repeatedly. Some calls time out.
  4. The scripts are `raw/debug/rep.py`, `rep_gap.py`, `rep_srv.py` and `tb.py`.
- **Why the tests miss it:** they call the functions in-process, so no reader thread exists.
- **Fix ideas:**
  - Around `proc.start()` in `run_bounded`, set `sys.stdin = None` and restore it afterwards. `_close_stdin` returns early when `sys.stdin` is None, and the transport keeps its own wrapper of the buffer.
  - Or fork with `os.fork()` / `os._exit()` instead of `multiprocessing.Process`.
  - Or use a forkserver started before any thread exists.
  - Add a stdio round-trip test that holds the session idle between calls.
- **How the sessions worked around it:** S1 after its 17th call and all of S2 to S5 ran the same tree through `sessions/driver/launch_server.py`. That launcher replaces `multiprocessing.util._close_stdin` with a no-op and changes nothing else.

### F-02 (medium, C): failures are not flagged as MCP errors
Every `{"ok": false, "error": ...}` answer arrives with `CallToolResult.isError = false`. That covers timeouts, refusals and the conversion errors seen. A client or LLM that branches on `isError` treats a failure as a result.
- **Repro:** any timeout in S1, for example S1 call 2: `is_error_flag` false, result text `ok:false`.

### F-03 (medium, C): `sparql_scene` discards ORDER BY and returns numbers as strings
- Rows are re-sorted by their JSON text so that pages are stable, so a query's own `ORDER BY` is silently dropped.
- Typed literals become strings, so a census comes back in text order: `"k":"11"` sorts before `"k":"2"` (S1 call 9).
- An LLM that asks for `ORDER BY DESC(?k)` and reads the first row gets the wrong answer.
- **Suggestion:** keep the query's order when it has ORDER BY (the page hash can be taken over that order), and return numbers as JSON numbers, or as `{value, datatype}`.

### F-04 (low, C): unbound variables and blank nodes are flattened
- **Unbound variables:** an unbound OPTIONAL variable is rendered as `""`, which looks the same as an empty-string literal (S1 call 11, `"def": ""`).
- **Blank nodes:** every blank node is rendered as `"_:blank"`. Rows look like duplicates and cannot be joined: S2 call 7 has 303 rows in all, and 93 of the first 100 read `{"range": "_:blank", ...}`.
- **Suggestion:** use JSON `null` for unbound variables and stable labels per answer (`_:b0`, `_:b1`) for blank nodes.

### F-05 (medium, C): `modify_x3d_node` re-serialises the whole document and drops the DOCTYPE
- **Measured:** 16 field changes on 5 Materials produced a 477-line text diff (S3 calls 5 to 9; `outputs/cabinet-glass-shelf.x3d`, sha256 `769d5356...`).
  - The DOCTYPE is removed.
  - Single quotes become double quotes.
  - Root attributes are re-ordered.
  - The element content is otherwise unchanged: 184 elements on both sides, only the 5 Materials differ.
- **Why it matters:** the Consortium Turtle pipeline reads the document with its DTD to get the containerField defaults. A document without its DOCTYPE no longer feeds that pipeline the same way, and a reviewer cannot see the real change in the diff.
- **Suggestion:** keep `docinfo.doctype` (`etree.tostring(..., doctype=...)`) and offer a minimal-edit mode that only rewrites the touched attributes. The hand-made minimal patch is 5 lines (`outputs/cabinet-glass-shelf.min.diff`) and gives identical material facts (page_sha256 `3bc565aa...` on both graphs, S3 calls 18 and 19).

### F-06 (medium, C): `shacl_validate` with inference cannot finish on a normal scene, and its timeout message is misleading
- **Measured:** `shacl_validate(graph_id=<stranger>, inference="rdfs")` stopped at 20 s on 1950 triples (S5 call 6, on the shim, so this is not F-01). The message was `query ran past 20 s ... (X3D_MCP_SPARQL_TIMEOUT)`, which talks about a query on a SHACL call. The tool has no `budget` argument. `rdf_infer` has one.
- **On a 3-node probe:** the same call took 12.3 s (S5 call 8).
- **Suggestion:** add `budget` as `rdf_infer` has, and give SHACL its own timeout message.

## Awkward for an LLM

### F-07 (low, C): `graph_id` names the text, not the graph
`graph_id` is the sha256 of the Turtle text, and that text follows attribute order. Two documents with identical facts can therefore get different ids: `d343fe31...` for the `modify_x3d_node` rewrite and `5709eb3d...` for the minimal patch, both 1973 triples (S3 calls 13 and 17).
- The tool's Turtle is also isomorphic to the lab's faithful `ttl/cabinet.ttl` but not byte-equal: the tool writes double-quoted literals, the stylesheet single-quoted ones. So the hash of the faithful file never equals `graph_sha256` (`raw/debug/isomorphism_cabinet.txt`: 1939 vs 1939 triples, isomorphic True, rdflib 7.6.0).
- **Suggestion:** also return a canonical graph hash, for example sorted N-Triples after canonicalising blank nodes.

### F-08 (medium, C; docs): the list example in the docs returns a set
The docs' "colour components" example `?m x3do:diffuseColor ?l . ?l rdf:rest*/rdf:first ?c` gives set semantics:
- Pearl's `(1 1 1)` comes back as one value, `1`.
- Component order is lost: Cobalt `0.12 0.28 0.95` read as `0.95 0.28 0.12` (S3 call 3).

A real LLM reads these as colours.
- **Suggestion:** warn in the docs and in the tool description. Show the fixed-length pattern (`rdf:first ?r ; rdf:rest/rdf:first ?g ; rdf:rest/rdf:rest/rdf:first ?b`, S3 call 18), or add a list-to-string helper.

### F-09 (low, C): results do not say where the offence is
- **SHACL S7:** `children-not-child-node` has `path: ""` and does not name the parent or the field. Finding the parent took one more query (S4 calls 4 and 5).
- **validate_semantic:** `containerfield-type-mismatch` says `Transform.children does not accept a Box` without the parent's DEF or a line number (S4 call 9). The XSD gave line 183.
- **Suggestion:** include the parent IRI or DEF, the `has<Field>` property and, where known, the source line.

### F-10 (low, C): user shapes get a mangled check_id and leave no trace in the instrument
- With `extra_shapes_ttl`, a user shape's `check_id` comes back as `//semantic-twin-lab.example/shapes#PrismIsGlass`, with the scheme stripped (S3 call 16).
- The `instrument.shapes` block still names only `x3d-core` and its hash. A receipt therefore does not record that extra shapes ran, or which ones.
- **Suggestion:** use the shape's local name, or the full IRI, for `check_id`, and add `extra_shapes_sha256` to the instrument.

### F-11 (low, C): `validate_semantic` summary mode
- **Not a summary:** `return_mode="summary"` returned all 114 findings, about 24 KB, 113 of them info-level `unused-def`. The one finding that mattered was buried (S3 call 12).
- **Ambiguous `ok`:** the summary says `"ok": true` next to `"errors": 1` (S4 call 9). `ok` means "the tool ran", but an LLM can read it as "the scene is clean".
- **Suggestion:** cap and sort the findings in summary mode (errors, then warnings, then a count of infos), and add `clean: errors == 0`.

### F-12 (low, C): `node_parents` does not say which release answered
`node_parents(ImageTexture)` returns 63 rows from the 4.0 release, the default, without saying so. `ontology_vs_gate` on 4.1 counts 85 pairs (S2 calls 1 and 3).
- **Suggestion:** add `ontology_version` and `instrument` to `node_parents`, `query_ontology` and `describe_ontology_term`, as the new tools have.

### F-13 (info, C): `ontology_vs_gate` could settle its inconclusive pairs
For ImageTexture, 4 gate pairs come back `I` (inconclusive). Live `validate_x3d` probes settle 3 of them as rejections (S2 calls 4 and 5):
- ComposedTexture3D.texture: "Missing child element(s). Expected is ( MovieTexture )".
- OpacityMapVolumeStyle.transferFunction and BlendedVolumeStyle.weightTransferFunction1: the value is not in ImageTexture's containerField enumeration in the 4.1 XSD.

These are the lab's own reproducible measurements on the shipped 4.1 schema, not a judgement on it.
- **Suggestion:** probe gate pairs that the table marks `I` too, within the 120-document budget, and return the XSD's reason. `validate_semantic` follows the X3DUOM gate and is silent on all of these (S2 call 6), so the tool is the right place to show where the two gates disagree.

### F-14 (low, C): the claims ledger is costly for an LLM
- **Cost:** the ledger travels as full text in every `claim_append` and `claims_verify` call. Each record embeds the whole instrument (730 bytes of about 1.1 to 1.4 KB per record). Over 31 appends, 573,213 bytes of ledger were sent and 611,364 returned (`ledger/claims.final.jsonl`).
- **Blobs do not help across sessions:** `store=true` keeps the ledger as a blob, but blobs expire after 3600 s (S3 call 4) and do not survive a server restart. A ledger that spans sessions has to be carried by the client.
- **Suggestion:** reference the instrument by hash (keep a dictionary of instruments), and under stdio allow `ledger_path=` to append to a file.

### F-15 (low, C): `serverInfo.version` is the SDK version
`serverInfo.version` is `1.30.0`, the mcp SDK version, not an x3d_mcp version or commit (`raw/S0/initialize.json`).
- **Suggestion:** pass `version=` to FastMCP.

### F-16 (low, privacy, C): summaries echo absolute local paths
The summaries of `validate_x3d` and `validate_semantic` echo the absolute local path in `"source": "file /..."` (S2 call 6, S3 call 20). A receipt built from these would carry the user's local paths, which on another machine could be a home directory.
- **Suggestion:** report the basename plus the input sha256.

## Could not do

- **F-17 (C): no rendering.** `render_image` needs Playwright, which is not installed in this server's environment (S3 call 23), so the "visible" rung was not checked by the server. The message is clear and points to `x3dom_page`.
- **F-06:** see above. SHACL with inference on a Cabinet-sized scene could not finish.

## Notes for the lab (not tool defects)

- **Fault F5 (C):** DESIGN.md says the ontology "allows" F5 through the pooled hasChildren range. Measured on Ontology 4.1:
  - The only named hasChildren range that subsumes Box is `x3do:X3DNode` (S4 call 11).
  - ontology_vs_gate's counting rule leaves X3DNode ranges out, so `ontology_vs_gate('Box')` lists no Transform parent: the map has 12 pairs and the gate 10, all geometry or picking slots (S4 call 10).
  - The pooled range that explains ImageTexture's 40-plus grouping parents is `x3do:X3DUrlObject`, the LoadSensor watch list (S2 call 8).
  - The station text should cite the X3DNode range for Box and the X3DUrlObject range for ImageTexture.
- **Laundering, measured (S5 calls 7 and 8, C):** on a 3-node probe (Box in Transform.children), SHACL gives:
  - with inference=none: 1 Violation (S7);
  - with inference=rdfs: 807 results (804 S6 Violations; 3 S2 Warnings that call the Box, the Transform and the Viewpoint Shapes), and no S7.

  The T3 "inference launders a violation" station can use this exact probe (`sessions/work/s5/box-in-transform.x3d`).
- **What worked well:**
  - `scene_to_rdf`'s Turtle is isomorphic to the faithful pipeline's `ttl/cabinet.ttl` (C).
  - The `rdf_infer` warning explains the explosion with the release's own counts.
  - `where_can_place` and `ontology_vs_gate` make the map-versus-gate story answerable in 3 calls.
  - The `semantic_audit` prompt's order of steps was followed end to end in S4.
