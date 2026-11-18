# Giza VI.1: start-up guard

New version folder; v6 is untouched and still live. VI.1 is v6 plus one thing: an explicit failure state when the
3D view cannot start (external accountability review, 18 Nov 2026, defect 9). Everything else (engine, story,
ledger, assets, X3D twin) is loaded from `../v6/` unchanged.

| Case | v6 | v6.1 |
|---|---|---|
| WebGL unavailable (blocked GPU, hardware acceleration off) | boot overlay "Baking stone textures..." forever; engine throws at module top level before `boot()` and its catch exist | panel with the reason, what to try (`chrome://gpu`), a committed still, links that need no graphics, and the full ledger read from `story.mjs` |
| Script error during start-up | boot overlay forever | same panel, with the error message |
| Slow software rendering | overlay | overlay plus a "taking longer than expected" note after 60 s; it keeps trying |
| WebGL works | plays | plays (same code) |

The guard is shared: `docs/lib/gfx-guard.js`. Outcomes are logged as `[gfx-guard]` on the console and kept on
`window.GfxGuard.state`. Checked with headless Chromium (Playwright, preinstalled build), WebGL disabled and enabled;
see `GUARD-CHECK.json`.
