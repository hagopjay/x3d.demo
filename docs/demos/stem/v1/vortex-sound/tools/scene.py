"""Generate scenes/vortex.x3d: the stage for Vortex Reconnection & Sound.

Computed states play through X3D's own event graph (TimeSensor -> IntegerSequencer -> Switch). Each
Switch child, created at runtime from a verified density field, holds the vortex cores (the surface where
the density falls to 0.25) and a slice through the fluid coloured by its density, where sound shows as
ripples. Units: 1 scene unit = 16 healing lengths.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1] / "lib"))
from stemkit.core import atomic_bytes   # noqa: E402

FRAMES, CYCLE = 48, 8.0


def make() -> str:
    keys = " ".join(f"{i / FRAMES:.6f}" for i in range(FRAMES))
    values = " ".join(str(i) for i in range(FRAMES))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<X3D profile="Immersive" version="4.0"><head>'
            '<component name="Shape" level="2"/>'
            '<meta name="title" content="Vortex Reconnection and Sound"/>'
            '<meta name="generator" content="studies/vortex-sound/tools/scene.py"/></head><Scene>'
            '<WorldInfo title="Vortex Reconnection and Sound"/>'
            '<NavigationInfo type=\'"EXAMINE" "ANY"\' transitionType=\'"TELEPORT"\' headlight="false"/>'
            '<Background skyColor="0.01 0.015 0.025 0.03 0.05 0.08" skyAngle="1.5" groundColor="0.01 0.015 0.025"/>'
            '<Viewpoint DEF="Oblique" description="Oblique" position="1.6 1.9 2.6" orientation="-0.6965 0.6899 0.1972 0.7787" centerOfRotation="0 0 0" fieldOfView="0.7"/>'
            '<Viewpoint DEF="Top" description="Top" position="0 3.4 0" orientation="-1 0 0 1.5708" centerOfRotation="0 0 0" fieldOfView="0.7"/>'
            '<DirectionalLight direction="-0.4 -1 -0.4" color="1 0.97 0.93" intensity="2.0"/>'
            '<DirectionalLight direction="0.7 -0.2 0.6" color="0.6 0.75 1" intensity="1.0"/>'
            '<DirectionalLight direction="0 0.6 -1" color="0.8 0.9 1" intensity="0.5"/>'
            '<Transform DEF="Fluid">'
            '<Switch DEF="Frames" whichChoice="-1">'
            '<Group DEF="Placeholder">'
            '<Shape><Appearance DEF="Core"><PhysicalMaterial baseColor="0.75 0.92 1" emissiveColor="0.05 0.12 0.2" roughness="0.25" metallic="0.1"/></Appearance>'
            '<IndexedTriangleSet solid="false"><Coordinate/></IndexedTriangleSet></Shape>'
            '<Shape><Appearance DEF="Sheet"><Material diffuseColor="0 0 0" emissiveColor="1 1 1" transparency="0.15"/></Appearance>'
            '<IndexedTriangleSet solid="false"><Coordinate/></IndexedTriangleSet></Shape>'
            '</Group>'
            '</Switch></Transform>'
            f'<TimeSensor DEF="Clock" cycleInterval="{CYCLE}" loop="true" enabled="false"/>'
            f'<IntegerSequencer DEF="Sequencer" key="{keys}" keyValue="{values}"/>'
            '<ROUTE fromNode="Clock" fromField="fraction_changed" toNode="Sequencer" toField="set_fraction"/>'
            '<ROUTE fromNode="Sequencer" fromField="value_changed" toNode="Frames" toField="set_whichChoice"/>'
            '</Scene></X3D>\n')


if __name__ == "__main__":
    atomic_bytes(ROOT / "scenes/vortex.x3d", make().encode())
    print("wrote scenes/vortex.x3d")
