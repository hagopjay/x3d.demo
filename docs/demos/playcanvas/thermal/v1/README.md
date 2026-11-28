# THERMAL · a KANSEI soaring game

A sailplane has no engine. THERMAL's glider is held up only by simulated air. Its atmosphere is a lattice Boltzmann simulation:
- D2Q9 MRT flow with Smagorinsky;
- D2Q5 temperature;
- Boussinesq buoyancy in a stratified atmosphere.

The slice runs across an X3D ridge, as WebGL2 fragment-shader passes. A Float64 CPU reference checks the GPU live: that check is the INTEGRITY panel. The glider flies an ASW-28 polar fitted from XCSoar's published entry.

**Ridge Day.** A west wind of 8 m/s blows against a 700 m ridge. Run the ridge 6 km north to North Cairn, then 11 km south to South Saddle. Then glide upwind to the airfield before the sun sets at 18:00.

    npm start                # node tools/serve.mjs -> http://localhost:8080  (no install, no build)
    npm test                 # every gate in tests/limits.json, ~6 min on 2 cores (Node 20+)
    node tools/build.mjs     # regenerate levels/ridge-day.x3d and assets/glider.x3d
    node tools/receipt.mjs   # run every gate once -> receipts/gates.json
    NODE_PATH=$(npm root -g) node tools/gpu-gate.cjs       # GPU vs CPU in headless Chromium -> receipts/gpu-cpu.json
    NODE_PATH=$(npm root -g) node tools/playtest.cjs --bot=mc --warp=4 --cam=1 --glass=1

**Keys**
- **Flying:**
  - **W / S:** stick (push, pull)
  - **A / D:** bank
  - **Space:** speed-to-fly hold on or off; Q / E trim when hand-flying
  - **[ ]:** MacCready setting
  - **F:** flaps
  - **B:** airbrakes
  - **J:** dump water
- **View and sound:**
  - **T:** time ×1/2/4/8
  - **C:** camera (chase, side, cockpit)
  - **G:** glass sky (the simulated vertical wind on the slice)
  - **M:** sound
- **Wrong twins:**
  - **V:** the uncompensated vario
  - **K:** plain BGK at τ ≈ ½ (watch it blow up)
  - **R:** reset the air

**URL options:** `?bot=mc|naive`, `?warp=4`, `?cam=1`, `?glass=1`, `?cpu=1`, `?spin=1200`.

**Read** `docs/PHYSICS.md` for:
- the model and its units;
- every gate with its measured numbers and wrong twin;
- what was changed after the first run.

**Licences**
- **THERMAL:** MIT.
- **Vendored:** PlayCanvas 2.24.3 (MIT, `vendor/PLAYCANVAS-LICENSE`).
- **Adapted:** the X3D reader and the X3D-to-PlayCanvas module come from HAUL and KANSEI (MIT).
- **Polar data:** XCSoar's `PolarStore.cpp`, entry ASW-28 (15m), which XCSoar marks as taken from SeeYou.
