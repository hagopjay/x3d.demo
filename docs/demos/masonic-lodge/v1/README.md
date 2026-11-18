# Masonic Lodge XR v1

Phone AR (AR.js 3.4.7 location-based on A-Frame 1.4.2) that stands a cutaway Great Pyramid, authored as X3D 4.0 (`giza-lodge.x3d`), over each Masonic building OpenStreetMap lists within 2 km of the phone.

- Open on a phone over HTTPS: `index.html` then "Start AR". Desktop: "Preview" (X_ITE view plus the list) or "Test points" (4 synthetic points, no network).
- `x3d2three.js` is a small X3D subset reader (Transform, Group, Shape, Material, Box, IndexedFaceSet) so AR.js can draw the same X3D file.
- `lodges.js`: Overpass query (ODbL, cached 24 h per ~1 km cell), Wikipedia GeoSearch helper, haversine/bearing to Giza, low-precision sun position.
- `tools/build_giza.py` regenerates `giza-lodge.x3d`. Great Pyramid 146.6 m high, 230.34 m base; Khafre and Menkaure shells; chamber and gallery positions are schematic.

## Checks (what ran)
- x3d_mcp `fa5dccf` XSD 4.0: `giza-lodge.x3d` valid, 0 errors.
- Headless Chromium (Playwright, SwiftShader, fake camera, mocked geolocation 38.8977, -77.0365), `?auto=fixture`: 4 of 4 lodge entities created and 4 of 4 model overlays attached, 0 console errors. Preview mode loads with 0 console errors.
- NOT run: live Overpass (blocked from the build container, so the query is untested against real data), a real phone, real GPS/compass behaviour, iOS Safari.

## Data rules
Public info only (building name and position). No member data. No aggregate list is published: `tools/aggregate_private.py` builds a national list for private use only; its outputs are gitignored and belong outside the repo. Grand Lodges should be contacted before any list is published.
