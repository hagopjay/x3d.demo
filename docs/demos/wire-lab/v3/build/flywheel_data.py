# SPDX-License-Identifier: GPL-3.0-or-later
"""Writes flywheel.json: the measured numbers of the lane that built this editor, one row per turn of the development loop.

    python build/flywheel_data.py

The table below is the only source. Every row names what measured it and where the measurement is written up. The page draws
this file and adds nothing: no number is computed, estimated or rounded in the page.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
GH = "https://github.com/hagopjay/{repo}/pull/{n}"


def pr(repo, *numbers):
    return [{"label": f"{repo} #{n}", "url": GH.format(repo=repo, n=n)} for n in numbers]


# stage, short number, the claim in full, instrument, sources, grade, caveat
ROWS = [
    ("judge", "14 of 14",
     "the simulator agrees with X_ITE 16.8.1 on 14 of 14 event streams of the timer probe (3 disagreed before)",
     "tools/behaviour_sim_judge", pr("x3d-blender-io", 89), "Confirmed", ""),
    ("fuzz", "1,055 to 0",
     "2,000 hostile random graphs: 1,055 raised before, 0 after; 271 delivered NaN or a wrong shape before, 0 after",
     "tools/behaviour_fuzz.py --hostile --seed 1", pr("x3d-blender-io", 92), "Confirmed", ""),
    ("speed", "30.4 to 4.45 ms",
     "Play, 1,000 interpolators on one timer: 30.4 ms per step before, 4.45 ms after",
     "tools/behaviour_bench.py, bpy 5.3.0, shared 4-core Xeon", pr("x3d-blender-io", 92), "Confirmed", ""),
    ("tests", "1,195 pass",
     "1,195 unit tests pass, 35 skipped",
     "unittest, bpy 5.3.0 wheel", pr("x3d-blender-io", 92), "Confirmed", ""),
    ("self-coding", "87 of 90",
     "a search wrote correct behaviour graphs for 87 of 90 unseen tasks from one demonstration (the simulator's verdict; synthetic tasks by the same author)",
     "x3d.loom selfcode/run.py", pr("x3d.loom", 208, 212), "Confirmed", "synthetic tasks, same author"),
    ("fold back", "349 to 356",
     "failure modes 349 to 356 written into the Loom",
     "count of rows in LOOM-v1.md", pr("x3d.loom", 211, 212), "Confirmed", ""),
    ("by eye", "1 world",
     "the owner opened the door with a click in Blender 5.3 on a Mac (one world; the rest of the editor's look is not yet judged by eye)",
     "a person", [{"label": "26 Nov 2026", "url": None}], "Confirmed", "for that one world only"),
]
LOOP = ["specify", "agents implement", "fuzz", "judge against X_ITE", "fold back into the Loom"]
data = {"title": "How this editor is built: one turn of the flywheel", "loop": LOOP,
        "turns_without_a_person": 0,
        "rows": [{"stage": s, "number": n, "claim": c, "instrument": i, "sources": src, "grade": g, "caveat": cv}
                 for s, n, c, i, src, g, cv in ROWS]}
(HERE / "flywheel.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
print("flywheel.json:", len(ROWS), "rows")
