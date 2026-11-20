#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Petrie's three squares of the Great Pyramid's base, walked round and compared (Demo 65 v6).

    python build_survey.py assets/survey.json

Standard library only. The numbers are Petrie 1883, The Pyramids and Temples of Gizeh, sections 20 and 21,
read from Ronald Birdsall's transcription on 20 November 2026 (chapter 6). Lengths are British inches;
azimuths are seconds of arc, negative = west of north.

Each square is walked from its north-west corner: north side eastward, east side southward, south side
westward, west side northward, each on its own bearing. The walk should come back to its start. How far
it misses is a check on the table itself, and it is written into the receipt.
"""
import json
import math
import sys

IN = 0.0254
SQUARES = {
    "casing": {
        "title": "Casing on the pavement",
        "note": "The finished base. Petrie computed it from the casing found on each side and the socket diagonals.",
        "source": "Petrie 1883 s.21",
        "lengths": {"N": 9069.4, "E": 9067.7, "S": 9069.5, "W": 9068.6},
        "azimuths": {"N": -(3 * 60 + 20), "E": -(3 * 60 + 57), "S": -(3 * 60 + 41), "W": -(3 * 60 + 54)},
        "petrie_mean_length": 9068.8, "petrie_mean_difference": 0.65,
        "petrie_mean_azimuth": -(3 * 60 + 43), "petrie_mean_azimuth_difference": 12,
    },
    "core": {
        "title": "Core masonry",
        "note": "The mean planes of the stepped core, reduced to the pavement level.",
        "source": "Petrie 1883 s.20",
        "lengths": {"N": 9002.3, "E": 8999.4, "S": 9001.7, "W": 9002.5},
        "azimuths": {"N": -(4 * 60 + 35), "E": -(5 * 60 + 26), "S": -(5 * 60 + 23), "W": -(5 * 60 + 39)},
        "petrie_mean_length": 9001.5, "petrie_mean_difference": 1.0,
        "petrie_mean_azimuth": -(5 * 60 + 16), "petrie_mean_azimuth_difference": 20,
    },
    "sockets": {
        "title": "Corner sockets",
        "note": "Cut in the rock at four different depths, so they are not a square at one level. Petrie: 'the socket lines cannot show the finished base'.",
        "source": "Petrie 1883 s.20",
        "lengths": {"N": 9129.8, "E": 9130.8, "S": 9123.9, "W": 9119.2},
        "azimuths": {"N": -(3 * 60 + 20), "E": -(5 * 60 + 21), "S": 1 * 60 + 15, "W": -(7 * 60 + 33)},
        "petrie_mean_length": 9125.9, "petrie_mean_difference": 4.4,
        "petrie_mean_azimuth": -(3 * 60 + 45), "petrie_mean_azimuth_difference": 162,
    },
}
ORDER = ["N", "E", "S", "W"]
HEADING = {"N": 90.0, "E": 180.0, "S": 270.0, "W": 0.0}


def walk(lengths, azimuths):
    x = y = 0.0
    corners = [(0.0, 0.0)]
    for k in ORDER:
        b = math.radians(HEADING[k] + azimuths[k] / 3600.0)
        x += lengths[k] * math.sin(b)
        y += lengths[k] * math.cos(b)
        corners.append((x, y))
    closure = math.hypot(x, y)
    pts = corners[:4]
    cx = sum(p[0] for p in pts) / 4
    cy = sum(p[1] for p in pts) / 4
    mean = sum(lengths.values()) / 4
    az = math.radians(sum(azimuths.values()) / 4 / 3600.0)
    h = mean / 2
    ideal = [(cx + u * math.cos(az) + v * math.sin(az), cy - u * math.sin(az) + v * math.cos(az))
             for u, v in ((-h, h), (h, h), (h, -h), (-h, -h))]
    offsets = [(p[0] - q[0], p[1] - q[1]) for p, q in zip(pts, ideal)]
    return closure, mean, sum(azimuths.values()) / 4, offsets


def main(out):
    result = {"schema": "x3d.io/giza-survey/1", "generated_by": "build/build_survey.py", "unit": "British inch", "inch_m": IN,
              "read": "Birdsall transcription of Petrie 1883, chapter 6, sections 20 and 21, read 20 November 2026",
              "corner_order": ["NW", "NE", "SE", "SW"], "squares": {}}
    for key, sq in SQUARES.items():
        closure, mean, mean_az, offsets = walk(sq["lengths"], sq["azimuths"])
        diffs = [abs(sq["lengths"][k] - mean) for k in ORDER]
        azd = [abs(sq["azimuths"][k] - mean_az) for k in ORDER]
        entry = dict(sq)
        entry.update({
            "mean_length": round(mean, 3),
            "mean_length_difference": round(sum(diffs) / 4, 3),
            "mean_azimuth": round(mean_az, 2),
            "mean_azimuth_difference": round(sum(azd) / 4, 2),
            "closure_in": round(closure, 3),
            "closure_mm": round(closure * IN * 1000, 1),
            "corner_offsets_in": [[round(o[0], 3), round(o[1], 3)] for o in offsets],
            "worst_corner_in": round(max(math.hypot(*o) for o in offsets), 3),
            "worst_corner_mm": round(max(math.hypot(*o) for o in offsets) * IN * 1000, 1),
            "spread_in": round(max(sq["lengths"].values()) - min(sq["lengths"].values()), 2),
        })
        result["squares"][key] = entry
        print("%-8s mean %.2f in (Petrie %.1f), mean difference %.2f (Petrie %.2f), azimuth %.1f'' (Petrie %d''), "
              "closure %.2f in, worst corner %.2f in = %.0f mm"
              % (key, mean, sq["petrie_mean_length"], entry["mean_length_difference"], sq["petrie_mean_difference"], mean_az,
                 sq["petrie_mean_azimuth"], closure, entry["worst_corner_in"], entry["worst_corner_mm"]))
    json.dump(result, open(out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1])
