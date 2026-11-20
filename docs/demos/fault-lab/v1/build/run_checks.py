#!/usr/bin/env python3
"""Fault Lab, step 2: run every case through the real validators of ONE x3d_mcp source tree and write what each said.

    PYTHONPATH=<x3d_mcp>/src python3 build/run_checks.py <x3d_mcp> <label> [--strict]     writes data/checks-<label>.json

Run twice: once on the tree before the review fixes (39c6e94) and once after (main). The same cases, the same code path,
two commits: the difference between the two files is what the fixes do. --strict also runs the hand-written twin shapes
(they are one of the fixes, so they exist only in the later tree).
"""
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
MCP, LABEL = Path(sys.argv[1]), sys.argv[2]
STRICT = "--strict" in sys.argv
sys.path.insert(0, str(MCP / "src"))
from validation.semantic import semantic_diagnostics  # noqa: E402
from validation.validate import validate_xml  # noqa: E402
from x3d_utils import semantic_web as sw  # noqa: E402

BASE = "https://example.org/scen/heritage/scene.ttl#"
TWIN = MCP / "examples/semantic_twins/data/heritage"
cases = json.loads((HERE / "data/cases.json").read_text())["cases"]
commit = subprocess.run(["git", "-C", str(MCP), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
has_card = "x3d-cardinality" in getattr(sw, "SHAPES", {})


def shacl(scene, **kw):
    r = sw.shacl(sw.convert(scene, base_iri=BASE), **kw)
    return [{"shape": x["shape"].rsplit("#")[-1].rsplit(":")[-1], "check": x.get("check_id"), "node": x.get("def") or x.get("focus"),
             "message": (x.get("message") or "")[:260]} for x in r["results"]]


out = {"label": LABEL, "x3d_mcp_commit": commit, "python": sys.version.split()[0], "cases": {}}
import pyshacl, rdflib  # noqa: E402
out["instruments"] = {"rdflib": rdflib.__version__, "pyshacl": pyshacl.__version__, "xsd": "X3D 4.0 XSD as bundled in x3d_mcp (the scene declares version 4.0)",
                      "x3duom": "X3DUOM 4.1 as bundled", "shapes_core": "x3d-core" + (" + x3d-cardinality" if has_card else ""),
                      "twin_shapes": "shapes-strict.ttl (hand-written)" if STRICT else "shapes.ttl (generated)"}
for c in cases:
    t0 = time.time()
    scene, domain = (HERE / c["scene"]).read_text(), (HERE / c["domain"]).read_text()
    x = validate_xml(scene)
    sem = [{"check": d.check, "level": d.level, "node": d.def_name or d.node_tag, "message": d.message[:300]} for d in semantic_diagnostics(scene)]
    core = shacl(scene, shapes="x3d-core,x3d-cardinality" if has_card else "x3d-core")
    twin = shacl(scene, shapes="none", extra_shapes_ttl=(TWIN / ("shapes-strict.ttl" if STRICT else "shapes.ttl")).read_text(), data_ttl=domain)
    out["cases"][c["id"]] = {
        "xsd": {"valid": bool(x.get("valid")), "errors": [str(e)[:260] for e in (x.get("errors") or [])][:5]},
        "semantic": {"errors": [d for d in sem if d["level"] == "error"], "warnings": [d for d in sem if d["level"] == "warning"]},
        "shacl_core": core, "twin": twin, "seconds": round(time.time() - t0, 2)}
    r = out["cases"][c["id"]]
    print(f"{LABEL:6} {c['id']:16} xsd {'ok ' if r['xsd']['valid'] else 'ERR'}  sem {len(r['semantic']['errors'])}E {len(r['semantic']['warnings'])}W  core {len(core)}  twin {sorted({t['shape'] for t in twin})}")
(HERE / f"data/checks-{LABEL}.json").write_text(json.dumps(out, indent=1) + "\n")
