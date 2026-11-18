# D3 to X3D Bridge v2.2

A hygiene release of v2.1. The folders `../v2.1/`, `../v2/` and `../v1/` are untouched. The scenes draw the same thing, and the page, the data and the interaction are unchanged. What changed is how much the scene files say that the checker has to ignore.

**What v2.1's receipt held (Confirmed, x3d_mcp `semantic_diagnostics`, main fa5dccf).** Its 1,369 "semantic warnings" were two kinds of finding. 64 were `empty-group` warnings: the empty `<Group/>` used as the far level of each decluttered label's LOD. The other 1,305 were `unused-def` notes, which the checker grades as info, not warning. They were names on cached Appearances, lights and Viewpoints that nothing in the file referred to. v2.1's `validate.py` counted every non-error finding as a warning, which hid that split.

| Change | Where | Effect |
|---|---|---|
| DEF hygiene pass: a name is kept only when the scene USEs it, a ROUTE names it, or the page reaches it through SAI `getNamedNode` | `tools/x3d3.mjs` (wraps `x3d2.mjs`), `defHygiene()` | 611 unused names removed across the 16 scenes; counts per scene are under `defs` in `manifest.json` |
| Page-addressed names (Viewpoints `VPn`, `CLOCK`, `SQUASH`, chord `CMn`/`CTn`, living-graph `Nn`/`NMn`/`NTn`/`Hn`/`EC`) are declared with `<EXPORT localDEF AS>` | same pass | The scene states its public interface, and a checker sees those names as referenced. EXPORT is the X3D statement for names that something outside the file may reach. Here the outside reader is the page, not a parent Inline. |
| The far level of a decluttered label is `<WorldInfo info='"far level: label hidden"'/>` instead of `<Group/>` | same pass | It draws nothing, as before. WorldInfo is a valid child node, and it says why the level exists. |
| `validate.py` reports warnings and info separately: `semanticWarnings` (full list), `semanticInfo` (count) and `semanticInfoByCheck` | `tools/validate.py` | The receipt can no longer merge the two grades |
| `shoot3.js` renamed to `shoot3.cjs` | `tools/` | It is CommonJS, and the `"type": "module"` in `tools/package.json` stopped it running from `tools/` in v2.1 |

**Checks (Confirmed, 18 Nov 2026).**
- XSD + semantic: 16 of 16 pass, with **0 semantic warnings and 0 info notes** (`receipt-xsd.json`; x3d_mcp `validate_xml` + `semantic_diagnostics`, main fa5dccf, lxml 6.1.3). v2.1 had 64 warnings and 1,305 info notes.
- Browser: headless Chromium, SwiftShader, X_ITE 16.6.0. 16 of 16 scenes load, every viewpoint is found (sankey 8, globe 4), and there are 0 console errors (`receipt-browser.json`). Interaction checks match v2.1: chord isolate leaves 1 of 91 arches opaque and restore brings back 91 of 91; the living graph shows 144 of 144 nodes and 757 edges at the last demo, 41 nodes and 65 edges at demo 5, and isolating `hypergraph` leaves 19 nodes opaque.
- No WebGL: 0 console errors, fallback frame shown, 16 tiles, 16 matrix rows (`receipt-no-webgl.json`).

**Limits.** The page-name list is a regular expression in `x3d3.mjs` (`PAGE_NAMES`) and is kept by hand to match `index.html`. A new SAI name in the page has to be added there, or the pass will strip its DEF. The browser run would catch that, since `getNamedNode` would throw. No GPU, phone or headset run was made.

**Rebuild.** In `tools/`: `npm ci`, `npm run build` (runs `build22.mjs`), `npm run validate`. To re-run the browser receipts, serve this folder and run `node shoot3.cjs .. <port>`; `NOGL=1` gives the no-WebGL run. Everything else (data, sources, licences) is as in v1's NOTICE.
