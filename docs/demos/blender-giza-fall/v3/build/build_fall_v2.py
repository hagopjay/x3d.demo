# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 64 v2 (Blenderized; v1's simulation, figures and cameras unchanged, see blenderize_fall.py).
Demo 64: the shared H-Anim explorer is shoved off the summit of the Great Pyramid and tumbles down the stepped
north face. Blender's rigid-body solver (Bullet) drives a 10-body ragdoll; the motion is baked onto the H-Anim joints,
a tracking camera is keyed every frame, and every contact that changes a body's velocity is written to impacts.json
so the page can play a thud or a smack at that instant.

Frame: Blender x east, y north, z up, metres, origin at the centre of Khufu's base.
Usage: Blender -b --python build_fall_v2.py -- OUT_DIR ADDON_SOURCE_DIR [--sim-only] [--profile=quick|local|g4]
"""
import bpy
import bmesh
import importlib
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig as R  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
OUT, ADDON = (os.path.abspath(a) for a in ARGV[:2])
SIM_ONLY = "--sim-only" in ARGV
PROFILE = next((a.split("=", 1)[1] for a in ARGV if a.startswith("--profile=")), "local")
FRICTION = float(os.environ.get("FALL_FRICTION", "0.45"))
SEED = int(os.environ.get("FALL_SEED", "7"))
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
FPS = 24
scene.render.fps = FPS
DT = 1.0 / FPS
G = 9.81

SOURCES = {
    "khufu": "Great Pyramid: base side 230.33 m, original height 146.6 m, present summit about 138.5 m, face slope 51.84 degrees (Petrie 1883 and standard summaries)",
    "courses": "About 203 courses remain; course heights shrink from about 1.5 m at the base to about 0.55 m near the top (Petrie's course survey, summarised). The individual heights here are generated to that trend, not copied course by course.",
    "summit": "A survey mast was set up on the summit platform in 1874 to mark the original apex height",
    "plateau": "Khafre and Menkaure positions from published centre coordinates, as in the Giza study v2",
}

# ---- materials ----------------------------------------------------------------------------------------------------
def mat(name, colour, rough=0.85, cull=True):
    m = R.principled(name, colour, rough)
    m.use_backface_culling = cull
    return m


STONE_A = mat("Core limestone", (0.78, 0.66, 0.48))
STONE_B = mat("Core limestone, darker course", (0.70, 0.58, 0.42))
SAND = mat("Plateau sand", (0.80, 0.66, 0.45), 0.95, cull=False)
FAR = mat("Far pyramids", (0.82, 0.71, 0.52), 0.9)
MAST = mat("Survey mast", (0.25, 0.25, 0.27), 0.5, cull=False)


def meta_set(ob, meta):
    ob["x3d_metadata"] = {"node": "MetadataSet", "name": "Giza", "value": [
        {"node": "MetadataString", "name": k, "value": '"%s"' % v} for k, v in meta.items()]}


def link_mesh(name, bm, mats, meta=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if meta:
        meta_set(ob, meta)
    return ob


# ---- the stepped pyramid ------------------------------------------------------------------------------------------
HALF_BASE, APEX, SUMMIT = 230.33 / 2, 146.6, 138.5
rng = random.Random(SEED)
N_COURSES = 203
raw = [1.5 - 0.95 * (k / (N_COURSES - 1)) + rng.uniform(-0.12, 0.12) for k in range(N_COURSES)]
scale = SUMMIT / sum(raw)
heights = [h * scale for h in raw]
tops = []
z = 0.0
for h in heights:
    z += h
    tops.append(z)


def half_width(zz):
    return HALF_BASE * (1 - zz / APEX)


def stepped_pyramid():
    bm = bmesh.new()
    corners = lambda w, zz: [(w, w, zz), (-w, w, zz), (-w, -w, zz), (w, -w, zz)]  # NE, NW, SW, SE
    z0 = 0.0
    for k, z1 in enumerate(tops):
        w = half_width(z1)
        lo, hi = corners(w, z0), corners(w, z1)
        mi = k % 2
        for i in range(4):          # risers, outward
            f = bm.faces.new([bm.verts.new(p) for p in (lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i])][::-1])
            f.material_index = mi
        w2 = half_width(tops[k + 1]) if k + 1 < len(tops) else None
        if w2 is None:              # summit platform
            f = bm.faces.new([bm.verts.new(p) for p in hi])
            f.material_index = mi
        else:
            inner = corners(w2, z1)
            for i in range(4):      # tread ring, facing up
                f = bm.faces.new([bm.verts.new(p) for p in (hi[i], hi[(i + 1) % 4], inner[(i + 1) % 4], inner[i])][::-1])
                f.material_index = mi
        z0 = z1
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.normal_update()
    # make every face point away from the vertical axis or up
    for f in bm.faces:
        c = f.calc_center_median()
        out = Vector((c.x, c.y, 0)).normalized() if abs(f.normal.z) < 0.5 else Vector((0, 0, 1))
        if f.normal.dot(out) < 0:
            f.normal_flip()
    return link_mesh("Great Pyramid, stepped core", bm, [STONE_A, STONE_B],
                     {"grade": "Documented size and slope; course heights generated to the published trend", "source": SOURCES["khufu"]})


PYR = stepped_pyramid()
w_top = half_width(SUMMIT)
print("summit platform side %.2f m, courses %d, mean course %.3f m" % (2 * w_top, N_COURSES, SUMMIT / N_COURSES))


def plain_pyramid(name, cx, cy, side, height):
    bm = bmesh.new()
    h = side / 2
    base = [bm.verts.new((cx + x, cy + y, 0)) for x, y in ((h, h), (-h, h), (-h, -h), (h, -h))]
    top = bm.verts.new((cx, cy, height))
    for i in range(4):
        bm.faces.new((base[i], base[(i + 1) % 4], top)) if False else bm.faces.new((top, base[(i + 1) % 4], base[i])[::-1])
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x - cx, c.y - cy, 0))) < 0:
            f.normal_flip()
    return link_mesh(name, bm, [FAR], {"grade": "Documented position and size, smooth faces", "source": SOURCES["plateau"]})


plain_pyramid("Khafre", -322.0, -340.0, 215.25, 143.5)
plain_pyramid("Menkaure", -563.0, -742.0, 103.4, 65.5)

bm = bmesh.new()
g = 1400
vs = [bm.verts.new(p) for p in ((-g, -g, -0.02), (g, -g, -0.02), (g, g, -0.02), (-g, g, -0.02))]
bm.faces.new(vs)
GROUND = link_mesh("Plateau", bm, [SAND], {"grade": "Authored", "what": "flat sand at the base"})

bm = bmesh.new()
res = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.06, radius2=0.04, depth=9.1)
bmesh.ops.translate(bm, vec=(0, 0, SUMMIT + 4.55), verts=res["verts"])
link_mesh("Survey mast", bm, [MAST], {"grade": "Documented that a mast stands on the summit; this one is schematic", "source": SOURCES["summit"]})

# ---- figures --------------------------------------------------------------------------------------------------------
START = Vector((3.2, w_top - 0.32, SUMMIT))
faller, fpb = R.build_figure(scene, "Explorer")
# an Empty carries the faller's travel: the add-on samples object animation for ordinary objects, and an armature
# object's own keys did not reach the X3D in this build (the Empty-parent pattern from Demo 61 and 63 does)
carrier = bpy.data.objects.new("Faller path", None)
scene.collection.objects.link(carrier)
carrier.location = START
faller.parent = carrier
pusher, ppb = R.build_figure(scene, "Pusher", jacket=(0.10, 0.35, 0.80))
pusher.location = START + Vector((0.0, -0.75, 0))
bpy.context.view_layer.update()
s_sign, r_sign = R.forward_sign(pusher, ppb)
for n in R.J:
    fpb[n].rotation_mode = "QUATERNION"

# ---- ragdoll bodies -----------------------------------------------------------------------------------------------
J = {n: START + Vector(p) for n, p in R.J.items()}
BODIES = {}       # bone -> object
MASS = {}


def seg_body(bone, a, b, r, mass, shape="CAPSULE"):
    a, b = Vector(a), Vector(b)
    bmx = bmesh.new()
    d = (b - a)
    bmesh.ops.create_cone(bmx, cap_ends=True, segments=8, radius1=r, radius2=r, depth=d.length)
    me = bpy.data.meshes.new("rb " + bone)
    bmx.to_mesh(me)
    bmx.free()
    ob = bpy.data.objects.new("rb " + bone, me)
    scene.collection.objects.link(ob)
    ob.location = (a + b) / 2
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    BODIES[bone] = ob
    MASS[bone] = mass
    ob["_shape"] = shape
    return ob


def box_body(bone, centre, size, mass):
    bmx = bmesh.new()
    bmesh.ops.create_cube(bmx, size=1.0)
    bmesh.ops.scale(bmx, vec=size, verts=bmx.verts)
    me = bpy.data.meshes.new("rb " + bone)
    bmx.to_mesh(me)
    bmx.free()
    ob = bpy.data.objects.new("rb " + bone, me)
    scene.collection.objects.link(ob)
    ob.location = centre
    BODIES[bone] = ob
    MASS[bone] = mass
    ob["_shape"] = "BOX"
    return ob


box_body("humanoid_root", START + Vector((0, 0, 0.93)), (0.32, 0.22, 0.22), 13.0)
box_body("vl5", START + Vector((0, 0, 1.24)), (0.38, 0.25, 0.46), 26.0)
box_body("skullbase", START + Vector((0, 0.01, 1.68)), (0.24, 0.26, 0.28), 5.0)
for s in ("l", "r"):
    seg_body(s + "_hip", J[s + "_hip"], J[s + "_knee"], 0.075, 9.5)
    seg_body(s + "_knee", J[s + "_knee"], J[s + "_ankle"] + Vector((0, 0, -0.06)), 0.06, 4.5)
    seg_body(s + "_shoulder", J[s + "_shoulder"], J[s + "_elbow"], 0.055, 2.3)
    seg_body(s + "_elbow", J[s + "_elbow"], J[s + "_wrist"] + Vector((0, 0, -0.1)), 0.045, 1.7)
print("ragdoll mass %.1f kg" % sum(MASS.values()))

bpy.ops.rigidbody.world_add()
rbw = scene.rigidbody_world
rbw.substeps_per_frame = 20
rbw.solver_iterations = 30


def make_rb(ob, kind, shape, mass=1.0, fric=FRICTION, rest=0.15):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.rigidbody.object_add(type=kind)
    rb = ob.rigid_body
    rb.collision_shape = shape
    rb.friction, rb.restitution = fric, rest
    if kind == "ACTIVE":
        rb.mass = mass
        rb.linear_damping, rb.angular_damping = 0.04, 0.25
        rb.collision_margin = 0.01
        rb.use_margin = True
    else:
        rb.collision_margin = 0.0
        rb.use_margin = True


make_rb(PYR, "PASSIVE", "MESH", fric=FRICTION, rest=0.15)
make_rb(GROUND, "PASSIVE", "BOX", fric=0.8, rest=0.05)
for bone, ob in BODIES.items():
    make_rb(ob, "ACTIVE", ob["_shape"], MASS[bone])

D = math.radians
LIMITS = {   # (parent bone, joint location, (x lo, x hi), (y lo, y hi), (z lo, z hi)) in degrees
    "vl5": ("humanoid_root", J["vl5"], (-30, 45), (-25, 25), (-25, 25)),
    "skullbase": ("vl5", J["skullbase"], (-40, 50), (-50, 50), (-30, 30)),
    "l_hip": ("humanoid_root", J["l_hip"], (-110, 30), (-20, 20), (-15, 45)),
    "r_hip": ("humanoid_root", J["r_hip"], (-110, 30), (-20, 20), (-45, 15)),
    "l_knee": ("l_hip", J["l_knee"], (0, 140), (0, 0), (0, 0)),
    "r_knee": ("r_hip", J["r_knee"], (0, 140), (0, 0), (0, 0)),
    "l_shoulder": ("vl5", J["l_shoulder"], (-170, 60), (-50, 50), (-20, 150)),
    "r_shoulder": ("vl5", J["r_shoulder"], (-170, 60), (-50, 50), (-150, 20)),
    "l_elbow": ("l_shoulder", J["l_elbow"], (-140, 0), (0, 0), (0, 0)),
    "r_elbow": ("r_shoulder", J["r_elbow"], (-140, 0), (0, 0), (0, 0)),
}
KNEE_SIGN = float(os.environ.get("FALL_KNEE_SIGN", "1"))
for child, (parent, loc, lx, ly, lz) in LIMITS.items():
    e = bpy.data.objects.new("joint " + child, None)
    e.location = loc
    scene.collection.objects.link(e)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = e
    e.select_set(True)
    bpy.ops.rigidbody.constraint_add(type="GENERIC")
    c = e.rigid_body_constraint
    c.object1, c.object2 = BODIES[parent], BODIES[child]
    c.disable_collisions = True
    for ax in "xyz":
        setattr(c, "use_limit_lin_" + ax, True)
        setattr(c, "limit_lin_%s_lower" % ax, 0.0)
        setattr(c, "limit_lin_%s_upper" % ax, 0.0)
    for ax, (lo, hi) in zip("xyz", (lx, ly, lz)):
        if ax == "x" and child.endswith(("knee", "elbow")) and KNEE_SIGN < 0:
            lo, hi = -hi, -lo
        setattr(c, "use_limit_ang_" + ax, True)
        setattr(c, "limit_ang_%s_lower" % ax, D(lo))
        setattr(c, "limit_ang_%s_upper" % ax, D(hi))

# ---- the shove: bodies ride a keyed motion, then the solver takes over ------------------------------------------
HOLD, PUSH_END = 18, 30          # frames
M0 = {b: ob.matrix_world.copy() for b, ob in BODIES.items()}
pivot = START + Vector((0, 0.08, 0))


def shove_matrix(f):
    if f <= HOLD:
        return Matrix.Identity(4)
    u = min(1.0, (f - HOLD) / (PUSH_END - HOLD))
    ease = u * u
    ang = -D(28) * ease          # negative about X tips the head toward +Y, the way the shove goes
    shift = Vector((0.0, 0.9 * ease, 0.0))
    return Matrix.Translation(pivot + shift) @ Matrix.Rotation(ang, 4, "X") @ Matrix.Translation(-pivot)


for f in range(1, PUSH_END + 2):
    T = shove_matrix(min(f, PUSH_END))
    if f == PUSH_END + 1:        # one more step of the same velocity, then release
        T = Matrix.Translation(Vector((0, 0.9 / (PUSH_END - HOLD) * 2, -0.02))) @ shove_matrix(PUSH_END)
    for b, ob in BODIES.items():
        ob.matrix_world = T @ M0[b]
        ob.keyframe_insert("location", frame=f)
        ob.keyframe_insert("rotation_euler", frame=f)
        ob.rigid_body.kinematic = f <= PUSH_END
        ob.keyframe_insert("rigid_body.kinematic", frame=f)

MAX_F = int(os.environ.get("FALL_MAX_FRAMES", "2400"))
rbw.point_cache.frame_start = 1
rbw.point_cache.frame_end = MAX_F
scene.frame_start, scene.frame_end = 1, MAX_F

track = {b: [] for b in BODIES}
end_f = MAX_F
still = 0
for f in range(1, MAX_F + 1):
    scene.frame_set(f)
    for b, ob in BODIES.items():
        track[b].append(ob.matrix_world.copy())
    p = track["humanoid_root"][-1].translation
    if f > 40:
        v = (p - track["humanoid_root"][-2].translation).length / DT
        still = still + 1 if (v < 0.25) else 0
        if still > FPS * 1.5:
            end_f = f
            break
    if f % 240 == 0:
        print("frame %d  pelvis (%.1f, %.1f, %.1f)" % (f, p.x, p.y, p.z))
p = track["humanoid_root"][-1].translation
rest_course = next((k for k, t in enumerate(tops) if t > p.z - 0.3), N_COURSES)
print("END frame %d (%.1f s), pelvis at (%.1f, %.1f, %.1f), height %.1f m, course %d" % (end_f, end_f * DT, p.x, p.y, p.z, p.z, rest_course))
json.dump({"end_frame": end_f, "pelvis_end": list(p), "friction": FRICTION, "seed": SEED},
          open(os.path.join(OUT, "sim_summary.json"), "w"))
if SIM_ONLY:
    sys.exit(0)

# ---- impacts: any velocity change beyond gravity is a contact --------------------------------------------------------
KIND = {"humanoid_root": "thud", "vl5": "thud", "skullbase": "knock"}
gvec = Vector((0, 0, -G * DT))
raw_ev = []
for b, mats in track.items():
    last_t = -1
    for f in range(2, len(mats)):
        v1 = (mats[f - 1].translation - mats[f - 2].translation) / DT
        v2 = (mats[f].translation - mats[f - 1].translation) / DT
        dv = (v2 - v1 - gvec).length
        J_ = MASS[b] * dv                                   # N s
        t = (f + 1) * DT
        if f + 1 > PUSH_END + 1 and J_ > 18.0 and t - last_t > 0.09:
            raw_ev.append({"t": round(t - DT * 0.5, 3), "body": b, "impulse": round(J_, 1), "kind": KIND.get(b, "smack"),
                           "z": round(mats[f].translation.z, 2)})
            last_t = t
raw_ev.sort(key=lambda e: e["t"])
events = []
for e in raw_ev:                                            # one sound per 40 ms, keep the hardest hit
    if events and e["t"] - events[-1]["t"] < 0.04:
        if e["impulse"] > events[-1]["impulse"]:
            events[-1] = e
        continue
    events.append(e)
for e in events:
    e["course"] = next((k + 1 for k, t in enumerate(tops) if t > e["z"] - 0.35), N_COURSES)
print("impacts:", len(events), "max impulse %.0f N s" % max(e["impulse"] for e in events))

# ---- bake onto the H-Anim joints -----------------------------------------------------------------------------------
END = end_f + 2 * FPS              # hold the last pose for two seconds
# The carrier Empty takes the pelvis's travel; the root joint keeps only the local offset. X_ITE culls a skinned
# HAnim mesh by the bounds of its rest coordinates, so a root joint that travels 170 m leaves the mesh behind (Likely).
W = faller.matrix_world.copy()
pel0 = track["humanoid_root"][0].translation.copy()
rest = {n: faller.data.bones[n].matrix_local.copy() for n in R.J}
ORDER = ["humanoid_root", "sacroiliac", "vl5", "skullbase", "l_hip", "l_knee", "l_ankle", "r_hip", "r_knee", "r_ankle",
         "l_shoulder", "l_elbow", "l_wrist", "r_shoulder", "r_elbow", "r_wrist"]
for f in range(END):
    fi = min(f, len(track["humanoid_root"]) - 1)
    travel = track["humanoid_root"][fi].translation - pel0
    Wf = Matrix.Translation(travel) @ W
    Wi = Wf.inverted()
    carrier.location = START + travel
    carrier.keyframe_insert("location", frame=f + 1)
    pose = {}
    for n in ORDER:
        par = R.PARENT.get(n)
        if n in BODIES:
            P = Wi @ track[n][fi] @ M0[n].inverted() @ W @ rest[n]
        else:
            P = pose[par] @ rest[par].inverted() @ rest[n]
        pose[n] = P
        base = (pose[par] @ rest[par].inverted() @ rest[n]) if par else rest[n]
        basis = base.inverted() @ P
        loc, rot, _ = basis.decompose()
        pb = fpb[n]
        pb.rotation_quaternion = rot
        pb.keyframe_insert("rotation_quaternion", frame=f + 1)
        if n == "humanoid_root":
            pb.location = loc
            pb.keyframe_insert("location", frame=f + 1)

# the pusher: stands, then both arms drive forward
PUSH = dict(R.MODES["look"], shoulder=0, elbow=40)
for f in range(1, END + 1):
    u = 0.0 if f < HOLD - 6 else min(1.0, (f - (HOLD - 6)) / 14)
    back = max(0.0, min(1.0, (f - PUSH_END - 10) / 30))
    p = dict(PUSH, shoulder=85 * u * (1 - 0.6 * back), elbow=40 * (1 - u) + 6, tilt=2 + 14 * u * (1 - back), head=-8 - 30 * back)
    R.pose(ppb, s_sign, r_sign, p, 0.0)
    R.key_pose(ppb, f)

# ---- tracking camera ------------------------------------------------------------------------------------------------
cam = bpy.data.objects.new("Tracking camera", bpy.data.cameras.new("Tracking camera"))
cam.data.lens = 30
cam.data.clip_end = 3000
scene.collection.objects.link(cam)
cam.rotation_mode = "QUATERNION"
cpos = None
look = None
prevq = None
speeds = []
heights_track = []
for f in range(END):
    fi = min(f, len(track["humanoid_root"]) - 1)
    pel = track["humanoid_root"][fi].translation.copy()
    sp = (pel - track["humanoid_root"][max(0, fi - 1)].translation).length / DT
    speeds.append(round(sp, 2))
    heights_track.append(round(max(0.0, pel.z - 0.2), 2))
    u = min(1.0, max(0.0, (f - PUSH_END) / (2 * FPS)))    # from a close two-shot at the top to a wide follow
    want = pel + Vector((2.2 + 2.6 * u, 3.0 + 3.4 * u, 1.2 + 1.8 * u))
    want.z = max(want.z, 1.4)
    cpos = want if cpos is None else cpos.lerp(want, 0.12)
    look = pel if look is None else look.lerp(pel, 0.35)
    q = (look - cpos).to_track_quat("-Z", "Y")
    if prevq is not None and prevq.dot(q) < 0:
        q.negate()
    prevq = q
    cam.location, cam.rotation_quaternion = cpos, q
    cam.keyframe_insert("location", frame=f + 1)
    cam.keyframe_insert("rotation_quaternion", frame=f + 1)


def fixed_cam(name, loc, at, lens=24):
    c = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    c.data.lens = lens
    c.data.clip_end = 3000
    scene.collection.objects.link(c)
    c.location = loc
    c.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return c


fixed_cam("North face", (90, 330, 40), (5, 60, 60), 30)
fixed_cam("Summit", START + Vector((-3.5, -4.5, 2.6)), START + Vector((0, 2.0, 0.6)), 20)
fixed_cam("From the base", (track["humanoid_root"][end_f - 1].translation + Vector((-6, 14, 2.5)))[:], (5, 40, 70), 22)
scene.camera = cam

# ---- light --------------------------------------------------------------------------------------------------------
def sun(name, energy, rot, colour):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy, ld.color, ld.use_shadow = energy, colour, False
    ld["x3d_energy_per_intensity"] = 1.0
    ld["x3d_intensity"] = 1
    lo = bpy.data.objects.new(name, ld)
    lo.rotation_euler = rot
    scene.collection.objects.link(lo)


sun("Sun", 2.4, (D(50), 0, D(150)), (1.0, 0.9, 0.76))
sun("Sky fill", 0.9, (D(65), 0, D(-30)), (0.65, 0.78, 1.0))
SKY = '<Background skyColor="0.20 0.38 0.68 0.52 0.66 0.84 0.86 0.84 0.78" skyAngle="1.2 1.57" groundColor="0.80 0.66 0.45 0.80 0.66 0.45" groundAngle="1.57" />'

# ---- Blenderize: rebuild what they fall on, bake light into textures (blenderize_fall.py) ------------------------------
import blenderize_fall as BZ  # noqa: E402
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "fall_sim.blend"))
for ob in list(BODIES.values()) + [o for o in scene.objects if o.name.startswith("joint ")]:
    bpy.data.objects.remove(ob, do_unlink=True)
BODIES = {}
bpy.ops.rigidbody.world_remove()
ZONES, BAKE_SUN = BZ.build(scene, tops, half_width, PYR, GROUND, ["Khafre", "Menkaure"],
                           {"grade": "Documented size and slope; course heights generated to the published trend", "source": SOURCES["khufu"]})
PYR = GROUND = None
BAKE = BZ.bake(scene, ZONES, OUT, PROFILE, BAKE_SUN)
json.dump(dict(BAKE, blender=bpy.app.version_string, device=scene.cycles.device, device_backend=os.environ.get("BAKE_DEVICE", "METAL")),
          open(os.path.join(OUT, "bake.json"), "w"), indent=1)
SKY = '<Background skyColor="0.16 0.24 0.42 0.46 0.48 0.58 0.92 0.68 0.44" skyAngle="1.1 1.53" groundColor="0.60 0.44 0.28 0.60 0.44 0.28" groundAngle="1.57" />'

# ---- strip the physics, export --------------------------------------------------------------------------------------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "fall_sim.blend"))
scene.frame_end = END
for ob in [o for o in (PYR, GROUND) if o is not None]:
    if ob.rigid_body:
        bpy.context.view_layer.objects.active = ob
        bpy.ops.rigidbody.object_remove()
scene.frame_set(1)
sys.path.insert(0, os.path.join(OUT, "_addon"))
os.makedirs(os.path.join(OUT, "_addon"), exist_ok=True)
link = os.path.join(OUT, "_addon", "io_scene_x3d")
if not os.path.exists(link):
    os.symlink(ADDON, link, target_is_directory=True)
try:
    importlib.import_module("io_scene_x3d").register()
except Exception:
    pass
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "fall.blend"))
print(bpy.ops.export_scene.x3d(filepath=os.path.join(OUT, "fall.x3d"), x3d_version="X3D40", use_selection=False, use_animation=True, path_mode="RELATIVE"))
# the add-on writes a Background only for imported scenes; the generator swaps in a sky (a scripted step, not a hand edit)
xp = os.path.join(OUT, "fall.x3d")
x = open(xp, encoding="utf-8").read()
import re
x, n_bg = re.subn(r"<Background [^>]*/>", SKY, x, count=1)
if not n_bg:
    x, n_bg = re.subn(r"(<Scene>)", r"\1\n" + SKY, x, count=1)
assert n_bg == 1
open(xp, "w", encoding="utf-8").write(x)
seconds = END / FPS
json.dump({"seconds": round(seconds, 3), "fps": FPS, "frames": END, "release_t": round((PUSH_END + 1) * DT, 3),
           "landed_t": round(end_f * DT, 2), "height_m": SUMMIT, "courses": N_COURSES,
           "rest_point_m_from_base": round(track["humanoid_root"][end_f - 1].translation.y - HALF_BASE, 1),
           "peak_speed_ms": max(speeds), "speed_10hz": [speeds[min(len(speeds) - 1, round(i * FPS / 10))] for i in range(int(seconds * 10) + 1)],
           "height_10hz": [heights_track[min(len(heights_track) - 1, round(i * FPS / 10))] for i in range(int(seconds * 10) + 1)],
           "ragdoll": {"bodies": len(BODIES), "joints_limited": len(LIMITS), "mass_kg": round(sum(MASS.values()), 1), "friction": FRICTION, "restitution": 0.15,
                       "substeps_per_frame": rbw.substeps_per_frame if scene.rigidbody_world else 20, "solver": "Bullet (Blender rigid body)"},
           "events": events, "sources": SOURCES}, open(os.path.join(OUT, "fall.json"), "w"), indent=1)
print("seconds %.1f frames %d impacts %d peak speed %.1f m/s" % (seconds, END, len(events), max(speeds)))
