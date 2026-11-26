"""A guided tour of Blender, one stop per run, in a real window.

    Blender --factory-startup --enable-event-simulate --window-geometry 0 0 1600 1000 --python tour.py -- --stop 1

Each stop builds its scene with bpy, switches to the workspace that shows it best, plays it, and writes screenshots,
a .blend and notes.json into NN-name/ beside this file. A caption drawn over the 3D viewport (blf) narrates, so every
screenshot carries its own label.
"""
import json
import math
import sys
import time
import traceback
from pathlib import Path

import blf
import bpy

HERE = Path(__file__).resolve().parent
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
STOP = int(ARGS[ARGS.index("--stop") + 1]) if "--stop" in ARGS else 1
NOTES = {"errors": [], "shots": [], "facts": {}}
CAPTION = {"title": "", "line": ""}
OUT = None


SOURCE = Path(__import__("os").environ.get("X3D_IO_SOURCE", "x3d-blender-io/source")).expanduser()   # the add-on source folder (main at 699e497, 2.7.8)


def load_addon():
    import addon_utils
    import tempfile
    shelf = Path(tempfile.mkdtemp(prefix="x3d_tour_pkg_"))
    (shelf / "x3d_blender_io").symlink_to(SOURCE, target_is_directory=True)
    sys.path.insert(0, str(shelf))
    if addon_utils.enable("x3d_blender_io", default_set=True, handle_error=None) is None:
        raise RuntimeError("the X3D add-on did not enable")


# -- the rig ------------------------------------------------------------------------------------------------------------

def window():
    return bpy.context.window_manager.windows[0]


def areas(kind):
    return [a for a in window().screen.areas if a.type == kind]


def region(area, kind="WINDOW"):
    return next(r for r in area.regions if r.type == kind)


def _draw_caption():
    if not CAPTION["title"]:
        return
    font = 0
    blf.enable(font, blf.SHADOW)
    blf.shadow(font, 5, 0.0, 0.0, 0.0, 0.9)
    blf.shadow_offset(font, 2, -2)
    blf.size(font, 26)
    blf.color(font, 1.0, 0.86, 0.45, 1.0)
    tools = next((r.width for r in bpy.context.area.regions if r.type == "TOOLS"), 0)
    x = tools + 18
    blf.position(font, x, 64, 0)
    blf.draw(font, CAPTION["title"])
    blf.size(font, 17)
    blf.color(font, 0.92, 0.94, 1.0, 1.0)
    blf.position(font, x, 32, 0)
    blf.draw(font, CAPTION["line"])
    blf.disable(font, blf.SHADOW)


_HANDLE = bpy.types.SpaceView3D.draw_handler_add(_draw_caption, (), "WINDOW", "POST_PIXEL")


def caption(title, line=""):
    CAPTION.update(title=title, line=line)
    for a in window().screen.areas:
        a.tag_redraw()
    print(f"[tour] {title} :: {line}")


def workspace(name):
    window().workspace = bpy.data.workspaces[name]


def shot(name):
    path = OUT / f"{name}.png"
    with bpy.context.temp_override(window=window()):
        bpy.ops.screen.screenshot(filepath=str(path))
    NOTES["shots"].append(path.name)
    return path.name


def fact(key, value):
    NOTES["facts"][key] = value
    print(f"[tour] fact {key} = {value}")


def clear_scene():
    scene = bpy.context.scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    return scene


def look_through_camera(cam):
    bpy.context.scene.camera = cam
    for a in window().screen.areas:
        if a.type == "VIEW_3D":
            a.spaces.active.region_3d.view_perspective = "CAMERA"
            a.spaces.active.shading.type = "RENDERED"
            a.spaces.active.overlay.show_overlays = True
            a.spaces.active.overlay.show_outline_selected = False      # let the materials show, not the selection
            with bpy.context.temp_override(window=window(), area=a, region=region(a)):
                bpy.ops.view3d.view_center_camera()                       # the camera's frame fills the viewport


def viewport_glare(scene):
    """Bloom in the viewport: a compositor Glare node, run live by the viewport's real-time compositor."""
    try:
        tree = bpy.data.node_groups.new("Tour Glare", "CompositorNodeTree")
        tree.interface.new_socket("Image", in_out="INPUT", socket_type="NodeSocketColor")
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        gin, gout = tree.nodes.new("NodeGroupInput"), tree.nodes.new("NodeGroupOutput")
        glare = tree.nodes.new("CompositorNodeGlare")
        for name, value in (("glare_type", "FOG_GLOW"), ("quality", "HIGH")):
            if hasattr(glare, name):
                setattr(glare, name, value)
        for name, value in (("Type", "Fog Glow"), ("Strength", 0.9), ("Size", 0.7)):
            if name in glare.inputs:
                try:
                    glare.inputs[name].default_value = value
                except TypeError:
                    pass
        tree.links.new(gin.outputs[0], glare.inputs["Image"])
        tree.links.new(glare.outputs["Image"], gout.inputs[0])
        scene.compositing_node_group = tree
        for a in window().screen.areas:
            if a.type == "VIEW_3D":
                a.spaces.active.shading.use_compositor = "ALWAYS"
        fact("viewport_glare", "on")
    except Exception as error:
        fact("viewport_glare", f"{type(error).__name__}: {error}")


def links(tree):
    return lambda a, b: tree.links.new(a, b)


# -- stop 1: geometry nodes and a simulation zone ----------------------------------------------------------------------

def emission_material(name, color, strength, by_attribute=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.15
    if by_attribute:
        attr = nt.nodes.new("ShaderNodeAttribute")
        attr.attribute_name = by_attribute
        attr.attribute_type = "INSTANCER"      # stored on instances: read from the instancer, not the mesh
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (0.05, 0.25, 1.0, 1)
        ramp.color_ramp.elements[1].color = (1.0, 0.35, 0.9, 1)
        nt.links.new(attr.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Emission Color"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def crystal_field():
    """A grid scattered with crystals whose size breathes with 4D noise over time; their glow is stored as an
    attribute the material reads."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=40, y_subdivisions=40, size=10)
    ground = bpy.context.object
    ground.name = "CrystalField"
    tree = bpy.data.node_groups.new("Crystal Field", "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N, L = tree.nodes, links(tree)
    gin, gout = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    scatter = N.new("GeometryNodeDistributePointsOnFaces")
    scatter.inputs["Density"].default_value = 9.0
    crystal = N.new("GeometryNodeMeshCone")
    crystal.inputs["Vertices"].default_value = 6
    crystal.inputs["Radius Top"].default_value = 0.0
    crystal.inputs["Radius Bottom"].default_value = 0.09
    crystal.inputs["Depth"].default_value = 0.7
    time_node = N.new("GeometryNodeInputSceneTime")
    pos = N.new("GeometryNodeInputPosition")
    noise = N.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 0.35
    w = N.new("ShaderNodeMath")
    w.operation = "MULTIPLY"
    w.inputs[1].default_value = 0.35
    size = N.new("ShaderNodeMapRange")
    size.inputs["From Min"].default_value = 0.35
    size.inputs["From Max"].default_value = 0.7
    size.inputs["To Min"].default_value = 0.05
    size.inputs["To Max"].default_value = 1.5
    tilt = N.new("FunctionNodeRandomValue")
    tilt.data_type = "FLOAT_VECTOR"
    tilt.inputs["Min"].default_value = (-0.35, -0.35, 0)
    tilt.inputs["Max"].default_value = (0.35, 0.35, 6.28)
    place = N.new("GeometryNodeInstanceOnPoints")
    store = N.new("GeometryNodeStoreNamedAttribute")
    store.data_type = "FLOAT"
    store.domain = "INSTANCE"
    store.inputs["Name"].default_value = "glow"
    setmat = N.new("GeometryNodeSetMaterial")
    setmat.inputs["Material"].default_value = emission_material("CrystalGlow", (0.3, 0.5, 1.0), 0.9, by_attribute="glow")
    ground_mat = N.new("GeometryNodeSetMaterial")
    gm = bpy.data.materials.new("Basalt")
    gm.use_nodes = True
    next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.02, 0.02, 0.03, 1)
    ground_mat.inputs["Material"].default_value = gm
    join = N.new("GeometryNodeJoinGeometry")
    L(gin.outputs[0], scatter.inputs["Mesh"])
    L(scatter.outputs["Points"], place.inputs["Points"])
    L(crystal.outputs["Mesh"], place.inputs["Instance"])
    L(time_node.outputs["Seconds"], w.inputs[0])
    L(w.outputs[0], noise.inputs["W"])
    L(pos.outputs[0], noise.inputs["Vector"])
    L(noise.outputs["Fac"], size.inputs["Value"])
    L(size.outputs["Result"], place.inputs["Scale"])
    L(tilt.outputs["Value"], place.inputs["Rotation"])
    L(place.outputs["Instances"], store.inputs["Geometry"])
    L(size.outputs["Result"], store.inputs["Value"])
    L(store.outputs["Geometry"], setmat.inputs["Geometry"])
    L(gin.outputs[0], ground_mat.inputs["Geometry"])
    L(setmat.outputs["Geometry"], join.inputs["Geometry"])
    L(ground_mat.outputs["Geometry"], join.inputs["Geometry"])
    L(join.outputs["Geometry"], gout.inputs[0])
    ground.modifiers.new("Crystal Field", "NODES").node_group = tree
    tidy(tree)
    return ground, tree


def fireflies():
    """A Simulation Zone: 600 points that remember where they were last frame and drift on a noise current."""
    bpy.ops.mesh.primitive_plane_add(size=0.01, location=(0, 0, 1.6))
    host = bpy.context.object
    host.name = "Fireflies"
    tree = bpy.data.node_groups.new("Firefly Swarm", "GeometryNodeTree")
    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N, L = tree.nodes, links(tree)
    gin, gout = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    seed = N.new("FunctionNodeRandomValue")
    seed.data_type = "FLOAT_VECTOR"
    seed.inputs["Min"].default_value = (-4, -4, 0.2)
    seed.inputs["Max"].default_value = (4, 4, 3.0)
    points = N.new("GeometryNodePoints")
    points.inputs["Count"].default_value = 600
    points.inputs["Radius"].default_value = 0.03
    sim_in, sim_out = N.new("GeometryNodeSimulationInput"), N.new("GeometryNodeSimulationOutput")
    sim_in.pair_with_output(sim_out)
    pos = N.new("GeometryNodeInputPosition")
    current = N.new("ShaderNodeTexNoise")
    current.noise_dimensions = "4D"
    current.inputs["Scale"].default_value = 0.45
    clock = N.new("GeometryNodeInputSceneTime")
    centred = N.new("ShaderNodeVectorMath")
    centred.operation = "SUBTRACT"
    centred.inputs[1].default_value = (0.5, 0.5, 0.47)
    speed = N.new("ShaderNodeVectorMath")
    speed.operation = "SCALE"
    move = N.new("ShaderNodeMath")
    move.operation = "MULTIPLY"
    move.inputs[1].default_value = 7.0
    step = N.new("GeometryNodeSetPosition")
    sphere = N.new("GeometryNodeMeshIcoSphere")
    sphere.inputs["Radius"].default_value = 0.035
    place = N.new("GeometryNodeInstanceOnPoints")
    setmat = N.new("GeometryNodeSetMaterial")
    setmat.inputs["Material"].default_value = emission_material("FireflyGlow", (1.0, 0.55, 0.1), 12.0)
    L(seed.outputs["Value"], points.inputs["Position"])
    L(points.outputs["Points"], sim_in.inputs["Geometry"])
    L(pos.outputs[0], current.inputs["Vector"])
    L(clock.outputs["Seconds"], current.inputs["W"])
    L(current.outputs["Color"], centred.inputs[0])
    L(centred.outputs[0], speed.inputs[0])
    L(sim_in.outputs["Delta Time"], move.inputs[0])
    L(move.outputs[0], speed.inputs["Scale"])
    L(sim_in.outputs["Geometry"], step.inputs["Geometry"])
    L(speed.outputs[0], step.inputs["Offset"])
    L(step.outputs["Geometry"], sim_out.inputs["Geometry"])     # inputs[0] is "Skip" in 5.x
    L(sim_out.outputs["Geometry"], place.inputs["Points"])
    L(sphere.outputs["Mesh"], place.inputs["Instance"])
    L(place.outputs["Instances"], setmat.inputs["Geometry"])
    L(setmat.outputs["Geometry"], gout.inputs[0])
    host.modifiers.new("Firefly Swarm", "NODES").node_group = tree
    tidy(tree)
    return host, tree


def tidy(tree):
    """Lay nodes out left to right by their distance from the group input, so the editor reads like a sentence."""
    depth = {}

    def walk(node, d):
        if depth.get(node, -1) >= d:
            return
        depth[node] = d
        for out in node.outputs:
            for link in out.links:
                walk(link.to_node, d + 1)
    for n in tree.nodes:
        if not any(s.is_linked for s in n.inputs):
            walk(n, 0)
    columns = {}
    for n, d in depth.items():
        columns.setdefault(d, []).append(n)
    for d, nodes in columns.items():
        for i, n in enumerate(nodes):
            n.location = (d * 230, -i * 190)


def frame_node_editor():
    for a in window().screen.areas:
        if a.type == "NODE_EDITOR":
            with bpy.context.temp_override(window=window(), area=a, region=region(a)):
                bpy.ops.node.view_all()


def stop_1():
    global OUT
    OUT = HERE / "01-geometry-nodes"
    OUT.mkdir(parents=True, exist_ok=True)
    scene = clear_scene()
    scene.render.engine = "BLENDER_EEVEE"
    scene.frame_start, scene.frame_end = 1, 240
    scene.render.fps = 24
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.006, 0.015, 1)
    caption("Stop 1 · Geometry Nodes", "A grid becomes a crystal field: points scattered, cones instanced, sizes breathing to 4D noise")
    yield 1.0
    ground, crystals = crystal_field()
    fact("crystal_nodes", len(crystals.nodes))
    bpy.ops.object.camera_add(location=(6.2, -6.2, 3.1), rotation=(math.radians(70), 0, math.radians(45)))
    cam = bpy.context.object
    cam.data.lens = 30
    bpy.ops.object.light_add(type="AREA", location=(0, 0, 8))
    bpy.context.object.data.energy = 300
    look_through_camera(cam)
    workspace("Geometry Nodes")
    viewport_glare(scene)
    yield 1.5
    for a in areas("NODE_EDITOR"):
        a.spaces.active.node_tree = crystals
    bpy.context.view_layer.objects.active = ground
    ground.select_set(True)
    yield 0.6
    frame_node_editor()
    look_through_camera(cam)
    yield 1.2
    shot("1-crystal-field-graph")
    caption("Scene Time drives the noise's 4th dimension", "Nothing is keyframed: every frame the field is computed again from the clock")
    with bpy.context.temp_override(window=window()):
        bpy.ops.screen.animation_play()
    for k in range(3):
        yield 2.0
        shot(f"2-breathing-{k}")
    with bpy.context.temp_override(window=window()):
        bpy.ops.screen.animation_cancel(restore_frame=False)
    caption("Stop 1b · a Simulation Zone", "600 fireflies remember last frame's position and drift on a noise current; state carries frame to frame")
    swarm, sim = fireflies()
    fact("swarm_nodes", len(sim.nodes))
    for a in areas("NODE_EDITOR"):
        a.spaces.active.node_tree = sim
    bpy.context.view_layer.objects.active = swarm
    scene.frame_set(1)
    yield 0.8
    frame_node_editor()
    yield 0.8
    shot("3-simulation-zone-graph")
    with bpy.context.temp_override(window=window()):
        bpy.ops.screen.animation_play()
    for k in range(4):
        yield 2.0
        shot(f"4-swarm-{k}")
    with bpy.context.temp_override(window=window()):
        bpy.ops.screen.animation_cancel(restore_frame=False)
    fact("frame_reached", scene.frame_current)
    ev = swarm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    fact("swarm_instances_now", len(ev.data.vertices) if ev.type == "MESH" else None)
    # the X3D thread: what survives an export? The add-on writes evaluated meshes; instances must be realized.
    caption("And X3D?", "Geometry Nodes output exports as plain meshes for the frame you are on; the noise and the zone do not travel")
    yield 1.5
    try:
        bpy.ops.object.select_all(action="DESELECT")
        ground.select_set(True)
        swarm.select_set(True)
        out = OUT / "frame-snapshot.x3d"
        result = bpy.ops.export_scene.x3d(filepath=str(out), use_selection=True)
        fact("x3d_export", {"result": sorted(result), "bytes": out.stat().st_size if out.exists() else None})
    except Exception as error:
        fact("x3d_export", f"{type(error).__name__}: {error}")
    shot("5-x3d-caption")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "stop-01.blend"))
    caption("End of stop 1", "Saved: stop-01.blend, screenshots, frame-snapshot.x3d")
    yield 1.0
    shot("6-end")


# -- stop 2: physics -------------------------------------------------------------------------------------------------

def tower_x3d(path, levels=10):
    """A Jenga-style tower as an X3D RigidBodyCollection: three blocks a level, each level turned a quarter, every block
    a RigidBody placed by its own position and orientation (what issue #99 fixed on import)."""
    colours = ["0.95 0.45 0.2", "0.95 0.75 0.25", "0.3 0.65 0.95"]
    bodies = []
    for level in range(levels):
        y = 0.125 + level * 0.25
        turned = level % 2 == 1
        for k in (-1, 0, 1):
            pos = f"0 {y:.3f} {k * 0.25:.3f}" if not turned else f"{k * 0.25:.3f} {y:.3f} 0"
            rot = "0 1 0 0" if not turned else "0 1 0 1.5708"      # long axis across the spacing, never along it
            name = f"Block_{level:02d}_{k + 1}"
            bodies.append(
                f"<RigidBody DEF='{name}' position='{pos}' orientation='{rot}' mass='0.4'>"
                f"<CollidableShape containerField='geometry'><Shape containerField='shape'>"
                f"<Appearance><Material diffuseColor='{colours[(level + k) % 3]}'/></Appearance>"
                f"<Box size='0.75 0.24 0.24'/></Shape></CollidableShape></RigidBody>")
    path.write_text("<?xml version='1.0' encoding='UTF-8'?>\n<X3D profile='Full' version='4.0'><head>"
                    "<component name='RigidBodyPhysics' level='2'/></head><Scene>"
                    "<RigidBodyCollection>" + "".join(bodies) + "</RigidBodyCollection></Scene></X3D>\n")
    return len(bodies)


def stop_2():
    global OUT
    OUT = HERE / "02-physics"
    OUT.mkdir(parents=True, exist_ok=True)
    scene = clear_scene()
    scene.render.engine = "BLENDER_EEVEE"
    scene.frame_start, scene.frame_end = 1, 220
    scene.sync_mode = "NONE"                     # play every frame: a simulation must not skip
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.025, 0.04, 1)
    caption("Stop 2 · Physics", "First the X3D thread: a tower of 30 RigidBody nodes, written as an X3D RigidBodyCollection")
    yield 1.0
    x3d = OUT / "tower.x3d"
    fact("bodies_in_x3d", tower_x3d(x3d))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.x3d(filepath=str(x3d))
    blocks = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    fact("blocks_imported", len(blocks))
    fact("block_heights", sorted({round(o.matrix_world.translation.z, 3) for o in blocks}))
    bpy.ops.mesh.primitive_plane_add(size=30)
    ground = bpy.context.object
    ground.name = "Ground"
    gmat = bpy.data.materials.new("Floor")
    gmat.use_nodes = True
    next(n for n in gmat.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.12, 0.12, 0.14, 1)
    ground.data.materials.append(gmat)
    bpy.ops.object.camera_add(location=(5.2, -6.0, 2.6), rotation=(math.radians(80), 0, math.radians(42)))
    cam = bpy.context.object
    cam.data.lens = 35
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(40), math.radians(15), math.radians(30)))
    bpy.context.object.data.energy = 4
    workspace("Layout")
    yield 0.8
    look_through_camera(cam)
    viewport_glare(scene)
    yield 1.0
    caption("Imported where the file puts them", f"{len(blocks)} blocks, each placed by its RigidBody position and orientation (the #99 fix); X3D brings no motion")
    yield 1.0
    shot("1-tower-imported")
    # Blender's physics takes over: every block active, the floor passive
    bpy.ops.rigidbody.world_add()
    scene.rigidbody_world.substeps_per_frame = 20
    scene.rigidbody_world.solver_iterations = 20
    for o in blocks:
        bpy.context.view_layer.objects.active = o
        bpy.ops.rigidbody.object_add(type="ACTIVE")
        o.rigid_body.mass = 0.4
        o.rigid_body.friction = 0.6
        o.rigid_body.collision_shape = "BOX"
    bpy.context.view_layer.objects.active = ground
    bpy.ops.rigidbody.object_add(type="PASSIVE")
    # a wrecking ball: animated (kinematic) for its run-up, then handed to the solver with the speed it had
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.38, location=(-4.5, -0.15, 1.2))
    ball = bpy.context.object
    ball.name = "WreckingBall"
    bpy.ops.object.shade_smooth()
    bmat = emission_material("Chrome", (0.8, 0.82, 0.9), 0.0)
    bsdf = next(n for n in bmat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Metallic"].default_value = 1.0
    ball.data.materials.append(bmat)
    bpy.ops.rigidbody.object_add(type="ACTIVE")
    ball.rigid_body.mass = 12
    ball.rigid_body.collision_shape = "SPHERE"
    for frame, x, kinematic in ((1, -4.5, True), (30, -4.5, True), (44, -0.9, True), (45, -0.65, False)):
        ball.location.x = x
        ball.keyframe_insert("location", frame=frame)
        ball.rigid_body.kinematic = kinematic
        ball.keyframe_insert("rigid_body.kinematic", frame=frame)
    # cloth: silk dropping over a pedestal beside the tower
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.6, location=(1.6, 2.4, 0.6))
    pedestal = bpy.context.object
    pedestal.name = "Pedestal"
    bpy.ops.object.shade_smooth()
    bpy.ops.object.modifier_add(type="COLLISION")
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=48, y_subdivisions=48, size=2.4, location=(1.6, 2.4, 2.0))
    silk = bpy.context.object
    silk.name = "Silk"
    smat = bpy.data.materials.new("Silk")
    smat.use_nodes = True
    sb = next(n for n in smat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    sb.inputs["Base Color"].default_value = (0.75, 0.08, 0.25, 1)
    sb.inputs["Sheen Weight"].default_value = 1.0
    silk.data.materials.append(smat)
    bpy.ops.object.modifier_add(type="CLOTH")
    silk.modifiers["Cloth"].settings.quality = 8
    silk.modifiers["Cloth"].collision_settings.use_self_collision = True
    bpy.ops.object.modifier_add(type="SUBSURF")
    bpy.ops.object.shade_smooth()
    # the properties editor on the physics tab, for a block
    bpy.context.view_layer.objects.active = blocks[len(blocks) // 2]
    for a in areas("PROPERTIES"):
        try:
            a.spaces.active.context = "PHYSICS"
        except TypeError:
            pass
    bpy.ops.object.select_all(action="DESELECT")
    scene.frame_set(1)
    caption("Blender's solver takes over", "Bullet rigid bodies for the blocks, a kinematic wrecking ball handed to the solver at frame 45, cloth on the right")
    yield 1.5
    shot("2-ready")
    with bpy.context.temp_override(window=window()):
        bpy.ops.screen.animation_play()
    marks = []
    for k in range(7):
        yield 1.6
        marks.append(scene.frame_current)
        shot(f"3-impact-{k}")
    with bpy.context.temp_override(window=window()):
        bpy.ops.screen.animation_cancel(restore_frame=False)
    fact("frames_shot", marks)
    standing = sum(1 for o in blocks if o.matrix_world.translation.z > 0.6)
    fact("blocks_still_above_60cm", f"{standing} of {len(blocks)} at frame {scene.frame_current}")
    caption("And X3D?", "Placement survives the trip in; the simulation is Blender's. Bake it to keyframes to carry the fall back out")
    yield 1.2
    shot("4-x3d-caption")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "stop-02.blend"))
    caption("End of stop 2", "Saved: stop-02.blend, tower.x3d, screenshots")
    yield 0.8
    shot("5-end")


# -- stop 3: materials, light and render -----------------------------------------------------------------------------

def principled(name, **inputs):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    for key, value in inputs.items():
        bsdf.inputs[key.replace("_", " ")].default_value = value
    return mat, bsdf


def marble():
    """Marble from nothing: a noise texture warps a wave texture, a colour ramp turns the bands into veins."""
    mat, bsdf = principled("Marble", Roughness=0.22)
    nt = mat.node_tree
    coord = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 12.0
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 2.2
    wave.inputs["Distortion"].default_value = 9.0
    wave.inputs["Detail"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.0, (0.32, 0.30, 0.30, 1)
    e[1].position, e[1].color = 0.25, (0.93, 0.92, 0.89, 1)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Color"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    tidy(nt)
    return mat


def render_to(path, engine, samples=None):
    scene = bpy.context.scene
    scene.render.engine = engine
    if engine == "CYCLES":
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = "GPU"
        except Exception as error:
            fact("cycles_device", f"CPU ({type(error).__name__}: {error})")
        scene.cycles.samples = samples or 96
        scene.cycles.use_denoising = True
    scene.render.filepath = str(path)
    began = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    return round(time.perf_counter() - began, 2)


def stop_3():
    global OUT
    OUT = HERE / "03-render"
    OUT.mkdir(parents=True, exist_ok=True)
    scene = clear_scene()
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.014, 0.024, 1)
    caption("Stop 3 · Materials, light and render", "One still life, four renderers: EEVEE, Cycles, the compositor, and X_ITE in a browser")
    yield 1.0
    bpy.ops.mesh.primitive_plane_add(size=40)
    floor = bpy.context.object
    floor.name = "Floor"
    floor.data.materials.append(principled("Lacquer", Base_Color=(0.03, 0.03, 0.035, 1), Roughness=0.08)[0])
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1.1, depth=0.9, location=(0, 0, 0.45))
    pedestal = bpy.context.object
    pedestal.name = "Pedestal"
    pedestal.data.materials.append(marble())
    bpy.ops.object.shade_smooth()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=0.42, location=(-0.35, 0.1, 1.32))
    glass = bpy.context.object
    glass.name = "GlassSphere"
    bpy.ops.object.shade_smooth()
    glass_mat = principled("Glass", Base_Color=(0.9, 0.97, 1.0, 1), Roughness=0.0, Transmission_Weight=1.0, IOR=1.45)[0]
    glass_mat.use_raytrace_refraction = True          # EEVEE: refraction is ray traced only when the material asks
    glass.data.materials.append(glass_mat)
    scene.eevee.use_raytracing = True                 # ... and the scene allows it
    bpy.ops.mesh.primitive_torus_add(major_radius=0.34, minor_radius=0.1, location=(0.5, -0.2, 1.08),
                                     rotation=(math.radians(70), 0, math.radians(20)))
    gold = bpy.context.object
    gold.name = "GoldTorus"
    bpy.ops.object.shade_smooth()
    gold.data.materials.append(principled("Gold", Base_Color=(1.0, 0.76, 0.33, 1), Metallic=1.0, Roughness=0.16)[0])
    bpy.ops.mesh.primitive_torus_add(major_radius=1.55, minor_radius=0.025, location=(0, 0, 0.92))
    neon = bpy.context.object
    neon.name = "NeonRing"
    neon.data.materials.append(principled("Neon", Base_Color=(0.1, 0.9, 1.0, 1), Emission_Color=(0.1, 0.9, 1.0, 1),
                                          Emission_Strength=12.0)[0])
    bpy.ops.object.light_add(type="AREA", location=(-2.6, -2.2, 3.4), rotation=(math.radians(50), 0, math.radians(-50)))
    key = bpy.context.object
    key.data.energy, key.data.size = 420, 2.2
    bpy.ops.object.light_add(type="SPOT", location=(2.8, 2.6, 2.4), rotation=(math.radians(-60), 0, math.radians(135)))
    rim = bpy.context.object
    rim.data.energy, rim.data.color, rim.data.spot_size = 900, (1.0, 0.45, 0.75), math.radians(40)
    bpy.ops.object.camera_add(location=(0.2, -4.6, 2.05), rotation=(math.radians(78), 0, math.radians(2)))
    cam = bpy.context.object
    cam.data.lens = 50
    scene.camera = cam
    workspace("Shading")
    yield 1.2
    bpy.context.view_layer.objects.active = pedestal
    bpy.ops.object.select_all(action="DESELECT")
    pedestal.select_set(True)
    look_through_camera(cam)
    for a in areas("NODE_EDITOR"):
        a.spaces.active.node_tree = pedestal.active_material.node_tree
    yield 0.8
    frame_node_editor()
    caption("Marble from nothing", "Noise warps a Wave texture; a Color Ramp turns its bands into veins; the same bands feed a Bump")
    yield 1.5
    shot("1-shader-editor-marble")
    # the renders: EEVEE, then Cycles, the same scene
    caption("Rendering with EEVEE", "Rasterised, real-time: screen-space reflections, raytraced where it can")
    yield 0.5
    shot("2-before-eevee")
    fact("eevee_seconds", render_to(OUT / "render-eevee.png", "BLENDER_EEVEE"))
    caption("Rendering with Cycles", "Path traced: every bounce of light followed, then denoised")
    yield 0.5
    fact("cycles_seconds", render_to(OUT / "render-cycles.png", "CYCLES", samples=128))
    fact("cycles_device_used", scene.cycles.device)
    # the compositor on the EEVEE render
    caption("The compositor", "Glare streaks from the neon, a touch of lens dispersion, applied after the render")
    try:
        tree = bpy.data.node_groups.new("Tour Grade", "CompositorNodeTree")
        tree.interface.new_socket("Image", in_out="INPUT", socket_type="NodeSocketColor")
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        N = tree.nodes
        gin, gout = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
        rl = N.new("CompositorNodeRLayers")
        glare = N.new("CompositorNodeGlare")
        for k, v in (("Type", "Streaks"), ("Streaks", 6), ("Strength", 1.0), ("Threshold", 0.8)):
            if k in glare.inputs:
                try:
                    glare.inputs[k].default_value = v
                except TypeError:
                    pass
        lens = N.new("CompositorNodeLensdist")
        for k, v in (("Dispersion", 0.025), ("Distortion", -0.01)):
            if k in lens.inputs:
                lens.inputs[k].default_value = v
        tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
        tree.links.new(glare.outputs["Image"], lens.inputs["Image"])
        tree.links.new(lens.outputs["Image"], gout.inputs[0])
        tidy(tree)
        scene.compositing_node_group = tree
        workspace("Compositing")
        yield 1.2
        for a in areas("NODE_EDITOR"):
            try:
                a.spaces.active.node_tree = tree
            except Exception:
                pass
        frame_node_editor()
        fact("composited_seconds", render_to(OUT / "render-eevee-composited.png", "BLENDER_EEVEE"))
        yield 0.8
        shot("3-compositor")
    except Exception as error:
        fact("compositor", f"{type(error).__name__}: {error}")
    # the X3D thread
    caption("And X3D?", "Principled values travel as PhysicalMaterial; procedural marble and glass transmission do not")
    try:
        bpy.ops.export_scene.x3d(filepath=str(OUT / "still-life.x3d"))
        text = (OUT / "still-life.x3d").read_text(errors="replace")
        fact("x3d_bytes", len(text))
        fact("x3d_physical_materials", text.count("<PhysicalMaterial"))
        fact("x3d_has_transmission", "transmission" in text.lower())
        fact("x3d_textures", text.count("ImageTexture"))
    except Exception as error:
        fact("x3d_export", f"{type(error).__name__}: {error}")
    workspace("Rendering")
    yield 1.0
    for a in areas("IMAGE_EDITOR"):
        img = bpy.data.images.load(str(OUT / "render-cycles.png"), check_existing=True)
        a.spaces.active.image = img
    caption("The Cycles render", "Look at the glass: refraction of the neon ring and caustic-free light through the sphere")
    yield 1.2
    shot("4-cycles-in-image-editor")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "stop-03.blend"))
    caption("End of stop 3", "Saved: stop-03.blend, four renders, still-life.x3d")
    yield 0.6
    shot("5-end")


# -- stop 4: animation, drivers, shape keys, grease pencil -----------------------------------------------------------

def gear_mesh(name, teeth, radius, depth=0.18):
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    ring = []
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        w = math.pi / teeth
        for da, r in ((-w * 0.55, radius), (-w * 0.3, radius + 0.13), (w * 0.3, radius + 0.13), (w * 0.55, radius)):
            ring.append(bm.verts.new((r * math.cos(a + da), r * math.sin(a + da), 0)))
    face = bm.faces.new(ring)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, 0, depth), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def stop_4():
    global OUT
    OUT = HERE / "04-animation"
    OUT.mkdir(parents=True, exist_ok=True)
    scene = clear_scene()
    scene.render.engine = "BLENDER_EEVEE"
    scene.frame_start, scene.frame_end = 1, 120
    scene.render.fps = 24
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.045, 0.06, 1)
    caption("Stop 4 · Animation", "A ball bounces on hand-set keyframes; a driver squashes it with a shape key near the floor")
    yield 1.0
    bpy.ops.mesh.primitive_plane_add(size=30)
    floor = bpy.context.object
    floor.data.materials.append(principled("Paper", Base_Color=(0.85, 0.8, 0.7, 1), Roughness=0.9)[0])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.4, location=(-4, 0, 0.4))
    ball = bpy.context.object
    ball.name = "Ball"
    bpy.ops.object.shade_smooth()
    ball.data.materials.append(principled("Red Rubber", Base_Color=(0.85, 0.1, 0.08, 1), Roughness=0.35)[0])
    # keyframes: x walks linearly, z bounces: sharp at the floor (vector handles), round at the top (auto clamped)
    bounces = [(1, 3.2), (24, 0.4), (40, 2.3), (56, 0.4), (68, 1.5), (80, 0.4), (88, 0.9), (96, 0.4), (101, 0.6), (106, 0.4)]
    for frame, z in bounces:
        ball.location = (-4 + 8 * (frame - 1) / 105, 0, z)
        ball.keyframe_insert("location", frame=frame)
    action = ball.animation_data.action
    curves = [c for c in getattr(action, "fcurves", [])] or [c for layer in action.layers for strip in layer.strips
                                                               for bag in strip.channelbags for c in bag.fcurves]
    for c in curves:
        for kp in c.keyframe_points:
            if c.array_index == 0:
                kp.interpolation = "LINEAR"
            elif c.array_index == 2:
                low = kp.co[1] < 0.41
                kp.handle_left_type = kp.handle_right_type = "VECTOR" if low else "AUTO_CLAMPED"
        c.update()
    fact("ball_keyframes", sum(len(c.keyframe_points) for c in curves))
    # a shape key, driven by the ball's own height
    ball.shape_key_add(name="Basis")
    squash = ball.shape_key_add(name="Squash")
    for v, base in zip(squash.data, ball.data.vertices):
        x, y, z = base.co
        squash.data[v.index if hasattr(v, "index") else 0].co = (x * 1.3, y * 1.3, (z + 0.4) * 0.6 - 0.4) if False else (x * 1.3, y * 1.3, z * 0.62 - 0.15)
    driver = squash.driver_add("value").driver
    driver.type = "SCRIPTED"
    var = driver.variables.new()
    var.name, var.type = "z", "TRANSFORMS"
    var.targets[0].id = ball
    var.targets[0].transform_type = "LOC_Z"
    var.targets[0].transform_space = "WORLD_SPACE"
    driver.expression = "max(0.0, 1.0 - (z - 0.4) / 0.3)"
    fact("squash_driver_simple_expression", driver.is_simple_expression)
    # two gears meshed by a driver: B turns -A x 16/10
    a = gear_mesh("GearA", 16, 0.9)
    b = gear_mesh("GearB", 10, 0.55)
    a.location, b.location = (-1.2, 3.0, 1.6), (0.38, 3.0, 1.6)
    for g in (a, b):
        g.rotation_euler = (math.radians(90), 0, 0)
    a.data.materials.append(principled("Brass", Base_Color=(0.9, 0.65, 0.25, 1), Metallic=1.0, Roughness=0.3)[0])
    b.data.materials.append(principled("Steel", Base_Color=(0.6, 0.65, 0.7, 1), Metallic=1.0, Roughness=0.25)[0])
    # Euler XYZ applies Z last, about the world's vertical: a gear stood up by X spins on its axle through Y
    da = a.driver_add("rotation_euler", 1).driver
    da.type, da.expression = "SCRIPTED", "frame * 0.04"
    db = b.driver_add("rotation_euler", 1).driver
    vb = db.variables.new()
    vb.name, vb.type = "ra", "TRANSFORMS"
    vb.targets[0].id = a
    vb.targets[0].transform_type = "ROT_Y"
    vb.targets[0].transform_space = "LOCAL_SPACE"
    db.type, db.expression = "SCRIPTED", "-ra * 16 / 10 + 0.314"
    fact("gear_drivers_simple", [da.is_simple_expression, db.is_simple_expression])
    # grease pencil: an ink trail along the ball's arc, revealed by a Build modifier
    gp = bpy.data.grease_pencils.new("InkTrail")
    gp_obj = bpy.data.objects.new("InkTrail", gp)
    bpy.context.collection.objects.link(gp_obj)
    ink = bpy.data.materials.new("Ink")
    bpy.data.materials.create_gpencil_data(ink)
    ink.grease_pencil.color = (0.1, 0.15, 0.45, 1)
    gp.materials.append(ink)
    drawing = gp.layers.new("Ink").frames.new(1).drawing
    zc = next(c for c in curves if c.array_index == 2)
    samples = [(f / 2, ) for f in range(2, 213)]
    drawing.add_strokes([len(samples)])
    stroke = drawing.strokes[0]
    for p, (f,) in zip(stroke.points, samples):
        x = -4 + 8 * (f - 1) / 105
        p.position = (x, -0.45, zc.evaluate(f))
        p.radius = 0.035 + 0.02 * math.sin(f * 0.3) ** 2
        p.delta_time = (f - 1) / 24
    try:
        build = gp_obj.modifiers.new("Draw it", "GREASE_PENCIL_BUILD")
        for k, v in (("mode", "SEQUENTIAL"), ("transition", "GROW"), ("time_mode", "FRAMES"), ("length", 100), ("frame_duration", 100)):
            if hasattr(build, k):
                try:
                    setattr(build, k, v)
                except (TypeError, ValueError):
                    pass
        build.use_percentage = True                   # one drawing has no next keyframe to build towards:
        build.percentage_factor = 0.0                 # drive the reveal explicitly instead
        build.keyframe_insert("percentage_factor", frame=1)
        build.percentage_factor = 1.0
        build.keyframe_insert("percentage_factor", frame=106)
        fact("gp_build", "percentage keyed 0 -> 1 over frames 1-106")
    except Exception as error:
        fact("gp_build", f"{type(error).__name__}: {error}")
    bpy.ops.object.camera_add(location=(0, -11, 2.4), rotation=(math.radians(84), 0, 0))
    cam = bpy.context.object
    cam.data.lens = 38
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(35), math.radians(-25), 0))
    bpy.context.object.data.energy = 3.5
    workspace("Animation")
    yield 1.2
    look_through_camera(cam)
    for s in (a.select_set(False), b.select_set(False)):
        pass
    bpy.ops.object.select_all(action="DESELECT")
    ball.select_set(True)
    bpy.context.view_layer.objects.active = ball
    graph = None
    for area in window().screen.areas:
        if area.type == "DOPESHEET_EDITOR":
            area.type = "GRAPH_EDITOR"
            graph = area
            break
    yield 0.6
    if graph:
        with bpy.context.temp_override(window=window(), area=graph, region=region(graph)):
            bpy.ops.graph.view_all()
    caption("The Graph Editor", "Z bounces with sharp vector handles at the floor and round tops; X walks at a constant (linear) speed")
    scene.frame_set(1)
    yield 1.2
    shot("1-graph-editor")
    with bpy.context.temp_override(window=window()):
        bpy.ops.screen.animation_play()
    caption("Playing", "Watch the squash: the shape key's value is computed from the ball's height every frame, no keys")
    heights = []
    for k in range(6):
        yield 0.8
        heights.append((scene.frame_current, round(ball.matrix_world.translation.z, 2),
                        round(ball.data.shape_keys.key_blocks["Squash"].value, 2)))
        shot(f"2-bounce-{k}")
    with bpy.context.temp_override(window=window()):
        bpy.ops.screen.animation_cancel(restore_frame=False)
    fact("frame_height_squash", heights)
    if graph:
        graph.ui_type = "DRIVERS"
        yield 0.5
        bpy.ops.object.select_all(action="DESELECT")
        b.select_set(True)
        bpy.context.view_layer.objects.active = b
        yield 0.4
        with bpy.context.temp_override(window=window(), area=graph, region=region(graph)):
            try:
                bpy.ops.graph.view_all()
            except Exception:
                pass
    caption("Drivers", "GearB's turn is an expression of GearA's: -ra × 16/10 — the gears mesh, no keyframes")
    yield 1.0
    shot("3-drivers")
    caption("Grease Pencil", "2D ink living in 3D: the ball's own arc drawn as a stroke, revealed by a Build modifier")
    scene.frame_set(60)
    yield 1.0
    shot("4-ink-frame-60")
    scene.frame_set(115)
    yield 1.0
    shot("5-ink-frame-115")
    # the X3D thread: do keyframes and drivers survive?
    caption("And X3D?", "Keyframes can become interpolators; drivers and shape keys are the harder questions")
    try:
        bpy.ops.export_scene.x3d(filepath=str(OUT / "bounce.x3d"), use_animation=True)
        text = (OUT / "bounce.x3d").read_text(errors="replace")
        fact("x3d_interpolators", {k: text.count(f"<{k}") for k in ("TimeSensor", "PositionInterpolator",
             "OrientationInterpolator", "CoordinateInterpolator", "ScalarInterpolator", "ROUTE")})
    except Exception as error:
        fact("x3d_export", f"{type(error).__name__}: {error}")
    yield 1.0
    shot("6-x3d-caption")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "stop-04.blend"))
    caption("End of the tour", "Saved: stop-04.blend, bounce.x3d, screenshots. Four wings visited.")
    yield 0.8
    shot("7-end")


STOPS = {1: stop_1, 2: stop_2, 3: stop_3, 4: stop_4}


# -- the timer that runs a stop as a generator -------------------------------------------------------------------------

def run():
    try:
        load_addon()
    except Exception:
        NOTES["errors"].append(traceback.format_exc())
    yield 0.5
    window().event_simulate(type="ESC", value="PRESS")
    window().event_simulate(type="ESC", value="RELEASE")
    yield 0.4
    try:
        yield from STOPS[STOP]()
    except Exception:
        NOTES["errors"].append(traceback.format_exc())
        print(traceback.format_exc())
        if OUT:
            shot("error")


_GEN = run()


def _tick():
    try:
        return next(_GEN)
    except StopIteration:
        if OUT:
            (OUT / "notes.json").write_text(json.dumps(NOTES, indent=1))
        print("[tour] done", OUT)
        bpy.ops.wm.quit_blender()
        return None


bpy.app.timers.register(_tick, first_interval=1.0)
