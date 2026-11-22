# The Fault Lab v3

v2 measured that Blender's glTF exporter carries the scene's metadata, but only as plain `extras`. v3 adds the step that
turns those extras into meaning a tool can query: the Loom's extras lifter (x3d.loom `formats/gltf/semantic/blender_extras.py`).
v1 and v2 are kept unchanged; v3 reads v1's cases, stills, converted glTF/USD files and vendored Babylon.js from `../v1/`.

| Blender glTF, clean twin (3 trees, 6 Metadata nodes) | blender.glb (v2) | blender.lifted.glb (v3) |
|---|---|---|
| Metadata as KHR_xmp_json_ld packets | 0 of 6 nodes | 6 of 6 nodes, 3 of 3 trees (node, material, scene) |
| Numbers typed | no, `"9.62"` is text | yes, `9.62` is a JSON number (rule L4) |
| CIDOC-CRM class as a JSON-LD type | no | yes, 1 of 1 (rule L3) |
| "Which crm:E25 features are deeper than 9 m?" | 0 answers | 1 answer (OsirisShaftA, 9.62 m) |
| Rules L0 to L6 against the source X3D | not applicable | 7 of 7 pass |
| Binary chunk | reference | byte-identical |
| Khronos glTF-Validator 2.0.0-dev.3.10 | 0 errors, 0 warnings | 0 errors, 0 warnings (1 extra info: extension not known to the validator) |
| Babylon.js 9.32.0 load | 12 meshes | 12 meshes |
| Size | 25,180 bytes | 28,156 bytes |

Rig: lifter `loom-gltf blender_extras 0.1.0`, Python 3 stdlib; input from Blender 5.3.0 `bpy` wheel with x3d-blender-io
f68adbd; page test on headless Chromium 157, SwiftShader. Every other number on the page is v1's or v2's and is unchanged.

Limits: one scene measured. The extras do not record the material node type, so hosts are compared by kind. The add-on
does not keep a Metadata node that describes another Metadata node; the rules fail on that case. The lift is a separate
step after Blender's export. The Khronos validator checks nothing inside KHR_xmp_json_ld; rule L0 checks the structure.

Build: `python build/lift.py PATH/x3d.loom` writes `assets/blender/blender.lifted.glb` and `data/lift.json`.
Test: `node build/test_page.mjs`, 29 of 29 checks.
