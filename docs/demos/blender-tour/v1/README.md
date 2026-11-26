# A tour of Blender, through X3D eyes (v1)

Blender 5.3 driven by script in a real window, one feature area per stop, with the X3D add-on (x3d-blender-io main
699e497, add-on 2.7.8) asked at every stop what survives an export and what X_ITE 16.7.1 shows. Then eight procedural
demos (maths, physics, emergence, modelling, gameplay, and an X3D behaviour world) cut into a 45-second reel in
Blender's own Video Sequencer. Page: `index.html`.

## Checked

| What | Instrument | Result |
|---|---|---|
| Stops 1 to 4 ran | Blender 5.3.0, macOS arm64, a 1600 x 1000 window driven by `build/tour.py` | 0 errors; screenshots looked at |
| RigidBody import | `assets/rigidbody-tower.x3d`, imported by the add-on | 30 of 30 bodies at the file's heights (0.125 to 2.375 m) |
| Four renderers | EEVEE, Cycles (128 spp, Metal GPU), compositor, X_ITE (`build/xite_shot.cjs`, headless Chromium, SwiftShader) | EEVEE 2.25 s, Cycles 10.26 s on a second run (364 s on the first: kernel compilation) |
| Animation export | the add-on with `use_animation=True` | 1 TimeSensor, 3 PositionInterpolator, 2 OrientationInterpolator (drivers baked), 10 ROUTEs; 0 CoordinateInterpolator |
| The eight clips | `build/wild.py --clip`, EEVEE, 1920 x 1080, 150 frames | each 5.000 s; last and middle frames looked at |
| The reel | `build/reel.py`, Blender's Video Sequencer; ffprobe | 45.0 s, 1920 x 1080, 30 fps, H.264 + AAC; re-encoded here at CRF 25 (16.8 MB) |
| The X3D segment | `build/x3d_clip.py`: `tests/behaviour/demos/orrery` imported, stepped by `behaviour_play.Player`, a scripted press on Terra at 1.5 s | camera moved (0, -10.6, 3.6) to (1.92, -8.09, 3.03); 0 ROUTEs not applied |

## Not checked

- How any of it looks to a person; the screenshots were looked at by the agent that made them.
- Rendering on any machine but one Mac; X_ITE only under SwiftShader.
- The baked rigid-body fall as X3D: a background bake recorded no motion (0 of 31 bodies moved; the solver did not step
  with `frame_set` in background Blender), so no animated tower is shipped.
- Why X_ITE draws nothing for the hand-written `RigidBodyCollection` in `assets/rigidbody-tower.x3d`.

## Lessons kept in the scripts

- A final render reads Simulation Zones from their cache: step the frames in order first (`wild.py`, `render_clip`).
- Blender 5.x: the Simulation Output's first input is `Skip`; link zone sockets by name. Random Value has one output.
- An attribute stored on instances is read in the shader with Attribute type Instancer.
- Stretch To stretches along local +Y; Euler XYZ applies Z last, about the world's vertical axis.
- EEVEE refracts only with scene ray tracing and the material's ray-traced transmission both on.
- The Video Sequencer shows the workspace's `sequencer_scene` (5.x), and FFMPEG output needs `media_type = "VIDEO"`.

Front page card and changelog entry: left to the site's numbered page versions.
