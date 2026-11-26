# Wire Lab v3: the event flywheel

Wire Lab v2 (kept unchanged beside this folder) lets you rewire three small X3D worlds and see the graph, the Python script
and the X3D text as three views of one thing. v3 keeps all of that and adds four layers on top. Everything is on by default;
`H` hides the HUD, `F` switches between the editor and the flywheel view.

| World | `?world=` | Feedback cycle in the starter graph? | A cycle you can add with one click ("Close the loop") |
|---|---|---|---|
| The Door | `door` | none: Click, Timer, Slide, Door is a pipeline | 2 nodes and 3 wires (Timer.isActive, BooleanFilter, TimeTrigger, back into Timer.startTime): the timer restarts itself, one hoop of 3 stations |
| The Ripple Counter | `counter` | none: Press, Flip0, Carry0, Flip1 is a pipeline, and so is the counter with a clock (checked) | 1 wire (Flip1.toggle into Flip0.set_boolean): one hoop of 3 stations |
| The Follower | `snake` | none: Clock, Path, Head, two dampers is a chain | none offered |

So, honestly: **none of the three starter worlds contains a ROUTE cycle**. Their flywheel view is the open arc with the
caption "a pipeline, not yet a wheel". A hoop appears only when a visitor closes a loop (the button, or by hand).

## What v3 adds

1. **Real events ride the wires.** For every ROUTE the page puts a field callback on the ROUTE's source field
   (`node.addFieldCallback(key, field, fn)`, X_ITE 16.7.1). Each time X_ITE really calls it, one record is made (time, from,
   to, type, value). A packet leaves the source along that wire in the graph editor, coloured by field type, with a tail whose
   length follows its speed; the sending node glows and decays; a wire's thickness and count badge follow its count. A running
   TimeSensor's 60-per-second `fraction_changed` becomes a steady flow of packets, each standing for the events since the
   last one. Nothing is drawn unless a callback ran: a paused scene is a still picture, and there is no decorative traffic.
   Editing a wire reloads the scene (as in v2), removes the old callbacks and attaches new ones; counts start again at 0.
2. **A dense HUD** (Gobbler v6 look): odometers (events, per second, routes active, deepest cascade, most events at one X3D
   time), an event stream (time to ms, from.field to to.field, compact value, type chip; a continuous wire is one updating
   line with a rate "x57/s"), per-wire counts with a 5 s sparkline and a cut button, a node panel (live field values, events in
   and out; hover or click a node) and the field-type legend. "Deepest cascade" is computed as the largest group of events
   that share one X3D timestamp (`browser.getCurrentTime()`) and are joined by the wires that fired; "one timestamp" is the
   plain count of events sharing a stamp.
3. **The flywheel view.** The same graph again: every strongly connected component of the ROUTE graph (Tarjan; the simple
   cycles inside are listed, capped at 60) is a luminous hoop with its nodes as glass beads on the rim, the far side of the
   rim dimmer and thinner; feeds and outputs sit left and right; a graph with no cycle is one open arc. Canvas 2D with
   additive layered glow, drawn at devicePixelRatio. An edit in either view shows in the other (they draw one `Graph`).
4. **The development flywheel, with receipts** (`flywheel.json`, written by `build/flywheel_data.py` from one table): seven
   measured numbers of the lane that built this editor, each with its instrument, grade and link. The page adds no number.
   "Turns of this loop that ran without a person: 0."
5. **The Blender lane.** `build/record_blender.py` plays a fixed stimulus through the Blender add-on's own event simulator
   (`behaviour_sim.Simulation`, add-on 2.7.6, read from git ref `origin/main` of the add-on checkout, commit
   `3e3c1e8e2a0446cb22b08496ae63c4dfffc6ad0c`) and writes `worlds/<world>.blender-trace.json` (every event the simulator sent,
   once per ROUTE that carries it; the stimulus; the commit). The page replays that file on its own clock as a calm lilac twin
   of the live lane (ring-headed packets beside the live ones, an inner dashed hoop, a twin stream), and compares it with
   X_ITE: per ROUTE, events in the recording versus events X_ITE sent, and whether the order of first events per ROUTE is the
   same. "Run the same stimulus in X_ITE" reloads the scene and sends the recorded click(s) to the canvas as mouse events.
   This is a recording versus a live run on different clocks (1/60 s steps versus the browser's frames), so the counts of
   continuous streams differ with the frame rate; the page says so beside the table and claims no agreement it did not compute.

6. **The graph wires itself** (door and counter only). `data/door.trace.json` and `data/counter.trace.json` are copied unchanged
   from the self-coding lane's recorded searches (schema `x3d.selfcode.trace/1`: 62 and 40 candidate wirings, 65 and 44 simulator
   runs). "Watch the search wire it" plays the candidates in order as ghost wirings that flash in and dim out when the verdict is
   "ran", and locks the winner in bright on "match", with "candidate k of n, simulator runs so far r" and a scrubber. It is a
   recording, not a live search: no language model took part and the page runs no search and no simulator; the verdicts are
   those of the Blender add-on's simulator at the commit named in the file. "Load the winner into the editor" appears only when
   the winner's nodes and ROUTEs can be expressed with this page's catalogue and world (checked by dry-running them on a copy of
   the graph); both winners can. The recording holds the wiring only, no field values (keys, intervals), so a loaded door is
   wired but not tuned: after a real click its timer and interpolator events are counted, but the door does not move.

Also changed from v2: the three worlds' own look (`build/build_worlds.py`): a warm key light with a soft shadow, a cool fill, a
rim light and a soft spot pool instead of the headlight, a sky graded to the page colour and a darker, slightly metallic floor.
Where a ROUTE sets `visible` (the counter's lamps, the follower's beacon) the lamp carries a soft halo of nested transparent
unlit shells, so the halo shows exactly when real events say the lamp is lit. The door's lamp has no halo (nothing routes its
visibility). Nodes, wires and ROUTEs are unchanged from v2. Their nodes, wires and ROUTEs are identical to
v2 (checked by comparing the graph JSON); the Blender round trip of v2's files is therefore unchanged in what it carries.

## How it is built

* `index.html` page; `wirelab.js` the v2 wiring core plus `components` and `simpleCycles`; `flow.js` event accounting (no DOM);
  `fx.js` packets, glow and path geometry; `wheel.js` the flywheel layout and drawing; `flywheel.json`; `catalogue.json` (v2's).
* X_ITE is loaded from the copy already in the repository (`blenderizer-nexus/v1/observatory/vendor/x_ite/`). No other library,
  no CDN, no network call, no analytics.

## What was checked (26 Nov 2026)

| Check | Tool | Result |
|---|---|---|
| Wiring rule, starter graphs, script view, a solved challenge (v2's checks unchanged) plus cycle finding (pipeline, ring, self ROUTE, two rings, cap) and the event accounting arithmetic | `node build/test_core.mjs` | 91 of 91 |
| The page, real mouse events, headless Chromium with SwiftShader, X_ITE 16.7.1: v2's checks (the event tape check now reads the stream, same assertions) and v3's: 0 events and nothing drawn before a click; after a real click the counts equal the callbacks the test heard on its own listeners and the page's own log; an edit re-taps without double counting; the flywheel shows a hoop if and only if an independently computed cycle exists; H and F; an edit in one view is in the other; the Blender lane replays exactly the recording's count and its comparison column equals the page's callback log; the search replay shows exactly `candidates.length` steps, ends on the winner, shows the file's counts, and a loaded winner's counts equal independent callbacks; no page error and no console error | `node build/test_page.cjs` | 92 of 92 (receipt in `build/page-test-receipt.json`) |
| The recording | `python build/record_blender.py` | door 365 events, counter 33, snake 1,442; nothing unsimulated, no faults, nothing dropped |

Not checked: a real GPU or any frame rate (software rendering only), a phone, touch input, any browser but headless
Chromium, any X3D browser but X_ITE, Safari's backdrop blur, `prefers-reduced-motion` (implemented, not tested), the
add-on's own Play panel in Blender (the trace is the simulator, not Blender's UI), a recording of the snake's drag (no pointer
stimulus is recorded for it: the Clock drives it).

## Known gaps

* The recording is of the simulator on 1/60 s steps; X_ITE under software GL runs at a few frames per second, so continuous
  streams count differently (the door's 182 recorded fractions are about 30 live here). This is shown, not hidden.
* Editing a wire reloads the scene and starts the counts again; running timers restart.
* The 3D scene lights up only where a ROUTE already sets a field (lamp visibility and its halo); the button and door lamp are static emissive accents, not driven by events.
* The flywheel view labels shrink to the name when crowded; hover a bead for its type. Shadows on the key light render cleanly in the shots here (software GL), not checked on a real GPU.
* "Close the loop" is offered for the door and the counter only; the follower has no loop button.
* The development flywheel row "by eye" is Confirmed for one world only (the door, in Blender 5.3 on a Mac).

Licence: GPL-3.0-or-later, with the add-on. No third-party data or imagery.
