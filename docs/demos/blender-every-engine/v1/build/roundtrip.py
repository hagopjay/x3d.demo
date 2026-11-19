# SPDX-License-Identifier: GPL-3.0-or-later
"""Re-import an exported file into an empty Blender and render it in Cycles exactly like the reference (frame 1, 96 spp,
OIDN, 960x540, Standard view, black world). Usage: python roundtrip.py IN_FILE OUT_PNG [FRAME]"""
import bpy, os, sys
src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
frame = int(sys.argv[3]) if len(sys.argv) > 3 else 1
bpy.ops.wm.read_factory_settings(use_empty=True)
ext = os.path.splitext(src)[1].lower()
if ext == ".glb":
    bpy.ops.import_scene.gltf(filepath=src, export_import_convert_lighting_mode=os.environ.get("GLTF_LIGHT_MODE", "SPEC"))
elif ext in (".usd", ".usdc", ".usda"):
    bpy.ops.wm.usd_import(filepath=src)
s = bpy.context.scene
cams = [o for o in s.objects if o.type == "CAMERA"]
s.camera = cams[0]
s.frame_start, s.frame_end = 1, 240
s.frame_set(frame)
s.render.engine = "CYCLES"
s.cycles.device, s.cycles.samples, s.cycles.use_denoising = "CPU", 96, True
s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = 960, 540, 100
s.view_settings.view_transform = "Standard"
s.world = bpy.data.worlds.new("Black")
s.world.use_nodes = True
s.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
s.render.threads_mode, s.render.threads = "FIXED", 2
if os.environ.get("RESTORE_FLAGS"):  # experiment: put back the two Blender-only flags the source .blend sets
    for o in s.objects:
        if o.type == "LIGHT":
            print("use_shadow was", o.name, o.data.use_shadow)
            o.data.use_shadow = False if o.data.type == "POINT" else o.data.use_shadow
        if o.name.replace("_", " ") == "The Sun":
            print("visible_diffuse was", o.visible_diffuse)
            o.visible_diffuse = False
s.render.filepath = out
print("ROUNDTRIP", src, "objects", len(s.objects), "lights", [(o.name, o.data.type, round(o.data.energy, 3)) for o in s.objects if o.type == "LIGHT"],
      "cams", len(cams), "actions", len(bpy.data.actions))
bpy.ops.render.render(write_still=True)
