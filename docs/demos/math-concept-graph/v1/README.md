# Math Lab concept graph v1 (candidate demo 47-49; number confirmed at card time)

18 x3d.mathslab lessons linked to OntoMathPro, OpenMath, MathML 3 content and PhySH terms. Every link is a graded claim (C Confirmed, L Likely, S Suspected) and every gap is a Confirmed negative with the regex that was run.

| Number | Value | Instrument |
|---|---|---|
| Lessons / links / distinct terms / gaps | 18 / 69 / 67 / 27 | tools/build.py over tools/mapping.py |
| Links by grade | 33 C, 29 L, 7 S | same |
| Cited terms verified live | 67 of 67 | tools/scout.py, 18 Nov 2026, build container |
| Gap searches that found nothing | 27 of 27 | scout.py regex over 3450 OMP labels, 1537 OpenMath symbols, MathML ch.4 text, 544 PhySH labels |
| Lessons with at least one C link | OMP 11, OpenMath 6, MathML 6, PhySH 1 (of 18) | coverage.json |
| Scene validity | valid, 0 errors | x3d_mcp fa5dccf `validate_xml` (XSD 4.0) |
| Semantic check | 0 errors after fix (18 had missing containerField="metadata"); 106 info unused-DEF | x3d_mcp fa5dccf `validation.semantic` |
| JSON-LD | 895 triples parse; SPARQL group-by-grade works | rdflib 7.6.0 |
| Browser | 18 lesson rows, 27 gap rows, S-link toggle works, 0 console errors | headless Chromium (Playwright, SwiftShader software GL), X_ITE 16.6.0, 1300x900; not timed |

Regenerate: `python3 -I tools/scout.py` (live, needs network) then `python3 -I tools/build.py --gate PATH/x3d_mcp/src`; browser check `node tools/smoke.js receipt-browser.json`.

Not tested: no WebGPU or GPU rendering; no mobile; no X_ITE other than 16.6.0; PhySH ids resolve by doi.org but that was not fetched; definitions of terms marked "definition not opened" were not read; Russian-only labels were read by a model, not a Russian reader.
