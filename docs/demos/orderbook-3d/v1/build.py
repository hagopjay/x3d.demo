#!/usr/bin/env python3
"""BTC/USD order-book depth over time as a 3D "Bookmap-style" scene (X3D 4.0) + panel data. Standard library only.

  python3 -I build.py            -> out/orderbook-scene.x3d, out/orderbook-panel.json, out/build-report.json
  python3 -I build.py --stats    -> print distributions used by the thresholds, write nothing

Data: downloads/kraken/depth.ndjson and trades.ndjson, written by tools/poll_kraken.py from Kraken's public REST API
(no key): Depth?pair=XBTUSD&count=500 every ~2 s and Trades?pair=XBTUSD&since=<cursor>. Venue: Kraken SPOT XBT/USD
(not a perpetual, not CME). Each line wraps one API response with the local receive time ("recv", Unix seconds).

Method (every derived number in the scene and the panel comes from these rules):
  time        one column per depth snapshot (X = snapshot index, ~2 s apart, labelled with real UTC receive times);
              trades are placed by interpolating their exchange timestamp between the snapshot receive times
  price bins  BIN = $5; every level of the top-500 book is summed into its bin; the window is the traded mid range
              +- PAD, clipped to the price range both sides cover in every snapshot (so no edge-of-book artefacts)
  height      resting size per bin (BTC), sqrt scale against Q_REF = 99th percentile of non-empty bins near price;
              capped at 1.6 x the reference height so walls stay readable (exact sizes are in the panel)
  near price  +- NEAR_USD of the mid at that snapshot
  wall        a bin whose size is >= the WALL_P (93rd) percentile of non-empty near-price bins, for >= WALL_MIN_SNAPS consecutive
              snapshots (one missing snapshot tolerated); its fate is read from the snapshot after it ends
  pulled      for consecutive snapshots: lost size at a bin minus all volume traded at that bin in the interval;
              flagged when >= the PULL_P (97th) percentile near-price bin. A LOWER BOUND proxy for cancels: REST polling cannot
              see orders placed and cancelled inside one ~2 s gap, and modifications look like cancel + add
  trades      clustered per (interval, bin, aggressor side); Kraken's "b"/"s" is the taker side
  imbalance   (bid - ask) / (bid + ask) of raw level sizes within +- IMB_USD of mid
  delta       buy minus sell aggressor volume (BTC) in the trailing 30 s / 60 s; CVD from the first snapshot
Layout: X = time, Y = price, Z (towards the viewer) = resting size. Bids blue, asks copper, trades green (buy aggressor)
and red (sell aggressor), walls amber, pulled liquidity violet. Below: spread and cumulative delta strips.
"""
import bisect, hashlib, json, math, os, statistics, sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DL = os.path.join(HERE, "downloads", "kraken")
OUT = os.path.join(HERE, "out")
PAIR = "XXBTZUSD"

BIN, PAD = 5.0, 260.0
NEAR_USD, IMB_USD = 250.0, 100.0
WALL_P, WALL_MIN_SNAPS = 93, 10      # wall: >= 93rd percentile of non-empty near-price bins, >= 10 snapshots
PULL_P = 97                          # pulled: >= 97th percentile of non-empty near-price bins
XS, PANEL_H, H = 0.11, 11.0, 2.2      # metres per snapshot, price panel height, reference height (layout)
CHUNK = 4                             # snapshots per replay chunk (~8 s)
CYCLE, LEAD, HOLD = 40.0, 1.0, 3.0
STRIP_H, STRIP_GAP = 1.5, 0.7
PAL = {"bid": "#3b82c4", "ask": "#c2652f", "buy": "#34d399", "sell": "#f87171", "wall": "#fbbf24", "pull": "#c084fc",
       "bbid": "#bfdbfe", "bask": "#fed7aa", "ink": "#e8edf3", "ink2": "#94a3b8", "ink3": "#334155", "now": "#e2e8f0",
       "spread": "#cbd5e1", "floor": "#0b1220"}
BID_RAMP = ["#0d1626", "#16304f", "#1f4f80", "#3b82c4", "#93c5fd"]
ASK_RAMP = ["#1a110c", "#4a2414", "#83391b", "#c2652f", "#fdba74"]


# ---------- helpers ----------
def rgbf(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def rgb(h):
    return "%.3f %.3f %.3f" % rgbf(h)


def ramp(stops, t):
    t = max(0.0, min(1.0, t)) * (len(stops) - 1)
    i = min(int(t), len(stops) - 2)
    a, b = rgbf(stops[i]), rgbf(stops[i + 1])
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


def usd(p, d=1):
    return "${:,.{}f}".format(p, d)


def btc(q):
    return "%.3f BTC" % q


def utc(t, ms=False):
    d = datetime.fromtimestamp(t, timezone.utc)
    return d.strftime("%H:%M:%S") + (".%03d" % (d.microsecond // 1000) if ms else "") + " UTC"


def pct(vals, p):
    v = sorted(vals)
    return v[min(len(v) - 1, int(p / 100 * len(v)))] if v else 0.0


# ---------- data ----------
def load():
    out = {}
    for name in ("depth", "trades"):
        path = os.path.join(DL, name + ".ndjson")
        raw = open(path, "rb").read()
        out[name] = ([json.loads(l) for l in raw.splitlines() if l.strip()], hashlib.sha256(raw).hexdigest(),
                     os.path.relpath(path, HERE), len(raw))
    snaps = []
    for rec in out["depth"][0]:
        r = rec["body"]["result"][PAIR]
        bids = [(float(p), float(q)) for p, q, _ in r["bids"]]
        asks = [(float(p), float(q)) for p, q, _ in r["asks"]]
        lvl_t = max(int(x[2]) for x in r["bids"][:20] + r["asks"][:20])
        snaps.append({"t": rec["recv"], "bids": bids, "asks": asks, "bid": bids[0][0], "ask": asks[0][0], "lvl_t": lvl_t})
    snaps.sort(key=lambda s: s["t"])
    seen, trades = set(), []
    for rec in out["trades"][0]:
        for tr in rec["body"]["result"][PAIR]:
            tid = tr[6]
            if tid in seen:
                continue
            seen.add(tid)
            trades.append({"p": float(tr[0]), "q": float(tr[1]), "t": float(tr[2]), "side": tr[3], "type": tr[4], "id": tid})
    trades.sort(key=lambda x: (x["t"], x["id"]))
    src = [{"file": v[2], "sha256": v[1], "bytes": v[3], "lines": len(v[0])} for v in (out["depth"], out["trades"])]
    return snaps, trades, src


def analyse(snaps, trades):
    N = len(snaps)
    T = [s["t"] for s in snaps]
    mids = [(s["bid"] + s["ask"]) / 2 for s in snaps]
    deep_bid = max(s["bids"][-1][0] for s in snaps)      # every snapshot covers prices >= this on the bid side
    deep_ask = min(s["asks"][-1][0] for s in snaps)
    lo = max(math.floor((min(mids) - PAD) / BIN) * BIN, math.ceil(deep_bid / BIN) * BIN)
    hi = min(math.ceil((max(mids) + PAD) / BIN) * BIN, math.floor(deep_ask / BIN) * BIN)
    NB = int(round((hi - lo) / BIN))
    binof = lambda p: int(math.floor((p - lo) / BIN))
    bq, aq = [[0.0] * NB for _ in range(N)], [[0.0] * NB for _ in range(N)]
    for k, s in enumerate(snaps):
        for p, q in s["bids"]:
            j = binof(p)
            if 0 <= j < NB:
                bq[k][j] += q
        for p, q in s["asks"]:
            j = binof(p)
            if 0 <= j < NB:
                aq[k][j] += q
    near = lambda k, j: abs(lo + (j + 0.5) * BIN - mids[k]) <= NEAR_USD
    nz = [v for k in range(N) for j in range(NB) if near(k, j) for v in (bq[k][j], aq[k][j]) if v > 0]
    med = statistics.median(nz)
    qref = pct(nz, 99)
    pull_thr = pct(nz, PULL_P)
    # trades: interval index (k = trade falls in (T[k-1], T[k]]), fractional x
    for tr in trades:
        k = bisect.bisect_left(T, tr["t"])
        tr["k"] = k
        if 0 < k < N:
            tr["xi"] = (k - 1) + (tr["t"] - T[k - 1]) / (T[k] - T[k - 1])
        tr["j"] = binof(tr["p"])
    vis = [tr for tr in trades if 0 < tr["k"] < N]
    traded_at = {}
    for tr in vis:
        traded_at[(tr["k"], tr["j"])] = traded_at.get((tr["k"], tr["j"]), 0.0) + tr["q"]
    # pulled liquidity
    pulls = []
    for k in range(1, N):
        for j in range(NB):
            if not near(k - 1, j):
                continue
            for side, Q in (("bid", bq), ("ask", aq)):
                lost = Q[k - 1][j] - Q[k][j]
                if lost <= 0:
                    continue
                tq = traded_at.get((k, j), 0.0)
                pulled = lost - tq
                if pulled >= pull_thr:
                    pulls.append({"k": k, "j": j, "side": side, "before": Q[k - 1][j], "after": Q[k][j], "traded": tq, "pulled": pulled})
    # walls
    thr = pct(nz, WALL_P)
    walls = []
    for side, Q in (("bid", bq), ("ask", aq)):
        for j in range(NB):
            run, gap = None, 0
            for k in range(N + 1):
                on = k < N and Q[k][j] >= thr and near(k, j)
                if on:
                    if run is None:
                        run = [k, k]
                    run[1], gap = k, 0
                elif run is not None:
                    gap += 1
                    if gap > 1 or k == N:
                        if run[1] - run[0] + 1 >= WALL_MIN_SNAPS:
                            walls.append({"side": side, "j": j, "k0": run[0], "k1": run[1]})
                        run, gap = None, 0
    for w in walls:
        Q = bq if w["side"] == "bid" else aq
        ks = range(w["k0"], w["k1"] + 1)
        w["peak"] = max(Q[k][w["j"]] for k in ks)
        w["mean"] = sum(Q[k][w["j"]] for k in ks) / len(ks)
        w["dist"] = sum(abs(lo + (w["j"] + 0.5) * BIN - mids[k]) for k in ks) / len(ks)
        e = w["k1"]
        if e >= N - 1:
            w["fate"] = "still resting at the last snapshot"
        else:
            before, after = Q[e][w["j"]], Q[e + 1][w["j"]]
            tq = traded_at.get((e + 1, w["j"]), 0.0)
            drop = before - after
            if after >= thr and not near(e + 1, w["j"]):
                w["fate"] = "price moved away: still %s resting, now outside +-$%d of mid" % (btc(after), NEAR_USD)
            elif after >= 0.5 * before:
                w["fate"] = "shrank below the wall threshold (%s -> %s)" % (btc(before), btc(after))
            elif tq >= 0.5 * drop:
                w["fate"] = "consumed by trades (%s traded at the level)" % btc(tq)
            else:
                w["fate"] = "PULLED: %s vanished, only %s traded there" % (btc(drop), btc(tq))
        w["traded_during"] = sum(traded_at.get((kk, w["j"]), 0.0) for kk in range(w["k0"] + 1, w["k1"] + 1))
    walls.sort(key=lambda w: -w["peak"])
    # per-snapshot "now" card
    cards, cvd, ti = [], 0.0, 0
    buy_cum = []
    for tr in trades:
        buy_cum.append((tr["t"], tr["q"] if tr["side"] == "b" else -tr["q"]))
    tt = [x[0] for x in buy_cum]
    cs = [0.0]
    for _, d in buy_cum:
        cs.append(cs[-1] + d)
    dsum = lambda a, b: cs[bisect.bisect_right(tt, b)] - cs[bisect.bisect_right(tt, a)]
    for k, s in enumerate(snaps):
        m = mids[k]
        B = sum(q for p, q in s["bids"] if p >= m - IMB_USD)
        A = sum(q for p, q in s["asks"] if p <= m + IMB_USD)
        nb = [(bq[k][j], j) for j in range(NB) if near(k, j) and bq[k][j] > 0]
        na = [(aq[k][j], j) for j in range(NB) if near(k, j) and aq[k][j] > 0]
        wb, wa = max(nb), max(na)
        cards.append({"k": k, "t": s["t"], "time": utc(s["t"]), "bid": s["bid"], "ask": s["ask"], "spread": round(s["ask"] - s["bid"], 2),
                      "mid": m, "imb": (B - A) / (B + A) if B + A else 0.0, "B": B, "A": A,
                      "wall_bid": [lo + wb[1] * BIN, lo + (wb[1] + 1) * BIN, wb[0], m - (lo + (wb[1] + 0.5) * BIN)],
                      "wall_ask": [lo + wa[1] * BIN, lo + (wa[1] + 1) * BIN, wa[0], (lo + (wa[1] + 0.5) * BIN) - m],
                      "d30": dsum(s["t"] - 30, s["t"]), "d60": dsum(s["t"] - 60, s["t"]), "cvd": dsum(T[0], s["t"]),
                      "n60": bisect.bisect_right(tt, s["t"]) - bisect.bisect_right(tt, s["t"] - 60)})
    return {"N": N, "T": T, "mids": mids, "lo": lo, "hi": hi, "NB": NB, "bq": bq, "aq": aq, "med": med, "qref": qref,
            "trades": vis, "all_trades": trades, "pulls": pulls, "walls": walls, "cards": cards, "wall_thr": thr, "pull_thr": pull_thr}


# ---------- scene ----------
def build(stats=False):
    snaps, trades, src = load()
    A = analyse(snaps, trades)
    N, NB, lo, hi, bq, aq, qref, T = A["N"], A["NB"], A["lo"], A["hi"], A["bq"], A["aq"], A["qref"], A["T"]
    if stats:
        nzall = [v for k in range(N) for j in range(NB) for v in (bq[k][j], aq[k][j]) if v > 0]
        print(json.dumps({"snapshots": N, "span_s": round(T[-1] - T[0], 1), "gaps": [round(min(b - a for a, b in zip(T, T[1:])), 2), round(statistics.median(b - a for a, b in zip(T, T[1:])), 2), round(max(b - a for a, b in zip(T, T[1:])), 2)],
                          "window": [lo, hi, NB], "mid_range": [min(A["mids"]), max(A["mids"])], "median_near_bin": A["med"], "q_ref_p99": qref,
                          "bin_pcts_all": [round(pct(nzall, p), 3) for p in (10, 50, 90, 99, 100)], "trades_visible": len(A["trades"]),
                          "trade_btc": round(sum(t["q"] for t in A["trades"]), 3), "pulls": len(A["pulls"]), "walls": len(A["walls"]), "wall_thr": A["wall_thr"], "pull_thr": A["pull_thr"],
                          "spread_pcts": [pct([c["spread"] for c in A["cards"]], p) for p in (10, 50, 90, 100)]}, indent=1))
        return None
    XW = (N - 1) * XS
    yp = lambda p: (p - lo) / (hi - lo) * PANEL_H
    ybin = PANEL_H / NB
    hgt = lambda q: H * min(1.6, math.sqrt(q / qref)) if q > 0 else 0.0
    xof = lambda xi: xi * XS
    vh = lambda k, j: hgt(bq[k][j] + aq[k][j])          # vertex height
    parts, routes, interps = [], [], []
    panel = {"items": {}, "views": [], "interps": [], "replay": {"cycle": CYCLE, "lead": LEAD, "hold": HOLD}}
    frac = lambda prog: (LEAD + prog * (CYCLE - LEAD - HOLD)) / CYCLE
    add = parts.append

    def text(pos, lines, size=0.2, col=PAL["ink"], justify="BEGIN", style="PLAIN", minor="FIRST"):
        return ('<Transform translation="%s"><Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="%s"/></Appearance>'
                '<Text string="%s"><FontStyle family=\'"SANS"\' style="%s" size="%.3f" justify=\'"%s" "%s"\'/></Text></Shape></Transform>'
                % (f3(*pos), rgb(col), mf(*lines), style, size, justify, minor))

    def lines(segs, col, width=1.0, tr=0.0, colors=None):
        segs = [s for s in segs if len(s) >= 2]
        if not segs:
            return ""
        lp = '<LineProperties linewidthScaleFactor="%.1f"/>' % width if width != 1.0 else ""
        cn = ('<Color color="%s"/>' % " ".join(f3(*c) for s in colors for c in s)) if colors else ""
        return ('<Shape><Appearance>%s<Material emissiveColor="%s"%s/></Appearance><LineSet vertexCount="%s"><Coordinate point="%s"/>%s</LineSet></Shape>'
                % (lp, rgb(col), ' transparency="%.2f"' % tr if tr else "", " ".join(str(len(s)) for s in segs),
                   " ".join(f3(*p) for s in segs for p in s), cn))

    def quads(qs, col, tr=0.0, emis=0.5):
        if not qs:
            return ""
        pts, idx = [], []
        for q in qs:
            b = len(pts)
            pts += q
            idx.append("%d %d %d %d -1" % (b, b + 1, b + 2, b + 3))
        c = rgbf(col)
        return ('<Shape><Appearance><Material diffuseColor="%s" emissiveColor="%s"%s/></Appearance><IndexedFaceSet solid="false" coordIndex="%s">'
                '<Coordinate point="%s"/></IndexedFaceSet></Shape>' % (f3(*(v * 0.6 for v in c)), f3(*(v * emis for v in c)),
                                                                       ' transparency="%.2f"' % tr if tr else "", " ".join(idx), " ".join(f3(*p) for p in pts)))

    def vcolor(k, j):
        b, a = bq[k][j], aq[k][j]
        if b + a <= 0:
            return rgbf(PAL["floor"])
        t = min(1.0, math.sqrt((b + a) / qref))
        return ramp(BID_RAMP if b >= a else ASK_RAMP, 0.15 + 0.85 * t)

    # --- prototypes (hidden Switch so DEF precedes every USE) ---
    add('<Switch whichChoice="-1">'
        '<Shape DEF="M_buy"><Appearance><Material diffuseColor="%s" emissiveColor="%s" specularColor="0.3 0.3 0.3"/></Appearance><Sphere radius="1"/></Shape>'
        '<Shape DEF="M_sell"><Appearance><Material diffuseColor="%s" emissiveColor="%s" specularColor="0.3 0.3 0.3"/></Appearance><Sphere radius="1"/></Shape>'
        '<Shape DEF="M_pull"><Appearance><Material diffuseColor="%s" emissiveColor="%s" transparency="0.15"/></Appearance><Box size="1 1 1"/></Shape>'
        '</Switch>' % (f3(*(v * 0.8 for v in rgbf(PAL["buy"]))), f3(*(v * 0.35 for v in rgbf(PAL["buy"]))),
                       f3(*(v * 0.8 for v in rgbf(PAL["sell"]))), f3(*(v * 0.35 for v in rgbf(PAL["sell"]))),
                       f3(*(v * 0.7 for v in rgbf(PAL["pull"]))), f3(*(v * 0.55 for v in rgbf(PAL["pull"])))))

    # --- static frame: floor, price grid + labels, time ticks, titles ---
    step = 50.0
    grid, labels = [], []
    p = math.ceil(lo / step) * step
    while p <= hi:
        grid.append([(-0.3, yp(p), -0.02), (XW + 0.3, yp(p), -0.02)])
        labels.append(text((-0.45, yp(p) - 0.08, 0), [usd(p, 0)], size=0.2, col=PAL["ink2"], justify="END"))
        labels.append(text((XW + 0.45, yp(p) - 0.08, 0), [usd(p, 0)], size=0.2, col=PAL["ink2"]))
        p += step
    add('<Transform translation="%s"><Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="%s"/></Appearance><Box size="%s"/></Shape></Transform>'
        % (f3(XW / 2, PANEL_H / 2, -0.06), rgb(PAL["floor"]), f3(XW + 0.6, PANEL_H + 0.2, 0.02)))
    add(lines(grid, PAL["ink3"], tr=0.2) + "".join(labels))
    t0 = T[0]
    tick_t = math.ceil(t0 / 30) * 30
    tks, tls = [], []
    ys0 = -STRIP_GAP - STRIP_H                # spread strip
    yc0 = ys0 - STRIP_GAP - STRIP_H           # CVD strip
    while tick_t <= T[-1]:
        k = bisect.bisect_left(T, tick_t)
        xi = (k - 1) + (tick_t - T[k - 1]) / (T[k] - T[k - 1]) if k > 0 else 0
        x = xof(xi)
        tks.append([(x, -0.05, 0), (x, -0.22, 0)])
        tks.append([(x, yc0 - 0.05, 0), (x, yc0 - 0.2, 0)])
        tls.append(text((x, -0.48, 0), [utc(tick_t).replace(" UTC", "")], size=0.17, col=PAL["ink2"], justify="MIDDLE"))
        tls.append(text((x, yc0 - 0.45, 0), [utc(tick_t).replace(" UTC", "")], size=0.15, col=PAL["ink2"], justify="MIDDLE"))
        tick_t += 30
    add(lines(tks, PAL["ink2"]) + "".join(tls))
    day = datetime.fromtimestamp(T[0], timezone.utc).strftime("%a %d %b %Y")
    add(text((-0.3, PANEL_H + 1.25, 0), ["BTC/USD order book in 3D: Kraken spot, %s" % day], size=0.42, style="BOLD"))
    add(text((-0.3, PANEL_H + 0.62, 0), ["REAL DATA · Kraken public REST (Depth top 500 + Trades), polled every ~2 s · %d snapshots %s to %s · bin %s · NOT FINANCIAL ADVICE"
                                         % (N, utc(T[0]), utc(T[-1]), usd(BIN, 0))], size=0.18, col=PAL["ink2"]))
    add(text((XW / 2, -0.9, 0), ["time (UTC, receive time of each snapshot)"], size=0.16, col=PAL["ink2"], justify="MIDDLE"))
    # strips: frames
    cards = A["cards"]
    smax = max(1.0, max(c["spread"] for c in cards))
    cmin, cmax = min(0.0, min(c["cvd"] for c in cards)), max(0.0, max(c["cvd"] for c in cards))
    crng = max(1e-6, cmax - cmin)
    ysp = lambda s: ys0 + min(1.0, s / smax) * STRIP_H
    ycv = lambda v: yc0 + (v - cmin) / crng * STRIP_H
    add(lines([[(-0.3, ys0, 0), (XW + 0.3, ys0, 0)], [(-0.3, ys0 + STRIP_H, 0), (XW + 0.3, ys0 + STRIP_H, 0)],
               [(-0.3, yc0, 0), (XW + 0.3, yc0, 0)], [(-0.3, yc0 + STRIP_H, 0), (XW + 0.3, yc0 + STRIP_H, 0)],
               [(-0.3, ycv(0), 0), (XW + 0.3, ycv(0), 0)]], PAL["ink3"]))
    add(text((-0.45, ys0 + STRIP_H - 0.15, 0), ["spread", usd(smax, 2)], size=0.15, col=PAL["ink2"], justify="END"))
    add(text((-0.45, ys0 - 0.02, 0), ["$0"], size=0.15, col=PAL["ink2"], justify="END"))
    add(text((-0.45, yc0 + STRIP_H - 0.15, 0), ["CVD", "%+.2f BTC" % cmax], size=0.15, col=PAL["ink2"], justify="END"))
    add(text((-0.45, yc0 + 0.1, 0), ["%+.2f BTC" % cmin], size=0.15, col=PAL["ink2"], justify="END"))
    add(text((XW + 0.45, ys0 + STRIP_H / 2 - 0.08, 0), ["best ask - best bid (USD)"], size=0.15, col=PAL["ink2"]))
    add(text((XW + 0.45, yc0 + STRIP_H / 2 - 0.08, 0), ["cumulative aggressor delta", "(buy - sell, BTC) + per-interval bars"], size=0.15, col=PAL["ink2"]))

    # --- chunks: terrain + trades + pulls + walls + lines + strips, each revealed when its last snapshot is reached ---
    trades_by_k, pulls_by_k = {}, {}
    clusters = {}
    for tr in A["trades"]:
        key = (tr["k"], tr["j"], tr["side"])
        c = clusters.setdefault(key, {"k": tr["k"], "j": tr["j"], "side": tr["side"], "q": 0.0, "n": 0, "pq": 0.0, "xq": 0.0, "tmin": tr["t"], "tmax": tr["t"], "maxq": 0.0, "types": set()})
        c["q"] += tr["q"]; c["n"] += 1; c["pq"] += tr["p"] * tr["q"]; c["xq"] += tr["xi"] * tr["q"]
        c["tmin"], c["tmax"], c["maxq"] = min(c["tmin"], tr["t"]), max(c["tmax"], tr["t"]), max(c["maxq"], tr["q"])
        c["types"].add({"m": "market", "l": "limit"}.get(tr["type"], tr["type"]))
    clist = sorted(clusters.values(), key=lambda c: -c["q"])
    qmax_c = clist[0]["q"] if clist else 1.0
    top_clusters = {id(c) for c in clist[:40]}
    for c in clist:
        trades_by_k.setdefault(c["k"], []).append(c)
    pl = sorted(A["pulls"], key=lambda p: -p["pulled"])
    top_pulls = {id(p) for p in pl[:30]}
    for p in pl:
        pulls_by_k.setdefault(p["k"], []).append(p)
    nchunks = math.ceil((N - 1) / CHUNK)
    deltas = {}
    for tr in A["trades"]:
        deltas[tr["k"]] = deltas.get(tr["k"], 0.0) + (tr["q"] if tr["side"] == "b" else -tr["q"])
    dmax = max([abs(v) for v in deltas.values()] or [1.0])
    for ci in range(nchunks):
        k0, k1 = ci * CHUNK, min(N - 1, (ci + 1) * CHUNK)
        cols = list(range(k0, k1 + 1))
        nx = len(cols)
        heights, colors = [], []
        for r in range(NB):                      # ElevationGrid row r = price bin NB-1-r (top first)
            j = NB - 1 - r
            for k in cols:
                heights.append(vh(k, j))
                colors.append(vcolor(k, j))
        surf = ('<Transform translation="%s" rotation="1 0 0 1.5708"><Shape><Appearance><Material diffuseColor="1 1 1" emissiveColor="0.1 0.1 0.1" '
                'specularColor="0.12 0.12 0.12" shininess="0.3"/></Appearance><ElevationGrid xDimension="%d" zDimension="%d" xSpacing="%s" zSpacing="%s" '
                'solid="false" creaseAngle="1.2" height="%s"><Color color="%s"/></ElevationGrid></Shape></Transform>'
                % (f3(xof(k0), yp(hi - BIN / 2), 0), nx, NB, f3(XS), f3(ybin), " ".join(f3(h) for h in heights), " ".join(f3(*c) for c in colors)))
        inner = []
        # best bid / ask lines on the terrain
        bb = [(xof(k), yp(snaps[k]["bid"]), max(vh(k, int((snaps[k]["bid"] - lo) // BIN)), 0) + 0.04) for k in cols]
        ba = [(xof(k), yp(snaps[k]["ask"]), max(vh(k, int((snaps[k]["ask"] - lo) // BIN)), 0) + 0.04) for k in cols]
        inner.append(lines([bb], PAL["bbid"], width=2.5) + lines([ba], PAL["bask"], width=2.5))
        # spread + CVD strips
        inner.append(lines([[(xof(k), ysp(cards[k]["spread"]), 0.01) for k in cols]], PAL["spread"], width=1.5))
        inner.append(lines([[(xof(k), ycv(cards[k]["cvd"]), 0.01) for k in cols]], PAL["ink"], width=2.0))
        dq = {"b": [], "s": []}
        for k in cols[1:] if k0 > 0 else cols:
            d = deltas.get(k, 0.0)
            if d:
                y1 = ycv(0) + d / dmax * STRIP_H * 0.35
                x = xof(k - 0.5)
                dq["b" if d > 0 else "s"].append([(x - XS * 0.35, ycv(0), 0), (x + XS * 0.35, ycv(0), 0), (x + XS * 0.35, y1, 0), (x - XS * 0.35, y1, 0)])
        inner.append(quads(dq["b"], PAL["buy"], tr=0.35) + quads(dq["s"], PAL["sell"], tr=0.35))
        # walls within this chunk
        for wi, w in enumerate(A["walls"]):
            ks = [k for k in cols if w["k0"] <= k <= w["k1"]]
            if len(ks) < 2:
                continue
            Q = bq if w["side"] == "bid" else aq
            y = yp(lo + (w["j"] + 0.5) * BIN)
            top = [(xof(k), y, hgt(Q[k][w["j"]] + (aq if w["side"] == "bid" else bq)[k][w["j"]]) + 0.05) for k in ks]
            fence = [[(xof(a_[0]), y, 0), (xof(b_[0]), y, 0), (b_[0] * 0 + xof(b_[0]), y, top[i + 1][2]), (xof(a_[0]), y, top[i][2])]
                     for i, (a_, b_) in enumerate(zip([(k,) for k in ks], [(k,) for k in ks[1:]]))]
            nm = "T_W%d_%d" % (wi, ci)
            inner.append('<Group>%s%s<TouchSensor DEF="%s" description="%s"/></Group>' % (
                quads(fence, PAL["wall"], tr=0.45, emis=0.7), lines([top], PAL["wall"], width=3.0), nm,
                attr("%s wall %s-%s, peak %s" % (w["side"], usd(lo + w["j"] * BIN, 0), usd(lo + (w["j"] + 1) * BIN, 0), btc(w["peak"])))))
            panel["items"][nm] = {"kind": "liquidity wall · %s side" % w["side"], "title": "%s wall at %s to %s" % (w["side"].capitalize(), usd(lo + w["j"] * BIN, 0), usd(lo + (w["j"] + 1) * BIN, 0)),
                                  "body": {"peak size": btc(w["peak"]), "mean size while a wall": btc(w["mean"]),
                                           "threshold": "%s (%dth percentile of non-empty near-price bins)" % (btc(A["wall_thr"]), WALL_P),
                                           "seen": "%s to %s (%d snapshots, %.0f s)" % (utc(T[w["k0"]]), utc(T[w["k1"]]), w["k1"] - w["k0"] + 1, T[w["k1"]] - T[w["k0"]]),
                                           "mean distance from mid": usd(w["dist"], 1), "traded at the level while resting": btc(w["traded_during"]),
                                           "fate": w["fate"], "source": "Kraken Depth snapshots, $5 bins (see README)"}}
        # pulled liquidity ghosts
        for p in [p for k in cols[1:] for p in pulls_by_k.get(k, [])] if k0 > 0 else [p for k in cols for p in pulls_by_k.get(k, [])]:
            hb = hgt(p["before"])
            x = xof(p["k"] - 0.5)
            y = yp(lo + (p["j"] + 0.5) * BIN)
            g = '<Transform translation="%s" scale="%s"><Shape USE="M_pull"/></Transform>' % (f3(x, y, hb), f3(XS * 0.9, ybin * 0.85, 0.035))
            if id(p) in top_pulls:
                nm = "T_P%d" % pl.index(p)
                g = '<Group>%s<TouchSensor DEF="%s" description="%s"/></Group>' % (g, nm, attr("pulled %s at %s %s" % (btc(p["pulled"]), p["side"], usd(lo + p["j"] * BIN, 0))))
                panel["items"][nm] = {"kind": "pulled liquidity (proxy) · %s side" % p["side"], "title": "%s pulled at %s to %s" % (btc(p["pulled"]), usd(lo + p["j"] * BIN, 0), usd(lo + (p["j"] + 1) * BIN, 0)),
                                      "body": {"interval": "%s to %s" % (utc(T[p["k"] - 1]), utc(T[p["k"]])), "size before": btc(p["before"]), "size after": btc(p["after"]),
                                               "traded at the bin in the interval": btc(p["traded"]), "pulled (lost - traded)": btc(p["pulled"]),
                                               "mid at the time": usd(A["mids"][p["k"]], 1),
                                               "distance from mid": usd(abs(lo + (p["j"] + 0.5) * BIN - A["mids"][p["k"]]), 1),
                                               "rule": "flag when >= %s (%dth percentile near-price bin); lower bound, REST cadence ~2 s" % (btc(A["pull_thr"]), PULL_P)}}
            inner.append(g)
        # trades
        tr_plain = []
        for c in [c for k in cols[1:] for c in trades_by_k.get(k, [])] if k0 > 0 else [c for k in cols for c in trades_by_k.get(k, [])]:
            r = 0.035 + 0.30 * (c["q"] / qmax_c) ** (1 / 3)
            xi = c["xq"] / c["q"]
            kk = min(N - 1, max(0, round(xi)))
            z = vh(kk, c["j"]) + r + 0.02
            g = '<Transform translation="%s" scale="%s"><Shape USE="%s"/></Transform>' % (f3(xof(xi), yp(c["pq"] / c["q"]), z), f3(r, r, r), "M_buy" if c["side"] == "b" else "M_sell")
            if id(c) in top_clusters:
                nm = "T_X%d" % clist.index(c)
                g = '<Group>%s<TouchSensor DEF="%s" description="%s"/></Group>' % (g, nm, attr("%s %s at %s" % ("buy" if c["side"] == "b" else "sell", btc(c["q"]), usd(c["pq"] / c["q"], 1))))
                panel["items"][nm] = {"kind": "trades · %s aggressor" % ("buy" if c["side"] == "b" else "sell"), "title": "%s %s at %s" % ("Bought" if c["side"] == "b" else "Sold", btc(c["q"]), usd(c["pq"] / c["q"], 1)),
                                      "body": {"trades in cluster": c["n"], "largest single trade": btc(c["maxq"]), "VWAP of cluster": usd(c["pq"] / c["q"], 2),
                                               "first / last": "%s / %s" % (utc(c["tmin"], True), utc(c["tmax"], True)), "order types": ", ".join(sorted(c["types"])),
                                               "price bin": "%s to %s" % (usd(lo + c["j"] * BIN, 0), usd(lo + (c["j"] + 1) * BIN, 0)),
                                               "resting at bin before": btc((aq if c["side"] == "b" else bq)[c["k"] - 1][c["j"]]),
                                               "source": "Kraken Trades (taker side b/s), clustered per interval, bin and side"}}
                inner.append(g)
            else:
                tr_plain.append(g)
        inner.append("".join(tr_plain))
        nm = "T_S%d" % ci
        sl = slice(k0 + 1 if k0 > 0 else 0, k1 + 1)
        ctr = [t for k in range(sl.start, sl.stop) for t in [x for x in A["trades"] if x["k"] == k]]
        buyv, sellv = sum(t["q"] for t in ctr if t["side"] == "b"), sum(t["q"] for t in ctr if t["side"] == "s")
        cpull = [p for k in range(sl.start, sl.stop) for p in pulls_by_k.get(k, [])]
        add('<Transform DEF="%s_grow" scale="0.0001 0.0001 0.0001"><Group>%s<TouchSensor DEF="%s" description="%s"/>%s</Group></Transform>' % (
            nm, surf, nm, attr("book %s to %s" % (utc(T[k0]), utc(T[k1]))), "".join(inner)))
        c1 = cards[k1]
        panel["items"][nm] = {"kind": "book window · %d snapshots" % nx, "title": "%s to %s" % (utc(T[k0]), utc(T[k1])),
                              "body": {"best bid / ask at end": "%s / %s" % (usd(c1["bid"]), usd(c1["ask"])), "spread at end": usd(c1["spread"], 2),
                                       "mid change": "%+.1f USD" % (c1["mid"] - cards[k0]["mid"]),
                                       "trades": len(ctr), "buy / sell aggressor volume": "%s / %s" % (btc(buyv), btc(sellv)), "delta": "%+.3f BTC" % (buyv - sellv),
                                       "largest trade": btc(max([t["q"] for t in ctr] or [0])),
                                       "pulled (flagged) in window": "%d events, %s" % (len(cpull), btc(sum(p["pulled"] for p in cpull))),
                                       "imbalance +-$%d at end" % IMB_USD: "%+.2f (bid %s vs ask %s)" % (c1["imb"], btc(c1["B"]), btc(c1["A"])),
                                       "source": "Kraken Depth + Trades REST, see README"}}
        reveal = k1 / (N - 1)
        f = frac(reveal)
        add('<PositionInterpolator DEF="I_%s" key="0 %.5f %.5f 1" keyValue="0.0001 0.0001 0.0001 0.0001 0.0001 0.0001 1 1 1 1 1 1"/>' % (nm, f - 1e-4, f))
        routes += [("Replay", "fraction_changed", "I_" + nm, "set_fraction"), ("I_" + nm, "value_changed", nm + "_grow", "set_scale")]
        interps.append("I_" + nm)
    # "now" cursor
    add('<Transform DEF="Cursor" translation="%s"><Shape><Appearance><Material diffuseColor="0 0 0" emissiveColor="%s" transparency="0.82"/></Appearance>'
        '<Box size="%s"/></Shape><Shape><Appearance><Material emissiveColor="%s"/></Appearance><LineSet vertexCount="2"><Coordinate point="%s"/></LineSet></Shape></Transform>'
        % (f3(XW, 0, 0), rgb(PAL["now"]), f3(0.03, PANEL_H, 0.02), rgb(PAL["now"]), f3(0, -PANEL_H / 2 - 0.1, 0.05, 0, PANEL_H / 2 + 0.1, 0.05)))
    # cursor's centre is at PANEL_H/2
    add('<PositionInterpolator DEF="I_Cursor" key="0 %.5f %.5f 1" keyValue="%s"/>' % (frac(0), frac(1), " ".join(f3(x, PANEL_H / 2, 0.02) for x in (0, 0, XW, XW))))
    routes += [("Replay", "fraction_changed", "I_Cursor", "set_fraction"), ("I_Cursor", "value_changed", "Cursor", "set_translation")]
    interps.append("I_Cursor")
    add('<TimeSensor DEF="Replay" cycleInterval="%s" loop="true"/>' % f3(CYCLE))
    # legend (scene-side, for viewers without the page)
    add(text((-0.3, yc0 - 1.1, 0), ["Height and colour: resting size per $5 bin, bids blue, asks copper (sqrt scale, capped at 1.6x the 99th percentile). Pale lines: best bid / best ask.",
                                    "Spheres: trades clustered per interval and bin, green = buy aggressor, red = sell aggressor (radius ~ cube root of BTC). Amber fences: liquidity walls.",
                                    "Violet lids: float where size vanished between snapshots without matching trades (lower-bound proxy at ~2 s polling). Not financial advice."],
                   size=0.17, col=PAL["ink2"]))
    # viewpoints
    ym = PANEL_H / 2
    mid_last = yp(A["mids"][-1])
    views = [
        ("VP_terrain", "Terrain, oblique from the bid side", (XW * 0.35, -9.5, 13), (XW * 0.55, ym, 0.6)),
        ("VP_ask", "Terrain from above the asks", (XW * 0.62, PANEL_H + 9, 11), (XW * 0.5, ym, 0.4)),
        ("VP_canyon", "Down the spread canyon (from now)", (XW + 3.2, mid_last + 1.6, 6.2), (XW * 0.45, yp(A["mids"][N // 2]), 0.2)),
        ("VP_side", "Side: depth by price, every snapshot (latest nearest)", (XW + 10, ym - 1.0, 6.5), (XW - 1.5, ym, 0.8)),
        ("VP_now", "Last minute close-up", (XW - 2.2, mid_last - 0.8, 6.5), (XW - 3.0, mid_last, 0.6)),
    ]
    # front: orthographic, so the face reads as a flat Bookmap heatmap (no perspective tunnel)
    fy0, fy1 = yc0 - 1.6, PANEL_H + 1.7
    vp = '<OrthoViewpoint DEF="VP_front" description="Front: heatmap (Bookmap view, orthographic)" position="%s" fieldOfView="%s" centerOfRotation="%s"/>\n' % (
        f3(XW / 2 + 0.6, (fy0 + fy1) / 2, 30), f3(-(XW / 2 + 2.6), -(fy1 - fy0) / 2, XW / 2 + 2.6, (fy1 - fy0) / 2), f3(XW / 2, ym, 0))
    panel["views"].append(["VP_front", "Front: heatmap (Bookmap view, orthographic)"])
    for d, desc, pos, tgt in views:
        vp += '<Viewpoint DEF="%s" description="%s" position="%s" orientation="%s" centerOfRotation="%s"/>\n' % (d, attr(desc), f3(*pos), f3(*look_at(pos, tgt)), f3(*tgt))
        panel["views"].append([d, desc])
    panel["interps"] = interps
    panel["cards"] = [{k: (round(v, 4) if isinstance(v, float) else [round(x, 4) for x in v] if isinstance(v, list) else v) for k, v in c.items()} for c in cards]
    panel["chunks"] = [{"name": "T_S%d" % ci, "k0": ci * CHUNK, "k1": min(N - 1, (ci + 1) * CHUNK)} for ci in range(nchunks)]
    panel["sources"] = src
    panel["params"] = {"bin_usd": BIN, "window": [lo, hi], "near_usd": NEAR_USD, "imb_usd": IMB_USD, "median_near_bin_btc": round(A["med"], 4),
                       "q_ref_btc": round(qref, 4), "wall_threshold_btc": round(A["wall_thr"], 4), "wall_min_snaps": WALL_MIN_SNAPS,
                       "pull_threshold_btc": round(A["pull_thr"], 4), "venue": "Kraken spot XBT/USD", "snapshots": N,
                       "span": [utc(T[0]), utc(T[-1])], "date": day}
    panel["summary"] = {"walls": len(A["walls"]), "pulls": len(A["pulls"]), "pulled_btc": round(sum(p["pulled"] for p in A["pulls"]), 3),
                        "trades": len(A["trades"]), "buy_btc": round(sum(t["q"] for t in A["trades"] if t["side"] == "b"), 4),
                        "sell_btc": round(sum(t["q"] for t in A["trades"] if t["side"] == "s"), 4), "clusters": len(clist)}
    head = [("title", "BTC/USD order book in 3D (Kraken spot)"),
            ("description", "Kraken spot XBT/USD top-500 order book polled every ~2 s via the public REST API, binned to $5: resting size as terrain "
                            "(bids blue, asks copper), trades as spheres by aggressor side, best bid/ask lines, liquidity walls and pulled-liquidity proxies, "
                            "spread and cumulative delta strips, replay."),
            ("generator", "orderbook-3d/build.py (Python %s)" % sys.version.split()[0])] + [
           ("source-" + os.path.basename(s["file"]), "%s sha256 %s (%d bytes)" % (s["file"], s["sha256"], s["bytes"])) for s in src] + [
           ("disclaimer", "Visual study tool, not financial advice. Pulled liquidity is a lower-bound proxy from ~2 s REST snapshots.")]
    x3d = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">\n'
           '<X3D profile="Interchange" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">\n<head>\n'
           + "".join('<component name="%s" level="%d"/>\n' % c for c in [("Shape", 2), ("Grouping", 2), ("Geometry3D", 3), ("PointingDeviceSensor", 1), ("Text", 1), ("Interpolation", 1), ("Time", 1), ("Navigation", 3)])
           + "".join('<meta name="%s" content="%s"/>\n' % (k, attr(v)) for k, v in head)
           + '</head>\n<Scene>\n<WorldInfo title="BTC/USD order book in 3D (Kraken spot)"/>\n'
           '<Background skyColor="0.035 0.047 0.071 0.063 0.082 0.118" skyAngle="1.5708"/>\n<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>\n'
           '<DirectionalLight direction="-0.35 -0.45 -0.8" intensity="0.45"/>\n' + vp + "\n".join(parts) + "\n"
           + "\n".join('<ROUTE fromNode="%s" fromField="%s" toNode="%s" toField="%s"/>' % r for r in routes) + "\n</Scene>\n</X3D>\n")
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "orderbook-scene.x3d"), "w", encoding="utf-8").write(x3d)
    json.dump(panel, open(os.path.join(OUT, "orderbook-panel.json"), "w"), indent=1, default=str)
    rep = {"scene_bytes": len(x3d.encode()), "panel_bytes": os.path.getsize(os.path.join(OUT, "orderbook-panel.json")), "routes": len(routes),
           "interpolators": len(interps), "touch": len(panel["items"]), "chunks": nchunks, "params": panel["params"], "summary": panel["summary"],
           "top_walls": [{"side": w["side"], "bin": [lo + w["j"] * BIN, lo + (w["j"] + 1) * BIN], "peak": round(w["peak"], 3), "snaps": w["k1"] - w["k0"] + 1, "fate": w["fate"]} for w in A["walls"][:12]],
           "top_pulls": [{"side": p["side"], "bin": lo + p["j"] * BIN, "pulled": round(p["pulled"], 3), "at": utc(T[p["k"]])} for p in pl[:10]],
           "last_card": panel["cards"][-1], "sources": src}
    json.dump(rep, open(os.path.join(OUT, "build-report.json"), "w"), indent=1, default=str)
    return rep


if __name__ == "__main__":
    r = build(stats="--stats" in sys.argv)
    if r:
        print(json.dumps(r, indent=1, default=str))
