import json,time,urllib.request,urllib.parse,sys,re
sys.path.insert(0,'.')
from mapping import LINKS,LESSONS
V=json.load(open('../data/verified-terms.json'))['terms']
G=json.load(open('/mnt/project-files/quarantine/math-ontology/omp-graph.json'))
UA={"User-Agent":"x3d-scout/1.0 (math ontology cross-check; generic client)"}
def api(**p):
    p["format"]="json"; u="https://www.wikidata.org/w/api.php?"+urllib.parse.urlencode(p)
    for i in range(6):
        time.sleep(1.5)
        try:
            r=urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=40).read().decode()
            if r.startswith("{"): return json.loads(r)
        except Exception as e: pass
        time.sleep(5*(i+1))
    return {}
def look(q,lang):
    s=api(action="wbsearchentities",search=q,language=lang,uselang=lang,limit=5,type="item").get("search",[])
    ids=[x["id"] for x in s]
    if not ids: return []
    e=api(action="wbgetentities",ids="|".join(ids),props="labels|descriptions",languages="en|ru").get("entities",{})
    out=[]
    for i in ids:
        L=e.get(i,{}).get("labels",{}); D=e.get(i,{}).get("descriptions",{})
        out.append(dict(qid=i,en=L.get("en",{}).get("value"),ru=L.get("ru",{}).get("value"),desc=D.get("en",{}).get("value")))
    return out
LESS={"linear":"matrix","derivative":"derivative","integral":"Riemann integral","fourier":"Fourier series","lorenz":"Lorenz system","gradient":"gradient descent","complex":"complex number","taylor":"Taylor series","waves":"wave interference","svd":"singular value decomposition","bayes":"Bayes' theorem","lagrange":"Lagrange multiplier","aliasing":"aliasing","heat":"heat equation","refraction":"Snell's law","probability":"binomial distribution","least_squares":"least squares","vector_field":"vector field"}
res={"lessons":{},"terms":{}}
for l,q in LESS.items():
    c=look(q,"en"); res["lessons"][l]=dict(query=q,cands=c[:3]); print(l,c[:1],flush=True)
seen=set()
for les,src,t,rel,g,note in LINKS:
    if src!="omp" or t in seen or t not in G: continue
    seen.add(t); labs=G[t]["labels"]; en=[a for a,l in labs if l=="en"]; ru=[a for a,l in labs if l=="ru"]
    if not ru: continue
    cands=look(ru[0],"ru")
    res["terms"][t]=dict(ru=ru[0],en=en[0] if en else None,cands=cands[:3],
       ru_match=[c["qid"] for c in cands if c["ru"] and c["ru"].lower()==ru[0].lower()],
       en_match=[c["qid"] for c in cands if en and c["en"] and c["en"].lower()==en[0].lower()])
    print(t,ru[0],"->",[ (c["qid"],c["en"]) for c in cands[:2]],flush=True)
json.dump(res,open("wikidata-raw.json","w"),ensure_ascii=False,indent=1)
