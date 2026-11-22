# Wire Lab v2: rewire a living X3D scene

Three small X3D 4.0 scenes whose behaviour is a graph you can rewire in the browser. The picture is drawn by X_ITE
16.7.1; the graph editor, the Python script view and the X3D text are three views of the same data.

v2 is v1 with one change: a long chain of nodes now wraps into rows of five, so the graph stays readable when you
build the counter out to four bits or the tail out to four beads (in v1 it shrank). v1 is kept unchanged beside it.

| World | What it teaches | Nodes it uses |
|---|---|---|
| `?world=door` The Door | a ROUTE joins two fields of one type; a click is a time; converters exist for a reason | TouchSensor, TimeSensor, PositionInterpolator, then TimeTrigger, ColorInterpolator, OrientationInterpolator |
| `?world=counter` The Ripple Counter | events can compute: a binary counter from two node types and no script | BooleanToggle, BooleanFilter, then TimeSensor and BooleanTrigger |
| `?world=snake` The Follower | an input-and-output field also sends; chained dampers look alive without physics | PositionDamper, PositionInterpolator, then PlaneSensor |

## How it is built

* `build/build_worlds.py` writes each world with the scripting methods of the Blender add-on
  (`x3d-blender-io/source/behaviour_graph.py`): a plain scene plus a short function that builds the graph. The page shows
  that function. Each woven file is checked against the X3D 4.0 schema and read back with no graph difference.
* `catalogue.json` is the add-on's node catalogue (generated from the X3D Unified Object Model 4.0: 45 behaviour node
  types, 32 scene target types) as JSON.
* `wirelab.js` is the same wiring rule in JavaScript. `build/route-cases.json` holds 55 cases it must judge exactly as the
  Python does.
* X_ITE is not copied here; the page loads the copy already in this repository under
  `blenderizer-nexus/v1/observatory/vendor/x_ite/` (MIT, see its LICENSE.md).

## What was checked (22 Nov 2026)

| Check | Tool | Result |
|---|---|---|
| Wiring rule against the shared cases, starter graphs, script view, a solved challenge | `node build/test_core.mjs` | 73 of 73 |
| The page with real mouse events: click opens the door; a dragged wire becomes a ROUTE; a wrong wire is refused with a way forward; hover opens the door after adding a TimeTrigger; the counter counts 0 to 15, wraps, counts down, and runs from a clock; the follower's beads follow, a real drag moves the head, the beacon tracks the last damper | `node build/test_page.cjs` (headless Chromium, SwiftShader, X_ITE 16.7.1) | 30 of 30, 0 page errors; `build/page-test-receipt.json` |
| The three worlds through Blender 5.3.0 and back (graph import on) | x3d-blender-io `tests/test_behaviour_nodes_bpy.py` | 0 node, field or ROUTE differences |

Not checked: a real GPU, a phone, touch input, any browser but headless Chromium, and any X3D browser but X_ITE. The
screenshots in `shots/` are the page test's own, halved to 1500 x 1000.

## Known gaps

* Editing a field reloads the whole scene, so running timers restart.
* Field values are typed as X3D text; there is no curve editor.
* The graph editor has no undo; "Start over" restores the starter graph. Work is kept in the browser's local storage.
* After a trip through Blender the counter's lamps start lit, because the add-on's importer does not read `visible` on a
  Transform (found by this work, not fixed here).

Licence: GPL-3.0-or-later, with the add-on. No third-party data or imagery.
