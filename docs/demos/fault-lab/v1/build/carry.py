"""Carry every scene case to glTF and USD and ask: is the planted fault still there, and does anything downstream object?

    python build/carry.py LOOM_PATH WORK_DIR

For each scene case (the clean twin and the 7 faults that live in the X3D file):
  * glTF: x3d.loom formats/gltf/semantic/x3dsem.py (KHR_xmp_json_ld), then the Khronos glTF validator (build/gltf_validate.mjs);
  * USD:  this demo's build/x3d_usd.py, then every registered pxr.UsdValidation validator.
A fault is ERASED when the converted file is identical to the clean twin's (provenance hashes aside): the downstream
file is clean-looking and the mistake can no longer be found. It is CARRIED when the output differs. Either way the
downstream validators' verdicts are recorded. Writes data/carry.json, assets/gltf/<case>.gltf and assets/usd/<case>.usda.
"""
import hashlib, json, re, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
LOOM, WORK = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(LOOM / "formats/gltf/semantic"))
import x3dsem  # noqa: E402

cases = [c for c in json.loads((HERE / "data/cases.json").read_text())["cases"] if c["scene"] != "cases/clean.x3d" or c["id"] == "clean"]
cases = [c for c in cases if c["id"] == "clean" or (c["changed"] and c["changed"]["file"] == "scene")]


def gltf_body(p):
    g = json.loads(p.read_text())
    return json.dumps({k: g.get(k) for k in ("nodes", "meshes", "materials", "accessors", "bufferViews", "buffers", "scenes")}, sort_keys=True)


def usd_body(p):
    return "\n".join(l for l in p.read_text().splitlines() if "sha256" not in l and ".x3d" not in l)


out, bodies = {}, {}
for c in cases:
    cid = c["id"]
    src = HERE / c["scene"]
    d = WORK / "carry" / cid
    d.mkdir(parents=True, exist_ok=True)
    row = {}
    try:
        r = x3dsem.roundtrip(src, d)
        gl = d / f"{src.stem}.gltf"
        v = json.loads(subprocess.run(["node", str(HERE / "build/gltf_validate.mjs"), str(gl), str(LOOM)], capture_output=True, text=True, check=True).stdout)
        g = json.loads(gl.read_text())
        row["gltf"] = {"converted": True, "nodes": len(g["nodes"]), "meshes": len(g.get("meshes", [])), "materials": len(g.get("materials", [])),
                       "skipped": r["conversion"]["skipped"], "body": gltf_body(gl), "validator": v}
    except Exception as e:  # a converter that refuses a faulty file is a catch, and is recorded as one
        row["gltf"] = {"converted": False, "error": f"{type(e).__name__}: {e}"[:300]}
    p = subprocess.run([sys.executable, str(HERE / "build/x3d_usd.py"), str(src), str(d / "scene.usda"), str(d / "usd.json"), str(LOOM)], capture_output=True, text=True)
    if (d / "usd.json").exists():
        u = json.loads((d / "usd.json").read_text())
        row["usd"] = {"converted": True, "prims": u["usd"]["prims"], "prim_types": u["usd"]["prim_types"], "not_converted": u["not_converted"],
                      "body": usd_body(d / "scene.usda"), "validator": {"tool": u["compliance"]["tool"], "validators_run": u["compliance"]["validators_run"], "errors": len(u["compliance"]["errors"])}}
    else:
        row["usd"] = {"converted": False, "error": p.stderr.strip().splitlines()[-1][:300] if p.stderr.strip() else "no report"}
    out[cid] = row

for cid, row in out.items():
    for fmt in ("gltf", "usd"):
        f = row[fmt]
        if f.get("converted"):
            body = f.pop("body")
            f["body_sha256"] = hashlib.sha256(body.encode()).hexdigest()[:16]
            bodies[(cid, fmt)] = body
for cid, row in out.items():
    for fmt in ("gltf", "usd"):
        f = row[fmt]
        if cid == "clean":
            f["fate"] = "clean"
        elif not f.get("converted"):
            f["fate"] = "refused"
        else:
            f["fate"] = "erased" if bodies[(cid, fmt)] == bodies[("clean", fmt)] else "carried"

for cid in out:  # the converted files the page shows and offers for download
    (HERE / "assets/gltf").mkdir(parents=True, exist_ok=True); (HERE / "assets/usd").mkdir(parents=True, exist_ok=True)
    shutil.copy(WORK / "carry" / cid / f"{cid}.gltf", HERE / "assets/gltf" / f"{cid}.gltf")
    shutil.copy(WORK / "carry" / cid / "scene.usda", HERE / "assets/usd" / f"{cid}.usda")
res = {"schema": "fault-lab.carry/1",
       "instruments": {"gltf_converter": x3dsem.CONVERTER, "gltf_validator": out["clean"]["gltf"]["validator"]["tool"],
                       "usd_converter": "fault-lab x3d_usd 0.1 (this demo's own)", "usd_validator": out["clean"]["usd"]["validator"]["tool"]},
       "meaning": {"erased": "converted file identical to the clean twin's (provenance hashes aside): the mistake can no longer be found downstream",
                   "carried": "converted file differs from the clean twin's: the mistake travelled", "refused": "the converter stopped"},
       "cases": out}
(HERE / "data/carry.json").write_text(json.dumps(res, indent=1) + "\n")
for cid, row in out.items():
    print(f"{cid:16s} glTF {row['gltf']['fate']:8s} val {row['gltf'].get('validator', {}).get('errors', '-')}E/{row['gltf'].get('validator', {}).get('warnings', '-')}W   USD {row['usd']['fate']:8s} val {row['usd'].get('validator', {}).get('errors', '-')}E")
