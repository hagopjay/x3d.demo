#!/usr/bin/env python3
"""PX4 ULog flight log -> X3D 4.0 scene + panel data. Standard library only (ulog.py beside this file).

  python3 -I build.py [file.ulg]   -> out/flight-scene.x3d, out/flight-panel.json, out/flight-report.json

Default log: downloads/px4-flight-review/4b7bf5df-6bdb-4815-be4c-070a3c520d60.ulg (PX4 Flight Review public log).

Frame
  X3D X = east, Y = up, Z = south, 1 unit = 1 m, origin = home_position (the take-off point).
  PX4 local NED (x north, y east, z down) maps as  X = y - home.y,  Y = home.z - z,  Z = -(x - home.x).
  Altitude is measured from home_position.z, not from the local origin: the EKF origin of a log can sit
  tens of metres above or below home (67.1 m above it in the default log).
Picture
  ground: actual path (vehicle_local_position) coloured by flight mode or by speed (Switch), its ground shadow,
          the position setpoint path (vehicle_local_position_setpoint) as a ghost with 1 s error whiskers,
          airframe glyphs every GLYPH_DT s posed by vehicle_attitude, event flags (log messages, mode changes),
          clickable samples every SAMPLE_DT s, finding markers.
  wall (north of home, facing south): X = log time; altitude above home (1:1 m), battery voltage, mode band,
          message / warning / dropout ticks.
Replay: one TimeSensor moves the airframe, its shadow, the chase camera rig and the wall playheads in log time.
"""
import hashlib, json, math, os, sys
from bisect import bisect_left, bisect_right

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ulog  # noqa: E402

SRC = os.path.join(HERE, "downloads", "px4-flight-review", "4b7bf5df-6bdb-4815-be4c-070a3c520d60.ulg")
OUT = os.path.join(HERE, "out")
TOPICS = {"vehicle_local_position", "vehicle_local_position_setpoint", "vehicle_attitude", "vehicle_status",
          "vehicle_land_detected", "battery_status", "home_position"}
LEAD, HOLD, SPEEDUP = 1.0, 3.0, 2.0          # replay: 1 s lead-in, 3 s hold at the end, log played at 2x
GLYPH_DT, SAMPLE_DT, KEY_DT, WHISKER_DT = 4.0, 2.0, 0.25, 1.0
SEVERITY = ["EMERG", "ALERT", "CRIT", "ERR", "WARNING", "NOTICE", "INFO", "DEBUG"]
WALL_Z, WALL_X0, WALL_W = -14.0, -100.0, 110.0
ALT_Y0, BAT_Y0, BAT_H, BAT_LO, BAT_HI = 0.0, 36.0, 12.0, 23.5, 25.0
MODE_Y0, LANE_Y0 = 50.0, 53.0
PAL = {"ink": "#e8edf3", "ink2": "#94a3b8", "ink3": "#334155", "grid": "#1e293b", "ghost": "#cbd5e1", "err": "#f87171",
       "warn": "#f2b84b", "ok": "#2dd4bf", "bat": "#a3e635", "alt": "#e8edf3", "play": "#fbbf24", "nose": "#f87171",
       "arm": "#e2e8f0", "drop": "#f87171", "gps": "#f2b84b"}
# vehicle_status.nav_state values (PX4 msg/VehicleStatus.msg); only the ones seen in a log are drawn
NAV = {0: ("Manual", "#f472b6"), 1: ("Altitude", "#c084fc"), 2: ("Position", "#e8edf3"), 3: ("Mission", "#2dd4bf"),
       4: ("Loiter", "#818cf8"), 5: ("Return (RTL)", "#fbbf24"), 10: ("Acro", "#fb7185"), 12: ("Descend", "#fca5a5"),
       13: ("Termination", "#ef4444"), 14: ("Offboard", "#38bdf8"), 15: ("Stabilized", "#f9a8d4"), 17: ("Takeoff", "#5eead4"),
       18: ("Land", "#fdba74"), 20: ("Precision land", "#fdba74"), 21: ("Orbit", "#a5b4fc")}
ARMING = {1: "standby (disarmed)", 2: "armed"}
SPEED_STOPS = [(0.0, "#1e3a8a"), (1.5, "#2563eb"), (3.0, "#2dd4bf"), (4.5, "#fbbf24"), (6.0, "#f87171")]


# ---- small helpers (same house style as capture-3d/build_mcap.py) -----------------------------------------
def rgbf(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def rgb(h):
    return "%.3f %.3f %.3f" % rgbf(h)


def f3(*v):
    return " ".join(("%.3f" % x).rstrip("0").rstrip(".") if abs(x) > 5e-4 else "0" for x in v)


def attr(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def mf(*lines):
    return attr(" ".join('"%s"' % str(s).replace("\\", "\\\\").replace('"', '\\"') for s in lines))


def rank(level):
    return SEVERITY.index(level) if level in SEVERITY else len(SEVERITY)


def finite(*v):
    return all(isinstance(x, (int, float)) and math.isfinite(x) for x in v)


def look_at(pos, target):
    dx, dy, dz = (target[i] - pos[i] for i in range(3))
    yaw, pitch = math.atan2(-dx, -dz), math.atan2(dy, math.hypot(dx, dz))
    x1, y1, z1, w1 = 0, math.sin(yaw / 2), 0, math.cos(yaw / 2)
    x2, y2, z2, w2 = math.sin(pitch / 2), 0, 0, math.cos(pitch / 2)
    q = (w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
         w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2)
    ang = 2 * math.acos(max(-1, min(1, q[3])))
    s = math.sqrt(max(1e-12, 1 - q[3] ** 2))
    return (q[0] / s, q[1] / s, q[2] / s, ang) if ang > 1e-6 else (0, 1, 0, 0)


def ramp(v, stops):
    if v <= stops[0][0]:
        return rgbf(stops[0][1])
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if v <= b:
            k = (v - a) / (b - a)
            A, B = rgbf(ca), rgbf(cb)
            return tuple(A[i] + (B[i] - A[i]) * k for i in range(3))
    return rgbf(stops[-1][1])


# ---- attitude -------------------------------------------------------------------------------------------
C = ((0, 1, 0), (0, 0, -1), (-1, 0, 0))       # NED -> X3D (east, up, south); det = +1


def quat_mat(q):
    w, x, y, z = q
    n = math.sqrt(w * w + x * x + y * y + z * z) or 1.0
    w, x, y, z = w / n, x / n, y / n, z / n
    return ((1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)),
            (2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)),
            (2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)))


def mm(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)) for i in range(3))


def tr(a):
    return tuple(tuple(a[j][i] for j in range(3)) for i in range(3))


def axis_angle(R):
    """Rotation matrix -> (x, y, z, angle) via quaternion (Shepperd)."""
    t = R[0][0] + R[1][1] + R[2][2]
    if t > 0:
        s = math.sqrt(t + 1) * 2
        w, x, y, z = s / 4, (R[2][1] - R[1][2]) / s, (R[0][2] - R[2][0]) / s, (R[1][0] - R[0][1]) / s
    elif R[0][0] > R[1][1] and R[0][0] > R[2][2]:
        s = math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2
        w, x, y, z = (R[2][1] - R[1][2]) / s, s / 4, (R[0][1] + R[1][0]) / s, (R[0][2] + R[2][0]) / s
    elif R[1][1] > R[2][2]:
        s = math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2
        w, x, y, z = (R[0][2] - R[2][0]) / s, (R[0][1] + R[1][0]) / s, s / 4, (R[1][2] + R[2][1]) / s
    else:
        s = math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2
        w, x, y, z = (R[1][0] - R[0][1]) / s, (R[0][2] + R[2][0]) / s, (R[1][2] + R[2][1]) / s, s / 4
    if w < 0:
        w, x, y, z = -w, -x, -y, -z
    ang = 2 * math.acos(max(-1.0, min(1.0, w)))
    s = math.sqrt(max(1e-12, 1 - w * w))
    return (x / s, y / s, z / s, ang) if ang > 1e-6 else (0, 1, 0, 0)


def x3d_rot(q):
    """vehicle_attitude.q (FRD body -> NED, [w x y z]) -> X3D axis-angle for a glyph modelled nose -Z, up +Y."""
    return axis_angle(mm(mm(C, quat_mat(q)), tr(C)))


def euler_deg(q):
    w, x, y, z = q
    roll = math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
    pitch = math.asin(max(-1, min(1, 2 * (w * y - z * x))))
    yaw = math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    return tuple(math.degrees(a) for a in (roll, pitch, yaw))


# ---- analysis -------------------------------------------------------------------------------------------
def analyse(path):
    raw = open(path, "rb").read()
    U = ulog.ULog(path, TOPICS)
    t0 = U.start_us
    T = lambda r: (r["timestamp"] - t0) / 1e6
    home = U.topic("home_position")
    if not home:
        raise SystemExit("no home_position in log")
    H = home[-1]
    hx, hy, hz = H["x"], H["y"], H["z"]
    P = lambda x, y, z: (y - hy, hz - z, -(x - hx))

    lp = [r for r in U.topic("vehicle_local_position") if r.get("xy_valid") and r.get("z_valid") and finite(r["x"], r["y"], r["z"])]
    pts = [{"t": T(r), "p": P(r["x"], r["y"], r["z"]), "v": (r["vx"], r["vy"], r["vz"]),
            "spd": math.sqrt(r["vx"] ** 2 + r["vy"] ** 2 + r["vz"] ** 2), "hspd": math.hypot(r["vx"], r["vy"]), "raw_z": r["z"]} for r in lp]
    times = [p["t"] for p in pts]
    dur = times[-1]

    def at(t):
        i = max(0, min(len(pts) - 1, bisect_left(times, t)))
        if i > 0 and abs(times[i - 1] - t) < abs(times[i] - t):
            i -= 1
        return pts[i]

    def interp(t):
        i = bisect_right(times, t)
        if i <= 0:
            return pts[0]["p"]
        if i >= len(pts):
            return pts[-1]["p"]
        a, b = pts[i - 1], pts[i]
        k = (t - a["t"]) / ((b["t"] - a["t"]) or 1)
        return tuple(a["p"][j] + (b["p"][j] - a["p"][j]) * k for j in range(3))

    # flight modes and arming (step functions)
    modes, arm = [], []
    for r in U.topic("vehicle_status"):
        if not modes or modes[-1][1] != r["nav_state"]:
            modes.append((max(0.0, T(r)), r["nav_state"]))
        if not arm or arm[-1][1] != r["arming_state"]:
            arm.append((T(r), r["arming_state"]))
    mode_t = [m[0] for m in modes]
    mode_at = lambda t: modes[max(0, bisect_right(mode_t, t) - 1)][1]
    segs = [{"t0": m[0], "t1": (modes[i + 1][0] if i + 1 < len(modes) else dur), "nav": m[1], "name": NAV.get(m[1], ("nav_state %d" % m[1], "#94a3b8"))[0]}
            for i, m in enumerate(modes)]

    land = []
    for r in U.topic("vehicle_land_detected"):
        if not land or land[-1][1] != r["landed"]:
            land.append((T(r), r["landed"]))
    takeoff = next((t for t, l in land if not l), 0.0)
    touchdown = next((t for t, l in land if l and t > takeoff), dur)

    # attitude
    att = [(T(r), r["q"]) for r in U.topic("vehicle_attitude") if finite(*r["q"])]
    att_t = [a[0] for a in att]

    def q_at(t):
        i = max(0, min(len(att) - 1, bisect_left(att_t, t)))
        return att[i][1]

    # setpoints
    sp = []
    for r in U.topic("vehicle_local_position_setpoint"):
        if finite(r["x"], r["y"], r["z"]):
            sp.append({"t": T(r), "p": P(r["x"], r["y"], r["z"])})
    err = []
    for s in sp:
        if not takeoff <= s["t"] <= touchdown:
            continue
        a = at(s["t"])
        if abs(a["t"] - s["t"]) > 0.15:
            continue
        d = [a["p"][i] - s["p"][i] for i in range(3)]
        err.append({"t": s["t"], "e3": math.sqrt(sum(x * x for x in d)), "eh": math.hypot(d[0], d[2]), "ev": abs(d[1]),
                    "act": a["p"], "sp": s["p"], "nav": mode_at(s["t"])})

    # battery
    bat = [{"t": T(r), "v": r["voltage_v"], "a": r["current_a"], "rem": r["remaining"], "mah": r["discharged_mah"]}
           for r in U.topic("battery_status") if finite(r["voltage_v"]) and r["voltage_v"] > 1]

    # log messages: split the repeated RTK-correction warning from the rest
    logs = [{"t": (ts - t0) / 1e6, "level": lvl, "text": txt.strip()} for ts, lvl, txt, _tag in U.logs]
    gps = [m for m in logs if "gps_inject_data lost" in m["text"]]
    msgs = [m for m in logs if m not in gps and not m["text"].startswith("[logger]")]
    drops = [{"t": (ts - t0) / 1e6, "ms": ms} for ts, ms in U.dropouts]

    return {"U": U, "raw_sha": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "path": path, "home": H, "pts": pts,
            "dur": dur, "at": at, "interp": interp, "modes": modes, "segs": segs, "mode_at": mode_at, "arm": arm, "land": land,
            "takeoff": takeoff, "touchdown": touchdown, "att": att, "q_at": q_at, "sp": sp, "err": err, "bat": bat,
            "logs": logs, "gps": gps, "msgs": msgs, "drops": drops, "lp_n": len(lp), "lp_all": len(U.topic("vehicle_local_position"))}


def findings(A):
    pts, H, F = A["pts"], A["home"], []
    air = [p for p in pts if A["takeoff"] <= p["t"] <= A["touchdown"]]
    top = max(air, key=lambda p: p["p"][1])
    F.append({"id": "F_alt", "level": "info", "at": top["t"], "pos": top["p"],
              "text": "Max altitude %.1f m above home at t = %.1f s (%s)." % (top["p"][1], top["t"], NAV.get(A["mode_at"](top["t"]), ("?",))[0]),
              "evidence": "home_position.z %.2f - vehicle_local_position.z %.2f (NED, z down). The navigator logged 'RTL: start return at 895 m (30 m above destination)'." % (H["z"], top["raw_z"])
              if any("30 m above" in m["text"] for m in A["msgs"]) else "home_position.z %.2f - vehicle_local_position.z %.2f" % (H["z"], top["raw_z"])})
    off = H["z"]
    if abs(off) > 2:
        F.append({"id": "F_origin", "level": "warn", "at": 0.0, "pos": (0, 0, 0),
                  "text": "The EKF local origin is %.1f m %s home, so -z alone would show a %.0f m climb that never happened. All heights here are home-relative." % (abs(off), "above" if off > 0 else "below", abs(off)),
                  "evidence": "home_position.z = %.2f m; vehicle_local_position.ref_alt %.1f m vs home_position.alt %.1f m (difference %.1f m)." % (
                      off, A["U"].topic("vehicle_local_position")[0]["ref_alt"], H["alt"], A["U"].topic("vehicle_local_position")[0]["ref_alt"] - H["alt"])})
    d3 = sum(math.dist(a["p"], b["p"]) for a, b in zip(air, air[1:]))
    dh = sum(math.hypot(b["p"][0] - a["p"][0], b["p"][2] - a["p"][2]) for a, b in zip(air, air[1:]))
    far = max(air, key=lambda p: math.hypot(p["p"][0], p["p"][2]))
    F.append({"id": "F_dist", "level": "info", "at": far["t"], "pos": far["p"],
              "text": "Flew %.0f m (%.0f m horizontal) between take-off and touch-down; farthest point %.1f m from home at t = %.1f s." % (d3, dh, math.hypot(far["p"][0], far["p"][2]), far["t"]),
              "evidence": "sum of straight segments between %d vehicle_local_position samples (%.1f Hz) from vehicle_land_detected take-off %.2f s to landed %.2f s." % (
                  len(air), (len(air) - 1) / max(1e-6, air[-1]["t"] - air[0]["t"]), A["takeoff"], A["touchdown"])})
    fast = max(air, key=lambda p: p["spd"])
    F.append({"id": "F_speed", "level": "info", "at": fast["t"], "pos": fast["p"],
              "text": "Max speed %.2f m/s (horizontal max %.2f m/s) at t = %.1f s in %s." % (fast["spd"], max(p["hspd"] for p in air), fast["t"], NAV.get(A["mode_at"](fast["t"]), ("?",))[0]),
              "evidence": "|(vx, vy, vz)| of vehicle_local_position; vx %.2f, vy %.2f, vz %.2f m/s at that sample." % fast["v"]})
    E = A["err"]
    if E:
        auto = [e for e in E if e["nav"] in (3, 4, 5)]
        base = auto or E
        worst = max(base, key=lambda e: e["e3"])
        rms = math.sqrt(sum(e["e3"] ** 2 for e in base) / len(base))
        F.append({"id": "F_track", "level": "warn" if worst["e3"] > 3 else "ok", "at": worst["t"], "pos": worst["act"],
                  "text": "Tracking error in auto modes: RMS %.2f m, worst %.2f m (%.2f m horizontal, %.2f m vertical) at t = %.1f s in %s." % (
                      rms, worst["e3"], worst["eh"], worst["ev"], worst["t"], NAV.get(worst["nav"], ("?",))[0]),
                  "evidence": "vehicle_local_position_setpoint (the smoothed trajectory the controller tracks, not the straight waypoint line) vs nearest vehicle_local_position (within 0.15 s); %d airborne pairs in Mission/Loiter/RTL. In Position mode the z setpoint is NaN (velocity control), so those samples are skipped." % len(base)})
    B = A["bat"]
    if B:
        vmin = min(B, key=lambda b: b["v"])
        nocur = all(abs(b["a"]) < 0.05 for b in B)
        F.append({"id": "F_battery", "level": "warn" if nocur else "info", "at": vmin["t"], "pos": A["interp"](vmin["t"]),
                  "text": "Battery sagged %.2f V under load: %.2f V at the start, %.2f V minimum at t = %.1f s, %.2f V at the end after disarm (rebound). Remaining estimate %.0f %% to %.0f %%.%s" % (
                      B[0]["v"] - vmin["v"], B[0]["v"], vmin["v"], vmin["t"], B[-1]["v"], B[0]["rem"] * 100, B[-1]["rem"] * 100,
                      " Current reads 0 A throughout, so the estimate is voltage-only and discharged mAh is not meaningful." if nocur else ""),
                  "evidence": "battery_status.voltage_v / remaining / current_a, %d samples; discharged_mah %.1f to %.1f." % (len(B), B[0]["mah"], B[-1]["mah"])})
    lv = {}
    for m in A["logs"]:
        lv[m["level"]] = lv.get(m["level"], 0) + 1
    if A["gps"]:
        g = A["gps"]
        F.append({"id": "F_gps", "level": "warn", "at": g[0]["t"], "pos": A["interp"](g[0]["t"]),
                  "text": "%d 'gps_inject_data lost' warnings from %.1f s to %.1f s (about one a second): the RTK correction stream to the GPS was dropping packets for the whole flight." % (len(g), g[0]["t"], g[-1]["t"]),
                  "evidence": "ULog 'L' logged strings at level WARNING from [gps]; all log levels: %s." % ", ".join("%s %d" % kv for kv in sorted(lv.items()))})
    kill = next((m for m in A["msgs"] if "Kill engaged" in m["text"]), None)
    if kill:
        p = A["at"](kill["t"])
        F.append({"id": "F_kill", "level": "warn", "at": kill["t"], "pos": p["p"],
                  "text": "Kill switch engaged at t = %.1f s with the vehicle already on the ground (%.2f m above home, %.2f m/s) after the pilot took over in Position mode: motors were stopped by the kill switch, not a normal disarm; landed was detected %.1f s later." % (
                      kill["t"], p["p"][1], p["spd"], A["touchdown"] - kill["t"]),
                  "evidence": "logged '%s' (%s) and vehicle_local_position at %.2f s; vehicle_land_detected.landed at %.2f s." % (kill["text"], kill["level"], p["t"], A["touchdown"])})
    if A["drops"]:
        big = max(A["drops"], key=lambda d: d["ms"])
        F.append({"id": "F_drop", "level": "warn" if big["ms"] > 500 else "info", "at": big["t"], "pos": A["interp"](big["t"]),
                  "text": "%d logger dropouts, %d ms in total; the largest (%d ms) after t = %.1f s." % (len(A["drops"]), sum(d["ms"] for d in A["drops"]), big["ms"], big["t"]),
                  "evidence": "ULog 'O' dropout messages; time is the last data timestamp before each."})
    return F


# ---- scene ----------------------------------------------------------------------------------------------
def build(path=SRC):
    A = analyse(path)
    U, pts, dur = A["U"], A["pts"], A["dur"]
    play = dur / SPEEDUP
    CYCLE = LEAD + play + HOLD
    frac = lambda t: (LEAD + (t / dur) * play) / CYCLE
    xw = lambda t: WALL_X0 + WALL_W * t / dur
    by = lambda v: BAT_Y0 + BAT_H * (min(BAT_HI, max(BAT_LO, v)) - BAT_LO) / (BAT_HI - BAT_LO)
    navname = lambda n: NAV.get(n, ("nav_state %d" % n, "#94a3b8"))[0]
    navcol = lambda n: NAV.get(n, ("", "#94a3b8"))[1]
    F = findings(A)
    items, parts, routes, interps = {}, [], [], []

    def unlit(col, tr_=0.0):
        return '<Appearance><Material diffuseColor="0 0 0" emissiveColor="%s"%s/></Appearance>' % (rgb(col), ' transparency="%.2f"' % tr_ if tr_ else "")

    def lit(col, tr_=0.0):
        return '<Appearance><Material diffuseColor="%s" emissiveColor="%s"%s/></Appearance>' % (rgb(col), f3(*(c * 0.25 for c in rgbf(col))), ' transparency="%.2f"' % tr_ if tr_ else "")

    def text(pos, lines, size=1.6, col=PAL["ink"], justify="BEGIN", bill=False, minor="FIRST"):
        s = '<Shape>%s<Text string="%s"><FontStyle family=\'"SANS"\' size="%.2f" justify=\'"%s" "%s"\'/></Text></Shape>' % (unlit(col), mf(*lines), size, justify, minor)
        if bill:
            s = '<Billboard axisOfRotation="0 0 0">%s</Billboard>' % s
        return '<Transform translation="%s">%s</Transform>' % (f3(*pos), s)

    def lines(segs, col, tr_=0.0, colors=None, width=None):
        segs = [s for s in segs if len(s) >= 2]
        if not segs:
            return ""
        cn = ('<Color color="%s"/>' % " ".join(f3(*c) for s in colors for c in s)) if colors else ""
        lpn = '<LineProperties linewidthScaleFactor="%.1f"/>' % width if width else ""
        app = unlit(col, tr_).replace("</Appearance>", lpn + "</Appearance>")
        return '<Shape>%s<LineSet vertexCount="%s"><Coordinate point="%s"/>%s</LineSet></Shape>' % (
            app, " ".join(str(len(s)) for s in segs), " ".join(f3(*p) for s in segs for p in s), cn)

    def clickable(name, desc, inner, kind, title, body):
        items[name] = {"kind": kind, "title": title, "body": body}
        return '<Group><TouchSensor DEF="%s" description="%s"/>%s</Group>' % (name, attr(desc), inner)

    def route(a, af, b, bf):
        routes.append('<ROUTE fromNode="%s" fromField="%s" toNode="%s" toField="%s"/>' % (a, af, b, bf))

    def sample_body(p, extra=None):
        t = p["t"]
        bat = min(A["bat"], key=lambda b: abs(b["t"] - t)) if A["bat"] else None
        q = A["q_at"](t)
        r, pi, y = euler_deg(q)
        e = min(A["err"], key=lambda e: abs(e["t"] - t)) if A["err"] else None
        body = {"log time": "%.2f s (vehicle_local_position)" % t, "flight mode": "%s (vehicle_status.nav_state %d)" % (navname(A["mode_at"](t)), A["mode_at"](t)),
                "altitude above home": "%.2f m" % p["p"][1], "east / south of home": "%.1f m / %.1f m" % (p["p"][0], p["p"][2]),
                "speed": "%.2f m/s (horizontal %.2f)" % (p["spd"], p["hspd"]), "vertical speed": "%.2f m/s up" % -p["v"][2],
                "attitude": "roll %.1f, pitch %.1f, yaw %.1f deg (vehicle_attitude.q)" % (r, pi, y)}
        if e and abs(e["t"] - t) < 0.3:
            body["setpoint error"] = "%.2f m (h %.2f, v %.2f) vs vehicle_local_position_setpoint" % (e["e3"], e["eh"], e["ev"])
        if bat:
            body["battery"] = "%.2f V, remaining %.0f %% (battery_status at %.1f s)" % (bat["v"], bat["rem"] * 100, bat["t"])
        body.update(extra or {})
        return body

    # ---- ground grid and home -------------------------------------------------------------------
    xs = [p["p"][0] for p in pts] + [p["p"][0] for p in A["sp"]]
    zs = [p["p"][2] for p in pts] + [p["p"][2] for p in A["sp"]]
    gx0, gx1 = math.floor((min(xs) - 10) / 10) * 10, math.ceil((max(xs) + 10) / 10) * 10
    gz0, gz1 = math.floor((min(zs) - 10) / 10) * 10, math.ceil((max(zs) + 10) / 10) * 10
    grid = [[(x, 0, gz0), (x, 0, gz1)] for x in range(int(gx0), int(gx1) + 1, 10)] + [[(gx0, 0, z), (gx1, 0, z)] for z in range(int(gz0), int(gz1) + 1, 10)]
    parts.append('<Transform DEF="Ground" translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (
        f3((gx0 + gx1) / 2, -0.06, (gz0 + gz1) / 2), lit("#0b1220"), f3(gx1 - gx0, 0.1, gz1 - gz0)))
    parts.append(lines(grid, PAL["grid"]))
    parts.append(text((gx1 - 1, 0.05, gz1 - 1), ["10 m grid"], 1.4, PAL["ink2"], "END"))
    # north marker (X_ITE's font has no arrow glyphs: a cone and a letter)
    parts.append('<Transform translation="%s" rotation="1 0 0 -1.5708"><Shape>%s<Cone bottomRadius="1.2" height="3"/></Shape></Transform>' % (f3(gx0 + 4, 0.3, gz0 + 6), unlit(PAL["ink2"])))
    parts.append(text((gx0 + 4, 2.2, gz0 + 3.5), ["N"], 2.2, PAL["ink2"], "MIDDLE", bill=True))
    home_body = {"position": "home_position (x %.2f, y %.2f, z %.2f m local NED)" % (A["home"]["x"], A["home"]["y"], A["home"]["z"]),
                 "home altitude (AMSL)": "%.1f m (home_position.alt)" % A["home"]["alt"],
                 "EKF origin altitude": "%.1f m (vehicle_local_position.ref_alt)" % U.topic("vehicle_local_position")[0]["ref_alt"],
                 "note": "latitude and longitude are in the log but not shown in this scene."}
    parts.append(clickable("T_home", "home (take-off point)", '<Transform translation="0 0.05 0"><Shape>%s<Cylinder radius="1.6" height="0.1"/></Shape></Transform>%s' % (
        unlit(PAL["ok"], 0.3), text((0, 0.2, 2.6), ["H"], 2.2, PAL["ok"], "MIDDLE")), "place", "Home", home_body))

    # ---- actual path: by mode / by speed (Switch) --------------------------------------------------
    P = [p["p"] for p in pts]
    mode_cols = [rgbf(navcol(A["mode_at"](p["t"]))) for p in pts]
    speed_cols = [ramp(p["spd"], SPEED_STOPS) for p in pts]
    parts.append('<Switch DEF="PathColour" whichChoice="0">%s%s</Switch>' % (
        '<Group>%s</Group>' % lines([P], PAL["ink"], colors=[mode_cols], width=3),
        '<Group>%s</Group>' % lines([P], PAL["ink"], colors=[speed_cols], width=3)))
    parts.append(lines([[(x, 0.02, z) for x, _y, z in P]], PAL["ink3"]))          # ground shadow
    drops = [[(p["p"][0], 0.02, p["p"][2]), p["p"]] for p in pts[::50]]
    parts.append(lines(drops, PAL["ink3"]))

    # ---- setpoint ghost + error whiskers -------------------------------------------------------------
    ghost, run = [], []
    for a, b in zip(A["sp"], A["sp"][1:]):
        run.append(a["p"])
        if b["t"] - a["t"] > 0.5:                 # NaN gap (velocity control) breaks the ghost line
            ghost.append(run)
            run = []
    if A["sp"]:
        run.append(A["sp"][-1]["p"])
        ghost.append(run)
    parts.append(lines(ghost, PAL["ghost"], 0.45, width=2))
    wh, last = [], -9
    for e in A["err"]:
        if e["t"] - last >= WHISKER_DT and e["e3"] > 0.3:
            wh.append([e["act"], e["sp"]])
            last = e["t"]
    parts.append(lines(wh, PAL["err"], 0.2))

    # ---- airframe glyph (DEF once, USE everywhere) -------------------------------------------------------
    glyph = ('<Group DEF="Airframe"><Transform rotation="0 1 0 0.7854"><Shape DEF="ArmShape">%s<Box size="1.5 0.08 0.1"/></Shape>'
             '<Transform rotation="0 1 0 1.5708"><Shape USE="ArmShape"/></Transform></Transform>'
             '<Shape>%s<Box size="0.35 0.18 0.35"/></Shape>'
             '<Transform translation="0 0 -0.55" rotation="1 0 0 -1.5708"><Shape>%s<Cone bottomRadius="0.14" height="0.45"/></Shape></Transform>'
             '<Transform translation="0 0.14 0"><Shape>%s<Cylinder radius="0.02" height="0.28"/></Shape></Transform></Group>') % (
        lit(PAL["arm"]), lit("#475569"), unlit(PAL["nose"]), unlit(PAL["ok"]))
    first_glyph = True
    t = math.ceil(A["takeoff"] / GLYPH_DT) * GLYPH_DT
    gi = 0
    while t <= A["touchdown"]:
        p = A["at"](t)
        q = A["q_at"](t)
        inner = '<Transform translation="%s" rotation="%s" scale="1.6 1.6 1.6">%s</Transform>' % (
            f3(*p["p"]), f3(*x3d_rot(q)), glyph if first_glyph else '<Group USE="Airframe"/>')
        first_glyph = False
        r, pi, y = euler_deg(q)
        parts.append(clickable("G_%d" % gi, "attitude at %.0f s" % p["t"], inner, "attitude glyph", "Attitude at t = %.1f s" % p["t"],
                               sample_body(p, {"glyph": "nose cone = forward, mast = body up; arms 2.4 m, about 5x a 0.5 m quad"})))
        gi += 1
        t += GLYPH_DT

    # ---- clickable samples -------------------------------------------------------------------------
    t, si = 0.0, 0
    sam = []
    while t <= dur:
        p = A["at"](t)
        sam.append(clickable("S_%d" % si, "sample %.0f s, %s, %.1f m" % (p["t"], navname(A["mode_at"](p["t"])), p["p"][1]),
                             '<Transform translation="%s"><Shape>%s<Sphere radius="0.32"/></Shape></Transform>' % (f3(*p["p"]), lit(navcol(A["mode_at"](p["t"])))),
                             "path sample", "t = %.1f s" % p["t"], sample_body(p)))
        si += 1
        t += SAMPLE_DT
    parts.append('<Group DEF="Samples">%s</Group>' % "".join(sam))

    # ---- events along the path (log messages merged within 1 s, plus mode changes) ------------------------
    ev = []
    for m in A["msgs"]:
        if ev and m["t"] - ev[-1]["t1"] < 1.0:
            ev[-1]["msgs"].append(m)
            ev[-1]["t1"] = m["t"]
        else:
            ev.append({"t": m["t"], "t1": m["t"], "msgs": [m]})
    for e in ev:
        e["t_pos"] = min(dur, max(0.0, e["t"]))
    placed = []
    for ei, e in enumerate(ev):
        p = A["interp"](e["t_pos"])
        k = sum(1 for q in placed if math.hypot(q[0] - p[0], q[2] - p[2]) < 10 and abs(q[1] - p[1]) < 8)
        placed.append(p)
        worst = min(e["msgs"], key=lambda m: rank(m["level"]))
        col = PAL["err"] if worst["level"] in ("EMERG", "ALERT", "CRIT", "ERR") else PAL["warn"] if worst["level"] == "WARNING" else "#c4b5fd"
        top = (p[0], p[1] + 3 + 2.4 * k, p[2])
        label = e["msgs"][0]["text"].split("] ", 1)[-1][:34]       # first message names the event; colour = worst level
        inner = (lines([[p, top]], col) + '<Transform translation="%s"><Shape>%s<Sphere radius="0.45"/></Shape></Transform>' % (f3(*top), unlit(col))
                 + text((top[0] + 0.8, top[1] - 0.4, top[2]), ["%.1f s  %s%s" % (e["t"], label, "  +%d" % (len(e["msgs"]) - 1) if len(e["msgs"]) > 1 else "")], 1.3, col, bill=True))
        body = {"log time": "%.3f s" % e["t"], "position": "%.1f m above home (vehicle_local_position at that time)" % p[1]}
        for j, m in enumerate(e["msgs"]):
            body["%.3f s %s" % (m["t"], m["level"])] = m["text"]
        e["name"] = "E_%d" % ei
        parts.append(clickable(e["name"], "%.1f s %s" % (e["t"], label), inner, "logged message", label, body))

    # ---- finding markers -------------------------------------------------------------------------------
    for f in F:
        if f["id"] in ("F_origin",):
            continue
        p = f["pos"]
        col = PAL["warn"] if f["level"] == "warn" else PAL["ok"] if f["level"] == "ok" else "#818cf8"
        inner = '<Transform translation="%s"><Shape>%s<Sphere radius="0.9"/></Shape></Transform>' % (f3(*p), unlit(col, 0.55))
        parts.append(clickable(f["id"], f["text"][:60], inner, "finding", f["text"], {"evidence": f["evidence"], "log time": "%.2f s" % f["at"]}))

    # ---- the wall: time series --------------------------------------------------------------------------
    W = []
    W.append('<Transform translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (f3(WALL_X0 + WALL_W / 2, (LANE_Y0 + 4) / 2 - 1, WALL_Z - 0.3), lit("#0b1220"), f3(WALL_W + 8, LANE_Y0 + 6, 0.2)))
    z = WALL_Z
    W.append(lines([[(WALL_X0, y, z), (WALL_X0 + WALL_W, y, z)] for y in (0, 10, 20, 30)], PAL["grid"]))
    W.append(lines([[(WALL_X0, by(v), z), (WALL_X0 + WALL_W, by(v), z)] for v in (23.5, 24.0, 24.5, 25.0)], PAL["grid"]))
    for y in (0, 10, 20, 30):
        W.append(text((WALL_X0 - 1, y - 0.5, z), ["%d m" % y], 1.3, PAL["ink2"], "END"))
    for v in (23.5, 24.0, 24.5, 25.0):
        W.append(text((WALL_X0 - 1, by(v) - 0.5, z), ["%.1f V" % v], 1.3, PAL["bat"], "END"))
    W.append(text((WALL_X0, 31.5, z), ["altitude above home (vehicle_local_position, 1:1 m)"], 1.5, PAL["alt"]))
    W.append(text((WALL_X0, BAT_Y0 + BAT_H + 0.6, z), ["battery voltage (battery_status.voltage_v)"], 1.5, PAL["bat"]))
    for s in range(0, int(dur) + 1, 20):
        W.append(lines([[(xw(s), -1.2, z), (xw(s), 0, z)]], PAL["ink2"]))
        W.append(text((xw(s), -3.0, z), ["%d s" % s], 1.3, PAL["ink2"], "MIDDLE"))
    W.append(text((WALL_X0 + WALL_W, -3.0, z), ["log time"], 1.3, PAL["ink2"], "END"))
    alt = [(xw(p["t"]), max(0.0, p["p"][1]), z + 0.05) for p in pts]
    W.append(lines([alt], PAL["alt"], width=2))
    W.append(lines([[(xw(b["t"]), by(b["v"]), z + 0.05) for b in A["bat"]]], PAL["bat"], width=2))
    for sgm in A["segs"]:
        x0, x1 = xw(sgm["t0"]), xw(sgm["t1"])
        W.append('<Transform translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (f3((x0 + x1) / 2, MODE_Y0 + 0.6, z), unlit(navcol(sgm["nav"])), f3(max(0.05, x1 - x0), 1.2, 0.1)))
        if x1 - x0 > 8:
            W.append(text(((x0 + x1) / 2, MODE_Y0 + 1.6, z), [sgm["name"]], 1.3, navcol(sgm["nav"]), "MIDDLE"))
    W.append(text((WALL_X0 - 1, MODE_Y0 + 0.2, z), ["mode"], 1.3, PAL["ink2"], "END"))
    W.append(lines([[(xw(g["t"]), LANE_Y0, z), (xw(g["t"]), LANE_Y0 + 1.0, z)] for g in A["gps"]], PAL["gps"]))
    W.append(text((WALL_X0 - 1, LANE_Y0, z), ["gps inject lost"], 1.2, PAL["gps"], "END"))
    for d in A["drops"]:
        W.append('<Transform translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (f3(xw(d["t"]) + WALL_W * d["ms"] / 1000 / dur / 2, LANE_Y0 + 2.0, z), unlit(PAL["drop"]), f3(max(0.15, WALL_W * d["ms"] / 1000 / dur), 0.8, 0.1)))
    W.append(text((WALL_X0 - 1, LANE_Y0 + 1.6, z), ["log dropouts"], 1.2, PAL["drop"], "END"))
    for e in ev:
        col = PAL["err"] if any(m["level"] in ("ERR", "CRIT") for m in e["msgs"]) else PAL["warn"] if any(m["level"] == "WARNING" for m in e["msgs"]) else "#c4b5fd"
        W.append(lines([[(xw(e["t_pos"]), 0, z + 0.06), (xw(e["t_pos"]), LANE_Y0 + 3.2, z + 0.06)]], col, 0.55))
    parts.append(clickable("T_wall", "time-series wall", "".join(W), "wall", "Time-series wall", {
        "X": "log time, %.1f s over %.0f m" % (dur, WALL_W), "altitude": "vehicle_local_position, home-relative, 1:1 m",
        "battery": "battery_status.voltage_v, %.1f V to %.1f V over %.0f m" % (BAT_LO, BAT_HI, BAT_H),
        "mode band": "vehicle_status.nav_state", "gps lane": "%d 'gps_inject_data lost' warnings" % len(A["gps"]),
        "dropout lane": "%d ULog dropouts, box width = duration" % len(A["drops"]), "vertical lines": "logged messages (see the flags on the path)"}))

    # ---- replay: airframe, shadow, chase rig, wall playheads ---------------------------------------------
    keys, kpos, krot, kalt, kbat = [], [], [], [], []
    t = 0.0
    while t <= dur + 1e-9:
        keys.append(frac(t))
        p = A["interp"](t)
        kpos.append(p)
        krot.append(x3d_rot(A["q_at"](t)))
        kalt.append((xw(t), max(0.0, p[1]), WALL_Z + 0.25))
        b = min(A["bat"], key=lambda b: abs(b["t"] - t)) if A["bat"] else {"v": BAT_LO}
        kbat.append((xw(t), by(b["v"]), WALL_Z + 0.25))
        t += KEY_DT
    K = " ".join("%.5f" % k for k in keys)
    parts.append('<TimeSensor DEF="Replay" cycleInterval="%.3f" loop="true"/>' % CYCLE)
    parts.append('<PositionInterpolator DEF="I_pos" key="%s" keyValue="%s"/>' % (K, " ".join(f3(*p) for p in kpos)))
    parts.append('<OrientationInterpolator DEF="I_rot" key="%s" keyValue="%s"/>' % (K, " ".join(f3(*r) for r in krot)))
    parts.append('<PositionInterpolator DEF="I_shadow" key="%s" keyValue="%s"/>' % (K, " ".join(f3(p[0], 0.06, p[2]) for p in kpos)))
    parts.append('<PositionInterpolator DEF="I_alt" key="%s" keyValue="%s"/>' % (K, " ".join(f3(*p) for p in kalt)))
    parts.append('<PositionInterpolator DEF="I_bat" key="%s" keyValue="%s"/>' % (K, " ".join(f3(*p) for p in kbat)))
    parts.append('<PositionInterpolator DEF="I_head" key="%s" keyValue="%s"/>' % (f3(frac(0), frac(dur)), f3(xw(0), (LANE_Y0 + 3) / 2, WALL_Z + 0.2, xw(dur), (LANE_Y0 + 3) / 2, WALL_Z + 0.2)))
    parts.append('<Transform DEF="Vehicle" translation="%s" scale="1.6 1.6 1.6"><Group USE="Airframe"/>'
                 '<Shape>%s<Sphere radius="1.1"/></Shape></Transform>' % (f3(*kpos[-1]), unlit(PAL["play"], 0.75)))
    parts.append('<Transform DEF="Shadow" translation="%s"><Shape>%s<Cylinder radius="1.2" height="0.04"/></Shape></Transform>' % (f3(kpos[-1][0], 0.06, kpos[-1][2]), unlit(PAL["play"], 0.5)))
    chase_off = (14, 8, -14)
    parts.append('<Transform DEF="ChaseRig" translation="%s"><Viewpoint DEF="VP_chase" description="chase (follows the airframe, fixed north-east offset)" position="%s" orientation="%s" centerOfRotation="0 0 0"/></Transform>' % (
        f3(*kpos[-1]), f3(*chase_off), f3(*look_at(chase_off, (0, 0, 0)))))
    parts.append('<Transform DEF="AltDot" translation="%s"><Shape>%s<Sphere radius="0.9"/></Shape></Transform>' % (f3(*kalt[-1]), unlit(PAL["play"])))
    parts.append('<Transform DEF="BatDot" translation="%s"><Shape>%s<Sphere radius="0.9"/></Shape></Transform>' % (f3(*kbat[-1]), unlit(PAL["play"])))
    parts.append('<Transform DEF="Playhead" translation="%s"><Shape>%s<Box size="0.25 %s 0.05"/></Shape></Transform>' % (f3(xw(dur), (LANE_Y0 + 3) / 2, WALL_Z + 0.2), unlit(PAL["play"], 0.35), f3(LANE_Y0 + 6)))
    for i_, n_, f_ in (("I_pos", "Vehicle", "translation"), ("I_rot", "Vehicle", "rotation"), ("I_shadow", "Shadow", "translation"),
                       ("I_pos", "ChaseRig", "translation"), ("I_alt", "AltDot", "translation"), ("I_bat", "BatDot", "translation"), ("I_head", "Playhead", "translation")):
        route(i_, "value_changed", n_, "set_" + f_)
    for i_ in ("I_pos", "I_rot", "I_shadow", "I_alt", "I_bat", "I_head"):
        route("Replay", "fraction_changed", i_, "set_fraction")
        interps.append(i_)

    # ---- viewpoints -------------------------------------------------------------------------------------
    cx, cz = (gx0 + gx1) / 2, (gz0 + gz1) / 2
    vps = [("VP_overview", "overview (from the south-east)", (cx + 62, 58, cz + 74), (cx, 8, cz - 6)),
           ("VP_top", "top-down (north up)", None, None),
           ("VP_side", "side (looking north-west, across the out-and-back)", (cx + 75, 14, cz + 75), (cx, 14, cz)),
           ("VP_wall", "time-series wall", (WALL_X0 + WALL_W / 2, 27, WALL_Z + 105), (WALL_X0 + WALL_W / 2, 27, WALL_Z)),
           ("VP_home", "home: take-off, landing and kill", (34, 24, 52), (-2, 8, 0))]
    vp = ""
    for d, desc, pos_, tgt in vps:
        if d == "VP_top":
            h = (gz1 - gz0) / (2 * math.tan(0.7854 / 2)) * 1.02          # fieldOfView applies to the shorter (vertical) side
            vp += '<Viewpoint DEF="VP_top" description="%s" position="%s" orientation="1 0 0 -1.5708" centerOfRotation="%s"/>\n' % (attr(desc), f3(cx, h, cz), f3(cx, 0, cz))
            continue
        vp += '<Viewpoint DEF="%s" description="%s" position="%s" orientation="%s" centerOfRotation="%s"/>\n' % (d, attr(desc), f3(*pos_), f3(*look_at(pos_, tgt)), f3(*tgt))
    views = [(d, desc.split(" (")[0]) for d, desc, _p, _t in vps]
    views.insert(2, ("VP_chase", "chase"))

    # ---- panel data -------------------------------------------------------------------------------------
    info = U.info
    panel = {"file": {"file": os.path.relpath(A["path"], HERE), "sha256": A["raw_sha"], "bytes": A["bytes"], "ulog_version": U.version,
                      "hw": info.get("ver_hw"), "sw": info.get("ver_sw"), "sw_release": "%08x" % info.get("ver_sw_release", 0), "os": info.get("sys_os_name"),
                      "data_messages": sum(U.counts.values()), "topics": len(U.counts), "logged_strings": len(U.logs), "bad_messages": U.bad,
                      "duration_s": round(dur, 3), "boot_time_utc_us": info.get("boot_time_utc_us")},
             "items": items, "findings": [{k: f[k] for k in ("id", "level", "text", "evidence", "at")} for f in F], "views": views,
             "replay": {"duration": dur, "cycle": CYCLE, "lead": LEAD, "hold": HOLD, "speedup": SPEEDUP}, "interps": interps,
             "modes": [{"t0": s["t0"], "t1": s["t1"], "name": s["name"], "col": navcol(s["nav"])} for s in A["segs"]],
             "events": [{"t": e["t"], "name": e["name"], "level": min((m["level"] for m in e["msgs"]), key=rank),
                         "text": e["msgs"][0]["text"]} for e in ev],
             "gps": [round(g["t"], 3) for g in A["gps"]], "drops": A["drops"],
             "samples": [{"t": round(A["at"](i * SAMPLE_DT)["t"], 2), "name": "S_%d" % i} for i in range(si)],
             "legend": {"modes": [(navname(n), navcol(n)) for n in sorted({s["nav"] for s in A["segs"]})], "speed": SPEED_STOPS}}
    first_vp = '<Viewpoint DEF="VP_start" description="start" position="%s" orientation="%s"/>\n' % (f3(cx + 62, 58, cz + 74), f3(*look_at((cx + 62, 58, cz + 74), (cx, 8, cz - 6))))
    head = [("title", "PX4 flight log (ULog) in 3D"), ("description", "A real PX4 quadrotor flight (ULog) as a 3D scene: path coloured by mode or speed, setpoint ghost, attitude glyphs, events, battery and altitude wall, replay."),
            ("source", "PX4 Flight Review public log %s (%s bytes, sha256 %s)" % (os.path.basename(A["path"]), "{:,}".format(A["bytes"]), A["raw_sha"])),
            ("generator", "build.py + ulog.py (Python standard library)"), ("created", "2026-11-20"), ("license", "scene: same terms as the source log; code: MIT")]
    x3d = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
           '<X3D profile="Interchange" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">\n<head>\n'
           + "".join('<component name="%s" level="%d"/>\n' % c for c in [("PointingDeviceSensor", 1), ("Text", 1), ("Interpolation", 1), ("Time", 1), ("Navigation", 2), ("Grouping", 2), ("Shape", 2), ("Geometry3D", 2)])
           + "".join('<meta name="%s" content="%s"/>\n' % (k, attr(v)) for k, v in head)
           + '</head>\n<Scene>\n<WorldInfo title="PX4 flight log (ULog) in 3D"/>\n<Background skyColor="0.035 0.047 0.071 0.063 0.082 0.118" skyAngle="1.5708"/>\n'
           '<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>\n<DirectionalLight direction="-0.3 -0.8 -0.5" intensity="0.45"/>\n'
           + first_vp + vp + "\n".join(p for p in parts if p) + "\n" + "\n".join(routes) + "\n</Scene>\n</X3D>\n")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "flight-scene.x3d"), "w", encoding="utf-8") as fh:
        fh.write(x3d)
    with open(os.path.join(OUT, "flight-panel.json"), "w", encoding="utf-8") as fh:
        json.dump(panel, fh, separators=(",", ":"))
    report = {"file": panel["file"], "frame": {"home_position": {k: A["home"][k] for k in ("x", "y", "z", "alt")}, "takeoff_s": A["takeoff"], "touchdown_s": A["touchdown"]},
              "counts": {"vehicle_local_position": A["lp_all"], "valid_positions": A["lp_n"], "setpoints_finite": len(A["sp"]), "error_pairs": len(A["err"]),
                         "attitude": len(A["att"]), "battery": len(A["bat"]), "log_strings": len(A["logs"]), "gps_inject_warnings": len(A["gps"]),
                         "dropouts": len(A["drops"]), "glyphs": gi, "samples": si, "events": len(ev), "clickable": len(items), "replay_keys": len(keys)},
              "topic_counts": {"%s/%d" % k: v for k, v in sorted(U.counts.items())}, "modes": panel["modes"], "findings": panel["findings"],
              "scene_bytes": len(x3d.encode())}
    with open(os.path.join(OUT, "flight-report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1)
    print("wrote out/flight-scene.x3d (%d bytes), %d clickable, %d glyphs, %d events, %d findings" % (len(x3d.encode()), len(items), gi, len(ev), len(F)))
    for f in F:
        print("-", f["level"], f["text"])
    return report


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else SRC)
