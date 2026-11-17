"""Exact bounded graph canonicalisation for local evidence comparison.

This is a project algorithm, NOT W3C RDFC-1.0 or URDNA2015. Colour refinement
partitions blank nodes, then all remaining within-class label permutations are
enumerated and the lexicographically least representation is selected. It fails
closed when the explicit search budget would be exceeded.
"""
from __future__ import annotations
import hashlib
import itertools
import json
import subprocess
from pathlib import Path

ALGORITHM = "semantic-twin-graph-c14n/v1"
PARSER_BASE_IRI = "urn:semantic-twin:input:"


class CanonicalizationLimit(ValueError):
    """The bounded exact search cannot certify a canonical graph."""


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_turtle(source: bytes, *, timeout: float = 15) -> list:
    """Parse only local bytes through the archive's already-bundled N3 parser."""
    if len(source) > 16 * 1024 * 1024:
        raise ValueError("Turtle input exceeds 16 MiB")
    bridge = Path(__file__).with_name("parse_turtle.cjs")
    try:
        p = subprocess.run(["node", str(bridge)], input=source, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise RuntimeError("Node.js is required for the bundled N3 parser") from exc
    except subprocess.TimeoutExpired as exc:
        raise CanonicalizationLimit("local Turtle parser exceeded its time budget") from exc
    if p.returncode:
        raise ValueError("Turtle parse failed: " + p.stderr.decode("utf-8", errors="replace")[:1000].strip())
    return json.loads(p.stdout)["triples"]


def _term(t):
    kind = t.get("termType")
    value = t.get("value")
    if not isinstance(value, str):
        raise ValueError("RDF term value must be a lexical string")
    if kind in ("NamedNode", "BlankNode"):
        return (kind, value)
    if kind == "Literal":
        datatype, language = t.get("datatype"), t.get("language", "")
        if not isinstance(datatype, str) or not isinstance(language, str):
            raise ValueError("literal datatype and language must be strings")
        return (kind, value, datatype, language.lower())
    raise ValueError("unsupported RDF term type")


def canonical_graph(triples, *, max_permutations=100000, max_blank_nodes=3000, max_candidate_triples=5000000):
    """Return a certified hash or refuse; never substitute a text hash on failure.

    Literals keep lexical value, datatype and language. The graph is a set of
    triples, so duplicate statements do not change identity. List order is
    represented by rdf:first/rest edges and remains significant.
    """
    if not isinstance(max_permutations, int) or isinstance(max_permutations, bool) or max_permutations < 1:
        raise ValueError("max_permutations must be a positive integer")
    if len(triples) > 50000:
        raise CanonicalizationLimit("graph exceeds 50000 triple limit")
    rows = set()
    for row in triples:
        if len(row) != 3:
            raise ValueError("expected RDF triples")
        q = tuple(_term(t) for t in row)
        if q[0][0] not in ("NamedNode", "BlankNode") or q[1][0] != "NamedNode":
            raise ValueError("invalid RDF subject or predicate")
        rows.add(q)
    blanks = sorted({t[1] for q in rows for t in q if t[0] == "BlankNode"})
    if len(blanks) > max_blank_nodes:
        raise CanonicalizationLimit("blank-node limit exceeded")
    incidence = {n: [] for n in blanks}
    for q in rows:
        for n in {t[1] for t in q if t[0] == "BlankNode"}:
            incidence[n].append(q)
    colors = {n: 0 for n in blanks}
    rounds = 0
    for _ in range(min(len(blanks) + 1, 64)):
        signatures = {}
        for n in blanks:
            neighbours = []
            for q in incidence[n]:
                parts = []
                for t in q:
                    parts.append(("Self",) if t == ("BlankNode", n) else ("Blank", colors[t[1]]) if t[0] == "BlankNode" else t)
                neighbours.append(parts)
            signatures[n] = json_bytes([colors[n], sorted(neighbours, key=json_bytes)])
        unique = sorted(set(signatures.values()))
        numbering = {s: i for i, s in enumerate(unique)}
        new = {n: numbering[signatures[n]] for n in blanks}
        rounds += 1
        # Since old colour is part of each signature, partitions can only split.
        stable = len(set(new.values())) == len(set(colors.values()))
        colors = new
        if stable:
            break
    else:
        raise CanonicalizationLimit("blank-node refinement exceeded the 64-round work budget")
    classes = [[n for n in blanks if colors[n] == c] for c in sorted(set(colors.values()))]
    permutations = 1
    for group in classes:
        # Stop before constructing enormous factorials for deliberately symmetric graphs.
        for factor in range(2, len(group) + 1):
            permutations *= factor
            if permutations > max_permutations:
                raise CanonicalizationLimit(f"exact canonicalization exceeds the {max_permutations} labeling budget")
    if permutations * max(1, len(rows)) > max_candidate_triples:
        raise CanonicalizationLimit("candidate serialization would exceed the triple-work budget")
    best = None
    # Product is lazy; refusal above prevents accidentally entering unbounded work.
    choices = [itertools.permutations(group) for group in classes]
    for assignment in itertools.product(*choices):
        mapping = {}
        for group in assignment:
            for n in group:
                mapping[n] = f"c{len(mapping)}"
        canonical = []
        for q in rows:
            canonical.append([("BlankNode", mapping[t[1]]) if t[0] == "BlankNode" else t for t in q])
        representation = json_bytes(sorted(canonical, key=json_bytes))
        if best is None or representation < best:
            best = representation
    if best is None:
        best = b"[]"
    domain = ALGORITHM.encode("ascii") + b"\n"
    return {"algorithm": ALGORITHM, "graph_sha256": sha256(domain + best), "triples": len(rows),
            "blank_nodes": len(blanks), "refinement_rounds": rounds, "labelings_checked": permutations,
            "canonicalization_complete": True, "literal_policy": "lexical value plus datatype and language; no numeric coercion"}


def graph_identity(source: bytes, **limits):
    return {"source_sha256": sha256(source), "source_bytes": len(source),
            "parser_base_iri": PARSER_BASE_IRI, **canonical_graph(parse_turtle(source), **limits)}
