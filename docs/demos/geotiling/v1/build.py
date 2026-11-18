#!/usr/bin/env python3
"""geotiling v1 builder. Turns the planet-scale tile pyramid (AWS terrarium + Google Map Tiles 2D, z7/z11/z13/z15)
into (A) a native X3D GeoLOD quadtree of GeoElevationGrid tiles and (B) a 3D Tiles 1.1 tileset with GLB content.
Run: python3 -I build.py --data DIR_OF_planet-scale/data [--open-textures] [--gate x3d_mcp/src]
--open-textures swaps the Google satellite imagery for a hypsometric hillshade made from the open terrarium heights."""
import json, math, sys, os, io, struct, hashlib, pathlib
import numpy as np
from PIL import Image
HERE = pathlib.Path(__file__).resolve().parent
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
DATA = pathlib.Path(arg("--data", "/mnt/project-files/polyxandria/planet-scale/data"))
OPEN = "--open-textures" in sys.argv
NG = -32.6                      # EGM geoid undulation near Blacksburg: h_ellipsoid = h_asl + NG (as in planet-scale astro.json)
N = 33                          # posts per tile edge
K_RANGE = 1080 / (2 * math.tan(math.radians(22.5)) * 16)   # 3D Tiles SSE: distance = geometricError * K (1080 px, 45 deg, 16 px)
REAL = {7: (range(33, 38), range(48, 52)), 11: (range(565, 569), range(794, 798)),
        13: (range(2264, 2268), range(3180, 3184)), 15: (range(9062, 9066), range(12727, 12731))}
a_wgs, f_wgs = 6378137.0, 1 / 298.257223563; e2 = f_wgs * (2 - f_wgs)

def terr(img): img = img.astype(np.float64); return img[..., 0] * 256 + img[..., 1] + img[..., 2] / 256 - 32768
def mosaic(sub, xs, ys, ext):
    return np.concatenate([np.concatenate([np.asarray(Image.open(DATA / sub / f"{x}_{y}.{ext}").convert("RGB")) for x in xs], 1) for y in ys], 0)
MOS = {}
for z, (xs, ys) in REAL.items():
    MOS[z] = dict(x0=xs[0], y0=ys[0], nx=len(xs), ny=len(ys), H=terr(mosaic(f"terr{z}", xs, ys, "png")), S=mosaic(f"sat{z}", xs, ys, "jpg"))
def px2ll(px, py, z):
    n = 256 * 2.0 ** z; return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py / n)))), px / n * 360 - 180
def ll2px(lat, lon, z):
    n = 256 * 2.0 ** z; s = math.sin(math.radians(lat)); return (lon + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
def bilin(H, x, y):
    x = np.clip(x, 0, H.shape[1] - 1.001); y = np.clip(y, 0, H.shape[0] - 1.001); x0 = x.astype(int); y0 = y.astype(int); fx = x - x0; fy = y - y0
    return H[y0, x0] * (1 - fx) * (1 - fy) + H[y0, x0 + 1] * fx * (1 - fy) + H[y0 + 1, x0] * (1 - fx) * fy + H[y0 + 1, x0 + 1] * fx * fy
def covers(L, z, x, y):
    m = MOS[L]; s = 2.0 ** (L - z); return x * s >= m["x0"] and (x + 1) * s <= m["x0"] + m["nx"] and y * s >= m["y0"] and (y + 1) * s <= m["y0"] + m["ny"]
def src_level(z, x, y):
    ups = [L for L in MOS if L >= z and covers(L, z, x, y)]
    if ups: return min(ups)
    return max(L for L in MOS if L < z and covers(L, z, x, y))
def children(z, x, y): return [(z + 1, 2 * x + dx, 2 * y + dy) for dy in (0, 1) for dx in (0, 1)]
def overlaps(L, z, x, y):
    m = MOS[L]; s = 2.0 ** (L - z); return x * s < m["x0"] + m["nx"] and (x + 1) * s > m["x0"] and y * s < m["y0"] + m["ny"] and (y + 1) * s > m["y0"]
def subdivides(z, x, y): return z < 15 and any(L > z and overlaps(L, z, x, y) for L in MOS)

def bounds(z, x, y):
    n, s = px2ll(x * 256, y * 256, z)[0], px2ll(x * 256, (y + 1) * 256, z)[0]
    return s, n, px2ll(x * 256, 0, z)[1], px2ll((x + 1) * 256, 0, z)[1]      # south, north, west, east
def tile_data(z, x, y):
    L = src_level(z, x, y); m = MOS[L]; s, n, w, e = bounds(z, x, y)
    lats = np.linspace(s, n, N); lons = np.linspace(w, e, N)
    PX = np.array([[ll2px(la, lo, L)[0] - m["x0"] * 256 for lo in lons] for la in lats]); PY = np.array([[ll2px(la, lo, L)[1] - m["y0"] * 256 for lo in lons] for la in lats])
    h = bilin(m["H"], PX, PY)
    if L <= 7: h = np.maximum(h, 0)
    # texture: crop the exact tile box out of mosaic level L, resample to 256 (down: area; up: bicubic)
    s_ = 2.0 ** (L - z); bx = (x * s_ - m["x0"]) * 256; by = (y * s_ - m["y0"]) * 256; bw = 256 * s_
    if OPEN:
        hh = bilin(m["H"], bx + (np.arange(256) + .5)[None, :] * bw / 256 + 0 * np.arange(256)[:, None], by + (np.arange(256) + .5)[:, None] * bw / 256 + 0 * np.arange(256)[None, :])
        gy, gx = np.gradient(hh * (0.7 if L >= 11 else 0.05)); shade = np.clip(0.75 + 0.5 * (gx - gy) / (1 + abs(gx) + abs(gy)), 0.2, 1.3)
        t = np.clip((hh - 200) / 1200, 0, 1)[..., None]; col = (1 - t) * np.array([.35, .5, .3]) + t * np.array([.85, .8, .7]); img = Image.fromarray(np.uint8(np.clip(col * shade[..., None], 0, 1) * 255))
    else:
        img = Image.fromarray(m["S"]).crop((int(round(bx)), int(round(by)), int(round(bx + bw)), int(round(by + bw)))).resize((256, 256), Image.LANCZOS if s_ >= 1 else Image.BICUBIC)
    # mercator row fraction of each latitude inside the tile (0 = north edge) for texCoord v
    yn = ll2px(n, w, z)[1]; ys_ = ll2px(s, w, z)[1]; rowf = np.array([(ll2px(la, w, z)[1] - yn) / (ys_ - yn) for la in lats])
    return dict(z=z, x=x, y=y, L=L, s=s, n=n, w=w, e=e, lats=lats, lons=lons, h=h + NG, rowf=rowf, img=img)
def ground_width_m(z, lat): return 40075016.686 * math.cos(math.radians(lat)) / 2 ** z
def geometric_error(z, lat): return ground_width_m(z, lat) / 51.0            # 3D Tiles geometricError (m); range = ge * K_RANGE ~ 1.6 tile widths

def fmt(v): return f"{v:.1f}".rstrip("0").rstrip(".") if abs(v) >= 1 else f"{v:.3f}".rstrip("0").rstrip(".") or "0"
def mesh_x3d(t, tex_rel):
    s, n, w, e = t["s"], t["n"], t["w"], t["e"]; H = " ".join(fmt(v) for v in t["h"].ravel())
    uv = " ".join(f"{i / (N - 1):.4f} {1 - t['rowf'][j]:.4f}" for j in range(N) for i in range(N))
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">
 <head><component name="Geospatial" level="1"/><meta name="title" content="geotiling v1 mesh z{t['z']} {t['x']}/{t['y']}"/></head>
 <Scene>
  <Shape>
   <Appearance><Material diffuseColor="1 1 1" ambientIntensity="0.6"/><ImageTexture url='"{tex_rel}"'/></Appearance>
   <GeoElevationGrid geoSystem='"GD" "WE"' geoGridOrigin="{s:.7f} {w:.7f} 0" xDimension="{N}" zDimension="{N}" xSpacing="{(e - w) / (N - 1):.9f}" zSpacing="{(n - s) / (N - 1):.9f}" creaseAngle="1.2" solid="false" height="{H}"><TextureCoordinate point="{uv}"/></GeoElevationGrid>
  </Shape>
 </Scene>
</X3D>
'''
def lod_x3d(t, kids, mesh_rel):
    c = (t["s"] + t["n"]) / 2, (t["w"] + t["e"]) / 2; ge = geometric_error(t["z"], c[0]); rng = ge * K_RANGE
    cu = " ".join(f'child{i + 1}Url=\'"{k}"\'' for i, k in enumerate(kids))
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">
 <head><component name="Geospatial" level="1"/><meta name="title" content="geotiling v1 GeoLOD z{t['z']} {t['x']}/{t['y']}"/></head>
 <Scene>
  <GeoLOD geoSystem='"GD" "WE"' center="{c[0]:.6f} {c[1]:.6f} 0" range="{rng:.1f}" rootUrl='"{mesh_rel}"' {cu}/>
 </Scene>
</X3D>
'''
def glb(t):
    """Minimal GLB (glTF 2.0, KHR_materials_unlit) in the tile's local ENU frame (x east, y up, z south), plus the 3D Tiles transform."""
    lat0 = (t["s"] + t["n"]) / 2; lon0 = (t["w"] + t["e"]) / 2; h0 = float(t["h"].mean())
    def ecef(la, lo, h):
        la, lo = np.radians(la), np.radians(lo); nn = a_wgs / np.sqrt(1 - e2 * np.sin(la) ** 2)
        return np.stack([(nn + h) * np.cos(la) * np.cos(lo), (nn + h) * np.cos(la) * np.sin(lo), (nn * (1 - e2) + h) * np.sin(la)], -1)
    la0, lo0 = math.radians(lat0), math.radians(lon0)
    E = np.array([-math.sin(lo0), math.cos(lo0), 0]); No = np.array([-math.sin(la0) * math.cos(lo0), -math.sin(la0) * math.sin(lo0), math.cos(la0)]); U = np.array([math.cos(la0) * math.cos(lo0), math.cos(la0) * math.sin(lo0), math.sin(la0)])
    C = ecef(lat0, lon0, h0)
    LA, LO = np.meshgrid(t["lats"], t["lons"], indexing="ij"); P = ecef(LA, LO, t["h"]) - C
    enu = np.stack([P @ E, P @ U, -(P @ No)], -1).reshape(-1, 3).astype("<f4")        # glTF Y-up: (east, up, -north)
    uv = np.stack([np.tile(np.arange(N) / (N - 1), N), np.repeat(t["rowf"], N)], -1).astype("<f4")      # glTF v runs top-down
    idx = []
    for j in range(N - 1):
        for i in range(N - 1):
            a = j * N + i; idx += [a, a + 1, a + N, a + 1, a + N + 1, a + N]
    idx = np.array(idx, "<u2"); jb = io.BytesIO(); t["img"].save(jb, "JPEG", quality=82); jpg = jb.getvalue()
    chunks = [enu.tobytes(), uv.tobytes(), idx.tobytes(), jpg]; views = []; off = 0; blob = b""
    for c in chunks:
        views.append(dict(buffer=0, byteOffset=off, byteLength=len(c))); pad = (-len(c)) % 4; blob += c + b"\0" * pad; off += len(c) + pad
    g = dict(asset=dict(version="2.0", generator="geotiling v1 build.py"), extensionsUsed=["KHR_materials_unlit"], scene=0, scenes=[dict(nodes=[0])], nodes=[dict(mesh=0)],
             meshes=[dict(primitives=[dict(attributes=dict(POSITION=0, TEXCOORD_0=1), indices=2, material=0)])],
             materials=[dict(pbrMetallicRoughness=dict(baseColorTexture=dict(index=0), metallicFactor=0, roughnessFactor=1), doubleSided=True, extensions=dict(KHR_materials_unlit={}))],
             textures=[dict(source=0)], images=[dict(bufferView=3, mimeType="image/jpeg")], buffers=[dict(byteLength=len(blob))], bufferViews=views,
             accessors=[dict(bufferView=0, componentType=5126, count=N * N, type="VEC3", min=enu.min(0).tolist(), max=enu.max(0).tolist()), dict(bufferView=1, componentType=5126, count=N * N, type="VEC2"), dict(bufferView=2, componentType=5123, count=len(idx), type="SCALAR")])
    j = json.dumps(g, separators=(",", ":")).encode(); j += b" " * ((-len(j)) % 4)
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(j) + 8 + len(blob)) + struct.pack("<I4s", len(j), b"JSON") + j + struct.pack("<I4s", len(blob), b"BIN\0") + blob
    transform = [*E, 0, *No, 0, *U, 0, *C, 1]            # 3D Tiles: column-major, z-up local (east, north, up)
    return out, transform, dict(lat=lat0, lon=lon0, h=h0, hmin=float(t["h"].min()), hmax=float(t["h"].max()))


def ground(lat, lon):
    m = MOS[7]; px, py = ll2px(lat, lon, 7); return float(bilin(m["H"], np.array(px - m["x0"] * 256), np.array(py - m["y0"] * 256))) + NG
DRILL_LIFT = 8.0     # registration offset (m): terrarium z15 reads 623 to 626 m on the field but the DSM ground sits near 617 to 620, which buries it; grade S
def write_root():
    """root.x3d: globe + 20 z7 tiles (each a GeoLOD tree via Inline), city beacons, Burruss pin, Drillfield finale by Inline, GeoViewpoints and a zoom-out tour."""
    B = (37.2284, -80.4234); G = json.load(open(DATA / "derived" / "globe.json")); gh = " ".join(str(int(v)) for v in G["heights"])
    from PIL import Image as I
    I.open(DATA / "earth-blue-marble.jpg").resize((2048, 1024), I.LANCZOS).save(HERE / "tex" / "earth_2048.jpg", quality=86)
    inl = "\n".join(f'  <Inline url=\'"tiles/z7_{x}_{y}.x3d"\'/>' for y in REAL[7][1] for x in REAL[7][0])
    keys, pos, ori = [], [], []; n = 49; a0, a1 = 300.0, 2.5e7
    for i in range(n):
        alt = a0 * (a1 / a0) ** (i / (n - 1)); ang = -0.95 + (-1.5707963 + 0.95) * min(1, i / 22); south = alt / math.tan(-ang) if ang > -1.5 else 0
        keys.append(f"{i / (n - 1):.5f}"); pos.append(f"{B[0] - south / 111320:.6f} {B[1]:.6f} {alt + 617 + NG:.1f}"); ori.append(f"1 0 0 {ang:.5f}")
    def beacon(name, lat, lon, h, r, hgt, col):
        return f'''  <GeoLocation DEF="gl_{name}" geoSystem='"GD" "WE"' geoCoords="{lat} {lon} {h + hgt / 2:.1f}"><Shape><Appearance><Material diffuseColor="{col}" emissiveColor="{col}"/></Appearance><Cylinder radius="{r}" height="{hgt}" top="false" bottom="false"/></Shape></GeoLocation>'''
    cities = [("dc", 38.8951, -77.0364), ("atlanta", 33.7490, -84.3880), ("nashville", 36.1627, -86.7816)]
    bc = "\n".join(beacon(n_, la, lo, ground(la, lo), 900, 60000, "1 0.45 0.1") for n_, la, lo in cities)
    vps = [("Space (2.5e7 m)", f"{B[0]} {B[1]} 25000000", -1.5707963), ("Eastern US (1.2e6 m)", f"{B[0]} {B[1]} 1200000", -1.5707963), ("Valley (1.5e5 m)", f"{B[0]} {B[1]} 150000", -1.5707963),
           ("Town (2.5e4 m)", f"{B[0]} {B[1]} 25000", -1.5707963), ("Campus (4e3 m)", f"{B[0] - 0.012:.5f} {B[1]} 4000", -1.2), ("Burruss and Drillfield (700 m)", f"{B[0] - 0.0035:.5f} {B[1]} {700 + 617 + NG:.1f}", -0.95)]
    vp = "\n".join(f'  <GeoViewpoint DEF="vp{i}" description="{d}" geoSystem=\'"GD" "WE"\' position="{p_}" orientation="1 0 0 {o}" speedFactor="4"/>' for i, (d, p_, o) in enumerate(vps))
    x = f'''<?xml version="1.0" encoding="UTF-8"?>
<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">
 <head>
  <component name="Geospatial" level="1"/>
  <meta name="title" content="geotiling v1: Burruss Hall to Earth (GeoLOD quadtree)"/>
  <meta name="description" content="20 z7 tiles, each a GeoLOD quadtree of GeoElevationGrid tiles to z15, a 1 degree globe underneath, GeoLocation beacons, a zoom-out tour by GeoPositionInterpolator and the Drillfield 0.25 m DSM by Inline. Satellite texture: Google Map Tiles 2D, academic non-commercial proof of concept only (see NOTICE.md)."/>
  <meta name="attribution" content="Imagery and data: Google; terrain: AWS Terrain Tiles; globe: NASA Blue Marble"/>
 </head>
 <Scene>
  <NavigationInfo type='"EXAMINE" "ANY"' headlight="true" visibilityLimit="0"/>
{vp}
  <Shape DEF="globe"><Appearance><Material diffuseColor="1 1 1" ambientIntensity="0.6"/><ImageTexture url='"tex/earth_2048.jpg"'/></Appearance>
   <GeoElevationGrid geoSystem='"GD" "WE"' geoGridOrigin="-90 -180 -2000" xDimension="361" zDimension="181" xSpacing="1" zSpacing="1" creaseAngle="1.5" solid="true" height="{gh}"/></Shape>
{inl}
{bc}
  <GeoLocation DEF="gl_burruss" geoSystem=\'"GD" "WE"\' geoCoords="{B[0]} {B[1]} {617 + NG + 70:.1f}"><Shape><Appearance><Material diffuseColor="0.9 0.1 0.1" emissiveColor="0.9 0.1 0.1"/></Appearance><Cone bottomRadius="14" height="140" bottom="false"/></Shape></GeoLocation>
  <GeoLOD DEF="lod_drillfield" geoSystem=\'"GD" "WE"\' center="{B[0]} {B[1]} {617 + NG:.1f}" range="2500" child1Url=\'"drillfield-geo.x3d"\'/>
  <TimeSensor DEF="tour_t" cycleInterval="90" loop="false"/>
  <GeoPositionInterpolator DEF="tour_p" geoSystem=\'"GD" "WE"\' key="{' '.join(keys)}" keyValue="{', '.join(pos)}"/>
  <OrientationInterpolator DEF="tour_o" key="{' '.join(keys)}" keyValue="{', '.join(ori)}"/>
  <ROUTE fromNode="tour_t" fromField="fraction_changed" toNode="tour_p" toField="set_fraction"/>
  <ROUTE fromNode="tour_t" fromField="fraction_changed" toNode="tour_o" toField="set_fraction"/>
  <ROUTE fromNode="tour_p" fromField="geovalue_changed" toNode="vp0" toField="set_position"/>
  <ROUTE fromNode="tour_o" fromField="value_changed" toNode="vp0" toField="set_orientation"/>
 </Scene>
</X3D>
'''
    (HERE / "root.x3d").write_text(x, encoding="utf8")
    (HERE / "drillfield-geo.x3d").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">
 <head><component name="Geospatial" level="1"/><meta name="title" content="Drillfield 0.25 m DSM placed with GeoLocation (finale of geotiling v1)"/><meta name="attribution" content="Imagery and data: Google (Solar API), academic non-commercial proof of concept only"/></head>
 <Scene>
  <GeoLocation geoSystem=\'"GD" "WE"\' geoCoords="{B[0]} {B[1]} {617 + NG + DRILL_LIFT:.1f}"><Inline url=\'"../../gobbler-worlds-within/v1/data/worlds/drillfield/drillfield.x3d"\'/></GeoLocation>
 </Scene>
</X3D>
''', encoding="utf8"); return x

def mul(A, B): return [sum(A[k * 4 + r] * B[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]
def rigid_inv(M):
    R = np.array([[M[0], M[4], M[8]], [M[1], M[5], M[9]], [M[2], M[6], M[10]]]); t = np.array(M[12:15]); Ri = R.T; ti = -Ri @ t
    return [*Ri[:, 0], 0, *Ri[:, 1], 0, *Ri[:, 2], 0, *ti, 1]

def inventory(stats):
    """data/inventory.json: what the archive held, counted from DATA (sizes, counts, sha256 of the sorted file digests)."""
    rows = []
    def dirinfo(sub):
        fs = sorted((DATA / sub).glob("*")); h = hashlib.sha256()
        for f in fs: h.update(hashlib.sha256(f.read_bytes()).digest())
        return len(fs), sum(f.stat().st_size for f in fs), h.hexdigest()[:16]
    src = {"sat": ("Google Map Tiles API, 2D satellite (session tiles, 256 px JPEG)", "Google Map Tiles API policies; academic non-commercial PoC only, owner decision 18 Nov 2026"),
           "terr": ("AWS Terrain Tiles, terrarium PNG (SRTM/3DEP/GMTED mix)", "open data (Mapzen/AWS Open Data terms; attribution kept in NOTICE.md)")}
    for z in (7, 11, 13, 15):
        for k in ("sat", "terr"):
            n, b, h = dirinfo(f"{k}{z}"); rows.append(dict(dir=f"{k}{z}", what=src[k][0], zoom=z, files=n, bytes=b, sha256_of_digests=h, licence=src[k][1]))
    n, b, h = dirinfo("terr3"); rows.append(dict(dir="terr3", what=src["terr"][0], zoom=3, files=n, bytes=b, sha256_of_digests=h, licence=src["terr"][1]))
    levels = []
    for z, st in sorted(stats["per_level"].items()):
        w = ground_width_m(z, 37.2284); ge = geometric_error(z, 37.2284)
        levels.append(dict(z=z, tiles=st["tiles"], native_source_tiles=st["real_native"], source_levels=st["src_levels"], width_m=round(w), px_size_m=round(w / 256, 2), geometric_error_m=round(ge, 1), range_m=round(ge * K_RANGE)))
    (HERE / "data" / "inventory.json").write_text(json.dumps(dict(sources=rows, levels=levels, note="Counts and sizes read from DATA at build time."), indent=1))

def main():
    for d in ("tiles", "tex", "gltf"): (HERE / d).mkdir(exist_ok=True)
    stats = dict(tiles=0, x3d_bytes=0, tex_bytes=0, glb_bytes=0, per_level={}); tiles3d = {}
    roots = [(7, x, y) for y in REAL[7][1] for x in REAL[7][0]]
    def emit(z, x, y, parent_tr=None):
        t = tile_data(z, x, y); name = f"z{z}_{x}_{y}"; tex = HERE / "tex" / f"{name}.jpg"; t["img"].save(tex, quality=84)
        sub = subdivides(z, x, y); kids = [f"z{c[0]}_{c[1]}_{c[2]}.x3d" for c in children(z, x, y)] if sub else None
        (HERE / "tiles" / f"{name}.mesh.x3d").write_text(mesh_x3d(t, f"../tex/{name}.jpg"), encoding="utf8")
        (HERE / "tiles" / f"{name}.x3d").write_text(lod_x3d(t, kids, f"{name}.mesh.x3d") if sub else mesh_x3d(t, f"../tex/{name}.jpg"), encoding="utf8")
        g, tr, info = glb(t); (HERE / "gltf" / f"{name}.glb").write_bytes(g)
        st = stats["per_level"].setdefault(z, dict(tiles=0, src_levels={}, real_native=0)); st["tiles"] += 1; st["src_levels"][t["L"]] = st["src_levels"].get(t["L"], 0) + 1; st["real_native"] += t["L"] >= z
        stats["tiles"] += 1; stats["glb_bytes"] += len(g)
        lat = (t["s"] + t["n"]) / 2; ge = geometric_error(z, lat)
        rel = tr if parent_tr is None else mul(rigid_inv(parent_tr), tr)       # 3D Tiles: a child's transform is relative to its parent's
        node = dict(boundingVolume=dict(region=[math.radians(t["w"]), math.radians(t["s"]), math.radians(t["e"]), math.radians(t["n"]), info["hmin"], info["hmax"]]),
                    geometricError=round(ge, 2), refine="REPLACE", transform=[round(v, 9) for v in rel], content=dict(uri=f"gltf/{name}.glb"), extras=dict(z=z, x=x, y=y, srcLevel=t["L"]))
        if sub: node["children"] = [emit(*c, tr) for c in children(z, x, y)]
        else: node["geometricError"] = 0
        return node
    top = [emit(*r) for r in roots]
    # synthetic root above the 20 z7 tiles so the tileset has one root, as 3D Tiles requires
    W = min(n["boundingVolume"]["region"][0] for n in top); S = min(n["boundingVolume"]["region"][1] for n in top); E = max(n["boundingVolume"]["region"][2] for n in top); Nn = max(n["boundingVolume"]["region"][3] for n in top)
    ts = dict(asset=dict(version="1.1", tilesetVersion="geotiling-v1"), geometricError=round(max(n["geometricError"] for n in top) * 4, 1),
              root=dict(boundingVolume=dict(region=[W, S, E, Nn, -50, 2000]), geometricError=round(max(n["geometricError"] for n in top) * 4, 1), refine="REPLACE", children=top))
    (HERE / "tileset.json").write_text(json.dumps(ts, separators=(",", ":")), encoding="utf8")
    for d, k in (("tiles", "x3d_bytes"), ("tex", "tex_bytes")): stats[k] = sum(p.stat().st_size for p in (HERE / d).iterdir())
    write_root()
    stats["K_RANGE"] = K_RANGE; stats["open_textures"] = OPEN; stats["N"] = N
    (HERE / "data").mkdir(exist_ok=True); (HERE / "data" / "build-stats.json").write_text(json.dumps(stats, indent=1)); inventory(stats)
    print(json.dumps(stats, indent=1))
    if "--gate" in sys.argv:
        sys.path.insert(0, arg("--gate")); from validation.validate import validate_xml
        res = []
        for p in sorted((HERE / "tiles").glob("*.x3d")) + [HERE / "root.x3d", HERE / "drillfield-geo.x3d"]:
            r = validate_xml(p.read_text(encoding="utf8")); res.append(dict(file=p.name, valid=r.get("valid"), errors=(r.get("errors") or [])[:2]))
        bad = [r for r in res if not r["valid"]]; print("validated", len(res), "invalid", len(bad), bad[:3])
        (HERE / "validation-tiles.json").write_text(json.dumps(dict(validator="x3d_mcp validate_xml", checked=len(res), invalid=len(bad), invalid_files=bad[:20]), indent=1))
if __name__ == "__main__": main()
