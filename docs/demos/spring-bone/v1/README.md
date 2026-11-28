# Spring Bone Lab v1 (Demo 87)

Spring bones as plain X3D 4.0. Four rigs in one file (`spring-lab.x3d`), moved by two PROTOs, `SpringBoneChain` and `SpringBoneCollider` (`x3d/SpringBone.x3d`), each running its own Script in X_ITE. Nothing here needs a plugin: any X3D browser with Scripting runs it.

| Rig | Bones | What it shows |
|---|---|---|
| Ponytail on an HAnim 2.0 figure (Ada, our own mannequin) | 7 custom `HAnimJoint`s under `skullbase` | FORCE model, 1.6 Hz at damping ratio 0.3; head sphere and shoulder capsule colliders; angle limit 60°; drag the figure |
| Fox tail | 8 `Transform`s | stiffness curve from root to tip; a ground plane collider; trot roll; drag the fox |
| Bead fringe | 7 roots, 42 bones, one chain | many roots in one PROTO; gusting wind; drag the glass ball through it |
| Antenna tree | 1 root, 2 branches | `branchMode MEAN`: a bone with two children turns to their mean direction |

The side panel tunes the selected rig live through SAI: frequency, damping ratio, stiffness, inert, stretch, angle limit, gravity, wind, weight, the spring model (FORCE or POSITION), the time mode (FIXED or VARIABLE) and the step rate. "What the solver reports" shows the exact per-step damping and elasticity the tuning maps give, and the PROTO's own `equivalentFrequency` and `equivalentDampingRatio` outputs.

## Measured

| Check | Result | Behind it |
|---|---|---|
| XSD | `spring-lab.x3d` (sha256 `0318006f6053`) and `x3d/SpringBone.x3d`: 0 errors | x3d-4.0.xsd via x3d_mcp `2943b78` `validate_xml`, lxml 6.1.3 |
| Runs | all four chains step (8, 9, 49 and 12 particles); 0 page errors; colliders report contact | X_ITE 16.8.1, Chromium 158.0.8127.36 headless, SwiftShader (`shot.png`) |
| POSITION damping floor, live | asked 2 Hz at ζ 0.05 in POSITION: the PROTO reports 2.01 Hz at ζ 0.105 | same rig; matches the Node witness W2b (floor 0.104 at 60 Hz) |
| Solver | 14 witness rows against closed-form damped-spring answers, 11 with planted controls that fail | x3d.loom `x3d.springbone`, Node 22.23.5 |

Grades: the four rows above are **Confirmed** on that rig. Looks on a real GPU, phones and other X3D browsers are **not measured**. SwiftShader draws about 25 frames a second here, so `droppedTime` grows in the headless shot; on a normal GPU it stays at 0 (Likely, not measured).

## Where the parts live

- Behaviour spec, JS solver, witnesses, PROTO builder and this scene's generator (`tools/make_demo.mjs`): x3d.loom `x3d.springbone/`.
- Blender: x3d-blender-io imports and exports the PROTOs and bakes a chain to keys (Python twin of the solver).
- Unity: x3d.unity_io `X3DSpringBone` (C# twin) and an editor mapping from a spring-bone component people already own.
- All three share one golden trace: the same 400 jittered frames give the same state hashes.

Credit and takedown: `NOTICE.md`.
