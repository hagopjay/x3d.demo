# SPDX-License-Identifier: GPL-3.0-or-later
"""Render a generation's .blend in Cycles at frame 1 from its camera (the G8 reference). python cycles_ref.py GEN_DIR"""
import bpy, os, sys
gen = os.path.abspath(sys.argv[1])
bpy.ops.wm.open_mainfile(filepath=os.path.join(gen, "orrery.blend"))
s = bpy.context.scene
s.frame_set(1)
s.render.engine = "CYCLES"
s.cycles.device, s.cycles.samples, s.cycles.use_denoising = "CPU", 96, True
s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = 960, 540, 100
s.view_settings.view_transform = "Standard"
s.render.film_transparent = False
# black world, as in the X3D (which has no Background). Gate defect found on gen 2: a new World uses nodes with a
# grey 0.05 background, so the first references had a grey backdrop the browser never draws.
s.world = bpy.data.worlds.new("Black")
s.world.use_nodes = True
s.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
s.render.threads_mode, s.render.threads = "FIXED", 2
s.render.filepath = os.path.join(gen, "cycles.png")
bpy.ops.render.render(write_still=True)
