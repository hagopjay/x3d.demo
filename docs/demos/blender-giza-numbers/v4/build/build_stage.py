# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 65 v4: assemble the stage scene (X3D 4.0) from the Blender bake and the verified numbers.
usage: build_stage.py <bake dir> <claims-v4.json> <out assets dir>
Reads pyramids-day.x3d / pyramids-night.x3d (x3d-blender-io exports), ground.json, ground-*.png, bake-receipt.json.
Writes giza.x3d, ground-day.jpg, ground-night.jpg, stage-data.json. Nothing here is edited by hand afterwards."""
import hashlib, json, math, os, sys, datetime
import xml.etree.ElementTree as ET
from PIL import Image

BAKE, CLAIMS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
G = json.load(open(os.path.join(BAKE, "ground.json")))
R = json.load(open(os.path.join(BAKE, "bake-receipt.json")))
C = {c["key"]: c for c in json.load(open(CLAIMS))["claims"]}
IN = 0.0254


def f(v, n=2):
    s = ("%.*f" % (n, v)).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def V(p):
    return " ".join(f(c) for c in p)


# ---- pyramids: bake the exporter's Z-up Transform in, weld vertices, one colour per face -------------------------------
def read_export(path):
    out = {}
    for tr in ET.parse(path).getroot().iter("Transform"):
        name = tr.get("DEF").replace("OB_", "").rsplit("_", 1)[0]
        ifs = tr.find("Shape/IndexedFaceSet")
        pts = [float(x) for x in ifs.find("Coordinate").get("point").split()]
        col = [float(x) for x in ifs.find("ColorRGBA").get("color").split()]
        idx = [int(x) for x in ifs.get("coordIndex").split()]
        assert tr.get("rotation").startswith("-1.000000 0.000000 0.000000 1.5707"), tr.get("rotation")
        verts = [(pts[i], pts[i + 2], -pts[i + 1]) for i in range(0, len(pts), 3)]      # Blender Z-up -> X3D Y-up
        cols = [tuple(col[i:i + 3]) for i in range(0, len(col), 4)]
        faces, cur = [], []
        for i in idx:
            if i < 0:
                faces.append(cur); cur = []
            else:
                cur.append(i)
        out[name] = (verts, cols, faces)
    return out


day, night = read_export(os.path.join(BAKE, "pyramids-day.x3d")), read_export(os.path.join(BAKE, "pyramids-night.x3d"))
shapes, stats = {"day": [], "night": []}, {}
for name, (verts, cols, faces) in day.items():
    weld, points, cidx = {}, [], []
    for face in faces:
        for i in face:
            k = tuple(round(c, 2) for c in verts[i])
            if k not in weld:
                weld[k] = len(points); points.append(k)
            cidx.append(weld[k])
        cidx.append(-1)
    coord_index = " ".join(map(str, cidx))

    def face_cols(src):
        _, c2, f2 = src[name]
        assert len(f2) == len(faces)
        return " ".join(" ".join(f(min(0.999, sum(c2[i][k] for i in face) / len(face)), 3) for k in range(3)) for face in f2)

    stats[name] = dict(faces=len(faces), exported_vertices=len(verts), welded_vertices=len(points))
    mat = "<Appearance><UnlitMaterial DEF='Mat_%s_%s' transparency='0'/></Appearance>"
    shapes["day"].append("<Shape DEF='%s_Day'>%s<IndexedFaceSet solid='true' colorPerVertex='false' coordIndex='%s'><Coordinate DEF='Coord_%s' point='%s'/><Color color='%s'/></IndexedFaceSet></Shape>" % (
        name, mat % (name, "Day"), coord_index, name, " ".join(V(p) for p in points), face_cols(day)))
    shapes["night"].append("<Shape DEF='%s_Night'>%s<IndexedFaceSet solid='true' colorPerVertex='false' coordIndex='%s'><Coordinate USE='Coord_%s'/><Color color='%s'/></IndexedFaceSet></Shape>" % (
        name, mat % (name, "Night"), coord_index, name, face_cols(night)))

# ---- ground --------------------------------------------------------------------------------------------------------------
for key in ("day", "night"):
    Image.open(os.path.join(BAKE, "ground-%s.png" % key)).convert("RGB").save(os.path.join(OUT, "ground-%s.jpg" % key), quality=90, optimize=True)
n, cell = G["n"], G["cell"]
L = (n - 1) * cell
gx0, gz0 = G["x0"], -G["y1"]
heights = " ".join(f(h) for h in G["height"])
cx, cz, ez, RR = gx0 + L / 2, gz0 + L / 2, G["edge_z"], 40000.0
a = L / 2
skirt_pts, skirt_idx = [], []
for x0, z0, x1, z1 in [(-RR, -RR, RR, -a), (-RR, a, RR, RR), (-RR, -a, -a, a), (a, -a, RR, a)]:
    b = len(skirt_pts)
    skirt_pts += [(cx + x0, ez, cz + z0), (cx + x0, ez, cz + z1), (cx + x1, ez, cz + z1), (cx + x1, ez, cz + z0)]
    skirt_idx += [b, b + 1, b + 2, b + 3, -1]


def ground(key, first):
    edge = R["lights"][key]["edge_colour"]
    geo = ("<ElevationGrid DEF='Terrain' xDimension='%d' zDimension='%d' xSpacing='%s' zSpacing='%s' solid='true' creaseAngle='3' height='%s'/>" % (n, n, f(cell), f(cell), heights)
           if first else "<ElevationGrid USE='Terrain'/>")
    sk = ("<IndexedFaceSet DEF='SkirtGeo' solid='true' coordIndex='%s'><Coordinate point='%s'/></IndexedFaceSet>" % (" ".join(map(str, skirt_idx)), " ".join(V(p) for p in skirt_pts))
          if first else "<IndexedFaceSet USE='SkirtGeo'/>")
    return ("<Transform translation='%s 0 %s'><Shape DEF='Ground_%s'><Appearance><UnlitMaterial emissiveColor='1 1 1'><ImageTexture containerField='emissiveTexture' url='\"ground-%s.jpg\"' repeatS='false' repeatT='false'/></UnlitMaterial></Appearance>%s</Shape></Transform>\n"
            "<Shape DEF='Skirt_%s'><Appearance><UnlitMaterial emissiveColor='%s'/></Appearance>%s</Shape>") % (
        f(gx0), f(gz0), key.title(), key, geo, key.title(), " ".join(f(c, 3) for c in edge), sk)


# ---- numbers the rigs draw -------------------------------------------------------------------------------------------------
P = {k: dict(c=(v["centre"][0], v["z"], -v["centre"][1]), a=v["base"] / 2, h=v["height"], base=v["base"]) for k, v in G["pyramids"].items()}
KH, KF, MK = P["Khufu"], P["Khafre"], P["Menkaure"]
anchors = []


def lines(segs, color, width=2.0, transparency=0.0, DEF=None):
    pts, idx = [], []
    for seg in segs:
        b = len(pts); pts += seg; idx += list(range(b, b + len(seg))) + [-1]
    return "<Shape%s><Appearance><UnlitMaterial emissiveColor='%s' transparency='%s'/><LineProperties linewidthScaleFactor='%s'/></Appearance><IndexedLineSet coordIndex='%s'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (
        " DEF='%s'" % DEF if DEF else "", color, f(transparency), f(width), " ".join(map(str, idx)), " ".join(V(p) for p in pts))


def add(c, d):
    return (c[0] + d[0], c[1] + d[1], c[2] + d[2])


def casing(p, lift=0.4):
    c, a, h = p["c"], p["a"], p["h"]
    cs = [add(c, (sx * a, lift, sz * a)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    apex = add(c, (0, h, 0))
    return [cs + [cs[0]]] + [[k, apex] for k in cs]


def slope_triangle(p, lift=0.4):
    c, a, h = p["c"], p["a"], p["h"]
    return [[add(c, (0, lift, 0)), add(c, (0, lift, a)), add(c, (0, h, 0)), add(c, (0, lift, 0))]]


def circle(c, r, y, nseg=128):
    return [[(c[0] + r * math.cos(2 * math.pi * i / nseg), c[1] + y, c[2] + r * math.sin(2 * math.pi * i / nseg)) for i in range(nseg + 1)]]


GOLD, CYAN, WHITE, ROSE, GREEN = "1 0.82 0.36", "0.35 0.9 1", "1 1 1", "1 0.45 0.55", "0.5 1 0.6"
rigs = {}
kc, kh = KH["c"], KH["h"]
# square: the base, the height and the apothem of the designed (cased) pyramid
rigs["square"] = lines(casing(KH), WHITE, 1.5, 0.35) + lines(slope_triangle(KH), GOLD, 3) + lines(
    [[add(kc, (-KH["a"], 0.5, -KH["a"])), add(kc, (KH["a"], 0.5, KH["a"]))], [add(kc, (KH["a"], 0.5, -KH["a"])), add(kc, (-KH["a"], 0.5, KH["a"]))]], CYAN, 1.5, 0.3)
anchors += [dict(rig="square", t="height %.2f m · 280 cubits" % kh, p=add(kc, (0, kh * 0.55, 0))), dict(rig="square", t="half base %.2f m · 220 cubits" % KH["a"], p=add(kc, (0, 2, KH["a"] * 0.55))),
            dict(rig="square", t="apothem %.2f m · 356 cubits" % math.hypot(kh, KH["a"]), p=add(kc, (0, kh * 0.5, KH["a"] * 0.5 + 14))), dict(rig="square", t="base %.3f m · 440 cubits" % KH["base"], p=add(kc, (0, 2, KH["a"] + 16)))]
# circle: the circle whose radius is the height, against the perimeter
rigs["circle"] = lines(casing(KH), WHITE, 1.5, 0.35) + lines(circle(kc, kh, 0.6), GOLD, 3) + lines([[add(kc, (0, 0.6, 0)), add(kc, (kh, 0.6, 0))], [add(kc, (0, 0.6, 0)), add(kc, (0, kh, 0))]], CYAN, 2)
anchors += [dict(rig="circle", t="circle of radius = height: %.2f m around" % (2 * math.pi * kh), p=add(kc, (kh * 0.72, 3, kh * 0.72))), dict(rig="circle", t="perimeter of the base: %.2f m" % (4 * KH["base"]), p=add(kc, (-KH["a"], 3, KH["a"] + 10)))]
# hemisphere: the dome whose equator is the perimeter (the 1 : 43,200 Earth)
rr = 4 * KH["base"] / (2 * math.pi)
dome = [[(kc[0] + rr * math.cos(th) * math.cos(ph), kc[1] + 0.5 + rr * math.sin(th), kc[2] + rr * math.cos(th) * math.sin(ph)) for th in [math.pi / 2 * i / 24 for i in range(25)]] for ph in [2 * math.pi * k / 16 for k in range(16)]]
dome += [[(kc[0] + rr * math.cos(th) * math.cos(2 * math.pi * i / 96), kc[1] + 0.5 + rr * math.sin(th), kc[2] + rr * math.cos(th) * math.sin(2 * math.pi * i / 96)) for i in range(97)] for th in [math.radians(d) for d in (0, 30, 60)]]
rigs["hemisphere"] = lines(casing(KH), WHITE, 1.5, 0.35) + lines(dome, CYAN, 1.5, 0.25)
anchors += [dict(rig="hemisphere", t="a dome whose equator is the base perimeter: radius %.2f m" % rr, p=add(kc, (rr * 0.8, rr * 0.62, 0))), dict(rig="hemisphere", t="apex %.2f m" % kh, p=add(kc, (0, kh + 8, 0)))]
# Khafre's 3-4-5
rigs["triangle345"] = lines(casing(KF), WHITE, 1.5, 0.35) + lines(slope_triangle(KF), GOLD, 3.5)
fc = KF["c"]
anchors += [dict(rig="triangle345", t="3 · half base %.2f m" % KF["a"], p=add(fc, (0, 3, KF["a"] * 0.5))), dict(rig="triangle345", t="4 · height %.2f m" % KF["h"], p=add(fc, (0, KF["h"] * 0.5, 0))),
            dict(rig="triangle345", t="5 · the face", p=add(fc, (0, KF["h"] * 0.52, KF["a"] * 0.5 + 12)))]
rigs["menkaure"] = lines(casing(MK), WHITE, 1.5, 0.35) + lines(slope_triangle(MK), GOLD, 3.5) + lines(casing(KH), WHITE, 1.2, 0.5) + lines(slope_triangle(KH), CYAN, 2.5)
anchors += [dict(rig="menkaure", t="Menkaure 51°00′ ± 10′", p=add(MK["c"], (0, MK["h"] + 8, 0))), dict(rig="menkaure", t="Khufu 51°52′ ± 2′", p=add(kc, (0, kh + 8, 0)))]
# chambers and passages (Petrie s.36-s.64; the passage run is a schematic that closes within a metre)
KCB = dict(x0=-107.7 * IN, x1=305.1 * IN, z0=330.6 * IN, z1=537.0 * IN, y0=1692.8 * IN, y1=1692.8 * IN + 230.09 * IN)
QCB = dict(x0=-226.47 * IN / 2 + 4.8, x1=226.47 * IN / 2 + 4.8, z0=-205.85 * IN / 2, z1=205.85 * IN / 2, y0=834.4 * IN, y1=834.4 * IN + 184.47 * IN)


def box(b):
    x0, x1, y0, y1, z0, z1 = b["x0"], b["x1"], b["y0"], b["y1"], b["z0"], b["z1"]
    bot = [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)]; top = [(x, y1, z) for x, _, z in bot]
    return [bot + [bot[0]], top + [top[0]]] + [[bot[i], top[i]] for i in range(4)]


PX = 287.0 * IN                       # passages lie east of the centre (illustrative: about 7.3 m)
face_z = lambda y: -(KH["a"] - y / math.tan(math.radians(51 + 52 / 60)))
e_y = 17.0; e = (PX, e_y, face_z(e_y))
ang_d, ang_a, ang_g = [math.radians(d + m / 60 + s / 3600) for d, m, s in ((26, 31, 23), (26, 2, 30), (26, 16, 40))]
j = (PX, e_y - 28.2 * math.sin(ang_d), e[2] + 28.2 * math.cos(ang_d))
pit = (PX, e_y - 105.0 * math.sin(ang_d), e[2] + 105.0 * math.cos(ang_d))
g0 = (PX, j[1] + 39.3 * math.sin(ang_a), j[2] + 39.3 * math.cos(ang_a))
g1 = (PX, g0[1] + 1838.6 * IN * math.sin(ang_g), g0[2] + 1838.6 * IN * math.cos(ang_g))
passages = [[e, j, pit], [j, g0, g1], [g0, (PX, g0[1], QCB["z0"])], [g1, (PX, g1[1], KCB["z0"])]]
sight = [[e, (PX, e_y + 60000 * math.sin(ang_d), e[2] - 60000 * math.cos(ang_d))]]      # the descending passage carried on into the sky
kdiag = [[(KCB["x0"], KCB["y0"], KCB["z0"]), (KCB["x0"], KCB["y1"], KCB["z1"])], [(KCB["x0"], KCB["y1"], KCB["z1"]), (KCB["x1"], KCB["y1"], KCB["z1"])],
         [(KCB["x0"], KCB["y0"], KCB["z0"]), (KCB["x1"], KCB["y1"], KCB["z1"])]]
rigs["chambers"] = lines(casing(KH), WHITE, 1.5, 0.3) + lines(box(KCB) + box(QCB), GOLD, 2.5) + lines(passages, CYAN, 2.5) + lines(sight, CYAN, 1.5, 0.35) + lines(kdiag, ROSE, 3)
anchors += [dict(rig="chambers", t="King's Chamber 10 × 20 cubits", p=(KCB["x1"] + 3, KCB["y1"] + 3, KCB["z1"])), dict(rig="chambers", t="Queen's Chamber", p=(QCB["x1"] + 3, QCB["y1"] + 2, 0)),
            dict(rig="chambers", t="Grand Gallery 26°16′40″", p=(PX, (g0[1] + g1[1]) / 2 + 4, (g0[2] + g1[2]) / 2)), dict(rig="chambers", t="descending passage 26°31′23″ · 1 in 2 is 26°33′54″", p=(PX, j[1] - 12, j[2] + 14)),
            dict(rig="chambers", t="entrance", p=e)]
# shafts
SH = {s["key"]: s for s in C["shaft_stars"]["shafts"]}
kx = (KCB["x0"] + KCB["x1"]) / 2
starts = dict(KS=(kx, KCB["y0"] + 1.0, KCB["z1"]), KN=(kx, KCB["y0"] + 1.0, KCB["z0"]), QS=(4.8, QCB["y0"] + 1.5, QCB["z1"]), QN=(4.8, QCB["y0"] + 1.5, QCB["z0"]))
SCOL = dict(KS="1 0.6 0.25", KN="0.3 1 0.85", QS="0.75 0.85 1", QN="1 0.9 0.4")
shaft_x3d, shaft_data = "", {}
for k, st in starts.items():
    ang = math.radians(SH[k]["gantenbrink_deg"]); sgn = 1 if k.endswith("S") else -1
    d = (0.0, math.sin(ang), sgn * math.cos(ang))
    # where the ray leaves the casing: y = (a - |z|) tan(slope)
    t_exit = next(t for t in [i * 0.25 for i in range(4000)] if st[1] + d[1] * t >= (KH["a"] - abs(st[2] + d[2] * t)) * math.tan(math.radians(51 + 52 / 60)))
    ex = add(st, tuple(c * t_exit for c in d)); far = add(st, tuple(c * 60000.0 for c in d))
    shaft_x3d += lines([[st, ex]], SCOL[k], 3.0, 0.0, DEF="Shaft_%s_in" % k) + lines([[ex, far]], SCOL[k], 2.0, 0.35, DEF="Shaft_%s_out" % k)
    shaft_data[k] = dict(start=st, exit=ex, dir=d, angle_deg=SH[k]["gantenbrink_deg"], star=SH[k]["star"], side=SH[k]["side"])
    anchors.append(dict(rig="shafts", t="%s shaft %.2f° → %s" % ("King's" if k[0] == "K" else "Queen's", SH[k]["gantenbrink_deg"], SH[k]["star"]), p=add(st, tuple(c * (t_exit + 60) for c in d))))
rigs["shafts"] = lines(casing(KH), WHITE, 1.5, 0.3) + lines(box(KCB) + box(QCB), GOLD, 2) + shaft_x3d
# Orion's belt on the plan
fit = C["orion_belt"]["fit_2560BC"]
gp = {k: (v[0], 0, -v[1]) for k, v in fit["points"].items()}
lev = lambda p, y=1.5: (p[0], y, p[2])
cen = [lev(KH["c"], 1.5), lev(KF["c"], 11.5), lev(MK["c"], 11.5)]
star_marks = []
for nme, p in gp.items():
    star_marks += circle((p[0], 0, p[2]), 22.0, 12.0 if nme != "Alnitak" else 2.0, 48) + [[(p[0], 0, p[2]), (p[0], 420, p[2])]]
    anchors.append(dict(rig="belt", t=nme + (" lands %.0f m from Khafre's centre" % fit["miss_m"] if nme == "Alnilam" else ""), p=(p[0], 430, p[2])))
rigs["belt"] = lines([cen], GOLD, 3) + lines(star_marks, CYAN, 2, 0.15) + lines([[lev(gp["Alnitak"], 300), lev(gp["Alnilam"], 300), lev(gp["Mintaka"], 300)]], CYAN, 2.5, 0.1)
# cardinal cross and the latitude of the speed of light
rigs["cardinal"] = lines(casing(KH), WHITE, 1.5, 0.35) + lines([[(0, 1, -1500), (0, 1, 1500)], [(-1500, 1, 0), (1500, 1, 0)]], CYAN, 2.5) + lines([[(-40, 1, -1400), (0, 1, -1500), (40, 1, -1400)]], CYAN, 2.5)
anchors += [dict(rig="cardinal", t="true north · sides off by 3′43″ (Petrie)", p=(0, 30, -1250)), dict(rig="cardinal", t="east", p=(1250, 30, 0))]
lat_m = (29.9792458 - 29.979175) * 110852.0
rigs["latitude"] = lines(casing(KH), WHITE, 1.5, 0.35) + lines([[(-900, 1, -lat_m), (900, 1, -lat_m)]], GOLD, 3.5) + lines([[(-900, 1, 0), (900, 1, 0)]], WHITE, 1.2, 0.5) + lines(
    [[(-KH["a"], 1.2, -KH["a"]), (KH["a"], 1.2, -KH["a"])], [(-KH["a"], 1.2, KH["a"]), (KH["a"], 1.2, KH["a"])]], ROSE, 3)
anchors += [dict(rig="latitude", t="29.9792458° N runs %.1f m north of the centre" % lat_m, p=(420, 14, -lat_m)), dict(rig="latitude", t="every latitude from 29.97814° to 29.98021° crosses the base", p=(-520, 14, KH["a"] + 30))]
# the diagonal through the south-east corners
se = [add(p["c"], (p["a"], 0, p["a"])) for p in (KH, KF, MK)]
d = (se[1][0] - se[0][0], se[1][2] - se[0][2]); dl = math.hypot(*d)
miss = ((se[2][0] - se[0][0]) * d[1] - (se[2][2] - se[0][2]) * d[0]) / dl
ext = (se[0][0] + d[0] / dl * 1250, 1.5, se[0][2] + d[1] / dl * 1250)
diag_c = (KF["c"][0] - KH["c"][0], KF["c"][2] - KH["c"][2])
rigs["diagonal"] = lines([[lev(se[0]), ext]], GOLD, 3) + lines([circle((s[0], 0, s[2]), 9.0, 11.5 if i else 1.5, 32)[0] for i, s in enumerate(se)], ROSE, 2.5) + lines([[lev(KH["c"]), (KH["c"][0] - 900, 1.5, KH["c"][2] + 900)]], CYAN, 1.5, 0.4)
anchors += [dict(rig="diagonal", t="line through two south-east corners misses the third by %.1f m" % abs(miss), p=(se[2][0] + 20, 30, se[2][2] + 20))]
rig_names = list(rigs)
proof = "\n".join("<Group DEF='Rig_%s'>%s</Group>" % (k, v) for k, v in rigs.items())

# ---- viewpoints and stops ---------------------------------------------------------------------------------------------------
def look(pos, at):
    """X3D orientation that looks from pos to at with +Y up."""
    import numpy as np
    fwd = np.array(at, float) - np.array(pos, float); fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    M = np.array([right, up, -fwd]).T
    # matrix -> quaternion by the largest-diagonal branch: the antisymmetric part alone is zero at a half turn,
    # and a camera facing due south is exactly a half turn
    t = np.trace(M)
    if t > 0:
        s = math.sqrt(t + 1) * 2; q = [(M[2, 1] - M[1, 2]) / s, (M[0, 2] - M[2, 0]) / s, (M[1, 0] - M[0, 1]) / s, s / 4]
    elif M[0, 0] > M[1, 1] and M[0, 0] > M[2, 2]:
        s = math.sqrt(1 + M[0, 0] - M[1, 1] - M[2, 2]) * 2; q = [s / 4, (M[0, 1] + M[1, 0]) / s, (M[0, 2] + M[2, 0]) / s, (M[2, 1] - M[1, 2]) / s]
    elif M[1, 1] > M[2, 2]:
        s = math.sqrt(1 + M[1, 1] - M[0, 0] - M[2, 2]) * 2; q = [(M[0, 1] + M[1, 0]) / s, s / 4, (M[1, 2] + M[2, 1]) / s, (M[0, 2] - M[2, 0]) / s]
    else:
        s = math.sqrt(1 + M[2, 2] - M[0, 0] - M[1, 1]) * 2; q = [(M[0, 2] + M[2, 0]) / s, (M[1, 2] + M[2, 1]) / s, s / 4, (M[1, 0] - M[0, 1]) / s]
    w = max(-1.0, min(1.0, float(q[3]))); sn = math.sqrt(max(0.0, 1 - w * w))
    if sn < 1e-9:
        return (0, 1, 0, 0)
    return (float(q[0]) / sn, float(q[1]) / sn, float(q[2]) / sn, 2 * math.acos(w))


mid = ((KH["c"][0] + MK["c"][0]) / 2, 40, (KH["c"][2] + MK["c"][2]) / 2)


def ground_y(x, z):
    """Height of the ElevationGrid at a point (bilinear)."""
    u, v = (x - gx0) / cell, (z - gz0) / cell
    i, j = min(n - 2, max(0, int(u))), min(n - 2, max(0, int(v)))
    fu, fv = u - i, v - j
    H = lambda a, b: G["height"][a + b * n]
    return (H(i, j) * (1 - fu) + H(i + 1, j) * fu) * (1 - fv) + (H(i, j + 1) * (1 - fu) + H(i + 1, j + 1) * fu) * fv


def sky_stop(x, z, eye, bearing, alt, fov, title):
    """A stop standing on the ground, looking along a compass bearing (from north through east) at an altitude."""
    b, a = math.radians(bearing), math.radians(alt)
    pos = (x, round(ground_y(x, z) + eye, 2), z)
    d = (math.sin(b) * math.cos(a), math.sin(a), -math.cos(b) * math.cos(a))
    return dict(pos=pos, at=tuple(round(pos[i] + 1000 * d[i], 2) for i in range(3)), fov=round(math.radians(fov), 4), title=title)


STOPS = {
    "hero": dict(pos=(430, 22, 1090), at=(-330, 86, 380), title="Golden hour from the south-east"),
    "khufu": dict(pos=(330, 60, 330), at=(0, 62, 0), title="The Great Pyramid"),
    "khafre": dict(pos=(-334, 60, 800), at=(-334, 78, 354), title="Khafre from the south"),
    "menkaure": dict(pos=(-380, 45, 1010), at=(-420, 55, 500), title="Menkaure and Khufu"),
    "plan": dict(pos=(-287, 2500, 82), at=(-287, 0, 80), title="Plan view, north up"),
    "section": dict(pos=(420, 70, 20), at=(0, 62, 0), title="Section from the east"),
    "south": dict(pos=(330, 6, -560), at=(-90, 250, 260), title="North-east of Khufu, facing the southern sky"),
    # the three sky stops stand on the sand (eye = metres above the ground there) and look along a compass bearing
    "north": sky_stop(80, 430, 2.2, bearing=356, alt=28, fov=60, title="South of Khufu, facing the northern sky"),
    "belt": sky_stop(-330, -420, 2.2, bearing=180, alt=27, fov=75, title="North of Khafre, facing the southern sky"),
    "moon": sky_stop(150, 760, 2.2, bearing=318, alt=24, fov=70, title="South-east of the plateau, under the Moon"),
    "rise": sky_stop(-1100, 420, 2.2, bearing=90, alt=17, fov=62, title="West of the plateau, facing the eastern sky"),
    "west": dict(pos=(-1500, 120, 500), at=(-250, 40, 380), title="Panorama from the west"),
    "east": dict(pos=(700, 5, 0), at=(0, 60, 0), title="Due east of Khufu"),
}
vps = ""
for k, sdef in STOPS.items():
    o = look(sdef["pos"], sdef["at"])
    sdef["ori"] = o
    vps += "<Viewpoint DEF='VP_%s' description='%s' position='%s' orientation='%s' fieldOfView='%s' nearDistance='1' farDistance='90000'/>\n" % (k, sdef["title"], V(sdef["pos"]), " ".join(f(c, 5) for c in o), f(sdef.get("fov", 0.7854), 4))

today = datetime.date.today().strftime("%d %B %Y")
x3d = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Immersive' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
<head>
<component name='Layering' level='1'/>
<component name='Shape' level='1'/>
<meta name='title' content='Giza plateau: three pyramids with Blender Cycles light baked in, and the proof rigs of the sacred-geometry atlas'/>
<meta name='description' content='1 unit = 1 m. X east, Y up, Z south; the centre of the Great Pyramid base is the origin. Pyramid sizes and spacing: Petrie 1883 (Great Pyramid base: Dash 2015). Light: Cycles vertex-colour and lightmap bakes for golden hour and a moonlit night, drawn unlit. Illustrative, not surveyed: course heights, missing tops, queens pyramids, ground relief, base levels, the passage run and the east offset of the chambers.'/>
<meta name='creator' content='x3d.io Blender pipelines lane for HagopJay'/>
<meta name='generator' content='Blender {R["blender"]} + x3d-blender-io 2.6.4, then build_stage.py (Demo 65 v4)'/>
<meta name='created' content='{today}'/>
<meta name='license' content='GPL-3.0-or-later'/>
</head>
<Scene>
<WorldInfo DEF='StageInfo' title='Giza: the sacred geometry atlas' info='"Demo 65 v4" "Petrie 1883" "Dash 2015" "Blender Cycles bake"'/>
<LayerSet DEF='Layers' activeLayer='1' order='0 1'>
<Layer DEF='Stage'>
<NavigationInfo DEF='Nav' type='"EXAMINE" "FLY" "ANY"' headlight='false' speed='60' transitionType='"TELEPORT"'/>
<Fog DEF='HazeDay' color='0.93 0.74 0.56' visibilityRange='26000'/>
<Fog DEF='HazeNight' color='0.03 0.048 0.1' visibilityRange='18000'/>
{vps}<Viewpoint DEF='Eye_A' description='Tour camera A' position='430 22 1090' orientation='{" ".join(f(c, 5) for c in STOPS["hero"]["ori"])}' nearDistance='1' farDistance='90000'/>
<Viewpoint DEF='Eye_B' description='Tour camera B' position='430 22 1090' orientation='{" ".join(f(c, 5) for c in STOPS["hero"]["ori"])}' nearDistance='1' farDistance='90000'/>
<ProximitySensor DEF='Where' size='1000000 1000000 1000000'/>
<Switch DEF='World' whichChoice='0'>
<Group DEF='Plateau'>
<Switch DEF='Light' whichChoice='0'>
<Group DEF='Day'>
{ground("day", True)}
{chr(10).join(shapes["day"])}
</Group>
<Group DEF='Night'>
{ground("night", False)}
{chr(10).join(shapes["night"])}
</Group>
</Switch>
<Switch DEF='Proof' whichChoice='-1'>
{proof}
</Switch>
</Group>
</Switch>
</Layer>
</LayerSet>
<Background DEF='SkyDay' skyColor='0.16 0.30 0.56 0.36 0.50 0.72 0.80 0.70 0.66 0.99 0.76 0.52' skyAngle='1.05 1.42 1.5708' groundColor='0.93 0.74 0.56'/>
<Background DEF='SkyNight' skyColor='0.002 0.004 0.012 0.006 0.011 0.03 0.018 0.03 0.07 0.04 0.062 0.125' skyAngle='1.0 1.4 1.5708' groundColor='0.03 0.048 0.1'/>
<Viewpoint DEF='SkyEye' description='Sky camera' position='0 0 0' nearDistance='0.4' farDistance='20000'/>
<Group DEF='SkyRoot'><WorldInfo title='sky' info='"The page loads assets/sky.x3d here (52,602 stars) once the plateau is drawn."'/></Group>
</Scene>
</X3D>
"""
open(os.path.join(OUT, "giza.x3d"), "w", encoding="utf-8").write(x3d)
data = dict(schema="x3d.io/giza-stage/1", rigs=rig_names, anchors=anchors, stops=STOPS, shafts=shaft_data, pyramids=P,
            chambers=dict(king=KCB, queen=QCB), latitude_line_m_north=lat_m, se_diagonal_miss_m=abs(miss),
            khafre_off_khufu_diagonal_m=abs(diag_c[0] + diag_c[1]) / math.sqrt(2), meshes=stats,
            sun=dict(az=248.0, el=10.0), moon=dict(az=300.0, el=44.0), giza_sha256=hashlib.sha256(x3d.encode()).hexdigest())
json.dump(data, open(os.path.join(OUT, "stage-data.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print("giza.x3d MB %.2f" % (len(x3d) / 1e6), stats, "rigs", rig_names, "anchors", len(anchors), "SE miss %.1f" % miss, "diag off %.1f" % data["khafre_off_khufu_diagonal_m"])
