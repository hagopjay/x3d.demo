#!/usr/bin/env python3
"""Controls for tiles3d_to_x3d v2 (stdlib). Exit 0 = all pass. Fixtures are synthetic and built in a temp folder.
Each refusal is checked by its message; the v1 converter is run on the same nested fixture to show the defect."""
import importlib.util, json, math, sys, tempfile, pathlib, re
HERE = pathlib.Path(__file__).resolve().parent
def load(p, n):
    s = importlib.util.spec_from_file_location(n, p); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
v2 = load(HERE / "tiles3d_to_x3d.py", "t2")
v1 = load(HERE.parents[1] / "docs/demos/geotiling/v1/tiles3d_to_x3d.py", "t1")
R = [math.radians(x) for x in (-80.425, 37.227, -80.421, 37.230)] + [600, 650]
la, lo = (R[1] + R[3]) / 2, (R[0] + R[2]) / 2
E = [-math.sin(lo), math.cos(lo), 0]; N = [-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)]
U = [math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)]
ENU = E + [0] + N + [0] + U + [0] + [0, 0, 0, 1]   # column-major east-north-up frame at the fixture centre (as geotiling v1 writes)
def tile(**k):  # every content tile carries the ENU frame unless the case overrides it; children inherit it, so they carry none
    if ("content" in k or "contents" in k) and "transform" not in k and not k.pop("child", False): k["transform"] = ENU
    return dict(boundingVolume={"region": R}, geometricError=k.pop("ge", 10), **k)
rows, bad = [], 0
def case(name, ok, detail=""):
    global bad; bad += not ok; rows.append({"case": name, "pass": bool(ok), "detail": detail})
def inline(out, f): return re.search(r"Inline url='\"([^\"]+)\"'", (out / f).read_text()).group(1)
with tempfile.TemporaryDirectory() as d:
    d = pathlib.Path(d); (d / "sub").mkdir()
    (d / "root.json").write_text(json.dumps({"asset": {"version": "1.1"}, "root": tile(ge=100, content={"uri": "sub/child.json"})}))
    (d / "sub/child.json").write_text(json.dumps({"asset": {"version": "1.1"}, "root": tile(ge=0, child=True, content={"uri": "mesh.glb"})}))
    (d / "sub/mesh.glb").write_bytes(b"glTF")
    o1, o2 = d / "out1", d / "out2"
    v1.convert(d / "root.json", o1); v2.convert(d / "root.json", o2)
    u1 = inline(o1, "t_0.x3d"); u2 = inline(o2, "t_0.x3d")
    case("v1 reproduces the review's nested-base defect", u1 == "../mesh.glb", u1)
    case("v2 resolves content against the tileset that names it", u2 == "../sub/mesh.glb" and (o2 / u2).resolve() == (d / "sub/mesh.glb").resolve(), u2)
    v2.convert(d / "root.json", d / "out3", content_base="tiles")
    case("v2 with --content-base keeps the sub folder", inline(d / "out3", "t_0.x3d") == "tiles/sub/mesh.glb", inline(d / "out3", "t_0.x3d"))
    def refuses(name, ts, needle):
        p = d / f"{name}.json"; p.write_text(json.dumps({"asset": {"version": "1.1"}, "root": ts}))
        try: v2.convert(p, d / f"o_{name}", dry=True); case(f"refuses {name}", False, "converted silently")
        except v2.Unsupported as e: case(f"refuses {name}", any(needle in i for i in e.items), e.items[0])
        s = v2.convert(p, d / f"o_{name}_lossy", allow_lossy=True)
        rep = d / f"o_{name}_lossy/conversion-report.json"
        case(f"--allow-lossy converts {name} and records the loss", rep.exists() and any(needle in l for l in s["losses"]), str(len(s["losses"])) + " loss(es)")
    (d / "a.glb").write_bytes(b"glTF"); (d / "b.glb").write_bytes(b"glTF")
    refuses("refine-add", tile(ge=50, refine="ADD", content={"uri": "a.glb"}, children=[tile(child=True, content={"uri": "b.glb"})]), "refine ADD")
    refuses("multi-contents", tile(contents=[{"uri": "a.glb"}, {"uri": "b.glb"}]), "2 contents")
    refuses("ECEF-framed content (identity transform, as Google's glb)", tile(transform=[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], content={"uri": "a.glb"}), "from local ENU")
    refuses("scaled-content", tile(transform=[2 * x for x in ENU[:12]] + [0, 0, 0, 1], content={"uri": "a.glb"}), "scale off")
    refuses("missing-external", tile(content={"uri": "nowhere.json"}), "not found")
    (d / "loop.json").write_text(json.dumps({"asset": {"version": "1.1"}, "root": tile(content={"uri": "loop.json"})}))
    try: v2.convert(d / "loop.json", d / "o_loop", dry=True); case("refuses an external tileset cycle", False)
    except v2.Unsupported as e: case("refuses an external tileset cycle", "cycle" in e.items[0], e.items[0])
    many = dict(tile(ge=80, children=[tile(child=True, content={"uri": "a.glb"}) for _ in range(9)]), transform=ENU)
    s = v2.convert(d / "root.json" if False else (lambda p: (p.write_text(json.dumps({"asset": {}, "root": many})), p)[1])(d / "many.json"), d / "o_many")
    case("more than 4 children still chunk (v1 behaviour kept)", s["chunked"] >= 1 and s["glb"] == 9 and not s["losses"], f"chunked {s['chunked']}, glb {s['glb']}")
    s1 = v1.convert(d / "many.json", d / "o_many1", dry=True)
    case("same tile count as v1 on a lossless tree", s["tiles"] == s1["tiles"], f"v1 {s1['tiles']} v2 {s['tiles']}")
print(json.dumps({"suite": "tiles3d_to_x3d v2", "python": sys.version.split()[0], "passed": len(rows) - bad, "failed": bad, "cases": rows}, indent=1))
sys.exit(1 if bad else 0)
