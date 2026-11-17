"""Rebuild the companion's deterministic examples from the bundled study files.

Run from the lab folder with ``python3 -m companion.build_examples``. Only the
known files inside companion/examples are replaced. This is a local reproduction,
not a fresh upstream x3d_mcp run or an XML-to-RDF conversion.
"""
from __future__ import annotations

import difflib
from pathlib import Path

from . import __version__
from .__main__ import write_json
from .graph_identity import ALGORITHM, graph_identity, sha256
from .ledger import append_record, new_ledger, verify_ledger
from .xml_witness import audit_scene, patch_attribute


def main():
    root = Path(__file__).resolve().parents[1]
    destination = root / "companion" / "examples"
    destination.mkdir(exist_ok=True)
    instrument = {"name": "semantic-twin-companion", "version": __version__,
                  "checks": "lexical XML plus exact bounded RDF graph identity",
                  "canonicalization": ALGORITHM, "network": "none"}
    ledger = new_ledger()
    for name in ("cabinet", "fault-F6", "fault-F7"):
        scene = root / "data" / "scenes" / f"{name}.xml"
        turtle = root / "data" / "ttl" / f"{name}.ttl.txt"
        source = scene.read_bytes()
        report = {"schema": "semantic-twin-source-audit/v1", "instrument": instrument,
                  "source": {"basename": scene.name, "sha256": sha256(source), "bytes": len(source)},
                  "xml": audit_scene(source), "rdf": {"basename": turtle.name, **graph_identity(turtle.read_bytes()),
                  "correspondence_verified": False,
                  "note": "XML and Turtle independently inspected; no derivation correspondence is certified."}}
        write_json(destination / f"{name}-audit.json", report)
        ledger = append_record(ledger, instrument=instrument,
                               claim=f"Local audit of {name} produced these bounded observations.", evidence=report)
    source = (root / "data" / "scenes" / "fault-F1.xml").read_bytes()
    output, witness = patch_attribute(source, def_name="Ruby", attribute="diffuseColor",
                                      value="0.85 0.08 0.16", expected_sha256=sha256(source),
                                      expected_value="1.5 0.08 0.16")
    (destination / "fault-F1-repaired.x3d").write_bytes(output)
    write_json(destination / "fault-F1-repair.json", witness)
    diff = difflib.unified_diff(source.decode("utf-8").splitlines(keepends=True),
                               output.decode("utf-8").splitlines(keepends=True),
                               fromfile="fault-F1.xml", tofile="fault-F1-repaired.x3d")
    (destination / "fault-F1-repair.diff").write_text("".join(diff), encoding="utf-8")
    ledger = append_record(ledger, instrument=instrument,
                           claim="A source-hash-guarded lexical edit changed only Ruby's diffuseColor value.",
                           evidence=witness)
    write_json(destination / "evidence-ledger.json", ledger)
    verification = verify_ledger(ledger)
    write_json(destination / "ledger-anchor.json", {"head": verification["head"], "length": verification["length"],
               "note": "A local adjacent copy is a demonstration anchor, not an independently trusted external commitment."})
    print(f"Rebuilt 8 example files. Ledger contains {verification['length']} records, {verification['instruments']} instrument.")
    print("No upstream service was called. XML-to-RDF derivation was not rerun.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
