# The Fault Lab v1

Ten mistakes planted in one heritage twin (an X3D scene joined to a CIDOC-CRM record), one edit each. Every checker is asked
before and after the ontology review fixes, and each faulty scene is carried to glTF and USD to see what the downstream tools say.

| Measured | Result | Instrument |
|---|---|---|
| Faults caught before the fixes | 1 of 10 | x3d_mcp 39c6e94, pyshacl 0.40.2, rdflib 7.6.0 |
| Faults caught after the fixes | 9 of 10, clean twin 0 findings | x3d_mcp 8205047 (strict twin shapes) |
| Still missed | Giza latitude/longitude swap (both numbers legal) | stated limit of `geo-coordinate-range` |
| Faulty files flagged downstream | 0 of 7 | Khronos glTF-Validator 2.0.0-dev.3.10; pxr.UsdValidation, 30 validators, usd-core 26.11 |
| Faults erased by conversion | glTF 4 of 7, USD 3 of 7 | loom-gltf x3dsem 0.1.0; this demo's `build/x3d_usd.py` |
| Faults that change no pixel | 5 of 10 (2 scene, 3 record) | X_ITE 16.7.1, headless Chromium 157, SwiftShader; control 0 pixels |
| Metadata trees arriving (3 trees, 6 nodes) | glTF 1 tree / 4 nodes; USD 3 / 6; Blender 0 / 0 | x3dsem rules S1, S2; x3d_usd read-back; Blender 5.3.0 + x3d-blender-io 1040830 |
| Page test | 22 of 22 checks | `build/test_page.mjs`, headless Chromium 157, SwiftShader |

Grades: every row is Confirmed on the rig named. The faults are planted by us, so the catch rate describes these kinds of
mistake, not real-world files.

## Rebuild

    python build/cases.py        PATH/x3d_mcp
    python build/run_checks.py   PATH/x3d_mcp_at_39c6e94 before
    python build/run_checks.py   PATH/x3d_mcp after --strict
    python build/carry.py        PATH/x3d.loom WORK
    python build/x3d_usd.py      cases/clean.x3d assets/usd/clean.usda data/usd-semantic.json PATH/x3d.loom
    <python with bpy> build/blender_leg.py PATH/x3d-blender-io/source cases/clean.x3d OUT
    node   build/render.mjs
    node   build/test_page.mjs

## Notes

- X_ITE keeps the second of two materials (the pasted red one). glTF and USD conversion keep the first, so the same faulty
  file looks different in each tool and neither converted file can be told from the clean one.
- gfx-guard-v3 treats the browser notice "ResizeObserver loop completed with undelivered notifications" as a start-up
  failure. The page stops that one message before the guard sees it.
- Reading an X_ITE canvas with drawImage clears its undrawn buffer; the test counts colours from a screenshot.
- Vendored: Babylon.js 9.32.0 and its glTF 2 loader (Apache-2.0). X_ITE 16.7.1 is read from `blenderizer-nexus/v1`.
