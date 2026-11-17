"""Scene structure and reproducible-bake regressions; not an XSD or render gate."""
from pathlib import Path
import hashlib
import json
import math
import subprocess
import sys
import tempfile
import shutil
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_BINARY_SHA256 = '98389c543c949e5f29ad391dd1c271e1bfcf2ddff2eb905983313e44c08de028'
ORIGINAL_VIEWS = {'V_Overview','V_Sunrise','V_Osiris','V_ChamberB','V_Depth','V_Anomaly','V_Hall','V_HallInside','V_Khafre','V_Khufu','V_Orion','V_Top'}
GENERATED = ('giza-atlas-v3.x3d','states.bin','states.json','tour.json','const.json','clusters.json')

class SceneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.xml = ET.parse(ROOT / GENERATED[0]).getroot()
        cls.nodes = list(cls.xml.iter())
        cls.named = {n.attrib['DEF']:n for n in cls.nodes if 'DEF' in n.attrib}
        cls.parents = {child:parent for parent in cls.nodes for child in parent}
        cls.states = json.loads((ROOT/'states.json').read_text())
        cls.tour = json.loads((ROOT/'tour.json').read_text())

    def test_rebuild_is_byte_identical_using_shipped_bake_caches(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run([sys.executable,str(ROOT/'build/build_scene2.py'),d],check=True,capture_output=True,timeout=30)
            for name in GENERATED:
                self.assertEqual((ROOT/name).read_bytes(),(Path(d)/name).read_bytes(),name)

    def test_mismatched_bake_cache_refuses_to_publish_a_scene(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);build=folder/'build';build.mkdir();out=folder/'out'
            for name in ['build_scene2.py','geo.py','x3dlib.py','stars_v2.json','light_sunrise.json','light_midday.json','light_afternoon.json']:
                shutil.copyfile(ROOT/'build'/name,build/name)
            light=json.loads((build/'light_sunrise.json').read_text())
            light['light']['khufu'].pop()
            (build/'light_sunrise.json').write_text(json.dumps(light))
            run=subprocess.run([sys.executable,str(build/'build_scene2.py'),str(out)],capture_output=True,text=True,timeout=30)
            self.assertNotEqual(run.returncode,0)
            self.assertIn('cached bake vertex count mismatch: khufu',run.stderr)
            self.assertFalse((out/'giza-atlas-v3.x3d').exists())
            self.assertFalse((out/'states.bin').exists())

    def test_unique_definitions_and_resolved_use_and_routes(self):
        definitions = [n.attrib['DEF'] for n in self.nodes if 'DEF' in n.attrib]
        self.assertEqual(len(definitions),len(set(definitions)))
        seen = set()
        for n in self.nodes:
            if 'USE' in n.attrib:self.assertIn(n.attrib['USE'],seen)
            if 'DEF' in n.attrib:seen.add(n.attrib['DEF'])
            if n.tag=='ROUTE':
                self.assertIn(n.attrib['fromNode'],self.named)
                self.assertIn(n.attrib['toNode'],self.named)

    def test_finite_coordinates_and_valid_geometry_indices(self):
        for n in self.nodes:
            if n.tag=='Coordinate':
                values=[float(x) for x in n.attrib.get('point','').split()]
                self.assertEqual(len(values)%3,0)
                self.assertTrue(all(math.isfinite(x) for x in values))
            if n.tag in ('IndexedFaceSet','IndexedLineSet'):
                c=n.find('Coordinate')
                self.assertIsNotNone(c)
                if 'USE' in c.attrib:c=self.named[c.attrib['USE']]
                count=len(c.attrib['point'].split())//3
                for i in map(int,n.attrib.get('coordIndex','').split()):self.assertTrue(i==-1 or 0<=i<count)

    def test_vertex_colour_binary_contract_retained_exactly(self):
        data=(ROOT/'states.bin').read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(),ORIGINAL_BINARY_SHA256)
        expected=len(self.states['states'])*sum(m['n']*3 for m in self.states['meshes'])
        self.assertEqual(len(data),expected)
        self.assertEqual(self.states['bytes'],expected)
        for mesh in self.states['meshes']:
            self.assertEqual(len(self.named['C_'+mesh['name']].attrib['point'].split()),mesh['n']*3)
            self.assertEqual(len(self.named['K_'+mesh['name']].attrib['color'].split()),mesh['n']*3)

    def test_clip_plane_scope_excludes_sky_and_annotations(self):
        scope=self.named['SECTION_WORLD'];descendants=set(scope.iter())
        clip=self.named['CLIP_SECTION'];self.assertIn(clip,descendants)
        self.assertEqual(clip.attrib['enabled'],'false')
        a,b,c,d=map(float,clip.attrib['plane'].split())
        self.assertAlmostEqual(a*a+b*b+c*c,1)
        self.assertEqual(d,-28)
        for name in ['SW_SURFACE','SW_DOC','SW_THE','SW_SPE']:self.assertIn(self.named[name],descendants)
        for name in ['SkyRig','SW_SURVEY','SW_SCALE']:
            self.assertNotIn(self.named[name],descendants)
        for name,node in self.named.items():
            if name.startswith('LB_'):self.assertNotIn(node,descendants)
        rendering=self.xml.find("head/component[@name='Rendering']")
        self.assertIsNotNone(rendering);self.assertEqual(rendering.attrib['level'],'5')

    def test_instruments_are_optional_and_theatre_states_its_limits(self):
        for name in ['SW_SURVEY','SW_SCALE']:self.assertEqual(self.named[name].attrib['whichChoice'],'-1')
        survey=ET.tostring(self.named['SW_SURVEY'],encoding='unicode')
        theatre=ET.tostring(self.named['SW_SCALE'],encoding='unicode')
        self.assertIn('MODEL DATUM',survey)
        self.assertIn('schematic horizontal layout',survey)
        self.assertIn('UNVERIFIED CLAIM',theatre)
        self.assertIn('independent source quantities and datums',theatre)
        self.assertIn('No linked tunnel or shared geological datum',theatre)

    def test_original_views_tour_and_new_instrument_views(self):
        views={v['id'] for v in self.tour['views']}
        self.assertTrue(ORIGINAL_VIEWS<=views)
        self.assertTrue({'V_Survey','V_DepthCompare','V_HallDetail','V_Section'}<=views)
        for view in views:self.assertEqual(self.named[view].tag,'Viewpoint')
        self.assertEqual(self.tour['duration'],68)
        times=[s['t'] for s in self.tour['stops']]
        self.assertEqual(times,sorted(set(times)))
        self.assertEqual(times[-1],self.tour['duration'])

if __name__=='__main__':unittest.main()
