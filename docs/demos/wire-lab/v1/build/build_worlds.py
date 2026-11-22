# SPDX-License-Identifier: GPL-3.0-or-later
"""Builds the three Wire Lab worlds with the scripting methods of x3d-blender-io's behaviour graph.

    python build/build_worlds.py /path/to/x3d-blender-io

Each world is a plain X3D scene (shapes only) plus a behaviour graph written by a short function below. The page shows
that function, so the script a visitor reads is the script that built what they see. Outputs: worlds/<name>.json (scene,
graph, script, challenges), worlds/<name>.x3d (the woven file, checked against the X3D 4.0 schema) and catalogue.json.
"""
import hashlib
import inspect
import json
import subprocess
import sys
import textwrap
from pathlib import Path

ADDON = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(ADDON / "source"))
import behaviour_graph as bg                                        # noqa: E402
from behaviour_catalogue import NODES, TARGETS, X3DUOM_SHA256, X3DUOM_VERSION    # noqa: E402
from validate import validate_xml_text                               # noqa: E402

HERE = Path(__file__).resolve().parents[1]

HEAD = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">
  <head>
    <component name="EventUtilities" level="1"/>
    <component name="Followers" level="1"/>
    <meta name="title" content="{title}"/>
    <meta name="creator" content="x3d.demo Wire Lab"/>
    <meta name="generator" content="x3d-blender-io behaviour_graph scripting methods"/>
    <meta name="license" content="GPL-3.0-or-later"/>
  </head>
  <Scene>
    <NavigationInfo type='"NONE"' headlight="true"/>
    <Background skyColor="0.02 0.03 0.07 0.07 0.09 0.18" skyAngle="1.6" groundColor="0.05 0.06 0.11"/>
{body}  </Scene>
</X3D>
"""


def shape(geometry, colour, *, name=None, emissive="0 0 0", rough=0.45, metal=0.0):
    material = f'<PhysicalMaterial{f" DEF=\"{name}\"" if name else ""} baseColor="{colour}" emissiveColor="{emissive}" ' \
               f'roughness="{rough}" metallic="{metal}"/>'
    return f"<Shape><Appearance>{material}</Appearance>{geometry}</Shape>"


FLOOR = f'    <Transform translation="0 -0.05 0">{shape("<Box size=\"14 0.1 8\"/>", "0.10 0.12 0.18", rough=0.9)}</Transform>\n'
SUN = '    <DirectionalLight direction="-0.4 -1 -0.6" intensity="2.2"/>\n'

# ---------------------------------------------------------------------------------------------------------------
# World 1: the door
# ---------------------------------------------------------------------------------------------------------------
DOOR_SCENE = (
    '    <Viewpoint DEF="View" description="Front" position="0 1.7 8.5" orientation="1 0 0 -0.04"/>\n' + SUN + FLOOR +
    f'    <Transform translation="-0.85 1.25 0">{shape("<Box size=\"0.2 2.5 0.3\"/>", "0.35 0.38 0.45")}</Transform>\n'
    f'    <Transform translation="0.85 1.25 0">{shape("<Box size=\"0.2 2.5 0.3\"/>", "0.35 0.38 0.45")}</Transform>\n'
    f'    <Transform translation="0 2.6 0">{shape("<Box size=\"1.9 0.2 0.3\"/>", "0.35 0.38 0.45")}</Transform>\n'
    f'    <Transform DEF="Door" translation="0 1.2 0">{shape("<Box size=\"1.5 2.4 0.12\"/>", "0.85 0.45 0.15", name="DoorPaint")}</Transform>\n'
    f'    <Transform DEF="Button" translation="-2.4 1.2 0.4">{shape("<Sphere radius=\"0.38\"/>", "0.9 0.15 0.2", name="ButtonPaint", emissive="0.25 0 0")}</Transform>\n'
    f'    <Transform DEF="Lamp" translation="2.4 2.6 0.4">{shape("<Sphere radius=\"0.3\"/>", "0.2 0.2 0.25", name="LampGlow", emissive="0.05 0.05 0.08")}</Transform>\n'
)


def door():
    b = bg.Behaviour()
    click = b.add("TouchSensor", "Click", parent="Button", description="open the door")
    timer = b.add("TimeSensor", "Timer", cycleInterval=3)
    slide = b.add("PositionInterpolator", "Slide",
                  key=[0, 0.4, 0.6, 1],
                  keyValue=[(0, 1.2, 0), (0, 3.7, 0), (0, 3.7, 0), (0, 1.2, 0)])
    door = b.target("Transform", "Door")
    click.touchTime >> timer.startTime             # a click sends the time; the timer starts at that time
    timer.fraction_changed >> slide.set_fraction   # the timer counts 0 to 1; the interpolator turns that into a place
    slide.value_changed >> door.translation        # the place moves the door
    return b


DOOR = {
    "id": "door", "title": "The Door", "tagline": "Three wires make a door open. Then make it yours.",
    "idea": "A ROUTE carries an event from one field to another field of the same type. A click is a time. A timer turns "
            "time into a number from 0 to 1. An interpolator turns that number into a place.",
    "extras": ["Lamp", "LampGlow", "DoorPaint", "ButtonPaint", "View"],
    "challenges": [
        {"title": "Open it without clicking",
         "ask": "Make the door open when the pointer only hovers over the red button.",
         "hint": "isOver is a yes/no (SFBool). startTime wants a time (SFTime). The wire will be refused. Add a "
                 "TimeTrigger: it turns a yes into a time.",
         "needs": [["TouchSensor", "isOver", "TimeTrigger", "set_boolean"], ["TimeTrigger", "triggerTime", "TimeSensor", "startTime"]]},
        {"title": "Light the lamp while it moves",
         "ask": "Make the lamp change colour for as long as the door is moving.",
         "hint": "Add a ColorInterpolator. Feed it the timer's fraction_changed. Send its value_changed to LampGlow's "
                 "emissiveColor. Give it key 0 0.5 1 and keyValue 0 0 0  1 0.8 0.2  0 0 0.",
         "needs": [["TimeSensor", "fraction_changed", "ColorInterpolator", "set_fraction"], ["ColorInterpolator", "value_changed", "LampGlow", "emissiveColor"]]},
        {"title": "Spin, don't slide",
         "ask": "Make the door swing like a revolving door.",
         "hint": "An OrientationInterpolator makes rotations (axis x y z, then an angle in radians). "
                 "Try key 0 0.5 1 and keyValue 0 1 0 0  0 1 0 3.14  0 1 0 6.28, and wire it to Door's rotation.",
         "needs": [["TimeSensor", "fraction_changed", "OrientationInterpolator", "set_fraction"], ["OrientationInterpolator", "value_changed", "Door", "rotation"]]},
    ],
}

# ---------------------------------------------------------------------------------------------------------------
# World 2: the ripple counter
# ---------------------------------------------------------------------------------------------------------------


def _bit(index, x):
    socket = shape('<Sphere radius="0.42"/>', "0.12 0.13 0.18", rough=0.3)
    glow = shape('<Sphere radius="0.5"/>', "1 0.75 0.2", emissive="1 0.7 0.15")
    post = shape('<Cylinder radius="0.07" height="1.6"/>', "0.3 0.32 0.4")
    return (f'    <Transform translation="{x} 0.8 0">{post}</Transform>\n'
            f'    <Transform translation="{x} 2 0">{socket}<Transform DEF="Bit{index}" visible="false">{glow}</Transform></Transform>\n')


COUNTER_SCENE = (
    '    <Viewpoint DEF="View" description="Front" position="0 1.9 9.5" orientation="1 0 0 -0.03"/>\n' + SUN + FLOOR +
    "".join(_bit(i, 3 - 2 * i) for i in range(4)) +
    f'    <Transform DEF="Button" translation="0 0.45 2.2">{shape("<Cylinder radius=\"0.55\" height=\"0.3\"/>", "0.9 0.15 0.2", emissive="0.25 0 0")}</Transform>\n'
)


def counter():
    b = bg.Behaviour()
    press = b.add("TouchSensor", "Press", parent="Button", description="add one")
    flip0 = b.add("BooleanToggle", "Flip0")
    carry0 = b.add("BooleanFilter", "Carry0")
    flip1 = b.add("BooleanToggle", "Flip1")
    bit0 = b.target("Transform", "Bit0")
    bit1 = b.target("Transform", "Bit1")
    press.isActive >> flip0.set_boolean     # pressing sends yes; a BooleanToggle flips every time it hears yes
    flip0.toggle >> bit0.visible            # the flip shows or hides the first lamp
    flip0.toggle >> carry0.set_boolean      # the same flip also goes to a filter ...
    carry0.inputNegate >> flip1.set_boolean  # ... which says yes exactly when the lamp went OFF: that is the carry
    flip1.toggle >> bit1.visible
    return b


COUNTER = {
    "id": "counter", "title": "The Ripple Counter", "tagline": "Two kinds of node, no code, and the lamps count in binary.",
    "idea": "Events can compute. A BooleanToggle is one bit of memory. A BooleanFilter's inputNegate says yes when its "
            "input says no, which is the moment a bit rolls over from 1 to 0. Chain them and you have built the counter "
            "inside every computer.",
    "extras": ["Bit2", "Bit3", "View"],
    "readout": {"bits": ["Bit0", "Bit1", "Bit2", "Bit3"]},
    "challenges": [
        {"title": "Count to fifteen",
         "ask": "Lamps 3 and 4 are dark. Wire them in so the counter reaches 15.",
         "hint": "Copy the pattern: Flip1.toggle goes to a new BooleanFilter, its inputNegate goes to a new BooleanToggle, "
                 "and that toggle goes to Bit2's visible. Once more for Bit3.",
         "needs": [["BooleanToggle", "toggle", "Bit2", "visible"], ["BooleanToggle", "toggle", "Bit3", "visible"]]},
        {"title": "Let a clock press the button",
         "ask": "Make it count by itself, once a second.",
         "hint": "A TimeSensor with loop on sends cycleTime (a time) every cycle. A BooleanTrigger turns a time into "
                 "a yes. Send that yes to Flip0's set_boolean.",
         "needs": [["TimeSensor", "cycleTime", "BooleanTrigger", "set_triggerTime"], ["BooleanTrigger", "triggerTrue", "Flip0", "set_boolean"]]},
        {"title": "Count down",
         "ask": "Make the counter run backwards: 0, 15, 14, 13 ...",
         "hint": "Counting down borrows when a bit goes from 0 to 1. BooleanFilter has an output for that moment too: "
                 "inputTrue. Use it in place of inputNegate.",
         "needs": [["BooleanFilter", "inputTrue", "BooleanToggle", "set_boolean"]]},
    ],
}

# ---------------------------------------------------------------------------------------------------------------
# World 3: the follower
# ---------------------------------------------------------------------------------------------------------------
_SEGMENTS = [(0.34, "0.25 0.75 0.95"), (0.29, "0.3 0.6 0.95"), (0.24, "0.45 0.45 0.95"), (0.19, "0.6 0.35 0.9")]
SNAKE_SCENE = (
    '    <Viewpoint DEF="View" description="Front" position="0 2.2 10" orientation="1 0 0 -0.02"/>\n' + SUN + FLOOR +
    f'    <Transform DEF="Rig"><Transform DEF="Head" translation="0 2.2 0">{shape("<Sphere radius=\"0.42\"/>", "1 0.8 0.25", emissive="0.5 0.35 0.05")}</Transform></Transform>\n' +
    "".join(f'    <Transform DEF="Seg{i + 1}" translation="{-1.0 * (i + 1)} 0.5 0">{shape(f"<Sphere radius=\"{r}\"/>", c, emissive="0.02 0.05 0.12")}</Transform>\n'
            for i, (r, c) in enumerate(_SEGMENTS)) +
    f'    <Transform DEF="Beacon" translation="4.6 3.6 -1" visible="false">{shape("<Sphere radius=\"0.25\"/>", "0.4 1 0.5", emissive="0.3 1 0.4")}</Transform>\n'
)


def snake():
    b = bg.Behaviour()
    clock = b.add("TimeSensor", "Clock", loop=True, cycleInterval=7)
    path = b.add("PositionInterpolator", "Path",
                 key=[0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
                 keyValue=[(0, 2.2, 0), (2.2, 3.4, 0), (3.6, 2.2, 0), (2.2, 1, 0), (0, 2.2, 0),
                           (-2.2, 3.4, 0), (-3.6, 2.2, 0), (-2.2, 1, 0), (0, 2.2, 0)])
    head = b.target("Transform", "Head")
    seg1 = b.target("Transform", "Seg1")
    seg2 = b.target("Transform", "Seg2")
    follow1 = b.add("PositionDamper", "Follow1", tau=0.25, order=2, initialValue=(-1, 0.5, 0), initialDestination=(-1, 0.5, 0))
    follow2 = b.add("PositionDamper", "Follow2", tau=0.25, order=2, initialValue=(-2, 0.5, 0), initialDestination=(-2, 0.5, 0))
    clock.fraction_changed >> path.set_fraction
    path.value_changed >> head.translation
    head.translation >> follow1.set_destination     # a Transform also SENDS its translation whenever it changes
    follow1.value_changed >> seg1.translation       # the damper chases that place, smoothly, and moves segment 1
    seg1.translation >> follow2.set_destination     # segment 2 chases segment 1: a chain
    follow2.value_changed >> seg2.translation
    return b


SNAKE = {
    "id": "snake", "title": "The Follower", "tagline": "No physics engine. Each bead only chases the one in front.",
    "idea": "An input-and-output field sends an event whenever it changes, so a moving object can drive other nodes. "
            "A PositionDamper chases a place smoothly (tau is how lazy it is). Chain dampers and the lag adds up into a "
            "tail that looks alive.",
    "extras": ["Seg3", "Seg4", "Rig", "Beacon", "View"],
    "challenges": [
        {"title": "Grow the tail",
         "ask": "Beads 3 and 4 sit on the floor. Make them follow.",
         "hint": "Add a PositionDamper. Seg2's translation goes to its set_destination; its value_changed goes to Seg3's "
                 "translation. Repeat for Seg4. Try a bigger tau on the last one.",
         "needs": [["PositionDamper", "value_changed", "Seg3", "translation"], ["PositionDamper", "value_changed", "Seg4", "translation"]]},
        {"title": "Take the wheel",
         "ask": "Drag the golden head with the mouse.",
         "hint": "Add a PlaneSensor that sits in Rig. Wire its translation_changed to Head's translation, and cut the "
                 "wire from Path so the two do not fight. Then drag the head.",
         "needs": [["PlaneSensor", "translation_changed", "Head", "translation"]],
         "lacks": [["PositionInterpolator", "value_changed", "Head", "translation"]]},
        {"title": "A light that knows it is moving",
         "ask": "Make the green beacon appear only while the tail is still catching up.",
         "hint": "A damper sends isActive: yes while it is still moving, no when it has arrived. "
                 "Wire the last damper's isActive to Beacon's visible.",
         "needs": [["PositionDamper", "isActive", "Beacon", "visible"]]},
    ],
}

# ---------------------------------------------------------------------------------------------------------------


def build(world, scene_body, function):
    graph = function()
    for name in world.get("extras", ()):          # scene parts on the bench, not yet wired
        element_type = next(e.tag for e in bg.ET.fromstring(HEAD.format(title="", body=scene_body)).iter() if e.get("DEF") == name)
        graph.target(element_type, name)
    assert graph.check() == [], graph.check()
    for node_id, position in bg.layout(graph, column=300, row=170).items():
        graph.nodes[node_id].position = position
    scene = HEAD.format(title=f"Wire Lab: {world['title']}", body=scene_body)
    woven = graph.weave(scene)
    result = validate_xml_text(woven)
    assert result.valid, result
    again = bg.Behaviour.from_x3d(woven)
    difference = bg.difference(graph, again)
    assert not any(difference.values()), difference
    source = textwrap.dedent(inspect.getsource(function))
    (HERE / "worlds" / f"{world['id']}.x3d").write_text(woven, encoding="utf-8")
    data = dict(world, scene=scene, graph=bg.to_json(graph), script=source, sentences=graph.explain(),
                x3d_sha256=hashlib.sha256(woven.encode()).hexdigest(),
                counts={"nodes": sum(1 for n in graph.nodes.values() if n.role == bg.BEHAVIOUR), "routes": len(graph.routes)})
    (HERE / "worlds" / f"{world['id']}.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
    print(world["id"], data["counts"], "XSD valid, weave/read difference: none")


if __name__ == "__main__":
    build(DOOR, DOOR_SCENE, door)
    build(COUNTER, COUNTER_SCENE, counter)
    build(SNAKE, SNAKE_SCENE, snake)
    commit = subprocess.run(["git", "-C", str(ADDON), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    catalogue = {
        "about": "X3D behaviour node catalogue, generated from the X3D Unified Object Model by x3d-blender-io "
                 "tools/behaviour_catalogue_gen.py; this file is that catalogue as JSON.",
        "x3duom_version": X3DUOM_VERSION, "x3duom_sha256": X3DUOM_SHA256, "addon_commit": commit,
        "nodes": {name: {"group": group, "fields": [list(row) for row in rows]} for name, (group, rows) in NODES.items()},
        "targets": {name: [list(row) for row in rows] for name, rows in TARGETS.items()},
        "placed": sorted(bg.PLACED_TYPES),
    }
    (HERE / "catalogue.json").write_text(json.dumps(catalogue, separators=(",", ":")), encoding="utf-8")
    cases = json.loads((ADDON / "tests" / "behaviour" / "route-cases.json").read_text(encoding="utf-8"))
    (HERE / "build" / "route-cases.json").write_text(json.dumps(cases, indent=1), encoding="utf-8")
    print("catalogue", len(catalogue["nodes"]), "nodes,", len(catalogue["targets"]), "targets;", len(cases["cases"]), "route cases")
