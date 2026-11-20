#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Static v5 integrity and deterministic builds, not browser/schema verification.

Checks every X3D's DEF/USE identity, file references, additive SAI contract,
frozen v4 source assets, and standard-library derivative generators.
"""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
import shlex
import subprocess
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT.parents[2]
failures = []
references = set()


def check(condition, message):
    if not condition:
        failures.append(message)


def local_reference(source, reference):
    value = reference.strip()
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return
    if parsed.path.endswith("/"):
        target = (DOCS / unquote(parsed.path).lstrip("/")) if parsed.path.startswith("/") else source.parent / unquote(parsed.path)
        check(target.is_dir(), f"Missing local directory from {source.name}: {value}")
        return
    target = (DOCS / unquote(parsed.path).lstrip("/")) if parsed.path.startswith("/") else source.parent / unquote(parsed.path)
    references.add((str(source.relative_to(ROOT)), value))
    check(target.is_file(), f"Missing local file from {source.name}: {value}")


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.source = source
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            check(attrs["id"] not in self.ids, f"Duplicate HTML ID: {attrs['id']}")
            self.ids.add(attrs["id"])
        for key in ("src", "href", "poster"):
            if attrs.get(key):
                local_reference(self.source, attrs[key])


def main():
    names = {}
    for path in sorted((ROOT / "assets").glob("*.x3d")):
        try:
            scene = ET.parse(path).getroot()
        except ET.ParseError as error:
            failures.append(f"Malformed XML {path.name}: {error}")
            continue
        defs = [node.attrib["DEF"] for node in scene.iter() if "DEF" in node.attrib]
        names[path.name] = set(defs)
        check(len(defs) == len(set(defs)), f"Duplicate DEF in {path.name}")
        for node in scene.iter():
            if "USE" in node.attrib:
                check(node.attrib["USE"] in names[path.name], f"Unresolved USE in {path.name}: {node.attrib['USE']}")
            for reference in shlex.split(node.get("url", "")):
                local_reference(path, reference)
    check(set(names) == {"giza.x3d", "sky.x3d", "instruments.x3d"}, "Expected exactly three X3D scene files")
    required = {"LensRoot", "SliceTransform", "SliceFillMaterial", "SliceLabelTransform", "SliceText", "ExperimentEnvelope", "InstrumentSection", "InstrumentGeometry", "InstrumentSurvey", "InstrumentHarmonics"}
    for name in sorted(required):
        check(name in names.get("instruments.x3d", set()), f"Missing instrument SAI node {name}")
    for script in ROOT.glob("*.mjs"):
        content = script.read_text()
        for reference in re.findall(r"(?:\bfrom\s*|\bimport\s*\(?\s*)['\"]([^'\"]+)['\"]", content):
            if reference.startswith((".", "/")):
                local_reference(script, reference)
        for reference in re.findall(r"\b(?:fetch|readJSON)\(\s*['\"]([^'\"]+)['\"]", content):
            local_reference(script, reference)
    for css in ROOT.glob("*.css"):
        for reference in re.findall(r"url\(\s*['\"]?([^)'\"]+)['\"]?\s*\)", css.read_text()):
            local_reference(css, reference)
    page_path = ROOT / "index.html"
    page = Page(page_path)
    page.feed(page_path.read_text())
    # The expensive Blender bakes and stellar catalogue are retained witnesses.
    frozen = ["giza.x3d", "sky.x3d", "ground-day.jpg", "ground-night.jpg", "sky-data.json", "stage-data.json"]
    for name in frozen:
        a, b = ROOT / "assets" / name, ROOT.parent / "v4" / "assets" / name
        check(a.is_file() and b.is_file() and a.read_bytes() == b.read_bytes(), f"Frozen v4 source asset changed: {name}")
    builds = [
        ("build_instruments.py", ["assets/instruments.x3d"]),
        ("build_instrument_data.py", ["assets/belt-instrument.json"]),
    ]
    if (ROOT / "build" / "apply_review.py").is_file():
        builds.append(("apply_review.py", ["receipts/atlas.json"]))
    generated = 0
    for name, outputs in builds:
        paths = [ROOT / output for output in outputs]
        before = {path: path.read_bytes() for path in paths}
        run = subprocess.run([sys.executable, str(ROOT / "build" / name)], capture_output=True, text=True)
        check(run.returncode == 0, f"Generator {name} failed: {run.stderr}")
        if run.returncode == 0:
            for path, old in before.items():
                check(path.read_bytes() == old, f"Generated asset stale or nondeterministic: {path.relative_to(ROOT)}")
                generated += 1
    derived = json.loads((ROOT / "assets" / "belt-instrument.json").read_text())
    check(derived["sky_sha256"] == hashlib.sha256((ROOT / "assets" / "sky.x3d").read_bytes()).hexdigest(), "Orion derivative references a different sky source")
    if failures:
        for failure in failures:
            print("FAIL:", failure, file=sys.stderr)
        return 1
    print(f"PASS: {len(names)} parsed X3D scenes; {sum(map(len, names.values()))} unique per-scene DEFs; {len(required)} instrument SAI nodes")
    print(f"PASS: {len(page.ids)} HTML IDs; {len(references)} local file references; {len(frozen)} byte-identical v4 assets; {generated} deterministic generated files")
    print("Scope: source/structural integrity only; no WebGL pixels, browser layout or XSD result implied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
