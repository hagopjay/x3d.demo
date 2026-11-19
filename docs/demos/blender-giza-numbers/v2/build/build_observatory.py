#!/usr/bin/env python3
"""Build the procedural X3D teaching scene; Python standard library only.

The envelope uses v1's reference base and derived height, in metres. This is
an idealized reconstruction, NOT a measured block model or archaeological
site scan. Masonry courses, terrain, chamber positions and the solar diagram
are teaching illustrations. The retained v1 asset is the Blender IO witness.

Coordinates: X east, Y up, -Z north. All instructional overlays have separate
Switch nodes, allowing the browser to show just the selected analysis.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import random
import struct
import xml.etree.ElementTree as ET
import zlib

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT.parent / "v1" / "receipts" / "claims.json"
D = json.loads(REFERENCE.read_text())
BASE, HEIGHT = D["base_m"], D["height_m"]
A = BASE / 2
GOLD = "1 .68 .19"
CYAN = ".22 .82 .91"
WHITE = ".92 .89 .77"
CORAL = "1 .30 .30"
FAINT = ".20 .29 .30"


def fmt(x):
    if isinstance(x, str):
        return x
    if isinstance(x, (float, int)):
        return f"{x:.5f}".rstrip("0").rstrip(".") or "0"
    return " ".join(fmt(i) for i in x)


def node(parent, tag, **attrs):
    return ET.SubElement(parent, tag, {k: fmt(v) for k, v in attrs.items()})


def appearance(shape, color, alpha=0, *, material_def=None, physical=False):
    app = node(shape, "Appearance")
    kw = {"transparency": alpha}
    if material_def:
        kw["DEF"] = material_def
    if physical:
        node(app, "PhysicalMaterial", baseColor=color, roughness=.86, metallic=0, **kw)
    else:
        node(app, "Material", diffuseColor=color, emissiveColor=color, **kw)
    return app


def polyline(parent, lines, color=GOLD, width=1, alpha=0, *, coord_def=None):
    shape = node(parent, "Shape")
    app = appearance(shape, color, alpha)
    node(app, "LineProperties", applied="true", linewidthScaleFactor=width)
    points, indices = [], []
    for line in lines:
        start = len(points)
        points.extend(line)
        indices.extend([*range(start, len(points)), -1])
    ifs = node(shape, "IndexedLineSet", coordIndex=indices)
    kw = {"point": [v for p in points for v in p]}
    if coord_def:
        kw["DEF"] = coord_def
    node(ifs, "Coordinate", **kw)
    return shape


def mesh(parent, pts, faces, color, alpha=0, *, mat_def=None, coord_def=None, colors=None):
    shape = node(parent, "Shape")
    appearance(shape, color, alpha, material_def=mat_def, physical=bool(mat_def))
    m = node(shape, "IndexedFaceSet", coordIndex=[v for f in faces for v in [*f, -1]],
             solid="false", colorPerVertex="false")
    kw = {"point": [v for p in pts for v in p]}
    if coord_def:
        kw["DEF"] = coord_def
    node(m, "Coordinate", **kw)
    if colors:
        node(m, "Color", color=[v for c in colors for v in c])
    return shape


def box(parent, centre, size, color, alpha=0):
    tr = node(parent, "Transform", translation=centre)
    sh = node(tr, "Shape")
    appearance(sh, color, alpha)
    node(sh, "Box", size=size)
    return tr


def ball(parent, p, radius, color):
    tr = node(parent, "Transform", translation=p)
    sh = node(tr, "Shape")
    appearance(sh, color)
    node(sh, "Sphere", radius=radius)
    return tr


def cylinder(parent, p, q, radius, color):
    d = [q[i] - p[i] for i in range(3)]
    h = math.sqrt(sum(v*v for v in d))
    axis = (d[2], 0, -d[0])
    length = math.hypot(axis[0], axis[2])
    rotation = (*[v/length for v in axis], math.acos(max(-1, min(1, d[1]/h)))) if length else (1, 0, 0, 0 if d[1] >= 0 else math.pi)
    tr = node(parent, "Transform", translation=[(p[i]+q[i])/2 for i in range(3)], rotation=rotation)
    sh = node(tr, "Shape")
    appearance(sh, color)
    node(sh, "Cylinder", radius=radius, height=h)
    return tr


def label(parent, text, p, color=WHITE, size=5, justify="MIDDLE", text_def=None):
    tr = node(parent, "Transform", translation=p)
    bb = node(tr, "Billboard", axisOfRotation="0 0 0")
    sh = node(bb, "Shape")
    appearance(sh, color)
    tx = node(sh, "Text", string='"' + text.replace('"', "'") + '"', solid="false")
    if text_def:
        tx.set("DEF",text_def)
    node(tx, "FontStyle", family='"SANS"', justify=f'"{justify}" "MIDDLE"', size=size, spacing=1)
    return tr


def switch(parent, name, on=False):
    return node(parent, "Switch", DEF=name, whichChoice=0 if on else -1)


def square(r, y=0):
    return [(-r, y, -r), (r, y, -r), (r, y, r), (-r, y, r), (-r, y, -r)]


def ring(r, y=0, n=180):
    return [(r*math.cos(2*math.pi*i/n), y, r*math.sin(2*math.pi*i/n)) for i in range(n+1)]


def viewpoint(scene, name, description, p, target, fov=.66):
    d = [target[i] - p[i] for i in range(3)]
    r = math.sqrt(sum(v*v for v in d))
    yaw, pitch = math.atan2(-d[0], -d[2]), math.asin(d[1]/r)
    sy, cy, sx, cx = math.sin(yaw/2), math.cos(yaw/2), math.sin(pitch/2), math.cos(pitch/2)
    q = (cy*sx, sy*cx, -sy*sx, cy*cx)
    theta = 2*math.acos(max(-1, min(1, q[3])))
    den = math.sqrt(max(0, 1-q[3]*q[3]))
    rot = [*(v/den for v in q[:3]), theta] if den > 1e-9 else [0, 1, 0, 0]
    node(scene, "Viewpoint", DEF=name, description=description, position=p,
         orientation=rot, centerOfRotation=target, fieldOfView=fov)


def stone_textures():
    """Seamless synthetic limestone microtexture; no external source imagery.

    The normal map is a visual material treatment, not measured surface relief.
    Both maps tile over each face and remain tiny enough for the static demo.
    """
    n, rng = 192, random.Random(73021)
    heights = []
    for y in range(n):
        for x in range(n):
            a, b = 2*math.pi*x/n, 2*math.pi*y/n
            grain = rng.random()
            v = (.49 + .07*math.sin(5*a+2*math.sin(3*b)) + .055*math.cos(9*b+math.sin(7*a))
                 + .045*math.sin(23*a+17*b) + .11*(grain-.5))
            if grain > .997:
                v -= .24
            heights.append(v)
    diffuse, normal = bytearray(), bytearray()
    for y in range(n):
        for x in range(n):
            k = y*n+x
            value = min(255,max(0,round(234+(heights[k]-.5)*58)))
            diffuse.extend((value,min(255,value+1),max(0,value-3)))
            dx = (heights[y*n+(x+1)%n]-heights[y*n+(x-1)%n])*.75
            dy = (heights[((y+1)%n)*n+x]-heights[((y-1)%n)*n+x])*.75
            length = math.sqrt(dx*dx+dy*dy+1)
            normal.extend((round(127.5*(1-dx/length)),round(127.5*(1-dy/length)),round(127.5*(1+1/length))))
    def png(path, pixels):
        def chunk(kind,data):
            return struct.pack(">I",len(data))+kind+data+struct.pack(">I",zlib.crc32(kind+data)&0xffffffff)
        scan = b"".join(b"\0"+pixels[y*n*3:(y+1)*n*3] for y in range(n))
        data = b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",n,n,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(scan,9))+chunk(b"IEND",b"")
        path.write_bytes(data)
    out = ROOT/"assets"
    out.mkdir(parents=True,exist_ok=True)
    png(out/"limestone-base.png",diffuse)
    png(out/"limestone-normal.png",normal)


def build():
    x3d = ET.Element("X3D", {"profile": "Full", "version": "4.0"})
    head = node(x3d, "head")
    node(head, "unit", category="length", name="metre", conversionFactor=1)
    node(head, "meta", name="title", content="Great Pyramid Observatory — procedural analytical reconstruction")
    node(head, "meta", name="generator", content="build_observatory.py; Python standard library; deterministic X3D 4.0")
    node(head, "meta", name="description", content="Idealized reconstructed envelope. Course joints, terrain and chambers are illustrative, not a block survey. Envelope reference: 230.363 m base, 146.721 m derived height. North is -Z, Y is up; metre units.")
    scene = node(x3d, "Scene")
    node(scene, "WorldInfo", title="Great Pyramid Observatory", info='"Envelope reconstruction, not current ruins" "Terrain, masonry and chambers schematic"')
    node(scene, "Background", DEF="Sky", skyColor=".025 .055 .09 .09 .16 .20 .39 .37 .29", skyAngle="1.10 1.57", groundColor=".075 .09 .09")
    node(scene, "NavigationInfo", headlight="false", type='"EXAMINE" "FLY" "ANY"', speed=20, avatarSize=".25 1.7 .75", transitionType='"LINEAR"', transitionTime=1.2)
    node(scene, "DirectionalLight", DEF="Sun", direction="-.52 -.75 -.41", color="1 .86 .66", intensity=.95, ambientIntensity=.24)
    node(scene, "DirectionalLight", direction=".5 -.35 .75", color=".39 .62 .81", intensity=.30, ambientIntensity=.12)
    # The first Viewpoint binds initially.
    viewpoint(scene, "CA_Overview", "01 · Observatory / reconstructed envelope", (395, 296, 455), (0, 40, 0), .66)
    viewpoint(scene, "CA_Pi", "02 · Perimeter and circle / pi", (305, 390, 390), (0, 15, 0), .70)
    viewpoint(scene, "CA_Phi", "03 · Face section / phi and seked", (345, 104, 10), (0, 65, 0), .64)
    viewpoint(scene, "CA_Latitude", "04 · Latitude section / north is -Z", (285, 245, 295), (0, 38, 0), .68)
    viewpoint(scene, "CA_Plan", "05 · True plan / north at top", (0, 650, .01), (0, 0, 0), .69)
    viewpoint(scene, "CA_Interior", "06 · Schematic internal passage section", (255, 102, 35), (0, 34, -15), .69)
    viewpoint(scene, "CA_Ground", "07 · Human scale / south-east corner", (184, 13, 208), (0, 65, 0), .88)
    viewpoint(scene, "CA_Survey", "08 · Survey instruments / base and height", (350, 230, 385), (0, 40, 0), .71)

    # An idealized desert surface with a level analytical pad near the pyramid.
    pts, faces, colors = [], [], []
    n, step = 41, 60
    for iz in range(n):
        z = (iz-(n-1)/2)*step
        for ix in range(n):
            x = (ix-(n-1)/2)*step
            dist = math.hypot(x, z)
            fade = min(1, max(0, (dist-230)/250))
            y = -.4 + fade*(10 + 13*math.sin(x*.005+z*.008)*math.sin(z*.006) + 7*math.sin(x*.012))
            pts.append((x, y, z))
    for iz in range(n-1):
        for ix in range(n-1):
            k = iz*n+ix
            faces.append((k, k+n, k+n+1, k+1))
            shade = .95 + .045*math.sin(ix*1.37+iz*1.7)
            colors.append((.255*shade, .227*shade, .177*shade))
    mesh(scene, pts, faces, "1 1 1", mat_def="Terrain", colors=colors)
    box(scene, (0, -.65, 0), (252, .5, 252), ".105 .125 .125")
    grid = [[(v, -.18, -310), (v, -.18, 310)] for v in range(-300, 301, 25)]
    grid += [[(-310, -.18, v), (310, -.18, v)] for v in range(-300, 301, 25)]
    polyline(scene, grid, ".17 .23 .22", alpha=.45)
    polyline(scene, [ring(r, -.12) for r in (175, 200, 250, 300)], ".22 .29 .27", alpha=.3)
    # Compass graduation and cardinal markers around the analytical site pad.
    ticks = []
    for i in range(72):
        t = math.pi*2*i/72
        r = 290 if i%6 == 0 else 295
        ticks.append([(r*math.sin(t), 0, r*math.cos(t)), (302*math.sin(t), 0, 302*math.cos(t))])
    polyline(scene, ticks, FAINT)
    for text, p, col in [("N", (0, 5, -266), CYAN), ("E", (266, 5, 0), WHITE), ("S", (0, 5, 266), WHITE), ("W", (-266, 5, 0), WHITE)]:
        label(scene, text, p, col, 12)
    polyline(scene, [[(0, .2, -246), (0, .2, -210)], [(-5, .2, -236), (0, .2, -246), (5, .2, -236)]], CYAN, 2)

    # The envelope and illustrative masonry share one deformable coordinate frame.
    monument = node(scene, "Transform", DEF="Monument")
    pyramid = node(monument, "Transform", DEF="Pyramid")
    body = mesh(pyramid, [(-A, 0, -A), (A, 0, -A), (A, 0, A), (-A, 0, A), (0, HEIGHT, 0)],
         [(0, 4, 1), (1, 4, 2), (2, 4, 3), (3, 4, 0)], "1 1 1", mat_def="Casing",
         colors=[(.78, .73, .61), (.86, .80, .66), (.94, .86, .70), (.84, .77, .62)])
    casing = body.find("Appearance/PhysicalMaterial")
    casing.set("normalScale", ".35")
    node(casing,"ImageTexture",containerField="baseTexture",url='"limestone-base.png"')
    node(casing,"ImageTexture",containerField="normalTexture",url='"limestone-normal.png"')
    node(body.find("Appearance"),"TextureTransform",scale="28 28")
    body.find("IndexedFaceSet").set("texCoordIndex","0 2 1 -1 0 2 1 -1 0 2 1 -1 0 2 1 -1")
    node(body.find("IndexedFaceSet"),"TextureCoordinate",point="0 0 1 0 .5 1")
    courses = switch(monument, "OverlayCourses", True)
    courses_group = node(courses,"Group")
    rings, joints = [], []
    count = 203
    for i in range(1, count):
        y = HEIGHT*i/count
        r = A*(1-y/HEIGHT)+.035
        rings.append(square(r, y))
        # Sparse stylized masonry joints; these are not a block-by-block survey.
        y0, y1 = HEIGHT*(i-1)/count, y
        r0, r1 = A*(1-y0/HEIGHT)+.04, r
        divisions = max(1, round(2*r0/7))
        for j in range(1, divisions):
            t = (j + (.5 if i%2 else 0))/divisions
            if t >= 1:
                continue
            u = 2*t-1
            joints.extend([[(u*r0, y0, -r0), (u*r1, y1, -r1)],
                           [(r0, y0, u*r0), (r1, y1, u*r1)],
                           [(u*r0, y0, r0), (u*r1, y1, r1)],
                           [(-r0, y0, u*r0), (-r1, y1, u*r1)]])
    polyline(courses_group, rings, ".30 .275 .22", alpha=.25)
    polyline(courses_group, joints, ".34 .31 .25", alpha=.48)
    polyline(monument, [[(-A, .1, -A), (0, HEIGHT+.1, 0), (A, .1, A)],
                        [(A, .1, -A), (0, HEIGHT+.1, 0), (-A, .1, A)]], ".91 .79 .51", 1.2, alpha=.35)

    # A projected silhouette, updated by the page's educational sun model.
    shadow = switch(scene, "OverlayShadow", True)
    mesh(shadow, [(-A, .05, -A), (A, .05, -A), (A, .05, A), (-A, .05, A), (-101, .05, -80)],
         [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], ".035 .047 .048", coord_def="ShadowCoordinate")

    pi = switch(scene, "OverlayPi", True)
    pi_root = node(pi, "Group")
    pc = node(pi_root, "Transform", DEF="PiCircle")
    polyline(pc, [ring(HEIGHT, .28)], GOLD, 2.4)
    polyline(pc, [[(0, .3, 0), (HEIGHT, .3, 0)]], GOLD, 2)
    # Arc wedges provide a perceptible subdivision of the circle.
    for i in range(4):
        t = i*math.pi/2
        ball(pc, (HEIGHT*math.cos(t), .35, HEIGHT*math.sin(t)), .75, GOLD)
    label(pc, "r = h", (HEIGHT*.69, 5, -7), GOLD, 6)
    ps = node(pi_root, "Transform", DEF="PiSquare")
    # Exact horizontal measurement: decorative outward offsets would exceed
    # the small pi residual that this overlay is intended to investigate.
    polyline(ps, [square(A, .03)], CYAN, 3)
    label(ps, "SQUARE PERIMETER  4b", (0, 5, A+18), CYAN, 6)
    label(pc, "CIRCLE CIRCUMFERENCE  2pi h", (0, 5, -HEIGHT-15), GOLD, 5.5)

    phi = switch(scene, "OverlayPhi")
    ph_group = node(phi,"Group")
    ph = node(ph_group, "Transform", DEF="PhiSection")
    # Shift just outside the east face so the measurement triangle reads clearly.
    px = A+8
    polyline(ph, [[(px, 0, -A), (px, 0, 0), (px, HEIGHT, 0), (px, 0, -A)],
                  [(px, 7, 0), (px, 7, -7), (px, 0, -7)]], GOLD, 3)
    mesh(ph, [(px, 0, -A), (px, 0, 0), (px, HEIGHT, 0)], [(0, 1, 2)], GOLD, .91)
    label(ph, "HALF-BASE  b/2", (px+4, -7, -A*.53), CYAN, 5)
    label(ph, "HEIGHT  h", (px+3, HEIGHT*.53, 9), CYAN, 5)
    label(ph, "SLANT  s", (px+5, HEIGHT*.56, -A*.55), GOLD, 6)
    # A small seked step diagram on the opposite side of the same section.
    step_reference = node(ph_group,"Group")
    polyline(step_reference, [[(px, 100, -A*.68), (px, 114, -A*.68), (px, 114, -A*.68+11)]], CYAN, 3)
    label(step_reference, "SEKED STEP / 5.5 PALM REFERENCE", (px+2, 124, -A*.68), CYAN, 3.4)

    survey = switch(scene, "OverlaySurvey")
    sm = node(survey, "Transform", DEF="SurveyMeasures")
    dimlines = [[(-A, 1, A+31), (A, 1, A+31)], [(A+31, 0, 0), (A+31, HEIGHT, 0)],
                [(0, HEIGHT, 0), (A+37, HEIGHT, 0)], [(0, .7, 0), (A+37, .7, 0)]]
    for x in (-A, A):
        dimlines.extend([[(x, 0, A+5), (x, 1, A+38)], [(x-3, 1, A+28), (x+3, 1, A+34)]])
    for y in (0, HEIGHT):
        dimlines.append([(A+28, y, -3), (A+34, y, 3)])
    polyline(sm, dimlines, GOLD, 2)
    label(sm, f"b = {BASE:.3f} m", (0, 7, A+40), GOLD, 7, text_def="SurveyBaseText")
    label(sm, f"h = {HEIGHT:.3f} m", (A+49, HEIGHT*.55, 0), GOLD, 6, text_def="SurveyHeightText")
    for i, (x, z) in enumerate([(-A, -A), (A, -A), (A, A), (-A, A)]):
        polyline(sm, [[(x-4, .3, z), (x+4, .3, z)], [(x, .3, z-4), (x, .3, z+4)]], CYAN, 2)
        cylinder(sm, (x, 0, z), (x, 6, z), .18, CYAN)
        label(sm, ["NW", "NE", "SE", "SW"][i], (x*1.09, 9, z*1.09), CYAN, 4)

    latitude = switch(scene, "OverlayLatitude")
    la = node(latitude, "Group")
    zclaim = -D["latitude"]["claim_point_north_of_centre_m"]
    # A constant-latitude plane is vertical in this local tangent frame.
    mesh(la, [(-A-25, 0, zclaim), (A+25, 0, zclaim), (A+25, HEIGHT+13, zclaim), (-A-25, HEIGHT+13, zclaim)], [(0, 1, 2, 3)], CORAL, .87)
    polyline(la, [[(-A-25, .45, zclaim), (A+25, .45, zclaim)],
                  [(-A-25, 0, zclaim), (-A-25, HEIGHT+13, zclaim), (A+25, HEIGHT+13, zclaim), (A+25, 0, zclaim)]], CORAL, 2)
    label(la, "CLAIMED LATITUDE  29.9792458 N", (0, HEIGHT+23, zclaim), CORAL, 6)
    polyline(la, [[(-A-25, .5, 0), (A+25, .5, 0)], [(0, 0, 0), (0, HEIGHT+4, 0)]], CYAN, 1.5)
    for z in range(-100, 101, 10):
        polyline(la, [[(-A-20, .3, z), (-A-13, .3, z)]], CYAN)
    label(la, "LOCAL TANGENT FRAME / NORTH -Z", (0, 6, -A-31), CYAN, 5)

    interior = switch(scene, "OverlayInterior")
    ins = node(interior, "Transform", DEF="InteriorModel")
    def wire_room(c, size, name):
        x, y, z = c
        w, h, d = [s/2 for s in size]
        p = [(x+xx*w, y+yy*h, z+zz*d) for yy in (-1, 1) for zz in (-1, 1) for xx in (-1, 1)]
        pairs = [(0,1),(1,3),(3,2),(2,0),(4,5),(5,7),(7,6),(6,4),(0,4),(1,5),(2,6),(3,7)]
        mesh(ins, p, [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)], CYAN, .65)
        polyline(ins, [[p[i],p[j]] for i,j in pairs], CYAN, 2)
        label(ins, name, (x+17,y+8,z), CYAN, 3.4)
    wire_room((0, 43, 13), (10.5, 5.8, 5.2), "KING'S CHAMBER")
    wire_room((0, 20, 0), (5.2, 6.2, 5.7), "QUEEN'S CHAMBER")
    cylinder(ins, (0,21,-41.3), (0,43,-.6), 1.7, GOLD)
    cylinder(ins, (0,43,-.6), (0,43,10), .6, GOLD)
    cylinder(ins, (0,20,-38), (0,20,0), .55, CYAN)
    cylinder(ins, (0,17,-101), (0,4,-75), .65, CYAN)
    cylinder(ins, (0,4,-75), (0,21,-41.3), .65, GOLD)
    polyline(ins, [[(0,43,13),(0,95,70)], [(0,43,13),(0,90,-70)]], CYAN, 1.2)
    label(ins, "GRAND GALLERY", (0, 37, -32), GOLD, 4)
    label(ins, "SCHEMATIC INTERIOR / NOT A SURVEY", (0, -9, 0), CYAN, 4.5)

    solar = switch(scene, "OverlaySolar")
    sr = node(solar, "Group")
    # Analytic celestial meridian arc, NOT a historical stellar alignment.
    arc = [(215*math.cos(math.pi*i/90), 215*math.sin(math.pi*i/90), 0) for i in range(91)]
    polyline(sr, [arc], FAINT, 1)
    polyline(sr, [arc], GOLD, 1.8, coord_def="SolarPathCoordinates")
    polyline(sr, [[(-215, 0, 0),(215, 0, 0)]], GOLD, 1.8)
    for d in (0, 15, 30, 45, 60, 75, 90):
        t = math.radians(d)
        label(sr, f"{d} deg", (224*math.cos(t),224*math.sin(t),0), GOLD, 4)
    sun_marker = node(sr, "Transform", DEF="SunMarker", translation=(140,164,0))
    ball(sun_marker, (0,0,0), 5, GOLD)
    label(sr, "SOLAR ALTITUDE / IDEAL LEVEL HORIZON", (0,238,0), GOLD, 5)

    # A real 1.8 m silhouette and a 10 m segmented ruler make scale tangible.
    human = node(scene, "Transform", translation=(A+13,0,A+8))
    ball(human, (0,1.67,0), .13, WHITE)
    cylinder(human, (0,1.46,0), (0,1.58,0), .06, WHITE)
    cylinder(human,(0,.73,0),(0,1.48,0),.16,WHITE)
    for s in (-1,1):
        cylinder(human,(0,.78,0),(s*.16,.08,0),.07,WHITE)
        cylinder(human,(s*.12,1.39,0),(s*.31,.92,0),.06,WHITE)
    label(scene, "1.8 m HUMAN", (A+13,4,A+10), WHITE, 2.2)
    for y in range(10):
        box(scene,(-A-12,y+.5,A+8),(.6,1,.6), GOLD if y%2 else WHITE)
    label(scene, "10 m",(-A-12,13,A+8),WHITE,3.2)
    polyline(scene, [square(126.5,.15)], ".46 .46 .34", 1)
    return x3d


def main():
    stone_textures()
    x3d = build()
    defs = [n.attrib["DEF"] for n in x3d.iter() if "DEF" in n.attrib]
    assert len(defs) == len(set(defs)), "Duplicate DEF"
    ET.indent(x3d, space="  ")
    target = ROOT / "assets" / "observatory.x3d"
    target.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(x3d).write(target, encoding="utf-8", xml_declaration=True)
    print(f"Wrote {target.name}: {target.stat().st_size:,} bytes; {len(defs)} named nodes")


if __name__ == "__main__":
    main()
