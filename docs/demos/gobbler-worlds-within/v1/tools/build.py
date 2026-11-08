#!/usr/bin/env python3
"""Deterministic scene transforms and numerical studio-light bake; no upstream sources invented."""
from pathlib import Path
import base64,gzip,hashlib,json,re,math
from lxml import etree as E
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sha=lambda b:hashlib.sha256(b).hexdigest()
from radiance import bake
bake_receipt=bake(ROOT/'assets/baked')
# Mathematically derived silver/gold micro-surface relief, no generative-image provenance.
y,x=np.mgrid[0:256,0:256];height=.5+.19*np.sin(x*.34+np.sin(y*.07)*.7)+.08*np.sin(x*1.7+y*.13)
Image.fromarray(np.uint8(np.clip(height,0,1)*255)).save(ROOT/'assets/baked/brushed-height.png')
parser=E.XMLParser(remove_blank_text=False,strip_cdata=False)
r=E.parse(str(ROOT/'source/bird.x3d'),parser)
# The application owns interpolation; prevent a second bind-time camera animator.
for n in r.iter('NavigationInfo'):n.set('transitionType','"TELEPORT"');n.set('transitionTime','0')
# Streaming has one owner. Visibility and animation routes stay intact.
controlled={x.get('DEF') for x in r.iter('Inline') if x.get('DEF')}
removed=[]
for x in list(r.iter('ROUTE')):
 if x.get('toNode') in controlled and x.get('toField') in ('load','set_load'):
  removed.append(dict(x.attrib));x.getparent().remove(x)
for x in r.iter('Inline'):
 if x.get('DEF') in controlled:x.set('load','false')
for x in r.iter('HAnimJoint'):
 name=x.get('name');
 if name is None:continue
 x.set('name',{'l_wrist':'l_radiocarpal','r_wrist':'r_radiocarpal','l_ankle':'l_talocrural','r_ankle':'r_talocrural'}.get(name,name))
shader=next(x for x in r.iter('ComposedShader') if x.get('DEF')=='FacetShader')
for name,typ,val in [('studioMix','SFFloat','0.72'),('roughness','SFFloat','0.32')]:E.SubElement(shader,'field',name=name,type=typ,accessType='inputOutput',value=val)
f=E.SubElement(shader,'field',name='studioMap',type='SFNode',accessType='initializeOnly');tex=E.SubElement(f,'ImageTexture',url='"assets/baked/studio-rgbm.png"',repeatS='true',repeatT='false');E.SubElement(tex,'TextureProperties',generateMipMaps='false',minificationFilter='AVG_PIXEL',magnificationFilter='AVG_PIXEL')
f=E.SubElement(shader,'field',name='surfaceMap',type='SFNode',accessType='initializeOnly');E.SubElement(f,'ImageTexture',url='"assets/baked/brushed-height.png"')
for part in shader.findall('ShaderPart'):
 if part.get('type')!='FRAGMENT':continue
 s=part.text.replace('smoothstep(0.0, -0.2, edge)','(1.0 - smoothstep(-0.2, 0.0, edge))').replace('smoothstep(0.13, 0.05, edge)','(1.0 - smoothstep(0.05, 0.13, edge))')
 s=s.replace('uniform float phase;', 'uniform float phase;\nuniform float studioMix;\nuniform float roughness;\nuniform sampler2D studioMap;\nuniform sampler2D surfaceMap;')
 s=s.replace('void main() {', '''vec3 studioSample(vec2 uv,float row){vec4 e=texture(studioMap,vec2(uv.x,(row*130.0+1.5+uv.y*127.0)/780.0));return e.rgb*e.a*8.0;}
void main() {''')
 s=s.replace('vec3 metal = F * env;', '''// Explicit RGBM decode: texture data is linear; this is a stylized studio reflection.
  vec2 uv = vec2(atan(R.z,R.x) / 6.28318530718 + 0.5, acos(clamp(R.y,-1.0,1.0)) / 3.14159265359);
  float level=clamp(roughness,0.0,1.0)*5.0;
  vec3 baked=mix(studioSample(uv,floor(level)),studioSample(uv,min(5.0,floor(level)+1.0)),fract(level));
  float brushed = texture(surfaceMap,vObj.xy*1.8).r;
  env = mix(env,baked * (0.92+0.12*brushed),studioMix);
  vec3 metal = F * env;''')
 s=s.replace('glint * 1.5 + flash * 1.3','glint * 0.8 + flash * 0.35').replace('lit * 0.5','lit * 0.35')
 part.text=E.CDATA(s)
# Shader-expanded ribbons are intentionally zero-area before vertex execution.
# MikkTSpace cannot infer their surface basis. Explicit neutral tangents bypass it;
# LineShader does not consume tangent attributes. Rendering 5 is declared honestly.
r.getroot().set('version','4.1')
r.getroot().attrib.pop('{http://www.w3.org/2001/XMLSchema-instance}noNamespaceSchemaLocation',None)
E.SubElement(r.getroot().find('head'),'component',name='Rendering',level='5')
ribbons=0
for n in r.iter('IndexedFaceSet'):
 faces=[list(map(int,f.split())) for f in n.get('coordIndex','').split('-1') if f.strip()]
 if any(len(set(f))<3 for f in faces):
  sh=n.getparent().find('Appearance/ComposedShader')
  assert sh is not None and (sh.get('DEF')=='LineShader' or sh.get('USE')=='LineShader'), 'Unclassified degenerate mesh'
  normal=n.find('Normal');vectors=list(map(float,normal.get('vector','').split())) if normal is not None else [0,0,1]
  tangents=[]
  for j in range(0,len(vectors),3):
   v=np.array(vectors[j:j+3]);v=v/max(np.linalg.norm(v),1e-12);axis=np.array([1.,0,0]) if abs(v[0])<.9 else np.array([0.,1,0]);t=axis-v*np.dot(axis,v);t=t/max(np.linalg.norm(t),1e-12);tangents.extend([*t,1])
  E.SubElement(n,'Tangent',vector=' '.join(format(v,'.8g') for v in tangents));ribbons+=1
for part in r.iter('ShaderPart'):
 if part.text and 'smoothstep(0.09, 0.02,' in part.text:part.text=E.CDATA(part.text.replace('smoothstep(0.09, 0.02, e)','(1.0 - smoothstep(0.02, 0.09, e))'))
# Keep every shape; give exterior render branches explicit names for scoped traversal culling.
# Individual wrappers are not inserted, so DEF/USE and ROUTE document order is unchanged.
shell=[];scene=r.getroot().find('Scene');loom=next(n for n in r.iter('Transform') if n.get('DEF')=='Loom')
for parent in [scene,loom]:
 for n in parent:
  if n.tag in ('Transform','Shape','Group','Switch') and n.get('DEF') not in ('Loom','Worlds','EarthWorld','PickMarker'):
   if not n.get('DEF'):n.set('DEF','CabinetShell'+str(len(shell)))
   shell.append({'name':n.get('DEF'),'field':'visible','original':n.get('visible','true')=='true'})
  if parent is scene and n.tag in ('PointLight','DirectionalLight','SpotLight'):
   shell.append({'name':n.get('DEF'),'field':'on','original':n.get('on','true')=='true'})
# Coherent warm stone key / cool ambient fill; retain disco as a story-world.
g=E.parse(str(ROOT/'source/giza-nest.x3d'),parser)
for n in g.iter('DirectionalLight'):
 if n.get('DEF')=='DuskSun':n.set('color','1 0.78 0.52');n.set('intensity','1.45');n.set('ambientIntensity','0.08')
 if n.get('DEF')=='NightFill':n.set('color','0.35 0.52 0.8');n.set('intensity','0.42');n.set('ambientIntensity','0.12')
for n in g.iter('PointLight'):
 if n.get('DEF')=='BallLight':n.set('color','1 0.48 0.18');n.set('intensity','1.2')
for n in g.iter('Material'):
 if float(n.get('transparency','0'))>.6:n.set('transparency',str(min(.96,float(n.get('transparency'))+.045)))
palette=['0.88 0.58 0.26','0.23 0.56 0.62','0.76 0.64 0.42','0.43 0.29 0.52','0.62 0.38 0.24']
for n in g.iter('UnlitMaterial'):
 name=n.get('DEF','')
 if name.startswith('Beam'):n.set('transparency','0.965');n.set('emissiveColor',palette[0])
 if name.startswith('Laser'):n.set('transparency','0.48')
 if name=='HaloMat':n.set('transparency','0.94')
for n in g.iter('ColorInterpolator'):
 name=n.get('DEF','')
 if name.endswith('Hue') and name!='HallHue':
  shift=sum(map(ord,name))%5;colors=palette[shift:]+palette[:shift];n.set('keyValue',' '.join(colors+[colors[0]]))
(ROOT/'data/worlds/giza/giza-nest.x3d').write_bytes(E.tostring(g,xml_declaration=True,encoding='UTF-8'))
xml=E.tostring(r.getroot(),xml_declaration=True,encoding='UTF-8')
(ROOT/'data/bird/bird.x3d.gz').write_bytes(gzip.compress(xml,mtime=0))
graph=gzip.decompress(base64.b64decode((ROOT/'data/bird/graph.b64.txt').read_bytes()))
(ROOT/'data/bird/graph.json.gz').write_bytes(gzip.compress(graph,mtime=0))
receipt={'schema':'gobbler.build/1','source_sha256':sha((ROOT/'source/bird.x3d').read_bytes()),'scene_sha256':sha(xml),'scene_bytes':len(xml),'transport_bytes':(ROOT/'data/bird/bird.x3d.gz').stat().st_size,'source_shapes':len(list(E.parse(str(ROOT/'source/bird.x3d')).iter('Shape'))),'output_shapes':len(list(r.iter('Shape'))),'removed_load_routes':removed,'explicit_ribbon_bases':ribbons,'exterior_branches':shell,'profile':'X_ITE 16.5.1 / X3D 4.1 experimental Rendering 5; nested GaussianSplats extension','bakes':bake_receipt,'claim':'Content identity and deterministic build receipt; not an XSD or aesthetic verdict.'}
(ROOT/'evidence/build.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:receipt[k] for k in ['scene_bytes','transport_bytes','source_shapes','output_shapes']}))
