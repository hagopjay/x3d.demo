# tools/tiles3d: 3D Tiles to X3D Geospatial, v2

`tiles3d_to_x3d.py` v2 is the geotiling v1 converter (`docs/demos/geotiling/v1/tiles3d_to_x3d.py`, left exactly as
shipped) with defect 7 of the external accountability review of 18 Nov 2026 fixed.

| Behaviour | v1 | v2 |
|---|---|---|
| Content in a nested external tileset (`root.json` -> `sub/child.json` -> `mesh.glb`) | `../mesh.glb` (resolved against the root's folder: wrong) | `../sub/mesh.glb` (resolved against the tileset that names it) |
| `refine: "ADD"` | drawn as REPLACE, counted | **refused**; `--allow-lossy` converts and records it |
| `contents` with 2+ entries | first kept, rest dropped silently | **refused**; same |
| glb tile whose frame is not local ENU (identity = ECEF-baked, as Google's glb; any rotation or scale) | placed unrotated; x axis checked only | **refused**; all three axes and scale checked |
| `implicitTiling`, missing external tileset, external cycle | not detected / counted / infinite recursion | **refused** |
| Lossy run | nothing on disk says what was lost | `conversion-report.json` beside the output lists every loss |
| Exit code | 0 | 0 converted, 2 refused (JSON names every refusal) |

Parity on the shipped geotiling v1 tileset (149 tiles, 132 glb, 5 chunked): v2 writes the same 177 files as v1,
byte-identical apart from the generator `<meta>`, with zero losses; all 177 are XSD + semantic clean (x3d_mcp
fa5dccf, lxml 6.1.3, libxml2 2.14.6, via `tools/assurance/validate_scenes.py`).

Controls: `python3 -I tools/tiles3d/test_tiles3d.py` (16 cases; runs v1 on the nested fixture first to show the
defect). Last run: `test-last-run.json`.

Still not handled (and refused, not guessed): implicit tiling expansion, ADD refinement as true additive LOD,
multiple contents per tile, re-framing ECEF glb into GeoLocation. Each needs a tested X3D mapping first.

## v2.1 (18 Nov 2026, second external review defect 4)

glb content is placed at its tile frame's origin (the translation of the accumulated `transform`), not at the
bounding-volume centre. Reviewer's probe: ENU frame at ECEF (6378137, 0, 0), sphere centred 10 m east. v2 as shipped
(`v2-shipped.py`, kept for the control) placed content 9.996 m off; v2.1 places it 0.0000 m off. The GeoLOD `center`
still uses the bounding volume. Content whose frame origin is the Earth's centre (ECEF-baked glb) is refused. The
v2 fixture's ENU frame had no translation (content at the Earth's centre) and v2 hid it; the fixture now carries it.
`test_tiles3d.py`: 21 of 21 pass (`test-last-run.json`), including a nested-translation case (0.0002 m).

## v2.2 (18 Nov 2026, third external review defects 6 and 7)

| Input | v2.1 (`v2.1-shipped.py`) | v2.2 |
|---|---|---|
| content `mesh&a.glb` | exit 0, output not XML (`EntityRef: expecting ';'`) | `url='"../mesh&amp;a.glb"'`; every output parsed before success |
| content `...mesh.glb?variant=red&proof=synthetic` | query dropped: loopback HTTP 200 became 403 | query and fragment kept: 200 and 200 |
| external `sub%20dir/child.json` | refused as missing | path decoded for the filesystem only; output stays `sub%20dir/` |
| region west 179.9, east -179.9 | GeoLOD centre lon 0 (12,756,294 m chord off) | lon 180 |
| origin exactly on the polar axis | ZeroDivisionError | lat 90, height above the pole |
| clean run into a folder that held a lossy run | old lossy `conversion-report.json` left | report written every run: `lossy`, `files_written` with hashes, `other_x3d_in_folder` |

Checked with the reviewer's own `tiles-probes.py` (all 7 cases) and `test_tiles3d.py`, 27 of 27 (Python 3.13).
MFString values escape `\` and `"`; XML attributes escape `& < > '`.
