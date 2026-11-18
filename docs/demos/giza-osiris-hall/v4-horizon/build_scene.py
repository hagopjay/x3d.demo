#!/usr/bin/env python3
"""Build the deterministic, asset-free Horizon Engine X3D demonstration.

Python 3.13+; standard library only. Run from any directory. All generated
geometry is dedicated to the public domain under CC0-1.0. Coordinates use
metres, +Y up, +X east, +Z south; Khufu's base centre is the origin.

The pyramid envelope and chamber dimensions are approximate. The landscape,
geology, materials, field lines, pharaoh and celestial imagery are SCHEMATIC.
Hypothetical crystals/conductors and mythic objects are not archaeological
findings. Luminous field geometry is an illustration, not an EM solution.

Story anchors (all lengths in metres):
  SW_MACHINERY -> MACHINE_ANCHOR [0,42.6,0] -> T_MACHINE: rotation offset.
  SW_CRAFT -> T_CRAFT [0,0,0] -> CRAFT_ANCHOR [0,229,-108].
  SW_BEINGS -> BEINGS_ANCHOR [0,185,-40] -> T_BEINGS: scale about the dais.
  Beings' feet: [-14,185,-38], [0,185,-44], [14,185,-38].
  V_Immersive begins [0,42.08,-0.70], looking toward portal [0,190,-30].
  V_Witness starts at the section camera and is independently animated.
The machinery, craft, and nonhuman beings are entirely authored fiction.
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path
import random
import xml.etree.ElementTree as ET

TAU = 2 * math.pi
RNG = random.Random(40717)
OUT = Path(__file__).with_name("horizon.x3d")


def fmt(value):
    if isinstance(value, (tuple, list)):
        return " ".join(fmt(v) for v in value)
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError("non-finite geometry")
        return f"{value:.6g}"
    return str(value)


def el(parent, tag, **attrs):
    return ET.SubElement(parent, tag, {key: fmt(value) for key, value in attrs.items()})


def transform(parent, pos=(0, 0, 0), scale=None, rotation=None, DEF=None):
    attrs = dict(translation=pos)
    if scale is not None:
        attrs["scale"] = scale
    if rotation is not None:
        attrs["rotation"] = rotation
    if DEF:
        attrs["DEF"] = DEF
    return el(parent, "Transform", **attrs)


def switch(parent, name, choice=0):
    return el(parent, "Switch", DEF=name, whichChoice=choice)


def material(parent, name, color, emissive=(0, 0, 0), transparency=0, shininess=.45):
    app = el(parent, "Appearance", DEF=name)
    el(app, "Material", diffuseColor=color, emissiveColor=emissive,
       specularColor=(.55, .51, .42), shininess=shininess,
       ambientIntensity=.28, transparency=transparency)
    return app


def shape(parent, appearance):
    node = el(parent, "Shape")
    el(node, "Appearance", USE=appearance)
    return node


def box(parent, pos, size, appearance, rotation=None):
    node = shape(transform(parent, pos, rotation=rotation), appearance)
    el(node, "Box", size=size)
    return node


def sphere(parent, pos, radius, appearance, scale=None):
    node = shape(transform(parent, pos, scale=scale), appearance)
    el(node, "Sphere", radius=radius)
    return node


def cylinder(parent, a, b, radius, appearance):
    d = tuple(b[i] - a[i] for i in range(3))
    length = math.sqrt(sum(x*x for x in d))
    if length < 1e-8:
        raise ValueError("zero length cylinder")
    unit = tuple(x / length for x in d)
    axis = (unit[2], 0, -unit[0])
    axis_length = math.sqrt(sum(x*x for x in axis))
    rotation = ((axis[0]/axis_length, 0, axis[2]/axis_length,
                 math.acos(max(-1, min(1, unit[1]))))
                if axis_length > 1e-8 else (1, 0, 0, 0 if unit[1] >= 0 else math.pi))
    node = shape(transform(parent, tuple((a[i]+b[i])/2 for i in range(3)), rotation=rotation), appearance)
    el(node, "Cylinder", radius=radius, height=length)
    return node


def mesh(parent, points, faces, appearance, colors=None, solid=False, crease=0):
    node = shape(parent, appearance)
    geo = el(node, "IndexedFaceSet", solid=solid, creaseAngle=crease,
             colorPerVertex=False,
             coordIndex=" ".join(" ".join(str(i) for i in face) + " -1" for face in faces))
    el(geo, "Coordinate", point=points)
    if colors:
        el(geo, "Color", color=[tuple(max(0, min(1, c)) for c in color) for color in colors])
    return node


def lines(parent, points, paths, appearance="A_CYAN"):
    node = shape(parent, appearance)
    geo = el(node, "IndexedLineSet", coordIndex=" ".join(" ".join(map(str, path))+" -1" for path in paths))
    el(geo, "Coordinate", point=points)
    return node


def ring(parent, centre, radius, appearance="A_CYAN", plane="xz", segments=96, ellipse=1):
    points = []
    for i in range(segments):
        u, v = radius*math.cos(TAU*i/segments), radius*ellipse*math.sin(TAU*i/segments)
        delta = (u, 0, v) if plane == "xz" else (u, v, 0) if plane == "xy" else (0, u, v)
        points.append(tuple(centre[j]+delta[j] for j in range(3)))
    return lines(parent, points, [list(range(segments))+[0]], appearance)


def torus(parent, centre, rx, ry, tube, appearance, major=48, minor=8):
    points, faces = [], []
    for i in range(major):
        a = TAU*i/major
        for j in range(minor):
            b = TAU*j/minor
            points.append((centre[0]+(rx+tube*math.cos(b))*math.cos(a),
                           centre[1]+(ry+tube*math.cos(b))*math.sin(a),
                           centre[2]+tube*math.sin(b)))
    for i in range(major):
        for j in range(minor):
            faces.append((i*minor+j, ((i+1)%major)*minor+j,
                          ((i+1)%major)*minor+(j+1)%minor, i*minor+(j+1)%minor))
    return mesh(parent, points, faces, appearance, crease=math.pi)


def viewpoint(parent, name, description, position, target, fov=.78):
    # Rotate X3D's local -Z sightline onto the requested look direction.
    d = tuple(target[i]-position[i] for i in range(3))
    length = math.sqrt(sum(v*v for v in d))
    d = tuple(v/length for v in d)
    axis = (d[1], -d[0], 0)
    norm = math.hypot(axis[0], axis[1])
    rotation = ((axis[0]/norm, axis[1]/norm, 0, math.acos(max(-1, min(1, -d[2]))))
                if norm > 1e-9 else (0, 1, 0, 0 if d[2] < 0 else math.pi))
    return el(parent, "Viewpoint", DEF=name, description=description, position=position,
              orientation=rotation, centerOfRotation=target, fieldOfView=fov,
              nearDistance=.04, farDistance=12000, retainUserOffsets=False)


def build_materials(scene):
    # Definitions live inside a hidden Switch and are shared throughout.
    bank = el(el(scene, "Switch", whichChoice=-1), "Group")
    palette = {
        "A_STONE": ((.64, .49, .29), (0, 0, 0), 0),
        "A_REAR": ((.48, .37, .23), (.018, .023, .035), 0),
        "A_DESERT": ((.21, .16, .12), (.012, .016, .035), 0),
        "A_BASALT": ((.055, .075, .10), (.005, .012, .025), 0),
        "A_GRANITE": ((.31, .18, .17), (.012, .006, .008), 0),
        "A_GOLD": ((.85, .57, .14), (.11, .055, .008), 0),
        "A_LAPIS": ((.018, .08, .22), (.006, .018, .07), 0),
        "A_SKIN": ((.49, .26, .11), (.018, .008, .003), 0),
        "A_CYAN": ((0, 0, 0), (.10, .70, .87), .07),
        "A_DIM_CYAN": ((0, 0, 0), (.025, .19, .24), .22),
        "A_GOLD_LIGHT": ((0, 0, 0), (.95, .59, .16), .04),
        "A_DIM_GOLD": ((0, 0, 0), (.22, .15, .05), .22),
        "A_VIOLET": ((0, 0, 0), (.43, .22, .82), .20),
        "A_QUARTZ": ((.37, .71, .79), (.07, .20, .26), .43),
        "A_GHOST": ((.08, .40, .52), (.08, .63, .76), .61),
        "A_WATER": ((.025, .15, .20), (.008, .04, .07), .21),
        "A_BEAM": ((.06, .28, .33), (.035, .17, .22), .93),
        "A_WHITE": ((0, 0, 0), (.77, .86, .94), 0),
        "A_STAR_BODY": ((.21, .46, .53), (.055, .30, .39), .12),
        "A_STAR_DARK": ((.025, .065, .14), (.008, .04, .085), 0),
    }
    for name, (color, emission, transparency) in palette.items():
        node = el(bank, "Shape")
        app = material(node, name, color, emission, transparency, .8 if name == "A_GOLD" else .4)
        if "CYAN" in name or "LIGHT" in name or "DIM" in name:
            el(app, "LineProperties", applied=True, linewidthScaleFactor=1.4)
    holder = el(bank, "Shape")
    app = el(holder, "Appearance", DEF="A_FIELD")
    el(app, "Material", DEF="M_FIELD", diffuseColor=(0, 0, 0), emissiveColor=(.04, .48, .70), transparency=.34)
    el(app, "LineProperties", applied=True, linewidthScaleFactor=1.6)
    app = el(el(bank, "Shape"), "Appearance", DEF="A_WAS_GLOW")
    el(app, "Material", DEF="M_WAS_GLOW", diffuseColor=(0,0,0),
       emissiveColor=(1,.61,.18), transparency=.30)
    el(app, "LineProperties", applied=True, linewidthScaleFactor=1.8)


def terrain(scene):
    points, faces, colors = [], [], []
    count, step = 56, 64
    for iz in range(count+1):
        z = (iz-count/2)*step
        for ix in range(count+1):
            x = (ix-count/2)*step
            y = -5 + 2.8*math.sin(x*.009+z*.003)+1.8*math.sin(z*.014-x*.002)
            points.append((x, y, z))
    for iz in range(count):
        for ix in range(count):
            x, z = (ix-count/2+.5)*step, (iz-count/2+.5)*step
            if abs(x) < 185 and abs(z) < 185:
                continue  # expose the illustrative geological section
            a = iz*(count+1)+ix
            faces.append((a, a+count+1, a+count+2, a+1))
            v = .80+.22*RNG.random()
            colors.append((v, v*.91, v*.78))
    mesh(scene, points, faces, "A_DESERT", colors, crease=.8)
    box(scene, (0, -34, 0), (285, 3, 285), "A_BASALT")
    # Exposed geological rear/west faces: deliberately schematic strata.
    for i, h in enumerate((5, 4, 7, 5, 8)):
        y = -3-sum((5, 4, 7, 5, 8)[:i])-h/2
        box(scene, (0, y, -139), (280, h-.3, 5), "A_GRANITE" if i % 2 else "A_STONE")
        box(scene, (-139, y, 0), (5, h-.3, 280), "A_GRANITE" if i % 2 else "A_STONE")
    for y in (-3, -8, -12, -19, -24, -32):
        lines(scene, [(-140,y,140),(140,y,140),(140,y,-140)], [[0,1,2]], "A_DIM_GOLD")
    # The base perimeter has a centre opening for the conceptual section.
    for x in (-120, 120):
        box(scene, (x,-1,0), (10,2,250), "A_STONE")
    for z in (-120, 120):
        box(scene, (0,-1,z), (230,2,10), "A_STONE")
    for r in (150, 175):
        ring(scene, (0,-.3,0), r, "A_DIM_GOLD", segments=160)
    water = transform(scene, (0,-3,0), DEF="T_WATER")
    box(water, (530,0,120), (185,.3,2300), "A_WATER")
    p, paths = [], []
    for j in range(110):
        z = -1000+j*20
        start = len(p)
        for k in range(15):
            x = 440+k*12
            p.append((x,.22+.07*math.sin(k*.8+j), z+1.4*math.sin(k*.7+j*.3)))
        paths.append(list(range(start, len(p))))
    lines(water, p, paths, "A_DIM_CYAN")


def pyramid_face(parent, face, appearance="A_STONE", courses=160):
    points, faces, colors = [], [], []
    def point(s, y, t):
        a = -s+2*s*t
        return ((a,y,s) if face == 0 else (s,y,-a) if face == 1
                else (-a,y,-s) if face == 2 else (-s,y,a))
    for level in range(courses):
        y0, y1 = level*146/courses+.035, (level+1)*146/courses-.035
        s0, s1 = 115*(1-y0/146), 115*(1-y1/146)
        n = max(1, round(2*s0/7))
        for brick in range(n):
            gap = min(.012, .07/max(s0, .1))
            t0, t1 = brick/n+gap/2, (brick+1)/n-gap/2
            i = len(points)
            points.extend((point(s0,y0,t0), point(s0,y0,t1), point(s1,y1,t1), point(s1,y1,t0)))
            faces.append((i,i+1,i+2,i+3))
            v = .78+.25*RNG.random()
            colors.append((v, v*(.93+.05*RNG.random()), v*.86))
    mesh(parent, points, faces, appearance, colors)


def pyramid(scene):
    rear = el(scene, "Group")
    pyramid_face(rear, 2, "A_REAR")
    pyramid_face(rear, 3, "A_REAR")
    front = el(switch(scene, "SW_SHELL_FRONT", -1), "Group")
    pyramid_face(front, 0)
    pyramid_face(front, 1)
    for parent, corners in ((rear, ((-115,0,-115),(-115,0,115),(115,0,-115))),
                            (front, ((115,0,115),))):
        p = list(corners)+[(0,146,0)]
        lines(parent, p, [[i,len(p)-1] for i in range(len(p)-1)], "A_DIM_GOLD")
    # Small nearby silhouettes establish scale; their placement is illustrative.
    for position, size in (((-410,0,-410),.69), ((-650,0,-590),.34), ((-265,0,-300),.12)):
        node = transform(scene, position, scale=(size,size,size))
        verts = [(-115,0,-115),(115,0,-115),(115,0,115),(-115,0,115),(0,146,0)]
        mesh(node, verts, [(0,1,4),(1,2,4),(2,3,4),(3,0,4)], "A_REAR")
        lines(node, verts, [[0,4],[1,4],[2,4],[3,4]], "A_DIM_GOLD")


def quartz(scene):
    group = el(switch(scene, "SW_QUARTZ", 0), "Group")
    for cluster in range(38):
        x, z = RNG.uniform(-90,100), RNG.uniform(-82,96)
        y = RNG.uniform(-30,-24)
        for shard in range(3):
            radius, height = RNG.uniform(1.8,3.8), RNG.uniform(6,17)
            cx, cz = x+RNG.uniform(-4,4), z+RNG.uniform(-4,4)
            points = [(cx+radius*math.cos(TAU*j/6),y,cz+radius*math.sin(TAU*j/6)) for j in range(6)]
            points += [(cx+radius*.83*math.cos(TAU*j/6),y+height*.7,cz+radius*.83*math.sin(TAU*j/6)) for j in range(6)]
            points.append((cx+.2*radius,y+height,cz-.3*radius))
            faces = [(j,(j+1)%6,(j+1)%6+6,j+6) for j in range(6)]
            faces += [(j+6,(j+1)%6+6,12) for j in range(6)]
            mesh(group, points, faces, "A_QUARTZ")
            lines(group, points, [[j,j+6,12] for j in range(0,6,2)], "A_DIM_CYAN")


def passages(scene):
    # Visible paths are diagrammatic centre lines, not surveyed tunnels.
    path = [(0,1,108),(0,5,70),(0,16,30),(0,31,12),(0,40.5,0)]
    lines(scene, path, [list(range(len(path)))], "A_DIM_GOLD")
    for i in range(len(path)-1):
        cylinder(scene, path[i], path[i+1], .70, "A_BEAM")
    for y, z in ((5,70),(16,30),(31,12)):
        ring(scene, (0,y,z), 2.4, "A_DIM_GOLD", plane="xy", segments=40)


def pharaoh(parent, ghost=False):
    skin, gold, blue = ("A_GHOST",)*3 if ghost else ("A_SKIN","A_GOLD","A_LAPIS")
    # Local feet at y=0; forward is +Z. Statue is approximately 1.95 m tall.
    for x in (-.12,.12):
        cylinder(parent, (x,.13,0),(x,.83,0), .085, gold)
        sphere(parent, (x,.10,.065), .11, gold, scale=(.8,.5,1.55))
    sphere(parent, (0,.91,0), .22, blue, scale=(1.15,.70,.68))
    sphere(parent, (0,1.19,0), .28, skin, scale=(1.07,1.25,.58))
    cylinder(parent, (0,1.40,0),(0,1.59,0), .09, gold)
    sphere(parent, (0,1.71,.02), .17, skin, scale=(.92,1.15,.91))
    # Nemes headdress flaps, crown and cobra.
    sphere(parent, (0,1.76,-.055), .205, blue, scale=(1.12,1.08,.7))
    for sign in (-1,1):
        mesh(parent, [(sign*.15,1.85,-.07),(sign*.26,1.79,-.04),
                      (sign*.25,1.34,.06),(sign*.13,1.48,.06)], [(0,1,2,3)], gold)
        if not ghost:
            for j in range(8):
                y = 1.39+j*.048
                cylinder(parent, (sign*.15,y,.069),(sign*.244,y,.069), .008, blue)
    if not ghost:
        sphere(parent,(0,1.91,.09),.036,gold,scale=(.55,1.4,.7))
        cylinder(parent,(0,1.89,.09),(0,1.96,.10),.014,gold)
        for x in (-.065,.065):
            sphere(parent, (x,1.735,.155), .024, blue, scale=(1.5,.40,.35))
        sphere(parent, (0,1.70,.175), .034, gold, scale=(.5,1.3,1.0))
        cylinder(parent,(-.045,1.63,.153),(.045,1.63,.153),.009,blue)
        cylinder(parent,(0,1.61,.12),(0,1.51,.15),.025,gold)
    # Broad collar and crossed forearms.
    for i in range(4):
        torus(parent,(0,1.43-i*.027,.005),.16+i*.034,.042,.014, gold if i % 2 else blue, major=36)
    for sign in (-1,1):
        shoulder = (sign*.27,1.35,0)
        elbow = (sign*.25,1.02,.1)
        hand = (-sign*.12,1.28,.18)
        cylinder(parent,shoulder,elbow,.066,gold)
        cylinder(parent,elbow,hand,.055,gold)
        sphere(parent,hand,.065,skin,scale=(.65,1,.60))
    # A lapis kilt with fine gold belt and central apron.
    box(parent,(0,.89,.005),(.46,.095,.29),gold)
    mesh(parent,[(-.22,.86,-.13),(.22,.86,-.13),(.29,.57,-.13),(-.29,.57,-.13),
                 (-.22,.86,.14),(.22,.86,.14),(.29,.57,.14),(-.29,.57,.14)],
         [(4,5,6,7),(0,3,2,1),(0,4,7,3),(1,2,6,5),(0,1,5,4)],blue)
    if not ghost:
        for j in range(9):
            x = -.25+j*.0625
            cylinder(parent,(x,.59,.15),(x*.82,.84,.15),.006,gold)
        box(parent,(0,.72,.165),(.095,.29,.024),gold)


def chamber(scene):
    group = el(scene,"Group",DEF="CHAMBER")
    box(group,(0,40.20,0),(11.3,.4,6.5),"A_GRANITE")
    # An open south wall is deliberate for legibility; the closed roof is optional.
    for row in range(5):
        y = 40.9+row*.99
        for col in range(6):
            x = -4.56+col*1.824
            box(group,(x,y,-3.03),(1.80,.96,.38),"A_GRANITE")
        for side in (-1,1):
            for col in range(3):
                z = -1.88+col*1.88
                box(group,(side*5.43,y,z),(.36,.96,1.85),"A_GRANITE")
    roof = el(switch(group,"SW_CHAMBER_ROOF",-1),"Group")
    for col in range(9):
        box(roof,(-4.80+col*1.20,45.78,0),(1.17,.48,6.45),"A_GRANITE")
    # Schematic relieving beams sit clear of the open chamber.
    for y in (48,51,54):
        for x in (-5.65,5.65):
            box(group,(x,y,0),(.6,.42,6.4),"A_BASALT")
        lines(group,[(-5.65,y,-3.2),(5.65,y,-3.2),(5.65,y,3.2),(-5.65,y,3.2)],[[0,1,2,3,0]],"A_DIM_GOLD")
    # Granite sarcophagus and pedestal, not a reconstruction of a royal burial.
    box(group,(0,40.70,0),(1.28,.55,2.8),"A_BASALT")
    box(group,(0,41.02,0),(1.20,.13,2.72),"A_GRANITE")
    for x in (-.64,.64):
        box(group,(x,41.27,0),(.15,.58,2.9),"A_GRANITE")
    for z in (-1.40,1.40):
        box(group,(0,41.27,z),(1.15,.58,.15),"A_GRANITE")
    # Face-up: local forward +Z rotates toward world +Y.
    royal_body = el(switch(group,"SW_ROYAL_BODY",0),"Group")
    figure = transform(royal_body,(0,41.31,1.02),rotation=(1,0,0,-math.pi/2))
    pharaoh(figure)
    # Ankh: a distinct loop and cross, suspended above the heart.
    ankh = transform(group,(-.06,41.90,-.18),rotation=(1,0,0,-math.pi/2),scale=(.72,.72,.72))
    torus(ankh,(0,.19,0),.11,.16,.027,"A_GOLD")
    box(ankh,(0,-.13,0),(.048,.36,.052),"A_GOLD")
    box(ankh,(0,.02,0),(.31,.046,.052),"A_GOLD")
    heart = transform(group,(-.06,41.99,-.23),DEF="T_HEART")
    sphere(heart,(0,0,0),.065,"A_GOLD_LIGHT")
    ring(heart,(0,0,0),.15,"A_GOLD_LIGHT",plane="xz",segments=48)
    head = transform(group,(0,42.02,-.70),DEF="T_HEAD")
    sphere(head,(0,0,0),.052,"A_CYAN")
    ring(head,(0,0,0),.14,"A_CYAN",plane="xz",segments=48)
    # Was is a prominent floating ritual prop above the brow. It remains an
    # authored composition, not an assertion about funerary practice.
    device = transform(group,(.39,42.46,-1.03),rotation=(1,0,0,-1.08),scale=(.47,.47,.47))
    choices = switch(device,"SW_DEVICE",0)
    was = transform(el(choices,"Group"),scale=(1,1,1),DEF="T_WAS")
    cylinder(was,(0,-.95,0),(0,1.05,0),.027,"A_GOLD")
    for sign in (-1,1):
        cylinder(was,(0,-.95,0),(sign*.11,-1.15,0),.025,"A_GOLD")
    mesh(was,[(-.07,1.03,-.04),(.28,1.14,-.04),(.21,1.23,-.04),(-.13,1.21,-.04),
              (-.07,1.03,.04),(.28,1.14,.04),(.21,1.23,.04),(-.13,1.21,.04)],
         [(0,1,2,3),(4,7,6,5),(0,4,5,1),(3,2,6,7),(0,3,7,4),(1,5,6,2)],"A_GOLD")
    for y in (-.70,-.34,.02,.38,.74):
        sphere(was,(0,y,.032),.038,"A_LAPIS",scale=(.75,.75,.5))
    was_aura=el(switch(was,"SW_WAS_AURA",-1),"Group")
    ring(was_aura,(.05,1.13,0),.24,"A_WAS_GLOW",plane="xy",segments=72,ellipse=.67)
    ring(was_aura,(.05,1.13,0),.30,"A_WAS_GLOW",plane="xy",segments=72,ellipse=.67)
    lines(was_aura,[(-.07,-.9,0),(-.07,1.02,0),(.07,-.9,0),(.07,1.02,0)],
          [[0,1],[2,3]],"A_WAS_GLOW")
    djed = el(choices,"Group")
    cylinder(djed,(0,-.70,0),(0,.75,0),.10,"A_LAPIS")
    for y in (.12,.33,.54,.75):
        box(djed,(0,y,0),(.62,.10,.27),"A_GOLD")
    box(djed,(0,-.76,0),(.46,.15,.35),"A_GOLD")
    receiver = el(choices,"Group")
    for radius in (.22,.35,.48):
        torus(receiver,(0,.16,0),radius,radius,.022,"A_GOLD")
    cylinder(receiver,(0,-.85,0),(0,-.30,0),.06,"A_LAPIS")
    sphere(receiver,(0,.16,0),.09,"A_CYAN")
    for x in (-4.7,4.7):
        el(group,"PointLight",location=(x,43.4,1.7),color=(1,.64,.26),intensity=.85,radius=13,attenuation=(1,.08,.02))
        sphere(group,(x,42.2,1.7),.075,"A_GOLD_LIGHT")
    el(group,"PointLight",location=(0,44,1),color=(.20,.64,1),intensity=.65,radius=13,attenuation=(1,.05,.018))


def conductors(scene):
    group = el(switch(scene,"SW_CONDUCTOR",-1),"Group")
    # These deliberately external traces express the hypothetical network.
    for radius, y in ((108,1),(76,43),(44,84),(12,127)):
        points = [(-radius,y,-radius),(radius,y,-radius),(radius,y,radius),(-radius,y,radius)]
        lines(group,points,[[0,1,2,3,0]],"A_GOLD_LIGHT")
    for sign in (-1,1):
        cylinder(group,(sign*95,-24,95),(sign*79,42,79),.32,"A_GOLD")
        lines(group,[(sign*79,42,79),(sign*35,43,35),(0,43,0),(0,146,0)],[[0,1,2,3]],"A_GOLD_LIGHT")
    sphere(group,(0,146,0),1.5,"A_GOLD_LIGHT")


def fields(scene):
    node = transform(el(switch(scene,"SW_FIELD",0),"Group"),DEF="T_FIELD")
    points, paths = [], []
    # Meridional loops form a toroidal teaching glyph around the monument.
    for meridian in range(24):
        az = TAU*meridian/24
        start = len(points)
        for i in range(97):
            a = TAU*i/96
            r = 74+55*math.cos(a)
            points.append((r*math.cos(az),62+72*math.sin(a),r*math.sin(az)))
        paths.append(list(range(start,len(points))))
    for y in (3,22,43,65,88,110,130):
        r = 128*math.sqrt(max(.05,1-((y-62)/92)**2))
        start = len(points)
        points += [(r*math.cos(TAU*i/128),y,r*math.sin(TAU*i/128)) for i in range(129)]
        paths.append(list(range(start,len(points))))
    lines(node,points,paths,"A_FIELD")
    # Axial guide column is intentionally faint and transparent.
    cylinder(node,(0,-28,0),(0,185,0),2.5,"A_BEAM")
    for y in (14,43,73,104,146):
        ring(node,(0,y,0),5.5,"A_FIELD",segments=64)
    ka = transform(el(switch(scene,"SW_KA",-1),"Group"),DEF="T_KA")
    standing = transform(ka,(0,42.35,0))
    pharaoh(standing,ghost=True)
    for y in (.3,1.0,1.8):
        ring(standing,(0,y,0),.42,"A_CYAN",segments=48)


def cosmic(scene):
    node = el(switch(scene,"SW_COSMIC",-1),"Group")
    centre = (0,190,-30)
    for radius in (38,42,46,57,59,74,76):
        ring(node,centre,radius,"A_CYAN" if radius % 2 else "A_GOLD_LIGHT",plane="xy",segments=240)
    points, paths = [], []
    for j in range(96):
        a = TAU*j/96
        radius = 60 if j % 4 else 58
        start = len(points)
        for r in (radius,68 if j % 4 else 73):
            points.append((r*math.cos(a),190+r*math.sin(a),-30))
        paths.append([start,start+1])
    # Layered eight-point geometry and a rising double helix.
    for step in (3,5):
        start = len(points)
        points += [(38*math.cos(TAU*j/16),190+38*math.sin(TAU*j/16),-30) for j in range(16)]
        paths.append([start+(j*step)%16 for j in range(17)])
    for phase in (0,math.pi):
        start=len(points)
        points += [(8*math.cos(i*.09+phase),45+i*.51,-1+8*math.sin(i*.09+phase)) for i in range(280)]
        paths.append(list(range(start,len(points))))
    lines(node,points,paths,"A_GOLD_LIGHT")
    # A hovering stellar barque silhouette: explicit authored mythic imagery.
    barque = transform(node,(0,185,-28),scale=(5,5,5))
    mesh(barque,[(-5,0,0),(-3,-.5,0),(3,-.5,0),(5,0,0),(3.5,-1,0),(-3.5,-1,0)],
         [(0,1,2,3,4,5)],"A_GOLD")
    cylinder(barque,(0,-.3,0),(0,3.5,0),.055,"A_GOLD")
    sphere(barque,(0,3.75,0),.60,"A_GOLD_LIGHT",scale=(1,1,.1))


def horizontal_torus(parent, centre, rx, rz, tube, appearance, segments=96):
    """A smooth elliptical ring in the XZ plane, centred at centre."""
    node=transform(parent,centre,rotation=(1,0,0,math.pi/2))
    return torus(node,(0,0,0),rx,rz,tube,appearance,major=segments)


def story_machinery(scene):
    """Wholly fictional bronze/lapis mechanisms unfolding around the coffin."""
    layer=el(switch(scene,"SW_MACHINERY",-1),"Group")
    el(layer,"MetadataString",name="classification",value='"Authored mythic fiction; no archaeological claim"')
    fixed=transform(layer,(0,42.6,0),DEF="MACHINE_ANCHOR")
    rotor=transform(fixed,rotation=(0,1,0,0),DEF="T_MACHINE")
    for rx,rz,y,appearance in ((2.48,1.88,0,"A_GOLD"),(2.30,1.70,.08,"A_LAPIS"),
                                (2.12,1.52,.12,"A_GOLD"),(1.92,1.32,.15,"A_CYAN")):
        horizontal_torus(rotor,(0,y,0),rx,rz,.037,appearance)
    # Segmented rim, etched radial graduations, and crystalline resonator heads.
    points,paths=[],[]
    for i in range(48):
        a=TAU*i/48
        x,z=2.39*math.cos(a),1.79*math.sin(a)
        if i%2==0:
            box(rotor,(x,-.035,z),(.13,.095,.115),"A_GOLD",rotation=(0,1,0,-a))
        start=len(points)
        for factor in (1.01,1.10 if i%4==0 else 1.055):
            points.append((2.18*factor*math.cos(a),.15,1.58*factor*math.sin(a)))
        paths.append([start,start+1])
    lines(rotor,points,paths,"A_GOLD_LIGHT")
    for side in (-1,1):
        for front in (-1,1):
            a=(side*1.87,-1.22,front*1.45)
            b=(side*2.28,-.5,front*1.50)
            c=(side*1.64,-.18,front*.92)
            cylinder(fixed,a,b,.065,"A_GOLD")
            cylinder(fixed,b,c,.042,"A_LAPIS")
            sphere(fixed,b,.11,"A_GOLD")
            sphere(fixed,c,.095,"A_CYAN",scale=(.75,1.5,.75))
    # Two ceremonial bearing wheels frame the body without covering its face.
    for x in (-1.05,1.05):
        wheel=transform(fixed,(x,-.45,0),rotation=(0,1,0,math.pi/2))
        for radius in (.39,.48,.57):
            torus(wheel,(0,0,0),radius,radius,.025,"A_GOLD",major=64)
        for i in range(12):
            a=TAU*i/12
            cylinder(wheel,(.15*math.cos(a),.15*math.sin(a),0),
                     (.48*math.cos(a),.48*math.sin(a),0),.012,"A_LAPIS")


def craft_hull(parent):
    """Faceted elliptical shell with alternating gold and lapis inlay panels."""
    rings=((.05,8.9),(.16,8.6),(.35,5.7),(.60,2.2),(.82,.4),
           (1.0,-1.0),(1.025,-2.0),(.98,-3.0),(.68,-4.9),(.35,-6),(.05,-6.6))
    points,faces,colors=[],[],[]
    count=128
    for fraction,y in rings:
        points += [(52*fraction*math.cos(TAU*j/count),y,
                    24*fraction*math.sin(TAU*j/count)) for j in range(count)]
    for i in range(len(rings)-1):
        for j in range(count):
            faces.append((i*count+j,i*count+(j+1)%count,
                          (i+1)*count+(j+1)%count,(i+1)*count+j))
            inlay=(j%16 in (0,1,2)) and i not in (5,6)
            colors.append((.055,.15,.34) if inlay else (.78+.10*math.cos(j*.18),.56,.23))
    node=mesh(parent,points,faces,"A_GOLD",colors,crease=.55)
    node.find("IndexedFaceSet").set("DEF","G_CRAFT_HULL")


def celestial_craft(scene):
    """A fictional solar barque interpreted as intricate ancient machinery."""
    layer=el(switch(scene,"SW_CRAFT",-1),"Group")
    el(layer,"MetadataString",name="classification",value='"Authored nonhuman craft; fictional design"')
    motion=transform(layer,(0,0,0),DEF="T_CRAFT")
    fixed=transform(motion,(0,229,-108),DEF="CRAFT_ANCHOR")
    craft_hull(fixed)
    sphere(fixed,(0,8.5,0),1,"A_LAPIS",scale=(9,3.0,5.0))
    for fraction,y in ((1.025,-1.7),(.99,-3.0),(.83,.35),(.61,2.15),(.36,5.65)):
        horizontal_torus(fixed,(0,y,0),52*fraction,24*fraction,.19,"A_GOLD")
        horizontal_torus(fixed,(0,y+.16,0),52*fraction,24*fraction,.045,"A_GOLD_LIGHT")
    # Dense rim windows and radial engravings read clearly in a moving shot.
    points,paths=[],[]
    for j in range(96):
        a=TAU*j/96
        x,z=52.3*math.cos(a),24.3*math.sin(a)
        cylinder(fixed,(x,-2.45,z),(x,-1.2,z),.11,"A_CYAN" if j%4 else "A_GOLD_LIGHT")
        start=len(points)
        for fraction,y in ((.40,5.11),(.60,2.34),(.80,.65),(.96,-.67)):
            points.append((52*fraction*math.cos(a),y,24*fraction*math.sin(a)))
        paths.append(list(range(start,len(points))))
    lines(fixed,points,paths,"A_DIM_GOLD")
    # Underside: a nested luminous mandala with actual metal spokes.
    for radius in (3.2,6,10.5,16.5,22):
        horizontal_torus(fixed,(0,-6.75,0),radius,radius*.52,.085,
                         "A_CYAN" if radius in (6,16.5) else "A_GOLD_LIGHT")
    points,paths=[],[]
    for j in range(32):
        a=TAU*j/32
        start=len(points)
        points += [(r*math.cos(a),-6.85,.52*r*math.sin(a)) for r in (4,10.5,16.5,22)]
        paths.append(list(range(start,len(points))))
    for step in (5,7):
        start=len(points)
        points += [(10.5*math.cos(TAU*j/24),-6.95,5.46*math.sin(TAU*j/24)) for j in range(24)]
        paths.append([start+(j*step)%24 for j in range(25)])
    lines(fixed,points,paths,"A_GOLD_LIGHT")
    sphere(fixed,(0,-6.6,0),2.4,"A_CYAN",scale=(1,.28,1))
    # Swept architectural fins, tiny ribs, and a central solar crest.
    for side in (-1,1):
        verts=[(side*30,0,-2),(side*47,-1,-5),(side*59,8,-2),
               (side*43,4,1),(side*30,0,2)]
        mesh(fixed,verts,[(0,1,2,3,4)],"A_LAPIS")
        lines(fixed,verts,[[0,1,2,3,4,0]],"A_GOLD_LIGHT")
        for j in range(6):
            x=side*(34+j*3.1)
            cylinder(fixed,(x,.6+j*.5,-1.9),(x,2.2+j*.75,-1.9),.075,"A_GOLD")
    crest=transform(fixed,(0,11,0))
    torus(crest,(0,0,0),4.7,4.7,.16,"A_GOLD",major=96)
    sphere(crest,(0,0,0),2.75,"A_GOLD_LIGHT",scale=(1,1,.20))
    for side in (-1,1):
        cylinder(crest,(side*5.0,0,0),(side*13,-2,0),.15,"A_GOLD")
        for j in range(6):
            cylinder(crest,(side*(5.4+j*1.15),-.1-j*.25,0),
                     (side*(5.1+j*1.15),-1.8-j*.45,0),.09,"A_LAPIS")


def star_being(parent, variant=0):
    """An original, elongated four-fingered nonhuman ceremonial silhouette."""
    body,dark,gold="A_STAR_BODY","A_STAR_DARK","A_GOLD"
    for sign in (-1,1):
        ankle=(sign*.18,.28,0)
        knee=(sign*.24,1.12,.10)
        hip=(sign*.20,1.91,0)
        sphere(parent,(sign*.18,.13,.10),.18,dark,scale=(.76,.50,1.65))
        cylinder(parent,ankle,knee,.105,body)
        cylinder(parent,knee,hip,.13,body)
        sphere(parent,knee,.14,gold,scale=(1,.8,.7))
        cylinder(parent,(sign*.18,.3,.10),(sign*.23,1.11,.20),.025,"A_CYAN")
    sphere(parent,(0,1.95,0),.30,dark,scale=(1.07,.72,.65))
    sphere(parent,(0,2.49,0),.43,body,scale=(.84,1.43,.48))
    # A luminous sternum and lapis/gold exoskeletal seams.
    cylinder(parent,(0,2.10,.20),(0,2.97,.16),.038,"A_CYAN")
    for sign in (-1,1):
        lines(parent,[(sign*.13,2.06,.17),(sign*.29,2.48,.20),
                      (sign*.24,2.88,.18),(0,3.0,.17)],[[0,1,2,3]],"A_GOLD_LIGHT")
    cylinder(parent,(0,2.90,0),(0,3.23,0),.13,dark)
    for y in (3.01,3.08,3.15):
        horizontal_torus(parent,(0,y,0),.18,.14,.025,gold,segments=40)
    sphere(parent,(0,3.48,.015),.27,body,scale=(.81,1.55,.75))
    # Obsidian faceplate, luminous eyes, brow line, and a slender nose ridge.
    sphere(parent,(0,3.49,.191),.22,dark,scale=(.81,.97,.18))
    for sign in (-1,1):
        sphere(parent,(sign*.091,3.54,.237),.057,"A_WHITE",scale=(1.22,.47,.32))
        cylinder(parent,(sign*.02,3.65,.224),(sign*.17,3.61,.205),.013,gold)
    cylinder(parent,(0,3.57,.245),(0,3.43,.249),.014,gold)
    lines(parent,[(-.045,3.37,.229),(.045,3.37,.229)],[[0,1]],"A_CYAN")
    # Split head crest creates a readable silhouette against the dark sky.
    crest=[(-.22,3.72,-.02),(-.27,4.14,-.02),(-.075,3.94,-.02),
           (0,4.32,-.02),(.075,3.94,-.02),(.27,4.14,-.02),(.22,3.72,-.02)]
    mesh(parent,crest,[(0,1,2),(2,3,4),(4,5,6),(0,2,4,6)],dark)
    lines(parent,crest,[list(range(7))],"A_GOLD_LIGHT")
    sphere(parent,(0,3.97,.018),.085,"A_CYAN",scale=(.46,1.55,.35))
    # Four long fingers and an opposing thumb on each open, extended hand.
    for sign in (-1,1):
        spread=.06 if variant==1 else 0
        shoulder=(sign*.44,2.86,0)
        elbow=(sign*(.64+spread),2.18,.07)
        wrist=(sign*(.67+spread),1.57,.28)
        cylinder(parent,shoulder,elbow,.10,body)
        cylinder(parent,elbow,wrist,.077,body)
        sphere(parent,shoulder,.16,gold,scale=(1.25,.70,.72))
        sphere(parent,elbow,.10,dark)
        cylinder(parent,(wrist[0],1.70,.255),(wrist[0],1.61,.28),.095,gold)
        sphere(parent,(wrist[0],1.49,.30),.13,body,scale=(.8,1.18,.37))
        for j in range(4):
            x=wrist[0]+(j-1.5)*.051
            end_y=1.10+.055*abs(j-1.5)
            cylinder(parent,(x,1.43,.31),(x,end_y,.36),.019,body)
            sphere(parent,(x,end_y,.36),.020,"A_GOLD_LIGHT")
        cylinder(parent,(wrist[0]-sign*.09,1.52,.31),
                 (wrist[0]-sign*.19,1.32,.38),.025,body)
        # Layered shoulder fins read as clothing/technology, not extra arms.
        for j in range(3):
            cylinder(parent,(sign*(.36+j*.05),2.92-j*.035,-.035),
                     (sign*(.62+j*.06),2.76-j*.07,-.025),.027,gold)


def encounter_beings(scene):
    """Three fictional emissive figures on a floating engraved encounter dais."""
    layer=el(switch(scene,"SW_BEINGS",-1),"Group")
    el(layer,"MetadataString",name="classification",value='"Original nonhuman beings; authored speculative fiction"')
    fixed=transform(layer,(0,185,-40),DEF="BEINGS_ANCHOR")
    node=transform(fixed,scale=(1,1,1),DEF="T_BEINGS")
    # Dais top is at local y=0, so each figure's feet meet its surface.
    cylinder(node,(0,-1.7,0),(0,-.7,0),30.2,"A_GOLD")
    cylinder(node,(0,-.7,0),(0,-.07,0),29.8,"A_BASALT")
    for r in (7,11,18,27,29.8,30.3):
        ring(node,(0,.012,0),r,"A_CYAN" if r in (11,27,30.3) else "A_GOLD_LIGHT",segments=160)
    points,paths=[],[]
    for i in range(72):
        a=TAU*i/72
        start=len(points)
        for radius in (18.5,24 if i%3 else 28.4):
            points.append((radius*math.cos(a),.03,radius*math.sin(a)))
        paths.append([start,start+1])
    lines(node,points,paths,"A_DIM_GOLD")
    for name,pos,scale,variant in (
        ("BEING_LEFT",(-14,0,2),4.65,0),
        ("BEING_CENTRE",(0,0,-4),4.95,1),
        ("BEING_RIGHT",(14,0,2),4.65,2),
    ):
        person=transform(node,pos,scale=(scale,scale,scale),DEF=name)
        star_being(person,variant)
        ring(person,(0,3.45,-.30),.63,"A_DIM_GOLD",plane="xy",segments=96)
        ring(person,(0,3.45,-.31),.68,"A_CYAN",plane="xy",segments=96)
    # Under-platform filigree and a soft entry axis connect the journey stages.
    for r,y in ((24,-2.0),(18,-2.5),(9,-3.0)):
        horizontal_torus(node,(0,y,0),r,r,.08,"A_GOLD_LIGHT")
    cylinder(node,(0,-8,0),(0,-2,0),1.5,"A_BEAM")


def stars(scene):
    points, colors = [], []
    for i in range(2400):
        az, y = RNG.uniform(0,TAU), RNG.uniform(.035,1)
        r = 2600
        h = math.sqrt(1-y*y)
        points.append((r*h*math.cos(az),r*y,r*h*math.sin(az)))
        b = RNG.uniform(.25,.94)
        colors.append((b*.78,b*.86,b))
    # A broad diagonal stellar river, decorative and not an epoch sky solution.
    for i in range(1150):
        a = RNG.uniform(0,TAU)
        d = RNG.gauss(0,.045)
        v = (math.cos(a), .45*math.sin(a)+.54+d, math.sin(a))
        norm = math.sqrt(sum(x*x for x in v))
        if v[1] <= 0:
            continue
        points.append(tuple(2550*x/norm for x in v))
        b=RNG.uniform(.16,.40)
        colors.append((b*.75,b*.79,b))
    node=el(scene,"Shape")
    app=el(node,"Appearance")
    el(app,"Material",diffuseColor=(0,0,0),emissiveColor=(1,1,1))
    el(app,"PointProperties",pointSizeScaleFactor=2.2,pointSizeMinValue=1,pointSizeMaxValue=3)
    geometry=el(node,"PointSet")
    el(geometry,"Coordinate",point=points)
    el(geometry,"Color",color=colors)


def main(output=OUT):
    global RNG
    RNG=random.Random(40717)
    root=ET.Element("X3D",profile="Immersive",version="4.0")
    head=el(root,"head")
    el(head,"component",name="Shape",level=5)
    for name,content in (
        ("title","Giza IV — The Horizon Engine"),
        ("generator","build_scene.py; Python standard library; deterministic seed 40717"),
        ("license","CC0-1.0; all generated geometry dedicated to the public domain"),
        ("units","metres; +Y up; +X east; +Z south; pyramid base centre [0,0,0]"),
        ("description","Approximate Khufu envelope: 230 m base, 146 m height. Chamber centre [0,43,0]; interior about 10.5 x 5.2 x 5.8 m. Landscape and passage layout are schematic."),
        ("warning","Quartz foundation, conductor network, royal burial, ritual devices, Ka double, machinery, craft, nonhuman beings and celestial portal are hypothetical or authored fiction, not archaeological findings. Fields are normalized teaching glyphs, not numerical electromagnetic predictions."),
        ("fiction-anchors","Machinery pivot [0,42.6,0]; craft anchor [0,229,-108]; beings dais [0,185,-40], feet [-14,185,-38], [0,185,-44], [14,185,-38]. T_MACHINE rotates locally; T_CRAFT is a zero translation offset; T_BEINGS scales about the dais origin."),
        ("starfield","Decorative seeded starfield; no astronomical date or alignment claim."),
    ):
        el(head,"meta",name=name,content=content)
    scene=el(root,"Scene")
    el(scene,"WorldInfo",title="Giza IV — The Horizon Engine",
       info='"Procedural X3D | CC0-1.0" "Schematic dimensions; explicit hypothesis and mythic layers"')
    el(scene,"Background",skyAngle=(.65,1.38,1.57),
       skyColor=((.003,.008,.025),(.009,.022,.06),(.035,.056,.09),(.09,.08,.08)),
       groundAngle=(1.5,),groundColor=((.018,.025,.04),(.035,.032,.03)))
    el(scene,"NavigationInfo",DEF="NAV",type='"EXAMINE" "ANY"',headlight=False,
       avatarSize=(.15,1.6,.5),speed=16,visibilityLimit=9000,transitionTime=.9)
    viewpoint(scene,"V_Overview","Plateau / horizon",(280,176,335),(0,49,0),.80)
    viewpoint(scene,"V_Cutaway","Resonance section",(175,105,210),(0,43,0),.78)
    viewpoint(scene,"V_Witness","Witness journey",(175,105,210),(0,43,0),.78)
    viewpoint(scene,"V_Chamber","King’s Chamber",(7.8,44.9,11.4),(0,42.4,0),.80)
    viewpoint(scene,"V_Ritual","Heart and brow",(3.3,44.0,4.7),(0,41.78,-.20),.70)
    viewpoint(scene,"V_Stars","Celestial horizon",(100,190,265),(0,180,-30),.83)
    viewpoint(scene,"V_Immersive","Pharaoh / first-person journey",(0,42.08,-.70),(0,190,-30),.87)
    el(scene,"DirectionalLight",direction=(-.4,-.7,-.5),color=(.42,.59,.90),intensity=.70,ambientIntensity=.40)
    el(scene,"DirectionalLight",direction=(.65,-.32,.45),color=(1,.68,.34),intensity=.90,ambientIntensity=.12)
    build_materials(scene)
    terrain(scene)
    pyramid(scene)
    quartz(scene)
    passages(scene)
    chamber(scene)
    conductors(scene)
    fields(scene)
    cosmic(scene)
    story_machinery(scene)
    celestial_craft(scene)
    encounter_beings(scene)
    stars(scene)
    # Validate contracts and unique names before the generated scene is written.
    defs=[node.attrib["DEF"] for node in root.iter() if "DEF" in node.attrib]
    if len(defs)!=len(set(defs)):
        raise ValueError("duplicate DEF")
    for node in root.iter():
        if "USE" in node.attrib and node.attrib["USE"] not in defs:
            raise ValueError("unresolved USE: "+node.attrib["USE"])
    ET.indent(root,space="  ")
    output=Path(output)
    output.parent.mkdir(parents=True,exist_ok=True)
    ET.ElementTree(root).write(output,encoding="utf-8",xml_declaration=True)
    ET.parse(output)
    print(f"{output}: {output.stat().st_size:,} bytes; {len(defs)} named nodes; {sum(1 for _ in root.iter('Shape'))} shapes")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output",nargs="?",type=Path,default=OUT)
    main(parser.parse_args().output)
