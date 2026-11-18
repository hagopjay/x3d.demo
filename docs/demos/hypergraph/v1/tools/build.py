import sys, math, json, random, colorsys
sys.path.insert(0,__import__('os').path.dirname(__file__))
from data import NODES, HE
OUT=__import__('os').path.join(__import__('os').path.dirname(__file__),'..')+'/'
ids=list(NODES); TW={'S':-1.5,'A':-0.75,'B':0,'C':0.75,'D':1.5}
rnd=random.Random(20261118)
P={n:[rnd.uniform(-1,1) for _ in range(3)]+[TW[NODES[n]]] for n in ids}
for it in range(900):
    t=1-it/900; F={n:[0,0,0,0] for n in ids}
    for a in ids:
        for b in ids:
            if a<b:
                d=[P[a][i]-P[b][i] for i in range(4)]; r2=sum(x*x for x in d)+0.01; f=1.6/r2
                for i in range(4): F[a][i]+=d[i]*f; F[b][i]-=d[i]*f
    for _,m in HE:
        c=[sum(P[n][i] for n in m)/len(m) for i in range(4)]
        for n in m:
            for i in range(4): F[n][i]+=(c[i]-P[n][i])*0.15
    for n in ids:
        for i in range(3): P[n][i]+=max(-.1,min(.1,F[n][i]*0.05*t+0.0))
        P[n][3]+= (TW[NODES[n]]-P[n][3])*0.5   # w locked to tier
# normalise xyz to radius 3
m=math.sqrt(sum(P[n][i]**2 for n in ids for i in range(3))/len(ids))/2.6
for n in ids:
    for i in range(3): P[n][i]*=3.0/m
TC={'S':'0.063 0.725 0.506','A':'0.231 0.510 0.965','B':'0.918 0.702 0.031','C':'0.976 0.451 0.086','D':'0.937 0.267 0.267'}
TR={'S':.2,'A':.17,'B':.15,'C':.13,'D':.11}
def proj(p): s=0.85*math.exp(-0.12*p[3]); return [p[0]*s,p[1]*s,p[2]*s]
hc=[]
for k in range(len(HE)):
    r,g,b=colorsys.hsv_to_rgb(k/len(HE),0.65,1.0); hc.append(f'{r:.3f} {g:.3f} {b:.3f}')
def nid(n): return 'N_'+n.replace('-','_')
x=['<?xml version="1.0" encoding="UTF-8"?>','<X3D profile="Immersive" version="4.0"><head><meta name="title" content="Hypergraph hyper-dimensional PoC"/><meta name="description" content="40 DSA concepts as 4D points (w = tier), 15 hyperedges as hubs plus translucent bounds; pose is the 4D default rotation."/></head><Scene>',
'<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/><Background skyColor="0.04 0.05 0.08"/><Viewpoint description="Overview" position="0 0 17"/>']
for n in ids:
    q=proj(P[n]+[]) if False else proj(P[n])
    t=NODES[n]
    x.append(f'<Transform DEF="{nid(n)}" translation="{q[0]:.4f} {q[1]:.4f} {q[2]:.4f}"><TouchSensor DEF="TS_{nid(n)}" description="{n}"/><Shape><Appearance><Material DEF="M_{nid(n)}" diffuseColor="{TC[t]}" emissiveColor="{TC[t]}" transparency="0.15"/></Appearance><Sphere radius="{TR[t]}"/></Shape><Billboard axisOfRotation="0 0 0"><Transform translation="0 {TR[t]+0.22:.3f} 0"><Shape><Appearance><Material emissiveColor="0.9 0.92 0.96" diffuseColor="0 0 0"/></Appearance><Text string=\'"{n}"\'><FontStyle size="0.18" justify=\'"MIDDLE" "MIDDLE"\'/></Text></Shape></Transform></Billboard></Transform>')
for k,(name,m) in enumerate(HE):
    qs=[proj(P[n]) for n in m]; c=[sum(q[i] for q in qs)/len(qs) for i in range(3)]
    pts=[c]+qs
    pt=' '.join(f'{v:.4f}' for q in pts for v in q)
    idx=' '.join(f'0 {j+1} -1' for j in range(len(m)))
    rad=max(math.dist(q,c) for q in qs)*1.08
    x.append(f'<Switch DEF="H{k}_W" whichChoice="0"><Group>')
    x.append(f'<Transform DEF="H{k}_T" translation="{c[0]:.4f} {c[1]:.4f} {c[2]:.4f}"><Shape><Appearance><Material diffuseColor="{hc[k]}" emissiveColor="{hc[k]}"/></Appearance><Box size="0.16 0.16 0.16"/></Shape>'
      f'<Transform DEF="H{k}_S" scale="{rad:.4f} {rad:.4f} {rad:.4f}"><Shape><Appearance><Material DEF="H{k}_SM" diffuseColor="{hc[k]}" emissiveColor="{hc[k]}" transparency="0.93"/></Appearance><Sphere radius="1"/></Shape></Transform></Transform>')
    x.append(f'<Shape><Appearance><Material DEF="H{k}_LM" emissiveColor="{hc[k]}" diffuseColor="0 0 0" transparency="0.2"/></Appearance><IndexedLineSet DEF="H{k}_L" coordIndex="{idx}"><Coordinate DEF="H{k}_C" point="{pt}"/></IndexedLineSet></Shape>')
    x.append('</Group></Switch>')
pairs=sorted({tuple(sorted((m[i],m[j]))) for _,m in HE for i in range(len(m)) for j in range(i+1,len(m))})
ix={n:i for i,n in enumerate(ids)}
cpt=' '.join(f'{v:.4f}' for n in ids for v in proj(P[n]))
cidx=' '.join(f'{ix[a]} {ix[b]} -1' for a,b in pairs)
x.append(f'<Switch DEF="SW_C" whichChoice="-1"><Shape><Appearance><Material emissiveColor="0.75 0.78 0.85" diffuseColor="0 0 0" transparency="0.55"/></Appearance><IndexedLineSet coordIndex="{cidx}"><Coordinate DEF="CL_C" point="{cpt}"/></IndexedLineSet></Shape></Switch>')
x.append('</Scene></X3D>')
open(OUT+'hypergraph.x3d','w').write('\n'.join(x))
# clique expansion stats
pairs=set()
for _,m in HE:
    for i in range(len(m)):
        for j in range(i+1,len(m)): pairs.add(tuple(sorted((m[i],m[j]))))
stats=dict(nodes=len(ids),hyperedges=len(HE),incidences=sum(len(m) for _,m in HE),clique_edges_dedup=len(pairs),clique_edges_raw=sum(len(m)*(len(m)-1)//2 for _,m in HE),
  orphan=[n for n in ids if not any(n in m for _,m in HE)])
data=dict(nodes=[dict(id=n,tier=NODES[n],p=[round(v,4) for v in P[n]]) for n in ids],hes=[dict(name=nm,m=m,color=hc[k]) for k,(nm,m) in enumerate(HE)],stats=stats,TC=TC,TR=TR)
open(OUT+'data.json','w').write(json.dumps(data))
print(stats)
