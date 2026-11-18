# Hypergraph, hyper-dimensionally: sources and checks

**What it is.** A proof of concept answering `HYPERGRAPH_VISUALIZATION_RFC.md` (DSA Tutor knowledge graph) in X3D instead of D3. 40 concepts are 4D points (x, y, z; w = tier S..D from RFC 2.3). 15 hyperedges (4 to 7 members each) are hubs with spokes plus translucent bounds. The page rotates the three planes that involve w (XW, YW, ZW) and projects 4D to 3D with a smooth perspective `s = 0.85 * exp(-0.12 w)`; the lens buttons drop w (3D) or z and w (2D). The clique-expansion button swaps hubs for every pairwise edge, to show what a plain graph does to a hyperedge.

**Data.** An illustrative curated set authored for this proof of concept. It is NOT the DSA Tutor database (the RFC contains a schema, not rows). Membership of each hyperedge is the author's judgement. Layout: seeded 4D force relaxation, `tools/build.py` (seed 20261118), w pinned to tier. Replace `tools/data.py` with an export of concept_nodes plus a hyperedge table to use real data.

**Built with.** `tools/build.py` writes `hypergraph.x3d` (Immersive 4.0) and `data.json`. X_ITE 16.6.0 bundled in `vendor/x_ite/` (own LICENSE.md). No network requests.

**Checks (Confirmed, 18 Nov 2026).**
- `hypergraph.x3d` is valid against the X3D 4.0 XSD, x3d_mcp `validation.validate.validate_xml` (lxml 6.1.3), x3d_mcp main fa5dccf. `receipt-xsd.json` holds the result and the SHA-256.
- Headless Chromium (Playwright, SwiftShader software GL), X_ITE 16.6.0, 1300x900: 40 of 40 concept nodes and 15 of 15 hyperedge switches resolved; rotation moves nodes; the 2D lens puts all 40 at z = 0; selecting `dp` reports 5 hyper-neighbours (matches data); the clique switch toggles; 0 console errors. `receipt-browser.json` (`tools/rec.js`).
- 13.3 frames/s is software GL on a CPU container, not a GPU number.

**Computed counts (from data.json).** 40 concepts, 15 hyperedges, 73 incidences, 138 distinct pairs after clique expansion (147 before dedup), so a plain graph needs 1.89 edges per incidence.

**Not done.** Click selection through the real mouse was not driven (selection was tested through the page API); no GPU, Firefox, Safari or phone run; no backend, progress or learning-path features from the RFC; hyperedge bounds are spheres, not convex hulls.
