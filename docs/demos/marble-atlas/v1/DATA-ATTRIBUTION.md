# Data attribution, Demo 76 (Marble → Atlas → X3D)

No World Labs output (no world, splat, mesh, image or depth produced by Marble or Atlas) is stored or shown here. No API call was made.

| data | source | licence / terms | how it is used here |
|---|---|---|---|
| Camera rig: 10 Atlas cameras (positions, XYZW quaternions, intrinsics), `data/atlas-skills-rig.json` | [worldlabsai/skills](https://github.com/worldlabsai/skills) commit `6cdb6b9` (12 Nov 2026), file `skills/atlas-splats/assets/example/splats-request.json`, © World Labs Technologies | [Apache License 2.0](https://github.com/worldlabsai/skills/blob/main/LICENSE); copied unchanged except that it now lives under a new name; this table is the notice | every Viewpoint, frustum and raycast camera. Asset ids in it are placeholders (`<source image asset id>`), no images |
| Reading room: geometry, colours, every RGB/depth/confidence/label frame, `mesh.glb`, `colliderBoxes.glb`, `fused.spz` | made for this demo by `kit/make_fixture.py` from maths only | CC0 1.0 | the scene the rig looks at |
| Atlas API shapes, coordinate conventions, prices, terms quoted | [Atlas Developer API docs](https://docs.atlas.worldlabs.ai/llms.txt) (fetched 23 Nov 2026, llms.txt sha256 `af08fdd9…`); [Marble docs](https://docs.worldlabs.ai/) (openapi.yaml sha256 `4a3ed614…`); World Labs blog posts linked in the page | quoted briefly for description and review | field names, formulas, prices, licence summary |
| X_ITE 16.7.1 | [create3000/x_ite](https://github.com/create3000/x_ite), Holger Seelig | MIT, vendored in `../../blenderizer-nexus/v1/observatory/vendor/x_ite/` with its licence | draws the worlds |
| X3D 4.1 XSD | Web3D Consortium, bundled in [hagopjay/x3d_mcp](https://github.com/hagopjay/x3d_mcp) `src/validation/schemas/` | Web3D Consortium terms | validation |

Atlas, Marble, Spark, Frameboy and World Labs are names of World Labs Technologies, Inc. (announced 28 Sep 2026 as joining AMD). They are used only to say what the bridge reads. This demo is independent and is not endorsed by World Labs or AMD.

**Takedown.** If you hold rights in anything on this page and want it changed or removed, open an issue at https://github.com/hagopjay/x3d.demo/issues and it will be taken down promptly while the question is looked at.
