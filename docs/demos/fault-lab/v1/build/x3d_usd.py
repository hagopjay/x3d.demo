#!/usr/bin/env python3
"""X3D -> USD (.usda) -> read back: does the scene's Metadata survive, and on which hosts?

    python3 build/x3d_usd.py IN.x3d OUT.usda REPORT.json      (needs: pip install usd-core; reuses x3d.loom's x3dsem for the X3D side)

A small, purpose-built converter (NOT a general X3D to USD exporter). What it carries:
  Transform / Group        -> UsdGeom.Xform (translate, orient, scale)
  Shape + Box / Sphere / Cylinder -> Xform + UsdGeom.Cube / Sphere / Cylinder (Box size as a scale on a unit cube)
  Material / PhysicalMaterial     -> UsdShade.Material + UsdPreviewSurface (diffuseColor, emissiveColor, roughness, metallic, opacity)
  WorldInfo                -> UsdGeom.Scope
  any Metadata* tree on ANY of those hosts -> the host prim's customData["x3d:metadata"], as a nested dictionary
                              (a MetadataSet's ordered children are keyed "0", "1", ...: USD dictionaries cannot hold a list of dictionaries)
  <head> <meta>            -> the stage root layer's customLayerData["x3d:head"]
Everything else (viewpoints, lights, GeoViewpoint, Background) is counted in the report, not converted.

The witness: read the .usda back with a fresh stage, rebuild every Metadata tree from customData, and compare with the
source tree for tree, host type for host type, value for value (canonical JSON). Then run every validator USD registers (UsdValidation).
"""
import hashlib
import json
import math
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, UsdValidation

LOOM = Path(__file__).resolve().parents[6] / "x3d.loom" if len(sys.argv) < 5 else Path(sys.argv[4])
sys.path.insert(0, str(LOOM / "formats/gltf/semantic"))
import x3dsem  # noqa: E402

KEY = "x3d:metadata"
GEOM = {"Box", "Sphere", "Cylinder"}
CARRIED = {"Transform", "Group", "Shape", "Appearance", "Material", "PhysicalMaterial", "WorldInfo", "Scene", "X3D", "head", "meta", "component"} | GEOM | x3dsem.META_TYPES


def to_usd(d: dict) -> dict:
    """Metadata JSON (x3dsem shape) -> a dictionary USD can store: lists of dictionaries become index-keyed dictionaries."""
    out = {}
    for k, v in d.items():
        if k == "value" and d["type"] == "MetadataSet":
            out["value"] = {str(i): to_usd(c) for i, c in enumerate(v)}
            out["count"] = len(v)
        elif k == "metadata":
            out["metadata"] = to_usd(v)
        elif k == "value":
            out["value"] = [float(x) for x in v] if d["type"] in ("MetadataDouble", "MetadataFloat") else list(v)
            out["count"] = len(v)       # an empty array would not round trip as a typed value
        else:
            out[k] = v
    return out


def from_usd(d: dict) -> dict:
    out = {"type": d["type"]}
    for k in ("name", "reference", "DEF", "USE"):
        if k in d:
            out[k] = d[k]
    if d["type"] == "MetadataSet":
        out["value"] = [from_usd(d["value"][str(i)]) for i in range(int(d.get("count", 0)))]
    elif "count" in d:
        v = list(d.get("value", [])) if int(d["count"]) else []
        out["value"] = [bool(x) for x in v] if d["type"] == "MetadataBoolean" else [int(x) for x in v] if d["type"] == "MetadataInteger" else [float(x) for x in v] if d["type"] in ("MetadataDouble", "MetadataFloat") else [str(x) for x in v]
    if "metadata" in d:
        out["metadata"] = from_usd(d["metadata"])
    return out


def convert(src: Path, out: Path) -> dict:
    root = ET.fromstring(src.read_bytes())
    stage = Usd.Stage.CreateNew(str(out))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())
    head = root.find("head")
    stage.GetRootLayer().customLayerData = {"x3d:head": {f"{i}": {"name": m.get("name") or "", "content": m.get("content") or ""} for i, m in enumerate(head.findall("meta") if head is not None else [])},
                                           "x3d:source_sha256": hashlib.sha256(src.read_bytes()).hexdigest(), "x3d:converter": "fault-lab x3d_usd 0.1"}
    counts, used = Counter(), Counter()

    def name(e, parent_path):
        base = "".join(c if c.isalnum() or c == "_" else "_" for c in (e.get("DEF") or e.tag))
        base = base if not base[0].isdigit() else "_" + base
        used[(parent_path, base)] += 1
        return base if used[(parent_path, base)] == 1 else f"{base}_{used[(parent_path, base)]}"

    def tag_host(prim, e):
        prim.SetCustomDataByKey("x3d:nodeType", e.tag)
        if e.get("DEF"):
            prim.SetCustomDataByKey("x3d:DEF", e.get("DEF"))
        m = x3dsem.host_metadata(e)
        if m is not None:
            prim.SetCustomDataByKey(KEY, to_usd(m))

    def walk(e, path):
        for c in e:
            if c.tag not in CARRIED:
                counts[c.tag] += 1
                continue
            if c.tag in x3dsem.META_TYPES:
                continue
            p = f"{path}/{name(c, path)}"
            if c.tag in ("Transform", "Group"):
                x = UsdGeom.Xform.Define(stage, p)
                t = x3dsem.floats(c.get("translation")) or [0, 0, 0]
                s = x3dsem.floats(c.get("scale")) or [1, 1, 1]
                r = x3dsem.floats(c.get("rotation")) or [0, 0, 1, 0]
                x.AddTranslateOp().Set(Gf.Vec3d(*t))
                if r[3]:
                    n = math.sqrt(sum(v * v for v in r[:3])) or 1
                    x.AddOrientOp().Set(Gf.Quatf(math.cos(r[3] / 2), *[float(v / n * math.sin(r[3] / 2)) for v in r[:3]]))
                if s != [1, 1, 1]:
                    x.AddScaleOp().Set(Gf.Vec3f(*s))
                tag_host(x.GetPrim(), c)
                walk(c, p)
            elif c.tag == "WorldInfo":
                tag_host(UsdGeom.Scope.Define(stage, p).GetPrim(), c)
            elif c.tag == "Shape":
                x = UsdGeom.Xform.Define(stage, p)
                tag_host(x.GetPrim(), c)
                mat = None
                app = c.find("Appearance")
                if app is not None:
                    tag_app = app          # Appearance has no prim of its own; its Metadata (none in this lab) would be counted lost
                    if x3dsem.host_metadata(tag_app) is not None:
                        counts["metadata_on_Appearance_not_carried"] += 1
                    m = next((k for k in app if k.tag in ("Material", "PhysicalMaterial")), None)
                    if m is not None:
                        mat = UsdShade.Material.Define(stage, f"{p}/{name(m, p)}")
                        sh = UsdShade.Shader.Define(stage, f"{mat.GetPath()}/Surface")
                        sh.CreateIdAttr("UsdPreviewSurface")
                        col = x3dsem.floats(m.get("baseColor") or m.get("diffuseColor")) or [0.8, 0.8, 0.8]
                        sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*col))
                        sh.CreateInput("emissiveColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*(x3dsem.floats(m.get("emissiveColor")) or [0, 0, 0])))
                        sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(float(m.get("roughness", 1)))
                        sh.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(float(m.get("metallic", 1 if m.tag == "PhysicalMaterial" else 0)))
                        sh.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(1 - float(m.get("transparency", 0)))
                        mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
                        tag_host(mat.GetPrim(), m)
                for g in c:
                    if g.tag not in GEOM:
                        continue
                    gp = f"{p}/{name(g, p)}"
                    if g.tag == "Box":
                        prim = UsdGeom.Cube.Define(stage, gp)
                        prim.CreateSizeAttr(1.0)
                        size = x3dsem.floats(g.get("size")) or [2, 2, 2]
                        prim.AddScaleOp().Set(Gf.Vec3f(*size))
                        prim.CreateExtentAttr([(-0.5, -0.5, -0.5), (0.5, 0.5, 0.5)])
                    elif g.tag == "Sphere":
                        prim = UsdGeom.Sphere.Define(stage, gp)
                        rad = float(g.get("radius", 1))
                        prim.CreateRadiusAttr(rad)
                        prim.CreateExtentAttr([(-rad, -rad, -rad), (rad, rad, rad)])
                    else:
                        prim = UsdGeom.Cylinder.Define(stage, gp)
                        rad, h = float(g.get("radius", 1)), float(g.get("height", 2))
                        prim.CreateRadiusAttr(rad)
                        prim.CreateHeightAttr(h)
                        prim.CreateAxisAttr("Y")
                        prim.CreateExtentAttr([(-rad, -h / 2, -rad), (rad, h / 2, rad)])
                    tag_host(prim.GetPrim(), g)
                    if mat is not None:
                        UsdShade.MaterialBindingAPI.Apply(prim.GetPrim()).Bind(mat)
            else:
                walk(c, path)

    walk(root.find("Scene"), "/World")
    stage.GetRootLayer().Save()
    return dict(counts)


def read_back(usda: Path) -> list[dict]:
    stage = Usd.Stage.Open(str(usda))
    hosts = []
    for prim in stage.Traverse():
        m = prim.GetCustomDataByKey(KEY)      # a colon in a customData key is a nesting separator: this reads customData["x3d"]["metadata"]
        if m:
            hosts.append({"hostType": prim.GetCustomDataByKey("x3d:nodeType"), "DEF": prim.GetCustomDataByKey("x3d:DEF"), "metadata": from_usd(m),
                          "prim": str(prim.GetPath()), "primType": prim.GetTypeName()})
    return hosts


def main():
    src, out, rep = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    skipped = convert(src, out)
    a = x3dsem.semantics(src)["hosts"]
    b = read_back(out)
    canon = lambda h: json.dumps({"hostType": h["hostType"], "DEF": h["DEF"], "metadata": h["metadata"]}, sort_keys=True)
    want, got = [canon(h) for h in a], [canon(h) for h in b]
    nodes = lambda hs: sum(1 for h in hs for _ in x3dsem.walk_meta(h["metadata"]))
    stage = Usd.Stage.Open(str(out))
    validators = UsdValidation.ValidationRegistry().GetOrLoadAllValidators()
    errors = UsdValidation.ValidationContext(validators).Validate(stage)
    report = {
        "schema": "fault-lab.usd-semantic/1", "converter": "fault-lab x3d_usd 0.1 (this demo's own; not a general exporter)",
        "usd": {"version": ".".join(str(v) for v in Usd.GetVersion()), "file": out.name, "sha256": hashlib.sha256(out.read_bytes()).hexdigest(), "bytes": out.stat().st_size,
                "prims": len(list(stage.Traverse())), "prim_types": dict(Counter(p.GetTypeName() for p in stage.Traverse()))},
        "source": {"file": src.name, "sha256": hashlib.sha256(src.read_bytes()).hexdigest()},
        "trees": {"expected": len(want), "got": sum(1 for w in want if w in got), "missing": [json.loads(w)["hostType"] for w in want if w not in got], "invented": sum(1 for g in got if g not in want)},
        "metadata_nodes": {"expected": nodes(a), "got": nodes(b)},
        "hosts": [{"hostType": h["hostType"], "DEF": h["DEF"], "prim": h["prim"], "primType": h["primType"]} for h in b],
        "not_converted": skipped,
        "compliance": {"tool": "pxr.UsdValidation (every registered validator)", "validators_run": len(validators),
                       "errors": [{"validator": e.GetName(), "message": e.GetMessage()[:200]} for e in errors]},
    }
    report["verdict"] = "pass" if report["trees"]["got"] == report["trees"]["expected"] and not report["trees"]["invented"] and report["metadata_nodes"]["got"] == report["metadata_nodes"]["expected"] else "fail"
    rep.write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps({k: report[k] for k in ("verdict", "trees", "metadata_nodes", "not_converted")}), "compliance", report["compliance"])
    return 0 if report["verdict"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
