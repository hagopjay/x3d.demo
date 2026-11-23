# SPDX-License-Identifier: GPL-3.0-or-later
"""Giza Crawl v2: procedural Cycles materials. None of these reach the X3D file as shaders: each surface is baked
(albedo x light, bump, AO and shadow included) to an image, and the image is what the exporter writes.

Coordinates: everything is driven by world position so joints and courses line up across separate objects.
`wall_uv` gives a 2D (along-the-wall, height) coordinate for axis-aligned walls; `slope_uv` follows a sloping
passage. Node look-ups use node types only (never localized names).
"""
import os

import bpy

TILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tiles")


class G:
    """A tiny node-graph helper: G(mat).n('ShaderNodeMath', operation='ADD', inputs={0: x, 1: 2.0})."""

    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        self.t = self.m.node_tree
        self.t.nodes.clear()
        self.out = self.t.nodes.new("ShaderNodeOutputMaterial")

    def n(self, kind, inputs=None, out=0, **props):
        node = self.t.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        for k, v in (inputs or {}).items():
            sock = node.inputs[k]
            if isinstance(v, bpy.types.NodeSocket):
                self.t.links.new(v, sock)
            elif isinstance(v, (tuple, list)) and len(v) == 3 and hasattr(sock, "default_value") and len(sock.default_value) == 4:
                sock.default_value = (*v, 1.0)
            else:
                sock.default_value = v
        return node.outputs[out] if out is not None else node

    # maths shorthands
    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        return self.n("ShaderNodeMath", {0: a, 1: b, 2: c}, operation=op, use_clamp=clamp)

    def vmath(self, op, a, b=(0, 0, 0)):
        return self.n("ShaderNodeVectorMath", {0: a, 1: b}, operation=op)

    def mix(self, fac, a, b):
        node = self.t.nodes.new("ShaderNodeMix")
        node.data_type = "RGBA"
        for i, v in ((0, fac), (6, a), (7, b)):
            s = node.inputs[i]
            if isinstance(v, bpy.types.NodeSocket):
                self.t.links.new(v, s)
            elif i == 0:
                s.default_value = v
            else:
                s.default_value = (*v, 1.0)
        return node.outputs[2]

    def mixf(self, fac, a, b):
        node = self.t.nodes.new("ShaderNodeMix")
        node.data_type = "FLOAT"
        for i, v in ((0, fac), (2, a), (3, b)):
            s = node.inputs[i]
            if isinstance(v, bpy.types.NodeSocket):
                self.t.links.new(v, s)
            else:
                s.default_value = v
        return node.outputs[0]

    def xyz(self):
        geo = self.n("ShaderNodeNewGeometry", out=None)
        sep = self.n("ShaderNodeSeparateXYZ", {0: geo.outputs["Position"]}, out=None)
        nsep = self.n("ShaderNodeSeparateXYZ", {0: geo.outputs["Normal"]}, out=None)
        return sep.outputs, nsep.outputs, geo

    def vec(self, x, y, z=0.0):
        return self.n("ShaderNodeCombineXYZ", {0: x, 1: y, 2: z})

    def noise(self, vec, scale, detail=6.0, rough=0.55, out=0):
        return self.n("ShaderNodeTexNoise", {0: vec, 2: scale, 3: detail, 4: rough}, out=out, noise_dimensions="3D")

    def voronoi(self, vec, scale, out=0, feature="F1"):
        return self.n("ShaderNodeTexVoronoi", {0: vec, 2: scale}, out=out, feature=feature)

    def ramp(self, fac, stops):
        node = self.t.nodes.new("ShaderNodeValToRGB")
        el = node.color_ramp.elements
        while len(el) > 2:
            el.remove(el[-1])
        for i, (pos, col) in enumerate(stops):
            e = el[i] if i < 2 else el.new(pos)
            e.position = pos
            e.color = (*col, 1.0) if len(col) == 3 else col
        self.t.links.new(fac, node.inputs[0])
        return node.outputs[0]

    def image(self, vec, fname, interp="Linear", colour=False):
        path = os.path.join(TILES, fname)
        img = bpy.data.images.get(fname) or bpy.data.images.load(path)
        img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        node = self.t.nodes.new("ShaderNodeTexImage")
        node.image = img
        node.interpolation = interp
        node.extension = "REPEAT"
        self.t.links.new(vec, node.inputs[0])
        return node.outputs[0]

    def bsdf(self, colour, rough=0.8, normal=None, metallic=0.0, emit=None, emit_strength=0.0, spec=0.3):
        p = self.t.nodes.new("ShaderNodeBsdfPrincipled")
        for k, v in (("Base Color", colour), ("Roughness", rough), ("Metallic", metallic), ("Specular IOR Level", spec)):
            s = p.inputs[k]
            if isinstance(v, bpy.types.NodeSocket):
                self.t.links.new(v, s)
            else:
                s.default_value = (*v, 1.0) if isinstance(v, tuple) else v
        if normal is not None:
            self.t.links.new(normal, p.inputs["Normal"])
        if emit is not None:
            s = p.inputs["Emission Color"]
            if isinstance(emit, bpy.types.NodeSocket):
                self.t.links.new(emit, s)
            else:
                s.default_value = (*emit, 1.0)
            p.inputs["Emission Strength"].default_value = emit_strength
        self.t.links.new(p.outputs[0], self.out.inputs[0])
        return p

    def bump(self, height, strength=0.4, distance=0.02, normal=None):
        inputs = {"Strength": strength, "Distance": distance, "Height": height}
        if normal is not None:
            inputs["Normal"] = normal
        return self.n("ShaderNodeBump", inputs)


def wall_uv(g):
    """(u, v) for axis-aligned surfaces: u runs along the wall (x on walls facing +-y, y on walls facing +-x),
    v is height; floors and ceilings (normal +-z) get (x, y)."""
    p, nrm, _ = g.xyz()
    ax, ay, az = (g.math("ABSOLUTE", nrm[i]) for i in range(3))
    is_flat = g.math("GREATER_THAN", az, 0.7)
    u_wall = g.math("ADD", g.math("MULTIPLY", p[0], g.math("GREATER_THAN", ay, ax)),
                    g.math("MULTIPLY", p[1], g.math("GREATER_THAN", ax, ay)))
    u = g.mixf(is_flat, u_wall, p[0])
    v = g.mixf(is_flat, p[2], p[1])
    return u, v, p


# ------------------------------------------------------------------------------------------------- the materials
def limestone_blocks(name, course=0.72, block=1.25, tone=(0.74, 0.63, 0.47), joint_w=0.012, worn=0.5, slope_deg=0.0):
    """Tura/core limestone laid in courses: brick texture on the wall coordinate, joints incised, blocks vary in tone,
    fossil speckle and soft weathering. slope_deg tilts the courses for the sloping passages."""
    import math as _m
    g = G(name)
    u, v, p = wall_uv(g)
    if slope_deg:
        t = _m.tan(_m.radians(slope_deg))
        v = g.math("SUBTRACT", v, g.math("MULTIPLY", u, t))
    vec = g.vec(g.math("DIVIDE", u, block), g.math("DIVIDE", v, course), 0.0)
    br = g.n("ShaderNodeTexBrick", {"Vector": vec, "Scale": 1.0, "Mortar Size": joint_w / course, "Mortar Smooth": 0.3,
                                    "Bias": 0.0, "Brick Width": 1.0, "Row Height": 1.0}, out=None,
             offset=0.5, offset_frequency=2, squash=1.0, squash_frequency=2)
    mortar = br.outputs["Fac"]
    blockrand = br.outputs["Color"]                          # Color1/Color2 random per brick, used as a tone seed
    g.t.links.new(g.n("ShaderNodeRGB", out=0), br.inputs["Color1"]) if False else None
    br.inputs["Color1"].default_value = (0.0, 0.0, 0.0, 1)
    br.inputs["Color2"].default_value = (1.0, 1.0, 1.0, 1)
    seed = g.n("ShaderNodeSeparateColor", {0: blockrand}, out=0)
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    fine = g.noise(wpos, 9.0, 8.0, 0.62)
    big = g.noise(wpos, 0.8, 3.0, 0.5)
    speck = g.math("GREATER_THAN", g.noise(wpos, 120.0, 2.0, 0.5), 0.68)
    tone_lo = tuple(c * 0.80 for c in tone)
    tone_hi = tuple(min(1, c * 1.08) for c in tone)
    col = g.mix(g.math("ADD", g.math("MULTIPLY", seed, 0.7), g.math("MULTIPLY", big, 0.3)), tone_lo, tone_hi)
    col = g.mix(g.math("MULTIPLY", g.math("SUBTRACT", fine, 0.45), 0.8 * worn), col, (0.45, 0.36, 0.26))
    col = g.mix(g.math("MULTIPLY", speck, 0.25), col, (0.95, 0.90, 0.80))
    col = g.mix(mortar, col, (0.30, 0.24, 0.18))            # Brick Fac is 1 in the mortar
    height = g.math("ADD", g.math("MULTIPLY", mortar, -1.0), g.math("MULTIPLY", fine, 0.25))
    nrm = g.bump(height, 0.55, 0.03)
    g.bsdf(col, 0.85, nrm)
    return g.m


def granite(name, polish=0.35, course=None, block=1.9):
    """Aswan red granite: pink feldspar, grey quartz, black biotite flecks; optional ashlar joints (course, block in m)."""
    g = G(name)
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    cells = g.voronoi(wpos, 38.0, out=1)                          # colour per crystal
    seed = g.n("ShaderNodeSeparateColor", {0: cells}, out=0)
    col = g.ramp(seed, [(0.0, (0.06, 0.05, 0.05)), (0.18, (0.10, 0.08, 0.08)), (0.22, (0.42, 0.40, 0.38)),
                        (0.45, (0.55, 0.30, 0.25)), (0.8, (0.70, 0.40, 0.33)), (1.0, (0.78, 0.55, 0.48))])
    mott = g.noise(wpos, 2.0, 4.0, 0.5)
    col = g.mix(g.math("MULTIPLY", mott, 0.25), col, (0.30, 0.16, 0.13))
    h = g.math("MULTIPLY", g.voronoi(wpos, 38.0, out=0), 0.3)
    if course:
        u, v, _ = wall_uv(g)
        br = g.n("ShaderNodeTexBrick", {"Vector": g.vec(g.math("DIVIDE", u, block), g.math("DIVIDE", v, course), 0.0), "Scale": 1.0,
                                        "Mortar Size": 0.006 / course, "Mortar Smooth": 0.2, "Brick Width": 1.0, "Row Height": 1.0},
                 out=None, offset=0.37, offset_frequency=1)
        br.inputs["Color1"].default_value = (0, 0, 0, 1)
        br.inputs["Color2"].default_value = (1, 1, 1, 1)
        bseed = g.n("ShaderNodeSeparateColor", {0: br.outputs["Color"]}, out=0)
        col = g.mix(g.math("MULTIPLY", bseed, 0.35), col, (0.36, 0.18, 0.14))
        col = g.mix(br.outputs["Fac"], col, (0.03, 0.02, 0.02))
        h = g.math("SUBTRACT", h, br.outputs["Fac"])
    g.bsdf(col, polish, g.bump(h, 0.2, 0.006), spec=0.5)
    return g.m


def bedrock(name, tone=(0.60, 0.50, 0.37), chisel=1.0):
    """Rock-cut Mokattam limestone: chisel tracks (distorted waves), fractures, dust in the hollows."""
    g = G(name)
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    warp = g.noise(wpos, 0.9, 4.0, 0.6, out=1)
    wp = g.vmath("ADD", wpos, g.vmath("SCALE", warp, 0.0) if False else g.vmath("MULTIPLY", warp, (0.35, 0.35, 0.35)))
    waves = g.n("ShaderNodeTexWave", {"Vector": wp, "Scale": 6.0, "Distortion": 3.0, "Detail": 3.0}, out=1,
                wave_type="BANDS", bands_direction="DIAGONAL")
    cracks = g.math("POWER", g.voronoi(wpos, 1.6, out=0, feature="DISTANCE_TO_EDGE"), 0.35)
    fine = g.noise(wpos, 14.0, 8.0, 0.6)
    big = g.noise(wpos, 0.5, 2.0, 0.5)
    col = g.mix(big, tuple(c * 0.72 for c in tone), tone)
    col = g.mix(g.math("MULTIPLY", g.math("SUBTRACT", 1.0, cracks), 0.7), col, (0.20, 0.16, 0.12))
    col = g.mix(g.math("MULTIPLY", fine, 0.35), col, (0.82, 0.74, 0.60))
    h = g.math("ADD", g.math("MULTIPLY", waves, 0.35 * chisel), g.math("ADD", g.math("MULTIPLY", cracks, 0.6), g.math("MULTIPLY", fine, 0.4)))
    g.bsdf(col, 0.95, g.bump(h, 0.8, 0.06))
    return g.m


def sand(name):
    g = G(name)
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    rip = g.n("ShaderNodeTexWave", {"Vector": g.vmath("ADD", wpos, g.vmath("MULTIPLY", g.noise(wpos, 0.05, 2.0, 0.5, out=1), (8, 8, 8))),
                                     "Scale": 0.9, "Distortion": 2.0}, out=1, wave_type="BANDS", bands_direction="X")
    big = g.noise(wpos, 0.02, 3.0, 0.5)
    col = g.mix(big, (0.62, 0.45, 0.27), (0.80, 0.63, 0.40))
    g.bsdf(col, 0.95, g.bump(rip, 0.25, 0.05))
    return g.m


def painted_wall(name, z0, height):
    """The Hall's walls: red-ochre dado, a field of incised invented glyph columns picked out in Egyptian blue on
    limewash, a coloured frieze and a gilt band. z0 is the floor level, height the wall height."""
    g = G(name)
    u, v, p = wall_uv(g)
    rel = g.math("SUBTRACT", v, z0)                                       # height above the floor
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    grime = g.noise(wpos, 1.5, 6.0, 0.6)
    flake = g.math("GREATER_THAN", g.noise(wpos, 6.0, 4.0, 0.7), 0.66)
    plaster = g.mix(g.math("MULTIPLY", grime, 0.7), (0.74, 0.63, 0.47), (0.50, 0.40, 0.28))
    # glyph field between 1.5 m and height-2.2 m: 16 columns per 7.2 m, 12 rows per 5.6 m
    gu = g.math("DIVIDE", u, 5.1)
    gv = g.math("DIVIDE", g.math("SUBTRACT", rel, 1.5), 4.1)
    gmask = g.image(g.vec(gu, gv), "glyphs.png")
    in_field = g.math("MULTIPLY", g.math("GREATER_THAN", rel, 1.55), g.math("LESS_THAN", rel, height - 2.25))
    ink = g.math("MULTIPLY", gmask, in_field)
    blue = g.mix(g.math("MULTIPLY", grime, 0.5), (0.07, 0.20, 0.42), (0.10, 0.14, 0.22))
    col = g.mix(g.math("MULTIPLY", ink, g.math("SUBTRACT", 1.0, g.math("MULTIPLY", flake, 0.6))), plaster, blue)
    # dado: red ochre below 1.4 m with a black band
    dado = g.math("LESS_THAN", rel, 1.4)
    ochre = g.mix(grime, (0.42, 0.12, 0.06), (0.30, 0.09, 0.05))
    col = g.mix(dado, col, ochre)
    col = g.mix(g.math("MULTIPLY", g.math("GREATER_THAN", rel, 1.4), g.math("LESS_THAN", rel, 1.55)), col, (0.05, 0.04, 0.035))
    # frieze between height-2.1 and height-0.6
    fz0 = height - 2.1
    in_fr = g.math("MULTIPLY", g.math("GREATER_THAN", rel, fz0), g.math("LESS_THAN", rel, height - 0.6))
    frieze = g.image(g.vec(g.math("DIVIDE", u, 6.0), g.math("DIVIDE", g.math("SUBTRACT", rel, fz0), 1.5)), "frieze.png", colour=True)
    frieze = g.mix(g.math("ADD", 0.25, g.math("MULTIPLY", grime, 0.4)), frieze, (0.40, 0.32, 0.22))
    col = g.mix(in_fr, col, frieze)
    gilt_band = g.math("GREATER_THAN", rel, height - 0.6)
    col = g.mix(gilt_band, col, (0.86, 0.60, 0.20))
    h = g.math("ADD", g.math("MULTIPLY", ink, -0.6), g.math("MULTIPLY", grime, 0.3))
    g.bsdf(col, g.mixf(gilt_band, 0.85, 0.5), g.bump(h, 0.5, 0.01))
    return g.m


def star_ceiling(name):
    """Egyptian-blue ceiling scattered with gold five-pointed stars (a tomb-ceiling motif, freely re-drawn)."""
    g = G(name)
    u, v, p = wall_uv(g)
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    smask = g.image(g.vec(g.math("DIVIDE", u, 6.0), g.math("DIVIDE", v, 6.0)), "stars.png")
    soot = g.noise(wpos, 0.6, 5.0, 0.6)
    blue = g.mix(g.math("MULTIPLY", soot, 0.8), (0.05, 0.10, 0.30), (0.02, 0.03, 0.07))
    col = g.mix(smask, blue, (0.95, 0.70, 0.26))                       # gold paint (not metal: it must bake as albedo)
    g.bsdf(col, g.mixf(smask, 0.9, 0.5), g.bump(smask, 0.2, 0.004))
    return g.m


def gilt(name, tone=(0.90, 0.58, 0.16)):
    """Hammered gold leaf over gesso: worn to red bole at the edges of the dents."""
    g = G(name)
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    dents = g.voronoi(wpos, 14.0, out=0)
    wear = g.noise(wpos, 3.0, 6.0, 0.6)
    col = g.mix(g.math("MULTIPLY", g.math("GREATER_THAN", wear, 0.70), 0.7), tone, (0.32, 0.09, 0.04))
    g.bsdf(col, g.mixf(wear, 0.25, 0.45), g.bump(dents, 0.3, 0.01), metallic=0.55)
    return g.m


def column_paint(name, z0, height):
    """Papyrus-bundle columns: limewash shaft, bands of red, blue and green under the capital, glyph panel at eye level."""
    g = G(name)
    p, nrm, geo = g.xyz()
    rel = g.math("SUBTRACT", p[2], z0)
    wpos = geo.outputs["Position"]
    grime = g.noise(wpos, 1.8, 6.0, 0.6)
    shaft = g.mix(g.math("MULTIPLY", grime, 0.8), (0.72, 0.60, 0.44), (0.46, 0.36, 0.25))
    # bands: five 0.22 m stripes starting 0.8*height
    bandz = g.math("DIVIDE", g.math("SUBTRACT", rel, height * 0.74), 0.22)
    stripe = g.math("FLOOR", bandz)
    in_b = g.math("MULTIPLY", g.math("GREATER_THAN", bandz, 0.0), g.math("LESS_THAN", bandz, 5.0))
    pick = g.math("MODULO", stripe, 3.0)
    bandcol = g.mix(g.math("GREATER_THAN", pick, 0.5), (0.45, 0.10, 0.05), (0.08, 0.18, 0.40))
    bandcol = g.mix(g.math("GREATER_THAN", pick, 1.5), bandcol, (0.12, 0.30, 0.18))
    col = g.mix(in_b, shaft, bandcol)
    # glyph panel: around the shaft (angle), 1.6 to 4.8 m
    ang = g.n("ShaderNodeMath", {0: nrm[1], 1: nrm[0]}, operation="ARCTAN2")
    gu = g.math("DIVIDE", ang, 6.2832 / 1.5)
    gv = g.math("DIVIDE", g.math("SUBTRACT", rel, 1.6), 3.2)
    gm = g.image(g.vec(gu, gv), "glyphs.png")
    in_p = g.math("MULTIPLY", g.math("GREATER_THAN", rel, 1.6), g.math("LESS_THAN", rel, 4.8))
    col = g.mix(g.math("MULTIPLY", gm, in_p), col, (0.40, 0.09, 0.05))
    cap = g.math("GREATER_THAN", rel, height * 0.86)
    col = g.mix(g.math("MULTIPLY", cap, 0.85), col, (0.88, 0.62, 0.22))
    g.bsdf(col, g.mixf(cap, 0.8, 0.5), g.bump(g.math("ADD", g.math("MULTIPLY", gm, g.math("MULTIPLY", in_p, -0.5)), grime), 0.35, 0.01))
    return g.m


def floor_flags(name, nave_half=2.2, axis_y=0.0):
    """Hall floor: honed dark granite flags with an alabaster processional strip down the axis."""
    g = G(name)
    p, nrm, geo = g.xyz()
    wpos = geo.outputs["Position"]
    vec = g.vec(g.math("DIVIDE", p[0], 1.6), g.math("DIVIDE", p[1], 1.1))
    br = g.n("ShaderNodeTexBrick", {"Vector": vec, "Scale": 1.0, "Mortar Size": 0.012, "Mortar Smooth": 0.2,
                                    "Brick Width": 1.0, "Row Height": 1.0}, out=None, offset=0.5, offset_frequency=2)
    br.inputs["Color1"].default_value = (0, 0, 0, 1)
    br.inputs["Color2"].default_value = (1, 1, 1, 1)
    seed = g.n("ShaderNodeSeparateColor", {0: br.outputs["Color"]}, out=0)
    mortar = br.outputs["Fac"]
    vein = g.n("ShaderNodeTexWave", {"Vector": wpos, "Scale": 0.6, "Distortion": 9.0, "Detail": 6.0}, out=1)
    dark = g.mix(seed, (0.05, 0.045, 0.045), (0.11, 0.09, 0.085))
    dark = g.mix(g.math("MULTIPLY", g.math("GREATER_THAN", g.noise(wpos, 70.0, 2.0), 0.7), 0.5), dark, (0.35, 0.30, 0.28))
    alab = g.mix(g.math("MULTIPLY", vein, 0.6), (0.88, 0.80, 0.66), (0.70, 0.58, 0.42))
    in_nave = g.math("LESS_THAN", g.math("ABSOLUTE", g.math("SUBTRACT", p[1], axis_y)), nave_half)
    col = g.mix(in_nave, dark, alab)
    col = g.mix(mortar, col, (0.02, 0.02, 0.02))
    g.bsdf(col, g.mixf(in_nave, 0.25, 0.35), g.bump(g.math("MULTIPLY", mortar, -1.0), 0.4, 0.01), spec=0.5)
    return g.m


def bronze(name):
    g = G(name)
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    pat = g.noise(wpos, 5.0, 5.0, 0.6)
    col = g.mix(g.math("GREATER_THAN", pat, 0.58), (0.55, 0.32, 0.14), (0.16, 0.36, 0.28))
    g.bsdf(col, 0.4, metallic=0.8)
    return g.m


def flame(name, strength=30.0, colour=(1.0, 0.45, 0.10)):
    g = G(name)
    em = g.n("ShaderNodeEmission", {0: (*colour, 1.0), 1: strength})
    g.t.links.new(em, g.out.inputs[0])
    return g.m


def water(name):
    g = G(name)
    p = g.bsdf((0.01, 0.03, 0.04), 0.03, spec=0.6)
    return g.m


def basalt(name):
    g = G(name)
    wpos = g.n("ShaderNodeNewGeometry", out="Position")
    n = g.noise(wpos, 25.0, 4.0, 0.5)
    col = g.mix(n, (0.035, 0.035, 0.04), (0.08, 0.08, 0.085))
    g.bsdf(col, 0.3, g.bump(n, 0.1, 0.003), spec=0.6)
    return g.m


def sprite(name, fname, strength=4.0):
    """Unlit RGBA sprite (flames): emission from the image; alpha cut-out in Cycles, carried by the texture in X3D."""
    g = G(name)
    uvn = g.n("ShaderNodeUVMap", out=0)
    path = os.path.join(TILES, fname)
    img = bpy.data.images.get(fname) or bpy.data.images.load(path)
    tex = g.t.nodes.new("ShaderNodeTexImage")
    tex.image = img
    g.t.links.new(uvn, tex.inputs[0])
    em = g.n("ShaderNodeEmission", {0: tex.outputs[0], 1: strength})
    tr = g.n("ShaderNodeBsdfTransparent")
    mix = g.n("ShaderNodeMixShader", {0: tex.outputs[1], 1: tr, 2: em})
    g.t.links.new(mix, g.out.inputs[0])
    g.m.use_backface_culling = False
    g.m.blend_method = "BLEND" if hasattr(g.m, "blend_method") else None
    return g.m
