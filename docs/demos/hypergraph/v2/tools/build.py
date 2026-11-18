import sys, os, math, json, random, colorsys
here=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,here)
from data_dsa import NODES as DSA, HE as DHE
from data_eco import ECO, VOL, ENG, HE_ECO, HE_BRIDGE
OUT=os.path.join(here,'..')+'/'
TW={'S':-1.5,'A':-0.75,'B':0,'C':0.75,'D':1.5}; VW={'A':-1.5,'B':-0.75,'C':0,'D':0.75,'E':1.5}
nodes=[]  # id,label,kind,w,color,radius,extra
for n,t in DSA.items(): nodes.append(dict(id=n,kind='dsa',tier=t,w=TW[t]))
for n,(v,r) in ECO.items(): nodes.append(dict(id=n,kind='eco',vol=v,eco=r,w=VW[v]))
for n,t in ENG.items(): nodes.append(dict(id='eng:'+n,label=n,kind='eng',tier=t,w=TW[t]))
def nm(x): return 'eng:'+x if x in ENG else x
hes=[dict(name=n,m=m,layer='dsa') for n,m in DHE]+[dict(name=n,m=[nm(x) for x in m],layer=l) for n,m,l in HE_ECO+HE_BRIDGE]
ids=[n['id'] for n in nodes]; idx={n:i for i,n in enumerate(ids)}
for h in hes:
    for m in h['m']: assert m in idx,(h['name'],m)
rnd=random.Random(20261118)
P={n['id']:[rnd.uniform(-1,1) for _ in range(3)]+[n['w']] for n in nodes}
for it in range(900):
    t=1-it/900;F={n:[0,0,0,0] for n in ids}
    for a in range(len(ids)):
        for b in range(a+1,len(ids)):
            A,B=ids[a],ids[b];d=[P[A][i]-P[B][i] for i in range(4)];r2=sum(x*x for x in d)+0.01;f=3.0/r2
            for i in range(4):F[A][i]+=d[i]*f;F[B][i]-=d[i]*f
    for h in hes:
        k=0.10 if h['layer']!='bridge' else 0.04
        c=[sum(P[n][i] for n in h['m'])/len(h['m']) for i in range(4)]
        for n in h['m']:
            for i in range(4):F[n][i]+=(c[i]-P[n][i])*k
    for n in nodes:
        i_=n['id']
        for i in range(3):P[i_][i]+=max(-.1,min(.1,F[i_][i]*0.05*t))
        P[i_][3]+=(n['w']-P[i_][3])*0.5
m=math.sqrt(sum(P[n][i]**2 for n in ids for i in range(3))/len(ids))/3.4
for n in ids:
    for i in range(3):P[n][i]*=1/m
TC={'S':'0.063 0.725 0.506','A':'0.231 0.510 0.965','B':'0.918 0.702 0.031','C':'0.976 0.451 0.086','D':'0.937 0.267 0.267'}
VC={'A':'0.9 0.25 0.8','B':'0.15 0.8 0.9','C':'0.75 0.9 0.15','D':'0.45 0.35 1.0','E':'1.0 0.5 0.15'}
TR={'S':.2,'A':.17,'B':.15,'C':.13,'D':.11}
def proj(p):s=0.85*math.exp(-0.12*p[3]);return [p[0]*s,p[1]*s,p[2]*s]
def X(n):return 'N_'+n.replace('-','_').replace(' ','_').replace(':','_').replace("'",'')
cols=[]
for k,h in enumerate(hes):
    hue={'dsa':0,'eco':0.08,'bridge':0.55}[h['layer']]
    r,g,b=colorsys.hsv_to_rgb((k*0.137+hue)%1,0.65 if h['layer']!='bridge' else 0.9,1.0);cols.append(f'{r:.3f} {g:.3f} {b:.3f}');h['color']=cols[-1]
x=['<?xml version="1.0" encoding="UTF-8"?>','<X3D profile="Immersive" version="4.0"><head><meta name="title" content="Hypergraph v2: DSA concepts + Chess ECO A-E"/><meta name="description" content="DSA concepts (spheres, w = tier) and ECO openings (boxes, w = volume A..E) in one 4D hypergraph with cross-domain bridge hyperedges."/></head><Scene>',
'<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/><Background skyColor="0.04 0.05 0.08"/><Viewpoint description="Overview" position="0 0 15"/>']
def label(txt,y):return f'<Billboard axisOfRotation="0 0 0"><Transform translation="0 {y:.3f} 0"><Shape><Appearance><Material emissiveColor="0.9 0.92 0.96" diffuseColor="0 0 0"/></Appearance><Text string=\'"{txt}"\'><FontStyle size="0.18" justify=\'"MIDDLE" "MIDDLE"\'/></Text></Shape></Transform></Billboard>'
for kind,sw in (('dsa','SW_dsa'),('eco','SW_eco'),('eng','SW_eng')):
    x.append(f'<Switch DEF="{sw}" whichChoice="0"><Group>')
    for n in nodes:
        if n['kind']!=kind:continue
        q=proj(P[n['id']]);lab=n.get('label',n['id'])
        if kind=='eco':
            col=VC[n['vol']];shape=f'<Box size="0.32 0.32 0.32"/>';rad=0.16
            txt=f"{lab} {n['eco']}"
        else:
            col=TC[n['tier']];rad=TR[n['tier']];shape=f'<Sphere radius="{rad}"/>' if kind=='dsa' else f'<Cone bottomRadius="{rad}" height="{rad*2.4:.3f}"/>';txt=lab
        x.append(f'<Transform DEF="{X(n["id"])}" translation="{q[0]:.4f} {q[1]:.4f} {q[2]:.4f}"><TouchSensor DEF="TS_{X(n["id"])}" description="{lab}"/><Shape><Appearance><Material DEF="M_{X(n["id"])}" diffuseColor="{col}" emissiveColor="{col}" transparency="0.1"/></Appearance>{shape}</Shape>{label(txt,rad+0.24)}</Transform>')
    x.append('</Group></Switch>')
for k,h in enumerate(hes):
    qs=[proj(P[n]) for n in h['m']];c=[sum(q[i] for q in qs)/len(qs) for i in range(3)]
    pt=' '.join(f'{v:.4f}' for q in [c]+qs for v in q);ci=' '.join(f'0 {j+1} -1' for j in range(len(qs)))
    rad=max(math.dist(q,c) for q in qs)*1.08;col=cols[k]
    x.append(f'<Switch DEF="H{k}_W" whichChoice="0"><Group><Transform DEF="H{k}_T" translation="{c[0]:.4f} {c[1]:.4f} {c[2]:.4f}"><Shape><Appearance><Material diffuseColor="{col}" emissiveColor="{col}"/></Appearance><Box size="0.16 0.16 0.16"/></Shape><Transform DEF="H{k}_S" scale="{rad:.4f} {rad:.4f} {rad:.4f}"><Shape><Appearance><Material DEF="H{k}_SM" diffuseColor="{col}" emissiveColor="{col}" transparency="0.93"/></Appearance><Sphere radius="1"/></Shape></Transform></Transform><Shape><Appearance><Material emissiveColor="{col}" diffuseColor="0 0 0" transparency="0.2"/></Appearance><IndexedLineSet coordIndex="{ci}"><Coordinate DEF="H{k}_C" point="{pt}"/></IndexedLineSet></Shape></Group></Switch>')
pairs=sorted({tuple(sorted((a,b))) for h in hes for i,a in enumerate(h['m']) for b in h['m'][i+1:]})
cpt=' '.join(f'{v:.4f}' for n in ids for v in proj(P[n]));cidx=' '.join(f'{idx[a]} {idx[b]} -1' for a,b in pairs)
x.append(f'<Switch DEF="SW_C" whichChoice="-1"><Shape><Appearance><Material emissiveColor="0.75 0.78 0.85" diffuseColor="0 0 0" transparency="0.55"/></Appearance><IndexedLineSet coordIndex="{cidx}"><Coordinate DEF="CL_C" point="{cpt}"/></IndexedLineSet></Shape></Switch>')
x.append('</Scene></X3D>')
open(OUT+'hypergraph.x3d','w').write('\n'.join(x))
def lay(h):return h['layer']
def stat(sel):
    hs=[h for h in hes if sel(h)];ns={m for h in hs for m in h['m']}
    pr={tuple(sorted((a,b))) for h in hs for i,a in enumerate(h['m']) for b in h['m'][i+1:]}
    return dict(nodes=len(ns),hyperedges=len(hs),incidences=sum(len(h['m']) for h in hs),clique_pairs=len(pr),raw=sum(len(h['m'])*(len(h['m'])-1)//2 for h in hs))
stats=dict(dsa=stat(lambda h:h['layer']=='dsa'),eco=stat(lambda h:h['layer']=='eco'),bridge=stat(lambda h:h['layer']=='bridge'),all=stat(lambda h:True))
stats['all']['nodes']=len(ids);stats['eco_nodes']=len(ECO);stats['eng_nodes']=len(ENG)
dn=[dict(id=n['id'],label=n.get('label',n['id']),kind=n['kind'],tier=n.get('tier'),vol=n.get('vol'),eco=n.get('eco'),p=[round(v,4) for v in P[n['id']]]) for n in nodes]
open(OUT+'data.json','w').write(json.dumps(dict(nodes=dn,hes=[dict(name=h['name'],m=h['m'],layer=h['layer'],color=h['color']) for h in hes],stats=stats,VOL=VOL,X={n['id']:X(n['id']) for n in nodes})))
print(json.dumps(stats))
