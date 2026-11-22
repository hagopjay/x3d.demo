#!/usr/bin/env python3
"""Read an OpenTelemetry trace (OTLP JSON or Jaeger JSON) into one span model, and analyse it.  Standard library only.

Accepted inputs
  OTLP JSON  ExportTraceServiceRequest / TracesData: {"resourceSpans":[{"resource":{...},"scopeSpans":[{"scope":{...},"spans":[...]}]}]}
             (also the older "instrumentationLibrarySpans" key).  kind and status.code may be numbers or enum names.
  Jaeger     the query API body {"data":[{"traceID","spans","processes"}]}, a bare trace {"traceID","spans","processes"},
             or {"data":{"spans","processes"}}.  Times in microseconds; span.kind / error / otel.status_code from tags.

Every number this module returns is computed from span start/end times, status and events in the file; nothing is estimated.
"""
import base64, json, re

KINDS = ["UNSPECIFIED", "INTERNAL", "SERVER", "CLIENT", "PRODUCER", "CONSUMER"]
STATUS = ["UNSET", "OK", "ERROR"]
ATTR_GROUPS = [("http", ("http.", "url.", "user_agent.", "client.", "server.", "network.", "net.")),
               ("db", ("db.",)), ("rpc", ("rpc.",)), ("messaging", ("messaging.",)), ("exception", ("exception.",))]


# ---------- readers ----------
def _hexid(v):
    """OTLP JSON ids are hex by spec; some exporters write base64 (protobuf JSON mapping).  Return lower-case hex or ''."""
    if not v:
        return ""
    v = str(v)
    if re.fullmatch(r"[0-9a-fA-F]+", v) and len(v) in (16, 32):
        return v.lower()
    try:
        return base64.b64decode(v + "=" * (-len(v) % 4)).hex()
    except Exception:
        return v.lower()


def _av(v):
    if not isinstance(v, dict):
        return v
    for k in ("stringValue", "boolValue"):
        if k in v:
            return v[k]
    if "intValue" in v:
        return int(v["intValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "arrayValue" in v:
        return [_av(x) for x in v["arrayValue"].get("values", [])]
    if "kvlistValue" in v:
        return {kv["key"]: _av(kv.get("value")) for kv in v["kvlistValue"].get("values", [])}
    if "bytesValue" in v:
        return v["bytesValue"]
    return None


def _attrs(lst):
    return {a["key"]: _av(a.get("value")) for a in (lst or [])}


def _enum(v, names, prefix):
    if isinstance(v, int):
        return names[v] if 0 <= v < len(names) else str(v)
    s = str(v or "").upper()
    s = s[len(prefix):] if s.startswith(prefix) else s
    return s or names[0]


def read_otlp(doc):
    spans = []
    for rs in doc.get("resourceSpans", []):
        res = _attrs((rs.get("resource") or {}).get("attributes"))
        svc = res.get("service.name", "unknown_service")
        for ss in rs.get("scopeSpans", rs.get("instrumentationLibrarySpans", [])):
            scope = ss.get("scope") or ss.get("instrumentationLibrary") or {}
            for s in ss.get("spans", []):
                st = s.get("status") or {}
                spans.append({
                    "trace": _hexid(s.get("traceId")), "id": _hexid(s.get("spanId")), "parent": _hexid(s.get("parentSpanId")),
                    "service": svc, "name": s.get("name", ""), "kind": _enum(s.get("kind", 0), KINDS, "SPAN_KIND_"),
                    "t0": int(s["startTimeUnixNano"]), "t1": int(s.get("endTimeUnixNano") or s["startTimeUnixNano"]),
                    "attrs": _attrs(s.get("attributes")), "resource": res,
                    "scope": ("%s %s" % (scope.get("name", ""), scope.get("version", ""))).strip(),
                    "status": _enum(st.get("code", 0), STATUS, "STATUS_CODE_"), "status_msg": st.get("message", ""),
                    "events": [{"t": int(e["timeUnixNano"]), "name": e.get("name", ""), "attrs": _attrs(e.get("attributes"))}
                               for e in s.get("events", [])],
                    "links": [{"trace": _hexid(l.get("traceId")), "id": _hexid(l.get("spanId")), "attrs": _attrs(l.get("attributes"))}
                              for l in s.get("links", [])]})
    return spans


def _jtags(lst):
    return {t["key"]: t.get("value") for t in (lst or [])}


def read_jaeger(doc):
    data = doc.get("data", doc)
    traces = data if isinstance(data, list) else [data]
    spans = []
    for tr in traces:
        procs = tr.get("processes") or {}
        for s in tr.get("spans", []):
            p = procs.get(s.get("processID")) or s.get("process") or {}
            res = _jtags(p.get("tags"))
            res["service.name"] = p.get("serviceName", "unknown_service")
            tags = _jtags(s.get("tags"))
            parent, links = "", []
            refs = s.get("references") or []
            child_of = [r for r in refs if r.get("refType") == "CHILD_OF"]
            # OTel -> Jaeger maps the parent to CHILD_OF and span links to FOLLOWS_FROM; classic Jaeger used FOLLOWS_FROM as a parent
            first = child_of[0] if child_of else (refs[0] if refs else None)
            if first:
                parent = _hexid(first["spanID"])
            for r in refs:
                if r is not first:
                    links.append({"trace": _hexid(r.get("traceID")), "id": _hexid(r["spanID"]), "attrs": {"jaeger.refType": r.get("refType")}})
            if not parent and s.get("parentSpanID"):
                parent = _hexid(s["parentSpanID"])
            err = tags.get("error") in (True, "true") or str(tags.get("otel.status_code", "")).upper() == "ERROR"
            status = "ERROR" if err else ("OK" if str(tags.get("otel.status_code", "")).upper() == "OK" else "UNSET")
            t0 = int(s["startTime"]) * 1000
            evs = []
            for lg in s.get("logs") or []:
                f = _jtags(lg.get("fields"))
                nm = f.pop("event", None) or f.pop("message", None) or "log"
                evs.append({"t": int(lg["timestamp"]) * 1000, "name": str(nm), "attrs": f})
            spans.append({
                "trace": _hexid(s.get("traceID")), "id": _hexid(s["spanID"]), "parent": parent, "service": res["service.name"],
                "name": s.get("operationName", ""), "kind": str(tags.pop("span.kind", "unspecified")).upper(),
                "t0": t0, "t1": t0 + int(s.get("duration", 0)) * 1000, "attrs": {k: v for k, v in tags.items() if not k.startswith("otel.status")
                                                                                 and not (k == "error" and "otel.status_code" in tags)},
                "resource": res, "scope": ("%s %s" % (tags.get("otel.library.name", tags.get("otel.scope.name", "")), tags.get("otel.library.version", ""))).strip(),
                "status": status, "status_msg": tags.get("otel.status_description", ""), "events": evs, "links": links})
    return spans


def read(path, trace_id=None):
    """-> (format, spans of one trace).  A file with several traces gives the one named, else the one with the most spans."""
    doc = json.load(open(path, encoding="utf-8"))
    if "resourceSpans" in doc:
        fmt, spans = "OTLP JSON (ExportTraceServiceRequest)", read_otlp(doc)
    elif "data" in doc or "spans" in doc:
        fmt, spans = "Jaeger JSON (query API)", read_jaeger(doc)
    else:
        raise ValueError("not OTLP JSON (resourceSpans) or Jaeger JSON (data[].spans): " + path)
    by_trace = {}
    for s in spans:
        by_trace.setdefault(s["trace"], []).append(s)
    if not by_trace:
        raise ValueError("no spans in " + path)
    tid = trace_id or max(by_trace, key=lambda k: len(by_trace[k]))
    return fmt, by_trace[tid], sorted(by_trace)


# ---------- model ----------
def model(spans):
    """Times to seconds from the trace start; depth; children; self-time (duration minus the union of child intervals)."""
    t0 = min(s["t0"] for s in spans)
    by = {s["id"]: s for s in spans}
    for s in spans:
        s["s"], s["e"] = (s["t0"] - t0) / 1e9, (s["t1"] - t0) / 1e9
        s["dur"] = s["e"] - s["s"]
        for ev in s["events"]:
            ev["ts"] = (ev["t"] - t0) / 1e9
        s["kids"] = []
        if s["parent"] and s["parent"] not in by:
            s["orphan_of"], s["parent"] = s["parent"], ""
    for s in spans:
        if s["parent"]:
            by[s["parent"]]["kids"].append(s)
    for s in spans:
        d, p, seen = 0, s["parent"], set()
        while p and p not in seen:
            seen.add(p)
            d, p = d + 1, by[p]["parent"]
        s["depth"] = d
        s["kids"].sort(key=lambda k: k["s"])
        s["self"] = s["dur"] - covered(s["s"], s["e"], [(k["s"], k["e"]) for k in s["kids"]])
    roots = [s for s in spans if not s["parent"]]
    return by, roots, t0


def union(iv):
    out = []
    for a, b in sorted(iv):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def covered(a, b, iv):
    return sum(max(0, min(b, y) - max(a, x)) for x, y in union(iv))


def uncovered(a, b, iv):
    gaps, cur = [], a
    for x, y in union([(max(a, x), min(b, y)) for x, y in iv if y > a and x < b]):
        if x > cur:
            gaps.append((cur, x))
        cur = max(cur, y)
    if cur < b:
        gaps.append((cur, b))
    return gaps


def critical_path(span, cursor=None):
    """Jaeger's rule: walk back from the span's end; take the last-finishing child that started before the cursor, clip it to the
    cursor, recurse into it, move the cursor to its start; time not covered by such a child is the span's own.
    -> [(span, from_s, to_s)] in reverse time order."""
    cur = span["e"] if cursor is None else min(span["e"], cursor)
    segs = []
    for c in sorted(span["kids"], key=lambda k: -k["e"]):
        if c["s"] >= cur or cur <= span["s"]:
            continue
        ce = min(c["e"], cur)
        if ce < cur:
            segs.append((span, ce, cur))
        segs += critical_path(c, ce)
        cur = max(c["s"], span["s"])
    if cur > span["s"]:
        segs.append((span, span["s"], cur))
    return segs


def max_overlap(iv):
    pts = sorted([(a, 1) for a, b in iv] + [(b, -1) for a, b in iv], key=lambda p: (p[0], p[1]))
    n = m = 0
    for _, d in pts:
        n += d
        m = max(m, n)
    return m


def ms(x):
    return "%.2f ms" % (x * 1000) if x < 0.001 else ("%.1f ms" % (x * 1000) if x < 10 else "%.2f s" % x)


def label(s):
    return "%s / %s" % (s["service"], s["name"])


def groups(attrs):
    out = {}
    for k, v in sorted(attrs.items()):
        g = next((g for g, pre in ATTR_GROUPS if k.startswith(pre)), "other")
        out.setdefault(g, {})[k] = v
    return out


IDENT = ("param.", "db.query.text", "db.statement", "url.full", "http.url", "rpc.method", "messaging.destination.name")


def analyse(spans, by, roots, manifest=None):
    """Findings, each with the evidence that produced it (span ids, times and the rule applied)."""
    T = max(s["e"] for s in spans)
    root = max(roots, key=lambda r: (r["e"] - r["s"], -r["s"]))
    cp = critical_path(root)
    cp_by_span, cp_by_svc = {}, {}
    for sp, a, b in cp:
        cp_by_span[sp["id"]] = cp_by_span.get(sp["id"], 0) + (b - a)
        cp_by_svc[sp["service"]] = cp_by_svc.get(sp["service"], 0) + (b - a)
    cp_total = sum(b - a for _, a, b in cp)
    svc = {}
    for s in spans:
        v = svc.setdefault(s["service"], {"self": 0.0, "spans": 0, "errors": 0, "kinds": {}, "ops": {}, "first": s["s"], "resource": s["resource"]})
        v["self"] += s["self"]
        v["spans"] += 1
        v["errors"] += s["status"] == "ERROR"
        v["kinds"][s["kind"]] = v["kinds"].get(s["kind"], 0) + 1
        v["ops"][s["name"]] = v["ops"].get(s["name"], 0) + 1
        v["first"] = min(v["first"], s["s"])
    self_sum = sum(v["self"] for v in svc.values())
    F = []

    # 1 critical path
    top = sorted(cp_by_svc.items(), key=lambda kv: -kv[1])
    top_sp = sorted(cp_by_span.items(), key=lambda kv: -kv[1])[:3]
    F.append({"key": "critical", "title": "Critical path: %s, %d%% of it in %s" % (ms(cp_total), round(100 * top[0][1] / cp_total), top[0][0]),
              "text": "; ".join("%s %s (%d%%)" % (k, ms(v), round(100 * v / cp_total)) for k, v in top),
              "evidence": "Jaeger's rule from the root %s (%s): walk back from its end through the last-finishing child; %d segments over %d spans. "
                          "Longest span shares: %s." % (label(root), ms(root["dur"]), len(cp), len(cp_by_span),
                                                        "; ".join("%s %s" % (label(by[i]), ms(v)) for i, v in top_sp)),
              "spans": [i for i, _ in top_sp]})

    # 2 slowest service by self-time
    sv = sorted(svc.items(), key=lambda kv: -kv[1]["self"])
    name, v = sv[0]
    top_self = max((s for s in spans if s["service"] == name), key=lambda s: s["self"])
    F.append({"key": "self", "title": "Slowest service by self-time: %s, %s (%d%% of all self-time)" % (name, ms(v["self"]), round(100 * v["self"] / self_sum)),
              "text": "; ".join("%s %s" % (k, ms(x["self"])) for k, x in sv),
              "evidence": "self-time = span duration minus the union of its children's intervals, summed per service (%d spans in %s; "
                          "largest single: %s, %s of %s). Sums can exceed wall time when spans run in parallel."
                          % (v["spans"], name, top_self["name"], ms(top_self["self"]), ms(top_self["dur"])),
              "spans": [top_self["id"]]})

    # 3 errors and exceptions
    errs = [s for s in spans if s["status"] == "ERROR"]
    exc = [(s, e) for s in spans for e in s["events"] if e["name"] == "exception"]
    loci = []
    for s in errs:
        segs = critical_path(s)
        deep = max(segs, key=lambda g: (g[0]["depth"], g[2] - g[1]))[0]
        loci.append((s, deep))
    if errs:
        parts = []
        for s, deep in loci[:4]:
            msg = s["status_msg"] or next((e["attrs"].get("exception.message") for e in s["events"] if e["name"] == "exception"), "") or "no message"
            p = "%s at +%s (%s)" % (label(s), ms(s["s"]), msg)
            if deep is not s:
                p += "; its own critical path ends in %s, %s, status %s" % (label(deep), ms(deep["dur"]), deep["status"])
            parts.append(p)
        F.append({"key": "errors", "title": "Errors: %d span%s with status ERROR, %d exception event%s" % (len(errs), "" if len(errs) == 1 else "s", len(exc), "" if len(exc) == 1 else "s"),
                  "text": "; ".join(parts) + ("; ..." if len(loci) > 4 else ""),
                  "evidence": "status.code = ERROR on the span; exception = span events named 'exception' (%s). Where an errored span has "
                              "children, the deepest span on its critical path is named as the place its time went (a locus, not a cause)."
                              % (", ".join(sorted({e["attrs"].get("exception.type") or e["attrs"].get("exception.message", "?") for _, e in exc})) or "none"),
                  "spans": [s["id"] for s in errs] + [d["id"] for _, d in loci if d["status"] != "ERROR"]})
    else:
        F.append({"key": "errors", "title": "Errors: none", "text": "No span has status ERROR and no span has an exception event.",
                  "evidence": "status.code and events of all %d spans" % len(spans), "spans": []})

    # 4 retries: retry-named events, and an errored call re-run by the same parent with the same identifying attributes
    retry_ev = [(s, e) for s in spans for e in s["events"] if re.search(r"retr(y|ied|ying)", e["name"], re.I)]
    reruns = []
    for s in errs:
        ident = {k: v for k, v in s["attrs"].items() if k.startswith(IDENT)}
        sib = [k for k in (by[s["parent"]]["kids"] if s["parent"] else []) if k is not s and k["service"] == s["service"]
               and k["name"] == s["name"] and k["s"] >= s["e"] - 1e-6]
        nxt = next((k for k in sib if all(k["attrs"].get(a) == b for a, b in ident.items())), None)
        if nxt:
            reruns.append((s, nxt, ident))
    if retry_ev or reruns:
        F.append({"key": "retries", "title": "Retries: %d re-run%s after an error, %d retry event%s" % (len(reruns), "" if len(reruns) == 1 else "s", len(retry_ev), "" if len(retry_ev) == 1 else "s"),
                  "text": "; ".join("%s failed at +%s, re-run at +%s with the same %s" % (label(a), ms(a["s"]), ms(b["s"]), ", ".join("%s=%s" % kv for kv in i.items()) or "operation")
                                    for a, b, i in reruns[:4]) or "; ".join("%s: %s at +%s" % (label(s), e["name"], ms(e["ts"])) for s, e in retry_ev[:4]),
                  "evidence": "re-run = the next sibling with the same service, name and identifying attributes (%s) starting after the errored "
                              "span ended; retry events = events whose name matches 'retry' (%s)." % (", ".join(IDENT), ", ".join(sorted({"%s on %s" % (e["name"], label(s)) for s, e in retry_ev})) or "none"),
                  "spans": [i for a, b, _ in reruns for i in (a["id"], b["id"])] + [s["id"] for s, _ in retry_ev]})
    else:
        F.append({"key": "retries", "title": "Retries: none found", "text": "No errored span was re-run by its parent and no event is named like a retry.",
                  "evidence": "sibling and event scan of all %d spans" % len(spans), "spans": []})

    # 5 fan-out: siblings with the same service and name under one parent
    fan = []
    for p in spans:
        g = {}
        for k in p["kids"]:
            g.setdefault((k["service"], k["name"]), []).append(k)
        for (sv_, nm), ks in g.items():
            if len(ks) >= 3:
                iv = [(k["s"], k["e"]) for k in ks]
                wall = max(b for _, b in iv) - min(a for a, _ in iv)
                fan.append({"parent": p, "service": sv_, "name": nm, "kids": ks, "n": len(ks), "conc": max_overlap(iv), "wall": wall,
                            "sum": sum(b - a for a, b in iv)})
    fan.sort(key=lambda f: (-f["n"], f["parent"]["s"]))
    if fan:
        def fdesc(f):
            shape = "serial: no two overlap, so each call waits for the last (N+1 shape)" if f["conc"] == 1 else "parallel, up to %d at once" % f["conc"]
            return "%d x %s / %s under %s (%s): %s; wall %s, sum of durations %s" % (f["n"], f["service"], f["name"], label(f["parent"]), f["parent"]["id"][:8], shape, ms(f["wall"]), ms(f["sum"]))
        mx = max(len(s["kids"]) for s in spans)
        F.append({"key": "fanout", "title": "Fan-out: %d x %s / %s, %s" % (fan[0]["n"], fan[0]["service"], fan[0]["name"], "serial" if fan[0]["conc"] == 1 else "up to %d parallel" % fan[0]["conc"]),
                  "text": "; ".join(fdesc(f) for f in fan[:3]),
                  "evidence": "siblings grouped by (service, name) under one parent, groups of 3 or more; overlap = largest number of the group's "
                              "intervals open at one instant. Widest parent overall: %d children." % mx,
                  "spans": [k["id"] for k in fan[0]["kids"]], "groups": [{"parent": f["parent"]["id"], "n": f["n"], "conc": f["conc"], "wall": f["wall"], "sum": f["sum"],
                                                                         "service": f["service"], "name": f["name"]} for f in fan[:3]]})
    else:
        F.append({"key": "fanout", "title": "Fan-out: no parent calls one operation 3 or more times", "text": "", "evidence": "sibling groups of all spans", "spans": []})

    # 6 gaps: time inside a parent, between its first child's start and its last child's end, when none of its children runs
    gaps = []
    for p in spans:
        if len(p["kids"]) < 2:
            continue
        a, b = min(k["s"] for k in p["kids"]), max(k["e"] for k in p["kids"])
        for x, y in uncovered(a, b, [(k["s"], k["e"]) for k in p["kids"]]):
            before = max((k for k in p["kids"] if k["e"] <= x + 1e-9), key=lambda k: k["e"])
            after = min((k for k in p["kids"] if k["s"] >= y - 1e-9), key=lambda k: k["s"])
            gaps.append({"parent": p, "s": x, "e": y, "before": before, "after": after})
    gaps.sort(key=lambda g: -(g["e"] - g["s"]))
    idle = sum(g["e"] - g["s"] for g in gaps)
    if gaps and gaps[0]["e"] - gaps[0]["s"] > 0.0005:
        g = gaps[0]
        F.append({"key": "gaps", "title": "Gaps: %d between child calls, %s in all; largest %s in %s" % (len(gaps), ms(idle), ms(g["e"] - g["s"]), label(g["parent"])),
                  "text": "; ".join("%s idle in %s from +%s (after %s) to +%s (before %s)" % (ms(x["e"] - x["s"]), label(x["parent"]), ms(x["s"]), x["before"]["name"], ms(x["e"]), x["after"]["name"]) for x in gaps[:3]),
                  "evidence": "inside each parent with 2 or more children, the intervals between its first child's start and its last child's end "
                              "that no child covers (time the parent spent on its own between calls, or unrecorded work).",
                  "spans": list(dict.fromkeys(i for x in gaps[:3] for i in (x["parent"]["id"], x["before"]["id"], x["after"]["id"]))),
                  "list": [{"parent": x["parent"]["id"], "s": x["s"], "e": x["e"]} for x in gaps[:6]]})
    else:
        F.append({"key": "gaps", "title": "Gaps: none over 0.5 ms", "text": "", "evidence": "child coverage of every parent", "spans": [], "list": []})

    # 7 the file's own manifest, when there is one: does our mechanical answer agree with the recorded one?
    if manifest:
        exp = manifest.get("expected", {})
        rows, agree = [], []
        if "parent_span_id" in exp:
            f = next((f for f in fan if f["parent"]["id"] == exp["parent_span_id"] and f["name"] == exp.get("operation")), None)
            if f:
                ok = f["n"] == exp.get("siblings") and (f["conc"] == 1) == (exp.get("overlapping_pairs") == 0)
                agree.append(ok)
                rows.append("manifest: %s x %s under %s, %s overlapping pairs, wall %s ms, sum %s ms; ours: %d, max overlap %d, wall %.1f ms, sum %.1f ms"
                            % (exp.get("siblings"), exp.get("operation"), exp["parent_span_id"][:8], exp.get("overlapping_pairs"), exp.get("wall_ms"),
                               exp.get("sum_of_durations_ms"), f["n"], f["conc"], f["wall"] * 1000, f["sum"] * 1000))
            else:
                agree.append(False)
                rows.append("manifest names parent %s; no matching sibling group found here" % exp["parent_span_id"][:8])
        if "locus_span_id" in exp:
            hit = [(s, d) for s, d in loci if d["id"] == exp["locus_span_id"]]
            agree.append(bool(hit))
            rows.append("manifest locus: %s / %s (%s), %s ms; ours: %s" % (exp.get("locus_service"), exp.get("locus_operation"), exp["locus_span_id"][:8],
                        exp.get("locus_duration_ms"), "; ".join("%s -> %s (%s)" % (label(s), label(d), d["id"][:8]) for s, d in loci) or "no errored span"))
        src = manifest.get("source", {})
        F.append({"key": "manifest", "title": "Check against the fixture's manifest: %s" % ("agrees" if agree and all(agree) else "DISAGREES" if agree else "nothing comparable"),
                  "text": "; ".join(rows),
                  "evidence": "%s.manifest.json from the Jaeger repo (label derived from %s; source %s, captured %s)" % (manifest.get("fixture"), manifest.get("label_derived_from"),
                              src.get("system"), src.get("captured")), "spans": [exp[k] for k in ("parent_span_id", "locus_span_id") if k in exp]})

    edges = []   # cross-service calls (parent and child in different services) and span links
    for s in spans:
        if s["parent"] and by[s["parent"]]["service"] != s["service"]:
            p = by[s["parent"]]
            typ = {("CLIENT", "SERVER"): "rpc", ("PRODUCER", "CONSUMER"): "message"}.get((p["kind"], s["kind"]), "call")
            edges.append({"from": p["id"], "to": s["id"], "type": typ})
        for l in s["links"]:
            if l["id"] in by:
                edges.append({"from": l["id"], "to": s["id"], "type": "link"})
    return {"T": T, "root": root, "cp": cp, "cp_by_span": cp_by_span, "cp_by_svc": cp_by_svc, "cp_total": cp_total, "services": svc,
            "self_sum": self_sum, "findings": F, "edges": edges, "errors": errs, "loci": loci, "reruns": reruns, "retry_events": retry_ev,
            "fan": fan, "gaps": gaps}
