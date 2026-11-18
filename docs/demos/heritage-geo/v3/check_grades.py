#!/usr/bin/env python3
"""heritage-geo v3 grade consistency check (stdlib). Exit 0 = consistent, 1 = drift found, 2 = a file is missing.

1. index.html scripts type no grade literal ('C', 'L', 'S' as a quoted value): grades come from data only.
2. Every finding's grade equals the weakest of its atomic parts (C > L > S).
3. claims.jsonld carries the same grade as claims.json / data/findings.json for every id.
4. The README's generated table matches data/findings.json.
"""
import json, re, sys, pathlib
H = pathlib.Path(__file__).resolve().parent
ORDER = {"C": 0, "L": 1, "S": 2}
bad = []
try:
    page = (H / "index.html").read_text(encoding="utf8")
    claims = json.loads((H / "claims.json").read_text()); F = json.loads((H / "data/findings.json").read_text())
    ld = json.loads((H / "claims.jsonld").read_text()); rd = (H / "README.md").read_text(encoding="utf8")
except (OSError, ValueError) as e:
    print(json.dumps({"error": type(e).__name__, "detail": str(e)})); sys.exit(2)
for s in re.findall(r"<script[^>]*>(.*?)</script>", page, re.S):
    for m in re.finditer(r"""['"]([CLS])['"]\s*[,\]]""", s):
        bad.append(f"index.html types a grade literal {m.group(0)!r}")
for f in F:
    w = max((p["grade"] for p in f["parts"]), key=ORDER.__getitem__)
    if f["grade"] != w:
        bad.append(f"finding {f['id']}: grade {f['grade']} but weakest part is {w}")
want = {f"urn:x3d:heritage-geo:{c['id']}": c["grade"] for c in claims}
want |= {f"urn:x3d:heritage-geo:finding:{f['id']}": f["grade"] for f in F}
want |= {f"urn:x3d:heritage-geo:finding:{f['id']}:{p['id']}": p["grade"] for f in F for p in f["parts"]}
got = {g["@id"]: g["crm:P2_has_type"]["@id"].rsplit(":", 1)[1] for g in ld["@graph"]}
for k in sorted(set(want) | set(got)):
    if want.get(k) != got.get(k):
        bad.append(f"jsonld {k}: {got.get(k)} vs data {want.get(k)}")
for f in F:
    if f"| **{f['id']}** | {f['headline']} | **{f['grade']}** (weakest part) |" not in rd:
        bad.append(f"README table out of date for {f['id']} (re-run build.py)")
print(json.dumps({"status": "fail" if bad else "pass", "claims": len(claims), "findings": len(F),
                  "atomic_parts": sum(len(f["parts"]) for f in F), "jsonld_nodes": len(got), "problems": bad}, indent=1))
sys.exit(1 if bad else 0)
