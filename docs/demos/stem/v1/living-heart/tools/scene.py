"""Generate scenes/heart.x3d: the stage for the Living Heart.

One period of computed states plays through X3D's own event graph (TimeSensor -> IntegerSequencer ->
Switch, 36 frames). The Switch's children are created at runtime from verified fields: relief sheets for
the 2D cases, or the ventricle wall (meshed once from its published geometry) with one colouring per frame.
A ClipPlane cuts the wall open.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1] / "lib"))
from stemkit.core import atomic_bytes   # noqa: E402

FRAMES, CYCLE = 36, 3.0


def make() -> str:
    keys = " ".join(f"{i / FRAMES:.6f}" for i in range(FRAMES))
    values = " ".join(str(i) for i in range(FRAMES))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<X3D profile="Immersive" version="4.0"><head>'
            '<component name="Rendering" level="5"/><component name="Shape" level="2"/>'
            '<meta name="title" content="Living Heart"/>'
            '<meta name="generator" content="studies/living-heart/tools/scene.py"/></head><Scene>'
            '<WorldInfo title="Living Heart"/>'
            '<NavigationInfo type=\'"EXAMINE" "ANY"\' transitionType=\'"TELEPORT"\' headlight="false"/>'
            '<Background skyColor="0.02 0.015 0.02 0.06 0.04 0.05" skyAngle="1.5" groundColor="0.02 0.015 0.02"/>'
            '<Viewpoint DEF="SheetView" description="Tissue" position="0 1.9 2.1" orientation="-1 0 0 0.73" centerOfRotation="0 0 0" fieldOfView="0.7"/>'
            '<Viewpoint DEF="HeartView" description="Ventricle" position="2.9 2.3 3.6" orientation="-0.5442 0.8167 0.1919 0.8153" centerOfRotation="0 0 0" fieldOfView="0.7"/>'
            '<DirectionalLight direction="-0.4 -1 -0.5" color="1 0.95 0.92" intensity="2.0"/>'
            '<DirectionalLight direction="0.7 -0.2 0.6" color="0.7 0.75 1" intensity="0.9"/>'
            '<DirectionalLight direction="0 0.5 -1" color="1 0.8 0.75" intensity="0.6"/>'
            '<Transform DEF="Specimen">'
            '<ClipPlane DEF="Cut" plane="-1 0 0 10" enabled="false"/>'
            '<Switch DEF="Frames" whichChoice="-1">'
            '<Shape DEF="Placeholder"><Appearance DEF="Skin"><PhysicalMaterial baseColor="1 1 1" roughness="0.5" metallic="0"/></Appearance>'
            '<IndexedTriangleSet solid="false"><Coordinate/></IndexedTriangleSet></Shape>'
            '</Switch></Transform>'
            f'<TimeSensor DEF="Clock" cycleInterval="{CYCLE}" loop="true" enabled="false"/>'
            f'<IntegerSequencer DEF="Sequencer" key="{keys}" keyValue="{values}"/>'
            '<ROUTE fromNode="Clock" fromField="fraction_changed" toNode="Sequencer" toField="set_fraction"/>'
            '<ROUTE fromNode="Sequencer" fromField="value_changed" toNode="Frames" toField="set_whichChoice"/>'
            '</Scene></X3D>\n')


if __name__ == "__main__":
    atomic_bytes(ROOT / "scenes/heart.x3d", make().encode())
    print("wrote scenes/heart.x3d")
