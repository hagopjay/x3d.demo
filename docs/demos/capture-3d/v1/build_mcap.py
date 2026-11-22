#!/usr/bin/env python3
"""MCAP robotics log -> X3D 4.0 scene + panel data. Standard library only (mcap.py beside this file).

  python3 -I build_mcap.py [file.mcap]   -> out/mcap-scene.x3d, out/mcap-panel.json, out/mcap-report.json

Default: downloads/foxglove-mcap/uncompressed.mcap (foxglove/mcap test data, see README-MCAP.md).

Picture
  ground (X = east, -Z = north, Y = up, 1 m = 1 m): the vehicle path from the GPS RTK fixes found in /diagnostics
    (diagnostic_msgs/DiagnosticArray key/values "GPS RTK meters north/east/height difference"), one sphere per fix coloured by
    the RTK solution status, velocity arrows, and the TF tree (base_link -> radar from /tf) riding on the vehicle.
  wall behind (X = log time, Y = lanes): one lane per topic and per diagnostic source; a tick per message, tick height =
    message bytes (topics) or level (diagnostics: OK / WARN / ERROR).
Replay: one TimeSensor moves the vehicle along the fixes and a playhead along the wall in log time.
"""
import hashlib, json, math, os, re, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mcap  # noqa: E402

SRC = os.path.join(HERE, "downloads", "foxglove-mcap", "uncompressed.mcap")
OUT = os.path.join(HERE, "out")
CYCLE, LEAD, HOLD = 20.0, 1.0, 3.0
WALL_Z, WALL_W, LANE_H = -9.0, 18.0, 0.9
PAL = {"ok": "#2dd4bf", "warn": "#f2b84b", "err": "#f87171", "stale": "#94a3b8", "ink": "#e8edf3", "ink2": "#94a3b8", "ink3": "#334155",
       "tf": "#818cf8", "diag": "#c4a1d6", "path": "#e8edf3", "vel": "#fbbf24", "play": "#fbbf24"}
LEVEL = {0: ("OK", PAL["ok"]), 1: ("WARN", PAL["warn"]), 2: ("ERROR", PAL["err"]), 3: ("STALE", PAL["stale"])}
RTK_STATUS = {4: "fixed RTK", 3: "float / no fix", 0: "invalid"}       # as labelled by the driver key "(4 = good)"


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


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def analyse(path):
    raw = open(path, "rb").read()
    M = mcap.read_mcap(path)
    defs = {}
    for sid, s in M["schemas"].items():
        if s["encoding"] == "ros1msg":
            defs[sid] = mcap.parse_ros1(s["name"], s["data"].decode("utf-8", "replace"))
    msgs = sorted(M["messages"], key=lambda x: x["log_time"])
    t0 = msgs[0]["log_time"]
    topics = defaultdict(lambda: {"count": 0, "bytes": 0, "times": [], "sizes": [], "undecoded": 0})
    tf_pairs, tf_values, diag_rows, fixes = Counter(), defaultdict(set), [], []
    tf_first = {}
    pubs = {}            # diagnostics publisher -> last header.seq (each publisher keeps its own counter)
    for x in msgs:
        ch = M["channels"][x["channel"]]
        sc = M["schemas"].get(ch["schema_id"], {})
        t = (x["log_time"] - t0) / 1e9
        T = topics[ch["topic"]]
        T["count"] += 1
        T["bytes"] += len(x["data"])
        T["times"].append(t)
        T["sizes"].append(len(x["data"]))
        T["schema"], T["encoding"] = sc.get("name"), ch["encoding"]
        if ch["schema_id"] not in defs:
            T["undecoded"] += 1
            continue
        try:
            v = mcap.decode_ros1(defs[ch["schema_id"]], sc["name"], x["data"])
        except Exception:
            T["undecoded"] += 1
            continue
        if sc["name"] in ("tf2_msgs/TFMessage", "tf/tfMessage"):
            for tr in v["transforms"]:
                k = (tr["header"]["frame_id"], tr["child_frame_id"])
                tf_pairs[k] += 1
                q, p = tr["transform"]["rotation"], tr["transform"]["translation"]
                tf_values[k].add((round(p["x"], 6), round(p["y"], 6), round(p["z"], 6), round(q["x"], 6), round(q["y"], 6), round(q["z"], 6), round(q["w"], 6)))
                tf_first.setdefault(k, tr["transform"])
        elif sc["name"] == "diagnostic_msgs/DiagnosticArray":
            hs = v["header"]["seq"]
            pub = next((k for k, last in sorted(pubs.items(), key=lambda kv: hs - kv[1]) if 0 < hs - last <= 50), None)
            if pub is None:
                pub = "ABCDEFGH"[len(pubs)]
            pubs[pub] = hs
            for st in v["status"]:
                kv = {a["key"]: a["value"] for a in st["values"]}
                diag_rows.append({"t": t, "pub": pub, "seq": hs, "name": st["name"], "level": st["level"], "message": st["message"], "hardware_id": st["hardware_id"], "values": kv})
                if "GPS RTK meters north" in kv:
                    fixes.append({"pub": pub, "t": t, "n": num(kv["GPS RTK meters north"]), "e": num(kv["GPS RTK meters east"]), "u": num(kv.get("GPS RTK height difference (m)")),
                                  "vn": num(kv.get("GPS RTK velocity north")), "ve": num(kv.get("GPS RTK velocity east")), "vu": num(kv.get("GPS RTK velocity up")),
                                  "status": int(num(kv.get("GPS RTK solution status (4 = good)")) or 0), "sats": int(num(kv.get("Number of satellites used in GPS RTK solution")) or 0),
                                  "hacc": num(kv.get("GPS RTK horizontal accuracy (m)")), "lat": num(kv.get("GPS latitude")), "lon": num(kv.get("GPS longitude")),
                                  "level": st["level"], "message": st["message"], "values": kv})
    for T in topics.values():
        span = T["times"][-1] - T["times"][0]
        T["rate_hz"] = round((T["count"] - 1) / span, 1) if span else None
    dur = (msgs[-1]["log_time"] - t0) / 1e9
    payload = sum(len(x["data"]) for x in msgs)
    findings = []
    for k, n in tf_pairs.items():
        if len(tf_values[k]) == 1 and n > 10:
            findings.append({"level": "warn", "text": "Static transform %s -> %s published %d times on /tf with identical values (%.1f Hz). A static transform belongs on /tf_static (latched, sent once)." % (k[0], k[1], n, topics["/tf"]["rate_hz"] or 0),
                             "evidence": "1 distinct translation+rotation over %d messages" % n})
    by = defaultdict(list)
    for f in fixes:
        by[f["pub"]].append(f)
    if len(by) > 1:
        findings.append({"level": "warn", "text": "/diagnostics carries %d publishers with independent header.seq counters (%s) and the same diagnostic names and hardware ids; their GPS RTK fixes are %d m apart at the start. Treated as separate receivers; the log does not say which rig each belongs to." % (
            len(by), ", ".join("%s from seq %d" % (k, min(r["seq"] for r in diag_rows if r["pub"] == k)) for k in sorted(by)),
            round(math.hypot(by[sorted(by)[0]][0]["n"] - by[sorted(by)[1]][0]["n"], by[sorted(by)[0]][0]["e"] - by[sorted(by)[1]][0]["e"]))),
            "evidence": "header.seq of each DiagnosticArray; GPS RTK meters north/east"})
    for k in sorted(by):
        fs = by[k]
        d = sum(math.hypot(b["n"] - a["n"], b["e"] - a["e"]) for a, b in zip(fs, fs[1:]))
        sp = [math.hypot(f["vn"], f["ve"]) for f in fs if f["vn"] is not None]
        nofix = [f for f in fs if f["status"] != 4]
        txt = "Receiver %s: %d fixes over %.2f s, %.1f m travelled, speed %.2f to %.2f m/s, %s satellites, accuracy %s m" % (
            k, len(fs), fs[-1]["t"] - fs[0]["t"], d, min(sp), max(sp), "/".join(str(x) for x in sorted({f["sats"] for f in fs})), "/".join(sorted({str(f["hacc"]) for f in fs})))
        if nofix:
            fx = [f for f in fs if f["status"] == 4]
            txt += "; no RTK fix (status %s) in its first %d fixes, fixed from %.2f s" % ("/".join(sorted({str(f["status"]) for f in nofix})), len(nofix), fx[0]["t"]) if fx else "; never fixed"
        if sp and sp[-1] < 0.05:
            txt += "; stopped by the end (speed %.3f m/s)" % sp[-1]
        findings.append({"level": "warn" if nofix else "ok", "text": txt + ".", "evidence": "GPS RTK keys in /diagnostics, publisher %s" % k})
    warn = Counter((r["name"], r["message"]) for r in diag_rows if r["level"] >= 1)
    for (nm, msg), n in warn.items():
        findings.append({"level": "warn", "text": "%d %s from '%s': %s" % (n, "WARN" if all(r["level"] == 1 for r in diag_rows if r["name"] == nm and r["message"] == msg) else "non-OK", nm, msg),
                         "evidence": "/diagnostics status level >= 1"})
    oc = M["opcounts"]
    if oc.get("Schema", 0) > len(M["schemas"]) * 2:
        findings.append({"level": "info", "text": "File overhead: %d Schema and %d Channel records for %d schemas / %d channels (repeated in each of %d chunks); message payload is %.1f %% of the %s-byte file." % (
            oc["Schema"], oc.get("Channel", 0), len(M["schemas"]), len(M["channels"]), len(M["chunks"]), 100 * payload / len(raw), "{:,}".format(len(raw))),
            "evidence": "record opcode counts from the reader"})
    return {"raw_sha": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "M": M, "t0": t0, "dur": dur, "topics": topics, "tf_pairs": tf_pairs, "tf_first": tf_first,
            "tf_values": tf_values, "diag": diag_rows, "fixes": fixes, "by_pub": dict(by), "findings": findings, "payload": payload, "path": os.path.relpath(path, HERE)}


def build(path=SRC):
    A = analyse(path)
    F = A["fixes"]
    parts, routes, interps = [], [], []
    panel = {"items": {}, "views": [], "interps": [], "replay": {"cycle": CYCLE, "lead": LEAD, "hold": HOLD, "duration": A["dur"]}}
    frac = lambda t: (LEAD + (t / A["dur"]) * (CYCLE - LEAD - HOLD)) / CYCLE
    unlit = lambda c, tr=0.0: '<Appearance><Material diffuseColor="0 0 0" emissiveColor="%s"%s/></Appearance>' % (rgb(c), ' transparency="%.2f"' % tr if tr else "")
    lit = lambda c, e=0.35, tr=0.0: '<Appearance><Material diffuseColor="%s" emissiveColor="%s" specularColor="0.15 0.15 0.15"%s/></Appearance>' % (
        f3(*(v * 0.7 for v in rgbf(c))), f3(*(v * e for v in rgbf(c))), ' transparency="%.2f"' % tr if tr else "")

    def text(pos, lines, size=0.25, col=PAL["ink"], justify="BEGIN", style="PLAIN", family="SANS", rot=None, minor="FIRST"):
        r = ' rotation="%s"' % f3(*rot) if rot else ""
        return ('<Transform translation="%s"%s><Shape>%s<Text string="%s"><FontStyle family=\'"%s"\' style="%s" size="%.3f" justify=\'"%s" "%s"\'/></Text></Shape></Transform>'
                % (f3(*pos), r, unlit(col), mf(*lines), family, style, size, justify, minor))

    def lines(segs, col, tr=0.0, colors=None):
        if not segs:
            return ""
        pts = [p for s in segs for p in s]
        cn = ('<Color color="%s"/>' % " ".join(f3(*c) for s in colors for c in s)) if colors else ""
        return '<Shape>%s<LineSet vertexCount="%s"><Coordinate point="%s"/>%s</LineSet></Shape>' % (
            unlit(col, tr), " ".join(str(len(s)) for s in segs), " ".join(f3(*p) for p in pts), cn)

    def route(a, af, b, bf):
        routes.append((a, af, b, bf))

    # ---- ground: path of RTK fixes (centred) ----
    ce = (min(f["e"] for f in F) + max(f["e"] for f in F)) / 2
    cn = (min(f["n"] for f in F) + max(f["n"] for f in F)) / 2
    P = lambda f: (f["e"] - ce, max(0.0, (f["u"] or 0) - min(g["u"] or 0 for g in F)) , -(f["n"] - cn))
    gx, gz = 22, 12
    parts.append('<Transform translation="0 -0.02 0"><Shape>%s<Box size="%d 0.02 %d"/></Shape></Transform>' % (lit("#0f172a", 0.6), gx, gz))
    grid = [[(x, 0.0, -gz / 2), (x, 0.0, gz / 2)] for x in range(-gx // 2, gx // 2 + 1)] + [[(-gx / 2, 0.0, z), (gx / 2, 0.0, z)] for z in range(-gz // 2, gz // 2 + 1)]
    parts.append(lines(grid, PAL["ink3"], 0.3))
    parts.append(text((gx / 2 - 0.2, 0.01, -gz / 2 + 0.6), ["N"], size=0.5, col=PAL["ink2"], justify="END", rot=(1, 0, 0, -1.5708)))
    parts.append(lines([[(gx / 2 - 0.5, 0.01, -gz / 2 + 2.0), (gx / 2 - 0.5, 0.01, -gz / 2 + 0.9)]], PAL["ink2"]))
    parts.append(text((-gx / 2 + 0.3, 0.01, gz / 2 - 0.4), ["1 m grid · east to the right, north into the scene · heights from 'GPS RTK height difference (m)', not exaggerated"], size=0.28, col=PAL["ink2"], rot=(1, 0, 0, -1.5708)))
    PUBCOL = {}
    pal_pub = ["#2dd4bf", "#818cf8", "#c4a1d6", "#f2b84b"]
    for pi_, (pub, fs) in enumerate(sorted(A["by_pub"].items())):
        PUBCOL[pub] = pal_pub[pi_ % len(pal_pub)]
        pc = PUBCOL[pub]
        parts.append(lines([[P(f) for f in fs]], pc, 0.15))
        for i, f in enumerate(fs):
            x, y, z = P(f)
            col = pc if f["status"] == 4 else PAL["warn"]
            name = "G_%s_%d" % (pub, i)
            inner = '<Transform translation="%s"><Shape>%s<Sphere radius="%s"/></Shape></Transform>' % (f3(x, y + 0.18, z), lit(col, 0.5), "0.18" if f["status"] == 4 else "0.24")
            inner += lines([[(x, 0.0, z), (x, y + 0.18, z)]], col, 0.4)
            if f["vn"] is not None:
                inner += lines([[(x, y + 0.18, z), (x + f["ve"], y + 0.18, z - f["vn"])]], PAL["vel"])
            parts.append('<Group>%s<TouchSensor DEF="T_%s" description="%s"/></Group>' % (inner, name, attr("receiver %s fix %d at %.2f s: %s, %d sats" % (pub, i + 1, f["t"], RTK_STATUS.get(f["status"], f["status"]), f["sats"]))))
            body = {"receiver (publisher)": "%s (header.seq stream)" % pub, "log time": "%.3f s after first message" % f["t"], "RTK solution status": "%d (%s)" % (f["status"], RTK_STATUS.get(f["status"], "?")),
                    "satellites (RTK)": f["sats"], "north / east / up (m, from RTK base)": "%s / %s / %s" % (f["n"], f["e"], f["u"]),
                    "velocity north / east / up (m/s)": "%s / %s / %s" % (f["vn"], f["ve"], f["vu"]), "speed (m/s)": round(math.hypot(f["vn"], f["ve"]), 3) if f["vn"] is not None else None,
                    "horizontal accuracy (m)": f["hacc"], "lat / lon (driver, coarse)": "%s / %s" % (f["lat"], f["lon"]), "diagnostic": "level %d: %s" % (f["level"], f["message"])}
            panel["items"]["T_" + name] = {"kind": "GPS RTK fix (from /diagnostics)", "title": "receiver %s · fix %d · %.2f s" % (pub, i + 1, f["t"]), "body": body}
        # moving marker for this receiver: position + yaw (from velocity heading) keyed at its fixes
        yaws = []
        for f in fs:
            yaws.append(math.atan2(f["vn"], f["ve"]) if f["vn"] is not None and math.hypot(f["vn"], f["ve"]) > 0.05 else (yaws[-1] if yaws else 0.0))
        for k in range(1, len(yaws)):
            while yaws[k] - yaws[k - 1] > math.pi:
                yaws[k] -= 2 * math.pi
            while yaws[k] - yaws[k - 1] < -math.pi:
                yaws[k] += 2 * math.pi
        keys = [0.0] + [frac(f["t"]) for f in fs] + [1.0]
        pos = [P(fs[0])] + [P(f) for f in fs] + [P(fs[-1])]
        rig = ('<Shape>%s<Cone bottomRadius="0.35" height="0.9"/></Shape>' % lit(pc, 0.55))
        parts.append('<Transform DEF="Rig_%s" translation="%s"><Transform DEF="RigYaw_%s"><Transform translation="0 0.55 0" rotation="0 0 1 -1.5708">%s</Transform></Transform>%s</Transform>' % (
            pub, f3(*pos[0]), pub, rig, text((0, 1.25, 0), ["receiver %s" % pub], size=0.26, col=pc, justify="MIDDLE", style="BOLD")))
        parts.append('<PositionInterpolator DEF="I_rig_%s" key="%s" keyValue="%s"/>' % (pub, " ".join("%.5f" % k for k in keys), " ".join(f3(*p_) for p_ in pos)))
        parts.append('<OrientationInterpolator DEF="I_yaw_%s" key="%s" keyValue="%s"/>' % (pub, " ".join("%.5f" % k for k in keys), " ".join("0 1 0 %.4f" % y_ for y_ in [yaws[0]] + yaws + [yaws[-1]])))
        for nm, tgt, fld in (("I_rig_" + pub, "Rig_" + pub, "set_translation"), ("I_yaw_" + pub, "RigYaw_" + pub, "set_rotation")):
            route("Replay", "fraction_changed", nm, "set_fraction")
            route(nm, "value_changed", tgt, fld)
            interps.append(nm)
        s0 = P(fs[0])
        parts.append(text((s0[0], 0.02, s0[2] + 0.7), ["start %s" % pub], size=0.24, col=pc, justify="MIDDLE", rot=(1, 0, 0, -1.5708)))
    panel["receivers"] = PUBCOL
    # TF inset: the frame tree from /tf, drawn once at a corner (no field in the log ties it to either receiver)
    tfk = next(iter(A["tf_first"]), None)
    if tfk:
        tr = A["tf_first"][tfk]
        rd = tr["translation"]
        ox, oz = -gx / 2 + 2.0, -gz / 2 + 2.2
        inset = (lines([[(ox, 0.3, oz), (ox + 1.2, 0.3, oz)]], "#f87171") + lines([[(ox, 0.3, oz), (ox, 1.5, oz)]], "#4ade80") + lines([[(ox, 0.3, oz), (ox, 0.3, oz - 1.2)]], "#60a5fa")
                 + lines([[(ox, 0.3, oz), (ox + rd["x"], 0.3 + rd["z"], oz - rd["y"])]], PAL["tf"])
                 + '<Transform translation="%s"><Shape>%s<Box size="0.3 0.3 0.6"/></Shape></Transform>' % (f3(ox + rd["x"], 0.3 + rd["z"], oz - rd["y"]), lit(PAL["tf"], 0.6))
                 + '<Transform translation="%s"><Shape>%s<Sphere radius="0.12"/></Shape></Transform>' % (f3(ox, 0.3, oz), lit("#e8edf3", 0.6))
                 + text((ox, 1.75, oz), [tfk[0]], size=0.24, col=PAL["ink"], justify="MIDDLE", style="BOLD")
                 + text((ox + rd["x"], 0.75, oz - rd["y"]), [tfk[1]], size=0.24, col=PAL["tf"], justify="MIDDLE", style="BOLD")
                 + text((ox - 0.2, 0.02, oz + 0.9), ["/tf: %s → %s, %s m, %d identical msgs" % (tfk[0], tfk[1], rd["x"], A["tf_pairs"][tfk])], size=0.2, col=PAL["tf"], rot=(1, 0, 0, -1.5708)))
        parts.append('<Group>%s<TouchSensor DEF="T_tf" description="%s"/></Group>' % (inset, attr("TF %s -> %s (from /tf)" % tfk)))
        panel["items"]["T_tf"] = {"kind": "TF frame pair (/tf)", "title": "%s to %s" % tfk, "body": {
            "translation (m)": "x %s, y %s, z %s" % (rd["x"], rd["y"], rd["z"]),
            "rotation (quaternion)": "x %s, y %s, z %s, w %s" % (tr["rotation"]["x"], tr["rotation"]["y"], tr["rotation"]["z"], tr["rotation"]["w"]),
            "messages": A["tf_pairs"][tfk], "distinct values": len(A["tf_values"][tfk]),
            "drawn as": "inset at the grid corner; axes red/green/blue = parent x/y/z (ROS x forward, y left, z up); not attached to a receiver because no field links them"}}
    # ---- wall: topic and diagnostic lanes over log time ----
    xw = lambda t: -WALL_W / 2 + t / A["dur"] * WALL_W
    lanes = []
    for topic, T in sorted(A["topics"].items(), key=lambda kv: -kv[1]["count"]):
        lanes.append(("topic", topic, T))
    for pub, nm in sorted({(r["pub"], r["name"]) for r in A["diag"]}):
        lanes.append(("diag", "%s [%s]" % (nm, pub), [r for r in A["diag"] if r["name"] == nm and r["pub"] == pub]))
    y_top = 1.0 + LANE_H * len(lanes)
    parts.append('<Transform translation="%s"><Shape>%s<Box size="%s 0.04"/></Shape></Transform>' % (f3(0, y_top / 2 + 0.3, WALL_Z - 0.05), lit("#0b1220", 0.6), f3(WALL_W + 9, y_top + 1.4)))
    for li, (kind, nm, data) in enumerate(lanes):
        y = y_top - (li + 1) * LANE_H + 0.15
        parts.append(lines([[(xw(0), y, WALL_Z), (xw(A["dur"]), y, WALL_Z)]], PAL["ink3"]))
        name = "L_%d" % li
        if kind == "topic":
            mx = max(data["sizes"])
            ticks = [[(xw(t), y, WALL_Z + 0.02), (xw(t), y + 0.12 + 0.55 * s / mx, WALL_Z + 0.02)] for t, s in zip(data["times"], data["sizes"])]
            col = PAL["tf"] if "tf" in nm else PAL["diag"]
            lab = ["%s" % nm, "%s · %d msgs · %.1f Hz · %s B" % (data["schema"], data["count"], data["rate_hz"] or 0, "{:,}".format(data["bytes"]))]
            inner = lines(ticks, col) + '<Transform translation="%s"><Shape>%s<Box size="%s 0.7 0.02"/></Shape></Transform>' % (f3(0, y + 0.3, WALL_Z - 0.01), unlit("#0b1220", 0.2), f3(WALL_W))
            panel["items"]["T_" + name] = {"kind": "MCAP channel", "title": nm, "body": {"schema": data["schema"], "message encoding": data["encoding"], "messages": data["count"],
                                           "rate (Hz)": data["rate_hz"], "payload bytes": data["bytes"], "message size min / max": "%d / %d" % (min(data["sizes"]), max(data["sizes"])),
                                           "undecoded": data["undecoded"], "tick height": "message size"}}
        else:
            ticks, cols = [], []
            for r in data:
                lv = LEVEL.get(r["level"], ("?", PAL["stale"]))
                ticks.append([(xw(r["t"]), y, WALL_Z + 0.02), (xw(r["t"]), y + 0.2 + 0.18 * min(r["level"], 3), WALL_Z + 0.02)])
                cols.append([rgbf(lv[1]), rgbf(lv[1])])
            inner = lines(ticks, PAL["ok"], colors=cols) + '<Transform translation="%s"><Shape>%s<Box size="%s 0.7 0.02"/></Shape></Transform>' % (f3(0, y + 0.3, WALL_Z - 0.01), unlit("#0b1220", 0.2), f3(WALL_W))
            lv = Counter(LEVEL.get(r["level"], ("?",))[0] for r in data)
            lab = ["/diagnostics · %s" % nm, ", ".join("%s %d" % kv for kv in lv.items()) + " · " + Counter(r["message"] for r in data).most_common(1)[0][0]]
            panel["items"]["T_" + name] = {"kind": "diagnostic source (/diagnostics)", "title": nm, "body": {
                "statuses": dict(lv), "messages": dict(Counter(r["message"] for r in data)), "hardware id": data[0]["hardware_id"],
                "first / last at": "%.2f s / %.2f s" % (data[0]["t"], data[-1]["t"]), "keys reported": ", ".join(list(data[-1]["values"])[:12]) + (" …" if len(data[-1]["values"]) > 12 else "")}}
        parts.append('<Group>%s<TouchSensor DEF="T_%s" description="%s"/></Group>' % (inner, name, attr(lab[0])))
        parts.append(text((xw(0) - 0.3, y + 0.25, WALL_Z), [lab[0]], size=0.2, col=PAL["ink"], justify="END", style="BOLD"))
        parts.append(text((xw(0) - 0.3, y + 0.03, WALL_Z), [lab[1][:70]], size=0.14, col=PAL["ink2"], justify="END"))
    for t in range(0, int(A["dur"]) + 1):
        parts.append(lines([[(xw(t), 0.95, WALL_Z), (xw(t), 1.1, WALL_Z)]], PAL["ink2"]) + text((xw(t), 0.6, WALL_Z), ["%d s" % t], size=0.18, col=PAL["ink2"], justify="MIDDLE"))
    parts.append('<Transform DEF="Playhead" translation="%s"><Shape>%s<Box size="0.04 %s 0.04"/></Shape></Transform>' % (f3(xw(0), (y_top + 1) / 2, WALL_Z + 0.05), unlit(PAL["play"]), f3(y_top - 0.6)))
    parts.append('<PositionInterpolator DEF="I_play" key="0 %.5f %.5f 1" keyValue="%s"/>' % (frac(0), frac(A["dur"]), " ".join(f3(x, (y_top + 1) / 2, WALL_Z + 0.05) for x in (xw(0), xw(0), xw(A["dur"]), xw(A["dur"])))))
    route("Replay", "fraction_changed", "I_play", "set_fraction")
    route("I_play", "value_changed", "Playhead", "set_translation")
    interps.append("I_play")
    # title on the wall
    M = A["M"]
    first = datetime.fromtimestamp(A["t0"] / 1e9, timezone.utc)
    parts.append(text((-WALL_W / 2 - 4.2, y_top + 1.25, WALL_Z), ["Robot log (MCAP) in 3D"], size=0.55, col=PAL["ink"], style="BOLD"))
    parts.append(text((-WALL_W / 2 - 4.2, y_top + 0.75, WALL_Z), ["REAL LOG · foxglove/mcap test file %s · %s bytes · profile %s · %d messages · %d channels · %.2f s · first message %s UTC"
                                                                  % (os.path.basename(A["path"]), "{:,}".format(A["bytes"]), M["header"]["profile"], len(M["messages"]), len(M["channels"]), A["dur"], first.strftime("%Y-%m-%d %H:%M:%S"))],
                       size=0.2, col=PAL["ink2"]))
    views = [("VP_overview", "Overview", (-5, 10, 21), (-1.5, 2.2, -3)),
             ("VP_path", "Path from above", (0, 17, 0.01), (0, 0, 0)),
             ("VP_ground", "Receivers close-up", (-4, 6, 9), (0, 0.5, 0)),
             ("VP_wall", "Topic lanes", (-3.2, y_top / 2 + 0.6, WALL_Z + 19), (-3.2, y_top / 2 + 0.4, WALL_Z))]
    vp = ""
    for d, desc, pos_, tgt in views:
        vp += '<Viewpoint DEF="%s" description="%s" position="%s" orientation="%s" centerOfRotation="%s"/>\n' % (d, attr(desc), f3(*pos_), f3(*look_at(pos_, tgt)), f3(*tgt))
        panel["views"].append([d, desc])
    panel["interps"] = interps
    panel["findings"] = A["findings"]
    panel["lanes"] = [{"label": nm, "kind": k, "times": [round(t, 3) for t in (d["times"] if k == "topic" else [r["t"] for r in d])][:2000],
                       "levels": None if k == "topic" else [r["level"] for r in d]} for k, nm, d in lanes]
    panel["fixes"] = [{"t": f["t"], "status": f["status"], "pub": pub, "sensor": "T_G_%s_%d" % (pub, i)} for pub, fs in sorted(A["by_pub"].items()) for i, f in enumerate(fs)]
    panel["file"] = {"file": A["path"], "sha256": A["raw_sha"], "bytes": A["bytes"], "profile": M["header"]["profile"], "library": M["header"]["library"],
                     "messages": len(M["messages"]), "channels": len(M["channels"]), "schemas": len(M["schemas"]), "chunks": len(M["chunks"]),
                     "chunk_compression": dict(Counter(c["compression"] for c in M["chunks"])), "skipped_chunks": M["skipped_chunks"], "record_counts": M["opcounts"],
                     "problems": M["problems"], "duration_s": round(A["dur"], 3), "first_message_utc": first.isoformat(), "payload_bytes": A["payload"], "statistics": M["statistics"]}
    head = [("title", "Robot log (MCAP) in 3D"), ("description", "An MCAP log as a 3D scene: GPS RTK path with TF frames on the ground, topic and diagnostic lanes on the wall."),
            ("generator", "capture-3d/build_mcap.py (Python %s)" % sys.version.split()[0]), ("source", "%s sha256 %s" % (A["path"], A["raw_sha"])),
            ("source-origin", "github.com/foxglove/mcap rust/mcap/tests/data/uncompressed.mcap via Git LFS (fetched 2026-11-20)")]
    rt = "\n".join('<ROUTE fromNode="%s" fromField="%s" toNode="%s" toField="%s"/>' % r for r in routes)
    x3d = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
           '<X3D profile="Interchange" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">\n<head>\n'
           + "".join('<component name="%s" level="%d"/>\n' % c for c in [("PointingDeviceSensor", 1), ("Text", 1), ("Interpolation", 1), ("Time", 1), ("Navigation", 2)])
           + "".join('<meta name="%s" content="%s"/>\n' % (k, attr(v)) for k, v in head)
           + '</head>\n<Scene>\n<WorldInfo title="Robot log (MCAP) in 3D"/>\n<Background skyColor="0.035 0.047 0.071 0.063 0.082 0.118" skyAngle="1.5708"/>\n'
           '<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>\n<DirectionalLight direction="-0.3 -0.8 -0.5" intensity="0.45"/>\n'
           + vp + '<TimeSensor DEF="Replay" cycleInterval="%s" loop="true"/>\n' % f3(CYCLE) + "\n".join(parts) + "\n" + rt + "\n</Scene>\n</X3D>\n")
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "mcap-scene.x3d"), "w", encoding="utf-8").write(x3d)
    json.dump(panel, open(os.path.join(OUT, "mcap-panel.json"), "w"), indent=1, default=str)
    rep = {"scene_bytes": len(x3d.encode()), "file": panel["file"], "findings": A["findings"], "fixes": len(F), "lanes": [l["label"] for l in panel["lanes"]]}
    json.dump(rep, open(os.path.join(OUT, "mcap-report.json"), "w"), indent=1, default=str)
    return rep


if __name__ == "__main__":
    print(json.dumps(build(sys.argv[1] if len(sys.argv) > 1 else SRC), indent=1, default=str))
