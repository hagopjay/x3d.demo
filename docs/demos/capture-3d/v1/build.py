#!/usr/bin/env python3
"""Packet capture (pcapng / pcap) -> X3D 4.0 scene + panel data. Standard library only (pcap.py beside this file).

  python3 -I build.py [capture]      -> out/capture-scene.x3d, out/capture-panel.json, out/build-report.json

Default capture: downloads/wireshark/sip-rtp.pcapng (Wireshark test capture, see README).

Picture: a 3D ladder (sequence) diagram.
  X  one rail per host, ordered to keep messages short (greedy on traffic)
  Z  capture time, receding from the viewer; bursts are spread out: z follows real time (Z_PER_S m/s) but two consecutive
     signalling events are never closer than MIN_GAP m. The real time is printed on the ruler, so the warp is visible.
  Y  height: signalling arcs above the floor; the RTP stream is a ribbon whose height at each packet = its RFC 3550 jitter
SIP messages are arcs between rails (requests and responses coloured differently, grouped per dialog / Call-ID).
RTP: one bead per packet on the ribbon; a sequence gap is a red post. RTCP, if any, small diamonds.
Replay: one TimeSensor; a playhead plane sweeps Z, each SIP arc is revealed and a packet sphere flies along it when its time
comes; the RTP ribbon grows with the playhead.
"""
import hashlib, json, math, os, re, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pcap  # noqa: E402

CAP = os.path.join(HERE, "downloads", "wireshark", "sip-rtp.pcapng")
OUT = os.path.join(HERE, "out")
RAIL_GAP, Z_PER_S, MIN_GAP, ARC_H = 5.0, 1.1, 0.9, 1.6
CYCLE, LEAD, HOLD = 30.0, 1.0, 3.0
PAL = {"req": "#818cf8", "resp1": "#94a3b8", "resp2": "#2dd4bf", "resp4": "#f87171", "rtp": "#2dd4bf", "loss": "#f87171",
       "reg": "#c4a1d6", "ink": "#e8edf3", "ink2": "#94a3b8", "ink3": "#334155", "rail": "#64748b", "play": "#fbbf24", "rtcp": "#f2b84b"}
CLOCK = {"PCMU": 8000, "PCMA": 8000, "GSM": 8000, "G729": 8000, "G723": 8000, "G722": 8000, "ILBC": 8000, "SPEEX": 8000}
STATIC_PT = {0: "PCMU", 3: "GSM", 4: "G723", 8: "PCMA", 9: "G722", 18: "G729"}


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


# ---------- analysis ----------
def analyse(path):
    raw = open(path, "rb").read()
    cap = pcap.read_capture(path)
    P = [p for p in cap["packets"] if p["t"] is not None]
    t0 = P[0]["t"]
    hosts = defaultdict(lambda: {"sent": 0, "recv": 0, "bytes_sent": 0, "bytes_recv": 0, "ports": set(), "roles": set(), "macs": set()})
    sipmsgs, rtp_pk, rtcp_pk, other, layers = [], defaultdict(list), [], Counter(), Counter()
    media_ports = {}         # (ip, port) -> {"call", "side", "codecs"}
    for n, p in enumerate(P, 1):
        d = pcap.decode(p)
        layers["/".join(d["layers"])] += 1
        if "src" not in d:
            other[d.get("stop", "non-ip")] += 1
            continue
        t = p["t"] - t0
        hs, hd = hosts[d["src"]], hosts[d["dst"]]
        hs["sent"] += 1
        hd["recv"] += 1
        hs["bytes_sent"] += p["len"]
        hd["bytes_recv"] += p["len"]
        if d.get("eth_src"):
            hs["macs"].add(d["eth_src"])
        if "sport" in d:
            hs["ports"].add(d["sport"])
            hd["ports"].add(d["dport"])
        pay = d.get("payload", b"")
        s = pcap.sip(pay) if "sport" in d else None
        if s:
            s.update(frame=n, t=t, src=d["src"], dst=d["dst"], sport=d["sport"], dport=d["dport"], size=p["len"])
            sipmsgs.append(s)
            if s.get("sdp"):
                conn = s["sdp"].get("conn") or d["src"]
                for m in s["sdp"]["media"]:
                    media_ports[(conn, m["port"])] = {"call": s["headers"].get("call-id"), "codecs": m["rtpmap"], "offered_by": d["src"],
                                                     "in": "INVITE" if s.get("method") else "%s %s" % (s.get("status"), s.get("reason"))}
            continue
        if "sport" in d:
            r = pcap.rtp(pay)
            known = (d["dst"], d["dport"]) in media_ports or (d["src"], d["sport"]) in media_ports
            if r and (known or d["dport"] >= 1024 and d["sport"] >= 1024):
                r.update(frame=n, t=t, src=d["src"], dst=d["dst"], sport=d["sport"], dport=d["dport"], psize=r["size"], size=p["len"])
                rtp_pk[(r["ssrc"], d["src"], d["sport"], d["dst"], d["dport"])].append(r)
                continue
            c = pcap.rtcp(pay)
            if c:
                c.update(frame=n, t=t, src=d["src"], dst=d["dst"])
                rtcp_pk.append(c)
                continue
        other["%s port %s" % ({17: "UDP", 6: "TCP"}.get(d.get("proto"), d.get("proto")), d.get("dport"))] += 1
    # SIP roles and dialogs
    for m in sipmsgs:
        if m.get("method") == "REGISTER":
            hosts[m["src"]]["roles"].add("SIP user agent (registers)")
            hosts[m["dst"]]["roles"].add("SIP registrar")
        elif m.get("method") == "INVITE":
            hosts[m["src"]]["roles"].add("SIP caller side")
            hosts[m["dst"]]["roles"].add("SIP callee side")
    dialogs = defaultdict(list)
    for m in sipmsgs:
        dialogs[m["headers"].get("call-id", "?")].append(m)
    calls = []
    for cid, ms in dialogs.items():
        kind = "call" if any(m.get("method") == "INVITE" for m in ms) else ("registration" if any(m.get("method") == "REGISTER" for m in ms) else "other")
        rec = {"call_id": cid, "kind": kind, "messages": len(ms), "start": ms[0]["t"], "end": ms[-1]["t"],
               "from": ms[0]["headers"].get("from", ""), "to": ms[0]["headers"].get("to", ""), "ladder": [m.get("method") or m.get("status") for m in ms]}
        if kind == "call":
            inv = next(m for m in ms if m.get("method") == "INVITE")
            ring = next((m for m in ms if m.get("status") == 180 and m["t"] >= inv["t"]), None)
            ok = next((m for m in ms if m.get("status") == 200 and m["t"] >= inv["t"]), None)
            rec["post_dial_delay_ms"] = round((ring["t"] - inv["t"]) * 1000, 1) if ring else None
            rec["answer_after_s"] = round(ok["t"] - inv["t"], 3) if ok else None
            rec["state_at_capture_end"] = "answered" if ok else ("ringing" if ring else "trying")
            if any(m.get("method") == "BYE" for m in ms):
                rec["state_at_capture_end"] = "ended (BYE)"
        calls.append(rec)
    # RTP streams (RFC 3550 jitter, sequence gaps)
    streams = []
    for (ssrc, src, sp, dst, dp), pk in rtp_pk.items():
        if len(pk) < 5:
            continue
        pk.sort(key=lambda r: r["t"])
        codec = STATIC_PT.get(pk[0]["pt"], "PT %d" % pk[0]["pt"])
        mp = media_ports.get((dst, dp)) or media_ports.get((src, sp))
        if mp and str(pk[0]["pt"]) in mp["codecs"]:
            codec = mp["codecs"][str(pk[0]["pt"])].split("/")[0].upper()
        clock = CLOCK.get(codec, 8000)
        J, prev, lost, gaps, maxdelta, dup, pauses = 0.0, None, 0, [], 0.0, 0, []
        expected_seq = None
        for r in pk:
            if prev is not None:
                D = (r["t"] - prev["t"]) - (r["ts"] - prev["ts"]) / clock
                J += (abs(D) - J) / 16
                maxdelta = max(maxdelta, r["t"] - prev["t"])
                if r["t"] - prev["t"] > 0.2:           # a pause in sending: did the RTP clock keep running (silence suppression)?
                    tsd = ((r["ts"] - prev["ts"]) % 2 ** 32) / clock
                    pauses.append({"t": prev["t"], "dur_s": round(r["t"] - prev["t"], 3), "rtp_clock_advance_s": round(tsd, 3),
                                   "seq_continuous": (r["seq"] - prev["seq"]) % 65536 == 1, "marker_after": r["marker"]})
                ds = (r["seq"] - prev["seq"]) % 65536
                if ds == 0:
                    dup += 1
                elif 1 < ds < 3000:
                    lost += ds - 1
                    gaps.append({"t": r["t"], "after_seq": prev["seq"], "missing": ds - 1})
            r["jitter_ms"] = J * 1000
            prev = r
        dur = pk[-1]["t"] - pk[0]["t"]
        streams.append({"ssrc": "0x%08X" % ssrc, "src": src, "sport": sp, "dst": dst, "dport": dp, "pt": pk[0]["pt"], "codec": codec,
                        "clock_hz": clock, "packets": len(pk), "first_t": pk[0]["t"], "last_t": pk[-1]["t"], "duration_s": round(dur, 3),
                        "rate_pps": round((len(pk) - 1) / dur, 1) if dur else None, "lost": lost, "loss_pct": round(100 * lost / (len(pk) + lost), 2),
                        "gaps": gaps, "duplicates": dup, "jitter_mean_ms": round(sum(r["jitter_ms"] for r in pk) / len(pk), 2),
                        "jitter_max_ms": round(max(r["jitter_ms"] for r in pk), 2), "max_delta_ms": round(maxdelta * 1000, 1),
                        "payload_bytes": pk[0]["psize"] - 12, "frame_bytes": pk[0]["size"],
                        "pauses": pauses, "signalled_by": mp, "packets_list": pk,
                        "markers": sum(1 for r in pk if r["marker"])})
        hosts[src]["roles"].add("RTP sender")
        hosts[dst]["roles"].add("RTP receiver")
    # findings (plain rules, each names its evidence)
    findings = []
    for s in streams:
        back = [x for x in streams if x["src"] == s["dst"] and x["dst"] == s["src"]]
        if not back:
            findings.append({"level": "warn", "text": "One-way media: RTP %s:%d -> %s:%d (%d packets) has no reverse stream in this capture. "
                             "Either one-way audio or the capture point saw only one direction." % (s["src"], s["sport"], s["dst"], s["dport"], s["packets"]),
                             "evidence": "RTP streams found: %d" % len(streams)})
        findings.append({"level": "ok" if s["lost"] == 0 else "warn", "text": "RTP %s %s: %d packets, %d lost (%.2f %%), jitter mean %.2f ms / max %.2f ms, largest gap %.1f ms."
                         % (s["ssrc"], s["codec"], s["packets"], s["lost"], s["loss_pct"], s["jitter_mean_ms"], s["jitter_max_ms"], s["max_delta_ms"]),
                         "evidence": "RFC 3550 interarrival jitter, clock %d Hz" % s["clock_hz"]})
    for c in calls:
        if c["kind"] == "call":
            findings.append({"level": "ok" if c["state_at_capture_end"] == "answered" else "info",
                             "text": "Call %s: %s; 180 Ringing after %s ms%s." % (c["call_id"][:18], c["state_at_capture_end"], c["post_dial_delay_ms"],
                                                                                    "; answered after %.3f s" % c["answer_after_s"] if c["answer_after_s"] else "; no 200 OK before the capture ends"),
                             "evidence": " -> ".join(str(x) for x in c["ladder"])})
    regm = [m for m in sipmsgs if m.get("method") == "REGISTER"]
    if regm:
        ok = sum(1 for m in regm if any(r.get("status") == 200 and r["headers"].get("cseq") == m["headers"].get("cseq") and r["headers"].get("call-id") == m["headers"].get("call-id") for r in sipmsgs))
        findings.append({"level": "info", "text": "%d REGISTER requests from %d user agents, %d answered 200 OK." % (len(regm), len({m["src"] for m in regm}), ok),
                         "evidence": ", ".join("%s at %.3f s" % (m["headers"].get("from", "").split(";")[0][:40], m["t"]) for m in regm)})
    for s in streams:
        if s["pauses"]:
            big = max(s["pauses"], key=lambda x: x["dur_s"])
            findings.append({"level": "info", "text": "RTP %s pauses: %d gaps over 200 ms (longest %.2f s at %.3f s). Sequence numbers stay continuous across %d of them, so packets were not lost: the sender stopped sending (silence suppression or hold); the RTP clock advanced %.2f s over the longest gap."
                             % (s["ssrc"], len(s["pauses"]), big["dur_s"], big["t"], sum(1 for x in s["pauses"] if x["seq_continuous"]), big["rtp_clock_advance_s"]),
                             "evidence": "inter-arrival > 200 ms; RTP seq and timestamp of the packets either side"})
    return {"path": os.path.relpath(path, HERE), "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "cap": cap, "t0": t0,
            "duration": P[-1]["t"] - t0, "packets": len(P), "hosts": hosts, "sip": sipmsgs, "calls": calls, "streams": streams,
            "rtcp": rtcp_pk, "other": other, "layers": layers, "findings": findings}


# ---------- scene ----------
def order_hosts(A):
    w = Counter()
    for m in A["sip"]:
        w[frozenset((m["src"], m["dst"]))] += 1
    for s in A["streams"]:
        w[frozenset((s["src"], s["dst"]))] += s["packets"]
    hs = sorted(A["hosts"], key=lambda h: -(A["hosts"][h]["sent"] + A["hosts"][h]["recv"]))
    order = [hs[0]]
    for h in hs[1:]:     # place each host at the end that is closer (by traffic) to its heaviest neighbour
        left = sum(w[frozenset((h, o))] / (i + 1) for i, o in enumerate(order))
        right = sum(w[frozenset((h, o))] / (i + 1) for i, o in enumerate(reversed(order)))
        order = [h] + order if left > right else order + [h]
    return order


def build(path=CAP):
    A = analyse(path)
    order = order_hosts(A)
    X = {h: (i - (len(order) - 1) / 2) * RAIL_GAP for i, h in enumerate(order)}
    # time -> z (monotone; real time with a minimum gap between consecutive signalling events)
    ev = sorted({round(m["t"], 6) for m in A["sip"]} | {0.0, round(A["duration"], 6)})
    keys, z = [], 0.0
    for i, t in enumerate(ev):
        if i:
            z += max(MIN_GAP, (t - ev[i - 1]) * Z_PER_S)
        keys.append((t, z))

    def zt(t):
        for (ta, za), (tb, zb) in zip(keys, keys[1:]):
            if ta <= t <= tb:
                return -(za + (zb - za) * ((t - ta) / (tb - ta) if tb > ta else 0))
        return -keys[-1][1]
    Z_END = zt(A["duration"])
    frac = lambda t: (LEAD + (t / A["duration"]) * (CYCLE - LEAD - HOLD)) / CYCLE
    parts, routes, interps = [], [], []
    panel = {"items": {}, "views": [], "interps": [], "replay": {"cycle": CYCLE, "lead": LEAD, "hold": HOLD, "duration": A["duration"]},
             "timemap": [[t, -z_] for t, z_ in keys]}
    unlit = lambda c, tr=0.0: '<Appearance><Material diffuseColor="0 0 0" emissiveColor="%s"%s/></Appearance>' % (rgb(c), ' transparency="%.2f"' % tr if tr else "")
    lit = lambda c, e=0.35, tr=0.0: '<Appearance><Material diffuseColor="%s" emissiveColor="%s" specularColor="0.15 0.15 0.15"%s/></Appearance>' % (
        f3(*(v * 0.7 for v in rgbf(c))), f3(*(v * e for v in rgbf(c))), ' transparency="%.2f"' % tr if tr else "")

    def text(pos, lines, size=0.25, col=PAL["ink"], justify="BEGIN", style="PLAIN", family="SANS", rot=None, minor="FIRST"):
        r = ' rotation="%s"' % f3(*rot) if rot else ""
        return ('<Transform translation="%s"%s><Shape>%s<Text string="%s"><FontStyle family=\'"%s"\' style="%s" size="%.3f" justify=\'"%s" "%s"\'/></Text></Shape></Transform>'
                % (f3(*pos), r, unlit(col), mf(*lines), family, style, size, justify, minor))

    def lines(segs, col, tr=0.0, colors=None):
        pts = [p for s in segs for p in s]
        cn = ('<Color color="%s"/>' % " ".join(f3(*c) for s in colors for c in s)) if colors else ""
        return '<Shape>%s<LineSet vertexCount="%s"><Coordinate point="%s"/>%s</LineSet></Shape>' % (
            unlit(col, tr), " ".join(str(len(s)) for s in segs), " ".join(f3(*p) for p in pts), cn)

    def tube(pts, r, app, n=8):
        cs = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
        return '<Shape>%s<Extrusion creaseAngle="1.6" beginCap="false" endCap="false" solid="false" crossSection="%s" spine="%s"/></Shape>' % (
            app, " ".join(f3(*c) for c in cs), " ".join(f3(*p) for p in pts))

    def route(a, af, b, bf):
        routes.append((a, af, b, bf))

    # floor and rails
    floor_len = -Z_END + 4
    parts.append('<Transform translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (
        f3(0, -0.03, Z_END / 2 + 1), lit("#0f172a", 0.6), f3(len(order) * RAIL_GAP + 6, 0.02, floor_len + 4)))
    for h in order:
        x = X[h]
        H = A["hosts"][h]
        name = "H_" + re.sub(r"[^A-Za-z0-9]", "_", h)
        roles = sorted(H["roles"]) or ["host"]
        inner = ('<Transform translation="%s"><Shape>%s<Box size="0.16 0.12 %s"/></Shape></Transform>' % (f3(x, 0.06, Z_END / 2 + 0.5), lit(PAL["rail"], 0.4), f3(-Z_END + 1))
                 + '<Transform translation="%s"><Shape>%s<Box size="1.6 2.2 0.25"/></Shape></Transform>' % (f3(x, 1.1, 1.4), lit("#1e293b", 0.5)))
        parts.append('<Group>%s<TouchSensor DEF="T_%s" description="%s"/></Group>' % (inner, name, attr("host %s: %s" % (h, ", ".join(roles)))))
        parts.append(text((x, 1.75, 1.55), [h], size=0.26, col=PAL["ink"], justify="MIDDLE", style="BOLD"))
        parts.append(text((x, 1.35, 1.55), roles[:3], size=0.15, col=PAL["ink2"], justify="MIDDLE"))
        parts.append(text((x, 0.45, 1.55), ["sent %d · recv %d" % (H["sent"], H["recv"])], size=0.15, col=PAL["ink2"], justify="MIDDLE"))
        panel["items"]["T_" + name] = {"kind": "host", "title": h, "body": {
            "roles (from what it did)": ", ".join(roles), "packets sent / received": "%d / %d" % (H["sent"], H["recv"]),
            "bytes sent / received (frame lengths)": "%d / %d" % (H["bytes_sent"], H["bytes_recv"]),
            "UDP/TCP ports seen": ", ".join(str(p) for p in sorted(H["ports"])), "MAC addresses": ", ".join(sorted(H["macs"])) or "n/a"}}
    # time ruler on the left
    xl = X[order[0]] - 2.2
    ticks, labs = [], []
    t = 0.0
    while t <= A["duration"] + 1e-9:
        zz = zt(t)
        ticks.append([(xl, 0.01, zz), (xl + 0.5, 0.01, zz)])
        labs.append(text((xl - 0.1, 0.02, zz), ["%.0f s" % t], size=0.22, col=PAL["ink2"], justify="END", rot=(1, 0, 0, -1.5708), minor="MIDDLE"))
        t += 2.0
    for m in A["sip"]:
        ticks.append([(xl + 0.2, 0.01, zt(m["t"])), (xl + 0.5, 0.01, zt(m["t"]))])
    parts.append(lines(ticks, PAL["ink2"]) + "".join(labs))
    parts.append(lines([[(xl + 0.5, 0.01, 0.3), (xl + 0.5, 0.01, Z_END)]], PAL["ink2"]))
    parts.append(text((xl - 0.1, 0.02, 1.2), ["capture time", "(signalling spread out,", "min %.1f m between events)" % MIN_GAP], size=0.17, col=PAL["ink2"], justify="END", rot=(1, 0, 0, -1.5708)))
    # SIP arcs
    call_ix = {c["call_id"]: i for i, c in enumerate(A["calls"])}
    for k, m in enumerate(A["sip"]):
        xa, xb, zz = X[m["src"]], X[m["dst"]], zt(m["t"])
        st = m.get("status")
        col = PAL["req"] if m.get("method") and m["method"] != "REGISTER" else PAL["reg"] if m.get("method") == "REGISTER" else (
            PAL["resp2"] if st and st < 300 and st >= 200 else PAL["resp4"] if st and st >= 400 else PAL["resp1"])
        h = ARC_H * (0.7 + 0.3 * (call_ix.get(m["headers"].get("call-id"), 0) % 3) / 2)
        pts = []
        for i in range(25):
            u = i / 24
            pts.append((xa + (xb - xa) * u, 0.15 + h * math.sin(math.pi * u), zz))
        label = m.get("method") or "%d %s" % (st, m.get("reason", ""))
        if m.get("sdp"):
            label += " (SDP)"
        name = "S_%d" % k
        head = pts[-1]
        dirx = 1 if xb > xa else -1
        arrow = '<Transform translation="%s" rotation="0 0 1 %s"><Shape>%s<Cone bottomRadius="0.11" height="0.3"/></Shape></Transform>' % (
            f3(head[0] - dirx * 0.12, head[1] + 0.12, zz), f3(dirx * 2.5), lit(col, 0.6))
        inner = tube(pts, 0.035, lit(col, 0.55)) + arrow + text(((xa + xb) / 2, 0.15 + h + 0.12, zz), [label], size=0.2, col=col, justify="MIDDLE", style="BOLD")
        parts.append('<Transform DEF="%s_pop" scale="0.0001 0.0001 0.0001" center="%s"><Group>%s<TouchSensor DEF="T_%s" description="%s"/></Group></Transform>' % (
            name, f3((xa + xb) / 2, 0, zz), inner, name, attr("%.3f s  %s -> %s  %s" % (m["t"], m["src"], m["dst"], m["first"][:60]))))
        k0 = frac(m["t"])
        parts.append('<PositionInterpolator DEF="I_%s" key="0 %s %s 1" keyValue="0.0001 0.0001 0.0001 0.0001 0.0001 0.0001 1 1 1 1 1 1"/>' % (name, "%.5f" % (k0 - 1e-4), "%.5f" % k0))
        route("Replay", "fraction_changed", "I_" + name, "set_fraction")
        route("I_" + name, "value_changed", name + "_pop", "set_scale")
        interps.append("I_" + name)
        # flying packet: visual travel 0.6 s of replay (not the network latency, which is milliseconds)
        k1 = min(0.999, k0 + 0.6 / CYCLE)
        samp = [pts[int(i * 24 / 8)] for i in range(9)]
        parts.append('<Transform DEF="%s_fly" translation="%s" scale="0.0001 0.0001 0.0001"><Shape>%s<Sphere radius="0.13"/></Shape></Transform>' % (name, f3(*samp[0]), lit("#ffffff", 0.9)))
        ks = [k0 + (k1 - k0) * i / 8 for i in range(9)]
        parts.append('<PositionInterpolator DEF="I_%s_pos" key="0 %s 1" keyValue="%s"/>' % (name, " ".join("%.5f" % k for k in ks), " ".join(f3(*p) for p in [samp[0]] + samp + [samp[-1]])))
        parts.append('<PositionInterpolator DEF="I_%s_sc" key="0 %.5f %.5f %.5f %.5f 1" keyValue="0.0001 0.0001 0.0001 0.0001 0.0001 0.0001 1 1 1 1 1 1 0.0001 0.0001 0.0001 0.0001 0.0001 0.0001"/>'
                     % (name, ks[0] - 1e-4, ks[0], ks[-1], ks[-1] + 1e-4))
        for nm, tgt, fld in (("I_%s_pos" % name, name + "_fly", "set_translation"), ("I_%s_sc" % name, name + "_fly", "set_scale")):
            route("Replay", "fraction_changed", nm, "set_fraction")
            route(nm, "value_changed", tgt, fld)
            interps.append(nm)
        nxt = next((r for r in A["sip"][k + 1:] if r["headers"].get("call-id") == m["headers"].get("call-id") and r["headers"].get("cseq") == m["headers"].get("cseq") and r.get("status")), None) if m.get("method") else None
        body = {"time": "%.6f s after capture start" % m["t"], "frame": m["frame"], "from -> to": "%s:%d -> %s:%d (UDP)" % (m["src"], m["sport"], m["dst"], m["dport"]),
                "start line": m["first"], "Call-ID": m["headers"].get("call-id"), "CSeq": m["headers"].get("cseq"), "From": m["headers"].get("from"), "To": m["headers"].get("to"),
                "User-Agent / Server": m["headers"].get("user-agent") or m["headers"].get("server"), "frame bytes": m["size"]}
        if nxt:
            body["first response"] = "%s %s after %.1f ms" % (nxt["status"], nxt.get("reason"), (nxt["t"] - m["t"]) * 1000)
        if m.get("sdp"):
            body["SDP media"] = "; ".join("%s port %d %s: %s" % (x["type"], x["port"], x["proto"], ", ".join(x["rtpmap"].values())) for x in m["sdp"]["media"])
            body["SDP connection"] = m["sdp"].get("conn")
        panel["items"]["T_" + name] = {"kind": "SIP %s" % ("request" if m.get("method") else "response"), "title": label, "body": {k_: v for k_, v in body.items() if v is not None}}
    # RTP streams: ribbon + beads (height = jitter), loss posts
    for si, s in enumerate(A["streams"]):
        xa, xb = X[s["src"]], X[s["dst"]]
        pk = s["packets_list"]
        jmax = max(1.0, max(r["jitter_ms"] for r in pk))
        yb = lambda j: 0.12 + 1.6 * j / jmax
        xm = (xa + xb) / 2
        name = "R_%d" % si
        # ribbon: a thin translucent band between the two rails over the stream's life
        za, zb = zt(s["first_t"]), zt(s["last_t"])
        band = '<Transform translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (f3(xm, 0.04, (za + zb) / 2), lit(PAL["rtp"], 0.3, 0.86), f3(abs(xb - xa) - 0.4, 0.04, abs(zb - za)))
        # jitter curve along the stream (one point per packet), at the mid line between rails
        jit = [(xm, yb(r["jitter_ms"]), zt(r["t"])) for r in pk]
        fence = [[(xm, 0.06, zt(r["t"])), (xm, yb(r["jitter_ms"]), zt(r["t"]))] for r in pk[::4]]
        loss = "".join('<Transform translation="%s"><Shape>%s<Cylinder radius="0.06" height="1.9"/></Shape></Transform>' % (f3(xm, 0.95, zt(g["t"])), lit(PAL["loss"], 0.6)) for g in s["gaps"])
        loss += "".join('<Transform translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (
            f3(xm, 0.07, (zt(g["t"]) + zt(g["t"] + g["dur_s"])) / 2), lit("#f2b84b", 0.35, 0.86), f3(abs(xb - xa) - 0.3, 0.02, abs(zt(g["t"] + g["dur_s"]) - zt(g["t"])))) for g in s["pauses"])
        arrows = lines([[(xa, 0.08, zt(r["t"])), (xb, 0.08, zt(r["t"]))] for r in pk[::10]], PAL["rtp"], tr=0.55)
        inner = band + lines([jit], PAL["rtp"]) + lines(fence, PAL["rtp"], tr=0.6) + arrows + loss
        # reveal with the playhead: grow along -Z from the first packet
        parts.append('<Transform DEF="%s_grow" center="%s" scale="1 1 0.0001"><Group>%s<TouchSensor DEF="T_%s" description="%s"/></Group></Transform>' % (
            name, f3(xm, 0, za), inner, name, attr("RTP %s %s %s:%d -> %s:%d, %d packets" % (s["ssrc"], s["codec"], s["src"], s["sport"], s["dst"], s["dport"], s["packets"]))))
        parts.append('<PositionInterpolator DEF="I_%s" key="0 %.5f %.5f 1" keyValue="1 1 0.0001 1 1 0.0001 1 1 1 1 1 1"/>' % (name, frac(s["first_t"]), frac(s["last_t"])))
        route("Replay", "fraction_changed", "I_" + name, "set_fraction")
        route("I_" + name, "value_changed", name + "_grow", "set_scale")
        interps.append("I_" + name)
        parts.append(text((xm, 2.05, za - 0.3), ["RTP %s · %s" % (s["codec"], s["ssrc"]), "%d pkts · %.0f pkt/s · loss %.2f %% · jitter max %.1f ms" % (s["packets"], s["rate_pps"], s["loss_pct"], s["jitter_max_ms"])],
                          size=0.2, col=PAL["rtp"], justify="MIDDLE", style="BOLD"))
        parts.append(text((xm + 0.15, yb(jmax) + 0.1, za - 1.5), ["jitter %.1f ms" % jmax], size=0.15, col=PAL["ink2"]))
        sb = {k_: (round(v, 3) if isinstance(v, float) else v) for k_, v in s.items() if k_ not in ("packets_list", "gaps", "signalled_by", "pauses")}
        sb["pauses (> 200 ms)"] = "; ".join("%.3f s for %.3f s (RTP clock +%.3f s, seq %s)" % (g["t"], g["dur_s"], g["rtp_clock_advance_s"], "continuous" if g["seq_continuous"] else "jumped") for g in s["pauses"]) or "none"
        sb["gaps (sequence)"] = ", ".join("after seq %d: %d missing at %.3f s" % (g["after_seq"], g["missing"], g["t"]) for g in s["gaps"]) or "none"
        if s["signalled_by"]:
            sb["signalled in"] = "SDP of %s from %s (Call-ID %s)" % (s["signalled_by"]["in"], s["signalled_by"]["offered_by"], (s["signalled_by"]["call"] or "")[:30])
        sb["method"] = "jitter: RFC 3550 interarrival estimate J += (|D| - J)/16 with the codec clock; loss: sequence-number gaps"
        panel["items"]["T_" + name] = {"kind": "RTP stream", "title": "%s %s -> %s" % (s["codec"], s["src"], s["dst"]), "body": sb}
        panel.setdefault("jitter", []).append({"stream": name, "t": [round(r["t"], 4) for r in pk], "j": [round(r["jitter_ms"], 3) for r in pk]})
    # playhead
    W = len(order) * RAIL_GAP + 2
    parts.append('<Transform DEF="Playhead" translation="0 0 0"><Shape>%s<Box size="%s 2.2 0.015"/></Shape></Transform>' % (unlit(PAL["play"], 0.9), f3(W)))
    parts.append('<Transform DEF="PlayheadLine" translation="0 0 0"><Shape>%s<Box size="%s 0.03 0.03"/></Shape></Transform>' % (unlit(PAL["play"]), f3(W)))
    pk_keys = [0.0] + [frac(t) for t, _ in keys] + [1.0]
    pk_vals = [(0, 1.3, 0)] + [(0, 1.3, -z_) for _, z_ in keys] + [(0, 1.3, -keys[-1][1])]
    for nm, tgt, dy in (("I_playhead", "Playhead", 1.3), ("I_playline", "PlayheadLine", 0.02)):
        parts.append('<PositionInterpolator DEF="%s" key="%s" keyValue="%s"/>' % (nm, " ".join("%.5f" % k for k in pk_keys), " ".join(f3(v[0], dy, v[2]) for v in pk_vals)))
        route("Replay", "fraction_changed", nm, "set_fraction")
        route(nm, "value_changed", tgt, "set_translation")
        interps.append(nm)
    # title
    xr = X[order[-1]] + 2.6
    first = datetime.fromtimestamp(A["t0"], timezone.utc)
    parts.append(text((X[order[0]] - 2.0, 0.02, 4.6), ["VoIP call capture in 3D"], size=0.6, col=PAL["ink"], style="BOLD", rot=(1, 0, 0, -1.5708)))
    parts.append(text((X[order[0]] - 2.0, 0.02, 5.2), ["REAL CAPTURE · Wireshark test file %s (%d bytes, sha256 %s…) · %d packets · %.2f s · first packet %s UTC"
                                                       % (os.path.basename(A["path"]), A["bytes"], A["sha256"][:12], A["packets"], A["duration"], first.strftime("%Y-%m-%d %H:%M:%S"))],
                       size=0.2, col=PAL["ink2"], rot=(1, 0, 0, -1.5708)))
    # viewpoints
    cx = 0.0
    zc = Z_END / 2
    c2 = max((c["start"] for c in A["calls"] if c["kind"] == "call"), default=A["duration"] / 2)   # last INVITE dialog
    views = [("VP_overview", "Overview", (cx - 15, 14, 15), (cx + 1, 0.0, zc * 0.7)),
             ("VP_ladder", "Ladder (top-down)", (cx, 64, zc + 0.01), (cx, 0, zc)),
             ("VP_setup", "Call setup", (cx - 4, 8.5, 6.5), (cx, 0.5, zt(8.5) / 2)),
             ("VP_rtp", "RTP jitter and pauses", ((X[A["streams"][0]["src"]] + X[A["streams"][0]["dst"]]) / 2 + 7, 4.5, zt(A["streams"][0]["first_t"]) + 1.5) if A["streams"] else (8, 4, -5),
              ((X[A["streams"][0]["src"]] + X[A["streams"][0]["dst"]]) / 2, 0.6, zt((A["streams"][0]["first_t"] + A["streams"][0]["last_t"]) / 2)) if A["streams"] else (0, 0, -10)),
             ("VP_call2", "Call 2: rings, no answer", (cx - 4, 7, zt(c2) + 7.5), (cx + 1, 0.6, zt(c2) - 1.5))]
    vp = ""
    for d, desc, pos, tgt in views:
        vp += '<Viewpoint DEF="%s" description="%s" position="%s" orientation="%s" centerOfRotation="%s"/>\n' % (d, attr(desc), f3(*pos), f3(*look_at(pos, tgt)), f3(*tgt))
        panel["views"].append([d, desc])
    panel["interps"] = interps
    panel["timeline"] = [{"t": m["t"], "label": m.get("method") or str(m.get("status")), "sensor": "T_S_%d" % k, "src": m["src"], "dst": m["dst"]} for k, m in enumerate(A["sip"])]
    panel["streams"] = [{"first_t": s["first_t"], "last_t": s["last_t"], "sensor": "T_R_%d" % i, "label": "RTP " + s["codec"]} for i, s in enumerate(A["streams"])]
    panel["findings"] = A["findings"]
    panel["capture"] = {"file": A["path"], "sha256": A["sha256"], "bytes": A["bytes"], "format": A["cap"]["format"], "writer": A["cap"]["app"],
                        "packets": A["packets"], "duration_s": round(A["duration"], 3), "first_packet_utc": first.isoformat(), "hosts": order,
                        "layers": dict(A["layers"]), "unclassified": dict(A["other"]), "malformed_blocks": A["cap"]["malformed"],
                        "calls": A["calls"], "rtcp_packets": len(A["rtcp"])}
    head = [("title", "VoIP call capture in 3D"), ("description", "A packet capture as a 3D ladder diagram: hosts as rails, SIP messages as arcs, RTP as a jitter ribbon."),
            ("generator", "capture-3d/build.py (Python %s)" % sys.version.split()[0]), ("source", "%s sha256 %s" % (A["path"], A["sha256"])),
            ("source-origin", "gitlab.com/wireshark/wireshark test/captures/sip-rtp.pcapng (fetched 2026-11-20)")]
    rt = "\n".join('<ROUTE fromNode="%s" fromField="%s" toNode="%s" toField="%s"/>' % r for r in routes)
    x3d = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
           '<X3D profile="Interchange" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">\n<head>\n'
           + "".join('<component name="%s" level="%d"/>\n' % c for c in [("Geometry3D", 4), ("PointingDeviceSensor", 1), ("Text", 1), ("Interpolation", 1), ("Time", 1), ("Navigation", 2)])
           + "".join('<meta name="%s" content="%s"/>\n' % (k, attr(v)) for k, v in head)
           + '</head>\n<Scene>\n<WorldInfo title="VoIP call capture in 3D"/>\n<Background skyColor="0.035 0.047 0.071 0.063 0.082 0.118" skyAngle="1.5708"/>\n'
           '<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>\n<DirectionalLight direction="-0.3 -0.8 -0.5" intensity="0.45"/>\n'
           + vp + '<TimeSensor DEF="Replay" cycleInterval="%s" loop="true"/>\n' % f3(CYCLE) + "\n".join(parts) + "\n" + rt + "\n</Scene>\n</X3D>\n")
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "capture-scene.x3d"), "w", encoding="utf-8").write(x3d)
    json.dump(panel, open(os.path.join(OUT, "capture-panel.json"), "w"), indent=1, default=lambda o: sorted(o) if isinstance(o, set) else str(o))
    rep = {"scene_bytes": len(x3d.encode()), "packets": A["packets"], "hosts": order, "sip_messages": len(A["sip"]), "calls": A["calls"],
           "streams": [{k_: v for k_, v in s.items() if k_ not in ("packets_list", "signalled_by")} for s in A["streams"]],
           "findings": A["findings"], "routes": len(routes), "interps": len(interps), "z_end": Z_END}
    json.dump(rep, open(os.path.join(OUT, "build-report.json"), "w"), indent=1, default=str)
    return rep


if __name__ == "__main__":
    r = build(sys.argv[1] if len(sys.argv) > 1 else CAP)
    print(json.dumps({k: v for k, v in r.items() if k != "streams"}, indent=1, default=str))
    for s in r["streams"]:
        print({k: v for k, v in s.items() if k != "gaps"}, "gaps:", s["gaps"][:5])
