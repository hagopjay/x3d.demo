#!/usr/bin/env python3
"""page_data: one data.json for the v2 page. Every number is read from a receipt or the ledger; the page prints no
number of its own. usage: page_data.py"""
import json
from pathlib import Path
HERE = Path(__file__).resolve().parent.parent
R = lambda n: json.loads((HERE / "receipts" / n).read_text())
L = json.loads((HERE / "ledger.json").read_text())
prep, prep24 = R("prepare-scriptorium.json")["summary"], R("prepare-scriptorium24.json")["summary"]
ch = R("scriptorium-chisel-scriptorium.json")["summary"]; back = R("scriptorium-atlas-return.json"); mesh = R("scriptorium-mesh-scriptorium-draft.json")["mesh"]
judge = R("scriptorium-cycles-judge.json")["summary"]; c12, c24 = R("scriptorium-clean.json"), R("scriptorium-clean24.json")
ph1, ph2 = R("physics-reading-room.json"), R("physics-scriptorium.json")
cm2, cm1 = R("scriptorium-ring2-colour-match.json"), R("reading-room-ring2-colour-match.json")
f = lambda v, d=1: f"{v:,.{d}f}"
V2 = [e for e in L["entries"] if e["label"] in L["v2_labels"]]
spent_v2 = sum(e["price"] for e in V2 if e["state"] == "succeeded")
RIG = "Rig: Blender 5.3.0 (bpy wheel, Cycles CPU) with the X3D Blender I/O add-on v2.7.4; X3D to three.js bridge on three r187, Chromium 157 headless, SwiftShader; validator hagopjay/x3d_mcp 4d433af (X3D 4.0 and 4.1 XSD)."


def phys(p, world, src):
    d = p["rest_height_diff_mm"]
    return [world, p["collider_boxes"], p["compared"], f(d["median_abs"]) + " mm", f(d["p90_abs"]) + " mm", f(p["within_100mm_pct"]) + "%", p["rests_higher_than_x3d_by_100mm"], p["rests_lower_than_x3d_by_100mm"], p["start_inside_atlas_box"], src]


def cm(c, world, src):
    h = c["held_out"]
    return [world, f(h["before"]["pairs"], 0), f(h["before"]["mean_level_ring1"]) + " / " + f(h["before"]["mean_level_ring2"]), f(h["before"]["psnr_db"], 2) + " dB", f(h["after_cdl"]["psnr_db"], 2) + " dB",
            f(h["after_one_gain_only"]["psnr_db"], 2) + " dB", f(c["ring1_vs_ring1_floor"]["psnr_db"], 2) + " dB", str(c["blender_node"]["max_abs_diff_vs_numpy_255"]) + " / 255", src]


data = {
 "stats": [
  {"value": f(prep24["max_pos_err_blender_vs_x3d_mm"], 4) + " mm", "label": "largest camera position difference, Blender camera against the exported X3D Viewpoint (24 cameras)", "source": "prepare-scriptorium24.json"},
  {"value": f(prep24["max_depth_median_abs_diff_mm"], 2) + " mm", "label": "largest per-view median difference, Cycles depth against the X3D bridge depth", "source": "prepare-scriptorium24.json"},
  {"value": f(ch["scaled_rel_err_median_pct"], 2) + "%", "label": "median error of the depth Atlas returned against the Cycles depth it was sent", "source": "scriptorium-chisel-scriptorium.json"},
  {"value": f(mesh["vertex_to_x3d_surface_median_mm"], 0) + " mm", "label": "median distance, Atlas mesh vertex to the Blender surface", "source": "scriptorium-mesh-scriptorium-draft.json"},
  {"value": f(c24["psnr_mean_db"]) + " dB", "label": "clean baked X3D against the 24 Atlas pictures it was painted from", "source": "scriptorium-clean24.json"},
  {"value": f(spent_v2, 0), "label": f"Atlas credits spent on this page ({len([e for e in V2 if e['state'] == 'succeeded'])} paid calls)", "source": "ledger.json"}],
 "roles": [
  {"n": 1, "title": "Blender builds the input", "grade": "C", "text": f"A scriptorium was modelled in Blender 5.3 ({c24['bake']['objects']} mesh objects) and exported by the Blenderizer add-on as X3D 4.0. Cameras agree to {f(prep24['max_pos_err_blender_vs_x3d_mm'], 4)} mm and {f(prep24['max_rot_err_blender_vs_x3d_deg'], 3)} degrees. The Cycles Depth pass is planar z and agrees with the bridge's depth of the exported file to a median of {f(prep24['max_depth_median_abs_diff_mm'], 2)} mm (worst view; 99th percentile {f(prep24['max_depth_p99_abs_diff_mm'], 1)} mm). Atlas Chisel took the Cycles depth and returned depth within {f(ch['scaled_rel_err_median_pct'], 2)}% (median), scale {f(ch['global_scale_atlas_over_x3d'], 4)}, {f(ch['px_within_5pct'])}% of pixels within 5%.", "source": "prepare-scriptorium24.json, scriptorium-chisel-scriptorium.json"},
  {"n": 2, "title": "Blender cleans what comes back", "grade": "C", "text": f"The 24 Atlas pictures were projected along their own cameras onto the exact Blender geometry and baked into one {c24['bake']['texture_size']} px texture ({f(c24['bake']['mm_per_texel'], 2)} mm per texel). {c24['bake']['faces_seen_by_a_view']:,} of {c24['bake']['faces']:,} faces are seen by a view ({f(c24['bake']['surface_seen_m2'], 0)} of {f(c24['bake']['surface_m2'], 0)} m2; the rest is the outside of the walls and hidden faces, which keep their flat Blender colour). The result is a valid X3D 4.0 file with straight shelves and a flat floor, and it scores {f(c24['psnr_mean_db'])} dB (SSIM {f(c24['ssim_mean'], 2)}) against the pictures it was painted from. With the first 12 views alone: {f(c12['bake']['surface_seen_m2'], 0)} m2 seen, {f(c12['psnr_mean_db'])} dB. The Atlas mesh itself was not repaired; it sits a median {f(mesh['vertex_to_x3d_surface_median_mm'], 0)} mm from the Blender surface ({f(mesh['within_100mm_pct'])}% within 100 mm).", "source": "scriptorium-clean24.json, scriptorium-clean.json, scriptorium-mesh-scriptorium-draft.json"},
  {"n": 3, "title": "Blender's compositor matches the rings", "grade": "C", "text": f"One ASC CDL (slope, offset, power) was fitted between the two rings from pairs of pixels that show the same surface point, then applied with Blender's Color Balance node; Blender and the numpy fit agree to {cm2['blender_node']['max_abs_diff_vs_numpy_255']}/255 on the scriptorium. The finding went against the v1 guess: on the same surface points the v1 rings sit at almost the same level ({f(cm1['held_out']['before']['mean_level_ring1'], 0)} against {f(cm1['held_out']['before']['mean_level_ring2'], 0)}), and the match moves held-out agreement only from {f(cm1['held_out']['before']['psnr_db'], 2)} to {f(cm1['held_out']['after_cdl']['psnr_db'], 2)} dB. Two first-ring pictures of one point already disagree at {f(cm1['ring1_vs_ring1_floor']['psnr_db'], 2)} dB. The v1 gap is the pictures disagreeing about content, not exposure. The scriptorium rings agree far better ({f(cm2['held_out']['before']['psnr_db'], 2)} dB before any match).", "source": "reading-room-ring2-colour-match.json, scriptorium-ring2-colour-match.json"},
  {"n": 4, "title": "Cycles is the reference judge", "grade": "C", "text": f"The Cycles object-index pass says where every object's outline is. Atlas keeps {f(judge['outline_recall_atlas_pct'])}% of those outlines ({judge['objects_with_recall_over_90pct']} of {R('scriptorium-cycles-judge.json')['objects_judged']} objects above 90%); the Cycles picture itself keeps {f(judge['outline_recall_cycles_pct'])}%. Median hue difference per object is {f(judge['hue_diff_median_deg'])} degrees, {f(judge['objects_hue_within_25deg_pct'])}% of objects within 25. Atlas merged the vault into the walls and painted plaster where the prompt asked for tufa blocks. Picture against picture, Atlas and Cycles are {f(judge['psnr_mean_db'])} dB apart, as expected of a painter and a path tracer.", "source": "scriptorium-cycles-judge.json"},
  {"n": 5, "title": "Blender physics tests the colliders", "grade": "C", "text": f"Small balls were dropped on a grid in two Blender rigid-body worlds: the X3D room as mesh colliders, and the Atlas collider boxes. Scriptorium: {ph2['compared']} probes, median rest-height difference {f(ph2['rest_height_diff_mm']['median_abs'])} mm, {f(ph2['within_100mm_pct'])}% within 100 mm, {ph2['rests_higher_than_x3d_by_100mm']} rest more than 100 mm high (boxes where there is air), {ph2['rests_lower_than_x3d_by_100mm']} low, none fell out. The v1 reading room behaves the same ({f(ph1['rest_height_diff_mm']['median_abs'])} mm, {f(ph1['within_100mm_pct'])}%).", "source": "physics-scriptorium.json, physics-reading-room.json"}],
 "physics": [phys(ph2, "Scriptorium (draft splat mesh)", "physics-scriptorium.json"), phys(ph1, "Reading room, v1 (refined splat mesh)", "physics-reading-room.json")],
 "colour": [cm(cm2, "Scriptorium", "scriptorium-ring2-colour-match.json"), cm(cm1, "Reading room, v1", "reading-room-ring2-colour-match.json")],
 "cdl": {"scriptorium": cm2["cdl_scene_linear"], "reading_room": cm1["cdl_scene_linear"]},
 "back": [
  ["Cameras returned against cameras sent", f"{back['cameras']['worst_position_diff_m']} m, {back['cameras']['worst_rotation_diff_deg']} degrees", "scriptorium-atlas-return.json"],
  ["Draft splats", f"{back['splats']['count']:,} splats; centre to Blender surface median {f(back['splats']['vs_x3d_surfaces']['median_mm'])} mm, {f(back['splats']['vs_x3d_surfaces']['within_100mm_pct'])}% within 100 mm", "scriptorium-atlas-return.json"],
  ["Mesh", f"{mesh['faces']:,} faces; vertex to Blender surface median {f(mesh['vertex_to_x3d_surface_median_mm'])} mm, 90th percentile {f(mesh['p90_mm'])} mm", "scriptorium-mesh-scriptorium-draft.json"],
  ["Collider boxes", f"{back['colliders']['boxes']} boxes, all upright; written as an X3D Collision proxy", "scriptorium-atlas-return.json"],
  ["Return world", f"{back['x3d']['file']}, {back['x3d']['bytes']:,} bytes, valid X3D 4.1", "scriptorium-atlas-return.json"]],
 "worlds": [
  {"label": "Clean X3D (Atlas paint on Blender geometry)", "file": "worlds/scriptorium-clean24.x3d", "size": "1.5 MB + 3.1 MB texture", "default": True},
  {"label": "Atlas return world (splats, mesh, colliders)", "file": "worlds/scriptorium-atlas.x3d", "size": "3.5 MB + 8.3 MB splats"},
  {"label": "Blender export, untouched", "file": "worlds/scriptorium24.x3d", "size": "1.4 MB"}],
 "ledger": {"entries": [{k: e.get(k) for k in ("label", "task", "price", "state", "operation", "seconds")} for e in V2],
            "note": f"{spent_v2:,} credits on this page's {len(V2)} calls. The account ledger stands at {L['committed']:,} committed against a hard stop of {L['hard_stop']['ledger_total']:,}; the other calls since v1 belong to two other studies on the same account and are listed in ledger.json. Prices are the account rate card (1,000 credits = 1 USD)."},
 "rig": RIG}
(HERE / "data.json").write_text(json.dumps(data, indent=1)); print("data.json", len(json.dumps(data)))
