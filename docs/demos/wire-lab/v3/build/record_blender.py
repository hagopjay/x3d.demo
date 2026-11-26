# SPDX-License-Identifier: GPL-3.0-or-later
"""Records what the Blender add-on's own event simulator does with each Wire Lab world.

    python build/record_blender.py            # uses ../x3d-blender-io (or $X3D_BLENDER_IO), ref $X3D_BLENDER_IO_REF (origin/main)

The add-on's `behaviour_graph` and `behaviour_sim` are read from a git ref (never the working tree, never written to) into a
temporary folder. Each world's woven .x3d is read back into a Behaviour graph, a fixed scripted stimulus is played through
`Simulation`, and every event the simulator sent is written down once per ROUTE that carries it (the same thing the page counts
for X_ITE: one field callback per event on the ROUTE's source field).

Output: worlds/<world>.blender-trace.json. It is a recording of the simulator, on the simulator's clock (steps of 1/60 s that
the script chose), so counts of continuous streams are a statement about those steps, not about any frame rate.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
REPO = HERE.parents[3]
# the add-on checkout: $X3D_BLENDER_IO, else ../x3d-blender-io next to this repo (or next to the folder holding its worktrees)
ROOT = Path(os.environ.get("X3D_BLENDER_IO") or next((c for c in (REPO.parent / "x3d-blender-io", REPO.parent.parent / "x3d-blender-io") if c.exists()), REPO.parent / "x3d-blender-io")).resolve()
REF = os.environ.get("X3D_BLENDER_IO_REF", "origin/main")
SRC = tempfile.mkdtemp(prefix="blender-io-src-")
for name in ("behaviour_graph.py", "behaviour_sim.py", "behaviour_catalogue.py"):
    text = subprocess.run(["git", "-C", str(ROOT), "show", f"{REF}:source/{name}"], check=True, capture_output=True, text=True).stdout
    Path(SRC, name).write_text(text, encoding="utf-8")
COMMIT = subprocess.run(["git", "-C", str(ROOT), "rev-parse", REF], check=True, capture_output=True, text=True).stdout.strip()
MANIFEST = subprocess.run(["git", "-C", str(ROOT), "show", f"{REF}:source/blender_manifest.toml"], check=True, capture_output=True, text=True).stdout
VERSION = next(line.split("=")[1].strip().strip('"') for line in MANIFEST.splitlines() if line.startswith("version"))
sys.path.insert(0, SRC)
import behaviour_graph as bg          # noqa: E402
from behaviour_sim import Simulation  # noqa: E402

DT = 1 / 60
# The stimulus of each world. "click" presses and releases the sensor at that time; "pointer" is where the page puts the real
# mouse on the X_ITE canvas (fractions of its width and height) to send the same click (found by the page test, build/test_page.cjs).
STIMULI = {
    "door": {"description": "one click on the red button at t = 1.0 s, then steps of 1/60 s until t = 5.0 s", "duration": 5.0,
             "actions": [{"t": 1.0, "do": "click", "node": "Click"}], "pointer": [0.28, 0.5]},
    "counter": {"description": "six clicks on the button at t = 1, 2, 3, 4, 5, 6 s, then steps of 1/60 s until t = 7.0 s", "duration": 7.0,
                "actions": [{"t": float(k), "do": "click", "node": "Press"} for k in range(1, 7)], "pointer": [0.5, 0.72]},
    "snake": {"description": "no pointer: the looping TimeSensor Clock drives the head; steps of 1/60 s for 4.0 s", "duration": 4.0,
              "actions": [], "pointer": None},
}


def compact(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(round(value, 2)) if abs(value) < 1e8 else f"{value:.2e}"
    if isinstance(value, (tuple, list)):
        return " ".join(compact(v) for v in value)
    return str(value)[:30]


def record(world_id):
    graph = bg.Behaviour.from_x3d((HERE / "worlds" / f"{world_id}.x3d").read_text(encoding="utf-8"))
    sim = Simulation(graph, log_size=200000)
    stimulus = STIMULI[world_id]
    routes = []
    for r in graph.routes:
        source = bg.resolve_field(graph.nodes[r.from_id].node_type, r.from_field, "out") if graph.nodes[r.from_id].role == bg.BEHAVIOUR else \
            bg.resolve_field(graph.nodes[r.from_id].node_type, r.from_field, "out")
        routes.append({"from": r.from_id, "ff": r.from_field, "to": r.to_id, "tf": r.to_field, "type": source[1], "canon": source[0]})
    sim.start(0.0)
    frames = round(stimulus["duration"] / DT)
    todo = {round(a["t"] / DT): a for a in stimulus["actions"]}
    for i in range(1, frames + 1):
        t = i * DT
        if i in todo:
            sim.click(todo[i]["node"], t)
        sim.step(t)
    events = []
    for (t, node, field, value) in sim.log:
        for k, r in enumerate(routes):
            if r["from"] == node and r["canon"] == field:
                events.append([round(t, 4), k, compact(value)])     # [time, index into "routes", compact value]
    counts = [sum(1 for e in events if e[1] == k) for k in range(len(routes))]
    return {"schema": "wire-lab.blender-trace/v1", "world": world_id, "recorded_by": "x3d-blender-io behaviour_sim.Simulation",
            "addon_version": VERSION, "addon_commit": COMMIT, "addon_ref": REF, "step_seconds": DT, "stimulus": stimulus,
            "not_simulated": list(sim.not_simulated), "dropped": dict(sim.dropped), "faults": list(sim.faults),
            "routes": [{k: v for k, v in r.items() if k != "canon"} for r in routes], "route_counts": counts,
            "event_fields": ["t", "route", "value"], "count": len(events), "log_truncated": len(sim.log) >= 200000, "events": events}


if __name__ == "__main__":
    for world in STIMULI:
        trace = record(world)
        (HERE / "worlds" / f"{world}.blender-trace.json").write_text(json.dumps(trace, separators=(",", ":")), encoding="utf-8")
        print(world, trace["count"], "events", trace["route_counts"], "not_simulated:", trace["not_simulated"], "faults:", trace["faults"], "dropped:", trace["dropped"])
    print("add-on", VERSION, COMMIT)
