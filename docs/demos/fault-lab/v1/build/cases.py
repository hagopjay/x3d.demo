#!/usr/bin/env python3
"""Fault Lab, step 1: one clean scene, one clean record, and the planted faults. Each fault is ONE text replacement.

    python3 build/cases.py /path/to/x3d_mcp        writes cases/*.x3d, cases/*.ttl and data/cases.json

The base is the heritage twin that ships with the x3d_mcp fork (examples/semantic_twins): a schematic Giza study whose
every drawn element has a CIDOC-CRM record. This script adds geospatial viewpoints and Metadata nodes to it, then plants
the faults. Nothing here judges anything: run_checks.py does, with the real validators.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
MCP = Path(sys.argv[1])
TWIN = MCP / "examples/semantic_twins"
scene = (TWIN / "scenes/heritage.x3d").read_text()
domain = (TWIN / "data/heritage/domain.ttl").read_text()


def once(text, find, replace):
    assert text.count(find) == 1, f"expected exactly one {find[:60]!r}, found {text.count(find)}"
    return text.replace(find, replace)


# NOTE kept on purpose: the first draft of this file wrote the three host-level Metadata nodes without
# containerField='metadata'. The XSD accepted it; validate_semantic refused it (3 errors, containerfield-unknown) and
# the x3d-core shapes refused it (3 results, field-not-in-domain). The checker corrected the author of its own demo.
# ---- the clean scene: the shipped twin plus geospatial viewpoints and Metadata on three kinds of host ------------------
clean = once(scene, "<component name='Shape' level='2'/>", "<component name='Shape' level='2'/><component name='Geospatial' level='1'/>")
clean = once(clean, "<DirectionalLight direction='-0.4 -1 -0.5' intensity='0.8'/>",
             "<DirectionalLight direction='-0.4 -1 -0.5' intensity='0.8'/>"
             "<WorldInfo DEF='Info' title='Osiris Shaft study'><MetadataString containerField='metadata' name='survey' value='\"Hawass 2007, ASAE 36\"'/></WorldInfo>"
             "<GeoViewpoint DEF='GV_Giza' description='Giza plateau, from 300 m' position='29.9792 31.1342 300'/>"
             "<GeoViewpoint DEF='GV_Angkor' description='Angkor Wat, the comparison site' position='13.4125 103.867 300'/>")
clean = once(clean, "<Transform DEF='OsirisShaftA' translation='0 -4.81 0'>",
             "<Transform DEF='OsirisShaftA' translation='0 -4.81 0'>"
             "<MetadataSet DEF='M_ShaftA' containerField='metadata' name='CidocCrm' reference='http://www.cidoc-crm.org/cidoc-crm/E25_Human-Made_Feature'>"
             "<MetadataString name='label' value='\"Osiris Shaft, Shaft A\"'/><MetadataDouble name='depth_m' value='9.62'/>"
             "<MetadataString name='tier' value='\"documented\"'/></MetadataSet>")
clean = once(clean, "<Transform DEF='OsirisChamberA' translation='0 -8.27 2.6'><Shape DEF='OsirisChamberA_Shape'><Appearance>"
             "<PhysicalMaterial baseColor='0.24 0.9 0.82' emissiveColor='0.108 0.405 0.369' roughness='0.8' metallic='0' transparency='0.55'/>",
             "<Transform DEF='OsirisChamberA' translation='0 -8.27 2.6'><Shape DEF='OsirisChamberA_Shape'><Appearance>"
             "<PhysicalMaterial DEF='Mat_ChamberA' baseColor='0.24 0.9 0.82' emissiveColor='0.108 0.405 0.369' roughness='0.8' metallic='0' transparency='0.55'>"
             "<MetadataString containerField='metadata' name='colour_key' value='\"teal = documented\"'/></PhysicalMaterial>")

CHAMBER_B_MAT = "<PhysicalMaterial baseColor='0.24 0.9 0.82' emissiveColor='0.108 0.405 0.369' roughness='0.8' metallic='0' transparency='0.55'/></Appearance><Box size='6.8 2.6 3.65'/>"
FAULTS = [
    # id, family, finding, file, find, replace, title, story (what a person did), harm (what happens if nobody notices)
    ("two-materials", "structure", "F1", "scene", CHAMBER_B_MAT,
     CHAMBER_B_MAT.replace("</Appearance>", "<PhysicalMaterial baseColor='0.9 0.1 0.1' roughness='0.4' metallic='0'/></Appearance>"),
     "Two materials on one surface", "A second PhysicalMaterial was pasted into the same Appearance.",
     "A browser keeps one material and silently drops the other. Which one depends on the browser."),
    ("two-geometries", "structure", "F1", "scene", "<Box size='5 2.7 4'/>", "<Box size='5 2.7 4'/><Sphere radius='3'/>",
     "Two geometries in one Shape", "A Sphere was added beside the Box inside one Shape.",
     "Shape.geometry holds one node. One of the two is never drawn."),
    ("angkor-swapped", "geo", "F23", "scene", "position='13.4125 103.867 300'", "position='103.867 13.4125 300'",
     "Longitude written first (Angkor)", "The comparison viewpoint was typed longitude, latitude.",
     "Latitude 103.867 does not exist. A viewer puts the camera somewhere undefined."),
    ("giza-swapped", "geo", "F23", "scene", "position='29.9792 31.1342 300'", "position='31.1342 29.9792 300'",
     "Longitude written first (Giza)", "The same slip, at a site where both numbers are under 90.",
     "The camera lands about 230 km away, in the Sinai. No range test can see this one."),
    ("scaled-shaft", "record", "F2", "scene", "<Transform DEF='OsirisShaftA' translation='0 -4.81 0'>", "<Transform DEF='OsirisShaftA' scale='1 1.3 1' translation='0 -4.81 0'>",
     "Shaft stretched by a scale", "Someone scaled Shaft A to 'look right'. The Box still says 9.62 m.",
     "The drawing shows 12.5 m; the excavation report says 9.62 m."),
    ("cylinder-shaft", "record", "F2", "scene", "<Box size='1.2 9.62 1.2'/>", "<Cylinder height='12' radius='0.6'/>",
     "Shaft redrawn as a Cylinder", "The Box was swapped for a Cylinder 12 m tall.",
     "The record's measurement no longer has anything it can be compared with."),
    ("secret-tunnel", "record", "F2", "scene", "<Transform DEF='OsirisShaftB' ", "<Transform DEF='SecretTunnel' translation='0 -50 0'><Shape><Appearance><PhysicalMaterial baseColor='0.9 0.3 0.9'/></Appearance><Box size='90 3 3'/></Shape></Transform><Transform DEF='OsirisShaftB' ",
     "A tunnel nobody recorded", "A 90 m tunnel was drawn under the plateau with no record behind it.",
     "A reader takes a drawn object for a documented one."),
    ("feet-not-metres", "record", "F2", "domain", "crm:P90_has_value 9.62 ; crm:P91_has_unit unit:M", "crm:P90_has_value 9.62 ; crm:P91_has_unit unit:FT",
     "Depth recorded in feet", "The record's unit for Shaft A was changed to feet; the number stayed 9.62.",
     "9.62 ft is 2.93 m. The scene and the record now disagree by a factor of 3.28 and both look fine alone."),
    ("no-tier", "record", "F2", "domain", "crm:P140_assigned_attribute_to h:HallOfRecords ; crm:P141_assigned h:tierSpeculative", "crm:P140_assigned_attribute_to h:HallOfRecords ; crm:P141_assigned unit:M",
     "A speculative claim loses its label", "The Hall of Records attribution no longer assigns a tier.",
     "The one speculative element in the scene is drawn like the documented ones."),
    ("ghost-def", "record", "F2", "domain", "sc:OsirisShaftA", "sc:NoSuchDEF",
     "The record points at nothing", "The record names a scene node that does not exist.",
     "A measurement exists on paper and can never be checked against the drawing."),
]

out = {"base": {"scene": "examples/semantic_twins/scenes/heritage.x3d", "domain": "examples/semantic_twins/data/heritage/domain.ttl"}, "cases": []}
(HERE / "cases/clean.x3d").write_text(clean)
(HERE / "cases/clean.domain.ttl").write_text(domain)
out["cases"].append({"id": "clean", "family": "clean", "finding": None, "title": "The clean twin", "story": "Nothing planted.", "harm": "", "scene": "cases/clean.x3d", "domain": "cases/clean.domain.ttl", "changed": None})
for cid, fam, finding, which, find, repl, title, story, harm in FAULTS:
    s, d = clean, domain
    if which == "scene":
        s = once(clean, find, repl)
        (HERE / f"cases/{cid}.x3d").write_text(s)
    else:
        assert find in domain
        d = domain.replace(find, repl) if cid == "ghost-def" else once(domain, find, repl)
        (HERE / f"cases/{cid}.domain.ttl").write_text(d)
    out["cases"].append({"id": cid, "family": fam, "finding": finding, "title": title, "story": story, "harm": harm,
                         "scene": f"cases/{cid}.x3d" if which == "scene" else "cases/clean.x3d",
                         "domain": f"cases/{cid}.domain.ttl" if which == "domain" else "cases/clean.domain.ttl",
                         "changed": {"file": which, "was": find, "now": repl}})
(HERE / "data/cases.json").write_text(json.dumps(out, indent=1) + "\n")
print(len(out["cases"]) - 1, "faults written")
