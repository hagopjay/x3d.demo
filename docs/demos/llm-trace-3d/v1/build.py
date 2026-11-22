#!/usr/bin/env python3
"""Langfuse trace export -> X3D 4.0 scene + panel data (standard library + the vendored x3dtrace engine).

  python3 -I build.py [trace.json]      -> out/trace-scene.x3d, out/trace-panel.json, out/build-report.json

Layout (every number below is a layout choice made here, not a measurement):
  X  trace time, X_PER_S metres per second, origin at the trace start
  Y  nesting depth: root at Y0, each level DEPTH_STEP lower (a waterfall, as in the Langfuse UI)
  Z  thickness of a bar = tokens (sqrt-scaled, generations only); lineage threads arc toward the viewer in +Z
  band below the waterfall: the retrieved sources (and the tool output), threads to the cited values on the right,
  coloured by the x3dtrace verdict (verified / check / reworded / unchecked).
Replay: one TimeSensor drives every fill (bar grows from its startTime to its endTime), the playhead and the data packets.
Trace time T (s) maps to fraction (LEAD + T * SLOW) / CYCLE, so the run is replayed SLOW times slower than it ran.
"""
import hashlib, json, math, os, re, sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "vendor"))
import x3dtrace as X  # noqa: E402

TRACE = os.path.join(HERE, "trace", "langfuse-rag-support-agent.synthetic.json")
SPEC = os.path.join(HERE, "downloads", "langfuse-openapi", "openapi.yml")
OUT = os.path.join(HERE, "out")

X_PER_S, X0, Y0, DEPTH_STEP, BAR_H = 2.4, -9.0, 3.0, 1.5, 0.42
LEAD, SLOW, CYCLE = 0.8, 1.6, 16.0
TYPE_RGB = {"AGENT": "#64748b", "GENERATION": "#818cf8", "RETRIEVER": "#2dd4bf", "EMBEDDING": "#99f6e4", "TOOL": "#f2b84b",
            "GUARDRAIL": "#a3c585", "EVALUATOR": "#c4a1d6", "SPAN": "#94a3b8", "EVENT": "#e2e8f0", "CHAIN": "#94a3b8"}
VERDICT_RGB = {"verified": "#2dd4bf", "check": "#f87171", "reworded": "#f2b84b", "unchecked": "#6b7280"}
ERROR_RGB, WARN_RGB, INK, INK2, INK3 = "#f87171", "#f2b84b", "#e8edf3", "#94a3b8", "#475569"


# ---------- small helpers ----------
def rgb(h):
    h = h.lstrip("#")
    return "%.3f %.3f %.3f" % tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def f3(*v):
    return " ".join(("%.4f" % x).rstrip("0").rstrip(".") if abs(x) > 1e-9 else "0" for x in v)


def attr(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def mf(*lines):
    return attr(" ".join('"%s"' % str(s).replace("\\", "\\\\").replace('"', '\\"') for s in lines))


def did(s):
    return re.sub(r"[^A-Za-z0-9_]", "_", s)


def t_of(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def frac(t_s):
    return (LEAD + t_s * SLOW) / CYCLE


def wrap(text, n):
    out, line = [], ""
    for w in text.split():
        if len(line) + len(w) + 1 > n and line:
            out.append(line)
            line = w
        else:
            line = (line + " " + w).strip()
    return out + ([line] if line else [])


def money(c):
    return "$%.5f" % c if c is not None else "n/a"


def look_at(pos, target):
    """Viewpoint orientation (axis angle) that looks from pos at target with +Y up (yaw about Y, then pitch about X)."""
    dx, dy, dz = (target[i] - pos[i] for i in range(3))
    yaw = math.atan2(-dx, -dz)
    pitch = math.atan2(dy, math.hypot(dx, dz))
    qy = (0, math.sin(yaw / 2), 0, math.cos(yaw / 2))
    qx = (math.sin(pitch / 2), 0, 0, math.cos(pitch / 2))
    x1, y1, z1, w1 = qy
    x2, y2, z2, w2 = qx
    q = (w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
         w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2)
    ang = 2 * math.acos(max(-1, min(1, q[3])))
    s = math.sqrt(max(1e-12, 1 - q[3] ** 2))
    return (q[0] / s, q[1] / s, q[2] / s, ang) if ang > 1e-6 else (0, 1, 0, 0)


def bezier(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        pts.append(tuple(a * p0[k] + b * p1[k] + c * p2[k] + d * p3[k] for k in range(3)))
    return pts


# ---------- schema check against the Langfuse OpenAPI spec ----------
def spec_props(text, name):
    m = re.search(r"\n    %s:\n(.*?)(?=\n    [A-Za-z]\w*:\n)" % re.escape(name), text, re.S)
    if not m:
        return set(), set()
    block = m.group(1)
    props = set(re.findall(r"\n        (\w+):\n", block))
    req = set()
    r = re.search(r"\n      required:\n((?:        - \w+\n)+)", block + "\n")
    if r:
        req = set(re.findall(r"- (\w+)", r.group(1)))
    return props, req


def check_trace(doc):
    """Every ObservationV2 / Score key must be a property of the spec schema; every required one must be present."""
    if not os.path.exists(SPEC):
        return {"checked": False, "why": "spec file not found: " + SPEC}
    text = open(SPEC, encoding="utf-8").read()
    problems = []
    op, oreq = spec_props(text, "ObservationV2")
    bp, breq = spec_props(text, "BaseScore")
    extra = {"NUMERIC": spec_props(text, "NumericScore"), "BOOLEAN": spec_props(text, "BooleanScore"),
             "CATEGORICAL": spec_props(text, "CategoricalScore")}
    levels = set(re.findall(r"- (\w+)", re.search(r"\n    ObservationLevel:\n.*?enum:\n((?:        - \w+\n)+)", text, re.S).group(1)))
    for o in doc["observations"]["data"]:
        for k in o:
            if k not in op:
                problems.append("observation %s: %s not in ObservationV2" % (o["id"], k))
        for k in oreq - set(o):
            problems.append("observation %s: required %s missing" % (o["id"], k))
        if o.get("level") not in levels:
            problems.append("observation %s: level %s not in ObservationLevel" % (o["id"], o.get("level")))
    for s in doc["scores"]:
        sp, sreq = extra[s["dataType"]]
        allowed = bp | sp | {"dataType"}
        for k in s:
            if k not in allowed:
                problems.append("score %s: %s not in BaseScore+%sScore" % (s["id"], k, s["dataType"].title()))
        for k in (breq | sreq) - set(s):
            problems.append("score %s: required %s missing" % (s["id"], k))
    return {"checked": True, "spec_sha256": hashlib.sha256(text.encode()).hexdigest(), "observation_props": len(op),
            "observation_required": sorted(oreq), "problems": problems}


# ---------- model ----------
def load(path):
    raw = open(path, "rb").read()
    doc = json.loads(raw)
    obs = doc["observations"]["data"]
    t0 = min(t_of(o["startTime"]) for o in obs)
    by_id = {o["id"]: o for o in obs}
    for o in obs:
        o["_s"] = (t_of(o["startTime"]) - t0).total_seconds()
        o["_e"] = (t_of(o["endTime"]) - t0).total_seconds() if o.get("endTime") else None
        d, p = 0, o.get("parentObservationId")
        while p:
            d, p = d + 1, by_id[p].get("parentObservationId")
        o["_depth"] = d
        o["_ttft"] = (t_of(o["completionStartTime"]) - t0).total_seconds() if o.get("completionStartTime") else None
        u = o.get("usageDetails") or {}
        o["_tok"] = u.get("total")
    return doc, raw, obs, by_id


def lineage(doc, by_id):
    """Run x3dtrace over every generation that returned citations: sources = retrieved documents + tool outputs."""
    sources, meta = [], {}
    for o in doc["observations"]["data"]:
        out = o.get("output") or {}
        if o["type"] == "RETRIEVER" and isinstance(out, dict) and isinstance(out.get("documents"), list) and out["documents"] and isinstance(out["documents"][0], dict):
            for d in out["documents"]:
                sources.append(X.Source(d["id"], d["text"]))
                meta[d["id"]] = {"kind": "document", "title": d.get("title", d["id"]), "text": d["text"], "from": o["id"],
                                 "similarity": d.get("similarity")}
        if o["type"] == "TOOL" and out and o.get("level") != "ERROR":
            sid = "tool:" + o["name"]
            txt = json.dumps(out)
            sources.append(X.Source(sid, txt))
            meta[sid] = {"kind": "tool output", "title": o["name"] + " (attempt %s)" % (o.get("metadata") or {}).get("attempt", "?"),
                         "text": txt, "from": o["id"]}
    for o in doc["observations"]["data"]:   # rerank scores, where a SPAN ranked the documents
        out = o.get("output") or {}
        for r in out.get("ranked", []) if isinstance(out, dict) else []:
            if r["id"] in meta:
                meta[r["id"]]["rerank"] = r["score"]
                meta[r["id"]]["kept"] = r["score"] >= (o.get("metadata") or {}).get("cutoff", 0)
    claims, items = [], []
    for o in doc["observations"]["data"]:
        out = o.get("output") or {}
        if o["type"] == "GENERATION" and isinstance(out, dict) and out.get("citations"):
            rep = X.check_claims(out["citations"], sources)
            for c, it in zip(out["citations"], rep.items):
                d = it.to_dict()
                ans = out.get("answer", "")
                d["answer_span"], d["answer_occurrences"] = answer_span(ans, c)
                d["generation"] = o["id"]
                claims.append(c)
                items.append(d)
    return sources, meta, items


def answer_span(ans, claim):
    """Where a cited value sits in the answer: whole-token matches only (a "5" inside "2025-05-12" is not the value), and of
    several, the one whose surrounding words share most words with the quote. Returns (span or None, number of candidates)."""
    vs = str(claim["value"])
    hits = [m.span() for m in re.finditer(r"(?<![\w.\-])%s(?![\w\-]|\.\d)" % re.escape(vs), ans)]
    if not hits:
        return None, 0
    qw = set(re.findall(r"[a-z0-9]+", claim.get("quote", "").lower()))
    best = max(hits, key=lambda h: (len(qw & set(re.findall(r"[a-z0-9]+", ans[max(0, h[0] - 40):h[1] + 40].lower()))), -h[0]))
    return list(best), len(hits)


# ---------- X3D writer ----------
class Scene:
    def __init__(self):
        self.parts, self.routes, self.interps, self.touch = [], [], [], {}

    def add(self, s):
        self.parts.append(s)

    def mat(self, col, emis=0.25, transp=0.0, spec=True):
        e = " ".join("%.3f" % (float(v) * emis) for v in rgb(col).split())
        dcol = " ".join("%.3f" % (float(v) * 0.62) for v in rgb(col).split())
        t = ' transparency="%.2f"' % transp if transp else ""
        s = ' specularColor="0.12 0.12 0.12" shininess="0.3"' if spec else ""
        return '<Appearance><Material diffuseColor="%s" emissiveColor="%s"%s%s/></Appearance>' % (dcol, e, s, t)

    def unlit(self, col, transp=0.0):
        t = ' transparency="%.2f"' % transp if transp else ""
        return '<Appearance><Material diffuseColor="0 0 0" emissiveColor="%s"%s/></Appearance>' % (rgb(col), t)

    def text(self, pos, lines, size=0.2, col=INK, justify="BEGIN", family="SANS", style="PLAIN", spacing=1.15):
        self.add('<Transform translation="%s"><Shape>%s<Text string="%s"><FontStyle family=\'"%s"\' style="%s" size="%.3f" '
                 'spacing="%.2f" justify=\'"%s" "FIRST"\'/></Text></Shape></Transform>'
                 % (f3(*pos), self.unlit(col), mf(*lines), family, style, size, spacing, justify))

    def box(self, pos, size, app, defn=None):
        d = ' DEF="%s"' % defn if defn else ""
        self.add('<Transform%s translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (d, f3(*pos), app, f3(*size)))

    def tube(self, pts, radius, app, n=8):
        cs = [(radius * math.cos(2 * math.pi * i / n), radius * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
        self.add('<Shape>%s<Extrusion creaseAngle="1.6" beginCap="false" endCap="false" solid="false" crossSection="%s" spine="%s"/></Shape>'
                 % (app, " ".join(f3(*c) for c in cs), " ".join(f3(*p) for p in pts)))

    def lines(self, segs, col, transp=0.0):
        pts = [p for s in segs for p in s]
        self.add('<Shape>%s<LineSet vertexCount="%s"><Coordinate point="%s"/></LineSet></Shape>'
                 % (self.unlit(col, transp), " ".join(str(len(s)) for s in segs), " ".join(f3(*p) for p in pts)))

    def interp(self, name, keys, values, target, field):
        self.add('<PositionInterpolator DEF="%s" key="%s" keyValue="%s"/>' % (name, " ".join("%.5f" % k for k in keys),
                                                                               " ".join(f3(*v) for v in values)))
        self.routes.append(("Replay", "fraction_changed", name, "set_fraction"))
        self.routes.append((name, "value_changed", target, field))
        self.interps.append(name)

    def sensor(self, name, desc, inner):
        self.add('<Group>%s<TouchSensor DEF="%s" description="%s"/></Group>' % (inner, name, attr(desc)))


def xpos(t):
    return X0 + t * X_PER_S


def ypos(depth):
    return Y0 - depth * DEPTH_STEP


def thickness(o):
    if o["type"] in ("GENERATION", "EVALUATOR", "EMBEDDING") and o["_tok"]:
        return 0.3 + 0.9 * math.sqrt(o["_tok"] / 2500.0)      # 2500 tokens -> 1.2 m: a layout scale, not a measurement
    return 0.3 if o["_depth"] else 0.18


def build(trace_path=TRACE):
    doc, raw, obs, by_id = load(trace_path)
    schema = check_trace(json.loads(raw))     # on the file as read, before load() adds its _ keys
    sources, smeta, items = lineage(doc, by_id)
    S = Scene()
    panel = {"items": {}, "views": [], "interps": [], "timeline": [], "replay": {"lead": LEAD, "slow": SLOW, "cycle": CYCLE}}
    T_END = max(o["_e"] or o["_s"] for o in obs)
    scores_by_obs = {}
    for s in doc["scores"]:
        scores_by_obs.setdefault(s.get("observationId") or obs[0]["id"], []).append(s)

    # --- grid and time axis ---
    axis_y = Y0 - 2 * DEPTH_STEP - 1.95
    ticks, step = [], 0.5
    n = int(T_END / step) + 1
    grid = []
    for i in range(n + 1):
        t = i * step
        x = xpos(t)
        grid.append([(x, axis_y + 0.1, -0.9), (x, Y0 + 0.6, -0.9)])
        S.text((x, axis_y - 0.32, 0), ["%.1f s" % t], size=0.17, col=INK2, justify="MIDDLE")
    S.lines(grid, INK3, transp=0.55)
    S.lines([[(xpos(0), axis_y, 0), (xpos(n * step), axis_y, 0)]], INK2)
    S.text((xpos(n * step) + 0.3, axis_y - 0.06, 0), ["trace time"], size=0.15, col=INK2)

    # --- bars with greedy label slots (above0, below0, above1, below1) ---
    placed, bars = [], []
    all_bars = [(xpos(q["_s"]), xpos(q["_e"] if q["_e"] is not None else q["_s"] + 0.12), ypos(q["_depth"]) - BAR_H / 2 - 0.02,
                 ypos(q["_depth"]) + BAR_H / 2 + 0.02) for q in obs]
    for o in sorted(obs, key=lambda o: o["_s"]):
        d, typ = o["_depth"], o["type"]
        x0, y = xpos(o["_s"]), ypos(d)
        col = TYPE_RGB.get(typ, "#94a3b8")
        lvl = o.get("level") or "DEFAULT"
        name = "O_" + did(o["id"])
        meta = [typ]
        if o["_e"] is not None:
            meta.append("%.2f s" % (o["_e"] - o["_s"]))
        if o["_tok"]:
            meta.append("{:,} tok".format(o["_tok"]))
        if o.get("totalCost"):
            meta.append(money(o["totalCost"]))
        if lvl in ("ERROR", "WARNING"):
            meta.append(lvl)
        name_line = o["name"]
        w = max(len(name_line) * 0.2 * 0.56, len(" · ".join(meta)) * 0.13 * 0.56)
        # global placement: a label block (2 lines, 0.42 m tall) may not overlap another label or any bar
        L_ = ((o["_e"] or o["_s"]) - o["_s"]) * X_PER_S
        bars.append((x0, x0 + max(L_, 0.3), y - BAR_H / 2 - 0.02, y + BAR_H / 2 + 0.02))
        cands = []
        for row in range(3):
            cands.append((True, row, y + BAR_H / 2 + 0.36 + row * 0.48))
            cands.append((False, row, y - BAR_H / 2 - 0.27 - row * 0.48))
        cands.sort(key=lambda c: (c[1], not c[0]))
        above, row, ly = cands[0]
        for a_, r_, ly_ in cands:
            rect = (x0 - 0.05, x0 + w + 0.1, ly_ - 0.3, ly_ + 0.2)
            if not any(rect[0] < q[1] and rect[1] > q[0] and rect[2] < q[3] and rect[3] > q[2] for q in placed + all_bars):
                above, row, ly = a_, r_, ly_
                break
        placed.append((x0 - 0.05, x0 + w + 0.1, ly - 0.3, ly + 0.2))
        S.text((x0, ly, 0.05), [name_line], size=0.2, col=INK, style="BOLD")
        S.text((x0, ly - 0.2, 0.05), [" · ".join(meta)], size=0.13, col=ERROR_RGB if lvl == "ERROR" else (WARN_RGB if lvl == "WARNING" else INK2))
        if row:
            yb = y + BAR_H / 2 if above else y - BAR_H / 2
            S.lines([[(x0 + 0.02, yb, 0.02), (x0 + 0.02, ly + (-0.32 if above else 0.2), 0.02)]], INK3)
        info = {"kind": "%s observation" % typ, "title": o["name"], "body": obs_body(o, scores_by_obs.get(o["id"], []), by_id)}
        panel["items"]["T_" + did(o["id"])] = info
        panel["timeline"].append({"id": o["id"], "name": o["name"], "type": typ, "s": o["_s"], "e": o["_e"], "level": lvl,
                                  "sensor": "T_" + did(o["id"]), "depth": d})
        if o["_e"] is None:      # EVENT: a point in time -> a small diamond
            inner = ('<Transform translation="%s" rotation="0 0 1 0.7854"><Shape>%s<Box size="0.26 0.26 0.26"/></Shape></Transform>'
                     % (f3(x0, y, 0), S.mat(col, 0.5)))
            S.add('<Transform DEF="%s_pop" center="%s" scale="0.0001 0.0001 0.0001">' % (name, f3(x0, y, 0)))
            S.sensor("T_" + did(o["id"]), "%s %s at +%.3f s" % (typ, o["name"], o["_s"]), inner)
            S.add("</Transform>")
            S.interp("I_" + name, [0, frac(o["_s"]) - 1e-4, frac(o["_s"]), 1],
                     [(1e-4,) * 3, (1e-4,) * 3, (1, 1, 1), (1, 1, 1)], name + "_pop", "set_scale")
            continue
        L = (o["_e"] - o["_s"]) * X_PER_S
        th = thickness(o)
        ghost_col = ERROR_RGB if lvl == "ERROR" else col
        inner = ""
        inner += '<Transform translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (
            f3(x0 + L / 2, y, 0), S.mat(ghost_col, 0.15, 0.78), f3(L + 0.03, BAR_H + 0.03, th + 0.03))
        inner += ('<Transform translation="%s"><Transform DEF="%s_fill" scale="0.0001 1 1"><Transform translation="%s">'
                  '<Shape>%s<Box size="%s"/></Shape></Transform></Transform></Transform>'
                  % (f3(x0, y, 0), name, f3(L / 2, 0, 0), S.mat(ghost_col, 0.3 if lvl != "ERROR" else 0.45),
                     f3(L, BAR_H, th)))
        if o["_ttft"] is not None:     # first token: a thin white tick through the bar
            xt = xpos(o["_ttft"])
            inner += '<Transform translation="%s"><Shape>%s<Box size="0.03 %s 0.03"/></Shape></Transform>' % (
                f3(xt, y, th / 2 + 0.03), S.unlit("#ffffff"), f3(BAR_H + 0.14))
        if lvl == "ERROR":
            inner += ('<Transform translation="%s"><Shape>%s<Sphere radius="0.13"/></Shape></Transform>'
                      % (f3(x0 + L + 0.22, y, 0), S.mat(ERROR_RGB, 0.6)))
        S.sensor("T_" + did(o["id"]), "%s %s: %s" % (typ, o["name"], " · ".join(meta[1:])), inner)
        k0, k1 = frac(o["_s"]), frac(o["_e"])
        keys = [0, k0, k1, 1] if k0 > 0 else [0, k1, 1]
        vals = [(1e-4, 1, 1), (1e-4, 1, 1), (1, 1, 1), (1, 1, 1)] if k0 > 0 else [(1e-4, 1, 1), (1, 1, 1), (1, 1, 1)]
        S.interp("I_" + name, keys, vals, name + "_fill", "set_scale")

    # --- parent -> child connectors (waterfall ticks) ---
    segs = []
    for o in obs:
        p = o.get("parentObservationId")
        if p:
            xc = xpos(o["_s"]) + 0.02
            segs.append([(xc, ypos(by_id[p]["_depth"]) - BAR_H / 2, 0), (xc, ypos(o["_depth"]) + BAR_H / 2, 0)])
    S.lines(segs, INK2, transp=0.2)

    # --- retry edge: failed TOOL attempt -> next attempt of the same tool ---
    tools = sorted([o for o in obs if o["type"] == "TOOL"], key=lambda o: o["_s"])
    for a, b in zip(tools, tools[1:]):
        if a["name"] == b["name"] and a.get("level") == "ERROR":
            ya = ypos(a["_depth"])
            xa, xb = (xpos(a["_s"]) + xpos(a["_e"])) / 2, xpos(b["_s"]) + min(0.3, (b["_e"] - b["_s"]) * X_PER_S / 2)
            pts = bezier((xa, ya + BAR_H / 2 + 0.02, 0.3), (xa + 0.4, ya + 1.05, 0.5), (xb - 0.2, ya + 1.05, 0.5), (xb, ya + BAR_H / 2 + 0.02, 0.3), 20)
            S.tube(pts, 0.022, S.unlit(ERROR_RGB))
            S.text(((xa + xb) / 2, ya + 1.12, 0.5), ["retry"], size=0.14, col=ERROR_RGB, style="ITALIC", justify="MIDDLE")

    # --- scores lane ---
    lane_y = Y0 + 1.45
    used = []
    for oid, ss in scores_by_obs.items():
        o = by_id[oid]
        xe = xpos(o["_e"] if o["_e"] is not None else o["_s"])
        for s in ss:
            row = 0
            while any(abs(xe - u[0]) < 2.6 and u[1] == row for u in used):
                row += 1
            used.append((xe, row))
            yy = lane_y + row * 0.55
            good = (s["value"] >= 0.7) if s["dataType"] == "NUMERIC" else (s.get("stringValue") in ("False", "resolved") if s["name"] == "pii-detected" or s["dataType"] == "CATEGORICAL" else bool(s["value"]))
            col = "#2dd4bf" if good else "#f2b84b"
            if s["dataType"] == "NUMERIC":
                inner = ('<Transform translation="%s"><Shape>%s<Box size="0.9 0.08 0.08"/></Shape></Transform>'
                         '<Transform translation="%s"><Shape>%s<Box size="%s 0.12 0.12"/></Shape></Transform>'
                         % (f3(xe - 0.45, yy, 0), S.mat(INK3, 0.3), f3(xe - 0.9 + 0.45 * s["value"], yy, 0), S.mat(col, 0.5), f3(0.9 * s["value"])))
                label = "%s %.2f" % (s["name"], s["value"])
            else:
                inner = ('<Transform translation="%s" rotation="1 0 0 1.5708"><Shape>%s<Cylinder radius="0.09" height="0.06"/></Shape></Transform>'
                         % (f3(xe - 0.1, yy, 0), S.mat(col, 0.5)))
                label = "%s: %s" % (s["name"], s.get("stringValue", s["value"]))
            inner += '<Transform translation="%s"><Shape>%s<Text string="%s"><FontStyle family=\'"SANS"\' size="0.14" justify=\'"BEGIN" "MIDDLE"\'/></Text></Shape></Transform>' % (
                f3(xe + 0.06, yy, 0), S.unlit(INK), mf(label + "  (" + s["source"] + ")"))
            S.sensor("T_score_" + did(s["id"]), "score %s" % label, inner)
            S.lines([[(xe, yy - 0.12, -0.02), (xe, ypos(o["_depth"]) + BAR_H / 2, -0.02)]], INK3, transp=0.3)
            panel["items"]["T_score_" + did(s["id"])] = {"kind": "score (%s, %s)" % (s["dataType"], s["source"]), "title": s["name"],
                                                         "body": {k: v for k, v in s.items() if v is not None}}
    S.text((xpos(0), lane_y + 0.02, 0), ["SCORES"], size=0.14, col=INK2, justify="END", style="BOLD")

    # --- lineage band: sources -> cited values -> answer ---
    src_y = axis_y - 1.55
    sids = list(smeta)
    src_x = {}
    for i, sid in enumerate(sids):
        m = smeta[sid]
        cx = xpos(0) + 0.9 + i * 2.55
        src_x[sid] = cx
        dim = m.get("kept") is False
        col = TYPE_RGB["TOOL"] if m["kind"] == "tool output" else TYPE_RGB["RETRIEVER"]
        sub = []
        if m.get("similarity") is not None:
            sub.append("sim %.3f" % m["similarity"])
        if m.get("rerank") is not None:
            sub.append("rerank %.2f" % m["rerank"])
        if dim:
            sub.append("dropped")
        body_lines = wrap(m["text"], 40)[:5]
        inner = ('<Transform translation="%s"><Shape>%s<Box size="2.35 1.45 0.05"/></Shape></Transform>'
                 '<Transform translation="%s"><Shape>%s<Box size="0.06 1.45 0.07"/></Shape></Transform>'
                 % (f3(cx, src_y, -0.03), S.mat("#1e293b", 0.6, 0.15 if not dim else 0.5), f3(cx - 1.15, src_y, -0.02), S.unlit(col, 0.6 if dim else 0)))
        S.sensor("T_src_" + did(sid), "%s %s" % (m["kind"], sid), inner)
        S.text((cx - 1.05, src_y + 0.52, 0.01), [m["title"]], size=0.15, col=INK if not dim else INK2, style="BOLD")
        S.text((cx - 1.05, src_y + 0.33, 0.01), [sid + ("   " + " · ".join(sub) if sub else "")], size=0.1, col=col if not dim else INK2, family="TYPEWRITER")
        S.text((cx - 1.05, src_y + 0.13, 0.01), body_lines, size=0.1, col=INK2 if not dim else INK3, spacing=1.25)
        used_by = [it["field"] for it in items if it["source"] == sid]
        panel["items"]["T_src_" + did(sid)] = {"kind": m["kind"], "title": m["title"],
                                                "body": {"source id": sid, "from observation": m["from"], "similarity": m.get("similarity"),
                                                         "rerank": m.get("rerank"), "kept after rerank": m.get("kept"),
                                                         "cited by": used_by or "nothing (no answer value quotes it)", "text": m["text"]},
                                                "highlight": [it["span"] for it in items if it["source"] == sid and it["span"]]}
        frm = by_id[m["from"]]       # thin link up to the observation that produced the source
        S.lines([[(cx, src_y + 0.73, -0.03), (min(max(cx, xpos(frm["_s"]) + 0.1), xpos(frm["_e"]) - 0.05), ypos(frm["_depth"]) - BAR_H / 2, -0.03)]], col, transp=0.55)
    S.text((xpos(0) - 0.3, src_y + 0.55, 0), ["SOURCES"], size=0.14, col=INK2, justify="END", style="BOLD")

    gen = by_id[items[0]["generation"]] if items else None
    cl_x = xpos(T_END) + 2.0
    top = Y0 + 0.35
    gap = (top - (src_y - 0.3)) / max(1, len(items) - 1) if items else 1
    for i, it in enumerate(items):
        cy = top - i * gap
        vcol = VERDICT_RGB[it["verdict"]]
        inner = ('<Transform translation="%s"><Shape>%s<Box size="3.3 0.78 0.05"/></Shape></Transform>'
                 '<Transform translation="%s"><Shape>%s<Box size="0.08 0.78 0.08"/></Shape></Transform>'
                 % (f3(cl_x + 1.65, cy, -0.03), S.mat("#1e293b", 0.6, 0.12), f3(cl_x + 0.04, cy, -0.02), S.unlit(vcol)))
        S.sensor("T_claim_%d" % (i + 1), "%s = %s (%s)" % (it["field"], it["value"], it["verdict"]), inner)
        S.text((cl_x + 0.2, cy + 0.2, 0.01), [str(it["value"])], size=0.2, col=INK, style="BOLD")
        S.text((cl_x + 3.2, cy + 0.2, 0.01), [it["verdict"].upper()], size=0.12, col=vcol, justify="END", style="BOLD")
        S.text((cl_x + 0.2, cy - 0.02, 0.01), [it["field"]], size=0.1, col=INK2, family="TYPEWRITER")
        S.text((cl_x + 0.2, cy - 0.2, 0.01), ["\u201c%s\u201d" % it["quote"][:52]], size=0.11, col=INK2, style="ITALIC")
        sx = src_x.get(it["source"])
        if sx is not None:
            p0 = (sx + 0.6, src_y + 0.73, 0.0)
            p3 = (cl_x - 0.02, cy, 0.0)
            pts = bezier(p0, (p0[0] + 1.5, p0[1] + 2.2, 2.4), (p3[0] - 3.5, p3[1] - 0.4, 2.4), p3, 30)
            S.tube(pts, 0.03 if it["verdict"] != "verified" else 0.022, S.unlit(vcol, 0.15 if it["verdict"] == "verified" else 0))
        cid = "claim %d" % (i + 1)
        src_text = smeta.get(it["source"], {}).get("text", "")
        panel["items"]["T_claim_%d" % (i + 1)] = {
            "kind": "cited value (x3dtrace %s)" % X.SCHEMA, "title": "%s = %s" % (it["field"], it["value"]),
            "body": {"verdict": it["verdict"], "find (quote in source)": it["status"], "compare (value in quote)": it["value_status"],
                     "quote": it["quote"], "source": it["source"], "locate (char span in source)": it["span"],
                     "occurrences": it["occurrences"], "note": it["note"] or None, "answer span": it["answer_span"], "answer candidates (whole-token)": it["answer_occurrences"],
                     "written by": "%s (%s)" % (gen["name"], gen["id"]) if gen else None, "source text": src_text},
            "highlight": [it["span"]] if it["span"] else [], "answer_span": it["answer_span"], "id": cid}
    S.text((cl_x, top + 0.75, 0), ["CITED VALUES", "x3dtrace: find · compare · locate"], size=0.14, col=INK2, style="BOLD")
    if gen:   # link from the generation's end to the cited-values column
        S.tube(bezier((xpos(gen["_e"]), ypos(gen["_depth"]), 0), (xpos(gen["_e"]) + 0.8, ypos(gen["_depth"]), 0.6),
                      (cl_x - 0.8, top + 0.2, 0.6), (cl_x - 0.02, top + 0.2, 0), 16), 0.02, S.unlit(TYPE_RGB["GENERATION"], 0.3))

    # answer card
    ans = (gen or {}).get("output", {}).get("answer", "")
    ax = cl_x + 3.8
    alines = wrap(ans, 44)
    ah = 0.62 + len(alines) * 0.17
    ay = top + 0.2 - ah / 2
    inner = '<Transform translation="%s"><Shape>%s<Box size="3.6 %s 0.05"/></Shape></Transform>' % (f3(ax + 1.8, ay, -0.03), S.mat("#1e293b", 0.6, 0.1), f3(ah))
    S.sensor("T_answer", "the answer the trace returned", inner)
    S.text((ax + 0.15, top + 0.0, 0.01), ["ANSWER  (%s output)" % (gen["name"] if gen else "")], size=0.13, col=TYPE_RGB["GENERATION"], style="BOLD")
    S.text((ax + 0.15, top - 0.25, 0.01), alines, size=0.12, col=INK, spacing=1.18)
    panel["items"]["T_answer"] = {"kind": "trace output", "title": "Answer", "body": {"answer": ans, "cited values": len(items),
                                  "verdicts": {v: sum(1 for it in items if it["verdict"] == v) for v in X.VERDICTS}},
                                  "answer_marks": [[it["answer_span"], it["verdict"]] for it in items if it["answer_span"]]}

    # --- data packets (motion that explains): source end -> consumer start ---
    flows = []
    if gen:
        for sid in sids:
            if smeta[sid].get("kept") is False:
                continue
            frm = by_id[smeta[sid]["from"]]
            flows.append((frm, gen, TYPE_RGB["TOOL"] if smeta[sid]["kind"] == "tool output" else TYPE_RGB["RETRIEVER"]))
        for o in obs:
            if o["type"] == "EVALUATOR":
                flows.append((gen, o, TYPE_RGB["EVALUATOR"]))
    seen = set()
    for k, (a, b, col) in enumerate(flows):
        key = (a["id"], b["id"])
        if key in seen:
            continue
        seen.add(key)
        p0 = ((xpos(a["_s"]) + xpos(a["_e"])) / 2, ypos(a["_depth"]) - BAR_H / 2, 0.25)
        p3 = (xpos(b["_s"]) + min(0.5, (b["_e"] - b["_s"]) * X_PER_S / 3), ypos(b["_depth"]) - BAR_H / 2, 0.25)
        dip = min(p0[1], p3[1]) - 0.55 - 0.08 * abs(p3[0] - p0[0])
        pts = bezier(p0, (p0[0], dip, 1.0), (p3[0], dip, 1.0), p3, 12)
        S.tube(pts, 0.012, S.unlit(col, 0.55))
        nm = "P_%d" % k
        S.add('<Transform DEF="%s" translation="%s" scale="0.0001 0.0001 0.0001"><Shape>%s<Sphere radius="0.11"/></Shape></Transform>'
              % (nm, f3(*p0), S.mat(col, 0.8)))
        t1 = a["_e"]
        t2 = max(b["_s"], t1 + 0.35)
        ks = [frac(t1) + (frac(t2) - frac(t1)) * i / 12 for i in range(13)]
        S.interp("I_%s_pos" % nm, [0] + ks + [1], [pts[0]] + pts + [pts[-1]], nm, "set_translation")
        S.interp("I_%s_scale" % nm, [0, ks[0] - 1e-4, ks[0], ks[-1], ks[-1] + 1e-4, 1],
                 [(1e-4,) * 3, (1e-4,) * 3, (1, 1, 1), (1, 1, 1), (1e-4,) * 3, (1e-4,) * 3], nm, "set_scale")

    # --- playhead ---
    ph_h = Y0 + 1.0 - axis_y
    ph_mid = axis_y + ph_h / 2
    S.add('<Transform DEF="Playhead" translation="%s"><Shape>%s<Box size="0.03 %s 0.03"/></Shape>'
          '<Transform translation="0 %s 0"><Shape>%s<Cone bottomRadius="0.12" height="0.22"/></Shape></Transform></Transform>'
          % (f3(xpos(0), ph_mid, 0.7), S.unlit("#fbbf24"), f3(ph_h), f3(ph_h / 2 + 0.11), S.unlit("#fbbf24")))
    S.interp("I_playhead", [0, frac(0), frac(T_END), 1],
             [(xpos(0), ph_mid, 0.7), (xpos(0), ph_mid, 0.7), (xpos(T_END), ph_mid, 0.7), (xpos(T_END), ph_mid, 0.7)], "Playhead", "set_translation")

    # --- title block ---
    tr = doc["trace"]
    tot_cost = sum(o.get("totalCost") or 0 for o in obs)
    tot_tok = sum(o["_tok"] or 0 for o in obs)
    S.text((xpos(0), Y0 + 3.15, 0), ["%s" % tr["name"]], size=0.42, col=INK, style="BOLD")
    S.text((xpos(0), Y0 + 2.62, 0), ["Langfuse trace %s · %s · %d observations · %.2f s · {:,} tokens · %s".format(tot_tok)
                                     % (tr["id"][:8], tr["timestamp"][:19].replace("T", " ") + " UTC", len(obs), T_END, money(tot_cost))],
           size=0.17, col=INK2)
    S.text((xpos(0), Y0 + 2.3, 0), ["SYNTHETIC DATA: invented trace in Langfuse ObservationV2 / Score schema; no live system behind any value"],
           size=0.15, col="#fbbf24", style="BOLD")

    # legend in-scene (types)
    lx, ly = cl_x + 3.8, axis_y - 0.4
    S.text((lx, ly + 0.35, 0), ["OBSERVATION TYPES"], size=0.13, col=INK2, style="BOLD")
    for i, typ in enumerate([t for t in TYPE_RGB if any(o["type"] == t for o in obs)]):
        yy = ly - i * 0.27
        S.box((lx + 0.12, yy + 0.05, 0), (0.22, 0.16, 0.05), S.mat(TYPE_RGB[typ], 0.4))
        S.text((lx + 0.32, yy, 0), [typ.lower()], size=0.13, col=INK)

    # --- viewpoints ---
    cx = (xpos(0) + cl_x + 7.4) / 2
    views = [
        ("VP_overview", "Overview", (cx - 1.5, 3.0, 22.5), (cx - 0.8, 0.5, 0)),
        ("VP_waterfall", "Waterfall (front)", (xpos(T_END / 2), 1.6, 17.0), (xpos(T_END / 2), 1.6, 0)),
        ("VP_lineage", "Lineage: sources to cited values", (cx - 1.0, -7.5, 20.5), (cx - 0.8, -1.4, 0)),
        ("VP_failure", "Failure and retry", (xpos(2.4), 2.6, 6.5), (xpos(2.4), 1.4, 0)),
        ("VP_side", "Side: tokens as thickness", (xpos(T_END) + 12.0, 3.0, 9.0), (xpos(T_END * 0.55), 1.2, 0)),
        ("VP_top", "High oblique: time and token depth", (cx - 1.0, 17.0, 13.0), (cx - 0.5, -0.5, -1.0)),
    ]
    vp_xml = []
    for d_, desc, pos, tgt in views:
        ax_ = look_at(pos, tgt)
        vp_xml.append('<Viewpoint DEF="%s" description="%s" position="%s" orientation="%s" centerOfRotation="%s" fieldOfView="0.7854"/>'
                      % (d_, attr(desc), f3(*pos), f3(*ax_), f3(*tgt)))
        panel["views"].append([d_, desc])
    panel["interps"] = S.interps
    panel["t_end"] = T_END
    panel["trace"] = {"id": tr["id"], "name": tr["name"], "timestamp": tr["timestamp"], "observations": len(obs), "tokens": tot_tok,
                      "cost_usd": round(tot_cost, 8), "synthetic": doc.get("_synthetic"), "question": tr["input"].get("question")}

    trace_sha = hashlib.sha256(raw).hexdigest()
    head = [("title", "%s trace in 3D" % tr["name"]),
            ("description", "Langfuse trace %s as an X3D 4.0 scene: waterfall by time and depth, scores, and value-level lineage "
                            "(x3dtrace) from retrieved sources to the answer. SYNTHETIC DATA." % tr["id"]),
            ("generator", "trace-3d/build.py (Python %s)" % sys.version.split()[0]),
            ("source", os.path.relpath(trace_path, HERE)), ("source-sha256", trace_sha),
            ("source-schema", "Langfuse openapi.yml sha256 %s: ObservationsV2Response, Score" % (schema.get("spec_sha256") or "n/a")),
            ("lineage-engine", "%s sha256 %s" % (X.SCHEMA, hashlib.sha256(open(X.__file__, "rb").read()).hexdigest())),
            ("data-label", "SYNTHETIC: invented for the demo")]
    body = "\n".join(S.parts)
    routes = "\n".join('<ROUTE fromNode="%s" fromField="%s" toNode="%s" toField="%s"/>' % r for r in S.routes)
    x3d = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
           '<X3D profile="Interchange" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" '
           'xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">\n<head>\n'
           '<component name="PointingDeviceSensor" level="1"/>\n<component name="Text" level="1"/>\n<component name="Interpolation" level="1"/>\n'
           '<component name="Geometry3D" level="4"/>\n<component name="Time" level="1"/>\n<component name="Navigation" level="2"/>\n'
           + "\n".join('<meta name="%s" content="%s"/>' % (k, attr(v)) for k, v in head) +
           '\n</head>\n<Scene>\n<WorldInfo title="%s"/>\n' % attr(tr["name"] + " trace in 3D") +
           '<Background skyColor="0.043 0.059 0.086 0.071 0.094 0.133 0.106 0.137 0.188" skyAngle="1.2 1.5708"/>\n'
           '<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>\n'
           '<DirectionalLight direction="-0.4 -0.7 -0.6" intensity="0.45" color="1 0.97 0.92"/>\n'
           + "\n".join(vp_xml) +
           '\n<TimeSensor DEF="Replay" cycleInterval="%s" loop="true"/>\n' % f3(CYCLE) + body + "\n" + routes + "\n</Scene>\n</X3D>\n")
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "trace-scene.x3d"), "w", encoding="utf-8").write(x3d)
    json.dump(panel, open(os.path.join(OUT, "trace-panel.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    report = {"trace": os.path.relpath(trace_path, HERE), "trace_sha256": trace_sha, "schema_check": schema,
              "observations": len(obs), "scores": len(doc["scores"]), "sources": len(sids), "claims": len(items),
              "verdicts": {v: sum(1 for it in items if it["verdict"] == v) for v in X.VERDICTS},
              "interpolators": len(S.interps), "routes": len(S.routes), "touch_sensors": len(panel["items"]),
              "scene_bytes": len(x3d.encode()), "replay": {"cycle_s": CYCLE, "slow_factor": SLOW, "lead_s": LEAD}}
    json.dump(report, open(os.path.join(OUT, "build-report.json"), "w"), indent=1)
    return report


def obs_body(o, scores, by_id):
    keep = ["type", "name", "id", "parentObservationId", "level", "statusMessage", "startTime", "endTime", "completionStartTime",
            "latency", "timeToFirstToken", "model", "modelParameters", "usageDetails", "costDetails", "totalCost", "promptName",
            "promptVersion", "metadata", "input", "output"]
    b = {}
    for k in keep:
        v = o.get(k)
        if v is None or v == {}:
            continue
        if k == "parentObservationId":
            v = "%s (%s)" % (by_id[v]["name"], v)
        b[k] = v
    if scores:
        b["scores"] = ["%s = %s (%s%s)" % (s["name"], s.get("stringValue", s["value"]), s["source"], "; " + s["comment"] if s.get("comment") else "")
                       for s in scores]
    return b


if __name__ == "__main__":
    r = build(sys.argv[1] if len(sys.argv) > 1 else TRACE)
    print(json.dumps(r, indent=1))
