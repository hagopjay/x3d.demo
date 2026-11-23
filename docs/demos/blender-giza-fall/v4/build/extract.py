"""Extract what Summit Duel needs from Giza Fall v1/v3, so the duel stands on the same pyramid.

Reads:  ../v1/build/build_fall.py's documented constants and its seeded course generator (re-run here, same
        Python `random.Random(7)` stream), and ../v3/assets/fall.x3d (H-Anim joint centres, sun, sky, neighbours).
Writes: data/giza.json (frame: X3D, Y up, metres, origin at the centre of Khufu's base, north is -Z).
Standard library only. Deterministic: same inputs, same bytes (sha256 of the output is printed).
"""
import hashlib, json, math, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
V4 = os.path.dirname(HERE)
X3D = os.path.join(V4, "..", "v3", "assets", "fall.x3d")

# --- constants and the course generator, as in v1/build/build_fall.py (lines 75-86) --------------------------------
HALF_BASE, APEX, SUMMIT = 230.33 / 2, 146.6, 138.5
SEED, N_COURSES = 7, 203
rng = random.Random(SEED)
raw = [1.5 - 0.95 * (k / (N_COURSES - 1)) + rng.uniform(-0.12, 0.12) for k in range(N_COURSES)]
scale = SUMMIT / sum(raw)
heights = [h * scale for h in raw]
tops, z = [], 0.0
for h in heights:
    z += h
    tops.append(z)
half = lambda zz: HALF_BASE * (1 - zz / APEX)

src = open(X3D, "rb").read()
text = src.decode("utf-8")

# --- H-Anim joint centres of the Explorer (Blender frame: x left/right, y forward, z up; feet at z = 0) -------------
explorer = text[text.index('<HAnimHumanoid DEF="hanim_Explorer"'):text.index('</HAnimHumanoid>')]
joints = {}
for m in re.finditer(r'<HAnimJoint DEF="hanim_Explorer_(\w+)" name="(\w+)" center="([^"]+)"', explorer):
    bx, by, bz = map(float, m.group(3).split())
    # figure-local X3D frame: Y up, the figure faces -Z (Blender +Y forward becomes X3D -Z)
    joints[m.group(1)] = {"hanim": m.group(2), "center": [round(bx, 6), round(bz, 6), round(-by, 6)]}

# --- the sun (DirectionalLight direction 0 0 -1 under its Transform rotation) ----------------------------------------
def rotate(axis_angle, v):
    x, y, z, a = axis_angle
    n = math.sqrt(x * x + y * y + z * z); x, y, z = x / n, y / n, z / n
    c, s = math.cos(a), math.sin(a)
    dot = x * v[0] + y * v[1] + z * v[2]
    cross = (y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0])
    return [v[i] * c + cross[i] * s + (x, y, z)[i] * dot * (1 - c) for i in range(3)]
lights = {}
for m in re.finditer(r'<Transform DEF="OB_(Sun|Sky_fill)"[^>]*rotation="([^"]+)"[^>]*>\s*<DirectionalLight[^>]*color="([^"]+)" intensity="([^"]+)"', text):
    d = rotate(list(map(float, m.group(2).split())), [0, 0, -1])
    lights[m.group(1).lower()] = {"direction": [round(c, 6) for c in d], "color": list(map(float, m.group(3).split())), "intensity": float(m.group(4))}
bg = re.search(r'<Background skyColor="([^"]+)" skyAngle="([^"]+)" groundColor="([^"]+)"', text)

# --- neighbours: Khafre's casing cap apex (Blender frame in the file; X3D = (x, z, -y)) ------------------------------
def bounds(defname):
    body = text[text.index('DEF="%s"' % defname):]
    pts = list(map(float, re.search(r'<Coordinate point="([^"]+)"', body).group(1).split()))
    xs, ys, zs = pts[0::3], pts[1::3], pts[2::3]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))
(kx0, kx1), (ky0, ky1), (kz0, kz1) = bounds("OB_Khafre_casing_cap")

w_top = half(SUMMIT)
out = {
    "schema": "giza-summit-duel/data/1",
    "frame": "X3D: Y up, metres, origin at the centre of Khufu's base, north is -Z; skeleton is figure-local, feet at y = 0, the figure faces +Z (its r_ joints are at -X)",
    "sources": {"courses": "v1/build/build_fall.py lines 75-86 (re-run here: random.Random(7))",
                "x3d": "v3/assets/fall.x3d", "x3d_sha256": hashlib.sha256(src).hexdigest()},
    "khufu": {"half_base": HALF_BASE, "apex": APEX, "summit": SUMMIT, "summit_half": round(w_top, 6),
              "courses": N_COURSES, "tops": [round(t, 6) for t in tops],
              "half_widths": [round(half(t), 6) for t in tops]},
    "khafre_apex": [round((kx0 + kx1) / 2, 3), round(kz1, 3), round(-(ky0 + ky1) / 2, 3)],
    "mast": {"x": 0.0, "z": 0.0, "base": SUMMIT, "top": 147.6, "radius": 0.1},
    "skeleton": joints,
    "lights": lights,
    "background": {"skyColor": list(map(float, bg.group(1).split())), "skyAngle": list(map(float, bg.group(2).split())),
                   "groundColor": list(map(float, bg.group(3).split()))},
}
blob = json.dumps(out, indent=1, sort_keys=True).encode()
out_path = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(V4, "data", "giza.json")
open(out_path, "wb").write(blob)
print("summit half-width %.3f m, %d courses, top course %.3f m, joints %d, khafre apex %s" % (w_top, N_COURSES, tops[-1], len(joints), out["khafre_apex"]))
print(out_path, "sha256", hashlib.sha256(blob).hexdigest())
