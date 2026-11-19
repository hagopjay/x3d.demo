#!/usr/bin/env python3
"""Builds docs/demos/x3d-coverage/v1/index.html + img/ from: data.json (gen.py), the three.js re-run (run.jsonl + shots/)."""
import json,os,sys,html,collections
from PIL import Image
OUT=sys.argv[1]; SH='/tmp/tjn/shots'
D=json.load(open('data.json'))
run={}
for line in open('/tmp/tjn/run.jsonl'):
    line=line.strip()
    if line: run.update(json.loads(line)['results'])
# re-run numbers per node
for r in D:
    q=run.get(r['n'])
    r['rerun']=None
    if q:
        vis=q.get('visual') or {}
        r['rerun']={'ok':q.get('ok'),'iou':min([s['iou'] for s in vis.values()],default=None),'psnr':min([s['psnr'] for s in vis.values()],default=None),'cmp':q.get('comparison')}
os.makedirs(OUT+'/img',exist_ok=True)
C=collections.Counter
tc=C(r['t'] for r in D); bc=C(r['b'] for r in D)
rer=[r for r in D if r['rerun']]
def kind(r):
    q=run[r['n']]
    return 'ok' if q.get('ok') else ('ride' if 'missing fixture' in str(q.get('msg','')) else 'fail')
rer_ok=sum(1 for r in rer if kind(r)=='ok'); rer_ride=sum(1 for r in rer if kind(r)=='ride'); rer_fail=[r['n'] for r in rer if kind(r)=='fail']
RERUNTXT=f'{len(rer)} drawn-status nodes run: {rer_ok} passed their own fixture, {rer_ride} have no fixture of their own (they ride along inside other nodes\' fixtures), {len(rer_fail)} failed ({", ".join(rer_fail) or "none"}).'
# gallery
pick=['Sphere','SpotLight','Fog','ImageTexture','Extrusion','TexturedPrimitives','Background','ElevationGrid','Billboard','Text','PhysicalMaterial','Arc2D']
def step(n):
    c=[f for f in os.listdir(SH) if f.startswith(n+'.') and f.endswith('.ours.png')]
    c.sort(key=lambda f:(0 if '.main.' in f else 1,f)); return c[0].split('.')[1] if c else None
gal=[]
for n in pick:
    s=step(n)
    if not s or not os.path.exists(f'{SH}/{n}.{s}.xite.png'): continue
    a=Image.open(f'{SH}/{n}.{s}.xite.png').convert('RGB'); b=Image.open(f'{SH}/{n}.{s}.ours.png').convert('RGB')
    w,h=a.size; im=Image.new('RGB',(w*2+4,h),(20,26,36)); im.paste(a,(0,0)); im.paste(b,(w+4,0))
    im=im.resize((im.width*2,im.height*2),Image.LANCZOS); im.save(f'{OUT}/img/pair-{n}.jpg',quality=86)
    r=[x for x in D if x['n']==n][0]; gal.append((n,s,r))
# hero strip: 6 three.js renders
strip=[n for n in ['Sphere','SpotLight','Fog','Extrusion','TexturedPrimitives','ElevationGrid'] if os.path.exists(f'{SH}/{n}.{step(n)}.ours.png')]
tiles=[Image.open(f'{SH}/{n}.{step(n)}.ours.png').convert('RGB') for n in strip]
w,h=tiles[0].size; hs=Image.new('RGB',(w*len(tiles),h)); 
for i,t in enumerate(tiles): hs.paste(t,(i*w,0))
hs=hs.resize((hs.width*2,hs.height*2),Image.LANCZOS); hs.save(OUT+'/img/hero-strip.jpg',quality=86)
E_=lambda s:html.escape(str(s))
comps=collections.OrderedDict()
for r in sorted(D,key=lambda r:(r['c'],r['l'],r['n'])): comps.setdefault(r['c'],[]).append(r)
TH={'drawn':('drawn','t-drawn'),'reader-checked':('checked','t-chk'),'reader':('reader','t-rdr'),'todo':('todo','t-todo'),'upstream':('waits','t-up')}
BB={'bridged':('bridged','b-ok'),'gap':('bridged + gap','b-gap'),'base':('baseline','b-base')}
def row(r):
    t,tc_=TH[r['t']]; b,bc_=BB[r['b']]
    iou=''
    rr=r['rerun']
    if rr and rr['psnr'] is not None: iou=f' <i>{rr["psnr"]:.0f} dB</i>'
    elif r.get('psnr') is not None: iou=f' <i>{r["psnr"]:.0f} dB</i>'
    x='<td class="c x-ok" title="registered in X_ITE 16.6.0">●</td>' if r['x'] else '<td class="c x-no" title="not registered in X_ITE 16.6.0">○</td>'
    bl=('W' if r['bw'] else '')+('R' if r['br'] else '')
    blc='<td class="c bl%s" title="name found in exporter source (W) / importer source (R); Suspected">%s</td>'%(' bl-on' if bl else '',bl or '·')
    cs='<td class="c ca%s" title="scenes among the 70 scout scenes that use it and drew pixels / that use it">%s</td>'%(' ca-on' if r['cs'] else '',('%d/%d'%(r['co'],r['cs'])) if r['cs'] else '·')
    if r['cg']: cs=cs.replace('</td>',' <b title="named in the Castle gap table">!</b></td>')
    f=' '.join(['x'+('1' if r['x'] else '0'),'t-'+r['t'],'b-'+r['b']])
    return f'<tr data-f="{f}" data-n="{E_(r["n"].lower())}"><th scope="row">{E_(r["n"])}<small>L{r["l"]}</small></th>{x}<td class="c {tc_}">{t}{iou}</td><td class="c {bc_}">{b}</td>{blc}{cs}</tr>'
tbl=''
for c,rs in comps.items():
    n3=sum(1 for r in rs if r['t'] in('drawn','reader-checked','reader'))
    tbl+=f'<tbody><tr class="comp"><th colspan="6">{E_(c)} <span>{len(rs)} nodes · three.js {n3}/{len(rs)}</span></th></tr>'+''.join(row(r) for r in rs)+'</tbody>'
xn=sum(r['x'] for r in D)
bw=sum(r['bw'] for r in D); br=sum(r['br'] for r in D); co=sum(1 for r in D if r['co']); cg=sum(1 for r in D if r['cg'])
def bar(parts):
    tot=sum(v for _,v,_ in parts)
    return '<div class="bar">'+''.join(f'<span class="{c}" style="flex:{v}" title="{E_(l)}: {v}"></span>' for l,v,c in parts if v)+'</div><div class="leg">'+''.join(f'<span><i class="{c}"></i>{E_(l)} <b>{v}</b></span>' for l,v,c in parts if v)+'</div>'
cards=[
 ('X_ITE 16.6.0','The reference browser',f'{xn}<small>/260</small>',bar([('node type registered',xn,'t-drawn'),('missing (ProtoInstance)',260-xn,'t-todo')]),'Confirmed','My probe: load every component, ask for each of the 260 concrete node names. Registered is not the same as correct; X_ITE is the reference the other bridges are measured against.'),
 ('three.js bridge','x3d.loom, three r187',f'{tc["drawn"]+tc["reader-checked"]}<small>/260 tested</small>',bar([('drawn, compared with X_ITE',tc['drawn'],'t-drawn'),('event node, checked in both',tc['reader-checked'],'t-chk'),('reader only, not re-run',tc['reader'],'t-rdr'),('not built yet',tc['todo'],'t-todo'),('waits on Babylon bridge',tc['upstream'],'t-up')]),'Confirmed (re-run)',f'I re-ran the fixtures here: {RERUNTXT} Drawn means a picture was scored against X_ITE; the 41 reader-only nodes are engine-free and were not re-run.'),
 ('Babylon bridge','x3d.webgpu, Babylon 9.32',f'260<small>/260 read</small>',bar([('baseline reader',bc['base'],'b-base'),('bridged',bc['bridged'],'b-ok'),('bridged with a logged gap',bc['gap'],'b-gap')]),'Likely','The tracker says the reader knows all 260 and 192 were bridged with a test against X_ITE; I read its NODES.json and did not re-run Babylon here.'),
 ('Castle Game Engine','x3d.castle scout',f'{co}<small> node types drawn</small>',bar([('seen in the 70 scout scenes and drew pixels',co,'t-drawn'),('not exercised',260-co,'t-todo')]),'Likely','No per-node table exists. This counts node names inside the 70 demo scenes the scout rendered, with exit 0 and visible pixels; 20 gaps are logged separately, '+str(cg)+' of them name a node type.'),
 ('Blender I/O','x3d-blender-io 5.x',f'{bw}<small> written · {br} read</small>',bar([('name in exporter',bw,'t-chk'),('name in importer only',max(0,br-bw),'t-rdr')]),'Suspected','No per-node table exists. This is a word match of the 260 names against the exporter and importer source; a word match can miss a node handled generically and can hit one that is only mentioned.'),
]
cardhtml=''.join(f'<article class="eng"><h3>{E_(a)}</h3><p class="sub">{E_(b)}</p><div class="big">{c}</div>{d}<p class="how"><span class="g g-{E_(e.split()[0].lower())}">{E_(e)}</span> {E_(f)}</p></article>' for a,b,c,d,e,f in cards)
galhtml=''
for n,s,r in gal:
    rr=r['rerun'] or {}
    m=''
    if rr.get('psnr') is not None: m=f'overlap {rr["iou"]:.2f} · {rr["psnr"]:.1f} dB'
    note={'Text':'Boxes match, letter shapes do not: the weak spot, kept on purpose.','PhysicalMaterial':'X_ITE adds a default environment glow three.js lacks; reference only.'}.get(n,'')
    galhtml+=f'<figure><div class="pr"><img src="img/pair-{E_(n)}.jpg" alt="{E_(n)}: X_ITE on the left, three.js bridge on the right" width="1288" height="480" loading="lazy"><b>X_ITE 16.6.0</b><b>three.js r187</b></div><figcaption><b>{E_(n)}</b><span>{m}</span><em>{E_(note)}</em></figcaption></figure>'
page=open('template.html').read()
page=page.replace('%%CARDS%%',cardhtml).replace('%%GALLERY%%',galhtml).replace('%%TABLE%%',tbl).replace('%%RERUNTXT%%',RERUNTXT)
open(OUT+'/index.html','w').write(page)
json.dump({'rerun':len(rer),'ok':rer_ok,'ride_along':rer_ride,'failed':rer_fail,'x':xn,'three':dict(tc),'babylon':dict(bc),'castle_exercised':co,'castle_gap_nodes':cg,'blender_write':bw,'blender_read':br,'gallery':[g[0] for g in gal]},open(OUT+'/receipts-summary.json','w'),indent=1)
print(len(rer),rer_ok,gal and [g[0] for g in gal])
