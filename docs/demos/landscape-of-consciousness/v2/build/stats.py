"""Counts for the page's stat tiles, read from the shipped files (no typed numbers). Usage: python3 stats.py <v1 folder> <evidence.json> """
import json, os, re, sys
v1, evp = sys.argv[1], sys.argv[2]
t = open(f"{v1}/assets/landscape.x3d", encoding="utf-8").read()
d = json.load(open(f"{v1}/assets/landscape.json"))
fams = d["families"]
branches = sum(len(f.get("branches", [])) for f in fams)
entries = sum(len(b["items"]) for f in fams for b in f.get("branches", [])) + sum(len(f.get("items", [])) for f in fams)
count = lambda pat: len(re.findall(pat, t))
clocks = sorted(set(re.findall(r"<TimeSensor DEF='([^']+)'[^>]*loop='true'", t)))
ev = json.load(open(evp))["evidence"]; fm = json.load(open(evp))["formats"]
inv = [["PROTO declarations", count(r"<ProtoDeclare ")], ["PROTO instances", count(r"<ProtoInstance ")], ["ROUTEs", count(r"<ROUTE ")],
       ["Viewpoints (perspective)", count(r"<Viewpoint ")], ["OrthoViewpoints", count(r"<OrthoViewpoint ")], ["looping TimeSensors", len(clocks)],
       ["Script nodes (ECMAScript)", count(r"<Script ")], ["ComposedShader nodes (GLSL)", count(r"<ComposedShader")],
       ["ParticleSystem nodes", count(r"<ParticleSystem")], ["glyph Shapes in the library", count(r"<Shape DEF='S[RB]\d+_Ink")],
       ["glyph USEs (label letters)", count(r"<Shape USE='S[RB]\d+_Ink")], ["Text nodes", count(r"<Text[ >]")]]
out = dict(entries=entries, families=len(fams), branches=branches, routes=count(r"<ROUTE "), viewpoints=count(r"<Viewpoint ") + count(r"<OrthoViewpoint "),
           protoInstances=count(r"<ProtoInstance "), mb=round(os.path.getsize(f"{v1}/assets/landscape.x3d") / 1e6, 2), clocks=clocks,
           inventory=[[k, f"{v:,}"] for k, v in inv], evidence=ev, formats=fm)
json.dump(out, open(f"{v1}/assets/stats.json", "w"), indent=1)
print({k: v for k, v in out.items() if k not in ("evidence", "inventory", "clocks")}, len(clocks), inv)
