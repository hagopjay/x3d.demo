#!/usr/bin/env python3
"""Control for validate_scenes.py: one unreadable scene must not lose the receipt (third review, 18 Nov 2026).
Running as root makes mode 000 readable, so the read is made to fail in-process for one named file instead.
  python3 tools/assurance/controls/unreadable_control.py --x3d-mcp PATH   -> exit 0 when the control holds"""
import argparse, json, pathlib, shutil, sys, tempfile
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import validate_scenes as vs
ap = argparse.ArgumentParser(); ap.add_argument("--x3d-mcp", required=True); a = ap.parse_args()
with tempfile.TemporaryDirectory() as d:
    demo = pathlib.Path(d) / "demo"; (demo / "scenes").mkdir(parents=True)
    good = (HERE / "malformed/scenes/a.x3d").read_bytes()
    for n in ("a.x3d", "m.x3d", "z.x3d"): (demo / "scenes" / n).write_bytes(good)
    real = pathlib.Path.read_bytes
    def read_bytes(self):
        if self.name == "m.x3d": raise PermissionError(13, "Permission denied", str(self))
        return real(self)
    pathlib.Path.read_bytes = read_bytes
    code = vs.main([str(demo), "--x3d-mcp", a.x3d_mcp, "--semantic"])
    pathlib.Path.read_bytes = real
    rec = json.loads((demo / "receipt-xsd.json").read_text())
    rows = {k: (v["valid"], v.get("semantic_status"), v["sha256"]) for k, v in rec["results"].items()}
    ok = code == 1 and rec["status"] == "fail" and rows["scenes/m.x3d"] == (False, "not_run", None) \
        and rows["scenes/a.x3d"][0] and rows["scenes/z.x3d"][0]
    print(json.dumps({"control": "unreadable scene keeps the receipt", "exit": code, "rows": rows, "holds": ok}))
    sys.exit(0 if ok else 1)
