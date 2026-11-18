# Math Lab concept graph v2 (Demo 47 lineage; v1 left untouched)

v2 re-runs the scout against a FULL private crawl (bilingual OntoMathPro, all 206 OpenMath CDs, OEIS names, 2,974 arXiv papers, 562 PhySH concepts) and publishes only derived ids, grades, counts and short labels. The crawl itself is quarantined outside every repo.

| Number | v1 | v2 | Instrument |
|---|---|---|---|
| Links (C / L / S) | 69 (33/29/7) | 90 (40/39/11) | tools/build.py over tools/mapping.py |
| Distinct terms verified live | 67 | 88 | tools/scout.py, 18 Nov 2026 |
| Confirmed gaps | 27 | 26 | regex over en+ru labels / 1537 OpenMath symbols / MathML ch.4 / 544 PhySH labels |
| Lessons with an OntoMathPro link / with a C link | 16 / 11 | 18 / 14 | coverage.json |
| Lessons with a C link: OpenMath / MathML / PhySH / OEIS | 6 / 6 / 1 / - | 6 / 6 / 1 / 0 (OEIS: 1 lesson, L) | coverage.json |
| Scene | valid, 0 errors | valid, 0 errors; semantic 0 errors (127 info unused-DEF) | x3d_mcp fa5dccf `validate_xml` and `validation.semantic` |
| JSON-LD | 895 triples | 1,363 triples | rdflib 7.6.0 |
| Browser | 0 console errors | 0 console errors, 18 lesson rows, 26 gap rows | headless Chromium (Playwright, SwiftShader), X_ITE 16.6.0, 1300x900, not timed |

## What changed and why (ERRATA-v1.md)
v1 read one label per OntoMathPro class. The full crawl has 2,717 English and 3,434 Russian labels (731 Russian-only). Fixes: waves/OntoMathPro gap refuted (E1931 Oscillation equation); vector_field now maps to E246 (v1 graded a weaker E2698); integral maps to E2865 Riemann integral; Lagrange multiplier E2722 and Bayes formula E2000 found; false friends recorded as S (E1520 wavelet, E1041 Fermat number, E1523). Added: OEIS (Pascal, central binomial), arXiv title-hit counts per lesson, skos:broader chains for OntoMathPro terms.

Regenerate: `python3 -I tools/scout.py --quarantine PRIVATE_DIR` (live; needs the private crawl) then `python3 -I tools/build.py --gate PATH/x3d_mcp/src`; browser check `node tools/smoke.js receipt-browser.json`.

Not tested: GPU/WebGPU, mobile; definitions of terms marked "definition not opened"; Russian labels read by a model, not a Russian reader; the arXiv counts are title-only regex over a 3-category window (crude).
