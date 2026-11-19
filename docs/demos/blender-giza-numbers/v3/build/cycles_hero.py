# SPDX-License-Identifier: GPL-3.0-or-later
"""Cycles hero still of the round-tripped Observatory scene: golden-hour sky, gold pi ring as glowing tubes.
Usage: python cycles_hero.py BLEND OUT_PNG CAMERA [samples] [w h]"""
import bpy, sys, math, os
blend, out, camname = sys.argv[1:4]
samples = int(sys.argv[4]) if len(sys.argv) > 4 else 64
W, H = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (1600, 900)
bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = samples; sc.cycles.use_denoising = True
sc.cycles.seed = 7; sc.render.resolution_x, sc.render.resolution_y = W, H; sc.render.film_transparent = False
sc.view_settings.view_transform = "AgX"
for look in ("AgX - Punchy", "Punchy", "AgX - High Contrast"):
    try: sc.view_settings.look = look; break
    except Exception: pass
# world: Nishita-style sky at golden hour
w = bpy.data.worlds.new("Golden hour"); sc.world = w; w.use_nodes = True
nt = w.node_tree; nt.nodes.clear()
sky = nt.nodes.new("ShaderNodeTexSky")
for t in ("MULTIPLE_SCATTERING", "NISHITA", "HOSEK_WILKIE"):
    try: sky.sky_type = t; break
    except Exception: pass
try: sky.sun_elevation, sky.sun_rotation = math.radians(6), math.radians(250)
except Exception: pass
bg = nt.nodes.new("ShaderNodeBackground"); bg.inputs[1].default_value = 0.22
o = nt.nodes.new("ShaderNodeOutputWorld"); nt.links.new(sky.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], o.inputs[0])
# a warm low sun to match
for ob in [o for o in bpy.data.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(ob)
ld = bpy.data.lights.new("Low sun", "SUN"); ld.energy = 9.0; ld.color = (1.0, 0.58, 0.30); ld.angle = math.radians(1.5)
lo = bpy.data.objects.new("Low sun", ld); sc.collection.objects.link(lo)
lo.rotation_euler = (math.radians(84), 0, math.radians(245 - 180 + 90))
# give line curves a glowing bevel so the overlays read in a path tracer; hide labels and survey clutter
glow = bpy.data.materials.new("Gold glow"); glow.use_nodes = True
p = glow.node_tree.nodes["Principled BSDF"]; p.inputs["Base Color"].default_value = (1, .62, .16, 1)
p.inputs["Emission Color"].default_value = (1, .55, .12, 1); p.inputs["Emission Strength"].default_value = 6
cyan = glow.copy(); cyan.name = "Cyan glow"; q = cyan.node_tree.nodes["Principled BSDF"]
q.inputs["Base Color"].default_value = (.2, .8, 1, 1); q.inputs["Emission Color"].default_value = (.15, .75, 1, 1)
keep = ("PiCircle", "PiSquare", "OverlayPi")
for ob in bpy.data.objects:
    if ob.type == "FONT":
        ob.hide_render = True
    elif ob.type == "CURVE":
        nm = ob.name + " " + (ob.parent.name if ob.parent else "")
        if any(k in nm for k in keep):
            ob.data.bevel_depth = 0.9; ob.data.bevel_resolution = 2
            ob.data.materials.clear(); ob.data.materials.append(cyan if "Square" in nm else glow)
        else:
            ob.hide_render = True
# the round trip dropped TextureTransform scale 28 28: restore it here, by hand, and say so in the receipt
for m in bpy.data.materials:
    if m.node_tree and any(n.type == "TEX_IMAGE" for n in m.node_tree.nodes):
        nt2 = m.node_tree; tc = nt2.nodes.new("ShaderNodeTexCoord"); mp = nt2.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (28, 28, 1); nt2.links.new(tc.outputs["UV"], mp.inputs["Vector"])
        for n in nt2.nodes:
            if n.type == "TEX_IMAGE": nt2.links.new(mp.outputs[0], n.inputs["Vector"])
from mathutils import Vector
if camname.startswith("@"):
    loc, at, lens = {"@low": ((330, -560, 9), (0, 0, 62), 34), "@ring": ((420, -300, 140), (0, 0, 20), 30)}[camname]
    cd = bpy.data.cameras.new("hero"); cam = bpy.data.objects.new("hero", cd); sc.collection.objects.link(cam)
    cam.location = loc; cam.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat("-Z", "Y").to_euler(); cd.lens = lens
else:
    cam = bpy.data.objects.get(camname)
sc.camera = cam
cam.data.clip_end = 6000
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("wrote", out, "curves", sum(1 for o in bpy.data.objects if o.type == "CURVE" and not o.hide_render))
