#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Apply explicit editorial corrections to the archived v4 atlas.

The original source and both original grades remain recoverable. This is not
a new statistical fit or an independent historical survey. It separates two
misassigned grades and exposes qualifications on four other inherited claims.
"""
from pathlib import Path
from collections import Counter
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "v4" / "receipts" / "atlas.json"
atlas = json.loads(SOURCE.read_text())
claims = {c["id"]: c for c in atlas["claims"]}


def amend(key, note, *, grade=None, test=None, status=None):
    c = claims[key]
    c["originalNumber"] = c["number"]
    c["originalTitle"] = c["title"]
    c["originalTest"] = c["test"]
    c["reviewNote"] = note
    if grade:
        c["number"] = grade
    if test:
        c["test"] = test
    if status:
        c["comparisonStatus"] = status


amend("kings_chamber", "The inherited Confirmed grade applied to the separate 2:1 floor plan. The displayed height/spatial-diagonal relationship was qualified as Likely in the original calculation. Historical quoted errors are not treated here as calibrated Gaussian standard deviations.", grade="Likely")
amend("v1_joints", "A reported mean of 0.508 mm does not establish an upper bound below 0.5 mm. Individual widths and measurement uncertainty are not supplied. Tight workmanship remains impressive; the literal threshold is unestablished.", grade="Suspected")
amend("height_au", "Approximation only: the comparison is about 1.92% short and below the stated orbital-distance range. The retained editorial grade does not certify equality or agreement within a measurement uncertainty.", status="Approximation only")
amend("menkaure_slope", "The same-slope claim is unsupported by the cited values: the difference is about 0.85°, approximately five times the quoted 10′ range. Broad family resemblance is a weaker statement than equality.", status="Same-slope claim unsupported")
amend("v1_latitude", "The target happens to fall within the modeled extent; many possible latitude lines do not logically force any selected target to lie there. The centre/datum accuracy does not justify centimetre interpretation of seven displayed decimals.", test="The selected 29.9792458° line crosses the illustrative footprint about 7.8 m north of the adopted map centre, roughly 12.5 m south of the modeled Gallery midpoint. The chosen point, datum, coordinate notation and modern SI units determine this numerical resemblance. It does not establish knowledge of the vacuum speed of light.")
amend("v1_pi", "A 5½-palm seked mathematically produces 22/7 for this ratio. That identity does not establish which constant, if any, the builders intended.", test="The reference square-pyramid model yields 2b/h ≈ 3.140160, near π. A 5½-palm seked yields 22/7 exactly. The default comparison uses analytic geometry; the inherited receipt's last digits are finite Monte Carlo sample means. Historical slope ranges are not calibrated standard deviations.")

atlas["number_grades"] = dict(Counter(c["number"] for c in atlas["claims"]))
atlas["review"] = {
    "schema": "giza-atlas-review/v1",
    "source": "../v4/receipts/atlas.json",
    "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    "reviewed_ids": [key for key, c in claims.items() if "reviewNote" in c],
    "design_labels": "Retained editorial plausibility labels; not probabilities or documentary proof of a particular ancient intention.",
    "generator": "build/apply_review.py",
}
(ROOT / "receipts" / "atlas.json").write_text(json.dumps(atlas, indent=2, ensure_ascii=False) + "\n")
print("Wrote reviewed atlas:", atlas["number_grades"])
