"""Run with python3 -m companion --help from the lab folder."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
from . import __version__
from .graph_identity import ALGORITHM, graph_identity, sha256
from .ledger import append_record, new_ledger, verify_ledger
from .xml_witness import audit_scene, patch_attribute


def write_json(path, value):
    """Publish complete UTF-8 JSON using a same-directory atomic replace."""
    destination = Path(path)
    data = (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    fd, tmp = tempfile.mkstemp(prefix="." + destination.name + ".", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, destination)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Local reference tools for Semantic Twin Lab; no network access is used.")
    sub = parser.add_subparsers(dest="command", required=True)
    audit = sub.add_parser("audit", help="inspect XML source witnesses and optional Turtle graph identity")
    audit.add_argument("scene", type=Path)
    audit.add_argument("--ttl", type=Path)
    audit.add_argument("--out", type=Path)
    audit.add_argument("--ledger", type=Path)
    graph = sub.add_parser("graph", help="separate Turtle source identity from bounded canonical graph identity")
    graph.add_argument("turtle", type=Path)
    graph.add_argument("--max-permutations", type=int, default=100000)
    graph.add_argument("--out", type=Path)
    patch = sub.add_parser("patch", help="replace one existing attribute without reserialising the XML")
    patch.add_argument("scene", type=Path)
    patch.add_argument("--def", dest="def_name", required=True)
    patch.add_argument("--attribute", required=True)
    patch.add_argument("--value", required=True)
    patch.add_argument("--expected-sha256", required=True)
    patch.add_argument("--expected-value")
    patch.add_argument("--out", type=Path, required=True)
    verify = sub.add_parser("verify", help="verify local evidence hashes; optionally compare an external anchor")
    verify.add_argument("ledger", type=Path)
    verify.add_argument("--head")
    verify.add_argument("--length", type=int)
    args = parser.parse_args(argv)
    try:
        if args.command == "audit":
            source = args.scene.read_bytes()
            report = {"schema": "semantic-twin-source-audit/v1", "instrument": {"name": "semantic-twin-companion", "version": __version__,
                      "checks": "XML identity/order/reference checks; not XSD or SHACL", "network": "none"},
                      "source": {"basename": args.scene.name, "sha256": sha256(source), "bytes": len(source)}, "xml": audit_scene(source)}
            if args.ttl:
                report["rdf"] = {"basename": args.ttl.name, **graph_identity(args.ttl.read_bytes())}
                report["rdf"]["correspondence_verified"] = False
                report["rdf"]["note"] = "XML and Turtle were inspected independently; this command does not prove that one was derived from the other."
            if args.out:
                if args.out.resolve() in {args.scene.resolve(), args.ttl.resolve() if args.ttl else None}:
                    raise ValueError("report output must not replace an input")
                write_json(args.out, report)
            if args.ledger:
                if args.ledger.resolve() in {args.scene.resolve(), args.ttl.resolve() if args.ttl else None, args.out.resolve() if args.out else None}:
                    raise ValueError("ledger output must differ from inputs and report output")
                ledger = json.loads(args.ledger.read_text()) if args.ledger.exists() else new_ledger()
                ledger = append_record(ledger, instrument=report["instrument"], claim="The local source audit produced this report.", evidence=report)
                write_json(args.ledger, ledger)
                report["ledger_anchor"] = {k: v for k, v in verify_ledger(ledger).items() if k in ("head", "length")}
            print(json.dumps(report, indent=2, ensure_ascii=False))
            return 0 if report["xml"].get("clean") else 1
        if args.command == "graph":
            report = {"basename": args.turtle.name, **graph_identity(args.turtle.read_bytes(), max_permutations=args.max_permutations)}
            if args.out:
                if args.out.resolve() == args.turtle.resolve():
                    raise ValueError("graph report must not replace its input")
                write_json(args.out, report)
            print(json.dumps(report, indent=2))
            return 0
        if args.command == "patch":
            if args.scene.resolve() == args.out.resolve():
                raise ValueError("patch writes a separate output; input is never overwritten")
            result, witness = patch_attribute(args.scene.read_bytes(), def_name=args.def_name, attribute=args.attribute,
                value=args.value, expected_sha256=args.expected_sha256, expected_value=args.expected_value)
            if args.out.exists():
                raise ValueError("patch output already exists; choose a new filename")
            # Exclusive creation prevents a concurrent command from replacing an existing target.
            with args.out.open("xb") as handle:
                handle.write(result)
            print(json.dumps({"ok": True, "output_basename": args.out.name, "witness": witness,
                "validation": "XML well-formedness only; rebuild Turtle and run XSD/semantic/SHACL gates separately"}, indent=2))
            return 0
        report = verify_ledger(json.loads(args.ledger.read_text()), expected_head=args.head, expected_length=args.length)
        print(json.dumps(report, indent=2))
        return 0 if report["valid"] else 1
    except (ValueError, OSError, RuntimeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
