# TIDEWRIGHT physics

The solver is in two files that do the same arithmetic. `src/sim/swe.js` is the CPU reference, in float64, run by Node and the page. `src/gpu/swe-gl.js` is the WebGL2 port, in float32, which the game runs. The gates are listed in `tests/limits.json`, committed on its own before any gated configuration ran (the second commit, after the root). That file wasn't edited afterwards, and `tests/ladder.test.mjs` checks that it's byte-identical to the commit that added it.

Every number below names its host:
- **Node:** v22.23.5 (linux x64).
- **Browser:** headless Chromium 158.0.8127.36 through playwright, launched with `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. The renderer it reported is **ANGLE (Mesa, Vulkan 1.4.335 (llvmpipe (LLVM 20.1.2 256 bits)), llvmpipe)**, a software rasteriser and not SwiftShader, whatever the flag says.
- **No real GPU was measured.** No number here is a hardware-GPU benchmark.

The receipts are in `docs/receipts/`:
- `ladder-node.json`: Node.
- `gpu-gate.json`: GPU against CPU in one page.
- `level-gpu.json`: the level on the GPU against Node.
- `exploration.json`: the coarse runs made before the limits.

`tests/receipts.test.mjs` refuses a GPU receipt if any solver source or the limits changed since it was made. It also re-judges every number against the limits instead of trusting the receipt's pass flags.

## The model

- **Equations:** the 2D shallow-water equations for (h, hu, hv) over a bed b. Cell-centred finite volumes on a uniform grid; cell (i, j) sits at an ElevationGrid vertex.
- **Hydrostatic reconstruction (Audusse, Bouchut, Bristeau, Klein & Perthame 2004):**
  - At each face, both sides see h* = max(0, h + b − max(b_L, b_R)).
  - The momentum update adds g/2 (h*²_{east, own side} − h*²_{west, own side}) / dx.
  - The HLL flux is written FL + sL((FL − FR) + sR(UR − UL))/(sR − sL), so equal states return FL to the bit. That's why a lake at rest stays at rest to round-off.
- **HLL wave speeds:** Davis's estimates, with Toro's dry-bed speeds (sR = uL + 2cL into a dry cell).
- **Dry threshold, 1e-4 m:**
  - Below it the velocity is desingularised (Kurganov & Petrova 2007): u = √2 h q / √(h⁴ + 10⁻¹⁶), which is q/h above the threshold.
  - Momentum isn't zeroed. Negative depths are clamped and counted (`clamped`; it was 0 in every gated run).
- **Manning friction**, semi-implicit: q ← q / (1 + dt g n² |u| / h^{4/3}). On the CPU, h^{4/3} uses a Newton cube root (only + − × ÷ √: portable math). The GPU uses `pow`.
- **Fixed dt** = 0.4 dx / (u_cap + √(g h_cap)). For Spring Melt: h_cap 6 m, u_cap 4 m/s, dx 10 m, so dt = 0.343 s and the storm is 31,514 steps. The game shows the measured Courant number (0.23 to 0.30 in the level runs).
- **Boundaries:** walls mirror the normal momentum. Open sides copy the state and *extrapolate the bed's slope* into the ghost cell (see "Before the limits" below).
- **Culvert:** Q = Cd A √(2 g |Δη|), between the mean levels of two rectangles of cells (its pools).
  - The flow is split evenly over the cells.
  - It never takes more than a quarter of the upstream pool in one step.
  - It's computed from the pre-step state in both solvers.
- **The GPU passes per step:**
  1. x-flux → FX, (nx+1) × ny;
  2. y-flux → FY, nx × (ny+1);
  3. update with sources, culverts, friction and max depth → S, ping-pong;
  4. outflow → one texel per step, summed in float64 on read-back.

  All textures are RGBA32F with `EXT_color_buffer_float`. A reduction pass (2 × 2 tree) gives the stored volume, the largest wave speed and the wet count. The GPU solver owns its own WebGL2 context, so it never touches PlayCanvas's GL state.

## The analytic ladder (Node, CPU float64; `npm test`)

| Gate | Grid | Measured | Limit | Wrong twin (must fail) | Twin measured |
|---|---|---|---|---|---|
| Ritter dry dam break, t = 40 s | 800 cells | L1 0.0164; front 0.124 behind; order 0.72 (800→1600) | ≤ 0.022; ≤ 0.16; ≥ 0.4 | HLL without its upwind branches | L1 0.237: **caught** |
| Stoker wet dam break | 800 cells | L1 0.0138; shock 0.0034 | ≤ 0.02; ≤ 0.012 | g h² for g h²/2 | L1 0.127, shock 0.419: **caught** |
| Lake at rest, bumpy bed, dry islands, 2,000 steps | 64 × 64 | max \|u\| 8.7e-15 m/s | ≤ 1e-10 | no hydrostatic reconstruction ("bad maths") | 0.77 m/s: **caught** |
| Thacker planar surface in a paraboloid, 1 period | 200 × 200 | L1 0.120; shoreline centre 0.070 a | ≤ 0.16; ≤ 0.09 | g h² for g h²/2; HLL without branches | 1.36 / 0.88; NaN: **both caught** |
| Volume, closed wet/dry basin, Manning 0.03, 3,600 s | 96 × 96 | \|ΔV\|/V 8.1e-16 | ≤ 1e-12 | films under 1e-4 m zeroed | 1.1e-4: **caught** |
| Manning normal depth (q 2 m²/s, S 1e-3, n 0.03) | 300 cells | 1.466 against 1.469 m (0.15 %) | ≤ 1 % | friction with h for h^{4/3} | 4.2 %: **caught** |
| Culvert orifice, two tanks, to 1,000 s | 41 × 20 | worst 0.17 % | ≤ 1 % | √(g Δh) for √(2 g Δh) | 52 %: **caught** |
| Determinism, bot tape, 20 simulated min | Spring Melt | 0 of 3,502 step hashes differ | 0 | one stroke moved by 10 m | first difference at step 1: **caught** |

Known numbers, reported and not hidden:
- **The Ritter front** (last cell over 1e-3 m) lags the exact point by 12 % of the distance run. The lag doesn't shrink with the grid (exploration: 8.0, 13.3, 13.6 % at 100, 200 and 400 cells). The L1 error converges (order 0.72). First-order fronts are smeared, and the depth threshold that defines "front" sits where the smear is.
- **Thacker** is the hardest rung. First-order HR damps the moving shoreline: L1 0.65, 0.41, 0.23 and 0.12 at 25², 50², 100² and 200², an order of about 0.66 to 0.93. This is the inconsistency Delestre et al. (2012) describe for HR where Δb ≫ h, at the shoreline. The gate sits at 200² for that reason.
- **The non-well-balanced scheme is *more* accurate on Thacker** (L1 0.10 at 50², against 0.41). So it isn't a twin of that gate; the lake at rest is the gate that catches it.
- **Twins the gates did not catch** (exploration, kept as findings):
  - Davis wave speeds at a dry state: Ritter L1 0.0384 against 0.0388. Past the threshold the front is supercritical, so the flux is pure upwind and the dry speed estimate never enters.
  - Zeroing films on Ritter or Thacker.
  - The HLL-without-branches twin moves the Ritter front *closer* (0.011) while ruining its L1.

## The GPU gate (headless Chromium, float32 GPU against float64 CPU in the same page)

| Case | L1 relative difference (limit 1e-3) | Other |
|---|---|---|
| Ritter, 800 | 4.3e-8 | GPU's own L1 against the exact solution 0.0164, the same as the CPU's to 3 digits |
| Stoker, 800 | 4.9e-8 | |
| Thacker, 200² | 1.0e-7 | |
| Lake at rest, 64² | 5.1e-8 | max \|u\| on the GPU 1.9e-6 m/s (limit 1e-5) |
| Volume, 96², 3,600 s | 9.3e-8 | \|ΔV\|/V on the GPU 4.0e-8 (limit 1e-5); the float32 reduction pass reads 1.7e-7 |
| Manning, 300 | 4.4e-5 | |
| *wrong twin*: GPU bad-maths shader on the lake | 1.6e-2 | max \|u\| 0.77 m/s: **caught** on both metrics |

Also run but not gated: the culvert on the GPU (0.18 %), and the zero-films twin on the GPU (1.1e-4). Whole run: about 3 minutes on llvmpipe.

## Spring Melt

The level:
- **Grid:** 128 × 80 cells of 10 m (1.27 × 0.79 km).
- **The town:** 14 houses on the north floodplain behind an old clay levee, which has a low spot at x 900.
- **The farmland:** behind a natural bank ridge. It fills from downstream; it's a washland if someone opens it.
- **The narrows:** a clay sill.
- **The tarn:** still, up in the hills.
- **Inflow:** 30 → 290 → 55 m³/s over 3 h.
- **Budget:** $140,000 at $9/m³ of cut; 30 sandbags at $1,600.

The ElevationGrid heights are the solver's bed, and `tests/level.test.mjs` checks the shipped file is the generator's output.

| Gate | Node CPU | Headless Chromium GPU | Limit |
|---|---|---|---|
| Bot plan: open the washland (cut the ridge, x 440–600), dig the sill, raise the low spot, the rest of the spoil on the crest | 0 of 14 flooded; peak 24.874 m; lowest freeboard 0.39 m; cut = fill = 8,731 m³; $78,581 | same houses; peak 24.874 m | 0 flooded; within budget |
| Naive plan: raise the low spot with earth dug behind it | 4 flooded (`.....XXX..X...`); freeboard −0.23 m | same houses | at least 1 |
| Do nothing | 12 flooded; freeboard −0.44 m | same houses | at least 1 |
| Water ledger, \|stored − (V0 + in − out)\| / (V0 + in) | 1e-15 to 7e-15 | 3.0e-8, 8.1e-8, 6.8e-8 | ≤ 1e-9 (CPU), ≤ 1e-4 (GPU) |
| Earth conservation, \|Σ(b − b0) dx² + barrow\| | 7.9e-11 m³ (bot) | | ≤ 1e-6 m³ |

A whole storm on the GPU took 25 to 27 s of wall time on llvmpipe. In the game, the headless playtest at 16x reached its requested 16.0x (480 simulated s per s) and drew at about 7 fps.

### What the INTEGRITY panel shows, and what it does not prove

- **The coarse reference agrees early and drifts late.** The CPU reference runs on a 2 × 2 coarser grid (64 × 40). Its gauge stage is within 0.1 m of the GPU's at the peak. In the recession it reads 0.28 to 0.30 m lower, which is amber on the panel's own scale (`readout` in the limits). Its stored volume is 19 to 37 % below the GPU's through the storm: the coarse grid smears the ridge cut and the farmland's edge. That's discretisation, not a GPU defect. The same-resolution GPU-against-CPU agreement is the gate above.
- **The ledger cannot see bad maths.** With bad maths on, the naive plan floods 10 houses instead of 4. The still tarn reaches 2.07 m/s, and the gauge drifts 0.84 m from the reference. The water ledger still closes to 5e-7: the non-well-balanced scheme conserves mass and creates momentum. The tarn and the reference catch it; the ledger can't.

## Before the limits (exploration on coarser grids, `tools/explore.mjs`)

Three changes were made in exploration, before `tests/limits.json` was written:
1. **Desingularised velocities.** They replaced zeroing the momentum below 1e-4 m. This didn't change the coarse numbers measurably.
2. **Extrapolated ghost bed at open sides.** With a copied ghost bed, the outlet was flat and its backwater (about h/S = 1.5 km long) raised the Manning reach by 10 %. With the slope continued, the error is 0.3 %.
3. **Culvert pools.** Single-cell culvert ends drained 7 % slow, because HLL's low-Froude dissipation needs a depth step of about 2F/c per face to feed a point sink. Five-by-five pools bring that to 0.35 %.

## Changed after the first run

`tests/limits.json` wasn't edited. These changes came after the first measured runs, with the reason for each:

1. **The determinism hash.** The limits file describes it as covering (h, hu, hv). Its first measured run failed: the twin (one dig stroke on the dry ridge moved by 10 m) gave the same hashes for all 3,502 steps, because nothing wet changes in 20 minutes. The hash now covers h, hu, hv, the maximum depth and **the bed**, and the twin differs from step 1. The limit (0 mismatches) is unchanged.
2. **CPU speed.**
   - Fluxes are skipped across faces with both sides dry.
   - Updates are skipped for dry cells with no flux in or out and no source.
   - Both give the same numbers by construction. All seven ladder gates' metrics and twin verdicts compared equal (JSON string equality) before and after.
3. **The GPU gate's timer.** It stopped at `gl.finish()`, which didn't wait on ANGLE/Vulkan (Thacker read "9 ms"). It now stops after the read-back. Only the informational timings changed.
4. **The level design.** These are level choices, not physics. The level gates were run while shaping it, with the same limits:
   - **The tarn.** It sat on a slope steeper than its own depth, and started dry. It moved to a shelf, and its rim ring was widened so water can't cross it between cells.
   - **The flanks.** Water reached the town round both ends of the levee. A terrace now closes the upstream end, and the rock in the narrows meets the levee's downstream end.
   - **The houses.** Two sat on the river side of the levee where the river bends north; they moved behind it.
   - **The storm and the levee.** Doing nothing flooded one house and the naive patch worked, so the inflow peak rose (205 → 290 m³/s) and the old crest fell (BASE + 1.55 → + 1.15 m, low spot −0.5 m).
   - **The bot.** It now spends its barrow on the crest until cut balances fill.

## Not done

- **Sediment (milestone 4):** the Exner equation, Meyer-Peter–Müller bedload from the Shields number, and the sand, clay, rock and willow erodibilities. The materials exist and set Manning's n, digging rights and colour, but not erosion.
- **Gates:** not built. Sandbags are a tool (a bought 0.6 m raise on one cell). The culvert is gated in the ladder but isn't used in Spring Melt.
- **Hosts:** Firefox, WebKit, a real GPU and a second machine weren't run. GPU determinism isn't claimed: only Node replays tapes.
- **Order of accuracy:** first order in space and time, as specified. A MUSCL or Heun variant would cut the Thacker and Ritter-front gaps.
- **Sound,** and a paired visual review.
