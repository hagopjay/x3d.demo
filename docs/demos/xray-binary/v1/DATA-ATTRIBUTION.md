# Demo 74 (xray-binary/v1): sources, attribution and takedown

The scene, page, build scripts and data records in this folder are this project's own work (CC BY 4.0).
Naming a source below is credit, not a claim of ownership or endorsement. This page is not legal advice.

| what | source | owner / author | licence or terms | status |
|---|---|---|---|---|
| target binary `crackme1` | `targets/crackme1.c` + `gen_strings.py` in [hagopjay/x3d.xray](https://github.com/hagopjay/x3d.xray/tree/main/targets) | self-authored for this project by an AI build agent working for the project owner (23 Nov 2026) | same as x3d.xray | own work; a benign teaching target with no payload. The compiled binary is **not** committed; build it from source (see README) |
| ptrace probe `ptrace_shim.c` | x3d.xray `targets/ptrace_shim.c` | same agent, same date | same as x3d.xray | own work |
| hypothesis ledger H1-H5 (imported) | the outside agent's `hypotheses.csv` (re-lab container) | that agent, for the project owner | project-internal | every row re-run here; only the re-run verdicts are shown as results |
| method | ioma8, ["LLM assisted reverse engineering"](https://www.slowchronicle.com/posts/llm-assisted-reverse-engineering), Slow Chronicle, 18 Nov 2026 | ioma8 | © 2026 ioma8, all rights reserved | **credited, not copied**: no text or code from the article is reproduced; the hypothesis-CSV loop it describes is implemented independently |
| renderer | X_ITE 16.7.1 (vendored in Demo 56, `blenderizer-nexus/v1/observatory/vendor/x_ite/`) | create3000 / Holger Seelig | GPL-3.0 | licensed, notice in the vendor folder |
| baking | Blender 5.3.0 as the `bpy` Python module | Blender Foundation | GPL-2.0-or-later | tool only; nothing from Blender is redistributed |
| fonts in the 3D labels | Ubuntu Mono via X_ITE's TYPEWRITER family | Canonical / Dalton Maag | Ubuntu Font Licence 1.0 | loaded from the vendored X_ITE assets |

No third-party data is visualised: every number comes from the self-authored binary and the tools run on it.

## Takedown, and how to ask

If you own anything listed here and want it removed or the credit changed, open an issue at
https://github.com/hagopjay/x3d.demo/issues titled `Takedown: xray-binary` and say what you want removed.
It will be removed promptly after a request, without argument; the history can be cleaned on request.
The demo is one folder, so removal is a small change.
