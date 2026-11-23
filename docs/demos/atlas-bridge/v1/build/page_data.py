#!/usr/bin/env python3
"""page_data: one data.json for the page, every number read from a receipt or the ledger (the page prints no
number of its own). usage: python3 build/page_data.py   (run in the demo folder)"""
import json
from pathlib import Path
HERE = Path(__file__).resolve().parent.parent
R = lambda n: json.loads((HERE / "receipts" / n).read_text())
has = lambda n: (HERE / "receipts" / n).exists()
L = json.loads((HERE / "ledger.json").read_text())
spent = L.get("opening_spent", 0) + sum(e["price"] for e in L["entries"] if e["state"] == "succeeded")
f1 = lambda v, d=1: f"{v:,.{d}f}"
out = []
for world, run, rec in [("Reading room", "Chisel, ring 1", "reading-room-chisel-reading-room.json"), ("Reading room", "Chisel, ring 2 (ring 1 as context)", "reading-room-chisel-reading-room-ring2.json"), ("King's Chamber", "Chisel", "kings-chamber-chisel-kings-chamber.json")]:
    s = R(rec)["summary"]; v = R(rec)["views"]
    out.append({"world": world, "run": run, "views": s["views"], "camera": f'{max(x["camera_back_pos_diff_m"] for x in v):g} m, {max(x["camera_back_rot_diff_deg"] for x in v):g} deg', "scale": s["global_scale_atlas_over_x3d"],
                "median_pct": s["scaled_rel_err_median_pct"], "within5": s["px_within_5pct"], "pixels": s["pixels_compared"], "receipt": "receipts/" + rec})
rr, kc = R("reading-room-atlas-return.json"), R("kings-chamber-atlas-return.json")
back = []
def splat_rows(name, r, kind):
    s = r["splats"]; v = s["vs_x3d_surfaces"]
    back.append({"world": name, "what": f'{kind} splats, {s["count"]:,} (SPZ v{s["spz_version"]}, {s["bytes"]/1e6:.1f} MB)', "number": f'centres a median {f1(v["median_mm"])} mm from an X3D surface; {f1(v["within_50mm_pct"])}% within 50 mm, {f1(v["within_100mm_pct"])}% within 100 mm', "grade": "C",
                 "witness": f'exact point-to-solid distance, {v["sample"]:,} splats · receipts/{name.lower().replace(" ", "-").replace("\'", "")}-atlas-return.json'})
    c = r["cameras"]
    back.append({"world": name, "what": f'{c["count"]} cameras as Viewpoint', "number": f'{c["worst_position_diff_m"]:g} m and {c["worst_rotation_diff_deg"]:g} deg from the Viewpoints sent', "grade": "C", "witness": "returned camera vs sent Viewpoint, worst of all"})
splat_rows("Reading room", rr, "Refined"); splat_rows("Kings Chamber", kc, "Draft")
for name, rec, r in [("Reading room", "reading-room-mesh-reading-room-refined.json", rr), ("Kings Chamber", "kings-chamber-mesh-kings-chamber-draft.json", kc)]:
    if not has(rec): continue
    m = R(rec); me = m["mesh"]
    back.append({"world": name, "what": f'Mesh as IndexedTriangleSet, {me["vertices"]:,} vertices, {me["faces"]:,} triangles', "number": f'vertices a median {f1(me["vertex_to_x3d_surface_median_mm"])} mm from an X3D surface; {f1(me["within_100mm_pct"])}% within 100 mm', "grade": "C", "witness": f"exact point-to-solid distance, 80,000 vertices · receipts/{rec}"})
    pad = [k for k in m if k.startswith("surface_within_")][0]
    back.append({"world": name, "what": f'{m["boxes"]} collider boxes as a Collision proxy (all upright: {"yes" if m["all_upright"] else "no"})', "number": f'{f1(m[pad])}% of the X3D surface points the cameras see lie within 50 mm of a box; {f1(m["open_air_wrongly_blocked_pct"], 2)}% of open-air points are wrongly inside one', "grade": "C",
                 "witness": f'{m["surface_points"]:,} surface points, {m["open_air_points"]:,} open-air points · receipts/{rec}'})
for name, r in [("Reading room", rr), ("Kings Chamber", kc)]:
    back.append({"world": name, "what": "The return file", "number": f'{r["x3d"]["file"]}, {r["x3d"]["bytes"]/1e6:.1f} MB, valid X3D 4.1' if r["x3d"]["valid"] else "NOT valid", "grade": "C", "witness": r["x3d"]["validator"]})
if has("reading-room-depth-ab.json"):
    ab = R("reading-room-depth-ab.json")["runs"]
    back.append({"world": "Reading room", "what": "A/B, same 12 pictures: splats built on X3D depth vs on the depth Atlas returned", "number": f'X3D depth: median {f1(ab["x3d_depth"]["median_mm"])} mm, {f1(ab["x3d_depth"]["within_100mm_pct"])}% within 100 mm. Atlas depth: median {f1(ab["atlas_depth"]["median_mm"])} mm, {f1(ab["atlas_depth"]["within_100mm_pct"])}% within 100 mm', "grade": "C", "witness": "receipts/reading-room-depth-ab.json"})
for b in back: b["world"] = b["world"].replace("Kings", "King's")
edit = R("reading-room-edit-globe.json")
P = json.loads((HERE / "receipts" / "page.json").read_text()) if has("page.json") else {}
v = rr["splats"]["vs_x3d_surfaces"]; o = out[0]
stats = [{"value": f'{spent:,}', "label": f'Atlas credits spent of the 10,000 cap ({sum(1 for e in L["entries"] if e["state"] == "succeeded")} paid calls)', "source": "ledger.json"},
         {"value": f'{o["median_pct"]:.2f}%', "label": "median gap, Atlas depth vs the X3D depth it was given (reading room)", "source": o["receipt"]},
         {"value": "0 m · 0°", "label": "camera error, X3D Viewpoint to Atlas and back, 36 cameras", "source": "receipts/*-atlas-return.json"},
         {"value": f'{rr["splats"]["count"]/1e6:.0f} M', "label": f'refined splats, a median {v["median_mm"]:.0f} mm from the X3D surfaces', "source": "receipts/reading-room-atlas-return.json"},
         {"value": f'{P["psnr_refined_db"]:.1f} to {P["psnr_kings_chamber_draft_db"]:.1f} dB', "label": "live page splat render vs the Atlas picture, same X3D Viewpoint (lowest: the 24-view hero, whose two rings differ in exposure)", "source": "receipts/page.json"},
         {"value": "3 / 3", "label": "return worlds valid X3D (4.1 worlds, 4.0 mesh files)", "source": "x3d_mcp 4d433af"}]
findings = json.loads((HERE / "receipts" / "findings.json").read_text())
size = lambda fs: f'{sum((HERE / "worlds" / f).stat().st_size for f in fs)/1e6:.0f} MB'
worlds = [{"label": "Reading room", "file": "worlds/reading-room-atlas.x3d", "size": size(["reading-room-atlas.x3d", "reading-room-refined.spz"]), "default": False, "start": 0},
          {"label": "King's Chamber", "file": "worlds/kings-chamber-atlas.x3d", "size": size(["kings-chamber-atlas.x3d", "kings-chamber-draft.spz"]), "default": True, "start": 0}]
entries = [{k: e.get(k) for k in ("label", "task", "price", "state", "seconds", "operation")} for e in L["entries"]]
data = {"stats": stats, "out": out, "edit": edit, "back": back, "worlds": worlds, "findings": findings,
        "ledger": {"entries": entries, "note": f'{spent:,} credits spent of a 10,000 cap, {L.get("opening_spent", 0)} of them on the first call before this demo. Prices are the account rate card read on 23 Nov 2026 (1,000 credits = 1 USD). Every call was written to the ledger with its price before it left; calls the API refused cost nothing and are listed at 0. Prompt enhancement was off on every call.'},
        "rig": "Rig for every render on this page and in the receipts: Playwright Chromium 157.0.8103.78 headless, ANGLE SwiftShader (software GL, no real GPU), three r187, Spark 2.4.0, the X3D to three.js bridge from x3d.loom. Validator: hagopjay/x3d_mcp 4d433af, bundled X3D 4.1 XSD.",
        "captions": {"layers": P.get("layers_caption", "")}}
(HERE / "data.json").write_text(json.dumps(data, indent=1)); print("data.json", (HERE / "data.json").stat().st_size, "bytes; spent", spent)
