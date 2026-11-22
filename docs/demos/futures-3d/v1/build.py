#!/usr/bin/env python3
"""ES and BTC futures week as a 3D market-profile scene (X3D 4.0) + panel data. Standard library only.

  python3 -I build.py      -> out/futures-scene.x3d, out/futures-panel.json, out/build-report.json

Data: downloads/yahoo/{ES=F,BTC=F}.1m.5d.json, Yahoo Finance chart endpoint (unofficial, delayed; CME continuous front
contracts; fetched 2026-11-20). Kept local for study; not redistributed.

Method (every derived number in the scene comes from these rules):
  sessions      RTH 09:30-16:00 America/New_York for each complete weekday; plus the overnight (Globex) session in progress
                18:00 ET previous day -> last bar. CME BTC futures use the same RTH window here so the two markets line up.
  brackets      30 minutes in RTH (letters A..M), 60 minutes overnight (letters a..)
  TPO           a bracket prints at every price bin between its high and low (classic TPO)
  volume@price  ESTIMATED from 1-minute OHLCV: each bar's volume spread evenly over the bins between its low and high
                (not tick data)
  value area    70 % of session volume, grown from the POC two bins at a time toward the larger side (CBOT rule)
  IB            initial balance = high/low of the first two RTH brackets (first hour)
  single prints price bins inside the session range touched by exactly one bracket
  naked POC     a session POC that no later bar (through the last bar in the file) traded through
  shape         HEURISTIC: trend if range > 2 x IB and close in the outer 20 % of the range; else P / b / D by POC position
  EMA 20 / 50   on 5-minute closes over the whole continuous series; RSI 14 (Wilder) on the same; VWAP per session from
                1-minute typical price x volume
Layout: X = time (sessions side by side, bracket columns), Y = price (one scale per market), Z = volume at price inside each
bracket (depth into the screen, square-root scale). Each session ends in its volume profile drawn as a horizontal histogram.
"""
import hashlib, json, math, os, re, sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
DL = os.path.join(HERE, "downloads", "yahoo")
OUT = os.path.join(HERE, "out")
ET = ZoneInfo("America/New_York")
MARKETS = [  # symbol, label, tick, bin, y0 of the price panel
    ("ES=F", "E-mini S&P 500 (CME ES, continuous)", 0.25, 2.0, 0.0),
    ("BTC=F", "Bitcoin futures (CME BTC, continuous)", 5.0, 100.0, 15.5),
]
W_RTH, W_ON = 0.36, 0.30          # metres per bracket column (layout)
WALL_W, GAP, PANEL_H = 2.3, 1.1, 9.0
DEPTH_MAX = 1.6                   # deepest cell (layout)
RSI_H, RSI_GAP = 2.2, 1.3
CYCLE, LEAD, HOLD = 26.0, 1.0, 3.0
PAL = {"up": "#2dd4bf", "down": "#f87171", "ema20": "#fbbf24", "ema50": "#c4a1d6", "vwap": "#e8edf3", "va": "#38bdf8",
       "poc": "#fbbf24", "out": "#475569", "single": "#f59e0b", "ib": "#a3c585", "naked": "#fbbf24", "ink": "#e8edf3",
       "ink2": "#94a3b8", "ink3": "#334155", "rsi_hi": "#f87171", "rsi_lo": "#2dd4bf", "rsi_mid": "#cbd5e1"}
RAMP = ["#1e3a8a", "#1d4ed8", "#2563eb", "#0284c7", "#0891b2", "#0d9488", "#14b8a6", "#65a30d", "#a3c585", "#ca8a04", "#eab308", "#f59e0b"]   # bracket colour by order (TPO letters): early blue -> late gold


# ---------- helpers ----------
def rgbf(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def rgb(h):
    return "%.3f %.3f %.3f" % rgbf(h)


def ramp(t):
    t = max(0.0, min(1.0, t)) * (len(RAMP) - 1)
    i = min(int(t), len(RAMP) - 2)
    a, b = rgbf(RAMP[i]), rgbf(RAMP[i + 1])
    f = t - i
    return tuple(a[k] + (b[k] - a[k]) * f for k in range(3))


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


def fmt_p(p, tick):
    return ("{:,.2f}" if tick < 1 else "{:,.0f}").format(p)


# ---------- data ----------
def load(sym):
    path = os.path.join(DL, sym + ".1m.5d.json")
    raw = open(path, "rb").read()
    r = json.loads(raw)["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    bars = []
    for i, t in enumerate(r["timestamp"]):
        o, h, l, c, v = (q[k][i] for k in ("open", "high", "low", "close", "volume"))
        if None in (o, h, l, c):
            continue
        bars.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v or 0})
    return bars, r["meta"], hashlib.sha256(raw).hexdigest(), os.path.relpath(path, HERE)


def sessions_of(bars):
    """Complete RTH sessions + the overnight session in progress at the last bar."""
    last = datetime.fromtimestamp(bars[-1]["t"], ET)
    days = sorted({datetime.fromtimestamp(b["t"], ET).date() for b in bars})
    out = []
    for d in days:
        s = datetime(d.year, d.month, d.day, 9, 30, tzinfo=ET)
        e = datetime(d.year, d.month, d.day, 16, 0, tzinfo=ET)
        if d.weekday() < 5 and last >= e:
            out.append({"kind": "RTH", "start": s, "end": e, "bracket_min": 30, "date": d.isoformat(),
                        "label": s.strftime("%a %d %b") + " RTH"})
    prev = last.date() - timedelta(days=1)
    s = datetime(prev.year, prev.month, prev.day, 18, 0, tzinfo=ET)
    if last.time() < datetime(2000, 1, 1, 9, 30).time() and last > s:
        out.append({"kind": "ON", "start": s, "end": last + timedelta(minutes=1), "bracket_min": 60, "date": last.date().isoformat(),
                    "label": "Overnight %s (in progress)" % last.strftime("%a %d %b"), "partial": True})
    return out


def resample5(bars):
    out = {}
    for b in bars:
        k = b["t"] - b["t"] % 300
        o = out.get(k)
        if o is None:
            out[k] = dict(b, t=k)
        else:
            o["h"], o["l"], o["c"], o["v"] = max(o["h"], b["h"]), min(o["l"], b["l"]), b["c"], o["v"] + b["v"]
    return [out[k] for k in sorted(out)]


def ema(vals, n):
    a, e, out = 2 / (n + 1), None, []
    for v in vals:
        e = v if e is None else e + a * (v - e)
        out.append(e)
    return out


def rsi(vals, n=14):
    out, ag, al = [None] * len(vals), None, None
    for i in range(1, len(vals)):
        ch = vals[i] - vals[i - 1]
        g, l_ = max(ch, 0), max(-ch, 0)
        if i <= n:
            ag = (ag or 0) + g / n
            al = (al or 0) + l_ / n
            if i < n:
                continue
        else:
            ag = (ag * (n - 1) + g) / n
            al = (al * (n - 1) + l_) / n
        out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


def analyse(sym, tick, bs):
    bars, meta, sha, rel = load(sym)
    S = sessions_of(bars)
    b5 = resample5(bars)
    closes = [b["c"] for b in b5]
    e20, e50, r14 = ema(closes, 20), ema(closes, 50), rsi(closes, 14)
    for b, a, c, r in zip(b5, e20, e50, r14):
        b["ema20"], b["ema50"], b["rsi"] = a, c, r
    binof = lambda p: int(math.floor(p / bs + 1e-9))
    for s in S:
        t0, t1 = s["start"].timestamp(), s["end"].timestamp()
        sb = [b for b in bars if t0 <= b["t"] < t1]
        s["bars1"] = sb
        s["bars5"] = [b for b in b5 if t0 <= b["t"] < t1]
        nbr = math.ceil((t1 - t0) / (s["bracket_min"] * 60) - 1e-9)
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if s["kind"] == "RTH" else "abcdefghijklmnopqrstuvwxyz"
        brs = []
        for k in range(nbr):
            a, z = t0 + k * s["bracket_min"] * 60, min(t1, t0 + (k + 1) * s["bracket_min"] * 60)
            bb = [b for b in sb if a <= b["t"] < z]
            br = {"k": k, "letter": letters[k], "start": a, "end": z, "bars": bb, "vol": {}, "tpo": set()}
            if bb:
                br.update(o=bb[0]["o"], h=max(b["h"] for b in bb), l=min(b["l"] for b in bb), c=bb[-1]["c"], v=sum(b["v"] for b in bb))
                br["tpo"] = set(range(binof(br["l"]), binof(br["h"]) + 1))
                for b in bb:
                    rng = range(binof(b["l"]), binof(b["h"]) + 1)
                    for i in rng:
                        br["vol"][i] = br["vol"].get(i, 0) + b["v"] / len(rng)
            brs.append(br)
        s["brackets"] = brs
        prof, tpoc = {}, {}
        for br in brs:
            for i, v in br["vol"].items():
                prof[i] = prof.get(i, 0) + v
            for i in br["tpo"]:
                tpoc[i] = tpoc.get(i, 0) + 1
        s["profile"], s["tpo_count"] = prof, tpoc
        s["o"], s["h"], s["l"], s["c"] = sb[0]["o"], max(b["h"] for b in sb), min(b["l"] for b in sb), sb[-1]["c"]
        s["v"] = sum(b["v"] for b in sb)
        lo, hi = min(prof), max(prof)
        V = [prof.get(i, 0) for i in range(lo, hi + 1)]
        p = max(range(len(V)), key=lambda i: (V[i], -abs(i - len(V) / 2)))
        a_, z_, acc, tot = p, p, V[p], sum(V)
        while acc < 0.7 * tot and (a_ > 0 or z_ < len(V) - 1):
            up = sum(V[z_ + 1:z_ + 3])
            dn = sum(V[max(0, a_ - 2):a_])
            if up >= dn and z_ < len(V) - 1:
                n = min(2, len(V) - 1 - z_)
                z_ += n
                acc += up
            else:
                n = min(2, a_)
                a_ -= n
                acc += dn
        s["poc_bin"], s["val_bin"], s["vah_bin"] = lo + p, lo + a_, lo + z_
        s["poc"] = (lo + p + 0.5) * bs
        s["val"], s["vah"] = (lo + a_) * bs, (lo + z_ + 1) * bs
        s["va_share"] = acc / tot if tot else None
        if s["kind"] == "RTH" and len(brs) >= 2:
            ib = [b for b in brs[:2] if b.get("bars")]
            s["ib_h"], s["ib_l"] = max(b["h"] for b in ib), min(b["l"] for b in ib)
        s["singles"] = sorted(i for i, n in tpoc.items() if n == 1 and binof(s["l"]) < i < binof(s["h"]))
        pv = sum((b["h"] + b["l"] + b["c"]) / 3 * b["v"] for b in sb)
        s["vwap_series"], cpv, cv = [], 0.0, 0.0
        for b in sb:
            cpv += (b["h"] + b["l"] + b["c"]) / 3 * b["v"]
            cv += b["v"]
            if cv:
                s["vwap_series"].append((b["t"], cpv / cv))
        s["vwap"] = pv / s["v"] if s["v"] else None
        R = s["h"] - s["l"]
        if s["kind"] == "RTH" and R > 0:
            ibr = s["ib_h"] - s["ib_l"]
            cpos = (s["c"] - s["l"]) / R
            ppos = (s["poc"] - s["l"]) / R
            if ibr > 0 and R > 2 * ibr and (cpos > 0.8 or cpos < 0.2):
                s["shape"] = "trend day (%s)" % ("up" if cpos > 0.8 else "down")
            else:
                s["shape"] = "P-shape" if ppos > 0.62 else ("b-shape" if ppos < 0.38 else "D-shape (balanced)")
        else:
            s["shape"] = "in progress"
    for i, s in enumerate(S):      # naked POC: no later bar's range contains it
        later = [b for b in bars if b["t"] >= s["end"].timestamp()]
        hit = next((b for b in later if b["l"] <= s["poc"] <= b["h"]), None)
        s["naked"] = hit is None and not s.get("partial")
        s["poc_touched_at"] = datetime.fromtimestamp(hit["t"], ET).strftime("%a %H:%M ET") if hit else None
    return {"sym": sym, "meta": meta, "sha": sha, "path": rel, "bars": bars, "b5": b5, "sessions": S, "tick": tick, "bs": bs}


def runs(bins, bs):
    """Contiguous bins -> [[low, high], ...] price ranges."""
    out = []
    for i in bins:
        if out and abs(out[-1][1] - i * bs) < 1e-9:
            out[-1][1] = (i + 1) * bs
        else:
            out.append([i * bs, (i + 1) * bs])
    return out


# ---------- scene ----------
class X:
    def __init__(self):
        self.p, self.routes, self.interps = [], [], []

    def add(self, s):
        self.p.append(s)

    @staticmethod
    def unlit(col, tr=0.0):
        t = ' transparency="%.2f"' % tr if tr else ""
        return '<Appearance><Material diffuseColor="0 0 0" emissiveColor="%s"%s/></Appearance>' % (rgb(col) if isinstance(col, str) else f3(*col), t)

    @staticmethod
    def lit(col, emis=0.3, tr=0.0):
        c = rgbf(col) if isinstance(col, str) else col
        t = ' transparency="%.2f"' % tr if tr else ""
        return '<Appearance><Material diffuseColor="%s" emissiveColor="%s" specularColor="0.1 0.1 0.1"%s/></Appearance>' % (
            f3(*(v * 0.7 for v in c)), f3(*(v * emis for v in c)), t)

    def text(self, pos, lines, size=0.2, col="#e8edf3", justify="BEGIN", style="PLAIN", family="SANS", minor="FIRST"):
        return ('<Transform translation="%s"><Shape>%s<Text string="%s"><FontStyle family=\'"%s"\' style="%s" size="%.3f" '
                'justify=\'"%s" "%s"\'/></Text></Shape></Transform>' % (f3(*pos), X.unlit(col), mf(*lines), family, style, size, justify, minor))

    def lines(self, segs, col=None, colors=None, width=1.0, tr=0.0):
        """segs: list of polylines; colors: optional per-vertex colour list (same nesting)."""
        pts = [p for s in segs for p in s]
        if not pts:
            return ""
        lp = '<LineProperties linewidthScaleFactor="%.1f"/>' % width if width != 1.0 else ""
        app = ('<Appearance>%s<Material emissiveColor="%s"%s/></Appearance>' % (lp, rgb(col or "#ffffff"), ' transparency="%.2f"' % tr if tr else ""))
        cn = ('<Color color="%s"/>' % " ".join(f3(*c) for s in colors for c in s)) if colors else ""
        return '<Shape>%s<LineSet vertexCount="%s"><Coordinate point="%s"/>%s</LineSet></Shape>' % (
            app, " ".join(str(len(s)) for s in segs), " ".join(f3(*p) for p in pts), cn)

    def boxes(self, items, app=None, faces=("front", "top", "bottom", "left", "right", "back")):
        """items: (x0,x1,y0,y1,z0,z1,(r,g,b)) -> one IndexedFaceSet, colour per face."""
        if not items:
            return ""
        pts, idx, cols = [], [], []
        for (x0, x1, y0, y1, z0, z1, c) in items:
            b = len(pts)
            pts += [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]
            F = {"front": (0, 1, 2, 3), "back": (5, 4, 7, 6), "top": (3, 2, 6, 7), "bottom": (4, 5, 1, 0), "left": (4, 0, 3, 7), "right": (1, 5, 6, 2)}
            shade = {"front": 1.0, "top": 1.15, "bottom": 0.55, "left": 0.75, "right": 0.75, "back": 0.6}
            for f in faces:
                idx.append(" ".join(str(b + i) for i in F[f]) + " -1")
                cols.append(tuple(min(1, v * shade[f]) for v in c))
        return ('<Shape>%s<IndexedFaceSet solid="true" colorPerVertex="false" coordIndex="%s"><Coordinate point="%s"/>'
                '<Color color="%s"/></IndexedFaceSet></Shape>' % (app or '<Appearance><Material diffuseColor="1 1 1" emissiveColor="0.25 0.25 0.25"/></Appearance>',
                                                                  " ".join(idx), " ".join(f3(*p) for p in pts), " ".join(f3(*c) for c in cols)))

    def route(self, a, af, b, bf):
        self.routes.append((a, af, b, bf))


def build():
    M = [dict(analyse(sym, tick, bs), label=lab, y0=y0) for sym, lab, tick, bs, y0 in MARKETS]
    Ssess = M[0]["sessions"]
    assert [s["label"] for s in Ssess] == [s["label"] for s in M[1]["sessions"]], "markets must share sessions"
    # x layout per session (shared by both markets)
    xs, x = [], 0.0
    for s in Ssess:
        w = len(s["brackets"]) * (W_RTH if s["kind"] == "RTH" else W_ON)
        xs.append((x, x + w, x + w + 0.25, x + w + 0.25 + WALL_W))
        x = x + w + 0.25 + WALL_W + GAP
    X_END = x - GAP
    sc = X()
    panel = {"items": {}, "views": [], "interps": [], "markets": [], "replay": {"cycle": CYCLE, "lead": LEAD, "hold": HOLD}}
    frac = lambda prog: (LEAD + prog * (CYCLE - LEAD - HOLD)) / CYCLE

    for m in M:
        y0, bs, tick = m["y0"], m["bs"], m["tick"]
        allb = [b for s in m["sessions"] for b in s["bars1"]]
        pmin = math.floor(min(b["l"] for b in allb) / bs) * bs - bs
        pmax = math.ceil(max(b["h"] for b in allb) / bs) * bs + bs
        yp = lambda p, y0=y0, pmin=pmin, pmax=pmax: y0 + (p - pmin) / (pmax - pmin) * PANEL_H
        bh = PANEL_H * bs / (pmax - pmin)
        cellmax = max(v for s in m["sessions"] for br in s["brackets"] for v in br["vol"].values())
        profmax = max(v for s in m["sessions"] for v in s["profile"].values())
        mk = re.sub(r"[^A-Za-z]", "", m["sym"])
        # price grid
        step = {2.0: 25.0, 100.0: 500.0}[bs]
        grid, labels = [], []
        p = math.ceil(pmin / step) * step
        while p <= pmax:
            grid.append([(-0.4, yp(p), -DEPTH_MAX - 0.05), (X_END + 0.2, yp(p), -DEPTH_MAX - 0.05)])
            labels.append(sc.text((-0.55, yp(p) - 0.07, 0), [fmt_p(p, tick)], size=0.2, col=PAL["ink2"], justify="END"))
            p += step
        sc.add(sc.lines(grid, PAL["ink3"], tr=0.35) + "".join(labels))
        sc.add(sc.text((-0.4, y0 + PANEL_H + 1.25, 0), [m["label"]], size=0.42, col=PAL["ink"], style="BOLD"))
        last = m["bars"][-1]
        sc.add(sc.text((-0.4, y0 + PANEL_H + 0.72, 0), ["REAL DATA · Yahoo Finance chart API (unofficial, delayed) · 1-min bars %s to %s ET · last %s · bin %s"
                                                         % (datetime.fromtimestamp(m["bars"][0]["t"], ET).strftime("%a %d %b %H:%M"),
                                                            datetime.fromtimestamp(last["t"], ET).strftime("%a %d %b %H:%M"), fmt_p(last["c"], tick), fmt_p(bs, tick))],
                           size=0.17, col=PAL["ink2"]))
        # RSI pane frame
        ry0 = y0 - RSI_GAP - RSI_H
        ry = lambda v, ry0=ry0: ry0 + v / 100 * RSI_H
        sc.add(sc.lines([[(-0.4, ry(v), 0), (X_END + 0.2, ry(v), 0)] for v in (30, 50, 70)], PAL["ink3"], tr=0.2))
        sc.add("".join(sc.text((-0.55, ry(v) - 0.06, 0), [str(v)], size=0.15, col=PAL["ink2"], justify="END") for v in (30, 50, 70)))
        sc.add(sc.text((-0.4, ry0 + RSI_H + 0.18, 0), ["RSI 14 (5-min, Wilder)"], size=0.16, col=PAL["ink2"]))
        mrec = {"sym": m["sym"], "label": m["label"], "sha256": m["sha"], "file": m["path"], "bin": bs, "tick": tick,
                "last": last["c"], "last_time": datetime.fromtimestamp(last["t"], ET).strftime("%a %d %b %H:%M ET"), "sessions": []}
        for si, s in enumerate(m["sessions"]):
            xa, xb, wa, wb = xs[si]
            W = W_RTH if s["kind"] == "RTH" else W_ON
            K = len(s["brackets"])
            sid = "%s_%d" % (mk, si)
            dur = s["end"].timestamp() - s["start"].timestamp()
            xt = lambda t, s=s, xa=xa, xb=xb, dur=dur: xa + (t - s["start"].timestamp()) / dur * (xb - xa)
            # session header
            sc.add(sc.text((xa, y0 + PANEL_H + 0.2, 0), [s["label"], s["shape"]], size=0.2, col=PAL["ink"], style="BOLD"))
            # value area band + POC + IB on the front plane
            sc.add('<Transform translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform>' % (
                f3((xa + wb) / 2, (yp(s["val"]) + yp(s["vah"])) / 2, -DEPTH_MAX - 0.1), sc.unlit(PAL["va"], 0.88),
                f3(wb - xa, yp(s["vah"]) - yp(s["val"]), 0.02)))
            lv = [[(xa, yp(s["poc"]), 0.03), (wb, yp(s["poc"]), 0.03)]]
            sc.add(sc.lines(lv, PAL["poc"], width=2.0))
            sc.add(sc.lines([[(xa, yp(s["vah"]), 0.02), (wb, yp(s["vah"]), 0.02)], [(xa, yp(s["val"]), 0.02), (wb, yp(s["val"]), 0.02)]], PAL["va"], tr=0.1))
            if s.get("ib_h") is not None:
                xi = xa + 2 * W
                sc.add(sc.lines([[(xa - 0.08, yp(s["ib_l"]), 0.05), (xa - 0.08, yp(s["ib_h"]), 0.05)],
                                 [(xa - 0.14, yp(s["ib_h"]), 0.05), (xi, yp(s["ib_h"]), 0.05)], [(xa - 0.14, yp(s["ib_l"]), 0.05), (xi, yp(s["ib_l"]), 0.05)]],
                                PAL["ib"], width=2.0))
            if s["naked"]:
                sc.add(sc.lines([[(wb, yp(s["poc"]), 0.03), (X_END + 0.2, yp(s["poc"]), 0.03)]], PAL["naked"], tr=0.45))
                sc.add(sc.text((X_END + 0.3, yp(s["poc"]) - 0.07, 0), ["naked POC %s · %s" % (fmt_p(s["poc"], tick), s["label"].split(" RTH")[0])],
                               size=0.15, col=PAL["naked"]))
            # bracket columns (TPO cells with volume depth) + candles, each revealed in replay order
            for br in s["brackets"]:
                k = br["k"]
                xc0 = xa + k * W
                colr = ramp(k / max(1, K - 1))
                cells = []
                for i in sorted(br["tpo"]):
                    v = br["vol"].get(i, 0)
                    d = 0.06 + (DEPTH_MAX - 0.06) * math.sqrt(v / cellmax)
                    in_va = s["val_bin"] <= i <= s["vah_bin"]
                    c = colr if in_va else tuple(0.25 + 0.45 * x_ for x_ in colr)
                    if i in s["singles"]:
                        c = rgbf(PAL["single"])
                    cells.append((xc0 + 0.02, xc0 + W - 0.02, yp(i * bs) + 0.01, yp(i * bs) + bh - 0.01, -d, 0.0, c))
                bodies, wicks, wcols = [], [], []
                for b in [b5 for b5 in s["bars5"] if br["start"] <= b5["t"] < br["end"]]:
                    xm = xt(b["t"] + 150)
                    up = b["c"] >= b["o"]
                    c = rgbf(PAL["up"] if up else PAL["down"])
                    lo_, hi_ = sorted((yp(b["o"]), yp(b["c"])))
                    hw = (xb - xa) / (dur / 300) * 0.32
                    bodies.append((xm - hw, xm + hw, lo_, max(hi_, lo_ + 0.012), 0.06, 0.12, c))
                    wicks.append([(xm, yp(b["l"]), 0.09), (xm, yp(b["h"]), 0.09)])
                    wcols.append([c, c])
                name = "C_%s_%d" % (sid, k)
                inner = ('<Transform DEF="%s_grow" scale="0.0001 0.0001 0.0001">%s%s</Transform>' % (name, sc.boxes(cells, faces=("front", "top", "bottom", "left", "right")), sc.text((xc0 + W / 2, yp(br["h"]) + bh + 0.08, 0.02), [br["letter"]], size=0.14, col="#cbd5e1", justify="MIDDLE"))
                         if br.get("bars") else "")
                # indicator segments for this bracket (joined to the previous 5-min point), revealed with the candles
                seg = [b5 for b5 in s["bars5"] if br["start"] - 300 <= b5["t"] < br["end"]]
                ind = ""
                if len(seg) >= 2:
                    ind += sc.lines([[(xt(b["t"] + 150), yp(b["ema20"]), 0.16) for b in seg]], PAL["ema20"], width=2.0)
                    ind += sc.lines([[(xt(b["t"] + 150), yp(b["ema50"]), 0.16) for b in seg]], PAL["ema50"], width=2.0)
                    rs = [b for b in seg if b["rsi"] is not None]
                    if len(rs) >= 2:
                        ind += sc.lines([[(xt(b["t"] + 150), ry(b["rsi"]), 0.02) for b in rs]], width=1.5,
                                        colors=[[rgbf(PAL["rsi_hi"] if b["rsi"] >= 70 else PAL["rsi_lo"] if b["rsi"] <= 30 else PAL["rsi_mid"]) for b in rs]])
                vws = [(t, v) for t, v in s["vwap_series"] if br["start"] - 60 <= t < br["end"]][::3]
                if len(vws) >= 2:
                    ind += sc.lines([[(xt(t + 30), yp(v), 0.17) for t, v in vws]], PAL["vwap"], width=1.5, tr=0.15)
                cand = '<Switch DEF="%s_show" whichChoice="-1"><Group>%s%s%s</Group></Switch>' % (
                    name, sc.boxes(bodies, app=sc.lit("#ffffff", 0.55), faces=("front",)), sc.lines(wicks, colors=wcols), ind)
                if br.get("bars"):
                    sc.add('<Group>%s<TouchSensor DEF="T_%s" description="%s"/>%s</Group>' % (
                        inner, name, attr("%s %s bracket %s: H %s L %s vol %s" % (m["sym"], s["label"], br["letter"], fmt_p(br["h"], tick), fmt_p(br["l"], tick), "{:,}".format(int(br["v"])))), cand))
                    p0, p1 = k / K, (k + 1) / K
                    sc.add('<PositionInterpolator DEF="I_%s" key="0 %s %s 1" keyValue="0.0001 0.0001 0.0001 0.0001 0.0001 0.0001 1 1 0.0001 1 1 1 1 1 1"/>' % (name, "%.5f %.5f" % (frac(p0) - 1e-4, frac(p0)), "%.5f" % frac(p1)))   # hidden (collapsed) -> depth grows -> full
                    sc.route("Replay", "fraction_changed", "I_" + name, "set_fraction")
                    sc.route("I_" + name, "value_changed", name + "_grow", "set_scale")
                    sc.add('<IntegerSequencer DEF="Q_%s" key="0 %s" keyValue="-1 0"/>' % (name, "%.5f" % frac(p1)))
                    sc.route("Replay", "fraction_changed", "Q_" + name, "set_fraction")
                    sc.route("Q_" + name, "value_changed", name + "_show", "set_whichChoice")
                    sc.interps += ["I_" + name, "Q_" + name]
                    t_a = datetime.fromtimestamp(br["start"], ET).strftime("%H:%M")
                    t_b = datetime.fromtimestamp(br["end"], ET).strftime("%H:%M")
                    panel["items"]["T_" + name] = {"kind": "%s · bracket %s (%s-%s ET)" % (m["sym"], br["letter"], t_a, t_b), "title": "%s %s" % (s["label"], br["letter"]),
                        "body": {"open": fmt_p(br["o"], tick), "high": fmt_p(br["h"], tick), "low": fmt_p(br["l"], tick), "close": fmt_p(br["c"], tick),
                                 "range": fmt_p(br["h"] - br["l"], tick), "volume (contracts)": "{:,}".format(int(br["v"])),
                                 "TPO prints (bins)": len(br["tpo"]), "busiest bin": fmt_p(max(br["vol"], key=br["vol"].get) * bs, tick) + " to " + fmt_p((max(br["vol"], key=br["vol"].get) + 1) * bs, tick),
                                 "1-min bars": len(br["bars"]), "source": "1-min OHLCV, Yahoo chart API; volume at price estimated"}}
            # profile wall: cumulative per bracket in a Switch driven by an IntegerSequencer
            choices = []
            cum = {}
            done = 0
            for br in s["brackets"]:
                for i, v in br["vol"].items():
                    cum[i] = cum.get(i, 0) + v
                items = []
                for i, v in cum.items():
                    L = WALL_W * v / profmax
                    in_va = s["val_bin"] <= i <= s["vah_bin"]
                    c = rgbf(PAL["poc"]) if i == s["poc_bin"] and br["k"] == K - 1 else rgbf(PAL["va"] if in_va else PAL["out"])
                    items.append((wa, wa + max(L, 0.02), yp(i * bs) + 0.008, yp(i * bs) + bh - 0.008, -0.3, 0.0, c))
                choices.append("<Group>%s</Group>" % sc.boxes(items, faces=("front", "top")))
                done += 1
            wname = "W_%s" % sid
            sc.add('<Group><Switch DEF="%s_show" whichChoice="-1">%s</Switch><Transform translation="%s"><Shape>%s<Box size="%s"/></Shape></Transform><TouchSensor DEF="T_%s" description="%s"/></Group>' % (
                wname, "".join(choices), f3((wa + wb) / 2, y0 + PANEL_H / 2, -0.32), sc.unlit("#0f172a", 0.6), f3(wb - wa, PANEL_H, 0.02),
                wname, attr("%s %s profile: POC %s VA %s-%s" % (m["sym"], s["label"], fmt_p(s["poc"], tick), fmt_p(s["val"], tick), fmt_p(s["vah"], tick)))))
            ks = " ".join("%.5f" % frac((k + 1) / K) for k in range(K))
            sc.add('<IntegerSequencer DEF="Q_%s" key="0 %s" keyValue="-1 %s"/>' % (wname, ks, " ".join(str(k) for k in range(K))))
            sc.route("Replay", "fraction_changed", "Q_" + wname, "set_fraction")
            sc.route("Q_" + wname, "value_changed", wname + "_show", "set_whichChoice")
            sc.interps.append("Q_" + wname)
            sc.add(sc.text((wa, y0 - 0.32, 0), ["POC %s · VA %s-%s" % (fmt_p(s["poc"], tick), fmt_p(s["val"], tick), fmt_p(s["vah"], tick))], size=0.15, col=PAL["ink2"]))
            # indicators: EMA20, EMA50, VWAP on the front plane; RSI below
            # time ticks
            tt, tl = [], []
            hrs = range(10, 16 + 1, 2) if s["kind"] == "RTH" else range(0, 24, 3)
            for b in s["bars5"]:
                d = datetime.fromtimestamp(b["t"], ET)
                if d.minute == 0 and d.hour in hrs:
                    xx = xt(b["t"])
                    tt.append([(xx, ry0 - 0.05, 0), (xx, ry0 - 0.2, 0)])
                    tl.append(sc.text((xx, ry0 - 0.45, 0), [d.strftime("%H:%M")], size=0.14, col=PAL["ink2"], justify="MIDDLE"))
            sc.add(sc.lines(tt, PAL["ink2"]) + "".join(tl))
            srec = {"label": s["label"], "kind": s["kind"], "shape": s["shape"], "open": s["o"], "high": s["h"], "low": s["l"], "close": s["c"],
                    "volume": int(s["v"]), "poc": s["poc"], "vah": s["vah"], "val": s["val"], "va_share": round(s["va_share"], 3),
                    "ib_high": s.get("ib_h"), "ib_low": s.get("ib_l"), "vwap": s["vwap"], "naked_poc": s["naked"], "poc_touched": s["poc_touched_at"],
                    "single_prints": runs(s["singles"], bs), "brackets": K,
                    "ema20_end": s["bars5"][-1]["ema20"], "ema50_end": s["bars5"][-1]["ema50"], "rsi_end": s["bars5"][-1]["rsi"],
                    "start": s["start"].strftime("%a %d %b %H:%M ET"), "end": s["end"].strftime("%a %d %b %H:%M ET")}
            mrec["sessions"].append(srec)
            body = {"shape (heuristic)": s["shape"], "open / high / low / close": " / ".join(fmt_p(v, tick) for v in (s["o"], s["h"], s["l"], s["c"])),
                    "range": fmt_p(s["h"] - s["l"], tick), "volume (contracts)": "{:,}".format(int(s["v"])), "POC": fmt_p(s["poc"], tick),
                    "value area (70 %)": "%s to %s (%.1f %% of volume)" % (fmt_p(s["val"], tick), fmt_p(s["vah"], tick), 100 * s["va_share"]),
                    "VWAP (session)": fmt_p(s["vwap"], tick)}
            if s.get("ib_h") is not None:
                body["initial balance"] = "%s to %s (range %s)" % (fmt_p(s["ib_l"], tick), fmt_p(s["ib_h"], tick), fmt_p(s["ib_h"] - s["ib_l"], tick))
            body["single prints"] = ", ".join("%s-%s" % (fmt_p(a, tick), fmt_p(b, tick)) for a, b in srec["single_prints"]) or "none"
            body["POC status"] = "naked (not traded through since)" if s["naked"] else ("touched %s" % s["poc_touched_at"] if s["poc_touched_at"] else "session in progress")
            body["at session end"] = "EMA20 %s · EMA50 %s · RSI %.1f" % (fmt_p(srec["ema20_end"], tick), fmt_p(srec["ema50_end"], tick), srec["rsi_end"] or float("nan"))
            body["window"] = "%s to %s" % (srec["start"], srec["end"])
            body["method"] = "volume at price estimated from 1-min OHLCV; VA by the 70 % two-bin rule; shape by heuristic (see README)"
            panel["items"]["T_" + wname] = {"kind": "%s · session profile" % m["sym"], "title": s["label"], "body": body}
        panel["markets"].append(mrec)

    sc.add('<TimeSensor DEF="Replay" cycleInterval="%s" loop="true"/>' % f3(CYCLE))
    panel["sessions_x"] = [{"label": s["label"], "kind": s["kind"], "x0": xs[i][0], "x1": xs[i][1], "start": s["start"].strftime("%H:%M"),
                            "minutes": round((s["end"] - s["start"]).total_seconds() / 60)} for i, s in enumerate(Ssess)]
    # legend text block (scene-side, for viewers without the page)
    ly = M[0]["y0"] - RSI_GAP - RSI_H - 1.5
    sc.add(sc.text((-0.4, ly, 0), ["Front: TPO brackets (colour = time, A blue to M red) with 5-min candles, EMA 20 (amber), EMA 50 (mauve), VWAP (white).",
                                    "Depth into the screen: volume at price inside each bracket (sqrt). Right of each session: its volume profile, value area blue, POC amber.",
                                    "Green bracket on the left = initial balance. Orange cells = single prints. Amber line to the right edge = naked POC. Not financial advice."],
                   size=0.17, col=PAL["ink2"]))
    yE, yB = M[0]["y0"], M[1]["y0"]
    cx = X_END / 2
    last_s = len(Ssess) - 1
    views = [
        ("VP_both", "Both markets, week", (cx - 3, (yE + yB + PANEL_H) / 2 - 1.5, 46), (cx, (yE + yB + PANEL_H) / 2 - 2.5, 0)),
        ("VP_es", "ES week", (cx - 1.0, yE + 3.6, 34), (cx - 0.5, yE + 2.4, 0)),
        ("VP_btc", "BTC week", (cx - 1.0, yB + 3.6, 34), (cx - 0.5, yB + 2.4, 0)),
        ("VP_es_3d", "ES landscape (oblique)", (xs[2][0] - 8, yE + 15, 16), (xs[1][1] + 2, yE + 3.0, -1)),
        ("VP_es_side", "ES side: volume depth", (X_END + 9, yE + 5, 7), (X_END - 8, yE + 4.5, -0.8)),
        ("VP_es_last", "ES last RTH + overnight", ((xs[last_s - 1][0] + xs[last_s][3]) / 2, yE + 3.0, 19), ((xs[last_s - 1][0] + xs[last_s][3]) / 2, yE + 2.3, 0)),
    ]
    vp = ""
    for d, desc, pos, tgt in views:
        vp += '<Viewpoint DEF="%s" description="%s" position="%s" orientation="%s" centerOfRotation="%s"/>\n' % (d, attr(desc), f3(*pos), f3(*look_at(pos, tgt)), f3(*tgt))
        panel["views"].append([d, desc])
    panel["interps"] = sc.interps
    panel["sources"] = [{"sym": m["sym"], "file": m["path"], "sha256": m["sha"], "exchange": m["meta"].get("exchangeName"),
                         "timezone": m["meta"].get("exchangeTimezoneName")} for m in M]
    head = [("title", "ES and BTC futures: 3D market profile"),
            ("description", "One week of CME E-mini S&P 500 and Bitcoin futures (1-min, Yahoo Finance chart API, delayed) as TPO brackets with volume depth, "
                            "session volume profiles, value areas, POCs, IB, single prints, naked POCs, candles, EMA 20/50, VWAP and RSI 14."),
            ("generator", "futures-3d/build.py (Python %s)" % sys.version.split()[0])] + [
           ("source-" + m["sym"], "%s sha256 %s" % (m["path"], m["sha"])) for m in M] + [("disclaimer", "Visual study tool, not financial advice. Volume at price is estimated from 1-min bars.")]
    routes = "\n".join('<ROUTE fromNode="%s" fromField="%s" toNode="%s" toField="%s"/>' % r for r in sc.routes)
    x3d = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
           '<X3D profile="Interchange" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">\n<head>\n'
           + "".join('<component name="%s" level="%d"/>\n' % c for c in [("Shape", 2), ("Grouping", 2), ("PointingDeviceSensor", 1), ("Text", 1), ("Interpolation", 1), ("EventUtilities", 1), ("Time", 1), ("Navigation", 2)])
           + "".join('<meta name="%s" content="%s"/>\n' % (k, attr(v)) for k, v in head)
           + '</head>\n<Scene>\n<WorldInfo title="ES and BTC futures: 3D market profile"/>\n'
           '<Background skyColor="0.035 0.047 0.071 0.063 0.082 0.118" skyAngle="1.5708"/>\n<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>\n'
           '<DirectionalLight direction="-0.3 -0.6 -0.75" intensity="0.4"/>\n' + vp + "\n".join(sc.p) + "\n" + routes + "\n</Scene>\n</X3D>\n")
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "futures-scene.x3d"), "w", encoding="utf-8").write(x3d)
    json.dump(panel, open(os.path.join(OUT, "futures-panel.json"), "w"), indent=1, default=str)
    rep = {"scene_bytes": len(x3d.encode()), "routes": len(sc.routes), "interpolators": len(sc.interps), "touch": len(panel["items"]),
           "sessions": [s["label"] for s in Ssess], "markets": [{"sym": m["sym"], "sessions": [{k: v for k, v in s.items() if k in ("label", "shape", "poc", "vah", "val", "high", "low", "close", "volume", "naked_poc", "ib_high", "ib_low")} for s in r["sessions"]]} for m, r in zip(M, panel["markets"])]}
    json.dump(rep, open(os.path.join(OUT, "build-report.json"), "w"), indent=1, default=str)
    return rep


if __name__ == "__main__":
    print(json.dumps(build(), indent=1, default=str))
