#!/usr/bin/env python3
"""Self-test for otelread.py and build.py.  python3 -I selftest.py   (standard library; exits non-zero on failure)

1. Reader agreement: the real HotROD trace (OTLP JSON) is written out as Jaeger JSON (query API shape, the mapping Jaeger's
   OTel translator uses: span.kind / error / otel.status_* tags, logs for events, CHILD_OF for the parent, FOLLOWS_FROM for links)
   and read back.  Both readers must give the same spans, and the analysis the same findings.
2. Paths the two real traces do not exercise (neither has PRODUCER / CONSUMER spans or span links): a tiny in-memory OTLP
   document, SYNTHETIC and never shipped as a scene, with enum-name kinds, base64 ids, a producer -> consumer hop and a
   batch consumer linking two producers.  It is built to a temporary scene, parsed as XML, and deleted.
"""
import base64, json, os, sys, tempfile, xml.dom.minidom

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import otelread as R  # noqa: E402
import build as B  # noqa: E402

FAIL = []


def check(cond, what):
    print(("ok    " if cond else "FAIL  ") + what)
    if not cond:
        FAIL.append(what)


def to_jaeger(spans):
    procs, out = {}, []
    for s in spans:
        pid = "p%d" % (list(procs).index(s["service"]) + 1 if s["service"] in procs else len(procs) + 1)
        if s["service"] not in procs:
            procs[s["service"]] = {"serviceName": s["service"], "tags": [{"key": k, "type": "string", "value": v} for k, v in s["resource"].items() if k != "service.name"]}
        pid = "p%d" % (list(procs).index(s["service"]) + 1)
        tags = [{"key": k, "type": "string", "value": v} for k, v in s["attrs"].items()] + [{"key": "span.kind", "type": "string", "value": s["kind"].lower()}]
        if s["status"] == "ERROR":
            tags += [{"key": "error", "type": "bool", "value": True}, {"key": "otel.status_code", "type": "string", "value": "ERROR"},
                     {"key": "otel.status_description", "type": "string", "value": s["status_msg"]}]
        refs = ([{"refType": "CHILD_OF", "traceID": s["trace"], "spanID": s["parent"]}] if s["parent"] else []) + \
               [{"refType": "FOLLOWS_FROM", "traceID": l["trace"], "spanID": l["id"]} for l in s["links"]]
        out.append({"traceID": s["trace"], "spanID": s["id"], "operationName": s["name"], "references": refs, "startTime": s["t0"] // 1000,
                    "duration": s["t1"] // 1000 - s["t0"] // 1000, "tags": tags, "processID": pid,
                    "logs": [{"timestamp": e["t"] // 1000, "fields": [{"key": "event", "type": "string", "value": e["name"]}] +
                              [{"key": k, "type": "string", "value": v} for k, v in e["attrs"].items()]} for e in s["events"]]})
    return {"data": [{"traceID": spans[0]["trace"], "spans": out, "processes": {"p%d" % (i + 1): p for i, p in enumerate(procs.values())}, "warnings": None}]}


# ---------- 1. reader agreement on the real trace ----------
src = os.path.join(HERE, "downloads", "jaeger-skills", "n_plus_one_full_serial.json")
fmt_o, so, _ = R.read(src)
with tempfile.TemporaryDirectory() as td:
    jp = os.path.join(td, "hotrod.jaeger.json")
    json.dump(to_jaeger(so), open(jp, "w"))
    fmt_j, sj, _ = R.read(jp)
check(fmt_o.startswith("OTLP") and fmt_j.startswith("Jaeger"), "format detection: %s / %s" % (fmt_o, fmt_j))
check(len(so) == len(sj) == 40, "span count 40 in both readers")
bj = {s["id"]: s for s in sj}
diff = []
for s in so:
    j = bj.get(s["id"])
    if not j:
        diff.append("missing " + s["id"])
        continue
    for k in ("parent", "service", "name", "kind", "status", "status_msg"):
        if s[k] != j[k]:
            diff.append("%s %s: %r != %r" % (s["id"][:6], k, s[k], j[k]))
    if abs(s["t0"] - j["t0"]) >= 1000 or abs(s["t1"] - j["t1"]) >= 2000:
        diff.append("%s times differ by >= 1 us" % s["id"][:6])
    if [e["name"] for e in s["events"]] != [e["name"] for e in j["events"]]:
        diff.append("%s events" % s["id"][:6])
    if {k: str(v) for k, v in s["attrs"].items()} != {k: str(v) for k, v in j["attrs"].items()}:
        diff.append("%s attributes" % s["id"][:6])
check(not diff, "span-by-span agreement (parent, service, name, kind, status, events, attributes; times to 1 us)" + ("" if not diff else ": " + "; ".join(diff[:5])))
ao = R.analyse(so, *R.model(so)[:2])
aj = R.analyse(sj, *R.model(sj)[:2])
check([f["title"] for f in ao["findings"]] == [f["title"] for f in aj["findings"]], "same finding titles from both readers")
check(abs(ao["cp_total"] - aj["cp_total"]) < 5e-6, "same critical path length (%.6f s vs %.6f s)" % (ao["cp_total"], aj["cp_total"]))

# ---------- 2. producer / consumer / links / enum names / base64 ids (SYNTHETIC, in memory) ----------
def b64(h):
    return base64.b64encode(bytes.fromhex(h)).decode()


def sp(i, name, kind, s_ms, e_ms, parent=None, links=(), err=False):
    d = {"traceId": b64("ab" * 16), "spanId": b64("%016x" % i), "name": name, "kind": kind,
         "startTimeUnixNano": str(1_700_000_000_000_000_000 + s_ms * 1_000_000), "endTimeUnixNano": str(1_700_000_000_000_000_000 + e_ms * 1_000_000),
         "attributes": [{"key": "messaging.system", "value": {"stringValue": "kafka"}}] if "orders" in name else [],
         "links": [{"traceId": b64("ab" * 16), "spanId": b64("%016x" % l)} for l in links]}
    if parent:
        d["parentSpanId"] = b64("%016x" % parent)
    if err:
        d["status"] = {"code": "STATUS_CODE_ERROR", "message": "synthetic failure"}
    return d


def rs(svc, spans):
    return {"resource": {"attributes": [{"key": "service.name", "value": {"stringValue": svc}}]}, "scopeSpans": [{"scope": {"name": "selftest"}, "spans": spans}]}


doc = {"_label": "SYNTHETIC self-test document, never shipped", "resourceSpans": [
    rs("checkout", [sp(1, "PlaceOrder", "SPAN_KIND_SERVER", 0, 100), sp(2, "orders publish", "SPAN_KIND_PRODUCER", 10, 20, 1),
                    sp(3, "orders publish", "SPAN_KIND_PRODUCER", 30, 40, 1)]),
    rs("accounting", [sp(4, "orders process", "SPAN_KIND_CONSUMER", 25, 60, 2), sp(5, "batch settle", "SPAN_KIND_INTERNAL", 70, 95, 1, links=(2, 3), err=True)]),
]}
with tempfile.TemporaryDirectory() as td:
    p = os.path.join(td, "synthetic.json")
    json.dump(doc, open(p, "w"))
    fmt, ss, _ = R.read(p)
    check(all(len(s["id"]) == 16 and len(s["trace"]) == 32 for s in ss), "base64 ids decoded to hex")
    check(sorted({s["kind"] for s in ss}) == ["CONSUMER", "INTERNAL", "PRODUCER", "SERVER"], "enum-name kinds parsed")
    by, roots, _ = R.model(ss)
    a = R.analyse(ss, by, roots)
    types = sorted(e["type"] for e in a["edges"])
    check(types.count("message") == 1 and types.count("link") == 2 and types.count("call") == 1, "edges: 1 message, 2 links, 1 call (got %s)" % types)
    check(any(s["status"] == "ERROR" for s in ss), "STATUS_CODE_ERROR parsed")
    out_before = set(os.listdir(B.OUT)) if os.path.isdir(B.OUT) else set()
    rep = B.build(p, "_selftest", "self-test", "SYNTHETIC: self-test only")
    x = open(os.path.join(B.OUT, "_selftest-scene.x3d"), encoding="utf-8").read()
    try:
        xml.dom.minidom.parseString(x.encode())
        parsed = True
    except Exception as e:  # noqa: BLE001
        parsed = str(e)
    check(parsed is True, "synthetic scene is well-formed XML")
    check(rep["edges"]["link"] == 2 and rep["edges"]["message"] == 1, "scene has the link and message arcs")
    check("&quot;link&quot;" in x, "link label drawn")
    for f in os.listdir(B.OUT):
        if f.startswith("_selftest") and f not in out_before:
            os.remove(os.path.join(B.OUT, f))

print("\n%d failure(s)" % len(FAIL))
sys.exit(1 if FAIL else 0)
