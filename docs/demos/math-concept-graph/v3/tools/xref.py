#!/usr/bin/env python3 -I
"""Cross-references the v2 mapping to Wikidata (CC0) and builds the Russian-label check sheet.
Inputs: data/wikidata-raw.json (live wbsearchentities + wbgetentities, 18 Nov 2026, see tools/wd.py), the private OntoMathPro crawl (--quarantine DIR).
Output: data/wikidata-xref.json.  A row is 'agrees' only when the Wikidata ru label equals the OntoMathPro ru label, or the Wikidata en label equals the reading of the term; otherwise 'search hit only' or 'no cross-check'."""
import json,sys,pathlib,re
HERE=pathlib.Path(__file__).resolve().parent; ROOT=HERE.parent; sys.path.insert(0,str(HERE))
from mapping import LINKS
RAW=json.load(open(ROOT/"data/wikidata-raw.json")); QD=pathlib.Path(sys.argv[sys.argv.index("--quarantine")+1]); G=json.load(open(QD/"omp-graph.json"))
LESSON_QID={"linear":("Q44337","exactMatch"),"derivative":("Q29175","exactMatch"),"integral":("Q697181","exactMatch"),"fourier":("Q179467","exactMatch"),"lorenz":("Q899844","exactMatch"),"gradient":("Q1199743","exactMatch"),"complex":("Q11567","exactMatch"),"taylor":("Q131187","exactMatch"),"waves":("Q136980","closeMatch"),"svd":("Q420904","exactMatch"),"bayes":("Q182505","exactMatch"),"lagrange":("Q598870","exactMatch"),"aliasing":("Q868732","exactMatch"),"heat":("Q6510488","exactMatch"),"refraction":("Q208391","closeMatch"),"probability":("Q185547","closeMatch"),"least_squares":("Q74304","exactMatch"),"vector_field":("Q186247","exactMatch")}
TERM_QID={"E3040":"Q29175","E1703":"Q44337","E1403":"Q207643","E2856":"Q2294564","E3079":"Q179467","E2975":"Q6520159","E598":"Q725944","E472":"Q1199743","E1700":"Q173582","E2127":"Q11567","E3071":"Q131187","E3072":"Q1882442","E1836":"Q182505","E2000":"Q182505","E1621":"Q74318512","E3128":"Q845060","E1921":"Q6510488","E690":"Q74304","E2865":"Q697181","E247":"Q1200279","E1931":"Q193846","E1520":"Q831390","E3239":"Q505735","E1041":"Q207264","E2722":"Q598870","E691":"Q1199743"}
READ={"E3040":"derivative of a function","E3079":"Fourier series","E3071":"Taylor series","E2924":"Taylor polynomial","E2021":"Taylor formula","E3072":"Maclaurin series","E1921":"heat equation","E3128":"extremum","E2865":"Riemann integral","E2855":"integral","E2856":"Darboux integral","E1523":"Kotelnikov-Shannon wavelet","E3303":"singular number","E1931":"equation of oscillations","E2722":"Lagrange multiplier","E2000":"Bayes formula","E598":"Runge-Kutta method","E691":"method of steepest descent","E472":"gradient descent method","E1856":"central limit theorem","E2498":"binomial distribution","E2514":"normal distribution","E246":"vector field","E1847":"integral de Moivre-Laplace theorem","E3406":"Kotelnikov frequency"}
cand={}
for v in list(RAW["lessons"].values())+list(RAW["terms"].values()):
    for c in v["cands"]: cand[c["qid"]]=c
cand["Q44337"]=cand.get("Q44337",dict(qid="Q44337",en="matrix",ru=None)); cand["Q74304"]=cand.get("Q74304",dict(qid="Q74304",en="least squares method",ru="Метод наименьших квадратов"))
rows=[]
cited=sorted({t for l,s,t,*_ in LINKS if s=="omp"},key=lambda x:int(x[1:]))
for t in cited:
    if t not in G: continue
    labs=G[t]["labels"]; ru=[a for a,l in labs if l=="ru"]; en=[a for a,l in labs if l=="en"]
    if not ru: continue
    reading=en[0] if en else READ.get(t)
    q=TERM_QID.get(t); c=cand.get(q) if q else None
    rawc=RAW["terms"].get(t,{}).get("cands",[])
    if q and not c: c=next((x for x in rawc if x["qid"]==q),None)
    if c:
        agree=(c.get("ru") and c["ru"].lower() in [x.lower() for x in ru]) or (reading and c.get("en") and c["en"].lower()==reading.lower())
        st="agrees" if agree else "search hit only"
    else: st="no cross-check"
    rows.append(dict(omp=t,ru=ru[0],reading=reading,reading_source="OntoMathPro en label" if en else "model reading (no en label)",ru_only=not en,qid=q,wd_en=c and c.get("en"),wd_ru=c and c.get("ru"),status=st))
out=dict(fetched="2026-11-18",source="wikidata.org wbsearchentities + wbgetentities (CC0)",lessons={l:dict(qid=q,rel=r,wd_en=(cand.get(q) or {}).get("en"),wd_ru=(cand.get(q) or {}).get("ru")) for l,(q,r) in LESSON_QID.items()},ru_check=rows,
  summary=dict(rows=len(rows),ru_only=sum(r["ru_only"] for r in rows),agrees=sum(r["status"]=="agrees" for r in rows),search_hit_only=sum(r["status"]=="search hit only" for r in rows),no_cross_check=sum(r["status"]=="no cross-check" for r in rows),ru_only_unchecked=sum(r["ru_only"] and r["status"]!="agrees" for r in rows)))
json.dump(out,open(ROOT/"data/wikidata-xref.json","w"),indent=1,ensure_ascii=False); print(json.dumps(out["summary"]))
for r in rows:
    if r["ru_only"]: print(r["omp"],r["ru"],"|",r["reading"],"|",r["qid"],r["wd_en"],"|",r["status"])
