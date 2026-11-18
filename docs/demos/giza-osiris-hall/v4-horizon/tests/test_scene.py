"""Structural and reproducibility checks for the procedural X3D world.

Run from v4 with: python3 -m unittest discover -s tests -p 'test_*.py'
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
                "V_Immersive", "V_Witness")},
            **{name: "Switch" for name in (
                "SW_SHELL_FRONT", "SW_QUARTZ", "SW_CONDUCTOR", "SW_FIELD",
                "SW_KA", "SW_COSMIC", "SW_DEVICE", "SW_CHAMBER_ROOF",
                "SW_MACHINERY", "SW_CRAFT", "SW_BEINGS", "SW_ROYAL_BODY", "SW_WAS_AURA")},
            **{name: "Transform" for name in (
                "T_WATER", "T_FIELD", "T_KA", "T_HEART", "T_HEAD", "T_WAS",
                "T_MACHINE", "T_CRAFT", "T_BEINGS")},
            "NAV": "NavigationInfo",
            "M_FIELD": "Material",
            "M_WAS_GLOW": "Material",
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

    def test_generator_reproduces_checked_scene_without_mutating_it(self):
        before = hashlib.sha256(SCENE.read_bytes()).digest()
        spec = importlib.util.spec_from_file_location("horizon_scene_for_test", GENERATOR)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix="giza-v4-scene-") as directory:
            output = Path(directory) / "regenerated.x3d"
            with redirect_stdout(io.StringIO()):
                module.main(output)
            self.assertEqual(hashlib.sha256(output.read_bytes()).digest(), before)
        self.assertEqual(hashlib.sha256(SCENE.read_bytes()).digest(), before)


if __name__ == "__main__":
    unittest.main()
