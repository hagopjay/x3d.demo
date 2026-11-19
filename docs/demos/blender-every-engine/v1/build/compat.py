# SPDX-License-Identifier: GPL-3.0-or-later
"""Second GLB with the glTF exporter's non-physical light units (export_import_convert_lighting_mode)."""
import bpy, os, sys
blend, out, mode = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), sys.argv[3]
bpy.ops.wm.open_mainfile(filepath=blend)
print(bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_cameras=True, export_lights=True,
      export_animations=True, export_animation_mode=(sys.argv[4] if len(sys.argv) > 4 else "ACTIONS"), export_apply=True,
      export_import_convert_lighting_mode=mode))
