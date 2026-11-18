# Math Lab concept graph v3 (v1, v2 untouched)

v3 = v2 plus (1) Wikidata (CC0) Q-id cross-references for all 18 lessons and 25 OntoMathPro terms, and (2) a Russian-label check sheet that tests every cited Russian OntoMathPro label against Wikidata's own Russian and English labels.

| Number | Value | Instrument |
|---|---|---|
| Lessons with a Wikidata Q-id | 18 of 18 (15 exactMatch, 3 closeMatch: waves, refraction, probability) | wbsearchentities + wbgetentities, 18 Nov 2026 (tools/wd.py) |
| OntoMathPro terms cited with a Russian label | 50 (12 Russian-only) | private crawl, tools/xref.py |
| Wikidata agrees (ru label equal or en label equal to the reading) | 19 of 50 | xref.py |
| Search hit only / no cross-check | 7 / 24 | xref.py |
| Russian-only rows still needing a human | 4 (E1523, E2021, E2855, E2924) | xref.py |
| Links / terms / gaps | 90 / 88 / 26 (unchanged from v2) | build.py |
| Scene | valid, 0 errors; semantic 0 errors (127 info) | x3d_mcp fa5dccf |
| JSON-LD | 1,426 triples; 15 lesson-level skos:exactMatch to Wikidata | rdflib 7.6.0 |
| Browser | 18 lesson rows, 26 gap rows, 39 check rows, 0 console errors | headless Chromium (Playwright, SwiftShader), X_ITE 16.6.0, 1300x900, not timed |

Readings of the 12 Russian-only labels were made by a model. "agrees" means an independent Wikidata label matches; it does not make a Russian reader redundant for the 4 unchecked rows.
Wikidata was rate-limited (HTTP 429 text responses) so lookups ran at about 1 per 10 s with backoff; search hits are not ground truth.

Regenerate: `python3 -I tools/wd.py` (live), `python3 -I tools/xref.py --quarantine PRIVATE_DIR`, `python3 -I tools/build.py --gate PATH/x3d_mcp/src`, `node tools/smoke.js receipt-browser.json`.
Not tested: GPU/WebGPU, mobile; term definitions marked "not opened".
