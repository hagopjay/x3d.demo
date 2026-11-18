# D3 to X3D Bridge v2

**What changed from v1** (v1 is untouched at `../v1/`). The spec is the "D3 to X3D Bridge v2 spec" (18 Nov 2026). There are five flagships, marked with a star in the gallery, and one fix that applies across all 16 scenes:

| Flagship | v1 → v2 | X3D mechanism | Checked (headless, see receipts) |
|---|---|---|---|
| Living graph (Elasticgraph) | Static types graph → bipartite demo/type graph that grows demo by demo in ship order (first commit in x3d.demo, 7 to 18 Nov 2026) | d3-force-3d live in the page; SAI writes Transform, hull scale and 5-point bundled edges; a TouchSensor on each node isolates it | 144 of 144 nodes and 757 of 757 edges at the last demo; 41 nodes and 65 edges at demo 5; isolating `hypergraph` leaves 19 nodes opaque |
| Chord dome | One variable → height = shared files, tube radius = Jaccard | 91 TouchSensors; 20 TimeSensor + PositionInterpolator bead loops | isolate leaves 1 of 91 arches opaque; restore brings back 91 of 91 |
| Sankey canyon | Static → beads on every ribbon over 1% of flow, plus a 5-stop tour | 75 bead interpolators on 47 ribbons; Viewpoints VP3 to VP7 | 8 of 8 viewpoints found |
| Project globe | Map → the project's own world | 5 great-circle arcs (d3.geoInterpolate) from Blacksburg, each carrying a bead; 6 beacons, height = log2(1 + commits) | 4 of 4 viewpoints, 0 errors |
| Space-time cube | Sweeping disc → a one-day slab that slices the cube | 2 ClipPlanes inside Transforms that move against each other, so the past is lit and the future is a ghost | renders (previews/spacetime-slab.jpg) |

**Label declutter (all scenes).** At build time every label is projected through the scene's first viewpoint and kept greedily by priority. Labels that would overlap go into an X3D LOD and appear when you fly near them. Overlapping label pairs at the default view before and after are listed per scene in `manifest.json` (`labels`): type sphere 73 → 0, sankey 19 → 0, ridgeline 16 → 0, force graph 13 → 0, globe 8 → 0, space-time 6 → 0. Labels that sit inside moving Transforms (living graph) and flat axis text are not part of the pass.

**Relief tone (spec target missed).** The lights are now warm white, set at 1.25, 0.55 and 0.3. The centre of the relief seen from above averages RGB 114, 94, 77, against 110, 73, 49 for the same part of the source photo: red is within 4%, but green is 30% high and blue 57% high, so colour saturation is still lost under PBR. The spec allowed 15%. The next try is an unlit colour layer.

**Twin sites (graded Likely).** The site list and the folders tied to each site are authored. Commit counts come from git: Giza and Hawara 6 (x3d.demo giza-osiris-hall + heritage-geo), Blacksburg 2 (geotiling + confluence-ifc), Rome 2 (heritage-facade, the Pantheon splats), Yerevan 15 (x3d.mashtots, all commits), and Turin 0 (the Shroud lane has no x3d.demo folder).

**Checks (Confirmed, 18 Nov 2026).**
- XSD: 16 of 16 valid against X3D 4.0 (x3d_mcp `validate_xml`, lxml 6.1.3, main fa5dccf); sha256 for each scene in `receipt-xsd.json`.
- Browser: headless Chromium (Playwright), SwiftShader software GL, X_ITE 16.6.0, 1400x1000. All 16 scenes load with 0 console errors (`receipt-browser.json`). The "frames in 5 s" figure counts page animation frames. Static scenes idle near 300 because X_ITE redraws only when something changes. Animated scenes measured 11 to 25 on software GL. These figures show correctness only, not GPU speed.

**Everything else** (data harvest, sources, licences, rebuild steps) is as in v1's NOTICE. Rebuild v2 with `node build2.mjs ../data/data.json ../data/relief.json .. ../data/demo_dates.txt ../data/sites.json` from `tools/`.

**Not done.** No GPU, phone or headset run. No mouse test (the page API stands in for clicks). The living graph's centre stays dense because Shape, Appearance and Transform are used by almost every demo. Hull spheres are bounding spheres, not convex hulls.
