import sys, json, collections, hashlib
root, world, out = sys.argv[1:4]
sys.path.insert(0, root + "/src")
from validation.validate import validate_xml
from validation import semantic
s = open(world, encoding="utf-8").read()
x = validate_xml(s)
d = semantic.semantic_diagnostics(s)
c = collections.Counter(f"{getattr(g,'level','?')}:{getattr(g,'check','?')}" for g in d)
res = {"root": root, "xsd": x.get("schema_version"), "xsd_valid": x["valid"], "xsd_errors": x["errors"][:5], "semantic_total": len(d), "by_check": dict(c),
       "non_info": [f"{getattr(g,'level','')}:{getattr(g,'check','')}: {str(getattr(g,'message',g))[:160]}" for g in d if getattr(g, 'level', '') != 'info'][:40]}
if hasattr(semantic, "semantic_diagnostics_with_files"):
    import os
    d2 = semantic.semantic_diagnostics_with_files(s, os.path.dirname(world))
    res["with_files_total"] = len(d2); res["with_files_by_check"] = dict(collections.Counter(f"{getattr(g,'level','?')}:{getattr(g,'check','?')}" for g in d2))
json.dump(res, open(out, "w"), indent=1); print(json.dumps({k: res[k] for k in res if k not in ("non_info",)}, indent=1)[:2500])
