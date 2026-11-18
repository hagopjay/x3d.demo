# medical-provenance v2: FMA, SNOMED CT ids and H-Anim names on a CT torso

Medical frontier (#2) for the Loom, 18 Nov 2026. **Educational proof of concept. Not medical advice, not a medical device.**
v2 adds FMA is-a ancestors (class filter and markers) and an in-page check of the running scene against the claims, with a tamper demo. v1 is untouched.
Reuses the torso and brain scenes of `../../brain-torso-xite/v1/` (no copy; textures are referenced there). Each organ Shape gets a `MetadataSet name="provenance"` (first child, per the XSD) carrying its FMA class, Uberon, Wikidata, SNOMED CT id, MeSH, H-Anim segment, BodyParts3D id, a grade and its claim ids. Every claim is also in `claims.jsonld` (same C/L/S grades as heritage-geo v1).

| Item | Value | Instrument |
|---|---|---|
| Structures | 121 (111 torso, 10 brain deep structures); 120 with an FMA class | FMA 5.1.0 via EBI OLS4 exact-label search, 117 of 117 labels resolved |
| SNOMED CT ids | 78 (ids only, via Uberon SCTID xref) | EBI OLS4 Uberon terms; not looked up in SNOMED |
| H-Anim names | 37 | 146 names parsed from x3d_mcp `x3d-4.1.xsd` |
| Open meshes known | 112 of 120 classes | BodyParts3D LATEST parts lists (meshes not downloaded) |
| Claims | 1033 (C 671, L 284, S 78) | `claims.json`, `claims.jsonld` |
| Validation | torso-fma.x3d and brain-fma.x3d valid, 0 errors; source scenes valid too | x3d_mcp `fa5dccf` `validate_xml` (`validation-v2.json`, sha256 bound) |
| Render | both tabs load, selection and filters work, 0 console errors, 0 failed requests, no horizontal scroll at 1280 and 390 px | Chromium (Playwright image) software GL, X_ITE 16.6.0; torso loaded in 6.2 s in that run; not a performance number |
| Network | 322 fetches logged with url, sha256, time | `data/ledger.json`; raw bodies in `data/cache/` so the build runs offline |

Rebuild: `python3 -I build.py --gate <x3d_mcp>/src` (offline from cache; `--refresh` re-fetches).

Findings (12, graded) are on the page and in `data/findings.json`. Open sources with licences: `data/open-sources.json`. Mapping proposals (built vs not built): `data/mapping.json`.

## Not done
No VolumeData or DICOM (nothing downloaded; TCIA reachable, 156 collections, licences per collection unread). No BodyParts3D meshes. No HAnimHumanoid with joints. No GPU, Firefox or Safari run. No anatomist review: C means checked by this build.
