#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Write receipts/witness.json for Demo 65 v6: what was checked, by what, and the hashes of what was checked.

    python build/write_witness.py . <unit tests passed> <unit tests total>

Standard library only. Run from the v6 folder after the gates; it reads receipts/loom/*.json (the Loom kit's own
evidence files) and does not run anything itself. A gate that has no evidence file is written as "not run".
"""
import hashlib
import json
import os
import sys

FILES = [
    "index.html", "atlas.mjs", "stage.mjs", "machine.mjs", "machine-math.mjs", "instruments.mjs",
    "assets/celestial.x3d", "assets/celestial-data.json", "assets/survey.json", "assets/instruments.x3d",
    "receipts/atlas.json", "build/build_celestial.py", "build/build_survey.py", "build/build_witness.py",
]


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def gate(root, name):
    p = os.path.join(root, "receipts", "loom", name + ".json")
    if not os.path.exists(p):
        return "not run"
    d = json.load(open(p))
    return d.get("status", "unknown")


def main(root, passed, total):
    atlas = json.load(open(os.path.join(root, "receipts", "atlas.json")))
    ind = atlas["independence"]
    survey = json.load(open(os.path.join(root, "assets", "survey.json")))["squares"]
    out = {
        "schema": "x3d.io/giza-v6-witness/1",
        "generated_by": "build/write_witness.py",
        "validator": "x3d_mcp fork 39c6e94 through the Loom kit (grammar = X3D 4.0 XSD, meaning = semantic pass, traps = strict host)",
        "rig": "Playwright headless Chromium with SwiftShader, X_ITE 16.7.1 (vendored). Software GL: no frame rate is quoted.",
        "gates": {
            "grammar": gate(root, "grammar"),
            "meaning": gate(root, "meaning"),
            "traps": gate(root, "traps"),
            "page-traps": gate(root, "page-traps"),
            "unit_tests": "%s of %s pass (node --test, with linkedom)" % (passed, total),
        },
        "sha256": {f: sha(os.path.join(root, f)) for f in FILES},
        "rows": [
            ["X3D 4.0 schema", "celestial.x3d and instruments.x3d: " + gate(root, "grammar")],
            ["Semantic pass", gate(root, "meaning")],
            ["Loom traps, strict host", gate(root, "traps")],
            ["Loom page traps", gate(root, "page-traps")],
            ["Unit tests", "%s of %s pass" % (passed, total)],
            ["Validator", "x3d_mcp fork 39c6e94"],
            ["Rig", "Chromium + SwiftShader, X_ITE 16.7.1"],
            ["Precession model", "ERFA ltpequ / ltpecl (Vondrak 2011), no nutation"],
            ["Stars", "HYG v4.1, David Nash, CC BY-SA 4.0"],
            ["Survey", "Petrie 1883, sections 20 and 21"],
            ["Casing square closes to", "%s mm" % survey["casing"]["closure_mm"]],
            ["Claims / separate facts", "%s / %s (editorial table)" % (ind["claims"], ind["facts_about_the_monuments"])],
        ],
    }
    json.dump(out, open(os.path.join(root, "receipts", "witness.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(out["gates"], indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
