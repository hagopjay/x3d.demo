#!/usr/bin/env python3
"""Generate the X3D 4.0 world "A Landscape of Consciousness" from landscape.json.

One data file drives every mark: 10 families, 13 sub-branches of Materialism, 209 entries.
Layout: a spiral ascent. Materialism is a neural arbor at the centre on the ground; families 2..9 sit on
floating lotus platforms climbing a ring of radius 36; Challenge hangs at the apex above the centre.
A river of thought (Extrusion) loops through every station and back down the central axis.

Traps honoured (x3d.loom lessons): ShaderPart sources are data:x-shader URLs; ROUTEs come after every DEF;
real geometry stays in the file (shaders only animate it); style metadata sits on the root Group.
"""
import json, math, sys, hashlib
import numpy as np
from glyphs import GlyphLib

HERE = sys.argv[1] if len(sys.argv) > 1 else "."
DATA = json.load(open(f"{HERE}/landscape.json"))
STYLE = json.load(open(f"{HERE}/style/kuhn-landscape.style.json"))["final"]
CAT = STYLE["palette"]["categorical"]

def hex2rgb(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])
def f(v):
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s
def fv(a): return " ".join(f(x) for x in a)
def fvs(arr): return " ".join(fv(a) for a in arr)
def cl(arr): return [np.clip(np.asarray(a, float), 0, 1) for a in arr]
def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&apos;")
def mfs(*ss): return " ".join('"' + esc(s).replace('"', '\\"') + '"' for s in ss)
def lighten(c, t): return np.asarray(c) * (1 - t) + t
def norm(v): v = np.asarray(v, float); n = np.linalg.norm(v); return v / n if n > 1e-12 else v

COL = [hex2rgb(h) for h in CAT]            # index 0 = family 1
OUT = []
def w(s): OUT.append(s)

# ---------------------------------------------------------------- geometry helpers
def ifs(points, faces, colors=None, color_per_vertex=True, crease=0.9, solid=True, face_colors=None, ccw=True):
    idx = " ".join(" ".join(str(i) for i in fc) + " -1" for fc in faces)
    s = [f"<IndexedFaceSet solid='{str(solid).lower()}' ccw='{str(ccw).lower()}' creaseAngle='{f(crease)}' coordIndex='{idx}'"]
    if face_colors is not None:
        s.append(" colorPerVertex='false'")
    s.append(f"><Coordinate point='{fvs(points)}'/>")
    if colors is not None:
        s.append(f"<Color color='{fvs(cl(colors))}'/>")
    if face_colors is not None:
        s.append(f"<Color color='{fvs(cl(face_colors))}'/>")
    s.append("</IndexedFaceSet>")
    return "".join(s)

def grid_faces(nu, nv, close_u, close_v, flip_seam=False):
    """Quads of a (nu x nv) vertex grid. flip_seam joins the last u column to the first with v reversed."""
    faces = []
    U = nu if close_u else nu - 1
    V = nv if close_v else nv - 1
    for i in range(U):
        for j in range(V):
            i1 = (i + 1) % nu
            j1 = (j + 1) % nv
            if flip_seam and i == nu - 1:
                a, b, c, d = i * nv + j, i * nv + j1, (nv - 1 - j1), (nv - 1 - j)
            else:
                a, b, c, d = i * nv + j, i * nv + j1, i1 * nv + j1, i1 * nv + j
            faces.append((a, b, c, d))
    return faces

def icosphere(n):
    t = (1 + 5 ** 0.5) / 2
    V = [norm(v) for v in [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]]
    F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
         (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(n):
        cache = {}
        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                V.append(norm((V[a] + V[b]) / 2)); cache[k] = len(V) - 1
            return cache[k]
        F2 = []
        for a, b, c in F:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            F2 += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        F = F2
    return np.array(V), F

def noise3(p, seed=0.0):
    x, y, z = p
    return (math.sin(1.7 * x + 3.1 * y + seed) * math.cos(2.3 * z - 1.3 * x + seed * 0.7)
            + 0.5 * math.sin(4.1 * y + 2.9 * z + seed * 1.3) * math.cos(3.7 * x + seed)
            + 0.25 * math.sin(8.3 * x - 7.1 * z + 5.3 * y + seed * 2.1))

def tube_mesh(curve, radius, sides=10, closed=True):
    """Parallel-transport tube along a polyline. radius may be a function of s in [0,1]."""
    P = np.array(curve, float); n = len(P)
    T = np.array([norm(P[(i + 1) % n] - P[i - 1]) if closed else norm(P[min(i + 1, n - 1)] - P[max(i - 1, 0)]) for i in range(n)])
    N = [norm(np.cross(T[0], [0.31, 0.77, 0.55]))]
    for i in range(1, n):
        b = np.cross(T[i - 1], T[i])
        if np.linalg.norm(b) < 1e-9: N.append(N[-1]); continue
        b = norm(b); ang = math.acos(max(-1, min(1, float(np.dot(T[i - 1], T[i])))))
        v = N[-1]; v = v * math.cos(ang) + np.cross(b, v) * math.sin(ang) + b * np.dot(b, v) * (1 - math.cos(ang))
        N.append(norm(v))
    pts = []
    for i in range(n):
        r = radius(i / (n - 1)) if callable(radius) else radius
        B = np.cross(T[i], N[i])
        for j in range(sides):
            a = 2 * math.pi * j / sides
            pts.append(P[i] + r * (math.cos(a) * N[i] + math.sin(a) * B))
    return np.array(pts), grid_faces(n, sides, closed, True)

def superformula(phi, m, n1, n2, n3, a=1, b=1):
    t1 = abs(math.cos(m * phi / 4) / a) ** n2
    t2 = abs(math.sin(m * phi / 4) / b) ** n3
    return (t1 + t2) ** (-1 / n1)

def axis_angle(R):
    R = np.asarray(R)
    ang = math.acos(max(-1, min(1, (np.trace(R) - 1) / 2)))
    if ang < 1e-6: return (0, 1, 0, 0)
    if abs(ang - math.pi) < 1e-4:
        ax = norm(np.sqrt(np.maximum(np.diag(R) + 1, 0) / 2))
        # fix signs
        if R[0, 1] < 0 and ax[0] * ax[1] > 0: ax[1] = -ax[1]
        if R[0, 2] < 0 and ax[0] * ax[2] > 0: ax[2] = -ax[2]
        return (*ax, ang)
    ax = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (2 * math.sin(ang))
    return (*norm(ax), ang)

def look_rot(eye, target, up=(0, 1, 0)):
    fwd = norm(np.array(target, float) - np.array(eye, float))
    right = norm(np.cross(fwd, up)); u = np.cross(right, fwd)
    R = np.column_stack([right, u, -fwd])
    return axis_angle(R)

def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n):
        t = i / (n - 1)
        out.append(((1 - t) ** 3) * np.array(p0) + 3 * ((1 - t) ** 2) * t * np.array(p1) + 3 * (1 - t) * t * t * np.array(p2) + t ** 3 * np.array(p3))
    return out

def catmull(points, samples_per_seg, closed=True):
    P = [np.array(p, float) for p in points]; n = len(P); out = []
    segs = n if closed else n - 1
    for i in range(segs):
        p0, p1, p2, p3 = P[(i - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]
        for k in range(samples_per_seg):
            t = k / samples_per_seg
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out

def resample(poly, n, closed=True):
    P = np.array(poly); Q = np.vstack([P, P[:1]]) if closed else P
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]
    s = np.linspace(0, d[-1], n + (0 if closed else 0), endpoint=not closed)
    return np.array([np.interp(s, d, Q[:, k]) for k in range(3)]).T

def mat(kind="phys", base=(1, 1, 1), emissive=(0, 0, 0), metallic=0.2, rough=0.5, transp=0.0, DEF=None):
    d = f" DEF='{DEF}'" if DEF else ""
    if kind == "phys":
        return f"<PhysicalMaterial{d} baseColor='{fv(base)}' emissiveColor='{fv(emissive)}' metallic='{f(metallic)}' roughness='{f(rough)}' transparency='{f(transp)}'/>"
    if kind == "unlit":
        return f"<UnlitMaterial{d} emissiveColor='{fv(emissive)}' transparency='{f(transp)}'/>"
    return f"<Material{d} diffuseColor='{fv(base)}' emissiveColor='{fv(emissive)}' specularColor='0.6 0.6 0.6' shininess='0.4' transparency='{f(transp)}'/>"

def shape(geom, material, extra_app="", DEF=None):
    d = f" DEF='{DEF}'" if DEF else ""
    return f"<Shape{d}><Appearance>{material}{extra_app}</Appearance>{geom}</Shape>"

ROUTES = []
def route(a, af, b, bf): ROUTES.append(f"<ROUTE fromNode='{a}' fromField='{af}' toNode='{b}' toField='{bf}'/>")

def spin(target_def, period, axis=(0, 1, 0), reverse=False):
    """A looping rotation about axis: TimeSensor + OrientationInterpolator + ROUTEs."""
    ts, oi = f"{target_def}_clk", f"{target_def}_rot"
    sgn = -1 if reverse else 1
    keys = "0 0.25 0.5 0.75 1"
    vals = ", ".join(f"{fv(axis)} {f(sgn * a)}" for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2, 2 * math.pi))
    w(f"<TimeSensor DEF='{ts}' cycleInterval='{f(period)}' loop='true'/>")
    w(f"<OrientationInterpolator DEF='{oi}' key='{keys}' keyValue='{vals}'/>")
    route(ts, "fraction_changed", oi, "set_fraction"); route(oi, "value_changed", target_def, "set_rotation")

def pulse_color(mat_def, field, c_lo, c_hi, period):
    ts, ci = f"{mat_def}_pclk", f"{mat_def}_pc"
    w(f"<TimeSensor DEF='{ts}' cycleInterval='{f(period)}' loop='true'/>")
    w(f"<ColorInterpolator DEF='{ci}' key='0 0.5 1' keyValue='{fv(c_lo)}, {fv(c_hi)}, {fv(c_lo)}'/>")
    route(ts, "fraction_changed", ci, "set_fraction"); route(ci, "value_changed", mat_def, field)

FONTS = {"R": GlyphLib(f"{HERE}/fonts/Ubuntu-R.ttf", "R"), "B": GlyphLib(f"{HERE}/fonts/Ubuntu-B.ttf", "B")}
INKS = {}        # colour -> DEF name
COMBOS = {}      # (font, char, ink) -> Shape DEF name, in first-use order
def ink_def(color):
    key = fv(np.clip(color, 0, 1))
    if key not in INKS: INKS[key] = f"Ink{len(INKS)}"
    return INKS[key], key
def text_geom(s_, size, color, bold=False, justify="BEGIN", dx=0.0):
    """A run of glyph instances; every glyph is geometry defined once in the library and USEd."""
    fk = "B" if bold else "R"; lib = FONTS[fk]; ink, _ = ink_def(color)
    width = lib.width(s_)
    x = dx / size + (-width / 2 if justify == "MIDDLE" else 0.0)
    parts = []
    for ch in s_:
        if lib.mesh(ch) is not None:
            name = f"S{fk}{ord(ch)}_{ink}"
            COMBOS.setdefault((fk, ch, ink), name)
            parts.append(f"<Transform translation='{f(x)} 0 0'><Shape USE='{name}'/></Transform>")
        x += lib.advance(ch)
    return f"<Transform translation='0 {f(-0.34 * size)} 0' scale='{f(size)} {f(size)} {f(size)}'>{''.join(parts)}</Transform>"
def text(strings, size, color, justify=("MIDDLE", "MIDDLE"), style="PLAIN", family="SANS"):
    return text_geom(strings[0], size, color, bold=(style == "BOLD"), justify=justify[0])

# ---------------------------------------------------------------- layout
R_RING = 36.0
STATIONS = {}
for k in range(2, 10):
    th = math.radians(90 - (k - 2) * 45 - 22.5)      # family 2 front-right, climbing counter-clockwise seen from above
    y = 5.0 + (k - 2) * 4.6
    c = np.array([R_RING * math.cos(th), y, R_RING * math.sin(th)])
    STATIONS[k] = dict(center=c, out=norm([c[0], 0, c[2]]), theta=th)
STATIONS[1] = dict(center=np.array([0.0, 0.0, 0.0]), out=np.array([0, 0, 1.0]), theta=math.pi / 2)
STATIONS[10] = dict(center=np.array([0.0, 56.0, 0.0]), out=np.array([0, 0, 1.0]), theta=math.pi / 2)
FAM = {fm["n"]: fm for fm in DATA["families"]}

def bead_positions_helix(n, center, r=8.2, y0=0.9, y1=8.2, turns=1.15, phase=0.0):
    out = []
    for i in range(n):
        t = i / max(n - 1, 1)
        a = phase + 2 * math.pi * turns * t
        out.append(center + np.array([r * math.cos(a), y0 + (y1 - y0) * t, r * math.sin(a)]))
    return out

def thinker(defn, pos, label, num, color, label_color, size=0.5):
    w(f"<ProtoInstance DEF='{defn}' name='Thinker'>"
      f"<fieldValue name='translation' value='{fv(pos)}'/>"
      f"<fieldValue name='label'>{text_geom(f'{num}  {label}', size, label_color, dx=0.42)}</fieldValue>"
      f"<fieldValue name='tint' value='{fv(color)}'/>"
      f"<fieldValue name='glow' value='{fv(np.asarray(color) * 0.45)}'/>"
      "</ProtoInstance>")

BEADS = []   # for the page index: (def, family, branch, label, position)
VIEWS = []   # (def, description, family)

# ---------------------------------------------------------------- document head
w("<?xml version='1.0' encoding='UTF-8'?>")
w("<!DOCTYPE X3D PUBLIC 'ISO//Web3D//DTD X3D 4.0//EN' 'https://www.web3d.org/specifications/x3d-4.0.dtd'>")
w("<X3D profile='Interchange' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>")
w("<head>")
for name, lvl in [("EnvironmentalSensor", 1), ("EventUtilities", 1), ("Geometry3D", 4), ("Interpolation", 3), ("Navigation", 3),
                  ("ParticleSystems", 3), ("PointingDeviceSensor", 1), ("Scripting", 1), ("Shaders", 1), ("Shape", 5),
                  ("Texturing", 2), ("Lighting", 2), ("Grouping", 3)]:
    w(f"<component name='{name}' level='{lvl}'/>")
w("<meta name='title' content='A Landscape of Consciousness (X3D)'/>")
w("<meta name='description' content='Robert Lawrence Kuhn&apos;s Landscape of Consciousness taxonomy (figure by Alex Gomez-Marin) as a navigable X3D 4.0 world: 10 families, 13 sub-branches, 209 entries.'/>")
w("<meta name='source' content='https://github.com/hagopjay/gcloud.map/blob/main/consciousnesssLandscape-copy.webp'/>")
w("<meta name='generator' content='x3d.loom landscape gen.py, 2026-11-25'/>")
w("<meta name='license' content='Scene code: author&apos;s own. Taxonomy: R. L. Kuhn, Landscape of Consciousness (2024); figure by A. Gomez-Marin.'/>")
w("</head><Scene>")
w("<WorldInfo title='A Landscape of Consciousness' info='\"Taxonomy: Robert Lawrence Kuhn. Figure: Alex Gomez-Marin.\" \"X3D world generated from a transcription of the figure; 209 entries.\"'/>")
w("<NavigationInfo type='\"EXAMINE\" \"ANY\"' headlight='false' speed='8' transitionType='\"ANIMATE\"' transitionTime='2.2'/>")
w("<Background skyAngle='0.9 1.35 1.5708' skyColor='0.004 0.005 0.018 0.012 0.014 0.045 0.035 0.028 0.085 0.085 0.045 0.12' "
  "groundAngle='1.2 1.5708' groundColor='0.004 0.004 0.012 0.01 0.01 0.03 0.03 0.022 0.07'/>")

# --------------------------------------------------------------- PROTO: one entry of the landscape
w('<!--GLYPHLIB-->')
w("<ProtoDeclare name='Thinker' appinfo='One entry of the Landscape: a crystal bead and a billboard label that appears within 36 m.'>"
  "<ProtoInterface>"
  "<field accessType='inputOutput' name='translation' type='SFVec3f' value='0 0 0'/>"
  "<field accessType='initializeOnly' name='label' type='MFNode'/>"
  "<field accessType='inputOutput' name='tint' type='SFColor' value='1 1 1'/>"
  "<field accessType='inputOutput' name='glow' type='SFColor' value='0.3 0.3 0.3'/>"
  "<field accessType='inputOutput' name='scale' type='SFVec3f' value='1 1 1'/>"
  "<field accessType='outputOnly' name='touchTime' type='SFTime'/>"
  "</ProtoInterface><ProtoBody>"
  "<Transform><IS><connect nodeField='translation' protoField='translation'/></IS>"
  "<Transform><IS><connect nodeField='scale' protoField='scale'/></IS>"
  "<TouchSensor description='entry'><IS><connect nodeField='touchTime' protoField='touchTime'/></IS></TouchSensor>"
  "<Shape><Appearance><PhysicalMaterial metallic='0.55' roughness='0.22'><IS><connect nodeField='baseColor' protoField='tint'/>"
  "<connect nodeField='emissiveColor' protoField='glow'/></IS></PhysicalMaterial></Appearance>")
# the bead: a twisted hexagonal bipyramid crystal
gp = [(0, 0.42, 0), (0, -0.42, 0)]
for i in range(6):
    a = i * math.pi / 3 + (0.26 if i % 2 else 0)
    r = 0.24 if i % 2 else 0.2
    gp.append((r * math.cos(a), 0.06 if i % 2 else -0.06, r * math.sin(a)))
gf = []
for i in range(6):
    a, b = 2 + i, 2 + (i + 1) % 6
    gf += [(0, b, a), (1, a, b)]
w(ifs(gp, gf, crease=0.2))
w("</Shape></Transform>"
  "<LOD range='36'><Billboard axisOfRotation='0 0 0'><IS><connect nodeField='children' protoField='label'/></IS></Billboard><Group/></LOD>"
  "</Transform></ProtoBody></ProtoDeclare>")

# --------------------------------------------------------------- root group with style metadata (travels to glTF)
w("<Group DEF='Landscape'>")
w("<MetadataSet containerField='metadata' name='xst:Style' reference='https://hagopjay.github.io/x3d.loom/ns/style#'>")
w(f"<MetadataString name='xst:id' value='\"{STYLE['@id']}\"'/>")
w(f"<MetadataString name='xst:intent_key' value='\"{STYLE['intent']['key']}\"'/>")
for part in ["palette", "surface", "light", "air", "line", "form", "type", "motion", "encode", "view"]:
    for tok, v in STYLE[part].items():
        nm = f"xst:{part}_{tok}"
        if isinstance(v, list): w(f"<MetadataString name='{nm}' value='{mfs(*v)}'/>")
        elif isinstance(v, str): w(f"<MetadataString name='{nm}' value='{mfs(v)}'/>")
        else: w(f"<MetadataDouble name='{nm}' value='{f(v)}'/>")
w("</MetadataSet>")

# lights: a cool key, a warm rim, a whisper of ambient
w("<DirectionalLight direction='-0.45 -0.75 -0.5' color='0.82 0.86 1' intensity='0.75' ambientIntensity='0.12' global='true'/>")
w("<DirectionalLight direction='0.6 -0.2 0.75' color='1 0.75 0.85' intensity='0.35' global='true'/>")

# ---------------------------------------------------------------- the ground: a dark basin with rings
nx = 97; sp = 3.2; half = (nx - 1) * sp / 2
H = []; GC = []
for j in range(nx):
    for i in range(nx):
        x, z = -half + i * sp, -half + j * sp
        r = math.hypot(x, z)
        hills = min(16.0, max(0, r - 62) ** 1.25 * 0.07) * (0.75 + 0.25 * math.sin(math.atan2(z, x) * 7 + r * 0.04)) * (0.8 + 0.2 * math.cos(x * 0.03 - z * 0.02))
        h = -0.6 + 0.25 * math.sin(x * 0.11) * math.cos(z * 0.09) + hills + 0.4 * noise3((x * 0.05, 0, z * 0.05)) * min(1, r / 40)
        H.append(h)
        g = 0.5 + 0.5 * math.sin(r * 0.15)
        base = np.array([0.03, 0.035, 0.08]) * (0.7 + 0.5 * g) + np.array([0.04, 0.0, 0.05]) * max(0, min(1, hills / 6))
        GC.append(base)
w(f"<Transform translation='{f(-half)} 0 {f(-half)}'><Shape><Appearance>{mat('phys', base=(1, 1, 1), metallic=0.1, rough=0.9)}</Appearance>"
  f"<ElevationGrid xDimension='{nx}' zDimension='{nx}' xSpacing='{f(sp)}' zSpacing='{f(sp)}' creaseAngle='1.2' height='{' '.join(f(h) for h in H)}'>"
  f"<Color color='{fvs(GC)}'/></ElevationGrid></Shape></Transform>")
# concentric rings on the basin floor (style: line.grid = rings)
for r_ in (14, 24, R_RING, 48, 60):
    n = 160
    pts = [(r_ * math.cos(2 * math.pi * i / n), -0.25, r_ * math.sin(2 * math.pi * i / n)) for i in range(n)]
    c = (0.16, 0.13, 0.32) if r_ != R_RING else (0.42, 0.36, 0.2)
    w(f"<Shape><Appearance>{mat('unlit', emissive=c)}</Appearance><IndexedLineSet coordIndex='{' '.join(map(str, range(n)))} 0 -1'><Coordinate point='{fvs(pts)}'/></IndexedLineSet></Shape>")
# stars
rng = np.random.default_rng(7)
S = []; SC = []
for _ in range(2200):
    v = norm(rng.normal(size=3)); v[1] = abs(v[1]) * 0.95 + 0.05
    S.append(norm(v) * 700)
    t = rng.random(); b = 0.35 + 0.65 * rng.random() ** 2
    SC.append(np.array([0.75 + 0.25 * t, 0.8, 1.0 - 0.25 * t]) * b)
w(f"<Shape><Appearance>{mat('unlit', emissive=(1, 1, 1))}<PointProperties pointSizeScaleFactor='2' pointSizeMinValue='1' pointSizeMaxValue='3'/></Appearance>"
  f"<PointSet><Coordinate point='{fvs(S)}'/><Color color='{fvs(SC)}'/></PointSet></Shape>")

# ---------------------------------------------------------------- common station furniture
def lotus(k, center, n_petals, color):
    """A floating platform: a superformula lotus whose petal count is the number of entries, and a glowing rim."""
    pts = [center + (0, 0, 0)]; cols = [color * 0.25]
    N = 360
    for i in range(N):
        a = 2 * math.pi * i / N
        r = 8.8 * (0.82 + 0.18 * superformula(a, n_petals, 0.5, 0.5, 0.5) / superformula(0, n_petals, 0.5, 0.5, 0.5))
        pts.append(center + (r * math.cos(a), 0, r * math.sin(a))); cols.append(color * 0.08)
    faces = [(0, 1 + (i + 1) % N, 1 + i) for i in range(N)]
    w(shape(ifs(pts, faces, colors=cols, crease=0.1), mat("phys", base=(1, 1, 1), metallic=0.7, rough=0.3, transp=0.25)))
    rim = [pts[1 + i] + (0, 0.05, 0) for i in range(N)]
    w(f"<Shape><Appearance>{mat('unlit', emissive=color, DEF=f'Rim{k}')}</Appearance><IndexedLineSet coordIndex='{' '.join(map(str, range(N)))} 0 -1'><Coordinate point='{fvs(rim)}'/></IndexedLineSet></Shape>")

def station_title(k, pos, color, size=1.25):
    fm = FAM[k]
    w(f"<Transform translation='{fv(pos)}'><Billboard axisOfRotation='0 1 0'>{text([f'{k}  {fm['name'].upper()}'], size, lighten(color, 0.35), style='BOLD')}</Billboard></Transform>")

def station_light(center, color, intensity=1.6, radius=30):
    w(f"<PointLight location='{fv(center)}' color='{fv(lighten(color, 0.2))}' intensity='{f(intensity)}' radius='{f(radius)}' attenuation='1 0 0.004' global='true'/>")

def station_view(k, eye, target, desc):
    ax = look_rot(eye, target)
    w(f"<Viewpoint DEF='VP{k}' description='{esc(desc)}' position='{fv(eye)}' orientation='{fv(ax)}' centerOfRotation='{fv(target)}' fieldOfView='0.9'/>")
    VIEWS.append((f"VP{k}", desc, k))

def touch_to_view(k, group_def):
    # TouchSensor in the emblem group -> BooleanTrigger -> bind the station's Viewpoint
    w(f"<TouchSensor DEF='Touch{k}' description='Fly to {esc(FAM[k]['name'])}'/>")
    w(f"<BooleanTrigger DEF='Trig{k}'/>")
    route(f"Touch{k}", "touchTime", f"Trig{k}", "set_triggerTime"); route(f"Trig{k}", "triggerTrue", f"VP{k}", "set_bind")

def awaken(k, center, color):
    # walking into a station makes its rim flare white and settle back to its colour
    w(f"<ProximitySensor DEF='Near{k}' center='{fv(center)}' size='34 30 34'/>")
    w(f"<TimeSensor DEF='Wake{k}' cycleInterval='2.4'/>")
    w(f"<ColorInterpolator DEF='WakeC{k}' key='0 0.15 1' keyValue='{fv(color)}, 1 1 1, {fv(color)}'/>")
    route(f"Near{k}", "enterTime", f"Wake{k}", "set_startTime"); route(f"Wake{k}", "fraction_changed", f"WakeC{k}", "set_fraction")
    route(f"WakeC{k}", "value_changed", f"Rim{k}", "set_emissiveColor")

def family_meta(k, role="mass"):
    fm = FAM[k]
    return (f"<MetadataSet containerField='metadata' name='loc:Family'><MetadataInteger name='loc:n' value='{k}'/>"
            f"<MetadataString name='skos:prefLabel' value='{mfs(fm['name'])}'/><MetadataString name='xst:role' value='\"{role}\"'/>"
            f"<MetadataInteger name='loc:entries' value='{sum(len(b['items']) for b in fm['branches']) if 'branches' in fm else len(fm['items'])}'/></MetadataSet>")

def ring_beads(k, center, items, r=8.2, y0=0.9, y1=8.2, turns=1.15):
    color = COL[k - 1]
    phase = STATIONS[k]["theta"] + math.pi * 0.15
    for i, (name, pos) in enumerate(zip(items, bead_positions_helix(len(items), center, r, y0, y1, turns, phase))):
        d = f"T_{k}_{i + 1:02d}"
        thinker(d, pos, name, f"{i + 1:02d}", color, lighten(color, 0.55))
        BEADS.append(dict(id=d, fam=k, branch=None, label=name, n=i + 1, pos=[round(float(x), 3) for x in pos]))
    # the strand the beads hang on
    hel = bead_positions_helix(80, center, r, y0, y1, turns, phase)
    w(f"<Shape><Appearance>{mat('unlit', emissive=color * 0.55, transp=0.35)}</Appearance><IndexedLineSet coordIndex='{' '.join(map(str, range(80)))} -1'><Coordinate point='{fvs(hel)}'/></IndexedLineSet></Shape>")

# ================================================================ 1  MATERIALISM: the neural arbor
k = 1; C1 = COL[0]; c0 = STATIONS[1]["center"]
w(f"<Group DEF='Fam1'>{family_meta(1)}")
station_view(1, (0, 23, 27), (0, 10.5, 0), "1 Materialism: the neural arbor")
touch_to_view(1, "Fam1")
# trunk: fluted, twisting Extrusion
trunk_n = 24
spine = [(0.35 * math.sin(i * 0.4), 0.0 + 10.2 * i / (trunk_n - 1), 0.35 * math.cos(i * 0.33)) for i in range(trunk_n)]
cs = []
for j in range(41):
    a = 2 * math.pi * j / 40
    r = 1.0 + 0.22 * math.cos(8 * a)
    cs.append((r * math.cos(a), r * math.sin(a)))
scale = [(1.7 - 0.95 * (i / (trunk_n - 1)) ** 0.7,) * 2 for i in range(trunk_n)]
orient = [f"0 1 0 {f(i * 0.18)}" for i in range(trunk_n)]
w(f"<Shape><Appearance>{mat('phys', base=C1 * 0.6, emissive=C1 * 0.08, metallic=0.35, rough=0.45)}</Appearance>"
  f"<Extrusion spine='{fvs(spine)}' crossSection='{' '.join(fv(c) for c in cs)}' scale='{' '.join(fv(s) for s in scale)}' orientation='{', '.join(orient)}' creaseAngle='1.2' beginCap='false'/></Shape>")
# roots over the ground of matter
for i in range(16):
    a = 2 * math.pi * i / 16 + 0.2 * math.sin(i * 1.7)
    L = 7 + 4 * ((i * 7) % 5) / 4
    pts = bezier((0, 0.6, 0), (1.6 * math.cos(a), 0.0, 1.6 * math.sin(a)), (L * 0.6 * math.cos(a + 0.25), -0.5, L * 0.6 * math.sin(a + 0.25)), (L * math.cos(a + 0.4), -0.55, L * math.sin(a + 0.4)), 18)
    tp, tf = tube_mesh(pts, lambda s: 0.36 * (1 - s) + 0.04, sides=8, closed=False)
    w(shape(ifs(tp, tf, crease=1.2), mat("phys", base=C1 * 0.45, emissive=C1 * 0.05, metallic=0.3, rough=0.5)))
# soma: a bumpy, breathing cell body
V, F = icosphere(4)
som = c0 + np.array([0, 11.2, 0])
SP = [som + v * 2.5 * (1 + 0.12 * noise3(v * 2.2, 1.0)) for v in V]
SCc = [C1 * (0.55 + 0.45 * (0.5 + 0.5 * noise3(v * 3.1, 4.0))) for v in V]
w(f"<Transform DEF='Soma'>{shape(ifs(SP, F, colors=SCc, crease=1.0), mat('phys', base=(1, 1, 1), emissive=C1 * 0.2, metallic=0.2, rough=0.35, DEF='SomaMat'))}</Transform>")
station_light(som + (0, 2, 0), C1, 2.0, 34)
# ten limbs, one per sub-branch; the map's hanging columns become pendant strands
for bi, br in enumerate(FAM[1]["branches"]):
    a = math.radians(90 - bi * 36 - 18)
    dirv = np.array([math.cos(a), 0, math.sin(a)])
    tip = som + dirv * 12.6 + np.array([0, 7.0 + 1.6 * (bi % 2), 0])
    start = som + dirv * 2.2 + np.array([0, 0.8, 0])
    pts = bezier(start, start + dirv * 3 + (0, 3.6, 0), tip - dirv * 4 + (0, 2.6, 0), tip, 28)
    tp, tf = tube_mesh(pts, lambda s: 0.5 * (1 - s) + 0.12, sides=10, closed=False)
    w(shape(ifs(tp, tf, crease=1.2), mat("phys", base=C1 * 0.7, emissive=C1 * 0.12, metallic=0.35, rough=0.4)))
    # twigs and boutons
    for t_i, tt in enumerate((0.45, 0.7)):
        p = pts[int(tt * 27)]
        side = norm(np.cross(dirv, (0, 1, 0))) * (1 if t_i % 2 else -1)
        twig = bezier(p, p + side * 1.4 + (0, 0.6, 0), p + side * 2.4 + (0, 1.6, 0), p + side * 2.8 + (0, 2.6, 0), 12)
        tp2, tf2 = tube_mesh(twig, lambda s: 0.14 * (1 - s) + 0.04, sides=6, closed=False)
        w(shape(ifs(tp2, tf2, crease=1.2), mat("phys", base=C1 * 0.7, emissive=C1 * 0.1, metallic=0.3, rough=0.4)))
        w(f"<Transform translation='{fv(twig[-1])}'>{shape('<Sphere radius=\"0.22\"/>', mat('phys', base=lighten(C1, 0.3), emissive=C1 * 0.7))}</Transform>".replace('\\"', '"'))
    # action potential racing from soma to tip
    ap = f"AP{bi}"
    w(f"<Transform DEF='{ap}' translation='{fv(pts[0])}'>{shape('<Sphere radius=\"0.3\"/>', mat('unlit', emissive=lighten(C1, 0.6)))}</Transform>".replace('\\"', '"'))
    keys = np.linspace(0, 1, 15)
    kv = [pts[int(round(t * 27))] for t in keys[:-2]] + [tip, tip]
    keys = list(np.linspace(0, 0.55, 14)) + [1.0]
    w(f"<TimeSensor DEF='{ap}_clk' cycleInterval='{f(2.2 + 0.37 * bi)}' loop='true'/>")
    w(f"<PositionInterpolator DEF='{ap}_pi' key='{' '.join(f(x) for x in keys)}' keyValue='{fvs(kv)}'/>")
    route(f"{ap}_clk", "fraction_changed", f"{ap}_pi", "set_fraction"); route(f"{ap}_pi", "value_changed", ap, "set_translation")
    # sub-branch title at the tip
    w(f"<Transform translation='{fv(tip + (0, 1.3, 0))}'><Billboard axisOfRotation='0 1 0'>{text([f'1.{bi + 1}  {br['name']}'], 0.78, lighten(C1, 0.5), style='BOLD')}</Billboard></Transform>")
    # pendant strand
    n = len(br["items"])
    bottom = tip - (0, 0.9 * n + 0.4, 0)
    w(f"<Shape><Appearance>{mat('unlit', emissive=C1 * 0.6)}</Appearance><IndexedLineSet coordIndex='0 1 -1'><Coordinate point='{fv(tip)} {fv(bottom)}'/></IndexedLineSet></Shape>")
    for j, name in enumerate(br["items"]):
        pos = tip - (0, 0.9 * (j + 1), 0)
        d = f"T_1_{bi + 1:02d}_{j + 1:02d}"
        thinker(d, pos, name, f"{j + 1:02d}", C1, lighten(C1, 0.6), size=0.42)
        BEADS.append(dict(id=d, fam=1, branch=bi + 1, label=name, n=j + 1, pos=[round(float(x), 3) for x in pos]))
w("</Group>")
pulse_color("SomaMat", "set_emissiveColor", C1 * 0.15, C1 * 0.7, 3.2)
station_title(1, (0, 26.5, 0), C1, 2.2)
awaken(1, (0, 10, 0), C1)
w(f"<Shape><Appearance>{mat('unlit', emissive=C1, DEF='Rim1')}</Appearance><IndexedLineSet coordIndex='{' '.join(map(str, range(120)))} 0 -1'><Coordinate point='{fvs([(16 * math.cos(2 * math.pi * i / 120), -0.2, 16 * math.sin(2 * math.pi * i / 120)) for i in range(120)])}'/></IndexedLineSet></Shape>")

# ================================================================ helpers for stations 2..9
def station_open(k, view_dist=21, view_up=15):
    st = STATIONS[k]; c = st["center"]; col = COL[k - 1]
    w(f"<Group DEF='Fam{k}'>{family_meta(k)}")
    eye = c + st["out"] * view_dist + (0, view_up, 0)
    station_view(k, eye, c + (0, 4.5, 0), f"{k} {FAM[k]['name']}")
    touch_to_view(k, f"Fam{k}")
    lotus(k, c, len(FAM[k]["items"]), col)
    station_light(c + (0, 6, 0) + st["out"] * 4, col)
    return c, col

def station_close(k, title_h=11.5):
    c = STATIONS[k]["center"]; col = COL[k - 1]
    ring_beads(k, c, FAM[k]["items"])
    w("</Group>")
    station_title(k, c + (0, title_h, 0), col)
    awaken(k, c + (0, 4, 0), col)

# ================================================================ 2  NON-REDUCTIVE PHYSICALISM: levels that supervene
k = 2; c, col = station_open(k)
for lvl in range(5):
    R0 = 4.4 - lvl * 0.62; y = 1.2 + lvl * 1.45; m = 3 + lvl
    nu, nv = 120, 18; P = []; CC = []
    for i in range(nu):
        u = 2 * math.pi * i / nu
        for j in range(nv):
            v = 2 * math.pi * j / nv
            rr = 0.38 * superformula(v + u * (lvl + 1), m, 1.8, 1.4, 1.4) / 1.2
            P.append((( R0 + rr * math.cos(v)) * math.cos(u), rr * math.sin(v), (R0 + rr * math.cos(v)) * math.sin(u)))
            CC.append(lighten(col, 0.1 + 0.12 * lvl) * (0.65 + 0.35 * math.cos(v)))
    w(f"<Transform translation='{fv(c + (0, y, 0))}'><Transform DEF='Lvl{lvl}'>"
      + shape(ifs(P, grid_faces(nu, nv, True, True), colors=CC, crease=1.0), mat("phys", base=(1, 1, 1), emissive=col * 0.12, metallic=0.6, rough=0.3))
      + "</Transform></Transform>")
    spin(f"Lvl{lvl}", 24 + 12 * lvl, reverse=bool(lvl % 2))
for s in range(6):   # supervenience struts
    a = 2 * math.pi * s / 6
    pts = [c + ((4.4 - l * 0.62) * math.cos(a), 1.2 + l * 1.45, (4.4 - l * 0.62) * math.sin(a)) for l in range(5)]
    w(f"<Shape><Appearance>{mat('unlit', emissive=lighten(col, 0.3))}</Appearance><IndexedLineSet coordIndex='0 1 2 3 4 -1'><Coordinate point='{fvs(pts)}'/></IndexedLineSet></Shape>")
station_close(k)

# ================================================================ 3  QUANTUM: interference field, microtubule, orbital
k = 3; c, col = station_open(k)
ng, gs = 49, 0.3; gw = (ng - 1) * gs
src1, src2 = (gw / 2 - 2.0, gw / 2), (gw / 2 + 2.0, gw / 2)
EH = []
for j in range(ng):
    for i in range(ng):
        x, z = i * gs, j * gs
        r1, r2 = math.hypot(x - src1[0], z - src1[1]), math.hypot(x - src2[0], z - src2[1])
        fall = max(0, 1 - math.hypot(x - gw / 2, z - gw / 2) / (gw / 2))
        EH.append(0.45 * fall * (math.cos(3.2 * r1) + math.cos(3.2 * r2)) / 2)
qv = ("precision highp float; uniform mat4 x3d_ModelViewMatrix; uniform mat4 x3d_ProjectionMatrix; attribute vec4 x3d_Vertex; uniform float u_phase; varying float v_h; varying float v_f;"
      f"void main(){{ vec3 p = x3d_Vertex.xyz; float t = u_phase * 600.0; float r1 = distance(p.xz, vec2({src1[0]:.3f},{src1[1]:.3f})); float r2 = distance(p.xz, vec2({src2[0]:.3f},{src2[1]:.3f}));"
      f"float fall = max(0.0, 1.0 - distance(p.xz, vec2({gw / 2:.3f})) / {gw / 2:.3f}); float h = 0.45 * fall * (cos(3.2 * r1 - 2.0 * t) + cos(3.2 * r2 - 2.0 * t)) * 0.5;"
      "v_h = h; v_f = fall; gl_Position = x3d_ProjectionMatrix * x3d_ModelViewMatrix * vec4(p.x, h, p.z, 1.0); }")
qf = ("precision highp float; varying float v_h; varying float v_f;"
      f"void main(){{ float k = clamp(v_h / 0.45 * 0.5 + 0.5, 0.0, 1.0); vec3 lo = vec3(0.12, 0.07, 0.02); vec3 hi = vec3({col[0]:.3f}, {col[1]:.3f}, {col[2]:.3f});"
      "vec3 c = mix(lo, hi, smoothstep(0.15, 0.95, k)) + vec3(1.0) * pow(k, 12.0) * 0.6; gl_FragColor = vec4(c * (0.25 + 0.75 * v_f), 0.88 * v_f + 0.12); }")
w(f"<Transform translation='{fv(c + (-gw / 2, 0.6, -gw / 2))}'><Shape><Appearance>{mat('unlit', emissive=(1, 0, 1), transp=0.1)}"
  f"<ComposedShader DEF='WaveShader' language='GLSL'><field accessType='inputOutput' name='u_phase' type='SFFloat' value='0'/>"
  f"<ShaderPart type='VERTEX' url='\"data:x-shader/x-vertex,{esc(qv)}\"'/><ShaderPart type='FRAGMENT' url='\"data:x-shader/x-fragment,{esc(qf)}\"'/></ComposedShader>"
  f"</Appearance><ElevationGrid xDimension='{ng}' zDimension='{ng}' xSpacing='{gs}' zSpacing='{gs}' solid='false' creaseAngle='3.14' height='{' '.join(f(h) for h in EH)}'/></Shape></Transform>")
w("<TimeSensor DEF='WaveClock' cycleInterval='600' loop='true'/>")
route("WaveClock", "fraction_changed", "WaveShader", "u_phase")
# microtubule: 13 protofilaments, 3-start helical lattice, alpha/beta tubulin
SV, SF = icosphere(1)
MP, MF, MC = [], [], []
rows, rad, rise = 24, 1.05, 0.36
for row in range(rows):
    for pf in range(13):
        a = 2 * math.pi * pf / 13
        y = row * rise + pf * 3 * rise / 13
        ctr = np.array([rad * math.cos(a), y, rad * math.sin(a)])
        base = len(MP)
        tint = lighten(col, 0.65) if row % 2 else col * 0.95
        for v in SV:
            MP.append(ctr + v * np.array([0.2, 0.19, 0.2])); MC.append(tint * (0.85 + 0.15 * v[1]))
        MF += [(base + x, base + y_, base + z_) for x, y_, z_ in SF]
w(f"<Transform translation='{fv(c + (0, 0.9, 0))}'><Transform DEF='Tubule'>{shape(ifs(MP, MF, colors=MC, crease=1.2), mat('phys', base=(1, 1, 1), emissive=col * 0.15, metallic=0.4, rough=0.3))}</Transform></Transform>")
spin("Tubule", 40)
# orbital: real spherical harmonic l=3, m=2, lobes coloured by sign
nu, nv = 64, 40; OP, OC = [], []
for i in range(nu):
    ph = 2 * math.pi * i / nu
    for j in range(nv):
        th = math.pi * j / (nv - 1)
        y = math.cos(th) * math.sin(th) ** 2 * math.cos(2 * ph)
        r = 2.6 * abs(y) / 0.385
        OP.append((r * math.sin(th) * math.cos(ph), r * math.cos(th), r * math.sin(th) * math.sin(ph)))
        OC.append(lighten(col, 0.15) if y >= 0 else np.array([0.55, 0.85, 1.0]))
w(f"<Transform translation='{fv(c + (0, 11.4, 0))}'><Transform DEF='Orbital'>{shape(ifs(OP, grid_faces(nu, nv, True, False), colors=OC, crease=1.2, solid=False), mat('phys', base=(1, 1, 1), emissive=col * 0.25, metallic=0.2, rough=0.25, transp=0.15))}</Transform></Transform>")
spin("Orbital", 18, axis=(0.2, 1, 0.1))
station_close(k, title_h=13.6)

# ================================================================ 4  IIT: a rotating tesseract driven by a Script (true 4D rotation)
k = 4; c, col = station_open(k)
verts4 = [[(1 if i & b else -1) for b in (1, 2, 4, 8)] for i in range(16)]
def proj4(v, a=0.0, b=0.0, s=1.9):
    x, y, z, ww = v
    x, ww = x * math.cos(a) - ww * math.sin(a), x * math.sin(a) + ww * math.cos(a)
    y, z = y * math.cos(b) - z * math.sin(b), y * math.sin(b) + z * math.cos(b)
    q = 3.0 / (3.0 - ww)
    return (x * q * s, y * q * s, z * q * s)
edges = [(i, j) for i in range(16) for j in range(i + 1, 16) if bin(i ^ j).count("1") == 1]
edge_dim = [int(math.log2(i ^ j)) for i, j in edges]
dimcol = [lighten(col, 0.1), lighten(col, 0.5), np.array([1.0, 0.9, 0.45]), np.array([0.6, 1.0, 0.8])]
w(f"<Transform translation='{fv(c + (0, 5.2, 0))}'>")
w(f"<Shape><Appearance>{mat('unlit', emissive=(1, 1, 1))}<LineProperties linewidthScaleFactor='3'/></Appearance>"
  f"<IndexedLineSet colorPerVertex='false' coordIndex='{' '.join(f'{i} {j} -1' for i, j in edges)}' colorIndex='{' '.join(str(d) for d in edge_dim)}'>"
  f"<Coordinate DEF='TessCoord' point='{fvs([proj4(v) for v in verts4])}'/><Color color='{fvs(dimcol)}'/></IndexedLineSet></Shape>")
w(f"<Shape><Appearance>{mat('unlit', emissive=lighten(col, 0.7))}<PointProperties pointSizeScaleFactor='9' pointSizeMinValue='4' pointSizeMaxValue='18'/></Appearance>"
  f"<PointSet><Coordinate USE='TessCoord'/></PointSet></Shape>")
# phi core: an integrated, glowing kernel
V2, F2 = icosphere(2)
w(f"<Transform DEF='PhiCore'>{shape(ifs([v * 1.05 for v in V2], F2, crease=0.0), mat('phys', base=lighten(col, 0.4), emissive=col * 0.6, metallic=0.1, rough=0.1, transp=0.3, DEF='PhiMat'))}</Transform>")
w("</Transform>")
pulse_color("PhiMat", "set_emissiveColor", col * 0.25, lighten(col, 0.5), 2.6)
spin("PhiCore", 16, axis=(1, 1, 0))
w("<TimeSensor DEF='TessClock' cycleInterval='30' loop='true'/>")
w("<Script DEF='Tesseract' directOutput='false' mustEvaluate='false'>"
  "<field accessType='inputOnly' name='set_fraction' type='SFFloat'/>"
  "<field accessType='outputOnly' name='points' type='MFVec3f'/>"
  "<![CDATA[ecmascript:\n"
  "var V = [];\n"
  "function initialize () { for (var i = 0; i < 16; i++) V.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]); }\n"
  "function set_fraction (f, t) {\n"
  "  var a = f * 2 * Math.PI, b = f * 4 * Math.PI, c = f * 2 * Math.PI, out = new MFVec3f();\n"
  "  for (var i = 0; i < 16; i++) {\n"
  "    var x = V[i][0], y = V[i][1], z = V[i][2], w = V[i][3];\n"
  "    var x1 = x * Math.cos(a) - w * Math.sin(a), w1 = x * Math.sin(a) + w * Math.cos(a);\n"
  "    var y1 = y * Math.cos(b) - z * Math.sin(b), z1 = y * Math.sin(b) + z * Math.cos(b);\n"
  "    var z2 = z1 * Math.cos(c) - w1 * Math.sin(c), w2 = z1 * Math.sin(c) + w1 * Math.cos(c);\n"
  "    var q = 3.0 / (3.0 - w2) * 1.9;\n"
  "    out [i] = new SFVec3f(x1 * q, y1 * q, z2 * q);\n"
  "  }\n"
  "  points = out;\n"
  "}\n]]></Script>")
route("TessClock", "fraction_changed", "Tesseract", "set_fraction"); route("Tesseract", "points", "TessCoord", "set_point")
station_close(k)

# ================================================================ 5  PANPSYCHISMS: phyllotaxis seed and a field of proto-minds
k = 5; c, col = station_open(k)
N = 377; GP, GF, GC2 = [], [], []
ga = math.pi * (3 - 5 ** 0.5)
for i in range(N):
    y = 1 - 2 * (i + 0.5) / N; r = math.sqrt(1 - y * y); a = i * ga
    n_ = np.array([r * math.cos(a), y, r * math.sin(a)])
    t1 = norm(np.cross(n_, [0, 1, 0.01])); t2 = np.cross(n_, t1)
    base = len(GP); R0 = 3.0; s = 0.2
    tip = n_ * (R0 + 0.55)
    quad = [n_ * R0 + (t1 * s + t2 * s), n_ * R0 + (-t1 * s + t2 * s), n_ * R0 + (-t1 * s - t2 * s), n_ * R0 + (t1 * s - t2 * s)]
    GP += quad + [tip]
    tint = lighten(col, 0.15) * (1 - (y + 1) / 2) + np.array([0.95, 0.85, 0.35]) * ((y + 1) / 2)
    GC2 += [tint * 0.7] * 4 + [lighten(tint, 0.5)]
    GF += [(base, base + 1, base + 4), (base + 1, base + 2, base + 4), (base + 2, base + 3, base + 4), (base + 3, base, base + 4)]
w(f"<Transform translation='{fv(c + (0, 4.8, 0))}'><Transform DEF='Seed'>{shape(ifs(GP, GF, colors=GC2, crease=0.3), mat('phys', base=(1, 1, 1), emissive=col * 0.2, metallic=0.5, rough=0.3))}"
  f"{shape('<Sphere radius=\"2.9\"/>', mat('phys', base=col * 0.4, emissive=col * 0.35, metallic=0.1, rough=0.6, DEF='SeedCore'))}</Transform>".replace('\\"', '"'))
# soft round sprite texture
dot = []
for yy in range(16):
    for xx in range(16):
        d = math.hypot(xx - 7.5, yy - 7.5) / 7.5
        a_ = int(255 * max(0, 1 - d) ** 1.6)
        dot.append(f"0xFFFFFF{a_:02X}")
w("<ParticleSystem geometryType='SPRITE' maxParticles='900' particleLifetime='7' lifetimeVariation='0.35' particleSize='0.32 0.32' colorKey='0 0.25 0.7 1'>"
  "<Appearance><UnlitMaterial emissiveColor='1 1 1'/>"
  f"<PixelTexture image='16 16 4 {' '.join(dot)}'/></Appearance>"
  f"<ColorRGBA containerField='color' color='{fv(col)} 0 {fv(lighten(col, 0.4))} 1 1 0.92 0.5 0.8 {fv(col)} 0'/>"
  "<PointEmitter direction='0 0 0' speed='0.55' variation='0.6' mass='0.01' surfaceArea='0.01'/>"
  "</ParticleSystem></Transform>")
spin("Seed", 60)
pulse_color("SeedCore", "set_emissiveColor", col * 0.2, lighten(col, 0.25), 5.0)
station_close(k)

# ================================================================ 6  MONISMS: a one-sided band along a trefoil knot
k = 6; c, col = station_open(k)
nc = 360
curve = [np.array([math.sin(t) + 2 * math.sin(2 * t), math.cos(t) - 2 * math.cos(2 * t), -math.sin(3 * t)]) * 1.45 for t in np.linspace(0, 2 * math.pi, nc, endpoint=False)]
T = [norm(curve[(i + 1) % nc] - curve[i - 1]) for i in range(nc)]
Nf = [norm(np.cross(T[0], [0, 0, 1]))]
for i in range(1, nc):
    b = np.cross(T[i - 1], T[i]); nb = np.linalg.norm(b)
    if nb < 1e-9: Nf.append(Nf[-1]); continue
    b /= nb; ang = math.acos(max(-1, min(1, float(np.dot(T[i - 1], T[i])))))
    v = Nf[-1]; v = v * math.cos(ang) + np.cross(b, v) * math.sin(ang) + b * np.dot(b, v) * (1 - math.cos(ang))
    Nf.append(norm(v))
# holonomy: transport once more to close and measure the angle error
b = np.cross(T[-1], T[0]); b /= np.linalg.norm(b); ang = math.acos(max(-1, min(1, float(np.dot(T[-1], T[0])))))
v = Nf[-1]; Nend = v * math.cos(ang) + np.cross(b, v) * math.sin(ang) + b * np.dot(b, v) * (1 - math.cos(ang))
err = math.atan2(float(np.dot(np.cross(Nf[0], Nend), T[0])), float(np.dot(Nf[0], Nend)))
total = 3 * math.pi - err                      # three half-twists: one surface, one edge
nvb = 9; BP, BC = [], []
for i in range(nc):
    th = total * i / nc
    B = np.cross(T[i], Nf[i]); dvec = math.cos(th) * Nf[i] + math.sin(th) * B
    for j in range(nvb):
        sv = -1 + 2 * j / (nvb - 1)
        BP.append(curve[i] + dvec * 0.85 * sv)
        hue = 0.5 + 0.5 * math.cos(2 * math.pi * i / nc * 1.5 + sv * 0.0)
        BC.append(col * (1 - hue) + np.array([0.92, 0.97, 1.0]) * hue)
w(f"<Transform translation='{fv(c + (0, 5.4, 0))}'><Transform DEF='Band'>{shape(ifs(BP, grid_faces(nc, nvb, True, False, flip_seam=True), colors=BC, crease=1.3, solid=False), mat('phys', base=(1, 1, 1), emissive=col * 0.18, metallic=0.55, rough=0.25))}"
  f"{shape('<Sphere radius=\"0.9\"/>', mat('phys', base=(0.9, 0.95, 1), emissive=(0.5, 0.6, 0.7), metallic=0, rough=0.05, transp=0.4))}</Transform></Transform>".replace('\\"', '"'))
spin("Band", 45, axis=(0.15, 1, 0.1))
station_close(k)

# ================================================================ 7  DUALISMS: a body of stone, a soul of light, one beam between
k = 7; c, col = station_open(k)
V3, F3 = icosphere(2)
RP = [v * 2.0 * (1 + 0.18 * noise3(v * 1.7, 9.0)) for v in V3]
w(f"<Transform translation='{fv(c + (0, 2.4, 0))}'><Transform DEF='Body'>{shape(ifs(RP, F3, crease=0.0), mat('phys', base=lighten(col, 0.15), emissive=col * 0.22, metallic=0.45, rough=0.3))}</Transform></Transform>")
spin("Body", 50)
kn = [np.array([(2.1 + 0.7 * math.cos(5 * t)) * math.cos(2 * t), 0.7 * math.sin(5 * t), (2.1 + 0.7 * math.cos(5 * t)) * math.sin(2 * t)]) for t in np.linspace(0, 2 * math.pi, 400, endpoint=False)]
kp, kf = tube_mesh(kn, 0.2, sides=10, closed=True)
w(f"<Transform translation='{fv(c + (0, 9.0, 0))}'><Transform DEF='Soul'>{shape(ifs(kp, kf, crease=1.2), mat('phys', base=lighten(col, 0.6), emissive=lighten(col, 0.25), metallic=0.0, rough=0.1, transp=0.3, DEF='SoulMat'))}</Transform></Transform>")
spin("Soul", 30, axis=(0, 1, 0), reverse=True)
w(f"<Transform translation='{fv(c + (0, 5.7, 0))}'>{shape('<Cylinder radius=\"0.06\" height=\"4.6\"/>', mat('unlit', emissive=(1, 1, 1), DEF='Pineal'))}</Transform>".replace('\\"', '"'))
pulse_color("Pineal", "set_emissiveColor", lighten(col, 0.2), (1, 1, 1), 1.8)
station_close(k, title_h=12.8)

# ================================================================ 8  IDEALISMS: the world inside mind, Indra's net outside
k = 8; c, col = station_open(k)
V4, F4 = icosphere(3)
PP, PC = [], []
for v in V4:
    nval = noise3(v * 2.4, 3.3)
    PP.append(v * 1.35 * (1 + (0.05 if nval > 0.2 else 0)))
    PC.append(np.array([0.8, 0.72, 1.0]) if nval > 0.2 else col * 0.6)
w(f"<Transform translation='{fv(c + (0, 5.2, 0))}'>")
w(f"<Transform DEF='Planet'>{shape(ifs(PP, F4, colors=PC, crease=0.7), mat('phys', base=(1, 1, 1), emissive=col * 0.1, metallic=0.1, rough=0.6))}"
  f"<Transform translation='2.5 0.4 0'>{shape('<Sphere radius=\"0.32\"/>', mat('phys', base=(0.85, 0.85, 0.95), emissive=(0.2, 0.2, 0.3)))}</Transform></Transform>".replace('\\"', '"'))
spin("Planet", 20)
w(shape('<Sphere radius="4.1" solid="false"/>', mat("phys", base=lighten(col, 0.3), emissive=col * 0.12, metallic=0.0, rough=0.05, transp=0.78)))
# Indra's net: a frequency-2 geodesic of jewels, each linked to its neighbours
V5, F5 = icosphere(1)
J = [v * 5.6 for v in V5]
E = sorted({(min(a, b), max(a, b)) for t in F5 for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0]))})
w("<Transform DEF='Net'>")
w(f"<Shape><Appearance>{mat('unlit', emissive=lighten(col, 0.35), transp=0.3)}</Appearance><IndexedLineSet coordIndex='{' '.join(f'{a} {b} -1' for a, b in E)}'><Coordinate point='{fvs(J)}'/></IndexedLineSet></Shape>")
for i, p in enumerate(J):
    inner = shape('<Sphere radius="0.2"/>', mat('phys', base=(1, 1, 1), emissive=lighten(col, 0.45), metallic=1.0, rough=0.05), DEF="Jewel") if i == 0 else "<Shape USE='Jewel'/>"
    w(f"<Transform translation='{fv(p)}'>{inner}</Transform>")
w("</Transform></Transform>")
spin("Net", 90, reverse=True)
station_close(k)

# ================================================================ 9  ANOMALOUS & ALTERED STATES: a supershape bloom and a tunnel of light
k = 9; c, col = station_open(k)
nu, nv = 96, 64; SSP = []
for i in range(nu):
    th = -math.pi + 2 * math.pi * i / nu
    r1 = superformula(th, 7, 0.2, 1.7, 1.7)
    for j in range(nv):
        ph = -math.pi / 2 + math.pi * j / (nv - 1)
        r2 = superformula(ph, 7, 0.2, 1.7, 1.7)
        SSP.append((r1 * math.cos(th) * r2 * math.cos(ph), r2 * math.sin(ph), r1 * math.sin(th) * r2 * math.cos(ph)))
SSP = np.array(SSP); SSP = SSP / np.abs(SSP).max() * 3.0
sv = ("precision highp float; uniform mat4 x3d_ModelViewMatrix; uniform mat4 x3d_ProjectionMatrix; uniform mat3 x3d_NormalMatrix;"
      "attribute vec4 x3d_Vertex; attribute vec3 x3d_Normal; varying vec3 v_n; varying vec3 v_p; varying vec3 v_o;"
      "void main(){ vec4 p = x3d_ModelViewMatrix * x3d_Vertex; v_p = p.xyz; v_n = normalize(x3d_NormalMatrix * x3d_Normal); v_o = x3d_Vertex.xyz; gl_Position = x3d_ProjectionMatrix * p; }")
sf = ("precision highp float; uniform float u_phase; varying vec3 v_n; varying vec3 v_p; varying vec3 v_o;"
      "vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }"
      "void main(){ float t = u_phase * 600.0; vec3 n = normalize(v_n); vec3 e = normalize(-v_p); float fr = pow(1.0 - abs(dot(n, e)), 2.2);"
      "float r = length(v_o); float h = 0.86 + 0.12 * sin(r * 3.0 - t * 0.7) + 0.08 * sin(atan(v_o.z, v_o.x) * 7.0 + t * 0.4) + 0.25 * fr;"
      "vec3 c = hsv(fract(h), 0.85 - 0.5 * fr, 0.55 + 0.45 * fr) + vec3(1.0, 0.9, 1.0) * pow(fr, 3.0) * 0.8;"
      "gl_FragColor = vec4(c, 0.95); }")
w(f"<Transform translation='{fv(c + (0, 5.2, 0))}'><Transform DEF='Bloom'><Shape><Appearance>{mat('phys', base=col, emissive=col * 0.4, transp=0.05)}"
  f"<ComposedShader DEF='BloomShader' language='GLSL'><field accessType='inputOutput' name='u_phase' type='SFFloat' value='0'/>"
  f"<ShaderPart type='VERTEX' url='\"data:x-shader/x-vertex,{esc(sv)}\"'/><ShaderPart type='FRAGMENT' url='\"data:x-shader/x-fragment,{esc(sf)}\"'/></ComposedShader></Appearance>"
  f"{ifs(SSP, grid_faces(nu, nv, True, False), crease=1.4, solid=False)}</Shape></Transform></Transform>")
route("WaveClock", "fraction_changed", "BloomShader", "u_phase")
spin("Bloom", 36, axis=(0.1, 1, 0.2))
# the tunnel: a flaring spiral Extrusion toward a light
out = STATIONS[k]["out"]; side = norm(np.cross(out, (0, 1, 0)))
tsp = []
for i in range(48):
    t = i / 47
    a = t * 2.4 * math.pi
    tsp.append(c + (0, 2.0, 0) - out * 1.0 + side * (4.6 + 0.8 * math.cos(a)) + np.array([0, 0.9 * math.sin(a) + 9.0 * t, 0]) - out * (6.0 * t))
cs = [(math.cos(2 * math.pi * j / 24), math.sin(2 * math.pi * j / 24)) for j in range(25)]
grad = []
for yy in range(16):
    t = yy / 15
    cc = col * (1 - t) ** 1.5 + np.array([1, 1, 1]) * t ** 2
    grad.append("0x%02X%02X%02X" % tuple(int(255 * min(1, x)) for x in cc))
w(f"<Shape><Appearance>{mat('unlit', emissive=(1, 1, 1), transp=0.25)}<PixelTexture image='1 16 3 {' '.join(grad)}'/></Appearance>"
  f"<Extrusion spine='{fvs(tsp)}' crossSection='{' '.join(fv(x) for x in cs)}' scale='{' '.join(fv((0.35 + 1.6 * (i / 47) ** 1.6,) * 2) for i in range(48))}' solid='false' beginCap='false' endCap='false' creaseAngle='1.5'/></Shape>")
w(f"<Transform translation='{fv(tsp[-1])}'>{shape('<Sphere radius=\"1.3\"/>', mat('unlit', emissive=(1, 1, 1)))}</Transform>".replace('\\"', '"'))
w(f"<PointLight location='{fv(tsp[-1])}' color='1 0.95 1' intensity='1.2' radius='14' global='true'/>")
station_close(k, title_h=13.0)

# ================================================================ 10  CHALLENGE: an impossible tribar against the void
k = 10; C10 = COL[9]; c10 = STATIONS[10]["center"]
v_view = norm((0, 0.32, 1))                     # the one standpoint from which it closes
L, h = 7.0, 0.7
def box_faces(lo, hi):
    x0, y0, z0 = lo; x1, y1, z1 = hi
    P = [np.array(p, float) for p in [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]]
    idx = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (0, 4, 7, 3), (1, 2, 6, 5)]
    return [[P[i] for i in f_] for f_ in idx]
def clip(faces, n, off):
    """Keep n.p >= off of a convex polyhedron given as outward faces; cap the cut."""
    n = np.asarray(n, float); out = []; cut = []
    for poly in faces:
        res = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            da, db = np.dot(n, a) - off, np.dot(n, b) - off
            if da >= -1e-9: res.append(a)
            if (da >= -1e-9) != (db >= -1e-9):
                p = a + (b - a) * (da / (da - db)); res.append(p); cut.append(p)
        if len(res) >= 3: out.append(res)
    if len(cut) >= 3:
        ctr = np.mean(cut, axis=0); u = norm(cut[0] - ctr); v = np.cross(-n, u)
        cut = sorted(cut, key=lambda p: math.atan2(np.dot(p - ctr, v), np.dot(p - ctr, u)))
        uniq = []
        for p in cut:
            if not uniq or np.linalg.norm(p - uniq[-1]) > 1e-7: uniq.append(p)
        out.append(uniq)
    return out
pieces = [box_faces((-h, -h, -h), (h, h, h)),                       # corner at P0
          box_faces((h, -h, -h), (L - h, h, h)),                     # x bar
          box_faces((L - h, -h, -h), (L + h, h, h)),                 # corner at P1
          box_faces((L - h, h, -h), (L + h, L - h, h)),              # y bar
          box_faces((L - h, L - h, -h), (L + h, L + h, h))]          # corner at P2
zbar = box_faces((L - h, L - h, h), (L + h, L + h, L + h))           # z bar, rising toward P3 = P0 + L(1,1,1)
s2 = 1 / math.sqrt(2)
pieces.append(clip(zbar, (s2, 0, -s2), 2 * h * s2))                  # outside the hexagon edge on y
pieces.append(clip(clip(zbar, (0, s2, -s2), 2 * h * s2), (-s2, 0, s2), -2 * h * s2))   # outside the other edge, not double counted
TP, TF, TC = [], [], []
shade = {0: np.array([0.86, 0.88, 0.94]), 1: np.array([0.52, 0.56, 0.66]), 2: np.array([0.2, 0.22, 0.3])}
for faces in pieces:
    for poly in faces:
        if len(poly) < 3: continue
        nrm = norm(np.cross(poly[1] - poly[0], poly[2] - poly[0]))
        base = len(TP); TP += poly; TF.append(tuple(range(base, base + len(poly))))
        TC.append(shade[int(np.argmax(np.abs(nrm)))])
d_local = norm((1, 1, 1))
pts3 = [np.array((0, 0, 0)), np.array((L, 0, 0)), np.array((L, L, 0))]
cen = np.mean(pts3, axis=0)
def perp(vv, axis): vv = vv - axis * np.dot(vv, axis); return norm(vv)
a_l = perp(pts3[2] - cen, d_local); b_l = np.cross(d_local, a_l)
a_w = perp(np.array([0, 1.0, 0]), v_view); b_w = np.cross(v_view, a_w)
Rm = np.column_stack([v_view, a_w, b_w]) @ np.column_stack([d_local, a_l, b_l]).T
mid3 = (np.array((0, 0, 0)) + np.array((L, L, L))) / 2 * 0 + cen        # rotate about the projected centroid
tri_pos = c10 - Rm @ mid3
w(f"<Group DEF='Fam10'>{family_meta(10)}")
eyeO = c10 + v_view * 24
w(f"<OrthoViewpoint DEF='VP10' description='10 Challenge: the one standpoint where it closes' position='{fv(eyeO)}' orientation='{fv(look_rot(eyeO, c10))}' centerOfRotation='{fv(c10)}' fieldOfView='-9.5 -9.5 9.5 9.5'/>")
VIEWS.append(("VP10", "10 Challenge: the one standpoint where it closes", 10))
eyeP = c10 + norm((0.9, 0.25, 0.6)) * 34
w(f"<Viewpoint DEF='VP10b' description='10 Challenge: from anywhere else' position='{fv(eyeP)}' orientation='{fv(look_rot(eyeP, c10))}' centerOfRotation='{fv(c10)}' fieldOfView='0.9'/>")
VIEWS.append(("VP10b", "10 Challenge: from anywhere else", 10))
touch_to_view(10, "Fam10")
w(f"<Transform DEF='Tribar' translation='{fv(tri_pos)}' rotation='{fv(axis_angle(Rm))}'>"
  + shape(ifs(TP, TF, crease=0.0, face_colors=TC), mat("unlit", emissive=(1, 1, 1))) + "</Transform>")
void = c10 - v_view * 16
w(f"<Transform translation='{fv(void)}'>{shape('<Sphere radius=\"8.5\"/>', mat('unlit', emissive=(0.0, 0.0, 0.004)))}</Transform>".replace('\\"', '"'))
ring = [void + (9.4 * math.cos(2 * math.pi * i / 200)) * b_w + (9.4 * math.sin(2 * math.pi * i / 200)) * a_w for i in range(200)]
w(f"<Shape><Appearance>{mat('unlit', emissive=lighten(C10, 0.5), DEF='Rim10')}<LineProperties linewidthScaleFactor='2'/></Appearance><IndexedLineSet coordIndex='{' '.join(map(str, range(200)))} 0 -1'><Coordinate point='{fvs(ring)}'/></IndexedLineSet></Shape>")
for i, name in enumerate(FAM[10]["items"]):
    a = 2 * math.pi * i / 8 + math.pi / 8
    pos = void + v_view * 12 + (12.2 * math.cos(a)) * b_w + (12.2 * math.sin(a)) * a_w
    d = f"T_10_{i + 1:02d}"
    thinker(d, pos, name, f"{i + 1:02d}", lighten(C10, 0.2), lighten(C10, 0.7), size=0.6)
    BEADS.append(dict(id=d, fam=10, branch=None, label=name, n=i + 1, pos=[round(float(x), 3) for x in pos]))
w("</Group>")
w(f"<Transform translation='{fv(c10 + a_w * 14.5)}'><Billboard axisOfRotation='0 1 0'>{text(['10  CHALLENGE'], 1.9, lighten(C10, 0.6), style='BOLD')}</Billboard></Transform>")
awaken(10, c10, lighten(C10, 0.5))

# ================================================================ the river of thought
WP = [np.array((0, 13.8, 0)), np.array((3, 15.5, 9))]
for kk in range(2, 10):
    st = STATIONS[kk]; cc = st["center"]
    WP.append(cc * np.array([0.66, 1, 0.66]) + (0, 3.5, 0))
    if kk < 9:
        nx_ = STATIONS[kk + 1]["center"]; mid = (cc + nx_) / 2
        WP.append(norm([mid[0], 0, mid[2]]) * 23 + (0, mid[1] + 3.0, 0))
WP += [np.array((-20, 48, 0)), np.array((-12, 58, -24)), np.array((0, 63, -30)), np.array((0, 40, -30)), np.array((0, 22, -22)), np.array((0, 16, -8))]
path = resample(catmull(WP, 24, closed=True), 420, closed=True)
riv_cs = [(0.28 * math.cos(2 * math.pi * j / 12), 0.28 * math.sin(2 * math.pi * j / 12)) for j in range(13)]
spine_closed = list(path) + [path[0]]
w(f"<Shape><Appearance>{mat('phys', base=(1, 0.92, 0.7), emissive=(0.55, 0.45, 0.22), metallic=0.2, rough=0.2, transp=0.35)}</Appearance>"
  f"<Extrusion spine='{fvs(spine_closed)}' crossSection='{' '.join(fv(x) for x in riv_cs)}' creaseAngle='1.6' beginCap='false' endCap='false'/></Shape>")
# motes: thoughts that take the colour of each family they pass
def nearest_family(p):
    best, bd = 1, 1e9
    for kk, st in STATIONS.items():
        cc = st["center"] + ((0, 10, 0) if kk == 1 else (0, 4, 0))
        d = np.linalg.norm(p - cc)
        if d < bd: best, bd = kk, d
    return best, bd
NK = 96
keys = np.linspace(0, 1, NK + 1)
samp = [path[int(round(t * len(path))) % len(path)] for t in keys]
fam_col = []
for p in samp:
    kk, d = nearest_family(p)
    fam_col.append(lighten(COL[kk - 1], 0.35) if d < 16 else np.array([1, 0.9, 0.6]))
w("<TimeSensor DEF='RiverClock' cycleInterval='140' loop='true'/>")
NM = 21
for m in range(NM):
    sh = int(round(m * NK / NM))
    pv = [samp[(i + sh) % NK] for i in range(NK)] + [samp[sh % NK]]
    cv = [fam_col[(i + sh) % NK] for i in range(NK)] + [fam_col[sh % NK]]
    w(f"<Transform DEF='Mote{m}' translation='{fv(pv[0])}'><Shape><Appearance><UnlitMaterial DEF='MoteMat{m}' emissiveColor='{fv(cv[0])}'/></Appearance><Sphere radius='0.42'/></Shape></Transform>")
    w(f"<PositionInterpolator DEF='MoteP{m}' key='{' '.join(f(x) for x in keys)}' keyValue='{fvs(pv)}'/>")
    w(f"<ColorInterpolator DEF='MoteC{m}' key='{' '.join(f(x) for x in keys)}' keyValue='{', '.join(fv(x) for x in cv)}'/>")
    route("RiverClock", "fraction_changed", f"MoteP{m}", "set_fraction"); route(f"MoteP{m}", "value_changed", f"Mote{m}", "set_translation")
    route("RiverClock", "fraction_changed", f"MoteC{m}", "set_fraction"); route(f"MoteC{m}", "value_changed", f"MoteMat{m}", "set_emissiveColor")

# ================================================================ the pilgrim: a viewpoint that rides the river
NP = 180
pk = np.linspace(0, 1, NP + 1)
ppos, pori = [], []
for i, t in enumerate(pk):
    idx = int(round(t * len(path))) % len(path)
    p = path[idx]
    ahead = path[(idx + 14) % len(path)]
    kk, d = nearest_family(p)
    st = STATIONS[kk]
    focus = st["center"] + ((0, 9, 0) if kk == 1 else (0, 5, 0))
    wgt = max(0.0, min(1.0, (22 - d) / 14)) * (0.0 if kk == 10 else 0.75)
    radial = norm([p[0], 0, p[2]]) if np.linalg.norm([p[0], 0, p[2]]) > 1 else np.array([0, 0, 1.0])
    eye = p - radial * 5.0 + np.array([0, 5.5, 0])
    tgt = ahead * (1 - wgt) + focus * wgt
    ppos.append(eye); pori.append(look_rot(eye, tgt))
# keep orientations on the short arc for the interpolator
for i in range(1, len(pori)):
    a0, a1 = np.array(pori[i - 1][:3]), np.array(pori[i][:3])
    if np.dot(a0, a1) < 0: pori[i] = (*(-a1), -pori[i][3])
w(f"<Viewpoint DEF='Pilgrim' description='Ride the river of thought' position='{fv(ppos[0])}' orientation='{fv(pori[0])}' fieldOfView='1.0' jump='true'/>")
VIEWS.append(("Pilgrim", "Ride the river of thought", 0))
w("<TimeSensor DEF='PilgrimClock' cycleInterval='210' loop='true'/>")
w(f"<PositionInterpolator DEF='PilgrimP' key='{' '.join(f(x) for x in pk)}' keyValue='{fvs(ppos)}'/>")
w(f"<OrientationInterpolator DEF='PilgrimO' key='{' '.join(f(x) for x in pk)}' keyValue='{', '.join(fv(x) for x in pori)}'/>")
route("PilgrimClock", "fraction_changed", "PilgrimP", "set_fraction"); route("PilgrimP", "value_changed", "Pilgrim", "set_position")
route("PilgrimClock", "fraction_changed", "PilgrimO", "set_fraction"); route("PilgrimO", "value_changed", "Pilgrim", "set_orientation")

w("</Group>")   # Landscape

# X3D binds the first Viewpoint in file order, so the Overview is written ahead of everything else.
OVERVIEW = "<Viewpoint DEF='Overview' description='Overview: the whole landscape' position='0 72 104' orientation='{}' centerOfRotation='0 24 0' fieldOfView='0.9'/>".format(fv(look_rot((0, 72, 104), (0, 22, 0))))
VIEWS.insert(0, ("Overview", "Overview: the whole landscape", 0))
OVERVIEW += "\n<Viewpoint DEF='Focus' description='Focus on the chosen entry' position='0 20 60' fieldOfView='0.8'/>"
body = "\n".join(OUT)
lib = ["<Switch DEF='GlyphLibrary' whichChoice='-1'>"]
seen_geo, seen_app = set(), set()
inv = {v: k for k, v in INKS.items()}
for (fk, ch, ink), name in COMBOS.items():
    P, T = FONTS[fk].mesh(ch); g = f"G{fk}{ord(ch)}"
    app = f"<Appearance USE='{ink}'/>" if ink in seen_app else f"<Appearance DEF='{ink}'><UnlitMaterial emissiveColor='{inv[ink]}'/></Appearance>"
    seen_app.add(ink)
    if g in seen_geo: geo = f"<IndexedFaceSet USE='{g}'/>"
    else:
        seen_geo.add(g)
        geo = (f"<IndexedFaceSet DEF='{g}' solid='false' coordIndex='{' '.join(f'{a} {b} {c} -1' for a, b, c in T)}'>"
               f"<Coordinate point='{' '.join(f'{f(x)} {f(y)} 0' for x, y in P)}'/></IndexedFaceSet>")
    lib.append(f"<Shape DEF='{name}'>{app}{geo}</Shape>")
lib.append("</Switch>")
body = body.replace("<!--GLYPHLIB-->", "\n".join(lib), 1)
body = body.replace("<NavigationInfo", OVERVIEW + "\n<NavigationInfo", 1)
body += "\n" + "\n".join(ROUTES) + "\n</Scene></X3D>\n"
open(f"{HERE}/out/landscape.x3d", "w").write(body)
import re as _re
CLOCKS = sorted(set(_re.findall(r"<TimeSensor DEF='([^']+)'[^>]*loop='true'", body)))
json.dump(dict(views=VIEWS, beads=BEADS, clocks=CLOCKS, x3d_sha256=hashlib.sha256(body.encode()).hexdigest(), families=[dict(n=fm["n"], name=fm["name"], color=CAT[fm["n"] - 1],
          branches=[b["name"] for b in fm.get("branches", [])]) for fm in DATA["families"]],
          stations={k: [round(float(x), 2) for x in v["center"]] for k, v in STATIONS.items()}),
          open(f"{HERE}/out/index.json", "w"), indent=0, ensure_ascii=False)
print("bytes", len(body), "beads", len(BEADS), "routes", len(ROUTES), "views", len(VIEWS), "sha256", hashlib.sha256(body.encode()).hexdigest()[:16])
