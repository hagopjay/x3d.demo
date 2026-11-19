import json,re,glob,os,collections
L='/home/user/x3d.loom/x3d.threejs/bridge'
nodes=json.load(open(L+'/NODES.json'))['nodes']
xs=json.load(open('xite.json'))['has']
bab=json.load(open('/home/user/x3d.loom/x3d.webgpu/bridge/NODES.json'))['nodes']
def words(paths):
    t=''
    for p in paths: t+=open(p,errors='ignore').read()
    return set(re.findall(r'[A-Za-z0-9_]+',t))
B='/home/user/x3d-blender-io/source/'
W=words([B+'emit_x3d40.py',B+'export_pipeline.py'])
R=words([B+'import_x3d.py',B+'parse_x3d40.py'])
# Castle: scout-70 scenes (x3d.castle/results/scout-70/matrix.json), a node counts as exercised when a scene using it exits 0 and drew pixels
rows=json.load(open('/home/user/x3d.castle/results/scout-70/matrix.json'))['rows']
cast=collections.defaultdict(lambda:[0,0])
for r in rows:
    p='/home/user/x3d.demo/'+r['scene']
    if not os.path.exists(p): continue
    t=open(p,errors='ignore').read()
    ok=r['render']['exit']==0 and r['render']['stats'].get('non_background_share',0)>0.01
    for n in set(re.findall(r'<([A-Za-z0-9]+)[\s/>]',t)):
        cast[n][0]+=1; cast[n][1]+=1 if ok else 0
gapnames=set(re.findall(r'`([A-Z][A-Za-z0-9]+)`',open('/home/user/x3d.castle/docs/castle-gaps.md').read()))
out=[]
for n,v in nodes.items():
    rec={'n':n,'c':v['component'],'l':v['level'],'t':v['three'],'b':bab[n]['status'],'x':xs[n],
         'bw':n in W,'br':n in R,'cs':cast[n][0],'co':cast[n][1],'cg':n in gapnames}
    rf=L+'/'+v['receipt'] if v.get('receipt') else None
    if rf and os.path.exists(rf):
        d=json.load(open(rf)); vis=d.get('visual') or {}
        if vis:
            rec['iou']=min(s['iou'] for s in vis.values()); rec['psnr']=min(s['psnr'] for s in vis.values()); rec['steps']=len(vis)
        rec['ok']=d.get('ok'); rec['cmp']=d.get('comparison')
    out.append(rec)
json.dump(out,open('data.json','w'))
C=collections.Counter
print(len(out),'scenes seen',len(rows),'castle nodes exercised',sum(1 for r in out if r['co']),'blender writes',sum(r['bw'] for r in out),'reads',sum(r['br'] for r in out),'gapnames hit',sum(r['cg'] for r in out))
print(C(r['t'] for r in out),C(r['b'] for r in out))
print(sum(1 for r in out if 'iou' in r))
