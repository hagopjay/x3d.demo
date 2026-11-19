# Pyramid Observatory v2

A dense, interactive successor to Great Pyramid Numbers. The archived v1 remains untouched. Native X3D geometry is coupled to analytical SVG instruments; no three.js, raster substitute for the interactive scene, remote assets or API key is required.

## Run

From the repository root, with Python 3 installed:

```bash
python -m http.server 8000 --directory docs
```

Open `http://localhost:8000/demos/blender-giza-numbers/v2/` in a WebGL2-capable browser. Windows with WSL works: start the server in WSL and open that address in Windows Chrome or Edge. A direct `file://` opening cannot fetch modules and receipts reliably; serve over HTTP.

The downloadable review bundle includes `START-WINDOWS.bat` and `serve.py`; run either from its unpacked folder. It contains the shared local X_ITE runtime, its licenses and fonts, and the original v1 reference assets.

## What changed

| Area | v2 behavior |
|---|---|
| Startup | Waits for custom element registration and X_ITE readiness before obtaining the browser; bounded timeouts and a visible analytical fallback. |
| Graphics | Limestone base/normal textures, illustrative 203 course bands, masonry joints, terrain, compass, dimensional guides, scale references, and eight authored cameras. |
| Geometry | Base/slope controls deform the envelope and relevant overlays; exact π/φ and 5½-palm seked presets; analytic central values. |
| Close comparisons | Magnified height residuals and a slope response chart expose differences hidden by normal scene line thickness. |
| Survey | The four published Dash casing side estimates and asymmetric 95% intervals are shown separately from the ideal square. |
| Latitude | A movable probe expresses coordinate offsets in metres and identifies the model’s point/datum limitations. |
| Sunlight | Local solar hour/declination controls update scene lighting, a solar-path arc, marker, ideal ground projection and seasonal altitude curves. |
| Sensitivity | Hypothetical base/height standard deviations and correlation drive analytic propagation plus 2,400 deterministic Gaussian samples. |
| Construction | Ideal volume distribution, mass, equivalent block count and gravitational lift energy, with editable assumptions. |
| Units | Metre/foot/illustrative-cubit comparison shows which ratios are invariant. |
| Evidence | All 27 original claims, full-text search, domain/class filters, source details and corrected interpretations. |
| Presentation | Rich/calm density, expanded viewport, user-started orbit/tour, keyboard focus, reduced-motion behavior, JSON experiment export. |
| Blender pipeline | The original Blender export is selectable as a **fixed reference**; enhanced geometry is clearly identified as procedural X3D. |

The original heading’s implication of ancient knowledge of π, φ and c is replaced by testable geometric comparisons. Archived data is preserved; its editorial grades, Monte Carlo means and unsupported confidence language are not promoted to newly validated results.

## Model and rendering details

- Envelope: ideal right square pyramid, base 230.363 m, face slope 51°52′. Height is derived, not separately measured. Central ratios are analytical.
- Scene baseline height: 146.721 m from the archived receipt; live scaling uses the analytical experimental height. The original renderer’s last-digit Monte Carlo differences are disclosed in the review.
- X east, Y up, −Z north. 1 X3D unit = 1 metre. One fixed figure is 1.8 m tall. Terrain, course pattern and chambers are illustrative, not survey data.
- Circle and square use exact horizontal analytical coordinates. Small vertical display lifts prevent z-fighting; line widths are for legibility and do not depict measurement resolution.
- Interior and latitude overlays remain **reference schematics** when the experimental envelope changes. Survey text is updated with current dimensions.
- Synthetic limestone textures are generated locally and are not photographs or archaeological evidence. PhysicalMaterial, direct lights, tone mapping and antialiasing provide the appearance. No full global illumination, atmospheric scattering, photogrammetry or measured performance claim is made.
- The shadow is the convex silhouette of a full ideal pyramid projected by parallel light onto level ground. It is hidden below 2° solar altitude to avoid horizon singularities; it is not a terrain shadow or full occlusion simulation. The numerical projection can still be inspected above the horizon.
- Solar input is declination and **local apparent solar hour**, not civil clock time or a dated ancient sky. No refraction, horizon, precession or equation-of-time correction.
- Published side intervals are distinct from the visitor’s Gaussian sensitivity assumptions. A slope interval and a standard deviation are not interchangeable.
- The coordinate centre is inherited from v1 mapping references. Displayed decimal places are not a centimetre accuracy claim. Read the linked AERA geodetic control report for measured modern reference points.
- Quality tiers adjust requested multisampling, content scale and frame cap. Hardware/browser caps may reduce actual sample count. These are settings, not FPS benchmarks.
- Original-scene mode keeps its geometry fixed. The model controls continue to drive analytical charts; the viewport explicitly identifies the reference scene.

## Verify and rebuild

Python’s standard library deterministically builds the X3D and both PNG textures:

```bash
python docs/demos/blender-giza-numbers/v2/build/build_observatory.py
node --test docs/demos/blender-giza-numbers/v2/tests/math.test.mjs docs/demos/blender-giza-numbers/v2/tests/runtime.test.mjs
python docs/demos/blender-giza-numbers/v2/tests/check_integrity.py
```

The optional DOM integration suite uses `linkedom@0.18.12`, installed outside the repository:

```bash
npm install --prefix /tmp/giza-ui-deps linkedom@0.18.12
LINKEDOM_PATH=/tmp/giza-ui-deps/node_modules/linkedom/esm/index.js node --test docs/demos/blender-giza-numbers/v2/tests/ui.test.mjs
```

This suite uses a DOM and mocked Scene Access Interface; it does **not** render WebGL pixels or establish actual browser custom-element timing.

XSD and semantic validation uses the repository’s shared validator and a separate `x3d_mcp` checkout:

```bash
python tools/assurance/validate_scenes.py --help
```

The shipped receipt `receipts/scene-validation.json` records the exact schema and validator revisions, scene hash and successful result. See `receipts/verification.json` for the scope and limitations of this review run.

## Manual release checks

The local preview was inaccessible from the review’s cloud browser. **v2 has not been visually verified in a real browser in this run.** The live v1 failure was observed directly. Before deployment:

1. Serve `docs/`, cold-load v2 and reload; confirm the LIVE X3D badge accompanies visible geometry and no console/HTTP errors.
2. Try every camera, layer, geometry preset, source-scene switch and reset. Verify labels remain legible, material normals are sensible and dimensions change coherently.
3. Sweep Sun inputs; compare morning/evening light and shadow against the solar chart. Check near-horizon behavior.
4. Test 390 px, 768 px, 1366 px and high-DPI desktop viewports. Check keyboard operation, reduced motion, density, tour stop, scroll and JSON export.
5. Disable WebGL and separately block the claims receipt. Numerical instruments should work without 3D; missing claims should receive their own error.
6. Measure real GPU frame times and loading before calling any quality tier “fast” or production-ready. The asset is about 1.1 MB plus 84 KB textures; the shared runtime is larger.

## Sources and review

Read [REVIEW.md](REVIEW.md) for 16 prioritized findings, equations, primary-source checks and next research directions. Primary references include Dash’s survey, AERA’s measured modern geodetic control, the BIPM metre definition and IAU nominal-conversion guidance. A later papyrus’s seked method does not by itself document Khufu’s design motivation.

The strongest next steps are a measured quadrilateral reconstruction with covariance, a source-level evidence graph, a controlled coincidence experiment, dated shaft/sky reconstruction, fresh Blender round-trip witnesses and measured rendering tiers.
