# Notice: Cesium Twin v1

- **Page and data files** (`index.html`, `data/tileset.json`, `data/confluence.glb`, `data/*receipt.json`): written for this site (x3d.demo), 28 Nov 2026, by x3d.loom `x3d.geo/cesium-leg/`.
- **Building**: HagopJay's own Confluence studio model (IFC4, sha256 32dc7211...eef0fb), carried to X3D by x3d.loom `x3d.engineering/ifc-loop/ifc2x3d.py`. Its placement on the Virginia Tech Drillfield (37.2284, -80.4234, 592.4 m ellipsoidal) is a **demonstration only**: the Confluence studio is not a real building there.
- **CesiumJS 1.147.0**: Apache-2.0, loaded from jsDelivr (`cdn.jsdelivr.net/npm/cesium@1.147.0`), not copied. No Cesium ion token is used and no ion asset is requested; the "Cesium ion" logo is CesiumJS's default credit.
- **Base map**: Natural Earth II, bundled with CesiumJS (public domain, naturalearthdata.com).
- **Region tiles**: loaded from [`../../geotiling/v1/tileset.json`](../../geotiling/v1/NOTICE.md) by reference, no copy. Their satellite textures are derived from Google Map Tiles API imagery ("Imagery and data: Google"), used at the owner's decision **for an academic, non-commercial proof of concept only**; see that notice. They are hidden until the Region button is pressed. **Keep them out of the card still** (`card.png` shows the building on Natural Earth II only).
- **Takedown**: anyone with a rights concern about any file here can open an issue on hagopjay/x3d.demo; the file comes down first and the question is settled after.
