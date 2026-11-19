# SPDX-License-Identifier: GPL-3.0-or-later
"""Cycles reference of the source .blend at a frame (same settings as roundtrip.py). python ref.py BLEND OUT_PNG FRAME"""
import bpy, os, sys
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(sys.argv[1]))
s = bpy.context.scene
s.frame_set(int(sys.argv[3]))
s.render.engine = "CYCLES"
s.cycles.device, s.cycles.samples, s.cycles.use_denoising = "CPU", 96, True
s.render.resolution_x, s.render.resolution_y, s.render.resolution_percentage = 960, 540, 100
s.view_settings.view_transform = "Standard"
s.world = bpy.data.worlds.new("Black")
s.world.use_nodes = True
s.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
s.render.threads_mode, s.render.threads = "FIXED", 2
s.render.filepath = os.path.abspath(sys.argv[2])
bpy.ops.render.render(write_still=True)
