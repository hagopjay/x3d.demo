# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 65 v4: re-render the path-traced poster from plateau.blend with the stage's hero camera.
usage: python hero_still.py plateau.blend OUT.png [--preview] [--exposure E] [--transform NAME] [--look NAME]"""
import math, sys, json, os
import bpy
from mathutils import Vector
a = sys.argv
blend, out = a[1], a[2]
opt = lambda k, d: a[a.index(k) + 1] if k in a else d
bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
cam = bpy.data.objects["Hero"]
cam.location = (430.0, -1090.0, 22.0)                       # the stage's VP_hero: X3D (430, 22, 1090)
target = Vector((-330.0, -380.0, 86.0))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.sensor_fit = "VERTICAL"; cam.data.angle = math.radians(45.0)     # X3D fieldOfView 0.7854 across the smaller side
world = scene.world.node_tree
world.nodes["Background"].inputs["Strength"].default_value = float(opt("--sky", 0.16))
for n in world.nodes:
    if n.type == "MIX":
        n.inputs["B"].default_value = (1.0, 0.80, 0.62, 1.0)  # the bake's dust filter on the sky light
    if n.type == "TEX_SKY":
        n.sun_disc = False
# the camera sees the same sky gradient as the X3D Background (display colours); the Nishita sky still lights the scene
SKY = [(0.0, (0.16, 0.30, 0.56)), (1.05, (0.36, 0.50, 0.72)), (1.42, (0.80, 0.70, 0.66)), (1.5708, (0.99, 0.76, 0.52))]
lin = lambda c: tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)
geo = world.nodes.new("ShaderNodeNewGeometry")
sep = world.nodes.new("ShaderNodeSeparateXYZ"); world.links.new(geo.outputs["Incoming"], sep.inputs["Vector"])
ac = world.nodes.new("ShaderNodeMath"); ac.operation = "ARCCOSINE"; world.links.new(sep.outputs["Z"], ac.inputs[0])
# for a camera ray "Incoming" points back at the camera, so the zenith angle of the view is pi - acos(z)
sub = world.nodes.new("ShaderNodeMath"); sub.operation = "SUBTRACT"; sub.inputs[0].default_value = math.pi; world.links.new(ac.outputs[0], sub.inputs[1])
div = world.nodes.new("ShaderNodeMath"); div.operation = "DIVIDE"; div.inputs[1].default_value = math.pi / 2; world.links.new(sub.outputs[0], div.inputs[0])
ramp = world.nodes.new("ShaderNodeValToRGB"); world.links.new(div.outputs[0], ramp.inputs["Fac"])
els = ramp.color_ramp.elements
els[0].position, els[0].color = 0.0, (*lin(SKY[0][1]), 1); els[1].position, els[1].color = 1.0, (*lin(SKY[3][1]), 1)
for ang, col in SKY[1:3]:
    e = els.new(ang / (math.pi / 2)); e.color = (*lin(col), 1)
cam_bg = world.nodes.new("ShaderNodeBackground"); world.links.new(ramp.outputs["Color"], cam_bg.inputs["Color"])
lp = world.nodes.new("ShaderNodeLightPath"); mix = world.nodes.new("ShaderNodeMixShader")
outn = [n for n in world.nodes if n.type == "OUTPUT_WORLD"][0]
world.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"]); world.links.new(world.nodes["Background"].outputs[0], mix.inputs[1]); world.links.new(cam_bg.outputs[0], mix.inputs[2])
world.links.new(mix.outputs[0], outn.inputs["Surface"])
EXPOSURE = float(opt("--exposure", 0.0))
cam_bg.inputs["Strength"].default_value = 2.0 ** (-EXPOSURE)            # so the backdrop lands on its display colour after exposure
scene.view_settings.view_transform = opt("--transform", "Standard")
try:
    scene.view_settings.look = opt("--look", "None")
except Exception as exc:
    print("look:", exc)
scene.view_settings.exposure = EXPOSURE
prev = "--preview" in a
scene.render.resolution_x, scene.render.resolution_y = (960, 540) if prev else (1920, 1080)
scene.cycles.samples = 24 if prev else 192
scene.cycles.use_denoising = True
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
json.dump(dict(camera=list(cam.location), target=list(target), fov_deg=45, samples=scene.cycles.samples, view_transform=scene.view_settings.view_transform,
               look=scene.view_settings.look, exposure_stops=scene.view_settings.exposure, size=[scene.render.resolution_x, scene.render.resolution_y]),
          open(os.path.splitext(out)[0] + ".json", "w"), indent=1)
