import sys, json, re, collections, struct
from pxr import Usd, UsdGeom, UsdShade, UsdLux, Sdf
x3d_path, usd_z, usd_y, glb, out = sys.argv[1:6]
t = open(x3d_path, encoding="utf-8").read()
cnt = lambda pat: len(re.findall(pat, t))
X = {"Viewpoint": cnt(r"<Viewpoint "), "OrthoViewpoint": cnt(r"<OrthoViewpoint "), "PROTO instances": cnt(r"<ProtoInstance "), "ROUTE": cnt(r"<ROUTE "),
     "TimeSensor": cnt(r"<TimeSensor "), "interpolators": cnt(r"<(?:Position|Orientation|Color|Scalar|Coordinate|Normal)Interpolator "),
     "Script": cnt(r"<Script "), "ComposedShader": cnt(r"<ComposedShader"), "ParticleSystem": cnt(r"<ParticleSystem"), "LOD": cnt(r"<LOD"), "Billboard": cnt(r"<Billboard"),
     "ElevationGrid": cnt(r"<ElevationGrid"), "Switch": cnt(r"<Switch"), "lights": cnt(r"<(?:Directional|Point|Spot)Light"), "Material nodes": cnt(r"<(?:Physical|Unlit)?Material[ >]"),
     "Shape (incl. USE)": cnt(r"<Shape[ >]"), "glyph USE Shapes": cnt(r"<Shape USE='S[RB]\d+_Ink"), "Sensors": cnt(r"<(?:Touch|Proximity|Visibility|TimeS)\w*Sensor"),
     "MetadataString/Set": cnt(r"<Metadata(?:String|Set)"), "meta tags": cnt(r"<meta "), "NavigationInfo": cnt(r"<NavigationInfo")}
# USD
st = Usd.Stage.Open(usd_z); prims = list(st.Traverse())
types = collections.Counter(p.GetTypeName() or "(untyped)" for p in prims)
anim = 0; timecodes = set(); animprims = set()
for p in prims:
    for a in p.GetAttributes():
        if a.GetNumTimeSamples() > 1: anim += 1; animprims.add(str(p.GetPath())); timecodes.update(a.GetTimeSamples())
cams = [p for p in prims if p.IsA(UsdGeom.Camera)]
ortho = [str(c.GetPath()) for c in cams if UsdGeom.Camera(c).GetProjectionAttr().Get() == "orthographic"]
lights = [p for p in prims if p.IsA(UsdLux.BoundableLightBase) or p.IsA(UsdLux.NonboundableLightBase)]
custom = collections.Counter()
for p in prims:
    for k in p.GetCustomData(): custom["customData:" + k] += 1
    for a in p.GetAttributes():
        if a.GetName().startswith("userProperties:"): custom["userProperties"] += 1; break
raw = open(usd_z, "rb").read()
usd = {"prims": len(prims), "types": dict(types.most_common(12)), "meshes": types.get("Mesh", 0), "cameras": len(cams), "ortho_cameras": len(ortho), "lights": len(lights),
       "materials": types.get("Material", 0), "shaders": types.get("Shader", 0), "animated_attributes": anim, "animated_prims": len(animprims),
       "timecode_range": [min(timecodes), max(timecodes)] if timecodes else None, "timeCodesPerSecond": st.GetTimeCodesPerSecond(), "upAxis_z": str(UsdGeom.GetStageUpAxis(st)),
       "upAxis_y": str(UsdGeom.GetStageUpAxis(Usd.Stage.Open(usd_y))), "instanceable_prims": sum(1 for p in prims if p.IsInstanceable()), "prototypes": len(st.GetPrototypes()),
       "metadata_keys": dict(custom), "strings": {s: (s.encode() in raw) for s in ("ecmascript", "Tesseract", "GLSL", "ParticleSystem", "ROUTE", "Thinker", "T_4_01", "Pilgrim")}}
usd["names_kept"] = {n: bool(st.GetPrimAtPath(p)) for n, p in (("T_4_01 (a PROTO instance DEF)", "/T_4_01"),)}
usd["sample_names"] = [str(p.GetPath()) for p in prims[:12]]
usd["has_T_names"] = sum(1 for p in prims if p.GetName().startswith("T_"))
# GLB
b = open(glb, "rb").read(); (ln,) = struct.unpack("<I", b[12:16]); j = json.loads(b[20:20 + ln])
gl = {"nodes": len(j.get("nodes", [])), "meshes": len(j.get("meshes", [])), "materials": len(j.get("materials", [])), "cameras": len(j.get("cameras", [])),
      "ortho_cameras": sum(1 for c in j.get("cameras", []) if c["type"] == "orthographic"), "animations": len(j.get("animations", [])),
      "animation_channels": sum(len(a["channels"]) for a in j.get("animations", [])), "skins": len(j.get("skins", [])), "images": len(j.get("images", [])),
      "extensionsUsed": j.get("extensionsUsed", []), "lights": len(j.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights", [])),
      "nodes_with_extras": sum(1 for n in j.get("nodes", []) if n.get("extras")), "meshes_with_extras": sum(1 for m in j.get("meshes", []) if m.get("extras")),
      "scenes": len(j.get("scenes", [])), "strings": {s: (s in json.dumps(j)) for s in ("ecmascript", "Tesseract", "GLSL", "ParticleSystem", "ROUTE", "Thinker", "T_4_01", "Pilgrim")},
      "node_names_T": sum(1 for n in j.get("nodes", []) if n.get("name", "").startswith("T_")), "points_primitives": sum(1 for m in j.get("meshes", []) for p in m["primitives"] if p.get("mode") == 0),
      "lines_primitives": sum(1 for m in j.get("meshes", []) for p in m["primitives"] if p.get("mode") in (1, 2, 3)), "triangle_primitives": sum(1 for m in j.get("meshes", []) for p in m["primitives"] if p.get("mode", 4) == 4)}
gl["extras_sample"] = next((n["extras"] for n in j.get("nodes", []) if n.get("extras")), None)
json.dump({"x3d": X, "usd": usd, "glb": gl}, open(out, "w"), indent=1); print(json.dumps({"x3d": X, "usd": usd, "glb": gl}, indent=1)[:6000])
