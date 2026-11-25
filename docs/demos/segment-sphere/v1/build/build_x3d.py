"""Build assets/segment-sphere.x3d (X3D 4.0) from data/services.json.

Usage: python -I build/build_x3d.py   (run from the demo folder)

One scene, three shapes of the same 301 services, morphed by one ecmascript Script:
  m = 0  WHEEL   the source page's wheel, kept to its own geometry (ring radius 204/444/684 of 1000, exact angles);
                 lifecycle becomes depth: preview floats up, closed sinks a little, sunset sinks far below the plane.
  m = 1  SPHERE  the wheel wrapped onto a ball: wheel angle -> longitude (a category's lune keeps its wedge angle,
                 so lune AREA is proportional to its service count, as the wedge's angle was); ring -> colatitude
                 40/90/140 deg; lifecycle -> radius (preview 1.14 R, GA 1.02 R, closed 0.88 R, sunset in the core).
  m = 2  HOPF    the sphere lifted to the 3-sphere S3 by the Hopf fibration: every service's point on the sphere
                 becomes a great circle (its fiber) in S3, stereographically projected to 3D. Any two fibers link
                 exactly once; the 3 rings become 3 nested tori; each category lune becomes a twisted band of fibers.
The static coordinates written here are the SPHERE state (what a browser without ecmascript shows); the Script
recomputes everything at run time from the same formulas (JS below is the reference implementation).
"""
import json, math, os, random, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
D = json.load(open(os.path.join(ROOT, "data", "services.json"), encoding="utf-8"))
CATS, SV = D["categories"], D["services"]
STATUS = {"ga": 0, "preview": 1, "closed": 2, "sunset": 3}
R = 6.0
RING_THETA = [40.0, 90.0, 140.0]
NU = 10                       # radial steps per patch
LIFE = {1: "#5FC6E8", 2: "#F0B64A", 3: "#F2707A"}   # source page's pill colours: preview, closed, sunset
TH0, TH1 = 10.0, 170.0        # sphere patch colatitude range
W_R0, W_R1 = 1.9, 9.25        # wheel patch radius (source: 190 .. 925 of 1000)
FIB_N = 64
TOR_N = 40


def hexc(h):
    h = h.lstrip("#"); return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def f(x):
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def v3(p):
    return " ".join(f(c) for c in p)


def sph(th, ph, r):
    t, p = math.radians(th), math.radians(ph)
    return (r * math.sin(t) * math.sin(p), r * math.sin(t) * math.cos(p), r * math.cos(t))


def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


def mfstr(xs):
    """MFString as a complete single-quoted XML attribute value."""
    def one(x):
        x = x.replace("\\", "\\\\").replace('"', '\\"')
        return '"' + x.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&apos;") + '"'
    return "'" + " ".join(one(x) for x in xs) + "'"


# patch topology: per category a (NU+1) x (NV+1) grid
cat_nv = [max(3, round(c["span"] / 2.5)) for c in CATS]
pc, pidx, pcol = [], [], []
base = 0
for ci, c in enumerate(CATS):
    nv = cat_nv[ci]
    for iu in range(NU + 1):
        th = TH0 + (TH1 - TH0) * iu / NU
        for iv in range(nv + 1):
            pc.append(sph(th, c["a0"] + c["span"] * iv / nv, R * 0.995))
    for iu in range(NU):
        for iv in range(nv):
            a = base + iu * (nv + 1) + iv; b = a + 1; cc = a + nv + 1; d = cc + 1
            pidx += [a, cc, d, b, -1]; pcol.append(ci)
    base += (NU + 1) * (nv + 1)

# gems: octahedron per service
def life_r(st):
    return {0: 1.02, 1: 1.14, 2: 0.88, 3: 0.0}[st]


svc_status = [STATUS[s["status"]] for s in SV]
gpos = []
for s, st in zip(SV, svc_status):
    th = RING_THETA[s["ring"]]
    gpos.append(sph(th, s["angle"], 2.35) if st == 3 else sph(th, s["angle"], R * life_r(st)))
OCT = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
OCT_F = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
GSIZE = {0: 0.15, 1: 0.26, 2: 0.15, 3: 0.12}
gc, gidx, gcolidx = [], [], []
colors = [hexc(c["color"]) for c in CATS] + [hexc(LIFE[2]), hexc(LIFE[3])]
for i, (p, st, s) in enumerate(zip(gpos, svc_status, SV)):
    k = GSIZE[st]
    for o in OCT:
        gc.append((p[0] + o[0] * k, p[1] + o[1] * k, p[2] + o[2] * k * (1.6 if st == 1 else 1)))
    ci = s["cat"] if st in (0, 1) else (19 if st == 2 else 20)
    for fa in OCT_F:
        gidx += [i * 6 + fa[0], i * 6 + fa[1], i * 6 + fa[2], -1]; gcolidx.append(ci)

# halo points
hcol = [hexc(LIFE[1]) if st == 1 else (colors[s["cat"]] if st == 0 else colors[19 if st == 2 else 20]) for s, st in zip(SV, svc_status)]

# fiber topology: 301 closed polylines of FIB_N points
fidx = []
for i in range(len(SV)):
    fidx += [i * FIB_N + k for k in range(FIB_N)] + [i * FIB_N, -1]
fcol = []
for s, st in zip(SV, svc_status):
    c = colors[s["cat"]] if st in (0, 1) else colors[19 if st == 2 else 20]
    fcol += [c] * FIB_N
# torus wire topology: 3 tori, TOR_N x TOR_N grid, lines both ways
tidx = []
for t in range(3):
    b = t * TOR_N * TOR_N
    for i in range(TOR_N):
        tidx += [b + i * TOR_N + j for j in range(TOR_N)] + [b + i * TOR_N, -1]
        tidx += [b + j * TOR_N + i for j in range(TOR_N)] + [b + i, -1]

# stars
rnd = random.Random(20261125)
stars, scol = [], []
for _ in range(2400):
    z = rnd.uniform(-1, 1); a = rnd.uniform(0, 2 * math.pi); r = rnd.uniform(160, 260)
    q = math.sqrt(1 - z * z)
    stars.append((r * q * math.cos(a), r * z, r * q * math.sin(a)))
    w = rnd.random(); tint = rnd.choice([(0.75, 0.85, 1), (1, 0.92, 0.8), (0.85, 1, 0.95), (1, 1, 1)])
    scol.append(tuple(c * (0.35 + 0.65 * w * w) for c in tint))

# labels: sphere set (tangent plane, baseline along the meridian like the wheel's spokes) + wheel set (in the plane)
def rot_from_basis(xa, ya, za):
    # rotation matrix columns xa, ya, za -> axis-angle
    m = [[xa[0], ya[0], za[0]], [xa[1], ya[1], za[1]], [xa[2], ya[2], za[2]]]
    tr = m[0][0] + m[1][1] + m[2][2]
    ang = math.acos(max(-1, min(1, (tr - 1) / 2)))
    if ang < 1e-6:
        return (0, 0, 1, 0)
    if abs(ang - math.pi) < 1e-4:
        xx = math.sqrt(max(0, (m[0][0] + 1) / 2)); yy = math.sqrt(max(0, (m[1][1] + 1) / 2)); zz = math.sqrt(max(0, (m[2][2] + 1) / 2))
        if m[0][1] < 0: yy = -yy
        if m[0][2] < 0: zz = -zz
        return (xx, yy, zz, ang)
    s2 = 2 * math.sin(ang)
    return ((m[2][1] - m[1][2]) / s2, (m[0][2] - m[2][0]) / s2, (m[1][0] - m[0][1]) / s2, ang)


def norm(v):
    l = math.sqrt(sum(c * c for c in v)); return tuple(c / l for c in v)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def look(name, desc, eye, fov, at=(0, 0, 0)):
    z = norm(tuple(e - a for e, a in zip(eye, at))); up = (0, 1, 0)
    x = norm(cross(up, z)); y = cross(z, x)
    ax = rot_from_basis(x, y, z)
    return f'<Viewpoint DEF="{name}" description="{esc(desc)}" position="{v3(eye)}" orientation="{v3(ax[:3])} {f(ax[3])}" fieldOfView="{f(fov)}" centerOfRotation="{v3(at)}"/>'


# category seams: meridians on the sphere, spokes on the wheel
seam_s = " ".join(v3(sph(TH0 + (TH1 - TH0) * k / 40, c["a0"], R * 1.002)) for c in CATS for k in range(41))
seam_si = " ".join(" ".join(str(ci * 41 + k) for k in range(41)) + " -1" for ci in range(len(CATS)))
seam_w = " ".join(v3((r * math.sin(math.radians(c["a0"])), r * math.cos(math.radians(c["a0"])), 0.02)) for c in CATS for r in (W_R0, W_R1))
seam_wi = " ".join(f"{2 * ci} {2 * ci + 1} -1" for ci in range(len(CATS)))
SEAM_APP = '<Appearance><Material diffuseColor="0 0 0" emissiveColor="0.02 0.03 0.05"/><LineProperties linewidthScaleFactor="2.5"/></Appearance>'
seam_sphere = f'<Shape>{SEAM_APP}<IndexedLineSet coordIndex="{seam_si}"><Coordinate point="{seam_s}"/></IndexedLineSet></Shape>'
seam_wheel = f'<Shape>{SEAM_APP}<IndexedLineSet coordIndex="{seam_wi}"><Coordinate point="{seam_w}"/></IndexedLineSet></Shape>'


def label_name(s):
    # X_ITE's SANS font has the dagger but no glyph for the wheel's diamond or white bullet, so those two are spelled out
    return s["name"] + {"ga": "", "preview": " (preview)", "closed": " (closed)", "sunset": " †"}[s["status"]]


sphere_labels, wheel_labels = [], []
for i, (s, st) in enumerate(zip(SV, svc_status)):
    th, ph = RING_THETA[s["ring"]], s["angle"]
    n = norm(sph(th, ph, 1))
    rr = R * (life_r(st) + 0.035)
    p = tuple(c * rr for c in n)
    # meridian direction (increasing theta)
    t, q = math.radians(th), math.radians(ph)
    e = (math.cos(t) * math.sin(q), math.cos(t) * math.cos(q), -math.sin(t))
    xa = e; za = n
    # keep text readable from outside: flip on the left half like the wheel does
    right = ph % 360 < 180
    if not right:
        xa = tuple(-c for c in xa)
    ya = cross(za, xa)
    ax = rot_from_basis(xa, ya, za)
    just = '"BEGIN" "MIDDLE"' if right else '"END" "MIDDLE"'
    off = 0.2 if right else -0.2
    if st != 3:  # sunset labels live with the core in the sphere view
      sphere_labels.append(f'<Transform translation="{v3(p)}" rotation="{v3(ax[:3])} {f(ax[3])}"><Transform translation="{f(off)} 0 0">'
                         f'<Shape><Appearance USE="LabelApp{"" if st == 0 else st}"/><Text string={mfstr([label_name(s)])}><FontStyle USE="FS_Svc{"R" if right else "L"}"/></Text></Shape></Transform></Transform>')
    # wheel: radial in plane, like the source svg
    rw = [2.04, 4.44, 6.84][s["ring"]]
    a = math.radians(ph)
    wp = (rw * math.sin(a), rw * math.cos(a), {0: 0.1, 1: 0.6, 2: -0.4, 3: -2.6}[st])
    xa2 = (math.sin(a), math.cos(a), 0)
    if not right:
        xa2 = tuple(-c for c in xa2)
    za2 = (0, 0, 1); ya2 = cross(za2, xa2)
    ax2 = rot_from_basis(xa2, ya2, za2)
    wheel_labels.append(f'<Transform translation="{v3(wp)}" rotation="{v3(ax2[:3])} {f(ax2[3])}"><Transform translation="{f(off * 0.8)} 0 0">'
                        f'<Shape><Appearance USE="LabelApp{"" if st == 0 else st}"/><Text string={mfstr([label_name(s)])}><FontStyle USE="FS_Svc{"R" if right else "L"}"/></Text></Shape></Transform></Transform>')

# core labels for sunset services: a ring of names around the core's equator band, by category
sun = [(i, s) for i, (s, st) in enumerate(zip(SV, svc_status)) if st == 3]
core_labels = []
for k, (i, s) in enumerate(sun):
    p = gpos[i]
    n = norm(p)
    core_labels.append(f'<Transform translation="{v3(tuple(c * 2.62 for c in n))}"><Billboard axisOfRotation="0 0 0"><Shape><Appearance USE="LabelApp3"/>'
                       f'<Text string={mfstr([s["name"] + " †"])}><FontStyle USE="FS_Core"/></Text></Shape></Billboard></Transform>')
# fall lines: from each sunset service's surface slot to its grave in the core
fall_pts, fall_idx = [], []
for k, (i, s) in enumerate(sun):
    a = sph(RING_THETA[s["ring"]], s["angle"], R * 1.0); b = gpos[i]
    fall_pts += [a, b]; fall_idx += [2 * k, 2 * k + 1, -1]

# category labels: sphere set (Billboard above lune centre on each ring's mid) and wheel set (outside the rim)
cat_sphere, cat_wheel = [], []
for ci, c in enumerate(CATS):
    mid = c["a0"] + c["span"] / 2
    p = sph(90, mid, R * 1.5)
    col = hexc(c["color"])
    txt = mfstr([c["name"].upper(), f'{c["count"]} services'])
    cat_sphere.append(f'<Transform translation="{v3(p)}"><Billboard axisOfRotation="0 0 0"><Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="{v3(col)}"/></Appearance>'
                      f'<Text string={txt}><FontStyle USE="FS_Cat"/></Text></Shape></Billboard></Transform>')
    a = math.radians(mid)
    rr2 = 10.8 + (0.9 if (ci % 2 and c["span"] < 20) else 0)
    wp = (rr2 * math.sin(a), rr2 * math.cos(a), 0.05)
    cat_wheel.append(f'<Transform translation="{v3(wp)}"><Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="{v3(col)}"/></Appearance>'
                     f'<Text string={txt}><FontStyle USE="FS_Cat"/></Text></Shape></Transform>')

# viewpoints: one per category (sphere), looking at the lune centre
cat_vps = []
for ci, c in enumerate(CATS):
    mid = c["a0"] + c["span"] / 2
    eye = sph(78, mid, 17.5)
    # orient: look from eye to origin, up ~ +Y projected
    z = norm(eye); up = (0, 1, 0) if abs(z[1]) < 0.95 else (0, 0, 1)
    x = norm(cross(up, z)); y = cross(z, x)
    ax = rot_from_basis(x, y, z)
    cat_vps.append(f'<Viewpoint DEF="VP_C{ci:02d}" description="{esc(c["name"])} ({c["count"]})" position="{v3(eye)}" orientation="{v3(ax[:3])} {f(ax[3])}" fieldOfView="0.7"/>')

# metadata: the whole dataset, in X3D, for anyone who reads the file without the page
meta = []
for ci, c in enumerate(CATS):
    mine = [s for s in SV if s["cat"] == ci]
    meta.append(f'<MetadataSet name="{re.sub(r"[^A-Za-z0-9]+", "_", c["name"]).strip("_")}" reference="aws_segment_wheel:category:{ci}">'
                f'<MetadataString name="label" value={mfstr([c["name"]])}/>'
                f'<MetadataString name="color" value=\'"{c["color"]}"\'/>'
                f'<MetadataInteger name="count" value="{c["count"]}"/>'
                f'<MetadataDouble name="wedge_deg" value="{f(c["a0"])} {f(c["span"])}"/>'
                f'<MetadataString name="services" value={mfstr([s["name"] for s in mine])}/>'
                f'<MetadataString name="status" value={mfstr([s["status"] for s in mine])}/>'
                f'<MetadataInteger name="ring" value="{" ".join(str(s["ring"]) for s in mine)}"/>'
                f'<MetadataDouble name="angle_deg" value="{" ".join(f(s["angle"]) for s in mine)}"/>'
                '</MetadataSet>')
watch = [s for s in SV if s["status"] != "ga"]
meta.append('<MetadataSet name="lifecycle_watch_list" reference="aws_segment_wheel:table">'
            f'<MetadataString name="service" value={mfstr([s["full"] for s in watch])}/>'
            f'<MetadataString name="status" value={mfstr([s["status_label"] for s in watch])}/>'
            f'<MetadataString name="note" value={mfstr([s["note"] for s in watch])}/></MetadataSet>')

SCRIPT = open(os.path.join(HERE, "morph.js"), encoding="utf-8").read()


def build():
    n = len(SV)
    phase = []
    per = {}
    for i, s in enumerate(SV):
        per.setdefault(s["cat"], []).append(i)
    ph = [0.0] * n
    for ci, ids in per.items():
        for k, i in enumerate(ids):
            ph[i] = 2 * math.pi * k / len(ids) + ci * 0.37
    sf = []
    sf.append(f'<field accessType="initializeOnly" name="svcLon" type="MFFloat" value="{" ".join(f(s["angle"]) for s in SV)}"/>')
    sf.append(f'<field accessType="initializeOnly" name="svcRing" type="MFInt32" value="{" ".join(str(s["ring"]) for s in SV)}"/>')
    sf.append(f'<field accessType="initializeOnly" name="svcStatus" type="MFInt32" value="{" ".join(str(x) for x in svc_status)}"/>')
    sf.append(f'<field accessType="initializeOnly" name="svcCat" type="MFInt32" value="{" ".join(str(s["cat"]) for s in SV)}"/>')
    sf.append(f'<field accessType="initializeOnly" name="svcPhase" type="MFFloat" value="{" ".join(f(x) for x in ph)}"/>')
    sf.append(f'<field accessType="initializeOnly" name="svcName" type="MFString" value={mfstr([label_name(s) for s in SV])}/>')
    sf.append(f'<field accessType="initializeOnly" name="catName" type="MFString" value={mfstr([c["name"] for c in CATS])}/>')
    sf.append(f'<field accessType="initializeOnly" name="catA0" type="MFFloat" value="{" ".join(f(c["a0"]) for c in CATS)}"/>')
    sf.append(f'<field accessType="initializeOnly" name="catSpan" type="MFFloat" value="{" ".join(f(c["span"]) for c in CATS)}"/>')
    sf.append(f'<field accessType="initializeOnly" name="catNV" type="MFInt32" value="{" ".join(str(x) for x in cat_nv)}"/>')
    sf.append(f'<field accessType="initializeOnly" name="fibN" type="SFInt32" value="{FIB_N}"/>')
    sf.append(f'<field accessType="initializeOnly" name="torN" type="SFInt32" value="{TOR_N}"/>')
    for nm in ["patchCoord", "gemCoord", "haloCoord", "fiberCoord", "torusCoord", "fiberMat", "torusMat", "patchMat", "hopfSwitch",
               "labelSwitch", "selT", "selText", "selSwitch", "hovT", "hovText", "hovSwitch"]:
        sf.append(f'<field accessType="initializeOnly" name="{nm}" type="SFNode"><{NODE_OF[nm]} USE="{nm[0].upper() + nm[1:]}"/></field>')
    sf += ['<field accessType="inputOnly" name="set_time" type="SFTime"/>', '<field accessType="inputOnly" name="set_mode" type="SFFloat"/>',
           '<field accessType="inputOnly" name="set_jump" type="SFFloat"/>', '<field accessType="inputOnly" name="set_spin" type="SFBool"/>',
           '<field accessType="inputOnly" name="set_hit" type="SFVec3f"/>', '<field accessType="inputOnly" name="set_click" type="SFTime"/>',
           '<field accessType="inputOnly" name="set_select" type="SFInt32"/>', '<field accessType="outputOnly" name="selected_changed" type="SFInt32"/>',
           '<field accessType="outputOnly" name="hover_changed" type="SFInt32"/>', '<field accessType="outputOnly" name="mode_changed" type="SFFloat"/>',
           '<field accessType="outputOnly" name="stats_changed" type="SFFloat"/>']

    src = D["source"]
    out = []
    A = out.append
    A('<?xml version="1.0" encoding="UTF-8"?>')
    A('<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">')
    A('<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">')
    A('<head>')
    A('<component level="2" name="Geometry2D"/><component level="5" name="Shape"/><component level="1" name="Scripting"/>')
    for k, v in [("title", "Segment Sphere: the AWS Segment Wheel as a sphere and a Hopf 3-sphere"),
                 ("description", "301 services, 19 categories, 3 rings and 38 lifecycle flags from the AWS Segment Wheel (Sept 2026), shown as the flat wheel, a segment sphere and a Hopf-fibred 3-sphere stereographically projected to 3D. One ecmascript Script morphs all three."),
                 ("creator", "x3d.demo segment-sphere/v1 (build/build_x3d.py)"), ("created", "25 November 2026"),
                 ("source", f"{src['repo']} commit {src['commit'][:7]} index.html sha256 {src['sha256']}"),
                 ("rights", "Scene CC BY 4.0. AWS and the service names are trademarks of Amazon.com, Inc. or its affiliates; not affiliated with or endorsed by AWS. See DATA-ATTRIBUTION.md."),
                 ("reference", "https://hagopjay.github.io/x3d.demo/demos/segment-sphere/v1/"), ("generator", "Python 3 string emitter, no third-party libraries")]:
        A(f'<meta name="{k}" content="{esc(v)}"/>')
    A('</head><Scene>')
    A('<WorldInfo DEF="Info" title="Segment Sphere"><MetadataSet containerField="metadata" name="aws_segment_wheel" reference="' + esc(src["repo"]) + '">' + "".join(meta) + '</MetadataSet></WorldInfo>')
    A('<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="false" visibilityLimit="0"/>')
    A('<Background skyAngle="0.9 1.45 1.6" skyColor="0.004 0.006 0.016 0.02 0.03 0.07 0.03 0.05 0.1 0.012 0.016 0.03" groundAngle="1.5" groundColor="0.004 0.006 0.016 0.008 0.01 0.02"/>')
    A(look("VP_Sphere", "Segment sphere", (11.5, 8.0, 17.5), 0.72))
    A('<Viewpoint DEF="VP_Wheel" description="The wheel, face on" position="0 0 27" fieldOfView="0.8"/>')
    A(look("VP_Hopf", "Hopf 3-sphere", (5.0, 10.0, 21.0), 0.8))
    A(look("VP_Core", "Inside the sphere: the graveyard core of sunset services", (1.2, 1.6, 4.9), 1.05))
    A('<Viewpoint DEF="VP_Pole" description="North pole: ring 0" position="0 0 16.5" fieldOfView="0.75"/>')
    out.extend(cat_vps)
    # light rig
    A('<DirectionalLight direction="-0.5 -0.6 -0.62" color="1 0.96 0.9" intensity="1.1"/>')
    A('<DirectionalLight direction="0.7 0.3 0.5" color="0.45 0.6 1" intensity="0.55"/>')
    A('<DirectionalLight direction="0.1 0.9 -0.3" color="0.9 0.5 0.9" intensity="0.25"/>')
    A('<PointLight location="0 0 0" color="1 0.35 0.3" intensity="2.4" radius="6" attenuation="1 0 0.4"/>')
    A('<TimeSensor DEF="Clock" loop="true" cycleInterval="1"/>')
    # stars
    A('<Shape DEF="Stars"><Appearance><Material emissiveColor="1 1 1" diffuseColor="0 0 0"/><PointProperties pointSizeScaleFactor="2.2" pointSizeMinValue="1" pointSizeMaxValue="3"/></Appearance>'
      f'<PointSet><Coordinate point="{" ".join(v3(p) for p in stars)}"/><Color color="{" ".join(v3(c) for c in scol)}"/></PointSet></Shape>')
    # core
    A('<Transform DEF="Core"><Shape><Appearance><PhysicalMaterial baseColor="0.25 0.04 0.06" emissiveColor="0.32 0.05 0.07" metallic="0.1" roughness="0.25" transparency="0.35"/></Appearance><Sphere radius="2.2"/></Shape>'
      '<Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="1 0.45 0.4" transparency="0.82"/></Appearance><Sphere radius="1.2"/></Shape></Transform>')
    # patches
    A('<Shape DEF="Patches"><Appearance><PhysicalMaterial DEF="PatchMat" baseColor="1 1 1" emissiveColor="0 0 0" metallic="0.15" roughness="0.38" transparency="0.22"/></Appearance>'
      f'<IndexedFaceSet solid="false" creaseAngle="1.2" colorPerVertex="false" coordIndex="{" ".join(map(str, pidx))}" colorIndex="{" ".join(map(str, pcol))}">'
      f'<Coordinate DEF="PatchCoord" point="{" ".join(v3(p) for p in pc)}"/><Color color="{" ".join(v3(c) for c in colors)}"/></IndexedFaceSet></Shape>')
    # latitude guide rings (sphere state)
    guide = ('<Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="0.5 0.56 0.7" transparency="0.6"/></Appearance><IndexedLineSet coordIndex="' +
      " ".join(" ".join(str(r * 97 + j) for j in range(96)) + f" {r * 97} -1" for r in range(3)) + '"><Coordinate point="' +
      " ".join(v3(sph(th, 360 * j / 96, R * 1.005)) for th in RING_THETA for j in range(97)) + '"/></IndexedLineSet></Shape>')
    # gems with picking
    A('<Group><TouchSensor DEF="Pick" description="pick a service"/>'
      '<Shape DEF="Gems"><Appearance><PhysicalMaterial baseColor="1 1 1" emissiveColor="0.08 0.08 0.09" metallic="0" roughness="0.3"/></Appearance>'
      f'<IndexedFaceSet solid="true" creaseAngle="0" colorPerVertex="false" coordIndex="{" ".join(map(str, gidx))}" colorIndex="{" ".join(map(str, gcolidx))}">'
      f'<Coordinate DEF="GemCoord" point="{" ".join(v3(p) for p in gc)}"/><Color color="{" ".join(v3(c) for c in colors)}"/></IndexedFaceSet></Shape></Group>')
    A('<Shape DEF="Halos"><Appearance><Material diffuseColor="0 0 0" emissiveColor="1 1 1" transparency="0.25"/><PointProperties pointSizeScaleFactor="9" pointSizeMinValue="3" pointSizeMaxValue="18" attenuation="0 0.1 0"/></Appearance>'
      f'<PointSet><Coordinate DEF="HaloCoord" point="{" ".join(v3(p) for p in gpos)}"/><Color color="{" ".join(v3(c) for c in hcol)}"/></PointSet></Shape>')
    # Hopf layer
    A('<Switch DEF="HopfSwitch" whichChoice="-1"><Group>'
      '<Shape DEF="Fibers"><Appearance><Material DEF="FiberMat" diffuseColor="0 0 0" emissiveColor="1 1 1" transparency="0.3"/><LineProperties linewidthScaleFactor="1.6"/></Appearance>'
      f'<IndexedLineSet colorPerVertex="true" coordIndex="{" ".join(map(str, fidx))}"><Coordinate DEF="FiberCoord" point="{" ".join("0 0 0" for _ in range(n * FIB_N))}"/>'
      f'<Color color="{" ".join(v3(c) for c in fcol)}"/></IndexedLineSet></Shape>'
      '<Shape DEF="Tori"><Appearance><Material DEF="TorusMat" diffuseColor="0 0 0" emissiveColor="0.55 0.7 1" transparency="0.75"/></Appearance>'
      f'<IndexedLineSet coordIndex="{" ".join(map(str, tidx))}"><Coordinate DEF="TorusCoord" point="{" ".join("0 0 0" for _ in range(3 * TOR_N * TOR_N))}"/></IndexedLineSet></Shape>'
      '</Group></Switch>')
    # labels
    A('<Switch DEF="LabelSwitch" whichChoice="1">')
    A('<Group DEF="WheelLabels"><Shape><Appearance DEF="LabelApp"><Material diffuseColor="0 0 0" emissiveColor="0.93 0.95 0.98"/></Appearance>'
      '<Text string=\'""\'><FontStyle DEF="FS_SvcR" family=\'"SANS"\' size="0.16" justify=\'"BEGIN" "MIDDLE"\'/></Text></Shape>'
      '<Shape><Appearance DEF="LabelApp1"><Material diffuseColor="0 0 0" emissiveColor="0.37 0.78 0.91"/></Appearance><Text string=\'""\'><FontStyle DEF="FS_SvcL" family=\'"SANS"\' size="0.16" justify=\'"END" "MIDDLE"\'/></Text></Shape>'
      '<Shape><Appearance DEF="LabelApp2"><Material diffuseColor="0 0 0" emissiveColor="0.94 0.71 0.29"/></Appearance><Text string=\'""\'><FontStyle DEF="FS_Cat" family=\'"SANS"\' style="BOLD" size="0.36" justify=\'"MIDDLE" "MIDDLE"\'/></Text></Shape>'
      '<Shape><Appearance DEF="LabelApp3"><Material diffuseColor="0 0 0" emissiveColor="0.95 0.44 0.48"/></Appearance><Text string=\'""\'><FontStyle DEF="FS_Core" family=\'"SANS"\' size="0.13" justify=\'"MIDDLE" "MIDDLE"\'/></Text></Shape>'
      + "".join(wheel_labels) + "".join(cat_wheel) + seam_wheel + '</Group>')
    fall = (f'<Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="0.95 0.44 0.48" transparency="0.45"/></Appearance>'
            f'<IndexedLineSet coordIndex="{" ".join(map(str, fall_idx))}"><Coordinate point="{" ".join(v3(p) for p in fall_pts)}"/></IndexedLineSet></Shape>')
    A('<Group DEF="SphereLabels">' + "".join(sphere_labels) + "".join(cat_sphere) + "".join(core_labels) + fall + guide + seam_sphere + '</Group>')
    A('</Switch>')
    # selection + hover markers
    A('<Switch DEF="SelSwitch" whichChoice="-1"><Transform DEF="SelT"><Billboard axisOfRotation="0 0 0">'
      '<Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="1 1 1"/></Appearance><Disk2D innerRadius="0.42" outerRadius="0.5"/></Shape>'
      '<Transform translation="0 0.78 0.05"><Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="1 1 1"/></Appearance>'
      '<Text DEF="SelText" string=\'""\'><FontStyle family=\'"SANS"\' style="BOLD" size="0.36" justify=\'"MIDDLE" "BEGIN"\'/></Text></Shape></Transform></Billboard></Transform></Switch>')
    A('<Switch DEF="HovSwitch" whichChoice="-1"><Transform DEF="HovT"><Billboard axisOfRotation="0 0 0">'
      '<Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="0.37 0.78 0.91" transparency="0.2"/></Appearance><Circle2D radius="0.36"/></Shape>'
      '<Transform translation="0 -0.62 0.05"><Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="0.37 0.78 0.91"/></Appearance>'
      '<Text DEF="HovText" string=\'""\'><FontStyle family=\'"SANS"\' size="0.26" justify=\'"MIDDLE" "END"\'/></Text></Shape></Transform></Billboard></Transform></Switch>')
    A('<Script DEF="Morph" directOutput="true">' + "".join(sf) + '<![CDATA[' + SCRIPT + ']]></Script>')
    for a_, b_, c_, d_ in [("Clock", "time", "Morph", "set_time"), ("Pick", "hitPoint_changed", "Morph", "set_hit"), ("Pick", "touchTime", "Morph", "set_click")]:
        A(f'<ROUTE fromNode="{a_}" fromField="{b_}" toNode="{c_}" toField="{d_}"/>')
    A('</Scene></X3D>')
    return "\n".join(out)


NODE_OF = {"patchCoord": "Coordinate", "gemCoord": "Coordinate", "haloCoord": "Coordinate", "fiberCoord": "Coordinate", "torusCoord": "Coordinate",
           "fiberMat": "Material", "torusMat": "Material", "patchMat": "PhysicalMaterial", "hopfSwitch": "Switch", "labelSwitch": "Switch",
           "selT": "Transform", "selText": "Text", "selSwitch": "Switch", "hovT": "Transform", "hovText": "Text", "hovSwitch": "Switch"}

if __name__ == "__main__":
    x = build()
    p = os.path.join(ROOT, "assets", "segment-sphere.x3d")
    open(p, "w", encoding="utf-8").write(x)
    print(p, len(x.encode()), "bytes;", len(SV), "services;", len(sphere_labels), "sphere labels;", len(wheel_labels), "wheel labels;", len(core_labels), "core labels")
