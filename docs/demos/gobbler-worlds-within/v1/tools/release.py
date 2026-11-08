"""Bind executable content independently from evidence; exact file-list witness detects additions too."""
from pathlib import Path
import hashlib,json,sys
ROOT=Path(__file__).resolve().parents[1]
def manifest():
 paths=[ROOT/'index.html',ROOT/'serve.py']
 for folder in ['src','engine','vendor','data','assets']:paths.extend(p for p in (ROOT/folder).rglob('*') if p.is_file())
 return {p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}
def signature(files):return hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()
if __name__=='__main__':
 files=manifest();out=ROOT/'evidence/candidate.json'
 if '--check' in sys.argv:
  r=json.loads(out.read_text());assert r['files']==files,'Executable files differ from candidate';assert r['candidate_sha256']==signature(files);print('Candidate verified:',r['candidate_sha256'])
 else:
  r={'schema':'gobbler.candidate/1','candidate_sha256':signature(files),'files':files,'scope':'All executable entry points, scene/assets, vendor runtime and server. Documentation, source input copies, tools, tests and evidence excluded to avoid self-reference.'};out.write_text(json.dumps(r,indent=2)+'\n');print(r['candidate_sha256'])
