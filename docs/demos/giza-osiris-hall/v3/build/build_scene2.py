#!/usr/bin/env python3
"""Giza v2: Osiris Shaft + Hall of Records. Writes OUTDIR/giza-atlas-v3.x3d, states.bin, states.json, tour.json.
Frame: metres, x east, z south, y up, Sphinx at the origin, plateau y=0. Underground geometry is SCHEMATIC.
Tiers: DOCUMENTED cyan (D), THEORIZED amber (T), SPECULATIVE magenta (S). Surface light: Cycles vertex bake (bake.py)."""
import sys, json, math, struct, os, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from x3dlib import *
import geo
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
SRC = os.path.dirname(os.path.abspath(__file__))
KHAFRE, KHUFU, MENKAURE, V, P_END = geo.KHAFRE, geo.KHUFU, geo.MENKAURE, geo.V, geo.P_END
# Shaft A lies directly under Khafre's causeway, about halfway from the Sphinx to the funerary temple (Hawass 2007, p. 381); drawn on the causeway centre line
O = (-223.0, 0.0, -28.0); PAW_R = (30.0, 0.0, 6.0); HALL = (125.0, -26.0, 18.0)
cD, cT, cS, cC = COL['D'], COL['T'], COL['S'], COL['C']
LB = {}
CLUSTER_R = dict(osiris=110, depth=110, anomaly=80, khufuin=330, hall=170, gaze=250, khufu=450, khafre=900, khafreclaim=900, menk=400, sphinx=200, causeway=300, onesys=600, orion=1500, ctxpyr=2000)
def L_(cl, text, pos, size, c, far=None): LB.setdefault(cl, []).append(label(text, pos, size, c, far=far))
# ---------------- baked surface ----------------
STATES = [  # id, label, sun az/el, bake file, exposure target (p70 ground), sky colours
 dict(id='sunrise', label='Equinox sunrise', az=90, el=7, tgt=1.45, rule='pyr95', sun=(1.0, .64, .36)),
 dict(id='midday', label='Midday', az=165, el=62, tgt=0.80, rule='ground70', sun=(1.0, .95, .85)),
 dict(id='afternoon', label='Late afternoon', az=250, el=22, tgt=1.35, rule='pyr95', sun=(1.0, .76, .48)),
 dict(id='night', label='Starlight', az=0, el=-30, tgt=0.0, sun=(0.2, .25, .5))]
def shoulder(x): return x if x <= 0.8 else 0.8+0.2*(1-math.exp(-(x-0.8)/0.2))
def srgb(x):
    x = max(0.0, min(1.0, x)); return 12.92*x if x <= 0.0031308 else 1.055*(x**(1/2.4))-0.055
meshes = [geo.orient(m) for m in geo.all_meshes()]
# A bake belongs to one immutable vertex order. Never silently zip unequal
# arrays: that can make a new geometry look lit while hiding missing colours.
for mesh in meshes:
    if len(mesh['verts']) != len(mesh['alb']):
        raise ValueError('albedo/vertex count mismatch: ' + mesh['name'])
    if any(len(c) != 3 or not all(math.isfinite(float(v)) and 0 <= v <= 1 for v in c) for c in mesh['alb']):
        raise ValueError('invalid linear albedo: ' + mesh['name'])
    if any(len(v) != 3 or not all(math.isfinite(float(c)) for c in v) for v in mesh['verts']):
        raise ValueError('non-finite or malformed vertex: ' + mesh['name'])
    if any(not face or any(not isinstance(i, int) or not 0 <= i < len(mesh['verts']) for i in face) for face in mesh['faces']):
        raise ValueError('invalid mesh index: ' + mesh['name'])
def finalize(st):
    out = {}
    if st['id'] == 'night':
        for m in meshes: out[m['name']] = [[srgb(shoulder(a*k)) for a, k in zip(al, (0.045, 0.06, 0.11))] for al in m['alb']]
        return out, dict(note='starlight: albedo x (0.045,0.06,0.11), no bake')
    L = json.load(open(os.path.join(SRC, 'light_%s.json' % st['id'])))
    for mesh in meshes:
        light = L['light'].get(mesh['name'])
        if light is None or len(light) != len(mesh['verts']):
            raise ValueError('cached bake vertex count mismatch: ' + mesh['name'])
        if any(len(c) != 3 or not all(math.isfinite(float(v)) and v >= 0 for v in c) for c in light):
            raise ValueError('invalid cached bake radiance: ' + mesh['name'])
    if st['rule'] == 'ground70':
        g = sorted(sum(c)/3 for c in L['light']['ground']); p70 = g[int(.7*len(g))]
    else:
        g = sorted(sum(c)/3 for n in ('khufu', 'khafre', 'menkaure') for c in L['light'][n]); p70 = g[int(.95*len(g))]
    e = st['tgt']/p70
    for m in meshes:
        lt = L['light'][m['name']]; res = []
        for c, al in zip(lt, m['alb']):
            res.append([srgb(shoulder(max(x*e, fl)*a)) for x, a, fl in zip(c, al, (0.05, 0.07, 0.12))])
        out[m['name']] = res
    return out, dict(exposure=round(e, 4), exposure_ref_light=round(p70, 4), exposure_rule=st['rule'], bake=L['meta'])
ST = {}; stmeta = []
for st in STATES:
    ST[st['id']], meta = finalize(st); stmeta.append(dict(id=st['id'], label=st['label'], az=st['az'], el=st['el'], sun=st['sun'], **{k: v for k, v in meta.items() if k != 'bake'}, bake=meta.get('bake')))
order = [m['name'] for m in meshes]
blob = bytearray()
for st in STATES:
    for n in order:
        for c in ST[st['id']][n]:
            blob += bytes(int(round(max(0, min(1, x))*255)) for x in c)
open(os.path.join(OUT, 'states.bin'), 'wb').write(blob)
json.dump(dict(meshes=[dict(name=m['name'], n=len(m['verts'])) for m in meshes], states=stmeta, bytes=len(blob), layout='state-major, mesh order, per vertex uint8 sRGB r,g,b'), open(os.path.join(OUT, 'states.json'), 'w'), indent=1)
def mesh_xml(m, state='sunrise', transp=0.0, matdef=None):
    n = m['name']; cols = ST[state][n]
    idx = ' '.join(' '.join(str(i) for i in fc)+' -1' for fc in m['faces'])
    return ("<Shape><Appearance><UnlitMaterial DEF='M_%s' transparency='%.2f'/></Appearance><IndexedFaceSet solid='true' colorPerVertex='true' coordIndex='%s'>"
            "<Coordinate DEF='C_%s' point='%s'/><Color DEF='K_%s' color='%s'/></IndexedFaceSet></Shape>") % (
        n, transp, idx, n, ' '.join(f3(*v) for v in m['verts']), n, ' '.join(f3(*c) for c in cols))
surface = ''.join(mesh_xml(m, 'sunrise', 0.45 if m['name'] == 'ground' else 0.0) for m in meshes)
# ---------------- stars (initial: equinox dawn, 10,500 BC) ----------------
STARS = json.load(open(os.path.join(SRC, 'stars_v2.json')))
R_SKY = 4500.0; LAT = 29.9753
def sky_dir(v, epoch, lst_h):
    e = min(STARS['epochs'], key=lambda k: abs(k-epoch)); m = STARS['mats'][STARS['epochs'].index(e)]
    x = m[0]*v[0]+m[1]*v[1]+m[2]*v[2]; y = m[3]*v[0]+m[4]*v[1]+m[5]*v[2]; z = m[6]*v[0]+m[7]*v[1]+m[8]*v[2]
    ra = math.atan2(y, x); dec = math.asin(max(-1, min(1, z))); ha = math.radians(lst_h*15)-ra; la = math.radians(LAT)
    sa = math.sin(dec)*math.sin(la)+math.cos(dec)*math.cos(la)*math.cos(ha); alt = math.asin(max(-1, min(1, sa)))
    az = math.atan2(-math.cos(dec)*math.sin(ha), math.sin(dec)*math.cos(la)-math.cos(dec)*math.sin(la)*math.cos(ha))
    n_, e_, u_ = math.cos(alt)*math.cos(az), math.cos(alt)*math.sin(az), math.sin(alt)
    return (e_, u_, -n_)
EP0, LST0 = -10499, 18.0   # 10,500 BC, equinox dawn (sun at RA 0h rising -> LST 18h)
fld = STARS['field']; fpts = [sky_dir(s[:3], EP0, LST0) for s in fld]
fcol = []
for s in fld:
    k = 0.55+0.22*min(3.0, s[6]); fcol.append(tuple(min(1.0, c) for c in (s[3]/255*k, s[4]/255*k, s[5]/255*k)))
sky = "<Transform DEF='SkyRig'><Switch DEF='SW_SKY' whichChoice='0'><Group>"
sky += "<Shape><Appearance><Material diffuseColor='0 0 0' emissiveColor='1 1 1'/><PointProperties pointSizeScaleFactor='3' pointSizeMinValue='1.5' pointSizeMaxValue='4'/></Appearance><PointSet><Coordinate DEF='STAR_PTS' point='%s'/><Color DEF='STAR_COL' color='%s'/></PointSet></Shape>" % (
    ' '.join(f3(*[c*R_SKY for c in p]) for p in fpts), ' '.join(f3(*c) for c in fcol))
for i, s in enumerate(STARS['named']):
    p = sky_dir(s['v'], EP0, LST0); r = 14+(2.5-s['mag'])*5.5
    sky += "<Transform DEF='NS_%d' translation='%s'><Shape><Appearance><Material diffuseColor='0 0 0' emissiveColor='%s'/></Appearance><Sphere radius='%.3g'/></Shape>" % (
        i, f3(*[c*R_SKY for c in p]), '1 0.96 0.88' if s['mag'] < 1.5 else '0.85 0.88 1', r)
    sky += "<Transform translation='0 -%.3g 0'><Billboard axisOfRotation='0 0 0'>%s</Billboard></Transform></Transform>" % (r*2.2, text_shape(s['n'], 70, (0.78, 0.82, 0.9)))
CONST = {'Orion': [('Betelgeuse', 'Bellatrix'), ('Betelgeuse', 'Alnitak'), ('Bellatrix', 'Mintaka'), ('Alnitak', 'Alnilam'), ('Alnilam', 'Mintaka'), ('Alnitak', 'Saiph'), ('Mintaka', 'Rigel'), ('Betelgeuse', 'Meissa'), ('Bellatrix', 'Meissa')],
         'Leo': [('Regulus', 'Algieba'), ('Algieba', 'Zosma'), ('Zosma', 'Denebola')], 'Dipper': [('Dubhe', 'Merak'), ('Merak', 'Phecda'), ('Phecda', 'Megrez'), ('Megrez', 'Dubhe'), ('Megrez', 'Alioth'), ('Alioth', 'Mizar'), ('Mizar', 'Alkaid')]}
nm = {s['n']: i for i, s in enumerate(STARS['named'])}
cl = []; ci = []
for cn, prs in CONST.items():
    for a, b in prs:
        base = len(cl); cl += [sky_dir(STARS['named'][nm[a]]['v'], EP0, LST0), sky_dir(STARS['named'][nm[b]]['v'], EP0, LST0)]; ci.append('%d %d -1' % (base, base+1))
sky += "<Switch DEF='SW_CONST' whichChoice='0'><Shape>%s<IndexedLineSet coordIndex='%s'><Coordinate DEF='CONST_PTS' point='%s'/></IndexedLineSet></Shape></Switch>" % (lmat((0.42, 0.52, 0.78)), ' '.join(ci), ' '.join(f3(*[c*R_SKY for c in p]) for p in cl))
sky += "</Group></Switch><Transform DEF='SUN' translation='%s'><Shape><Appearance><Material diffuseColor='0 0 0' emissiveColor='1 0.72 0.42' transparency='0'/></Appearance><Sphere radius='60'/></Shape></Transform></Transform>" % f3(R_SKY*.93*math.sin(math.radians(90))*math.cos(math.radians(7)), R_SKY*.93*math.sin(math.radians(7)), 0)
json.dump(dict(const={k: [[nm[a], nm[b]] for a, b in v] for k, v in CONST.items()}), open(os.path.join(OUT, 'const.json'), 'w'))
# ---------------- observation overlays: modelling instruments, not archaeology ----------------
def line_set(points, lines, colour, width=1.5):
    """One indexed geometry for many fine lines; avoids a cylinder per tick."""
    if any(len(p) != 3 or not all(math.isfinite(float(v)) for v in p) for p in points):
        raise ValueError('invalid instrument coordinate')
    if any(not line or any(i < 0 or i >= len(points) for i in line) for line in lines):
        raise ValueError('invalid instrument index')
    appearance = "<Appearance><Material diffuseColor='0 0 0' emissiveColor='%s'/><LineProperties applied='true' linewidthScaleFactor='%.3g'/></Appearance>" % (f(*colour), width)
    return "<Shape>%s<IndexedLineSet coordIndex='%s'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (appearance, ' '.join(' '.join(map(str, line))+' -1' for line in lines), ' '.join(f3(*p) for p in points))

def circle_line(center, radius, colour, plane='xz', segments=96, width=1.5):
    cx, cy, cz = center
    points = []
    for i in range(segments):
        a = 2*math.pi*i/segments
        u, v = radius*math.cos(a), radius*math.sin(a)
        points.append((cx+u, cy, cz+v) if plane == 'xz' else (cx, cy+u, cz+v) if plane == 'yz' else (cx+u, cy+v, cz))
    return line_set(points, [list(range(segments))+[0]], colour, width)

survey = ["<Switch DEF='SW_SURVEY' whichChoice='-1'><Group>"]
sc = (0.70, 0.80, 0.78)
for radius in (25, 50, 100, 250):
    survey.append(circle_line((0, .52, 0), radius, (0.24, 0.42, 0.41)))
    survey.append(label('%d m radius' % radius, (radius*.71, 1.1, radius*.71), max(1.4, radius*.018), sc))
survey.append(line_set([(-270,.55,0),(270,.55,0),(0,.55,-270),(0,.55,270),
                        (258,.55,-4),(270,.55,0),(258,.55,4),(-4,.55,-258),(0,.55,-270),(4,.55,-258)],
                       [[0,1],[2,3],[4,5,6],[7,8,9]], sc, 2))
for text, pos in [('E / +X',(278,1,0)),('N / -Z',(0,1,-282)),('W / -X',(-285,1,0)),('S / +Z',(0,1,282))]:
    survey.append(label(text, pos, 6, sc))
survey.append(label('MODEL DATUM  y = 0 m|Sphinx origin; schematic horizontal layout', (0, 8, 32), 3, sc))
# A countable 50m bar is more useful than a decorative compass alone.
barpts = [(-25,.7,62),(25,.7,62)]; barlines = [[0,1]]
for i in range(6):
    x = -25+i*10; n=len(barpts);barpts += [(x,.7,60),(x,.7,64)];barlines.append([n,n+1])
survey.append(line_set(barpts,barlines,sc,2.5))
survey.append(label('0       10       20       30       40       50 m', (0,2.4,68),1.4,sc))
survey.append("</Group></Switch>")
survey = ''.join(survey)

# Values are normalised to a common *display* zero. The two Osiris numbers
# describe different source quantities/datums and must not be subtracted as
# though one excavation instrument had measured both.
scale_x, scale_z = -430.0, 360.0
scale = ["<Switch DEF='SW_SCALE' whichChoice='-1'><Group>"]
scale.append(label('NORMALISED DEPTH THEATRE|same metres; independent source quantities and datums', (scale_x,50,scale_z),14,sc))
scale_pts=[];scale_lines=[]
for depth in range(0,701,100):
    n=len(scale_pts);scale_pts += [(scale_x-240,-depth,scale_z),(scale_x+240,-depth,scale_z)];scale_lines.append([n,n+1])
    scale.append(label('%d m' % depth,(scale_x-267,-depth,scale_z),10,sc))
scale.append(line_set(scale_pts,scale_lines,(.20,.31,.33),1))
for offset, depth, colour, wording in [(-180,30.37,cD,'30.37 m|SHAFT LENGTH SUM'),(0,35.45,cT,'35.45 m|SECTION LABEL'),(180,648,cS,'648 m|UNVERIFIED CLAIM')]:
    x=scale_x+offset
    scale.append(seg(colour,(x,0,scale_z),(x,-depth,scale_z),2.2,.12,.8))
    scale.append(circle_line((x,-depth,scale_z),5,colour,segments=48,width=2.5))
    scale.append(label(wording,(x,20,scale_z),12,colour))
scale.append(label('No linked tunnel or shared geological datum is established by this graphic.',(scale_x,-710,scale_z),10,sc))
scale.append("</Group></Switch>")
scale = ''.join(scale)

# ---------------- context overlays: labels ----------------
ctx = []
L_('khafre', 'Khafre pyramid|215.25 m base, 136.4 m today (143.5 m original)', (KHAFRE[0], 175, KHAFRE[2]), 8, (0.9, 0.82, 0.62), far=(600, 14))
L_('khufu', 'Great Pyramid (Khufu)|230.33 m base, 138.5 m today', (KHUFU[0], 170, KHUFU[2]), 8, (0.9, 0.82, 0.62), far=(600, 14))
L_('menk', 'Menkaure pyramid|~103 m base, 65.5 m original', (MENKAURE[0], 95, MENKAURE[2]), 6, (0.9, 0.82, 0.62), far=(600, 12))
L_('sphinx', 'Great Sphinx|73 m long, 20 m high, faces due east', (10, 38, -30), 3, (0.9, 0.82, 0.62), far=(300, 9))
L_('causeway', 'Khafre causeway 494.6 m', (V[0]+0.8*(P_END[0]-V[0]), 12, V[2]+0.8*(P_END[2]-V[2])), 5, (0.9, 0.82, 0.62), far=(400, 9))
# ---------------- DOCUMENTED ----------------
doc = []
o = ["<Transform translation='%s'>" % f(*O), "<Group>", touch('T_osiris', 'Osiris Shaft: click for the story')]
sh = 2.0
o.append(box(cD, (sh, 9.62, sh), (0, -4.81, 0), 0.5, True))
o.append(box(cD, (8.6, 2.7, 3.85), (1.8, -8.27, 0), 0.55, True))     # Chamber A: 8.60 long, up to 3.85 wide (Hawass 2007); height schematic
o.append(box(cD, (sh, 13.25, sh), (4, -9.62-6.625, 0), 0.5, True))
yB = -(9.62+13.25); o.append(box(cD, (6.80, 2.60, 3.65), (4, yB+1.3, 0), 0.55, True, solid=False))
for dx in (-2.2, 0, 2.2):
    o.append(box(cD, (1.6, 1.5, 1.8), (4+dx, yB+1.1, 1.825+0.9), 0.6, True)); o.append(box(cD, (1.6, 1.5, 1.8), (4+dx, yB+1.1, -1.825-0.9), 0.6, True))
o.append(box(cD, (1.65, 7.5, 1.9), (6, yB-3.75, 0), 0.5, True)); yC = yB-7.5
# Level 3, Chamber I (Hawass 2007): ~9 x 9 m, water-filled trench round a rock-cut emplacement 5.2-6.0 m a side with four 1.5 m pillar stumps and a basalt sarcophagus 228 x 108 cm. Heights schematic.
CX = 6.0
o.append(box(cD, (9.0, 4.5, 9.0), (CX, yC+2.25, 0), 0.82, True, solid=False))
o.append("<Transform translation='%s'><Shape><Appearance><Material DEF='WaterMat' diffuseColor='0.06 0.14 0.4' emissiveColor='0.1 0.25 0.7' transparency='0.5'/></Appearance><Box size='8.9 1.8 8.9'/></Shape></Transform>" % f(CX, yC+0.9, 0))
o.append(box(cD, (5.8, 2.3, 5.8), (CX, yC+1.15, 0), 0.25, True, emis=0.45))
for px in (-2.3, 2.3):
    for pz in (-2.3, 2.3): o.append(box(cD, (1.5, 3.6, 1.5), (CX+px, yC+1.8, pz), 0.35, True, emis=0.6))
o.append(box((0.12, 0.12, 0.14), (2.28, 0.8, 1.08), (CX, yC+2.7, 0), 0.0, True, emis=0.5))   # basalt sarcophagus, 228 x 108 cm
L_('osiris', 'OSIRIS SHAFT|under Khafre\'s causeway|3 levels, schematic plan', (O[0]+6, 13, O[2]-30), 1.5, cD, far=(300, 9))
L_('osiris', 'Shaft A 9.62 m', (O[0]+9, -4.8, O[2]), 0.8, cD)
L_('osiris', 'Level 1, Chamber A|8.60 x 3.85 x 2.70 m', (O[0]+14.5, -8.3, O[2]), 0.8, cD)
L_('osiris', 'Shaft B 13.25 m', (O[0]+11, -16.2, O[2]), 0.8, cD)
L_('osiris', 'Level 2, Chamber B 6.80 x 3.65 x 2.60 m|+ 6 side chambers (C-H)', (O[0]+17, yB+1.3, O[2]), 0.8, cD)
L_('osiris', 'Level 3, Chamber I: walls 8.6 to 9.2 m|water-filled trench, 4 pillar stumps,|basalt sarcophagus 228 x 108 cm|Shaft C 7.5 m', (O[0]+21, yC+1.6, O[2]), 0.8, cD); o += ["</Group>", "</Transform>"]
doc.append(''.join(o))
K = KHUFU
doc.append("<Group>%s" % touch('T_khufu', 'Great Pyramid interior: click'))
# Descending passage (Petrie 1883): door 16.97 m above the pavement, 13.31 m inside the north casing edge and 7.29 m EAST of the axis; slope 26 deg 31 min; about 105 m long, ending near 30 m below the pavement
E = (K[0]+7.29, 16.97, K[2]-115.17+13.31); sl = math.radians(26.52); Pd = (E[0], E[1]-105.0*math.sin(sl), E[2]+105.0*math.cos(sl))
doc.append(seg(cD, E, Pd, 0.9))
SUBC = (K[0]+3, -28.9, Pd[2]+4.2)    # Subterranean Chamber: Petrie 14.05 x 8.33 m plan, roof about 26.8 m, floor about 30-32 m below the pavement; plan position schematic
doc.append(box(cD, (14.05, 4.0, 8.33), SUBC, 0.5, True))
doc.append(seg(cD, (K[0], 21.6, K[2]-25), (K[0], 42.1, K[2]+16.9), 1.6))     # Grand Gallery: 46.7 m slope length at 26 deg (arXiv 1711.01576), plan position schematic
doc.append(box(cD, (10.47, 5.85, 5.23), (K[0], 46, K[2]+27), 0.5, True))      # King's Chamber 10.47 x 5.23 m (Petrie); height 5.85 m not re-opened; long axis east-west
doc.append(box(cD, (5.75, 6.23, 5.23), (K[0], 24.1, K[2]+4), 0.55, True))     # Queen's Chamber 5.75 x 5.23 m, 6.23 m to the gable peak
doc.append(box(cD, (2.6, 8.0, 30.0), (K[0], 62, K[2]-8), 0.4, True, emis=0.9))   # Big Void: >= 30 m long (muons); cross-section and position schematic
doc.append(box(cD, (2.02, 2.18, 9.06), (K[0]+7.29, 21.0, K[2]-92.4), 0.4, True, emis=0.9))   # North Face Corridor: 9.06 x 2.02 x 2.18 m (Nagoya), about 0.8 m behind the chevron; position schematic
L_('khufuin', 'Big Void (muon imaging, 2017)|>= 30 m long, position schematic', (K[0]+95, 70, K[2]-8), 3, cD, far=(260, 12))
L_('khufuin', "King's Chamber|10.47 x 5.23 m", (K[0]-26, 46, K[2]+27), 2, cD); L_('khufuin', "Queen's Chamber|5.75 x 5.23 m", (K[0]-26, 24, K[2]+4), 2, cD)
L_('khufuin', 'North Face Corridor|9 x 2 x 2 m, muons, 2023', (K[0]+40, 24, K[2]-96), 2, cD)
L_('khufuin', 'Subterranean Chamber|27 to 30 m below the base, sources differ', (K[0]+34, -29, K[2]+4), 2, cD); doc.append("</Group>")
# ---------------- THEORIZED ----------------
the = []
the.append("<Group>%s" % touch('T_anomaly', 'Seismic anomaly under the paws: click'))
the.append(box(cT, (12, 3, 9), (PAW_R[0], -5.5, -6.0), 0.5, True, emis=0.9)); the.append(box(cT, (12, 3, 9), (PAW_R[0], -5.5, 6.0), 0.86, True, emis=0.5))
L_('anomaly', 'Seismic anomaly under the paws?|about 12 x 9 m, buried less than 5 m|thickness not stated; the paw is disputed', (PAW_R[0]+25, 14, 30), 2, cT, far=(260, 9)); the.append("</Group>")
for i in range(3): the.append("<Transform DEF='Ring%d' translation='%s'><Shape><Appearance><Material DEF='RingM%d' diffuseColor='0 0 0' emissiveColor='%s' transparency='0.3'/></Appearance><Cylinder radius='1' height='0.15' bottom='false'/></Shape></Transform>" % (i, f(PAW_R[0], 0.4, 6.0), i, f(*cT)))
rx = O[0]-8; rz = O[2]
the.append("<Shape>%s<IndexedLineSet coordIndex='0 1 -1'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (lmat(cT), f(rx, 0, rz, rx, -41.48, rz)))
for d, t in ((29.9, '29.9 m: 98 ft (Reuters 2000)'), (30.37, '30.37 m: 9.62+13.25+7.50 (Hawass 2007, summed)'), (33, '~33 m: Hassan 1944, rounded shafts'), (35.45, '35.45 m: deepest label, Hawass Fig. 2'), (41.48, '41.48 m: in no source opened (project table)')):
    off = {29.9: 1.5, 30.37: -0.7, 33: 0, 35.45: 0, 41.48: 0}[d]
    the.append(seg(cT, (rx-1.2, -d, rz), (rx+1.2, -d, rz), 0.1, 0, 1)); L_('depth', t, (rx-13.5, -d+off, rz), 0.8, cT)
L_('depth', 'DEPTH QUANTITIES|shaft sum vs section datum|41.48 m untraced', (rx-8, 4, rz), 0.9, cT, far=(300, 7))
# Orion correlation overlay (Bauval 1994): three belt stars hovering over the three pyramids
apex = [(KHUFU[0], 138.5, KHUFU[2]), (KHAFRE[0], 143.5, KHAFRE[2]), (MENKAURE[0], 65.5, MENKAURE[2])]
the.append("<Switch DEF='SW_ORION' whichChoice='-1'><Group>%s" % touch('T_orion', 'Orion Correlation: click'))
for (a, nmx) in zip(apex, ('Alnitak', 'Alnilam', 'Mintaka')):
    the.append(seg(cT, a, (a[0], 330, a[2]), 0.7, 0.4, 1.0))
    the.append("<Transform translation='%s'><Shape><Appearance><Material diffuseColor='0 0 0' emissiveColor='1 0.86 0.55'/></Appearance><Sphere radius='11'/></Shape></Transform>" % f(a[0], 330, a[2]))
    L_('orion', nmx, (a[0], 360, a[2]), 14, cT)
the.append("<Shape>%s<IndexedLineSet coordIndex='0 1 2 -1'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (lmat(cT), ' '.join(f(a[0], 330, a[2]) for a in apex)))
L_('orion', "ORION CORRELATION (Bauval 1989, 1994)|Belt stars over Khufu, Khafre, Menkaure|a theory; most Egyptologists and astronomers reject it", (-620, 520, -170), 20, cT); the.append("</Group></Switch>")
# Sphinx gaze: due east to the equinox sunrise
L_('gaze', 'Sphinx gaze: due east, to the equinox sunrise|(faces east; the Leo-at-dawn reading of 10,500 BC is a theory)', (70, 36, 0), 3.5, cT, far=(300, 10))
the.append("<Switch DEF='SW_GAZE' whichChoice='-1'><Group>%s</Group></Switch>" % seg(cT, (20, 17, 0), (2400, 17, 0), 0.5, 0.5, 1.0))
# ---------------- SPECULATIVE ----------------
spe = []
spe.append("<Group>%s" % touch('T_hall', 'Cayce Hall of Records: click'))
spe.append(seg(cS, (PAW_R[0]+8, -3, 6.0), (HALL[0]-28, HALL[1], HALL[2]-4), 1.1))
hw, hh, hd = 56, 11, 30
spe.append(box(cS, (hw, hh, hd), HALL, 0.8, True, emis=1.0, solid=False))
spe.append("<Transform translation='%s'><Shape>%s<Box size='%s'/></Shape></Transform>" % (f(HALL[0], HALL[1]-hh/2+0.05, HALL[2]), mat(cS, 0.5, 0.35), f(hw-1, 0.1, hd-1)))
for row in (-7, 7):
    for i in range(8):
        x = HALL[0]-24+i*6.8
        spe.append(cyl(cS, 0.9, hh-0.4, (x, HALL[1], HALL[2]+row), 0.45, 0.6))
        spe.append("<Transform translation='%s'><Shape>%s<Box size='2.4 0.4 2.4'/></Shape></Transform>" % (f(x, HALL[1]+hh/2-0.4, HALL[2]+row), mat(cS, 0.2, 1.0)))
for side in (-1, 1):
    for i in range(13):
        x = HALL[0]-24+i*4
        spe.append("<Transform translation='%s'><Shape>%s<Box size='1.8 2.6 0.2'/></Shape></Transform>" % (f(x, HALL[1]-1.2, HALL[2]+side*(hd/2-0.3)), mat((1, .85, 1), 0.0, 0.6)))
spe.append(cyl(cS, 2.4, 1.0, (HALL[0]+14, HALL[1]-hh/2+0.5, HALL[2]), 0.3, 0.7))
spe.append("<Transform DEF='Orb' translation='%s'><Shape><Appearance><Material diffuseColor='0 0 0' emissiveColor='1 0.8 1' transparency='0.1'/></Appearance><Sphere radius='1.4'/></Shape></Transform>" % f(HALL[0]+14, HALL[1]-hh/2+2.6, HALL[2]))
spe.append("<PointLight color='1 0.6 1' intensity='1.2' radius='45' location='%s' global='false'/>" % f(HALL[0]+14, HALL[1]-1, HALL[2]))
# Architectural finish is intentionally an invention. Dark stone bays, brass
# inlay, column collars and an armillary describe craft, not a discovery.
floor_y = HALL[1]-hh/2
for ix in range(14):
    for iz in range(6):
        cx = HALL[0]-26+ix*4; cz = HALL[2]-12.5+iz*5
        tone = .043 if (ix+iz)%2 else .060
        spe.append(box((tone,tone*.9,tone*1.3),(3.93,.12,4.93),(cx,floor_y+.12,cz),0,False,emis=.7))
for zoff in (-11.5,0,11.5):
    spe.append(line_set([(HALL[0]-27,floor_y+.2,HALL[2]+zoff),(HALL[0]+27,floor_y+.2,HALL[2]+zoff)],[[0,1]],(.65,.46,.24),2))
for row in (-7,7):
    for i in range(8):
        x = HALL[0]-24+i*6.8
        for yoff, radius, height in [(-hh/2+.28,1.3,.4),(-hh/2+.7,1.08,.15),(hh/2-.83,1.2,.15)]:
            spe.append(cyl((.55,.40,.26),radius,height,(x,HALL[1]+yoff,HALL[2]+row),.05,.6))
        # One thin vault rib per column pair; emissive accent, not a GI bake.
        if row == -7:
            points=[]
            for j in range(33):
                a=math.pi*j/32
                points.append((x,HALL[1]+2.1+3.1*math.sin(a),HALL[2]+13.5*math.cos(a)))
            spe.append(line_set(points,[list(range(33))],(.28,.38,.47),1.5))
ornament=(HALL[0]+14,floor_y+2.6,HALL[2])
for plane,radius,colour in [('xz',2.6,(.95,.66,.32)),('yz',2.9,(.36,.78,.84)),('xy',2.35,(.81,.45,.78))]:
    spe.append(circle_line(ornament,radius,colour,plane=plane,segments=96,width=2))
for radius in (3.3,4.0,5.3):
    spe.append(circle_line((ornament[0],floor_y+.22,ornament[2]),radius,(.54,.38,.22),segments=96))
for a in range(0,360,30):
    a=math.radians(a)
    spe.append(line_set([(ornament[0]+3.3*math.cos(a),floor_y+.24,ornament[2]+3.3*math.sin(a)),(ornament[0]+5.3*math.cos(a),floor_y+.24,ornament[2]+5.3*math.sin(a))],[[0,1]],(.54,.38,.22)))
spe.append("<PointLight color='0.30 0.70 0.90' intensity='0.35' radius='35' location='%s'/>" % f(HALL[0]-14,HALL[1]-1,HALL[2]))
L_('hall', "IMAGINED INTERIOR|no description exists beyond a few words in Cayce's readings", (HALL[0], HALL[1]+hh+4, HALL[2]), 2.6, cS)
L_('hall', "CAYCE'S HALL OF RECORDS|trance readings, 1930s-40s|right forepaw, between Sphinx and Nile|depth unstated; ~10,500 BC", (HALL[0]+10, HALL[1]+hh+16, HALL[2]+30), 3.2, cS, far=(400, 7)); spe.append("</Group>")
R = 80.0; cyl_r = 4.0; DEPTH = 648.0; ring = []
spe.append("<Group>%s" % touch('T_khafre', 'The "648 m" claim: click'))
for k in range(8):
    a = k*math.pi/4; cx, cz = KHAFRE[0]+R*math.cos(a), KHAFRE[2]+R*math.sin(a)
    spe.append("<Transform translation='%s'><Shape>%s<Cylinder radius='%.3g' height='%.4g' top='false' bottom='false'/></Shape></Transform>" % (f(cx, -DEPTH/2, cz), mat(cS, 0.8, 0.9), cyl_r, DEPTH)); ring.append((cx, cz))
pts = []; idx = []; n = 0
for (cx, cz) in ring:
    N = 160; turns = 36
    for i in range(N+1):
        t = i/N; a = t*turns*2*math.pi; pts.append((cx+(cyl_r+2.5)*math.cos(a), -t*DEPTH, cz+(cyl_r+2.5)*math.sin(a)))
    idx.append(' '.join(str(n+i) for i in range(N+1))+' -1'); n += N+1
spe.append("<Shape>%s<IndexedLineSet coordIndex='%s'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (lmat((0.8, 0.3, 0.7)), ' '.join(idx), ' '.join(f(*p) for p in pts)))
for sx in (-60, 60): spe.append(box(cS, (90, 90, 90), (KHAFRE[0]+sx, -DEPTH+45, KHAFRE[2]), 0.65, True, emis=1.0))
L_('khafreclaim', '"648 m" CLAIM (Mar 2025)|8 shafts + spirals + 2 cubes under Khafre|unpublished; rejected by Hawass, Conyers', (KHAFRE[0], -90, KHAFRE[2]-130), 12, cS, far=(700, 18)); spe.append("</Group>")
net = [(SUBC[0], SUBC[1], SUBC[2]), (HALL[0]-28, HALL[1], HALL[2]-4), (PAW_R[0], -9, 6.0), (O[0]+6, yC+1.0, O[2]), (ring[4][0], -30, ring[4][1])]
for a, b in zip(net, net[1:]): spe.append(seg(cS, a, b, 0.5, 0.5, 0.9))
L_('onesys', '"ONE SYSTEM" (illustration)|joins every claim; no source', (-100, -45, -40), 9, cS, far=(700, 14))
keys = [0]; Ls = [math.dist(a, b) for a, b in zip(net, net[1:])]; tot = sum(Ls); acc = 0
for l in Ls: acc += l; keys.append(acc/tot)
kv = ' '.join(f(*p) for p in net); timers = []
for i, st in enumerate((1, 7, 13)):
    spe.append("<Transform DEF='Pulse%d'><Shape>%s<Sphere radius='2.6'/></Shape></Transform>" % (i, lmat((1, 0.75, 0.95))))
    timers.append("<TimeSensor DEF='PClk%d' cycleInterval='24' loop='true' startTime='%d'/><PositionInterpolator DEF='PInt%d' key='%s' keyValue='%s'/>" % (i, st, i, f(*keys), kv))
# ---------------- views and tour ----------------
VIEWS = [
 ('V_Overview', 'Overview: pyramids, Sphinx, causeway', (-80, 420, 760), (-330, -40, -120)),
 ('V_Sunrise', 'Sphinx at equinox sunrise', (110, 18, 95), (0, 12, -6)),
 ('V_Osiris', 'Osiris Shaft, side section', (O[0]-1, -17, O[2]+58), (O[0]-1, -17, O[2])),
 ('V_ChamberB', 'Inside Chamber B', (O[0]+1.0, -21.6, O[2]+1.2), (O[0]+7, -22, O[2]-0.3)),
 ('V_Depth', 'Osiris depth ruler: source quantities', (O[0]-28, -20, O[2]+30), (O[0]-8, -20, O[2])),
 ('V_Anomaly', 'Seismic anomaly under the paws', (62, -4, 38), (PAW_R[0], -8, 0)),
 ('V_Hall', "Cayce's Hall of Records, outside", (40, 30, 130), (HALL[0], HALL[1]+5, HALL[2])),
 ('V_HallInside', 'Inside the imagined Hall', (HALL[0]-25, HALL[1]-3.2, HALL[2]), (HALL[0]+14, HALL[1]-2.5, HALL[2])),
 ('V_Khafre', 'Khafre "648 m" claim', (KHAFRE[0]+480, -330, KHAFRE[2]+660), (KHAFRE[0], -330, KHAFRE[2])),
 ('V_Khufu', 'Great Pyramid: Big Void', (KHUFU[0]+170, 60, KHUFU[2]+200), (KHUFU[0], 40, KHUFU[2])),
 ('V_Orion', 'Orion over the pyramids', (330, 22, 40), (-640, 190, -60)),
 ('V_Top', 'Plan view', (-330, 1100, -120), (-330, 0, -120)),
 ('V_Survey', 'Survey frame: model datum and metric rings', (165,180,240), (0,0,0)),
 ('V_DepthCompare', 'Depth theatre: unlike quantities, one metric scale', (-10,-320,1450), (-430,-320,360)),
 ('V_HallDetail', 'Imagined Hall: armillary and architectural craft', (HALL[0]+3,HALL[1]-3.1,HALL[2]+8), (HALL[0]+14,HALL[1]-2.9,HALL[2])),
 ('V_Section', 'Osiris section: enable the cutaway plane', (O[0]-12,6,O[2]+80), (O[0]+3,-16,O[2]))]
vp = ["<Viewpoint DEF='%s' description=%s position='%s' orientation='%s' centerOfRotation='%s' fieldOfView='0.8'/>" % (nmv, quoteattr(d), f(*p), f(*look(p, t)), f(*t)) for nmv, d, p, t in VIEWS]
TOUR = [(0, (-80, 420, 760), (-330, -40, -120), 'Giza from above: three pyramids, the Sphinx, and the causeway between them.'),
        (7, (110, 18, 95), (0, 12, -6), 'The Sphinx faces due east. At the equinox the sun rises straight over its gaze.'),
        (14, (O[0]+30, 14, O[2]+60), (O[0], -5, O[2]), 'Under Khafre\'s causeway, about halfway from the Sphinx to the pyramid, a shaft drops into the rock: the Osiris Shaft.'),
        (20, (O[0]-1, -17, O[2]+34), (O[0]-1, -17, O[2]), 'Three levels: 9.62 m, then 13.25 m, then about 7.5 m more, ending in water.'),
        (26, (O[0]+1.0, -21.6, O[2]+1.2), (O[0]+7, -22, O[2]-0.3), 'Chamber B: 6.80 by 3.65 by 2.60 m, with six side chambers.'),
        (32, (62, -4, 38), (PAW_R[0], -8, 0), 'A 1991 seismic survey of the Sphinx enclosure is popularly said to show a void under a paw.'),
        (38, (40, 30, 130), (HALL[0], HALL[1]+5, HALL[2]), "Edgar Cayce's readings placed a Hall of Records near here. No chamber has been found."),
        (44, (HALL[0]-25, HALL[1]-3.2, HALL[2]), (HALL[0]+14, HALL[1]-2.5, HALL[2]), 'An imagined interior. Nothing here is evidence; it is what the idea would look like.'),
        (52, (KHAFRE[0]+480, -330, KHAFRE[2]+660), (KHAFRE[0], -330, KHAFRE[2]), 'A 2025 claim: eight shafts, 648 m deep. Unpublished and rejected. Note the scale against the Osiris Shaft.'),
        (60, (KHUFU[0]+170, 60, KHUFU[2]+200), (KHUFU[0], 40, KHUFU[2]), 'Measured, not claimed: muon imaging found a void at least 30 m long inside the Great Pyramid.'),
        (68, (-80, 420, 760), (-330, -40, -120), 'Documented, theorized, speculative: three colours, one plateau.')]
T = TOUR[-1][0]; tk = ' '.join('%.4g' % (t/T) for t, *_ in TOUR)
tour = ("<Transform DEF='TourRig'><Viewpoint DEF='V_Tour' description='Guided descent (68 s)' fieldOfView='0.8'/></Transform><TimeSensor DEF='TourClock' cycleInterval='%d' loop='false'/>"
        "<PositionInterpolator DEF='TourPos' key='%s' keyValue='%s'/><OrientationInterpolator DEF='TourOri' key='%s' keyValue='%s'/>") % (T, tk, ' '.join(f(*p) for _, p, _, _ in TOUR), tk, ' '.join(f(*look(p, tg)) for _, p, tg, _ in TOUR))
json.dump(dict(duration=T, stops=[dict(t=t, caption=c) for t, _, _, c in TOUR], views=[dict(id=a, label=b) for a, b, *_ in VIEWS]), open(os.path.join(OUT, 'tour.json'), 'w'), indent=1)
# ---------------- zones (discovery) ----------------
ZONES = [('Z_sphinx', (0, 10, 0), (110, 60, 70)), ('Z_osiris', (O[0]+3, -20, O[2]), (70, 90, 70)), ('Z_anomaly', (PAW_R[0], -8, 0), (60, 40, 50)), ('Z_hall', HALL, (70, 40, 50)),
         ('Z_khufu', (KHUFU[0], 40, KHUFU[2]), (260, 160, 260)), ('Z_khafre', (KHAFRE[0], -330, KHAFRE[2]), (320, 700, 320)), ('Z_menkaure', (MENKAURE[0], 35, MENKAURE[2]), (170, 100, 170))]
zones = ''.join("<ProximitySensor DEF='%s' center='%s' size='%s'/>" % (n, f(*c), f(*s)) for n, c, s in ZONES)
routes = ["<ROUTE fromNode='CamSensor' fromField='position_changed' toNode='SkyRig' toField='set_translation'/>"]
for i in range(3):
    routes.append("<ROUTE fromNode='PClk%d' fromField='fraction_changed' toNode='PInt%d' toField='set_fraction'/><ROUTE fromNode='PInt%d' fromField='value_changed' toNode='Pulse%d' toField='set_translation'/>" % (i, i, i, i))
for i, st in enumerate((1, 3.3, 5.6)):
    timers.append("<TimeSensor DEF='RClk%d' cycleInterval='9' loop='true' startTime='%.1f'/><PositionInterpolator DEF='RSc%d' key='0 1' keyValue='2 1 2 38 1 38'/><ScalarInterpolator DEF='RTr%d' key='0 1' keyValue='0.25 1'/>" % (i, st, i, i))
    routes.append("<ROUTE fromNode='RClk%d' fromField='fraction_changed' toNode='RSc%d' toField='set_fraction'/><ROUTE fromNode='RSc%d' fromField='value_changed' toNode='Ring%d' toField='set_scale'/><ROUTE fromNode='RClk%d' fromField='fraction_changed' toNode='RTr%d' toField='set_fraction'/><ROUTE fromNode='RTr%d' fromField='value_changed' toNode='RingM%d' toField='set_transparency'/>" % (i, i, i, i, i, i, i, i))
timers.append("<TimeSensor DEF='WaterClk' cycleInterval='7' loop='true'/><ScalarInterpolator DEF='WaterInt' key='0 0.5 1' keyValue='0.42 0.62 0.42'/><TimeSensor DEF='OrbClk' cycleInterval='5' loop='true'/><PositionInterpolator DEF='OrbInt' key='0 0.5 1' keyValue='1 1 1 1.35 1.35 1.35 1 1 1'/>")
routes.append("<ROUTE fromNode='WaterClk' fromField='fraction_changed' toNode='WaterInt' toField='set_fraction'/><ROUTE fromNode='WaterInt' fromField='value_changed' toNode='WaterMat' toField='set_transparency'/><ROUTE fromNode='OrbClk' fromField='fraction_changed' toNode='OrbInt' toField='set_fraction'/><ROUTE fromNode='OrbInt' fromField='value_changed' toNode='Orb' toField='set_scale'/>")
routes.append("<ROUTE fromNode='TourClock' fromField='fraction_changed' toNode='TourPos' toField='set_fraction'/><ROUTE fromNode='TourPos' fromField='value_changed' toNode='TourRig' toField='set_translation'/><ROUTE fromNode='TourClock' fromField='fraction_changed' toNode='TourOri' toField='set_fraction'/><ROUTE fromNode='TourOri' fromField='value_changed' toNode='TourRig' toField='set_rotation'/>")
LBX = ''.join("<Switch DEF='LB_%s' whichChoice='0'><Group>%s</Group></Switch>" % (k, ''.join(v)) for k, v in LB.items())
CEN = dict(khufuin=(KHUFU[0], 40, KHUFU[2]), osiris=O, depth=(O[0]-8, -20, O[2]), anomaly=PAW_R, hall=HALL, gaze=(60, 17, 0), khufu=KHUFU, khafre=(KHAFRE[0], -100, KHAFRE[2]), khafreclaim=(KHAFRE[0], -100, KHAFRE[2]), menk=MENKAURE, sphinx=(0, 10, 0), causeway=((V[0]+P_END[0])/2, 0, (V[2]+P_END[2])/2), onesys=(-100, -45, -40), orion=(-620, 300, -170))
json.dump(dict(clusters={k: dict(r=CLUSTER_R[k], c=list(CEN[k])) for k in LB}), open(os.path.join(OUT, 'clusters.json'), 'w'))
def sw(name, items): return "<Switch DEF='%s' whichChoice='0'><Group>%s</Group></Switch>" % (name, ''.join(items))
x = ("<?xml version='1.0' encoding='UTF-8'?>\n<X3D profile='Immersive' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>\n"
     "<head><component name='Shape' level='5'/><component name='Rendering' level='5'/><meta name='title' content='Giza v2: Osiris Shaft and Hall of Records'/><meta name='description' content='Schematic X3D study of the Osiris Shaft and the Hall of Records ideas under Giza, with a Blender-baked surface and a precession sky. Archaeological and interpretive layers are tagged documented, theorized or speculative; survey and section instruments are modelling annotations.'/>"
     "<meta name='creator' content='HagopJay and Claude'/><meta name='generator' content='build_scene2.py'/><meta name='observation-overlays' content='Survey rings, depth theatre, and section cut are modelling instruments; no new archaeological measurements. Imagined Hall ornament is fictional.'/><meta name='license' content='CC0 (geometry); source claims keep their own authors'/></head>\n<Scene>\n"
     "<NavigationInfo DEF='NAV' type='\"EXAMINE\" \"FLY\" \"WALK\" \"ANY\"' speed='60' avatarSize='0.3 1.7 0.75' headlight='true'/>"
     "<Background DEF='BG' skyColor='0.03 0.04 0.10 0.30 0.20 0.28 0.95 0.55 0.30' skyAngle='1.0 1.5708' groundColor='0.02 0.025 0.04 0.30 0.20 0.20' groundAngle='1.5708'/>"
     "<Fog DEF='FOG' fogType='LINEAR' visibilityRange='16000' color='0.20 0.16 0.20'/>"
     "<ProximitySensor DEF='CamSensor' size='1e9 1e9 1e9'/>" + ''.join(vp) + tour + zones + sky
     + "<Group DEF='SECTION_WORLD'><ClipPlane DEF='CLIP_SECTION' enabled='false' plane='0 0 -1 -28'/><Switch DEF='SW_SURFACE' whichChoice='0'><Group>" + surface + ''.join(ctx) + "</Group></Switch>"
     + sw('SW_DOC', doc) + sw('SW_THE', the) + sw('SW_SPE', spe) + "</Group>" + survey + scale + LBX + ''.join(timers) + ''.join(routes) + "\n</Scene></X3D>\n")
open(os.path.join(OUT, 'giza-atlas-v3.x3d'), 'w').write(x)
print('wrote', len(x), 'bytes;', len(blob), 'state bytes')
