#!/usr/bin/env python3
"""scenes: the two X3D 4.1 blockouts the bridge sends to Atlas, written from numbers, CC0.

  kings-chamber   the King's Chamber of the Great Pyramid. Room and coffer sizes are Petrie's 1883 survey
                  (The Pyramids and Temples of Gizeh, sections 51-60, inches x 0.0254). Grades are in the
                  MetadataSet of the file: sizes L (quoted from the survey as commonly cited, not re-read
                  from a scan in this build), placements S (approximate).
  reading-room    an invented library reading room (no source; every number is this file's own).

Each solid is one <Transform DEF=...><Shape><Box|Cylinder|Sphere/></Shape></Transform>, so the three.js bridge,
X_ITE and kit/x3dcast.py all read the same primitives, and every Atlas camera is a plain X3D <Viewpoint>.
Axes: +X east, +Y up, -Z north (X3D's own right-handed Y-up frame, which is also Atlas's "rub" world).
"""
from __future__ import annotations

import math
import random
from pathlib import Path

import numpy as np

IN = 0.0254
ATLAS_W, ATLAS_H = 1280, 720
HFOV_DEG = 80.0                                   # cameras-and-posed-images.md: "A 1280-wide camera with fx of 762 sees 80 deg"
FX = ATLAS_W / (2 * math.tan(math.radians(HFOV_DEG) / 2))
VFOV = 2 * math.atan(ATLAS_H / (2 * FX))          # X3D fieldOfView = the smaller (vertical) angle of a landscape view


def look_at_axis_angle(pos, target, up=(0, 1, 0)):
    pos, target, up = (np.asarray(v, float) for v in (pos, target, up))
    back = pos - target
    back /= np.linalg.norm(back)
    right = np.cross(up, back)
    right /= np.linalg.norm(right)
    upv = np.cross(back, right)
    R = np.stack([right, upv, back], axis=1)
    w = math.sqrt(max(0.0, 1 + R[0, 0] + R[1, 1] + R[2, 2])) / 2
    if w > 1e-6:
        q = np.array([(R[2, 1] - R[1, 2]) / (4 * w), (R[0, 2] - R[2, 0]) / (4 * w), (R[1, 0] - R[0, 1]) / (4 * w), w])
    else:                                          # 180 degree turn: take the largest diagonal term
        i = int(np.argmax([R[0, 0], R[1, 1], R[2, 2]]))
        j, k = (i + 1) % 3, (i + 2) % 3
        s = math.sqrt(max(0.0, 1 + R[i, i] - R[j, j] - R[k, k])) * 2
        q = np.zeros(4)
        q[i] = s / 4
        q[j] = (R[j, i] + R[i, j]) / s
        q[k] = (R[k, i] + R[i, k]) / s
        q[3] = (R[k, j] - R[j, k]) / s
    q /= np.linalg.norm(q)
    if q[3] < 0:
        q = -q
    s = math.sqrt(max(0.0, 1 - q[3] ** 2))
    ang = 2 * math.atan2(s, q[3])
    return (0.0, 0.0, 1.0, 0.0) if s < 1e-9 else (q[0] / s, q[1] / s, q[2] / s, ang)


class Scene:
    def __init__(self, slug, title, source, prompt):
        self.slug, self.title, self.source, self.prompt = slug, title, source, prompt
        self.groups: dict[str, list[str]] = {}
        self.cams: list[str] = []
        self.meta: list[tuple[str, str, str]] = []     # (name, value, grade)
        self.n = 0
        self.center = (0.0, 1.5, 0.0)

    def _shape(self, group, DEF, t, geom, rgb, rot=None, scale=None):
        a = f' rotation="{rot[0]:.6f} {rot[1]:.6f} {rot[2]:.6f} {rot[3]:.6f}"' if rot else ""
        s = f' scale="{scale[0]:.4f} {scale[1]:.4f} {scale[2]:.4f}"' if scale else ""
        self.groups.setdefault(group, []).append(
            f'<Transform DEF="{DEF}" translation="{t[0]:.4f} {t[1]:.4f} {t[2]:.4f}"{a}{s}><Shape><Appearance>'
            f'<Material diffuseColor="{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f}"/></Appearance>{geom}</Shape></Transform>')
        self.n += 1

    def box(self, group, DEF, lo, hi, rgb):
        """Axis-aligned box from its two corners (metres)."""
        lo, hi = np.minimum(lo, hi), np.maximum(lo, hi)
        size = hi - lo
        if np.any(size <= 1e-6):
            raise ValueError(f"{DEF}: empty box {lo} {hi}")
        c = (lo + hi) / 2
        self._shape(group, DEF, c, f'<Box size="{size[0]:.4f} {size[1]:.4f} {size[2]:.4f}"/>', rgb)

    def obox(self, group, DEF, center, size, rgb, rot):
        self._shape(group, DEF, center, f'<Box size="{size[0]:.4f} {size[1]:.4f} {size[2]:.4f}"/>', rgb, rot=rot)

    def cyl(self, group, DEF, base, radius, height, rgb):
        self._shape(group, DEF, (base[0], base[1] + height / 2, base[2]), f'<Cylinder radius="{radius:.4f}" height="{height:.4f}"/>', rgb)

    def sph(self, group, DEF, c, radius, rgb, scale=None):
        self._shape(group, DEF, c, f'<Sphere radius="{radius:.4f}"/>', rgb, scale=scale)

    def cam(self, desc, pos, target):
        i = len(self.cams)
        o = look_at_axis_angle(pos, target)
        self.cams.append(
            f'<Viewpoint DEF="Cam{i:02d}" description="{desc}" position="{pos[0]:.4f} {pos[1]:.4f} {pos[2]:.4f}" '
            f'orientation="{o[0]:.6f} {o[1]:.6f} {o[2]:.6f} {o[3]:.6f}" fieldOfView="{VFOV:.6f}" '
            f'centerOfRotation="{self.center[0]:.3f} {self.center[1]:.3f} {self.center[2]:.3f}"/>')

    def panel(self, group, DEF, plane, u0, u1, v0, v1, thick, rgb, holes=()):
        """A wall slab with rectangular holes. plane = ('z', z, sign) or ('x', x, sign): the inner face sits at
        that coordinate and the slab grows by `thick` along `sign`. u runs along the wall, v is height."""
        us = sorted({u0, u1, *[h[0] for h in holes], *[h[1] for h in holes]})
        vs = sorted({v0, v1, *[h[2] for h in holes], *[h[3] for h in holes]})
        us = [u for u in us if u0 <= u <= u1]
        vs = [v for v in vs if v0 <= v <= v1]
        k = 0
        for ua, ub in zip(us, us[1:]):
            run = None                                   # merge the cells of one column that touch
            cells = []
            for va, vb in zip(vs, vs[1:]):
                um, vm = (ua + ub) / 2, (va + vb) / 2
                if any(h[0] < um < h[1] and h[2] < vm < h[3] for h in holes):
                    if run:
                        cells.append(run)
                        run = None
                else:
                    run = (run[0], vb) if run else (va, vb)
            if run:
                cells.append(run)
            for va, vb in cells:
                axis, c, sign = plane
                a, b = c, c + sign * thick
                if axis == "z":
                    self.box(group, f"{DEF}_{k}", (ua, va, a), (ub, vb, b), rgb)
                else:
                    self.box(group, f"{DEF}_{k}", (a, va, ua), (b, vb, ub), rgb)
                k += 1

    def xml(self) -> str:
        head = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.1//EN" "https://www.web3d.org/specifications/x3d-4.1.dtd">',
            '<X3D version="4.1" profile="Immersive" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" '
            'xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.1.xsd">',
            '  <head>',
            f'    <meta name="title" content="{self.title}"/>',
            '    <meta name="generator" content="x3d.demo atlas-bridge kit/scenes.py"/>',
            f'    <meta name="source" content="{self.source}"/>',
            '    <meta name="license" content="CC0 1.0 (this blockout: geometry and cameras)"/>',
            f'    <meta name="atlas.prompt" content="{self.prompt}"/>',
            f'    <meta name="atlas.grid" content="{ATLAS_W} {ATLAS_H}; fx = fy = {FX:.4f} px; cx {ATLAS_W / 2:g}, cy {ATLAS_H / 2:g}; pose camera-to-world, rub"/>',
            '  </head>',
            '  <Scene>',
            '    <WorldInfo DEF="Provenance" title="' + self.title + '">',
            '      <MetadataSet name="blockout" containerField="metadata">',
        ]
        for name, value, grade in self.meta:
            head.append(f'        <MetadataString name="{name}" value=\'"{value}" "{grade}"\' containerField="value"/>')
        head += ['      </MetadataSet>', '    </WorldInfo>',
                 '    <NavigationInfo type=\'"EXAMINE" "FLY" "ANY"\' headlight="true" speed="2"/>',
                 '    <Background skyColor="0.02 0.02 0.03"/>']
        body = ['    ' + c for c in self.cams]
        for g, items in self.groups.items():
            body.append(f'    <Group DEF="G_{g}">')
            body += ['      ' + s for s in items]
            body.append('    </Group>')
        return "\n".join(head + body + ['  </Scene>', '</X3D>', ''])


# ----------------------------------------------------------------------------------------------- King's Chamber
def kings_chamber() -> Scene:
    L, W, H = 412.24 * IN, 206.12 * IN, 230.09 * IN          # east-west, north-south, height
    s = Scene("kings-chamber", "King's Chamber, Great Pyramid of Giza: X3D blockout for Atlas",
              "W. M. Flinders Petrie, The Pyramids and Temples of Gizeh (1883), sections 51-60; inches x 0.0254",
              "The King's Chamber inside the Great Pyramid of Giza: a bare rectangular room built of huge polished "
              "red Aswan granite blocks in five wall courses with hairline joints, nine massive granite beams "
              "across the flat ceiling, a worn granite floor, one lidless dark granite sarcophagus standing near "
              "the west wall, a low square doorway in the corner of the north wall, lit by a few warm work lamps "
              "on the floor, dust in the air, documentary photograph, sharp focus")
    s.center = (0.0, 1.4, 0.0)
    s.meta += [("room length east-west", f"{L:.4f} m (412.24 in)", "L"), ("room width north-south", f"{W:.4f} m (206.12 in)", "L"),
               ("room height", f"{H:.4f} m (230.09 in)", "L"),
               ("coffer outside", "2.2763 x 0.9779 x 1.0493 m (89.62 x 38.50 x 41.31 in)", "L"),
               ("coffer inside", "1.9827 x 0.6810 x 0.8743 m (78.06 x 26.81 x 34.42 in)", "L"),
               ("doorway", "1.0465 m wide, 1.110 m high (41.2 x 43.7 in), east end of the north wall", "L"),
               ("wall courses", "five, drawn equal at one fifth of the height; the real lowest course runs below the floor", "S"),
               ("coffer placement, shaft mouths", "approximate", "S"),
               ("joints", "15 mm grooves 20 mm deep between courses and beams so the depth map carries the block lines", "S")]
    granite, dark, floor = (0.55, 0.36, 0.30), (0.20, 0.14, 0.12), (0.42, 0.30, 0.26)
    hx, hz, T, g, gd = L / 2, W / 2, 0.5, 0.015, 0.02
    door_w, door_h = 41.2 * IN, 43.7 * IN
    shaft_x, shaft = hx - 2.50, (0.93, 1.07, 0.21)                # v0, v1, width
    # floor, with the passage floor to the north
    s.box("Floor", "Floor", (-hx - T, -0.5, -hz - 3.2), (hx + T, 0, hz + T), floor)
    ch = H / 5
    for i in range(5):
        v0 = i * ch + (g / 2 if i else 0)
        v1 = (i + 1) * ch - (g / 2 if i < 4 else 0)
        holes_n = [(hx - door_w, hx, 0, door_h), (shaft_x - shaft[2] / 2, shaft_x + shaft[2] / 2, shaft[0], shaft[1])] if i == 0 else []
        holes_s = [(shaft_x - shaft[2] / 2, shaft_x + shaft[2] / 2, shaft[0], shaft[1])] if i == 0 else []
        s.panel("WallNorth", f"N{i + 1}", ("z", -hz, -1), -hx, hx, v0, v1, T, granite, holes_n)
        s.panel("WallSouth", f"S{i + 1}", ("z", hz, 1), -hx, hx, v0, v1, T, granite, holes_s)
        s.panel("WallEast", f"E{i + 1}", ("x", hx, 1), -hz - T, hz + T, v0, v1, T, granite)
        s.panel("WallWest", f"W{i + 1}", ("x", -hx, -1), -hz - T, hz + T, v0, v1, T, granite)
        if i < 4:                                                  # the recessed joint above this course
            j0, j1 = (i + 1) * ch - g / 2, (i + 1) * ch + g / 2
            s.box("Joints", f"JN{i + 1}", (-hx, j0, -hz - gd), (hx, j1, -hz - T), dark)
            s.box("Joints", f"JS{i + 1}", (-hx, j0, hz + gd), (hx, j1, hz + T), dark)
            s.box("Joints", f"JE{i + 1}", (hx + gd, j0, -hz - T), (hx + T, j1, hz + T), dark)
            s.box("Joints", f"JW{i + 1}", (-hx - gd, j0, -hz - T), (-hx - T, j1, hz + T), dark)
    bw = L / 9
    for i in range(9):                                             # nine roof beams, spanning north-south
        x0 = -hx + i * bw + (g / 2 if i else 0)
        x1 = -hx + (i + 1) * bw - (g / 2 if i < 8 else 0)
        s.box("Ceiling", f"Beam{i + 1}", (x0, H, -hz - T), (x1, H + 0.6, hz + T), granite)
        if i < 8:
            xj = -hx + (i + 1) * bw
            s.box("Joints", f"JB{i + 1}", (xj - g / 2, H + gd, -hz - T), (xj + g / 2, H + 0.6, hz + T), dark)
    # entrance passage north of the doorway (its east side is flush with the east wall)
    zp0, zp1 = -hz - T, -hz - 3.2
    s.box("Passage", "PassageWest", (hx - door_w - 0.4, 0, zp0), (hx - door_w, door_h, zp1), granite)
    s.box("Passage", "PassageEast", (hx, 0, zp0), (hx + 0.4, door_h, zp1), granite)
    s.box("Passage", "PassageRoof", (hx - door_w - 0.4, door_h, zp0), (hx + 0.4, door_h + 0.4, zp1), granite)
    s.box("Passage", "PassageEnd", (hx - door_w - 0.4, 0, zp1), (hx + 0.4, door_h + 0.4, zp1 - 0.3), dark)
    for name, sign in (("ShaftNorth", -1), ("ShaftSouth", 1)):    # the back of each shaft mouth, 0.5 m in
        z = sign * (hz + T)
        s.box("Shafts", name, (shaft_x - 0.3, shaft[0] - 0.2, z), (shaft_x + 0.3, shaft[1] + 0.2, z + sign * 0.2), dark)
    # the coffer: long axis north-south, near the west wall
    cx, cz = -hx + 1.45 + 0.9779 / 2, 0.10
    ox, oz, oh = 38.50 * IN / 2, 89.62 * IN / 2, 41.31 * IN
    ix, iz, base = 26.81 * IN / 2, 78.06 * IN / 2, (41.31 - 34.42) * IN
    coffer = (0.36, 0.24, 0.21)
    s.box("Coffer", "CofferBase", (cx - ox, 0, cz - oz), (cx + ox, base, cz + oz), coffer)
    s.box("Coffer", "CofferWest", (cx - ox, base, cz - oz), (cx - ix, oh, cz + oz), coffer)
    s.box("Coffer", "CofferEast", (cx + ix, base, cz - oz), (cx + ox, oh, cz + oz), coffer)
    s.box("Coffer", "CofferNorth", (cx - ix, base, cz - oz), (cx + ix, oh, cz - iz), coffer)
    s.box("Coffer", "CofferSouth", (cx - ix, base, cz + iz), (cx + ix, oh, cz + oz), coffer)
    # twelve cameras: four corners, four around the coffer, four that cover floor, ceiling, door and the long axis
    e = 1.60
    cams = [("south-east corner to the coffer", (hx - 0.9, e, hz - 0.8), (-2.6, 1.1, -0.6)),
            ("north-east corner by the door, to the south-west", (hx - 1.6, e, -hz + 0.9), (-2.8, 1.2, 1.2)),
            ("south-west corner to the doorway", (-hx + 0.8, e, hz - 0.7), (3.4, 0.9, -1.8)),
            ("north-west corner to the south-east", (-hx + 0.8, e, -hz + 0.7), (3.2, 1.2, 1.6)),
            ("coffer from the east", (cx + 2.3, 1.75, cz + 0.2), (cx, 0.75, cz)),
            ("coffer from the south-east", (cx + 1.5, 1.70, hz - 0.55), (cx, 0.70, cz - 0.3)),
            ("coffer from the north-east", (cx + 1.5, 1.70, -hz + 0.55), (cx, 0.70, cz + 0.3)),
            ("into the coffer from above the north end", (cx + 0.55, 2.35, -hz + 0.75), (cx, 0.35, cz + 0.2)),
            ("centre, along the room to the east wall", (-0.6, e, 0.15), (hx, 1.5, -0.4)),
            ("centre, up to the nine beams", (0.9, 1.45, 0.35), (-2.2, H, -0.9)),
            ("east end, low, the floor and the doorway", (hx - 2.6, 1.85, hz - 1.0), (hx - 0.6, 0.35, -hz)),
            ("mid south wall to the north wall and shaft", (1.3, e, hz - 0.6), (2.4, 1.3, -hz))]
    for d, p, t in cams:
        s.cam(d, p, t)
    return s


# ----------------------------------------------------------------------------------------------- reading room
def reading_room() -> Scene:
    L, W, H = 14.0, 9.0, 6.2
    s = Scene("reading-room", "Reading room: X3D blockout for Atlas", "invented for this demo; no outside source",
              "A grand old library reading room in late afternoon: floor-to-ceiling dark walnut bookcases packed "
              "with leather-bound books along both long walls, two rows of pale limestone columns, long oak "
              "reading tables with benches and brass lamps with green glass shades, a large antique terrestrial "
              "globe on a turned wooden pedestal in the centre, three tall windows in the far wall with warm sun "
              "coming through, panelled double doors at the other end, herringbone parquet floor, dark timber "
              "ceiling beams, architectural interior photograph, sharp focus")
    s.center = (0.0, 1.4, 0.0)
    s.meta += [("room", f"{L} x {W} x {H} m (east-west, north-south, height)", "invented"),
               ("windows", "three openings in the east wall with no surface behind them: depth 0, which Atlas reads as empty space", "design")]
    hx, hz, T = L / 2, W / 2, 0.4
    wall, wood, dark, stone, oak, brass = (0.78, 0.74, 0.66), (0.32, 0.20, 0.12), (0.18, 0.11, 0.07), (0.82, 0.80, 0.74), (0.55, 0.40, 0.24), (0.75, 0.6, 0.25)
    s.box("Shell", "Floor", (-hx - T, -0.4, -hz - T), (hx + T, 0, hz + T), (0.45, 0.32, 0.2))
    s.box("Shell", "Ceiling", (-hx - T, H, -hz - T), (hx + T, H + 0.4, hz + T), wall)
    s.panel("Shell", "WallN", ("z", -hz, -1), -hx, hx, 0, H, T, wall)
    s.panel("Shell", "WallS", ("z", hz, 1), -hx, hx, 0, H, T, wall)
    wins = [(zc - 0.75, zc + 0.75, 1.1, 5.0) for zc in (-2.7, 0.0, 2.7)]
    s.panel("Shell", "WallE", ("x", hx, 1), -hz - T, hz + T, 0, H, T, wall, wins)
    for i, (z0, z1, v0, v1) in enumerate(wins):                    # a sill and a mullion cross in each window
        s.box("Windows", f"Sill{i}", (hx - 0.12, v0 - 0.08, z0 - 0.1), (hx + 0.1, v0, z1 + 0.1), stone)
        s.box("Windows", f"MullionV{i}", (hx + 0.16, v0, (z0 + z1) / 2 - 0.04), (hx + 0.24, v1, (z0 + z1) / 2 + 0.04), dark)
        s.box("Windows", f"MullionH{i}", (hx + 0.16, 3.3, z0), (hx + 0.24, 3.38, z1), dark)
    s.panel("Shell", "WallW", ("x", -hx, -1), -hz - T, hz + T, 0, H, T, wall, [(-1.1, 1.1, 0, 3.1)])
    s.box("Doors", "DoorLeft", (-hx - 0.14, 0, -1.1), (-hx - 0.22, 3.1, -0.01), wood)
    s.box("Doors", "DoorRight", (-hx - 0.14, 0, 0.01), (-hx - 0.22, 3.1, 1.1), wood)
    s.box("Doors", "DoorFrameTop", (-hx + 0.06, 3.1, -1.3), (-hx, 3.32, 1.3), dark)
    for k, z in enumerate((-1.2, 1.2)):
        s.box("Doors", f"DoorFrame{k}", (-hx + 0.06, 0, z - 0.1), (-hx, 3.1, z + 0.1), dark)
    for i, x in enumerate(np.linspace(-hx + 1.4, hx - 1.4, 5)):    # ceiling beams, north-south
        s.box("Beams", f"Beam{i}", (x - 0.16, H - 0.42, -hz), (x + 0.16, H, hz), dark)
    for z, tag in ((-0.18, "N"), (0.18, "S")):
        s.box("Beams", f"Ridge{tag}", (-hx, H - 0.24, z - 0.1), (hx, H, z + 0.1), dark)
    # bookcases along both long walls: five bays a side, six shelves, books as blocks of uneven height
    rng = random.Random(77)
    bay_w, case_h, depth = 2.3, 4.3, 0.42
    xs = np.linspace(-hx + 1.55, hx - 1.55, 5)
    for side, zs in (("N", -1), ("S", 1)):
        zw = zs * hz                                                # wall face
        zf = zw - zs * depth                                        # case front
        for b, xc in enumerate(xs):
            x0, x1 = xc - bay_w / 2, xc + bay_w / 2
            tag = f"Case{side}{b}"
            s.box("Bookcases", f"{tag}_SideL", (x0, 0, zw), (x0 + 0.05, case_h, zf), wood)
            s.box("Bookcases", f"{tag}_SideR", (x1 - 0.05, 0, zw), (x1, case_h, zf), wood)
            s.box("Bookcases", f"{tag}_Plinth", (x0, 0, zw), (x1, 0.14, zf - zs * 0.03), wood)
            s.box("Bookcases", f"{tag}_Cornice", (x0 - 0.05, case_h, zw), (x1 + 0.05, case_h + 0.16, zf - zs * 0.07), wood)
            shelf_h = (case_h - 0.14) / 6
            for k in range(6):
                y0 = 0.14 + k * shelf_h
                s.box("Bookcases", f"{tag}_Shelf{k}", (x0 + 0.05, y0, zw), (x1 - 0.05, y0 + 0.035, zf), wood)
                x = x0 + 0.07
                j = 0
                while x < x1 - 0.2:                                 # runs of books: width, height and set-back vary
                    w = min(rng.uniform(0.22, 0.6), x1 - 0.07 - x)
                    hgt = rng.uniform(0.62, 0.9) * (shelf_h - 0.05)
                    back = rng.uniform(0.02, 0.10)
                    col = (rng.uniform(0.25, 0.6), rng.uniform(0.12, 0.3), rng.uniform(0.08, 0.2))
                    s.box("Books", f"{tag}_B{k}_{j}", (x, y0 + 0.035, zw - zs * 0.02), (x + w, y0 + 0.035 + hgt, zf + zs * back), col)
                    x += w + rng.choice((0.0, 0.0, 0.02, 0.09))
                    j += 1
    # two rows of four columns
    for r, z in enumerate((-2.55, 2.55)):
        for c, x in enumerate((-4.6, -1.55, 1.55, 4.6)):
            s.box("Columns", f"ColBase{r}{c}", (x - 0.34, 0, z - 0.34), (x + 0.34, 0.3, z + 0.34), stone)
            s.cyl("Columns", f"Col{r}{c}", (x, 0.3, z), 0.24, H - 0.42 - 0.3 - 0.28, stone)
            s.box("Columns", f"ColCap{r}{c}", (x - 0.36, H - 0.42 - 0.28, z - 0.36), (x + 0.36, H - 0.42, z + 0.36), stone)
    # two reading tables with benches and lamps, east and west of the globe
    for t, xc in enumerate((-3.3, 3.3)):
        tl, tw, th = 3.0, 1.15, 0.76
        s.box("Tables", f"Table{t}_Top", (xc - tl / 2, th - 0.07, -tw / 2), (xc + tl / 2, th, tw / 2), oak)
        for k, (dx, dz) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
            px, pz = xc + dx * (tl / 2 - 0.16), dz * (tw / 2 - 0.14)
            s.box("Tables", f"Table{t}_Leg{k}", (px - 0.06, 0, pz - 0.06), (px + 0.06, th - 0.07, pz + 0.06), oak)
        for k, dz in enumerate((-1, 1)):
            zb = dz * (tw / 2 + 0.42)
            s.box("Tables", f"Bench{t}{k}_Seat", (xc - 1.3, 0.40, zb - 0.18), (xc + 1.3, 0.46, zb + 0.18), oak)
            for m, dx in enumerate((-1.15, 1.15)):
                s.box("Tables", f"Bench{t}{k}_Leg{m}", (xc + dx - 0.05, 0, zb - 0.16), (xc + dx + 0.05, 0.40, zb + 0.16), oak)
        for k, dx in enumerate((-0.8, 0.8)):
            s.cyl("Lamps", f"Lamp{t}{k}_Base", (xc + dx, th, 0), 0.09, 0.03, brass)
            s.cyl("Lamps", f"Lamp{t}{k}_Stem", (xc + dx, th + 0.03, 0), 0.02, 0.30, brass)
            s.cyl("Lamps", f"Lamp{t}{k}_Shade", (xc + dx, th + 0.33, 0), 0.17, 0.11, (0.1, 0.4, 0.25))
        s.box("Tables", f"Table{t}_BookOpen", (xc - 0.25, th, -0.36), (xc + 0.25, th + 0.05, -0.02), (0.85, 0.82, 0.72))
        s.box("Tables", f"Table{t}_BookStack", (xc + 0.95, th, 0.14), (xc + 1.27, th + 0.17, 0.38), (0.4, 0.15, 0.12))
    # the globe in the centre
    s.cyl("Globe", "GlobePlinth", (0, 0, 0), 0.42, 0.10, wood)
    s.cyl("Globe", "GlobePedestal", (0, 0.10, 0), 0.13, 0.72, wood)
    s.cyl("Globe", "GlobeRing", (0, 1.34, 0), 0.66, 0.035, brass)
    s.sph("Globe", "GlobeSphere", (0, 1.36, 0), 0.56, (0.25, 0.42, 0.5))
    # a lectern in front of the middle window, and a ladder block against the north cases
    s.box("Lectern", "LecternPost", (hx - 1.75, 0, -0.14), (hx - 1.45, 1.05, 0.14), wood)
    s.obox("Lectern", "LecternDesk", (hx - 1.62, 1.12, 0.0), (0.5, 0.05, 0.62), wood, (0, 0, 1, math.radians(-24)))
    s.obox("Ladder", "LadderRailA", (-2.9, 1.85, -hz + 0.42 + 0.52), (0.07, 3.9, 0.05), oak, (1, 0, 0, math.radians(-15.5)))
    s.obox("Ladder", "LadderRailB", (-2.4, 1.85, -hz + 0.42 + 0.52), (0.07, 3.9, 0.05), oak, (1, 0, 0, math.radians(-15.5)))
    for k in range(9):
        y = 0.35 + k * 0.4
        z = -hz + 0.42 + 0.52 + (1.85 - y) * math.tan(math.radians(15.5))
        s.box("Ladder", f"LadderRung{k}", (-2.9, y - 0.02, z - 0.03), (-2.4, y + 0.02, z + 0.03), oak)
    e = 1.60
    cams = [("west doors, down the hall to the windows", (-hx + 0.9, e, 0.25), (hx, 2.2, -0.2)),
            ("east end, back down the hall to the doors", (hx - 0.9, e, -0.3), (-hx, 2.0, 0.2)),
            ("west end, across the west table to the north cases", (-5.6, e, 1.2), (2.0, 1.3, -3.6)),
            ("west end, across the west table to the south cases", (-5.6, e, -1.2), (2.0, 1.3, 3.6)),
            ("east end, across the east table to the north cases", (5.6, e, 1.2), (-2.0, 1.3, -3.6)),
            ("east end, across the east table to the south cases", (5.6, e, -1.2), (-2.0, 1.3, 3.6)),
            ("the globe from the south", (0.5, 1.75, 2.3), (0, 1.25, 0)),
            ("the globe from the north-west", (-1.2, 1.75, -2.0), (0, 1.25, 0)),
            ("north bookcases and ladder, square on", (-1.9, e, 1.2), (-2.6, 2.1, -hz)),
            ("south bookcases, square on", (1.9, e, -1.2), (2.6, 2.1, hz)),
            ("centre aisle, up to the beams and column capitals", (-1.6, 1.4, -0.9), (3.4, H, 1.6)),
            ("east table, low, the floor and the windows", (1.2, 1.9, 1.6), (4.6, 0.6, -1.0)),
            # second ring, added for splat coverage: the side aisles, the ends, the floor and the far sides of things
            ("north aisle from the west end", (-6.2, e, -3.45), (2.0, 1.5, -3.7)),
            ("north aisle from the east end", (6.2, e, -3.45), (-2.0, 1.5, -3.7)),
            ("south aisle from the west end", (-6.2, e, 3.45), (2.0, 1.5, 3.7)),
            ("south aisle from the east end", (6.2, e, 3.45), (-2.0, 1.5, 3.7)),
            ("the globe from the east", (2.1, 1.7, -0.5), (0, 1.2, 0)),
            ("the globe from the west", (-2.1, 1.7, 0.5), (0, 1.2, 0)),
            ("west table from the north side, to the doors", (-1.6, 1.75, -1.7), (-5.5, 0.9, 0.8)),
            ("east table from the south side, to the lectern and windows", (1.6, 1.75, 1.7), (5.6, 1.0, -0.6)),
            ("the ladder, close", (-1.2, 1.5, -1.9), (-2.7, 2.0, -4.0)),
            ("the doors, square on", (-3.4, 1.7, 1.75), (-7.0, 1.6, 0.0)),
            ("the windows, square on, from the centre", (2.2, 1.7, -1.75), (7.0, 2.8, 0.0)),
            ("high in the centre, down the hall floor", (0.9, 3.4, 1.9), (-4.5, 0.2, -0.6))]
    for d, p, t in cams:
        s.cam(d, p, t)
    return s


SCENES = {"kings-chamber": kings_chamber, "reading-room": reading_room}

if __name__ == "__main__":
    import sys
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for slug, fn in SCENES.items():
        sc = fn()
        (out / f"{slug}.x3d").write_text(sc.xml(), encoding="utf-8")
        print(f"{slug}: {sc.n} solids, {len(sc.cams)} viewpoints -> {out / (slug + '.x3d')}")
