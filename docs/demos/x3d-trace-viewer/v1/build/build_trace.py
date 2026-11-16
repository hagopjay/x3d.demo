"""Build data/report-<set>.json: run x3dtrace (plain code, no model) over every claim in claims.json.

    python3 -I build_trace.py <demo dir> <x3dtrace.py> <receipt.py>

Writes nothing but the reports and a copy of claims.json under <demo dir>/data/. Deterministic: same inputs, same bytes.
"""
import hashlib, importlib.util, json, sys
from pathlib import Path

demo, engine_py, receipt_py = (Path(a) for a in sys.argv[1:4])
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m; spec.loader.exec_module(m); return m
T = load("x3dtrace", engine_py)
R = load("receipt", receipt_py)            # only version_in_quote is used
data = demo / "data"
cj = json.loads((demo / "build" / "claims.json").read_text(encoding="utf-8"))
(data / "claims.json").write_text(json.dumps(cj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
for s in cj["sets"]:
    sources = [T.Source(src["id"], (data / src["file"]).read_text(encoding="utf-8"), src["kind"]) for src in s["sources"]]
    claims = [{k: v for k, v in c.items() if k in ("field", "value", "quote", "source", "ftype", "path", "prefix", "suffix", "line")} for c in s["claims"]]
    for pname, pol in (("default", T.TracePolicy()), ("strict", T.TracePolicy.strict())):
        rep = T.check_claims(claims, sources, pol, expected_fields=[c["field"] for c in s["claims"]])
        for c, it in zip(claims, rep.items):       # versions are strings (see receipt.version_in_quote)
            if c.get("ftype") == "version" and it.status in ("found", "moved"):
                ok = R.version_in_quote(str(c["value"]), c["quote"])
                it.value_status, it.derivation, it.verdict = ("match", ["version"], "verified") if ok else ("mismatch", [], "check")
        d = rep.to_dict()
        d["engine"] = {"name": T.SCHEMA, "sha256": hashlib.sha256(engine_py.read_bytes()).hexdigest(), "policy": pname}
        d["set"] = s["id"]
        out = data / ("report-%s-%s.json" % (s["id"], pname))
        out.write_text(json.dumps(d, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        sm = rep.summary()
        print("%-6s %-8s %s -> %s" % (s["id"], pname, {k: sm[k] for k in ("verified", "check", "reworded", "unchecked", "total", "ambiguous")}, out.name))
        if "-v" in sys.argv:
            for c, it in zip(s["claims"], rep.items):
                print("   %-9s %-8s occ=%d %s" % (it.verdict, c["kind"], it.occurrences, c["statement"][:70]))
    # every place a repeated quote stands in: the locus of each occurrence (the engine boxes the first one unless told)
    places = {}
    rep = T.check_claims(claims, sources, T.TracePolicy(), expected_fields=None)
    for i, (c, it) in enumerate(zip(claims, rep.items)):
        if it.occurrences > 1:
            src = next(x for x in sources if x.id == it.source)
            q = T.lex(c["quote"], src.mode, src.normalizer)
            lst = []
            for at in src.occurrences(q.norms):
                st = src.lexed.starts[at]
                line, col = T.line_col(src.text, st)
                one = T.check_claims([dict(c, line=line, path="", prefix="", suffix="")], sources, T.TracePolicy()).items[0]
                lst.append({"line": line, "col": col, "start": st, "xpath": one.locus.get("xpath"), "node": one.locus.get("node"),
                            "aabb_e6": one.locus.get("aabb_e6"), "aabb_owner": one.locus.get("aabb_owner")})
            places[str(i)] = lst
    (data / ("places-%s.json" % s["id"])).write_text(json.dumps(places, indent=1, sort_keys=True) + "\n", encoding="utf-8")
