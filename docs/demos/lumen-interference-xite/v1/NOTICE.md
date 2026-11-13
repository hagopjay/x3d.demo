# LUMEN Interference, X3D port: sources and checks

**What it is.** An X3D 4.0 (Immersive + Shape level 2) port of the "LUMEN Interference Atelier" by HagopJay (analytic two-source interference sheet; the atelier's WebGL2 page and Blender scene are the originals and are not redistributed here). `build_x3d.py` writes `lumen-interference.x3d`; the sheet mesh and colours are baked at the chosen recipe so any X3D viewer shows it, and a Script node recomputes the same field live in X_ITE.

**Formula (shared with the atelier's field.py).** h = 0.8 + A[sin(k r1 - phase) + b sin(k r2 - phase + offset)] exp(-g (x^2+y^2)/36), k = 2 pi / wavelength, r1,2 = distance to the sources at x = -/+ d/2.

**Checks (Confirmed, run 13 Nov 2026).**
| Check | Result | Tool |
|---|---|---|
| X3D schema + semantic + profile | XSD valid, 0 errors / 0 warnings, profile ok (`validation.json`) | x3d_mcp validator, fork commit acdf5c4 (integration/validator-fixes) |
| Live Script drive | phase advanced 2.82 -> 3.60 rad in 1 s at speed 0.7, 10,000 points updated | X_ITE 16.6.0, headless Chromium, SwiftShader software GL |
| Frame rate | 2.6 to 6.3 fps in that software-GL run; not a measure of real GPUs | same |
| Blender reference render | Cycles CPU, 48 samples, 1280x853, 52.6 s | Blender 5.3.0 (bpy wheel) opening the file saved by 4.3 |

**Not ported (Confirmed absent):** elevation contours, sampling-grid and cut-away toggles, point inspector, the shader's exact lighting. Pixel equality with the atelier or Blender is not claimed.

**Caught by the validator while building:** a malformed `diffuseColor` (one number) and a missing `<component name="Shape" level="2"/>` for PhysicalMaterial. Both fixed before the page worked.

X_ITE 16.6.0 is bundled under `vendor/x_ite/` (own LICENSE.md). No network requests.
