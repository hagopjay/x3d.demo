"""Compact content-addressed instruments and hash-linked local evidence.

Integrity does not establish truth, authorship, or completeness. An externally
retained head and length are needed to detect a fully recomputed/truncated chain.
"""
from __future__ import annotations
import copy
import re
from .graph_identity import json_bytes, sha256

SCHEMA = "semantic-twin-evidence-ledger/v1"
ZERO = "0" * 64
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")


def new_ledger():
    return {"schema": SCHEMA, "instruments": {}, "records": []}


def instrument_hash(instrument):
    return sha256(b"semantic-twin-instrument/v1\n" + json_bytes(instrument))


def record_hash(record):
    return sha256(b"semantic-twin-record/v1\n" + json_bytes(record))


def verify_ledger(ledger, *, expected_head=None, expected_length=None):
    errors = []
    if not isinstance(ledger, dict) or ledger.get("schema") != SCHEMA:
        return {"valid": False, "errors": ["unsupported ledger schema"], "head": None, "length": 0}
    instruments, records = ledger.get("instruments"), ledger.get("records")
    if not isinstance(instruments, dict) or not isinstance(records, list):
        return {"valid": False, "errors": ["malformed ledger structure"], "head": None, "length": 0}
    for key, instrument in instruments.items():
        try:
            if not isinstance(instrument, dict) or instrument_hash(instrument) != key:
                errors.append("instrument digest mismatch: " + str(key))
        except (ValueError, TypeError):
            errors.append("instrument cannot be encoded as finite JSON")
    previous = ZERO
    for i, record in enumerate(records):
        if not isinstance(record, dict) or set(record) != {"sequence", "previous", "instrument", "claim", "evidence", "sha256"}:
            errors.append(f"record {i}: malformed envelope")
            continue
        if any(not isinstance(record[k], str) or not _DIGEST.fullmatch(record[k]) for k in ("previous", "instrument", "sha256")):
            errors.append(f"record {i}: malformed digest")
            continue
        if type(record["sequence"]) is not int or record["sequence"] != i:
            errors.append(f"record {i}: sequence mismatch")
        if not isinstance(record["claim"], str) or not record["claim"].strip():
            errors.append(f"record {i}: missing claim text")
        if record["previous"] != previous:
            errors.append(f"record {i}: parent mismatch")
        if record["instrument"] not in instruments:
            errors.append(f"record {i}: unknown instrument")
        envelope = {k: v for k, v in record.items() if k != "sha256"}
        try:
            if record_hash(envelope) != record["sha256"]:
                errors.append(f"record {i}: digest mismatch")
        except (ValueError, TypeError):
            errors.append(f"record {i}: invalid JSON value")
        previous = record["sha256"]
    if expected_head is not None and expected_head != previous:
        errors.append("external head does not match")
    if expected_length is not None and expected_length != len(records):
        errors.append("external length does not match")
    anchor_supplied = expected_head is not None and expected_length is not None
    return {"valid": not errors, "errors": errors, "head": previous, "length": len(records),
            "instruments": len(instruments), "authenticity_verified": False,
            "external_anchor_supplied": anchor_supplied,
            "completeness_anchored": anchor_supplied and not errors}


def append_record(ledger, *, instrument, claim, evidence):
    verification = verify_ledger(ledger)
    if not verification["valid"]:
        raise ValueError("refusing to append to invalid ledger: " + "; ".join(verification["errors"]))
    if not isinstance(instrument, dict) or not isinstance(claim, str) or not claim.strip():
        raise ValueError("instrument must be an object and claim a nonempty string")
    result = copy.deepcopy(ledger)
    key = instrument_hash(instrument)
    result["instruments"][key] = copy.deepcopy(instrument)
    record = {"sequence": len(result["records"]), "previous": verification["head"],
              "instrument": key, "claim": claim, "evidence": copy.deepcopy(evidence)}
    record["sha256"] = record_hash(record)
    result["records"].append(record)
    return result
