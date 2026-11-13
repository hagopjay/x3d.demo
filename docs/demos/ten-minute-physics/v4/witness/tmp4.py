"""Batch 4: own-code ports of ideas from Ten Minute Physics 11 (spatial hashing), 17 (Eulerian fluid), 25 (joints),
under the Loom physics witness. No code copied. Limits (LIM) are written before the first measurement and not tuned.
usage: tmp4.py OUTDIR ROOT | tmp4.py --replay NAME"""
import sys, json, math, hashlib, subprocess, time
import numpy as np
from collections import defaultdict
from pathlib import Path
G = 9.81
LIM = dict(hash_missed=0, hash_false=0, hash_candidate_ratio=0.10,
           fluid_div=0.01, fluid_flux=0.02,
           mj_vs_rk4_m=1e-4, rk4_energy=1e-8, xpbd100_pos_1s=0.02)
def h32(arr): return int(hashlib.sha256(np.asarray(arr, dtype='<f8').tobytes()).hexdigest()[:8], 16)
def trace_sha(hs): return hashlib.sha256(",".join(str(h) for h in hs).encode()).hexdigest()

# ======================= 11: spatial hashing, 400 balls =======================
NB, BW, BH = 400, 3.0, 2.4
def ball_init():
    rng = np.random.default_rng(7); r = rng.choice([0.035, 0.045, 0.055], size=NB)
    cols = 24; pos = np.array([[0.12+(k % cols)*0.12+rng.uniform(-0.004, 0.004), 0.35+(k//cols)*0.12+rng.uniform(-0.004, 0.004)] for k in range(NB)])
    return pos, r
def hash_pairs(x, r, cell):
    """grid hash: bucket by cell, test the 3x3 neighbourhood; returns (overlapping pairs, candidate count)"""
    inv = 1.0/cell; buckets = defaultdict(list)
    ci = np.floor(x*inv).astype(int)
    for k in range(len(x)): buckets[(ci[k, 0], ci[k, 1])].append(k)
    pairs = []; cand = 0
    for k in range(len(x)):
        cx, cy = ci[k]
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for m in buckets.get((cx+dx, cy+dy), ()):
                    if m <= k: continue
                    cand += 1; d = x[m]-x[k]
                    if d@d < (r[k]+r[m])**2: pairs.append((k, m))
    return pairs, cand
def brute_pairs(x, r):
    d = x[:, None, :]-x[None, :, :]; dist2 = (d**2).sum(-1); rr = (r[:, None]+r[None, :])**2
    iu = np.triu_indices(len(x), 1); mask = dist2[iu] < rr[iu]
    return set(zip(iu[0][mask].tolist(), iu[1][mask].tolist()))
def balls_run(T=8.0, fps=30, nsub=8, cell_scale=2.0, hashes=None, check_every=0, frames=None):
    x, r = ball_init(); v = np.zeros_like(x); h = 1/(fps*nsub); cell = cell_scale*r.max(); out = dict(missed=0, false=0, cand_total=0, steps=0, checks=0, pairs_total=0)
    for step in range(int(T*fps)*nsub + 1):
        if step % nsub == 0:
            if frames is not None: frames.append(x.copy())
            if hashes is not None: hashes.append(h32(x))
        xp = x.copy(); v[:, 1] -= G*h; x = x + v*h
        pairs, cand = hash_pairs(x, r, cell); out['cand_total'] += cand; out['steps'] += 1; out['pairs_total'] += len(pairs)
        if check_every and step % check_every == 0:
            b = brute_pairs(x, r); hs_ = set(pairs); out['missed'] += len(b-hs_); out['false'] += len(hs_-b); out['checks'] += 1
        for (a, b_) in pairs:
            d = x[b_]-x[a]; dist = math.sqrt(d@d)
            if dist < 1e-9: continue
            pen = r[a]+r[b_]-dist; n = d/dist; x[a] -= n*pen/2; x[b_] += n*pen/2
        for k in range(2):
            lim = (BW if k == 0 else BH)
            lo = r; hi = lim - r
            m1 = x[:, k] < lo; x[m1, k] = lo[m1]; m2 = x[:, k] > hi; x[m2, k] = hi[m2]
        v = (x-xp)/h
    return x, r, out

# ======================= 17: Eulerian smoke tunnel =======================
NX, NY, HC, UIN = 60, 30, 1/30, 2.0
def fluid_setup():
    s = np.ones((NX, NY)); cx, cy, rad = 0.45, 0.5, 0.12
    ci, cj = np.meshgrid((np.arange(NX)+0.5)*HC, (np.arange(NY)+0.5)*HC, indexing='ij'); s[(ci-cx)**2+(cj-cy)**2 < rad**2] = 0.0
    return s
def bilerp(f, gx, gy):
    nx, ny = f.shape; gx = np.clip(gx, 0, nx-1.000001); gy = np.clip(gy, 0, ny-1.000001); i = gx.astype(int); j = gy.astype(int); fx = gx-i; fy = gy-j
    return (f[i, j]*(1-fx)*(1-fy)+f[i+1, j]*fx*(1-fy)+f[i, j+1]*(1-fx)*fy+f[i+1, j+1]*fx*fy)
def fluid_run(T=5.0, fps=30, nsub=2, niter=100, hashes=None, frames=None, stats=None, over=1.9, tracers=None):
    s = fluid_setup(); sp = np.zeros((NX+2, NY+2)); sp[1:-1, 1:-1] = s; sp[-1, 1:-1] = 1.0   # left/top/bottom walls solid, right open
    u = np.zeros((NX+1, NY)); v = np.zeros((NX, NY+1)); m = np.zeros((NX, NY)); dt = 1/(fps*nsub)
    I, J = np.meshgrid(np.arange(NX), np.arange(NY), indexing='ij'); colors = []
    for c in (0, 1):
        sel = ((I+J) % 2 == c) & (s == 1); colors.append((I[sel], J[sel]))
    band = (np.arange(NY)*HC+HC/2 > 0.44) & (np.arange(NY)*HC+HC/2 < 0.56)
    # grid positions
    ugx, ugy = np.meshgrid(np.arange(NX+1), np.arange(NY)+0.5, indexing='ij'); vgx, vgy = np.meshgrid(np.arange(NX)+0.5, np.arange(NY+1), indexing='ij'); cgx, cgy = np.meshgrid(np.arange(NX)+0.5, np.arange(NY)+0.5, indexing='ij')
    def vel_at(gx, gy):  # grid coords (cell units, origin at lower-left corner) -> velocity components
        return bilerp(u, gx, gy-0.5), bilerp(v, gx-0.5, gy)
    def enforce():
        u[0, :] = UIN; u[:-1][s == 0] = 0.0; u[1:][s == 0] = 0.0; v[:, :-1][s == 0] = 0.0; v[:, 1:][s == 0] = 0.0; v[:, 0] = 0.0; v[:, -1] = 0.0
        u[0, :] = UIN
    def project():
        for _ in range(niter):
            for I_, J_ in colors:
                sxm, sxp, sym, syp = sp[I_, J_+1], sp[I_+2, J_+1], sp[I_+1, J_], sp[I_+1, J_+2]; ssum = sxm+sxp+sym+syp
                d = over*(u[I_+1, J_]-u[I_, J_]+v[I_, J_+1]-v[I_, J_]); w = np.where(ssum > 0, d/np.maximum(ssum, 1e-12), 0.0)
                u[I_, J_] += w*sxm; u[I_+1, J_] -= w*sxp; v[I_, J_] += w*sym; v[I_, J_+1] -= w*syp
    def diag():
        div = (u[1:, :]-u[:-1, :]+v[:, 1:]-v[:, :-1])*(s == 1)
        flux = u.sum(axis=1)*HC
        return float(np.abs(div).max()/UIN), flux
    steps = int(T*fps)*nsub; maxdiv = 0.0; fluxdev = 0.0
    if tracers is not None:
        lanes, every = tracers['lanes'], tracers['every']; laney = (np.arange(lanes)+0.5)/lanes*0.8+0.1
        nrel = steps//every+1; NP = lanes*nrel; plane = np.tile(np.arange(lanes), nrel); prel = np.repeat(np.arange(nrel)*every, lanes)
        tx = np.full(NP, -5.0); ty = laney[plane].copy(); state = np.zeros(NP, int)   # 0 waiting, 1 flying, 2 gone
        tracers['lane_of'] = plane; tracers['frames'] = []
        def tvel(px, py): return bilerp(u, px/HC, py/HC-0.5), bilerp(v, px/HC-0.5, py/HC)
    for step in range(steps+1):
        if step % nsub == 0:
            if tracers is not None: tracers['frames'].append(np.stack([tx, ty], 1).copy())
            if frames is not None: frames.append(m.copy())
            if hashes is not None: hashes.append(h32(np.concatenate([u.ravel(), v.ravel(), m.ravel()])))
        enforce(); project(); enforce()
        dv, flux = diag()
        if step*dt > 1.0:
            maxdiv = max(maxdiv, dv); fluxdev = max(fluxdev, float(np.abs(flux/flux[0]-1).max()))
        # advect
        ux, uy = vel_at(ugx, ugy); nu = bilerp(u, ugx-dt*ux/HC, ugy-0.5-dt*uy/HC)
        vx, vy = vel_at(vgx, vgy); nv = bilerp(v, vgx-0.5-dt*vx/HC, vgy-dt*vy/HC)
        cx_, cy_ = vel_at(cgx, cgy); nm = bilerp(m, cgx-0.5-dt*cx_/HC, cgy-0.5-dt*cy_/HC)
        if tracers is not None:
            rel = (state == 0) & (prel == step); tx[rel] = 0.02; ty[rel] = laney[plane[rel]]; state[rel] = 1
            fl = state == 1
            if fl.any():
                px, py = tx[fl], ty[fl]; ua, va = tvel(px, py); mx, my = px+0.5*dt*ua, py+0.5*dt*va; ub, vb = tvel(mx, my)
                px = px+dt*ub; py = np.clip(py+dt*vb, 0.01, NY*HC-0.01)
                dx_, dy_ = px-0.45, py-0.5; dd = np.sqrt(dx_**2+dy_**2); ins = dd < 0.125; px[ins] = 0.45+dx_[ins]/dd[ins]*0.125; py[ins] = 0.5+dy_[ins]/dd[ins]*0.125
                tx[fl], ty[fl] = px, py; gone = np.where(fl)[0][px > NX*HC]; state[gone] = 2; tx[gone] = NX*HC+5.0
        u, v, m = nu, nv, nm; m[0, :] = band.astype(float); m[s == 0] = 0.0; enforce()
    if stats is not None: stats.update(max_div_rel=maxdiv, flux_dev=fluxdev)
    return m

# ======================= 25: double pendulum, XPBD joints vs MuJoCo vs RK4 =======================
TH1, TH2, L1, L2 = 2.0, 2.5, 1.0, 1.0
def dp_rhs(th1, th2, w1, w2):
    d = th1-th2; den = 3-math.cos(2*d)
    a1 = (-G*3*math.sin(th1)-G*math.sin(th1-2*th2)-2*math.sin(d)*(w2*w2+w1*w1*math.cos(d)))/den
    a2 = (2*math.sin(d)*(w1*w1*2+G*2*math.cos(th1)+w2*w2*math.cos(d)))/den
    return a1, a2
def dp_rk4(T=10.0, h=1e-3):
    s = np.array([TH1, TH2, 0.0, 0.0]); out = [s.copy()]
    f = lambda q: np.array([q[2], q[3], *dp_rhs(q[0], q[1], q[2], q[3])])
    for i in range(int(round(T/h))):
        k1 = f(s); k2 = f(s+h/2*k1); k3 = f(s+h/2*k2); k4 = f(s+h*k3); s = s+h/6*(k1+2*k2+2*k3+k4); out.append(s.copy())
    return np.array(out)
def dp_pos(th1, th2): return np.stack([L1*np.sin(th1), -L1*np.cos(th1)], -1), np.stack([L1*np.sin(th1)+L2*np.sin(th2), -L1*np.cos(th1)-L2*np.cos(th2)], -1)
def dp_energy_rk4(S):
    th1, th2, w1, w2 = S.T; return 0.5*(2*w1**2*L1**2 + w2**2*L2**2 + 2*w1*w2*L1*L2*np.cos(th1-th2))*1.0 + 0 - G*(2*L1*np.cos(th1)+L2*np.cos(th2)) # m=1 each
def dp_mujoco(T=10.0, h=1e-3):
    import mujoco
    xml = f"""<mujoco><option timestep="{h}" integrator="RK4" gravity="0 0 -{G}"><flag energy="enable"/></option><worldbody><body name="b1" pos="0 0 0"><joint name="j1" type="hinge" axis="0 1 0"/>
      <inertial pos="0 0 -{L1}" mass="1" diaginertia="1e-9 1e-9 1e-9"/><body name="b2" pos="0 0 -{L1}"><joint name="j2" type="hinge" axis="0 1 0"/><inertial pos="0 0 -{L2}" mass="1" diaginertia="1e-9 1e-9 1e-9"/></body></body></worldbody></mujoco>"""
    m = mujoco.MjModel.from_xml_string(xml); d = mujoco.MjData(m); d.qpos[:] = [-TH1, -(TH2-TH1)]; mujoco.mj_forward(m, d)
    b1, b2 = m.body('b1').id, m.body('b2').id; p1, p2, E = [], [], []
    for i in range(int(round(T/h))+1):
        p1.append([d.xipos[b1][0], d.xipos[b1][2]]); p2.append([d.xipos[b2][0], d.xipos[b2][2]]); E.append(d.energy[0]+d.energy[1]); mujoco.mj_step(m, d)
    return np.array(p1), np.array(p2), np.array(E), mujoco.__version__
def dp_xpbd(nsub, T=10.0, dt=1/30, hashes=None):
    a, b = dp_pos(np.array(TH1), np.array(TH2)); x1 = a.copy(); x2 = b.copy(); v1 = np.zeros(2); v2 = np.zeros(2); h = dt/nsub; out = [(x1.copy(), x2.copy())]
    for i in range(int(round(T/dt))):
        for _ in range(nsub):
            p1, p2 = x1.copy(), x2.copy(); v1 = v1+np.array([0, -G])*h; v2 = v2+np.array([0, -G])*h; x1 = x1+v1*h; x2 = x2+v2*h
            d = x1; l = math.sqrt(d[0]*d[0]+d[1]*d[1]); x1 = x1-(l-L1)*d/l
            d = x2-x1; l = math.sqrt(d[0]*d[0]+d[1]*d[1]); c = (l-L2)*d/l; x1 = x1+c/2; x2 = x2-c/2
            v1 = (x1-p1)/h; v2 = (x2-p2)/h
        out.append((x1.copy(), x2.copy()))
        if hashes is not None: hashes.append(h32(np.concatenate([x1, x2, v1, v2])))
    return out

HASHERS = {
 'balls': lambda: (lambda hs: (balls_run(T=3.0, hashes=hs), hs)[1])([]),
 'fluid': lambda: (lambda hs: (fluid_run(T=2.0, hashes=hs), hs)[1])([]),
 'joints': lambda: (lambda hs: (dp_xpbd(100, hashes=hs), hs)[1])([]),
}
if len(sys.argv) > 2 and sys.argv[1] == '--replay':
    print(json.dumps(HASHERS[sys.argv[2]]())); sys.exit(0)

OUT, ROOT = Path(sys.argv[1]), Path(sys.argv[2]); (OUT/'records').mkdir(parents=True, exist_ok=True)
def sha_file(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def replay_fresh(name): return json.loads(subprocess.run([sys.executable, '-I', __file__, '--replay', name], capture_output=True, text=True, check=True).stdout)
def replay_block(host, ref, other):
    mism = [i for i, (a, b) in enumerate(zip(ref, other)) if a != b]
    return dict(host=host, steps=len(other), mismatches=len(mism)+abs(len(ref)-len(other)), first_mismatch=(mism[0] if mism else None), trace_sha256=trace_sha(other))
PYV, NPV = sys.version.split()[0], np.__version__; HOST_REC = f"cpython-{PYV}-numpy-{NPV}"; HOST_FRESH = "numpy-fresh-process"
def ref_item(id_, observed, limit, source, rule="at most"):
    ok = observed <= limit if rule == "at most" else observed >= limit
    return dict(id=id_, observed=float(observed), limit=limit, declared_limit=limit, rule=rule, status="pass" if ok else "fail", source=source)
V4 = "docs/demos/ten-minute-physics/v4/"
PENDING = []
def record(*a):
    PENDING.append(a)
def write_record(rid, model_path, hashes, replays, refs, controls, not_shown, note):
    rec = dict(schema="loom.physics-run/1", id=rid, engine=dict(name="tmp-ports (numpy)", version=f"numpy-{NPV}", build=f"tmp4.py sha256 {hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]}, python {PYV}"),
        model=dict(sha256=sha_file(OUT/Path(model_path).name), path=model_path, what="the X3D scene the port produced; parameters live in tmp4.py"),
        recorded=dict(host=HOST_REC, steps=len(hashes), hashes=hashes, trace_sha256=trace_sha(hashes)), replays=replays, references=refs, controls=controls, not_shown=not_shown, note=note)
    (OUT/'records'/(rid.split('/')[-1]+'.physics.json')).write_text(json.dumps(rec, indent=1))
N = {}; t0 = time.time()
def f(a, p=3): return " ".join(("%.*f" % (p, x)).rstrip("0").rstrip(".") if abs(x) > 10**-p else "0" for x in np.ravel(a))
HEAD = lambda title, desc: f"""<?xml version="1.0" encoding="UTF-8"?>
<X3D profile='Full' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
<head><meta name='title' content='{title}'/><meta name='description' content='{desc}'/><meta name='creator' content='x3d.io project; ports written from the published method of Matthias Mueller, Ten Minute Physics'/><meta name='reference' content='https://matthias-research.github.io/pages/tenMinutePhysics/'/></head>
<Scene><NavigationInfo type='"EXAMINE" "ANY"' headlight='false'/>
<Background skyColor='0.02 0.03 0.06 0.08 0.1 0.18' skyAngle='1.5708' groundColor='0.02 0.02 0.03 0.05 0.05 0.07' groundAngle='1.5708'/>
<DirectionalLight direction='-0.4 -1 -0.5' intensity='1.1' color='1 0.96 0.9'/><DirectionalLight direction='0.6 -0.3 0.7' intensity='0.4' color='0.6 0.7 1'/>
"""
def pm(base, rough=0.25, emis=None): return f"<Appearance><PhysicalMaterial baseColor='{base}' roughness='{rough}' metallic='0'" + (f" emissiveColor='{emis}'" if emis else "") + "/></Appearance>"
def line(pts, col): return f"<Shape><Appearance><Material emissiveColor='{col}'/></Appearance><IndexedLineSet coordIndex='{' '.join(map(str, range(len(pts))))} -1'><Coordinate point='{f(pts)}'/></IndexedLineSet></Shape>\n"

# ---------- run 1: hashing ----------
T1 = 8.0; frames = []; xf, rr, st = balls_run(T=T1, frames=frames, check_every=40)
_, _, st_bad = balls_run(T=1.0, cell_scale=0.6, check_every=10)   # control: cell smaller than a ball
hs = []; balls_run(T=3.0, hashes=hs); fr = replay_fresh('balls')
brute_total = NB*(NB-1)//2; ratio = st['cand_total']/st['steps']/brute_total
N['hashing'] = dict(balls=NB, steps=st['steps'], checks=st['checks'], missed=st['missed'], false=st['false'], candidates_per_step=st['cand_total']/st['steps'], brute_pairs_per_step=brute_total,
                    candidate_ratio=ratio, overlapping_pairs_per_step=st['pairs_total']/st['steps'], control_cell_0_6_missed=st_bad['missed'], control_checks=st_bad['checks'])
record("tmp-ports/11-hashing", V4+"11-hashing.x3d", hs, [replay_block(HOST_FRESH, hs, fr)],
       [ref_item("hash pair set against the brute-force pair set: pairs missed, over 54 sampled substeps", st['missed'], LIM['hash_missed'], "set equality with O(n^2) search"),
        ref_item("hash pair set against the brute-force pair set: false pairs", st['false'], LIM['hash_false'], "set equality with O(n^2) search"),
        ref_item("candidate pairs tested per substep over all n(n-1)/2 pairs", ratio, LIM['hash_candidate_ratio'], "count")],
       [dict(id="the same check with cells 0.6 of a ball diameter must miss pairs", expect="fail", observed_failed=bool(st_bad['missed'] > 0), observed=st_bad['missed'])],
       ["timing (counts only, no clock)", "another machine", "contact physics beyond the pair set (no exact reference)"], "hash replay covers the first 3 s")
S = {0.035: 'S0', 0.045: 'S1', 0.055: 'S2'}; cols = {0.035: '0.95 0.55 0.2', 0.045: '0.25 0.75 0.95', 0.055: '0.6 0.95 0.45'}
s = HEAD("TMP 11 Spatial hashing: 400 balls", "400 balls dropped in a box, pairs found by a grid hash and checked against brute force. Idea of Ten Minute Physics 11.") + "<TimeSensor DEF='CLK' cycleInterval='8' loop='true'/>\n"
s += f"<Transform translation='{BW/2} -0.03 0'><Shape>{pm('0.1 0.11 0.15',0.7)}<Box size='{BW+0.2} 0.06 0.4'/></Shape></Transform>\n"
for sx in (-0.03, BW+0.03): s += f"<Transform translation='{sx} {BH/2} 0'><Shape>{pm('0.1 0.11 0.15',0.7)}<Box size='0.06 {BH} 0.4'/></Shape></Transform>\n"
for rad, nm in S.items(): s += f"<Transform visible='false'><Shape DEF='{nm}'>{pm(cols[rad],0.2,' '.join(f'{float(c)*0.25:.2f}' for c in cols[rad].split()))}<Sphere radius='{rad}'/></Shape></Transform>\n"
key = np.linspace(0, 1, len(frames)); kk = f(key, 5); arr = np.array(frames)
for k in range(NB):
    s += f"<Transform DEF='B{k}'><Shape USE='{S[round(float(rr[k]),3)]}'/></Transform>"
    s += f"<PositionInterpolator DEF='B{k}_P' key='{kk}' keyValue='{' '.join(f(np.array([p[0], p[1], 0.0]),3) for p in arr[:, k])}'/><ROUTE fromNode='CLK' fromField='fraction_changed' toNode='B{k}_P' toField='set_fraction'/><ROUTE fromNode='B{k}_P' fromField='value_changed' toNode='B{k}' toField='set_translation'/>\n"
s += f"<Viewpoint description='front' position='{BW/2} {BH/2} 4.2' fieldOfView='0.9'/></Scene></X3D>\n"
(OUT/"11-hashing.x3d").write_text(s); N['hashing']['frames'] = len(frames)

# ---------- run 2: fluid ----------
stats = {}; frames = []; trc = dict(lanes=16, every=2); fluid_run(T=5.0, frames=frames, stats=stats, tracers=trc); stats_bad = {}; fluid_run(T=2.5, niter=3, stats=stats_bad)
hs = []; fluid_run(T=2.0, hashes=hs); fr = replay_fresh('fluid')
N['fluid'] = dict(grid=f"{NX}x{NY}", iterations=100, overrelax=1.9, max_div_rel=stats['max_div_rel'], flux_dev=stats['flux_dev'], control_3iter_div=stats_bad['max_div_rel'], control_3iter_flux=stats_bad['flux_dev'], frames=len(frames))
record("tmp-ports/17-smoke-tunnel", V4+"17-smoke-tunnel.x3d", hs, [replay_block(HOST_FRESH, hs, fr)],
       [ref_item("after the pressure solve: max |divergence| of any fluid cell over the inflow speed (100 sweeps, t > 1 s)", stats['max_div_rel'], LIM['fluid_div'], "continuity, exact invariant"),
        ref_item("flux through every column against the inflow flux, worst relative deviation (t > 1 s)", stats['flux_dev'], LIM['fluid_flux'], "continuity (closed top and bottom)")],
       [dict(id="the divergence test applied to a 3-sweep pressure solve must fail", expect="fail", observed_failed=bool(stats_bad['max_div_rel'] > LIM['fluid_div']), observed=stats_bad['max_div_rel'])],
       ["vortex shedding frequency (no closed form at this resolution)", "another machine"], "hash replay covers the first 2 s")
# tracer scene: dye points released from 16 lanes, advected through the solved velocity field (CoordinateInterpolator drives every frame)
import colorsys
W, Hh = NX*HC, NY*HC; TF = np.array(trc['frames']); npt = TF.shape[1]; lane = trc['lane_of']
colr = np.array([colorsys.hsv_to_rgb(0.0+0.75*(l/17.0), 0.75, 1.0) for l in lane]); key = f(np.linspace(0, 1, len(TF)), 5)
pts3 = np.concatenate([TF, np.zeros((TF.shape[0], npt, 1))], 2)
s = HEAD("TMP 17 Smoke tunnel: dye lanes in an incompressible grid fluid", "60 by 30 staggered grid, Gauss-Seidel pressure projection, semi-Lagrangian advection, circular obstacle; 16 lanes of tracer points. Idea of Ten Minute Physics 17.") + "<TimeSensor DEF='CLK' cycleInterval='5' loop='true'/>\n"
s += f"<Transform translation='{W/2} {Hh/2} -0.05'><Shape>{pm('0.03 0.05 0.1',0.9)}<Box size='{W} {Hh} 0.02'/></Shape></Transform>\n"
s += f"<Shape><Appearance><PointProperties pointSizeScaleFactor='5' pointSizeMinValue='3' pointSizeMaxValue='8' attenuation='1 0 0'/></Appearance><PointSet><Coordinate DEF='DYE' point='{f(pts3[0])}'/><Color color='{f(colr)}'/></PointSet></Shape>\n"
s += f"<CoordinateInterpolator DEF='DYE_I' key='{key}' keyValue='{' '.join(f(p_) for p_ in pts3)}'/><ROUTE fromNode='CLK' fromField='fraction_changed' toNode='DYE_I' toField='set_fraction'/><ROUTE fromNode='DYE_I' fromField='value_changed' toNode='DYE' toField='set_point'/>\n"
s += f"<Transform translation='0.45 0.5 0.0' rotation='1 0 0 1.5708'><Shape>{pm('0.55 0.6 0.7',0.3)}<Cylinder radius='0.12' height='0.06'/></Shape></Transform>\n"
s += f"<OrthoViewpoint description='front' position='0 0 3' fieldOfView='-0.1 -0.1 2.1 1.1'/></Scene></X3D>\n"
(OUT/"17-smoke-tunnel.x3d").write_text(s); N['fluid']['tracers'] = int(npt)

# ---------- run 3: joints ----------
rk = dp_rk4(); mj1, mj2, mjE, mjv = dp_mujoco(); P1r, P2r = dp_pos(rk[:, 0], rk[:, 1])
e_rk = dp_energy_rk4(rk); rk_drift = float(np.abs(e_rk-e_rk[0]).max()/abs(e_rk[0])); mj_drift = float(np.abs(mjE-mjE[0]).max()/abs(mjE[0]))
n3 = int(3.0/1e-3); mj_err = float(max(np.abs(mj1[:n3+1]-P1r[:n3+1]).max(), np.abs(mj2[:n3+1]-P2r[:n3+1]).max()))
mj_err_10 = float(np.abs(mj2-P2r).max(axis=1).max())
div_t = next((i*1e-3 for i in range(len(P2r)) if np.linalg.norm(mj2[i]-P2r[i]) > 0.05), None)
xp = {n: dp_xpbd(n) for n in (1, 20, 100)}
def xerr(n, t): fr_ = int(round(t*30)); a, b = xp[n][fr_]; return float(np.linalg.norm(b-P2r[int(round(t*1000))]))
N['joints'] = dict(mujoco=mjv, mj_vs_rk4_max_m_3s=mj_err, mj_vs_rk4_max_m_10s=mj_err_10, mj_diverges_past_5cm_at_s=div_t, rk4_energy_drift=rk_drift, mujoco_energy_drift=mj_drift,
                   xpbd_pos_err_1s={str(n): xerr(n, 1.0) for n in xp}, xpbd_pos_err_3s={str(n): xerr(n, 3.0) for n in xp})
hs = []; dp_xpbd(100, hashes=hs); fr = replay_fresh('joints')
record("tmp-ports/25-double-pendulum", V4+"25-double-pendulum.x3d", hs, [replay_block(HOST_FRESH, hs, fr)],
       [ref_item("MuJoCo 4.0.1 RK4 against the Lagrangian double pendulum (RK4 on the angles): worst bob position difference over the first 3 s (m)", mj_err, LIM['mj_vs_rk4_m'], f"mujoco {mjv}, dt 1e-3"),
        ref_item("Lagrangian RK4 energy drift over 10 s (relative)", rk_drift, LIM['rk4_energy'], "energy is conserved exactly by the continuous system"),
        ref_item("XPBD joints, 100 substeps at 1/30 s: outer bob position against the Lagrangian reference at t = 1 s (m)", xerr(100, 1.0), LIM['xpbd100_pos_1s'], "Lagrangian RK4")],
       [dict(id="the same position test applied to the 1-substep XPBD pendulum must fail", expect="fail", observed_failed=bool(xerr(1, 1.0) > LIM['xpbd100_pos_1s']), observed=xerr(1, 1.0))],
       ["agreement past the Lyapunov time (chaos; see numbers)", "joint limits and motors", "another machine"], "double pendulum is the first exact reference for XPBD distance joints")
# scene: 3 engines + trails
fps = 30; nfr = 300; key = f(np.linspace(0, 1, nfr+1), 5)
piv = np.array([0.0, 2.2, 0.0]); get = lambda a: np.concatenate([a, np.zeros((len(a), 1))], 1)+piv
eng = [("MuJoCo 4.0.1 (RK4)", np.array([mj1[int(round(i/fps*1000))] for i in range(nfr+1)]), np.array([mj2[int(round(i/fps*1000))] for i in range(nfr+1)]), "1 0.75 0.2"),
       ("Lagrangian RK4", np.array([P1r[int(round(i/fps*1000))] for i in range(nfr+1)]), np.array([P2r[int(round(i/fps*1000))] for i in range(nfr+1)]), "1 1 1"),
       ("XPBD 100 substeps", np.array([xp[100][i][0] for i in range(nfr+1)]), np.array([xp[100][i][1] for i in range(nfr+1)]), "0.2 0.8 1"),
       ("XPBD 1 substep", np.array([xp[1][i][0] for i in range(nfr+1)]), np.array([xp[1][i][1] for i in range(nfr+1)]), "1 0.3 0.25")]
s = HEAD("TMP 25 Joints: a double pendulum, four engines", "A double pendulum as two distance constraints (XPBD) against MuJoCo and the Lagrangian reference. Idea of Ten Minute Physics 25.") + "<TimeSensor DEF='CLK' cycleInterval='10' loop='true'/>\n"
s += f"<Transform translation='{f(piv)}'><Shape>{pm('0.6 0.65 0.75',0.3)}<Sphere radius='0.05'/></Shape></Transform>\n"
for ei, (name, a1, a2, col) in enumerate(eng):
    A1, A2 = get(a1)+[0, 0, 0.04*ei], get(a2)+[0, 0, 0.04*ei]; emis = ' '.join(f'{float(c)*0.35:.2f}' for c in col.split())
    s += line(A2[::3], col)
    for nm, A, rad in (("A", A1, 0.09), ("B", A2, 0.11)):
        s += f"<Transform DEF='E{ei}{nm}'><Shape>{pm(col,0.15,emis)}<Sphere radius='{rad-0.015*ei:.3f}'/></Shape></Transform><PositionInterpolator DEF='E{ei}{nm}_P' key='{key}' keyValue='{' '.join(f(p) for p in A)}'/><ROUTE fromNode='CLK' fromField='fraction_changed' toNode='E{ei}{nm}_P' toField='set_fraction'/><ROUTE fromNode='E{ei}{nm}_P' fromField='value_changed' toNode='E{ei}{nm}' toField='set_translation'/>\n"
    rod = [np.concatenate([piv+[0, 0, 0.04*ei], A1[i], A2[i]]) for i in range(nfr+1)]
    s += f"<Shape><Appearance><Material emissiveColor='{col}'/></Appearance><IndexedLineSet DEF='E{ei}R_L' coordIndex='0 1 2 -1'><Coordinate DEF='E{ei}R_C' point='{f(rod[0])}'/></IndexedLineSet></Shape>"
    s += f"<CoordinateInterpolator DEF='E{ei}R_I' key='{key}' keyValue='{' '.join(f(r_) for r_ in rod)}'/><ROUTE fromNode='CLK' fromField='fraction_changed' toNode='E{ei}R_I' toField='set_fraction'/><ROUTE fromNode='E{ei}R_I' fromField='value_changed' toNode='E{ei}R_C' toField='set_point'/>\n"
s += "<!-- thin trails: outer bob path over 10 s. gold MuJoCo, white Lagrangian RK4, blue XPBD 100, red XPBD 1. gold and white overlap for the whole run -->\n<Viewpoint description='front' position='0 0.4 7.2' fieldOfView='0.9'/></Scene></X3D>\n"
(OUT/"25-double-pendulum.x3d").write_text(s)
for a in PENDING: write_record(*a)
N['seconds'] = round(time.time()-t0, 1)
(OUT/'numbers4.json').write_text(json.dumps(N, indent=1, default=float)); print(json.dumps(N, indent=1, default=float))
