"""Generate scenes/chirp.x3d: the stage for Chirp.

Physics plane (x, y) maps to X3D (x, -z); heights (the gravitational-wave strain pattern) go up y.
Scene units: 1 = 50 M. The holes are spheres at their true horizon radius 2 m_i; the page moves them,
draws their trails and the wave surface from verified samples, driven by the TimeSensor's fraction.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1] / "lib"))
from stemkit.core import atomic_bytes   # noqa: E402


def hole(name: str) -> str:
    return (f'<Transform DEF="{name}"><Shape><Appearance><PhysicalMaterial baseColor="0.01 0.01 0.012" roughness="0.15" metallic="0.9"/></Appearance>'
            f'<Sphere DEF="{name}Sphere" radius="0.02"/></Shape></Transform>')


def make() -> str:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<X3D profile="Immersive" version="4.0"><head>'
            '<component name="Shape" level="2"/>'
            '<meta name="title" content="Chirp"/>'
            '<meta name="generator" content="studies/chirp/tools/scene.py"/></head><Scene>'
            '<WorldInfo title="Chirp"/>'
            '<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="false"/>'
            '<Background skyColor="0.01 0.012 0.02 0.03 0.035 0.06" skyAngle="1.4" groundColor="0.01 0.012 0.02" />'
            '<Viewpoint DEF="Close" description="Close" position="0 0.55 0.75" orientation="-1 0 0 0.63" centerOfRotation="0 0 0" fieldOfView="0.7"/>'
            '<Viewpoint DEF="Wide" description="Wide" position="0 2.6 3.4" orientation="-1 0 0 0.65" centerOfRotation="0 0 0" fieldOfView="0.7"/>'
            '<DirectionalLight direction="-0.4 -1 -0.3" color="1 0.95 0.9" intensity="2.2"/>'
            '<DirectionalLight direction="0.6 -0.5 0.6" color="0.55 0.65 1" intensity="1.0"/>'
            '<DirectionalLight direction="0 -0.2 -1" color="1 0.8 0.6" intensity="0.5"/>'
            '<Transform DEF="System">'
            + hole("Hole1") + hole("Hole2") +
            '<Shape DEF="Trail1"><Appearance><Material emissiveColor="1 0.72 0.4" diffuseColor="0 0 0"/></Appearance><IndexedLineSet DEF="Trail1Lines"><Coordinate DEF="Trail1Coord"/></IndexedLineSet></Shape>'
            '<Shape DEF="Trail2"><Appearance><Material emissiveColor="0.5 0.8 1" diffuseColor="0 0 0"/></Appearance><IndexedLineSet DEF="Trail2Lines"><Coordinate DEF="Trail2Coord"/></IndexedLineSet></Shape>'
            '<Shape DEF="Ripple"><Appearance DEF="Sheet"><PhysicalMaterial baseColor="1 1 1" roughness="0.4" metallic="0.1"/></Appearance>'
            '<IndexedTriangleSet DEF="RippleGeom" solid="false"><Coordinate DEF="RippleCoord"/></IndexedTriangleSet></Shape>'
            '</Transform>'
            '<TimeSensor DEF="Clock" cycleInterval="40" loop="true" enabled="false"/>'
            '</Scene></X3D>\n')


if __name__ == "__main__":
    atomic_bytes(ROOT / "scenes/chirp.x3d", make().encode())
    print("wrote scenes/chirp.x3d")
