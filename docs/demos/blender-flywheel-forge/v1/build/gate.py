# SPDX-License-Identifier: GPL-3.0-or-later
"""Flywheel Forge gate: every check a generation must pass, with the tool that ran it.
Usage: python -I gate.py GEN_DIR  (expects GEN_DIR/orrery.x3d; writes GEN_DIR/gate.json and frames)"""
import gzip, json, os, subprocess, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.environ.get("X3D_MCP_SRC", "../x3d_mcp/src"))
from validation.validate import validate_xml
from validation.semantic import validate_semantic

gen = os.path.abspath(sys.argv[1])
site = os.environ.get("FORGE_SITE", "site")  # a folder served over HTTP that holds X_ITE and probe pages
x3d = open(os.path.join(gen, "orrery.x3d"), encoding="utf-8").read()
rel = "forge/" + os.path.basename(gen) + "/orrery.x3d"
os.makedirs(os.path.join(site, "forge", os.path.basename(gen)), exist_ok=True)
open(os.path.join(site, rel), "w", encoding="utf-8").write(x3d)
checks = []
def check(gid, name, tool, ok, detail):
    checks.append({"id": gid, "check": name, "tool": tool, "pass": bool(ok), "detail": detail})
r = validate_xml(x3d)
check("G1", "X3D 4.0 XSD", "x3d_mcp 39c6e94 validate_xml", r.get("valid"), "; ".join(e if isinstance(e, str) else str(e) for e in r.get("errors", [])[:3]) or "valid")
sem = validate_semantic(x3d)
n_err = int(sem.split("Found ")[1].split(" error")[0]) if "Found " in sem else -1
n_warn = int(sem.split("error(s), ")[1].split(" warning")[0]) if "Found " in sem else -1
errs = [l.strip("- ") for l in sem.splitlines() if l.startswith("- **[") and "## Errors" in sem.split(l)[0].split("## Warnings")[0]][:3]
check("G2", "Semantic errors", "x3d_mcp 39c6e94 validate_semantic", n_err == 0, "%d errors, %d warnings%s" % (n_err, n_warn, (": " + " | ".join(errs)) if n_err else ""))
gz = len(gzip.compress(x3d.encode(), 9))
check("G3", "Size budget", "gzip -9", gz < 400_000, "%d bytes raw, %d gzip (budget 400,000)" % (len(x3d), gz))
a, b = os.path.join(gen, "frame-a.png"), os.path.join(gen, "frame-b.png")
import re
still = os.path.join(gen, "frame-still.png")
interps = json.dumps(re.findall(r'DEF="((?:OI|PI|SI)_[^"]+)"', x3d))
out = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "frames.cjs"), rel, a, b, still, interps], capture_output=True, text=True, timeout=300)
info = json.loads(out.stdout.strip().splitlines()[-1])
check("G4", "Loads clean in X_ITE", "X_ITE 16.7.1, headless Chromium %s SwiftShader" % info["chromium"], not info["errors"], "; ".join(info["errors"][:3]) or "0 console errors")
fa = np.asarray(Image.open(a).convert("RGB"), dtype=np.float64) / 255
fb = np.asarray(Image.open(b).convert("RGB"), dtype=np.float64) / 255
lum = float(fa.mean())
check("G5", "Not too dark", "mean frame value (numpy)", lum > 0.10, "mean %.3f (needs > 0.10)" % lum)
bg = np.median(np.concatenate([fa[0], fa[-1], fa[:, 0], fa[:, -1]]), axis=0)
cov = float((np.abs(fa - bg).max(axis=2) > 0.03).mean())
check("G6", "Subject fills the frame", "pixels unlike the border colour (numpy)", 0.25 <= cov <= 0.92, "%.0f%% of the frame (needs 25-92%%)" % (cov * 100))
# deterministic: the interpolators are driven to fraction 0 and 0.25 through SAI (an earlier wall-clock version
# of this check flipped gen 1 between 0.41 and 0.54 across runs)
s0 = np.asarray(Image.open(still).convert("RGB"), dtype=np.float64) / 255
s1 = np.asarray(Image.open(still.replace(".png", "-q.png")).convert("RGB"), dtype=np.float64) / 255
motion = float(np.abs(s0 - s1).mean() * 255)
check("G7", "It moves", "mean |still(fraction 0) - still(fraction 0.25)|, interpolators set through SAI", motion > 0.5, "%.2f of 255 (needs > 0.5)" % motion)
ref_png = os.path.join(gen, "cycles.png")
if os.path.exists(ref_png):
    from skimage.metrics import structural_similarity
    ref = np.asarray(Image.open(ref_png).convert("RGB"), dtype=np.float64) / 255
    fs = np.asarray(Image.open(still).convert("RGB"), dtype=np.float64) / 255
    ssim = float(structural_similarity(ref, fs, channel_axis=2, data_range=1.0))
    mad = float(np.abs(ref - fs).mean() * 255)
    check("G8", "Looks like Blender", "SSIM of the X_ITE still (t=0) vs Cycles frame 1 (scikit-image)", ssim >= 0.80 and mad < 20,
          "SSIM %.3f, mean |delta| %.1f of 255 (needs SSIM >= 0.80 and |delta| < 20)" % (ssim, mad))
else:
    check("G8", "Looks like Blender", "Cycles reference", False, "no cycles.png: reference not rendered")
report = {"generation": os.path.basename(gen), "passed": sum(c["pass"] for c in checks), "of": len(checks), "checks": checks,
          "x_ite_warnings": info["warnings"]}
json.dump(report, open(os.path.join(gen, "gate.json"), "w"), indent=1)
for c in checks:
    print(("PASS " if c["pass"] else "FAIL ") + c["id"], c["check"], "-", c["detail"])
print("%d/%d" % (report["passed"], report["of"]))
