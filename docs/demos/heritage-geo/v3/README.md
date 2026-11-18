# heritage-geo v3: atomic grades, Background fix

New version folder (v1 and v2 are untouched). Made after the external accountability review of 18 Nov 2026 (defect 6):
v2's page typed the elevation finding as **C** while its own data said "C numbers, S interpretation", and its Giza
scene carried a Background cardinality error (one `groundColor` with one `groundAngle`) that the v2 gate missed
because it ran XSD only.

What changed from v2:

| Change | Why | Where |
|---|---|---|
| Every grade on the page, in `claims.jsonld` and in the table below is generated from atomic records in `build.py` (`ATOMS`, `FINDINGS`) | One source of truth: the UI can no longer state a stronger grade than the data | `data/findings.json`, `claims.jsonld` |
| A finding that joins a measured number with an interpretation shows the **weakest** part's grade (C > L > S) | "Not a datum conflict" rests on an assumed tile centre (S), so the finding is S, with its C parts listed under it | page Findings table |
| `groundAngle` removed from the Giza `Background` | one ground colour needs zero angles | `giza-provenance-twin.x3d` line 11 |
| Gate runs XSD **and** x3d_mcp semantic checks through the shared `tools/assurance/validate_scenes.py`, exits non-zero on any error, and derives the validator commit instead of typing it | v2's gate hard-coded "fa5dccf" and ran XSD only | `validation-v3.json` |
| `check_grades.py` fails if the page types a grade literal, if a finding's grade is not the weakest of its parts, or if JSON-LD and JSON disagree | so the next edit cannot drift | run it after `build.py` |

## Findings (generated; do not edit by hand)

<!-- findings:begin -->
| Finding | Part | Grade | Instrument |
|---|---|---|---|
| **elevation** | Elevation 627 vs 617 m: measured residual near zero; the 'not a datum conflict' reading depends on an assumed tile centre. | **S** (weakest part) | |
| | Median of EPQS minus (617 + DSM) is +0.03 m over 140 points at 30 m spacing. | C | USGS EPQS 1 m, 18 Nov 2026; reconcile_elevation.py |
| | Ground across the 400 x 300 m tile spans 619.8 to 632.9 m in EPQS, so 627.175 m is one point on the slope. | C | USGS EPQS 1 m, 18 Nov 2026 |
| | The tile centre (37.2284, -80.4234) and z-southward orientation are assumptions (correlation 0.51 vs -0.40). | S | reconcile_elevation.py fit; not surveyed |
| | Therefore 627 vs 617 m is not a datum conflict: 617 m is the right reference for the DSM. | S | interpretation that rests on e1-e3 |
| **pleiades** | Correction: Khafre and Menkaure moved to their Pleiades points. | **C** (weakest part) | |
| | v1 put Khafre 208 m and Menkaure 64 m from their Pleiades points (typed from memory); v2 and v3 use the Pleiades points. | C | Pleiades dump 17 Nov 2026 |
| **ifc** | IFC model carries no placement; the placement here is authored. | **S** (weakest part) | |
| | The confluence-ifc model.ifc has no site placement and no IfcMapConversion. | C | grep of model.ifc (2,030 lines) |
| | The placement shown here is authored, not read from the file. | S | authored in build.py |
<!-- findings:end -->

Rebuild: `python3 -I reconcile_elevation.py` (network, about 8 minutes, unchanged from v2) then
`python3 -I build.py --gate <x3d_mcp checkout>` and `python3 -I check_grades.py`. Both exit non-zero on failure.

Licence: see NOTICE.md. Google Drillfield data: academic, non-commercial proof of concept only.
