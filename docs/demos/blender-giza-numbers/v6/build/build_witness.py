#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Sort the 63 claims by the one fact each rests on (Demo 65 v6).

    python build_witness.py ../v5/receipts/atlas.json receipts/atlas.json

Standard library only. The input is the reviewed v5 atlas; nothing in it is changed. Two fields are added
to every claim:

  roots        one or two keys from ROOTS below: the measured thing the claim stands on. The first is the
               one the page groups by.
  modern_unit  the unit the claim needs that the builders did not have (mile, metre, second ...), or null.

This is an EDITORIAL table. It was made by reading each claim's test, not by a computation, and it is
printed on the page as such. Its use is one count: how many separate facts about the monument do the 63
claims rest on? Two claims with one root are one witness, not two.
"""
import collections
import hashlib
import json
import sys

ROOTS = {
    "khufu_slope": "The Great Pyramid's one slope (7 up for 11 along)",
    "khufu_base": "The Great Pyramid's base side (440 cubits)",
    "cubit": "The length of the royal cubit",
    "khufu_volume": "The Great Pyramid's volume and what it is made of",
    "khafre_shape": "Khafre's base and slope",
    "menkaure_slope": "Menkaure's slope",
    "kings_chamber": "The King's Chamber: its size",
    "coffer": "The granite coffer",
    "chamber_levels": "The levels of the chamber floors",
    "queens_chamber": "Where the Queen's Chamber stands",
    "passage_angle": "The entrance passage's angle",
    "shaft_angles": "The angles of the four shafts",
    "orientation": "How square and how true to north the base is",
    "platform_level": "How level the platform is",
    "casing_joints": "How thin the casing joints are",
    "core_hollow": "The hollow in the core faces",
    "site_layout": "Where the three pyramids stand",
    "latitude": "Where on the Earth Giza is",
    "greaves": "John Greaves's visit",
    "sky_only": "The sky alone: no measurement of a monument",
    "none": "No measurement of Giza at all",
}

# claim id -> (roots, modern unit)
TABLE = {
    "v1_base": (["khufu_base"], "foot"),
    "v1_height": (["khufu_slope", "khufu_base"], "foot and mile"),
    "v1_ratio711": (["khufu_slope"], None),
    "v1_acres": (["khufu_base"], "acre"),
    "v1_blocks": (["khufu_volume"], None),
    "v1_pi": (["khufu_slope"], None),
    "v1_tau": (["khufu_slope"], None),
    "v1_phi": (["khufu_slope"], None),
    "khafre_345": (["khafre_shape"], None),
    "menkaure_slope": (["menkaure_slope"], None),
    "seked": (["khufu_slope"], None),
    "pi_phi_identity": (["khufu_slope"], None),
    "herodotus_face": (["khufu_slope"], None),
    "khafre_137": (["khafre_shape", "cubit"], None),
    "cubit_pi6": (["cubit"], "metre"),
    "cubits_440_280": (["cubit", "khufu_base"], None),
    "perimeter_1760": (["khufu_base"], "yard and mile"),
    "pyramid_inch_year": (["khufu_base"], "pyramid inch"),
    "perimeter_36524": (["khufu_base"], "pyramid inch"),
    "kings_chamber": (["kings_chamber"], None),
    "kc_half_area": (["chamber_levels"], None),
    "qc_half_level": (["chamber_levels"], None),
    "qc_midplane": (["queens_chamber"], None),
    "passage_1_in_2": (["passage_angle"], None),
    "coffer_double": (["coffer"], None),
    "v1_level": (["platform_level"], None),
    "v1_joints": (["casing_joints"], None),
    "v1_north": (["orientation"], None),
    "square_sides": (["orientation"], None),
    "giza_diagonal": (["site_layout"], None),
    "khufu_diagonal": (["site_layout"], None),
    "eight_sides": (["core_hollow"], None),
    "v1_latitude": (["latitude"], "metre and second"),
    "scale_43200_perimeter": (["khufu_base"], None),
    "scale_43200_height": (["khufu_slope", "khufu_base"], None),
    "circles_light": (["khufu_base"], "metre and second"),
    "mass_earth": (["khufu_volume"], "kilogram"),
    "latitude_30": (["latitude"], None),
    "land_centre": (["latitude"], None),
    "v1_day": (["none"], "second"),
    "v1_sun": (["none"], "mile"),
    "v1_sun_r": (["none"], "mile"),
    "v1_moon_r": (["none"], "mile"),
    "v1_sun_earth": (["none"], None),
    "v1_sun_dist": (["none"], None),
    "v1_meridian": (["none"], "metre"),
    "v1_canon_size": (["none"], None),
    "v1_canon_dist": (["none"], None),
    "v1_canon_spin": (["none"], None),
    "height_au": (["khufu_slope", "khufu_base"], "metre"),
    "earth_moon_triangle": (["khufu_slope"], None),
    "radii_5040": (["none"], "mile"),
    "earth_7920": (["none"], "mile"),
    "orion_belt": (["site_layout"], None),
    "shaft_stars": (["shaft_angles"], None),
    "thuban_pole": (["sky_only"], None),
    "diagonals_precession": (["khufu_base"], "pyramid inch"),
    "passage_thuban": (["passage_angle"], None),
    "leo_10500": (["sky_only"], None),
    "orion_lowest": (["sky_only"], None),
    "spence_alignment": (["orientation"], None),
    "v1_greaves": (["greaves"], None),
    "v1_greaves_foot": (["greaves"], None),
}


def main(src, out):
    raw = open(src, "rb").read()
    atlas = json.loads(raw)
    ids = [c["id"] for c in atlas["claims"]]
    missing = [i for i in ids if i not in TABLE]
    extra = [i for i in TABLE if i not in ids]
    if missing or extra:
        raise SystemExit("table and atlas disagree: missing %s, extra %s" % (missing, extra))
    for c in atlas["claims"]:
        roots, unit = TABLE[c["id"]]
        for r in roots:
            if r not in ROOTS:
                raise SystemExit("unknown root " + r)
        c["roots"] = roots
        c["modern_unit"] = unit
    first = collections.Counter(c["roots"][0] for c in atlas["claims"])
    monument = [k for k in first if k not in ("none", "sky_only")]
    held = [c for c in atlas["claims"] if c["number"] == "Confirmed"]
    held_roots = sorted({c["roots"][0] for c in held if c["roots"][0] not in ("none", "sky_only")})
    atlas["independence"] = {
        "schema": "x3d.io/giza-witness/1",
        "generated_by": "build/build_witness.py",
        "kind": "editorial: assigned by reading each claim's test, not computed",
        "source": src.replace("\\", "/").split("/blender-giza-numbers/")[-1],
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "roots": [{"key": k, "label": ROOTS[k], "claims": first[k]} for k in ROOTS if first[k]],
        "claims": len(ids),
        "facts_about_the_monuments": len(monument),
        "claims_on_no_measurement": first["none"],
        "claims_on_the_sky_alone": first["sky_only"],
        "claims_needing_a_modern_unit": sum(1 for c in atlas["claims"] if c["modern_unit"]),
        "confirmed_claims": len(held),
        "confirmed_claims_on_no_measurement": sum(1 for c in held if c["roots"][0] == "none"),
        "facts_behind_confirmed_claims": len(held_roots),
        "largest_root": max(monument, key=lambda k: first[k]),
        "largest_root_claims": max(first[k] for k in monument),
    }
    json.dump(atlas, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in atlas["independence"].items() if k != "roots"}, indent=1))
    for r in atlas["independence"]["roots"]:
        print("%3d  %s" % (r["claims"], r["label"]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
