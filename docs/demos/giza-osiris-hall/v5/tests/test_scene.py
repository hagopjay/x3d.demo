"""Structural and reproducibility checks for the procedural X3D world.

Run from v5 with: python3 -m unittest discover -s tests -p 'test_*.py'
No browser or third-party Python package is required. These checks validate
the scene contract and geometry; they do not replace a visual browser check.
"""
from __future__ import annotations

from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import math
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "horizon.x3d"
GENERATOR = ROOT / "build_scene.py"


def floats(node: ET.Element, field: str) -> list[float]:
    return [float(value) for value in node.get(field, "").split()]


class SceneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = ET.parse(SCENE).getroot()
        cls.def_nodes = [node for node in cls.root.iter() if "DEF" in node.attrib]
        cls.defs = {node.get("DEF"): node for node in cls.def_nodes}

    def test_public_node_contracts_have_expected_types(self):
        contracts = {
            **{name: "Viewpoint" for name in (
                "V_Overview", "V_Cutaway", "V_Chamber", "V_Stars", "V_Ritual",
                "V_Immersive", "V_Witness", "V_Tesla", "V_Regional", "V_Atmosphere", "V_Earth")},
            **{name: "Switch" for name in (
                "SW_SHELL_FRONT", "SW_QUARTZ", "SW_CONDUCTOR", "SW_FIELD",
                "SW_KA", "SW_COSMIC", "SW_DEVICE", "SW_CHAMBER_ROOF",
                "SW_MACHINERY", "SW_CRAFT", "SW_BEINGS", "SW_ROYAL_BODY", "SW_WAS_AURA",
                "SW_TESLA", "SW_ARCS", "SW_SKY_ELECTRODE", "SW_REGIONAL", "SW_EARTH_CIRCUIT")},
            **{name: "Transform" for name in (
                "T_WATER", "T_FIELD", "T_KA", "T_HEART", "T_HEAD", "T_WAS",
                "T_MACHINE", "T_CRAFT", "T_BEINGS", "T_ARC_ROOT", "T_ARC_SPAN",
                "T_SKY_ELECTRODE", "T_CORONA", "T_REGIONAL", "T_EARTH_PHASE")},
            "NAV": "NavigationInfo",
            "M_FIELD": "Material",
            "M_WAS_GLOW": "Material",
            "M_ARC_CORE": "Material",
            "M_ARC_HALO": "Material",
            "M_GRID_GLOW": "Material",
            "ARC_POINTS": "Coordinate",
            "HALO_POINTS": "Coordinate",
        }
        for name, tag in contracts.items():
            with self.subTest(name=name):
                self.assertIn(name, self.defs)
                self.assertEqual(self.defs[name].tag, tag)

    def test_def_names_are_unique_and_use_types_match(self):
        self.assertEqual(len(self.def_nodes), len(self.defs), "duplicate DEF name")
        for node in self.root.iter():
            if "USE" in node.attrib:
                name = node.get("USE")
                with self.subTest(USE=name):
                    self.assertIn(name, self.defs)
                    self.assertEqual(node.tag, self.defs[name].tag)
                    self.assertEqual(set(node.attrib), {"USE"})

    def test_indexed_geometry_uses_complete_finite_coordinates(self):
        geometries = [node for node in self.root.iter()
                      if node.tag in {"IndexedFaceSet", "IndexedLineSet"}]
        self.assertTrue(geometries)
        for number, geometry in enumerate(geometries):
            with self.subTest(geometry=number, type=geometry.tag):
                coordinate = geometry.find("Coordinate")
                self.assertIsNotNone(coordinate)
                points = floats(coordinate, "point")
                self.assertTrue(points)
                self.assertEqual(len(points) % 3, 0)
                self.assertTrue(all(math.isfinite(v) for v in points))
                indices = [int(value) for value in geometry.get("coordIndex", "").split()]
                self.assertTrue(indices)
                self.assertEqual(indices[-1], -1)
                self.assertTrue(all(index == -1 or 0 <= index < len(points)//3
                                    for index in indices))
                minimum = 3 if geometry.tag == "IndexedFaceSet" else 2
                run = []
                for index in indices:
                    if index == -1:
                        self.assertGreaterEqual(len(run), minimum)
                        run = []
                    else:
                        run.append(index)
                color = geometry.find("Color")
                if color is not None and geometry.get("colorPerVertex") == "false":
                    self.assertEqual(len(floats(color, "color"))//3, indices.count(-1))

    def test_color_and_star_attributes_are_valid(self):
        for color in self.root.iter("Color"):
            values = floats(color, "color")
            self.assertEqual(len(values) % 3, 0)
            self.assertTrue(all(math.isfinite(v) and 0 <= v <= 1 for v in values))
        for points in self.root.iter("PointSet"):
            coordinate = points.find("Coordinate")
            color = points.find("Color")
            self.assertIsNotNone(coordinate)
            self.assertIsNotNone(color)
            vertices = floats(coordinate, "point")
            self.assertEqual(len(vertices), len(floats(color, "color")))
            self.assertTrue(all(math.isfinite(v) for v in vertices))

    def test_scene_has_no_external_asset_dependencies(self):
        external_asset_types = {
            "Inline", "ExternProtoDeclare", "ImageTexture", "MovieTexture",
            "AudioClip", "ImageCubeMapTexture", "ImageTexture3D", "Script",
        }
        for node in self.root.iter():
            self.assertNotIn(node.tag, external_asset_types)
            for field, value in node.attrib.items():
                if field.lower().endswith("url"):
                    self.assertFalse(value.strip(), f"external URL in {node.tag}.{field}")

    def test_device_choices_and_initial_visibility_are_deliberate(self):
        device = self.defs["SW_DEVICE"]
        self.assertEqual([child.tag for child in device], ["Group"]*3)
        self.assertTrue(all(len(child) > 0 for child in device))
        visible = {"SW_DEVICE", "SW_QUARTZ", "SW_FIELD", "SW_ROYAL_BODY"}
        hidden = {"SW_SHELL_FRONT", "SW_CONDUCTOR", "SW_KA", "SW_COSMIC", "SW_CHAMBER_ROOF",
                  "SW_MACHINERY", "SW_CRAFT", "SW_BEINGS", "SW_WAS_AURA"}
        for name in visible | hidden:
            with self.subTest(name=name):
                self.assertEqual(int(self.defs[name].get("whichChoice")), 0 if name in visible else -1)
        # A Ka-rise update is an offset, preserving the chamber-local placement.
        self.assertEqual(floats(self.defs["T_KA"], "translation"), [0, 0, 0])

    def test_journey_camera_and_fiction_layers_have_safe_separated_bounds(self):
        # The reclining camera clears the sarcophagus. Its offset can be moved
        # independently of the fixed witness camera during the ascent.
        eye = floats(self.defs["V_Immersive"], "position")
        self.assertLess(abs(eye[0]), .5)
        self.assertTrue(41.7 < eye[1] < 42.4)
        self.assertTrue(-1.2 < eye[2] < -.3)
        for name in ("V_Immersive", "V_Witness"):
            node = self.defs[name]
            axis_angle = floats(node, "orientation")
            self.assertEqual(len(axis_angle), 4)
            self.assertTrue(all(math.isfinite(value) for value in axis_angle))
            self.assertAlmostEqual(sum(v*v for v in axis_angle[:3]), 1, places=5)
            self.assertEqual(node.get("retainUserOffsets"), "false")
        # The craft remains above and behind the encounter figures, preserving
        # silhouettes and preventing a full-size hull from blocking their shot.
        craft = floats(self.defs["CRAFT_ANCHOR"], "translation")
        dais = floats(self.defs["BEINGS_ANCHOR"], "translation")
        self.assertGreater(craft[1]-dais[1], 35)
        self.assertLess(craft[2]-dais[2], -45)
        hull = floats(self.defs["G_CRAFT_HULL"].find("Coordinate"), "point")
        self.assertTrue(all(abs(v) <= 54 for v in hull[0::3]))
        self.assertTrue(all(-7 < v < 10 for v in hull[1::3]))
        self.assertTrue(all(abs(v) < 26 for v in hull[2::3]))
        self.assertEqual(floats(self.defs["T_CRAFT"], "translation"), [0, 0, 0])
        self.assertEqual(floats(self.defs["T_BEINGS"], "scale"), [1, 1, 1])
        for name in ("BEING_LEFT", "BEING_CENTRE", "BEING_RIGHT"):
            position = floats(self.defs[name], "translation")
            self.assertTrue(abs(position[0]) <= 15 and position[1] == 0 and abs(position[2]) <= 5)
            self.assertTrue(all(4 < value < 6 for value in floats(self.defs[name], "scale")))

    def test_tesla_master_and_features_are_independently_hidden(self):
        master = self.defs["SW_TESLA"]
        self.assertEqual(master.get("whichChoice"), "-1")
        children = {node.get("DEF"): node for node in master.iter("Switch")}
        for name in ("SW_ARCS", "SW_SKY_ELECTRODE", "SW_REGIONAL", "SW_EARTH_CIRCUIT"):
            with self.subTest(name=name):
                self.assertIn(name, children)
                self.assertEqual(children[name].get("whichChoice"), "-1")
                self.assertEqual(len(children[name]), 1)
        # Canonical geometry is static: pulse intensity can be updated without
        # a built-in random strobe, sequencer, or repeated scene mutation.
        self.assertFalse(list(master.iter("TimeSensor")))
        self.assertFalse(list(master.iter("BooleanSequencer")))

    def test_standing_channels_keep_apex_and_canopy_endpoints_coherent(self):
        self.assertEqual(floats(self.defs["T_ARC_ROOT"], "translation"), [0, 146, 0])
        self.assertEqual(floats(self.defs["T_ARC_SPAN"], "scale"), [1, 1, 1])
        self.assertEqual(floats(self.defs["T_SKY_ELECTRODE"], "translation"), [0, 500, 0])
        core = floats(self.defs["ARC_POINTS"], "point")
        halo = floats(self.defs["HALO_POINTS"], "point")
        self.assertEqual(core, halo)
        points = [tuple(core[i:i+3]) for i in range(0, len(core), 3)]
        self.assertTrue(all(0 <= point[1] <= 354 for point in points))
        self.assertAlmostEqual(146 + max(point[1] for point in points), 500)
        parent = next(node for node in self.root.iter("IndexedLineSet")
                      if node.find("Coordinate") is self.defs["ARC_POINTS"])
        paths, run = [], []
        for index in map(int, parent.get("coordIndex").split()):
            if index == -1:
                paths.append(run)
                run = []
            else:
                run.append(points[index])
        self.assertGreaterEqual(len(paths), 16)
        trunks = [path for path in paths if path[0] == (0, 0, 0)]
        self.assertEqual(len(trunks), 8)
        trunk_points = {point for path in trunks for point in path}
        for path in paths:
            self.assertEqual(path[-1][1], 354)
            self.assertIn(path[0], trunk_points)
            self.assertTrue(all(b[1] > a[1] for a, b in zip(path, path[1:])))

    def test_regional_receivers_form_a_bounded_southward_display(self):
        self.assertEqual(floats(self.defs["T_REGIONAL"], "translation"), [0, 0, 0])
        self.assertEqual(floats(self.defs["T_REGIONAL"], "scale"), [1, 1, 1])
        values = floats(self.defs["REGIONAL_NODE_POINTS"], "point")
        self.assertEqual(len(values), 26 * 3)
        points = [values[i:i+3] for i in range(0, len(values), 3)]
        self.assertTrue(all(150 < x < 1000 and 10 < y < 40 and 0 <= z < 3300
                            for x, y, z in points))
        self.assertTrue(all(b[2] > a[2] for a, b in zip(points, points[1:])))
        self.assertGreater(points[-1][2] - points[0][2], 3000)
        stations = self.defs["REGIONAL_STATIONS"]
        self.assertEqual(len(stations), 26)
        self.assertEqual(len({node.get("DEF") for node in stations}), 26)

    def test_earth_is_a_separate_scale_with_a_surface_pyramid_node(self):
        anchor = floats(self.defs["EARTH_ANCHOR"], "translation")
        self.assertGreater(math.sqrt(sum(value*value for value in anchor)), 2000)
        centre = floats(self.defs["V_Earth"], "centerOfRotation")
        self.assertEqual(anchor, centre)
        pyramid = floats(self.defs["EARTH_PYRAMID_NODE"], "translation")
        self.assertAlmostEqual(math.sqrt(sum(value*value for value in pyramid)), 424, places=3)
        rotation = floats(self.defs["T_EARTH_PHASE"], "rotation")
        self.assertEqual(rotation, [0, 1, 0, 0])
        text = self.root.find("head/meta[@name='tesla-scales']").get("content")
        self.assertIn("50000", text)
        self.assertIn("separate scale", text)

    def test_generator_reproduces_checked_scene_without_mutating_it(self):
        before = hashlib.sha256(SCENE.read_bytes()).digest()
        spec = importlib.util.spec_from_file_location("horizon_scene_for_test", GENERATOR)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix="giza-v5-scene-") as directory:
            output = Path(directory) / "regenerated.x3d"
            with redirect_stdout(io.StringIO()):
                module.main(output)
            self.assertEqual(hashlib.sha256(output.read_bytes()).digest(), before)
        self.assertEqual(hashlib.sha256(SCENE.read_bytes()).digest(), before)


if __name__ == "__main__":
    unittest.main()
