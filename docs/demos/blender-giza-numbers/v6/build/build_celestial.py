#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Build the sky machine for Demo 65 v6: the frames of the sky as native X3D, for the star layer.

    python build_celestial.py OUT_X3D OUT_JSON ../v4/assets/sky.x3d ../v4/assets/sky-data.json

Needs pyerfa and numpy. Deterministic: the same inputs give the same bytes.

Everything here lives in the SKY layer of the v4 stage (layer 0, units of light-years, camera at the origin).
The drawings sit on a sphere of radius 9,000 light-years: beyond every star in the file (the star boxes
reach about 3,000) and inside the sky camera's far plane (20,000). They are circles of direction, not things
at a distance.

Four frames, four groups:
  CelLocal     the observer's frame, fixed to the stage: horizon, compass ticks, the meridian.
  CelEquator   the equator of date, tilted by Giza's latitude and fixed to the stage: the celestial equator,
               the pole, rings 1, 2 and 5 degrees round the pole, the circle of stars that never set.
  CelEcliptic  the ecliptic of date. The page turns it with the year (obliquity from ERFA ltpecl / ltpequ)
               and the hour: equinox and solstice points ride on it.
  CelJ2000     the star frame. The page gives it the same rotation as the stars. It holds the 25,800-year
               path of the celestial pole among the stars (ERFA ltpequ, 13,000 BC to AD 12,800) and the
               angular ruler.

Axes are those of sky.x3d: equatorial (x, y, z) stored as X3D (X, Y, Z) = (y, z, x), so the pole is +Y.
The stage is X east, Y up, Z south. Lines are thin triangle strips, because WebGL draws an X3D line one
pixel wide whatever linewidthScaleFactor says. Each main circle is three strips: a core and two soft halos.
"""
import json
import math
import sys

import erfa
import numpy as np

LAT = 29.979175
R = 9000.0
RAD = math.pi / 180

CYAN = (0.42, 0.93, 1.0)
GOLD = (1.0, 0.78, 0.36)
VIOLET = (0.78, 0.62, 1.0)
WHITE = (0.95, 0.97, 1.0)
CORAL = (1.0, 0.50, 0.42)


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def to_x3d(v):
    """Equatorial (x, y, z) -> file axes (y, z, x)."""
    return np.array([v[1], v[2], v[0]], float)


def f(x):
    s = "%.2f" % x
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def pts(a):
    return " ".join(f(c) for p in a for c in p)


class Doc:
    def __init__(self):
        self.out = []

    def w(self, s):
        self.out.append(s)

    def appearance(self, colour, transparency):
        return ("<Appearance><UnlitMaterial emissiveColor='%s' transparency='%s'/></Appearance>"
                % (" ".join(f(c) for c in colour), f(transparency)))

    def strip(self, dirs, half_deg, colour, transparency, radius=R, closed=False, colours=None):
        """A ribbon along a path of unit directions, half_deg wide on each side."""
        dirs = [unit(d) for d in dirs]
        n = len(dirs)
        verts = []
        t = math.tan(half_deg * RAD)
        for i, d in enumerate(dirs):
            a = dirs[(i - 1) % n] if (closed or i > 0) else dirs[i]
            b = dirs[(i + 1) % n] if (closed or i < n - 1) else dirs[i]
            tangent = unit(b - a)
            side = unit(np.cross(d, tangent))
            verts.append(unit(d + t * side) * radius)
            verts.append(unit(d - t * side) * radius)
        if closed:
            verts += verts[:2]
        col = ""
        if colours is not None:
            cs = list(colours) + ([colours[0]] if closed else [])
            col = "<Color color='%s'/>" % " ".join(" ".join(f(c) for c in c3) + " " + " ".join(f(c) for c in c3) for c3 in cs)
        self.w("<Shape>%s<TriangleStripSet solid='false' stripCount='%d'><Coordinate point='%s'/>%s</TriangleStripSet></Shape>"
               % (self.appearance(colour, transparency), len(verts), pts(verts), col))

    def glow(self, dirs, colour, closed=False, core=0.045, colours=None, strength=1.0):
        self.strip(dirs, core * 9, colour, 1 - 0.07 * strength, R * 1.02, closed, colours)
        self.strip(dirs, core * 3.4, colour, 1 - 0.22 * strength, R * 1.01, closed, colours)
        self.strip(dirs, core, colour, 0.04, R, closed, colours)

    def thin(self, dirs, colour, transparency=0.45, closed=False, half=0.022):
        self.strip(dirs, half, colour, transparency, R * 1.005, closed)

    def quads(self, segs, half_deg, colour, transparency=0.1):
        """Many short ribbons (ticks) as one IndexedTriangleSet. segs: list of (dir_a, dir_b)."""
        verts, index = [], []
        t = math.tan(half_deg * RAD)
        for a, b in segs:
            a, b = unit(a), unit(b)
            side = unit(np.cross(a, b - a))
            k = len(verts)
            verts += [unit(a + t * side) * R, unit(a - t * side) * R, unit(b - t * side) * R, unit(b + t * side) * R]
            index += [k, k + 1, k + 2, k, k + 2, k + 3]
        self.w("<Shape>%s<IndexedTriangleSet solid='false' index='%s'><Coordinate point='%s'/></IndexedTriangleSet></Shape>"
               % (self.appearance(colour, transparency), " ".join(map(str, index)), pts(verts)))


def altaz(alt, az):
    """Stage direction for an altitude and an azimuth (degrees, azimuth from north through east)."""
    a, z = alt * RAD, az * RAD
    return np.array([math.cos(a) * math.sin(z), math.sin(a), -math.cos(a) * math.cos(z)])


def polar(dec, ha):
    """Direction in a pole-up frame (pole +Y): declination and an angle round the pole, measured from +Z to +X."""
    d, h = dec * RAD, ha * RAD
    return np.array([math.cos(d) * math.sin(h), math.sin(d), math.cos(d) * math.cos(h)])


POLE_STARS = ["Thuban", "Kochab", "Polaris", "Errai", "Alderamin", "Deneb", "Vega"]
# stars the page's charts and ruler need without starting WebGL (J2000 positions and space motions from sky.x3d)
CHART_STARS = POLE_STARS + ["Alnitak", "Alnilam", "Mintaka", "Betelgeuse", "Rigel", "Sirius", "Mizar", "Regulus", "Denebola",
                            "Arcturus", "Aldebaran", "Capella", "Procyon", "Spica", "Antares", "Canopus"]

# Camera stops the sky machine adds to the v4 stage (metres; X east, Y up, Z south). The low ones reuse eye points
# that v4 placed on the baked ground.
STOPS = {
    "machine": {"pos": [-330, 7.77, -420], "at": [-330.0, 522.0, 471.0], "fov": 1.55, "title": "North of Khafre, under the frames of the sky"},
    "polepath": {"pos": [80, 5.27, 430], "at": [80.0, 874.0, -470.0], "fov": 1.5, "title": "South of Khufu, under the path of the pole"},
    "trails": {"pos": [80, 5.27, 430], "at": [40.0, 520.0, -450.8], "fov": 1.22, "title": "South of Khufu, facing north for a long exposure"},
    "trailsouth": {"pos": [-330, 7.77, -420], "at": [-330.0, 430.0, 471.0], "fov": 1.31, "title": "North of Khafre, facing south for a long exposure"},
    "garden": {"pos": [560, 720, 1330], "at": [-230, 0, 360], "title": "High over the geometric garden"},
    "surveyview": {"pos": [520, 560, 1420], "at": [-290, 30, 370], "title": "The survey cages from the south-east"},
    "ghost": {"pos": [400, 95, 300], "at": [30, 70, 20], "title": "The ghost envelope over the Great Pyramid"},
}


def chart_stars(sky_x3d, sky_json):
    """J2000 positions (light-years, file axes) and space motions (light-years a year) of named stars."""
    data = json.load(open(sky_json, encoding="utf-8"))
    text = open(sky_x3d, encoding="utf-8").read()
    start = text.index("positions='", text.index("DEF='StarsBright'")) + len("positions='")
    numbers = text[start:text.index("'", start)].split()
    index = {}
    for l in data["labels"]:
        index.setdefault(l["n"], l["i"])
    index.update(data["key"])
    movers = {m["i"]: m["v"] for m in data["movers"]}
    out = {}
    for name in CHART_STARS:
        i = index[name]
        if i >= data["bright"]:
            raise SystemExit("%s is not among the bright stars" % name)
        out[name] = {"p": [float(c) for c in numbers[3 * i:3 * i + 3]], "v": movers.get(i, [0, 0, 0])}
    return out, data["sky_sha256"]


def build(out_x3d, out_json, sky_x3d, sky_json):
    d = Doc()
    labels = {"local": [], "equator": [], "ecliptic": [], "j2000": []}

    def lab(frame, direction, text, kind="", group=""):
        labels[frame].append({"d": [round(float(c), 5) for c in unit(direction)], "t": text, "k": kind, "g": group})

    d.w("<?xml version=\"1.0\" encoding=\"UTF-8\"?>")
    d.w("<!DOCTYPE X3D PUBLIC \"ISO//Web3D//DTD X3D 4.0//EN\" \"https://www.web3d.org/specifications/x3d-4.0.dtd\">")
    d.w("<X3D profile='Interchange' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' "
        "xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>")
    d.w("<head>")
    d.w("<component name='Shape' level='1'/>")
    d.w("<component name='Grouping' level='2'/>")
    d.w("<meta name='title' content='The sky machine over Giza: horizon, meridian, equator, ecliptic and the path of the pole'/>")
    d.w("<meta name='description' content='Frames of the sky for the star layer of the Giza atlas (Demo 65 v6). Circles of direction "
        "drawn on a sphere of radius 9000 light-years, beyond every star in sky.x3d. Axes as sky.x3d: equatorial (x, y, z) stored as "
        "X3D (y, z, x). CelLocal and CelEquator are fixed to the stage at latitude 29.979175 N. The page turns CelEcliptic and CelJ2000. "
        "The path of the pole is ERFA ltpequ (Vondrak 2011) from 13000 BC to AD 12800, one point every 50 years. Ribbon widths and "
        "halos are for the eye: they are not error bars.'/>")
    d.w("<meta name='creator' content='x3d.io Blender pipelines lane for HagopJay'/>")
    d.w("<meta name='generator' content='build_celestial.py (Demo 65 v6)'/>")
    d.w("<meta name='created' content='20 November 2026'/>")
    d.w("<meta name='license' content='GPL-3.0-or-later'/>")
    d.w("</head>")
    d.w("<Scene>")
    d.w("<Group DEF='Celestial'>")

    # ---------------- the observer's frame
    d.w("<Switch DEF='CelLocal' whichChoice='-1'><Group>")
    ring = [altaz(0.25, a) for a in range(0, 360, 2)]
    d.glow(ring, CYAN, closed=True)
    ticks_s, ticks_m, ticks_l = [], [], []
    for a in range(0, 360, 5):
        if a % 30 == 0:
            ticks_l.append((altaz(0.25, a), altaz(3.2, a)))
        elif a % 10 == 0:
            ticks_m.append((altaz(0.25, a), altaz(1.9, a)))
        else:
            ticks_s.append((altaz(0.25, a), altaz(1.1, a)))
    d.quads(ticks_l, 0.07, CYAN, 0.05)
    d.quads(ticks_m, 0.05, CYAN, 0.25)
    d.quads(ticks_s, 0.035, CYAN, 0.45)
    for a, name in ((0, "N"), (90, "E"), (180, "S"), (270, "W")):
        lab("local", altaz(5.4, a), name, "cardinal")
    for a in range(30, 360, 30):
        if a % 90:
            lab("local", altaz(4.6, a), "%d°" % a, "tick")
    # the meridian: north horizon, zenith, south horizon
    mer = [altaz(alt, 0) for alt in range(0, 90, 2)] + [altaz(alt, 180) for alt in range(90, -1, -2)]
    d.glow(mer, CYAN)
    mt = []
    for az in (0, 180):
        for alt in range(10, 90, 10):
            c = altaz(alt, az)
            e = np.array([1.0, 0, 0])
            mt.append((unit(c - math.tan(0.9 * RAD) * e), unit(c + math.tan(0.9 * RAD) * e)))
            lab("local", unit(c + math.tan(2.0 * RAD) * e), "%d°" % alt, "tick")
    d.quads(mt, 0.05, CYAN, 0.2)
    lab("local", altaz(88.2, 90), "Zenith", "name")
    lab("local", unit(altaz(37, 180) - math.tan(2.6 * RAD) * np.array([1.0, 0, 0])), "Meridian", "name")
    for alt in (30, 60):
        d.thin([altaz(alt, a) for a in range(0, 360, 3)], CYAN, 0.72, closed=True)
    d.w("</Group></Switch>")

    # ---------------- the equator of date, tilted by the latitude
    d.w("<Switch DEF='CelEquator' whichChoice='-1'><Transform DEF='CelEquatorTilt' rotation='1 0 0 %.6f'>" % ((LAT - 90) * RAD))
    d.glow([polar(0, h) for h in range(0, 360, 2)], GOLD, closed=True)
    d.quads([(polar(0, h), polar(1.6 if h % 90 else 2.6, h)) for h in range(0, 360, 15)], 0.05, GOLD, 0.2)
    for dec in (-30, 30, 60):
        d.thin([polar(dec, h) for h in range(0, 360, 3)], GOLD, 0.74, closed=True)
    # the pole, and rings round it
    for radius, tr in ((1, 0.35), (2, 0.5), (5, 0.62)):
        d.thin([polar(90 - radius, h) for h in range(0, 360, 6)], GOLD, tr, closed=True, half=0.03)
        lab("equator", polar(90 - radius, 135), "%d°" % radius, "tick", "pole")
    d.quads([(polar(89.75, h), polar(88.6, h)) for h in (0, 90, 180, 270)], 0.05, GOLD, 0.05)
    lab("equator", polar(86.6, 300), "Celestial pole", "name", "pole")
    # stars inside this circle never set at Giza: polar distance = latitude
    d.strip([polar(90 - LAT, h) for h in range(0, 360, 2)], 0.05, WHITE, 0.55, R * 1.004, closed=True)
    lab("equator", polar(90 - LAT + 1.2, 250), "Never sets inside this circle", "name", "pole")
    for h in (-48, 48, 132, 228):
        lab("equator", polar(1.8, h), "Celestial equator", "name")
    d.w("</Transform></Switch>")

    # ---------------- the ecliptic of date (the page sets the rotation)
    d.w("<Switch DEF='CelEcliptic' whichChoice='-1'><Transform DEF='CelEclipticTurn'>")
    d.glow([polar(0, h) for h in range(0, 360, 2)], VIOLET, closed=True)
    d.quads([(polar(-0.9, h), polar(0.9, h)) for h in range(0, 360, 30)], 0.06, VIOLET, 0.1)
    d.quads([(polar(-0.45, h), polar(0.45, h)) for h in range(0, 360, 10) if h % 30], 0.04, VIOLET, 0.4)
    # the four points of the year: a four-pointed star at each
    star = []
    for lon, size in ((0, 2.3), (180, 1.5), (90, 1.5), (270, 1.5)):
        star.append((polar(-size, lon), polar(size, lon)))
        c = polar(0, lon)
        e = unit(np.cross(np.array([0, 1.0, 0]), c))
        star.append((unit(c - math.tan(size * RAD) * e), unit(c + math.tan(size * RAD) * e)))
    d.quads(star, 0.11, WHITE, 0.0)
    lab("ecliptic", polar(3.4, 0), "Spring equinox point", "point")
    lab("ecliptic", polar(2.6, 90), "Summer solstice point", "point")
    lab("ecliptic", polar(2.6, 180), "Autumn equinox point", "point")
    lab("ecliptic", polar(2.6, 270), "Winter solstice point", "point")
    for lon in (30, 130, 220, 310):
        lab("ecliptic", polar(1.7, lon), "Ecliptic: the Sun's yearly path", "name")
    d.w("</Transform></Switch>")

    # ---------------- the star frame (the page gives it the stars' rotation)
    d.w("<Transform DEF='CelJ2000'>")
    d.w("<Switch DEF='CelPoleTrail' whichChoice='-1'><Group>")
    y0, y1, step = -13000, 12800, 50
    years = list(range(y0, y1 + 1, step))
    trail = [to_x3d(np.array(erfa.ltpequ(float(y)))) for y in years]

    def shade(y):
        # the past is warm, the present white, the future cool
        k = (y - 2000) / 13000.0
        a, b = (CORAL, WHITE) if k < 0 else (WHITE, VIOLET)
        k = min(1.0, abs(k)) ** 0.7
        c = [(1 - k) * b[i] + k * a[i] for i in range(3)] if a is CORAL else [(1 - k) * a[i] + k * b[i] for i in range(3)]
        return c

    cols = [shade(y) for y in years]
    d.strip(trail, 0.42, WHITE, 0.92, R * 1.02, colours=cols)
    d.strip(trail, 0.16, WHITE, 0.74, R * 1.01, colours=cols)
    d.strip(trail, 0.05, WHITE, 0.03, R, colours=cols)
    # a tick every 500 calendar years, a longer one every 1000, pointing away from the middle of the loop.
    # Ticks stand on round historical years: 3000 BC is astronomical year -2999.
    centre = unit(np.sum(trail, axis=0))
    tk_l, tk_s = [], []
    marks = [(1 - n, n, "BC") for n in range(13000, 0, -500)] + [(1, 1, "AD")] + [(n, n, "AD") for n in range(500, 12501, 500)]
    for y, n, era in marks:
        p = unit(to_x3d(np.array(erfa.ltpequ(float(y)))))
        outward = unit(p - centre * float(np.dot(p, centre)))
        major = n % 1000 == 0 or n == 1
        seg = (p, unit(p + math.tan((1.5 if major else 0.7) * RAD) * outward))
        (tk_l if major else tk_s).append(seg)
        if major:
            num = format(n, ",") if n >= 10000 else str(n)
            text = "%s BC" % num if era == "BC" else "AD %s" % num
            lab("j2000", unit(p + math.tan(2.5 * RAD) * outward), text, "year", str(y))
    d.quads(tk_l, 0.06, WHITE, 0.05)
    d.quads(tk_s, 0.04, WHITE, 0.4)
    lab("j2000", unit(centre), "The pole's path: one turn in about 25,800 years", "name")
    d.w("</Group></Switch>")
    # the angular ruler: 65 points of a great-circle arc, written by the page
    d.w("<Switch DEF='CelRuler' whichChoice='-1'><Group>")
    zero = " ".join("0 %s 0" % f(R) for _ in range(130))
    for name, tr in (("RulerGlow", 0.8), ("RulerCore", 0.0)):
        d.w("<Shape>%s<TriangleStripSet solid='false' stripCount='130'><Coordinate DEF='%s' point='%s'/></TriangleStripSet></Shape>"
            % (d.appearance(CORAL, tr), name, zero))
    d.w("</Group></Switch>")
    d.w("</Transform>")
    d.w("</Group>")
    d.w("</Scene>")
    d.w("</X3D>")
    open(out_x3d, "w", encoding="utf-8").write("\n".join(d.out) + "\n")

    # ---------------- numbers the page needs
    obl = []
    for y in range(-13000, 3001, 50):
        pe = np.array(erfa.ltpequ(float(y)))
        pc = np.array(erfa.ltpecl(float(y)))
        obl.append(round(math.degrees(math.acos(max(-1.0, min(1.0, float(pe @ pc))))), 5))
    stars, sky_sha = chart_stars(sky_x3d, sky_json)
    data = {
        "schema": "x3d.io/giza-sky-machine/1",
        "generated_by": "build_celestial.py",
        "radius_ly": R,
        "latitude": LAT,
        "model": "ERFA %s ltpequ / ltpecl (Vondrak 2011): mean pole and mean ecliptic, no nutation" % erfa.__version__,
        "obliquity": {"y0": -13000, "step": 50, "n": len(obl), "deg": obl},
        "trail": {"y0": y0, "step": step, "n": len(trail), "dirs": [round(float(c), 6) for p in trail for c in unit(p)]},
        "pole_stars": POLE_STARS,
        "stars": stars,
        "stars_from": "HYG v4.1 by David Nash, CC BY-SA 4.0, through ../v4/assets/sky.x3d (sha256 %s)" % sky_sha,
        "stops": STOPS,
        "labels": labels,
        "ruler_points": 65,
    }
    json.dump(data, open(out_json, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print("celestial.x3d: %d bytes; labels %s; obliquity %.3f deg (2560 BC) %.3f deg (J2000)"
          % (len("\n".join(d.out)), {k: len(v) for k, v in labels.items()}, obl[(-2550 + 13000) // 50], obl[(2000 + 13000) // 50]))


if __name__ == "__main__":
    build(*sys.argv[1:5])
