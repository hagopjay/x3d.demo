# Giza VI.3: X3D twin that flies by default

New version folder; v6, v6.1 and v6.2 are untouched and still live. VI.3 is v6.2's page plus a corrected X3D twin.
Engine, story, ledger data and assets still load from `../v6/` unchanged. The twin, its validation receipt and its
build script live here.

In X_ITE 16.6, EXAMINE keeps orbiting after a drag is released while the mouse is moving, and a slightly diagonal
drag swings the camera under the plateau, so every pyramid seemed to turn by itself. Measured on the published v6 twin
with no input after one drag: the camera moved through x = -1110, 185, -693, -739 over 2.5 s at y = -470 (below the
ground). The viewpoints' `centerOfRotation` values are fine.

| | v6 twin | v6.3 twin |
|---|---|---|
| Navigation | `"EXAMINE" "ANY"` | `"FLY" "EXAMINE" "ANY"`; Navigate: Fly / Examine toggle in `twin.html` |
| Speed | X_ITE default | each Viewpoint carries its own NavigationInfo, speed set to cross the shot in about 10 s on a 100 px drag (about 130 over the plateau, 0.27 in the King's Chamber) |
| `validation-vi.json` | x3d_mcp fa5dccf, 18 Nov | same validator, rechecked 19 Nov: XSD valid, 0 semantic errors or warnings |

`build/export_x3d.mjs` rebuilds `giza-vi.x3d` byte-identically (run from this folder: `node build/export_x3d.mjs out.x3d`).
Not covered: fly speeds come from the formula and were not tuned by hand at full frame rate; worth a quick fly-through.
Authored by hagsmac in x3d.demo #112, moved here from an in-place edit of v6.
