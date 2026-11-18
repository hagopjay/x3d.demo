"""Check generated X3D variants and relative deployment URLs without WebGL."""
import json, pathlib, subprocess, unittest, xml.etree.ElementTree as ET
from html.parser import HTMLParser
ROOT = pathlib.Path(__file__).resolve().parents[1]
class HTML(HTMLParser):
    def __init__(self): super().__init__(); self.urls=[]; self.base=''
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='base': self.base=a['href']
        if tag in ('script','link','x3d-canvas'): self.urls.append(a.get('src',a.get('href','')))
class Checks(unittest.TestCase):
    def variants(self):
        script="""import {hawaraScene,chapters} from './hawara.mjs';console.log(JSON.stringify({chapters,scenes:['plan','section','oblique'].flatMap(view=>[false,true].map(lower=>({view,lower,xml:hawaraScene({view,lower,depth:-70})})))}));"""
        return json.loads(subprocess.check_output(['node','--input-type=module','-e',script],cwd=ROOT))
    def test_geometry_and_evidence_separation(self):
        data=self.variants()
        for s in data['scenes']:
            root=ET.fromstring(s['xml'])
            self.assertEqual(len(root.findall('.//Cylinder')),120)
            self.assertEqual(len(root.findall('.//ClipPlane')),int(s['view']=='section'))
            lower_switch=root.find(".//Switch[@DEF='H_LowerSwitch']")
            self.assertEqual(lower_switch.get('whichChoice'),'0' if s['lower'] else '-1')
            self.assertEqual(len(lower_switch.findall('.//Box')),48)
            self.assertEqual(root.find(".//Material[@DEF='H_Floor']").get('transparency'),'0.75' if s['lower'] else '0')
            self.assertEqual(len(root.findall('.//OrthoViewpoint')),int(s['view']!='oblique'))
            defs=[n.get('DEF') for n in root.iter() if n.get('DEF')]
            self.assertEqual(len(defs),len(set(defs)))
    def test_sources_and_deployment(self):
        data=self.variants();self.assertEqual(len(data['chapters']),7)
        for c in data['chapters']:
            self.assertTrue(c['url'].startswith('https://'));self.assertTrue(c['tier'])
        html=HTML();html.feed((ROOT/'index.html').read_text())
        for url in html.urls:self.assertTrue((ROOT/html.base/url).resolve().is_file(),url)
        source=(ROOT/'witness.js').read_text();self.assertIn('giza-atlas-v3.x3d',source)
        scene=ET.parse(ROOT/'../v3/giza-atlas-v3.x3d');defs={n.get('DEF') for n in scene.iter()}
        for name in ['V_Osiris','V_Khufu','V_Section','CLIP_SECTION','M_ground','SW_SPE','SW_SKY','SW_CONST','SW_ORION','SW_GAZE']:
            self.assertIn(name,defs)
if __name__=='__main__':unittest.main()
