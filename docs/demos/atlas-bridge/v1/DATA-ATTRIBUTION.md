# Data attribution, Demo 77 (Atlas Bridge)

This demo **does** store and show World Labs Atlas outputs. They were made on 23 Nov 2026 with the owner's own World Labs developer account, on Developer signup credits.

| data | source | licence / terms | how it is used here |
|---|---|---|---|
| Atlas pictures (every `view-*.jpg` shown in `shots/`), Gaussian splats (`worlds/*.spz`), meshes and their textures (`worlds/*-atlas-mesh.x3d`, `*.png`, converted from the returned GLB), collider boxes (inside `worlds/*-atlas.x3d`), returned depth (only as error maps in `shots/`) | [World Labs](https://www.worldlabs.ai/) Atlas Developer API, operations listed in `ledger.json` | World Labs Terms of Service (dated 10 Nov 2026), section 2.3(a): outputs made on a free or signup-credit tier are **owned by World Labs** and licensed to the account holder for **personal, non-commercial use**. They are shown here on that basis, with credit. They are **not** covered by this repository's licence and may not be reused commercially. | the "back" half of the bridge, and the pictures on the page |
| X3D blockouts `worlds/reading-room.x3d`, `worlds/kings-chamber.x3d`, every camera, depth map and mask sent to Atlas | made for this demo by `kit/scenes.py` | the author's; reading room invented, CC0 1.0 | the "out" half of the bridge |
| King's Chamber dimensions (412.24 × 206.12 × 230.09 inches, coffer, doorway) | W. M. Flinders Petrie, *The Pyramids and Temples of Gizeh* (1883), public domain | facts; public domain | the size of the blockout |
| Torii gate photograph (source of `shots/torii-generate-sheet.jpg`; the eight other views in that sheet are Atlas outputs) | [Pexels photo 31252468](https://www.pexels.com/photo/31252468/), photographer Daniel Erlandson | [Pexels licence](https://www.pexels.com/license/): free to use and modify, attribution not required but given | the one posed photograph of the image-to-views leg |
| Spark 2.4.0 (`@sparkjsdev/spark`) | [sparkjs.dev](https://sparkjs.dev/), © 2025 World Labs Technologies, Inc. | MIT; loaded from jsDelivr, not copied | draws the splats inside the bridge |
| three.js r187 | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT; loaded from jsDelivr | the bridge's renderer |
| X3D to three.js bridge (`bridge-three.js`) | [hagopjay/x3d.loom](https://github.com/hagopjay/x3d.loom) `x3d.threejs/bridge` | the author's | reads the X3D and builds the scene |
| X3D 4.1 XSD | Web3D Consortium, bundled in [hagopjay/x3d_mcp](https://github.com/hagopjay/x3d_mcp) `4d433af` | Web3D Consortium terms | validation |
| Atlas API shapes, prices and terms quoted | [Atlas Developer API docs](https://docs.atlas.worldlabs.ai/) and the account's rate card, read 23 Nov 2026 | quoted briefly for description | field names, prices, licence summary |

Atlas, Marble, Spark and World Labs are names of World Labs Technologies, Inc. They are used to say what the bridge talks to. This demo is independent and is not endorsed by World Labs. The fidelity numbers are measurements of this bridge's round trip against its own X3D input; they are not a benchmark of Atlas and are not offered as one.

No API key, signed URL or account identifier is stored here: `ledger.json` holds operation ids and prices only, and `kit/atlas_client.py` strips signed URLs from everything it saves.

**Takedown.** If you hold rights in anything on this page (World Labs included) and want it changed or removed, open an issue at https://github.com/hagopjay/x3d.demo/issues and it will be taken down at once while the question is looked at.
