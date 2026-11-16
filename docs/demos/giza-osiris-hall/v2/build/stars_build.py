import json, itertools, math, numpy as np, erfa
from astropy.coordinates import SkyCoord
S = json.load(open(__import__('os').environ.get('STARS_JSON', 'stars.json')))
A = np.array([s[:3] for s in S['stars']]); R = np.linalg.norm(A, axis=1); U = A/R[:, None]
def kabsch(P, Q):
    H = P.T@Q; u, _, vt = np.linalg.svd(H); d = np.sign(np.linalg.det(vt.T@u.T)); return vt.T@np.diag([1, 1, d])@u.T
sir = SkyCoord.from_name('Sirius').cartesian.xyz.value; pro = SkyCoord.from_name('Procyon').cartesian.xyz.value
P = np.vstack([U[141], U[160], np.cross(U[141], U[160])]); Q = np.vstack([sir, pro, np.cross(sir, pro)])
M = kabsch(P, Q)
EQ = (M@U.T).T   # data -> ICRS unit vectors
# validation against named stars (distance match)
val = {}
for n, d in [('Proxima Centauri', 4.24), ("Barnard's Star", 5.96), ('Wolf 359', 7.86), ('Epsilon Eridani', 10.5), ('Altair', 16.7), ('Vega', 25.0), ('Fomalhaut', 25.1), ('Pollux', 33.8), ('Arcturus', 36.7), ('Capella', 42.9), ('Denebola', 35.9)]:
    e = SkyCoord.from_name(n).cartesian.xyz.value
    c = [k for k in range(len(R)) if abs(R[k]-d) < 0.12]
    val[n] = round(min(math.degrees(math.acos(max(-1, min(1, EQ[k]@e)))) for k in c), 2) if c else None
print('frame fit residual deg', val)
NAMED = [('Alnitak', 1.77), ('Alnilam', 1.69), ('Mintaka', 2.23), ('Betelgeuse', .5), ('Rigel', .13), ('Bellatrix', 1.64), ('Saiph', 2.07), ('Meissa', 3.39), ('Sirius', -1.46), ('Procyon', .34),
         ('Canopus', -.74), ('Aldebaran', .85), ('Capella', .08), ('Regulus', 1.36), ('Denebola', 2.14), ('Spica', .97), ('Arcturus', -.05), ('Antares', 1.06), ('Vega', .03), ('Altair', .76),
         ('Deneb', 1.25), ('Pollux', 1.14), ('Castor', 1.58), ('Thuban', 3.65), ('Polaris', 1.98), ('Dubhe', 1.79), ('Alkaid', 1.86), ('Mizar', 2.23), ('Alioth', 1.77), ('Merak', 2.37),
         ('Phecda', 2.44), ('Megrez', 3.31), ('Fomalhaut', 1.16), ('Achernar', .46), ('Alpha Centauri', -.27), ('Hadar', .61), ('Acrux', .76), ('Alcyone', 2.87), ('Algieba', 2.01), ('Zosma', 2.56)]
named = []
for n, m in NAMED:
    c = SkyCoord.from_name(n); v = c.cartesian.xyz.value
    named.append(dict(n=n, v=[round(float(x), 6) for x in v], mag=m, ra=round(float(c.ra.deg), 4), dec=round(float(c.dec.deg), 4)))
epochs = list(range(-13000, 2101, 100)); mats = []
for e in epochs:
    m = erfa.ltpb(float(e)); mats.append([round(float(x), 6) for x in m.flatten()])
def dated(v, e):  # unit vec J2000 -> of date
    m = np.array(mats[epochs.index(e)]).reshape(3, 3); return m@np.array(v)
def ra_dec(v): return (math.degrees(math.atan2(v[1], v[0])) % 360, math.degrees(math.asin(max(-1, min(1, v[2])))))
lat = 29.9753; info = {}
for e in (2000, -2500, -2600, -10500):
    ee = min(epochs, key=lambda k: abs(k-e)) if e not in epochs else e
    row = {}
    for n in ('Alnilam', 'Alnitak', 'Mintaka', 'Thuban', 'Regulus', 'Polaris', 'Sirius'):
        v = [x for x in named if x['n'] == n][0]['v']; ra, dec = ra_dec(dated(v, ee)); row[n] = dict(ra_h=round(ra/15, 3), dec=round(dec, 2), culm_alt=round(90-lat+dec if dec < lat else 90+lat-dec, 1))
    info[ee] = row
print(json.dumps(info))
out = dict(source='star field: x3d-blender-io docs/brag/stars.json (HYG v4.1, 978 stars within 50 ly), rotated into ICRS by one Kabsch rotation fitted on Sirius and Procyon; named stars: CDS Sesame ICRS J2000 coordinates (via astropy); precession: Vondrak 2011 long-term matrices (ERFA ltpb), proper motion ignored; magnitudes approximate',
           frame_fit_deg=val, field=[[round(float(x), 5) for x in EQ[i]]+[S['stars'][i][3], S['stars'][i][4], S['stars'][i][5], S['stars'][i][6]] for i in range(len(R))], named=named, epochs=epochs, mats=mats, info=info,
           rotation_M=[[round(float(x), 5) for x in r] for r in M])
json.dump(out, open('stars_v2.json', 'w'), separators=(',', ':')); print(len(json.dumps(out)), 'bytes')
