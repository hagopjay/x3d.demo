#!/usr/bin/env python3
"""Controls for tiles3d_to_x3d v2 (stdlib). Exit 0 = all pass. Fixtures are synthetic and built in a temp folder.
Each refusal is checked by its message; the v1 converter is run on the same nested fixture to show the defect."""
import importlib.util, json, math, sys, tempfile, pathlib, re
HERE = pathlib.Path(__file__).resolve().parent
def load(p, n):
    s = importlib.util.spec_from_file_location(n, p); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
v2 = load(HERE / "tiles3d_to_x3d.py", "t2")
v22 = load(HERE / "v2.2-shipped.py", "t22")
v1 = load(HERE.parents[1] / "docs/demos/geotiling/v1/tiles3d_to_x3d.py", "t1")
R = [math.radians(x) for x in (-80.425, 37.227, -80.421, 37.230)] + [600, 650]
la, lo = (R[1] + R[3]) / 2, (R[0] + R[2]) / 2
E = [-math.sin(lo), math.cos(lo), 0]; N = [-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)]
U = [math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)]
C = v2.geodetic_to_ecef(math.degrees(la), math.degrees(lo), 625.0)
# column-major east-north-up frame AT the fixture centre (v2.1: the frame's translation is where content sits; the v2
# fixture had no translation, i.e. content at the Earth's centre, and v2 hid it by placing content at the region centre)
ENU = E + [0] + N + [0] + U + [0] + list(C) + [1]
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
    refuses("ECEF-framed content (identity transform, as Google's glb)", tile(transform=[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], content={"uri": "a.glb"}), "ECEF-baked")
    refuses("rotated content (x axis pointing north)", tile(transform=N + [0] + [-x for x in E] + [0] + U + [0] + list(C) + [1], content={"uri": "a.glb"}), "from local ENU")
    refuses("scaled-content", tile(transform=[2 * x for x in ENU[:12]] + list(C) + [1], content={"uri": "a.glb"}), "scale off")
    refuses("missing-external", tile(content={"uri": "nowhere.json"}), "not found")
    (d / "loop.json").write_text(json.dumps({"asset": {"version": "1.1"}, "root": tile(content={"uri": "loop.json"})}))
    try: v2.convert(d / "loop.json", d / "o_loop", dry=True); case("refuses an external tileset cycle", False)
    except v2.Unsupported as e: case("refuses an external tileset cycle", "cycle" in e.items[0], e.items[0])
    many = dict(tile(ge=80, children=[tile(child=True, content={"uri": "a.glb"}) for _ in range(9)]), transform=ENU)
    s = v2.convert(d / "root.json" if False else (lambda p: (p.write_text(json.dumps({"asset": {}, "root": many})), p)[1])(d / "many.json"), d / "o_many")
    case("more than 4 children still chunk (v1 behaviour kept)", s["chunked"] >= 1 and s["glb"] == 9 and not s["losses"], f"chunked {s['chunked']}, glb {s['glb']}")
    s1 = v1.convert(d / "many.json", d / "o_many1", dry=True)
    case("same tile count as v1 on a lossless tree", s["tiles"] == s1["tiles"], f"v1 {s1['tiles']} v2 {s['tiles']}")
    # second review, defect 4: the reviewer's probe. ENU at (0 N, 0 E, 0 m): ECEF (6378137, 0, 0); a sphere centred
    # 10 m east of the content origin. Content must sit at the origin; v2 put it at the sphere centre (9.996 m off).
    E0 = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 6378137, 0, 0, 1]
    (d / "off.json").write_text(json.dumps({"asset": {"version": "1.1"}, "root": {"boundingVolume": {"sphere": [10, 0, 0, 20]},
        "geometricError": 0, "transform": E0, "content": {"uri": "a.glb"}}}))
    def geo(out, f): return [float(x) for x in re.search(r'GeoLocation[^>]*geoCoords="([^"]+)"', (out / f).read_text()).group(1).split()]
    v2_shipped = load(HERE / "v2-shipped.py", "t2s") if (HERE / "v2-shipped.py").exists() else None
    s = v2.convert(d / "off.json", d / "o_off"); g = geo(d / "o_off", "t.x3d")
    err = v2.geo_distance(tuple(g), (0.0, 0.0, 0.0))
    case("off-centre sphere: content placed at the frame origin (6378137, 0, 0)", err < 0.01, f"{err:.4f} m from the origin; bv centre offset {s['origin_offsets_m']}")
    if v2_shipped:
        v2_shipped.convert(d / "off.json", d / "o_off_v2"); g0 = geo(d / "o_off_v2", "t.x3d")
        e0 = v2.geo_distance(tuple(g0), (0.0, 0.0, 0.0))
        case("v2 as shipped reproduces the review's error (about 10 m)", 9.9 < e0 < 10.1, f"{e0:.3f} m")
    # nested translations accumulate: parent frame at the origin above, child translated 100 m east in that frame
    child = {"boundingVolume": {"sphere": [0, 0, 0, 5]}, "geometricError": 0, "transform": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1], "content": {"uri": "b.glb"}}
    (d / "nest.json").write_text(json.dumps({"asset": {"version": "1.1"}, "root": {"boundingVolume": {"sphere": [0, 0, 0, 200]},
        "geometricError": 50, "transform": E0, "children": [child]}}))
    v2.convert(d / "nest.json", d / "o_nest"); g = geo(d / "o_nest", "t_0.x3d")
    want = v2.ecef_to_geodetic(6378137, 100, 0)
    err = v2.geo_distance(tuple(g), want)
    case("nested transforms: child content at parent frame + 100 m east", err < 0.01, f"{err:.4f} m; lon {g[1]:.7f} vs {want[1]:.7f}")
    # third review (18 Nov 2026): URI identity and XML, antimeridian, pole, encoded local path, stale report
    import xml.etree.ElementTree as ET
    def one(name, root, extra=None):
        q = d / f"{name}.json"; q.write_text(json.dumps({"asset": {"version": "1.1"}, "root": root})); o = d / f"o3_{name}"
        s = v2.convert(q, o); return s, o
    (d / "mesh&a.glb").write_bytes(b"glTF")
    s, o = one("amp", {"boundingVolume": {"sphere": [0, 0, 0, 5]}, "geometricError": 0, "transform": E0, "content": {"uri": "mesh&a.glb"}})
    xml = (o / "t.x3d").read_text(); ok = True
    try: el = ET.fromstring(xml); url = el.find(".//Inline").get("url")
    except ET.ParseError as e: ok, url = False, str(e)
    case("R3: `mesh&a.glb` gives well-formed XML and keeps the & in the URI", ok and url == '"../mesh&a.glb"', url)
    s, o = one("query", {"boundingVolume": {"sphere": [0, 0, 0, 5]}, "geometricError": 0, "transform": E0,
                         "content": {"uri": "https://example.invalid/mesh.glb?variant=red&proof=1#f"}})
    url = ET.fromstring((o / "t.x3d").read_text()).find(".//Inline").get("url")
    case("R3: absolute content URL keeps its query and fragment", url == '"https://example.invalid/mesh.glb?variant=red&proof=1#f"', url)
    (d / "sub dir").mkdir(); (d / "sub dir/mesh.glb").write_bytes(b"glTF")
    (d / "sub dir/child.json").write_text(json.dumps({"asset": {"version": "1.1"}, "root": {"boundingVolume": {"sphere": [0, 0, 0, 5]}, "geometricError": 0, "content": {"uri": "mesh.glb"}}}))
    s, o = one("pct", {"boundingVolume": {"sphere": [0, 0, 0, 5]}, "geometricError": 1, "transform": E0, "content": {"uri": "sub%20dir/child.json"}})
    case("R3: percent-encoded local tileset path is found and the output stays encoded", s["external_missing"] == 0 and s["content_uris"] == ["../sub%20dir/mesh.glb"], str(s["content_uris"]))
    am = [math.radians(x) for x in (179.9, -0.1, -179.9, 0.1)] + [0, 20]
    s, o = one("anti", {"boundingVolume": {"region": am}, "geometricError": 10, "children": [{"boundingVolume": {"region": am}, "geometricError": 0}]})
    c = [float(x) for x in re.search(r'GeoLOD[^>]*center="([^"]+)"', (o / "t.x3d").read_text()).group(1).split()]
    case("R3: region 179.9..-179.9 has its GeoLOD centre at 180, not 0", abs(abs(c[1]) - 180) < 1e-6, f"centre lon {c[1]}")
    b = 6378137.0 * (1 - 1 / 298.257223563)
    pole = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, b, 1]
    try:
        v2.convert((lambda q: (q.write_text(json.dumps({"asset": {}, "root": {"boundingVolume": {"sphere": [0, 0, 0, 5]}, "geometricError": 0, "transform": pole, "content": {"uri": "a.glb"}}})), q)[1])(d / "pole.json"), d / "o3_pole", allow_lossy=True)
        g = geo(d / "o3_pole", "t.x3d"); case("R3: exact north-pole origin converts (no ZeroDivisionError)", abs(g[0] - 90) < 1e-9 and abs(g[2]) < 1e-3, str(g))
    except ZeroDivisionError as e: case("R3: exact north-pole origin converts (no ZeroDivisionError)", False, repr(e))
    reuse = d / "o3_reuse"; addp = d / "reuse-add.json"
    addp.write_text(json.dumps({"asset": {}, "root": tile(ge=50, refine="ADD", content={"uri": "a.glb"}, children=[tile(child=True, content={"uri": "b.glb"})])}))
    v2.convert(addp, reuse, allow_lossy=True)
    v2.convert(d / "off.json", reuse)
    rep = json.loads((reuse / "conversion-report.json").read_text())
    case("R3: a clean run into a reused folder rewrites the report (not the old lossy one) and lists the other files there",
         rep["lossy"] is False and not rep["losses"] and set(rep["files_written"]) == {"t.x3d"} and rep["other_x3d_in_folder"], str(rep["other_x3d_in_folder"]))
    # fourth review: parent scale in geometricError; viewerRequestVolume refused, not dropped
    S2 = [2 * x for x in ENU[:12]] + ENU[12:]
    half = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1]
    def scaled(scale_root, scale_child):
        return {"asset": {"version": "1.1"}, "root": {"boundingVolume": {"sphere": [0, 0, 0, 1000]}, "geometricError": 10, "refine": "REPLACE",
                "transform": scale_root, "children": [{"boundingVolume": {"sphere": [0, 0, 0, 10]}, "geometricError": 0, "transform": scale_child, "content": {"uri": "a.glb"}}]}}
    rng = lambda o: float(re.search(r'range="([^"]+)"', (o / "t.x3d").read_text()).group(1))
    for label, conv in (("v2.3", v2), ("v2.2 (shipped)", v22)):
        q = d / f"scale-{label[:4]}.json"; q.write_text(json.dumps(scaled(S2, half)))
        s = conv.convert(q, d / f"o4_scale_{label[:4]}")
        r = rng(d / f"o4_scale_{label[:4]}")
        want = 10 * 2 * s["K"]
        if conv is v2: case("R4-G1: parent scale 2, child scale 0.5 (unit-scale content): range uses 20 m world error", abs(r - want) < 0.1 and not s["losses"], f"range {r}, expected {want:.1f}")
        else: case("R4-G1 control: v2.2 emits half the range on the same fixture", abs(r - want / 2) < 0.1, f"v2.2 range {r}")
    q = d / "unit.json"; q.write_text(json.dumps(scaled(ENU, IDENT := [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])))
    s = v2.convert(q, d / "o4_unit"); case("R4-G1: unit-scale hierarchy keeps the local error", abs(rng(d / "o4_unit") - 10 * s["K"]) < 0.1, str(rng(d / "o4_unit")))
    vr = scaled(ENU, IDENT); vr["root"]["children"][0]["viewerRequestVolume"] = {"sphere": [0, 0, 0, 50]}
    q = d / "vrv.json"; q.write_text(json.dumps(vr))
    try: v2.convert(q, d / "o4_vrv"); case("R4-G2: viewerRequestVolume refused in strict mode", False, "converted")
    except v2.Unsupported as e: case("R4-G2: viewerRequestVolume refused in strict mode", any("viewerRequestVolume" in i for i in e.items), str(e.items))
    s = v2.convert(q, d / "o4_vrv_lossy", allow_lossy=True)
    rep = json.loads((d / "o4_vrv_lossy/conversion-report.json").read_text())
    case("R4-G2: --allow-lossy converts and records the dropped volume", rep["viewer_request_volume"] == 1 and rep["lossy"], str(rep["losses"]))
    s = v22.convert(q, d / "o4_vrv_22"); case("R4-G2 control: v2.2 dropped it with no loss", not s["losses"], "strict exit 0")
print(json.dumps({"suite": "tiles3d_to_x3d v2.3", "python": sys.version.split()[0], "passed": len(rows) - bad, "failed": bad, "cases": rows}, indent=1))
sys.exit(1 if bad else 0)
