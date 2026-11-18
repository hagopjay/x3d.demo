"""Hypergraph v3 data builder. Needs python-chess (dev only). Inputs: ../source/*.tsv (Lichess chess-openings, CC0),
data_dsa.py (DSA set from v1). Outputs ../data.json and ../hypergraph.x3d."""
import os, io, csv, sys, json, math, random, collections, colorsys
import chess, chess.pgn
here=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0,here)
from data_dsa import NODES as DSA, HE as DHE
OUT=os.path.join(here,'..')+'/'
rows=[]
for f in 'abcde': rows+=list(csv.DictReader(open(OUT+'source/'+f+'.tsv'),delimiter='\t'))
# ---- replay every line once
final={}
for r in rows:
    g=chess.pgn.read_game(io.StringIO(r['pgn']));b=g.board();san=[];ms=list(g.mainline_moves());eps=[]
    for m in ms: san.append(b.san(m));b.push(m);eps.append(b.epd())
    r['san']=san;r['epds']=eps;r['epd']=b.epd();r['ply']=len(ms);final[b.epd()]=r
by=collections.OrderedDict()
for r in rows: by.setdefault(r['eco'],[]).append(r)
codes=sorted(by)
# ---- transposition meeting points: line X passes through Y's final position by a different move order
groups=collections.defaultdict(set); events=0
for x in rows:
    for k,e in enumerate(x['epds']):
        y=final.get(e)
        if y is not None and y is not x and len(y['san'])==k+1 and x['san'][:k+1]!=y['san']:
            groups[e].add(x['eco']);groups[e].add(y['eco']);events+=1
meet=[(e,sorted(s)) for e,s in groups.items() if len(s)>=2]
# ---- ECO code nodes
VW={'A':-1.5,'B':-0.75,'C':0,'D':0.75,'E':1.5}
def fam(n): return n.split(':')[0].strip()
cn={}
for c in codes:
    f=by[c][0]
    san=f['san']; fm=san[0] if san else '-'
    b=chess.Board(); 
    cn[c]=dict(id=c,kind='eco',label=c,vol=c[0],name=f['name'],family=fam(f['name']),ply=min(r['ply'] for r in by[c]),nl=len(by[c]),
      fen=f['epd'].split(' ')[0],fm=fm,pgn=f['pgn'],w=VW[c[0]])
fams=collections.OrderedDict()
for c in codes: fams.setdefault(cn[c]['family'],[]).append(c)
# ---- hyperedges (chess)
VN={'A':'Flank openings','B':'Semi-open games','C':'Open games and French','D':'Closed and semi-closed','E':'Indian defences'}
HE=[]
for v in 'ABCDE': HE.append(dict(name=f'ECO {v}: {VN[v]}',m=[c for c in codes if c[0]==v],layer='chess',type='volume',vol=v))
for f,m in fams.items():
    if len(m)>=3:
        vols=collections.Counter(cn[c]['vol'] for c in m);HE.append(dict(name=f,m=m,layer='chess',type='family',vol=vols.most_common(1)[0][0]))
fmg=collections.defaultdict(list)
for c in codes: fmg[cn[c]['fm'] if cn[c]['fm'] in ('e4','d4','c4','Nf3') else 'other'].append(c)
for k in ('e4','d4','c4','Nf3','other'): HE.append(dict(name='1.'+k if k!='other' else 'Other first moves',m=fmg[k],layer='chess',type='firstmove'))
tm=[(e,m) for e,m in meet if len(m)>=3]
tm.sort(key=lambda t:(-len({c[0] for c in t[1]}),-len(t[1])))
for e,m in tm[:40]:
    y=final[e];HE.append(dict(name='Meeting point: '+y['name'],m=m,layer='chess',type='transposition',pgn=y['pgn'],xvol=len({c[0] for c in m})>1))
# ---- DSA, engine, bridges
TW={'S':-1.5,'A':-0.75,'B':0,'C':0.75,'D':1.5}
ENG={'minimax':'S','alpha-beta':'A','transposition-table':'A','zobrist-hash':'B','opening-book':'B','iterative-deepening':'B','move-ordering':'C','quiescence':'C'}
nodes=list(cn.values())
for n,t in DSA.items(): nodes.append(dict(id=n,kind='dsa',label=n,tier=t,w=TW[t]))
for n,t in ENG.items(): nodes.append(dict(id='eng:'+n,kind='eng',label=n,tier=t,w=TW[t]))
for n,m in DHE: HE.append(dict(name=n,m=m,layer='dsa',type='dsa'))
E=lambda x:'eng:'+x
HE+= [dict(name='Engine alpha-beta search',m=[E(x) for x in ['minimax','alpha-beta','move-ordering','iterative-deepening','quiescence']],layer='chess',type='engine'),
 dict(name='Engine hash tables',m=[E(x) for x in ['transposition-table','zobrist-hash','opening-book']],layer='chess',type='engine'),
 dict(name='Search is recursion',m=[E('minimax'),E('alpha-beta'),'recursion','backtracking','dfs','memoization'],layer='bridge',type='bridge'),
 dict(name='Transposition = memoization by hashing',m=[E('transposition-table'),E('zobrist-hash'),'memoization','hash-map','string-hashing','dp'],layer='bridge',type='bridge'),
 dict(name='Opening book is a trie',m=[E('opening-book'),'trie','hash-map','C60','B90','D30','E60','E20'],layer='bridge',type='bridge'),
 dict(name='Move ordering is a priority sort',m=[E('move-ordering'),'heap','greedy','quicksort'],layer='bridge',type='bridge'),
 dict(name='Iterative deepening = BFS by DFS',m=[E('iterative-deepening'),'bfs','dfs','recursion'],layer='bridge',type='bridge')]
ids={n['id'] for n in nodes}
for h in HE:
    for m in h['m']: assert m in ids,(h['name'],m)
# ---- layout: particles = family clusters + individual DSA/engine nodes
rnd=random.Random(20261118)
part={}   # key -> dict(members,w,r)
for f,m in fams.items(): part['f:'+f]=dict(m=m,w=sum(cn[c]['w'] for c in m)/len(m),r=0.55*len(m)**(1/3)+0.25)
for n in nodes:
    if n['kind']!='eco': part['n:'+n['id']]=dict(m=[n['id']],w=n['w'],r=0.22)
pk={}
for k,p in part.items():
    for m in p['m']: pk[m]=k
keys=list(part); P={k:[rnd.uniform(-1,1)*3 for _ in range(3)]+[part[k]['w']] for k in keys}
links=collections.Counter()
for h in HE:
    if h['type'] in ('volume',): continue
    ks=sorted({pk[m] for m in h['m']})
    wgt={'transposition':0.5,'family':0.0,'firstmove':0.03,'dsa':0.35,'engine':0.5,'bridge':0.5}.get(h['type'],0.1)
    if h['type'] in ('firstmove',) : wgt=0.03
    for i,a in enumerate(ks):
        for b in ks[i+1:]: links[(a,b)]+=wgt/ max(1,len(ks)-1)*3
for it in range(1200):
    t=1-it/1200;F={k:[0,0,0,0] for k in keys}
    for i,a in enumerate(keys):
        for b in keys[i+1:]:
            d=[P[a][j]-P[b][j] for j in range(4)];r2=sum(x*x for x in d)+0.05;R=part[a]['r']+part[b]['r']
            f=(2.2*R*R)/r2 if r2<(R*3)**2 else 0.0
            for j in range(4):F[a][j]+=d[j]*f;F[b][j]-=d[j]*f
    for (a,b),w in links.items():
        d=[P[b][j]-P[a][j] for j in range(4)];dist=math.sqrt(sum(x*x for x in d))+1e-6;pull=min(w,6)*0.04*max(0,dist-(part[a]['r']+part[b]['r']))
        for j in range(4):F[a][j]+=d[j]/dist*pull;F[b][j]-=d[j]/dist*pull
    for k in keys:
        for j in range(3):F[k][j]-=P[k][j]*0.02
        for j in range(3):P[k][j]+=max(-.15,min(.15,F[k][j]*0.08*(0.2+t)))
        P[k][3]+=(part[k]['w']-P[k][3])*0.5
# normalise xyz
rms=math.sqrt(sum(P[k][j]**2 for k in keys for j in range(3))/len(keys));S=5.0/rms
for k in keys:
    for j in range(3):P[k][j]*=S
# DSA/engine particles form their own continent to the right of the chess clusters, so bridges read as long edges
chess_keys=[k for k in keys if k.startswith('f:')];other=[k for k in keys if k.startswith('n:')]
R=max(math.sqrt(sum(P[k][j]**2 for j in range(3))) for k in chess_keys)
cc=[sum(P[k][j] for k in other)/len(other) for j in range(3)]
for k in other:
    for j in range(3):P[k][j]=(P[k][j]-cc[j])*1.7+(R*1.35 if j==0 else 0)
# codes inside clusters: golden-spiral sphere, cluster radius scaled
GA=math.pi*(3-math.sqrt(5))
for f,m in fams.items():
    k='f:'+f;c=P[k];n=len(m);R=(0.55*n**(1/3)+0.25)*S*0.55 if n>1 else 0
    for i,code in enumerate(m):
        if n==1: u=(0,0,0)
        else:
            z=1-2*(i+0.5)/n;rr=math.sqrt(max(0,1-z*z));th=GA*i;u=(rr*math.cos(th),rr*math.sin(th),z)
        cn[code]['p']=[c[0]+u[0]*R,c[1]+u[1]*R,c[2]+u[2]*R,cn[code]['w']]
for n in nodes:
    if n['kind']!='eco': n['p']=P['n:'+n['id']][:3]+[n['w']]
# ---- colours
VC={'A':'#ff6b9d','B':'#35d6cf','C':'#ffd166','D':'#8c7bff','E':'#ff8a4c'}
TC={'S':'#22d3a0','A':'#4c8dff','B':'#f2c14e','C':'#f97316','D':'#ef4444'}
def hexrgb(h):return [int(h[i:i+2],16)/255 for i in (1,3,5)]
for h in HE:
    t=h['type']
    h['color']={'volume':VC.get(h.get('vol'),'#fff'),'family':VC.get(h.get('vol'),'#fff'),'firstmove':'#9db4ff','transposition':'#a9dcff','engine':'#cfd8ff','bridge':'#ff4fd8','dsa':None}[t]
dc=[colorsys.hsv_to_rgb(i/15,0.55,1.0) for i in range(15)]
di=0
for h in HE:
    if h['type']=='dsa': h['color']='#%02x%02x%02x'%tuple(int(255*v) for v in dc[di]);di+=1
    h['spokes']=h['type'] not in ('volume','firstmove')
    h['aura']=h['type'] in ('volume','family','dsa','bridge','engine') or (h['type']=='transposition')
for n in nodes:
    n['color']=VC[n['vol']] if n['kind']=='eco' else (TC[n['tier']] if n['kind']=='dsa' else '#d6defc')
# ---- stats
xv=[h for h in HE if h['type']=='transposition' and h.get('xvol')]
codes_in_trans=len({c for e,m in meet for c in m})
pairs_all=sum(len(h['m'])*(len(h['m'])-1)//2 for h in HE)
stats=dict(rows=len(rows),codes=len(codes),families=len(fams),family_hyperedges=sum(h['type']=='family' for h in HE),
  transposition_events=events,meeting_positions=len(meet),meeting_ge3=len(tm),meeting_shown=sum(h['type']=='transposition' for h in HE),meeting_cross_volume_shown=len(xv),
  codes_in_meetings=codes_in_trans,hyperedges=len(HE),incidences=sum(len(h['m']) for h in HE),nodes=len(nodes),
  max_ply=max(cn[c]['ply'] for c in codes),median_ply=sorted(cn[c]['ply'] for c in codes)[len(codes)//2],
  source_commit='3ba6b20d31b2e6125cb0e6a2e792f400717d9d39',source_license='CC0',
  lines_per_vol={v:sum(len(by[c]) for c in codes if c[0]==v) for v in 'ABCDE'},codes_per_vol={v:sum(1 for c in codes if c[0]==v) for v in 'ABCDE'})
slim=[]
for n in nodes:
    d={k:n[k] for k in ('id','kind','label','color') if k in n};d['p']=[round(v,3) for v in n['p']]
    for k in ('vol','name','family','ply','nl','fen','fm','pgn','tier'):
        if k in n:d[k]=n[k]
    slim.append(d)
json.dump(dict(nodes=slim,hes=[{k:h[k] for k in h if k!='vol' or True} for h in HE],stats=stats,VN=VN,VC=VC),open(OUT+'data.json','w'),separators=(',',':'))
print(json.dumps(stats))
# ---- X3D (portable scene, static pose; w dropped to 3D by the same exp depth map at default rotation)
def proj(p):s=0.85*math.exp(-0.12*p[3]);return [p[0]*s,p[1]*s,p[2]*s]
def rgb(h):return ' '.join(f'{v:.3f}' for v in hexrgb(h))
def X(i):return 'N_'+''.join(ch if ch.isalnum() else '_' for ch in i)
x=['<?xml version="1.0" encoding="UTF-8"?>','<X3D profile="Immersive" version="4.0"><head><meta name="title" content="Hypergraph v3: DSA, engine concepts and the 500 ECO codes"/><meta name="description" content="ECO codes from the Lichess chess-openings table (CC0), family, first-move and transposition hyperedges, DSA and engine layers and five bridges; static pose."/></head><Scene>',
 '<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/><Background skyColor="0.03 0.035 0.06"/><Viewpoint description="Overview" position="8 0 32"/>']
for n in nodes:
    q=proj(n['p']);r={'eco':0.09,'dsa':0.16,'eng':0.14}[n['kind']]
    sh=f'<Sphere radius="{r}"/>' if n['kind']!='eng' else f'<Cone bottomRadius="{r}" height="{r*2.4:.3f}"/>'
    x.append(f'<Transform DEF="{X(n["id"])}" translation="{q[0]:.3f} {q[1]:.3f} {q[2]:.3f}"><Shape><Appearance><Material diffuseColor="{rgb(n["color"])}" emissiveColor="{rgb(n["color"])}"/></Appearance>{sh}</Shape></Transform>')
for k,h in enumerate(HE):
    qs=[proj(nodes_by[0]) for nodes_by in [next(n['p'] for n in nodes if n['id']==m)] for m in h['m']] if False else None
pos={n['id']:proj(n['p']) for n in nodes}
for k,h in enumerate(HE):
    if not h['spokes']: continue
    qs=[pos[m] for m in h['m']];c=[sum(q[i] for q in qs)/len(qs) for i in range(3)]
    pt=' '.join(f'{v:.3f}' for q in [c]+qs for v in q);ci=' '.join(f'0 {j+1} -1' for j in range(len(qs)));col=rgb(h['color'])
    lab=h['name'].replace('"','').replace("'",'\u2019').replace('&','and')
    x.append(f'<Shape><Appearance><Material emissiveColor="{col}" diffuseColor="0 0 0" transparency="0.35"/></Appearance><IndexedLineSet coordIndex="{ci}"><Coordinate point="{pt}"/></IndexedLineSet></Shape>')
    if h['type'] in ('family','dsa','bridge','engine'):
        x.append(f'<Transform translation="{c[0]:.3f} {c[1]:.3f} {c[2]:.3f}"><Billboard axisOfRotation="0 0 0"><Shape><Appearance><Material emissiveColor="{col}" diffuseColor="0 0 0"/></Appearance><Text string=\'"{lab}"\'><FontStyle size="0.3" justify=\'"MIDDLE" "MIDDLE"\'/></Text></Shape></Billboard></Transform>')
x.append('</Scene></X3D>')
open(OUT+'hypergraph.x3d','w').write('\n'.join(x))
