"""Batch 2: own-code XPBD / wave-equation ports of ideas from Ten Minute Physics 10 (soft bodies), 14 (cloth), 20 (height-field water).
No code copied. Emits keyframed, script-free X3D 4.0 (CoordinateInterpolator drives every mesh frame)."""
import numpy as np, json, math, sys, itertools
from pathlib import Path
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
R = {}
def f(a, p=3): return " ".join(("%.*f" % (p, x)).rstrip("0").rstrip(".") if abs(x) > 10**-p else "0" for x in np.ravel(a))
def head(title, desc):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<X3D profile='Full' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
<head>
 <meta name='title' content='{title}'/>
 <meta name='description' content='{desc}'/>
 <meta name='creator' content='x3d.io project; ports written from the published method of Matthias Mueller, Ten Minute Physics'/>
 <meta name='reference' content='https://matthias-research.github.io/pages/tenMinutePhysics/'/>
</head>
<Scene>
 <NavigationInfo type='"EXAMINE" "ANY"' headlight='false'/>
 <Background skyColor='0.02 0.03 0.06 0.08 0.1 0.18' skyAngle='1.5708' groundColor='0.02 0.02 0.03 0.05 0.05 0.07' groundAngle='1.5708'/>
 <DirectionalLight direction='-0.4 -1 -0.5' intensity='1.1' color='1 0.96 0.9'/>
 <DirectionalLight direction='0.6 -0.3 0.7' intensity='0.4' color='0.6 0.7 1'/>
"""
def pm(base, rough=0.3, metal=0.0, emis=None, transp=None):
    e = f" emissiveColor='{emis}'" if emis else ""
    t = f" transparency='{transp}'" if transp is not None else ""
    return f"<Appearance><PhysicalMaterial baseColor='{base}' roughness='{rough}' metallic='{metal}'{e}{t}/></Appearance>"
def lines(pts, color):
    pts = np.asarray(pts); idx = " ".join(map(str, range(len(pts)))) + " -1"
    return f"<Shape><Appearance><Material emissiveColor='{color}'/></Appearance><IndexedLineSet coordIndex='{idx}'><Coordinate point='{f(pts)}'/></IndexedLineSet></Shape>\n"
def clock(T): return f"<TimeSensor DEF='CLK' cycleInterval='{T}' loop='true'/>\n"
def chart(series, colors, origin, size, ymin, ymax):
    ox, oy, oz = origin; w, h = size
    out = lines([(ox,oy,oz),(ox+w,oy,oz),(ox+w,oy+h,oz),(ox,oy+h,oz),(ox,oy,oz)], "0.5 0.55 0.65")
    for s, c in zip(series, colors):
        s = np.clip(np.asarray(s), ymin, ymax); xs = np.linspace(0, w, len(s)); ys = (s-ymin)/(ymax-ymin)*h
        out += lines(np.stack([ox+xs, oy+ys, np.full_like(xs, oz)], 1), c)
    return out
def deform(name, T, frames, ifs_attrs, tail="", app=""):
    """frames: (F, N, 3). ifs_attrs: dict(coordIndex=..., ...). Emits a Shape whose Coordinate is driven by a CoordinateInterpolator."""
    F = frames.shape[0]
    key = np.linspace(0, 1, F)
    attrs = " ".join(f"{k}='{v}'" for k, v in ifs_attrs.items())
    s = f"<Shape>{app}<IndexedFaceSet DEF='{name}_F' {attrs}><Coordinate DEF='{name}_C' point='{f(frames[0])}'/>{tail}</IndexedFaceSet></Shape>\n"
    s += f"<CoordinateInterpolator DEF='{name}_I' key='{f(key,5)}' keyValue='{' '.join(f(fr) for fr in frames)}'/>\n"
    s += f"<ROUTE fromNode='CLK' fromField='fraction_changed' toNode='{name}_I' toField='set_fraction'/><ROUTE fromNode='{name}_I' fromField='value_changed' toNode='{name}_C' toField='set_point'/>\n"
    return s
def color_groups(cons, nverts):
    """greedy graph colouring: constraints (tuples of vertex ids) -> list of index arrays with no shared vertices."""
    groups = []; used = []
    for ci, c in enumerate(cons):
        for g, u in zip(groups, used):
            if not any(v in u for v in c):
                g.append(ci); u.update(c); break
        else:
            groups.append([ci]); used.append(set(c))
    return [np.array(g) for g in groups]

# =================== DEMO 10: soft body jelly (tet mesh, XPBD edge + volume) ===================
def jelly():
    n = 6; side = 1.0; h = side/(n-1)
    gid = lambda i,j,k: (i*n+j)*n+k
    P0 = np.array([[i*h-side/2, j*h-side/2, k*h-side/2] for i in range(n) for j in range(n) for k in range(n)])
    tets = []
    for i in range(n-1):
        for j in range(n-1):
            for k in range(n-1):
                for perm in itertools.permutations(range(3)):
                    c = np.array([i,j,k]); vs = [tuple(c)]
                    for a in perm: c = c.copy(); c[a] += 1; vs.append(tuple(c))
                    t = [gid(*v) for v in vs]
                    if np.linalg.det(np.stack([P0[t[1]]-P0[t[0]], P0[t[2]]-P0[t[0]], P0[t[3]]-P0[t[0]]])) < 0: t[0], t[1] = t[1], t[0]
                    tets.append(t)
    tets = np.array(tets)
    edges = sorted({tuple(sorted((t[a], t[b]))) for t in tets for a in range(4) for b in range(a+1, 4)})
    edges = np.array(edges); L0 = np.linalg.norm(P0[edges[:,0]]-P0[edges[:,1]], axis=1)
    vol = lambda P: np.einsum('ij,ij->i', np.cross(P[tets[:,1]]-P[tets[:,0]], P[tets[:,2]]-P[tets[:,0]]), P[tets[:,3]]-P[tets[:,0]])/6
    V0 = vol(P0)
    eg = color_groups([tuple(e) for e in edges], len(P0)); vg = color_groups([tuple(t) for t in tets], len(P0))
    # surface quads (outward ccw)
    quads = []
    for a in (0, n-1):
        for u in range(n-1):
            for v in range(n-1):
                for ax in range(3):
                    def pt(uu, vv):
                        idx = [0,0,0]; idx[ax] = a; idx[(ax+1)%3] = uu; idx[(ax+2)%3] = vv; return gid(*idx)
                    q = [pt(u,v), pt(u+1,v), pt(u+1,v+1), pt(u,v+1)]
                    nrm = np.cross(P0[q[1]]-P0[q[0]], P0[q[3]]-P0[q[0]]); out = np.zeros(3); out[ax] = 1 if a else -1
                    quads.append(q if nrm@out > 0 else q[::-1])
    quads = np.array(quads)
    # rotate and place
    def rot(ax, a):
        c, s = math.cos(a), math.sin(a); M = np.eye(3)
        i, j = [(1,2),(2,0),(0,1)][ax]; M[i,i]=c; M[i,j]=-s; M[j,i]=s; M[j,j]=c; return M
    Rm = rot(0, math.radians(28)) @ rot(2, math.radians(18))
    h_drop = 1.5
    def run(a_edge, a_vol, use_vol, nsub=8, fps=30, T=8.0, g=9.81):
        x = P0 @ Rm.T + np.array([0, h_drop, 0]); v = np.zeros_like(x); dt = 1/(fps*nsub); frames = []; vr = []; inv = []
        for step in range(int(T*fps)*nsub + 1):
            if step % nsub == 0:
                frames.append(x.copy()); vv = vol(x); vr.append(vv.sum()/V0.sum()); inv.append(int((vv < 0).sum()))
            xp = x.copy(); v[:,1] -= g*dt; x = x + v*dt
            for grp in eg:
                e = edges[grp]; d = x[e[:,0]]-x[e[:,1]]; l = np.linalg.norm(d, axis=1); C = l - L0[grp]
                dl = (C/(1+a_edge/dt**2*2)); # w=1 per vertex (unit mass): lambda = -C/(2 + alpha/dt^2)
                lam = -C/(2 + a_edge/dt**2); gr = d/np.maximum(l,1e-9)[:,None]
                np.add.at(x, e[:,0], gr*lam[:,None]); np.add.at(x, e[:,1], -gr*lam[:,None])
            if use_vol:
                for grp in vg:
                    t = tets[grp]; p0,p1,p2,p3 = (x[t[:,k]] for k in range(4))
                    vv = np.einsum('ij,ij->i', np.cross(p1-p0, p2-p0), p3-p0)/6; C = vv - V0[grp]
                    g1 = np.cross(p2-p0, p3-p0)/6; g2 = np.cross(p3-p0, p1-p0)/6; g3 = np.cross(p1-p0, p2-p0)/6; g0 = -(g1+g2+g3)
                    gs = [g0,g1,g2,g3]; den = sum(np.einsum('ij,ij->i', q, q) for q in gs) + a_vol/dt**2
                    lam = -C/np.maximum(den, 1e-12)
                    for k in range(4): np.add.at(x, t[:,k], gs[k]*lam[:,None])
            # floor with friction
            low = x[:,1] < 0
            if low.any():
                x[low,1] = 0; x[low,0] = xp[low,0] + (x[low,0]-xp[low,0])*0.6; x[low,2] = xp[low,2] + (x[low,2]-xp[low,2])*0.6
            v = (x-xp)/dt
        return np.array(frames), np.array(vr), np.array(inv)
    cfg = [("edges only", 0.0, 0.0, False, "1 0.3 0.25"), ("edges + volume, stiff", 0.0, 0.0, True, "0.2 0.8 1"), ("edges + volume, soft", 0.0, 3e-9, True, "0.45 0.95 0.4")]
    runs = [run(a, b, uv) for _, a, b, uv, _ in cfg]
    R["10_jelly"] = dict(verts=len(P0), tets=len(tets), edges=len(edges), edge_colour_groups=len(eg), vol_colour_groups=len(vg), substeps_per_key=8, sim_hz=240, key_hz=30, T=8.0,
        rest_volume=float(V0.sum()), runs={c[0]: dict(volume_ratio_min=float(r[1].min()), volume_ratio_max=float(r[1].max()), volume_ratio_final=float(r[1][-1]), inverted_tets_max=int(r[2].max()), inverted_tets_final=int(r[2][-1]))
               for c, r in zip(cfg, runs)})
    T = 8.0
    s = head("TMP 10 Soft bodies: jelly cubes", "Tetrahedral XPBD: edge-length plus tet-volume constraints, dropped tilted onto a floor. Idea of Ten Minute Physics 10.") + clock(T)
    s += f"<Transform translation='0 -0.03 0'><Shape>{pm('0.1 0.11 0.15',0.7)}<Box size='7 0.06 3.2'/></Shape></Transform>\n"
    for ci, ((name, a, b, uv, col), (fr, vr, inv)) in enumerate(zip(cfg, runs)):
        fr2 = fr + np.array([(ci-1)*2.3, 0, 0])
        s += deform(f"J{ci}", T, fr2, dict(coordIndex=" ".join(" ".join(map(str, q))+" -1" for q in quads), solid="true", creaseAngle="0.9"),
                    app=pm(col, 0.12, 0.0, ' '.join(f'{float(c)*0.25:.2f}' for c in col.split())))
    s += chart([r[1] for r in runs], [c[4] for c in cfg], (-3.0, 2.6, -1.2), (6.0, 0.9), 0.9, 1.02)
    s += "<!-- chart: total tet volume / rest volume over 8 s: red edges only, cyan stiff volume, green soft volume (y axis 0.9..1.02) -->\n"
    s += "<Viewpoint description='front' position='0 1.8 8.5' orientation='1 0 0 -0.12' fieldOfView='0.95'/>\n</Scene>\n</X3D>\n"
    (OUT/"10-jelly.x3d").write_text(s)

# =================== DEMO 14: cloth, XPBD stretch+shear+bend, substeps 2 vs 20 ===================
def cloth():
    N = 21; W = 1.7; h0 = W/(N-1); gid = lambda i,j: i*N+j
    P0 = np.array([[ (i*h0-W/2), 0.0, (j*h0-W/2)] for i in range(N) for j in range(N)])
    cons = []; kind = []
    for i in range(N):
        for j in range(N):
            if i+1<N: cons.append((gid(i,j),gid(i+1,j))); kind.append(0)
            if j+1<N: cons.append((gid(i,j),gid(i,j+1))); kind.append(0)
            if i+1<N and j+1<N: cons.append((gid(i,j),gid(i+1,j+1))); kind.append(1); cons.append((gid(i+1,j),gid(i,j+1))); kind.append(1)
            if i+2<N: cons.append((gid(i,j),gid(i+2,j))); kind.append(2)
            if j+2<N: cons.append((gid(i,j),gid(i,j+2))); kind.append(2)
    cons = np.array(cons); kind = np.array(kind); L0 = np.linalg.norm(P0[cons[:,0]]-P0[cons[:,1]], axis=1)
    alpha = np.array([1e-8, 1e-8, 5e-3])[kind]   # stretch, shear, bend compliance (m/N)
    groups = color_groups([tuple(c) for c in cons], len(P0))
    tri = []
    for i in range(N-1):
        for j in range(N-1): a,b,c,d = gid(i,j),gid(i+1,j),gid(i+1,j+1),gid(i,j+1); tri += [a,c,b,-1,a,d,c,-1]
    sph_r = 0.5; sph_c = np.array([0.0, sph_r, 0.0]); thick = 0.02
    def run(nsub, fps=30, T=9.0, g=9.81):
        x = P0 + np.array([0, 1.5, 0]); v = np.zeros_like(x); dt = 1/(fps*nsub); frames = []; strain = []
        stretch = kind == 0
        for step in range(int(T*fps)*nsub + 1):
            if step % nsub == 0:
                frames.append(x.copy()); l = np.linalg.norm(x[cons[stretch,0]]-x[cons[stretch,1]], axis=1); strain.append(float(np.abs(l/L0[stretch]-1).max()))
            xp = x.copy(); v[:,1] -= g*dt; v *= (1 - 0.3*dt); x = x + v*dt
            for grp in groups:
                c = cons[grp]; d = x[c[:,0]]-x[c[:,1]]; l = np.linalg.norm(d, axis=1)
                lam = -(l - L0[grp])/(2 + alpha[grp]/dt**2); gr = d/np.maximum(l,1e-9)[:,None]
                np.add.at(x, c[:,0], gr*lam[:,None]); np.add.at(x, c[:,1], -gr*lam[:,None])
            dd = x - sph_c; dl = np.linalg.norm(dd, axis=1); inn = dl < sph_r + thick
            q = sph_c + dd[inn]/dl[inn,None]*(sph_r+thick); nn = dd[inn]/dl[inn,None]; dlt = q - xp[inn]; dt_ = dlt - (dlt*nn).sum(1)[:,None]*nn
            x[inn] = q - 0.85*dt_
            low = x[:,1] < thick; x[low,1] = thick; x[low,0] = xp[low,0] + (x[low,0]-xp[low,0])*0.2; x[low,2] = xp[low,2] + (x[low,2]-xp[low,2])*0.2
            v = (x-xp)/dt
        return np.array(frames), np.array(strain)
    cfg = [(2, "0.95 0.45 0.2"), (20, "0.2 0.8 0.95")]; runs = [run(n) for n,_ in cfg]
    R["14_cloth"] = dict(grid=f"{N}x{N}", verts=len(P0), constraints=int(len(cons)), colour_groups=len(groups), compliance_stretch_shear_bend=[1e-8, 1e-8, 5e-3], key_hz=30, T=9.0,
        runs={str(n): dict(max_stretch_strain_peak=float(r[1].max()), max_stretch_strain_final=float(r[1][-1]), mean_strain_over_time=float(r[1].mean())) for (n,_), r in zip(cfg, runs)})
    # checker texture
    S = 16; img = " ".join("0x%06x" % (0xf2f2f2 if ((x//4)+(y//4))%2==0 else 0x2a6f8f) for y in range(S) for x in range(S))
    tex = f"<PixelTexture containerField='baseTexture' image='{S} {S} 3 {img}' repeatS='true' repeatT='true'/>"
    tc = " ".join(f"{i/(N-1)*4:.3f} {j/(N-1)*4:.3f}" for i in range(N) for j in range(N))
    T = 9.0
    s = head("TMP 14 Cloth: stretch, shear and bend with XPBD", "Same cloth, same frame step 1/30 s, 2 vs 20 substeps, draped on a sphere. Idea of Ten Minute Physics 14.") + clock(T)
    s += f"<Transform translation='0 -0.03 0'><Shape>{pm('0.1 0.11 0.15',0.7)}<Box size='7 0.06 3.2'/></Shape></Transform>\n"
    for ci, ((n, col), (fr, st)) in enumerate(zip(cfg, runs)):
        off = np.array([(ci-0.5)*3.0, 0, 0]); s += f"<Transform translation='{off[0]} 0 0'><Shape>{pm('0.8 0.82 0.85',0.25,0.1)}<Sphere radius='{sph_r}' DEF='SPH{ci}'/></Shape></Transform>\n" if False else f"<Transform translation='{off[0]} {sph_r} 0'><Shape>{pm('0.75 0.78 0.85',0.25,0.15)}<Sphere radius='{sph_r}'/></Shape></Transform>\n"
        s += deform(f"CL{ci}", T, fr + off, dict(coordIndex=" ".join(map(str, tri)), solid="false", creaseAngle="1.2"),
                    tail="<TextureCoordinate point='%s'/>" % tc, app="<Appearance><PhysicalMaterial baseColor='1 1 1' roughness='0.7' metallic='0'>%s</PhysicalMaterial></Appearance>" % tex)
    s += chart([r[1] for r in runs], [c[1] for c in cfg], (-2.6, 2.6, -1.3), (5.2, 0.8), 0.0, 0.6)
    s += "<!-- chart: worst stretch-edge strain over 9 s (y axis 0..0.6): orange 2 substeps, cyan 20 substeps -->\n"
    s += "<Viewpoint description='front' position='0 3.4 6.4' orientation='1 0 0 -0.4' fieldOfView='0.95'/>\n<Viewpoint description='high' position='0 6 3' orientation='1 0 0 -1.05'/>\n</Scene>\n</X3D>\n"
    (OUT/"14-cloth.x3d").write_text(s)

# =================== DEMO 20: height-field water, CFL stable vs unstable ===================
def water():
    M = 28; dx = 0.1; c = 5.0
    X = (np.arange(M)-(M-1)/2)*dx
    def lap(h):
        p = np.pad(h, 1, mode='edge')  # reflecting wall: zero normal gradient
        return (p[2:,1:-1]+p[:-2,1:-1]+p[1:-1,2:]+p[1:-1,:-2]-4*h)/dx**2
    drops = [(0.4, 5, 8, 0.3), (1.6, 20, 18, -0.25), (3.0, 12, 21, 0.3), (4.4, 7, 14, 0.3)]  # time, i, j, amplitude
    def run(dt_sim, T=6.0, fps=30, ball=False, clampv=0.35, damp=0.0008):
        h = np.zeros((M, M)); v = np.zeros((M, M)); frames = []; amp = []; inj = 0.0
        nsub = max(1, int(round(1/(fps*dt_sim)))); dt = 1/(fps*nsub)
        yb, vb, r = 0.5, 0.0, 0.24; prev_sub = 0.0; bx, bz = 0.0, 0.0; ball_traj = []
        ii, jj = np.meshgrid(np.arange(M), np.arange(M), indexing='ij'); gx, gz = X[ii], X[jj]
        for step in range(int(T*fps)*nsub + 1):
            t = step*dt
            if step % nsub == 0:
                frames.append(clampv*np.tanh(h/clampv)); amp.append(float(np.abs(h).max())); ball_traj.append([bx, yb, bz])
            for (td, di, dj, a) in drops:
                if abs(t-td) < dt/2:
                    for k in range(M):
                        for l in range(M):
                            d2 = (k-di)**2+(l-dj)**2
                            if d2 < 9: h[k,l] += a*math.exp(-d2/2.5); inj += a*math.exp(-d2/2.5)
            if ball:
                d2 = (gx-bx)**2 + (gz-bz)**2; inside = d2 < r**2
                bottom = np.where(inside, yb - np.sqrt(np.maximum(r**2-d2, 0)), 1e9)
                ring = (d2 >= r**2) & (d2 < (r+1.5*dx)**2)
                ann = (d2 >= (r+2.5*dx)**2) & (d2 < (r+5*dx)**2); hl = h[ann].mean() if ann.any() else 0.0
                sub_vol = np.where(inside, np.maximum(hl - bottom, 0), 0.0).sum()*dx*dx; frac = min(sub_vol/(4/3*math.pi*r**3), 1.0)
                rho = 0.45; g = 9.81
                ab = -g + g*frac/rho - 9.0*vb*frac
                vb += ab*dt; yb += vb*dt
                if yb < -0.4 + r: yb = -0.4 + r; vb = 0
                dV = sub_vol - prev_sub; prev_sub = sub_vol   # volume newly displaced this step (negative when the ball lifts)
                h[inside] -= dV/(inside.sum()*dx*dx); h[ring] += dV/(ring.sum()*dx*dx)
            v += c**2*lap(h)*dt*1.0; v *= (1 - damp/dt*dt*0 - 0.0)
            v *= (1 - 0.6*dt); h += v*dt
        return np.array(frames), np.array(amp), inj, h, np.array(ball_traj)
    # stability scan
    scan = {}
    for ratio in (0.5, 0.65, 0.7, 0.72, 0.8, 1.0):
        dtt = ratio*dx/c; hh = np.zeros((M,M)); vv = np.zeros((M,M)); hh[10,10] = 0.1
        for _ in range(int(3/dtt)):
            vv += c**2*lap(hh)*dtt; hh += vv*dtt
            if not np.isfinite(hh).all() or np.abs(hh).max() > 1e6: break
        scan[str(ratio)] = float(np.abs(hh).max()) if np.isfinite(hh).all() else float('inf')
    A = run(1/120, ball=True); B = run(1/60)
    # volume check on pure tank with no damping effect on volume: sum h - injected
    R["20_water"] = dict(grid=f"{M}x{M}", dx=dx, wave_speed=c, key_hz=30, T=6.0,
        tank_A=dict(dt="1/120", c_dt_over_dx=c/120/dx, ball="floating, density 0.45 of water", max_abs_h=float(A[1].max()), ball_peak_y=float(A[4][:,1].max()), ball_min_y=float(A[4][:,1].min()), ball_final_y=float(A[4][-1,1])),
        tank_B=dict(dt="1/60", c_dt_over_dx=c/60/dx, max_abs_h_unclamped=float(B[1].max()), first_frame_over_1m=int(np.argmax(B[1] > 1.0)) if (B[1] > 1.0).any() else None),
        stability_scan_final_max_h_after_3s={k: v for k, v in scan.items()}, predicted_limit=1/math.sqrt(2),
        note="B amplitude is soft-clamped (0.35*tanh(h/0.35)) m in the file for display; the true values blow up")
    # exact volume conservation on the stable pure tank
    hh = np.zeros((M,M)); vv = np.zeros((M,M)); hh[10,10] = 0.1; dtt = 1/240; v0 = hh.sum()
    for _ in range(2400): vv += c**2*lap(hh)*dtt; hh += vv*dtt
    R["20_water"]["volume_drift_pure_tank_10s"] = float(abs(hh.sum()-v0))
    T = 6.0
    s = head("TMP 20 Height-field water: the wave equation and its speed limit", "Left: stable tank with a floating ball. Right: same water, step too big for its wave speed. Idea of Ten Minute Physics 20.") + clock(T)
    gridi = " ".join(" ".join(map(str, (i*M+j, (i+1)*M+j, (i+1)*M+j+1, i*M+j+1)))+" -1" for i in range(M-1) for j in range(M-1))
    for ti, ((fr, amp, inj, hf, bt), col) in enumerate([(A, "0.1 0.55 0.9"), (B, "0.9 0.3 0.2")]):
        ox = (ti-0.5)*3.4
        xyz = np.stack([np.broadcast_to(X[:,None], (M,M)), fr.transpose(1,2,0)*0 + 0], 0) if False else None
        F = fr.shape[0]; frames = np.zeros((F, M*M, 3))
        gxg, gzg = np.meshgrid(X, X, indexing='ij')
        frames[:,:,0] = gxg.ravel() + ox; frames[:,:,2] = gzg.ravel(); frames[:,:,1] = fr.reshape(F, -1) + 0.5
        s += deform(f"W{ti}", T, frames, dict(coordIndex=gridi, solid="false", creaseAngle="1.5"), app=pm(col, 0.04, 0.0, ' '.join(f'{float(c)*0.15:.2f}' for c in col.split()), 0.2))
        tank = [(-1.5,0,-1.5),(1.5,0,-1.5),(1.5,0,1.5),(-1.5,0,1.5),(-1.5,0,-1.5),(-1.5,1.4,-1.5),(1.5,1.4,-1.5),(1.5,1.4,1.5),(-1.5,1.4,1.5),(-1.5,1.4,-1.5)]
        s += lines(np.array(tank)*[1,1,1] + [ox,0,0], "0.5 0.55 0.65")
        s += f"<Transform translation='{ox} -0.03 0'><Shape>{pm('0.1 0.11 0.15',0.6)}<Box size='3.1 0.06 3.1'/></Shape></Transform>\n"
    # ball in tank A
    ox = -1.7; bt = A[4]; key = np.linspace(0, 1, len(bt))
    s += f"<Transform DEF='BALL'><Shape>{pm('0.95 0.85 0.3',0.2,0.0,'0.3 0.25 0.05')}<Sphere radius='0.24'/></Shape></Transform>\n"
    s += f"<PositionInterpolator DEF='BALL_P' key='{f(key,5)}' keyValue='{' '.join(f([b[0]+ox, b[1]+0.5, b[2]]) for b in bt)}'/><ROUTE fromNode='CLK' fromField='fraction_changed' toNode='BALL_P' toField='set_fraction'/><ROUTE fromNode='BALL_P' fromField='value_changed' toNode='BALL' toField='set_translation'/>\n"
    s += chart([np.log10(np.maximum(A[1],1e-6)), np.log10(np.maximum(B[1],1e-6))], ["0.2 0.7 1", "1 0.4 0.3"], (-2.4, 2.1, -1.6), (4.8, 0.8), -3.0, 3.0)
    s += "<!-- chart: log10 of max |height| (y axis -3..3 = 1 mm..1 km): blue stable tank, red unstable tank -->\n"
    s += "<Viewpoint description='front' position='0 2.4 6.2' orientation='1 0 0 -0.3' fieldOfView='1.0'/>\n<Viewpoint description='low' position='0 0.9 5' orientation='1 0 0 -0.12'/>\n</Scene>\n</X3D>\n"
    (OUT/"20-water.x3d").write_text(s)

jelly(); cloth(); water()
(OUT/"numbers2.json").write_text(json.dumps(R, indent=1)); print(json.dumps(R, indent=1))
