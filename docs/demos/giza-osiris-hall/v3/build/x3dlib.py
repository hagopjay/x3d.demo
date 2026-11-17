import math
from xml.sax.saxutils import quoteattr, escape
def xesc(s): return escape(s, {"'": '&apos;'})
COL = {'D': (0.24, 0.90, 0.82), 'T': (1.0, 0.70, 0.28), 'S': (1.0, 0.31, 0.85), 'C': (0.62, 0.55, 0.42)}
def f(*v): return ' '.join(('%.4g' % x) for x in v)
def f3(*v): return ' '.join(('%.3f' % x).rstrip('0').rstrip('.') if abs(x) > 1e-9 else '0' for x in v)
def mat(c, trans=0.0, emis=0.7, dif=0.35, defn=None):
    d = " DEF='%s'" % defn if defn else ''
    return "<Appearance><Material%s diffuseColor='%s' emissiveColor='%s' transparency='%.3g'/></Appearance>" % (d, f(*[x*dif for x in c]), f(*[x*emis for x in c]), trans)
def lmat(c): return "<Appearance><Material diffuseColor='0 0 0' emissiveColor='%s'/></Appearance>" % f(*c)
def box(c, size, pos, trans=0.45, wire=True, rot=None, emis=0.5, solid=True, defn=None):
    r = " rotation='%s'" % f(*rot) if rot else ''
    s = "<Transform translation='%s'%s>" % (f(*pos), r)
    s += "<Shape>%s<Box size='%s'%s/></Shape>" % (mat(c, trans, emis, defn=defn), f(*size), '' if solid else " solid='false'")
    if wire:
        x, y, z = [d/2 for d in size]
        P = [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
        idx = '0 1 2 3 0 -1 4 5 6 7 4 -1 0 4 -1 1 5 -1 2 6 -1 3 7 -1'
        s += "<Shape>%s<IndexedLineSet coordIndex='%s'><Coordinate point='%s'/></IndexedLineSet></Shape>" % (lmat(c), idx, ' '.join(f(*p) for p in P))
    return s + "</Transform>"
def rot_y_to(d):
    n = math.sqrt(sum(a*a for a in d)); d = [a/n for a in d]
    ax = (d[2], 0, -d[0]); s = math.sqrt(ax[0]**2 + ax[2]**2)
    if s < 1e-9: return (1, 0, 0, 0 if d[1] > 0 else math.pi)
    return (ax[0]/s, 0, ax[2]/s, math.acos(max(-1, min(1, d[1]))))
def seg(c, p, q, r, trans=0.3, emis=0.8, defn=None):
    d = [q[i]-p[i] for i in range(3)]; L = math.sqrt(sum(a*a for a in d)); m = [(p[i]+q[i])/2 for i in range(3)]
    return "<Transform translation='%s' rotation='%s'><Shape>%s<Cylinder radius='%.3g' height='%.4g' top='false' bottom='false'/></Shape></Transform>" % (f(*m), f(*rot_y_to(d)), mat(c, trans, emis, defn=defn), r, L)
def cyl(c, r, h, pos, trans=0.5, emis=0.7):
    return "<Transform translation='%s'><Shape>%s<Cylinder radius='%.3g' height='%.4g'/></Shape></Transform>" % (f(*pos), mat(c, trans, emis), r, h)
def look(pos, tgt):
    d = [tgt[i]-pos[i] for i in range(3)]; n = math.sqrt(sum(a*a for a in d)); d = [a/n for a in d]
    up = (0, 1, 0)
    if abs(d[1]) > .999: up = (0, 0, -1)
    r = [d[1]*up[2]-d[2]*up[1], d[2]*up[0]-d[0]*up[2], d[0]*up[1]-d[1]*up[0]]; rn = math.sqrt(sum(a*a for a in r)); r = [a/rn for a in r]
    u = [r[1]*d[2]-r[2]*d[1], r[2]*d[0]-r[0]*d[2], r[0]*d[1]-r[1]*d[0]]; z = [-a for a in d]
    m = [[r[0], u[0], z[0]], [r[1], u[1], z[1]], [r[2], u[2], z[2]]]
    tr = m[0][0]+m[1][1]+m[2][2]; ang = math.acos(max(-1, min(1, (tr-1)/2)))
    if ang < 1e-6: return (0, 1, 0, 0)
    if abs(ang-math.pi) < 1e-4:
        i = max(range(3), key=lambda k: m[k][k]); a = [0, 0, 0]; a[i] = math.sqrt((m[i][i]+1)/2)
        for k in range(3):
            if k != i: a[k] = m[i][k]/(2*a[i])
        return (*a, ang)
    ax = [m[2][1]-m[1][2], m[0][2]-m[2][0], m[1][0]-m[0][1]]; n = math.sqrt(sum(a*a for a in ax))
    return (ax[0]/n, ax[1]/n, ax[2]/n, ang)
def text_shape(text, size, c, justify='MIDDLE'):
    return "<Shape>%s<Text string='%s'><FontStyle family='\"SANS\"' size='%.3g' justify='\"%s\"' spacing='1.1'/></Text></Shape>" % (
        lmat(c), xesc(' '.join('"%s"' % l for l in text.split('|'))), size, justify)
def label(text, pos, size, c, far=None):
    one = lambda sz: "<Billboard axisOfRotation='0 0 0'>%s</Billboard>" % text_shape(text, sz, c)
    s = "<Transform translation='%s'>" % f(*pos)
    s += ("<LOD range='%.4g' center='0 0 0'>%s%s</LOD>" % (far[0], one(size), one(far[1]))) if far else one(size)
    return s + "</Transform>"
def touch(defn, desc): return "<TouchSensor DEF='%s' description=%s/>" % (defn, quoteattr(desc))
