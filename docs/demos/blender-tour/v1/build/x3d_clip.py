"""An X3D behaviour world played by the node editor's own Player, rendered frame by frame (background Blender).
    Blender -b --factory-startup --python x3d_clip.py -- --world orrery --click Terra@1.5"""
import json, math, sys, tempfile, addon_utils, bpy
from pathlib import Path
ARGS = sys.argv[sys.argv.index("--") + 1:]
WORLD = ARGS[ARGS.index("--world") + 1]
CLICK = ARGS[ARGS.index("--click") + 1] if "--click" in ARGS else None
SRC = Path(__import__("os").environ.get("X3D_IO_REPO", "x3d-blender-io")).expanduser()   # a checkout of x3d-blender-io
OUT = Path(__file__).resolve().parent / "wild" / f"x3d-{WORLD}"
OUT.mkdir(parents=True, exist_ok=True)
shelf = Path(tempfile.mkdtemp()); (shelf / "x3d_blender_io").symlink_to(SRC / "source", target_is_directory=True)
sys.path.insert(0, str(shelf)); addon_utils.enable("x3d_blender_io", default_set=True)
from x3d_blender_io import behaviour_play
bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable("x3d_blender_io", default_set=True)
scene = bpy.context.scene
path = SRC / "tests/behaviour/demos" / WORLD / f"{WORLD}.x3d"
print("IMPORT", bpy.ops.import_scene.x3d(filepath=str(path), use_behaviour_graph=True))
scene.camera = scene.camera or next(o for o in scene.objects if o.type == "CAMERA")   # bind the Viewpoint
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.eevee.taa_render_samples = 24
scene.view_settings.view_transform, scene.view_settings.look = "AgX", "AgX - Punchy"
player = behaviour_play.Player(scene, flash=False)
player.start(0.0)
target = None
if CLICK:
    name, at = CLICK.split("@")
    target = next((o for o in scene.objects if any(s.startswith(name) for s in player.sensors_for(o))), None)
    print("CLICK target", target and target.name, "at", at)
fps, seconds = 30, 5
facts = {"world": WORLD, "frames": fps * seconds, "click": CLICK, "camera_moves": []}
frames = OUT / "frames"
frames.mkdir(exist_ok=True)
for f in range(fps * seconds):
    now = f / fps
    if target is not None and abs(now - float(at)) < 0.5 / fps:
        player.press(target, now, target.matrix_world.translation.copy())
    if target is not None and abs(now - (float(at) + 0.1)) < 0.5 / fps:
        player.release(now)
    player.step(now)
    if f % 30 == 0:
        facts["camera_moves"].append([round(v, 2) for v in scene.camera.matrix_world.translation])
    scene.render.filepath = str(frames / f"f{f:04d}.png")
    bpy.ops.render.render(write_still=True)
player.stop()
facts["not_applied"] = list(player.not_applied)
(OUT / "notes.json").write_text(json.dumps(facts, indent=1))
print("DONE", facts)
