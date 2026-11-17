import hashlib
from pathlib import Path
import unittest

from companion.xml_witness import audit_scene, patch_attribute, SourceError


def sha(source):
    return hashlib.sha256(source).hexdigest()


class WitnessTests(unittest.TestCase):
    def patch(self, source, **overrides):
        args = dict(def_name="M", attribute="diffuseColor", value="0.2 0.3 0.4",
                    expected_sha256=sha(source))
        args.update(overrides)
        return patch_attribute(source, **args)

    def test_preserves_doctype_quotes_newlines_and_other_bytes(self):
        src = (b"<?xml version='1.0' encoding='UTF-8'?>\r\n"
               b"<!DOCTYPE X3D SYSTEM 'https://invalid.example/no-fetch.dtd'>\r\n"
               b"<X3D><Scene><!-- <Material DEF='M'/> -->\r\n"
               b"  <Material  DEF = 'M' diffuseColor = '1 1 1' shininess=\".5\"/>\r\n"
               b"</Scene></X3D>\r\n")
        output, receipt = self.patch(src)
        self.assertEqual(output, src.replace(b"'1 1 1'", b"'0.2 0.3 0.4'"))
        self.assertEqual(receipt["source_sha256"], sha(src))
        self.assertEqual(receipt["output_sha256"], sha(output))
        a, b = receipt["replaced_byte_range"]
        self.assertEqual(src[a:b], b"1 1 1")
        self.assertEqual(receipt["witness"]["xml_path"], "/X3D[1]/Scene[1]/Material[1]")
        self.assertEqual(receipt["witness"]["line"], 4)
        self.assertEqual(receipt["witness"]["column"], 3)
        self.assertTrue(audit_scene(src)["doctype"]["present"])
        self.assertFalse(audit_scene(src)["doctype"]["external_dtd_loaded"])

    def test_source_hash_and_expected_value_guards(self):
        src = b"<X3D><Scene><Material DEF='M' diffuseColor='1 1 1'/></Scene></X3D>"
        with self.assertRaisesRegex(SourceError, "SHA-256"):
            self.patch(src, expected_sha256="0" * 64)
        with self.assertRaisesRegex(SourceError, "decoded XML value"):
            self.patch(src, expected_value="0 0 0")

    def test_unicode_and_quote_escaping(self):
        src = "<X3D><Scene><!-- α♥ --><Material DEF='M' description='old'/></Scene></X3D>".encode()
        output, receipt = self.patch(src, attribute="description", value="Հ ♥ ' & < \n\t\r")
        self.assertIn("Հ ♥ &apos; &amp; &lt; &#10;&#9;&#13;".encode(), output)
        self.assertTrue(audit_scene(output)["clean"])
        self.assertEqual(src[receipt["witness"]["start_byte"]:receipt["witness"]["end_byte"]],
                         b"<Material DEF='M' description='old'/>")

    def test_greater_than_inside_quoted_value_is_not_tag_end(self):
        src = b'<X3D><Scene><Material description="x > y" DEF="M" diffuseColor="1 1 1"/></Scene></X3D>'
        output, _ = self.patch(src)
        self.assertIn(b'description="x > y"', output)
        self.assertIn(b'diffuseColor="0.2 0.3 0.4"', output)

    def test_duplicate_and_missing_def_refused(self):
        src = b"<X3D><Scene><Material DEF='M' diffuseColor='1 1 1'/><Material DEF='M'/></Scene></X3D>"
        self.assertIn("duplicate-def", [f["code"] for f in audit_scene(src)["findings"]])
        with self.assertRaisesRegex(SourceError, "exactly once"):
            self.patch(src)
        with self.assertRaisesRegex(SourceError, "exactly once"):
            self.patch(b"<X3D><Scene/></X3D>")

    def test_existing_attributes_only_and_identity_edits_refused(self):
        src = b"<X3D><Scene><Material DEF='M' diffuseColor='1 1 1'/></Scene></X3D>"
        for attribute in ("DEF", "USE", "xmlns", "xml:base", "not valid"):
            with self.assertRaises(SourceError):
                self.patch(src, attribute=attribute)
        with self.assertRaisesRegex(SourceError, "existing attributes"):
            self.patch(src, attribute="transparency")

    def test_entities_refused_and_invalid_xml_is_not_clean(self):
        for src in (
            b"<!DOCTYPE X3D [<!ENTITY attack 'expanded'>]><X3D/>",
            b"<!DOCTYPE X3D [<!ENTITY attack SYSTEM 'file:///never-read'>]><X3D/>",
            b"<!DOCTYPE X3D [<!ENTITY % attack SYSTEM 'file:///never-read'>%attack;]><X3D/>",
        ):
            out = audit_scene(src)
            self.assertFalse(out["ok"])
            self.assertFalse(out["clean"])
            self.assertEqual(out["findings"][0]["code"], "entity-declaration-refused")
        self.assertFalse(audit_scene(b"<X3D><Scene></X3D>")["ok"])

    def test_encoding_and_xml_characters_refused(self):
        out = audit_scene(b"<?xml version='1.0' encoding='ISO-8859-1'?><X3D/>")
        self.assertEqual(out["findings"][0]["code"], "encoding-unsupported")
        src = b"<X3D><Material DEF='M' diffuseColor='1 1 1'/></X3D>"
        with self.assertRaises(SourceError):
            self.patch(src, value="bad\x00")
        with self.assertRaises(SourceError):
            self.patch(src, value="bad\ud800")

    def test_order_type_routes_and_scope(self):
        src = (b"<X3D><Scene><Material USE='Later'/><Shape DEF='Later'/>"
               b"<Material USE='Missing'/><ROUTE fromNode='Ghost' toNode='Later'/>"
               b"<ProtoDeclare><ProtoBody><Shape DEF='Later'/><Shape USE='Later'/></ProtoBody></ProtoDeclare>"
               b"</Scene></X3D>")
        out = audit_scene(src)
        codes = [f["code"] for f in out["findings"]]
        self.assertTrue(out["ok"])
        self.assertFalse(out["clean"])
        self.assertCountEqual(codes, ["forward-use", "use-type-mismatch", "unresolved-use", "dangling-route"])
        for f in out["findings"]:
            w = f["witness"]
            self.assertEqual(w["source_sha256"], sha(src))
            self.assertTrue(src[w["start_byte"]:w["end_byte"]].startswith(b"<"))

    def test_import_route_alias_is_not_reported_dangling(self):
        src = b"<X3D><Scene><IMPORT importedDEF='External' AS='Alias'/><Transform DEF='T'/><ROUTE fromNode='Alias' toNode='T'/></Scene></X3D>"
        self.assertTrue(audit_scene(src)["clean"])

    def test_resource_bounds(self):
        self.assertEqual(audit_scene(b"<n>" * 257 + b"</n>" * 257)["findings"][0]["code"], "source-too-deep")
        self.assertEqual(audit_scene(b"<X3D a='" + b"a" * 65536 + b"'/>")["findings"][0]["code"], "tag-too-large")

    def test_fixture_faults_and_clean_source(self):
        root = Path(__file__).resolve().parents[1] / "data" / "scenes"
        if not root.exists():
            self.skipTest("study fixtures not installed")
        self.assertTrue(audit_scene((root / "cabinet.xml").read_bytes())["clean"])
        for fault, code in [("F3", "use-type-mismatch"), ("F4", "dangling-route"),
                            ("F6", "forward-use"), ("F7", "duplicate-def")]:
            report = audit_scene((root / f"fault-{fault}.xml").read_bytes())
            self.assertIn(code, [f["code"] for f in report["findings"]], fault)


if __name__ == "__main__":
    unittest.main()
