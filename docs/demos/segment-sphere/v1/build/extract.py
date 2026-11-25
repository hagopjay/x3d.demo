"""Extract the AWS Segment Wheel (hagopjay/aws_SegmentWheel index.html) into data/services.json.

Usage: python -I build/extract.py /path/to/aws_segmentwheel
Reads only the page's own SVG and table. Every service keeps: its short label, the category
(from the wedge it sits in, cross-checked against the dot colour), its ring (wheel radius 204/444/684),
its exact wheel angle, its lifecycle glyph (bullet GA, diamond preview, circle closed, dagger sunset),
and, for the 38 watch-list rows, the full name and note. Fails loudly if any count disagrees with the page.
"""
import collections, hashlib, html, json, math, os, re, subprocess, sys

src = sys.argv[1]
p = os.path.join(src, "index.html")
raw = open(p, "rb").read()
s = raw.decode("utf-8")
commit = subprocess.run(["git", "-C", src, "log", "-1", "--format=%H"], capture_output=True, text=True).stdout.strip()
svg = s[s.index("<svg"):s.index("</svg>")]
U = html.unescape
cats = [dict(name=U(n), color=c.upper(), count=int(k)) for c, n, k in
        re.findall(r'<span class="chip"><i style="background:(#[0-9A-Fa-f]{6})"></i>(.*?) <b>(\d+)</b></span>', s)]
C = 1080.0
def compass(x, y):
    return math.degrees(math.atan2(x - C, C - y)) % 360
wedges = []
for d, fill in re.findall(r'<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})" fill-opacity="0.85"/>', svg):
    n = list(map(float, re.findall(r"-?\d+\.?\d*", d)))
    wedges.append(dict(color=fill.upper(), a0=compass(n[0], n[1]), a1=compass(n[7], n[8])))
assert [w["color"] for w in wedges] == [c["color"] for c in cats], "wedge order != chip order"
for c, w in zip(cats, wedges):
    c["a0"], c["a1"] = round(w["a0"], 4), round(w["a1"], 4)
    c["span"] = round((w["a1"] - w["a0"]) % 360, 4)
def cat_of(a):
    for i, c in enumerate(cats):
        if (a - c["a0"]) % 360 < c["span"]:
            return i
    raise ValueError(a)
GLYPH = {"◇": "preview", "◦": "closed", "†": "sunset"}
RINGS = {204.0: 0, 444.0: 1, 684.0: 2}
svcs = []
for rot, body in re.findall(r'<g transform="rotate\((-?[\d.]+) 1080.0 1080.0\)">\s*(.*?)</g>', svg, re.S):
    cx = float(re.search(r'cx="([\d.]+)"', body).group(1))
    fill = re.search(r'fill="(#[0-9A-Fa-f]{6})"', body).group(1).upper()
    label = U(re.sub("<[^>]+>", "", re.search(r"<text[^>]*>(.*?)</text>", body, re.S).group(1))).strip()
    r = math.radians(float(rot))
    x = C + (cx - C) * math.cos(r); y = C + (cx - C) * math.sin(r)
    ang = compass(x, y)
    status = "ga"
    if label[-1] in GLYPH:
        status = GLYPH[label[-1]]; label = label[:-1].strip()
    ci = cat_of(ang)
    if status in ("ga", "preview"):
        assert fill == cats[ci]["color"], (label, fill, cats[ci])
    svcs.append(dict(name=label, cat=ci, ring=RINGS[abs(cx - C)], angle=round(ang, 4), status=status))
cnt = collections.Counter(v["cat"] for v in svcs)
for i, c in enumerate(cats):
    assert cnt[i] == c["count"], (c["name"], cnt[i], c["count"])
rows = [dict(full=U(a), cat=U(b), status=k, label=U(t), note=U(n)) for a, b, k, t, n in
        re.findall(r'<tr><td>(.*?)</td><td>(.*?)</td><td><span class="st (\w+)">(.*?)</span></td><td>(.*?)</td></tr>', s)]
# join watch-list rows to wheel dots by category + name suffix
for r in rows:
    ci = [c["name"] for c in cats].index(r["cat"])
    m = [v for v in svcs if v["cat"] == ci and v["status"] != "ga" and (r["full"].endswith(v["name"]) or v["name"] in r["full"]
         or (v["name"] == "QLDB" and "Quantum Ledger" in r["full"]) or (v["name"] == "Interconnect" and "Interconnect" in r["full"]))]
    assert len(m) == 1, (r, [v["name"] for v in m])
    v = m[0]; assert "full" not in v, v
    want = {"closed": "closed", "sunset": "sunset", "preview": "preview"}[r["status"]]
    assert v["status"] == want, (v, r)
    v["full"], v["note"], v["status_label"] = r["full"], r["note"], r["label"]
flagged = [v for v in svcs if v["status"] != "ga"]
assert len(flagged) == len(rows) == 38 and all("full" in v for v in flagged)
title = U(re.search(r"<title>(.*?)</title>", s).group(1))
foot = U(re.sub(r"\s+", " ", re.sub("<[^>]+>", "", re.search(r"<footer>(.*?)</footer>", s, re.S).group(1)))).strip()
out = dict(source=dict(repo="https://github.com/hagopjay/aws_SegmentWheel", live="https://hagopjay.github.io/aws_SegmentWheel/",
                       commit=commit, file="index.html", sha256=hashlib.sha256(raw).hexdigest(), title=title,
                       compiled="September 2026", footer=foot),
           counts=dict(services=len(svcs), categories=len(cats), watch=len(rows),
                       by_status=dict(collections.Counter(v["status"] for v in svcs)),
                       by_ring=dict(collections.Counter(v["ring"] for v in svcs))),
           categories=cats, services=svcs)
os.makedirs("data", exist_ok=True)
json.dump(out, open("data/services.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(json.dumps(out["counts"]), out["source"]["sha256"][:16])
