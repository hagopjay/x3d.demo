# heritage-geo v2: Pleiades placement, elevation reconciliation, IFC placement row

New version folder; v1 is untouched. Validator behind scene claims: x3d_mcp `fa5dccf` `validate_xml` (XSD 4.0), receipt `validation-v2.json` (scene sha256 bound). Render: headless Chromium, software GL, X_ITE 16.6.0, not timed.

| Item | Result | Grade | Instrument |
|---|---|---|---|
| 627.175 m vs 617 m | Not a datum conflict. Median of EPQS minus (617 + DSM) is +0.03 m over 140 points at 30 m spacing; ground across the 400 x 300 m tile spans 619.8 to 632.9 m, so 627.175 m is one slope point | C numbers, S centre assumption | USGS EPQS 1 m, `reconcile_elevation.py`, `data/elevation-reconcile.json` |
| Orientation of the DSM | z increases southward: corr 0.51 vs -0.40 northward; correlation is modest, buildings and trees sit in the DSM but not in EPQS (min difference -24.2 m) | C | same |
| v1 coordinate error | v1 placed Khafre 208.3 m and Menkaure 64.1 m from their Pleiades points (typed from memory); Great Pyramid 4.7 m, Sphinx 4.3 m | C | `data/pleiades-giza.json` |
| Pleiades ids | Great Pyramid 704360201, Khafre 866839043, Menkaure 599695861, Sphinx 536839380, Necropolis 979282842 | C | Pleiades dump (6,843,218 bytes, 42,542 rows, sha256 75f620a7...) |
| IFC placement | `confluence-ifc` model.ifc has IFCSITE with all placement and lat/lon fields null, no IFCMAPCONVERSION, no IFCPROJECTEDCRS; the row in `ifc-placement.json` is authored (EPSG:32617, scale 0.001 for mm) | C file / S placement | grep over 2,030 lines |
| UTM numbers | Krueger series in stdlib, not checked against PROJ (pyproj not installed) | S | `build.py` |

The IFC marker is a 24 x 16 m box (the model's slab profile) on the Drillfield lawn, labelled illustrative. It is not Burruss Hall and the full Confluence scene is not inlined (it uses absolute asset paths and shader extensions).

Rebuild: `python3 -I reconcile_elevation.py` (network, about 8 minutes) then `python3 -I build.py --gate <x3d_mcp>/src`.

## Not done
3DEP `GeoElevationGrid` and general tiling belong to the geotiling thread. No Egyptian DEM, no GeoSPARQL endpoint, no full IFC inline, no cross-browser sweep.

Licence: see NOTICE.md. Google Drillfield data: academic, non-commercial proof of concept only.
