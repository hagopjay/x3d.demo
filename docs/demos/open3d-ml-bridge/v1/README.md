# Demo 81 · Open3D-ML Bridge (open3d-ml-bridge/v1)

Open3D-ML RandLA-Net (S3DIS) on CPU over a Redwood RGB-D room fragment, carried into X3D 4.0 with per-class metadata,
three lenses (class / source RGB / confidence) and per-class oriented boxes; read back into Open3D.
Code: `x3d.ml/o3d_bridge/x3do3d.py`, build: `x3d.ml/o3d_bridge/build_demo.py`, tests: `x3d.ml/tests/test_x3do3d.py`.
Renders with X_ITE (WebGL2 only; no WebGPU). `GfxGuard` shows a still when WebGL2 is missing.

| check | result | instrument |
|---|---|---|
| inference | 315,723 points in ~4 s on CPU | Open3D 0.20.0, torch 2.13.0, container CPU |
| validity | XSD 4.0 valid, x3dprov chain verified | x3d_mcp fork 4d433af |
| round trip | counts exact, worst position error 0.00084 m | `x3do3d.read_segmentation`, cKDTree |
| frame | 25.8% label agreement without floor-at-z=0 | two runs, same points |
| bridge vs noise | bridged 84.1±1.3, direct 82.8±3.2, full repeat 87.3±0.6 (%, 5 runs each) | `assets/stats.json` |
| render | 6 frames, 0 console lines, 0 black | X_ITE 16.7.1, Chromium, SwiftShader (software), `shots/shots-receipt.json` |

Numbers move a few points between rebuilds (the pipeline samples at random); `assets/stats.json` is the one source.
Rebuild: `LD_LIBRARY_PATH=<dir with libcudart.so.12> python o3d_bridge/build_demo.py <out> --ckpt ... --cfg ... --fork <x3d_mcp>`.
Holes: no real LiDAR detection run, no ground truth for this scan. See the page.
