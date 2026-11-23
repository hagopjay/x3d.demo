"""Assemble Demo 74's X3D 4.0 world around the Blender-baked city.

Pure Python. Reads ../data/layout.json and the x3dray.binary records, writes
../assets/xray-binary.x3d. The baked city comes in by Inline
(city-baked.x3d, unlit per-corner colour); everything that must glow, move or
switch is drawn here, unbaked:

  call constellation   Extrusion arcs between rooftops, colour = edge kind,
                       a packet travelling each arc (PositionInterpolator)
  int3 scan ring       48 byte tiles around derive; in the gdb world one turns
                       red and reads CC
  the two worlds       Switch DEF='Worlds': 0 = native (salt 0), 1 = under gdb
                       (salt 0xa5a5a5a5, poisoned serial accepted)
  investigation helix  two strands, one rung per hypothesis, verdict colour,
                       a line from each rung to the buildings it is about
  capability lattice   FCA concepts as spheres, covers as rods
  .rodata wall         each encrypted string beside its decoded text

ROUTEs are written after every node they name (an X_ITE trap).
"""
import json
import math
import os
from xml.sax.saxutils import quoteattr

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")


def load(name):
    with open(os.path.join(ROOT, "data", name), encoding="utf-8") as fh:
        return json.load(fh)


def f(x):
    s = f"{x:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def v3(p):
    return " ".join(f(c) for c in p)


def hx(h):
    h = h.lstrip("#")
    return " ".join(f(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def q(s):
    return quoteattr(s)


KIND = {"direct": "#6fb7e0", "plt": "#c58ce0", "runtime": "#ffd36b", "indirect": "#7f93a3"}
VERD = {"CONFIRMED": "#5cf2a0", "REFUTED": "#ff5a52", "UNTESTED": "#9aa9b5"}
PHASE = {"static": "#6fb7e0", "dynamic": "#ff9a52", "oracle": "#ffd36b"}
LABEL = "#dce8ef"


def glow(color, transp=0.0):
    t = f" transparency='{f(transp)}'" if transp else ""
    return (f"<Appearance><Material diffuseColor='0 0 0' specularColor='0 0 0' "
            f"emissiveColor='{hx(color)}'{t}/></Appearance>")


def circle(r, n=10):
    pts = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
    return " ".join(f"{f(a)} {f(b)}" for a, b in pts)


def tube(points, r, color, defn=None, transp=0.0):
    d = f" DEF='{defn}'" if defn else ""
    return (f"<Shape{d}>{glow(color, transp)}<Extrusion crossSection='{circle(r)}' "
            f"spine='{' '.join(v3(p) for p in points)}' beginCap='false' endCap='false' "
            f"solid='false' creaseAngle='1.6'/></Shape>")


def mfstring(lines):
    """MFString for a single-quoted XML attribute: backslash-escape \\ and \" inside each
    string, then XML-escape & < > and the apostrophe."""
    out = []
    for x in lines:
        x = x.replace("\\", "\\\\").replace('"', '\\"')
        x = x.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&apos;")
        out.append('"' + x + '"')
    return " ".join(out)


def text(s, pos, size, color=LABEL, bill=True, justify="MIDDLE", family="TYPEWRITER", bold=False):
    lines = s if isinstance(s, list) else [s]
    sv = mfstring(lines)
    st = "BOLD" if bold else "PLAIN"
    shape = (f"<Shape>{glow(color)}<Text string='{sv}'><FontStyle family='\"{family}\"' style='{st}' "
             f"size='{f(size)}' justify='\"{justify}\" \"MIDDLE\"'/></Text></Shape>")
    if bill:
        shape = f"<Billboard axisOfRotation='0 1 0'>{shape}</Billboard>"
    return f"<Transform translation='{v3(pos)}'>{shape}</Transform>"


def sphere(pos, r, color, defn=None):
    d = f" DEF='{defn}'" if defn else ""
    return f"<Transform{d} translation='{v3(pos)}'><Shape>{glow(color)}<Sphere radius='{f(r)}'/></Shape></Transform>"


def box(pos, size, color, defn=None, rot=None, transp=0.0):
    d = f" DEF='{defn}'" if defn else ""
    r = f" rotation='0 1 0 {f(rot)}'" if rot is not None else ""
    return f"<Transform{d} translation='{v3(pos)}'{r}><Shape>{glow(color, transp)}<Box size='{v3(size)}'/></Shape></Transform>"


def main():
    L, B, G = load("layout.json"), load("binary.json"), load("callgraph.json")
    LED, CL = load("ledger.json"), load("claims.json")
    rows = {r["id"]: r for r in LED["rows"]}
    bpos = {b["name"]: b for b in L["buildings"]}
    out, routes = [], []
    gk = L["gatekeeper"]
    main_b, der = bpos[gk], bpos["derive"]

    out.append("<?xml version='1.0' encoding='UTF-8'?>")
    out.append("<!DOCTYPE X3D PUBLIC 'ISO//Web3D//DTD X3D 4.0//EN' 'https://www.web3d.org/specifications/x3d-4.0.dtd'>")
    out.append("<X3D profile='Immersive' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' "
               "xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>")
    out.append("<head>")
    out.append("<meta name='title' content='Binary X-Ray: the debugger lies (Demo 74 v1)'/>")
    out.append("<meta name='description' content='crackme1 reverse-engineered by x3dray.binary: a Blender-baked binary city, "
               "its call constellation, the int3 scan ring, the investigation helix of six re-run hypotheses and the capability lattice.'/>")
    out.append("<meta name='generator' content='x3d.demo xray-binary/v1 build/assemble.py; city baked in Blender 5.3.0, exported by x3d-blender-io 2.7.4'/>")
    out.append(f"<meta name='x3dray.binary_sha256' content='{LED['binary_sha256']}'/>")
    out.append("<meta name='method' content='hypothesis-debugging loop after ioma8, LLM assisted reverse engineering, Slow Chronicle, 18 Nov 2026'/>")
    out.append("<meta name='reference' content='https://www.slowchronicle.com/posts/llm-assisted-reverse-engineering'/>")
    out.append("<meta name='license' content='CC BY 4.0 for this scene; crackme1 is a self-authored benign target'/>")
    out.append("</head><Scene>")
    out.append("<WorldInfo title='Binary X-Ray: the debugger lies'/>")
    out.append("<NavigationInfo type='\"EXAMINE\" \"ANY\"' headlight='false' visibilityLimit='400'/>")
    # sky, horizon and fog share one colour so no band shows where the fog meets the sky
    out.append("<Background skyColor='0.008 0.014 0.026 0.02 0.036 0.064 0.035 0.06 0.1' skyAngle='1.2 1.5708' "
               "groundColor='0.035 0.06 0.1 0.035 0.06 0.1' groundAngle='1.5708'/>")
    out.append("<Fog color='0.035 0.06 0.1' fogType='EXPONENTIAL' visibilityRange='230'/>")
    H = L["helix"]
    vps = [("VP_Hero", "Hero: the city, its calls and the helix", (25, 8.5, 27), (-0.12, 0.72)),
           ("VP_Overview", "Overview: the binary city", (-4, 27, 47), (-0.48, 0)),
           ("VP_Gatekeeper", f"The gatekeeper: {gk}", (main_b['x'] + 9, 12, main_b['z'] + 15), (-0.42, 0.52)),
           ("VP_Vault", "derive and its int3 scan ring", (der['x'] - 7.5, 8.0, der['z'] + 11.5), (-0.5, -0.55)),
           ("VP_Helix", "The investigation helix", (H['x'] + 6, 10.5, H['z'] + 25), (-0.12, 0.22)),
           ("VP_Lattice", "The capability lattice", (5, 16.5, 6), (-0.08, 0)),
           ("VP_Imports", "Imports: the PLT gates", (2.5, 3.6, 22), (-0.15, 0))]
    for d, desc, pos, (pitch, yaw) in vps:
        # orientation = yaw about Y then pitch about X, folded into one axis-angle
        cy, sy, cp, sp = math.cos(yaw / 2), math.sin(yaw / 2), math.cos(pitch / 2), math.sin(pitch / 2)
        w, x, y, z = cy * cp, cy * sp, sy * cp, -sy * sp
        ang = 2 * math.acos(max(-1, min(1, w)))
        s = math.sqrt(max(1e-12, 1 - w * w))
        out.append(f"<Viewpoint DEF='{d}' description={q(desc)} position='{v3(pos)}' "
                   f"orientation='{f(x / s)} {f(y / s)} {f(z / s)} {f(ang)}' fieldOfView='0.8'/>")
    out.append("<Inline DEF='City' url='\"city-baked.x3d\"'/>")

    # ---- labels on the city
    for b in L["buildings"]:
        top = b["h"] + (2.6 if b["role"] == "gatekeeper" else 1.0 if b["role"] == "import" else 0.7)
        col = "#ffd36b" if b["role"] == "gatekeeper" else ("#ff9a52" if b["anti"] or b["name"].startswith("ptrace") else LABEL)
        size = 0.62 if b["role"] in ("gatekeeper", "target") else 0.42
        out.append(text(b["name"].replace("@plt", ""), (b["x"], top + 0.55, b["z"]), size, col))
    for d in L["districts"]:
        out.append(f"<Transform translation='{f((d['x0'] + d['x1']) / 2)} 0.2 {f(d['z1'] + 0.9)}' rotation='1 0 0 -1.5708'>"
                   f"<Shape>{glow('#6f8aa0')}<Text string='{mfstring([d['label']])}'><FontStyle family='\"TYPEWRITER\"' "
                   f"size='0.9' justify='\"MIDDLE\" \"MIDDLE\"'/></Text></Shape></Transform>")

    # ---- call constellation + packets
    out.append("<Group DEF='Calls'>")
    for i, a in enumerate(L["arcs"]):
        out.append(tube(a["points"], 0.055 if a["kind"] != "runtime" else 0.08, KIND[a["kind"]], f"ARC_{i}"))
        keys = " ".join(f(k / (len(a["points"]) - 1)) for k in range(len(a["points"])))
        out.append(sphere(a["points"][0], 0.16, "#ffffff", f"PKT_{i}"))
        period = 2.2 + 0.25 * (i % 5)
        out.append(f"<TimeSensor DEF='T_{i}' cycleInterval='{f(period)}' loop='true'/>")
        out.append(f"<PositionInterpolator DEF='PI_{i}' key='{keys}' keyValue='{' '.join(v3(p) for p in a['points'])}'/>")
        routes.append(f"<ROUTE fromNode='T_{i}' fromField='fraction_changed' toNode='PI_{i}' toField='set_fraction'/>")
        routes.append(f"<ROUTE fromNode='PI_{i}' fromField='value_changed' toNode='PKT_{i}' toField='set_translation'/>")
    out.append("</Group>")
    # legend for arc kinds, floating at the front-right corner
    lx, ly, lz = 17.0, 1.2, 14.5
    for k, (kind, col) in enumerate([("direct call", KIND["direct"]), ("PLT import call", KIND["plt"]),
                                     ("runtime: __libc_start_main(main)", KIND["runtime"])]):
        out.append(tube([(lx - 4.6, ly + k * 0.8, lz), (lx - 3.4, ly + k * 0.8, lz)], 0.07, col))
        out.append(text(kind, (lx - 3.1, ly + k * 0.8, lz), 0.4, col, bill=False, justify="BEGIN"))

    # ---- the two worlds: native vs under gdb
    h2, h3, h5 = rows["H2"]["observed"], rows["H3"]["observed"], rows["H5"]["observed"]
    salt_gdb = h2.get("gdb-salt-at-main", "?")
    poisoned, true = h3.get("poisoned_serial", "?"), h5.get("alice", "?")
    scan = L["scan"]
    board = (-11.0, 10.5, -10.0)

    CC_TILE = 16          # the byte that faces the vault viewpoint; any of the 48 would do

    def ring(red):
        parts = []
        for t in scan:
            hot = red and t["i"] == CC_TILE
            parts.append(box((t["x"], 0.3, t["z"]), (0.34, 0.12 if not hot else 0.5, 0.2),
                             "#ff3b30" if hot else "#46d7c4", rot=t["yaw"]))
        if red:
            t0 = scan[CC_TILE]
            parts.append(box((t0["x"], 1.6, t0["z"]), (0.12, 3.2, 0.12), "#ff3b30"))
            parts.append(text(["0xCC", "int3 found"], (t0["x"] + 0.4, 3.9, t0["z"]), 0.5, "#ff3b30", bold=True))
        return "".join(parts)
    native = [ring(False),
              text(["NATIVE RUN  (no debugger)", "salt = 0x00000000",
                    f"alice  {true}   accepted", f"alice  {poisoned}   rejected"],
                   board, 0.55, "#5cf2a0")]
    gdb = [ring(True),
           text(["UNDER GDB  (traced)", f"salt = {salt_gdb}",
                 f"alice  {poisoned}   accepted", "the debugger lies"],
                board, 0.55, "#ff6a5a"),
           # the observer's lens: a red ring hanging over the city
           tube([(main_b["x"] + 13 * math.cos(2 * math.pi * i / 64), 11.8, main_b["z"] + 9 * math.sin(2 * math.pi * i / 64))
                 for i in range(65)], 0.12, "#ff3b30"),
           tube([(main_b["x"] + 13, 11.8, main_b["z"]), (der["x"], der["h"] + 1.0, der["z"])], 0.05, "#ff3b30")]
    out.append(f"<Switch DEF='Worlds' whichChoice='0'><Group DEF='NativeWorld'>{''.join(native)}</Group>"
               f"<Group DEF='GdbWorld'>{''.join(gdb)}</Group></Switch>")

    # ---- investigation helix
    out.append("<Group DEF='Helix'>")
    out.append(tube(H["strands"][0], 0.13, "#6fb7e0"))
    out.append(tube(H["strands"][1], 0.13, "#ff9a52"))
    out.append(text(["INVESTIGATION HELIX", "one rung per hypothesis, re-run here"],
                    (H["x"], 0.9, H["z"] + 6.6), 0.5, LABEL, bill=False))
    for rg in H["rungs"]:
        r = rows[rg["hid"]]
        vc = VERD[r["verdict"]]
        out.append(f"<Group DEF='{rg['id']}'>")
        out.append(tube([rg["p1"], rg["p2"]], 0.09, vc))
        out.append(sphere(rg["p1"], 0.38, PHASE[r["phase"]]))
        out.append(sphere(rg["p2"], 0.28, vc))
        mid = ((rg["p1"][0] + rg["p2"][0]) / 2, rg["y"], (rg["p1"][2] + rg["p2"][2]) / 2)
        hyp = r["hypothesis"]
        short = hyp if len(hyp) < 64 else hyp[:61].rsplit(" ", 1)[0] + "..."
        side = rg["p1"] if rg["p1"][0] <= rg["p2"][0] else rg["p2"]
        out.append(text([f"{r['id']}  {r.get('title', '')}", f"{r['phase']} · {r['verdict'].lower()}"],
                        (side[0] - 0.6, rg["y"] + 0.15, side[2]), 0.42, vc, justify="END"))
        # touch lines to the buildings this hypothesis is about
        for fn in H["touches"].get(r["id"], []):
            b = bpos.get(fn)
            if b:
                out.append(f"<Shape>{glow(vc, 0.75)}<IndexedLineSet coordIndex='0 1 -1'>"
                           f"<Coordinate point='{v3(rg['p2'])} {f(b['x'])} {f(b['h'] + 0.3)} {f(b['z'])}'/></IndexedLineSet></Shape>")
        out.append("</Group>")
    out.append("</Group>")

    # ---- capability lattice
    lat = L["lattice"]
    out.append("<Group DEF='Lattice'>")
    for a, b2 in lat["covers"]:
        out.append(tube([lat["nodes"][a]["p"], lat["nodes"][b2]["p"]], 0.06, "#6f8aa0"))
    for n in lat["nodes"]:
        hot = "anti-debug" in n["intent"]
        col = "#ff9a52" if hot else ("#ffd36b" if len(n["intent"]) >= 4 else "#6fb7e0")
        out.append(sphere(n["p"], 0.35 + 0.18 * n["support"], col, f"CONCEPT_{n['i']}"))
        intent = ", ".join(n["intent"]) or "top: every function"
        out.append(text([intent, ", ".join(n["extent"])], (n["p"][0], n["p"][1] + 1.25 + 0.18 * n["support"], n["p"][2]),
                        0.38, col))
    out.append(text(["CAPABILITY LATTICE", "formal concept analysis, x3dray.fca"],
                    (5.0, 10.6, -17.0), 0.5, LABEL, bill=False))
    out.append("</Group>")

    # ---- .rodata wall: encrypted bytes beside the decoded text (H1)
    dec = rows["H1"]["observed"]["decoded"]
    model = LED.get("model") or {}
    wall = ["<Group DEF='Rodata'>"]
    wz = -22.5
    wall.append(text([".rodata: what `strings` sees vs what the H1 decoder recovers"],
                     (-5.0, 4.6, wz), 0.5, LABEL, bill=False))
    for k, s in enumerate(dec):
        enc = bytes(c ^ ((0x33 + 7 * i) & 0xFF) for i, c in enumerate(s.encode()))
        hexs = " ".join(f"{c:02x}" for c in enc[:16]) + (" .." if len(enc) > 16 else "")
        y = 3.3 - k * 1.2
        wall.append(text(hexs, (-14.0, y, wz), 0.42, "#7f93a3", bill=False, justify="BEGIN"))
        wall.append(text("->  " + s.replace("\n", "\\n"), (2.0, y, wz), 0.42, "#5cf2a0", bill=False, justify="BEGIN"))
    wall.append("</Group>")
    out.extend(wall)
    out.extend(routes)
    out.append("</Scene></X3D>")
    dst = os.path.join(ROOT, "assets", "xray-binary.x3d")
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"wrote {dst}: {os.path.getsize(dst)} bytes, {len(routes)} routes, {len(L['arcs'])} arcs")


if __name__ == "__main__":
    main()
