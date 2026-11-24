# Data attribution, Atlas Bridge v2

This demo **does** store and show World Labs Atlas outputs. They were made on 23 and 24 Nov 2026 with the owner's own World Labs developer account. The first calls ran on Developer signup credits; the later ones ran after the owner bought credits. The terms for outputs made on bought credits were not re-read for this page, so every Atlas output here is treated under the stricter signup-tier rule below.

| data | source | licence / terms | how it is used here |
|---|---|---|---|
| Atlas pictures (every Atlas view shown in `shots/`), the texture `worlds/scriptorium-clean24.jpg` and `worlds/scriptorium-clean.jpg` (Atlas pictures projected onto Blender geometry), Gaussian splats (`worlds/draft.spz` and the preview inside `worlds/scriptorium-atlas.x3d`), the mesh and its texture (`worlds/scriptorium-atlas-mesh.x3d`, `.png`, converted from the returned GLB), collider boxes (inside `worlds/scriptorium-atlas.x3d`), returned depth (only as error maps in `shots/`) | [World Labs](https://www.worldlabs.ai/) Atlas Developer API, operations listed in `ledger.json` | World Labs Terms of Service (dated 10 Nov 2026), section 2.3(a): outputs made on a free or signup-credit tier are **owned by World Labs** and licensed to the account holder for **personal, non-commercial use**. Shown here on that basis, with credit. **Not** covered by this repository's licence; no commercial reuse. | the paint, and the "back" half of the bridge |
| Blender scene `worlds/scriptorium.blend`, `scriptorium24.blend`, the X3D exported from them, every camera and depth map sent to Atlas, Cycles renders in `shots/` | made for this demo by `blender/make_scene.py` and `blender/add_ring2.py` | the author's; an invented room, CC0 1.0 | the "out" half of the bridge and the reference |
| Blender 5.3.0 (`bpy` wheel), Cycles | [blender.org](https://www.blender.org/) | GPL; used as a tool, not redistributed | modelling, depth, bake, compositor, rigid bodies |
| X3D Blender I/O add-on v2.7.4 ("Blenderizer") | [hagopjay/x3d-blender-io](https://github.com/hagopjay/x3d-blender-io) | its own licence; not copied here | X3D export and import |
| Spark 2.4.0 (`@sparkjsdev/spark`) | [sparkjs.dev](https://sparkjs.dev/), © 2025 World Labs Technologies, Inc. | MIT; loaded from jsDelivr | draws the splats inside the bridge |
| three.js r187 | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT; loaded from jsDelivr | the bridge's renderer |
| X3D to three.js bridge (`bridge-three.js`) | [hagopjay/x3d.loom](https://github.com/hagopjay/x3d.loom) `x3d.threejs/bridge` | the author's | reads the X3D and builds the scene |
| X3D 4.0 and 4.1 XSD | Web3D Consortium, bundled in [hagopjay/x3d_mcp](https://github.com/hagopjay/x3d_mcp) `4d433af` | Web3D Consortium terms | validation |

Atlas, Marble, Spark and World Labs are names of World Labs Technologies, Inc. They are used to say what the bridge talks to. This demo is independent and is not endorsed by World Labs. The numbers are measurements of this bridge's round trip against its own Blender input; they are not a benchmark of Atlas and are not offered as one.

No API key, signed URL or account identifier is stored here: `ledger.json` holds operation ids and prices only, and `kit/atlas_client.py` strips signed URLs from everything it saves. `ledger.json` also lists calls made for two other studies on the same account; none of their outputs are in this folder.

**Takedown.** If you hold rights in anything on this page (World Labs included) and want it changed or removed, open an issue at https://github.com/hagopjay/x3d.demo/issues and it will be taken down at once while the question is looked at.
