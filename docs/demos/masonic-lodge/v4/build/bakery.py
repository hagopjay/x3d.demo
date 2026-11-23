# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2: bake Cycles light into image textures and hand the exporter unlit textured materials.

For each baked object:
  1. a fresh UV map "Bake" from Smart UV Project, packed with a margin; the image size follows the surface area
     (texels per metre per zone), rounded to a power of two between 256 and 4096;
  2. a 32-bit float image; Cycles bakes COMBINED (diffuse and glossy, direct and indirect, emission) from the
     procedural materials and the scene lights, so albedo, bump, shadow, colour bleeding and AO land in one image;
  3. the float pixels go through one tone curve per zone (exposure, then a filmic shoulder) and are written as JPEG
     (sRGB, quality 88);
  4. the object's materials are replaced by one Emission material reading that JPEG through "Bake".
x3d-blender-io then writes Appearance { ImageTexture, UnlitMaterial } and a TextureCoordinate per Shape.
"""
import json
import math
import os
import time

import bpy
import numpy as np
from mathutils import Vector


def pow2(n):
    return int(2 ** round(math.log2(max(256, min(4096, n)))))


def area(ob):
    m = ob.matrix_world
    return sum((m.to_3x3() @ p.normal).length * 0 + p.area for p in ob.data.polygons) * max(abs(v) for v in m.to_scale())


def fit_uv(ob):
    """Scale the packed UVs to fill [0, 1] on both axes and return the island bbox aspect (w / h) before scaling,
    so a long wall gets a long image at the same texel density instead of half an empty square."""
    uv = ob.data.uv_layers["Bake"].data
    co = np.empty(len(uv) * 2, dtype=np.float32)
    uv.foreach_get("uv", co)
    co = co.reshape(-1, 2)
    lo, hi = co.min(0), co.max(0)
    span = np.maximum(hi - lo, 1e-6)
    co = (co - lo) / span
    co = 0.004 + co * 0.992
    uv.foreach_set("uv", co.ravel())
    return float(span[0] / span[1])


def unwrap(ob, margin=0.004):
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name="Bake")
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    ob.hide_viewport = False
    ob.hide_set(False)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    if bpy.context.object is not ob or ob.mode != "EDIT":
        raise RuntimeError("could not enter edit mode on %r" % ob.name)
    bpy.ops.mesh.select_all(action="SELECT")
    print("UNWRAP", ob.name, len(ob.data.polygons), ob.mode, ob.type, bpy.context.mode, bpy.ops.uv.smart_project.poll())
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=1.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def unwrap_slope(ob, cx, cy, slope_deg):
    """UVs for a stepped pyramid: every face is projected onto the plane of its own side (the side picked from the face
    centre), so the risers and treads of one side make one continuous island with no gaps; sides are packed one per cell.
    Smart UV Project would make one thin island per riser, and mipmaps then mix in the empty texels between them."""
    a = math.radians(slope_deg)
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    uvl = me.uv_layers.new(name="Bake")
    sides = {}
    for p in me.polygons:
        c = p.center
        dx, dy = c.x - cx, c.y - cy
        if abs(p.normal.z) > 0.99 and p.normal.z < 0:
            side = "B"
        else:
            side = ("E" if dx > 0 else "W") if abs(dx) >= abs(dy) else ("N" if dy > 0 else "S")
        sides.setdefault(side, []).append(p.index)
    # along-side axis u and up-slope axis v per side (v grows toward the apex)
    ax = {"N": ((-1, 0, 0), (0, -math.cos(a), math.sin(a))), "S": ((1, 0, 0), (0, math.cos(a), math.sin(a))),
          "E": ((0, 1, 0), (-math.cos(a), 0, math.sin(a))), "W": ((0, -1, 0), (math.cos(a), 0, math.sin(a))),
          "B": ((1, 0, 0), (0, 1, 0))}
    order = [s for s in ("N", "E", "S", "W", "B") if s in sides]
    cols = 1 if len(order) == 1 else 2
    rows = (len(order) + cols - 1) // cols
    raw = {}
    for s in order:
        uax, vax = (Vector(v) for v in ax[s])
        pts = []
        for pi in sides[s]:
            for li in me.polygons[pi].loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                pts.append((li, co.dot(uax), co.dot(vax)))
        raw[s] = pts
    span = max(max(max(u for _, u, _ in pts) - min(u for _, u, _ in pts), max(v for _, _, v in pts) - min(v for _, _, v in pts)) for pts in raw.values())
    pad = 0.01
    for k, s in enumerate(order):
        pts = raw[s]
        u0, v0 = min(u for _, u, _ in pts), min(v for _, _, v in pts)
        cu, cv = (k % cols) / cols, (k // cols) / rows
        sc = (1.0 / max(cols, rows) - 2 * pad) / span
        for li, u, v in pts:
            uvl.data[li].uv = (cu + pad + (u - u0) * sc, cv + pad + (v - v0) * sc)


def tone(px, exposure, shoulder=0.9, sat=1.0):
    """Linear scene light -> display sRGB. Exposure in stops, then the Narkowicz ACES filmic fit so lamps and the
    light well roll off instead of clipping, then the sRGB transfer."""
    rgb = px[..., :3] * (2.0 ** exposure)
    if sat != 1.0:
        lum = (rgb @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
        rgb = lum + (rgb - lum) * sat
    x = np.maximum(rgb, 0) * 0.6
    t = np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)
    srgb = np.where(t <= 0.0031308, 12.92 * t, 1.055 * np.power(t, 1 / 2.4) - 0.055)
    out = px.copy()
    out[..., :3] = srgb
    out[..., 3] = 1.0
    return out


def _bake(ob, img, kind, passes, samples):
    nodes = []
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
        nodes.append((nt, n))
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.bake.target = "IMAGE_TEXTURES"
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type=kind, pass_filter=passes, margin=8)
    for nt, n in nodes:
        nt.nodes.remove(n)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def _upsample(a, k):
    """Bilinear upsample by an integer factor (light is smooth, so this costs nothing visible)."""
    if k == 1:
        return a
    def axis(n):
        x = (np.arange(n * k) + 0.5) / k - 0.5
        i0 = np.clip(np.floor(x).astype(int), 0, n - 1)
        return i0, np.clip(i0 + 1, 0, n - 1), np.clip(x - np.floor(x), 0, 1)
    i0, i1, f = axis(a.shape[0])
    a = a[i0] * (1 - f)[:, None, None] + a[i1] * f[:, None, None]
    j0, j1, g = axis(a.shape[1])
    return a[:, j0] * (1 - g)[None, :, None] + a[:, j1] * g[None, :, None]


def _blur(a, r=1):
    out = a.copy()
    for ax in (0, 1):
        acc = np.zeros_like(out)
        for d in range(-r, r + 1):
            acc += np.roll(out, d, axis=ax)
        out = acc / (2 * r + 1)
    return out


def bake_object(ob, out_dir, texels_per_m, samples, exposure, sat=1.0, max_px=4096, rel_dir="tex", light_div=4,
                combined=False, gloss=False, cull=True, uv=None):
    """Split bake: albedo (DIFFUSE colour, 4 samples) at full size, light (DIFFUSE direct + indirect plus GLOSSY)
    at 1/light_div size with `samples`; display = tone(albedo x light + glossy). combined=True bakes COMBINED at full
    size instead (small gilt objects, where the sheen matters)."""
    t0 = time.time()
    if uv:
        uv(ob)
    else:
        unwrap(ob)
    aspect = fit_uv(ob)
    a = sum(p.area for p in ob.data.polygons)
    n = math.sqrt(a) * texels_per_m * 1.15
    sw = pow2(min(max_px, n * math.sqrt(aspect)))
    sh = pow2(min(max_px, n / math.sqrt(aspect)))
    side = max(sw, sh)
    name = "".join(ch if ch.isalnum() else "-" for ch in ob.name.lower()).strip("-")
    while "--" in name:
        name = name.replace("--", "-")
    if combined:
        img = bpy.data.images.new("c_" + name, sw, sh, alpha=False, float_buffer=True)
        lit = _bake(ob, img, "COMBINED", {"DIRECT", "INDIRECT", "DIFFUSE", "GLOSSY", "EMIT"}, samples)[..., :3]
        bpy.data.images.remove(img)
        light_side = side
    else:
        light_side = max(128, side // light_div)
        k = max(1, min(light_div, min(sw, sh) // 64))
        lw, lh = sw // k, sh // k
        img = bpy.data.images.new("a_" + name, sw, sh, alpha=False, float_buffer=True)
        alb = _bake(ob, img, "DIFFUSE", {"COLOR"}, 4)[..., :3]
        bpy.data.images.remove(img)
        img = bpy.data.images.new("l_" + name, lw, lh, alpha=False, float_buffer=True)
        light = _bake(ob, img, "DIFFUSE", {"DIRECT", "INDIRECT"}, samples)[..., :3]
        bpy.data.images.remove(img)
        if gloss:
            img = bpy.data.images.new("g_" + name, lw, lh, alpha=False, float_buffer=True)
            gl = _bake(ob, img, "GLOSSY", {"DIRECT", "INDIRECT", "COLOR"}, max(16, samples // 2))[..., :3]
            bpy.data.images.remove(img)
        else:
            gl = None
        light_side = max(lw, lh)
        light = _upsample(_blur(light, 1), k)
        lit = alb * light + (_upsample(_blur(gl, 1), k) * 0.6 if gl is not None else 0.0)
    os.makedirs(os.path.join(out_dir, "cache"), exist_ok=True)
    np.save(os.path.join(out_dir, "cache", name + ".npy"), lit.astype(np.float16))
    os.makedirs(os.path.join(out_dir, rel_dir), exist_ok=True)
    path = os.path.join(out_dir, rel_dir, name + ".jpg")
    write_jpeg(lit, path, exposure, sat)
    stats = dict(p50=float(np.percentile(lit.mean(-1), 50)), p99=float(np.percentile(lit.mean(-1), 99)))
    # the exporter-facing material: Emission(ImageTexture) on UV "Bake"
    shown = bpy.data.images.load(path)
    shown.colorspace_settings.name = "sRGB"
    m = bpy.data.materials.new("Baked " + ob.name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = shown
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(tex.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    m.use_backface_culling = cull
    ob.data.materials.clear()
    ob.data.materials.append(m)
    rec = dict(object=ob.name, image=os.path.join(rel_dir, name + ".jpg"), px=[sw, sh], light_px=light_side, mode="combined" if combined else "split", area_m2=round(a, 1),
               texels_per_m=round(side / math.sqrt(max(a, 1e-6)), 1), samples=samples, exposure=exposure,
               linear_p50=round(stats["p50"], 4), linear_p99=round(stats["p99"], 4), seconds=round(time.time() - t0, 1),
               jpeg_bytes=os.path.getsize(path))
    print("BAKED", json.dumps(rec))
    return rec


def write_jpeg(lit, path, exposure, sat=1.0):
    h, w = lit.shape[:2]
    px = np.concatenate([lit, np.ones((h, w, 1), np.float32)], -1)
    disp = tone(px, exposure, sat=sat)
    outimg = bpy.data.images.new("tex_out", w, h, alpha=False)
    outimg.colorspace_settings.name = "sRGB"
    outimg.pixels.foreach_set(disp.astype(np.float32).ravel())
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 88
    outimg.save_render(path, scene=scene)
    bpy.data.images.remove(outimg)
    img = bpy.data.images.get(os.path.basename(path))
    if img:
        img.reload()


def setup_cycles(samples=128):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    # BAKE_DEVICE: OPTIX or CUDA on an NVIDIA box (the G4 run), METAL on this Mac (measured no faster than CPU for
    # bakes on the M3), CPU anywhere. Falls back to CPU if the requested backend has no device.
    want = os.environ.get("BAKE_DEVICE", "METAL").upper()
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        if want == "CPU":
            raise RuntimeError("CPU requested")
        prefs.compute_device_type = want
        prefs.refresh_devices() if hasattr(prefs, "refresh_devices") else prefs.get_devices()
        devs = [d for d in prefs.devices if d.type == want]
        if not devs:
            raise RuntimeError("no %s device" % want)
        for d in prefs.devices:
            d.use = d.type == want
        scene.cycles.device = "GPU"
        print("BAKE DEVICE", want, [d.name for d in devs])
    except Exception as e:  # noqa: BLE001
        scene.cycles.device = "CPU"
        print("BAKE DEVICE CPU (", e, ")")
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 2
    scene.cycles.sample_clamp_indirect = 8.0
    scene.view_settings.view_transform = "Standard"      # tone() does the display transform; save_render must not
    scene.view_settings.look = "None"
