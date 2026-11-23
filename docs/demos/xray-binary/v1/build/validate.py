"""Validate Demo 74's X3D with the x3d_mcp validator (XSD 4.0 + semantic checks).

Usage: python build/validate.py /path/to/x3d_mcp
Writes ../assets/validate-receipt.json. Counts semantic diagnostics by level;
'info' (for example a DEF named only for SAI) is not a defect.
"""
import collections
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "..", "assets")
fork = sys.argv[1]
sys.path.insert(0, os.path.join(fork, "src"))
from validation.validate import validate_xml  # noqa: E402
from validation import semantic  # noqa: E402

commit = subprocess.run(["git", "-C", fork, "log", "-1", "--format=%h"], capture_output=True, text=True).stdout.strip()
files = {}
for name in ("xray-binary.x3d", "city-baked.x3d"):
    s = open(os.path.join(A, name), encoding="utf-8").read()
    x = validate_xml(s)
    diags = semantic.semantic_diagnostics(s)
    lv = collections.Counter(getattr(d, "level", "?") for d in diags)
    checks = collections.Counter(f"{getattr(d, 'level', '?')}:{getattr(d, 'check', '?')}" for d in diags)
    files[name] = {"sha256": hashlib.sha256(s.encode()).hexdigest(), "xsd_valid": x["valid"],
                   "schema": x.get("schema_version"), "xsd_errors": x["errors"][:20],
                   "semantic_by_level": dict(lv), "semantic_by_check": dict(checks)}
ok = all(f["xsd_valid"] and not f["semantic_by_level"].get("error") for f in files.values())
summ = "; ".join(f"{k}: XSD {f['schema']} {'valid' if f['xsd_valid'] else 'INVALID'}, semantic "
                 + ", ".join(f"{n} {lvl}" for lvl, n in sorted(f["semantic_by_level"].items())) for k, f in files.items())
rec = {"validator": f"x3d_mcp fork {commit} (validation.validate.validate_xml + validation.semantic)",
       "ok": ok, "summary": f"x3d_mcp {commit}: {summ}", "files": files}
with open(os.path.join(A, "validate-receipt.json"), "w", encoding="utf-8") as fh:
    json.dump(rec, fh, indent=1)
print(json.dumps({"ok": ok, "summary": rec["summary"]}, indent=1))
sys.exit(0 if ok else 1)
