#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Record actual Node, structural and schema checks without claiming pixels.

Run from anywhere: python write_upgrade_witness.py PATH_TO_NODE_TEST_LOG.
The test log must represent a complete zero-failure, zero-skip run.
"""
from pathlib import Path
import hashlib
import json
import platform
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
log = Path(sys.argv[1]).read_text()


def count(name):
    match = re.search(r"(?:ℹ|#)\s+" + name + r"\s+(\d+)", log)
    if not match:
        raise SystemExit("Missing test counter: " + name)
    return int(match[1])


tests = {key: count(key) for key in ["tests", "pass", "fail", "skipped"]}
if tests["tests"] != tests["pass"] or tests["fail"] or tests["skipped"]:
    raise SystemExit("Expected a complete zero-failure, zero-skip run")
validation = json.loads((ROOT / "receipts/validation-v5.json").read_text())
if validation["status"] != "pass" or validation["files"] != 3:
    raise SystemExit("Expected a successful validation of all three scenes")
record = {
    "schema": "giza-atlas-upgrade-witness/v1",
    "review_date": "2026-11-19",
    "baseline_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "tests": tests,
    "test_scope": "Pure math, catalogue/halo identity, stage lifecycle, real controller with imports mocked, and linkedom UI integration. SAI and canvas rendering are mocked.",
    "tools": {"node": subprocess.check_output(["node", "--version"], text=True).strip(), "python": platform.python_version(), "linkedom": "0.18.12"},
    "scene_validation": {"status": "pass", "files": 3, "errors": 0, "semantic_warnings": 0, "receipt": "validation-v5.json"},
    "visual_scope": "Live v4 poster/atlas inspected. The cloud browser could not create its WebGL browser. V5 WebGL pixels, responsive layout and real GPU performance are unverified. Copied v4 frames/receipts remain inherited evidence.",
    "deployment": "Patch prepared; no remote PR or deployment created. GitHub CLI has no authenticated account in this session.",
    "rows": [],
}
out = ROOT / "receipts/upgrade-witness.json"
# The structural checker follows this public link, so create its record first.
out.write_text(json.dumps(record, indent=2) + "\n")
integrity = subprocess.run([sys.executable, str(ROOT / "tests/integrity.py")], capture_output=True, text=True)
if integrity.returncode:
    raise SystemExit(integrity.stdout + integrity.stderr)
record["structural_integrity"] = {"status": "pass", "output": integrity.stdout.strip()}
atlas = json.loads((ROOT / "receipts/atlas.json").read_text())
record["rows"] = [
    ["Baseline", "v4 retained at " + record["baseline_commit"][:12] + "; v1–v4 untouched."],
    ["Automated tests", str(tests["pass"]) + "/" + str(tests["tests"]) + " pass; zero failures/skips. Rendering mocked in DOM/SAI tests."],
    ["X3D grammar + semantics", "All 3 scenes pass: 4.0 plateau/instruments, 4.1 sky. Zero errors or warnings; exact hashes in validation-v5.json."],
    ["Source integrity", "Local references, SAI names, six frozen v4 assets and three deterministic generated files pass."],
    ["Catalogue motion", "All 179 halo copies match cores; requested epochs update cores, halos, lines and labels together."],
    ["Atlas review", str(atlas["count"]) + " claims retained; two grades corrected and four further comparisons annotated; originals preserved."],
    ["Inherited provenance", "Blender/Cycles bakes, stellar catalogue, original receipts and old frames are retained v4 evidence, not newly run v5 exports/renders."],
    ["Visual checks still open", "V5 pixels, native browser layout, mobile, Firefox/Safari, hardware MSAA and GPU frame times. The live review browser could not create WebGL."],
]
record["sha256"] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.rglob("*")) if p.is_file() and (p.suffix in [".mjs", ".css", ".html", ".x3d"] or p.name in ["belt-instrument.json", "atlas.json"])}
out.write_text(json.dumps(record, indent=2) + "\n")
print(str(tests["pass"]) + " tests + 3 scenes + structural integrity: pass")
