Scenes written for Demo 24 version 2 (the bridge and the blenderizer), 14 Nov 2026.

They are NOT in the x3d.loom bridge repository. They draw the pictures in the volume and physics sections:
  _demo-vol-*.x3d   one 32 x 32 x 32 voxel field (a torus, a core and a satellite) drawn by eight volume styles
  _demo-phys-*.x3d  a sphere and two boxes dropped on a fixed ground; a pendulum on a hinge with limits (-0.5 to 0.5 rad)
  *.test.json       the bridge's run-tests spec for each scene (steps and named shots)

To rerun: copy the files into x3d.webgpu/bridge/fixtures/ of hagopjay/x3d.loom at commit 7bca6e3 (the head of open PR 63; batch 43 is not on main),
then from x3d.webgpu/bridge run
  XITE_DIR=<x_ite 16.6.0 dist> BABYLON_JS=<babylon 9.32.0 babylon.js> CHROMIUM_EXECUTABLE=<chromium> \
  node tools/run-tests.js --shots <out dir> _demo-vol-shaded
Rig used: Chromium 153.0.8010.12 headless, SwiftShader (CPU raster), X_ITE 16.6.0, Babylon.js 9.32.0, 320 x 240 pictures.
Each picture is the bridge on the left and X_ITE on the right. Run one volume scene at a time: several at once on a small CPU can time out.
