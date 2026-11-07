"""Generate scenes/garden.x3d: the stage for the Turing Garden.

Playback is declared in X3D, not scripted: a TimeSensor drives an IntegerSequencer whose value selects
the Switch child, so the browser's own event graph shows frame i for 1/41 of each cycle. The Switch's
children (one Shape per computed frame) are created at runtime from verified fields; the scene carries
one empty placeholder whose Appearance (DEF Skin) every frame shares. A ClipPlane in the specimen's
coordinates (grid cells) cuts it open.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1] / "lib"))
from stemkit.core import atomic_bytes   # noqa: E402

FRAMES, CYCLE = 41, 8.2
S = 2 / 65                               # padded grid 0..65 cells -> [-1, 1]


def box_lines() -> str:
    p = [(x, y, z) for z in (1, 64) for y in (1, 64) for x in (1, 64)]
    pts = " ".join(f"{x} {y} {z}" for x, y, z in p)
    idx = "0 1 -1 2 3 -1 4 5 -1 6 7 -1 0 2 -1 1 3 -1 4 6 -1 5 7 -1 0 4 -1 1 5 -1 2 6 -1 3 7 -1"
    return (f'<Shape><Appearance><Material emissiveColor="0.32 0.30 0.27" diffuseColor="0 0 0"/></Appearance>'
            f'<IndexedLineSet coordIndex="{idx}"><Coordinate point="{pts}"/></IndexedLineSet></Shape>')


def make() -> str:
    keys = " ".join(f"{i / FRAMES:.6f}" for i in range(FRAMES))
    values = " ".join(str(i) for i in range(FRAMES))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<X3D profile="Immersive" version="4.0"><head>'
            '<component name="Rendering" level="5"/><component name="Shape" level="2"/>'
            '<meta name="title" content="Turing Garden"/>'
            '<meta name="generator" content="studies/turing-garden/tools/scene.py"/></head><Scene>'
            '<WorldInfo title="Turing Garden"/>'
            '<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="false"/>'
            '<Background skyColor="0.018 0.02 0.024 0.05 0.045 0.042" skyAngle="1.57"'
            ' groundColor="0.018 0.02 0.024 0.012 0.012 0.014" groundAngle="1.57"/>'
            '<Viewpoint DEF="Front" description="Specimen" position="3.3 2.35 4.4" orientation="-0.484 0.855 0.186 0.735"'
            ' centerOfRotation="0 0 0" fieldOfView="0.62"/>'
            '<Viewpoint DEF="Face" description="Cut face" position="5.6 0 0" orientation="0 1 0 1.5708"'
            ' centerOfRotation="0 0 0" fieldOfView="0.62"/>'
            '<DirectionalLight direction="-0.45 -0.85 -0.35" color="1 0.93 0.84" intensity="2.6" shadows="true" shadowIntensity="0.55"/>'
            '<DirectionalLight direction="0.85 -0.15 0.5" color="0.55 0.68 1" intensity="0.9"/>'
            '<DirectionalLight direction="0.1 0.7 -0.9" color="1 0.75 0.6" intensity="0.6"/>'
            f'<Transform DEF="Specimen" translation="-1 -1 -1" scale="{S:.9f} {S:.9f} {S:.9f}">'
            '<ClipPlane DEF="Cut" plane="-1 0 0 66" enabled="false"/>'
            '<Switch DEF="Garden" whichChoice="-1">'
            '<Shape DEF="Placeholder"><Appearance DEF="Skin"><PhysicalMaterial DEF="Flesh" baseColor="1 1 1" roughness="0.42" metallic="0"/></Appearance>'
            '<IndexedTriangleSet solid="false"><Coordinate/></IndexedTriangleSet></Shape>'
            '</Switch>' + box_lines() + '</Transform>'
            f'<TimeSensor DEF="Clock" cycleInterval="{CYCLE}" loop="true" enabled="false"/>'
            f'<IntegerSequencer DEF="Frames" key="{keys}" keyValue="{values}"/>'
            '<ROUTE fromNode="Clock" fromField="fraction_changed" toNode="Frames" toField="set_fraction"/>'
            '<ROUTE fromNode="Frames" fromField="value_changed" toNode="Garden" toField="set_whichChoice"/>'
            '</Scene></X3D>\n')


if __name__ == "__main__":
    atomic_bytes(ROOT / "scenes/garden.x3d", make().encode())
    print("wrote scenes/garden.x3d")
