# medical-provenance v4: a jointed H-Anim skeleton from CT bones

Educational proof of concept. Not medical advice. Third step of the medical frontier (v3: [`../v3/`](../v3/)).

`hanim-skeleton.x3dz` is a real `HAnimHumanoid` (X3D 4.0, profile Full, HAnim level 2): 35 `HAnimJoint`, 35 `HAnimSegment`, built from the bone meshes of `../../brain-torso-xite/v1` (read, not copied). Each segment carries the FMA id and claim digest of its v3 structure. Ribs, sternum and costal cartilage have no H-Anim segment name, so they are drawn outside the humanoid (26 translucent shapes). The page poses the skeleton with joint sliders and three preset poses.

| Item | Value | Instrument |
|---|---|---|
| Joints / segments | 35 / 35 | `build.py` |
| Names exist in the XSD | 35 of 35 joints, 35 of 35 segments | x3d_mcp `x3d-4.1.xsd` enumerations (`data/xsd-name-check.json`) |
| Scene valid | 0 errors | x3d_mcp `fa5dccf` `validate_xml` (`validation-v4.json`, sha256 bound) |
| Joint tree vs placement table | max error 0.000000 m over 35 joints | forward-kinematics walk in `build.py` |
| Render and posing | loads, 35 joint rows, 35 segment rows, three poses run, 0 console errors, no horizontal scroll at 1280 px | Chromium (Playwright image) software GL, X_ITE 16.6.0 |
| Size | 817,727 bytes XML, about 253 KB gzip | `data/summary.json` |

Joint centres are ESTIMATES (grade S) from mesh geometry; see `joints.json` for each method. No skinning, no joint limits. Other H-Anim players were not tested.

Rebuild: `python3 -I build.py --gate <x3d_mcp>/src`. Licences as in `../v3/NOTICE.md`.
