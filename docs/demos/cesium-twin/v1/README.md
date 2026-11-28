# Cesium Twin v1

An X3D building on the CesiumJS globe, and a receipt that says CesiumJS put it where the X3D says.

1. HagopJay's Confluence studio (IFC4) is carried to X3D (x3d.loom `x3d.engineering/ifc-loop`).
2. `geo_place.py` wraps the scene in a `GeoLocation` (`"GD" "WE"`, 37.2284, -80.4234, 592.4 m) and sets `component Geospatial 1`: x3d_mcp `validate_xml` 0 errors, 0 warnings.
3. Blender 5.3.0 with the x3d-blender-io add-on writes the glb (111 meshes, 11,292 triangles); `x3d_to_3dtiles.py` writes a 3D Tiles 1.1 tileset whose root transform is the east-north-up frame at the geoCoords: 3d-tiles-validator 0.6.1 0 errors, 0 warnings.
4. `cesium_check.py` shoots 121 vertical rays at the roof in Python, from the X3D and the glb only, then asks CesiumJS 1.147.0 (`sampleHeightMostDetailed`, headless Chromium, SwiftShader, offline) for the same 121 points.

| | result |
|---|---|
| Roof hits that agree | 45 of 45, none extra |
| Worst height difference | 0.34 mm (tolerance 5 cm) |
| Our ENU frame vs Cesium's `eastNorthUpToFixedFrame` | 2.4e-7 max element |
| Planted +33 m height | caught, 33.00 m off |
| Planted z-up content | caught, 41 of 45 points wrong |
| Planted lat/lon swap | caught, 0 of 45 hit |

Page: sun slider (21 June, shadows), orbit, and the three planted faults shown as a modelMatrix so you can see where each lands. Receipts in `data/`. Grade: Confirmed for the numbers on this rig; the page's looks were checked on SwiftShader only, not a real GPU.
