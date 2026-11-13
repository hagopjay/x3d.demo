"""Own-code ports of ideas from Ten Minute Physics (Matthias Mueller, ten minute physics videos 01/03/05-06).
No code copied; integrators written from the published method descriptions. Emits declarative X3D 4.0
(TimeSensor + interpolators), so every frame is a keyframe in the file and the validator can see it."""
import numpy as np, json, math, sys
from pathlib import Path
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
R = {}  # numbers receipt

def f(a, p=4): return " ".join(f"{x:.{p}f}".rstrip("0").rstrip(".") if abs(x)>1e-9 else "0" for x in np.ravel(a))
def head(title, desc, extra=""):
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
 <DirectionalLight direction='0.6 -0.3 0.7' intensity='0.35' color='0.6 0.7 1'/>
{extra}"""
def pm(base, rough=0.3, metal=0.0, emis=None):
    e = f" emissiveColor='{emis}'" if emis else ""
    return f"<Appearance><PhysicalMaterial baseColor='{base}' roughness='{rough}' metallic='{metal}'{e}/></Appearance>"
def lines(pts, color, name=""):
    pts = np.asarray(pts); idx = " ".join(map(str, range(len(pts)))) + " -1"
    return (f"<Shape><Appearance><Material emissiveColor='{color}'/></Appearance><IndexedLineSet coordIndex='{idx}'>"
            f"<Coordinate point='{f(pts,3)}'/></IndexedLineSet></Shape>")
def mover(name, T, keys_t, keys_p, children, kind="pos", ori=None):
    s = f"<Transform DEF='{name}'>{children}</Transform>\n"
    s += f"<PositionInterpolator DEF='{name}_P' key='{f(keys_t,5)}' keyValue='{f(keys_p,4)}'/>\n"
    s += f"<ROUTE fromNode='CLK' fromField='fraction_changed' toNode='{name}_P' toField='set_fraction'/><ROUTE fromNode='{name}_P' fromField='value_changed' toNode='{name}' toField='set_translation'/>\n"
    if ori is not None:
        s += f"<OrientationInterpolator DEF='{name}_O' key='{f(keys_t,5)}' keyValue='{f(ori,4)}'/>\n"
        s += f"<ROUTE fromNode='CLK' fromField='fraction_changed' toNode='{name}_O' toField='set_fraction'/><ROUTE fromNode='{name}_O' fromField='value_changed' toNode='{name}' toField='set_rotation'/>\n"
    return s
def clock(T): return f"<TimeSensor DEF='CLK' cycleInterval='{T}' loop='true'/>\n"
def chart(series, colors, origin, size, label_pts=None, ymin=None, ymax=None):
    """3D line chart in the xy plane at origin, size=(w,h); series list of arrays."""
    allv = np.concatenate(series); lo = allv.min() if ymin is None else ymin; hi = allv.max() if ymax is None else ymax
    out = []
    ox, oy, oz = origin; w, h = size
    frame = [(ox,oy,oz),(ox+w,oy,oz),(ox+w,oy+h,oz),(ox,oy+h,oz),(ox,oy,oz)]
    out.append(lines(frame, "0.5 0.55 0.65"))
    for s, c in zip(series, colors):
        n = len(s); step = max(1, n//300)
        xs = np.linspace(0, w, len(s[::step])); ys = (np.asarray(s[::step])-lo)/(hi-lo+1e-12)*h
        out.append(lines(np.stack([ox+xs, oy+ys, np.full_like(xs, oz)], 1), c))
    return "\n".join(out), (lo, hi)

# ---------- DEMO 01: cannonball, three integrators ----------
def cannon():
    T, dt, g = 12.0, 1/30, 9.81
    L, H, D = 6.0, 4.0, 3.0   # box x,y,z
    r = 0.15
    def sim(mode):
        p = np.array([-2.5, 0.3, -0.6]); v = np.array([3.2, 7.5, 1.1]); P=[p.copy()]; E=[]
        m=1; 
        for i in range(int(T/dt)):
            if mode == "symplectic": v = v + np.array([0,-g,0])*dt; p = p + v*dt
            elif mode == "explicit": pn = p + v*dt; v = v + np.array([0,-g,0])*dt; p = pn
            for k,(lo,hi) in enumerate([(-L/2+r,L/2-r),(r,H-r),(-D/2+r,D/2-r)]):
                if p[k] < lo: p[k] = 2*lo - p[k]; v[k] = -v[k]
                if p[k] > hi: p[k] = 2*hi - p[k]; v[k] = -v[k]
            P.append(p.copy()); E.append(0.5*v@v + g*(p[1]-r))
        return np.array(P), np.array(E)
    Ps, Es = sim("symplectic"); Pe, Ee = sim("explicit")
    # exact: ballistic parabola with exact reflection (unfold): integrate analytic per-axis triangle wave
    t = np.arange(len(Ps))*dt
    def unfold(x0, v0, a, lo, hi, tt):
        w = hi-lo; # exact motion with constant accel a, reflecting: use tiny-step RK is overkill; use dt/200 symplectic as reference
        return None
    ref=[]; p = np.array([-2.5, 0.3, -0.6]); v = np.array([3.2, 7.5, 1.1]); h = dt/200
    for i in range(int(T/dt)*200):
        v = v + np.array([0,-g,0])*h; p = p + v*h
        for k,(lo,hi) in enumerate([(-L/2+r,L/2-r),(r,H-r),(-D/2+r,D/2-r)]):
            if p[k] < lo: p[k] = 2*lo - p[k]; v[k] = -v[k]
            if p[k] > hi: p[k] = 2*hi - p[k]; v[k] = -v[k]
        if (i+1)%200==0: ref.append(p.copy())
    Pr = np.vstack([[-2.5,0.3,-0.6], ref])
    E0 = 0.5*(3.2**2+7.5**2+1.1**2)+g*(0.3-r)
    Es_rel = Es/E0; Ee_rel = Ee/E0
    R["01_cannonball"] = dict(dt=dt, frames=len(Ps), E0=E0, symplectic_E_rel_min=float(Es_rel.min()), symplectic_E_rel_max=float(Es_rel.max()),
        explicit_E_rel_final=float(Ee_rel[-1]), explicit_E_rel_max=float(Ee_rel.max()),
        symplectic_pos_err_vs_ref_final=float(np.linalg.norm(Ps[-1]-Pr[-1])), explicit_pos_err_vs_ref_final=float(np.linalg.norm(Pe[-1]-Pr[-1])),
        ref_substeps=200, note="reference = same scheme at dt/200, not analytic; chaotic after many bounces so late position error is bounded by box size")
    key = np.linspace(0,1,len(Ps))
    s = head("TMP 01 Cannonball: three integrators", "Symplectic vs explicit Euler vs fine reference, elastic box. Port of the idea of Ten Minute Physics 01.")
    s += clock(T)
    # box wireframe + floor
    bx = [(-L/2,0,-D/2),(L/2,0,-D/2),(L/2,0,D/2),(-L/2,0,D/2),(-L/2,0,-D/2),(-L/2,H,-D/2),(L/2,H,-D/2),(L/2,H,D/2),(-L/2,H,D/2),(-L/2,H,-D/2)]
    s += lines(bx,"0.45 0.5 0.6")+"\n"
    s += f"<Transform translation='0 -0.02 0'><Shape>{pm('0.08 0.09 0.12',0.6)}<Box size='{L} 0.04 {D}'/></Shape></Transform>\n"
    for name, P_, col, em in [("BALL_SYMP",Ps,"0.1 0.8 1.0","0.0 0.25 0.35"),("BALL_EXPL",Pe,"1.0 0.25 0.2","0.35 0.05 0.03"),("BALL_REF",Pr,"1 1 1","0.2 0.2 0.2")]:
        s += mover(name, T, key, P_, f"<Shape>{pm(col,0.2,0.0,em)}<Sphere radius='{r if name!='BALL_REF' else r*0.55}'/></Shape>")
        s += lines(P_[::3],{ 'BALL_SYMP':'0.1 0.8 1','BALL_EXPL':'1 0.3 0.2','BALL_REF':'0.9 0.9 0.9'}[name])+"\n"
    ch,(lo,hi) = chart([Es_rel,Ee_rel],["0.1 0.8 1","1 0.3 0.2"],(-3.0,H+0.5,-D/2),(6.0,1.6),ymin=min(Es_rel.min(),Ee_rel.min())-0.02,ymax=max(Es_rel.max(),Ee_rel.max())+0.02)
    s += "<!-- energy/E0 chart: cyan symplectic, red explicit -->\n"+ch+"\n"
    s += "<Viewpoint description='front' position='0 3.4 11.5' orientation='1 0 0 -0.1' fieldOfView='0.95'/>\n<Viewpoint description='top' position='0 8 0.1' orientation='1 0 0 -1.5'/>\n</Scene>\n</X3D>\n"
    (OUT/"01-cannonball.x3d").write_text(s)

# ---------- DEMO 03: billiards ----------
def billiards():
    T, hz = 14.0, 30; sub = 8; dt = 1/(hz*sub)
    W, Hh = 3.2, 1.6; r = 0.057*1.7  # exaggerated ball size for legibility
    pos = []; rowx = 0.8; d = 2*r*1.0001
    for row in range(5):
        for k in range(row+1):
            pos.append([rowx + row*d*math.sqrt(3)/2, (k - row/2)*d*1.001])
    pos = [[-0.9,0.02]] + pos
    p = np.array(pos); n = len(p); v = np.zeros((n,2)); v[0] = [6.0, 0.12]
    q = np.tile([0,0,0,1.0],(n,1))  # x,y,z,w quaternion
    mu = 0.35  # rolling decel m/s^2
    def run(fric, collect=True):
        nonlocal p, v, q
        p = np.array(pos); v = np.zeros((n,2)); v[0] = [6.0, 0.12]; q = np.tile([0,0,0,1.0],(n,1))
        TP=[]; TQ=[]; KE=[]; MOM=[]
        for i in range(int(T/dt)+1):
            if collect and i % sub == 0:
                TP.append(p.copy()); TQ.append(q.copy()); KE.append(0.5*(v**2).sum()); MOM.append(v.sum(0).copy())
            p = p + v*dt
            # walls
            for k in range(2):
                lim = (W/2 if k==0 else Hh/2) - r
                m1 = p[:,k] > lim; m2 = p[:,k] < -lim
                p[m1,k] = 2*lim - p[m1,k]; v[m1,k] *= -1
                p[m2,k] = -2*lim - p[m2,k]; v[m2,k] *= -1
            # pair collisions
            for _ in range(2):
                for a in range(n):
                    dd = p[a+1:] - p[a]; dist = np.linalg.norm(dd,axis=1)
                    for j in np.where(dist < 2*r)[0]:
                        b = a+1+j; nrm = dd[j]/max(dist[j],1e-9); pen = 2*r - dist[j]
                        p[a] -= nrm*pen/2; p[b] += nrm*pen/2
                        vn = (v[a]-v[b])@nrm
                        if vn < 0:  # approaching: equal-mass elastic = swap normal components
                            v[a] -= vn*nrm; v[b] += vn*nrm
            if fric:
                sp = np.linalg.norm(v,axis=1); dec = np.minimum(sp, mu*dt)
                v -= v/np.maximum(sp,1e-9)[:,None]*dec[:,None]
            # roll: omega = up x v / r  -> axis in xz plane (x=px, z=py of sim)
            for a in range(n):
                sp = np.linalg.norm(v[a])
                if sp > 1e-6:
                    ax = np.array([v[a][1], 0, -v[a][0]])/sp  # up(0,1,0) x (vx,0,vy) = (vy... ) sign: (0,1,0)x(vx,0,vz)=(vz,0,-vx)
                    ang = sp/r*dt; s_ = math.sin(ang/2)
                    dq = np.array([ax[0]*s_, ax[1]*s_, ax[2]*s_, math.cos(ang/2)])
                    x1,y1,z1,w1 = dq; x2,y2,z2,w2 = q[a]
                    q[a] = [w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2, w1*w2-x1*x2-y1*y2-z1*z2]
                    q[a] /= np.linalg.norm(q[a])
        return np.array(TP), np.array(TQ), np.array(KE), np.array(MOM)
    # conservation check, no friction
    P0,_,KE0,M0 = run(False)
    R["03_billiards_frictionless_check"] = dict(KE_rel_drift_max=float(np.abs(KE0/KE0[0]-1).max()), mom_x_drift_note="walls reflect momentum so only KE is conserved",
        KE0=float(KE0[0]))
    TP,TQ,KE,MOM = run(True)
    R["03_billiards"] = dict(balls=n, sim_hz=hz*sub, key_hz=hz, frames=len(TP), r=r, KE_start=float(KE[0]), KE_end=float(KE[-1]), rolling_decel=mu)
    key = np.linspace(0,1,len(TP))
    s = head("TMP 03 Billiards: elastic pairs, rolling spin", "15 balls plus cue, equal-mass elastic impulses, wall reflection, rolling friction. Idea of Ten Minute Physics 03.")
    s += clock(T)
    s += f"<Transform translation='0 -0.05 0'><Shape>{pm('0.02 0.35 0.18',0.9)}<Box size='{W+0.3} 0.1 {Hh+0.3}'/></Shape></Transform>\n"
    for sx,sz,sw,sd in [(0,-1,W+0.4,0.2),(0,1,W+0.4,0.2)]:
        s += f"<Transform translation='0 0.02 {sz*(Hh/2+0.2)}'><Shape>{pm('0.25 0.12 0.06',0.4)}<Box size='{sw} 0.16 {sd}'/></Shape></Transform>\n"
    for sx in (-1,1):
        s += f"<Transform translation='{sx*(W/2+0.2)} 0.02 0'><Shape>{pm('0.25 0.12 0.06',0.4)}<Box size='0.2 0.16 {Hh+0.6}'/></Shape></Transform>\n"
    cols = ["0.95 0.95 0.9","0.95 0.8 0.1","0.1 0.2 0.8","0.85 0.1 0.1","0.35 0.1 0.5","0.95 0.4 0.05","0.1 0.5 0.15","0.5 0.05 0.1","0.03 0.03 0.03","0.95 0.8 0.1","0.1 0.2 0.8","0.85 0.1 0.1","0.35 0.1 0.5","0.95 0.4 0.05","0.1 0.5 0.15","0.5 0.05 0.1"]
    for a in range(n):
        pts = np.stack([TP[:,a,0], np.full(len(TP), r), TP[:,a,1]],1)
        qs = TQ[:,a]; ang = 2*np.arccos(np.clip(qs[:,3],-1,1)); sn = np.sqrt(np.maximum(1-qs[:,3]**2,1e-12)); axs = qs[:,:3]/sn[:,None]
        ori = np.concatenate([axs, ang[:,None]],1)
        # stripe so spin is visible
        kid = f"<Shape>{pm(cols[a],0.12,0.0)}<Sphere radius='{r}'/></Shape><Transform translation='0 {r*0.985} 0' rotation='1 0 0 1.5708'><Shape>{pm('0.97 0.97 0.97',0.3)}<Cylinder radius='{r*0.3}' height='{r*0.06}'/></Shape></Transform>"
        s += mover(f"B{a}", T, key, pts, kid, ori=ori)
    ch,_ = chart([KE/KE[0]],["1 0.8 0.2"],(-1.6,0.25,-Hh/2-0.55),(3.2,0.5),ymin=0,ymax=1.0)
    s += "<!-- kinetic energy / KE0 chart (rolling friction removes it smoothly, collisions conserve it) -->\n"+ch+"\n"
    s += "<Viewpoint description='table' position='0 2.7 3.3' orientation='1 0 0 -0.72' fieldOfView='1.0'/>\n<Viewpoint description='top' position='0 3.6 0.01' orientation='1 0 0 -1.5708'/>\n</Scene>\n</X3D>\n"
    (OUT/"03-billiards.x3d").write_text(s)

# ---------- DEMO 05/06: bead on wire, XPBD substeps ----------
def bead():
    T, dt, g, Rw = 12.0, 1/30, 9.81, 1.0
    th0 = math.radians(80)
    x0 = np.array([Rw*math.sin(th0), -Rw*math.cos(th0)]); 
    def energy(x, v): return 0.5*v@v + g*(x[1]+Rw)
    def xpbd(nsub):
        x = x0.copy(); v = np.zeros(2); h = dt/nsub; P=[x.copy()]; E=[energy(x,v)]
        for i in range(int(T/dt)):
            for _ in range(nsub):
                xp = x.copy(); v = v + np.array([0,-g])*h; x = x + v*h
                d = np.linalg.norm(x); x = x - (d-Rw)*x/d   # project onto wire, compliance 0
                v = (x-xp)/h
            P.append(x.copy()); E.append(energy(x,v))
        return np.array(P), np.array(E)
    def ref():  # RK4 on the angle, tiny step
        th, w = th0, 0.0; h = dt/50; P=[x0.copy()]; E=[]
        f_ = lambda th,w: (w, -g/Rw*math.sin(th))
        for i in range(int(T/dt)):
            for _ in range(50):
                k1=f_(th,w); k2=f_(th+h/2*k1[0],w+h/2*k1[1]); k3=f_(th+h/2*k2[0],w+h/2*k2[1]); k4=f_(th+h*k3[0],w+h*k3[1])
                th += h/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]); w += h/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1])
            P.append([Rw*math.sin(th), -Rw*math.cos(th)])
        return np.array(P)
    Pref = ref()
    cfg = [(1,"1 0.3 0.2"),(5,"1 0.7 0.15"),(20,"0.3 0.9 0.4"),(100,"0.2 0.7 1")]
    runs = {k: xpbd(k) for k,_ in cfg}
    E0 = energy(x0, np.zeros(2))
    R["05_bead_xpbd"] = dict(dt=dt, T=T, wire_radius=Rw, theta0_deg=80, E0=E0,
        runs={str(k): dict(E_rel_final=float(runs[k][1][-1]/E0), E_rel_min=float(runs[k][1].min()/E0), E_rel_max=float(runs[k][1].max()/E0),
        constraint_drift_final=float(abs(np.linalg.norm(runs[k][0][-1])-Rw)), phase_err_final=float(np.linalg.norm(runs[k][0][-1]-Pref[-1]))) for k,_ in cfg},
        reference="RK4 on theta, dt/50")
    key = np.linspace(0,1,len(Pref))
    s = head("TMP 05 Bead on a wire: XPBD substeps", "Same bead, same big step 1/30 s, 1/5/20/100 XPBD substeps. Idea of Ten Minute Physics 05-06 and the Small Steps in Physics Simulation paper.")
    s += clock(T)
    sep = 2.6; xs = [-1.5*sep+i*sep for i in range(4)]
    for (k,col),xo in zip(cfg,xs):
        ring = [(xo+Rw*math.sin(a), 1.4-Rw*math.cos(a), 0) for a in np.linspace(0,2*math.pi,97)]
        s += lines(ring, "0.4 0.45 0.55")+"\n"
        P = np.array([[xo+x[0], 1.4+x[1], 0] for x in runs[k][0]])
        s += mover(f"BEAD{k}", T, key, P, f"<Shape>{pm(col,0.15,0.0,' '.join(f'{float(c)*0.35:.2f}' for c in col.split()))}<Sphere radius='0.09'/></Shape>")
        PR = np.array([[xo+x[0], 1.4+x[1], 0] for x in Pref])
        s += mover(f"REF{k}", T, key, PR, "<Shape><Appearance><Material emissiveColor='1 1 1' transparency='0.3'/></Appearance><Sphere radius='0.045'/></Shape>")
        s += f"<Transform translation='{xo-0.35} 2.75 0'><Shape><Appearance><Material emissiveColor='{col}'/></Appearance><Text string='\"substeps {k}\"'><FontStyle size='0.18' justify='\"MIDDLE\"'/></Text></Shape></Transform>\n" if False else ""
        # energy label bar: final E/E0 as a vertical bar
        e = runs[k][1][-1]/E0
        s += f"<Transform translation='{xo} 0.15 0' scale='1 {max(e,0.001)} 1'><Transform translation='0 0.2 0'><Shape>{pm(col,0.4)}<Box size='0.5 0.4 0.1'/></Shape></Transform></Transform>\n"
    ch,_ = chart([runs[k][1]/E0 for k,_ in cfg],[c for _,c in cfg],(-4.2,-1.4,0),(8.4,1.2),ymin=0,ymax=1.2)
    s += "<!-- E/E0 over 12 s for 1,5,20,100 substeps: red,orange,green,blue. Bars at bottom: final E/E0 -->\n"+ch+"\n"
    s += "<Viewpoint description='front' position='0 0.6 10' fieldOfView='0.85'/>\n</Scene>\n</X3D>\n"
    (OUT/"05-bead-xpbd.x3d").write_text(s)

cannon(); billiards(); bead()
(OUT/"numbers.json").write_text(json.dumps(R, indent=1))
print(json.dumps(R, indent=1))
