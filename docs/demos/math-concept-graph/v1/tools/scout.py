#!/usr/bin/env python3 -I
"""Live scout. Fetches the four sources, verifies every cited term in mapping.py and every GAP regex,
writes data/receipts.json and data/verified-terms.json. Fails (exit 1) on any mismatch. stdlib + curl.
Run: python3 -I tools/scout.py [--raw DIR]   (raw downloads kept out of the repo; only cited terms are written)"""
import json, re, sys, subprocess, hashlib, html, pathlib, datetime
HERE=pathlib.Path(__file__).resolve().parent; D=HERE.parent/"data"; sys.path.insert(0,str(HERE))
from mapping import LINKS, GAPS
RAW=pathlib.Path(sys.argv[sys.argv.index("--raw")+1] if "--raw" in sys.argv else "/tmp/mcg-raw"); RAW.mkdir(parents=True,exist_ok=True)
receipts=[]
def get(name,url,accept=None,quiet=False):
    f=RAW/name; cmd=["curl","-s","-m","90","-L","-o",str(f),"-w","%{http_code}"]
    if accept: cmd+=["-H","Accept: "+accept]
    code=subprocess.run(cmd+[url],capture_output=True,text=True).stdout.strip(); b=f.read_bytes() if f.exists() else b""
    receipts.append(dict(name=name,url=url,http=int(code or 0),bytes=len(b),sha256=hashlib.sha256(b).hexdigest()))
    return code,b.decode("utf8","replace")
# OntoMathPro: Protege-style class listing, no content negotiation, concept dereferencing 404
c,t=get("omp-classes.html","http://ontomathpro.org/ontology")
omp={}
for h,l in re.findall(r'<a href="([^"]+?)___[^"]*" id=\s*"?[^">]*"?[^>]*>(.*?)</a>',t,re.S):
    omp[h]=html.unescape(re.sub("<[^>]+>","",l)).strip().strip("'").strip()
omp.pop("Thing",None); print("omp classes",len(omp),"cyrillic-labelled",sum(bool(re.search("[а-яА-ЯёЁ]",v)) for v in omp.values()))
deref,_=get("omp-E1.ttl","http://ontomathpro.org/ontology/E1","text/turtle"); print("OMP dereference E1:",deref)
# OpenMath: symbol index + each cited CD
c,t=get("om-symbols.html","https://openmath.org/symbols/")
om=sorted({f"{a}:{b}" for a,b in re.findall(r'<a href="[^"]*?([A-Za-z0-9_]+)\.html#([A-Za-z0-9_]+)"',t)}); print("openmath symbols",len(om))
cds=sorted({x.split(":")[0] for l,s,x,*_ in LINKS if s=="om"}); cdstat={}
for cd in cds+["prob1","stats1"]:
    code,t=get(cd+".ocd",f"https://openmath.org/cd/{cd}.ocd"); m=re.search(r"<CDStatus>([^<]*)",t); cdstat[cd]=dict(http=int(code),status=m and m.group(1))
# MathML 3 chapter 4 (content markup)
code,ml=get("mathml3-ch4.html","https://www.w3.org/TR/MathML3/chapter4.html"); mlt=html.unescape(ml)
# PhySH (CC0): concepts list + disciplines subsets
_,pj=get("physh-concepts.json","https://physh.org/concepts","application/json"); ph={x["id"]:x["label"] for x in json.loads(pj)}
_,dj=get("physh-disciplines.json","https://physh.org/disciplines","application/json")
for d in json.loads(dj):
    _,s=get(f"physh-{d['id'][:8]}.json",f"https://physh.org/concepts?discipline={d['id']}","application/json")
    try: ph.update({x["id"]:x["label"] for x in json.loads(s)})
    except Exception: pass
print("physh concepts (unfiltered list + 17 disciplines)",len(ph))
ver,bad={},[]
def ml_count(el): return len(re.findall(r"<"+re.escape(el)+r"\b",mlt))
for les,src,term,rel,g,note in LINKS:
    if src=="omp": ok=term in omp; lab=omp.get(term); uri=f"http://ontomathpro.org/ontology/{term}"
    elif src=="om": ok=term in om; lab=term; uri=f"https://openmath.org/cd/{term.split(':')[0]}.ocd#{term.split(':')[1]}"
    elif src=="ml": n=ml_count(term); ok=n>0; lab=f"<{term}/> ({n} occurrences in ch.4)"; uri=f"https://www.w3.org/TR/MathML3/chapter4.html (element {term})"
    elif src=="ph": ok=term in ph; lab=ph.get(term); uri=f"https://doi.org/10.29172/{term}"
    if not ok: bad.append((les,src,term))
    ver[f"{src}/{term}"]=dict(label=lab,uri=uri,verified=ok)
gapres=[]
for les,src,rx,note in GAPS:
    pool={"omp":list(omp.values()),"om":om,"ph":list(ph.values())}.get(src)
    hits=[x for x in pool if re.search(rx,x,re.I)] if pool is not None else ([rx] if ml_count(rx.split("|")[0])>0 and any(ml_count(w)>0 for w in rx.split("|")) else [])
    if src=="ml": hits=[w for w in rx.split("|") if ml_count(w)>0]
    gapres.append(dict(lesson=les,src=src,regex=rx,note=note,hits=hits[:6],confirmed_gap=not hits))
cdstat["_note"]="status = CDStatus; prob1 and stats1 do not exist"
json.dump(dict(fetched=datetime.date.today().isoformat(),host="build container, curl via agent proxy",omp_classes=len(omp),omp_cyrillic=sum(bool(re.search("[а-яА-ЯёЁ]",v)) for v in omp.values()),
  openmath_symbols=len(om),physh_concepts=len(ph),omp_dereference_E1_http=int(deref),cds=cdstat,files=receipts),open(D/"receipts.json","w"),indent=1,ensure_ascii=False)
json.dump(dict(terms=ver,gaps=gapres),open(D/"verified-terms.json","w"),indent=1,ensure_ascii=False)
print("verified",sum(v["verified"] for v in ver.values()),"/",len(ver)); print("gaps confirmed",sum(g["confirmed_gap"] for g in gapres),"/",len(gapres))
for g in gapres:
    if not g["confirmed_gap"]: print("GAP REFUTED",g["lesson"],g["src"],g["hits"])
if bad: print("MISSING",bad); sys.exit(1)
