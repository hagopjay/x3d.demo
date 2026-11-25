"""Build assets/salon.x3d (X3D 4.0): the Salon of Two Centuries, 1700-1899.

Usage: python -I build/build_x3d.py   (run from the demo folder)

Layout (one axis carries the time for every layer):
  z = -(year - 1700) metres. 1 m = 1 year; the spine corridor runs 200 m from 1700 to 1899.
  GALLERIES  each movement is a gallery beside the spine, from its start to its end year (clamped to the slice).
             Overlapping movements take separate lanes (greedy interval packing), so overlap is visible as
             parallel rooms. Each gallery is built in its own movement's architecture and light.
  PIGMENTS   (layer C) each new pigment stands on a pedestal in the spine at its year; a thread runs from it to
             every gallery that used it; the Pigment Tower at the far end stacks them all in date order.
  ATLAS SKY  (layer D) above the rooms, x = longitude (Europe, -10..+40 E), z = the same year axis: every
             artist is a thread from birth to death, bending through the cities they worked in; influence links
             are arcs between threads. Data from data/artists.json (optional at build time).
  PAINTINGS  data/paintings.json (optional): each work hangs on its movement's outer wall at its own year.
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
Y0, Y1 = 1700, 1899
SPINE_W, H = 6.0, 7.5
GAL_W, GAP = 8.0, 1.0


def load(name, default=None):
    p = os.path.join(ROOT, "data", name)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else default


MOV = load("movements.json")["movements"]
PIG = load("pigments.json")["pigments"]
ART = load("artists.json", {"artists": [], "influences": []})
PNT = load("paintings.json", {"paintings": []})["paintings"]
# Walk-in paintings: the depth map (Depth Anything V2 Small, run locally on CPU) pushes the painting into a room
# beyond the gallery's outer wall. mode relief = textured ElevationGrid; points = coloured PointSet (pointillism).
WALKIN = {"Q212616": dict(mode="relief", depth=4.2, n=150),
          "Q45585": dict(mode="relief", depth=3.2, n=130),
          "Q1044742": dict(mode="points", depth=4.0, n=46000)}
ROOM_D = 9.0


def f(x):
    s = f"{x:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def v3(*a):
    return " ".join(f(x) for x in a)


def hexc(h):
    h = h.lstrip("#"); return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def zc(year):
    return -(year - Y0)


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def mfs(items):
    return " ".join('"' + esc(i).replace("\\", "\\\\") + '"' for i in items)


# ---------------------------------------------------------------- materials (DEF once, USE many)
MATS = {}


def mat(name, base, rough=0.6, metal=0.0, emis=None, alpha=0.0):
    if name in MATS:
        return f'<Appearance USE="{name}"/>'
    MATS[name] = 1
    e = f' emissiveColor="{v3(*hexc(emis))}"' if emis else ""
    t = f' transparency="{f(alpha)}"' if alpha else ""
    c = hexc(base)
    if metal > 0.5:      # metal: dark diffuse, coloured specular, tight highlight
        d, sp, sh = [q * 0.55 for q in c], c, max(0.05, 0.9 - rough)
    else:                # dielectric: white-ish specular scaled by smoothness
        d, sp, sh = c, [0.5 * (1 - rough)] * 3, max(0.02, 0.6 - rough * 0.55)
    return (f'<Appearance DEF="{name}"><Material diffuseColor="{v3(*d)}" specularColor="{v3(*sp)}" shininess="{f(sh)}" '
            f'ambientIntensity="{f(0.35 if sum(c) < 2.2 else 0.12)}"{e}{t}/></Appearance>')


def box(pos, size, app, extra=""):
    return f'<Transform translation="{v3(*pos)}"{extra}><Shape>{app}<Box size="{v3(*size)}"/></Shape></Transform>'


def cyl(pos, r, h, app, rot=None):
    rr = f' rotation="{v3(*rot)}"' if rot else ""
    return f'<Transform translation="{v3(*pos)}"{rr}><Shape>{app}<Cylinder radius="{f(r)}" height="{f(h)}"/></Shape></Transform>'


def extrusion(spine, cross, app, scale=None, solid=False, cap=True):
    sc = f' scale="{" ".join(v3(*s) for s in scale)}"' if scale else ""
    return (f'<Shape>{app}<Extrusion solid="{str(solid).lower()}" beginCap="{str(cap).lower()}" endCap="{str(cap).lower()}" '
            f'crossSection="{" ".join(v3(*p) for p in cross)}" spine="{" ".join(v3(*p) for p in spine)}"{sc}/></Shape>')


def circle(r, n=10):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]


def label(pos, text, size=0.6, color="#f3ead8", justify="MIDDLE", face=None, rot=None):
    rr = f' rotation="{v3(*rot)}"' if rot else ""
    fs = face or "SERIF"
    items = text if isinstance(text, list) else [text]
    st = mfs(items).replace("'", "&apos;")
    return (f'<Transform translation="{v3(*pos)}"{rr}><Shape><Appearance><Material diffuseColor="0 0 0" '
            f'emissiveColor="{v3(*hexc(color))}"/></Appearance><Text string=\'{st}\'>'
            f'<FontStyle family=\'"{fs}"\' size="{f(size)}" justify=\'"{justify}" "MIDDLE"\'/></Text></Shape></Transform>')


# ---------------------------------------------------------------- lanes (greedy interval packing)
def lanes():
    out, ends = {}, {"L": [], "R": []}
    for m in sorted(MOV, key=lambda m: max(m["start"], Y0)):
        a, b = max(m["start"], Y0), min(m["end"], Y1)
        placed = False
        for k in range(4):
            for side in (("L", "R") if k == 0 else ("R", "L")):
                e = ends[side]
                while len(e) <= k:
                    e.append(Y0 - 99)
                if e[k] + 2 <= a and not placed:
                    e[k] = b; out[m["id"]] = (side, k, a, b); placed = True
        assert placed, m["id"]
    return out


LANES = lanes()


def passages(mid):
    """Openings in a lane-0 gallery's outer wall wherever a lane-1 gallery runs behind it (else it is unreachable)."""
    side, k, a, b = LANES[mid]
    out = []
    if k != 0:
        return out
    for o, (s2, k2, a2, b2) in LANES.items():
        if s2 == side and k2 == 1:
            lo, hi = max(a, a2), min(b, b2)
            y = lo + 2.5
            while y <= hi - 2:
                out.append((zc(y), 3.6)); y += 7
    return out


def lane_x(side, k):
    off = SPINE_W / 2 + GAP + GAL_W / 2 + k * (GAL_W + GAP)
    return -off if side == "L" else off


# ---------------------------------------------------------------- walk-in paintings
DOORS = {}


def walkin_ready(p):
    return (os.path.exists(os.path.join(ROOT, "paintings", p["file"])) and
            os.path.exists(os.path.join(ROOT, "depth", p["id"] + ".png")))


def walkin_w(p):
    pw, ph = p.get("px", [4, 3])
    return min(5.6, 5.4 * pw / ph)


def walkin_z(p):
    """Door centre (z) for a walk-in: at its year when it fits, clamped inside the gallery, packed apart from siblings."""
    sib = sorted((q for q in PNT if q["id"] in WALKIN and q["movement"] == p["movement"] and walkin_ready(q)), key=lambda q: q["year"])
    _, _, a, b = LANES[p["movement"]]
    zs, prev = {}, None
    for q in sib:
        w = walkin_w(q) + 0.8
        z = min(zc(q["year"]), zc(a) - w / 2 - 0.3)
        if prev is not None:
            z = min(z, prev[0] - prev[1] / 2 - w / 2 - 0.2)
        zs[q["id"]] = z; prev = (z, w)
    over = zc(b) + walkin_w(sib[-1]) / 2 + 0.7 - prev[0] if sib else 0
    if over > 0:   # shift the whole run back toward the gallery start
        zs = {k: v + over for k, v in zs.items()}
    return zs[p["id"]]


def walkin(p, walls):
    from PIL import Image
    cfg = WALKIN[p["id"]]
    x, wx, out = walls[p["movement"]]
    img = Image.open(os.path.join(ROOT, "paintings", p["file"])).convert("RGB")
    dep = Image.open(os.path.join(ROOT, "depth", p["id"] + ".png")).convert("L").resize(img.size)
    W = walkin_w(p); Hh = W * img.size[1] / img.size[0]
    D = cfg["depth"]
    zdoor = walkin_z(p)
    th = -out * math.pi / 2
    room = []
    # dark room shell (floor, ceiling, two side walls) in local coords: door at z = ROOM_D, relief plane at z = 0
    RW = W + 0.6
    room.append(box((0, -0.05, ROOM_D / 2 - D / 2), (RW, 0.1, ROOM_D + D), mat("walkin_floor", "#0d0c0b", 0.9)))
    room.append(box((0, H + 0.05, ROOM_D / 2 - D / 2), (RW, 0.1, ROOM_D + D), mat("walkin_ceil", "#050505", 1.0)))
    for sx in (-1, 1):
        room.append(box((sx * RW / 2, H / 2, ROOM_D / 2 - D / 2), (0.1, H, ROOM_D + D), mat("walkin_wall", "#100f0e", 0.95)))
    room.append(box((0, H / 2, -D - 0.1), (RW, H, 0.1), mat("walkin_wall", "#100f0e")))
    y0 = 0.6
    if cfg["mode"] == "relief":
        n = cfg["n"]; m = max(2, int(round(n * Hh / W)))
        di = dep.resize((n, m), Image.BILINEAR)
        # Depth Anything gives relative inverse depth (bright = near). Near stays on the picture plane, far recedes.
        hv = []
        for j in range(m):          # ElevationGrid row j is the image row from the BOTTOM (rotation -90 deg about X)
            for i in range(n):
                v = di.getpixel((i, m - 1 - j)) / 255.0
                hv.append(-(1.0 - v) ** 1.3 * D)
        rel = (f'<Transform translation="{v3(-W / 2, y0, 0)}" rotation="1 0 0 -1.5708">'
               f'<Shape><Appearance><UnlitMaterial emissiveColor="0.95 0.95 0.95"/>'
               f'<ImageTexture url=\'"../paintings/{p["file"]}"\' repeatS="false" repeatT="false"/></Appearance>'
               f'<ElevationGrid solid="false" creaseAngle="0" xDimension="{n}" zDimension="{m}" xSpacing="{f(W / (n - 1))}" zSpacing="{f(Hh / (m - 1))}" '
               f'height="{" ".join(f(-h) for h in hv)}"/></Shape></Transform>')
        # note: rotation -90 about X sends grid +z to world +y and height +y to world -z, so heights are written negated
        room.append(rel)
    else:
        import random
        rnd = random.Random(1884)
        sm = img.resize((img.size[0] // 2, img.size[1] // 2)); dm = dep.resize(sm.size)
        pts, cols = [], []
        for _ in range(cfg["n"]):
            u, v = rnd.random(), rnd.random()
            px_, py_ = int(u * (sm.size[0] - 1)), int(v * (sm.size[1] - 1))
            near = dm.getpixel((px_, py_)) / 255.0
            c = sm.getpixel((px_, py_))
            pts.append((-W / 2 + u * W, y0 + (1 - v) * Hh, -(1 - near) ** 1.3 * cfg["depth"] + rnd.gauss(0, 0.02)))
            cols.append(tuple(ch / 255 for ch in c))
        room.append(f'<Shape><Appearance><Material emissiveColor="1 1 1"/><PointProperties pointSizeScaleFactor="3" pointSizeMinValue="2" pointSizeMaxValue="6"/></Appearance>'
                    f'<PointSet><Coordinate point="{" ".join(f"{f(a)} {f(b)} {f(c)}" for a, b, c in pts)}"/>'
                    f'<Color color="{" ".join(f"{q[0]:.2f} {q[1]:.2f} {q[2]:.2f}" for q in cols)}"/></PointSet></Shape>')
    room.append(label((0, H - 0.6, ROOM_D - 0.6), [f'Walk into: {p["title"]} ({p["year"]})',
                       f'{p["artist"]} \u00b7 depth by Depth Anything V2 Small, estimated, not measured'], 0.18, "#f3ead8", face="SANS"))
    room.append(f'<PointLight global="false" location="0 {f(H - 1)} {f(ROOM_D - 1)}" intensity="0.4" color="1 0.95 0.9" radius="20"/>')
    room.append(f'<Viewpoint DEF="VP_W_{p["id"]}" description="Walk into {esc(p["title"])}" position="0 2.6 {f(ROOM_D - 3.2)}" fieldOfView="1.05"/>')
    cx = wx + out * ROOM_D
    return (f'<Transform DEF="WALKIN_{p["id"]}" translation="{v3(cx, 0, zdoor)}" rotation="0 1 0 {f(th)}">'
            + "".join(room) + "</Transform>")


# ---------------------------------------------------------------- per-movement architecture
def gallery(m):
    side, k, a, b = LANES[m["id"]]
    x = lane_x(side, k); z0, z1 = zc(a), zc(b); L = z0 - z1; zm = (z0 + z1) / 2
    out_sign = -1 if side == "L" else 1           # outer wall direction
    wx = x + out_sign * GAL_W / 2                   # outer wall plane
    s = []
    mid = m["id"]
    P = {  # wall, floor, ceiling, trim, light colour, light intensity
        "baroque": ("#4a1014", "#1b1410", "#120c0a", "#b8902e", "#ffcf8a", 1.2),
        "rococo": ("#b9d0db", "#d6c7ad", "#eae3d6", "#d9b45a", "#fff1dd", 0.32),
        "neoclassicism": ("#dcd8cf", "#bfb8ab", "#e4e0d8", "#f4f1ea", "#f4f7ff", 0.3),
        "romanticism": ("#26304a", "#2a2522", "#1a1f30", "#9a7a4a", "#ffb766", 1.1),
        "realism": ("#8a4b35", "#5a4a3c", "#3a3430", "#2c2c2e", "#e8eef5", 0.9),
        "impressionism": ("#e4dfd3", "#b8a98e", "#eef6ff", "#cfc8b8", "#fffaf0", 0.3),
        "postimpressionism": ("#1f3bb0", "#c89a3c", "#f0c419", "#1a1a1a", "#fff2c4", 1.1),
        "symbolism": ("#24122e", "#120a16", "#0c0610", "#c9a227", "#ffcf70", 1.0),
        "artnouveau": ("#1e4a44", "#3a2c1c", "#1a3832", "#4f8a5b", "#ffd69a", 1.0),
    }[mid]
    wall, floor, ceil, trim, lc, li = P
    rough = {"rococo": 0.35, "neoclassicism": 0.25, "symbolism": 0.5}.get(mid, 0.8)
    s.append(box((x, -0.05, zm), (GAL_W, 0.1, L), mat(f"floor_{mid}", floor, 0.45 if mid in ("neoclassicism", "rococo") else 0.85)))
    doors = []
    for p in PNT:
        if p["id"] in WALKIN and p["movement"] == mid and walkin_ready(p):
            doors.append((walkin_z(p), walkin_w(p) + 0.8))
    doors_all = doors + passages(mid)
    edges = [z0]
    for zd, wd in sorted(doors_all, reverse=True):
        edges += [zd + wd / 2, zd - wd / 2]
    edges.append(z1)
    for i in range(0, len(edges), 2):
        za, zb = edges[i], edges[i + 1]
        if za - zb > 0.05:
            s.append(box((wx, H / 2, (za + zb) / 2), (0.3, H, za - zb), mat(f"wall_{mid}", wall, rough)))
    for zd, wd in doors_all:   # lintel over each doorway
        s.append(box((wx, H - 0.9, zd), (0.34, 1.8, wd), mat(f"trim_{mid}", trim)))
    DOORS[mid] = doors_all
    # end walls with door gap toward the spine is open: only the outer half closed
    for ze in (z0, z1):
        s.append(box((x + out_sign * GAL_W / 4, H / 2, ze), (GAL_W / 2, H, 0.3), mat(f"wall_{mid}", wall)))
    glass_roof = mid in ("impressionism", "realism", "artnouveau")
    if not glass_roof:
        s.append(box((x, H + 0.05, zm), (GAL_W + 0.3, 0.1, L), mat(f"ceil_{mid}", ceil, 0.9)))
    else:
        s.append(box((x, H + 0.05, zm), (GAL_W + 0.3, 0.05, L), mat("glass", "#dfefff", 0.05, 0.0, None, 0.82)))
    # skirting + cornice trim along the outer wall
    s.append(box((wx - out_sign * 0.18, 0.18, zm), (0.08, 0.36, L), mat(f"trim_{mid}", trim, 0.35, 0.9 if mid in ("rococo", "baroque", "symbolism") else 0.0)))
    s.append(box((wx - out_sign * 0.18, H - 0.25, zm), (0.12, 0.3, L), mat(f"trim_{mid}", trim)))
    n = max(2, int(L // 6))
    zs = [z0 - (i + 0.5) * L / n for i in range(n)]
    if mid == "baroque":
        # heavy gilt pilasters, raking light from one high window (chiaroscuro)
        for z in zs:
            s.append(box((wx - out_sign * 0.25, H / 2, z), (0.25, H, 0.55), mat("gilt", "#b8902e", 0.3, 1.0)))
    elif mid == "rococo":
        # boiserie panels with gilt C-scrolls (rocaille) and mirrors between
        for z in zs:
            s.append(box((wx - out_sign * 0.17, H / 2, z), (0.04, 4.6, 2.2), mat("rococo_panel", "#e6f0f2", 0.5)))
            for sy in (1, -1):
                spine = [(wx - out_sign * 0.22, H / 2 + sy * (1.9 + 0.5 * math.sin(t / 6 * math.pi)), z - 1.0 + t / 6 * 2.0) for t in range(7)]
                s.append(extrusion(spine, circle(0.05, 6), mat("gilt", "#b8902e", 0.3, 1.0)))
            s.append(box((wx - out_sign * 0.16, H / 2, z + L / n / 2), (0.03, 4.0, 0.9), mat("mirror", "#e8eef0", 0.04, 1.0)))
    elif mid == "neoclassicism":
        flute = [(0.32 * (1 if i % 2 == 0 else 0.92) * math.cos(2 * math.pi * i / 40), 0.32 * (1 if i % 2 == 0 else 0.92) * math.sin(2 * math.pi * i / 40)) for i in range(41)]
        for z in zs:
            for cx in (x - out_sign * (GAL_W / 2 - 0.7), wx - out_sign * 0.7):
                s.append(f'<Transform translation="{v3(cx, 0, z)}"><Shape>{mat("marble", "#f2f0ea", 0.25)}<Extrusion solid="false" crossSection="{" ".join(v3(a, b) for a, b in flute)}" spine="0 0.3 0 0 {f(H - 0.6)} 0"/></Shape></Transform>')
                s.append(box((cx, 0.15, z), (0.9, 0.3, 0.9), mat("marble", "#f2f0ea")))
                s.append(box((cx, H - 0.45, z), (0.9, 0.3, 0.9), mat("marble", "#f2f0ea")))
        for i in range(n * 2):  # coffers
            s.append(box((x, H - 0.1, z0 - (i + 0.5) * L / (n * 2)), (GAL_W - 1.2, 0.2, L / (n * 2) - 0.6), mat("coffer", "#d9d4c6", 0.6)))
    elif mid == "romanticism":
        # Gothic Revival pointed-arch ribs
        for z in zs:
            pts = []
            hw = GAL_W / 2; r = GAL_W * 0.8
            for t in range(13):
                a_ = t / 12
                if a_ <= 0.5:
                    th = math.pi - math.acos(((hw) - (2 * a_ * hw)) / r) if False else None
                xx = -hw + a_ * 2 * hw
                # pointed arch: two circular arcs centred at +-(r-hw)
                c = (r - hw) if xx < 0 else -(r - hw)
                yy = math.sqrt(max(0.0, r * r - (xx - c) ** 2))
                pts.append((x + xx, H * 0.55 + yy * 0.75, z))
            s.append(extrusion(pts, circle(0.09, 6), mat("stone_rib", "#8f8576", 0.8)))
    elif mid == "realism":
        for z in zs:  # iron trusses
            for t in range(-4, 5):
                pass
            sp = [(x - GAL_W / 2, H - 0.2, z), (x, H - 1.4, z), (x + GAL_W / 2, H - 0.2, z)]
            s.append(extrusion(sp, circle(0.06, 6), mat("iron", "#2c2c2e", 0.5, 1.0)))
            s.append(extrusion([(x - GAL_W / 2, H - 0.2, z), (x + GAL_W / 2, H - 0.2, z)], circle(0.05, 6), mat("iron", "#2c2c2e")))
    elif mid == "impressionism":
        pass  # emptiness is the style: white walls and sky
    elif mid == "postimpressionism":
        for z in zs:
            s.append(box((wx - out_sign * 0.16, H - 1.1, z), (0.03, 0.5, L / n - 0.4), mat("chrome_band", "#f0c419", 0.7)))
    elif mid == "symbolism":
        # gold-leaf mosaic band: one IndexedFaceSet of small tesserae with per-face colour
        coords, idx, cols = [], [], []
        import random
        rnd = random.Random(79)
        nz, ny = int(L / 0.25), 8
        for j in range(ny):
            for i in range(nz):
                zz = z0 - i * 0.25; yy = H - 2.2 + j * 0.25
                xx = wx - out_sign * 0.16
                b0 = len(coords)
                coords += [(xx, yy, zz), (xx, yy, zz - 0.22), (xx, yy + 0.22, zz - 0.22), (xx, yy + 0.22, zz)]
                idx.append(f"{b0} {b0 + 1} {b0 + 2} {b0 + 3} -1")
                g = rnd.random()
                cols.append((0.75 + 0.2 * g, 0.55 + 0.2 * g, 0.12 + 0.1 * rnd.random()) if rnd.random() > 0.12 else (0.25, 0.1, 0.45))
        s.append(f'<Shape>{mat("mosaic", "#ffffff", 0.35, 0.85)}<IndexedFaceSet solid="false" colorPerVertex="false" coordIndex="{" ".join(idx)}">'
                 f'<Coordinate point="{" ".join(v3(*p) for p in coords)}"/><Color color="{" ".join(v3(*c) for c in cols)}"/></IndexedFaceSet></Shape>')
    elif mid == "artnouveau":
        # whiplash ironwork: a sinuous curve springing from the floor and lashing back under the glass roof
        for z in zs:
            sp = []
            for t in range(25):
                u = t / 24
                sp.append((wx - out_sign * (0.3 + 2.6 * u * u), 0.2 + (H - 0.6) * math.sin(u * math.pi / 2), z + 0.9 * math.sin(u * 3 * math.pi) * (1 - u)))
            s.append(extrusion(sp, circle(0.07, 8), mat("bronze", "#4f8a5b", 0.35, 1.0), scale=[(1.6 - u, 1.6 - u) for u in [t / 24 for t in range(25)]]))
            s.append(f'<Transform translation="{v3(*sp[-1])}"><Shape>{mat("amber_glass", "#ffb347", 0.1, 0.0, "#ff9a2e")}<Sphere radius="0.22"/></Shape></Transform>')
    # movement title on the spine-side lintel + graded notes plaque
    lx = x - out_sign * (GAL_W / 2 - 0.2)
    ry = (0, 1, 0, math.pi / 2 * (1 if side == "L" else -1))
    s.append(label((x, H - 0.8, z0 - 0.4), [m["name"], f"{m['start']}–{m['end']}"], 0.55, "#fff4d6", rot=None))
    notes = [f"{t}  [{g.split(':')[0]}]" for t, g in m["notes"]]
    s.append(label((wx - out_sign * 0.2, 1.4, z0 - 1.8), notes, 0.22, "#f3ead8", "BEGIN", rot=(0, 1, 0, -math.pi / 2 * out_sign)))
    # local light (scoped to the gallery group)
    nl = max(2, min(4, int(L // 14) + 1))
    light = "".join(f'<PointLight global="false" location="{v3(x, H - 0.9, z0 - (i + 0.5) * L / nl)}" color="{v3(*hexc(lc))}" '
                    f'intensity="{f(li * 1.6)}" ambientIntensity="{f(0.25 * min(1, li))}" radius="{f(L / nl * 1.6 + 8)}" attenuation="0.6 0.06 0.004"/>' for i in range(nl))
    if mid == "baroque":
        light = (f'<SpotLight global="false" location="{v3(x - out_sign * 3.0, H + 2, z0)}" direction="{v3(out_sign * 0.5, -0.6, -0.6)}" '
                 f'color="{v3(*hexc(lc))}" intensity="3" beamWidth="0.7" cutOffAngle="1.0" radius="120"/>' +
                 f'<PointLight global="false" location="{v3(x, 3, zm)}" color="1 0.7 0.45" intensity="1.2" ambientIntensity="0.15" radius="60" attenuation="0.8 0.04 0.002"/>')
    return (f'<Group DEF="G_{mid}"><MetadataString containerField="metadata" name="movement" value=\'"{mid}"\'/>'
            + light + "".join(s) + "</Group>"), (x, wx, out_sign)


# ---------------------------------------------------------------- paintings
def paint_size(p):
    """Real size in metres when Wikidata has it (P2048/P2049); else 1.2 m tall at the image's own aspect."""
    pw, ph = p.get("px", [4, 3])
    if p.get("h_cm") and p.get("w_cm"):
        h, w = p["h_cm"] / 100, p["w_cm"] / 100
        # trust the image's aspect if Wikidata's h/w disagree with it by > 25 % (swapped or frame sizes)
        if abs((w / h) / (pw / ph) - 1) > 0.25:
            w = h * pw / ph
        return w, h, "Wikidata P2048/P2049"
    return 1.2 * pw / ph, 1.2, "not on Wikidata: 1.2 m tall at image aspect"


def paintings(walls):
    s, by = [], {}
    for p in PNT:
        if p["id"] in WALKIN and walkin_ready(p):
            continue
        if p["movement"] in walls and os.path.exists(os.path.join(ROOT, "paintings", p["file"])):
            by.setdefault(p["movement"], []).append(p)
    for mv, ps in by.items():
        x, wx, out = walls[mv]
        _, _, a, b = LANES[mv]
        # spread along the wall in year order, at least 0.9 m apart; keep each near its own year when room allows
        ps.sort(key=lambda p: p["year"])
        zcur = zc(a) - 2.5
        for p in ps:
            w, h, src = paint_size(p)
            k = min(1.0, (H - 1.9) / h, 6.5 / w)          # very large canvases are shown reduced; the plaque says so
            w, h = w * k, h * k
            zt = zc(p["year"])
            z = min(zcur - w / 2, zt) if zt < zcur - w / 2 else zcur - w / 2
            for zd, wd in DOORS.get(mv, []):      # never hang across a walk-in doorway
                if abs(z - zd) < wd / 2 + w / 2 + 0.3:
                    z = zd - wd / 2 - w / 2 - 0.4
            z = max(z, zc(b) + w / 2 + 0.6)
            zcur = z - w / 2 - 0.9
            fr = 0.06 + 0.025 * max(w, h)
            cy = 1.55 + h / 2
            px = wx - out * 0.2
            rot = (0, 1, 0, -math.pi / 2 * out)
            scale_note = f"shown at {round(k * 100)} % of" if k < 0.999 else "shown at"
            s.append(f'<Transform DEF="P_{p["id"]}" translation="{v3(px, cy, z)}" rotation="{v3(*rot)}">'
                     f'<MetadataSet containerField="metadata" name="painting"><MetadataString name="wikidata" value=\'"{p["id"]}"\'/>'
                     f'<MetadataInteger name="year" value="{p["year"]}"/><MetadataString name="size_source" value=\'"{esc(src)}"\'/></MetadataSet>'
                     f'<TouchSensor DEF="TS_{p["id"]}" description="{esc(p["title"])}"/>'
                     f'<Transform translation="0 0 -0.05"><Shape>{mat("frame_gilt", "#a8822a", 0.32, 1.0)}<Box size="{v3(w + 2 * fr, h + 2 * fr, 0.08)}"/></Shape></Transform>'
                     f'<Shape><Appearance><UnlitMaterial emissiveColor="0.93 0.92 0.9"/>'
                     f'<ImageTexture url=\'"../paintings/{esc(p["file"])}"\' repeatS="false" repeatT="false"/></Appearance>'
                     f'<Rectangle2D solid="true" size="{v3(w, h)}"/></Shape>'
                     + label((0, -h / 2 - fr - 0.22, 0.01), [f'{p["title"]} ({p["year"]})', f'{p["artist"]} · {scale_note} real size'], 0.11, "#f3ead8")
                     + f'<SpotLight global="false" location="0 {f(h / 2 + 1.2)} 2.4" direction="0 -0.5 -1" beamWidth="0.5" cutOffAngle="0.8" intensity="1.6" color="1 0.95 0.86" radius="14"/>'
                     '</Transform>')
    return "".join(s)


# ---------------------------------------------------------------- spine corridor
def spine():
    s = []
    L = Y1 - Y0 + 1
    s.append(box((0, -0.05, -L / 2 + 8), (SPINE_W, 0.1, L + 18), mat("spine_floor", "#2a241e", 0.35)))
    s.append(box((0, -0.06, 12), (60, 0.1, 16), mat("plaza", "#1a1612", 0.5)))
    s.append(label((0, 6.6, 1.0), ["Salon of Two Centuries", "1700 \u2192 1899 \u00b7 one metre is one year"], 0.7, "#e6c87a"))
    for y in range(Y0, Y1 + 1):
        z = zc(y)
        if y % 10 == 0:
            s.append(box((0, 0.006, z), (SPINE_W, 0.012, 0.06), mat("brass", "#c9a54e", 0.3, 1.0)))
            s.append(label((-SPINE_W / 2 + 0.7, 0.02, z - 0.4), str(y), 0.5, "#e6c87a", rot=(1, 0, 0, -math.pi / 2)))
        elif y % 5 == 0:
            s.append(box((0, 0.004, z), (SPINE_W * 0.4, 0.008, 0.03), mat("brass", "#c9a54e")))
    return "".join(s)


# ---------------------------------------------------------------- pigments (layer C)
def pigments(walls):
    s, th = [], []
    for i, p in enumerate(PIG):
        z = zc(p["year"]); xx = (SPINE_W / 2 - 0.8) * (1 if i % 2 else -1) * 0.6
        c = p["rgb"]
        s.append(cyl((xx, 0.5, z), 0.28, 1.0, mat("pedestal", "#d8d0c0", 0.4)))
        s.append(f'<Transform translation="{v3(xx, 1.35, z)}"><Shape>{mat("pg_" + str(i), c, 0.4, 0.0, c)}<Sphere radius="0.26"/></Shape></Transform>')
        s.append(label((xx, 1.9, z), [p["name"], str(p["year"])], 0.16, "#ffffff"))
        for mv in p["used"]:
            if mv not in walls:
                continue
            gx = walls[mv][0]
            _, _, a, b = LANES[mv]
            tz = zc(max(a, min(b, p["year"] + 15)))
            pts = [(xx + (gx - xx) * t / 16, 1.35 + 4.0 * math.sin(math.pi * t / 16), z + (tz - z) * t / 16) for t in range(17)]
            th.append(f'<Shape><Appearance><Material emissiveColor="{v3(*hexc(c))}" transparency="0.35"/></Appearance>'
                     f'<LineSet vertexCount="17"><Coordinate point="{" ".join(v3(*q) for q in pts)}"/></LineSet></Shape>')
    # the tower at the end of the corridor: one storey per pigment, in date order
    zt = zc(Y1) - 14
    for i, p in enumerate(sorted(PIG, key=lambda q: q["year"])):
        y = 0.6 + i * 0.9
        s.append(box((0, y, zt), (3.2 - i * 0.12, 0.7, 3.2 - i * 0.12), mat("pgt_" + str(i), p["rgb"], 0.35, 0.0, p["rgb"]),
                     extra=f' rotation="0 1 0 {f(i * 0.2)}"'))
        s.append(label((2.6, y, zt + 1.9), f'{p["year"]}  {p["name"]}', 0.24, "#ffffff", "BEGIN"))
    s.append(label((0, 0.6 + len(PIG) * 0.9 + 0.6, zt), ["The Pigment Tower", "new colours, 1704–1868"], 0.5, "#fff4d6"))
    return "".join(s) + f'<Switch DEF="PIG_SW" whichChoice="0"><Group>{"".join(th)}</Group></Switch>'


# ---------------------------------------------------------------- Atlas sky (layer D)
SKY_Y = H + 16.0
MCOL = {"baroque": "#e0503f", "rococo": "#f5a8c8", "neoclassicism": "#f2f0ea", "romanticism": "#5d8bf4", "realism": "#d39a55",
        "impressionism": "#7fd3ff", "postimpressionism": "#ffd23f", "symbolism": "#b77cff", "artnouveau": "#4fd1a5"}


def lon_x(lon):
    """Europe (-12..45 E) at 0.9 m per degree; beyond it compressed to 0.18 m per degree (the Americas, Asia)."""
    if lon < -12:
        return (-12 - 15) * 0.9 - (-12 - lon) * 0.18
    if lon > 45:
        return (45 - 15) * 0.9 + (lon - 45) * 0.18
    return (lon - 15) * 0.9


def geo(lat, lon, year):
    return (lon_x(lon), SKY_Y + (max(30, min(66, lat)) - 45) * 0.55, zc(max(Y0, min(Y1, year))))


def atlas():
    cities = ART.get("cities", {})
    arts = ART.get("artists", [])
    use = {}
    for a in arts:
        for _, c in a["path"]:
            use[c] = use.get(c, 0) + 1
    s = []
    # city meridians: one IndexedLineSet, the 24 busiest cities labelled at both ends of time
    pts, idx = [], []
    top = sorted(use, key=lambda c: -use[c])[:24]
    for c in top:
        lat, lon = cities[c]
        p0, p1 = geo(lat, lon, Y0), geo(lat, lon, Y1)
        idx.append(f"{len(pts)} {len(pts) + 1} -1"); pts += [p0, p1]
        s.append(label((p0[0], p0[1] + 0.35, p0[2] + 1.2), f"{c} ({use[c]})", 0.42, "#a9c1ff", face="SANS"))
    s.append(f'<Shape><Appearance><Material emissiveColor="0.22 0.3 0.5" transparency="0.3"/></Appearance>'
             f'<IndexedLineSet coordIndex="{" ".join(idx)}"><Coordinate point="{" ".join(v3(*p) for p in pts)}"/></IndexedLineSet></Shape>')
    # other cities as points at their first use
    rest = [cities[c] for c in use if c not in top]
    s.append(f'<Shape><Appearance><Material emissiveColor="0.45 0.55 0.8"/></Appearance><PointSet><Coordinate point="{" ".join(v3(*geo(la, lo, 1800)) for la, lo in rest)}"/></PointSet></Shape>')
    # artist threads: one IndexedLineSet, colour per vertex from movement
    pts, idx, col, pos = [], [], [], {}
    for a in arts:
        seq = []
        for yr, c in a["path"]:
            lat, lon = cities[c]
            seq.append(geo(lat, lon, yr))
        if len(seq) == 1:
            seq = [seq[0], (seq[0][0], seq[0][1], zc(max(Y0, min(Y1, a["died"]))))]
        pos[a["id"]] = seq
        b0 = len(pts); pts += seq; col += [hexc(MCOL.get(a["movement"], "#ffffff"))] * len(seq)
        idx.append(" ".join(str(b0 + i) for i in range(len(seq))) + " -1")
    s.append(f'<Shape DEF="ARTIST_THREADS"><Appearance><Material emissiveColor="1 1 1"/></Appearance>'
             f'<IndexedLineSet colorPerVertex="true" coordIndex="{" ".join(idx)}"><Coordinate point="{" ".join(v3(*p) for p in pts)}"/>'
             f'<Color color="{" ".join(v3(*c) for c in col)}"/></IndexedLineSet></Shape>')
    # artist names: the 90 with the most Wikipedia articles (sitelinks), at their birth
    for a in sorted(arts, key=lambda a: -a["sitelinks"])[:90]:
        p = pos[a["id"]][0]
        s.append(label((p[0], p[1] + 0.22, p[2]), f'{a["name"]} {a["born"]}–{a["died"]}', 0.2, MCOL.get(a["movement"], "#ffffff"), face="SANS"))
    # influence and teaching arcs: one IndexedLineSet; gold = influenced by (P737), white = student of (P1066)
    for kind, c in (("influenced", "1 0.8 0.35"), ("taught", "0.9 0.95 1")):
        pts, idx = [], []
        for (src, dst, k) in ART.get("influences", []):
            if k != kind or src not in pos or dst not in pos:
                continue
            A_, B_ = pos[src][-1 if len(pos[src]) < 3 else len(pos[src]) // 2], pos[dst][0]
            b0 = len(pts)
            for t in range(11):
                u = t / 10
                pts.append(tuple(A_[i] + (B_[i] - A_[i]) * u + (1.6 * math.sin(math.pi * u) if i == 1 else 0) for i in range(3)))
            idx.append(" ".join(str(b0 + i) for i in range(11)) + " -1")
        if pts:
            s.append(f'<Shape><Appearance><Material emissiveColor="{c}" transparency="0.45"/></Appearance>'
                     f'<IndexedLineSet coordIndex="{" ".join(idx)}"><Coordinate point="{" ".join(v3(*p) for p in pts)}"/></IndexedLineSet></Shape>')
    s.append(label((0, SKY_Y + 6.5, zc(Y0) + 3), ["Atlas sky: where the painters were, year by year",
                                                  f"{len(arts)} painters · {len(ART.get('influences', []))} influence and teaching links · Wikidata (CC0)"], 0.8, "#ffffff", face="SANS"))
    return f'<Switch DEF="ATLAS_SW" whichChoice="0"><Group DEF="ATLAS_SKY">{"".join(s)}</Group></Switch>'


def lookat(eye, tgt):
    """Axis-angle orientation that turns the default view (-Z forward, +Y up) toward tgt."""
    fx, fy, fz = (tgt[i] - eye[i] for i in range(3)); n = math.sqrt(fx * fx + fy * fy + fz * fz); fx, fy, fz = fx / n, fy / n, fz / n
    yaw = math.atan2(-fx, -fz); pitch = math.asin(fy)
    cy, sy, cp, sp = math.cos(yaw / 2), math.sin(yaw / 2), math.cos(pitch / 2), math.sin(pitch / 2)
    w, x, y, z = cy * cp, cy * sp, sy * cp, -sy * sp     # q = qYaw(Y) * qPitch(X)
    a = 2 * math.acos(max(-1, min(1, w))); k = math.sqrt(max(1e-12, 1 - w * w))
    return (x / k, y / k, z / k, a)


def viewpoints():
    vps = [("Entrance, 1700", (0, 3.0, 14), (1, 0, 0, -0.06))]
    for m in MOV:
        side, k, a, b = LANES[m["id"]]
        x = lane_x(side, k)
        out = -1 if side == "L" else 1
        eye = (x - out * (GAL_W / 2 - 1.2), 1.75, zc(a) - 0.8)
        vps.append((f"{m['name']}", eye, lookat(eye, (x + out * GAL_W / 2, 2.6, zc(a) - 16))))
    vps.append(("The Pigment Tower", (0, 4, zc(Y1) - 2), (0, 1, 0, 0)))
    vps.append(("Atlas sky: artists over time", (34, SKY_Y + 13, -12), lookat((34, SKY_Y + 13, -12), (-4, SKY_Y - 2, -110))))
    return "".join(f'<Viewpoint DEF="VP_{i:02d}" description="{esc(d)}" position="{v3(*p)}" orientation="{v3(*o)}" fieldOfView="0.9"/>'
                   for i, (d, p, o) in enumerate(vps))


def main():
    walls, gals = {}, []
    for m in MOV:
        g, w = gallery(m); gals.append(g); walls[m["id"]] = w
    body = (f'<WorldInfo title="Salon of Two Centuries, 1700-1899 (Demo 79)" info=\'"1 m = 1 year" "movements: {len(MOV)}" "pigments: {len(PIG)}" "paintings: {len(PNT)}" "artists: {len(ART.get("artists", []))}"\'/>'
            '<NavigationInfo type=\'"FLY" "WALK" "EXAMINE" "ANY"\' speed="8" headlight="false" avatarSize="0.25 1.6 0.75"/>'
            '<Background skyColor="0.04 0.04 0.07 0.10 0.12 0.2 0.35 0.42 0.6" skyAngle="1.2 1.57" groundColor="0.03 0.03 0.03"/>'
            + viewpoints() +
            '<DirectionalLight direction="-0.3 -1 -0.4" intensity="0.45" ambientIntensity="0.2" color="0.95 0.93 1"/>'
            '<DirectionalLight direction="0.5 -0.4 0.6" intensity="0.18" color="0.6 0.7 1"/>'
            '<Fog fogType="EXPONENTIAL" color="0.05 0.045 0.06" visibilityRange="420"/>'
            + spine() + "".join(gals) + paintings(walls) + pigments(walls) + atlas()
            + "".join(walkin(p, walls) for p in PNT if p["id"] in WALKIN and walkin_ready(p)))
    x3d = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
           '<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">'
           '<head><component name="Shape" level="5"/><component name="Lighting" level="3"/><component name="Text" level="1"/><component name="Geometry2D" level="1"/><component name="Navigation" level="2"/>'
           '<meta name="title" content="salon.x3d"/><meta name="description" content="Demo 79: art movements 1700-1899 as a walkable time corridor, 1 m = 1 year"/>'
           '<meta name="license" content="CC BY 4.0 (scene); paintings per DATA-ATTRIBUTION.md"/></head>'
           f'<Scene>{body}</Scene></X3D>\n')
    p = os.path.join(ROOT, "assets", "salon.x3d")
    open(p, "w", encoding="utf-8").write(x3d)
    print("wrote", p, len(x3d), "bytes; lanes:", {k: v[:2] for k, v in LANES.items()})


if __name__ == "__main__":
    main()
