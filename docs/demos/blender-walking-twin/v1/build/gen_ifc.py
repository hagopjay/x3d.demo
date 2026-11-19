# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 61, step 1: author a small IFC4 building (a field station) with ifcopenshell.

Every element is an extruded rectangle with its own GlobalId, a material and a storey. Plan 12 m x 8 m, walls 3.2 m.
Usage: python gen_ifc.py OUT.ifc
"""
import sys
import numpy as np
import ifcopenshell
import ifcopenshell.api
import ifcopenshell.guid

out = sys.argv[1]
f = ifcopenshell.file(schema="IFC4")
api = lambda usecase, **kw: ifcopenshell.api.run(usecase, f, **kw)
project = api("root.create_entity", ifc_class="IfcProject", name="Walking Twin field station")
api("unit.assign_unit", units=[api("unit.add_si_unit", unit_type=t) for t in ("LENGTHUNIT", "AREAUNIT", "VOLUMEUNIT")])  # metres (the default is millimetres)
ctx = api("context.add_context", context_type="Model")
body = api("context.add_context", context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)
site = api("root.create_entity", ifc_class="IfcSite", name="Site")
building = api("root.create_entity", ifc_class="IfcBuilding", name="Field station")
storey = api("root.create_entity", ifc_class="IfcBuildingStorey", name="Ground floor")
api("aggregate.assign_object", relating_object=project, products=[site])
api("aggregate.assign_object", relating_object=site, products=[building])
api("aggregate.assign_object", relating_object=building, products=[storey])

MATERIALS = {}
def material(name, category):
    if name not in MATERIALS:
        MATERIALS[name] = api("material.add_material", name=name, category=category)
    return MATERIALS[name]

ELEMENTS = []
def box(ifc_class, name, x0, y0, z0, x1, y1, z1, mat, cat, predefined=None):
    """An axis-aligned box element from (x0,y0,z0) to (x1,y1,z1) in metres."""
    kw = {"ifc_class": ifc_class, "name": name}
    if predefined:
        kw["predefined_type"] = predefined
    el = api("root.create_entity", **kw)
    m = np.eye(4); m[:3, 3] = (x0, y0, z0)
    api("geometry.edit_object_placement", product=el, matrix=m, is_si=True)
    profile = f.createIfcRectangleProfileDef("AREA", None, f.createIfcAxis2Placement2D(
        f.createIfcCartesianPoint(((x1 - x0) / 2, (y1 - y0) / 2)), None), x1 - x0, y1 - y0)
    solid = f.createIfcExtrudedAreaSolid(profile, f.createIfcAxis2Placement3D(f.createIfcCartesianPoint((0., 0., 0.)), None, None),
                                         f.createIfcDirection((0., 0., 1.)), z1 - z0)
    rep = f.createIfcShapeRepresentation(body, "Body", "SweptSolid", [solid])
    api("geometry.assign_representation", product=el, representation=rep)
    api("spatial.assign_container", relating_structure=storey, products=[el])
    api("material.assign_material", products=[el], type="IfcMaterial", material=material(mat, cat))
    ELEMENTS.append(el)
    return el

H, T = 3.2, 0.2
CLT, CON, BRK, STL, GLS = ("Cross-laminated timber", "wood"), ("Concrete C30/37", "concrete"), ("Clay brick", "brick"), ("Steel S355", "steel"), ("Float glass", "glass")
box("IfcSlab", "Ground slab", -0.2, -0.2, -0.25, 12.2, 8.2, 0.0, *CON, predefined="FLOOR")
box("IfcSlab", "Roof", -0.3, -0.3, H, 12.3, 8.3, H + 0.2, *CLT, predefined="ROOF")
box("IfcWall", "North wall", 0.0, 7.8, 0.0, 12.0, 8.0, H, *CON)
box("IfcWall", "West wall", 0.0, 0.2, 0.0, 0.2, 7.8, H, *BRK)
box("IfcWall", "East wall", 11.8, 0.2, 0.0, 12.0, 7.8, H, *BRK)
# south facade: piers, a door opening at x 2.0-3.2, two windows at x 5-7 and 9-11 with sill and head panels
for name, a, b in (("South pier 1", 0.0, 2.0), ("South pier 2", 3.2, 5.0), ("South pier 3", 7.0, 9.0), ("South pier 4", 11.0, 12.0)):
    box("IfcWall", name, a, 0.0, 0.0, b, T, H, *CLT)
box("IfcWall", "Door head", 2.0, 0.0, 2.2, 3.2, T, H, *CLT)
for i, (a, b) in enumerate(((5.0, 7.0), (9.0, 11.0)), 1):
    box("IfcWall", "Window %d sill" % i, a, 0.0, 0.0, b, T, 0.9, *CLT)
    box("IfcWall", "Window %d head" % i, a, 0.0, 2.4, b, T, H, *CLT)
    box("IfcWindow", "Window %d glazing" % i, a, 0.09, 0.9, b, 0.11, 2.4, *GLS)
box("IfcDoor", "Entrance door", 2.0, T, 0.0, 2.05, T + 0.9, 2.1, *CLT)        # leaf standing open, inward
# internal wall between the two rooms, doorway at y 4.8-5.8
box("IfcWall", "Partition south", 5.9, T, 0.0, 6.1, 4.8, H, *CLT)
box("IfcWall", "Partition north", 5.9, 5.8, 0.0, 6.1, 7.8, H, *CLT)
box("IfcWall", "Partition head", 5.9, 4.8, 2.2, 6.1, 5.8, H, *CLT)


def steel(ifc_class, name, origin, axis, ref, length, depth, width, web, flange):
    """An I-section member: IfcIShapeProfileDef extruded along the placement's Z axis (axis), profile X along ref."""
    el = api("root.create_entity", ifc_class=ifc_class, name=name)
    z, x = np.array(axis, float), np.array(ref, float)
    m = np.eye(4); m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, np.cross(z, x), z, origin
    api("geometry.edit_object_placement", product=el, matrix=m, is_si=True)
    profile = f.createIfcIShapeProfileDef("AREA", name + " profile", None, width, depth, web, flange, None)
    solid = f.createIfcExtrudedAreaSolid(profile, f.createIfcAxis2Placement3D(f.createIfcCartesianPoint((0., 0., 0.)), None, None),
                                         f.createIfcDirection((0., 0., 1.)), length)
    api("geometry.assign_representation", product=el, representation=f.createIfcShapeRepresentation(body, "Body", "SweptSolid", [solid]))
    api("spatial.assign_container", relating_structure=storey, products=[el])
    api("material.assign_material", products=[el], type="IfcMaterial", material=material(*STL))
    ELEMENTS.append(el)


for i, (x, y) in enumerate(((3.0, 6.6), (9.0, 2.4), (9.0, 6.6)), 1):     # about HEB 200
    steel("IfcColumn", "Column C%d" % i, (x, y, 0.0), (0, 0, 1), (1, 0, 0), H - 0.3, 0.2, 0.2, 0.009, 0.015)
steel("IfcBeam", "Ridge beam", (0.2, 4.0, H - 0.15), (1, 0, 0), (0, 1, 0), 11.6, 0.3, 0.15, 0.0071, 0.0107)   # about IPE 300
f.write(out)
print({"elements": len(ELEMENTS), "materials": list(MATERIALS), "schema": f.schema, "ifcopenshell": ifcopenshell.version})
