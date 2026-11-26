"""Out-of-this-world demos for the tour and the sizzle reel: maths, science, games, modelling, built with Geometry Nodes.

Live, narrated in a window (screenshots + .blend):
    Blender --factory-startup --enable-event-simulate --window-geometry 0 0 1600 1000 --python wild.py -- --demo lorenz
A 5-second clip for the reel (background render, MP4):
    Blender -b --factory-startup --python wild.py -- --demo lorenz --clip
"""
import json
import math
import sys
import time
import traceback
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DEMO = ARGS[ARGS.index("--demo") + 1] if "--demo" in ARGS else "lorenz"
CLIP = "--clip" in ARGS
FPS, SECONDS = 30, 5
OUT = HERE / "wild" / DEMO
OUT.mkdir(parents=True, exist_ok=True)
NOTES = {"demo": DEMO, "errors": [], "facts": {}}


def fact(k, v):
    NOTES["facts"][k] = v
    print(f"[wild] {k} = {v}")


# -- small node-building helpers -------------------------------------------------------------------------------------

class G:
    """A geometry node group with terse helpers: g.n(type, **inputs), g.l(out, in)."""

    def __init__(self, name):
        self.tree = bpy.data.node_groups.new(name, "GeometryNodeTree")
        self.tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
        self.tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
        self.gin = self.tree.nodes.new("NodeGroupInput")
        self.gout = self.tree.nodes.new("NodeGroupOutput")

    def n(self, kind, props=None, **inputs):
        node = self.tree.nodes.new(kind)
        for k, v in (props or {}).items():
            setattr(node, k, v)
        for k, v in inputs.items():
            key = k.replace("_", " ")
            sock = node.inputs[key] if key in node.inputs else node.inputs[int(k[1:])] if k.startswith("i") and k[1:].isdigit() else None
            if sock is None:
                raise KeyError(f"{kind} has no input {key!r}: {[s.name for s in node.inputs]}")
            if hasattr(v, "is_output") or hasattr(v, "links"):
                self.tree.links.new(v, sock)
            else:
                sock.default_value = v
        return node

    def l(self, a, b):
        return self.tree.links.new(a, b)

    def math(self, op, a, b=None, c=None):
        node = self.n("ShaderNodeMath", {"operation": op})
        for sock, v in zip(node.inputs, (a, b, c)):
            if v is None:
                continue
            if hasattr(v, "is_output"):
                self.l(v, sock)
            else:
                sock.default_value = v
        return node.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        node = self.n("ShaderNodeVectorMath", {"operation": op})
        for sock, v in zip(node.inputs[:2], (a, b)):
            if v is None:
                continue
            if hasattr(v, "is_output"):
                self.l(v, sock)
            else:
                sock.default_value = v
        if scale is not None:
            if hasattr(scale, "is_output"):
                self.l(scale, node.inputs["Scale"])
            else:
                node.inputs["Scale"].default_value = scale
        return node.outputs["Vector"] if op not in ("LENGTH", "DOT_PRODUCT", "DISTANCE") else node.outputs["Value"]

    def xyz(self, vec):
        s = self.n("ShaderNodeSeparateXYZ")
        self.l(vec, s.inputs[0])
        return s.outputs[0], s.outputs[1], s.outputs[2]

    def comb(self, x, y, z):
        c = self.n("ShaderNodeCombineXYZ")
        for sock, v in zip(c.inputs, (x, y, z)):
            if hasattr(v, "is_output"):
                self.l(v, sock)
            else:
                sock.default_value = v
        return c.outputs[0]

    def attr(self, name, kind="FLOAT"):
        return self.n("GeometryNodeInputNamedAttribute", {"data_type": kind}, Name=name).outputs["Attribute"]

    def store(self, geo, name, value, kind="FLOAT", domain="POINT"):
        s = self.n("GeometryNodeStoreNamedAttribute", {"data_type": kind, "domain": domain}, Name=name)
        self.l(geo, s.inputs["Geometry"])
        self.l(value, s.inputs["Value"])
        return s.outputs["Geometry"]

    def tidy(self):
        depth = {}

        def walk(node, d, seen=()):
            if node in seen or depth.get(node, -1) >= d or d > 60:
                return
            depth[node] = d
            for out in node.outputs:
                for link in out.links:
                    walk(link.to_node, d + 1, seen + (node,))
        for nd in self.tree.nodes:
            if not any(s.is_linked for s in nd.inputs):
                walk(nd, 0)
        cols = {}
        for nd, d in depth.items():
            cols.setdefault(d, []).append(nd)
        for d, nds in cols.items():
            for i, nd in enumerate(nds):
                nd.location = (d * 220, -i * 170)


def glow_material(name, a, b, strength, attribute=None, attr_type="INSTANCER", lo=0.0, hi=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*a, 1)
    bsdf.inputs["Emission Color"].default_value = (*a, 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.3
    if attribute:
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_name, at.attribute_type = attribute, attr_type
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = lo, hi
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*a, 1)
        ramp.color_ramp.elements[1].color = (*b, 1)
        mid = ramp.color_ramp.elements.new(0.55)
        mid.color = tuple(min(1.0, (x + y) * 0.7) for x, y in zip(a, b)) + (1,)
        nt.links.new(at.outputs["Fac"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Emission Color"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def fresh(dark=(0.004, 0.005, 0.012)):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, FPS * SECONDS
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (*dark, 1)
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
    return scene


def glare(scene, strength=0.8):
    try:
        tree = bpy.data.node_groups.new("Bloom", "CompositorNodeTree")
        tree.interface.new_socket("Image", in_out="INPUT", socket_type="NodeSocketColor")
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        gin, gout = tree.nodes.new("NodeGroupInput"), tree.nodes.new("NodeGroupOutput")
        rl = tree.nodes.new("CompositorNodeRLayers")
        g = tree.nodes.new("CompositorNodeGlare")
        for k, v in (("Type", "Fog Glow"), ("Strength", strength), ("Size", 0.75), ("Threshold", 0.6)):
            if k in g.inputs:
                try:
                    g.inputs[k].default_value = v
                except TypeError:
                    pass
        tree.links.new(rl.outputs["Image"], g.inputs["Image"])
        tree.links.new(g.outputs["Image"], gout.inputs[0])
        scene.compositing_node_group = tree
    except Exception as error:
        fact("glare", f"{type(error).__name__}: {error}")


def camera(loc, look_at, lens=40):
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    cam.data.lens = lens
    d = (look_at[0] - loc[0], look_at[1] - loc[1], look_at[2] - loc[2])
    from mathutils import Vector
    cam.rotation_euler = Vector(d).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def orbit(cam, centre, radius, height, turns=0.25, start=0.0):
    """Keyframe the camera on a slow orbit, looking at the centre, over the clip."""
    from mathutils import Vector
    scene = bpy.context.scene
    for f in range(scene.frame_start, scene.frame_end + 1, 5):
        a = start + turns * 2 * math.pi * (f - scene.frame_start) / (scene.frame_end - scene.frame_start)
        cam.location = (centre[0] + radius * math.cos(a), centre[1] + radius * math.sin(a), centre[2] + height)
        cam.rotation_euler = (Vector(centre) - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)


def host(name, location=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=0.01, location=location)
    obj = bpy.context.object
    obj.name = name
    return obj


# -- the demos -------------------------------------------------------------------------------------------------------

def lorenz():
    """2,000 particles start within 0.05 of each other and are integrated through the Lorenz system; chaos spreads them
    across the butterfly. Simulation Zone (state across frames) with a Repeat Zone inside (6 Euler steps a frame)."""
    scene = fresh()
    g = G("Lorenz")
    pts = g.n("GeometryNodePoints", Count=2000, Radius=0.02)
    seed = g.n("FunctionNodeRandomValue", {"data_type": "FLOAT_VECTOR"}, Min=(-0.4, -0.4, -0.4), Max=(0.4, 0.4, 0.4))
    start = g.vmath("ADD", seed.outputs["Value"], (1.0, 1.0, 20.0))
    g.l(start, pts.inputs["Position"])
    sim_in, sim_out = g.n("GeometryNodeSimulationInput"), g.n("GeometryNodeSimulationOutput")
    sim_in.pair_with_output(sim_out)
    g.l(pts.outputs["Points"], sim_in.inputs["Geometry"])
    rep_in, rep_out = g.n("GeometryNodeRepeatInput"), g.n("GeometryNodeRepeatOutput")
    rep_in.pair_with_output(rep_out)
    rep_in.inputs["Iterations"].default_value = 20      # 20 Euler steps a frame: ~18 Lorenz time units a clip
    g.l(sim_in.outputs["Geometry"], rep_in.inputs["Geometry"])
    pos = g.n("GeometryNodeInputPosition").outputs[0]
    x, y, z = g.xyz(pos)
    sigma, rho, beta, dt = 10.0, 28.0, 8.0 / 3.0, 0.006
    dx = g.math("MULTIPLY", g.math("SUBTRACT", y, x), sigma)
    dy = g.math("SUBTRACT", g.math("MULTIPLY", x, g.math("SUBTRACT", rho, z)), y)
    dz = g.math("SUBTRACT", g.math("MULTIPLY", x, y), g.math("MULTIPLY", z, beta))
    vel = g.comb(dx, dy, dz)
    setp = g.n("GeometryNodeSetPosition")
    g.l(rep_in.outputs["Geometry"], setp.inputs["Geometry"])
    g.l(g.vmath("SCALE", vel, scale=dt), setp.inputs["Offset"])
    speed = g.vmath("LENGTH", vel)
    stored = g.store(setp.outputs["Geometry"], "speed", speed)
    g.l(stored, rep_out.inputs["Geometry"])
    g.l(rep_out.outputs["Geometry"], sim_out.inputs["Geometry"])
    ico = g.n("GeometryNodeMeshIcoSphere", Radius=0.22, Subdivisions=1)
    inst = g.n("GeometryNodeInstanceOnPoints")
    g.l(sim_out.outputs["Geometry"], inst.inputs["Points"])
    g.l(ico.outputs["Mesh"], inst.inputs["Instance"])
    mat = g.n("GeometryNodeSetMaterial")
    mat.inputs["Material"].default_value = glow_material("LorenzGlow", (0.1, 0.35, 1.0), (1.0, 0.25, 0.6), 6.0,
                                                         attribute="speed", lo=20, hi=180)
    g.l(inst.outputs["Instances"], mat.inputs["Geometry"])
    g.l(mat.outputs["Geometry"], g.gout.inputs[0])
    g.tidy()
    obj = host("LorenzAttractor")
    obj.modifiers.new("Lorenz", "NODES").node_group = g.tree
    obj.scale = (0.09, 0.09, 0.09)
    obj.location = (0, 0, -2.2)
    cam = camera((6.5, -6.5, 1.5), (0, 0, 0.1), lens=38)
    orbit(cam, (0, 0, 0.1), 8.0, 1.2, turns=0.22, start=-math.pi / 4)
    glare(scene, 0.9)
    return scene, obj, g.tree, "Lorenz attractor · chaos in a Simulation Zone",\
        "2,000 particles start in a 0.8-wide ball; the Lorenz equations fan them across the butterfly"


def julia():
    """A terrain whose height is a Julia set's escape time: a Repeat Zone iterates z <- z^2 + c 24 times on every vertex
    of a 300 x 300 grid, while c travels round the main cardioid's rim, so the fractal morphs."""
    scene = fresh((0.01, 0.006, 0.02))
    g = G("Julia")
    grid = g.n("GeometryNodeMeshGrid", Size_X=8.0, Size_Y=8.0, Vertices_X=300, Vertices_Y=300)
    t = g.n("GeometryNodeInputSceneTime").outputs["Seconds"]
    ang = g.math("ADD", g.math("MULTIPLY", t, 0.5), 2.2)
    cx = g.math("MULTIPLY", g.math("COSINE", ang), 0.7885)
    cy = g.math("MULTIPLY", g.math("SINE", ang), 0.7885)
    pos = g.n("GeometryNodeInputPosition").outputs[0]
    px, py, _ = g.xyz(pos)
    geo = g.store(grid.outputs["Mesh"], "zx", g.math("MULTIPLY", px, 0.42))
    geo = g.store(geo, "zy", g.math("MULTIPLY", py, 0.42))
    rep_in, rep_out = g.n("GeometryNodeRepeatInput"), g.n("GeometryNodeRepeatOutput")
    rep_in.pair_with_output(rep_out)
    rep_in.inputs["Iterations"].default_value = 24
    g.l(geo, rep_in.inputs["Geometry"])
    zx, zy, n = g.attr("zx"), g.attr("zy"), g.attr("n")
    inside = g.math("LESS_THAN", g.math("ADD", g.math("MULTIPLY", zx, zx), g.math("MULTIPLY", zy, zy)), 4.0)
    nzx = g.math("ADD", g.math("SUBTRACT", g.math("MULTIPLY", zx, zx), g.math("MULTIPLY", zy, zy)), cx)
    nzy = g.math("ADD", g.math("MULTIPLY", g.math("MULTIPLY", zx, zy), 2.0), cy)
    keepx = g.n("GeometryNodeSwitch", {"input_type": "FLOAT"})
    g.l(inside, keepx.inputs["Switch"])
    g.l(zx, keepx.inputs["False"])
    g.l(nzx, keepx.inputs["True"])
    keepy = g.n("GeometryNodeSwitch", {"input_type": "FLOAT"})
    g.l(inside, keepy.inputs["Switch"])
    g.l(zy, keepy.inputs["False"])
    g.l(nzy, keepy.inputs["True"])
    geo = g.store(rep_in.outputs["Geometry"], "zx", keepx.outputs["Output"])
    geo = g.store(geo, "zy", keepy.outputs["Output"])
    geo = g.store(geo, "n", g.math("ADD", n, inside))
    g.l(geo, rep_out.inputs["Geometry"])
    # the classic look: points that never escape are a dark lake; the escape-time ridges rise along the boundary
    escaped = g.math("LESS_THAN", g.attr("n"), 23.5)
    height = g.math("MULTIPLY", g.math("MULTIPLY", g.math("POWER", g.math("DIVIDE", g.attr("n"), 24.0), 1.4), 1.1), escaped)
    setp = g.n("GeometryNodeSetPosition")
    g.l(rep_out.outputs["Geometry"], setp.inputs["Geometry"])
    g.l(g.comb(0.0, 0.0, height), setp.inputs["Offset"])
    smooth = g.n("GeometryNodeSetShadeSmooth")
    g.l(setp.outputs["Geometry"], smooth.inputs["Geometry"])
    mat = g.n("GeometryNodeSetMaterial")
    mat.inputs["Material"].default_value = glow_material("JuliaGlow", (0.05, 0.02, 0.25), (1.0, 0.75, 0.2), 2.2,
                                                         attribute="n", attr_type="GEOMETRY", lo=0, hi=24)
    g.l(smooth.outputs["Geometry"], mat.inputs["Geometry"])
    g.l(mat.outputs["Geometry"], g.gout.inputs[0])
    g.tidy()
    bpy.ops.mesh.primitive_plane_add(size=0.01)
    obj = bpy.context.object
    obj.name = "JuliaTerrain"
    obj.modifiers.new("Julia", "NODES").node_group = g.tree
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(45), 0, math.radians(30)))
    bpy.context.object.data.energy = 2.0
    cam = camera((6.5, -6.5, 6.0), (0, 0, 0.0), lens=30)
    orbit(cam, (0, 0, 0.0), 8.2, 5.6, turns=0.12, start=-math.pi / 4)
    glare(scene, 0.6)
    return scene, obj, g.tree, "Julia-set landscape · a Repeat Zone",\
        "z ← z² + c, 24 times on 90,000 vertices; c circles the cardioid, so the fractal terrain morphs"


def life():
    """Conway's Game of Life on a 64 x 64 torus: a Simulation Zone keeps every cell's state; each frame Sample Index
    reads the 8 neighbours (indices wrap), B3/S23 decides; cubes glow by age."""
    scene = fresh((0.01, 0.01, 0.015))
    N = 64
    g = G("Life")
    grid = g.n("GeometryNodeMeshGrid", Size_X=N * 0.1, Size_Y=N * 0.1, Vertices_X=N, Vertices_Y=N)
    pts = g.n("GeometryNodeMeshToPoints")
    g.l(grid.outputs["Mesh"], pts.inputs["Mesh"])
    rnd = g.n("FunctionNodeRandomValue", {"data_type": "BOOLEAN"}, Probability=0.33, Seed=7)
    geo = g.store(pts.outputs["Points"], "alive", rnd.outputs["Value"], kind="FLOAT")
    geo = g.store(geo, "age", g.math("MULTIPLY", rnd.outputs["Value"], 1.0))
    sim_in, sim_out = g.n("GeometryNodeSimulationInput"), g.n("GeometryNodeSimulationOutput")
    sim_in.pair_with_output(sim_out)
    g.l(geo, sim_in.inputs["Geometry"])
    idx = g.n("GeometryNodeInputIndex").outputs[0]
    row = g.math("FLOOR", g.math("DIVIDE", idx, N))
    col = g.math("SUBTRACT", idx, g.math("MULTIPLY", row, N))
    total = None
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == dc == 0:
                continue
            r2 = g.math("FLOORED_MODULO", g.math("ADD", row, dr), N)
            c2 = g.math("FLOORED_MODULO", g.math("ADD", col, dc), N)
            j = g.math("ADD", g.math("MULTIPLY", r2, N), c2)
            s = g.n("GeometryNodeSampleIndex", {"data_type": "FLOAT", "domain": "POINT"})
            g.l(sim_in.outputs["Geometry"], s.inputs["Geometry"])
            g.l(g.attr("alive"), s.inputs["Value"])
            g.l(j, s.inputs["Index"])
            total = s.outputs["Value"] if total is None else g.math("ADD", total, s.outputs["Value"])
    alive = g.attr("alive")
    born = g.math("COMPARE", total, 3.0, 0.1)
    survive = g.math("MULTIPLY", alive, g.math("COMPARE", total, 2.0, 0.1))
    nxt = g.math("MAXIMUM", born, survive)
    # step the board every 3rd frame so the eye can follow it
    frame = g.n("GeometryNodeInputSceneTime").outputs["Frame"]
    tick = g.math("COMPARE", g.math("FLOORED_MODULO", frame, 3.0), 0.0, 0.1)
    new_alive = g.n("GeometryNodeSwitch", {"input_type": "FLOAT"})
    g.l(tick, new_alive.inputs["Switch"])
    g.l(alive, new_alive.inputs["False"])
    g.l(nxt, new_alive.inputs["True"])
    age_next = g.math("MULTIPLY", g.math("ADD", g.attr("age"), 1.0), new_alive.outputs["Output"])
    geo = g.store(sim_in.outputs["Geometry"], "alive", new_alive.outputs["Output"])
    geo = g.store(geo, "age", age_next)
    g.l(geo, sim_out.inputs["Geometry"])
    cube = g.n("GeometryNodeMeshCube", Size=(0.085, 0.085, 0.085))
    inst = g.n("GeometryNodeInstanceOnPoints")
    g.l(sim_out.outputs["Geometry"], inst.inputs["Points"])
    g.l(cube.outputs["Mesh"], inst.inputs["Instance"])
    g.l(g.math("GREATER_THAN", g.attr("alive"), 0.5), inst.inputs["Selection"])
    g.l(g.comb(1.0, 1.0, g.math("ADD", 1.0, g.math("MINIMUM", g.math("MULTIPLY", g.attr("age"), 0.08), 3.0))),
        inst.inputs["Scale"])
    agecopy = g.n("GeometryNodeStoreNamedAttribute", {"data_type": "FLOAT", "domain": "INSTANCE"}, Name="glowage")
    g.l(inst.outputs["Instances"], agecopy.inputs["Geometry"])
    g.l(g.attr("age"), agecopy.inputs["Value"])
    mat = g.n("GeometryNodeSetMaterial")
    mat.inputs["Material"].default_value = glow_material("LifeGlow", (0.2, 1.0, 0.55), (0.9, 0.2, 1.0), 3.5,
                                                         attribute="glowage", lo=0, hi=40)
    g.l(agecopy.outputs["Geometry"], mat.inputs["Geometry"])
    g.l(mat.outputs["Geometry"], g.gout.inputs[0])
    g.tidy()
    obj = host("GameOfLife")
    obj.modifiers.new("Life", "NODES").node_group = g.tree
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.05))
    floor = bpy.context.object
    fm = bpy.data.materials.new("Board")
    fm.use_nodes = True
    next(n for n in fm.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.01, 0.01, 0.015, 1)
    floor.data.materials.append(fm)
    cam = camera((4.6, -5.2, 4.4), (0, 0, 0), lens=36)
    orbit(cam, (0, 0, 0), 6.6, 4.6, turns=0.15, start=-math.pi / 3.5)
    glare(scene, 0.7)
    return scene, obj, g.tree, "Conway's Game of Life on a torus",\
        "A Simulation Zone holds 4,096 cells; Sample Index counts 8 neighbours; B3/S23; colour by age"


DEMOS = {"lorenz": lorenz, "julia": julia, "life": life}


def phyllotaxis():
    """A sunflower head growing seed by seed: seed i sits at radius c*sqrt(i), angle i * 137.508 degrees (the golden
    angle); Fibonacci spirals (21, 34, 55) appear without being drawn."""
    scene = fresh((0.02, 0.012, 0.006))
    g = G("Phyllotaxis")
    count = 1600
    line = g.n("GeometryNodeMeshLine", Count=count)
    pts = g.n("GeometryNodeMeshToPoints")
    g.l(line.outputs["Mesh"], pts.inputs["Mesh"])
    idx = g.n("GeometryNodeInputIndex").outputs[0]
    ang = g.math("MULTIPLY", idx, math.radians(137.50776))
    rad = g.math("MULTIPLY", g.math("SQRT", idx), 0.085)
    pos = g.comb(g.math("MULTIPLY", rad, g.math("COSINE", ang)), g.math("MULTIPLY", rad, g.math("SINE", ang)),
                 g.math("MULTIPLY", g.math("MULTIPLY", rad, rad), -0.05))
    setp = g.n("GeometryNodeSetPosition")
    g.l(pts.outputs["Points"], setp.inputs["Geometry"])
    g.l(pos, setp.inputs["Position"])
    t = g.n("GeometryNodeInputSceneTime").outputs["Seconds"]
    grown = g.math("MULTIPLY", t, count / 4.2)                     # seeds appear over 4.2 s
    age = g.math("SUBTRACT", grown, idx)
    size = g.math("MULTIPLY", g.math("MINIMUM", g.math("MAXIMUM", g.math("DIVIDE", age, 120.0), 0.0), 1.0),
                  g.math("ADD", 0.045, g.math("MULTIPLY", g.math("SQRT", idx), 0.0016)))
    seed = g.n("GeometryNodeMeshUVSphere", Segments=12, Rings=6, Radius=1.0)
    inst = g.n("GeometryNodeInstanceOnPoints")
    g.l(setp.outputs["Geometry"], inst.inputs["Points"])
    g.l(seed.outputs["Mesh"], inst.inputs["Instance"])
    g.l(g.math("GREATER_THAN", age, 0.0), inst.inputs["Selection"])
    g.l(g.comb(size, size, g.math("MULTIPLY", size, 0.55)), inst.inputs["Scale"])
    store = g.n("GeometryNodeStoreNamedAttribute", {"data_type": "FLOAT", "domain": "INSTANCE"}, Name="ring")
    g.l(inst.outputs["Instances"], store.inputs["Geometry"])
    g.l(g.math("FRACT", g.math("DIVIDE", idx, 89.0)), store.inputs["Value"])
    mat = g.n("GeometryNodeSetMaterial")
    mat.inputs["Material"].default_value = glow_material("Seeds", (0.35, 0.12, 0.02), (1.0, 0.72, 0.08), 0.6,
                                                         attribute="ring", lo=0, hi=1)
    g.l(store.outputs["Geometry"], mat.inputs["Geometry"])
    g.l(mat.outputs["Geometry"], g.gout.inputs[0])
    g.tidy()
    obj = host("Sunflower")
    obj.modifiers.new("Phyllotaxis", "NODES").node_group = g.tree
    bpy.ops.object.light_add(type="AREA", location=(0, -1, 6))
    bpy.context.object.data.energy, bpy.context.object.data.size = 900, 4
    cam = camera((0, -0.01, 6.8), (0, 0, 0), lens=40)
    cam.keyframe_insert("rotation_euler", frame=1)
    cam.rotation_euler.z += math.radians(40)
    cam.keyframe_insert("rotation_euler", frame=150)
    glare(scene, 0.5)
    return scene, obj, g.tree, "Phyllotaxis · the golden angle",\
        "Seed n at radius √n, turned 137.508° from the last: Fibonacci spirals appear without being drawn"


def waves():
    """A ripple tank: two sources (moving apart) add their circular waves; nodal lines of destructive interference
    sweep across a 400 x 400 surface. Height drives the colour."""
    scene = fresh((0.0, 0.006, 0.015))
    g = G("Ripple tank")
    grid = g.n("GeometryNodeMeshGrid", Size_X=10.0, Size_Y=10.0, Vertices_X=400, Vertices_Y=400)
    t = g.n("GeometryNodeInputSceneTime").outputs["Seconds"]
    pos = g.n("GeometryNodeInputPosition").outputs[0]
    half = g.math("ADD", 0.6, g.math("MULTIPLY", t, 0.32))
    total = None
    for sign in (-1.0, 1.0):
        src = g.comb(g.math("MULTIPLY", half, sign), 0.0, 0.0)
        r = g.vmath("DISTANCE", pos, src)
        phase = g.math("SUBTRACT", g.math("MULTIPLY", r, 7.0), g.math("MULTIPLY", t, 9.0))
        w = g.math("DIVIDE", g.math("SINE", phase), g.math("ADD", 1.0, g.math("MULTIPLY", r, 0.8)))
        total = w if total is None else g.math("ADD", total, w)
    hgt = g.math("MULTIPLY", total, 0.35)
    setp = g.n("GeometryNodeSetPosition")
    g.l(grid.outputs["Mesh"], setp.inputs["Geometry"])
    g.l(g.comb(0.0, 0.0, hgt), setp.inputs["Offset"])
    geo = g.store(setp.outputs["Geometry"], "h", total)
    smooth = g.n("GeometryNodeSetShadeSmooth")
    g.l(geo, smooth.inputs["Geometry"])
    mat = g.n("GeometryNodeSetMaterial")
    mat.inputs["Material"].default_value = glow_material("Water", (0.0, 0.03, 0.22), (0.35, 0.95, 1.0), 0.32,
                                                         attribute="h", attr_type="GEOMETRY", lo=-0.7, hi=0.8)
    g.l(smooth.outputs["Geometry"], mat.inputs["Geometry"])
    g.l(mat.outputs["Geometry"], g.gout.inputs[0])
    g.tidy()
    bpy.ops.mesh.primitive_plane_add(size=0.01)
    obj = bpy.context.object
    obj.name = "RippleTank"
    obj.modifiers.new("Ripple", "NODES").node_group = g.tree
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), 0, math.radians(-30)))
    bpy.context.object.data.energy = 2.5
    cam = camera((0, -8.5, 5.2), (0, 0, 0), lens=32)
    orbit(cam, (0, 0, 0), 8.6, 5.0, turns=0.08, start=-math.pi / 2)
    glare(scene, 0.5)
    return scene, obj, g.tree, "Ripple tank · interference",\
        "Two sources drifting apart; their waves add, and nodal lines sweep across 160,000 vertices"


def city():
    """Procedural modelling: a 34 x 34 grid's faces are scaled into lots, extruded into towers along a noise skyline
    (taller downtown), and rise during the clip; a window texture lights some floors."""
    scene = fresh((0.01, 0.012, 0.03))
    g = G("City")
    grid = g.n("GeometryNodeMeshGrid", Size_X=17.0, Size_Y=17.0, Vertices_X=35, Vertices_Y=35)
    lots = g.n("GeometryNodeScaleElements", Scale=0.72)
    g.l(grid.outputs["Mesh"], lots.inputs["Geometry"])
    pos = g.n("GeometryNodeInputPosition").outputs[0]
    noise = g.n("ShaderNodeTexNoise", Scale=0.22, Detail=3.0)
    g.l(pos, noise.inputs["Vector"])
    centre = g.math("MAXIMUM", g.math("SUBTRACT", 1.0, g.math("DIVIDE", g.vmath("LENGTH", pos), 8.5)), 0.0)
    rnd = g.n("FunctionNodeRandomValue", {"data_type": "FLOAT"}, Min=0.2, Max=1.0, Seed=3)
    tall = g.math("MULTIPLY", g.math("ADD", g.math("MULTIPLY", g.math("POWER", centre, 2.0), 5.5), 0.3),
                  g.math("MULTIPLY", rnd.outputs["Value"], g.math("ADD", noise.outputs["Fac"], 0.3)))
    t = g.n("GeometryNodeInputSceneTime").outputs["Seconds"]
    rise = g.math("MINIMUM", g.math("MAXIMUM", g.math("SUBTRACT", g.math("MULTIPLY", t, 0.45),
                                                       g.math("MULTIPLY", g.vmath("LENGTH", pos), 0.06)), 0.0), 1.0)
    ext = g.n("GeometryNodeExtrudeMesh", {"mode": "FACES"}, Individual=True)
    g.l(lots.outputs["Geometry"], ext.inputs["Mesh"])
    g.l(g.math("ADD", g.math("MULTIPLY", tall, rise), 0.02), ext.inputs["Offset Scale"])
    mat = g.n("GeometryNodeSetMaterial")
    m = bpy.data.materials.new("Towers")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.08, 0.1, 0.15, 1)
    bsdf.inputs["Metallic"].default_value = 0.7
    bsdf.inputs["Roughness"].default_value = 0.25
    coord = nt.nodes.new("ShaderNodeTexCoord")
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.inputs["Scale"].default_value = 5.0
    brick.inputs["Brick Width"].default_value = 0.35
    brick.inputs["Row Height"].default_value = 0.16
    brick.inputs["Mortar Size"].default_value = 0.04       # absolute texture units, not a fraction
    brick.inputs["Color1"].default_value = (1.0, 0.75, 0.35, 1)
    brick.inputs["Color2"].default_value = (0.0, 0.0, 0.0, 1)
    brick.inputs["Mortar"].default_value = (0.0, 0.0, 0.0, 1)
    nt.links.new(coord.outputs["Object"], brick.inputs["Vector"])
    nt.links.new(brick.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.1
    mat.inputs["Material"].default_value = m
    g.l(ext.outputs["Mesh"], mat.inputs["Geometry"])
    g.l(mat.outputs["Geometry"], g.gout.inputs[0])
    g.tidy()
    bpy.ops.mesh.primitive_plane_add(size=0.01)
    obj = bpy.context.object
    obj.name = "City"
    obj.modifiers.new("City", "NODES").node_group = g.tree
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.01))
    road = bpy.data.materials.new("Road")
    road.use_nodes = True
    next(n for n in road.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.015, 0.015, 0.02, 1)
    bpy.context.object.data.materials.append(road)
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(60), 0, math.radians(140)))
    bpy.context.object.data.energy, bpy.context.object.data.color = 3.5, (0.6, 0.7, 1.0)
    cam = camera((13, -13, 9), (0, 0, 1.5), lens=30)
    orbit(cam, (0, 0, 1.2), 15.0, 6.5, turns=0.14, start=-math.pi / 4)
    glare(scene, 0.6)
    return scene, obj, g.tree, "Procedural city · modelling with nodes",\
        "Grid faces become lots, lots become towers along a noise skyline, and the city rises"


def turrets():
    """Gameplay with constraints as the logic: six turrets aim at a drone on a looping path (Damped Track); a laser
    from each barrel stretches to the drone (Stretch To) and flashes on its own rhythm."""
    scene = fresh((0.012, 0.01, 0.02))
    bpy.ops.mesh.primitive_plane_add(size=40)
    floor = bpy.context.object
    fm = bpy.data.materials.new("Deck")
    fm.use_nodes = True
    nt = fm.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    chk = nt.nodes.new("ShaderNodeTexChecker")
    chk.inputs["Scale"].default_value = 18
    chk.inputs["Color1"].default_value = (0.05, 0.05, 0.07, 1)
    chk.inputs["Color2"].default_value = (0.09, 0.09, 0.12, 1)
    nt.links.new(chk.outputs["Color"], b.inputs["Base Color"])
    floor.data.materials.append(fm)
    bpy.ops.curve.primitive_bezier_circle_add(radius=5.5, location=(0, 0, 3.0))
    path = bpy.context.object
    path.data.path_duration = 150
    for i, p in enumerate(path.data.splines[0].bezier_points):
        p.co.z += 1.6 * math.sin(i * 1.7)
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.35, subdivisions=2)
    drone = bpy.context.object
    drone.name = "Drone"
    drone.data.materials.append(glow_material("DroneGlow", (1.0, 0.2, 0.15), (1.0, 0.2, 0.15), 18.0))
    fol = drone.constraints.new("FOLLOW_PATH")
    fol.target = path
    path.data.use_path = True
    path.data.eval_time = 0
    path.data.keyframe_insert("eval_time", frame=1)
    path.data.eval_time = 150
    path.data.keyframe_insert("eval_time", frame=150)
    for fc in path.data.animation_data.action.layers[0].strips[0].channelbags[0].fcurves if not hasattr(path.data.animation_data.action, "fcurves") or not len(path.data.animation_data.action.fcurves) else path.data.animation_data.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    metal = bpy.data.materials.new("Gunmetal")
    metal.use_nodes = True
    mb = next(n for n in metal.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    mb.inputs["Base Color"].default_value = (0.35, 0.38, 0.42, 1)
    mb.inputs["Metallic"].default_value = 1.0
    mb.inputs["Roughness"].default_value = 0.3
    beam_colours = [(0.2, 1.0, 0.6), (0.3, 0.7, 1.0), (1.0, 0.85, 0.2)]
    for k in range(6):
        a = k / 6 * 2 * math.pi
        x, y = 2.6 * math.cos(a), 2.6 * math.sin(a)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=0.5, location=(x, y, 0.25))
        base = bpy.context.object
        base.data.materials.append(metal)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.38, location=(x, y, 0.75))
        head = bpy.context.object
        head.name = f"Turret{k}"
        head.data.materials.append(metal)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.07, depth=0.9, location=(0, 0, 0.55))
        barrel = bpy.context.object
        barrel.data.materials.append(metal)
        barrel.parent = head
        barrel.location = (0, 0, 0.55)
        trk = head.constraints.new("DAMPED_TRACK")
        trk.target, trk.track_axis = drone, "TRACK_Z"
        bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=2.0, location=(x, y, 0.75))
        beam = bpy.context.object
        beam.name = f"Laser{k}"
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=False)
        mu = __import__("mathutils")
        beam.data.transform(mu.Matrix.Rotation(-math.pi / 2, 4, "X") @ mu.Matrix.Translation((0, 0, 1.0)))   # Stretch To uses +Y
        beam.data.materials.append(glow_material(f"Beam{k}", beam_colours[k % 3], beam_colours[k % 3], 40.0))
        st = beam.constraints.new("STRETCH_TO")
        st.target, st.volume, st.keep_axis = drone, "NO_VOLUME", "PLANE_X"
        st.rest_length = 2.0
        for f in range(1, 151):
            on = ((f + k * 7) % 22) < 5
            beam.hide_render = not on
            beam.hide_viewport = not on
            beam.keyframe_insert("hide_render", frame=f)
            beam.keyframe_insert("hide_viewport", frame=f)
    bpy.ops.object.light_add(type="AREA", location=(0, 0, 9))
    bpy.context.object.data.energy, bpy.context.object.data.size = 1500, 10
    cam = camera((9, -9, 6), (0, 0, 1.5), lens=30)
    orbit(cam, (0, 0, 1.4), 12.0, 5.0, turns=0.18, start=-math.pi / 4)
    glare(scene, 0.9)
    return scene, drone, bpy.data.node_groups.new("none", "GeometryNodeTree"), "Turret defense · constraints as game logic",\
        "Damped Track aims six turrets at a drone on a path; Stretch To locks each laser on; keyframes fire"


DEMOS.update({"phyllotaxis": phyllotaxis, "waves": waves, "city": city, "turrets": turrets})


# -- run: a clip in the background, or a narrated live window --------------------------------------------------------

def render_clip(scene):
    # a final render reads Simulation Zones from their cache and does not compute them: fill it, frame by frame, in order
    for f in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(f)
    scene.frame_set(scene.frame_start)
    scene.render.image_settings.media_type = "VIDEO" if hasattr(scene.render.image_settings, "media_type") else None
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.filepath = str(OUT / f"{DEMO}.mp4")
    scene.eevee.taa_render_samples = 24
    began = time.perf_counter()
    bpy.ops.render.render(animation=True)
    fact("clip_seconds_to_render", round(time.perf_counter() - began, 1))
    fact("clip", scene.render.filepath)


def main_clip():
    try:
        scene, obj, tree, title, line = DEMOS[DEMO]()
        fact("title", title)
        fact("nodes", len(tree.nodes))
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f"{DEMO}.blend"))
        render_clip(scene)
    except Exception:
        NOTES["errors"].append(traceback.format_exc())
        print(traceback.format_exc())
    (OUT / "notes.json").write_text(json.dumps(NOTES, indent=1))


if CLIP:
    main_clip()
