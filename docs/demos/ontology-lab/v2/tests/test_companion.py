import copy
import json
from pathlib import Path
import random
import shutil
import unittest
from companion.graph_identity import CanonicalizationLimit, canonical_graph, graph_identity, parse_turtle
from companion.ledger import append_record, new_ledger, verify_ledger


def named(value): return {"termType": "NamedNode", "value": value}
def blank(value): return {"termType": "BlankNode", "value": value}
def literal(value, datatype="http://www.w3.org/2001/XMLSchema#string", language=""):
    return {"termType": "Literal", "value": value, "datatype": datatype, "language": language}


class CanonicalGraphTests(unittest.TestCase):
    def test_label_and_statement_order_do_not_change_graph(self):
        p = named("urn:link")
        graph = [[named("urn:root"), p, blank("a")], [blank("a"), p, blank("b")], [blank("b"), p, literal("end")]]
        other = [[blank("y"), p, literal("end")], [named("urn:root"), p, blank("x")], [blank("x"), p, blank("y")]]
        self.assertEqual(canonical_graph(graph)["graph_sha256"], canonical_graph(other)["graph_sha256"])

    def test_graph_is_a_set_but_lists_are_not(self):
        a = [[named("urn:s"), named("urn:p"), literal("x")]]
        self.assertEqual(canonical_graph(a)["graph_sha256"], canonical_graph(a + a)["graph_sha256"])
        first, rest = named("urn:first"), named("urn:rest")
        one = [[blank("a"), first, literal("red")], [blank("a"), rest, blank("b")], [blank("b"), first, literal("blue")]]
        two = [[blank("a"), first, literal("blue")], [blank("a"), rest, blank("b")], [blank("b"), first, literal("red")]]
        self.assertNotEqual(canonical_graph(one)["graph_sha256"], canonical_graph(two)["graph_sha256"])

    def test_large_integer_and_lexical_datatype_preserved(self):
        prefix = [named("urn:s"), named("urn:p")]
        a = [prefix + [literal("9007199254740993", "urn:integer")]]
        b = [prefix + [literal("9007199254740992", "urn:integer")]]
        c = [prefix + [literal("9007199254740993", "urn:string")]]
        self.assertNotEqual(canonical_graph(a)["graph_sha256"], canonical_graph(b)["graph_sha256"])
        self.assertNotEqual(canonical_graph(a)["graph_sha256"], canonical_graph(c)["graph_sha256"])

    def test_symmetric_cycle_relabelings_are_identical(self):
        p = named("urn:link")
        cycle = [[blank(str(i)), p, blank(str((i + 1) % 4))] for i in range(4)]
        original = canonical_graph(cycle)["graph_sha256"]
        for seed in range(8):
            rng = random.Random(seed); labels = list("abcd"); rng.shuffle(labels)
            relabeled = [[blank(labels[int(s["value"])]), p, blank(labels[int(o["value"])])] for s, _, o in cycle]
            rng.shuffle(relabeled)
            self.assertEqual(original, canonical_graph(relabeled)["graph_sha256"])

    def test_ambiguity_budget_fails_closed(self):
        p = named("urn:p")
        rows = [[blank(str(i)), p, literal("same")] for i in range(8)]
        with self.assertRaises(CanonicalizationLimit): canonical_graph(rows, max_permutations=100)

    def test_refinement_and_candidate_work_are_bounded(self):
        p = named("urn:p")
        path = [[blank(str(i)), p, blank(str(i + 1))] for i in range(199)]
        path.append([named("urn:start"), p, blank("0")])
        path.append([blank("199"), p, literal("end")])
        with self.assertRaises(CanonicalizationLimit): canonical_graph(path)
        symmetric = [[blank(str(i)), p, literal("same")] for i in range(4)]
        with self.assertRaises(CanonicalizationLimit): canonical_graph(symmetric, max_candidate_triples=10)

    def test_invalid_rdf_rejected(self):
        with self.assertRaises(ValueError): canonical_graph([[literal("bad"), named("urn:p"), named("urn:o")]])
        with self.assertRaises(ValueError): canonical_graph([], max_permutations=0)

    @unittest.skipUnless(shutil.which("node"), "Node.js needed for bundled N3 parser")
    def test_real_turtle_hash_distinguishes_bytes_from_graph(self):
        a = b'@prefix : <urn:test:> . :s :p [ :q "hello" ] .'
        b = b'@prefix t: <urn:test:> . _:other t:q "hello" . t:s t:p _:other .\n'
        x, y = graph_identity(a), graph_identity(b)
        self.assertNotEqual(x["source_sha256"], y["source_sha256"])
        self.assertEqual(x["graph_sha256"], y["graph_sha256"])
        self.assertTrue(x["canonicalization_complete"])

    @unittest.skipUnless(shutil.which("node"), "Node.js needed for bundled N3 parser")
    def test_repeated_list_values_and_large_integer_remain_lexical(self):
        rows = parse_turtle(b'@prefix : <urn:test:> . :s :p (1 1 1); :big 9007199254740993 .')
        ones = [t[2] for t in rows if t[1]["value"].endswith("#first")]
        self.assertEqual([v["value"] for v in ones], ["1", "1", "1"])
        self.assertIn("9007199254740993", [t[2]["value"] for t in rows])

    @unittest.skipUnless(shutil.which("node"), "Node.js needed for bundled N3 parser")
    def test_malformed_utf8_is_not_replaced_into_a_different_graph(self):
        with self.assertRaisesRegex(ValueError, "Turtle parse failed"):
            parse_turtle(b'<urn:s> <urn:p> "bad\xfftext" .')

    @unittest.skipUnless(shutil.which("node"), "Node.js needed for bundled N3 parser")
    def test_cabinet_fixture_is_a_real_nontrivial_graph(self):
        p = Path(__file__).resolve().parents[1] / "data/ttl/cabinet.ttl.txt"
        report = graph_identity(p.read_bytes())
        self.assertEqual(report["triples"], 1939)
        self.assertGreater(report["blank_nodes"], 300)
        self.assertEqual(report["labelings_checked"], 1)

    @unittest.skipUnless(shutil.which("node"), "Node.js needed for bundled N3 parser")
    def test_source_order_fault_can_share_the_same_graph_identity(self):
        root = Path(__file__).resolve().parents[1] / "data"
        cabinet = graph_identity((root / "ttl/cabinet.ttl.txt").read_bytes())
        before_def = graph_identity((root / "ttl/fault-F6.ttl.txt").read_bytes())
        self.assertNotEqual((root / "scenes/cabinet.xml").read_bytes(),
                            (root / "scenes/fault-F6.xml").read_bytes())
        self.assertNotEqual(cabinet["source_sha256"], before_def["source_sha256"])
        self.assertEqual(cabinet["graph_sha256"], before_def["graph_sha256"])

    @unittest.skipUnless(shutil.which("node"), "Node.js needed for bundled N3 parser")
    def test_cabinet_graph_identity_survives_whole_graph_relabeling(self):
        path = Path(__file__).resolve().parents[1] / "data/ttl/cabinet.ttl.txt"
        rows = parse_turtle(path.read_bytes())
        before = canonical_graph(rows)["graph_sha256"]
        relabeled = copy.deepcopy(rows)
        for row in relabeled:
            for term in row:
                if term["termType"] == "BlankNode": term["value"] = "changed_" + term["value"][::-1]
        random.Random(12345).shuffle(relabeled)
        self.assertEqual(before, canonical_graph(relabeled)["graph_sha256"])
        relabeled.append([named("urn:new"), named("urn:witness"), literal("new fact")])
        self.assertNotEqual(before, canonical_graph(relabeled)["graph_sha256"])


class LedgerTests(unittest.TestCase):
    def make(self):
        ledger = new_ledger()
        for n in range(3):
            ledger = append_record(ledger, instrument={"name": "test", "version": 1}, claim=f"claim {n}", evidence={"observed": n})
        return ledger

    def test_instruments_deduplicate_and_chain_verifies(self):
        ledger = self.make()
        self.assertEqual(len(ledger["instruments"]), 1)
        result = verify_ledger(ledger)
        self.assertTrue(result["valid"])
        anchored = verify_ledger(ledger, expected_head=result["head"], expected_length=result["length"])
        self.assertTrue(anchored["completeness_anchored"])
        self.assertFalse(anchored["authenticity_verified"])

    def test_claim_tampering_is_detected(self):
        ledger = self.make(); ledger["records"][1]["claim"] = "changed"
        self.assertFalse(verify_ledger(ledger)["valid"])
        with self.assertRaises(ValueError): append_record(ledger, instrument={}, claim="new", evidence={})

    def test_instrument_tampering_is_detected(self):
        ledger = self.make(); next(iter(ledger["instruments"].values()))["version"] = 2
        self.assertFalse(verify_ledger(ledger)["valid"])

    def test_truncation_requires_an_external_anchor(self):
        ledger = self.make(); prior = verify_ledger(ledger); ledger["records"].pop()
        self.assertTrue(verify_ledger(ledger)["valid"])
        rejected = verify_ledger(ledger, expected_head=prior["head"], expected_length=3)
        self.assertFalse(rejected["valid"])
        self.assertTrue(rejected["external_anchor_supplied"])
        self.assertFalse(rejected["completeness_anchored"])

    def test_append_does_not_mutate_earlier_evidence(self):
        ledger = new_ledger(); before = copy.deepcopy(ledger)
        new = append_record(ledger, instrument={}, claim="claim", evidence={"x": [1]})
        self.assertEqual(ledger, before)
        self.assertEqual(len(new["records"]), 1)

    def test_nonfinite_json_is_refused(self):
        with self.assertRaises(ValueError): append_record(new_ledger(), instrument={}, claim="bad", evidence={"x": float("nan")})

    def test_malformed_envelope_is_reported_without_crashing(self):
        ledger = self.make(); ledger["records"][0]["instrument"] = {}
        self.assertFalse(verify_ledger(ledger)["valid"])
        ledger = self.make(); ledger["records"][0]["sequence"] = False
        self.assertFalse(verify_ledger(ledger)["valid"])


if __name__ == "__main__": unittest.main()
