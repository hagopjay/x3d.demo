"""Giza v2 surface geometry (X3D frame: x east, z south, y up, metres). Schematic massing.
Each mesh: dict(name, verts[[x,y,z]], faces[[i,j,k(,l)]], alb[[r,g,b]] per vertex linear)."""
import math, random
random.seed(26)
KHAFRE = (-651.0, 0.0, -95.0); KHUFU = (-329.0, 0.0, -435.0); MENKAURE = (-892.0, 0.0, 307.0)  # from Wikipedia centre coordinates, Sphinx at the origin
V = (35.0, 0.0, 35.0); P_END = (-446.0, 0.0, -82.0)
def noise(x, z, s=1.0):
    return (math.sin(x*.043*s+1.3)*math.cos(z*.051*s)+math.sin((x+z)*.017*s)*.8+math.sin(x*.19*s)*math.sin(z*.23*s)*.4)/2.2
def grid_axis(lo, hi, near_lo, near_hi, coarse, fine):
    a = []; x = lo
    while x < near_lo - 1e-6: a.append(x); x += coarse
    x = near_lo
    while x < near_hi - 1e-6: a.append(x); x += fine
    x = near_hi
    while x <= hi + 1e-6: a.append(x); x += coarse
    return a
def ground():
    xs = grid_axis(-1150, 500, -90, 70, 10.0, 2.0); zs = grid_axis(-700, 600, -45, 60, 10.0, 2.0)
    verts = []; alb = []
    for z in zs:
        for x in xs:
            n = noise(x, z); y = 0.0
            verts.append([x, y, z]); s = .62+.08*n
            alb.append([s*1.0, s*.80, s*.55])
    faces = []; nx = len(xs)
    for j in range(len(zs)-1):
        for i in range(nx-1):
            a = j*nx+i; faces.append([a, a+nx, a+nx+1, a+1])  # counter-clockwise seen from +y
    return dict(name='ground', verts=verts, faces=faces, alb=alb)
def pyramid(name, c, base, h, n=14, cap=None, alb0=(0.80, 0.70, 0.52), shell=1.0):
    cx, cy, cz = c; b = base/2; verts = []; faces = []; alb = []
    apex = (cx, h, cz)
    corners = [(cx-b, cz-b), (cx+b, cz-b), (cx+b, cz+b), (cx-b, cz+b)]  # N-W, N-E, S-E, S-W (z north is -z)
    for f in range(4):
        (x0, z0), (x1, z1) = corners[f], corners[(f+1) % 4]; base_i = len(verts)
        for r in range(n+1):
            t = r/n  # 0 base -> 1 apex
            for k in range(n+1-r):
                u = k/(n) if n else 0
                # point on base edge s in [0,1], shrinks toward apex
                s = (k/(n-r)) if n-r else 0.5
                bx = x0+(x1-x0)*s; bz = z0+(z1-z0)*s
                px = bx+(cx-bx)*t; pz = bz+(cz-bz)*t; py = h*t
                verts.append([px, py, pz])
                course = 0.93+0.07*math.sin(py/h*203*math.pi*2*.5)
                a = [alb0[0]*course, alb0[1]*course, alb0[2]*course]
                if cap and py > h-cap: a = [0.88, 0.82, 0.70]      # surviving smooth casing near Khafre's top
                alb.append(a)
        # triangulate rows
        idx = {}; p = base_i
        for r in range(n+1):
            for k in range(n+1-r): idx[(r, k)] = p; p += 1
        for r in range(n):
            for k in range(n-r):
                faces.append([idx[(r, k)], idx[(r, k+1)], idx[(r+1, k)]] if f in (0, 1) else [idx[(r, k)], idx[(r, k+1)], idx[(r+1, k)]])
                if k+1 < n-r: faces.append([idx[(r, k+1)], idx[(r+1, k+1)], idx[(r+1, k)]])
    return dict(name=name, verts=verts, faces=faces, alb=alb)
def loft(name, xs, hfn, wfn, y0=0.0, z0=0.0, alb0=(0.80, 0.68, 0.50)):
    prof = [(-1, 0), (-1, .55), (-.82, .9), (-.4, 1), (.4, 1), (.82, .9), (1, .55), (1, 0)]
    verts = []; alb = []; faces = []; m = len(prof)
    for x in xs:
        h = hfn(x); w = wfn(x)
        for (u, v) in prof:
            verts.append([x, y0+v*h, z0+u*w]); n = noise(x*3, u*7)
            alb.append([alb0[0]*(1+.06*n), alb0[1]*(1+.06*n), alb0[2]*(1+.06*n)])
    for i in range(len(xs)-1):
        for j in range(m-1):
            a = i*m+j; b = a+m
            faces.append([a, b, b+1, a+1])
    # end caps
    for i, flip in ((0, True), (len(xs)-1, False)):
        base = i*m; c = len(verts)
        verts.append([xs[i], y0+hfn(xs[i])*.5, z0]); alb.append(alb0)
        for j in range(m-1):
            faces.append([c, base+j+1, base+j] if flip else [c, base+j, base+j+1])
    return dict(name=name, verts=verts, faces=faces, alb=alb)
def sphinx():
    def lerp(x, pts):
        for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
            if xa <= x <= xb: return ya+(yb-ya)*(x-xa)/(xb-xa)
        return pts[0][1] if x < pts[0][0] else pts[-1][1]
    H = [(-37, 1.5), (-30, 7), (-22, 11), (-8, 12.5), (6, 12.5), (12, 11), (18, 6)]
    Wd = [(-37, 4), (-30, 7.5), (-20, 9.9), (10, 9.9), (14, 7), (18, 5)]
    xs = [-37+i*1.0 for i in range(56)]
    body = loft('sphinx_body', xs, lambda x: lerp(x, H), lambda x: lerp(x, Wd))
    hx = [10+i*0.8 for i in range(11)]
    head = loft('sphinx_head', hx, lambda x: 7.6, lambda x: 4.4 if x < 17 else 3.4, y0=12.7, alb0=(0.84, 0.72, 0.54))
    px = [14+i*1.5 for i in range(17)]
    pawr = loft('sphinx_pawR', px, lambda x: 3.8, lambda x: 2.1, z0=5.6)
    pawl = loft('sphinx_pawL', px, lambda x: 3.8, lambda x: 2.1, z0=-5.6)
    return [body, head, pawr, pawl]
def causeway():
    import math as m
    a = -m.radians(13.7); L = 494.6; W = 15.0; ux, uz = m.cos(-a), m.sin(-a)  # direction east-south-east
    # unit along (ux, uz) with z positive for east movement: use V->P_END
    dx, dz = P_END[0]-V[0], P_END[2]-V[2]; l = math.hypot(dx, dz); dx /= l; dz /= l
    nx, nz = -dz, dx
    verts = []; faces = []; alb = []; N = 50
    for i in range(N+1):
        t = i/N
        cx, cz = V[0]+(P_END[0]-V[0])*t, V[2]+(P_END[2]-V[2])*t
        for s in (-1, -.34, .34, 1):
            verts.append([cx+nx*s*W/2, 0.35, cz+nz*s*W/2]); alb.append([.70, .62, .50])
    for i in range(N):
        for j in range(3):
            a = i*4+j; faces.append([a, a+4, a+5, a+1])
    return dict(name='causeway', verts=verts, faces=faces, alb=alb)
def temple():
    x0, x1, z0, z1, h = V[0]-2, V[0]+16, V[2]-2, V[2]+12, 4.0
    verts = []; faces = []; alb = []
    for (x, y, z) in [(x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1), (x0, h, z0), (x1, h, z0), (x1, h, z1), (x0, h, z1)]:
        verts.append([x, y, z]); alb.append([.78, .68, .50])
    faces = [[4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return dict(name='valley_temple', verts=verts, faces=faces, alb=alb)
def all_meshes():
    return [ground(), pyramid('khufu', KHUFU, 230.33, 138.5, 16), pyramid('khafre', KHAFRE, 215.25, 143.5, 16, cap=43.0, alb0=(0.80, 0.70, 0.52)),
            pyramid('menkaure', MENKAURE, 103.4, 65.5, 10, alb0=(0.74, 0.58, 0.44))] + sphinx() + [causeway(), temple()]
if __name__ == '__main__':
    for m in all_meshes(): print(m['name'], len(m['verts']), len(m['faces']))

def _newell(vs):
    nx = ny = nz = 0.0
    for i in range(len(vs)):
        a = vs[i]; b = vs[(i+1) % len(vs)]
        nx += (a[1]-b[1])*(a[2]+b[2]); ny += (a[2]-b[2])*(a[0]+b[0]); nz += (a[0]-b[0])*(a[1]+b[1])
    return nx, ny, nz
def orient(m):
    """Flip faces so normals point outward (up for ground/causeway)."""
    V_ = m['verts']; nm = m['name']
    if nm in ('khufu', 'khafre', 'menkaure'):
        c = {'khufu': KHUFU, 'khafre': KHAFRE, 'menkaure': MENKAURE}[nm]; inner = lambda p: (c[0], 20.0, c[2])
    elif nm.startswith('sphinx'):
        zc = {'sphinx_pawR': 5.6, 'sphinx_pawL': -5.6}.get(nm, 0.0)
        ys = [v[1] for v in V_]; yc = (min(ys)+max(ys))/2
        inner = lambda p: (p[0], yc, zc)
    elif nm == 'valley_temple': inner = lambda p: (V[0]+7, 2, V[2]+5)
    else: inner = None
    out = []; flips = 0
    for f in m['faces']:
        vs = [V_[i] for i in f]; n = _newell(vs)
        cx = sum(v[0] for v in vs)/len(vs); cy = sum(v[1] for v in vs)/len(vs); cz = sum(v[2] for v in vs)/len(vs)
        if inner is None: d = (0, 1, 0)
        else:
            i_ = inner((cx, cy, cz)); d = (cx-i_[0], cy-i_[1], cz-i_[2])
        if n[0]*d[0]+n[1]*d[1]+n[2]*d[2] < 0: f = f[::-1]; flips += 1
        out.append(f)
    m['faces'] = out; m['flips'] = flips
    return m
