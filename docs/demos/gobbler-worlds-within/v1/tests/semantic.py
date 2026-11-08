from pathlib import Path
from lxml import etree as E
import gzip,hashlib,json,re,unittest,sys
ROOT=Path(__file__).resolve().parents[1]
def inspect(xml,receipt):
 errors=[]
 if hashlib.sha256(xml).hexdigest()!=receipt['scene_sha256']:errors.append('G-ID: receipt hash mismatch')
 r=E.fromstring(xml);defs={};seen=set();inline={x.get('DEF') for x in r.iter('Inline')}
 for n in r.iter():
  if n.get('USE') and set(n.attrib)-{'USE','containerField'}:errors.append('G-USE: attributes on USE')
  d=n.get('DEF')
  if d:
   if d in seen:errors.append('G-DEF: duplicate '+d)
   seen.add(d);defs[d]=n
  if n.tag=='ROUTE' and n.get('toNode') in inline and n.get('toField') in ('load','set_load'):errors.append('G-OWN: dual load writer')
  if n.tag=='ShaderPart':
   for m in re.finditer(r'smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,',n.text or ''):
    if float(m[1])>=float(m[2]):errors.append('G-GLSL: unordered smoothstep')
  if n.tag=='IndexedFaceSet':
   faces=[f.split() for f in n.get('coordIndex','').split('-1') if f.strip()]
   if any(len(set(f))<3 for f in faces) and n.find('Tangent') is None:errors.append('G-RIBBON: missing explicit basis')
  if n.tag=='HAnimJoint' and n.get('name') in ('l_wrist','r_wrist','l_ankle','r_ankle'):errors.append('G-HANIM: legacy joint name')
 if len(list(r.iter('Shape')))!=receipt['source_shapes']:errors.append('G-DENSITY: shape count changed')
 return errors
class Gates(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.xml=gzip.decompress((ROOT/'data/bird/bird.x3d.gz').read_bytes());cls.receipt=json.loads((ROOT/'evidence/build.json').read_text())
 def test_current(self):self.assertEqual(inspect(self.xml,self.receipt),[])
 def test_ribbon(self):
  r=E.fromstring(self.xml);n=next(r.iter('Tangent'));n.getparent().remove(n);self.assertTrue(any('G-RIBBON' in e for e in inspect(E.tostring(r),self.receipt)))
 def test_use_attributes(self):
  x=self.xml.replace(b'USE="LineShader"',b'USE="LineShader" language="GLSL"',1);self.assertTrue(any('G-USE' in e for e in inspect(x,self.receipt)))
 def test_experimental_header(self):
  self.assertNotIn(b'x3d-4.0.xsd',self.xml);self.assertNotIn(b'<!DOCTYPE',self.xml)
 def test_geometry_exact(self):
  src=E.parse(str(ROOT/'source/bird.x3d'));out=E.fromstring(self.xml)
  for tag,field in [('Coordinate','point'),('IndexedFaceSet','coordIndex'),('IndexedTriangleSet','index'),('ColorRGBA','color')]:self.assertEqual([x.get(field) for x in src.iter(tag)],[x.get(field) for x in out.iter(tag)],tag+' source geometry changed')
 def test_stale(self):self.assertTrue(any('G-ID' in x for x in inspect(self.xml+b' ',self.receipt)))
 def test_reversed_smoothstep(self):self.assertTrue(any('G-GLSL' in x for x in inspect(self.xml.replace(b'smoothstep(-0.2, 0.0, edge)',b'smoothstep(0.0, -0.2, edge)'),self.receipt)))
 def test_dual_owner(self):x=self.xml.replace(b'</Scene>',b'<ROUTE fromNode="GizaSense" fromField="isActive" toNode="GizaInline" toField="load"/></Scene>');self.assertTrue(any('G-OWN' in e for e in inspect(x,self.receipt)))
 def test_density(self):r=E.fromstring(self.xml);shape=next(r.iter('Shape'));shape.getparent().remove(shape);self.assertTrue(any('G-DENSITY' in e for e in inspect(E.tostring(r),self.receipt)))
 def test_hanim(self):x=self.xml.replace(b'name="l_radiocarpal"',b'name="l_wrist"');self.assertTrue(any('G-HANIM' in e for e in inspect(x,self.receipt)))
if __name__=='__main__':unittest.main()
