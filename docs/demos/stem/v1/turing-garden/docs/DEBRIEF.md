# Turing Garden: debrief, pass 1 (4 Nov 2026)

The second x3d.STEM flagship, built with the X3D Loom. Grades: **C** = a named tool ran and showed it; **L** = read or reasoned; **S** = suspected or a visual judgement. Every number in the tables comes from the case manifests ([NUMBERS](NUMBERS.html)).

## 1. What it is

Five gardens grown by the same two equations (Gray–Scott reaction–diffusion) in a periodic box of 64³ cells, each from three random seeds. Only two parameters differ between gardens: the feed rate F and the removal rate k. Every 200 time units the activator field v is published as a verified 8-bit or 16-bit field. The browser meshes it itself, as a closed surface, and plays the 41 states through X3D's own event graph (`TimeSensor → IntegerSequencer → Switch`). It never blends two states.

| Garden | F, k | What the builder measured on the last frame (C) |
|---|---|---|
| Dividing spots | 0.0367, 0.0649 | 45 separate pieces, the largest 12 % of the pattern; Euler characteristic 88 (sphere-like blobs and rods); settled |
| Swiss cheese | 0.039, 0.058 | one connected solid filling 78 % of the box, pierced by 83 separate holes; settled |
| Coral network | 0.0545, 0.062 | one network (98 % of the pattern) with handles: Euler characteristic −30; settled |
| Perforated sheets | 0.029, 0.057 | stacked layers, median mean curvature 0.02 (nearly flat), Euler characteristic −74; settled |
| Restless garden | 0.018, 0.051 | still churning at t = 8,000: mean change 0.15 per 200 time units, against 0.0007 to 0.0028 for the settled gardens |

## 2. Witnesses

Fourteen per settled garden and twelve for the restless one, 68 in all, every one green on the final build; each limit was declared in `tools/garden.py` before the first build.

- **Exact references.** Small Fourier modes about the rest state (u, v) = (1, 0) obey the linearized scheme exactly. The u mode along x and the v mode along y and z match (1 + dt λ)ⁿ to 1.2 × 10⁻¹⁰ and 2.7 × 10⁻¹¹, which exercises every stencil direction, both diffusivities and both rates. The total Σ(u + v) changes by exactly dt Σ[F(1 − u) − (F + k)v] each step, because the periodic Laplacian sums to zero; the worst residual over 16,000 steps is 1.9 × 10⁻¹⁴.
- **Numerics.** The observed order in dt of a smooth run is 0.983 to 0.995 (forward Euler is first order). A 2,000-step rerun matches bit for bit. The discrete maximum principle holds at every step: 0 ≤ u ≤ 1, v ≥ 0.
- **Display.** Every frame's mesh is closed (no boundary edges). Its enclosed volume agrees with a Monte Carlo estimate on the field to 0.04 % to 3.3 % (a gross-error check with a 5 % limit). Quantization moves the isosurface by at most 0.013 to 0.049 cells for the four 8-bit gardens and 0.0002 cells for the 16-bit one (99th percentile, worst frame). Mesh vertices sit within 10⁻⁷ cells of the surface they were asked for.
- **Claims.** Each garden's name is a measured claim with declared thresholds: pieces, holes, Euler characteristic, mean curvature, late activity.
- **In the browser (C, Chromium on Apple M3).** The page rebuilds all 41 meshes from the verified fields with a JavaScript port of the mesher. It compares each with the builder's reference: vertex and triangle counts exact, enclosed volume within 10⁻⁶. All 5 × 41 frames match; the worst volume difference is 3 × 10⁻¹⁴.

## 3. What failed, and what it taught

1. **A seed that grows in 2D dies in 3D (C).** Pearson's 6-cell seed vanished within t = 100: diffusion drains it in three directions. Seeds are now 12 cells.
2. **The labyrinth grew as nested squares (C).** Noise only inside the seed left the cubic seed's symmetry intact, and the fronts echoed it outward. Pearson perturbed the whole domain; with domain-wide noise the same parameters grow sheets.
3. **2D names do not carry over (C).** "Labyrinth" and "sponge" become stacked sheets in 3D; "worms" churns and then settles into sheets; "bubbles" dies. The builder now names nothing it has not measured: each name is a claim with thresholds.
4. **The noise broke the bound it was meant to respect (L).** Symmetric noise put u above 1 at t = 0, which would have made the maximum-principle witness meaningless. The noise is now one-sided (u only decreases, v only increases).
5. **One witness measured two things (C).** The first "display quantization" witness went red for every garden with the same value (0.31 cells, at 8 and at 16 bits alike), so the cause was not quantization. It was the t = 0 frame. There the seeds are step functions, and two Newton steps with a central-difference gradient (which spans two cells) left vertices far from the surface. Projection now uses the exact gradient of the trilinear interpolant, the function Newton is actually solving, and converges to 10⁻⁷ cells. Quantization is now measured on its own, as |f₈ − f| / |∇f|.
6. **Precision is chosen to meet the witness (C).** The restless garden's shallow gradients let 8-bit fields move its surface 0.058 cells, over the 0.05 limit. The builder tries 8 bits and publishes 16 bits for any garden that fails. The first red run is kept in `evidence/history/`.
7. **Plain surface nets shrink convex shapes (C).** Against an exact sphere and torus the volume came out 0.97 % and 1.99 % small. Most of this is expected: the trilinear interpolant of a convex distance field lies inside it, and a polyhedron with vertices on a convex surface is inscribed. The stemkit tests now hold these as characterization bounds, and the study's volume witness is labelled a gross-error check.
8. **Playback froze silently (C).** X_ITE 16.5.1 has no `Browser.currentTime`, so the TimeSensor's start time was NaN. It reported itself active and sent no events. The page now uses `getCurrentTime()` and refuses a non-finite start.

9. **A loading race, found on a later page (C, fixed 5 Nov).** A case change that arrived while the X3D scene was still loading reached the loader before the scene existed (Loom failure mode 78, first seen on the Electron Cloud page). Navigation is now wired only once the scene is ready; the browser evidence reproduces the race and must land on the new case. The page's mesher was also synced to the shared `lib/stemkit/js/nets.js` (identical output for these unsigned fields).

## 4. Limits (also in every case manifest)

A nondimensional model on a 64-cell periodic box: no real chemistry, and patterns a few wavelengths across. Forward Euler is first order in time; the restless garden's details depend on dt and on rounding, so only its statistics are claims. The skin is the level v = 0.2 of the published field. The box walls are cut faces, not physics, and pieces and holes are counted in the box as shown, not periodically. Browser observations are from a headless Chromium on one machine; no frame rate is claimed.

## 5. Next pass

- Tier C: an offline path-traced film of the coral growing (Blender Cycles from the same verified meshes), and a dome-format time-lapse.
- A parameter-plane explorer: a coarse (F, k) map in 3D, each point a measured morphology, so visitors can see where the five gardens sit.
- Colour by a second computed field (u, or the local growth rate) as a Lab-lens option.
- Grow on a curved surface or inside a shape (a shell, a leaf), where the pattern meets geometry.
