# Roadmap and backlog

Ranked by value for the next heavy development cycle. Effort: S under half a day, M a day or two, L several days. Each item names how it is verified, so "done" is not a matter of opinion.

## Next (high value, mostly independent)

| # | Item | Effort | Done when |
| --- | --- | --- | --- |
| 1 | **Screenshot regression.** Capture the 16 named views at 1280x800 and 390x844 and diff against stored references with a tolerance | M | `make shots` fails on a layout or lighting regression; references stored under `tests/shots/` |
| 2 | **Real-GPU pass.** Run `make smoke` plus frame timing on one integrated and one discrete GPU; record fps per view and per quality tier | S (needs hardware) | Table of fps with browser, GPU and driver named, added to `VALIDATION.md` |
| 3 | **Gate in CI.** Check out `x3d_mcp` in the workflow and run `make gate` on every scene change | S | Workflow job red when `validation-v3.json` bytes do not match the scene |
| 4 | **Reopen every source link.** Script a link check (HTTP status, redirect, archive fallback) over the 128 links, then manually re-read the 3 never-opened ones | M | `research-log.md` gains a dated pass; 128 of 128 handled |
| 5 | **Proper-motion sky.** Add Gaia/HYG proper motions so Orion's Belt drift over 13,000 years is shown, not only precession | L | Tests against ERFA reference values at 5 epochs; `SKY-MODEL.md` limits updated |
| 6 | **Tour editor.** Author tours as data (`tour.json`) with a small UI to record camera, layers, light and caption per stop | M | A new tour recorded in the page replays identically after reload |

## Soon

- Accessibility pass: keyboard focus order in the dock and modals, ARIA on the lens chips, reduced-motion respect for the guided descent (S, verified with axe and a keyboard-only run).
- Session files: add a version migration hook so future `giza-evidence-atlas-session/v2` imports v1 (S).
- Light states: a fifth state (dusk) needs a new Cycles bake, so the binary layout changes; do it together with a layout-version field in `states.json` (M).
- Evidence index: generate it from `content.json` and the scene instead of hand-recorded counts (S).
- Offline bundle: move `dist/giza-atlas-v3.zip` creation into a release workflow with a SHA-256 in the release notes (S).

## Later and speculative

- Replace the schematic Khafre and Hall geometry with survey-derived meshes where public data exist (L, and only with sources that carry a licence).
- Georeference the local frame to a real datum with stated uncertainty (L).
- A second engine check (Babylon or Blender import) of the same scene, to see which differences are X_ITE-specific (M).
- WebGPU path once X_ITE supports it for this scene (blocked upstream).

## Not planned

Excavation claims, new "discoveries", or anything that presents the speculative layers as findings. The study's job is to keep the imagined visible as imagined.

## Backlog hygiene

One line per item here with a number; reference it in commit messages (`roadmap #3`). When an item ships, move it to a dated "Done" list below and leave the number retired.

### Done

- 17 Nov 2026: v3 assembled from the Evidence Atlas upgrade; first fresh XSD, semantic and profile gate of the enhanced scene (see `validation-v3.json`); `make` loop, smoke test and CI added.
