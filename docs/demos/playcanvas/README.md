# PlayCanvas × X3D (Demos 89–92)

Four KANSEI physics games whose worlds are X3D 4.0 files, drawn by PlayCanvas. The section page is `index.html`; each game sits in its own `v1/` folder, unchanged from its kit apart from the review fixes below, and runs on its own (`npm start`, no install, no build).

| Demo | Game | The physics | What X3D carries |
|---|---|---|---|
| 89 | [HAUL](haul/v1/) | 240 Hz 6x6 truck and trailer on Ammo (Bullet): suspension, relaxation-length tyres, diesel and EV drivelines | the truck, the trailer, five ElevationGrid levels with `kansei:haul-level` metadata |
| 90 | [TIDEWRIGHT](tidewright/v1/) | shallow-water equations, well-balanced, on WebGL2, against a CPU reference | the Spring Melt valley |
| 91 | [THERMAL](thermal/v1/) | lattice Boltzmann air (D2Q9 MRT with Smagorinsky, D2Q5 heat) on WebGL2 | the Ridge Day ridge and the glider |
| 92 | [SLAB](slab/v1/) | MLS-MPM snow with APIC, a Mohr-Coulomb weak layer, on WebGL2 | the mountain, the skier, and every saved snowpack (F9 saves; drop a file to resume) |

## Measured (2026-11-28)

| Check | Result | Behind it |
|---|---|---|
| Gates, HAUL | 17 of 17 pass | `npm test`, Node 23.7.0, in this folder |
| Gates, TIDEWRIGHT | 16 of 16 pass | same |
| Gates, THERMAL | 16 of 17 pass, 1 todo: the lee wave fails as written (42.4 cells against a limit of 40, 6 % off), as the game's docs say | same |
| Gates, SLAB | 15 of 16 pass, 1 todo: the angle of repose fails as written, see `slab/v1/docs/PHYSICS.md` | same |
| Live, SLAB | INTEGRITY panel: PASS, 1264 particles over 100 steps, GPU against the CPU reference | Chromium in the Claude desktop app's browser pane, Apple M3 (ANGLE Metal), 0 console errors |
| Live, TIDEWRIGHT | bot plan at 16x: 14 of 14 houses dry; ledger residual 9.9e-8; still tarn 1.8e-5 m/s; gauge against the coarse CPU reference green (+0.09 to −0.04 m) from 1:09 to 1:45. One red reading early in the rising limb at 0:19 (−0.575 m), not described in the game's docs | same |
| Live, THERMAL | flies, 0 console errors; the live GPU-vs-CPU window had not completed when the pane was backgrounded | same; **not verified live** (the committed receipt is checked by the gates) |
| Live, HAUL | loads with Ammo's wasm, 0 console errors; level cards 1–5 and 0 | same |
| Static hosting | each game loads from its folder by relative paths; nothing needs a server beyond static files | the preview server above |

Grades: the gate rows are **Confirmed** on this machine. Frame rates, sound, phones, other GPUs and Safari are **not measured**.

## Review fixes (on top of the kits)

- **The dev server** (`tools/serve.mjs`, all four) now listens on `127.0.0.1` only (it listened on every interface) and checks a directory boundary instead of a bare prefix: a path like `/../slab2/…` resolves into a sibling folder whose name starts with the game's, and passed the old check (read from the code); it is now refused (403, checked with three encodings).
- **SLAB's server** announced itself as "HAUL"; it now says SLAB.
- **HAUL's Test Hill card** showed "T", but the key that loads it is 0; the card now shows 0.
- **SLAB's licence**: its `package.json` says MIT, but the kit had no `LICENSE` file; the MIT text the other three games ship is added.

## Not included

- `x3d-atlas-real.html` from the same bundle is an X_ITE page, not a PlayCanvas one, so it is not in this section.
- The kits' scripts created a repository per game; here the games live in this section instead.

## Where this is going

The handoff's thesis is to make X3D the game's **save file**, not just its import format. The acceptance test: save a moment in the game, open it in Blender, raise a hill, play it again, with a generated ledger listing every field that does not survive. SLAB already saves and resumes its snowpack as X3D. The shared reader (`src/game/x3d-pc.js`) is the same about 150 lines in each game and reads about 11 of X3D's ~260 node types; the planned rounds turn it into one codec with export.

Credit and licences: `NOTICE.md`.
