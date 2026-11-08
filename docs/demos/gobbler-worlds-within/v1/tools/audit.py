#!/usr/bin/env python3
from pathlib import Path
import gzip,json,hashlib,subprocess,sys,base64
ROOT=Path(__file__).resolve().parents[1]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
checks=[]
for command in [[sys.executable,'tests/semantic.py'],[sys.executable,'tests/server.py'],[sys.executable,'tests/radiance.py'],['node','tests/stream.cjs'],['node','tests/profiler.cjs']]:
 r=subprocess.run(command,cwd=ROOT,text=True,capture_output=True);checks.append({'command':command,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
files=['data/bird/bird.b64.txt','data/bird/bird.x3d.gz','data/bird/graph.b64.txt','data/bird/graph.json.gz','data/worlds/pantheon/pantheon.x3d','data/worlds/giza/sphinx-today-mesh-v21.xml','vendor/x_ite/x_ite.min.js']
transport=[]
for f in files:
 p=ROOT/f;b=p.read_bytes();c=b if p.suffix=='.gz' else gzip.compress(b,compresslevel=6,mtime=0)
 transport.append({'file':f,'source_bytes':len(b),'server_transfer_bytes':len(c),'sha256':digest(p),'method':'identity .gz' if p.suffix=='.gz' else 'HTTP Content-Encoding gzip level 6'})
legacy=json.loads((ROOT/'data/bird/receipt.json').read_text());source=(ROOT/'source/bird.x3d').read_bytes()
result={'schema':'gobbler.audit/1','passed':all(c['exit']==0 for c in checks),'checks':checks,'transport':transport,'legacy_receipt':{'actual_source_sha256':hashlib.sha256(source).hexdigest(),'actual_source_bytes':len(source),'historical_scene_sha256':legacy.get('scene_sha256'),'historical_scene_bytes':legacy.get('scene_bytes'),'binding_matches':legacy.get('scene_sha256')==hashlib.sha256(source).hexdigest()},'bound_scene':json.loads((ROOT/'evidence/build.json').read_text())['scene_sha256']}
(ROOT/'evidence/audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':result['passed'],'checks':len(checks),'legacy_receipt_matches':result['legacy_receipt']['binding_matches'],'transport':transport},indent=2));sys.exit(0 if result['passed'] else 1)
