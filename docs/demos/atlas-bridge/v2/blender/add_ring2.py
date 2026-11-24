#!/usr/bin/env python3
"""add_ring2: a second ring of 12 cameras (Cam12..Cam23) for what the eye-height ring cannot see: the vault, the floor,
the tops of furniture and the low faces under the table. Cam00..Cam11 are untouched.
  python add_ring2.py <in.blend> <out.blend>"""
import math, sys
import bpy
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=sys.argv[1])
sc = bpy.context.scene
src = bpy.data.objects["Cam00"].data
shots = []
for k in range(4):                                  # high in each corner, looking down across the room
    sx, sy = (1, -1)[k & 1], (1, -1)[k >> 1]
    shots.append(((3.9 * sx, 2.5 * sy, 2.9), (-1.2 * sx, -0.6 * sy, 0.5)))
for k in range(4):                                  # from near the middle, tilted up into the vault and the wall heads
    a = math.pi / 4 + k * math.pi / 2
    shots.append(((-1.4 * math.cos(a), -0.9 * math.sin(a), 1.3), (3.2 * math.cos(a), 2.4 * math.sin(a), 4.3)))
for k in range(4):                                  # low, looking along the floor and under the table
    a = k * math.pi / 2 + 0.35
    shots.append(((3.4 * math.cos(a), 2.1 * math.sin(a), 0.55), (-2.0 * math.cos(a), -1.2 * math.sin(a), 0.5)))
for i, (pos, tgt) in enumerate(shots, start=12):
    cd = src.copy(); cd.name = f"Cam{i:02d}"
    co = bpy.data.objects.new(f"Cam{i:02d}", cd); sc.collection.objects.link(co)
    pos, tgt = Vector(pos), Vector(tgt)
    co.location = pos; co.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[2])
print("cameras", len([o for o in sc.objects if o.type == "CAMERA"]))
