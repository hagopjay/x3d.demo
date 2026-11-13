#!/usr/bin/env python3
"""Giza: Osiris Shaft + Hall of Records. Writes giza-osiris-hall.x3d (X3D 4.0, Immersive).
Frame: metres, x east, z south, y up, ground plateau y=0. All underground geometry is SCHEMATIC.
Tier colours: DOCUMENTED cyan, THEORIZED amber, SPECULATIVE magenta."""
import math, sys, json
from xml.sax.saxutils import quoteattr, escape
def xesc(s): return escape(s, {"'": '&apos;'})
OUT = sys.argv[1]
COL = {'D': (0.24, 0.90, 0.82), 'T': (1.0, 0.70, 0.28), 'S': (1.0, 0.31, 0.85), 'C': (0.62, 0.55, 0.42)}
out = []; defs = set()
def f(*v): return ' '.join(('%.4g' % x) for x in v)
def mat(c, trans=0.0, emis=0.7, dif=0.35):
    return "<Appearance><Material diffuseColor='%s' emissiveColor='%s' transparency='%.3g'/></Appearance>" % (
        f(*[x*dif for x in c]), f(*[x*emis for x in c]), trans)
def lmat(c): return "<Appearance><Material diffuseColor='0 0 0' emissiveColor='%s'/></Appearance>" % f(*c)
def box(c, size, pos, trans=0.45, wire=True, rot=None, name=None, emis=0.5):
    r = " rotation='%s'" % f(*rot) if rot else ''
    s = "<Transform translation='%s'%s>" % (f(*pos), r)
    s += "<Shape>%s<Box size='%s'/></Shape>" % (mat(c, trans, emis), f(*size))
    if wire:
        x, y, z = [d/2 for d in size]
        P = [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
        idx = '0 1 2 3 0 -1 4 5 6 7 4 -1 0 4 -1 1 5 -1 2 6 -1 3 7 -1'
        s += "<Shape>%s<IndexedLineSet coordIndex='%s'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (
            lmat(c), idx, ' '.join(f(*p) for p in P))
    return s + "</Transform>"
def rot_y_to(d):
    n = math.sqrt(sum(a*a for a in d)); d = [a/n for a in d]
    ax = (d[2], 0, -d[0])  # y cross d = (1*d2-0, 0*d0-0*d2, 0-1*d0)
    s = math.sqrt(ax[0]**2 + ax[2]**2)
    if s < 1e-9: return (1, 0, 0, 0 if d[1] > 0 else math.pi)
    return (ax[0]/s, 0, ax[2]/s, math.acos(max(-1, min(1, d[1]))))
def seg(c, p, q, r, trans=0.3, emis=0.8):
    d = [q[i]-p[i] for i in range(3)]; L = math.sqrt(sum(a*a for a in d))
    m = [(p[i]+q[i])/2 for i in range(3)]
    return "<Transform translation='%s' rotation='%s'><Shape>%s<Cylinder radius='%.3g' height='%.4g' top='false' bottom='false'/></Shape></Transform>" % (
        f(*m), f(*rot_y_to(d)), mat(c, trans, emis), r, L)
def look(pos, tgt):
    d = [tgt[i]-pos[i] for i in range(3)]; n = math.sqrt(sum(a*a for a in d)); d = [a/n for a in d]
    up = (0, 1, 0)
    if abs(d[1]) > .999: up = (0, 0, -1)
    r = [d[1]*up[2]-d[2]*up[1], d[2]*up[0]-d[0]*up[2], d[0]*up[1]-d[1]*up[0]]
    rn = math.sqrt(sum(a*a for a in r)); r = [a/rn for a in r]
    u = [r[1]*d[2]-r[2]*d[1], r[2]*d[0]-r[0]*d[2], r[0]*d[1]-r[1]*d[0]]
    z = [-a for a in d]
    m = [[r[0], u[0], z[0]], [r[1], u[1], z[1]], [r[2], u[2], z[2]]]
    tr = m[0][0]+m[1][1]+m[2][2]
    ang = math.acos(max(-1, min(1, (tr-1)/2)))
    if ang < 1e-6: return (0, 1, 0, 0)
    if abs(ang-math.pi) < 1e-4:
        i = max(range(3), key=lambda k: m[k][k]); a = [0, 0, 0]; a[i] = math.sqrt((m[i][i]+1)/2)
        for k in range(3):
            if k != i: a[k] = m[i][k]/(2*a[i])
        return (*a, ang)
    ax = [m[2][1]-m[1][2], m[0][2]-m[2][0], m[1][0]-m[0][1]]; n = math.sqrt(sum(a*a for a in ax))
    return (ax[0]/n, ax[1]/n, ax[2]/n, ang)
def label(text, pos, size, c, far=None):
    def one(sz):
        return ("<Billboard axisOfRotation='0 0 0'><Shape>%s<Text string='%s'><FontStyle family='\"SANS\"' size='%.3g' justify='\"MIDDLE\"' spacing='1.1'/></Text></Shape></Billboard>"
                % (lmat(c), xesc(' '.join('"%s"' % l for l in text.split('|'))), sz))
    s = "<Transform translation='%s'>" % f(*pos)
    if far:
        s += "<LOD range='%.4g' center='0 0 0'>%s%s</LOD>" % (far[0], one(size), one(far[1]))
    else:
        s += one(size)
    return s + "</Transform>"
def pyramid(c, center, base, h, trans=0.8):
    cx, cy, cz = center; b = base/2
    P = [(cx-b,0,cz-b),(cx+b,0,cz-b),(cx+b,0,cz+b),(cx-b,0,cz+b),(cx,h,cz)]
    s = "<Shape>%s<IndexedFaceSet solid='false' coordIndex='0 1 4 -1 1 2 4 -1 2 3 4 -1 3 0 4 -1'><Coordinate point='%s'/></IndexedFaceSet></Shape>" % (
        mat(COL['C'], trans, 0.25, 0.5), ' '.join(f(*p) for p in P))
    s += "<Shape>%s<IndexedLineSet coordIndex='0 1 2 3 0 -1 0 4 -1 1 4 -1 2 4 -1 3 4 -1'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (lmat((0.8, 0.72, 0.55)), ' '.join(f(*p) for p in P))
    return s

# ---------- layout (metres) ----------
O = (-109.0, 0.0, 14.0)                 # model's Osiris mouth (13.6 m S of causeway axis, 144.9 m up from Valley Temple end)
V = (35.0, 0.0, 35.0); P_end = (-446.0, 0.0, -82.0)
KHAFRE = (-560.0, 0.0, -100.0); KHUFU = (-330.0, 0.0, -480.0)
PAW_R = (30.0, 0.0, 6.0)
doc, the, spe, ctx = [], [], [], []

# ---------- context (always on) ----------
ctx.append("<Shape>%s<Box size='1700 0.2 1700'/></Shape>" % "")  # placeholder replaced below
ctx.clear()
ctx.append("<Transform translation='-300 0 -250'><Shape>%s<Box size='1800 0.1 1500'/></Shape></Transform>" % mat(COL['C'], 0.62, 0.12, 0.35))
grid = []; gi = []; n = 0
for gx in range(-1200, 601, 100):
    grid += [(gx, 0.05, -1000), (gx, 0.05, 500)]; gi.append('%d %d -1' % (n, n+1)); n += 2
for gz in range(-1000, 501, 100):
    grid += [(-1200, 0.05, gz), (600, 0.05, gz)]; gi.append('%d %d -1' % (n, n+1)); n += 2
ctx.append("<Shape>%s<IndexedLineSet coordIndex='%s'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (lmat((0.2, 0.22, 0.26)), ' '.join(gi), ' '.join(f(*p) for p in grid)))
ctx.append(pyramid(COL['C'], KHAFRE, 215.25, 143.5))
ctx.append(pyramid(COL['C'], KHUFU, 230.33, 138.5))
ang = -math.radians(13.7)
ctx.append(box((0.55, 0.5, 0.42), (494.6, 0.6, 15), ((V[0]+P_end[0])/2, 0.3, (V[2]+P_end[2])/2), 0.35, False, rot=(0, 1, 0, ang)))
ctx.append(box((0.55, 0.5, 0.42), (14, 4, 12), (V[0]+6, 2, V[2]+4), 0.3, True))   # Valley Temple marker
# Sphinx massing
sc = (0.78, 0.66, 0.46)
ctx.append(box(sc, (54, 12, 19.8), (-10, 6, 0), 0.25, True))
ctx.append(box(sc, (22, 4, 5), (30, 2, 5.5), 0.25, True)); ctx.append(box(sc, (22, 4, 5), (30, 2, -5.5), 0.25, True))
ctx.append(box(sc, (9, 8, 8), (13, 16, 0), 0.25, True))
ctx.append(label('Khafre pyramid|215.25 m base, 143.5 m (published)', (KHAFRE[0], 175, KHAFRE[2]), 8, (0.9, 0.82, 0.62), far=(600, 12)))
ctx.append(label('Great Pyramid (Khufu)|230.33 m base, 138.5 m today', (KHUFU[0], 170, KHUFU[2]), 8, (0.9, 0.82, 0.62), far=(600, 12)))
ctx.append(label('Sphinx (massing only)', (10, 30, 0), 3, (0.9, 0.82, 0.62), far=(300, 8)))
ctx.append(label('Khafre causeway 494.6 m', ((V[0]+P_end[0])/2, 12, (V[2]+P_end[2])/2), 5, (0.9, 0.82, 0.62), far=(400, 8)))

# ---------- DOCUMENTED ----------
cD = COL['D']
doc.append("<Transform translation='%s'>" % f(*O))
sh = 2.0
doc.append(box(cD, (sh, 9.62, sh), (0, -4.81, 0), 0.5, True))                               # Shaft A
doc.append(box(cD, (5, 2.7, 4), (0, -8.27, 0), 0.55, True))                                  # Chamber A (size schematic)
doc.append(box(cD, (sh, 13.25, sh), (4, -9.62-6.625, 0), 0.5, True))                         # Shaft B
yB = -(9.62+13.25)
doc.append(box(cD, (6.80, 2.60, 3.65), (4, yB+1.3, 0), 0.55, True))                          # Chamber B
for i, dx in enumerate((-2.2, 0, 2.2)):
    doc.append(box(cD, (1.6, 1.5, 1.8), (4+dx, yB+1.1, 1.825+0.9), 0.6, True))
    doc.append(box(cD, (1.6, 1.5, 1.8), (4+dx, yB+1.1, -1.825-0.9), 0.6, True))
doc.append(box(cD, (sh, 7.5, sh), (6, yB-3.75, 0), 0.5, True))                               # Shaft C
yC = yB-7.5
doc.append(box((0.25, 0.55, 1.0), (9, 2.8, 6.4), (6, yC+1.0, 0), 0.55, True))                # flooded Level 3 (water, schematic)
doc.append(label('OSIRIS SHAFT|3 levels, schematic plan', (0, 6, 0), 1.6, cD, far=(110, 9)))
doc.append(label('Shaft A 9.62 m', (-4.5, -4.8, 0), 0.8, cD))
doc.append(label('Chamber B 6.80 x 3.65 x 2.60 m|+ 6 side chambers (C-H)', (-6.5, yB+1.3, 0), 0.8, cD))
doc.append(label('Level 3: water-filled|Shaft C ~7.5 m', (-5.0, yC+1.2, 0), 0.8, cD))
doc.append("</Transform>")
# Big Void (Khufu): documented by muon imaging, schematic position
K = KHUFU
doc.append(seg(cD, (K[0]-7.3, 17, K[2]-115.2), (K[0], -30+4, K[2]-60), 0.9))
doc.append(box(cD, (14, 6, 8), (K[0], -30, K[2]-55), 0.5, True))                              # Subterranean Chamber, ~30 m below pavement
doc.append(seg(cD, (K[0], 21.6, K[2]-25), (K[0], 42.1, K[2]+16.9), 1.6))                      # Grand Gallery 46.68 m
doc.append(box(cD, (5.24, 5.97, 10.47), (K[0], 46, K[2]+27), 0.5, True))                       # King's Chamber
doc.append(box(cD, (2.6, 8.0, 30.0), (K[0], 62, K[2]-8), 0.4, True, emis=0.9))                 # ScanPyramids Big Void (>=30 m)
doc.append(label('Big Void (muon imaging, 2017)|>= 30 m long, position schematic', (K[0]+40, 70, K[2]-8), 3, cD, far=(260, 14)))
doc.append(label("King's Chamber", (K[0]-24, 46, K[2]+27), 2, cD))
doc.append(label('Subterranean Chamber|~30 m below pavement', (K[0]+30, -30, K[2]-55), 2, cD))

# ---------- THEORIZED ----------
cT = COL['T']
the.append(box(cT, (12, 5, 9), (PAW_R[0], -7.5, 6.0), 0.55, True, emis=0.9))                  # reported seismic anomaly, right-paw reading
the.append(box(cT, (12, 5, 9), (PAW_R[0], -7.5, -6.0), 0.85, True, emis=0.5))                 # left-paw alternative
the.append(label('Seismic anomaly under the paws?|~12 x 9 x 5 m, ~5 m down (popular accounts)|reports say right OR left paw', (PAW_R[0], 8, 18), 2, cT, far=(260, 9)))
# ping rings
for i, st in enumerate((1, 3.3, 5.6)):
    the.append("<Transform DEF='Ring%d' translation='%s'><Shape>%s<Cylinder radius='1' height='0.15' top='true' bottom='false'/></Shape></Transform>" % (
        i, f(PAW_R[0], 0.4, 6.0), "<Appearance><Material DEF='RingM%d' diffuseColor='0 0 0' emissiveColor='%s' transparency='0.3'/></Appearance>" % (i, f(*cT))))
# depth ruler at Osiris (disputed totals)
rx = O[0]-8; rz = O[2]
the.append("<Shape>%s<IndexedLineSet coordIndex='0 1 -1'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (lmat(cT), f(rx, 0, rz, rx, -41.48, rz)))
for d, t in ((25, '25 m: one Hawass write-up (last level)'), (30.37, '30.37 m: 9.62+13.25+7.5 (this project)'), (30, '~30 m / ~100 ft: Hawass, Whiting'), (41.43, '41.43 m: + chamber heights (this project)'), (41.48, '41.48 m: diagram of unknown origin')):
    off = {25: 0, 30.37: -1.2, 30: 1.2, 41.43: 1.2, 41.48: -1.2}[d]
    the.append(seg(cT, (rx-1.2, -d, rz), (rx+1.2, -d, rz), 0.1, 0, 1))
    the.append(label(t, (rx-13.5, -d+off*0.5, rz), 0.8, cT))
the.append(label('DEPTH: DISPUTED|totals disagree by ~11 m', (rx-3, 4, rz), 1.2, cT, far=(110, 7)))

# ---------- SPECULATIVE ----------
cS = COL['S']
hall = (118.0, -22.0, 16.0)
spe.append(seg(cS, (PAW_R[0]+8, -3, 6.0), (hall[0]-18, hall[1], hall[2]-4), 1.1))                # passage from right forepaw
spe.append(box(cS, (36, 7, 22), hall, 0.6, True, emis=1.0))                                      # "Hall of Records"
spe.append(label("CAYCE'S HALL OF RECORDS|trance readings, 1930s-40s|right forepaw, between Sphinx and Nile|depth unstated; ~10,500 BC", (hall[0], hall[1]+14, hall[2]), 2.4, cS, far=(300, 12)))
ring = []
R = 80.0; cyl_r = 4.0; DEPTH = 648.0
for k in range(8):
    a = k*math.pi/4
    cx, cz = KHAFRE[0]+R*math.cos(a), KHAFRE[2]+R*math.sin(a)
    spe.append("<Transform translation='%s'><Shape>%s<Cylinder radius='%.3g' height='%.4g' top='false' bottom='false'/></Shape></Transform>" % (
        f(cx, -DEPTH/2, cz), mat(cS, 0.8, 0.9), cyl_r, DEPTH))
    ring.append((cx, cz))
pts = []; idx = []; n = 0
for (cx, cz) in ring:
    N = 160; turns = 36
    for i in range(N+1):
        t = i/N; a = t*turns*2*math.pi
        pts.append((cx+(cyl_r+2.5)*math.cos(a), -t*DEPTH, cz+(cyl_r+2.5)*math.sin(a)))
    idx.append(' '.join(str(n+i) for i in range(N+1))+' -1'); n += N+1
spe.append("<Shape>%s<IndexedLineSet coordIndex='%s'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (lmat((0.8, 0.3, 0.7)), ' '.join(idx), ' '.join(f(*p) for p in pts)))
for sx in (-60, 60):
    spe.append(box(cS, (80, 80, 80), (KHAFRE[0]+sx, -DEPTH+40, KHAFRE[2]), 0.65, True, emis=1.0))
spe.append(label('"648 m" CLAIM (Mar 2025)|8 shafts + spirals + 2 cubes under Khafre|unpublished; rejected by Hawass, Conyers', (KHAFRE[0], -90, KHAFRE[2]-130), 12, cS, far=(700, 16)))
# the "one system" connector (this project's illustration)
net = [(KHUFU[0], -30, KHUFU[2]-55), (hall[0], hall[1], hall[2]), (PAW_R[0], -9, 6.0), (O[0]+6, yC+1.0, O[2]), (ring[4][0], -30, ring[4][1])]
for a, b in zip(net, net[1:]): spe.append(seg(cS, a, b, 0.5, 0.5, 0.9))
spe.append(label('"ONE SYSTEM" (illustration)|joins every claim; no source', (-100, -45, -40), 9, cS, far=(700, 14)))
# travelling pulses
keys = [0]; L = [math.dist(a, b) for a, b in zip(net, net[1:])]; tot = sum(L); acc = 0
for l in L: acc += l; keys.append(acc/tot)
kv = ' '.join(f(*p) for p in net)
for i, st in enumerate((1, 7, 13)):
    spe.append("<Transform DEF='Pulse%d'><Shape>%s<Sphere radius='2.6'/></Shape></Transform>" % (i, lmat((1, 0.75, 0.95))))
    spe.append("<TimeSensor DEF='PClk%d' cycleInterval='24' loop='true' startTime='%d'/><PositionInterpolator DEF='PInt%d' key='%s' keyValue='%s'/>" % (i, st, i, f(*keys), kv))

# ---------- views and tour ----------
VIEWS = [
 ('V_Overview', 'Overview: pyramids, Sphinx, causeway', (-40, 360, 620), (-200, -60, -170)),
 ('V_Osiris', 'Osiris Shaft, side section', (O[0]-1, -17, O[2]+58), (O[0]-1, -17, O[2])),
 ('V_Depth', 'Osiris depth ruler (disputed totals)', (O[0]-28, -20, O[2]+30), (O[0]-8, -20, O[2])),
 ('V_Anomaly', 'Seismic anomaly under the paws', (62, -4, 38), (PAW_R[0], -8, 0)),
 ('V_Hall', "Cayce's Hall of Records", (40, 30, 130), (110, -15, 14)),
 ('V_Khafre', 'Khafre "648 m" claim', (KHAFRE[0]+380, -250, KHAFRE[2]+520), (KHAFRE[0], -330, KHAFRE[2])),
 ('V_Khufu', 'Great Pyramid: Big Void', (KHUFU[0]+170, 60, KHUFU[2]+200), (KHUFU[0], 40, KHUFU[2])),
 ('V_Top', 'Plan view', (-250, 900, -150), (-250, 0, -150)),
]
vp = []
for nm, desc, p, t in VIEWS:
    vp.append("<Viewpoint DEF='%s' description=%s position='%s' orientation='%s' centerOfRotation='%s' fieldOfView='0.8'/>" % (nm, quoteattr(desc), f(*p), f(*look(p, t)), f(*t)))
TOUR = [(0, (-40, 360, 620), (-200, -60, -170)), (6, (O[0]+30, 14, O[2]+60), (O[0], -5, O[2])), (11, (O[0]+2, -17, O[2]+34), (O[0]+2, -17, O[2])),
        (17, (O[0]-24, -24, O[2]+26), (O[0], -25, O[2])), (22, (62, -4, 38), (PAW_R[0], -8, 0)), (27, (66, 10, 70), (110, -20, 14)),
        (33, (-30, -60, 160), (-250, -30, -40)), (42, (KHAFRE[0]+380, -250, KHAFRE[2]+520), (KHAFRE[0], -330, KHAFRE[2])),
        (52, (KHUFU[0]+170, 60, KHUFU[2]+200), (KHUFU[0], 40, KHUFU[2])), (60, (-40, 360, 620), (-200, -60, -170))]
T = TOUR[-1][0]
tk = ' '.join('%.4g' % (t/T) for t, _, _ in TOUR)
tour = ("<Transform DEF='TourRig'><Viewpoint DEF='V_Tour' description='Guided descent (60 s)' fieldOfView='0.8'/></Transform>"
        "<TimeSensor DEF='TourClock' cycleInterval='%d' loop='false' enabled='true'/>"
        "<PositionInterpolator DEF='TourPos' key='%s' keyValue='%s'/><OrientationInterpolator DEF='TourOri' key='%s' keyValue='%s'/>") % (
    T, tk, ' '.join(f(*p) for _, p, _ in TOUR), tk, ' '.join(f(*look(p, tg)) for _, p, tg in TOUR))

def sw(name, items): return "<Switch DEF='%s' whichChoice='0'><Group>%s</Group></Switch>" % (name, ''.join(items))
routes = []
for i in range(3):
    routes.append("<ROUTE fromNode='PClk%d' fromField='fraction_changed' toNode='PInt%d' toField='set_fraction'/><ROUTE fromNode='PInt%d' fromField='value_changed' toNode='Pulse%d' toField='set_translation'/>" % (i, i, i, i))
for i, st in enumerate((1, 3.3, 5.6)):
    # rings: scale 1->38 and fade, loop 9 s, staggered by startTime
    spe_clk = "<TimeSensor DEF='RClk%d' cycleInterval='9' loop='true' startTime='%.1f'/>" % (i, st)
    the.append(spe_clk + "<PositionInterpolator DEF='RSc%d' key='0 1' keyValue='2 1 2 38 1 38'/><ScalarInterpolator DEF='RTr%d' key='0 1' keyValue='0.25 1'/>" % (i, i))
    routes.append("<ROUTE fromNode='RClk%d' fromField='fraction_changed' toNode='RSc%d' toField='set_fraction'/><ROUTE fromNode='RSc%d' fromField='value_changed' toNode='Ring%d' toField='set_scale'/>"
                  "<ROUTE fromNode='RClk%d' fromField='fraction_changed' toNode='RTr%d' toField='set_fraction'/><ROUTE fromNode='RTr%d' fromField='value_changed' toNode='RingM%d' toField='set_transparency'/>" % (i, i, i, i, i, i, i, i))
routes.append("<ROUTE fromNode='TourClock' fromField='fraction_changed' toNode='TourPos' toField='set_fraction'/><ROUTE fromNode='TourPos' fromField='value_changed' toNode='TourRig' toField='set_translation'/>"
              "<ROUTE fromNode='TourClock' fromField='fraction_changed' toNode='TourOri' toField='set_fraction'/><ROUTE fromNode='TourOri' fromField='value_changed' toNode='TourRig' toField='set_rotation'/>")
x = ("<?xml version='1.0' encoding='UTF-8'?>\n<X3D profile='Immersive' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>\n"
     "<head><meta name='title' content='Giza: Osiris Shaft and Hall of Records'/><meta name='description' content='Schematic X3D study of the Osiris Shaft and the Hall of Records ideas under Giza; every element is tagged documented, theorized or speculative.'/>"
     "<meta name='creator' content='HagopJay and Claude'/><meta name='generator' content='build_scene.py'/><meta name='license' content='CC0 (geometry); source claims keep their own authors'/></head>\n<Scene>\n"
     "<NavigationInfo type='\"EXAMINE\" \"FLY\" \"ANY\"' speed='60' headlight='true'/>"
     "<Background skyColor='0.01 0.015 0.03 0.03 0.05 0.09' skyAngle='1.5708' groundColor='0.01 0.012 0.02 0.02 0.03 0.05' groundAngle='1.5708'/>"
     "<Fog fogType='EXPONENTIAL' visibilityRange='2600' color='0.01 0.015 0.03'/>"
     + ''.join(vp) + tour + ''.join(ctx) + sw('SW_DOC', doc) + sw('SW_THE', the) + sw('SW_SPE', spe) + ''.join(routes) + "\n</Scene></X3D>\n")
open(OUT, 'w').write(x)
print('wrote', OUT, len(x), 'bytes')
