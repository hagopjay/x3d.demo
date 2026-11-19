#!/usr/bin/env python3
"""Dependency-free structural checks; these do not claim X3D schema validation.

Checks the static app's file references and SAI name contract. Regenerates the
procedural scene and textures and requires byte-for-byte reproducibility.
Run from any directory: python3 tests/check_integrity.py
"""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import re
import shlex
import subprocess
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
REPO_DOCS = ROOT.parents[2]
failures: list[str] = []
checked: set[tuple[str, str]] = set()


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def local_reference(source: Path, reference: str) -> None:
    reference = reference.strip()
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return
    # Directory navigation links are outside the artifact's file contract.
    if parsed.path.endswith("/"):
        return
    target = REPO_DOCS / unquote(parsed.path).lstrip("/") if parsed.path.startswith("/") else source.parent / unquote(parsed.path)
    key = (str(source.relative_to(ROOT)), reference)
    if key in checked:
        return
    checked.add(key)
    check(target.is_file(), f"Missing local reference in {source.relative_to(ROOT)}: {reference}")


class References(HTMLParser):
    def __init__(self, source: Path):
        super().__init__()
        self.source = source
        self.ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            check(values["id"] not in self.ids, f"Duplicate HTML id: {values['id']}")
            self.ids.add(values["id"])
        for name in ("src", "href", "poster"):
            if values.get(name):
                local_reference(self.source, values[name])


def main() -> int:
    scene_path = ROOT / "assets" / "observatory.x3d"
    scene = ET.parse(scene_path).getroot()
    defs = [element.attrib["DEF"] for element in scene.iter() if "DEF" in element.attrib]
    names = set(defs)
    check(len(defs) == len(names), "Duplicate X3D DEF names")
    check(scene.tag == "X3D" and scene.get("version") == "4.0", "Expected an X3D 4.0 document")
    required = {
        "Sky", "Sun", "Monument", "Pyramid", "Casing", "PiCircle", "PiSquare",
        "PhiSection", "SurveyMeasures", "InteriorModel", "SunMarker", "ShadowCoordinate",
        "OverlayCourses", "OverlayShadow", "OverlayPi", "OverlayPhi", "OverlaySurvey",
        "OverlayLatitude", "OverlayInterior", "OverlaySolar",
        "CA_Overview", "CA_Pi", "CA_Phi", "CA_Latitude", "CA_Plan", "CA_Interior", "CA_Ground", "CA_Survey",
    }
    for script in ROOT.glob("*.mjs"):
        text = script.read_text()
        required.update(re.findall(r"getNamedNode\(\s*['\"]([^'\"]+)['\"]\s*\)", text))
        for reference in re.findall(r"(?:\bfrom\s*|\bimport\s*)['\"]([^'\"]+)['\"]", text):
            if reference.startswith((".", "/")):
                local_reference(script, reference)
        # Static fetch targets only; computed exports do not identify files.
        for reference in re.findall(r"\bfetch\(\s*['\"]([^'\"]+)['\"]", text):
            local_reference(script, reference)
    for name in sorted(required):
        check(name in names, f"Missing required SAI DEF: {name}")
    for element in scene.iter():
        if "USE" in element.attrib:
            check(element.attrib["USE"] in names, f"Unresolved X3D USE: {element.attrib['USE']}")
        if "url" in element.attrib:
            for reference in shlex.split(element.attrib["url"]):
                local_reference(scene_path, reference)
    html_path = ROOT / "index.html"
    parser = References(html_path)
    parser.feed(html_path.read_text())
    for css in ROOT.glob("*.css"):
        for reference in re.findall(r"url\(\s*['\"]?([^)'\"]+)['\"]?\s*\)", css.read_text()):
            local_reference(css, reference)
    outputs = [scene_path, ROOT / "assets" / "limestone-base.png", ROOT / "assets" / "limestone-normal.png"]
    before = {path: path.read_bytes() for path in outputs}
    rebuild = subprocess.run([sys.executable, str(ROOT / "build" / "build_observatory.py")], capture_output=True, text=True)
    check(rebuild.returncode == 0, f"Scene rebuild failed: {rebuild.stderr}")
    if rebuild.returncode == 0:
        for path, expected in before.items():
            check(path.read_bytes() == expected, f"Nondeterministic or stale generated asset: {path.name}")
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    print(f"PASS: {len(names)} unique X3D DEFs; {len(required)} required SAI nodes; {len(checked)} local file references; 3 deterministic assets")
    print("Scope: structural integrity only; no schema, GPU or browser validation implied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
