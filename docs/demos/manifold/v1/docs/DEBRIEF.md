# Manifold of Emotion, in X3D: debrief

**What this is.** `Manifold-of-Emotion.html`, a WebGL 2 page that draws an emotional field as a Riemannian surface, recreated as one ISO-standard X3D 4.0 scene (`scenes/manifold.x3d`) driven by the original's own logic. Run it with `python3 serve.py --port 8836`, then open http://127.0.0.1:8836/. The original is not published with this study (owner's decision); the fidelity evidence was recorded against it locally, and its sha256 is in the evidence.

## The mathematics, and what was checked

The field is a conformal metric on the plane, g = λ² (dx² + dz²), with λ = 1 + Σ aᵢ exp(−½ dᵀAᵢd): seven rotated, anisotropic Gaussians that breathe and drift with time. The surface is coloured by its Gaussian curvature, K = −Δ ln λ / λ². The luminous paths are its geodesics, traced with a unit Euclidean tangent: dT/ds = ∇ln λ − (∇ln λ · T) T.

The page uses the original's own code for all of it (`src/math-core.js`, verbatim; `src/field.js`, lifted statement for statement). The builder (`tools/manifold.py`) checks that code without its shortcuts:
- **Curvature** against Brioschi's formula for a general metric, which does not assume the metric is conformal.
- **Geodesics** against the full geodesic equation, with Christoffel symbols of the general metric, integrated in its affine parameter.
- **Two exact references:** the Gauss–Bonnet flux identity on the drawn square, and Clairaut's invariant for a round source.
- **Parity:** the page's JavaScript is run under Node and compared with the builder.

Limits were declared in the builder before the first build.

| Witness | Observed | Limit | |
|---|---|---|---|
| sources match page js | 8.9e-16 | at most 1.0e-12 | pass |
| heights match page js | 1.8e-15 | at most 1.0e-12 | pass |
| curvature matches page js | 1.1e-16 | at most 1.0e-12 | pass |
| curvature general metric | 5.1e-15 | at most 1.0e-12 | pass |
| gauss bonnet flux identity | 4.5e-14 | at most 1.0e-10 | pass |
| geodesic formulation | 9.6e-09 | at most 1.0e-07 | pass |
| geodesic rk4 error page step | 1.4e-04 | at most 2.0e-04 | pass |
| geodesic rk4 order | 9.3e-02 | at most 1.0e-01 | pass |
| clairaut reference | 1.8e-11 | at most 1.0e-09 | pass |
| particle seeds match page js | 0.0e+00 | at most 0.0e+00 | pass |

What the numbers say:
- **The page's own geodesics:** this page traces them at half the original's step. That makes them about 16 times more accurate: 1.4e-04 against 2.2e-03.
- **The drawn landscape is a picture of the metric, not an isometric embedding.** The original says so too. Here it is measured: the drawn surface's own geodesics stray up to 4.744 units from those of g within 20 units of path.
- **The labels** (Joy, Serenity, Curiosity…) are illustrative names, not measurements. They carry the Loom's label *Authored*.

## Fidelity to the original

The original and this page were captured at the same moment, camera and mood, with film grain off and the interface masked (`tools/browser_run.js`, `tools/record_browser.py`). Limits were declared before the first evidence run.

| Mood | SSIM | Mean ΔE | p95 ΔE | Luma |
|---|---|---|---|---|
| Reverie. | 0.9055 | 2.17 | 10.48 | 0.6 % |
| Euphoria. | 0.9529 | 2.15 | 9.81 | 0.6 % |
| Catharsis. | 0.9518 | 2.21 | 9.76 | 1.5 % |
| Stillness. | 0.9598 | 1.47 | 6.74 | 0.2 % |

Controls that must fail:
- **The mirrored original:** SSIM 0.5129.
- **The original three time units later:** SSIM 0.5541, mean ΔE 11.41.

Pictures, original left and X3D right: `docs/frames/pair-0.jpg` to `pair-3.jpg`. Up close: `docs/frames/closeup.jpg`, and `docs/frames/closeup-2x.jpg` cropped.

## Where it exceeds the original

- **Edges:** multisampled (4×) rather than FXAA. At close range the original's geodesic ribbons alias into dashes, while these stay continuous. Contour profiles match the original within a pixel.
- **Resolution:** a 513 × 513 surface, against the original's 361 × 361 at its highest setting. Ultra supersamples 2× on any display, with line widths and bloom kept at the original's size on screen.
- **Occlusion:** computed from the true height function per vertex, in place of screen-space AO. Its strength (0.12) is held inside the original look's budget in the deepest mood.
- **Geodesics:** about 16 times more accurate, with 30 traces.
- **Portability:** every moment can be saved as its own X3D scene, with the surface's heights, the shaders' inputs, the geodesic ribbons and the camera all baked in. Loaded alone into X_ITE, with no page logic, it redraws the live frame at SSIM 0.9987 (4.1 MB, valid X3D 4.0).

## How the X3D is built

- **One file:** `scenes/manifold.x3d`, written by `tools/scene.py`.
- **The surface:** an ElevationGrid of the rest heights, the builder's verified payload. Any X3D browser shows the manifold at rest.
- **Seven ComposedShaders**, inlined as `data:` URLs. They re-evaluate the metric, the fold and the ripples every frame.
- **Baked attributes:** particle seeds and filament ribbons, as vertex attributes. The X3D 4.0 schema gives PointSet no vertex attributes, so the seeds ride in a Coordinate and a Color.
- **Light layers:** standard alpha. Each writes (g / max g, max g), which approximates the original's linear-light addition without any blending extension.
- **Metadata:** states the mathematics, the grades and the witnesses.
- **The page:** `src/app.js` feeds the shaders through SAI from one guarded TimeSensor callback.
- **The lens:** `src/lens.js` inverts the per-fragment tone curve and runs the original's bloom, vignette and grain on X_ITE's frame. It runs in a microtask right after X_ITE draws.

## Red runs kept

- `evidence/history/2026-11-06-rk4-order-red.md`: the order witness compared points beyond the reference's end.
- `evidence/history/2026-11-06-browser-red.md`, three red runs:
  - a frame-count threshold that measured the software renderer;
  - a saved moment drawn with opaque sheets, because the blending extension wasn't in the file;
  - Catharsis luma over budget, first from biased light colour, then from occlusion tuned on another mood.

## Not checked

- A real GPU's look and frame rate (evidence ran in headless software GL).
- Other browsers.
- A paired human review.
- Listening: the piece has no sound.
