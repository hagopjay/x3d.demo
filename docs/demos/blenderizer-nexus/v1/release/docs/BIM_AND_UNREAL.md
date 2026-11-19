# BIM and Unreal handoffs: measured inputs, explicit application boundaries

The pavilion is a genuine **IFC4 file** with `IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey` spatial structure, eight columns, two beams, foundation, slab, roof, nineteen solar fins, three plinths and a rear screen. The primary footprint is 12 × 8 metres; the roof overhang is 12.6 × 8.6 metres. Every object is synthetic. Energy, life and carbon properties are illustrative scenario values, not an engineering design or lifecycle assessment.

## Rebuild the IFC dataset

From this demo directory in ordinary Python:

```bash
python -m pip install ifcopenshell==0.9.0.post1 numpy
python adapters/bim.py --out web/assets/bim
```

No Blender import is required for this step. The script writes:

| File | Purpose |
|---|---|
| `pavilion.ifc` | IFC4 spatial graph, extruded solids, material associations, styles and synthetic property sets |
| `bim_geometry.json` | World-coordinate tessellation **read back from the written IFC** through IfcOpenShell |
| `bim_evidence.json` | Version/hash, units, type and geometry counts, identity/bounds/schema checks, and application checks not run |

It also generates a second IFC in a temporary directory and requires exact byte identity in the same runtime. All `IfcRoot` GUIDs are deterministic UUID5-derived compressed IFC GUIDs. The timestamp is fixed to preserve repeatability. This does not assert bitwise tessellation stability across different IfcOpenShell/Open Cascade versions.

The tested generator uses IfcOpenShell **0.9.0.post1**. It produced **36 elements, 288 tessellated vertices and 432 triangles**, zero schema-validator messages, and a maximum world bounds error of approximately **1.78 × 10⁻¹⁵ metres**. The generator repeats these checks on every run rather than relying on these printed historical values.

## Blender adapter contract

The parent showcase's Blender builder consumes `bim_geometry.json`, builds each mesh from the extracted triangles, assigns the supplied colour, and carries IFC identities and synthetic properties into the scene metadata. This is an explicit IfcOpenShell-to-Blender adapter. **The X3D add-on is not represented as a native IFC parser.** Blender then becomes the authoring/format hub for X3D, GLB, USD and rendered output.

```json
{
  "schema": "x3d-hub/bim-geometry/1",
  "source": "pavilion.ifc",
  "units": "metre",
  "up_axis": "Z",
  "coordinate_space": "world",
  "synthetic": true,
  "elements": [{
    "id": "compressed IFC GlobalId",
    "name": "element display name",
    "ifc_type": "IfcColumn",
    "vertices": [[0.0, 0.0, 0.0], [0.22, 0.0, 0.0], [0.0, 0.22, 0.0]],
    "faces": [[0, 1, 2]],
    "color": [0.12, 0.68, 0.73],
    "properties": {"Synthetic": true, "Material": "Recycled aluminium"}
  }]
}
```

The triangle above illustrates the schema. Real output contains every tessellated surface of each element. Coordinates are Z-up world metres; the Blender adapter should not apply another IFC placement or scale. The X3D add-on handles its own Blender Z-up ↔ X3D Y-up conversion. `properties` contains `Pset_AsterionSynthetic` values without the transient STEP entity number. GUID, class and property preservation through later exports must be checked separately; IFC parametric solids and spatial relationships do not become editable IFC semantics merely by exporting an X3D mesh.

## Open in Bonsai

Open `pavilion.ifc` with a compatible Bonsai installation and inspect the spatial tree, element class, material and `Pset_AsterionSynthetic`. Compare its 36 elements and eight columns with `bim_evidence.json`. Select a column and check that its GlobalId matches the JSON element record.

**Status:** IFC writing, reopening, schema validation and geometry extraction were executed. Bonsai's interactive import was **not run** in the build environment. The ready IFC asset and these inspection steps make that last handoff reviewable without claiming a green application test.

## Import GLB or USD content in Unreal Editor

The showcase provides standard GLB/USD assets. Enable **Python Editor Script Plugin** and the relevant **Interchange/glTF** or **USD Importer** facilities in an Unreal project. Importer names/options depend on the installed engine version. `adapters/unreal_import.py` uses the Editor's `AssetImportTask` interface and the USD factory when choosing USD. It deliberately imports **content assets**, not a complete level/camera/animation reconstruction.

In Unreal's Python console:

```python
import sys
sys.path.insert(0, r"C:\NEXUS\adapters")
import unreal_import
unreal_import.import_asset(
    r"C:\NEXUS\web\assets\bim\scene.glb",
    destination="/Game/NEXUS/Pavilion",
    report=r"C:\NEXUS\unreal_pavilion_import.json",
)
```

For a USD asset, use the actual `.usd`, `.usda`, `.usdc` or `.usdz` download path instead. Programmatic callers can use `main(["--assets-root", path, "--asset", "bim/scene.glb"])`. `--replace` is required to request replacement of existing assets. The script writes the observed engine version, source SHA-256, import destinations and actual returned object paths. It reports failure if no assets are returned. A successful external run is the evidence needed to change the showcase route from `not_run` to `pass`; generated files alone are not that evidence.

**Status:** the script was syntax checked outside Unreal. Unreal Editor was **not run**, so material, hierarchy, animation and unit fidelity in Unreal remain application verification steps. Compare a known 12 m span against 1,200 Unreal centimetres after import, examine the returned content, and only then record the handoff result. No LLM API is required by any adapter.

## Primary references

- [IfcOpenShell geometry creation](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_creation.html): local placement, representation creation and extrusion conventions.
- [IfcOpenShell geometry API](https://docs.ifcopenshell.org/autoapi/ifcopenshell/geom/index.html): `create_shape` and geometry settings.
- [IfcOpenShell validation](https://docs.ifcopenshell.org/ifcopenshell-python/validate.html).
- [Epic AssetImportTask](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetImportTask?application_version=5.1) and [AssetTools](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetTools): task properties and `import_asset_tasks`.
- [Epic USD stage asset import factory](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/UsdStageAssetImportFactory).

These references describe the APIs and interchange routes. They are not substitutes for an executed Unreal/Bonsai import of this fixture.
