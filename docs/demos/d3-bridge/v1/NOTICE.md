# D3 to X3D Bridge v1

**What it is.** Sixteen ideas from the D3 / D3Blocks gallery (Heatmap, Chord, Treemap, MovingBubbles, D3graph, Sankey, Scatter, Timeseries, Elasticgraph, CirclePacking, Violin, ImageSlider, RadialGraph, Tree, Maps, Particles) re-expressed as true 3D X3D 4.0 scenes. D3 computes every layout at build time in Node; a small emitter (`tools/x3d.mjs`, "d3-x3d") writes the X3D; the x3d_mcp XSD validator gates it; X_ITE 16.6.0 draws it. One chart (Elastic graph) runs d3-force-3d live in the page and moves X3D Transforms through the SAI on every tick. No D3Blocks code, images or data are used: only the chart ideas.

**The data is ours.** Every chart is fed by facts harvested from the 16 x3d.* repositories (`tools/harvest.py`, counts and timestamps only; no author names, emails or commit messages are kept): commit times, X3D element counts in the 620 `.x3d` files of x3d.demo, tracked file trees of x3d.demo and x3d.loom, and the X3D 4.0 X3DUOM from x3d_mcp. Repository heads at harvest time are listed in `manifest.json` (`sources`).

| # | D3Blocks tile | 3D form | D3 modules | What the third dimension adds |
|---|---|---|---|---|
| 1 | Heatmap | Heat terrain | d3-scale (log), interpolateInferno | height repeats colour; top viewpoint is the 2D heatmap |
| 2 | Chord | Chord dome | d3-chord | ribbons arch by sqrt(flow), so crossings separate in height |
| 3 | Treemap | Treemap city | d3-hierarchy treemap (squarify) | each hierarchy level is a terrace; files are towers |
| 4 | MovingBubbles | Space-time cube | d3-array, d3-time-format | time is an axis, so the whole history is visible; a sweeping plane is the "now" |
| 5 | D3graph | 3D force graph | d3-force-3d (numDimensions 3) | same force model, fewer crossings, components form lobes |
| 6 | Sankey | Sankey canyon | d3-sankey 0.12.3 | each source owns a depth lane; front viewpoint is the exact 2D layout |
| 7 | Scatter | 3D scatter + wall shadows | d3-scale | a real third variable; the three 2D scatters are cast on floor and walls |
| 8 | Timeseries | Ridgeline wall | d3-array, d3-time-format | each series gets its own row; no overplotting |
| 9 | Elasticgraph | Live elastic graph | d3-force-3d in the browser | D3 owns physics, X3D owns light and navigation (SAI bridge) |
| 10 | CirclePacking | Sphere packing | d3-hierarchy pack | nesting as tiers, bytes as sphere volume |
| 11 | Violin | Violins of revolution | d3-array (KDE, quantile) | density spun into solids; median and quartile rings |
| 12 | ImageSlider | Relief slider | luminance at harvest | slider morphs flat image to luminance terrain |
| 13 | RadialGraph | Type sphere | d3-hierarchy stratify, cluster | 263 leaves on a sphere instead of one circle; used types glow |
| 14 | Tree | Cone tree | d3-hierarchy | breadth spent on the third dimension (Robertson, Mackinlay, Card 1991) |
| 15 | Maps | Globe + Equal Earth plate | d3-geo, topojson-client | no projection distortion; the flat projection sits below for comparison |
| 16 | Particles | Particle type | d3-random (seeded) | letters with thickness; swirl phase rotates through depth |

**Checks (Confirmed, 18 Nov 2026).**
- XSD: 16 of 16 scenes valid against the X3D 4.0 schema via x3d_mcp `validate_xml` (lxml 6.1.3, x3d_mcp main fa5dccf). Per-scene sha256 in `receipt-xsd.json`.
- Browser: headless Chromium (Playwright), SwiftShader software GL, X_ITE 16.6.0, 1400x1000: 16 of 16 scenes load with every viewpoint found (2 or 3 each), 0 console errors; Elastic graph Reheat ran 129 simulation ticks in 8 s and the X3D Transform of node 0 matched the simulation position times the scene scale (`receipt-browser.json`). Software GL is for correctness only; no frame rate is claimed.
- Previews in `previews/` are frames from that run.

**Sources and grades.**
- Country shapes: world-atlas 2.0.2 `countries-110m` (Natural Earth, public domain; package ISC). Areas from `d3.geoArea` x 6371.0088 km squared: Confirmed as computed, Likely within a few percent of published areas at 110m resolution.
- Relief image: x3d.demo `docs/assets/facade.jpg` (our own render of Demo 2), downsampled to 128 x 72.
- Commit hours are UTC, not his local time. The Timeseries, Space-time and Ridgeline window is 1 Oct to 18 Nov 2026 UTC (1,326 of 1,391 commits; the rest are older x3d_mcp history from before the fork's work began).
- Node-type counts are XML element counts (ProtoInstance bodies count where they appear); files that fail to parse are skipped (none did in this run: 620 of 620 read).
- Licences of vendored code: X_ITE 16.6.0 (GPL-3.0, `vendor/x_ite/LICENSE.md`, the same copy other demos ship); `vendor/d3-force-3d.bundle.js` bundles d3-force-3d 3.0.6, d3-octree, d3-binarytree (MIT) and d3-quadtree, d3-dispatch, d3-timer (ISC). D3 7.9.0 (ISC) and d3-sankey 0.12.3 (BSD-3-Clause) run only at build time.

**Rebuild.** In `tools/`: `npm ci`, then `npm run harvest` (needs the 16 repos cloned side by side), `npm run build`, `npm run bundle`, `npm run validate`. `node shoot.js .. <port>` re-runs the browser check against a local static server.

**Not done.** No GPU, Firefox, phone or headset run; no mouse-driven test (the page API was used). Treemap draws 330 of 681 leaves (the rest are thinner than 0.004 units). Labels overlap in the dense charts (force graph, sankey, type sphere). The space-time cube is busy where three repositories dominate the same days. Relief colours come from vertex colours under PBR lighting, so they read darker than the photo. Scenes use profile Immersive plus Shape 5 and Lighting 3; profile conformance is not checked by the XSD.
