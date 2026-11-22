#!/usr/bin/env python3
"""OpenTelemetry trace (OTLP JSON or Jaeger JSON) -> X3D 4.0 scene + panel data.  Standard library only.

  python3 -I build.py                         build the three presets below
  python3 -I build.py trace.json [name]       any OTLP / Jaeger JSON file -> out/<name>-scene.x3d, -panel.json, -report.json

Layout (every number here is a layout choice, not a measurement):
  X  trace time, X_LEN metres for the whole trace, origin at the first span's start
  Z  one rail per service, LANE_DZ apart, in order of each service's first span
  Y  rows on a rail: a span sits one row above its parent when the parent is on the same rail, and moves up when it would overlap
Colour = span kind; red = status ERROR; pink ribbon = critical path; arcs = cross-service calls (parent and child on different rails)
and span links.  Replay: one TimeSensor; trace time t maps to fraction (LEAD + t * SLOW) / CYCLE with SLOW = PLAY / T.
"""
import hashlib, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import otelread as R  # noqa: E402

OUT = os.path.join(HERE, "out")
DL = os.path.join(HERE, "downloads")
PRESETS = {
    "hotrod": {"file": "jaeger-skills/n_plus_one_full_serial.json", "manifest": "jaeger-skills/n_plus_one_full_serial.manifest.json",
               "title": "HotROD: GET /dispatch?customer=123",
               "label": "REAL CAPTURE: Jaeger HotROD demo (-W 1), captured 2026-08-19; whole trace, nothing removed. Jaeger repo testdata, Apache-2.0"},
    "otel-demo": {"file": "jaeger-skills/error_timeout_masked.json", "manifest": "jaeger-skills/error_timeout_masked.manifest.json",
                  "title": "OpenTelemetry Demo: user_checkout_multi",
                  "label": "REAL CAPTURE: OpenTelemetry Demo 2e72d8b, cartFailure flag on, captured 2026-08-06; trimmed by the fixture authors to 26 of 107 spans. Jaeger repo testdata, Apache-2.0"},
    "petclinic": {"file": "jaeger-ui/spanAmongEachOtherGroupedAndSpans.json", "manifest": None,
                  "title": "Spring PetClinic: GET /api/customer/owners",
                  "label": "TEST FIXTURE: jaeger-ui (Apache-2.0), Jaeger JSON; the repo does not say how it was captured"},
}

X_LEN, LANE_DZ, ROW0, ROW_H, BAR_H, BAR_D, MIN_W = 24.0, 2.6, 0.32, 0.5, 0.3, 0.6, 0.05
LEAD, PLAY, CYCLE, PACKET_S = 0.8, 13.0, 16.0, 0.6
KIND_RGB = {"SERVER": "#818cf8", "CLIENT": "#2dd4bf", "PRODUCER": "#f2b84b", "CONSUMER": "#c4a1d6", "INTERNAL": "#94a3b8", "UNSPECIFIED": "#64748b"}
EDGE_RGB = {"rpc": "#cbd5e1", "message": "#f2b84b", "call": "#94a3b8", "link": "#c4a1d6"}
CRIT, ERR, RETRY, GAP, INK, INK2, INK3, AMBER, REAL = "#e879f9", "#f87171", "#fb923c", "#fbbf24", "#e8edf3", "#94a3b8", "#475569", "#fbbf24", "#86efac"


# ---------- helpers (as in trace-3d) ----------
def rgb(h):
    h = h.lstrip("#")
    return "%.3f %.3f %.3f" % tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def f3(*v):
    return " ".join(("%.4f" % x).rstrip("0").rstrip(".") if abs(x) > 1e-9 else "0" for x in v)


def attr(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def ascii_(s):   # X_ITE's default font lacks arrows and some symbols: keep scene text ASCII
    return str(s).replace("→", "->").replace("×", "x").encode("ascii", "replace").decode()


def mf(*lines):
    return attr(" ".join('"%s"' % ascii_(s).replace("\\", "\\\\").replace('"', '\\"') for s in lines))


def did(s):
    return re.sub(r"[^A-Za-z0-9_]", "_", s)


def wrap(text, n):
    out, line = [], ""
    for w in str(text).split():
        if len(line) + len(w) + 1 > n and line:
            out.append(line)
            line = w
        else:
            line = (line + " " + w).strip()
    return out + ([line] if line else [])


def look_at(pos, target):
    dx, dy, dz = (target[i] - pos[i] for i in range(3))
    yaw = math.atan2(-dx, -dz)
    pitch = math.atan2(dy, math.hypot(dx, dz))
    x1, y1, z1, w1 = 0, math.sin(yaw / 2), 0, math.cos(yaw / 2)
    x2, y2, z2, w2 = math.sin(pitch / 2), 0, 0, math.cos(pitch / 2)
    q = (w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
         w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2)
    ang = 2 * math.acos(max(-1, min(1, q[3])))
    s = math.sqrt(max(1e-12, 1 - q[3] ** 2))
    return (q[0] / s, q[1] / s, q[2] / s, ang) if ang > 1e-6 else (0, 1, 0, 0)


def bezier(p0, p1, p2, p3, n=20):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        pts.append(tuple(a * p0[k] + b * p1[k] + c * p2[k] + d * p3[k] for k in range(3)))
    return pts


def nice_step(T, n=8):
    raw = T / n
    m = 10 ** math.floor(math.log10(raw))
    return next(m * k for k in (1, 2, 2.5, 5, 10) if m * k >= raw)


def tlabel(t, step):
    if step >= 1:
        return "%g s" % round(t, 3)
    if step >= 0.001:
        return "%g ms" % round(t * 1000, 3)
    return "%g us" % round(t * 1e6, 3)


class Scene:
    def __init__(self):
        self.parts, self.routes, self.interps = [], [], []

    def add(self, s):
        self.parts.append(s)

    def mat(self, col, emis=0.25, transp=0.0):
        e = " ".join("%.3f" % (float(v) * emis) for v in rgb(col).split())
        d = " ".join("%.3f" % (float(v) * 0.62) for v in rgb(col).split())
        t = ' transparency="%.2f"' % transp if transp else ""
        return '<Appearance><Material diffuseColor="%s" emissiveColor="%s" specularColor="0.12 0.12 0.12" shininess="0.3"%s/></Appearance>' % (d, e, t)

    def unlit(self, col, transp=0.0):
        t = ' transparency="%.2f"' % transp if transp else ""
        return '<Appearance><Material diffuseColor="0 0 0" emissiveColor="%s"%s/></Appearance>' % (rgb(col), t)

    def text_xml(self, pos, lines, size=0.2, col=INK, justify="BEGIN", style="PLAIN", family="SANS", spacing=1.15, minor="FIRST"):
        return ('<Transform translation="%s"><Shape>%s<Text string="%s"><FontStyle family=\'"%s"\' style="%s" size="%.3f" spacing="%.2f" '
                'justify=\'"%s" "%s"\'/></Text></Shape></Transform>' % (f3(*pos), self.unlit(col), mf(*lines), family, style, size, spacing, justify, minor))

    def text(self, *a, **k):
        self.add(self.text_xml(*a, **k))

    def box_xml(self, pos, size, app, rot=None):
        r = ' rotation="%s"' % rot if rot else ""
        return '<Transform translation="%s"%s><Shape>%s<Box size="%s"/></Shape></Transform>' % (f3(*pos), r, app, f3(*size))

    def box(self, *a, **k):
        self.add(self.box_xml(*a, **k))

    def tube(self, pts, radius, app, n=8):
        cs = [(radius * math.cos(2 * math.pi * i / n), radius * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
        self.add('<Shape>%s<Extrusion creaseAngle="1.6" beginCap="false" endCap="false" solid="false" crossSection="%s" spine="%s"/></Shape>'
                 % (app, " ".join(f3(*c) for c in cs), " ".join(f3(*p) for p in pts)))

    def lines(self, segs, col, transp=0.0):
        self.add('<Shape>%s<LineSet vertexCount="%s"><Coordinate point="%s"/></LineSet></Shape>'
                 % (self.unlit(col, transp), " ".join(str(len(s)) for s in segs), " ".join(f3(*p) for s in segs for p in s)))

    def interp(self, name, keys, values, target, field):
        self.add('<PositionInterpolator DEF="%s" key="%s" keyValue="%s"/>' % (name, " ".join("%.5f" % k for k in keys), " ".join(f3(*v) for v in values)))
        self.routes.append(("Replay", "fraction_changed", name, "set_fraction"))
        self.routes.append((name, "value_changed", target, field))
        self.interps.append(name)

    def sensor(self, name, desc, inner):
        self.add('<Group>%s<TouchSensor DEF="%s" description="%s"/></Group>' % (inner, name, attr(ascii_(desc))))


def build(path, name, title=None, label=None, manifest_path=None, trace_id=None):
    fmt, spans, tids = R.read(path, trace_id)
    by, roots, t0 = R.model(spans)
    manifest = json.load(open(manifest_path)) if manifest_path else None
    A = R.analyse(spans, by, roots, manifest)
    T = A["T"]
    SLOW = PLAY / T
    frac = lambda t: (LEAD + t * SLOW) / CYCLE   # noqa: E731
    xpos = lambda t: t / T * X_LEN               # noqa: E731
    raw = open(path, "rb").read()
    root = A["root"]
    title = title or "%s: %s" % (root["service"], root["name"])
    label = label or "TRACE FILE: %s (provenance not recorded here)" % os.path.basename(path)
    S = Scene()
    P = {"items": {}, "views": [], "timeline": [], "findings": A["findings"], "services": [], "replay": {"lead": LEAD, "slow": SLOW, "cycle": CYCLE}, "t_end": T}

    # --- lanes and rows ---
    svcs = sorted(A["services"], key=lambda k: A["services"][k]["first"])
    lane = {s: i for i, s in enumerate(svcs)}
    zof = lambda s: -lane[s["service"]] * LANE_DZ   # noqa: E731
    rows = {}   # service -> list of rows, each a list of (x0, x1)
    for s in sorted(spans, key=lambda s: (s["s"], s["depth"])):
        x0, x1 = xpos(s["s"]), max(xpos(s["e"]), xpos(s["s"]) + MIN_W)
        p = by.get(s["parent"])
        r = p["row"] + 1 if p is not None and p["service"] == s["service"] else 0
        rs = rows.setdefault(s["service"], [])
        while r < len(rs) and any(x0 < b - 1e-6 and x1 > a + 1e-6 for a, b in rs[r]):
            r += 1
        while len(rs) <= r:
            rs.append([])
        rs[r].append((x0, x1))
        s["row"] = r
    yof = lambda s: ROW0 + s["row"] * ROW_H   # noqa: E731
    max_rows = max(len(r) for r in rows.values())
    top_y = ROW0 + max_rows * ROW_H + 0.3
    z_back = -(len(svcs) - 1) * LANE_DZ
    zmid = z_back / 2

    # --- floor grid and time axis ---
    step = nice_step(T)
    grid, n = [], int(T / step + 1e-9)
    for i in range(n + 1):
        x = xpos(i * step)
        grid.append([(x, 0.0, 1.0), (x, 0.0, z_back - 1.0)])
        S.add('<Transform translation="%s" rotation="1 0 0 -1.5708">%s</Transform>' % (f3(x, 0.01, 1.25), S.text_xml((0, 0, 0), [tlabel(i * step, step)], size=0.32, col=INK2, justify="MIDDLE")))
    S.lines(grid, INK3, transp=0.6)
    S.add('<Transform translation="%s" rotation="1 0 0 -1.5708">%s</Transform>' % (f3(X_LEN + 0.6, 0.01, 1.25), S.text_xml((0, 0, 0), ["trace time"], size=0.28, col=INK2)))

    # --- service rails ---
    for sv in svcs:
        z, v = -lane[sv] * LANE_DZ, A["services"][sv]
        inner = S.box_xml((X_LEN / 2, 0.05, z), (X_LEN + 0.8, 0.06, BAR_D + 0.3), S.mat("#1e293b", 0.5))
        inner += S.box_xml((-0.62, 0.3, z), (0.08, 0.5, 0.08), S.unlit(CRIT if A["cp_by_svc"].get(sv, 0) >= 0.2 * A["cp_total"] else INK3))
        inner += S.text_xml((-0.85, 0.42, z + 0.3), [sv], size=0.3, col=INK, justify="END", style="BOLD")
        inner += S.text_xml((-0.85, 0.08, z + 0.3), ["self %s  |  %d span%s%s" % (R.ms(v["self"]), v["spans"], "" if v["spans"] == 1 else "s",
                                                                                  "  |  %d error%s" % (v["errors"], "" if v["errors"] == 1 else "s") if v["errors"] else "")],
                            size=0.16, col=ERR if v["errors"] else INK2, justify="END")
        inner += ('<Transform translation="%s" rotation="1 0 0 -1.5708">%s</Transform>'
                  % (f3(-0.85, 0.01, z + 0.15), S.text_xml((0, 0, 0), [sv], size=0.42, col=INK2, justify="END", style="BOLD", minor="MIDDLE")))
        sid = "S_%d" % lane[sv]
        S.sensor(sid, "service %s: self-time %s, %d spans" % (sv, R.ms(v["self"]), v["spans"]), inner)
        res = {k: x for k, x in v["resource"].items() if not k.startswith(("host.cpu", "process.command_args"))}
        P["items"][sid] = {"kind": "service (rail)", "title": sv, "body": {
            "self-time": R.ms(v["self"]), "share of all self-time": "%.1f%%" % (100 * v["self"] / A["self_sum"]) if A["self_sum"] else "n/a",
            "on the critical path": R.ms(A["cp_by_svc"].get(sv, 0)), "spans": v["spans"], "errors": v["errors"], "span kinds": v["kinds"],
            "operations": v["ops"], "resource attributes": res}}
        P["services"].append({"name": sv, "lane": lane[sv], "self": v["self"], "spans": v["spans"], "errors": v["errors"], "cp": A["cp_by_svc"].get(sv, 0), "sensor": sid})

    # --- span labels: one per run of same-named siblings on a rail ---
    lab, placed = {}, {}
    for s in sorted(spans, key=lambda s: s["s"]):
        key = (s["service"], s["name"], s["parent"], s["row"])
        if key in lab:
            lab[key]["n"] += 1
            lab[key]["e"] = s["e"]
            continue
        lab[key] = {"first": s, "n": 1, "e": s["e"]}
    for g in sorted(lab.values(), key=lambda g: g["first"]["s"]):
        s = g["first"]
        nm = s["name"] if len(s["name"]) <= 34 else s["name"][:32] + ".."
        txt = "%s  x%d" % (nm, g["n"]) if g["n"] > 1 else "%s  %s" % (nm, R.ms(s["dur"]))
        w = len(txt) * 0.16 * 0.55
        x0, y = xpos(s["s"]), yof(s) + BAR_H / 2 + 0.08
        pl = placed.setdefault(s["service"], [])
        bars = [(xpos(q["s"]), max(xpos(q["e"]), xpos(q["s"]) + MIN_W), yof(q) - BAR_H / 2, yof(q) + BAR_H / 2) for q in spans if q["service"] == s["service"]]
        for k in range(4):
            yy = y + k * 0.24
            rect = (x0, x0 + w, yy - 0.02, yy + 0.2)
            if not any(rect[0] < q[1] and rect[1] > q[0] and rect[2] < q[3] and rect[3] > q[2] for q in pl + bars):
                pl.append(rect)
                S.text((x0, yy, zof(s) + BAR_D / 2 + 0.02), [txt], size=0.16, col=ERR if s["status"] == "ERROR" else INK, minor="BEGIN")
                if k:
                    S.lines([[(x0 + 0.02, yof(s) + BAR_H / 2, zof(s) + BAR_D / 2 + 0.02), (x0 + 0.02, yy, zof(s) + BAR_D / 2 + 0.02)]], INK3)
                break

    # --- span bars ---
    for s in sorted(spans, key=lambda s: s["s"]):
        x0, y, z = xpos(s["s"]), yof(s), zof(s)
        L = max(xpos(s["e"]) - x0, MIN_W)
        col = ERR if s["status"] == "ERROR" else KIND_RGB.get(s["kind"], KIND_RGB["UNSPECIFIED"])
        nm = "B_" + s["id"]
        inner = S.box_xml((x0 + L / 2, y, z), (L + 0.02, BAR_H + 0.02, BAR_D + 0.02), S.mat(col, 0.15, 0.8))
        inner += ('<Transform translation="%s"><Transform DEF="%s_fill" scale="0.0001 1 1"><Transform translation="%s">'
                  '<Shape>%s<Box size="%s"/></Shape></Transform></Transform></Transform>'
                  % (f3(x0, y, z), nm, f3(L / 2, 0, 0), S.mat(col, 0.45 if s["status"] == "ERROR" else 0.3), f3(L, BAR_H, BAR_D)))
        for ev in s["events"]:
            ex = xpos(ev["ts"])
            if ev["name"] == "exception":
                c_, sz = ERR, 0.17
            elif re.search(r"retr(y|ied|ying)", ev["name"], re.I):
                c_, sz = RETRY, 0.15
            else:
                c_, sz = "#e2e8f0", 0.1
            inner += S.box_xml((ex, y + BAR_H / 2 + 0.02, z + BAR_D / 2 + 0.04), (sz, sz, 0.04), S.unlit(c_), rot="0 0 1 0.7854")
        if s["status"] == "ERROR":
            inner += '<Transform translation="%s"><Shape>%s<Sphere radius="0.11"/></Shape></Transform>' % (f3(x0 + L + 0.16, y, z), S.mat(ERR, 0.6))
        sid = "T_" + s["id"]
        S.sensor(sid, "%s %s / %s: %s%s" % (s["kind"].lower(), s["service"], s["name"], R.ms(s["dur"]), ", ERROR" if s["status"] == "ERROR" else ""), inner)
        k0, k1 = frac(s["s"]), frac(s["e"])
        S.interp("I_" + nm, [0, k0, max(k1, k0 + 1e-5), 1], [(1e-4, 1, 1), (1e-4, 1, 1), (1, 1, 1), (1, 1, 1)], nm + "_fill", "set_scale")
        P["items"][sid] = {"kind": "%s span" % s["kind"].lower(), "title": "%s / %s" % (s["service"], s["name"]), "body": span_body(s, by, A)}
        P["timeline"].append({"id": s["id"], "name": s["name"], "service": s["service"], "lane": lane[s["service"]], "row": s["row"], "s": s["s"], "e": s["e"],
                              "kind": s["kind"], "error": s["status"] == "ERROR", "cp": s["id"] in A["cp_by_span"], "sensor": sid})

    # --- critical path ribbons ---
    for sp, a, b in A["cp"]:
        if b - a <= 0:
            continue
        x0, x1 = xpos(a), xpos(b)
        S.box(((x0 + x1) / 2, yof(sp) + BAR_H / 2 + 0.035, zof(sp)), (max(x1 - x0, 0.02), 0.05, BAR_D * 0.7), S.unlit(CRIT))

    # --- cross-service arcs and links, with packets for the replay ---
    pk = 0
    for ed in A["edges"]:
        a, b = by[ed["from"]], by[ed["to"]]
        on_cp = ed["type"] != "link" and a["id"] in A["cp_by_span"] and b["id"] in A["cp_by_span"]
        xa = xpos(b["s"]) if ed["type"] != "link" else xpos(a["e"])
        xb = xpos(b["s"])
        p0 = (xa, yof(a) + BAR_H / 2, zof(a))
        p3 = (xb, yof(b) + BAR_H / 2, zof(b))
        h = max(p0[1], p3[1]) + 0.45 + 0.16 * abs(p3[2] - p0[2])
        pts = bezier(p0, (xa + (0.35 if ed["type"] == "link" else 0), h, p0[2]), (xb, h, p3[2]), p3, 20)
        col = CRIT if on_cp else EDGE_RGB[ed["type"]]
        S.tube(pts, 0.03 if on_cp else 0.016, S.unlit(col, 0 if on_cp else 0.35))
        if ed["type"] == "link":
            S.text(((xa + xb) / 2, h + 0.1, (p0[2] + p3[2]) / 2), ["link"], size=0.14, col=EDGE_RGB["link"], justify="MIDDLE", style="ITALIC")
        if pk < 40:
            nm = "P_%d" % pk
            pk += 1
            S.add('<Transform DEF="%s" translation="%s" scale="0.0001 0.0001 0.0001"><Shape>%s<Sphere radius="0.09"/></Shape></Transform>'
                  % (nm, f3(*p0), S.mat(col, 0.8)))
            k0 = frac(a["e"] if ed["type"] == "link" else b["s"])
            dk = PACKET_S / CYCLE
            ks = [k0 + dk * i / 20 for i in range(21)]
            ks = [min(k, 0.9999) for k in ks]
            S.interp("I_%s_pos" % nm, [0] + ks + [1], [pts[0]] + pts + [pts[-1]], nm, "set_translation")
            S.interp("I_%s_scale" % nm, [0, max(0, ks[0] - 1e-4), ks[0], ks[-1], min(1, ks[-1] + 1e-4), 1],
                     [(1e-4,) * 3, (1e-4,) * 3, (1, 1, 1), (1, 1, 1), (1e-4,) * 3, (1e-4,) * 3], nm, "set_scale")

    # --- retries: errored span -> its re-run ---
    for a, b, _ in A["reruns"]:
        y, z = yof(a) + BAR_H / 2, zof(a) + BAR_D / 2 + 0.05
        xa, xb = (xpos(a["s"]) + xpos(a["e"])) / 2, xpos(b["s"]) + min(0.15, (xpos(b["e"]) - xpos(b["s"])) / 2)
        pts = bezier((xa, y, z), (xa, y + 0.75, z + 0.25), (xb, y + 0.75, z + 0.25), (xb, y, z), 16)
        S.tube(pts, 0.02, S.unlit(RETRY))
        S.text(((xa + xb) / 2, y + 0.66, z + 0.25), ["retry"], size=0.13, col=RETRY, justify="MIDDLE", style="ITALIC")

    def flat(x, z, lines_, size, col):   # text lying on the floor, read from above and from oblique views
        S.add('<Transform translation="%s" rotation="1 0 0 -1.5708">%s</Transform>' % (f3(x, 0.03, z), S.text_xml((0, 0, 0), lines_, size=size, col=col, justify="MIDDLE", minor="FIRST")))

    # --- fan-out brackets (top groups) ---
    for f in A["fan"][:2]:
        ks = f["kids"]
        z = zof(ks[0]) + BAR_D / 2 + 0.3
        x0, x1 = xpos(min(k["s"] for k in ks)), xpos(max(k["e"] for k in ks))
        S.lines([[(x0, 0.03, z - 0.12), (x0, 0.03, z), (x1, 0.03, z), (x1, 0.03, z - 0.12)]], GAP)
        flat((x0 + x1) / 2, z + 0.1, ["%d x %s: %s" % (f["n"], f["name"], "serial (N+1 shape)" if f["conc"] == 1 else "up to %d parallel" % f["conc"])],
               0.2, GAP)

    # --- gaps ---
    for g in A["gaps"][:3]:
        if g["e"] - g["s"] < 0.01 * T:
            continue
        p = g["parent"]
        x0, x1 = xpos(g["s"]), xpos(g["e"])
        S.box(((x0 + x1) / 2, yof(p), zof(p)), (x1 - x0, BAR_H + 0.08, BAR_D + 0.08), S.unlit(GAP, 0.55))
        flat((x0 + x1) / 2, zof(p) + BAR_D / 2 + 0.75, ["gap %s" % R.ms(g["e"] - g["s"])], 0.2, GAP)

    # --- playhead: a translucent sheet across all rails ---
    H = top_y
    S.add('<Transform DEF="Playhead" translation="%s"><Shape>%s<Box size="%s"/></Shape>'
          '<Transform translation="%s"><Shape>%s<Cone bottomRadius="0.13" height="0.24"/></Shape></Transform></Transform>'
          % (f3(0, H / 2, zmid), S.unlit(AMBER, 0.9), f3(0.025, H, -z_back + 2.0), f3(0, H / 2 + 0.12, -zmid + 1.0), S.unlit(AMBER)))
    S.interp("I_playhead", [0, frac(0), frac(T), 1], [(0, H / 2, zmid), (0, H / 2, zmid), (X_LEN, H / 2, zmid), (X_LEN, H / 2, zmid)], "Playhead", "set_translation")

    # --- title block ---
    errs = len(A["errors"])
    tz = z_back - 1.6
    S.text((0, top_y + 1.75, tz), [title], size=0.62, col=INK, style="BOLD")
    S.text((0, top_y + 1.1, tz), ["trace %s  |  %d spans  |  %d services  |  %s  |  %d error%s  |  %s" % (root["trace"][:12], len(spans), len(svcs), R.ms(T), errs, "" if errs == 1 else "s", fmt)],
           size=0.26, col=INK2)
    S.text((0, top_y + 0.6, tz), [label], size=0.22, col=REAL if label.startswith("REAL") else AMBER, style="BOLD")

    # --- findings card (in the scene; the page shows the same list with evidence) ---
    cx, cy, cz = X_LEN + 4.0, top_y + 1.6, 0.4
    lines_ = []
    for f in A["findings"]:
        lines_.append(("t", f["title"]))
        body = wrap(f["text"], 70)
        for i, ln in enumerate(body[:3]):
            lines_.append(("b", ln + (" ..." if i == 2 and len(body) > 3 else "")))
        lines_.append(("g", ""))
    adv = {"t": 0.3, "b": 0.22, "g": 0.14}
    ch = 0.9 + sum(adv[k] for k, _ in lines_)
    inner = S.box_xml((cx + 4.3, cy - ch / 2 + 0.35, cz - 0.04), (8.9, ch, 0.05), S.mat("#111827", 0.6, 0.1))
    inner += S.box_xml((cx - 0.13, cy - ch / 2 + 0.35, cz - 0.03), (0.06, ch, 0.07), S.unlit(CRIT))
    yy = cy
    inner += S.text_xml((cx, yy, cz), ["FINDINGS  (computed from span times, status and events; evidence in the page panel)"], size=0.16, col=INK2, style="BOLD")
    yy -= 0.42
    for k, ln in lines_:
        if k == "g":
            yy -= adv[k]
            continue
        inner += S.text_xml((cx, yy, cz), [ln if k == "t" else "   " + ln], size=0.2 if k == "t" else 0.15, col=INK if k == "t" else INK2, style="BOLD" if k == "t" else "PLAIN")
        yy -= adv[k]
    S.sensor("T_findings", "findings card", inner)
    P["items"]["T_findings"] = {"kind": "findings", "title": "Findings", "body": {}, "findings": True}

    # legend (kinds present + marks)
    lx, ly = cx, cy - ch - 0.2
    S.text((lx, ly, cz), ["SPAN KIND (bar colour)"], size=0.15, col=INK2, style="BOLD")
    present = [k for k in KIND_RGB if any(s["kind"] == k for s in spans)]
    for i, k in enumerate(KIND_RGB):
        yy = ly - 0.35 - i * 0.28
        S.box((lx + 0.12, yy + 0.06, cz), (0.22, 0.16, 0.05), S.mat(KIND_RGB[k], 0.4, 0 if k in present else 0.6))
        S.text((lx + 0.35, yy, cz), [k.lower() + ("" if k in present else "  (none in this trace)")], size=0.14, col=INK if k in present else INK3)
    marks = [(ERR, "status ERROR (bar and dot)"), (CRIT, "critical path (ribbon, arc)"), (RETRY, "retry (arc, event)"), (GAP, "gap / fan-out bracket"),
             (EDGE_RGB["rpc"], "client -> server arc"), (EDGE_RGB["link"], "span link arc"), (AMBER, "replay playhead")]
    for i, (c_, t_) in enumerate(marks):
        yy = ly - 0.35 - i * 0.28
        S.box((lx + 4.32, yy + 0.06, cz), (0.22, 0.06, 0.05), S.unlit(c_))
        S.text((lx + 4.55, yy, cz), [t_], size=0.14, col=INK)

    # --- viewpoints ---
    first_err = min(A["errors"], key=lambda s: s["s"]) if A["errors"] else None
    loc = A["loci"][0][1] if A["loci"] else None
    fan = A["fan"][0]["kids"] if A["fan"] else None
    views = [("VP_overview", "Overview", (X_LEN * 0.56, 12.0 + 0.25 * -z_back, 15.0 + 0.2 * -z_back), (X_LEN * 0.48, 0.0, zmid + 0.6)),
             ("VP_lanes", "Rails from above: services by time", (X_LEN / 2, 20.0 + 0.8 * -z_back, zmid + 5.0), (X_LEN / 2, 0.0, zmid)),
             ("VP_front", "Critical path: high front", (X_LEN / 2, 8.5 + 0.2 * -z_back, 8.0), (X_LEN / 2, 0.6, zmid * 0.75)),
             ("VP_side", "Side: rails in depth", (X_LEN + 9.0, 5.5, zmid + 7.5), (X_LEN * 0.45, 0.5, zmid))]
    if first_err:
        t_ = loc if loc is not None else first_err
        xs = min(xpos(first_err["s"]) + 2.0, (xpos(first_err["s"]) + xpos(first_err["e"])) / 2)
        zs = (zof(first_err) + zof(t_)) / 2
        views.append(("VP_error", "Errors: %s" % first_err["name"], (xs + 1.2, yof(first_err) + 6.0, zs + 8.5), (xs + 0.8, yof(first_err), zs - 0.5)))
    if fan:
        xa, xb = xpos(fan[0]["s"]), xpos(fan[-1]["e"])
        views.append(("VP_fanout", "Fan-out: %d x %s" % (len(fan), fan[0]["name"]), ((xa + xb) / 2, yof(fan[0]) + 4.2, zof(fan[0]) + 3.6 + 0.55 * (xb - xa)),
                      ((xa + xb) / 2, yof(fan[0]), zof(fan[0]))))
    views.append(("VP_findings", "Findings card", (cx + 4.3, cy - ch / 2 + 0.2, cz + 11.5), (cx + 4.3, cy - ch / 2 + 0.2, cz)))
    vp_xml = []
    for d_, desc, pos, tgt in views:
        vp_xml.append('<Viewpoint DEF="%s" description="%s" position="%s" orientation="%s" centerOfRotation="%s" fieldOfView="0.7854"/>'
                      % (d_, attr(desc), f3(*pos), f3(*look_at(pos, tgt)), f3(*tgt)))
        P["views"].append([d_, desc])

    sha = hashlib.sha256(raw).hexdigest()
    P["interps"] = S.interps
    P["trace"] = {"id": root["trace"], "title": title, "label": label, "format": fmt, "spans": len(spans), "services": len(svcs), "errors": errs,
                  "source": os.path.relpath(path, HERE), "sha256": sha, "manifest": os.path.relpath(manifest_path, HERE) if manifest_path else None,
                  "traces_in_file": len(tids)}
    P["kinds"] = {k: KIND_RGB[k] for k in KIND_RGB}
    P["present_kinds"] = present
    head = [("title", "%s, an OpenTelemetry trace in 3D" % title),
            ("description", "Trace %s (%d spans, %d services) as an X3D 4.0 scene: services as rails, spans as bars by time, cross-service arcs, "
                            "critical path, errors and retries, with a findings card. %s" % (root["trace"], len(spans), len(svcs), label)),
            ("generator", "otel-trace-3d/build.py (Python %s, standard library)" % sys.version.split()[0]),
            ("source", os.path.relpath(path, HERE)), ("source-sha256", sha), ("source-format", fmt),
            ("data-label", label)]
    if manifest_path:
        head.append(("source-manifest-sha256", hashlib.sha256(open(manifest_path, "rb").read()).hexdigest()))
    routes = "\n".join('<ROUTE fromNode="%s" fromField="%s" toNode="%s" toField="%s"/>' % r for r in S.routes)
    x3d = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
           '<X3D profile="Interchange" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" '
           'xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">\n<head>\n'
           '<component name="PointingDeviceSensor" level="1"/>\n<component name="Text" level="1"/>\n<component name="Interpolation" level="1"/>\n'
           '<component name="Geometry3D" level="4"/>\n<component name="Time" level="1"/>\n<component name="Navigation" level="2"/>\n'
           + "\n".join('<meta name="%s" content="%s"/>' % (k, attr(v)) for k, v in head) +
           '\n</head>\n<Scene>\n<WorldInfo title="%s"/>\n' % attr(ascii_(title)) +
           '<Background skyColor="0.043 0.059 0.086 0.071 0.094 0.133 0.106 0.137 0.188" skyAngle="1.2 1.5708"/>\n'
           '<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>\n'
           '<DirectionalLight direction="-0.4 -0.7 -0.6" intensity="0.45" color="1 0.97 0.92"/>\n'
           + "\n".join(vp_xml) +
           '\n<TimeSensor DEF="Replay" cycleInterval="%s" loop="true"/>\n' % f3(CYCLE) + "\n".join(S.parts) + "\n" + routes + "\n</Scene>\n</X3D>\n")
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, name + "-scene.x3d"), "w", encoding="utf-8").write(x3d)
    json.dump(P, open(os.path.join(OUT, name + "-panel.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False, default=str)
    rep = {"name": name, "source": os.path.relpath(path, HERE), "sha256": sha, "format": fmt, "spans": len(spans), "services": svcs,
           "edges": {t: sum(1 for e in A["edges"] if e["type"] == t) for t in EDGE_RGB}, "critical_path_ms": round(A["cp_total"] * 1000, 3),
           "errors": errs, "reruns": len(A["reruns"]), "retry_events": len(A["retry_events"]), "findings": [f["title"] for f in A["findings"]],
           "interpolators": len(S.interps), "routes": len(S.routes), "touch_sensors": len(P["items"]), "views": len(views),
           "scene_bytes": len(x3d.encode()), "replay": {"cycle_s": CYCLE, "play_s": PLAY, "slow_factor": round(SLOW, 4)}}
    json.dump(rep, open(os.path.join(OUT, name + "-report.json"), "w"), indent=1)
    return rep


def span_body(s, by, A):
    b = {"service": s["service"], "operation": s["name"], "kind": s["kind"], "span id": s["id"], "trace id": s["trace"]}
    if s["parent"]:
        p = by[s["parent"]]
        b["parent"] = "%s / %s (%s)" % (p["service"], p["name"], p["id"])
    if s.get("orphan_of"):
        b["parent (not in file)"] = s["orphan_of"]
    b["start"] = "+" + R.ms(s["s"])
    b["duration"] = R.ms(s["dur"])
    b["self-time"] = "%s (duration minus children)" % R.ms(s["self"])
    if s["id"] in A["cp_by_span"]:
        b["on critical path"] = R.ms(A["cp_by_span"][s["id"]])
    b["status"] = s["status"] + (": " + s["status_msg"] if s["status_msg"] else "")
    for g, kv in R.groups(s["attrs"]).items():
        b["attributes: " + g] = kv
    if s["events"]:
        b["events"] = ["+%s  %s  %s" % (R.ms(e["ts"]), e["name"], json.dumps(e["attrs"], default=str) if e["attrs"] else "") for e in s["events"]]
    if s["links"]:
        b["links"] = ["%s %s" % (l["id"], "(in this trace)" if l["id"] in by else "(not in this file)") for l in s["links"]]
    b["children"] = len(s["kids"])
    if s["scope"]:
        b["instrumentation scope"] = s["scope"]
    return b


if __name__ == "__main__":
    a = sys.argv[1:]
    if a:
        print(json.dumps(build(a[0], a[1] if len(a) > 1 else re.sub(r"\W+", "-", os.path.splitext(os.path.basename(a[0]))[0])), indent=1))
    else:
        for nm, p in PRESETS.items():
            r = build(os.path.join(DL, p["file"]), nm, p["title"], p["label"], os.path.join(DL, p["manifest"]) if p["manifest"] else None)
            print(json.dumps(r, indent=1))
