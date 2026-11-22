#!/usr/bin/env python3
"""Build the SYNTHETIC Langfuse trace export used by this folder (deterministic: same bytes every run).

Nothing here was recorded from a live system: the company (Halden Bikes), the knowledge-base text, the order, the
model names, the token counts, the latencies, the prices and the scores are all invented for the demo.

Schema followed (Langfuse public API, openapi.yml fetched 2026-11-20 from
raw.githubusercontent.com/langfuse/langfuse/main/web/public/generated/api/openapi.yml, sha256 cdaac03b07396353...):
  observations   ObservationsV2Response  {data: [ObservationV2], meta}   (GET /api/public/v2/observations?traceId=...)
  scores         Score (v1, NumericScore | BooleanScore | CategoricalScore over BaseScore)   (GET /api/public/scores)
  trace          the trace-level fields that ObservationV2 denormalises (traceName, tags, release, userId, sessionId) plus
                 id / timestamp / input / output / metadata / environment. The current spec no longer documents the
                 TraceWithFullDetails body of GET /api/public/traces/{traceId}, so this object is NOT validated against a schema.
Envelope keys (`_synthetic`, `_schema`, `trace`, `observations`, `scores`) are this folder's own; check_trace() in build.py
checks every ObservationV2 / Score field name against the spec.
"""
import json, os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "trace", "langfuse-rag-support-agent.synthetic.json")
T0 = datetime(2026, 11, 19, 14, 2, 11, 0, tzinfo=timezone.utc)
TRACE_ID = "c0ffee5a-71e2-4b0d-9d3a-5e1f00d3a001"
PROJECT = "proj-synthetic-demo"
PRICE = {"provider-x/chat-large": (2.50, 10.00), "provider-x/chat-small": (0.15, 0.60), "provider-x/embed-small": (0.02, 0.0),
         "provider-x/judge-small": (0.15, 0.60)}            # USD per 1M input / output tokens: SYNTHETIC price table

DOCS = [
    ("kb-warranty-0412", "Battery warranty (e-bikes)",
     "Halden e-bike batteries are covered for 24 months from the date of delivery. A battery that holds less than 70 percent "
     "of its rated capacity within the warranty period is replaced free of charge. Capacity is measured by an authorised "
     "service centre with the Halden Diagnostic Tool."),
    ("kb-service-0137", "Replacement turnaround",
     "Once a claim is approved, a replacement battery ships within 7 to 10 business days. Customers in remote postcodes "
     "should allow 3 additional business days."),
    ("kb-claims-0098", "How to open a warranty claim",
     "Open a claim from the Orders page or by calling support. You will need the order number and the frame serial number "
     "printed under the bottom bracket."),
    ("kb-accessories-0551", "Accessory warranty",
     "Lights, locks and racks sold by Halden carry a 12 month limited warranty against manufacturing defects."),
]
VEC_SCORES = [0.884, 0.861, 0.812, 0.774]
RERANK = [0.97, 0.91, 0.88, 0.21]
QUESTION = "My Halden e-bike battery barely lasts 20 km now. I bought it about 18 months ago. Is it still under warranty, and how long would a replacement take?"
ORDER = {"order_id": "HB-20391", "sku": "HB-EB-500-BAT", "delivered_at": "2025-05-12", "customer_tier": "standard"}
ANSWER = ("Yes, your battery is still under warranty. Halden e-bike batteries are covered for 24 months from the date of delivery, "
          "and order HB-20391 was delivered on 2025-05-12. If a service centre measures less than 70 percent of rated capacity, "
          "the battery is replaced free of charge. After approval, a replacement ships within 5 business days. "
          "To start, open a claim from the Orders page with your order number and the frame serial number.")
CITATIONS = [   # what the model returned beside its answer: value + exact quote + source (the x3dtrace claim shape)
    {"field": "warranty_months", "value": 24, "quote": "covered for 24 months from the date of delivery", "source": "kb-warranty-0412"},
    {"field": "delivered_at", "value": "2025-05-12", "quote": "\"delivered_at\": \"2025-05-12\"", "source": "tool:order-api"},
    {"field": "capacity_threshold_percent", "value": 70, "quote": "less than 70 percent of its rated capacity", "source": "kb-warranty-0412"},
    {"field": "replacement_cost", "value": "free of charge", "quote": "is replaced free of charge", "source": "kb-warranty-0412"},
    {"field": "replacement_ship_business_days", "value": 5, "quote": "ships within 7 to 10 business days", "source": "kb-service-0137"},
    {"field": "claim_channel", "value": "Orders page", "quote": "Open a claim from the Orders page", "source": "kb-claims-0098"},
    {"field": "required_identifier", "value": "frame serial number", "quote": "the order number and the frame serial number", "source": "kb-claims-0098"},
]


def ts(ms):
    return (T0 + timedelta(milliseconds=ms)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def obs(oid, typ, name, parent, start, end, *, level="DEFAULT", status=None, inp=None, out=None, meta=None, model=None,
        params=None, usage=None, ttft=None, prompt=None):
    o = {"id": oid, "traceId": TRACE_ID, "startTime": ts(start), "endTime": ts(end) if end is not None else None,
         "projectId": PROJECT, "parentObservationId": parent, "type": typ, "isRootObservation": parent is None, "name": name,
         "level": level, "statusMessage": status, "version": "2026.11.3", "environment": "synthetic-demo", "bookmarked": False,
         "public": False, "userId": "user-7f3a", "sessionId": "sess-2026-11-19-0042",
         "completionStartTime": ts(start + ttft) if ttft is not None else None, "createdAt": ts(start), "updatedAt": ts(end or start),
         "input": inp, "output": out, "metadata": meta or {}, "model": model, "internalModelId": None, "modelParameters": params,
         "usageDetails": None, "costDetails": None, "totalCost": None, "usagePricingTierName": None,
         "promptId": None, "promptName": prompt[0] if prompt else None, "promptVersion": prompt[1] if prompt else None,
         "latency": round((end - start) / 1000, 3) if end is not None else None,
         "timeToFirstToken": round(ttft / 1000, 3) if ttft is not None else None,
         "modelId": None, "inputPrice": None, "outputPrice": None, "totalPrice": None,
         "traceName": "support-agent", "tags": ["rag", "warranty", "synthetic"], "release": "agent-2026.11.3"}
    if usage:
        i, o_ = usage
        pi, po = PRICE[model]
        o["usageDetails"] = {"input": i, "output": o_, "total": i + o_}
        ci, co = round(i * pi / 1e6, 8), round(o_ * po / 1e6, 8)
        o["costDetails"] = {"input": ci, "output": co, "total": round(ci + co, 8)}
        o["totalCost"] = round(ci + co, 8)
        o["inputPrice"], o["outputPrice"] = pi / 1e6, po / 1e6
    return o


def build():
    docs_out = [{"id": d, "title": t, "text": x, "similarity": s} for (d, t, x), s in zip(DOCS, VEC_SCORES)]
    O = []
    O.append(obs("obs-01", "AGENT", "support-agent", None, 0, 7420, inp={"question": QUESTION}, out={"answer": ANSWER},
                 meta={"agent": "halden-support", "max_steps": 6}))
    O.append(obs("obs-02", "GUARDRAIL", "input-moderation", "obs-01", 18, 164, inp={"text": QUESTION},
                 out={"flagged": False, "categories": []}, meta={"policy": "pii+abuse v4"}))
    O.append(obs("obs-03", "GENERATION", "plan-steps", "obs-01", 180, 1010, model="provider-x/chat-small",
                 params={"temperature": 0, "max_tokens": 200}, usage=(612, 74), ttft=290, prompt=("agent-planner", 7),
                 inp=[{"role": "system", "content": "Plan the tool calls needed to answer."}, {"role": "user", "content": QUESTION}],
                 out={"plan": ["search_kb('battery warranty replacement time')", "lookup_order(user)"]}))
    O.append(obs("obs-04", "RETRIEVER", "retrieve-docs", "obs-01", 1030, 1640, inp={"query": "battery warranty replacement time"},
                 out={"documents": [d["id"] for d in docs_out]}, meta={"index": "kb-v12", "k": 4}))
    O.append(obs("obs-05", "EMBEDDING", "embed-query", "obs-04", 1036, 1188, model="provider-x/embed-small", usage=(9, 0),
                 inp="battery warranty replacement time", out={"dims": 1536}))
    O.append(obs("obs-06", "RETRIEVER", "vector-search", "obs-04", 1196, 1472, inp={"top_k": 4, "index": "kb-v12"},
                 out={"documents": docs_out}))
    O.append(obs("obs-07", "SPAN", "rerank", "obs-04", 1480, 1632, inp={"n": 4},
                 out={"ranked": [{"id": d[0], "score": r} for d, r in zip(DOCS, RERANK)], "kept": 3}, meta={"cutoff": 0.5}))
    O.append(obs("obs-08", "TOOL", "order-api", "obs-01", 1650, 2870, level="ERROR",
                 status="upstream timeout after 1.2 s (attempt 1 of 3)", inp={"user_id": "user-7f3a"}, out=None,
                 meta={"http_status": 504, "attempt": 1}))
    O.append(obs("obs-09", "TOOL", "order-api", "obs-01", 2900, 3180, level="WARNING", status="succeeded on retry (attempt 2 of 3)",
                 inp={"user_id": "user-7f3a"}, out=ORDER, meta={"http_status": 200, "attempt": 2}))
    O.append(obs("obs-10", "GENERATION", "compose-answer", "obs-01", 3210, 6240, model="provider-x/chat-large",
                 params={"temperature": 0.2, "max_tokens": 400, "response_format": "json_schema:cited_answer"},
                 usage=(2184, 231), ttft=455, prompt=("support-answer", 12),
                 inp=[{"role": "system", "content": "Answer only from the context. For every value, copy the exact quote and its source id."},
                      {"role": "user", "content": QUESTION},
                      {"role": "tool", "content": json.dumps(ORDER)}] + [{"role": "context", "id": d[0], "content": d[2]} for d in DOCS[:3]],
                 out={"answer": ANSWER, "citations": CITATIONS}))
    O.append(obs("obs-11", "EVENT", "citations-emitted", "obs-01", 6252, None, inp=None, out={"count": len(CITATIONS)}))
    O.append(obs("obs-12", "EVALUATOR", "faithfulness-judge", "obs-01", 6270, 7380, model="provider-x/judge-small",
                 params={"temperature": 0}, usage=(1420, 96), ttft=380, prompt=("judge-faithfulness", 3),
                 inp={"answer": ANSWER, "context_ids": [d[0] for d in DOCS[:3]]},
                 out={"score": 0.83, "unsupported": ["ships within 5 business days"]}))
    for o in O:
        if o["type"] == "EVENT":
            o["latency"] = None
    scores = [
        score("sc-1", "faithfulness", 0.83, "obs-10", "EVAL", "NUMERIC", "1 of 7 cited values not supported: shipping time (source says 7 to 10 business days)"),
        score("sc-2", "retrieval-relevance", 0.92, "obs-06", "EVAL", "NUMERIC", "mean rerank score of the 3 kept documents"),
        score("sc-3", "pii-detected", 0, "obs-02", "API", "BOOLEAN", None, string="False"),
        score("sc-4", "user-feedback", 1, None, "ANNOTATION", "BOOLEAN", "thumbs up", string="True"),
        score("sc-5", "resolution", 1, None, "EVAL", "CATEGORICAL", None, string="resolved"),
    ]
    trace = {"id": TRACE_ID, "timestamp": ts(0), "name": "support-agent", "input": {"question": QUESTION},
             "output": {"answer": ANSWER}, "userId": "user-7f3a", "sessionId": "sess-2026-11-19-0042",
             "tags": ["rag", "warranty", "synthetic"], "release": "agent-2026.11.3", "version": "2026.11.3",
             "environment": "synthetic-demo", "metadata": {"synthetic_price_table_usd_per_1M_tokens": {k: list(v) for k, v in PRICE.items()}}}
    return {"_synthetic": "SYNTHETIC: invented for the X3D trace demo; no live system, model or customer behind any value.",
            "_schema": {"source": "Langfuse public API openapi.yml (main, fetched 2026-11-20)",
                        "sha256": "cdaac03b07396353ffb7e5870285014f7aa3c35d342295987ebd7d81a2e36b19",
                        "observations": "#/components/schemas/ObservationsV2Response", "scores": "#/components/schemas/Score (v1)"},
            "trace": trace, "observations": {"data": O, "meta": {}}, "scores": scores}


def score(sid, name, value, oid, source, dtype, comment, string=None):
    s = {"id": sid, "traceId": TRACE_ID, "sessionId": None, "observationId": oid, "datasetRunId": None, "name": name,
         "source": source, "timestamp": ts(7400), "createdAt": ts(7400), "updatedAt": ts(7400), "authorUserId": None,
         "comment": comment, "metadata": None, "configId": None, "queueId": None, "environment": "synthetic-demo",
         "value": value, "dataType": dtype}
    if string is not None:
        s["stringValue"] = string
    return s


if __name__ == "__main__":
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(build(), f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(OUT)
