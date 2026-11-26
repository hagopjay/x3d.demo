# Demo 81 (open3d-ml-bridge/v1): sources, attribution and takedown

The bridge code, scene, page and derived numbers are this project's own work (MIT for code, CC BY 4.0 for the page and scene).
Naming a source below is credit, not a claim of ownership or endorsement. This page is not legal advice.

| what | source | owner / author | licence or terms | status |
|---|---|---|---|---|
| 3D scan (a 50,000-point random subset of 315,723 points, positions rounded to 1 mm, with its RGB, plus labels) | Redwood "Robust Reconstruction of Indoor Scenes" living-room fragments, http://redwood-data.org/indoor/ , fetched with `open3d.data.LivingRoomPointClouds` from https://github.com/isl-org/open3d_downloads (fragment 20) | Sungjoon Choi, Qian-Yi Zhou, Vladlen Koltun (CVPR 2015) | **no licence stated on the site**; it asks "please cite our work if you use code or data" | cited below; derived subset only, the raw fragment is not committed; **redistribution terms unverified, removed on request** |
| model weights (not committed; downloaded at build time) | `randlanet_s3dis_202201071330utc.pth` from https://github.com/isl-org/Open3D-ML model zoo | Intel Intelligent Systems Lab / Open3D-ML authors | repository licence MIT; the weights were trained on S3DIS (Stanford, its own terms) | sha256 recorded in `assets/stats.json`; not redistributed here |
| library | Open3D 0.20.0, Open3D-ML (https://github.com/isl-org/Open3D-ML) | Intel ISL, Open3D contributors | MIT | used, not modified |
| renderer | X_ITE 16.7.1 (vendored in Demo 56) | create3000 / Holger Seelig | licence notice in the vendor folder | licensed, not modified |
| validator | x3d_mcp fork `4d433af` (XSD 4.0) | this project | per repo | used |

Cite: Sungjoon Choi, Qian-Yi Zhou, Vladlen Koltun, "Robust Reconstruction of Indoor Scenes", IEEE CVPR 2015.
Open3D-ML: Q.-Y. Zhou, J. Park, V. Koltun, "Open3D: A Modern Library for 3D Data Processing", arXiv:1801.09847, 2018.

Not used, and why: SemanticKITTI and KITTI (CC BY-NC-SA, registration), S3DIS (Stanford agreement), Waymo (own terms).

## Takedown, and how to ask

If you own anything listed here and want it removed or the credit changed, open an issue at
https://github.com/hagopjay/x3d.demo/issues titled `Takedown: open3d-ml-bridge` and say what you want removed.
It will be removed promptly after a request, without argument; the history can be cleaned on request.
