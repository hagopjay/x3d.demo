# Demo 81 v2 · Open3D-ML Bridge scored against ground truth (open3d-ml-bridge/v2)

Same bridge as v1 (kept unchanged), run on three Rohbau3D construction-shell scans (CC BY 4.0) and scored with a stated class mapping.
Scene lenses: class, source RGB, confidence, **correct vs ground truth**, **ground truth**. Build: `x3d.ml/o3d_bridge/build_rohbau.py`.
All numbers: `assets/stats.json` (3 scenes x 3 runs, Open3D 0.20.0, torch 2.13.0, CPU; XSD 4.0 on x3d_mcp fork 4d433af; X_ITE 16.7.1 SwiftShader, 0 console lines).
