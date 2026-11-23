"""Bake the binary city in Blender (Cycles, CPU) and export it with x3d-blender-io.

Run with the bpy wheel (Blender 5.3.0 as a module):
    python build/bake_city.py --addon /path/to/x3d-blender-io/source [--samples 384]

Follows the Loom Blender bake stage: generator not file; albedo per face corner
in `Alb` (alpha = emissive share); Cycles vertex-colour DIFFUSE bake (direct +
indirect, colour pass off, so it holds light only); finish in Python
(exposure on the 70th-percentile ground corner, light floor, x albedo, sRGB,
soft shoulder, emissive share); export X3D 4.0 with the add-on; strip
materials so X_ITE draws the corners unlit; weld ColorRGBA to Color.
Writes assets/city-baked.x3d and assets/bake-receipt.json.
"""
import argparse
import hashlib
import importlib
import json
import math
import os
import re
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

import bpy  # first: bmesh and mathutils load with it
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")


def X(p):
    """X3D (x, y, z), Y up  ->  Blender (x, -z, y), Z up."""
    return Vector((p[0], -p[2], p[1]))


class Builder:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.alb = self.bm.loops.layers.float_color.new("Alb")

    def _paint(self, faces, rgb, emit=0.0):
        for f in faces:
            for lp in f.loops:
                lp[self.alb] = (rgb[0], rgb[1], rgb[2], emit)

    def box(self, c, size, rgb, emit=0.0, bevel=0.0, top_rgb=None, top_emit=None, grid=0):
        """Axis-aligned box. c = X3D centre of the BOTTOM face; size = (w, h, d).
        grid > 0 subdivides the top face into a grid, so a vertex bake can hold the
        shadows and occlusion that fall on it (a single quad holds four values)."""
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        for v in tmp.verts:
            v.co = Vector((v.co.x * size[0], v.co.y * size[2], (v.co.z + 0.5) * size[1]))
        if bevel > 0:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel, segments=2, affect='EDGES',
                            profile=0.5)
        if grid > 0:
            tmp.faces.ensure_lookup_table()
            top = max(tmp.faces, key=lambda fc: (fc.normal.z, fc.calc_area()))
            bmesh.ops.subdivide_edges(tmp, edges=list(top.edges), cuts=grid, use_grid_fill=True)
        base = X(c)
        for v in tmp.verts:
            v.co += base
        self._merge(tmp, rgb, emit, top_rgb, top_emit)

    def cyl(self, c, r, h, rgb, emit=0.0, seg=24, r2=None):
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=r, radius2=r if r2 is None else r2, depth=h)
        for v in tmp.verts:
            v.co.z += h / 2
            v.co += X(c)
        self._merge(tmp, rgb, emit)

    def pyramid(self, c, w, h, rgb, emit=0.0):
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=4, radius1=w * 0.7071,
                              radius2=0.0, depth=h)
        bmesh.ops.rotate(tmp, verts=tmp.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 4, 3, 'Z'))
        for v in tmp.verts:
            v.co.z += h / 2
            v.co += X(c)
        self._merge(tmp, rgb, emit)

    def _merge(self, tmp, rgb, emit, top_rgb=None, top_emit=None):
        me = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me)
        tmp.free()
        n0 = len(self.bm.faces)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        self.bm.faces.ensure_lookup_table()
        new = [self.bm.faces[i] for i in range(n0, len(self.bm.faces))]
        self._paint(new, rgb, emit)
        if top_rgb is not None:
            top = [f for f in new if f.normal.z > 0.9 and f.calc_center_median().z >= max(v.co.z for g in new for v in g.verts) - 1e-4]
            self._paint(top, top_rgb, emit if top_emit is None else top_emit)

    def finish(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


GROUND = hexrgb("#1d2935")
TRACE = hexrgb("#8a5a2b")
DISTRICT = hexrgb("#222c36")
SECTION = {".text": hexrgb("#5d86a3"), ".plt.sec": hexrgb("#7a6f93"), ".plt.got": hexrgb("#7a6f93"),
           ".init": hexrgb("#5c9a7c"), ".fini": hexrgb("#5c9a7c")}
WINDOW = hexrgb("#9fe2ff")
HEAT = hexrgb("#ff8a3d")
GOLD = hexrgb("#ffc94d")
VAULT = hexrgb("#3d4f63")
PED = hexrgb("#2b3642")


def build(layout):
    P = layout["plinth"]
    g = Builder("Ground")
    cx, cz = (P["x0"] + P["x1"]) / 2, (P["z0"] + P["z1"]) / 2
    g.box((cx, -0.6, cz), (P["x1"] - P["x0"], 0.6, P["z1"] - P["z0"]), GROUND, bevel=0.12, grid=88)
    # copper traces on a 1.4 m pitch PCB grid, skipping building footprints
    occupied = [(b["x"], b["z"], b["w"] / 2 + 0.6) for b in layout["buildings"]]

    def free(x, z):
        return all(abs(x - ox) > r or abs(z - oz) > r for ox, oz, r in occupied)
    pitch = 1.4
    zz = P["z0"] + 1.2
    while zz < P["z1"] - 1.0:
        xx = P["x0"] + 1.0
        while xx < P["x1"] - 1.0:
            # short segments, deterministic gaps: a board, not a wallpaper
            k = int((xx * 7.3 + zz * 3.1) * 10) % 7
            if k < 4 and free(xx, zz) and free(xx + pitch, zz):
                g.box((xx + pitch / 2, 0.0, zz), (pitch, 0.035, 0.09), TRACE, bevel=0.0)
            if k in (1, 5) and free(xx, zz):
                g.cyl((xx, 0.0, zz), 0.13, 0.05, TRACE, seg=8)
            xx += pitch
        zz += pitch
    for d in layout["districts"]:
        g.box(((d["x0"] + d["x1"]) / 2, 0.0, (d["z0"] + d["z1"]) / 2),
              (d["x1"] - d["x0"], 0.16, d["z1"] - d["z0"]), DISTRICT, bevel=0.05,
              grid=max(8, int((d["x1"] - d["x0"]) / 0.6)))
    # helix pedestal: stepped drum
    H = layout["helix"]
    for i, (r, h) in enumerate(((5.6, 0.25), (4.6, 0.5), (3.9, 0.75))):
        g.cyl((H["x"], 0.0, H["z"]), r, h, PED, seg=64)
    g.cyl((H["x"], 0.0, H["z"]), 0.35, H["rungs"][-1]["y"] + 1.6, PED, seg=16)
    ground = g.finish()

    c = Builder("City")
    for b in layout["buildings"]:
        alb = SECTION.get(b["section"], SECTION[".text"])
        base_y = 0.16 if b["role"] != "loader" or True else 0.0
        if b["role"] == "import":
            # an import is a gate: two posts and a lintel, the PLT stub you walk through
            w, h = b["w"], b["h"] + 0.8
            for s in (-1, 1):
                c.box((b["x"] + s * w * 0.36, base_y, b["z"]), (0.32, h, 0.5), alb, bevel=0.04)
            hot = b["name"].startswith("ptrace")
            c.box((b["x"], base_y + h, b["z"]), (w, 0.32, 0.62), HEAT if hot else alb,
                  emit=0.9 if hot else 0.0, bevel=0.04)
            continue
        if b["name"] == "derive":
            alb = VAULT
        tiers = b["tiers"]
        y = base_y
        w = b["w"]
        for t in range(tiers):
            th = b["h"] / tiers
            c.box((b["x"], y, b["z"]), (w, th, w), alb, bevel=0.05)
            # window ledges every 0.55 m: AO stripes the bake will pick up
            k = 0.45
            while k < th - 0.25:
                c.box((b["x"], y + k, b["z"]), (w + 0.08, 0.07, w + 0.08), WINDOW, emit=0.55)
                k += 0.55
            y += th
            w *= 0.78
        if b["anti"]:
            c.box((b["x"], y, b["z"]), (w * 1.08, 0.34, w * 1.08), HEAT, emit=1.0, bevel=0.03)
            y += 0.34
        if b["role"] == "gatekeeper":
            c.pyramid((b["x"], y, b["z"]), w * 0.9, 2.2, GOLD, emit=0.9)
            c.cyl((b["x"], y + 2.2, b["z"]), 0.06, 1.6, GOLD, emit=1.0, seg=8)
        if b["name"] == "derive":
            # the vault: a dome over the serial algorithm
            c.cyl((b["x"], y, b["z"]), w * 0.48, 0.5, VAULT, seg=32, r2=w * 0.2)
    city = c.finish()
    return [ground, city]


def bake_material():
    m = bpy.data.materials.new("BakeAlb")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Alb"
    attr.attribute_type = 'GEOMETRY'
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    # emissive parts light their neighbours (hot roofs, gold crown, window ledges)
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = 7.0
    nt.links.new(attr.outputs["Alpha"], mul.inputs[0])
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Emission Color"])
    nt.links.new(mul.outputs[0], bsdf.inputs["Emission Strength"])
    bsdf.inputs["Roughness"].default_value = 0.62
    return m


def light_rig(cfg):
    sc = bpy.context.scene
    sun = bpy.data.lights.new("Key", 'SUN')
    sun.energy = cfg["sun_strength"]
    sun.color = cfg["sun_color"]
    sun.angle = math.radians(cfg["sun_disc_deg"])
    ob = bpy.data.objects.new("Key", sun)
    az, el = math.radians(cfg["sun_az_deg"]), math.radians(cfg["sun_el_deg"])
    ob.rotation_euler = (math.pi / 2 - el, 0.0, az)
    sc.collection.objects.link(ob)
    w = bpy.data.worlds.new("Night")
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*cfg["sky_color"], 1.0)
    bg.inputs["Strength"].default_value = cfg["sky_strength"]
    sc.world = w
    return ob


def bake(objs, samples, seed):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.sample_clamp_indirect = 4.0
    sc.cycles.seed = seed
    sc.render.bake.target = 'VERTEX_COLORS'
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    mat = bake_material()
    for ob in objs:
        me = ob.data
        me.materials.clear()
        me.materials.append(mat)
        if "Bake" not in me.color_attributes:
            me.color_attributes.new("Bake", 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = me.color_attributes["Bake"]
    for ob in objs:
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        t = time.time()
        bpy.ops.object.bake(type='DIFFUSE')
        print(f"[bake] {ob.name}: {len(ob.data.polygons)} faces, {len(ob.data.loops)} corners, {time.time() - t:.1f} s")


def finish(objs, cfg):
    ground = objs[0]
    lum = sorted(0.2126 * c.color[0] + 0.7152 * c.color[1] + 0.0722 * c.color[2]
                 for c in ground.data.color_attributes["Bake"].data)
    p70 = lum[int(0.70 * (len(lum) - 1))] or 1.0
    k = cfg["exposure_target"] / p70
    floor = cfg["light_floor"]
    stats = {}
    for ob in objs:
        me = ob.data
        bake_d = me.color_attributes["Bake"].data
        alb_d = me.color_attributes["Alb"].data
        out = me.color_attributes.new("Col", 'FLOAT_COLOR', 'CORNER')
        ls = []
        for i, (bk, al) in enumerate(zip(bake_d, alb_d)):
            emit = al.color[3]
            rgb = []
            for ch in range(3):
                light = max(bk.color[ch] * k, floor[ch])
                v = srgb(min(light * al.color[ch], 4.0))
                if v > 0.8:                      # soft shoulder, never reaches 1
                    v = 0.8 + 0.2 * (1 - math.exp(-(v - 0.8) / 0.2))
                glow = srgb(min(al.color[ch] * 1.15, 1.0))
                v = (1 - 0.75 * emit) * v + 0.75 * emit * glow
                rgb.append(max(0.0, min(0.999, v)))
            out.data[i].color = (*rgb, 1.0)
            ls.append(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2])
        ls.sort()
        stats[ob.name] = {f"p{q}": round(ls[int(q / 100 * (len(ls) - 1))], 4) for q in (5, 25, 50, 75, 95)}
        me.color_attributes.active_color = out
        for nm in ("Bake",):
            me.color_attributes.remove(me.color_attributes[nm])
        me.color_attributes.render_color_index = me.color_attributes.find("Col")
    return {"p70_ground_raw": p70, "exposure_k": k, "display_percentiles": stats}


def export(addon_src, path):
    tmpdir = tempfile.mkdtemp(prefix="x3dio-")
    os.symlink(addon_src, os.path.join(tmpdir, "io_scene_x3d"))
    sys.path.insert(0, tmpdir)
    mod = importlib.import_module("io_scene_x3d")
    try:
        mod.register()
    except Exception as e:  # already registered
        print("[export] register:", e)
    for ob in list(bpy.data.objects):
        if ob.type != 'MESH':
            bpy.data.objects.remove(ob)
    for ob in bpy.data.objects:
        ob.data.color_attributes.remove(ob.data.color_attributes["Alb"])
    res = bpy.ops.export_scene.x3d(filepath=path, x3d_version='X3D40', use_selection=False,
                                   use_triangulate=True, use_normals=False, use_compress=False)
    print("[export]", res)
    return getattr(mod, "bl_info", {}).get("version") or "?"


def postprocess(src, dst):
    """Unlit corners: drop materials, background, nav, lights; weld ColorRGBA alpha 1 to Color;
    shorten numbers."""
    tree = ET.parse(src)
    root = tree.getroot()
    scene = root.find("Scene")
    stats = {"removed": {}, "shapes": 0}
    for parent in list(root.iter()):
        for ch in list(parent):
            if ch.tag in ("Material", "PhysicalMaterial", "Background", "NavigationInfo", "DirectionalLight",
                          "PointLight", "SpotLight", "Viewpoint", "WorldInfo", "TextureTransform"):
                parent.remove(ch)
                stats["removed"][ch.tag] = stats["removed"].get(ch.tag, 0) + 1
    for el in root.iter():
        if el.tag == "ColorRGBA":
            vals = el.get("color", "").split()
            if all(abs(float(vals[i]) - 1.0) < 1e-6 for i in range(3, len(vals), 4)):
                rgb = [vals[i + j] for i in range(0, len(vals), 4) for j in range(3)]
                el.tag = "Color"
                el.attrib.pop("color")
                el.set("color", " ".join(f"{float(v):.3f}".rstrip("0").rstrip(".") for v in rgb))
        if el.tag == "Coordinate":
            el.set("point", " ".join(f"{float(v):.4f}".rstrip("0").rstrip(".") or "0" for v in el.get("point").split()))
        if el.tag == "Shape":
            stats["shapes"] += 1
    head = root.find("head")
    if head is not None:
        for m in list(head):
            if m.get("name") in ("creator", "filename", "identifier", "file"):
                head.remove(m)
    ET.indent(tree, space=" ")
    tree.write(dst, encoding="UTF-8", xml_declaration=True)
    return stats


def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--addon", required=True)
    ap.add_argument("--samples", type=int, default=384)
    ap.add_argument("--out", default=os.path.join(ROOT, "assets"))
    a = ap.parse_args([x for x in sys.argv[1:] if x != "--"])
    cfg = {"sun_strength": 4.0, "sun_color": (1.0, 0.9, 0.78), "sun_disc_deg": 6.0,
           "sun_az_deg": 220.0, "sun_el_deg": 42.0, "sky_color": (0.18, 0.26, 0.45), "sky_strength": 0.55,
           "exposure_target": 0.55, "light_floor": (0.05, 0.07, 0.12), "seed": 74}
    with open(os.path.join(ROOT, "data", "layout.json"), encoding="utf-8") as fh:
        layout = json.load(fh)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    t0 = time.time()
    objs = build(layout)
    light_rig(cfg)
    bake(objs, a.samples, cfg["seed"])
    fin = finish(objs, cfg)
    os.makedirs(a.out, exist_ok=True)
    raw = os.path.join(tempfile.mkdtemp(), "raw.x3d")
    ver = export(a.addon, raw)
    dst = os.path.join(a.out, "city-baked.x3d")
    pp = postprocess(raw, dst)
    rec = {"asset": "city-baked.x3d", "sha256": sha(dst), "bytes": os.path.getsize(dst),
           "blender": bpy.app.version_string, "exporter": "x3d-blender-io " + ".".join(map(str, ver)) if ver != "?" else "x3d-blender-io",
           "script_sha256": sha(os.path.abspath(__file__)), "layout_sha256": sha(os.path.join(ROOT, "data", "layout.json")),
           "bake": {"engine": "CYCLES", "device": "CPU", "samples": a.samples, "denoise": False,
                    "clamp_indirect": 4.0, "seed": cfg["seed"], "target": "VERTEX_COLORS", "type": "DIFFUSE",
                    "direct": True, "indirect": True, "color_pass": False},
           "light": cfg, "finish": fin, "postprocess": pp,
           "meshes": {ob.name: {"faces": len(ob.data.polygons), "corners": len(ob.data.loops)} for ob in objs},
           "seconds": round(time.time() - t0, 1)}
    with open(os.path.join(a.out, "bake-receipt.json"), "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=1)
    print(json.dumps({k: rec[k] for k in ("bytes", "blender", "exporter", "seconds", "meshes")}, indent=1))


if __name__ == "__main__":
    main()
