# Vortex Reconnection & Sound: debrief, pass 1 (5 Nov 2026)

The sixth x3d.STEM flagship, built with the X3D Loom. Grades: **C** = a named tool ran and showed it; **L** = read or reasoned; **S** = suspected or a visual judgement. Every witness number is in [NUMBERS](NUMBERS.html), generated from the case manifests.

## 1. What it is

A quantum fluid (the Gross–Pitaevskii equation) in a periodic box, solved by split-step Fourier on two grids (96³ and 128³). Whirlpools in this fluid are quantized: each vortex line is a thread where the fluid's wave vanishes and its phase winds once round. The page meshes those threads itself from verified density fields, as tubes where the density falls to a quarter. A slice through the fluid shows sound as orange (denser) and blue (thinner) ripples. Both cases play through X3D's own `TimeSensor → IntegerSequencer → Switch` route.

- **A vortex ring**: a smoke ring in the superfluid, radius 7.6 healing lengths, carried along by its own flow.
- **Two rings collide**: two rings meet off-centre. At t ≈ 48.5 the loop count goes 2 → 1 → 2: the lines cut and swap partners, two kinked new rings fly apart, and the snap sends sound through the fluid.

The Scientific Loom left its vortex topology as a gate it could not run. Here the page calls the event a reconnection only because the topology witness passed.

## 2. Witnesses (C)

21 in all, every one green on the final build. Limits were declared in `tools/vortex.py` before the first build.

- **Sound, exact.** Small waves on the calm fluid oscillate at the Bogoliubov frequency ω = k√(1 + k²/4) to within 4 × 10⁻⁶ to 1.1 × 10⁻⁴ at three wavenumbers. The error falls at observed order 2.0006 in dt, as the Strang scheme should.
- **Conservation.** The norm is conserved to 10⁻¹⁴ (every sub-step is exactly unitary), and the energy drifts by 3 × 10⁻⁶ or less.
- **The ring (grade L for the reference).** Its speed, 0.2660, is within 3.1 % of Roberts and Grant's large-ring formula plus a periodic-box speed-up of 2π²R²/L³. That box term's sign and size were *measured* in exploration from two box sizes, which is why the witness is graded L. The speed changes by 0.38 % between the grids.
- **Topology before claims.** Both grids give the same loop sequence (2 → 1 → 2), with the events 1.0 time unit apart at most (t = 47.5 / 48.5 for the merge, 49.5 / 49.5 for the split).
- **Sound from the snap.** The compressible kinetic energy, 5 to 15 time units after the reconnection, is 1.57 times its value before (98 against 63).
- **Display.** Every core mesh is closed. 8-bit density moves the core surface by at most 0.010 cells, with no clipping.
- **In the browser (Chromium, Apple M3).** The page meshed all 96 frames' vortex cores and matched the builder: counts exact, worst volume difference 8 × 10⁻¹⁵. Playback followed the route and held on pause.

## 3. What failed, and what it taught

1. **The vortex detector had the wrong geometry (C).** It marked cells beside a pierced face in the face's own plane, not on either side of it. That can leave gaps along a line, and a single ring read as two loops. It now marks along the face normal. Tested on one ring, it reads one loop.
2. **A plausible cause, tested and rejected (C).** A ring ran 7 to 14 % faster than the reference. I blamed the non-periodic initial phase, but making it periodic changed nothing. Changing the resolution changed 0.5 %. Changing only the box size showed the cause: periodic images speed rings up. My first correction had the right size and the wrong sign.
3. **A planned witness the data could not support (C).** The separation of the strands near the reconnection should scale like |t − tᵣ|^½. At this resolution, with one sample per time unit, the fitted exponent ranged from 0.46 to 0.84 depending on the window. It is reported, not gated.
4. **Rough starting cores shed sound (C).** Before a short imaginary-time relaxation the energy drifted by 2 × 10⁻³; after it, by 3 × 10⁻⁶.
5. **Carried over from the X_ITE teardown (C).** One exception escaping an X_ITE field callback freezes every route in a scene; this was reproduced on the Turing Garden page. This page's callback catches its own errors.

## 4. Limits (also in every case manifest)

- **The model:** a zero-temperature, weakly interacting superfluid, with no thermal cloud, normal fluid or dissipation. Real superfluid helium has cores about an ångström across and is strongly interacting.
- **The periodic box:** rings feel their images, and sound wraps round rather than leaving.
- **The start:** rings begin from an approximate profile with a short relaxation.
- **Resolution:** vortex positions come from a grid of 0.5 (0.71 healing lengths).

## 5. Next pass

- A finer grid (192³ or 256³ on a GPU workstation, Tier B) to gate the |t − tᵣ|^½ law.
- Kelvin waves along a single line, against their exact dispersion relation.
- A vortex tangle decaying into sound: turbulence that ends as noise.
- Sonify the compressible energy, so the snap can be heard.
