# Giza: Osiris Shaft and Hall of Records (X3D study, v1)

A schematic X3D 4.0 scene (Immersive profile) drawn by X_ITE 16.6.0 (bundled in `vendor/x_ite/`, own LICENSE.md). `build_scene.py` writes `giza-osiris-hall.x3d`; the geometry is generated and CC0. Claims keep their own authors; each one is in the page's ledger with its source and a grade (Confirmed / Likely / Suspected).

**Three tiers, three colours.** Documented (cyan), theorized (amber), speculative (magenta). Layer switches are three `Switch` nodes (`SW_DOC`, `SW_THE`, `SW_SPE`); views are `Viewpoint` nodes; the guided descent is a Viewpoint inside a Transform driven by Position and Orientation interpolators.

**What is invented (Confirmed).** Every underground position; the cross-sections of the shafts; the size of Chamber A, of the Hall, of the passage; the Khufu inner layout; the shaft radius, spiral pitch and cube placement of the "648 m" claim; the "one system" links. The Sphinx is massing only.

**Checks (run 13 Nov 2026).**
| Check | Result | Tool |
|---|---|---|
| XSD 4.0, semantic, profile | valid, 0 errors, 0 warnings (12 info notes: DEFs used from the page) | x3d_mcp validator, main 13121b6 (`validation.json`) |
| Render, 6 views, no page errors | Confirmed | X_ITE 16.6.0, headless Chromium, SwiftShader software GL; not timed |
| Sources | web-search summaries; primary papers not opened (see ledger grades) | WebSearch, 13 Nov 2026 |

The Osiris rows carry over the 24 Oct 2026 ledger of the Giza v2.1 build. The page does not endorse the Cayce or "648 m" ideas; it draws them so they can be set against the measured size of everything else.
