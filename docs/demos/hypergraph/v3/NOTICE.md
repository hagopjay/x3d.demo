# Hypergraph v3: all 500 ECO codes, DSA and engine concepts (Babylon.js)

**What it is.** v2 (hand-authored 48 openings) rebuilt from a real table: all 500 ECO codes (A00 to E99) with their 3,865 named lines. Points are ECO codes (colour = volume, size = number of named lines), DSA concepts and chess-engine concepts. Four dimensions: x, y, z plus w (ECO volume A to E for openings, tier S to D for DSA and engine nodes). Hyperedges: 5 ECO volumes, 27 opening families with 3 or more codes, 5 first-move groups, 40 transposition meeting points, the 15 DSA hyperedges, 2 engine groups and 5 bridges between chess and DSA (99 hyperedges, 1,791 incidences). v1 and v2 are untouched.

**Sources and grades.**
- ECO codes, names, move lines: Lichess `chess-openings`, commit 3ba6b20d31b2e6125cb0e6a2e792f400717d9d39, CC0, copied unchanged into `source/` (checksums in `source/README.md`). **Confirmed** as the data used.
- Families: the opening name before the first colon of an ECO code's first line (63 families; 27 have 3 or more codes and become hyperedges).
- Transposition meeting points: every line is replayed with python-chess 1.10. If a line passes through the final position of another line by a different move order, both codes join that position's hyperedge. Result: 831 events, 148 positions joining 2 or more codes, 54 joining 3 or more. The 40 shown are ranked by number of ECO volumes spanned, then size; 6 of them span volumes. Exact-position duplicates between lines do not exist in the table (0 of 3,865), so these are the only transpositions it contains. **Confirmed** (computed here), but they count positions reached inside the named lines only, not transpositions in real games.
- First-move groups, DSA concepts and tiers, engine concepts, and the 5 bridges: author's judgement (DSA set from v1, bridges from v2; the opening-book bridge now points at C60, B90, D30, E60 and E20). Not a published taxonomy.
- Layout: seeded 4D relaxation of family clusters (`tools/build.py`, seed 20261118); codes sit on a spiral inside their cluster; the DSA and engine concepts are placed as their own cluster to the right so bridges read as long edges. Position carries no meaning beyond clustering and the w axis.

**Rendering.** Babylon.js 9.37.0 (WebGL, thin-instance points with a custom shader, additive line and aura layers, bloom and FXAA in High quality; Light turns those off). The portable scene is `hypergraph.x3d` (X3D 4.0, Immersive, static pose, with `xite.html` showing it in X_ITE 16.6.0): the same positions and hyperedges, family and bridge labels only; it is not the interactive scene. The page draws `data.json`, which `tools/build.py` writes together with the X3D file.

**Checks (18 Nov 2026).**
- `hypergraph.x3d` valid against the X3D 4.0 XSD via x3d_mcp `validate_xml` (lxml 6.1.3, main fa5dccf): see `receipt-xsd.json`. **Confirmed.**
- Headless Chromium (Playwright, SwiftShader software GL, WebGL2), 1500x900: 548 nodes and 99 hyperedges loaded; real mouse hover and click selected C60; the selection panel drew a 64-square board; a meeting-point hyperedge could be isolated; search found Najdorf lines; Light quality and Esc worked; 0 console errors. `receipt-browser.json`, `tools/smoke.js`. **Confirmed.** X_ITE static view loaded with 0 console errors.
- Screenshots reviewed at four layers and poses (previews in this folder).

**Not done or not proved.**
- No frame-rate or GPU measurement: the test machine is a CPU software renderer, so no speed figure is claimed. Not run on a hardware GPU, Firefox, Safari or a phone.
- The ranges and names are the table's, not independently checked against ECO books; family hyperedges for the smaller families (under 3 codes) do not exist.
- No game statistics (no frequencies, win rates, ratings): nothing here ranks or recommends openings.
- Hubs and auras are drawn at the centroid of visible members; they are not convex hulls.
