"""Generate scenes/cloud.x3d: the stage for the Electron Cloud Observatory.

The specimen frame is the padded display grid (cells 0..81) scaled to [-1, 1]. The Switch's children, one
Shape per computed frame, are created at runtime from verified fields and share the Appearance DEF Skin.
Playback of the Lyman-alpha superposition is declared in X3D (TimeSensor -> IntegerSequencer -> Switch),
one period in 4 s. The nucleus sits at the grid centre; the charge-centre marker is moved by the page to
each frame's computed <z> (never interpolated between frames).
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1] / "lib"))
from stemkit.core import atomic_bytes   # noqa: E402

FRAMES, CYCLE, N = 24, 4.0, 80
S = 2 / (N + 1)
C = (N - 1) / 2 + 1          # grid centre in padded cell coordinates


def box_lines() -> str:
    p = [(x, y, z) for z in (1, N) for y in (1, N) for x in (1, N)]
    pts = " ".join(f"{x} {y} {z}" for x, y, z in p)
    idx = "0 1 -1 2 3 -1 4 5 -1 6 7 -1 0 2 -1 1 3 -1 4 6 -1 5 7 -1 0 4 -1 1 5 -1 2 6 -1 3 7 -1"
    return (f'<Shape><Appearance><Material emissiveColor="0.26 0.27 0.32" diffuseColor="0 0 0"/></Appearance>'
            f'<IndexedLineSet coordIndex="{idx}"><Coordinate point="{pts}"/></IndexedLineSet></Shape>')


def make() -> str:
    keys = " ".join(f"{i / FRAMES:.6f}" for i in range(FRAMES))
    values = " ".join(str(i) for i in range(FRAMES))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<X3D profile="Immersive" version="4.0"><head>'
            '<component name="Rendering" level="5"/><component name="Shape" level="2"/>'
            '<meta name="title" content="Electron Cloud Observatory"/>'
            '<meta name="generator" content="studies/electron-cloud/tools/scene.py"/></head><Scene>'
            '<WorldInfo title="Electron Cloud Observatory"/>'
            '<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="false"/>'
            '<Background skyColor="0.012 0.014 0.03 0.04 0.035 0.06" skyAngle="1.57"'
            ' groundColor="0.012 0.014 0.03 0.008 0.008 0.016" groundAngle="1.57"/>'
            '<Viewpoint DEF="Front" description="Atom" position="2.15 1.53 2.87" orientation="-0.484 0.855 0.186 0.735"'
            ' centerOfRotation="0 0 0" fieldOfView="0.62"/>'
            '<Viewpoint DEF="Side" description="Side on" position="3.6 0 0" orientation="0 1 0 1.5708"'
            ' centerOfRotation="0 0 0" fieldOfView="0.62"/>'
            '<DirectionalLight direction="-0.45 -0.85 -0.35" color="1 0.95 0.9" intensity="2.4" shadows="true" shadowIntensity="0.45"/>'
            '<DirectionalLight direction="0.85 -0.15 0.5" color="0.6 0.7 1" intensity="1.0"/>'
            '<DirectionalLight direction="0.1 0.7 -0.9" color="0.9 0.7 1" intensity="0.6"/>'
            f'<Transform DEF="Specimen" translation="-1 -1 -1" scale="{S:.9f} {S:.9f} {S:.9f}">'
            f'<ClipPlane DEF="Cut" plane="-1 0 0 {N + 2}" enabled="false"/>'
            '<Switch DEF="Cloud" whichChoice="-1">'
            '<Shape DEF="Placeholder"><Appearance DEF="Skin"><PhysicalMaterial DEF="Glass" baseColor="1 1 1" roughness="0.3" metallic="0"/></Appearance>'
            '<IndexedTriangleSet solid="false"><Coordinate/></IndexedTriangleSet></Shape>'
            '</Switch>'
            f'<Transform DEF="Nucleus" translation="{C} {C} {C}"><Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="1 0.85 0.5"/></Appearance><Sphere radius="0.7"/></Shape></Transform>'
            f'<Switch DEF="ChargeShown" whichChoice="-1"><Transform DEF="Charge" translation="{C} {C} {C}"><Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="0.45 0.9 1"/></Appearance><Sphere radius="1.1"/></Shape></Transform></Switch>'
            + box_lines() + '</Transform>'
            f'<TimeSensor DEF="Clock" cycleInterval="{CYCLE}" loop="true" enabled="false"/>'
            f'<IntegerSequencer DEF="Frames" key="{keys}" keyValue="{values}"/>'
            '<ROUTE fromNode="Clock" fromField="fraction_changed" toNode="Frames" toField="set_fraction"/>'
            '<ROUTE fromNode="Frames" fromField="value_changed" toNode="Cloud" toField="set_whichChoice"/>'
            '</Scene></X3D>\n')


if __name__ == "__main__":
    atomic_bytes(ROOT / "scenes/cloud.x3d", make().encode())
    print("wrote scenes/cloud.x3d")
