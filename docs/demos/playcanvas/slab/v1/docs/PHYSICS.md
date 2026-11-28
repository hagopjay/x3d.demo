# SLAB physics: the model, the gates, and what changed after the first runs

SLAB has three layers:

- **Snow:** a 2D MLS-MPM solver (Hu et al. 2018) with APIC transfers (Jiang et al. 2015) and quadratic B-splines, in float64 (`src/sim/mpm.js`). It is the reference.
- **GPU port:** the same step written as WebGL2 shaders (`src/gpu/mpm-gl.js`), judged against the CPU file.
- **Save format:** X3D 4.0 (`src/x3d/snapshot.js`). A snapshot resumes bit-exactly, and its PointSet shows the snowpack in any X3D browser.

All limits are in `tests/limits.json`, committed (`b7f99c1`) before any gated run and never edited. Receipts live in `receipts/`. A gate that failed as written stays failed. Every number below comes from those receipts, measured with Node 22.23.5, with headless Chromium 158 for the GPU gate.

## Materials

| Material | Model | Used for |
|---|---|---|
| Elastic | fixed-corotated, no plasticity | gates: momentum, energy, P-wave |
| Snow | Stomakhin et al. (2013): singular values clamped to [1 − 0.025, 1 + 0.0075], hardening exp(10 (1 − Jp)) | the slab |
| Granular | Hencky elasticity with a plane Mohr–Coulomb return (Drucker–Prager in 2D, after Klár et al. 2016); cohesion c, non-dilatant (ψ = 0), tension cut-off at the apex; optional strain softening of c with accumulated plastic shear | the weak layer (and the repose grains) |

## Gates

| Gate | Measured | Limit | Wrong twin |
|---|---|---|---|
| Momentum, spinning elastic disc, 1000 steps | linear 5.7e-15, angular 2.7e-16 (relative) | 1e-10 / 1e-9 | PIC: angular 0.157, caught · FLIP: 4.4e-4, caught |
| Energy never rises (disc + granular collapse) | max rise 1.8e-6 of E(0) | 1e-4 | FLIP: energy ×604, caught |
| Repose, cohesionless column, aspect 0.5 | **FAILS as written:** flank 21.1° | φ = 30° ± 5° | no return mapping: the column stands (no flank), caught |
| Infinite slope, periodic, 0.6 m slab on a 0.15 m weak layer | releases at **33.24°** (bracket 33.13–33.36°) | Davis 34.18° ± 1.0°; naive referee at least 2° away (it is at 39.09°) | weak layer given the slab's strength: holds at 50°, caught |
| P-wave, standing wave, 32 cells | −0.42% (18.27 vs 18.34 m/s) | 2% | stress factor 2/dx²: −29.6%, caught |
| Determinism, 2000 steps | 0 mismatches | 0 | 1e-12 m nudge: differs, caught |
| X3D save-and-resume, 1000 + 1000 steps through a 355 KB X3D file | bit-exact | 0 mismatches | doubles written as float32: differs; C left out: differs. Both caught |
| GPU vs CPU, disc onto a sticky floor, 300 steps | \|Δx\| 1.5e-5 m, \|Δv\| 3.0e-5 m/s | 1e-4 m / 1e-3 m/s | PIC shader: \|Δv\| 0.37 m/s, caught |
| Levels: every `kansei:referee` claim re-proven | see `receipts/levels.json` | each claim | the naive skier and doing nothing are the twins |

The GPU gate ran on ANGLE over Mesa llvmpipe, a software rasteriser. No real GPU has been measured.

## Two findings

**1. The design's slope referee was wrong for this model, and the solver says so.**

- The design doc judged slope failure by τ = c + σ tanφ. That is the strength of a Mohr–Coulomb layer whose flow is *associated* (dilatancy ψ = φ).
- The return map here is non-dilatant (ψ = 0). Davis (1968) gives the simple-shear strength of such a layer as τ = c cosφ + σ sinφ.
- The solver releases 0.94° from Davis and 5.85° from the naive form.
- The same correction explains repose. A cohesionless ψ = 0 slope stands at atan(sin φ) = 26.57°, not at φ = 30°.
- A quasi-static diagnostic (the infinite slope with c = 0, `tools/diag-repose.mjs`, `receipts/diag-repose.json`) releases at 26.95°.
- The repose gate's own collapse case settles lower again, at 21.1°, because a collapsing column overshoots.
- So the repose gate fails because its committed referee was wrong, and it stays failed.

**2. Thin slabs are the dangerous ones.**

- The Föhn-style index (Flamant line load of 780 N/m, Föhn 1987) predicts that a skier's extra shear falls off as 1/depth.
- 0.35–0.4 m slabs hold by themselves with a 28–47% margin, yet still fail under a skier.
- The solver agrees: on the bowl, nothing moves with no skier, and a skier crossing it releases the slab.

## Changed after the first run

1. **P-wave set-up.** The material ended exactly at the slip walls, so the walls never carried its edge traction. The column sloshed vertically (|v_y| up to 0.82 A) and the gate read +7.0%. The first run is kept in `receipts/gates-first-run.json`. The material now runs into the wall node rows. The error converges at second order: −0.42%, −0.11%, −0.03% at 32, 64 and 128 cells.
    - The same bed (one cell of grains inside the floor's node rows) was then given to the repose and slope cases before their first runs.
2. **Level design, iterated on the first runs** (first receipt kept as `receipts/levels-first-run.json`):
    - **Snowpack toe.** A snowpack ending in a cliff released by itself, so the toe now tapers off at the foot of the pitch.
    - **Bonding.** Strain softening starts only once the pack has settled ("sintering"). Plastic shear from the settling itself is reset.
    - **Weak-layer stiffness.** Its Poisson ratio is 0.45, standing in for the creep that makes a real snowpack's lateral stress nearly isotropic (K0 = 0.82). At ν = 0.2 (K0 = 0.25) the settled layer sat at yield and every steep slope crept off by itself.
    - **Slabs.** They are thin (0.3–0.4 m), and c is solved so the skier index on the deadly pitch is 0.9. Safe lines are at 16°.
    - **Wind Lip.** The slab was thinned from 0.4 to 0.3 m after it released by itself.
    - **The patrol bot.** It now charges at the top of the convex roll; a charge 2 m lower left hangfire that a skier later released. It also waits until the debris has rested for 1 s.
3. **Detectors in `src/sim/run.js`** (not part of the limits):
    - "Released" changed from "20% of the slab faster than 1 m/s" to "half of the pitch's slab has moved 0.5 m". The bowl's released slab slides at about 1 m/s, which the speed rule missed.
    - "Caught" now needs at least 0.3 m² (per metre of width) of moving slab within 1.5 m. A few centimetres of sluff under the skis was counting as a burial.
4. **SVD sign bug.** It was found by a unit check before any gate ran: the V matrix was transposed. Listed here for completeness.

## Not done

- **The levels run on the CPU solver.** The WebGL2 port is gated and checked live in the INTEGRITY panel, but level play (skier load, charge, caught-skier body) is not wired to it yet. On llvmpipe the CPU is about 9× faster than the GPU path anyway.
- **No 3D.** There is no 3D MPM. The slice is 2D under each line, inside a 3D rendered X3D mountain.
- **Only 3 of the 5 designed levels.** The Cornice and the Persistent Layer (remote triggering) are missing.
- **Not tested** on a real GPU, Firefox, WebKit or a second machine. Only Node is claimed to be deterministic.
- **The airbag** (a bigger, less dense disc in the debris) is in the game, but buoyancy is not gated.
