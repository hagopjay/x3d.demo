# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 65 v4: gather the gates' own outputs into receipts/witness.json (the table on the page reads it).
usage: make_witness.py <v4 dir> <loom evidence dir> <finalcheck.json> <hyg csv> <x3d-blender-io dir> <unit tests passed> <unit tests total>
Nothing here judges anything: it copies statuses, counts and hashes, and names the instrument behind each."""
import hashlib, json, os, subprocess, sys, datetime

V4, EV, FINAL, HYG, ADDON, T_PASS, T_ALL = sys.argv[1:8]
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
W = {n: json.load(open(os.path.join(EV, n + ".json"))) for n in ("grammar", "meaning", "traps", "page-traps")}
final = json.load(open(FINAL))
bake = json.load(open(os.path.join(V4, "receipts", "bake-receipt.json")))
atlas = json.load(open(os.path.join(V4, "receipts", "atlas.json")))
fork = W["grammar"]["instrument"]["commit"][:7]
git = lambda *a: subprocess.run(["git", "-C", ADDON, *a], capture_output=True, text=True)
# name main's commit when the checked-out add-on source is the same tree as main (a squash merge renames the commit, not the code)
same = git("diff", "--quiet", "origin/main", "--", "source").returncode == 0
addon = git("rev-parse", "--short", "origin/main" if same else "HEAD").stdout.strip() + ("" if same else " (local branch)")
g, m, t, pt = (W[k]["measurements"] for k in ("grammar", "meaning", "traps", "page-traps"))
files = {f: sha(os.path.join(V4, f)) for f in ("assets/giza.x3d", "assets/sky.x3d", "assets/sky-data.json", "assets/stage-data.json", "assets/ground-day.jpg",
                                               "assets/ground-night.jpg", "receipts/atlas.json", "receipts/claims-v4.json")}
runs = final["runs"]
clean = all(not r["console"] and not r["requests"] for r in runs)
rows = [
    ["X3D grammar", "giza.x3d valid against the X3D %s XSD, sky.x3d against %s: %d errors. Validator: x3d_mcp fork %s." % (
        g["assets/giza.x3d"]["xsd_version"], g["assets/sky.x3d"]["xsd_version"], sum(v["xsd_errors"] for v in g.values()), fork)],
    ["X3D meaning", "%d errors, %d warnings from the same fork's semantic checks (profile and component cover included)." % (
        sum(v["semantic_errors"] for v in m.values()), sum(v["semantic_warnings"] for v in m.values()))],
    ["Loom traps", "%d rules over both scenes, strict host: %d errors, %d warnings. Status %s." % (W["traps"]["coverage"]["rules"], t["errors"], t["warnings"], W["traps"]["status"])],
    ["Loom page traps", "%d rules over %d page files: %d errors, %d warnings. Status %s." % (W["page-traps"]["coverage"]["rules"], pt["files"], pt["errors"], pt["warnings"], W["page-traps"]["status"])],
    ["Unit tests", "%s of %s pass (node --test tests/atlas.test.mjs): the page's sky against the Python receipt, literal digits, camera maths." % (T_PASS, T_ALL)],
    ["Renderer", "X_ITE 16.7.1 in headless Chromium %s with SwiftShader, at %s px: all %d claims shown, tour, fly-out and sliders driven. Console %s." % (
        final["chromium"], " and ".join(str(r["width"]) for r in runs), runs[0]["steps"]["claims"], "clean, no failed request" if clean else "NOT clean: see finalcheck")],
    ["Not checked", "A real GPU, a real phone, Firefox, Safari. No frame rate is quoted: software GL says nothing about one."],
    ["Bake", "Blender %s Cycles on the CPU; x3d-blender-io %s. Ground bake %s s (day) and %s s (night). Script sha256 %s…" % (
        bake["blender"], addon, bake["timings"]["day"]["ground_bake_s"], bake["timings"]["night"]["ground_bake_s"], bake["script_sha256"][:12])],
    ["Stars", "HYG v4.1 (David Nash, CC BY-SA 4.0), catalogue sha256 %s…; precession ERFA ltp (Vondrak 2011)." % sha(HYG)[:12]],
    ["Atlas", "%d claims: %s. Design: %s." % (atlas["count"], ", ".join("%s %d" % kv for kv in atlas["number_grades"].items()), ", ".join("%s %d" % kv for kv in atlas["design_grades"].items()))],
]
out = dict(schema="x3d.io/giza-witness/1", made=datetime.date.today().isoformat(), rows=rows, files_sha256=files,
           validator=dict(tool=W["grammar"]["instrument"]["tool"], commit=W["grammar"]["instrument"]["commit"]),
           loom=dict(traps_rules_sha256=W["traps"]["instrument"]["rules_sha256"], page_traps_rules_sha256=W["page-traps"]["instrument"]["rules_sha256"]),
           browser=final)
json.dump(out, open(os.path.join(V4, "receipts", "witness.json"), "w"), indent=1, ensure_ascii=False)
for r in rows:
    print(r[0], "|", r[1])
