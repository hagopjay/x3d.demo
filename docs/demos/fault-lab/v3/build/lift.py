"""python build/lift.py PATH/x3d.loom : lift the Blender glb's extras into KHR_xmp_json_ld packets and write data/lift.json.
Uses x3d.loom formats/gltf/semantic/blender_extras.py (the lifter and its rules L0-L6) and the Khronos validator from that folder."""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
LOOM = Path(sys.argv[1]).resolve() / "formats" / "gltf"
sys.path.insert(0, str(LOOM / "semantic"))
import blender_extras as bx  # noqa: E402

src, dst, x3d = HERE / "assets/blender/blender.glb", HERE / "assets/blender/blender.lifted.glb", HERE.parent / "v1/cases/clean.x3d"
rep = bx.run(src, dst, x3d)
before, _ = bx.load(src)
after, _ = bx.load(dst)
packets = after["extensions"]["KHR_xmp_json_ld"]["packets"]


def walk(n):
    if isinstance(n, dict):
        yield n
        for v in n.values():
            yield from walk(v)
    elif isinstance(n, list):
        for v in n:
            yield from walk(v)


def q_packets(g):
    """Human-made features (crm:E25) deeper than 9 m: one JSON-LD question, no knowledge of X3D or of the add-on."""
    hits = []
    for p in g.get("extensions", {}).get("KHR_xmp_json_ld", {}).get("packets", []):
        for n in walk(p.get("x3d:metadata", {})):
            t = n.get("@type")
            if isinstance(t, list) and "crm:E25_Human-Made_Feature" in t:
                kids = {k.get("x3d:name"): k["x3d:value"]["@list"] for k in n["x3d:value"]["@list"]}
                depth = kids.get("depth_m", [None])[0]
                if isinstance(depth, (int, float)) and depth > 9:
                    hits.append({"host": p.get("x3d:hostDEF"), "label": kids.get("label", [None])[0], "depth_m": depth, "tier": kids.get("tier", [None])[0]})
    return hits


n6 = before["nodes"][6]["extras"]["x3d_transform_metadata"]
val = json.loads(subprocess.run(["node", str(HERE / "build/gltf_validate_file.mjs"), str(LOOM), str(src), str(dst)], check=True, capture_output=True, text=True).stdout)
loom_commit = subprocess.run(["git", "-C", str(LOOM), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
out = {"schema": "fault-lab.lift/1", "lifter": bx.LIFTER, "loom_commit_base": loom_commit, "report": rep, "validator": val,
       "sizes": {"before": src.stat().st_size, "after": dst.stat().st_size},
       "example": {"host": "Transform OsirisShaftA", "extras": n6, "depth_extras_type": type(n6["value"][1]["value"]).__name__,
                   "packet": {k: v for k, v in packets[after["nodes"][6]["extensions"]["KHR_xmp_json_ld"]["packet"]].items() if k != "@context"},
                   "context": packets[0]["@context"]},
       "query": {"text": "Which human-made features (crm:E25) are deeper than 9 m?",
                 "on_extras": q_packets(before), "on_packets": q_packets(after),
                 "note": "The same JSON-LD question on both files. The extras file has no packets and no @type, and holds the depth as the text \"9.62\"."}}
(HERE / "data/lift.json").write_text(json.dumps(out, indent=1) + "\n")
print(json.dumps({"verdict": rep["verdict"], "rules": {r["id"]: r["pass"] for r in rep["rules"]}, "validator": val["files"], "query": out["query"]["on_packets"], "on_extras": out["query"]["on_extras"], "sizes": out["sizes"]}))
