# heritage-geo v1: Giza provenance twin + Burruss Hall geospatial placement

Heritage (CIDOC-CRM) and geospatial (X3D Geospatial component) frontiers for the Loom, scouted and scaffolded 18 Nov 2026.

| Item | Value | Instrument |
|---|---|---|
| Giza scene | `giza-provenance-twin.x3d`, 4 GeoLocation monuments, 7 CRM E13 claims as MetadataSet, X3D 4.0 | x3d_mcp `fa5dccf` `validate_xml`: valid, 0 errors (receipt `validation-v1.json`, scene sha256 bound) |
| Burruss scene | `burruss-geo.x3d`, validated the same way; Drillfield reused by Inline | same validator (checked by hand; the receipt file covers the Giza scene only) |
| Render | both tabs draw, no page errors, no horizontal scroll at 1280 px | Chromium (Playwright image) software GL, X_ITE 16.6.0; not timed |
| Claims | 7 (5 L, 1 S, 1 C) | `claims.json`, `claims.jsonld` |
| Open-data scout | 11 rows, each with what was run and a grade | `data/open-data-sources.json` |

Rebuild: `python3 -I build.py --gate <x3d_mcp>/src`.

## Findings (graded)
- **C**: a GeoLocation child needs no extra rotation for Y-up content; with an extra +90 degree X rotation the Drillfield stood on edge (render-checked, X_ITE 16.6.0).
- **C**: in the X3D 4.0 XSD, `metadata` must be the first child of Transform/GeoLocation; the validator rejected it after the shapes.
- **C**: X3D GD is lat, lon, elevation; GeoSPARQL/WKT/GeoJSON are lon, lat.
- **S**: USGS EPQS gives 627.175 m at the Burruss point while the Drillfield world uses 617 m as its reference; not reconciled (datum, building footprint or the sampled spot).

## Not tested
No Egyptian terrain, no IFC to X3D conversion of Burruss yet (confluence-ifc model.ifc is the candidate), no GeoSPARQL endpoint, no timing, no cross-browser sweep, Overpass unreachable from the container.

Licence and attribution: NOTICE.md. Academic, non-commercial PoC only for the Google data.
