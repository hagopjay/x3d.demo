# Electron Cloud Observatory: debrief, pass 1 (4 Nov 2026)

The third x3d.STEM flagship, built with the X3D Loom. Grades: **C** = a named tool ran and showed it; **L** = read or reasoned; **S** = suspected or a visual judgement. Every witness number is in [NUMBERS](NUMBERS.html), generated from the case manifests.

## 1. What it is

Hydrogen has an exact solution, so this study solves it numerically anyway and holds the solver to the exact answers. The radial equation is solved by finite differences (a 0.01-bohr grid to 200 bohr, the lowest eigenpairs of a tridiagonal matrix). Each 3D state is that numerical radial function times a real spherical harmonic, published as a verified 80³ field. The page meshes each field itself where the cloud encloses 90 % (or 50 or 99 %) of the probability, colours the skin by the sign of the wave, and cuts it open with an X3D ClipPlane.

- **Ten orbitals**: 1s, 2s, 2p_z, 3s, 3d_z², 3d_xy, 4f_z³, 4f_xyz, 4f_y(3x²−y²), 5g_z⁴.
- **Lyman-α, an atom that rings**: half in 1s and half in 2p_z. Neither state moves on its own; mixed, they beat. Over 24 computed states of one period (0.405 fs), the charge centre swings ±0.745 bohr through the nucleus at 2.47 × 10¹⁵ Hz. That motion radiates hydrogen's brightest ultraviolet line, at 121.50 nm in this model. Playback runs on X3D's own `TimeSensor → IntegerSequencer → Switch` route, and the charge bead moves to each frame's computed centre.

## 2. Witnesses (C)

156 in all, every one green on the final build; limits were declared in `tools/cloud.py` before the first build.

- **Exact references.** Energies match −1/(2n²) to 2.5 × 10⁻⁵ at h = 0.01 bohr. The observed order in h is 2 within 0.01, and Richardson extrapolation over h and 2h brings every energy within 5 × 10⁻⁹. Hydrogen's accidental degeneracy (E independent of l) holds to 4 × 10⁻¹⁰. Radial functions match the Laguerre forms to 1.5 × 10⁻⁵, ⟨r⟩ = (3n² − l(l+1))/2 to 1.7 × 10⁻⁵, the virial theorem ⟨V⟩ = 2E to 5 × 10⁻⁵, and every radial node count is exact.
- **Lyman-α.** E₂ − E₁ = 3/8 hartree to 7 × 10⁻⁹, and ⟨1s|z|2p_z⟩ = 128√2/243 to 3.4 × 10⁻⁵. On the 3D frames the charge centre swings with the exact dipole amplitude to 4.1 × 10⁻⁵, which checks the harmonics, the assembly and the time dependence together. The wavelength witness (4/(3R∞) = 121.5023 nm, to 7 × 10⁻⁹) is a units check: its error equals the energy's, as it should.
- **Display.** Every mesh is closed. Enclosed volumes agree with a Monte Carlo estimate on the field to 0.8 %. 16-bit fields move the surface by at most 0.0013 cells. For 1s, the 90 % surface sits at 2.661 bohr on average, against the analytic 2.6612 (0.25 %): an exact control for the whole level-and-mesh pipeline.
- **In the browser (Chromium, Apple M3).** The page rebuilt all 34 meshes (ten orbitals and 24 Lyman frames) from the verified fields and matched the builder: counts exact, worst volume difference 7 × 10⁻¹⁵. Playback followed the X3D route at 6 frames per second, the charge bead moved on every sample, and pause held.

## 3. What failed, and what it taught

1. **Limits declared from an incomplete exploration (C).** The 3D normalization limit (5 × 10⁻⁴) was set after measuring 1s, 2p, 3d, 4f and 5g, but not 2s, 3s or the superposition. On the first build 3s (8.2 × 10⁻⁴) and the Lyman frames (7.6 × 10⁻⁴) went red. The cause was resolution: the 80³ display grid samples the s-state cusp at the nucleus coarsely in a large box. Doubling the grid shrank the deficit 4 to 10 times (observed order 3.4 to 4), and the extrapolated norms sat within the 10⁻⁴ tail the box leaves out by design. The witness now measures the assembly on a 160³ check grid with the same limit. The display grid's sum is reported as a metric, and display fidelity is gated by the quantization and mesh witnesses. The first red runs are in `evidence/history/`.
2. **`const top` broke the page (C).** In a classic script a top-level `const top` collides with the browser's `window.top`, and nothing ran. Renamed.
3. **A hash change while the scene loaded reached `load()` with no scene (C).** The hashchange listener is now registered only once the scene is ready, and a hash that changed during loading is routed afterwards. The Turing Garden page has the same latent race (its next pass).
4. **Carried over, not repeated:** components were declared from the start (Shape level 2 for PhysicalMaterial, Loom failure mode 73), the clock is `getCurrentTime()` (72), normalization and display are separate witnesses (70), and the mesher is the shared `lib/stemkit/js/nets.js` with a test that keeps the copy identical.

## 4. Limits (also in every case manifest)

Non-relativistic hydrogen with an infinitely heavy nucleus: no fine structure, spin, Lamb shift or reduced-mass correction, so the real Lyman-α line (121.567 nm) differs from the model's 121.502 nm. The cloud has no edge; the skin is a level enclosing a share of the probability on the grid. Each state has its own box, so states are not drawn to one scale (the page states the box width). Browser observations are one headless Chromium on one machine; no frame rate is claimed.

## 5. Next pass

- An energy-ladder view: all states on one scale, with the Lyman and Balmer transitions as lines whose colours are their computed wavelengths.
- Complex orbitals (m = ±1) coloured by phase, with the probability current shown as streamlines.
- The Stark effect: a field mixes 2s and 2p and the cloud leans, against the exact linear shift ±3F.
- Helium by Hartree–Fock, where no exact answer exists, so the witnesses become refinement and the measured ionization energy.
