#!/usr/bin/env python3
"""Offline check: recompute per-shape digests and the root from claims.json and compare with the scenes (stdlib).
python3 -I verify.py"""
import json, gzip, hashlib, re, pathlib, collections, sys
H = pathlib.Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
canon = lambda o: json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
C = json.loads((H / "claims.json").read_text(encoding="utf8"))
by = collections.defaultdict(list)
for c in C: by[c["struct"]].append(c)
dig = {u: sha(canon(v).encode("utf8")) for u, v in by.items()}
root = sha("".join(f"{u} {dig[u]}\n" for u in sorted(dig)).encode("utf8"))
S = json.loads((H / "structures.json").read_text(encoding="utf8"))
bad = 0
for name in ("torso-fma.x3dz", "brain-fma.x3dz"):
    t = gzip.open(H / "scene" / name).read().decode("utf8")
    r = re.search(r"name='claims-root-sha256' content='([0-9a-f]{64})'", t).group(1)
    scene = "torso" if name.startswith("torso") else "brain"
    n = ok = 0
    for s in S:
        if s["scene"] != scene: continue
        n += 1
        m = re.search(r"DEF='" + re.escape(s["id"]) + r"'><MetadataSet.*?name=\"claims_digest\" value='\"([0-9a-f]{64})\"'", t)
        ok += bool(m and m.group(1) == dig[s["uid"]])
    print(name, "root", "OK" if r == root else "MISMATCH", f"{ok}/{n} shape digests")
    bad += (r != root) + (n - ok)
print("root", root); sys.exit(1 if bad else 0)
