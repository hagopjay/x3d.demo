# Demo 79 · Salon of Two Centuries (salon-two-centuries/v1)

The owner's [ArtHistory.md](https://github.com/hagopjay/gcloud.map/blob/main/ArtHistory.md), sliced to **1700-1899**
(nodes A20-A28: late Baroque to early Art Nouveau), as one walkable X3D 4.0 scene. **One metre is one year**:
`z = -(year - 1700)`. Every layer shares that axis.

| layer | what it is | data |
|---|---|---|
| **Spine** | a 200 m corridor, brass year lines every 5 and 10 years | n/a |
| **Galleries** (A) | one per movement, from its start year to its end year (clamped to the slice), each in its own architecture and light: Baroque chiaroscuro, Rococo boiserie and mirrors, Neoclassical fluted columns and coffers, Gothic Revival ribs, Realist iron trusses under north light, an Impressionist glass roof, Post-Impressionist chrome-yellow bands, a Symbolist gold mosaic, Art Nouveau whiplash ironwork. Overlapping movements take parallel lanes (greedy interval packing); passages are cut where a second lane runs behind the first | `data/movements.json` (notes graded C/L/S) |
| **Paintings** (A) | 57 public-domain works hung at their real size (Wikidata P2048/P2049) at their own year, unlit so the photograph keeps its colour; click one for its card and credits | `data/paintings.json`, `paintings/` |
| **Walk-ins** (A) | *The Raft of the Medusa* and *The Starry Night* as depth reliefs (textured ElevationGrid), *La Grande Jatte* as 46,000 coloured points in depth | `depth/` from Depth Anything V2 Small on CPU |
| **Pigment tower** (C) | 14 pigments on pedestals at their year with threads to the rooms that used them; a stacked tower at 1899+14 m | `data/pigments.json` |
| **Atlas sky** (D) | above the rooms: x = longitude (Europe 0.9 m/deg, beyond it compressed), y = latitude, z = the same year axis. 405 painters as threads from birth place through work places to death place, coloured by movement; 182 arcs (gold = influenced by, white = student of) | `data/artists.json` |

## Receipts (25 Nov 2026)

| check | result | instrument |
|---|---|---|
| data | 1,434 painters harvested (14 movement items), 405 shown (top 45 per movement by sitelinks), 658 places, 182 links; 836 candidate paintings, 57 hung | QLever Wikidata endpoint, `build/ql.py` + `build/curate.py` + `build/finalize.py` |
| sizes | first pass read bare numbers and mixed metres and millimetres (Watteau 1.29 x 1.94, Degas 920 x 680); fixed by reading the unit from the full statement | `build/finalize.py` |
| XSD + semantic | X3D 4.0 valid, 0 errors, 0 warnings, info only (unused DEFs addressed by the page) | x3d_mcp fork `4d433af`, `assets/validate-receipt.json` |
| round trip | 54/54 wall paintings (Wikidata id + year) equal; 3/3 walk-in rooms; 56 ImageTexture urls, 0 missing | lxml, `build/validate.py` |
| load | ready in ~20 s; 14 frames, 0 black; the only console entry is the page's own optional fetch of the receipt before it existed | X_ITE 16.7.1, Chromium 158 (Playwright), SwiftShader WebGL2, `shots/shots-receipt.json` |
| picking | fly-to + card for *The Oath of the Horatii*: asked Q476458, card shows it | `build/shots.mjs` |

Frames are software rendered (SwiftShader); no frame rate here is a performance claim. The page needs only WebGL2.

## Rebuild

```
python3 -I build/curate.py data/movements.json data/artists.json data/paintings.json   # needs raw/ from build/ql.py queries
python3 -I build/finalize.py data/paintings.json                                        # units, Art Nouveau works, image urls
python3 -I build/fetch_img.py data/paintings.json paintings                             # throttled; Wikimedia returns 429 when rushed
python build/depth.py paintings/Q212616.jpg depth/Q212616.png ...                       # transformers + torch CPU
python3 -I build/build_x3d.py                                                           # -> assets/salon.x3d
python3 build/validate.py /path/to/x3d_mcp                                              # -> assets/validate-receipt.json
node build/shots.mjs http://127.0.0.1:8765/demos/salon-two-centuries/v1/ OUT 2
```

## Learned here (folded into x3d.loom)

1. **Wikimedia's own endpoints rate-limit cloud sessions hard** (Commons API, Wikidata API and WDQS all answered 429 within minutes, the image server answered 429 "robot policy" on bursts). QLever's Wikidata mirror answered every query with short backoff, and the image server works at about one image per 2-30 s. Route: QLever for facts, throttled thumbnails for images, and Wikidata P6216 for copyright status when the Commons API is closed.
2. **Wikidata quantities need their unit.** `wdt:P2048` gives the bare number; the same property holds cm, mm and m. Read `psv:` with `wikibase:quantityUnit`.
3. **PBR metals render black in X_ITE without an environment map.** Gilt and mirrors in PhysicalMaterial came out black under point lights; tuned Blinn-Phong Material (coloured specular for metals) restored them on WebGL2.
4. **Viewpoints off the floor fall under WALK gravity.** The entrance and walk-in viewpoints sat beyond their floors; FLY as the default and floors under every viewpoint fixed it.
5. **Interval packing makes unreachable rooms.** A second-lane gallery sat behind a first-lane wall; the build now cuts passages wherever lanes overlap.
6. **The validator caught two header gaps**: Interchange does not cover Extrusion, Switch, TouchSensor or PhysicalMaterial, and PointProperties needs Shape level 5.
