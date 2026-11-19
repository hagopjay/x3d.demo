# SPDX-License-Identifier: GPL-3.0-or-later
"""Shared H-Anim 2.0 figure for the Giza demos: a 16-joint armature with standard joint names, one skinned mesh with
rigid weights, and a pose function that sets every joint from a few gait parameters.

Built from The Walking Twin's rig (Demo 61), with one fix found while reusing it: the pelvic bob now moves along the
root bone's local Y axis (world up). In Demo 61 it moved along local Z, a 2.5 cm fore-and-aft sway, not a bob.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

J = {  # joint centres, metres, figure facing +Y, feet on z=0
    "humanoid_root": (0, 0, 0.95), "sacroiliac": (0, 0, 0.95), "vl5": (0, 0, 1.02), "skullbase": (0, 0, 1.55),
    "l_hip": (0.10, 0, 0.92), "l_knee": (0.10, 0.01, 0.50), "l_ankle": (0.10, 0, 0.08),
    "r_hip": (-0.10, 0, 0.92), "r_knee": (-0.10, 0.01, 0.50), "r_ankle": (-0.10, 0, 0.08),
    "l_shoulder": (0.20, 0, 1.43), "l_elbow": (0.22, -0.01, 1.14), "l_wrist": (0.22, 0.01, 0.89),
    "r_shoulder": (-0.20, 0, 1.43), "r_elbow": (-0.22, -0.01, 1.14), "r_wrist": (-0.22, 0.01, 0.89),
}
TAIL = {"humanoid_root": (0, 0, 1.0), "sacroiliac": (0, 0, 0.90), "vl5": (0, 0, 1.45), "skullbase": (0, 0, 1.80),
        "l_ankle": (0.10, 0.16, 0.02), "r_ankle": (-0.10, 0.16, 0.02), "l_wrist": (0.22, 0.03, 0.74), "r_wrist": (-0.22, 0.03, 0.74)}
PARENT = {"sacroiliac": "humanoid_root", "vl5": "humanoid_root", "skullbase": "vl5",
          "l_hip": "sacroiliac", "l_knee": "l_hip", "l_ankle": "l_knee", "r_hip": "sacroiliac", "r_knee": "r_hip", "r_ankle": "r_knee",
          "l_shoulder": "vl5", "l_elbow": "l_shoulder", "l_wrist": "l_elbow", "r_shoulder": "vl5", "r_elbow": "r_shoulder", "r_wrist": "r_elbow"}
CHILD = {"l_hip": "l_knee", "l_knee": "l_ankle", "r_hip": "r_knee", "r_knee": "r_ankle",
         "l_shoulder": "l_elbow", "l_elbow": "l_wrist", "r_shoulder": "r_elbow", "r_elbow": "r_wrist"}
HANIM2 = {"l_ankle": "l_talocrural", "r_ankle": "r_talocrural", "l_wrist": "l_radiocarpal", "r_wrist": "r_radiocarpal"}


def principled(name, colour, rough=0.6, metal=0.0, alpha=1.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_strength
    return m


def build_figure(scene, name="Explorer", jacket=(0.95, 0.42, 0.04)):
    """Armature + skinned mesh. Returns (rig object, pose bones)."""
    arm_data = bpy.data.armatures.new(name + " rig")
    rig = bpy.data.objects.new(name, arm_data)
    scene.collection.objects.link(rig)
    rig["x3d_hanim_names"] = "standard"
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for n in J:
        eb = arm_data.edit_bones.new(n)
        eb.head = J[n]
        eb.tail = J[CHILD[n]] if n in CHILD else TAIL[n]
        eb.roll = 0.0
    for n, p in PARENT.items():
        arm_data.edit_bones[n].parent = arm_data.edit_bones[p]
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm_data.bones:
        b["x3d_hanim_joint"] = HANIM2.get(b.name, b.name)

    mats = {"Jacket": principled(name + " jacket", jacket, 0.55),
            "Trousers": principled(name + " trousers", (0.30, 0.26, 0.20), 0.8),
            "Helmet": principled(name + " helmet", (0.95, 0.95, 0.92), 0.35),
            "Skin": principled(name + " skin", (0.70, 0.52, 0.42), 0.6),
            "Boots": principled(name + " boots", (0.12, 0.09, 0.07), 0.7)}
    order = list(mats)
    skin = bmesh.new()
    parts = []

    def tube(a, b, r1, r2, bone, mat, segs=10):
        a, b = Vector(a), Vector(b)
        d = b - a
        res = bmesh.ops.create_cone(skin, cap_ends=True, segments=segs, radius1=r1, radius2=r2, depth=d.length)
        rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        bmesh.ops.transform(skin, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=res["verts"])
        parts.append((res["verts"], bone, order.index(mat)))

    def ball(c, r, bone, mat, scale=(1, 1, 1)):
        res = bmesh.ops.create_uvsphere(skin, u_segments=14, v_segments=8, radius=r)
        bmesh.ops.transform(skin, matrix=Matrix.Translation(c) @ Matrix.Diagonal((*scale, 1)), verts=res["verts"])
        parts.append((res["verts"], bone, order.index(mat)))

    for s, x in (("l", 0.10), ("r", -0.10)):
        tube(J[s + "_hip"], J[s + "_knee"], 0.075, 0.06, s + "_hip", "Trousers")
        tube(J[s + "_knee"], J[s + "_ankle"], 0.058, 0.045, s + "_knee", "Trousers")
        tube((x, -0.05, 0.05), (x, 0.17, 0.05), 0.055, 0.05, s + "_ankle", "Boots")
        tube(J[s + "_shoulder"], J[s + "_elbow"], 0.055, 0.047, s + "_shoulder", "Jacket")
        tube(J[s + "_elbow"], J[s + "_wrist"], 0.045, 0.038, s + "_elbow", "Jacket")
        ball(Vector(J[s + "_wrist"]) + Vector((0, 0, -0.07)), 0.045, s + "_wrist", "Skin")
    ball((0, 0, 0.93), 0.17, "sacroiliac", "Trousers", (1.0, 0.7, 0.55))
    tube((0, 0, 1.0), (0, 0, 1.47), 0.17, 0.2, "vl5", "Jacket", segs=14)
    tube((0, 0, 1.47), (0, 0, 1.56), 0.06, 0.05, "skullbase", "Skin")
    ball((0, 0.01, 1.66), 0.11, "skullbase", "Skin", (0.9, 1.0, 1.1))
    ball((0, 0.0, 1.73), 0.13, "skullbase", "Helmet", (1.0, 1.1, 0.6))
    ball((0, 0.13, 1.74), 0.035, "skullbase", "Helmet")          # headlamp housing
    me = bpy.data.meshes.new(name + " skin")
    skin.to_mesh(me)
    ob = bpy.data.objects.new(name + " skin", me)
    scene.collection.objects.link(ob)
    for m in mats.values():
        me.materials.append(m)
    groups = {n: ob.vertex_groups.new(name=n) for n in J}
    index_of = {}
    skin.verts.index_update()
    for verts, bone, mi in parts:
        ids = [v.index for v in verts]
        groups[bone].add(ids, 1.0, "REPLACE")
        for i in ids:
            index_of[i] = mi
    for poly in me.polygons:
        poly.material_index = index_of.get(poly.vertices[0], 0)
    skin.free()
    ob.parent = rig
    ob.modifiers.new("Armature", "ARMATURE").object = rig
    pb = rig.pose.bones
    for n in J:
        pb[n].rotation_mode = "XYZ"
    return rig, pb


def forward_sign(rig, pb):
    """+1 when a positive local-X rotation of a downward limb swings its far end toward +Y (measured, not assumed)."""
    pb["l_hip"].rotation_euler = (0.4, 0, 0)
    bpy.context.view_layer.update()
    s = 1.0 if (rig.matrix_world @ pb["l_hip"].tail).y > J["l_knee"][1] else -1.0
    pb["l_hip"].rotation_euler = (0, 0, 0)
    pb["humanoid_root"].rotation_euler = (0.4, 0, 0)
    bpy.context.view_layer.update()
    r = 1.0 if (rig.matrix_world @ pb["humanoid_root"].tail).y > 0 else -1.0     # +1: positive X tips the torso forward
    pb["humanoid_root"].rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    return s, r


# Gait parameter sets (degrees unless noted). tilt: torso pitched forward; pelvis: pelvis height (m);
# hip/knee/shoulder/elbow: base angles (forward flexion positive, knee flexion positive); amp_*: swing amplitudes;
# head: head pitch back to keep the eyes level; kind: which limbs pair up.
MODES = {
    "walk":  dict(tilt=4, pelvis=0.95, hip=0, knee=6, shoulder=0, elbow=18, amp_hip=24, amp_knee=48, amp_arm=18, head=-4, kind="biped"),
    "stoop": dict(tilt=38, pelvis=0.80, hip=30, knee=24, shoulder=20, elbow=30, amp_hip=16, amp_knee=30, amp_arm=10, head=-34, kind="biped"),
    "crawl": dict(tilt=78, pelvis=0.50, hip=78, knee=92, shoulder=82, elbow=6, amp_hip=12, amp_knee=10, amp_arm=12, head=-62, kind="quad"),
    "climb": dict(tilt=6, pelvis=0.95, hip=28, knee=40, shoulder=150, elbow=40, amp_hip=26, amp_knee=34, amp_arm=16, head=-14, kind="ladder"),
    "look":  dict(tilt=2, pelvis=0.95, hip=0, knee=4, shoulder=4, elbow=14, amp_hip=0, amp_knee=0, amp_arm=0, head=-8, kind="idle"),
    "kneel": dict(tilt=10, pelvis=0.55, hip=80, knee=110, shoulder=30, elbow=50, amp_hip=0, amp_knee=0, amp_arm=0, head=10, kind="idle"),
}


def blend(a, b, t):
    return {k: (a[k] + (b[k] - a[k]) * t if isinstance(a[k], (int, float)) else (a[k] if t < 0.5 else b[k])) for k in a}


def pose(pb, s, r, p, phase, look_yaw=0.0):
    """Set every joint for gait parameters p at stride phase (0..1)."""
    R = math.radians
    w = 2 * math.pi * phase
    tilt = p["tilt"]
    pb["humanoid_root"].rotation_euler = (-r * R(tilt), 0, 0)   # measured: +r tilted the figure backward
    bob = 0.02 * math.cos(2 * w) if p["kind"] == "biped" else 0.0
    pb["humanoid_root"].location = (0, p["pelvis"] - 0.95 + bob, 0)     # local Y of an upward bone is world up
    for side, sgn in (("l", 1), ("r", -1)):
        ph = w if sgn > 0 else w + math.pi
        if p["kind"] == "biped":
            hip = p["hip"] + sgn * p["amp_hip"] * math.sin(w)
            knee = p["knee"] + p["amp_knee"] * max(0.0, math.cos(ph)) ** 1.5
            arm = p["shoulder"] - sgn * p["amp_arm"] * math.sin(w)
            ankle = 10 * math.sin(ph)
        elif p["kind"] == "quad":        # diagonal pairs: left arm with right knee
            hip = p["hip"] + p["amp_hip"] * math.sin(ph)
            knee = p["knee"] + p["amp_knee"] * max(0.0, math.cos(ph))
            arm = p["shoulder"] + p["amp_arm"] * math.sin(ph + math.pi)
            ankle = -20
        elif p["kind"] == "ladder":      # opposite hand and foot together, hands overhead
            hip = p["hip"] + p["amp_hip"] * math.sin(ph)
            knee = p["knee"] + p["amp_knee"] * max(0.0, math.sin(ph))
            arm = p["shoulder"] + p["amp_arm"] * math.sin(ph)
            ankle = 5
        else:
            hip, knee, arm, ankle = p["hip"], p["knee"], p["shoulder"], 0
        # the torso tilt is undone at the hips and shoulders so legs and arms keep hanging under gravity
        pb[side + "_hip"].rotation_euler = (s * R(hip), 0, 0)
        pb[side + "_knee"].rotation_euler = (-s * R(knee), 0, 0)
        pb[side + "_ankle"].rotation_euler = (s * R(ankle), 0, 0)
        pb[side + "_shoulder"].rotation_euler = (s * R(arm), 0, 0)
        pb[side + "_elbow"].rotation_euler = (s * R(p["elbow"]), 0, 0)
    pb["vl5"].rotation_euler = (0, 0, R(4) * math.sin(w) if p["kind"] == "biped" else 0)
    pb["skullbase"].rotation_euler = (-r * R(p["head"]), 0, look_yaw)


def key_pose(pb, frame):
    for n in J:
        pb[n].keyframe_insert("rotation_euler", frame=frame)
    pb["humanoid_root"].keyframe_insert("location", frame=frame)
