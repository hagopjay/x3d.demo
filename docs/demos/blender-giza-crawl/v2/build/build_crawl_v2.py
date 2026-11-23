# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2 (Demo 63): the v1 route, rebuilt with "Blenderizer" techniques. Procedural Cycles materials and
scene lights are baked into image textures (bakery.py), the night sky over Giza in 2560 BC comes from the Sky Machine's
star data (sky_cube.py), and x3d-blender-io exports one X3D 4.0 scene with the H-Anim explorer, the chase camera,
the textures and the viewpoints.

Zones and their style: plateau (moonlit night, real stars), passages and chambers (warm visitor lamps raking the
stone), Grand Gallery (corbels lit from the ramps), King's Chamber (polished granite, a cold beam down the southern
shaft), Osiris Shaft (a descent into the dark), Hall of Records (Authored: torch-lit hypostyle, gilt, painted script).

Usage: Blender -b --python build_crawl_v2.py -- OUT_DIR ADDON_SOURCE_DIR [--quick]
  --quick: 1/4 of the texels and samples (look-dev); the shipped build uses the defaults below.
Writes OUT_DIR/crawl.x3d (raw export), crawl.blend, tex/*.jpg, cache/*.npy, route.json, bake.json.
"""
import importlib
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, ADDON = os.path.abspath(argv[0]), os.path.abspath(argv[1])
QUICK = "--quick" in argv
# --profile=quick | local | g4. local = what this M3 can bake in about 15 min; g4 = the GPU-heavy final quality
# (BAKE_DEVICE=OPTIX on the leased G4: more texels, 4x samples, light at half resolution, gloss everywhere).
PROFILE = next((a.split("=", 1)[1] for a in argv if a.startswith("--profile=")), "quick" if QUICK else "local")
QUICK = PROFILE == "quick"
ONLY = next((a.split("=", 1)[1].split(",") for a in argv if a.startswith("--zones=")), None)
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
T_START = time.time()

import bakery  # noqa: E402
import geo  # noqa: E402
import hall  # noqa: E402
import mats  # noqa: E402
import osiris  # noqa: E402
import outdoor  # noqa: E402
import pyramid as PY  # noqa: E402
import rig as R  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

scene = bpy.context.scene
FPS = 8
scene.render.fps = FPS

# ---- zones ----------------------------------------------------------------------------------------------------------
PY.build()
OS = osiris.build()
HL = hall.build()
OX, OY, zA, zB, zC = osiris.OX, osiris.OY, osiris.zA, osiris.zB, osiris.zC
T0, T1 = hall.T0, hall.T1
HOLES = [(OX - 1.0, OY - 1.0, OX + 1.0, OY + 1.0), (T0.x - 1.5, T0.y - 1.5, T0.x + 1.5, T0.y + 1.5)]
OD = outdoor.build(HOLES)
VOID = mats.G("Muon void")
pv = VOID.bsdf((0.3, 0.8, 1.0), 0.5, emit=(0.2, 0.6, 0.9), emit_strength=0.5)
pv.inputs["Alpha"].default_value = 0.22
VOID.m.use_backface_culling = False
geo.block("Big Void (muons)", PY.KX - 1.3, PY.KY - 23, 58, PY.KX + 1.3, PY.KY + 7, 66, VOID.m,
          {"grade": "Documented by muon imaging, shape and position schematic", "what": "Big Void, at least 30 m long", "source": PY.SOURCES["muon"]})

# ---- the route: v1's legs, Osiris descents slowed and filmed from above -----------------------------------------------
E, JN, AT, GT, KF, KCF, KC_Y1 = PY.E, PY.JN, PY.AT, PY.GT, PY.KF, PY.KCF, PY.KC_Y1
PX, WT, WG, WB, BOT, HP1, SC = PY.PX, PY.WT, PY.WG, PY.WB, PY.BOT, PY.HP1, PY.SC
HX, HY, HZ = hall.HX, hall.HY, hall.HZ
dirA = PY.dirA
LEGS = []


def leg(mode, speed, to, cap, grade="Documented", face=None, cam=None):
    LEGS.append(dict(mode=mode, speed=speed, to=Vector(to), cap=cap, grade=grade, face=face, cam=cam))


START = E + Vector((0, 6.0, 0))
leg("walk", 1.2, E, "The entrance, 16.97 m up the north face, 7.29 m east of the axis. Overhead, the sky of 2560 BC")
leg("stoop", 0.8, JN, "Down the descending passage: 1.20 m high, 26.5 degrees")
leg("stoop", 0.75, AT, "Up the ascending passage, 39.3 m")
leg("walk", 1.1, GT - dirA * 0.5, "The Grand Gallery: seven corbelled courses, 8.6 m of roof over your head")
leg("climb", 0.5, KF, "The Great Step")
leg("crawl", 0.55, Vector((PX, GT.y - 8.4, KCF)), "Through the low passages and the antechamber")
leg("walk", 1.0, Vector((PX - 7.0, KC_Y1 - 3.0, KCF)), "The King's Chamber: 10.47 x 5.23 m of Aswan granite")
leg("look", 4.0, Vector((PX - 7.0, KC_Y1 - 3.0, KCF)), "The empty granite coffer. The cold beam is a stylised nod to the southern shaft, aimed near Alnitak's 44.7 degrees in 2560 BC", face=(-1, 0))
leg("cut", 0, WT + Vector((0, 0.3, 0)), "Fast-forward to the foot of the Grand Gallery and the well shaft", grade="Cut")
leg("climb", 0.6, WG, "Down the well shaft, a rough service shaft about 0.7 m square (path schematic)", grade="Documented, path schematic", face=(0, -1))
leg("climb", 0.8, WB + Vector((-0.6, 0, 0)), "Still descending, toward the bottom of the descending passage", grade="Documented, path schematic", face=(0, -1))
leg("stoop", 0.8, BOT, "The last 19 m of the descending passage, now below the bedrock surface")
leg("crawl", 0.55, HP1, "On hands and knees: the horizontal passage is about 0.9 m high")
leg("walk", 1.0, Vector((PX - 6.0, HP1.y - 4.2, SC[2])), "The Subterranean Chamber, 27 to 30 m under the pavement, never finished")
leg("look", 4.0, Vector((PX - 6.0, HP1.y - 4.2, SC[2])), "Rough-cut bedrock: the floor was never levelled", face=(-1, 0))
leg("cut", 0, Vector((OX + 1.5, OY - 3.0, 0.0)), "No known tunnel joins these places. Cut to Khafre's causeway, 490 m away", grade="Cut")
leg("walk", 1.0, Vector((OX + 0.0, OY - 1.0, 0.0)), "The mouth of the Osiris Shaft, under Khafre's causeway")
leg("climb", 0.32, Vector((OX, OY - 0.6, zA)), "Shaft A, 9.62 m down", grade="Documented, plan schematic", face=(0, -1), cam="down")
leg("walk", 1.0, Vector((OX + 6.0, OY - 0.6, zA)), "Level 1, Chamber A", grade="Documented, plan schematic")
leg("climb", 0.32, Vector((OX + 6.0, OY - 0.6, zB)), "Shaft B, 13.25 m down", grade="Documented, plan schematic", face=(0, -1), cam="down")
leg("walk", 1.0, Vector((OX + 9.0, OY - 0.6, zB)), "Level 2, Chamber B and its side chambers", grade="Documented, plan schematic")
leg("climb", 0.32, Vector((OX + 9.0, OY - 0.6, zC + 1.0)), "Shaft C, about 7.5 m, down to the water", grade="Documented, plan schematic", face=(0, -1), cam="down")
leg("walk", 0.8, Vector((OX + 9.0, OY - 3.6, zC + 1.0)), "Level 3: a water-filled trench round a rock-cut emplacement", grade="Documented, plan schematic")
leg("look", 4.0, Vector((OX + 9.0, OY - 3.6, zC + 1.0)), "The basalt sarcophagus, 228 x 108 cm", grade="Documented, plan schematic", face=(1, 1))
leg("cut", 0, T0, "Now the legend. Edgar Cayce's Hall of Records, under the Sphinx's right paw. Everything ahead is invented", grade="Cut")
leg("walk", 1.3, T1, "An imagined tunnel: no such passage is known", grade="Authored")
leg("walk", 1.2, Vector((HX + 12.0, HY, HZ)), "An imagined hall: size, columns, script and shrines are inventions", grade="Authored")
leg("kneel", 4.0, Vector((HX + 12.0, HY, HZ)), "Kneeling at an imagined archive. In the readings, records of a lost civilisation", grade="Authored", face=(1, 0))

# ---- timeline: one sample per frame (v1 code) -----------------------------------------------------------------------------
explorer, pb = R.build_figure(scene, "Explorer")
s_sign, r_sign = R.forward_sign(explorer, pb)
carrier = bpy.data.objects.new("Explorer path", None)
scene.collection.objects.link(carrier)
explorer.parent = carrier
BLEND_T = 0.7
samples = []
t, pos, heading, phase = 0.0, START.copy(), math.pi, 0.0
prev_mode = "walk"
chapters = []
dt = 1.0 / FPS


def heading_of(v, fallback):
    if Vector((v.x, v.y)).length < 1e-4:
        return fallback
    return math.atan2(v.y, v.x) - math.pi / 2


STRIDE = {"walk": 1.4, "stoop": 0.9, "crawl": 0.55, "climb": 0.6, "look": 1.0, "kneel": 1.0}
for i, L in enumerate(LEGS):
    chapters.append({"t": round(t, 2), "caption": L["cap"], "grade": L["grade"], "mode": L["mode"]})
    if L["mode"] == "cut":
        pos = L["to"].copy()
        samples.append(dict(t=t, pos=pos.copy(), h=heading, mode=prev_mode, phase=phase, leg=i, cut=True))
        continue
    if L["mode"] in ("look", "kneel"):
        dur = L["speed"]
        target_h = math.atan2(L["face"][1], L["face"][0]) - math.pi / 2 if L["face"] else heading
        n = max(1, int(round(dur * FPS)))
        h0 = heading
        while target_h - h0 > math.pi: target_h -= 2 * math.pi
        while target_h - h0 < -math.pi: target_h += 2 * math.pi
        for k in range(n):
            u = min(1.0, (k + 1) / (n * 0.4))
            heading = h0 + (target_h - h0) * u
            samples.append(dict(t=t, pos=pos.copy(), h=heading, mode=L["mode"], phase=phase, leg=i, look=math.sin(t * 0.9) * 0.5))
            t += dt
        prev_mode = L["mode"]
        continue
    a, b = pos.copy(), L["to"]
    dist = (b - a).length
    n = max(1, int(round(dist / L["speed"] * FPS)))
    target_h = (math.atan2(L["face"][1], L["face"][0]) - math.pi / 2) if L["face"] else heading_of(b - a, heading)
    h0 = heading
    while target_h - h0 > math.pi: target_h -= 2 * math.pi
    while target_h - h0 < -math.pi: target_h += 2 * math.pi
    for k in range(n):
        u = (k + 1) / n
        p = a + (b - a) * u
        heading = h0 + (target_h - h0) * min(1.0, (k + 1) / max(1, FPS * 0.6))
        phase += (dist / n) / STRIDE[L["mode"]]
        samples.append(dict(t=t, pos=p, h=heading, mode=L["mode"], phase=phase % 1.0, leg=i, k=k, n=n))
        t += dt
    pos = b.copy()
    prev_mode = L["mode"]
TOTAL = t
F_END = len(samples)
scene.frame_start, scene.frame_end = 1, F_END
modes = [s["mode"] for s in samples]
nb = int(BLEND_T * FPS)
for f, s in enumerate(samples):
    p = R.MODES[s["mode"]]
    if f > 0:
        for back in range(1, nb + 1):
            if f - back < 0:
                break
            if modes[f - back] != s["mode"]:
                p = R.blend(R.MODES[modes[f - back]], p, back / (nb + 1))
                break
    frame = f + 1
    carrier.location = s["pos"]
    carrier.rotation_euler = (0, 0, s["h"])
    carrier.keyframe_insert("location", frame=frame)
    carrier.keyframe_insert("rotation_euler", frame=frame)
    R.pose(pb, s_sign, r_sign, p, s["phase"], s.get("look", 0.0))
    R.key_pose(pb, frame)


# ---- cameras --------------------------------------------------------------------------------------------------------------
def look_quat(fwd, up_hint):
    """Camera quaternion looking along fwd with up as close to up_hint as possible (works straight down)."""
    f = fwd.normalized()
    r = f.cross(up_hint)
    if r.length < 1e-6:
        r = f.cross(Vector((0, 1, 0)))
    r.normalize()
    u = r.cross(f).normalized()
    m = Matrix((r, u, -f)).transposed()
    return m.to_quaternion()


chase = bpy.data.objects.new("Chase", bpy.data.cameras.new("Chase"))
chase.data.lens = 16
scene.collection.objects.link(chase)
chase.rotation_mode = "QUATERNION"
path_s = [0.0]
for f in range(1, F_END):
    jump = samples[f].get("cut") or (samples[f]["pos"] - samples[f - 1]["pos"]).length > 5
    path_s.append(0.0 if jump else path_s[-1] + (samples[f]["pos"] - samples[f - 1]["pos"]).length)
seg_start = [0] * F_END
for f in range(1, F_END):
    seg_start[f] = f if path_s[f] == 0.0 else seg_start[f - 1]
prevq = None
cam_pos = None
for f in range(F_END):
    s = samples[f]
    L = LEGS[s["leg"]]
    g = f
    while g > seg_start[f] and path_s[f] - path_s[g] < 3.0:
        g -= 1
    trail = samples[g]["pos"]
    hd = Vector((-math.sin(s["h"]), math.cos(s["h"]), 0))
    if (s["pos"] - trail).length < 0.6:
        trail = s["pos"] - hd * 1.8
    eye_h = {"crawl": 0.75, "stoop": 0.95, "climb": 1.2}.get(s["mode"], 1.45)
    want = trail + Vector((0, 0, eye_h))
    up_hint = Vector((0, 0, 1))
    if L.get("cam") == "down":
        # the Osiris descents: hang 2.6 m above the climber's head inside the shaft, look straight down past them into
        # the dark, and turn slowly (one third of a turn per shaft) so the walls wheel round
        u = s.get("k", 0) / max(1, s.get("n", 1))
        top_z = LEGS[s["leg"] - 1]["to"].z                      # floor of the chamber (or ground) the shaft opens from
        want = s["pos"] + Vector((0.35, 0.35, 4.2))
        want.z = min(want.z, top_z + 2.2)                       # stay under that chamber's ceiling
        target = s["pos"] + Vector((0, 0, -6.0))
        ang = 2.1 * u + s["leg"] * 0.9
        up_hint = Vector((math.cos(ang), math.sin(ang), 0))
    elif s["mode"] == "climb":
        side = Vector((math.cos(s["h"]), math.sin(s["h"]), 0))
        want = s["pos"] + side * 2.8 - hd * 0.9 + Vector((0, 0, 0.9))
    jump = s.get("cut") or (f > 0 and (s["pos"] - samples[f - 1]["pos"]).length > 5) or (f > 0 and LEGS[samples[f - 1]["leg"]].get("cam") != L.get("cam"))
    cam_pos = want if (cam_pos is None or jump) else cam_pos.lerp(want, 0.45)
    if L.get("cam") != "down":
        target = s["pos"] + Vector((0, 0, {"crawl": 0.45, "climb": 0.8}.get(s["mode"], 1.0))) + hd * (0.0 if s["mode"] == "climb" else 0.6)
    q = look_quat(target - cam_pos, up_hint)
    if prevq is not None and prevq.dot(q) < 0:
        q.negate()
    prevq = q
    chase.location = cam_pos
    chase.rotation_quaternion = q
    chase.keyframe_insert("location", frame=f + 1)
    chase.keyframe_insert("rotation_quaternion", frame=f + 1)


def fixed_cam(name, loc, look, lens=24):
    c = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    c.data.lens = lens
    scene.collection.objects.link(c)
    c.location = loc
    c.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return c


KX, KY = PY.KX, PY.KY
fixed_cam("Pyramid cutaway", (KX + 170, KY + 150, 70), (KX + 7, KY + 40, 5), 26)
fixed_cam("Osiris section", (OX + 40, OY - 28, -6), (OX + 6, OY, -17), 24)
fixed_cam("Imagined hall", (HX - 26, HY - 13, HZ + 9), (HX + 10, HY, HZ + 2), 16)
fixed_cam("Grand Gallery", tuple(AT + Vector((0.25, 0, 1.4)) - dirA * 0.5), tuple(GT + Vector((0, 0, 3.5))), 14)
kx0, ky0, kx1, ky1 = PY.KC_Y1, 0, 0, 0
fixed_cam("King's Chamber", (PX - 9.6, KC_Y1 - 0.6, KCF + 1.7), (PX - 2.0, KC_Y1 - 4.6, KCF + 0.6), 16)
fixed_cam("Osiris descent", (OX + 0.4, OY + 0.4, 2.2), (OX, OY, zA - 3), 12)
fixed_cam("Night sky", (KX + 60, KY + 260, 3.0), (KX - 20, KY - 200, 160), 18)
fixed_cam("Hall dais", (HX + 6.0, HY + 1.0, HZ + 1.6), (HX + 24.3, HY, HZ + 3.0), 20)
scene.camera = chase

# ---- bake ----------------------------------------------------------------------------------------------------------------
bakery.setup_cycles(128)
world = bpy.data.worlds.new("Night")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.010, 0.014, 0.030, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
scene.world = world
DENSITY = {"plateau": 3.0, "passages": 40.0, "gallery": 60.0, "chambers": 56.0, "kings": 110.0, "subterranean": 56.0,
           "osiris": 64.0, "hall": 56.0}
SAMPLES = {"plateau": 96, "hall": 128, "osiris": 160}
MAXPX = {"plateau": 4096}
COMBINED = ("shrine", "obelisk", "coffer", "sarcophag")
LIGHT_DIV, GLOSS_ALL, SMUL = 4, False, 1
if QUICK:
    DENSITY = {k: v / 4 for k, v in DENSITY.items()}
elif PROFILE == "g4":
    DENSITY = {k: v * 1.5 for k, v in DENSITY.items()}
    LIGHT_DIV, GLOSS_ALL, SMUL = 2, True, 4
unbaked = [o for o in scene.objects if o.type == "MESH" and o.name not in geo.ZONES and "caster" not in o.name]
for o in unbaked:
    o.hide_render = True
explorer_meshes = [o for o in scene.objects if o.type == "MESH" and o.parent == explorer]
for o in explorer_meshes:
    o.hide_render = True
bake = []
for name, zone in geo.ZONES.items():
    if ONLY and zone not in ONLY:
        continue
    ob = bpy.data.objects[name]
    smp = SAMPLES.get(zone, 128) // (4 if QUICK else 1) * SMUL
    rec = bakery.bake_object(ob, OUT, DENSITY[zone], smp, 0.0, max_px=MAXPX.get(zone, 4096),
                             combined=any(k in name.lower() for k in COMBINED),
                             gloss=GLOSS_ALL or zone == "kings" or name == "Hall floor", light_div=LIGHT_DIV)
    rec["zone"] = zone
    bake.append(rec)
for o in unbaked + explorer_meshes:
    o.hide_render = False
bpy.data.objects.remove(bpy.data.objects[OD["caster"]])
for o in [o for o in scene.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(o)                                     # the light is in the textures now
# the explorer still needs light (its materials are lit): a warm key and a cool fill, plus a headlamp
geo.lamp("Explorer key", "SUN", 1.4, (0, 0, 0), (1.0, 0.86, 0.68), rot=(math.radians(50), 0, math.radians(-35)), shadow=False)
geo.lamp("Explorer fill", "SUN", 0.6, (0, 0, 0), (0.55, 0.65, 0.9), rot=(math.radians(60), 0, math.radians(150)), shadow=False)
for lo in [o for o in scene.objects if o.type == "LIGHT"]:
    lo.data["x3d_energy_per_intensity"] = 1.0
    lo.data["x3d_intensity"] = 1

# sprites (flames) ship beside the textures
import shutil  # noqa: E402
for img in bpy.data.images:
    if img.filepath and os.path.basename(img.filepath) == "flame.png":
        dst = os.path.join(OUT, "tex", "flame.png")
        shutil.copyfile(bpy.path.abspath(img.filepath), dst)
        img.filepath = dst

# ---- export ----------------------------------------------------------------------------------------------------------------
scene.frame_set(1)
sys.path.insert(0, os.path.join(OUT, "_addon"))
os.makedirs(os.path.join(OUT, "_addon"), exist_ok=True)
link = os.path.join(OUT, "_addon", "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(ADDON, link, target_is_directory=True)
try:
    importlib.import_module("io_scene_x3d").register()
except Exception as e:  # noqa: BLE001
    print("register:", e)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "crawl.blend"))
print(bpy.ops.export_scene.x3d(filepath=os.path.join(OUT, "crawl.x3d"), x3d_version="X3D40", use_selection=False,
                               use_animation=True, path_mode="RELATIVE"))
mode_time = {}
for s in samples:
    mode_time[s["mode"]] = mode_time.get(s["mode"], 0) + dt
json.dump({"seconds": round(TOTAL, 2), "fps": FPS, "frames": F_END, "chapters": chapters, "sources": dict(PY.SOURCES, hawass=osiris.SRC,
           cayce="Edgar Cayce trance readings, 1930s and 1940s (a legend: no hall has been found)"),
           "mode_seconds": {k: round(v, 1) for k, v in mode_time.items()},
           "metres_walked": round(sum((samples[f]["pos"] - samples[f - 1]["pos"]).length for f in range(1, F_END)
                                      if (samples[f]["pos"] - samples[f - 1]["pos"]).length < 5), 1)},
          open(os.path.join(OUT, "route.json"), "w"), indent=1)
json.dump(dict(blender=bpy.app.version_string, quick=QUICK, profile=PROFILE, device=bpy.context.scene.cycles.device,
               device_backend=os.environ.get("BAKE_DEVICE", "METAL"), light_div=LIGHT_DIV, density_texels_per_m=DENSITY, samples=SAMPLES,
               build_seconds=round(time.time() - T_START, 1), objects=bake), open(os.path.join(OUT, "bake.json"), "w"), indent=1)
print("DONE seconds", round(TOTAL, 1), "frames", F_END, "chapters", len(chapters), "build_s", round(time.time() - T_START, 1))
