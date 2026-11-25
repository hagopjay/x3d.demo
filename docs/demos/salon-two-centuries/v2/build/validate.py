"""Validate Demo 79's X3D with the x3d_mcp validator, and round-trip the hang out of the X3D file.

Usage: python build/validate.py /path/to/x3d_mcp
Writes ../assets/validate-receipt.json.
1. XSD 4.0 + semantic checks (x3d_mcp validation.validate.validate_xml + validation.semantic); 'info' is not a defect.
2. Round trip: every wall painting's MetadataSet (Wikidata id + year) read back with lxml equals data/paintings.json,
   every walk-in has its room, and every ImageTexture url resolves to a file in paintings/.
"""
import collections, hashlib, json, os, subprocess, sys
from lxml import etree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
A = os.path.join(ROOT, "assets")
fork = sys.argv[1]
sys.path.insert(0, os.path.join(fork, "src"))
from validation.validate import validate_xml  # noqa: E402
from validation import semantic  # noqa: E402

commit = subprocess.run(["git", "-C", fork, "log", "-1", "--format=%h"], capture_output=True, text=True).stdout.strip()
name = "salon.x3d"
raw = open(os.path.join(A, name), "rb").read()
s = raw.decode("utf-8")
x = validate_xml(s)
diags = semantic.semantic_diagnostics(s)
lv = collections.Counter(getattr(d, "level", "?") for d in diags)
checks = collections.Counter(f"{getattr(d, 'level', '?')}:{getattr(d, 'check', '?')}" for d in diags)

P = json.load(open(os.path.join(ROOT, "data", "paintings.json"), encoding="utf-8"))["paintings"]
WALK = {"Q212616", "Q45585", "Q1044742"}
root = etree.fromstring(raw)
got = {}
for t in root.iter("Transform"):
    d = t.get("DEF") or ""
    if d.startswith("P_"):
        ms = t.find("MetadataSet[@name='painting']")
        qid = ms.find("MetadataString[@name='wikidata']").get("value").strip('"')
        got[qid] = int(ms.find("MetadataInteger[@name='year']").get("value"))
want = {p["id"]: p["year"] for p in P if p["id"] not in WALK}
walk_rooms = sorted(t.get("DEF")[7:] for t in root.iter("Transform") if (t.get("DEF") or "").startswith("WALKIN_"))
urls = [u.get("url").strip("'\"") for u in root.iter("ImageTexture")]
missing = [u for u in urls if not os.path.exists(os.path.normpath(os.path.join(A, u)))]
hang_ok = got == want
walk_ok = walk_rooms == sorted(WALK)
rt = {"wall_paintings": len(got), "wall_equal": hang_ok, "walk_in_rooms": walk_rooms, "walk_ok": walk_ok,
      "image_textures": len(urls), "missing_textures": missing,
      "summary": f"wall paintings {len(got)}/{len(want)} {'equal' if hang_ok else 'DIFFER'} (id + year); walk-in rooms {len(walk_rooms)}/3; "
                 f"ImageTexture urls {len(urls)}, missing {len(missing)} (lxml, vs data/paintings.json)"}
ok = x["valid"] and not lv.get("error") and hang_ok and walk_ok and not missing
summ = f"x3d_mcp {commit}: {name} XSD {x.get('schema_version')} {'valid' if x['valid'] else 'INVALID'}, semantic " + \
       (", ".join(f"{n} {l}" for l, n in sorted(lv.items())) or "0 diagnostics")
rec = {"validator": f"x3d_mcp fork {commit} (validation.validate + validation.semantic)", "ok": ok, "summary": summ,
       "xsd": {k: x.get(k) for k in ("valid", "schema_version", "errors")}, "semantic_levels": dict(lv), "semantic_checks": dict(checks),
       "semantic_first": [str(d) for d in diags if getattr(d, "level", "") in ("error", "warning")][:20],
       "files": {name: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}}, "roundtrip": rt}
json.dump(rec, open(os.path.join(A, "validate-receipt.json"), "w"), indent=1, default=str)
print(summ); print(rt["summary"]); print("OK" if ok else "NOT OK")
for d in rec["semantic_first"]:
    print(" ", d)
