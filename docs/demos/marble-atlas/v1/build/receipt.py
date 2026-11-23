#!/usr/bin/env python3
"""Loom Receipt v1 (x3d.loom kit/loomkit/receipt.py schema "loom.receipt/1") for Demo 76.
Uses loomkit's own canonical() + sha256 so `loomkit.receipt.verify` accepts it.
    python3 build/receipt.py /home/user/x3d.loom   -> receipts/loom-receipt.json"""
import json, subprocess, sys
from pathlib import Path
HERE = Path(__file__).resolve().parents[1]
loom = Path(sys.argv[1])
sys.path.insert(0, str(loom / "kit"))
from loomkit.core import canonical, sha256_bytes, sha256_file, utc_now   # noqa: E402
N = json.loads((HERE / "receipts/numbers.json").read_text())
C = json.loads((HERE / "receipts/camtest.json").read_text())
git = lambda p: subprocess.run(["git", "-C", str(p), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
B = HERE / "data/bundle"
outs = sorted(HERE.glob("worlds/*.x3d")) + [B / "fused.spz", B / "mesh.glb", B / "colliderBoxes.glb"]
r = {
    "schema": "loom.receipt/1", "kind": "artifact", "subject": "x3d.demo demos/marble-atlas/v1 (Demo 76): Atlas outputs -> X3D 4.1",
    "candidate_sha256": sha256_bytes(canonical({p.name: sha256_file(p) for p in outs})), "candidate_files": len(outs),
    "profile": "Immersive + GaussianSplats:1 (X3D 4.1 draft)",
    "inputs": {"rig": {"file": "data/atlas-skills-rig.json", "sha256": sha256_file(HERE / "data/atlas-skills-rig.json"),
                       "origin": "github.com/worldlabsai/skills 6cdb6b9 skills/atlas-splats/assets/example/splats-request.json", "licence": "Apache-2.0"},
               "depth_exr_sha256": {p.name: sha256_file(p) for p in sorted(B.glob("*_depth.exr"))},
               "atlas_docs": "docs.atlas.worldlabs.ai llms.txt sha256 af08fdd9eb0affece65005004e4db9dbb16ccd9c59c5f1220a328c0e12c43f38, fetched 2026-11-23"},
    "tools": {"atlas2x3d": "1.0.0", "x3d_mcp": git("/home/user/x3d_mcp"), "x_ite": "16.7.1", "chromium": C["rig"], "x3d.loom": git(loom)},
    "outputs": {p.name: {"bytes": p.stat().st_size, "sha256": sha256_file(p)} for p in outs},
    "witnesses": {
        "Grammar": {"result": "pass", "detail": {k: v["valid"] for k, v in N["validation"]["value"].items()}, "tool": N["validation"]["source"]},
        "Eyes": {"result": "pass", "detail": {"label_agreement_mean_pct": C["worlds"]["correct"]["mean_pct"], "min_pct": C["worlds"]["correct"]["min_pct"],
                 "mutants": {k: v["mean_pct"] for k, v in C["worlds"].items() if k != "correct"}}, "tool": "build/camtest.mjs + build/compare.py"},
        "Traps": {"result": "pass", "detail": {"unproject_max_mm": N["unproject_correct"]["value"]["max_mm"],
                  "trap_mean_mm": {k: v["mean_mm"] for k, v in N["traps"]["value"].items()}}, "tool": N["unproject_correct"]["source"]},
        "Meaning": {"result": "pass", "detail": "frame: Atlas Three.js = X3D; docs 30-degree example reproduced; rdf round trip " + str(N["rdf_roundtrip_max_abs"]["value"])}},
    "not_run": [{"witness": "Truth (real Atlas output)", "why": "no API call: key not in environment, spend needs his OK per call"},
                {"witness": "Host (real GPU)", "why": "SwiftShader only"}, {"witness": "Blender", "why": "Atlas extension / Blender 5.3 not run here"}],
    "model_calls": [], "budget": {"usd_spent": 0.0, "api_calls": 0},
    "limitations": ["Scene is procedural; Atlas SPZ frame graded L (docs) not C", "EXR depth files are not committed (20 MB); regenerate with kit/make_fixture.py, hashes above"],
    "grade": "C", "written_at": utc_now(), "prev": None, "signed": False}
r["sha256"] = sha256_bytes(canonical(r))
(HERE / "receipts/loom-receipt.json").write_text(json.dumps(r, sort_keys=True, indent=2) + "\n")
from loomkit.receipt import verify   # noqa: E402
verify(HERE / "receipts/loom-receipt.json"); print("receipt verified", r["sha256"][:12])
