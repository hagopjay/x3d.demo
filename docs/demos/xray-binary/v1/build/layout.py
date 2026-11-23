"""Layout for Demo 74 (Binary X-Ray v1). Pure Python, no Blender.

Reads the x3dray.binary records in ../data (binary.json, callgraph.json,
capability.json, ledger.json) and places every drawn thing in X3D coordinates
(Y up, metres). bake_city.py (Blender) and assemble.py (X3D) both read the
result, so the baked city and the unlit overlays cannot drift apart.

Every placed object carries the record id it was drawn from (FN_*, HYP_*, ...)
so the x3dray re_scene gate idea holds here too: nothing drawn without a record.
"""
import json
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def safe(n):
    return re.sub(r"[^A-Za-z0-9_]", "_", n)


SECTION_ALB = {".text": (0.36, 0.52, 0.62), ".plt.sec": (0.42, 0.40, 0.50), ".plt.got": (0.42, 0.40, 0.50),
               ".init": (0.36, 0.55, 0.45), ".fini": (0.36, 0.55, 0.45)}
CELL = 4.2


def building(fn, x, z, role):
    ins, bl = fn["insns"], fn["blocks"]
    h = 0.7 + 0.088 * ins
    w = min(3.2, 1.5 + 0.12 * bl)
    return {"id": "FN_" + safe(fn["name"]), "name": fn["name"], "section": fn["section"],
            "x": round(x, 3), "z": round(z, 3), "w": round(w, 3), "d": round(w, 3), "h": round(h, 3),
            "tiers": 1 + min(3, bl // 6), "insns": ins, "blocks": bl, "role": role,
            "anti": bool(fn.get("anti_debug")), "addr": hex(fn["addr"])}


def main():
    b, g = load("binary.json"), load("callgraph.json")
    cap, L = load("capability.json"), load("ledger.json")
    fns = b["functions"]
    gk = g.get("gatekeeper")
    target = (g.get("passage") or {}).get("target")
    text = sorted([f for f in fns if f["section"] == ".text"], key=lambda f: (-f["insns"], f["name"]))
    # .text: spiral by importance, main at the centre of the district
    cx, cz = 4.0, -1.0
    cells = sorted(((i, j) for i in range(-2, 3) for j in range(-2, 2)),
                   key=lambda c: (abs(c[0]) + abs(c[1]) * 1.1, c[0], c[1]))
    blds = []
    for f, (i, j) in zip(text, cells):
        role = "gatekeeper" if f["name"] == gk else ("target" if f["name"] == target else "code")
        blds.append(building(f, cx + i * CELL, cz + j * CELL, role))
    # imports: a row of gate kiosks along the front avenue
    plt = sorted([f for f in fns if f["section"].startswith(".plt")], key=lambda f: f["name"])
    for k, f in enumerate(plt):
        blds.append(building(f, -6.0 + k * 2.9, 11.5, "import"))
    # loader plaza: _init / _fini
    for k, f in enumerate([f for f in fns if f["section"] in (".init", ".fini")]):
        blds.append(building(f, -12.5, -6.0 + k * 5.0, "loader"))
    pos = {bd["name"]: bd for bd in blds}

    def node(name):
        return pos.get(name) or pos.get(name + "@plt")

    arcs = []
    for e in g["edges"]:
        a, c = node(e["from"]), node(e["to"])
        if not a or not c:
            continue
        p0 = (a["x"], a["h"] + 0.15, a["z"])
        p1 = (c["x"], c["h"] + 0.15, c["z"])
        dist = math.dist((p0[0], p0[2]), (p1[0], p1[2]))
        apex = max(p0[1], p1[1]) + 1.2 + 0.22 * dist
        pts = []
        for s in range(17):
            t = s / 16
            y = (1 - t) * p0[1] + t * p1[1] + 4 * t * (1 - t) * (apex - max(p0[1], p1[1]) * 0.5 - min(p0[1], p1[1]) * 0.5)
            pts.append((round(p0[0] + (p1[0] - p0[0]) * t, 3), round(y, 3), round(p0[2] + (p1[2] - p0[2]) * t, 3)))
        arcs.append({"from": e["from"], "to": e["to"], "kind": e["kind"], "points": pts})

    # derive's int3 scan perimeter: 48 byte tiles in a ring around the vault
    d = node("derive")
    scan = []
    if d:
        r = d["w"] * 0.5 + 0.75
        for i in range(48):
            a = 2 * math.pi * i / 48
            scan.append({"i": i, "x": round(d["x"] + r * math.cos(a), 3), "z": round(d["z"] + r * math.sin(a), 3),
                         "yaw": round(-a, 4)})

    # investigation helix
    hx, hz, R, rise = -23.0, -1.0, 3.4, 2.6
    rungs = []
    for i, row in enumerate(L["rows"]):
        a = i * 2 * math.pi / 5.2 + 0.6
        y = 2.2 + i * rise
        rungs.append({"id": "HYP_" + row["id"], "hid": row["id"], "phase": row["phase"], "verdict": row["verdict"],
                      "y": round(y, 3), "a": round(a, 4),
                      "p1": (round(hx + R * math.cos(a), 3), round(y, 3), round(hz + R * math.sin(a), 3)),
                      "p2": (round(hx - R * math.cos(a), 3), round(y, 3), round(hz - R * math.sin(a), 3))})
    strands = [[], []]
    for s in range(0, 181):
        t = s / 180
        a = 0.6 + t * (len(rungs) - 1 + 0.9) * 2 * math.pi / 5.2 - 0.2
        y = 2.2 - 0.6 + t * ((len(rungs) - 1) * rise + 1.6)
        strands[0].append((round(hx + R * math.cos(a), 3), round(y, 3), round(hz + R * math.sin(a), 3)))
        strands[1].append((round(hx - R * math.cos(a), 3), round(y, 3), round(hz - R * math.sin(a), 3)))
    touches = {"H1": ["reveal"], "H2": ["guard"], "H3": ["main"], "H4": ["guard", "main"],
               "H5": ["derive"], "H6": ["derive"]}

    # capability lattice, floating behind the city
    lat = cap["lattice"]
    # top concept (every function) at the top, as a Hasse diagram is read
    lx, ly, lz = 5.0, 12.5, -17.0
    top = max(c["level"] for c in lat["concepts"])
    lnodes = [{"i": i, "intent": c["intent"], "extent": c["extent"], "support": c["support"],
               "p": (round(lx + (c["x"] - 0.5) * 16.0, 3), round(ly + (top - c["level"]) * 3.4, 3), lz)}
              for i, c in enumerate(lat["concepts"])]
    lat_out = {"nodes": lnodes, "covers": lat["covers"]}

    out = {"buildings": blds, "arcs": arcs, "scan": scan,
           "helix": {"x": hx, "z": hz, "r": R, "rungs": rungs, "strands": strands, "touches": touches},
           "lattice": lat_out,
           "plinth": {"x0": -32.0, "x1": 19.0, "z0": -21.0, "z1": 17.0},
           "districts": [
               {"id": "D_text", "label": ".text", "x0": cx - 2.5 * CELL, "x1": cx + 2.5 * CELL,
                "z0": cz - 2.5 * CELL, "z1": cz + 1.5 * CELL},
               {"id": "D_plt", "label": ".plt.sec / .plt.got (imports)", "x0": -7.6, "x1": -6.0 + (len(plt) - 1) * 2.9 + 1.6,
                "z0": 9.7, "z1": 13.3},
               {"id": "D_loader", "label": ".init / .fini", "x0": -14.6, "x1": -10.4, "z0": -8.2, "z1": 1.2}],
           "gatekeeper": gk, "target": target}
    with open(os.path.join(DATA, "layout.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(f"layout: {len(blds)} buildings, {len(arcs)} arcs, {len(scan)} scan tiles, {len(rungs)} rungs, "
          f"{len(lnodes)} lattice nodes")


if __name__ == "__main__":
    main()
