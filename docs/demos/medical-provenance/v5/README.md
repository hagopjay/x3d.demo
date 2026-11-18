# medical-provenance v5: open BodyParts3D meshes vs the CT surfaces

Educational proof of concept. Not medical advice. Fourth step of the medical frontier (v3 claims, v4 H-Anim skeleton).

For 100 of the 110 torso shapes that have an FMA class (v3), the matching open BodyParts3D mesh (merged from its element files) is fitted into the CT frame and compared with the CT surface. The page overlays both, ranks the 100 structures by mean surface distance and highlights a chosen structure.

| Item | Value | Instrument |
|---|---|---|
| Meshes | 100 structures, 998 element files, 2,222,680 source faces, shipped as 148,060 (decimated by vertex clustering) | `build.py`, BodyParts3D `partof_BP3D_4.0_obj_99.zip` sha256 `9fbc713f...` (pinned, not committed) |
| Frame | CT = (-x, z, y) of BodyParts3D; read from kidney and sternum sides | build log; an automatic 48-permutation search chose wrongly (finding 2) |
| Fit | scale 0.9397, rotation 10.6 deg, 67 of 84 trunk structures in the last round | Umeyama similarity fit, 6 robust rounds (`data/fit.json`) |
| Agreement | close (under 15 mm) 27, partial 56, far 17; spine median 10.8 mm, best C4 5.0 mm | 2,500-point mean nearest-vertex distance both ways, seed 7 (`data/metrics.json`) |
| Scenes valid | overlay and compare scene, 0 errors | x3d_mcp `fa5dccf` `validate_xml` (`validation-v5.json`) |
| Render | loads (9 s in that run, not a benchmark), 100 rows, highlight and CT toggle run, 0 console errors, no horizontal scroll at 1280 px | Chromium (Playwright image) software GL, X_ITE 16.6.0 |

Licence: BodyParts3D file headers say CC BY-SA 2.1 Japan, the current licence page says CC BY 4.0; the derived mesh file is treated as share-alike. See `NOTICE-BP3D.md`. Not tested: other browsers, GPU, per-bone fit with the v4 joints.

Rebuild: `python3 -I build.py --gate <x3d_mcp>/src [--zip PATH]` (downloads and checks the zip, needs numpy).
