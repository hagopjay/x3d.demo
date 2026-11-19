# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 65 v4: the Giza plateau with light baked in Blender Cycles, twice (golden hour and moonlit night).
usage: python build_plateau.py OUT_DIR [--preview]
Pyramid sizes and spacing are Petrie 1883 (s.21, s.25, s.66, s.67, s.80, s.81, s.92), the Great Pyramid's base is Dash 2015.
Course heights, today's missing tops, the queens' pyramids, the ground relief and the base levels are ILLUSTRATIVE.
The moon stands in the north-west (azimuth 300) so that the faces seen under the southern sky are lit: a stage light.
Writes: plateau.blend, pyramids-day.x3d, pyramids-night.x3d (add-on exports), ground-day.png, ground-night.png (light x albedo,
display values), ground.json (the height field for an X3D ElevationGrid), hero-cycles.png, bake-receipt.json."""
import hashlib, json, math, os, sys, time
import bpy, bmesh
import numpy as np
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else sys.argv[1]
PREVIEW = "--preview" in sys.argv
os.makedirs(OUT, exist_ok=True)
IN = 0.0254
SAMPLES = 48 if PREVIEW else 256
TEX = 1024 if PREVIEW else 2048          # light
ATEX = 2048 if PREVIEW else 4096         # albedo detail and the finished lightmap
TEX_SAMPLES = 16 if PREVIEW else 96
rng = np.random.default_rng(65)

# ---- survey -------------------------------------------------------------------------------------------------------------
KHUFU = dict(name="Khufu", c=(0.0, 0.0), base=230.363, slope=math.radians(51 + 52 / 60), top=138.75, courses=203, z=0.0)
KHAFRE = dict(name="Khafre", c=(-13165.8 * IN, -13931.6 * IN), base=8474.9 * IN, slope=math.radians(53 + 10 / 60), top=136.4, courses=124, z=10.0, cap_from=0.70)
MENKAURE = dict(name="Menkaure", c=(-22616.0 * IN, -29102.0 * IN), base=4153.6 * IN, slope=math.atan2(2564.0, 4153.6 / 2), top=61.0, courses=62, z=10.0, granite=16)
for p in (KHUFU, KHAFRE, MENKAURE):
    p["height"] = p["base"] / 2 * math.tan(p["slope"])
QUEENS = [  # illustrative positions and sizes
    dict(name="G1a", c=(171.0, -22.0), base=49.5, slope=math.radians(51.8), top=12.0, courses=14, z=0.0),
    dict(name="G1b", c=(171.0, -82.0), base=49.0, slope=math.radians(51.8), top=15.0, courses=17, z=0.0),
    dict(name="G1c", c=(171.0, -140.0), base=46.3, slope=math.radians(51.7), top=18.0, courses=20, z=0.0),
    dict(name="G3a", c=(MENKAURE["c"][0] + 0.0, MENKAURE["c"][1] - 92.0), base=44.0, slope=math.radians(52.2), top=22.0, courses=22, z=10.0),
    dict(name="G3b", c=(MENKAURE["c"][0] - 46.0, MENKAURE["c"][1] - 92.0), base=31.2, slope=math.radians(52.0), top=9.0, courses=4, z=10.0, stepped=True),
    dict(name="G3c", c=(MENKAURE["c"][0] - 86.0, MENKAURE["c"][1] - 92.0), base=31.2, slope=math.radians(52.0), top=9.0, courses=4, z=10.0, stepped=True),
]
LIME, CASING, GRANITE, SAND = np.array([0.62, 0.45, 0.27]), np.array([0.78, 0.65, 0.46]), np.array([0.40, 0.23, 0.17]), np.array([0.66, 0.46, 0.25])

# ---- ground -------------------------------------------------------------------------------------------------------------
G_N, G_CELL = 241, 16.0
G_X0, G_Y1 = -290.0 - (G_N - 1) * G_CELL / 2, -370.0 + (G_N - 1) * G_CELL / 2      # west edge, north edge
G_L = (G_N - 1) * G_CELL
EDGE_Z = -14.0


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def ground_height(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    pads = [(KHUFU, 0.0), (KHAFRE, 10.0), (MENKAURE, 10.0)]
    wsum, hsum, near = 0, 0, np.full(np.broadcast(x, y).shape, 1e9)
    for p, lvl in pads:
        d = np.maximum(np.abs(x - p["c"][0]), np.abs(y - p["c"][1])) - p["base"] / 2
        d = np.maximum(d, 0)
        w = 1 / (d + 30.0) ** 2
        wsum, hsum, near = wsum + w, hsum + w * lvl, np.minimum(near, d)
    base = hsum / wsum
    n = (np.sin(x * 0.0061 + 1.3) * np.cos(y * 0.0047 - 0.4) * 5.5 + np.sin(x * 0.0173 - y * 0.0131) * 3.0
         + np.sin(x * 0.041 + 0.7) * np.sin(y * 0.037 + 2.1) * 0.9 + np.sin((x + y) * 0.093) * np.sin((x - y) * 0.081) * 0.35)
    east = -22.0 * smooth(260, 900, x) - 10.0 * smooth(-200, -1200, y)             # the plateau falls toward the valley
    h = base + (n + east) * smooth(40, 260, near)
    cx, cy = G_X0 + G_L / 2, G_Y1 - G_L / 2
    border = smooth(G_L / 2 - 260, G_L / 2 - 20, np.maximum(np.abs(x - cx), np.abs(y - cy)))
    return h * (1 - border) + EDGE_Z * border


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


reset()
scene = bpy.context.scene


def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def add_quad(bm, alb, pts, col):
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    for lp in f.loops:
        lp[alb] = (*col, 1.0)
    return f


def course_heights(n, total):
    h = rng.lognormal(0.0, 0.22, n)
    for k in (0, 1, 34, 35, 43, 97, 98):          # a few thick courses, as on the real core
        if k < n:
            h[k] *= 1.7
    return h * total / h.sum()


def stepped(p):
    """Stepped core of a pyramid as it stands today: risers and treads, each split into blocks of varied tone."""
    bm = bmesh.new(); alb = bm.loops.layers.float_color.new("Alb")
    cx, cy = p["c"]; z = p["z"]; inset = 0.012 * p["base"]
    core_top = p["top"] if "cap_from" not in p else p["top"]
    hs = course_heights(p["courses"], core_top)
    tan = math.tan(p["slope"])
    z0 = 0.0
    for k, ch in enumerate(hs):
        z1 = z0 + ch
        w0 = p["base"] / 2 - inset - z0 / tan
        w1 = p["base"] / 2 - inset - z1 / tan if k < len(hs) - 1 else 0.0
        if w0 <= 0.5:
            break
        base_col = GRANITE if k < p.get("granite", 0) else LIME
        tone = 1.0 + rng.normal(0, 0.05)
        nseg = max(1, int(round(2 * w0 / rng.uniform(14, 26))))
        cuts = np.sort(np.concatenate([[-1.0, 1.0], rng.uniform(-1, 1, nseg - 1)]))
        for side in range(4):
            ca, sa = math.cos(side * math.pi / 2), math.sin(side * math.pi / 2)
            def P(u, v, zz):                      # u along the side, v outward
                return (cx + u * ca - v * sa, cy + u * sa + v * ca, z + zz)
            for a, b in zip(cuts[:-1], cuts[1:]):
                col = np.clip(base_col * tone * (1.0 + rng.normal(0, 0.07)) * (0.93 + 0.14 * z0 / core_top), 0.02, 0.95)
                add_quad(bm, alb, [P(a * w0, -w0, z0), P(b * w0, -w0, z0), P(b * w0, -w0, z1), P(a * w0, -w0, z1)], col)   # riser
                tcol = np.clip(col * 1.04, 0.02, 0.95)
                add_quad(bm, alb, [P(a * w0, -w0, z1), P(b * w0, -w0, z1), P(b * w1, -w1, z1), P(a * w1, -w1, z1)], tcol)  # tread
        z0 = z1
    return new_obj(p["name"], bm)


def casing_cap(p):
    """Khafre's surviving casing: a smooth frustum standing proud of the core near the top."""
    bm = bmesh.new(); alb = bm.loops.layers.float_color.new("Alb")
    cx, cy = p["c"]; z = p["z"]; tan = math.tan(p["slope"])
    za, zb = p["cap_from"] * p["height"], p["top"] + 3.0
    NU, NV = 10, 8
    for side in range(4):
        ca, sa = math.cos(side * math.pi / 2), math.sin(side * math.pi / 2)
        def P(u, zz):
            w = p["base"] / 2 - zz / tan
            return (cx + u * w * ca + w * sa, cy + u * w * sa - w * ca, z + zz)
        for i in range(NU):
            for j in range(NV):
                u0, u1 = -1 + 2 * i / NU, -1 + 2 * (i + 1) / NU
                # ragged lower edge
                lo = za + (rng.uniform(-3.5, 3.5) if j == 0 else 0)
                zz0 = (lo if j == 0 else za + (zb - za) * j / NV); zz1 = za + (zb - za) * (j + 1) / NV
                col = np.clip(CASING * (1 + rng.normal(0, 0.05)), 0.02, 0.95)
                add_quad(bm, alb, [P(u0, zz0), P(u1, zz0), P(u1, zz1), P(u0, zz1)], col)
    w = p["base"] / 2 - zb / tan
    add_quad(bm, alb, [(cx - w, cy - w, z + zb), (cx + w, cy - w, z + zb), (cx + w, cy + w, z + zb), (cx - w, cy + w, z + zb)], CASING * 0.9)
    # underside lip so the cap's shadow falls on the core
    return new_obj(p["name"] + "Cap", bm)


def ground():
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap")
    xs = G_X0 + np.arange(G_N) * G_CELL; ys = G_Y1 - np.arange(G_N) * G_CELL
    X, Y = np.meshgrid(xs, ys)                       # row j = north to south
    H = ground_height(X, Y)
    vs = [[bm.verts.new((X[j, i], Y[j, i], H[j, i])) for i in range(G_N)] for j in range(G_N)]
    for j in range(G_N - 1):
        for i in range(G_N - 1):
            f = bm.faces.new([vs[j + 1][i], vs[j + 1][i + 1], vs[j][i + 1], vs[j][i]])
            for lp in f.loops:
                co = lp.vert.co
                lp[uv].uv = ((co.x - G_X0) / G_L, (G_Y1 - co.y) / G_L)
    # skirt to the horizon
    R, cx, cy = 40000.0, G_X0 + G_L / 2, G_Y1 - G_L / 2
    a, b = G_L / 2, R
    ring = [(-b, -b, b, -a), (-b, a, b, b), (-b, -a, -a, a), (a, -a, b, a)]
    for x0, y0, x1, y1 in ring:
        f = bm.faces.new([bm.verts.new((cx + x0, cy + y0, EDGE_Z)), bm.verts.new((cx + x1, cy + y0, EDGE_Z)),
                          bm.verts.new((cx + x1, cy + y1, EDGE_Z)), bm.verts.new((cx + x0, cy + y1, EDGE_Z))])
        for lp in f.loops:
            lp[uv].uv = (0.001, 0.001)
    ob = new_obj("Ground", bm)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    return ob, H


pyr = [stepped(KHUFU), stepped(KHAFRE), casing_cap(KHAFRE), stepped(MENKAURE)]
queens = [stepped(q) for q in QUEENS]
bpy.ops.object.select_all(action="DESELECT")
for q in queens:
    q.select_set(True)
bpy.context.view_layer.objects.active = queens[0]
bpy.ops.object.join()
queens[0].name = "Queens"; queens[0].data.name = "Queens"
pyr.append(queens[0])
gnd, H = ground()
for ob in pyr:
    ob.data.color_attributes.new("Bake", "FLOAT_COLOR", "CORNER")

# ---- materials ----------------------------------------------------------------------------------------------------------
mat = bpy.data.materials.new("BakeStone"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
attr = nt.nodes.new("ShaderNodeAttribute"); attr.attribute_name = "Alb"
nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"]); bsdf.inputs["Roughness"].default_value = 0.9
for ob in pyr:
    ob.data.materials.append(mat)
gmat = bpy.data.materials.new("BakeSand"); gmat.use_nodes = True
gnt = gmat.node_tree; gb = gnt.nodes["Principled BSDF"]
gb.inputs["Roughness"].default_value = 0.95
noise = gnt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 0.0045; noise.inputs["Detail"].default_value = 12.0; noise.inputs["Roughness"].default_value = 0.62
ramp = gnt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.3, 0.75
ramp.color_ramp.elements[0].color = (*(SAND * 0.80), 1); ramp.color_ramp.elements[1].color = (*(SAND * 1.12), 1)
tc = gnt.nodes.new("ShaderNodeTexCoord")
gnt.links.new(tc.outputs["Object"], noise.inputs["Vector"]); gnt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
noise2 = gnt.nodes.new("ShaderNodeTexNoise"); noise2.inputs["Scale"].default_value = 0.06; noise2.inputs["Detail"].default_value = 8.0; noise2.inputs["Roughness"].default_value = 0.7
gnt.links.new(tc.outputs["Object"], noise2.inputs["Vector"])
mixn = gnt.nodes.new("ShaderNodeMix"); mixn.data_type = "RGBA"; mixn.blend_type = "MULTIPLY"; mixn.inputs["Factor"].default_value = 0.55
ramp2 = gnt.nodes.new("ShaderNodeValToRGB")
ramp2.color_ramp.elements[0].position, ramp2.color_ramp.elements[1].position = 0.25, 0.8
ramp2.color_ramp.elements[0].color = (0.72, 0.70, 0.68, 1); ramp2.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
gnt.links.new(noise2.outputs["Fac"], ramp2.inputs["Fac"])
gnt.links.new(ramp.outputs["Color"], mixn.inputs["A"]); gnt.links.new(ramp2.outputs["Color"], mixn.inputs["B"])
gnt.links.new(mixn.outputs["Result"], gb.inputs["Base Color"])
img_node = gnt.nodes.new("ShaderNodeTexImage")
gnd.data.materials.append(gmat)

# ---- lights -------------------------------------------------------------------------------------------------------------
sun_data = bpy.data.lights.new("Key", "SUN"); sun = bpy.data.objects.new("Key", sun_data); scene.collection.objects.link(sun)
world = bpy.data.worlds.new("Sky"); scene.world = world; world.use_nodes = True
wn = world.node_tree; bgn = wn.nodes["Background"]
sky = wn.nodes.new("ShaderNodeTexSky")
try:
    sky.sky_type = "MULTIPLE_SCATTERING"
except TypeError:
    sky.sky_type = "NISHITA"
skymix = wn.nodes.new("ShaderNodeMix"); skymix.data_type = "RGBA"; skymix.blend_type = "MULTIPLY"; skymix.inputs["Factor"].default_value = 1.0
wn.links.new(sky.outputs["Color"], skymix.inputs["A"])          # a dusty-air filter on the sky's fill light
LIGHTS = {
    "day": dict(elev=10.0, travel_az=68.0, color=(1.0, 0.60, 0.30), energy=7.0, disc=1.5, sky=0.16, sky_elev=10.0, sky_filter=(1.0, 0.80, 0.62),
                expose_q=70, expose_to=0.74, tint=(1.0, 0.96, 0.90), floor=(0.040, 0.042, 0.060), saturation=1.22),
    "night": dict(elev=44.0, travel_az=120.0, color=(0.70, 0.80, 1.0), energy=1.0, disc=1.0, sky=None, sky_rgb=(0.10, 0.14, 0.30),
                  sky_strength=0.35, expose_q=70, expose_to=0.12, tint=(0.26, 0.48, 1.0), floor=(0.012, 0.016, 0.030), saturation=1.25),
}


def set_light(L):
    sun_data.energy, sun_data.color, sun_data.angle = L["energy"], L["color"], math.radians(L["disc"])
    # the lamp's -Z is the direction light travels; travel_az is the compass bearing it travels toward
    sun.rotation_euler = (math.radians(90 - L["elev"]), 0, -math.radians(L["travel_az"]))
    for l in list(bgn.inputs["Color"].links):
        wn.links.remove(l)
    if L["sky"] is not None:
        sky.sun_disc = False; sky.sun_elevation = math.radians(L["sky_elev"])
        sky.sun_rotation = math.radians((L["travel_az"] + 180) % 360)
        skymix.inputs["B"].default_value = (*L.get("sky_filter", (1, 1, 1)), 1)
        wn.links.new(skymix.outputs["Result"], bgn.inputs["Color"]); bgn.inputs["Strength"].default_value = L["sky"]
    else:
        bgn.inputs["Color"].default_value = (*L["sky_rgb"], 1); bgn.inputs["Strength"].default_value = L["sky_strength"]


scene.render.engine = "CYCLES"
cy = scene.cycles
cy.device = "CPU"; cy.use_denoising = False; cy.sample_clamp_indirect = 4.0; cy.seed = 65
cy.max_bounces = 6; cy.diffuse_bounces = 4
scene.render.threads_mode = "FIXED"; scene.render.threads = 4


def read_attr(mesh, name):
    a = mesh.color_attributes[name]
    buf = np.empty(len(a.data) * 4, dtype=np.float32); a.data.foreach_get("color", buf)
    return buf.reshape(-1, 4)


def srgb(x):
    x = np.clip(x, 0, None)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def shoulder(d):
    over = np.clip(d - 0.8, 0, None)
    return np.where(d < 0.8, d, 0.8 + 0.2 * (1 - np.exp(-over / 0.2)))


def face_average(mesh, light):
    """One light value per face would lose the shadow gradient; average only corners that share a vertex and a normal."""
    n = len(mesh.loops)
    lv = np.empty(n, dtype=np.int64); mesh.loops.foreach_get("vertex_index", lv)
    return light


receipt = dict(schema="x3d.io/bake-receipt/1", blender=bpy.app.version_string, preview=PREVIEW, lights={}, meshes={}, timings={})
images = {}
for key, L in LIGHTS.items():
    set_light(L)
    t0 = time.time()
    cy.samples = SAMPLES
    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.select_all(action="DESELECT")
    for ob in pyr:
        ob.select_set(True); ob.data.color_attributes.active_color = ob.data.color_attributes["Bake"]
    bpy.context.view_layer.objects.active = pyr[0]
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, target="VERTEX_COLORS")
    t_v = time.time() - t0
    # ground: light to an image
    t0 = time.time()
    img = bpy.data.images.new("GroundLight_" + key, TEX, TEX, float_buffer=True, alpha=False)
    img_node.image = img; gnt.nodes.active = img_node
    cy.samples = TEX_SAMPLES
    scene.render.bake.target = "IMAGE_TEXTURES"; scene.render.bake.margin = 2
    bpy.ops.object.select_all(action="DESELECT"); gnd.select_set(True); bpy.context.view_layer.objects.active = gnd
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, target="IMAGE_TEXTURES")
    t_g = time.time() - t0
    light_img = np.array(img.pixels[:], dtype=np.float32).reshape(TEX, TEX, 4)[:, :, :3]
    # albedo for the ground: bake the colour pass once
    if "alb" not in images:
        aimg = bpy.data.images.new("GroundAlb", ATEX, ATEX, float_buffer=True, alpha=False)
        img_node.image = aimg; cy.samples = 1
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, target="IMAGE_TEXTURES")
        images["alb"] = np.array(aimg.pixels[:], dtype=np.float32).reshape(ATEX, ATEX, 3 + 1)[:, :, :3]
    # a 3x3 box filter twice takes the fireflies out of the light without moving shadow edges by more than a texel
    for _ in range(2):
        pad = np.pad(light_img, ((1, 1), (1, 1), (0, 0)), mode="edge")
        light_img = sum(pad[1 + dy:1 + dy + TEX, 1 + dx:1 + dx + TEX] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9.0
    centre = light_img[TEX // 4:3 * TEX // 4, TEX // 4:3 * TEX // 4].mean(axis=2)
    pq = float(np.percentile(centre, L["expose_q"]))
    exposure = L["expose_to"] / max(pq, 1e-6)
    tint, floor = np.array(L["tint"]), np.array(L["floor"])

    def finish(light, albedo):
        lin = np.maximum(light * exposure, floor) * albedo * tint
        d = shoulder(srgb(lin))
        lum = d.mean(axis=-1, keepdims=True)
        return np.clip(lum + (d - lum) * L["saturation"], 0.0, 0.999)       # a taste step: recorded in the receipt

    k = ATEX // TEX                                         # light is smooth: bake it at TEX, show it at ATEX
    if k > 1:
        idx = (np.arange(ATEX) + 0.5) / k - 0.5
        i0 = np.clip(np.floor(idx).astype(int), 0, TEX - 1); i1 = np.clip(i0 + 1, 0, TEX - 1); fr = np.clip(idx - i0, 0, 1)
        rows = light_img[i0] * (1 - fr)[:, None, None] + light_img[i1] * fr[:, None, None]
        light_big = rows[:, i0] * (1 - fr)[None, :, None] + rows[:, i1] * fr[None, :, None]
    else:
        light_big = light_img
    gdisp = finish(light_big, images["alb"])
    # fade the border of the lightmap to one colour so the skirt can match it
    edge_col = gdisp[2:6, :, :].reshape(-1, 3).mean(axis=0)
    yy, xx = np.mgrid[0:ATEX, 0:ATEX]
    d = np.maximum(np.abs(xx - ATEX / 2), np.abs(yy - ATEX / 2)) / (ATEX / 2)
    f = smooth(0.90, 0.995, d)[:, :, None]
    gdisp = gdisp * (1 - f) + edge_col * f
    out = bpy.data.images.new("GroundDisplay_" + key, ATEX, ATEX, alpha=False)
    out.colorspace_settings.name = "Non-Color"            # values are already display values: write them unchanged
    out.pixels.foreach_set(np.concatenate([gdisp, np.ones((ATEX, ATEX, 1))], axis=2).astype(np.float32).ravel())
    out.filepath_raw = os.path.join(OUT, "ground-%s.png" % key); out.file_format = "PNG"; out.save()
    stats = {}
    for ob in pyr:
        me = ob.data
        light = read_attr(me, "Bake")[:, :3]
        disp = finish(light, read_attr(me, "Alb")[:, :3])
        name = "Display_" + key
        a = me.color_attributes.new(name, "FLOAT_COLOR", "CORNER")
        a.data.foreach_set("color", np.concatenate([disp, np.ones((len(disp), 1))], axis=1).astype(np.float32).ravel())
        lum = disp.mean(axis=1)
        stats[ob.name] = {str(q): round(float(np.percentile(lum, q)), 4) for q in (5, 50, 95)}
    receipt["lights"][key] = dict(L, exposure=round(exposure, 5), edge_colour=[round(float(c), 4) for c in edge_col],
                                  ground_percentiles={str(q): round(float(np.percentile(gdisp.mean(axis=2), q)), 4) for q in (5, 50, 95)},
                                  pyramid_percentiles=stats)
    receipt["timings"][key] = dict(vertex_bake_s=round(t_v, 1), ground_bake_s=round(t_g, 1))
    print("BAKED", key, receipt["timings"][key], "exposure", exposure, flush=True)

# ---- export through the add-on, once per light --------------------------------------------------------------------------
import addon_utils
sys.path.insert(0, os.path.join(OUT, "_addon"))
addon_utils.enable("io_scene_x3d", default_set=True)
gnd.hide_set(True); sun.hide_set(True)
for key in LIGHTS:
    for ob in pyr:
        me = ob.data
        for nm in [a.name for a in me.color_attributes if a.name != "Display_" + key]:
            pass
        me.color_attributes.active_color = me.color_attributes["Display_" + key]
        me.color_attributes.render_color_index = list(me.color_attributes.keys()).index("Display_" + key)
    # the exporter writes the first colour attribute: give it a copy that holds only this light
    tmp = []
    for ob in pyr:
        me2 = ob.data.copy()
        for nm in [a.name for a in me2.color_attributes if a.name != "Display_" + key]:
            me2.color_attributes.remove(me2.color_attributes[nm])
        o2 = bpy.data.objects.new(ob.name, me2); tmp.append((o2, ob.name))
    exp_scene = bpy.data.scenes.new("Export_" + key)
    for o2, nm in tmp:
        exp_scene.collection.objects.link(o2); o2.name = nm + "_" + key
        o2.data.materials.clear()
    bpy.context.window.scene = exp_scene
    bpy.ops.export_scene.x3d(filepath=os.path.join(OUT, "pyramids-%s.x3d" % key), x3d_version="X3D40", use_selection=False, use_animation=False)
    bpy.context.window.scene = scene
    receipt["meshes"][key] = {nm: dict(faces=len(o2.data.polygons), corners=len(o2.data.loops)) for o2, nm in tmp}
gnd.hide_set(False); sun.hide_set(False)

xs = G_X0 + np.arange(G_N) * G_CELL; ys = G_Y1 - np.arange(G_N) * G_CELL
json.dump(dict(n=G_N, cell=G_CELL, x0=G_X0, y1=G_Y1, edge_z=EDGE_Z, height=[round(float(v), 2) for v in H.ravel()],
               pyramids={p["name"]: dict(centre=p["c"], base=p["base"], height=p["height"], slope_deg=math.degrees(p["slope"]), top=p["top"], z=p["z"])
                         for p in (KHUFU, KHAFRE, MENKAURE)}), open(os.path.join(OUT, "ground.json"), "w"))

# ---- path-traced still at golden hour -----------------------------------------------------------------------------------
set_light(LIGHTS["day"])
sky.sun_disc = True
try:
    sky.sun_size = math.radians(1.2); sky.sun_intensity = 0.6
except Exception:
    pass
bgn.inputs["Strength"].default_value = LIGHTS["day"]["sky"]
cam_data = bpy.data.cameras.new("Cam"); cam_data.lens = 34.0; cam_data.clip_end = 90000; cam_data.clip_start = 1
cam = bpy.data.objects.new("Hero", cam_data); scene.collection.objects.link(cam)
cam.location = (560.0, -1330.0, 34.0)
target = Vector((-330.0, -400.0, 70.0))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = (960, 540) if PREVIEW else (1920, 1080)
cy.samples = 24 if PREVIEW else 160
cy.use_denoising = True
try:
    scene.view_settings.view_transform = "AgX"; scene.view_settings.look = "AgX - Medium High Contrast"
except Exception as exc:
    print("look not set:", exc)
scene.view_settings.exposure = math.log2(receipt["lights"]["day"]["exposure"]) - 0.1
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = os.path.join(OUT, "hero-cycles.png")
t0 = time.time()
if "--no-hero" not in sys.argv:              # the poster is rendered by hero_still.py from plateau.blend
    bpy.ops.render.render(write_still=True)
    receipt["timings"]["hero_s"] = round(time.time() - t0, 1)
receipt["hero"] = dict(camera=list(cam.location), target=list(target), lens_mm=34, samples=cy.samples, view_transform=scene.view_settings.view_transform,
                       exposure_stops=round(scene.view_settings.exposure, 3))
receipt["script_sha256"] = hashlib.sha256(open(__file__, "rb").read()).hexdigest()
receipt["illustrative"] = ["course heights and counts", "today's missing tops", "queens' pyramids", "ground relief", "base levels (Khafre and Menkaure +10 m)"]
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "plateau.blend"))
json.dump(receipt, open(os.path.join(OUT, "bake-receipt.json"), "w"), indent=1)
print("DONE", json.dumps(receipt["timings"]))
