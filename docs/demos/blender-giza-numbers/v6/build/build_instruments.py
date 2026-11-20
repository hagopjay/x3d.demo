#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build the additive, native-X3D instruments for the v5 Giza Atlas.

Standard library only; deterministic. Nothing in the Blender/Cycles plateau is
modified. Coordinates follow stage-data.json: metres, X east, Y up, Z south,
Khufu's reconstructed base centre at the origin.

These are teaching constructions, not archaeological measurements. Survey
envelopes reuse v4's reference values; flower-of-life, logarithmic spirals and
concentric diagrams are mathematical art with no historical-intention claim.
Line/tube thickness and slight vertical offsets provide legibility rather
than measurement precision. Every instrument can be switched independently.

Run from any directory: python3 build_instruments.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "assets" / "stage-data.json").read_text())
K = DATA["pyramids"]["Khufu"]
A, H, B = K["a"], K["h"], K["base"]
TAU = math.tau
GOLD = (1, .66, .17)
CYAN = (.21, .88, 1)
WHITE = (.9, .94, 1)
CORAL = (1, .32, .29)
VIOLET = (.68, .4, 1)
FAINT = (.18, .4, .49)


def fmt(value):
    if isinstance(value, str):
        return value
    if isinstance(value, (float, int)):
        if abs(value) < .0000005:
            return "0"
        return f"{value:.6f}".rstrip("0").rstrip(".")
    return " ".join(fmt(x) for x in value)


def add(parent, tag, **attributes):
    return ET.SubElement(parent, tag, {key: fmt(value) for key, value in attributes.items()})


def material(shape, color, transparency=0, name=None):
    appearance = add(shape, "Appearance")
    attrs = {"diffuseColor": "0 0 0", "emissiveColor": color,
             "transparency": transparency}
    if name:
        attrs["DEF"] = name
    add(appearance, "Material", **attrs)
    return appearance


def line(parent, paths, color=CYAN, width=1, transparency=0, name=None):
    shape = add(parent, "Shape")
    appearance = material(shape, color, transparency)
    add(appearance, "LineProperties", applied="true", linewidthScaleFactor=width)
    points, indices = [], []
    for path in paths:
        start = len(points)
        points.extend(path)
        indices.extend([*range(start, len(points)), -1])
    geometry = add(shape, "IndexedLineSet", coordIndex=indices)
    kw = {"point": [v for p in points for v in p]}
    if name:
        kw["DEF"] = name
    add(geometry, "Coordinate", **kw)
    return shape


def mesh(parent, points, faces, color=CYAN, transparency=0, material_name=None):
    shape = add(parent, "Shape")
    material(shape, color, transparency, material_name)
    geometry = add(shape, "IndexedFaceSet", solid="false",
                   coordIndex=[i for face in faces for i in [*face, -1]])
    add(geometry, "Coordinate", point=[v for p in points for v in p])
    return shape


def tube(parent, points, color=CYAN, radius=.45, sides=6, transparency=0):
    """A real thin mesh tube, independent of platform line-width limits."""
    vertices, faces = [], []
    for i, point in enumerate(points):
        p0, p1 = points[max(0, i-1)], points[min(len(points)-1, i+1)]
        tangent = [p1[j]-p0[j] for j in range(3)]
        length = math.sqrt(sum(x*x for x in tangent))
        if length < 1e-12:
            raise ValueError("Tube points must have a nonzero tangent")
        tangent = [x/length for x in tangent]
        helper = (0, 1, 0) if abs(tangent[1]) < .9 else (1, 0, 0)
        normal = [tangent[1]*helper[2]-tangent[2]*helper[1],
                  tangent[2]*helper[0]-tangent[0]*helper[2],
                  tangent[0]*helper[1]-tangent[1]*helper[0]]
        length = math.sqrt(sum(x*x for x in normal))
        normal = [x/length for x in normal]
        bitangent = [tangent[1]*normal[2]-tangent[2]*normal[1],
                     tangent[2]*normal[0]-tangent[0]*normal[2],
                     tangent[0]*normal[1]-tangent[1]*normal[0]]
        for j in range(sides):
            angle = j*TAU/sides
            vertices.append([point[k]+radius*(math.cos(angle)*normal[k]+math.sin(angle)*bitangent[k]) for k in range(3)])
        if i:
            base = i*sides
            for j in range(sides):
                nj = (j+1) % sides
                faces.append([base-sides+j, base-sides+nj, base+nj, base+j])
    return mesh(parent, vertices, faces, color, transparency)


def label(parent, value, position, color=WHITE, size=5, name=None):
    transform = add(parent, "Transform", translation=position)
    billboard = add(transform, "Billboard", axisOfRotation="0 0 0")
    shape = add(billboard, "Shape")
    material(shape, color)
    kw = {"string": '"' + value.replace('"', "'") + '"', "solid": "false"}
    if name:
        kw["DEF"] = name
    text = add(shape, "Text", **kw)
    add(text, "FontStyle", family='"SANS"', justify='"MIDDLE" "MIDDLE"', size=size)
    return transform


def square(a, y=0, x=0, z=0):
    return [(x-a, y, z-a), (x+a, y, z-a), (x+a, y, z+a),
            (x-a, y, z+a), (x-a, y, z-a)]


def circle(radius, y=0, x=0, z=0, n=180):
    return [(x+radius*math.cos(TAU*i/n), y, z+radius*math.sin(TAU*i/n)) for i in range(n+1)]


def switch(parent, name):
    element = add(parent, "Switch", DEF=name, whichChoice=-1)
    return add(element, "Group")


def tick_ruler(parent, x, length=H):
    paths = [[(x, 0, 0), (x, length, 0)]]
    for i in range(0, int(length)+1, 5):
        half = 4 if i % 25 == 0 else 1.7
        paths.append([(x-half, i, 0), (x+half, i, 0)])
    line(parent, paths, CYAN, 1.5)
    for i in range(0, int(length)+1, 25):
        label(parent, f"{i} m", (x+13, i, 0), CYAN, 3.4)


def build():
    document = ET.Element("X3D", {"profile": "Immersive", "version": "4.0"})
    head = add(document, "head")
    add(head, "component", name="Shape", level=2)
    add(head, "unit", category="length", name="metre", conversionFactor=1)
    add(head, "meta", name="title", content="Giza Atlas v5 — additive analytical instruments")
    add(head, "meta", name="generator", content="build_instruments.py; deterministic Python standard library")
    add(head, "meta", name="description", content="Mathematical visualization overlays. Reference geometry from stage-data.json; decorative line widths do not depict survey error. Flower-of-life and golden spirals are mathematical art, not historical claims. No lights, cameras or backgrounds; attach LensRoot to the existing Plateau Group.")
    add(head, "meta", name="license", content="GPL-3.0-or-later")
    scene = add(document, "Scene")
    root = add(scene, "Group", DEF="LensRoot")

    # Horizontal section with a normalized scalable face. IndexedLineSet keeps
    # its screen-space width when the host changes SliceTransform's X/Z scale.
    section = switch(root, "InstrumentSection")
    transform = add(section, "Transform", DEF="SliceTransform",
                    translation=[0, H*.4, 0], scale=[A*.6, 1, A*.6])
    mesh(transform, square(1)[:-1], [(0, 1, 2, 3)], CYAN, .89, "SliceFillMaterial")
    line(transform, [square(1, .035)], CYAN, 3, name="SliceCoordinate")
    line(transform, [[(-1, .04, 0), (1, .04, 0)], [(0, .04, -1), (0, .04, 1)]], GOLD, 1.2)
    label_transform = add(section, "Transform", DEF="SliceLabelTransform", translation=[A+48, H*.4, 0])
    label(label_transform, "SECTION 40%", (0, 0, 0), CYAN, 4.6, "SliceText")
    tick_ruler(section, A+30)
    line(section, [[(0, 0, 0), (0, H, 0)], [(0, H, 0), (A+34, H, 0)]], CYAN, 1.5, .2)
    # A clear wire cage gives the slice a full-height frame in x-ray mode.
    vertices = square(A, .07)[:-1] + [(0, H, 0)]
    line(section, [square(A, .07)] + [[point, (0, H, 0)] for point in vertices[:4]], FAINT, 1.1, .2)

    geometry = switch(root, "InstrumentGeometry")
    # A literal perimeter/circle comparison at the envelope dimensions. The
    # 0.75 m lift affects only Y, not the compared horizontal lengths.
    tube(geometry, square(A, .75), CYAN, .40)
    tube(geometry, circle(H, .75, n=256), GOLD, .48)
    line(geometry, [[(0, .85, 0), (H, .85, 0)]], GOLD, 2)
    # A floating construction triangle is translated east for legibility.
    # It retains exactly the pyramid's half-base, height and slant length.
    experiment = add(geometry, "Transform", DEF="ExperimentEnvelope")
    # The ghost envelope deforms independently; the baked plateau stays fixed.
    line(experiment, [square(A, .1)] + [[p, (0, H, 0)] for p in square(A, .1)[:-1]], WHITE, 2, .05)
    px = A+18
    triangle = [(px, 0, 0), (px, H, 0), (px, 0, A), (px, 0, 0)]
    tube(experiment, triangle, CYAN, .5)
    mesh(experiment, triangle[:-1], [(0, 1, 2)], CYAN, .94)
    line(experiment, [[(px, 7, 0), (px, 7, 7), (px, 0, 7)]], GOLD, 1.8)
    label(experiment, "h", (px+7, H*.5, -7), GOLD, 6)
    label(experiment, "b / 2", (px+7, -7, A*.5), CYAN, 5.5)
    label(experiment, "slant", (px+7, H*.53, A*.53), WHITE, 5)
    label(geometry, "2b / h  |  slant / half-base", (0, H+19, 0), GOLD, 5.5)
    label(geometry, "FIXED REFERENCE CIRCLE / ADJUSTABLE GHOST ENVELOPE", (0, 5, A+30), WHITE, 3.5)
    # Nested circles expose the b/2,h,slant relationship without suggesting
    # the circles were historical features of the site.
    slant = math.hypot(A, H)
    line(geometry, [circle(A, .35), circle(slant, .35)], FAINT, 1.1, .25)
    for angle in range(0, 360, 15):
        t = math.radians(angle)
        inner = H-2.5 if angle % 45 == 0 else H-1.2
        line(geometry, [[(inner*math.cos(t), .8, inner*math.sin(t)),
                         ((H+2.5)*math.cos(t), .8, (H+2.5)*math.sin(t))]], GOLD, 1.3)

    harmonics = switch(root, "InstrumentHarmonics")
    art = add(harmonics, "Transform", translation=[-250, 1.1, 350])
    radius = 148.0
    centres = [(0, 0)]
    # Axial hex-grid rings: 1+6+12=19 equal-radius circles, a finite
    # flower-of-life construction whose centres are exactly one radius apart.
    for q in range(-2, 3):
        for r in range(-2, 3):
            if (q or r) and max(abs(q), abs(r), abs(-q-r)) <= 2:
                centres.append((radius*(q+r*.5), radius*(math.sqrt(3)/2*r)))
    paths = [circle(radius, 0, x, z, 144) for x, z in centres]
    line(art, paths, GOLD, 1.35, .18)
    tube(art, circle(radius*3, 0, n=320), CYAN, .7)
    line(art, [circle(radius*math.sqrt(3), 0, n=240), circle(radius*2, 0, n=240)], FAINT, 1.1)
    # A true logarithmic golden spiral: r multiplies by phi every pi/2 turn.
    phi = (1+math.sqrt(5))/2
    spiral = []
    turns = 3
    for i in range(601):
        theta = TAU*turns*i/600
        rad = radius*2.8*phi**((theta-TAU*turns)/(math.pi/2))
        spiral.append((rad*math.cos(theta), 1.0, rad*math.sin(theta)))
    tube(art, spiral, WHITE, .7)
    # Six spokes and an inner star are mathematical guides, not alignment rays.
    line(art, [[(0, 0, 0), (radius*3*math.cos(i*TAU/6), 0, radius*3*math.sin(i*TAU/6))] for i in range(6)], CYAN, 1.1, .25)
    star = [(radius*math.sqrt(3)*math.cos(i*TAU/3), .2, radius*math.sqrt(3)*math.sin(i*TAU/3)) for i in range(4)]
    line(art, [star, [(-x, y, -z) for x, y, z in star]], CYAN, 1.5, .16)
    label(harmonics, "MATHEMATICAL ART / NO ARCHAEOLOGICAL CLAIM", (-250, 11, 350+radius*3+28), GOLD, 10)
    label(harmonics, "GOLDEN LOG SPIRAL / x phi EACH QUARTER TURN", (-250, 11, 350-radius*3-28), WHITE, 7)

    survey = switch(root, "InstrumentSurvey")
    pyramid_centres = []
    for name, p in DATA["pyramids"].items():
        x, y, z = p["c"]
        a, height = p["a"], p["h"]
        base = square(a, y+.4, x, z)
        apex = (x, y+height, z)
        tube(survey, base, CYAN, .55)
        line(survey, [[corner, apex] for corner in base[:-1]], GOLD, 1.65, .1)
        line(survey, [[(x, y, z), (x, y+height+20, z)]], CYAN, 1.2, .25)
        for fraction in (.25, .5, .75):
            line(survey, [square(a*(1-fraction), y+height*fraction, x, z)], FAINT, 1.1, .15)
        tube(survey, circle(9, y+.5, x, z, 64), GOLD, .35)
        label(survey, name.upper(), (x, y+height+28, z), GOLD, 7)
        label(survey, f"b {p['base']:.2f} m  /  h {height:.2f} m", (x, y+height+15, z), CYAN, 4.6)
        pyramid_centres.append((x, y+.5, z))
    # In-plan centre baselines use the same reference centre coordinates. Their
    # display plane floats at Y=25 m above the Khufu datum so crossing terrain cannot
    # falsely suggest that the connection follows an excavated feature.
    points = [(p[0], 25, p[2]) for p in pyramid_centres]
    line(survey, [points, [points[0], points[-1]]], CORAL, 1.7, .25)
    for index, (p, q) in enumerate(zip(pyramid_centres, pyramid_centres[1:])):
        distance = math.hypot(q[0]-p[0], q[2]-p[2])
        label(survey, f"PLAN BASELINE {distance:.1f} m", ((p[0]+q[0])/2, 30, (p[2]+q[2])/2), CORAL, 5)
    # Cardinal registration at Khufu: survey frame, independent of the art.
    line(survey, [[(0, 1, -260), (0, 1, 220)], [(-220, 1, 0), (220, 1, 0)]], CYAN, 1.4, .15)
    label(survey, "N", (0, 8, -270), CYAN, 9)
    label(survey, "E", (230, 8, 0), CYAN, 9)
    label(survey, "REFERENCE ENVELOPES / IDEALIZED CASING", (-275, 60, 990), WHITE, 8)

    # Named nodes are intentionally public SAI targets of the host application.
    for name in ["LensRoot", "InstrumentSection", "InstrumentGeometry", "InstrumentHarmonics", "InstrumentSurvey",
                 "ExperimentEnvelope", "SliceTransform", "SliceCoordinate", "SliceFillMaterial", "SliceLabelTransform", "SliceText"]:
        add(scene, "EXPORT", localDEF=name, AS=name)
    ET.indent(document, space="  ")
    output = ROOT / "assets" / "instruments.x3d"
    output.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(document, encoding="unicode") + "\n")
    print(f"{output}: {output.stat().st_size:,} bytes; 4 independent instruments; Khufu B={B:.3f}, H={H:.6f}")
    return output


if __name__ == "__main__":
    build()
