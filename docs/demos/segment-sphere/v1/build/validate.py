"""Validate Demo 78's X3D with the x3d_mcp validator, and round-trip the dataset out of the X3D file.

Usage: python build/validate.py /path/to/x3d_mcp
Writes ../assets/validate-receipt.json.
1. XSD 4.0 + semantic checks (x3d_mcp validation.validate.validate_xml + validation.semantic); 'info' is not a defect.
2. Round trip: read the WorldInfo MetadataSet and the Script's data fields back out of the X3D with lxml and
   compare them, service by service, with data/services.json (the extractor's output from the source page).
"""
import collections, hashlib, json, os, subprocess, sys
from lxml import etree

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "..", "assets")
fork = sys.argv[1]
sys.path.insert(0, os.path.join(fork, "src"))
from validation.validate import validate_xml  # noqa: E402
from validation import semantic  # noqa: E402

commit = subprocess.run(["git", "-C", fork, "log", "-1", "--format=%h"], capture_output=True, text=True).stdout.strip()
name = "segment-sphere.x3d"
raw = open(os.path.join(A, name), "rb").read()
s = raw.decode("utf-8")
x = validate_xml(s)
diags = semantic.semantic_diagnostics(s)
lv = collections.Counter(getattr(d, "level", "?") for d in diags)
checks = collections.Counter(f"{getattr(d, 'level', '?')}:{getattr(d, 'check', '?')}" for d in diags)


def mfs(v):  # MFString attribute -> list (handles \" and \\ escapes)
    out, cur, inq, esc = [], "", False, False
    for ch in v:
        if inq:
            if esc: cur += ch; esc = False
            elif ch == "\\": esc = True
            elif ch == '"': out.append(cur); cur = ""; inq = False
            else: cur += ch
        elif ch == '"': inq = True
    return out


D = json.load(open(os.path.join(HERE, "..", "data", "services.json"), encoding="utf-8"))
root = etree.fromstring(raw)
top = root.find(".//WorldInfo/MetadataSet[@name='aws_segment_wheel']")
got = []
for ci, ms in enumerate(top.findall("MetadataSet")):
    if ms.get("name") == "lifecycle_watch_list":
        continue
    label = mfs(ms.find("MetadataString[@name='label']").get("value"))[0]
    names = mfs(ms.find("MetadataString[@name='services']").get("value"))
    st = mfs(ms.find("MetadataString[@name='status']").get("value"))
    ring = [int(v) for v in ms.find("MetadataInteger[@name='ring']").get("value").split()]
    ang = [float(v) for v in ms.find("MetadataDouble[@name='angle_deg']").get("value").split()]
    for a, b, c, d in zip(names, st, ring, ang):
        got.append((label, a, b, c, round(d, 3)))
want = [(D["categories"][v["cat"]]["name"], v["name"], v["status"], v["ring"], round(v["angle"], 3)) for v in D["services"]]
meta_ok = sorted(got) == sorted(want)
wl = top.find("MetadataSet[@name='lifecycle_watch_list']")
wl_names = mfs(wl.find("MetadataString[@name='service']").get("value"))
wl_ok = sorted(wl_names) == sorted(v["full"] for v in D["services"] if v["status"] != "ga")
scr = root.find(".//Script[@DEF='Morph']")
fld = {f.get("name"): f.get("value") for f in scr.findall("field")}
lon = [round(float(v), 3) for v in fld["svcLon"].split()]
scr_ok = lon == [round(v["angle"], 3) for v in D["services"]] and [int(v) for v in fld["svcRing"].split()] == [v["ring"] for v in D["services"]] \
    and [int(v) for v in fld["svcCat"].split()] == [v["cat"] for v in D["services"]]
rt = {"metadata_services": len(got), "metadata_equal": meta_ok, "watch_list": len(wl_names), "watch_equal": wl_ok, "script_fields_equal": scr_ok,
      "summary": f"MetadataSet round trip {len(got)}/{len(want)} services {'equal' if meta_ok else 'DIFFER'}; watch list {len(wl_names)} {'equal' if wl_ok else 'DIFFER'}; Script data fields {'equal' if scr_ok else 'DIFFER'} (lxml, vs data/services.json)"}
ok = x["valid"] and not lv.get("error") and meta_ok and wl_ok and scr_ok
summ = f"x3d_mcp {commit}: {name} XSD {x.get('schema_version')} {'valid' if x['valid'] else 'INVALID'}, semantic " + \
       (", ".join(f"{n} {l}" for l, n in sorted(lv.items())) or "0 diagnostics")
rec = {"validator": f"x3d_mcp fork {commit} (validation.validate.validate_xml + validation.semantic)", "ok": ok, "summary": summ,
       "files": {name: {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "xsd_valid": x["valid"], "schema": x.get("schema_version"),
                        "xsd_errors": x["errors"][:20], "semantic_by_level": dict(lv), "semantic_by_check": dict(checks)}},
       "roundtrip": rt}
json.dump(rec, open(os.path.join(A, "validate-receipt.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps({"ok": ok, "summary": summ, "roundtrip": rt["summary"]}, indent=1))
sys.exit(0 if ok else 1)
