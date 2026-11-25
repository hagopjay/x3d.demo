#!/usr/bin/env python3
"""Turn the glass Gobbler (x3d.gobbler mascot/glass/gobbler-glass.x3d) into the v5 page's bird: glass faces and sparks.

The serpent's head in v5 is the Gobbler itself. Its IndexedFaceSets are fan-triangulated and kept as triangles with
the scene's own per-face colours and a face normal (the page draws them as additive glass, brighter at grazing
angles). Its Sphere nodes (eyes, heart, the 64 frontier gems) become point shells, and a sparse set of points is
sampled on the faces as sparks (area-weighted). Deterministic (seeded).

Output: ouro/gobbler.bin, little-endian records of 16 bytes: int16 x, y, z (bird units * 2000), int16 part,
uint8 r, g, b, seed, int8 nx, ny, nz (unit normal * 127; 0 for points), int8 0. Triangle vertices come first
(ouro/gobbler.json says how many), then points. Parts: 0 body and loom, 1 head (beak, wattle, eyes), 2 fan vanes and
shafts, 3 check beads, 4 frontier gems, 5 heart, 6 failure-mode beads and the flywheel ring.
"""
import argparse, hashlib, json, math, pathlib, random, struct
import xml.etree.ElementTree as ET

PART = {'Body': 0, 'Loom': 0, 'Legs': 0, 'Beak': 1, 'Wattle': 1, 'Vanes': 2, 'Shafts': 2, 'Beads': 3, 'FailureModes': 6, 'WheelRing': 6}
BUDGET = {'Body': 300, 'Loom': 900, 'Legs': 60, 'Beak': 60, 'Wattle': 120, 'Vanes': 1800, 'Shafts': 300, 'Beads': 0, 'FailureModes': 0, 'WheelRing': 300}

def floats(s): return [float(v) for v in s.replace(',', ' ').split()]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--x3d', required=True); ap.add_argument('--out', required=True); a = ap.parse_args()
    src = pathlib.Path(a.x3d); raw = src.read_bytes(); root = ET.fromstring(raw)
    rnd = random.Random(20261125); pts = []; tri_out = []

    def tri_sample(p0, p1, p2):
        u, v = rnd.random(), rnd.random()
        if u + v > 1: u, v = 1 - u, 1 - v
        return [p0[i] + u * (p1[i] - p0[i]) + v * (p2[i] - p0[i]) for i in range(3)]

    def walk(e, off):
        for ch in e:
            if ch.tag == 'Transform':
                # the bird's transforms carry translation only at rest (rotations are animated by ROUTEs from identity)
                t = floats(ch.get('translation', '0 0 0')); walk(ch, [off[i] + t[i] for i in range(3)])
            elif ch.tag == 'Shape':
                name = ch.get('DEF', ''); geo = next((g for g in ch if g.tag != 'Appearance'), None)
                mat = ch.find('Appearance/Material')
                if geo is None: continue
                if geo.tag == 'IndexedFaceSet' and name in PART:
                    P = floats(geo.find('Coordinate').get('point')); P = [P[i:i + 3] for i in range(0, len(P), 3)]
                    C = floats(geo.find('Color').get('color')); C = [C[i:i + 3] for i in range(0, len(C), 3)]
                    faces, cur = [], []
                    for i in (int(v) for v in geo.get('coordIndex').replace(',', ' ').split()):
                        if i < 0: faces.append(cur); cur = []
                        else: cur.append(i)
                    if cur: faces.append(cur)
                    tris = []
                    for fi, f in enumerate(faces):
                        for k in range(1, len(f) - 1):
                            p0, p1, p2 = P[f[0]], P[f[k]], P[f[k + 1]]
                            ux, uy, uz = (p1[i] - p0[i] for i in range(3)); vx, vy, vz = (p2[i] - p0[i] for i in range(3))
                            ar = 0.5 * math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2)
                            c = C[fi] if geo.get('colorPerVertex') == 'false' else C[f[0]]
                            tris.append((ar, p0, p1, p2, c))
                            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx; nl = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
                            for q in (p0, p1, p2): tri_out.append(([q[i] + off[i] for i in range(3)], c, PART[name], (nx / nl, ny / nl, nz / nl)))
                    total = sum(t[0] for t in tris) or 1; n = BUDGET[name]
                    for ar, p0, p1, p2, c in tris:
                        want = n * ar / total; k = int(want) + (1 if rnd.random() < want - int(want) else 0)
                        for _ in range(k):
                            p = tri_sample(p0, p1, p2); pts.append(([p[i] + off[i] for i in range(3)], c, PART[name]))
                elif geo.tag == 'Sphere' and mat is not None:
                    r = float(geo.get('radius', '1')); c = floats(mat.get('emissiveColor', '0 0 0'))
                    if max(c) < 0.05: c = floats(mat.get('diffuseColor', '0.8 0.8 0.8'))
                    part = 4 if name.startswith('Gem_') else (5 if r > 0.5 else (1 if r < 0.1 else -1))
                    if part < 0: continue
                    n = {4: 26, 5: 900, 1: 60}[part]
                    for _ in range(n):
                        z = rnd.uniform(-1, 1); th = rnd.uniform(0, 2 * math.pi); s = math.sqrt(1 - z * z)
                        pts.append(([off[0] + r * s * math.cos(th), off[1] + r * s * math.sin(th), off[2] + r * z], c, part))
    walk(root.find('Scene'), [0, 0, 0])
    out = pathlib.Path(a.out); buf = bytearray(); cnt = {}
    allp = [t[0] for t in tri_out] + [p[0] for p in pts]
    lo = [min(p[i] for p in allp) for i in range(3)]; hi = [max(p[i] for p in allp) for i in range(3)]
    def rec(p, c, part, n):
        q = [max(-32767, min(32767, round(v * 2000))) for v in p]
        return struct.pack('<4h4B4b', q[0], q[1], q[2], part, *(max(0, min(255, round(v * 255))) for v in c), rnd.randrange(256), *(round(v * 127) for v in n), 0)
    for p, c, part, n in tri_out: buf += rec(p, c, part, n)
    for p, c, part in pts:
        buf += rec(p, c, part, (0, 0, 0)); cnt[part] = cnt.get(part, 0) + 1
    (out / 'gobbler.bin').write_bytes(buf)
    meta = {'schema': 'gobbler.bird/2', 'triangle_vertices': len(tri_out), 'triangles': len(tri_out) // 3, 'points': len(pts), 'bytes': len(buf), 'record': '16 bytes: int16 x y z part, uint8 r g b seed, int8 nx ny nz 0; position = int16 / 2000 bird units; triangles first, then points',
            'points_by_part': {str(k): v for k, v in sorted(cnt.items())}, 'parts': ['body and loom', 'head', 'fan', 'check beads', 'frontier gems', 'heart', 'failure modes and wheel'],
            'bbox': [[round(v, 3) for v in lo], [round(v, 3) for v in hi]], 'source': 'x3d.gobbler mascot/glass/gobbler-glass.x3d', 'source_sha256': hashlib.sha256(raw).hexdigest(),
            'bin_sha256': hashlib.sha256(buf).hexdigest()}
    (out / 'gobbler.json').write_text(json.dumps(meta, indent=1) + '\n'); print(meta)

if __name__ == '__main__':
    main()
