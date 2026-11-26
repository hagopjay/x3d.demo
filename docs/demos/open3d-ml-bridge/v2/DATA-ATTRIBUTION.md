# Demo 81 v2 (open3d-ml-bridge/v2): sources, attribution and takedown

The bridge code, scene, page and derived numbers are this project's own work (MIT for code, CC BY 4.0 for the page and scene).
Naming a source is credit, not endorsement. This page is not legal advice.

| what | source | owner / author | licence | status |
|---|---|---|---|---|
| point clouds (scenes `scene_02009`, `scene_02010`, `scene_02000` of site_02), labels | **Rohbau3D: A Shell Construction Site 3D Point Cloud Dataset**, https://doi.org/10.60776/ZWJFI4 (Dataverse, OpenData UniBw M); code https://github.com/RauchLukas/rohbau3d | Lukas Rauch et al., Universität der Bundeswehr München | **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/), read from the Dataverse API `latestVersion.license` on 26 Nov 2026 | **changed by us**: random subsample (400,000 of about 11 million points per scene for scoring; 50,000 shown), positions rounded to 1 mm, recoloured per lens, labels mapped to the S3DIS classes; the raw files are not committed |
| model weights (not committed) | `randlanet_s3dis_202201071330utc.pth`, https://github.com/isl-org/Open3D-ML | Intel ISL | repository MIT; trained on S3DIS | sha256 in `assets/stats.json` |
| library | Open3D 0.20.0, Open3D-ML | Intel ISL | MIT | used |
| renderer | X_ITE 16.7.1 (vendored in Demo 56) | create3000 / Holger Seelig | per vendor folder | not modified |
| validator | x3d_mcp fork (XSD 4.0) | this project | per repo | used |

Credit line (CC BY 4.0): "Rohbau3D" by Lukas Rauch et al., Universität der Bundeswehr München, doi:10.60776/ZWJFI4, licensed CC BY 4.0; modified as described above. The authors do not endorse this demo.
Please also cite the dataset's paper as listed on its Dataverse page.

## Takedown, and how to ask
If you own anything listed here and want it removed or the credit changed, open an issue at https://github.com/hagopjay/x3d.demo/issues titled `Takedown: open3d-ml-bridge` and say what you want removed. It will be removed promptly, without argument; history can be cleaned on request.
