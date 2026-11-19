# SPDX-License-Identifier: GPL-3.0-or-later
"""Flywheel Forge, generation 2: answers gen 1's gate (G5 still dark, G7 motion too faint).
Usage: python gen0.py OUT_DIR ADDON_SOURCE_DIR
"""
import bpy  # noqa: F401
import math
import os
import sys

OUT, ADDON = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, 240
scene.render.fps = 24


def material(name, color, metallic, roughness, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if emission:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = 3.0
    return m


# G5 fix (2 of 2): a fully metallic surface in X_ITE with no environment map only shows light-source highlights,
# so the brass read black. Lower metallic, a little rougher: it keeps its colour under direct light.
brass = material("Brass", (0.78, 0.57, 0.24), 0.7, 0.38)
walnut = material("Walnut", (0.20, 0.10, 0.05), 0.0, 0.6)
sun_mat = material("Sun glow", (1.0, 0.7, 0.2), 0.0, 0.5, emission=(1.0, 0.62, 0.18))
planet_colours = [(0.55, 0.52, 0.5), (0.85, 0.65, 0.35), (0.20, 0.42, 0.75), (0.75, 0.30, 0.18)]

bpy.ops.mesh.primitive_cylinder_add(radius=3.2, depth=0.25, location=(0, 0, -0.125), vertices=96)
base = bpy.context.active_object
base.name = "Walnut base"
base.data.materials.append(walnut)
bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=1.6, location=(0, 0, 0.8), vertices=24)
spindle = bpy.context.active_object
spindle.name = "Brass spindle"
spindle.data.materials.append(brass)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.45, location=(0, 0, 1.7), segments=48, ring_count=24)
sun = bpy.context.active_object
sun.name = "The Sun"
sun.data.materials.append(sun_mat)

for i, (radius, size, period) in enumerate(((0.9, 0.10, 60), (1.45, 0.16, 110), (2.05, 0.18, 170), (2.7, 0.14, 240))):
    bpy.ops.object.empty_add(location=(0, 0, 1.0 + 0.12 * i))
    pivot = bpy.context.active_object
    pivot.name = "Orbit %d" % (i + 1)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(radius / 2, 0, 1.0 + 0.12 * i))
    arm = bpy.context.active_object
    arm.name = "Arm %d" % (i + 1)
    arm.scale = (radius, 0.05, 0.03)
    arm.data.materials.append(brass)
    arm.parent = pivot
    arm.location = (radius / 2, 0, 0)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=size, location=(0, 0, 0), segments=32, ring_count=16)
    planet = bpy.context.active_object
    planet.name = "Planet %d" % (i + 1)
    planet.data.materials.append(material("Planet %d paint" % (i + 1), planet_colours[i], 0.0, 0.45))
    planet.parent = pivot
    planet.location = (radius, 0, 0.18)
    pivot.rotation_euler = (0, 0, 0)
    pivot.keyframe_insert("rotation_euler", frame=1)
    pivot.rotation_euler = (0, 0, 2 * math.pi * 240 / period)
    pivot.keyframe_insert("rotation_euler", frame=240)
    for fc in pivot.animation_data.action.fcurves if hasattr(pivot.animation_data.action, "fcurves") else []:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"

light = bpy.data.lights.new("Sun lamp", "POINT")
light.energy = 400
# G5 fix: the lamp sits inside the Sun sphere and the exporter keeps Blender's cast-shadow flag
# (PointLight shadows="true"), so X_ITE shadowed the whole orrery with the Sun's own mesh.
light.use_shadow = False
lamp = bpy.data.objects.new("Sun lamp", light)
lamp.location = (0, 0, 1.7)
scene.collection.objects.link(lamp)

# G5 fix (1 of 2): one 400 W lamp exports as intensity 1 with radius 40, too little for a 6 m model.
# Add a warm key and a cool rim sun (DirectionalLight in X3D).
for name, energy, colour, rot in (("Key sun", 3.0, (1.0, 0.9, 0.78), (math.radians(50), 0, math.radians(30))),
                                  ("Rim sun", 1.6, (0.62, 0.75, 1.0), (math.radians(-60), 0, math.radians(200)))):
    d = bpy.data.lights.new(name, "SUN")
    d.energy, d.color, d.use_shadow = energy, colour, False
    o = bpy.data.objects.new(name, d)
    o.rotation_euler = rot
    scene.collection.objects.link(o)

cam_data = bpy.data.cameras.new("Camera")
cam = bpy.data.objects.new("Camera", cam_data)
scene.collection.objects.link(cam)
cam.location = (7.5, -7.5, 5.0)
cam.rotation_euler = (math.radians(65), 0, math.radians(45))
scene.camera = cam

sys.path.insert(0, os.path.join(OUT, "_addon"))
os.makedirs(os.path.join(OUT, "_addon"), exist_ok=True)
link = os.path.join(OUT, "_addon", "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(ADDON, link, target_is_directory=True)
import importlib  # noqa: E402
try:
    importlib.import_module("io_scene_x3d").register()
except Exception:
    pass
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "orrery.blend"))
print(bpy.ops.export_scene.x3d(filepath=os.path.join(OUT, "orrery.x3d"), x3d_version="X3D40", use_selection=False,
                                     use_animation=True))  # G7 fix: animation export is off unless set
