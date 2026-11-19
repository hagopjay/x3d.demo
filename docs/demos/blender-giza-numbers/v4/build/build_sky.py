# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 65 v4 sky: HYG v4.1 -> X3D 4.1 GaussianSplats in light-years, plus the data the page needs.
usage: build_sky.py <dir of sky_math.py> <hygdata_v41.csv> <out sky.x3d> <out sky-data.json>
Axes: equatorial J2000 (x to RA 0 h, y to RA 6 h, z to the north pole) stored as X3D (X, Y, Z) = (y, z, x).
Positions are J2000 (no space motion); the page moves the fast stars itself from the velocities in sky-data.json."""
import hashlib, json, math, sys, datetime
sys.path.insert(0, sys.argv[1])
import numpy as np
from sky_math import load_hyg, precession, to_x3d, bv_to_rgb, PC_LY

NEAREST, NAKED = 50000, 6.5
K_M_PER_LY = 1.0
rows = load_hyg(sys.argv[2])
rows.sort(key=lambda r: float(r["dist"]))
GREEK = dict(Alp="α", Bet="β", Gam="γ", Del="δ", Eps="ε", Zet="ζ", Eta="η", The="θ", Iot="ι", Kap="κ", Lam="λ", Mu="μ", Nu="ν",
             Xi="ξ", Omi="ο", Pi="π", Rho="ρ", Sig="σ", Tau="τ", Ups="υ", Phi="φ", Chi="χ", Psi="ψ", Ome="ω")
SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")

FIGURES = {   # (bayer, constellation) pairs joined by a line; a teaching set, not the full IAU figures
    "Orion": [("Alp", "Gam"), ("Alp", "Zet"), ("Gam", "Del"), ("Zet", "Eps"), ("Eps", "Del"), ("Zet", "Kap"), ("Del", "Bet"),
              ("Kap", "Bet"), ("Alp", "Lam"), ("Gam", "Lam")],
    "Canis Major": [("Alp", "Bet"), ("Alp", "Del"), ("Del", "Eps"), ("Del", "Eta")],
    "Ursa Minor": [("Alp", "Del"), ("Del", "Eps"), ("Eps", "Zet"), ("Zet", "Bet"), ("Bet", "Gam"), ("Gam", "Eta"), ("Eta", "Zet")],
    "Ursa Major": [("Alp", "Bet"), ("Bet", "Gam"), ("Gam", "Del"), ("Del", "Alp"), ("Del", "Eps"), ("Eps", "Zet"), ("Zet", "Eta")],
    "Draco": [("Lam", "Kap"), ("Kap", "Alp"), ("Alp", "Iot"), ("Iot", "The"), ("The", "Eta"), ("Eta", "Zet"), ("Zet", "Del"),
              ("Del", "Xi"), ("Xi", "Gam"), ("Gam", "Bet"), ("Bet", "Nu"), ("Nu", "Xi")],
    "Leo": [("Alp", "Eta"), ("Eta", "Gam"), ("Gam", "Zet"), ("Zet", "Mu"), ("Mu", "Eps"), ("Gam", "Del"), ("Del", "Bet"), ("Bet", "The"),
            ("The", "Alp"), ("The", "Del")],
}
ABBR = {"Orion": "Ori", "Canis Major": "CMa", "Ursa Minor": "UMi", "Ursa Major": "UMa", "Draco": "Dra", "Leo": "Leo"}
figure_keys = {(b, ABBR[c]) for c, segs in FIGURES.items() for seg in segs for b in seg}


def bayer_base(r):
    return r["bayer"].split("-")[0] if r["bayer"] else ""


keep, seen = [], set()
for i, r in enumerate(rows):
    m = float(r["mag"])
    if i < NEAREST or m <= NAKED or r["proper"] or (bayer_base(r), r["con"]) in figure_keys:
        keep.append(r)
bright = [r for r in keep if float(r["mag"]) <= NAKED]
faint = [r for r in keep if float(r["mag"]) > NAKED]
bright.sort(key=lambda r: float(r["mag"]))
stars = bright + faint                                   # global index = position in this list


def pos(r):
    return to_x3d(np.array([float(r["x"]), float(r["y"]), float(r["z"])]) * PC_LY)


def sigma_deg(m):
    return max(0.012, min(0.42, 0.10 * 10 ** (-0.13 * (m - 2))))


def opacity(m):
    return max(0.08, min(0.95, 0.95 * 10 ** (-0.20 * (m - 4.2))))


def fmt(v, n=6):
    s = "%.*g" % (n, v)
    if "e" in s:
        s = ("%.10f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def splat_fields(group, halos=False):
    P, Sc, O, Op, C = [], [], [], [], []
    for r in group:
        p = pos(r); d = float(np.linalg.norm(p)); m = float(r["mag"])
        s = math.radians(sigma_deg(m)) * d
        rgb = bv_to_rgb(float(r["ci"]) if r["ci"] else 0.6)
        P.append(" ".join(fmt(v) for v in p)); Sc.append(" ".join([fmt(s, 3)] * 3)); O.append("0 0 0 1")
        Op.append(fmt(opacity(m), 2)); C.append(" ".join(fmt((c - 0.5) / 0.28209479, 3) for c in rgb))
    n_halo = 0
    if halos:
        for r in group:
            m = float(r["mag"])
            if m > 3.0:
                continue
            p = pos(r); d = float(np.linalg.norm(p))
            s = math.radians(sigma_deg(m) * 3.6) * d
            rgb = bv_to_rgb(float(r["ci"]) if r["ci"] else 0.6)
            P.append(" ".join(fmt(v) for v in p)); Sc.append(" ".join([fmt(s, 3)] * 3)); O.append("0 0 0 1")
            Op.append(fmt(max(0.06, 0.20 - 0.035 * m), 2)); C.append(" ".join(fmt((c - 0.5) / 0.28209479, 3) for c in rgb))
            n_halo += 1
    return dict(positions=" ".join(P), scales=" ".join(Sc), orientations=" ".join(O), opacities=" ".join(Op), sh=" ".join(C)), n_halo


fb, n_halo = splat_fields(bright, halos=True)
ff, _ = splat_fields(faint)

# ---- labels: tier 1 proper names, 2 Bayer letters, 3 Flamsteed numbers, 4 Gliese ids of neighbours within 33 ly
labels = []
for i, r in enumerate(stars):
    d_ly = float(r["dist"]) * PC_LY
    name, tier = None, None
    if r["proper"]:
        name, tier = r["proper"], 1
    elif r["bayer"] and r["con"]:
        b = r["bayer"].split("-")
        g = GREEK.get(b[0], b[0]) + (b[1].translate(SUP) if len(b) > 1 else "")
        name, tier = "%s %s" % (g, r["con"]), 2
    elif r["flam"] and r["con"]:
        name, tier = "%s %s" % (r["flam"], r["con"]), 3
    elif r["gl"] and d_ly < 33:
        name, tier = r["gl"].replace("Gl ", "Gliese ").replace("GJ ", "GJ ").replace("NN ", "NN "), 4
    if name:
        labels.append(dict(i=i, n=name, t=tier, m=round(float(r["mag"]), 2), d=round(d_ly, 1 if d_ly < 100 else 0),
                           c=r["con"], s=r["spect"][:6]))

index = {}
for i, r in enumerate(stars):
    if r["bayer"] and r["con"]:
        index.setdefault((bayer_base(r), r["con"]), i)      # brightest first within the bright block
lines, missing = [], []
for cname, segs in FIGURES.items():
    for a, b in segs:
        ia, ib = index.get((a, ABBR[cname])), index.get((b, ABBR[cname]))
        if ia is None or ib is None:
            missing.append((cname, a, b)); continue
        lines.append([ia, ib, cname])

# ---- movers: stars whose space motion carries them more than 0.2 degrees between 2560 BC and today
movers = []
for i, r in enumerate(stars):
    if float(r["mag"]) > 7.0 and not r["proper"]:
        continue
    p = np.array([float(r["x"]), float(r["y"]), float(r["z"])]); v = np.array([float(r["vx"] or 0), float(r["vy"] or 0), float(r["vz"] or 0)])
    q = p - v * 4559.0
    ang = math.degrees(math.acos(max(-1, min(1, float(np.dot(p, q) / np.linalg.norm(p) / np.linalg.norm(q))))))
    if ang > 0.2 or (r["proper"] and ang > 0.005):        # every named star moves, so the page matches the receipts
        movers.append(dict(i=i, v=[float("%.4g" % x) for x in to_x3d(v * PC_LY)], a=round(ang, 3)))

# ---- precession: mean J2000 -> mean of date, as X3D-axis quaternions every 50 years
Y0, Y1, STEP = -13000, 3000, 50


def quat(R):
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1) * 2; q = [(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4]
    else:
        i = int(np.argmax(np.diag(R))); j, k = (i + 1) % 3, (i + 2) % 3
        s = math.sqrt(1 + R[i, i] - R[j, j] - R[k, k]) * 2
        q = [0, 0, 0, (R[k, j] - R[j, k]) / s]; q[i] = s / 4; q[j] = (R[j, i] + R[i, j]) / s; q[k] = (R[k, i] + R[i, k]) / s
    return q


prec, last = [], None
for y in range(Y0, Y1 + 1, STEP):
    q = quat(to_x3d(precession(y)))
    if last is not None and sum(a * b for a, b in zip(q, last)) < 0:
        q = [-a for a in q]
    last = q; prec += [round(a, 7) for a in q]

ils_coord = " ".join(" ".join(fmt(v) for v in pos(stars[i])) for ln in lines for i in ln[:2])
ils_index = " ".join("%d %d -1" % (2 * k, 2 * k + 1) for k in range(len(lines)))
esc = lambda s: s.replace("&", "&amp;").replace("'", "&apos;").replace('"', "&quot;").replace("<", "&lt;")
names_mf = " ".join('"%s"' % esc(l["n"]) for l in labels)
def bbox(positions, pad):
    """bboxCenter and bboxSize for a GaussianSplats node. X_ITE never finishes loading a splat set that is culled
    without them (Loom trap splat-bbox); pad covers the splat radii and the stars' own motion over 16,000 years."""
    p = np.array(positions.split(), float).reshape(-1, 3)
    lo, hi = p.min(axis=0) - pad, p.max(axis=0) + pad
    return "bboxCenter='%s' bboxSize='%s'" % (" ".join(fmt(v) for v in (lo + hi) / 2), " ".join(fmt(v) for v in hi - lo))


def horizon(az, el, r=1000.0):
    a, e = math.radians(az), math.radians(el)
    return " ".join(fmt(v) for v in (r * math.cos(e) * math.sin(a), r * math.sin(e), -r * math.cos(e) * math.cos(a)))


SUN, MOON = horizon(248.0, 10.0), horizon(300.0, 44.0)      # must match the bake: the lamps travel toward 68 and 120 degrees
today = datetime.date.today().strftime("%d %B %Y")
x3d = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.1//EN" "https://www.web3d.org/specifications/x3d-4.1.dtd">
<X3D profile='Interchange' version='4.1' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.1.xsd'>
<head>
<component name='GaussianSplats' level='1'/>
<component name='Shape' level='1'/>
<meta name='title' content='The sky over Giza: {len(stars)} HYG v4.1 stars as X3D 4.1 Gaussian splats'/>
<meta name='description' content='The nearest {NEAREST} stars with a known distance, every star of magnitude {NAKED} or brighter and every named star, at true 3D positions. 1 unit = 1 light-year (SkyScale stays at 1: X_ITE 16.7.1 crashed the page when the splats were scaled by 300 or more). Axes: equatorial J2000 stored as X3D (X, Y, Z) = (y, z, x). Splat sigma = angular sigma times distance, angular sigma = 0.10 deg x 10^(-0.13 (m - 2)) clipped to 0.012..0.42 deg; opacity 0.95 x 10^(-0.20 (m - 4.2)) clipped to 0.08..0.95. {n_halo} halo splats follow the {len(bright)} bright stars. Colour from B-V. Positions are J2000: no proper motion in this file. SunGlow and MoonGlow are stage lights for the baked plateau (azimuth 248 and 300 degrees), not ephemeris positions.'/>
<meta name='creator' content='x3d.io Blender pipelines lane for HagopJay'/>
<meta name='generator' content='build_sky.py (Demo 65 v4)'/>
<meta name='created' content='{today}'/>
<meta name='license' content='Star data: HYG Database v4.1 by David Nash, CC BY-SA 4.0, https://github.com/astronexus/HYG-Database'/>
<meta name='GaussianSplats.orientations.componentOrder' content='x y z w'/>
</head>
<Scene>
<WorldInfo DEF='SkyInfo' title='The sky over Giza' info='"{len(stars)} stars" "{len(labels)} labels" "HYG v4.1 CC BY-SA 4.0 David Nash"'/>
<Transform DEF='SkyFollow'>
<Transform DEF='SkyRot'>
<Transform DEF='SkyScale' scale='{K_M_PER_LY:g} {K_M_PER_LY:g} {K_M_PER_LY:g}'>
<GaussianSplats DEF='StarsBright' {bbox(fb["positions"], 60)} positions='{fb["positions"]}' scales='{fb["scales"]}' orientations='{fb["orientations"]}' opacities='{fb["opacities"]}' sphericalHarmonicsDegree0Coef0='{fb["sh"]}'/>
<GaussianSplats DEF='StarsFaint' {bbox(ff["positions"], 60)} positions='{ff["positions"]}' scales='{ff["scales"]}' orientations='{ff["orientations"]}' opacities='{ff["opacities"]}' sphericalHarmonicsDegree0Coef0='{ff["sh"]}'/>
<Shape DEF='Figures'>
<Appearance><UnlitMaterial emissiveColor='0.45 0.62 0.95' transparency='0.45'/></Appearance>
<IndexedLineSet coordIndex='{ils_index}'><Coordinate point='{ils_coord}'/></IndexedLineSet>
</Shape>
</Transform>
</Transform>
</Transform>
<GaussianSplats DEF='SunGlow' visible='false' {bbox(SUN, 700)} positions='{SUN} {SUN} {SUN} {SUN}' scales='9 9 9 40 40 40 130 130 130 330 330 330' orientations='0 0 0 1 0 0 0 1 0 0 0 1 0 0 0 1' opacities='0.99 0.6 0.32 0.2' sphericalHarmonicsDegree0Coef0='1.77 1.6 1.2 1.77 1.1 0.3 1.77 0.5 -0.6 1.6 0.1 -0.9'/>
<GaussianSplats DEF='MoonGlow' visible='false' {bbox(MOON, 220)} positions='{MOON} {MOON} {MOON}' scales='8 8 8 26 26 26 100 100 100' orientations='0 0 0 1 0 0 0 1 0 0 0 1' opacities='0.99 0.34 0.12' sphericalHarmonicsDegree0Coef0='1.6 1.65 1.77 0.9 1.1 1.6 0.2 0.5 1.4'/>
<MetadataSet DEF='StarLabels' containerField='metadata' name='StarLabels' reference='HYG v4.1'>
<MetadataString containerField='value' name='name' value='{names_mf}'/>
<MetadataInteger containerField='value' name='index' value='{" ".join(str(l["i"]) for l in labels)}'/>
<MetadataInteger containerField='value' name='tier' value='{" ".join(str(l["t"]) for l in labels)}'/>
</MetadataSet>
</Scene>
</X3D>
"""
open(sys.argv[3], "w", encoding="utf-8").write(x3d)
key = {l["n"]: l["i"] for l in labels if l["t"] == 1}
data = dict(schema="x3d.io/giza-sky/1", catalogue="HYG v4.1, David Nash, CC BY-SA 4.0", stars=len(stars), bright=len(bright), faint=len(faint),
            halos=n_halo, nearest=NEAREST, nearest_reach_ly=round(float(rows[NEAREST - 1]["dist"]) * PC_LY, 1), naked_eye_limit=NAKED,
            m_per_ly=K_M_PER_LY, labels=labels, tiers={str(t): sum(1 for l in labels if l["t"] == t) for t in (1, 2, 3, 4)},
            lines=lines, movers=movers, precession=dict(y0=Y0, step=STEP, n=len(prec) // 4, q=prec, model="ERFA ltp (Vondrak 2011)"),
            key={n: key[n] for n in ("Alnitak", "Alnilam", "Mintaka", "Thuban", "Kochab", "Sirius", "Polaris", "Betelgeuse", "Rigel", "Vega", "Regulus") if n in key},
            sky_sha256=hashlib.sha256(x3d.encode()).hexdigest())
json.dump(data, open(sys.argv[4], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("stars", len(stars), "bright", len(bright), "faint", len(faint), "halos", n_halo, "labels", len(labels), data["tiers"],
      "lines", len(lines), "missing", missing, "movers", len(movers), "x3d MB %.2f" % (len(x3d) / 1e6), "far ly %.0f" % max(float(r["dist"]) * PC_LY for r in stars))
