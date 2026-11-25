import json,sys,time,urllib.request,os,io,hashlib
from PIL import Image
D=sys.argv[1]; OUT=sys.argv[2]; P=json.load(open(D))
UA="x3d-art-slice/1.0 (research demo; https://github.com/hagopjay/x3d.demo)"
log=[]
for p in P['paintings']:
    dst=os.path.join(OUT,p['file'])
    if os.path.exists(dst): continue
    for t in range(5):
        try:
            b=urllib.request.urlopen(urllib.request.Request(p['thumb'],headers={"User-Agent":UA}),timeout=60).read(); break
        except Exception as e:
            print('retry',p['id'],e,flush=True); time.sleep(6*(t+1)); b=None
    if not b: log.append([p['id'],'FAILED']); continue
    im=Image.open(io.BytesIO(b)).convert('RGB'); im.thumbnail((1280,1280),Image.LANCZOS)
    im.save(dst,'JPEG',quality=85,optimize=True,progressive=True)
    p['px']=list(im.size); p['src_sha256']=hashlib.sha256(b).hexdigest()
    print('ok',p['id'],im.size,os.path.getsize(dst),flush=True); time.sleep(1.5)
json.dump(P,open(D,'w'),ensure_ascii=False,indent=1); print('fails',log)
