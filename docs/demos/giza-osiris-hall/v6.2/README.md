# Giza VI.2: readable ledger without graphics

New version folder; v6 and v6.1 are untouched and still live. VI.2 is v6.1 with two fixes from the second external
review (18 Nov 2026). Engine, story, ledger data, assets and the X3D twin still load from `../v6/` unchanged.

| Defect | v6.1 | v6.2 |
|---|---|---|
| 7: no-graphics ledger | read rows as arrays (`r[0]`..`r[4]`) but `story.mjs` exports objects `{id, g, claim, from, src, url}`: 33 rows, 132 cells reading "undefined", 0 of 23 links | named fields written as DOM text (nothing from the ledger is parsed as HTML); only http(s) links kept; 33 rows, 0 undefined, 23 of 23 links |
| 10: slow start | `gfx-guard.js` v1 appended only the STYLE element, so the "taking longer" note never showed | `gfx-guard-v2.js`: the whole note shows, and is removed once the page is ready |
| guard check | counted rows only (`ledgerRows: 33` passed with every cell undefined) | compares every row with `story.mjs` field by field: id, grade letter and name, claim, from, source, link |

Checked 18 Nov 2026 with `tools/assurance/check_giza_ledger.cjs` (Playwright 1.63.0, headless Chromium, WebGL
disabled): v6.2 pass, 0 mismatches; the same check on v6.1 fails with 188 mismatches. With SwiftShader WebGL the page
reaches `ready` with no page errors. See `GUARD-CHECK.json`. A real-GPU run has not been done (Suspected: same result).
