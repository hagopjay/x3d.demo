"""Batch 3: put the Ten Minute Physics ports under the Loom physics witness (loom.physics-run/1).
Own code. Limits (declared_limit) are written in this file before the first measurement run and are not tuned.
usage: witness_tmp.py OUTDIR ROOT        record + measure + write records and the engines scene
       witness_tmp.py --replay NAME      print the per-step hash list of one run (used for the fresh-process replay)"""
import sys, json, math, hashlib, struct, subprocess, time
import numpy as np

G = 9.81
# ---------- declared limits (written before the run) ----------
LIM = dict(free_flight_pos=1e-9, shadow_energy=1e-9, bounded_energy=0.20,
           pair_momentum=1e-12, pair_energy=1e-12, pair_swap=1e-12,
           mj_vs_rk4_rad=1e-6, mj_period=1e-4, xpbd100_period=0.02, xpbd_retained=0.9,
           water_volume=1e-10, cfl_threshold=0.003)

def h32(arr):
    return int(hashlib.sha256(np.asarray(arr, dtype='<f8').tobytes()).hexdigest()[:8], 16)
def trace_sha(hs): return hashlib.sha256(",".join(str(h) for h in hs).encode()).hexdigest()

# ================= RUN 1: bead on a wire =================
R_W, TH0 = 1.0, math.radians(80)
def bead_numpy(nsub, T=12.0, dt=1/30, hashes=None):
    x = np.array([R_W*math.sin(TH0), -R_W*math.cos(TH0)]); v = np.zeros(2); h = dt/nsub; P = [x.copy()]; E = []
    for i in range(int(T/dt)):
        for _ in range(nsub):
            xp = x.copy(); v = v + np.array([0, -G])*h; x = x + v*h
            d = math.sqrt(x[0]*x[0] + x[1]*x[1]); x = x - (d-R_W)*x/d; v = (x-xp)/h   # explicit sqrt: np.linalg.norm differs by 1 ulp from scalar code (see norm_ulp_probe)
        P.append(x.copy()); E.append(0.5*v@v + G*(x[1]+R_W))
        if hashes is not None: hashes.append(h32(np.concatenate([x, v])))
    return np.array(P), np.array(E)
def bead_pure(nsub, T=12.0, dt=1/30):
    x0, x1 = R_W*math.sin(TH0), -R_W*math.cos(TH0); v0 = v1 = 0.0; h = dt/nsub; hs = []
    for i in range(int(T/dt)):
        for _ in range(nsub):
            p0, p1 = x0, x1; v1 = v1 + (-G)*h; x0 = x0 + v0*h; x1 = x1 + v1*h
            d = math.sqrt(x0*x0 + x1*x1); x0 = x0 - (d-R_W)*x0/d; x1 = x1 - (d-R_W)*x1/d
            v0 = (x0-p0)/h; v1 = (x1-p1)/h
        hs.append(h32([x0, x1, v0, v1]))
    return hs

def norm_ulp_probe(nsub=100):
    """first substep at which a bead run that uses np.linalg.norm leaves the scalar-python run (cross-host determinism finding)"""
    h = (1/30)/nsub; x = np.array([R_W*math.sin(TH0), -R_W*math.cos(TH0)]); v = np.zeros(2); x0, x1 = float(x[0]), float(x[1]); v0 = v1 = 0.0
    for i in range(nsub*30):
        xp = x.copy(); v = v + np.array([0, -G])*h; x = x + v*h; d = np.linalg.norm(x); x = x - (d-R_W)*x/d; v = (x-xp)/h
        p0, p1 = x0, x1; v1 = v1 + (-G)*h; x0 = x0 + v0*h; x1 = x1 + v1*h; dp = math.sqrt(x0*x0+x1*x1); x0 = x0-(dp-R_W)*x0/dp; x1 = x1-(dp-R_W)*x1/dp; v0 = (x0-p0)/h; v1 = (x1-p1)/h
        if not (x[0] == x0 and x[1] == x1): return dict(substep=i, d_numpy_minus_scalar=float(d-dp))
    return None
def theta_ref(T=12.0, h=1e-3):
    th, w = TH0, 0.0; out = [th]; f = lambda a, b: (b, -G/R_W*math.sin(a))
    for i in range(int(round(T/h))):
        k1 = f(th, w); k2 = f(th+h/2*k1[0], w+h/2*k1[1]); k3 = f(th+h/2*k2[0], w+h/2*k2[1]); k4 = f(th+h*k3[0], w+h*k3[1])
        th += h/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]); w += h/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]); out.append(th)
    return np.array(out)
def mujoco_theta(T=12.0, h=1e-3):
    import mujoco
    xml = f"""<mujoco><option timestep="{h}" integrator="RK4" gravity="0 0 -{G}"/><worldbody><body pos="0 0 0">
      <joint name="j" type="hinge" axis="0 1 0"/><inertial pos="0 0 -{R_W}" mass="1" diaginertia="1e-9 1e-9 1e-9"/>
      <geom type="sphere" size="0.01" pos="0 0 -{R_W}" contype="0" conaffinity="0" mass="0"/></body></worldbody></mujoco>"""
    m = mujoco.MjModel.from_xml_string(xml); d = mujoco.MjData(m); d.qpos[0] = -TH0  # axis y: positive turns -z toward -x; sign matched below
    out = [d.qpos[0]]
    for i in range(int(round(T/h))):
        mujoco.mj_step(m, d); out.append(d.qpos[0])
    return np.array(out)*-1.0, mujoco.__version__
def period_from(theta, h):
    """mean period from upward zero crossings, linear interpolation"""
    zs = [ (i + theta[i]/(theta[i]-theta[i+1]))*h for i in range(len(theta)-1) if theta[i] < 0 <= theta[i+1] ]
    return float(np.mean(np.diff(zs))) if len(zs) > 1 else float('nan')
def period_exact(th0):
    a, b = 1.0, math.cos(th0/2)
    for _ in range(30): a, b = (a+b)/2, math.sqrt(a*b)
    return 2*math.pi/a*math.sqrt(R_W/G)   # T = 2 pi/AGM(1,cos(th0/2)) sqrt(L/g)

# ================= RUN 2: cannonball (two Euler orders, box with bounces) =================
BOX = (6.0, 4.0, 3.0); RB = 0.15; H30 = 1/30
def cannon_numpy(mode, T=12.0, h=H30, hashes=None, bounce_log=None):
    L, H, D = BOX; p = np.array([-2.5, 0.3, -0.6]); v = np.array([3.2, 7.5, 1.1]); E = []
    for i in range(int(round(T/h))):
        if mode == 'sym': v = v + np.array([0, -G, 0])*h; p = p + v*h
        else: pn = p + v*h; v = v + np.array([0, -G, 0])*h; p = pn
        Eb = 0.5*v@v + G*(p[1]-RB)
        for k, (lo, hi) in enumerate([(-L/2+RB, L/2-RB), (RB, H-RB), (-D/2+RB, D/2-RB)]):
            if p[k] < lo: p[k] = 2*lo-p[k]; v[k] = -v[k]
            if p[k] > hi: p[k] = 2*hi-p[k]; v[k] = -v[k]
        Ea = 0.5*v@v + G*(p[1]-RB); E.append(Ea)
        if bounce_log is not None and abs(Ea-Eb) > 1e-12: bounce_log.append(Ea-Eb)
        if hashes is not None: hashes.append(h32(np.concatenate([p, v])))
    return np.array(E)
def cannon_pure(mode, T=12.0, h=H30):
    L, H, D = BOX; p = [-2.5, 0.3, -0.6]; v = [3.2, 7.5, 1.1]; hs = []
    lims = [(-L/2+RB, L/2-RB), (RB, H-RB), (-D/2+RB, D/2-RB)]
    for i in range(int(round(T/h))):
        if mode == 'sym':
            v[1] = v[1] + (-G)*h
            for k in range(3): p[k] = p[k] + v[k]*h
        else:
            pn = [p[k] + v[k]*h for k in range(3)]; v[1] = v[1] + (-G)*h; p = pn
        for k, (lo, hi) in enumerate(lims):
            if p[k] < lo: p[k] = 2*lo-p[k]; v[k] = -v[k]
            if p[k] > hi: p[k] = 2*hi-p[k]; v[k] = -v[k]
        hs.append(h32(p+v))
    return hs
def free_flight(mode, n=360, h=H30):
    y, vy = 0.3, 7.5; E0 = 0.5*vy*vy + G*y; sh = []
    for i in range(n):
        if mode == 'sym': vy -= G*h; y += vy*h; shadow = 0.5*vy*vy + G*y - 0.5*G*h*vy
        else: yn = y + vy*h; vy -= G*h; y = yn; shadow = 0.5*vy*vy + G*y + 0.5*G*h*vy
        sh.append(shadow)
    return y, vy, np.array(sh), E0
def cannon_both(hashes_s=None, hashes_e=None):
    return cannon_numpy('sym', hashes=hashes_s), cannon_numpy('exp', hashes=hashes_e)

# ================= RUN 3: head-on equal-mass pair =================
def pair_run(hashes=None, steps=240, hz=240.0, rule='fixed'):
    dt = 1/hz; r = 0.1; p = np.array([[-0.5, 0.0], [0.5, 0.0]]); v = np.array([[3.0, 0.0], [-1.0, 0.0]]); v0 = v.copy()
    for i in range(steps):
        p = p + v*dt
        d = p[1]-p[0]; dist = np.linalg.norm(d)
        if dist < 2*r:
            n = d/dist; pen = 2*r - dist; p[0] -= n*pen/2; p[1] += n*pen/2
            vn = (v[0]-v[1])@n
            if (vn > 0 if rule == 'fixed' else vn < 0): v[0] -= vn*n; v[1] += vn*n
        if hashes is not None: hashes.append(h32(np.concatenate([p.ravel(), v.ravel()])))
    return v0, v
def pair_pure(steps=240, hz=240.0):
    dt = 1/hz; r = 0.1; p0, p1 = [-0.5, 0.0], [0.5, 0.0]; va, vb = [3.0, 0.0], [-1.0, 0.0]; hs = []
    for i in range(steps):
        p0 = [p0[0]+va[0]*dt, p0[1]+va[1]*dt]; p1 = [p1[0]+vb[0]*dt, p1[1]+vb[1]*dt]
        dx, dy = p1[0]-p0[0], p1[1]-p0[1]; dist = math.sqrt(dx*dx+dy*dy)
        if dist < 2*r:
            nx, ny = dx/dist, dy/dist; pen = 2*r-dist
            p0 = [p0[0]-nx*pen/2, p0[1]-ny*pen/2]; p1 = [p1[0]+nx*pen/2, p1[1]+ny*pen/2]
            vn = (va[0]-vb[0])*nx + (va[1]-vb[1])*ny
            if vn > 0: va = [va[0]-vn*nx, va[1]-vn*ny]; vb = [vb[0]+vn*nx, vb[1]+vn*ny]
        hs.append(h32(p0+p1+va+vb))
    return hs

# ================= RUN 4: height-field water =================
M, DX, C = 28, 0.1, 5.0
def lap(h):
    p = np.pad(h, 1, mode='edge'); return (p[2:, 1:-1]+p[:-2, 1:-1]+p[1:-1, 2:]+p[1:-1, :-2]-4*h)/DX**2
def water_run(ratio, T=10.0, hashes=None, seed_drop=True):
    dt = ratio*DX/C; h = np.zeros((M, M)); v = np.zeros((M, M)); h[10, 10] = 0.1; v0 = h.sum(); n = int(T/dt); amp = 0.0
    for i in range(n):
        v += C**2*lap(h)*dt; h += v*dt
        if hashes is not None and i % 50 == 0: hashes.append(h32(h.ravel()))
        if not np.isfinite(h).all(): return float('inf'), abs(h.sum()-v0) if np.isfinite(h).all() else float('nan'), i
        amp = max(amp, float(np.abs(h).max()))
        if amp > 1e6: return amp, float('nan'), i
    return amp, abs(h.sum()-v0), n
def cfl_bisect():
    lo, hi = 0.5, 1.0
    for _ in range(14):
        mid = (lo+hi)/2; amp, _, _ = water_run(mid, T=4.0)
        if amp > 1e3: hi = mid
        else: lo = mid
    return (lo+hi)/2

HASHERS = {
 'bead': lambda: (lambda hs: (bead_numpy(100, hashes=hs), hs)[1])([]),
 'cannon_sym': lambda: (lambda hs: (cannon_numpy('sym', hashes=hs), hs)[1])([]),
 'cannon_exp': lambda: (lambda hs: (cannon_numpy('exp', hashes=hs), hs)[1])([]),
 'pair': lambda: (lambda hs: (pair_run(hashes=hs), hs)[1])([]),
 'water': lambda: (lambda hs: (water_run(0.5, hashes=hs), hs)[1])([]),
}
if len(sys.argv) > 2 and sys.argv[1] == '--replay':
    print(json.dumps(HASHERS[sys.argv[2]]())); sys.exit(0)

OUT, ROOT = sys.argv[1], sys.argv[2]
from pathlib import Path
OUT = Path(OUT); (OUT/'records').mkdir(parents=True, exist_ok=True); ROOT = Path(ROOT)
def sha_file(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def sha_ports(): return hashlib.sha256((Path(__file__).read_bytes())).hexdigest()[:12]
def replay_fresh(name):
    out = subprocess.run([sys.executable, '-I', __file__, '--replay', name], capture_output=True, text=True, check=True).stdout
    return json.loads(out)
def replay_block(host, ref, other, steps, extra=None):
    mism = [i for i, (a, b) in enumerate(zip(ref, other)) if a != b]
    d = dict(host=host, steps=len(other), mismatches=len(mism) + abs(len(ref)-len(other)), first_mismatch=(mism[0] if mism else None), trace_sha256=trace_sha(other))
    if extra: d.update(extra)
    return d
PYV = sys.version.split()[0]; NPV = np.__version__
HOST_REC = f"cpython-{PYV}-numpy-{NPV}"; HOST_FRESH = "numpy-fresh-process"; HOST_PURE = "cpython-pure-float"
def ref_item(id_, observed, limit, source, rule="at most"):
    return dict(id=id_, observed=float(observed), limit=limit, declared_limit=limit, rule=rule, status=("pass" if (observed <= limit if rule == "at most" else observed >= limit) else "fail"), source=source)
V1 = "docs/demos/ten-minute-physics/v1/"; V2 = "docs/demos/ten-minute-physics/v2/"
numbers = {}
def record(rid, model_path, hashes, replays, refs, controls, not_shown, note):
    rec = dict(schema="loom.physics-run/1", id=rid, engine=dict(name="tmp-ports (numpy)", version=f"numpy-{NPV}", build=f"witness_tmp.py sha256 {sha_ports()}, python {PYV}"),
        model=dict(sha256=sha_file(ROOT/model_path), path=model_path, what="the X3D scene the port produced; the sim parameters live in the generator scripts beside it"),
        recorded=dict(host=HOST_REC, steps=len(hashes), hashes=hashes, trace_sha256=trace_sha(hashes)),
        replays=replays, references=refs, controls=controls, not_shown=not_shown, note=note)
    (OUT/'records'/(rid.split('/')[-1]+'.physics.json')).write_text(json.dumps(rec, indent=1)); return rec

# ---- run 1 bead + MuJoCo ----
t0 = time.time()
hs = []; P100, E100 = bead_numpy(100, hashes=hs); P1, E1 = bead_numpy(1); E0 = 0.5*0 + G*(math.sin(0)+0) ; E0 = G*(-R_W*math.cos(TH0)+R_W)
mj, mjv = mujoco_theta(); rk = theta_ref()
mj_err = float(np.abs(mj - rk).max())
T_ex = period_exact(TH0); T_mj = period_from(mj, 1e-3)
th100 = np.array([math.atan2(p[0], -p[1]) for p in P100]); T_x = period_from(th100, 1/30)
retained1 = float(E1[-1]/E0); retained100 = float(E100[-1]/E0)
numbers['bead'] = dict(mj_vs_rk4_max_rad=mj_err, T_exact=T_ex, T_mujoco=T_mj, T_xpbd100=T_x, xpbd100_period_err=abs(T_x/T_ex-1), mj_period_err=abs(T_mj/T_ex-1),
                       retained_E_1sub=retained1, retained_E_100sub=retained100, mujoco=mjv)
refs = [ref_item("MuJoCo RK4 hinge pendulum against our RK4 on theta: max |theta| difference over 12 s (rad)", mj_err, LIM['mj_vs_rk4_rad'], f"mujoco {mjv}, dt 1e-3; numpy RK4 dt 1e-3"),
        ref_item("MuJoCo period against the exact elliptic period 2 pi/AGM(1,cos(th0/2)) sqrt(L/g), theta0 80 deg (relative)", abs(T_mj/T_ex-1), LIM['mj_period'], "AGM closed form"),
        ref_item("XPBD bead, 100 substeps at 1/30 s: period against the exact elliptic period (relative)", abs(T_x/T_ex-1), LIM['xpbd100_period'], "AGM closed form")]
ctrls = [dict(id="energy-retention test (E/E0 >= 0.9 after 12 s) applied to the 1-substep bead: it must fail", expect="fail", observed_failed=bool(retained1 < LIM['xpbd_retained']), observed=retained1)]
pure = bead_pure(100); fresh = replay_fresh('bead')
reps = [replay_block(HOST_FRESH, hs, fresh, len(hs)), replay_block(HOST_PURE, hs, pure, len(hs))]
numbers['bead']['norm_ulp_probe'] = norm_ulp_probe()
numbers['bead_hash'] = dict(steps=len(hs), fresh_mismatch=reps[0]['mismatches'], pure_python_mismatch=reps[1]['mismatches'], pure_first_mismatch=reps[1]['first_mismatch'])
record("tmp-ports/05-bead-xpbd", V1+"05-bead-xpbd.x3d", hs, reps, refs, ctrls,
       ["XPBD energy decay has no closed form here (reported in v1 receipt, not judged)", "another machine", "a real GPU"],
       "MuJoCo is the independent engine: a model check, not a build check (playbook pattern 9)")
# ---- run 2 cannonball ----
hs_s, hs_e = [], []; Es, Ee = cannon_both(hs_s, hs_e)
E0c = 0.5*(3.2**2+7.5**2+1.1**2) + G*(0.3-RB); relS, relE = Es/E0c, Ee/E0c
ys, vys, shs, E0f = free_flight('sym'); ye, vye, she, _ = free_flight('exp')
def disc(n, h=H30): return 0.3 + 7.5*n*h - G*h*h*n*(n+1)/2
bl_s, bl_e = [], []; cannon_numpy('sym', bounce_log=bl_s); cannon_numpy('exp', bounce_log=bl_e)
numbers['cannon'] = dict(sym_dev_max=float(np.abs(relS-1).max()), exp_dev_max=float(np.abs(relE-1).max()), exp_E_final=float(relE[-1]), exp_E_min=float(relE.min()),
        free_flight_pos_err_sym=float(abs(ys-disc(360))), shadow_energy_drift_sym=float(np.abs(shs-shs[0]).max()/E0f), shadow_energy_drift_exp=float(np.abs(she-she[0]).max()/E0f),
        bounce_jumps_sym=dict(n=len(bl_s), mean=float(np.mean(bl_s)), sum=float(np.sum(bl_s))), bounce_jumps_exp=dict(n=len(bl_e), mean=float(np.mean(bl_e)), sum=float(np.sum(bl_e))))
# exact y for symplectic: y_n = y0 + v0 n h - g h^2 n(n+1)/2 ; shadow energy conserved
refs = [ref_item("free flight, symplectic Euler, 360 steps at 1/30 s: height against the discrete solution y0 + v0 n h - g h^2 n(n+1)/2 (m)", abs(ys-disc(360)), LIM['free_flight_pos'], "closed form of the scheme"),
        ref_item("free flight, symplectic Euler: shadow energy E - g h v / 2 is conserved (max drift / E0)", np.abs(shs-shs[0]).max()/E0f, LIM['shadow_energy'], "modified-equation identity"),
        ref_item("free flight, explicit Euler: shadow energy E + g h v / 2 is conserved (max drift / E0)", np.abs(she-she[0]).max()/E0f, LIM['shadow_energy'], "modified-equation identity"),
        ref_item("box with bounces, symplectic Euler: energy stays within 20% of E0 over 12 s (max |E/E0 - 1|)", np.abs(relS-1).max(), LIM['bounded_energy'], "bounded-energy test declared before the run")]
ctrls = [dict(id="the same bounded-energy test applied to explicit Euler in the box must fail", expect="fail", observed_failed=bool(np.abs(relE-1).max() > LIM['bounded_energy']), observed=float(np.abs(relE-1).max()))]
fs, fe = replay_fresh('cannon_sym'), replay_fresh('cannon_exp'); ps, pe = cannon_pure('sym'), cannon_pure('exp')
reps = [replay_block(HOST_FRESH, hs_s, fs, len(hs_s)), replay_block(HOST_PURE, hs_s, ps, len(hs_s))]
numbers['cannon_hash'] = dict(steps=len(hs_s), fresh_mismatch=reps[0]['mismatches'], pure_mismatch=reps[1]['mismatches'], pure_first=reps[1]['first_mismatch'],
                              exp_fresh=replay_block(HOST_FRESH, hs_e, fe, len(hs_e))['mismatches'], exp_pure=replay_block(HOST_PURE, hs_e, pe, len(hs_e))['mismatches'])
record("tmp-ports/01-cannonball-symplectic", V1+"01-cannonball.x3d", hs_s, reps, refs, ctrls, ["the reference ball at dt/200 is the same scheme, not independent", "another machine"],
       "the explicit-Euler run is the control; its own hashes replay too (see numbers)")
# ---- run 3 pair ----
hs = []; v0, v1 = pair_run(hashes=hs)
m_err = float(np.abs(v1.sum(0)-v0.sum(0)).max()); e_err = float(abs((v1**2).sum()-(v0**2).sum())/(v0**2).sum()); sw = float(np.abs(v1[0]-v0[1]).max()); sw2 = float(np.abs(v1[1]-v0[0]).max())
numbers['pair'] = dict(momentum_err=m_err, energy_err=e_err, swap_err=max(sw, sw2))
refs = [ref_item("head-on equal-mass elastic pair: total momentum change (kg m/s)", m_err, LIM['pair_momentum'], "conservation, closed form"),
        ref_item("head-on equal-mass elastic pair: kinetic energy change (relative)", e_err, LIM['pair_energy'], "conservation, closed form"),
        ref_item("head-on equal-mass elastic pair: velocities exchanged (max difference, m/s)", max(sw, sw2), LIM['pair_swap'], "closed form")]
v0o, v1o = pair_run(rule='v1'); sw_old = float(max(np.abs(v1o[0]-v0o[1]).max(), np.abs(v1o[1]-v0o[0]).max()))
numbers['pair']['v1_rule_swap_err'] = sw_old
ctrls = [dict(id="the batch-1 collision rule (impulse when the normal speed is negative) must fail the swap test: it never exchanged momentum", expect="fail", observed_failed=bool(sw_old > LIM['pair_swap']), observed=sw_old)]
fr = replay_fresh('pair'); pp = pair_pure(); reps = [replay_block(HOST_FRESH, hs, fr, len(hs)), replay_block(HOST_PURE, hs, pp, len(hs))]
numbers['pair_hash'] = dict(steps=len(hs), fresh=reps[0]['mismatches'], pure=reps[1]['mismatches'], pure_first=reps[1]['first_mismatch'])
record("tmp-ports/03-billiards-pair", V1+"03-billiards.x3d", hs, reps, refs, ctrls, ["16-ball rack: no closed form; its frictionless KE drift 1.3e-15 is in the v1 receipt, not judged here", "multi-contact order dependence"], "the pair is the only exact piece of the billiards demo")
# ---- run 4 water ----
hs = []; amp, vol, nst = water_run(0.5, hashes=hs); ratio = cfl_bisect(); amp72, _, ns72 = water_run(0.72, T=4.0)
numbers['water'] = dict(volume_drift_10s=vol, cfl_bisect=ratio, cfl_theory=1/math.sqrt(2), cfl_err=abs(ratio-1/math.sqrt(2)), amp_at_0_72=amp72, steps_to_blowup_0_72=ns72)
refs = [ref_item("pure tank, c dt/dx 0.5, 10 s: total volume drift (m^3 per unit)", vol, LIM['water_volume'], "Neumann wave equation conserves volume exactly"),
        ref_item("stability threshold of c dt/dx found by bisection against 1/sqrt(2) (absolute)", abs(ratio-1/math.sqrt(2)), LIM['cfl_threshold'], "von Neumann analysis, symplectic Euler, 5-point Laplacian")]
ctrls = [dict(id="stability test (max |h| < 1000 after 4 s) at c dt/dx = 0.72 must fail", expect="fail", observed_failed=bool(amp72 > 1e3), observed=float(amp72))]
fr = replay_fresh('water'); reps = [replay_block(HOST_FRESH, hs, fr, len(hs))]
numbers['water_hash'] = dict(steps=len(hs), fresh=reps[0]['mismatches'])
record("tmp-ports/20-water-cfl", V2+"20-water.x3d", hs, reps, refs, ctrls, ["the floating ball (no exact reference)", "cloth and jelly dynamics (self-consistency only: see v2 receipt)", "another machine"], "hash is taken every 50 steps of the stable tank")
numbers['seconds'] = round(time.time()-t0, 1)
# ---- scene: three engines on one ring ----
sys.path.insert(0, str(Path(__file__).parent))
def f(a, p=3): return " ".join(("%.*f" % (p, x)).rstrip("0").rstrip(".") if abs(x) > 10**-p else "0" for x in np.ravel(a))
fps = 30; nfr = int(12*fps); key = np.linspace(0, 1, nfr+1)
def at(arr, per_sec): return np.array([arr[int(round(i/fps*per_sec))] for i in range(nfr+1)])
th_mj, th_rk = at(mj, 1000), at(rk, 1000); th_x100 = th100; th_x1 = np.array([math.atan2(p[0], -p[1]) for p in P1])
rings = [("MuJoCo 4.0.1 (RK4)", th_mj, "1 0.75 0.2"), ("exact RK4 on theta", th_rk, "1 1 1"), ("XPBD 100 substeps", th_x100, "0.2 0.8 1"), ("XPBD 1 substep", th_x1, "1 0.3 0.25")]
def pm(base, rough=0.2, emis=None):
    e = f" emissiveColor='{emis}'" if emis else ""
    return f"<Appearance><PhysicalMaterial baseColor='{base}' roughness='{rough}' metallic='0'{e}/></Appearance>"
s = f"""<?xml version="1.0" encoding="UTF-8"?>
<X3D profile='Full' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
<head><meta name='title' content='TMP 06 Pendulum: four engines, one wire'/><meta name='description' content='A bead released at 80 degrees: MuJoCo RK4, exact RK4, XPBD with 100 substeps, XPBD with 1 substep. Idea of Ten Minute Physics 05-06.'/>
<meta name='creator' content='x3d.io project; ports written from the published method of Matthias Mueller, Ten Minute Physics'/><meta name='reference' content='https://matthias-research.github.io/pages/tenMinutePhysics/'/></head>
<Scene><NavigationInfo type='"EXAMINE" "ANY"' headlight='false'/>
<Background skyColor='0.02 0.03 0.06 0.08 0.1 0.18' skyAngle='1.5708' groundColor='0.02 0.02 0.03 0.05 0.05 0.07' groundAngle='1.5708'/>
<DirectionalLight direction='-0.4 -1 -0.5' intensity='1.1' color='1 0.96 0.9'/><DirectionalLight direction='0.6 -0.3 0.7' intensity='0.4' color='0.6 0.7 1'/>
<TimeSensor DEF='CLK' cycleInterval='12' loop='true'/>
"""
ring = " ".join(f(np.array([R_W*math.sin(a), 1.2-R_W*math.cos(a), 0]), 3) for a in np.linspace(0, 2*math.pi, 97)); idx = " ".join(map(str, range(97))) + " -1"
s += f"<Shape><Appearance><Material emissiveColor='0.45 0.5 0.6'/></Appearance><IndexedLineSet coordIndex='{idx}'><Coordinate point='{ring}'/></IndexedLineSet></Shape>\n"
for i, (name, th, col) in enumerate(rings):
    r_ = 0.10 - 0.02*i; z = 0.05*i
    pts = np.array([[R_W*math.sin(t), 1.2-R_W*math.cos(t), z] for t in th])
    emis = ' '.join(f'{float(c)*0.35:.2f}' for c in col.split())
    s += f"<Transform DEF='B{i}'><Shape>{pm(col, 0.15, emis)}<Sphere radius='{r_:.3f}'/></Shape></Transform>\n"
    s += f"<PositionInterpolator DEF='B{i}_P' key='{f(key,5)}' keyValue='{' '.join(f(p) for p in pts)}'/><ROUTE fromNode='CLK' fromField='fraction_changed' toNode='B{i}_P' toField='set_fraction'/><ROUTE fromNode='B{i}_P' fromField='value_changed' toNode='B{i}' toField='set_translation'/>\n"
# chart: |theta - theta_rk| per engine, log10 clamp
def chart_lines(series, cols, ox, oy, w, h, lo, hi):
    out = f"<Shape><Appearance><Material emissiveColor='0.5 0.55 0.65'/></Appearance><IndexedLineSet coordIndex='0 1 2 3 0 -1'><Coordinate point='{f([ox,oy,0, ox+w,oy,0, ox+w,oy+h,0, ox,oy+h,0])}'/></IndexedLineSet></Shape>\n"
    for sr, c in zip(series, cols):
        sr = np.clip(np.log10(np.maximum(sr, 1e-12)), lo, hi); xs = np.linspace(0, w, len(sr)); ys = (sr-lo)/(hi-lo)*h
        pts = np.stack([ox+xs, oy+ys, np.zeros_like(xs)], 1)
        out += f"<Shape><Appearance><Material emissiveColor='{c}'/></Appearance><IndexedLineSet coordIndex='{' '.join(map(str, range(len(pts))))} -1'><Coordinate point='{f(pts)}'/></IndexedLineSet></Shape>\n"
    return out
errs = [np.abs(th_mj-th_rk), np.abs(th_x100-th_rk), np.abs(th_x1-th_rk)]
s += chart_lines(errs, ["1 0.75 0.2", "0.2 0.8 1", "1 0.3 0.25"], -1.6, -1.5, 3.2, 1.0, -10, 1)
s += "<!-- chart: log10 |theta - theta_RK4| over 12 s, axis -10..1: gold MuJoCo, blue XPBD 100, red XPBD 1 -->\n"
s += "<Viewpoint description='front' position='0 0.5 6.2' fieldOfView='0.9'/></Scene></X3D>\n"
(OUT/'06-pendulum-engines.x3d').write_text(s)
numbers['scene'] = dict(mj_vs_exact_rk4_max_rad=mj_err, frames=nfr+1)
(OUT/'numbers3.json').write_text(json.dumps(numbers, indent=1, default=float)); print(json.dumps(numbers, indent=1, default=float))
