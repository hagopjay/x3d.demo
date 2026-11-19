# SPDX-License-Identifier: GPL-3.0-or-later
"""Flywheel Forge, generation 7: gen 6 changed nothing (frames byte-identical: X_ITE's PhysicalMaterial ignores a light's ambientIntensity); calibrate instead.
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
# G8 fix: in Cycles the glowing Sun mesh is itself a light (emission 3) and brightened the walnut near the spindle;
# an X3D emissiveColor lights nothing. The lamp inside already carries the Sun's light, so the mesh stops lighting
# diffuse surfaces in Cycles: both renderers now get their light from the same lamps.
sun.visible_diffuse = False

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
    # beauty: a brass rod carries each planet up from its arm (gen 3 planets floated above the arm ends)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=0.18, vertices=12)
    rod = bpy.context.active_object
    rod.name = "Rod %d" % (i + 1)
    rod.data.materials.append(brass)
    rod.parent = pivot
    rod.location = (radius, 0, 0.09)
    # beauty: an engraved orbit ring inlaid in the walnut
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=0.012, major_segments=128, minor_segments=8,
                                     location=(0, 0, 0.004))
    ring = bpy.context.active_object
    ring.name = "Orbit ring %d" % (i + 1)
    ring.data.materials.append(brass)
    if i == 2:
        bpy.ops.mesh.primitive_torus_add(major_radius=size * 1.9, minor_radius=size * 0.35, major_segments=64,
                                         minor_segments=6)
        band = bpy.context.active_object
        band.name = "Ring band"
        band.scale = (1, 1, 0.12)
        band.data.materials.append(material("Ring band ivory", (0.86, 0.78, 0.6), 0.0, 0.5))
        band.parent = planet
        band.location = (0, 0, 0)
        band.rotation_euler = (math.radians(24), 0, 0)
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
# G8 fix: the exporter caps a Blender-made light at intensity 1 and writes no attenuation, so the browser lamp had
# no falloff and a fraction of Cycles' light. Give the lamp X3D's inverse-square attenuation and Cycles' radiant
# intensity (400 W / 4 pi = 31.8). Setting x3d_intensity tells the exporter the value is meant, so it is not capped.
light["x3d_energy_per_intensity"] = 4 * math.pi / 1.35   # gen 7 bounce calibration
light["x3d_intensity"] = light.energy / (4 * math.pi) * 1.35   # same bounce calibration (gen 7)
light["x3d_attenuation"] = [0.0, 0.0, 1.0]
lamp = bpy.data.objects.new("Sun lamp", light)
lamp.location = (0, 0, 1.7)
scene.collection.objects.link(lamp)

# G5 fix (1 of 2): one 400 W lamp exports as intensity 1 with radius 40, too little for a 6 m model.
# Add a warm key and a cool rim sun (DirectionalLight in X3D).
for name, energy, colour, rot in (("Key sun", 3.0, (1.0, 0.9, 0.78), (math.radians(50), 0, math.radians(30))),
                                  ("Rim sun", 1.6, (0.62, 0.75, 1.0), (math.radians(-60), 0, math.radians(200)))):
    d = bpy.data.lights.new(name, "SUN")
    d.energy, d.color, d.use_shadow = energy, colour, False
    d["x3d_energy_per_intensity"] = 1.0      # G8 fix: 1 W/m2 of Blender sun = X3D intensity 1, uncapped
    # G8 fix: Cycles adds light bounced off the walnut and brass; X3D has no bounce. Gen 6 tried each sun's
    # ambientIntensity: X_ITE 16.7.1 ignores it under PhysicalMaterial (byte-identical frames). Gen 5 measured the
    # Cycles frame 1.35x brighter on average, so the browser suns get that factor (Blender's stay as they are).
    BOUNCE = 1.35
    # the exporter writes energy / x3d_energy_per_intensity (x3d_intensity only marks the value as meant), so the
    # factor goes into the divisor: a first try that set x3d_intensity alone exported 3.0 unchanged
    d["x3d_energy_per_intensity"] = 1.0 / BOUNCE
    d["x3d_intensity"] = energy * BOUNCE
    o = bpy.data.objects.new(name, d)
    o.rotation_euler = rot
    scene.collection.objects.link(o)

cam_data = bpy.data.cameras.new("Camera")
cam = bpy.data.objects.new("Camera", cam_data)
scene.collection.objects.link(cam)
cam.location = (5.4, -5.4, 3.4)    # beauty: closer, lower, the orrery fills the frame
cam.rotation_euler = (math.radians(70), 0, math.radians(45))   # framing fix: gen 4 cropped the Sun
cam_data.lens = 42
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
