# The Fault Lab v2

v1 measured that Blender returned none of the scene's metadata. v2 is the same lab after that gap was closed in the
add-on (x3d-blender-io PR #70). v1 is kept unchanged; v2 reads v1's cases, stills, converted glTF/USD files and vendored
Babylon.js from `../v1/` and adds its own page, data and Blender outputs.

| Blender row (3 trees, 6 Metadata nodes) | v1, add-on 1040830 | v2, add-on f68adbd |
|---|---|---|
| Held in Blender after Import | 0 trees | 3 trees |
| Blender to X3D 4.0 | 0 of 6 nodes | 6 of 6, value for value (x3dsem); XSD valid, 0 semantic errors (x3d_mcp 8205047) |
| Blender to glTF (extras on) | 0 of 6 | 6 of 6 as plain extras, not KHR_xmp_json_ld packets |
| Blender to USD | 0 of 6 | 0 of 6 (the exporter skips nested custom properties) |

Rig: Blender 5.3.0 `bpy` wheel. Every other number on the page is v1's and is unchanged.

Page changes: the X_ITE canvas keeps its drawing buffer; a sixth headline number; the format table shows what each Blender
row read before.

Test: `node build/test_page.mjs`, 24 of 24 checks (headless Chromium 157, SwiftShader).

Correction to v1: its test server sent `x_ite.css` with the wrong content type, so X_ITE drew nothing in v1's test run and
the X_ITE panel in `v1/shots/02-two-materials.png` is black. The check passed because it counted the caption's text
colours. The v1 page itself is not affected on a server that sends `text/css` (GitHub Pages does). v2's test serves the
right type and counts colours only where the scene is drawn.
