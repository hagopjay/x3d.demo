import json,collections,re,sys,urllib.parse,hashlib
A=json.load(open('raw/artists.json')); Lk=json.load(open('raw/links.json')); W=json.load(open('raw/work.json')); P=json.load(open('raw/paintings.json'))
MAP={'Q37853':'baroque','Q808561':'baroque','Q122960':'rococo','Q14378':'neoclassicism','Q37068':'romanticism','Q10857409':'realism','Q143357':'realism','Q40415':'impressionism','Q166713':'postimpressionism','Q200034':'postimpressionism','Q164800':'symbolism','Q184814':'symbolism','Q34636':'artnouveau'}
MOV={m['id']:m for m in json.load(open(sys.argv[1]))['movements']}
qid=lambda u:u.rsplit('/',1)[-1]
yr=lambda s:int(s[:5]) if s.startswith('-') else int(s[:4])
def pt(s):
    m=re.match(r'POINT\(([-\d.]+) ([-\d.]+)\)',s); return (round(float(m.group(2)),3),round(float(m.group(1)),3)) if m else None
art={}
for r in A:
    q=qid(r['a']); mv=MAP.get(qid(r['mv']))
    a=art.setdefault(q,{'id':q,'name':r['al'],'b':yr(r['b']),'d':yr(r['d']),'mvs':set(),'sl':int(r.get('sl',0) or 0),'birth':None,'death':None})
    if mv: a['mvs'].add(mv)
    if r.get('bc') and not a['birth']: a['birth']=(r['bpl'],pt(r['bc']))
    if r.get('dc') and not a['death']: a['death']=(r['dpl'],pt(r['dc']))
art={k:v for k,v in art.items() if v['mvs']}
for a in art.values():
    mid=(a['b']+a['d'])//2 if a['d']-a['b']<90 else a['b']+40
    best=sorted(a['mvs'],key=lambda m:(0 if MOV[m]['start']<=a['b']+30<=MOV[m]['end'] else 1, abs((MOV[m]['start']+MOV[m]['end'])/2-(a['b']+30))))
    a['movement']=best[0]
works=collections.defaultdict(list)
for r in W:
    q=qid(r['a'])
    if q in art:
        c=pt(r['wc']); s=yr(r['s']) if r.get('s') else None
        if c: works[q].append((s,r['wl'],c))
cities={}
def city(n,c):
    cities.setdefault(n,c); return n
for a in art.values():
    path=[]
    if a['birth']: path.append([a['b'],city(*a['birth'])])
    ws=sorted({(s or 0,n,c) for s,n,c in works.get(a['id'],[])},key=lambda t:t[0])
    k=0
    for s,n,c in ws:
        y=s if s else a['b']+25+k*6; k+=1
        y=max(a['b']+1,min(a['d']-1,y))
        path.append([y,city(n,c)])
    if a['death']: path.append([a['d'],city(*a['death'])])
    path.sort(key=lambda t:t[0])
    dedup=[]
    for p in path:
        if not dedup or dedup[-1][1]!=p[1]: dedup.append(p)
    a['path']=dedup
# keep artists alive in the slice with a path, ranked by sitelinks, cap per movement
keep=[a for a in art.values() if a['d']>=1700 and a['b']<=1880 and len(a['path'])>=1]
bym=collections.defaultdict(list)
for a in sorted(keep,key=lambda a:-a['sl']): bym[a['movement']].append(a)
CAP=45
sel=[a for m in bym for a in bym[m][:CAP]]
ids={a['id'] for a in sel}
inf=[]
for r in Lk:
    s,o=qid(r['a']),qid(r['o'])
    if s in ids and o in ids and s!=o: inf.append([o,s,'influenced' if r['p'].endswith('P737') else 'taught'])  # o -> s
inf=[list(x) for x in {tuple(x) for x in inf}]
used={c for a in sel for _,c in a['path']}
out={'source':'Wikidata via QLever (qlever.dev/api/wikidata), queried 2026-11-25; CC0','note':'Paths: birth place (P19) -> work locations (P937, with start-time qualifier when present; otherwise spread after age 25, graded Suspected) -> death place (P20). Influence: P737 influenced by; P1066 student of.',
     'counts':{'artists_harvested':len(art),'artists_shown':len(sel),'links_between_shown':len(inf),'cities':len(used)},
     'cities':{c:cities[c] for c in sorted(used)},
     'artists':[{'id':a['id'],'name':a['name'],'born':a['b'],'died':a['d'],'movement':a['movement'],'movements':sorted(a['mvs']),'sitelinks':a['sl'],'path':a['path']} for a in sel],
     'influences':inf}
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=0)
print(out['counts'], {m:len(bym[m]) for m in bym})
# paintings
pw={}
for r in P:
    w=qid(r['w']); a=qid(r['a'])
    if a not in art: continue
    x=pw.setdefault(w,{'id':w,'title':r['wl'],'artist_id':a,'artist':art[a]['name'],'year':yr(r['inc']),'img':urllib.parse.unquote(r['img'].rsplit('/',1)[-1]),'sitelinks':int(r['sl']),'copyright':set(),'collection':None,'h_cm':None,'w_cm':None})
    if r.get('cs'): x['copyright'].add(qid(r['cs']))
    if r.get('coll') and not x['collection']: x['collection']=r['coll']
    for k,kk in (('h','h_cm'),('wd','w_cm')):
        if r.get(k) and not x[kk]:
            try: x[kk]=float(r[k])
            except: pass
picked=[]
for m,mm in MOV.items():
    a0,b0=max(mm['start'],1700),min(mm['end'],1899)
    cand=[p for p in pw.values() if m in art[p['artist_id']]['mvs'] and a0-2<=p['year']<=b0 and p['copyright']=={'Q19652'}]
    cand.sort(key=lambda p:-p['sitelinks'])
    seen=collections.Counter(); got=[]
    for p in cand:
        if seen[p['artist_id']]>=2 or any(p['id']==q['id'] for q in picked): continue
        seen[p['artist_id']]+=1; p2=dict(p); p2['movement']=m; got.append(p2)
        if len(got)>=7: break
    picked+=got
for p in picked:
    p['copyright']='public domain (Wikidata P6216 = Q19652)'
    n=p['img'].replace(' ','_'); h=hashlib.md5(n.encode()).hexdigest()
    p['commons_page']='https://commons.wikimedia.org/wiki/File:'+urllib.parse.quote(n)
    p['thumb']=f"https://upload.wikimedia.org/wikipedia/commons/thumb/{h[0]}/{h[:2]}/{urllib.parse.quote(n)}/1280px-{urllib.parse.quote(n)}"
    p['file']=p['id']+'.jpg'
    p['wikidata']='https://www.wikidata.org/wiki/'+p['id']
json.dump({'source':out['source'],'paintings':picked},open(sys.argv[3],'w'),ensure_ascii=False,indent=1)
for p in picked: print(p['movement'][:6],p['year'],p['sitelinks'],p['artist'],'|',p['title'],p['h_cm'],p['w_cm'])
