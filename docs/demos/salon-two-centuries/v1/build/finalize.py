import json,sys,urllib.parse,hashlib,collections
D=sys.argv[1]; P=json.load(open(D)); U=json.load(open('raw/units.json')); AN=json.load(open('raw/artnouveau.json'))
qid=lambda u:u.rsplit('/',1)[-1]
CONV={'Q174728':1.0,'Q174789':0.1,'Q11573':100.0,'Q218593':2.54}  # cm, mm, m, inch -> cm
dim=collections.defaultdict(dict); bad=[]
for r in U:
    u=qid(r['u'])
    if u in CONV: dim[qid(r['w'])].setdefault('h' if r['prop'].endswith('P2048') else 'w', round(float(r['amt'])*CONV[u],1))
    else: bad.append(u)
want={'Gismonda':None,'Zodiac':None,'Tournée du Chat noir':None,'Pallas Athena':None,'Nuda Veritas':None}
add=[]
for r in AN:
    t=r['wl']
    if t in want and want[t] is None and r['inc'][:4]!='1895':
        want[t]=r; cs=qid(r.get('cs','')) if r.get('cs') else None
        add.append({'id':qid(r['w']),'title':t,'artist_id':qid(r['a']),'artist':r['al'],'year':int(r['inc'][:4]),
          'img':urllib.parse.unquote(r['img'].rsplit('/',1)[-1]),'sitelinks':int(r['sl']),'movement':'artnouveau',
          'copyright':'public domain (Wikidata P6216 = Q19652)' if cs=='Q19652' else 'public domain by term (artist died 1939; life+70 expired 2010) [Likely; no P6216 on Wikidata]',
          'collection':None,'h_cm':None,'w_cm':None,'type':r['t']})
ps=[p for p in P['paintings'] if p['movement']!='artnouveau']+add
for p in ps:
    d=dim.get(p['id'],{})
    p['h_cm']=d.get('h'); p['w_cm']=d.get('w')
    n=p['img'].replace(' ','_'); h=hashlib.md5(n.encode()).hexdigest()
    p['commons_page']='https://commons.wikimedia.org/wiki/File:'+urllib.parse.quote(n)
    p['thumb']=f"https://upload.wikimedia.org/wikipedia/commons/thumb/{h[0]}/{h[:2]}/{urllib.parse.quote(n)}/1280px-{urllib.parse.quote(n)}"
    if n.lower().endswith(('.tif','.tiff')): p['thumb']+='.jpg'
    p['file']=p['id']+'.jpg'; p['wikidata']='https://www.wikidata.org/wiki/'+p['id']
P['paintings']=ps; P['dims_source']='Wikidata P2048/P2049 with units (cm, mm, m, inch normalised to cm), QLever 2026-11-25'
json.dump(P,open(D,'w'),ensure_ascii=False,indent=1)
print(len(ps),'paintings; unknown units',set(bad)); 
for p in ps:
    if not p['h_cm']: print('no dims',p['title'])
for p in add: print(p['title'],p['year'],p['artist'],p['copyright'][:40])
