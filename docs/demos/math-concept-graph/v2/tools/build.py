#!/usr/bin/env python3 -I
"""Builds concept-graph.x3d, claims.jsonld, coverage.json from tools/mapping.py + data/verified-terms.json (made by scout.py).
Run: python3 -I tools/build.py [--gate PATH_TO_x3d_mcp/src]"""
import json, sys, math, hashlib, pathlib, collections
from xml.sax.saxutils import quoteattr
HERE=pathlib.Path(__file__).resolve().parent; ROOT=HERE.parent; sys.path.insert(0,str(HERE))
from mapping import LESSONS, LINKS, GAPS
V=json.load(open(ROOT/"data/verified-terms.json")); T=V["terms"]
assert all(t["verified"] for t in T.values()), "unverified term: run scout.py"
assert all(g["confirmed_gap"] for g in V["gaps"]), "gap refuted: fix mapping.GAPS"
SRC={"omp":("OntoMathPro","0.35 0.75 1","http://ontomathpro.org/ontology"),"om":("OpenMath","1 0.45 0.8","https://openmath.org/cd/"),
     "ml":("MathML 3 content","0.85 0.85 0.9","https://www.w3.org/TR/MathML3/chapter4.html"),"ph":("PhySH","0.3 0.85 0.8","https://physh.org/"),"oe":("OEIS","1 0.6 0.2","https://oeis.org/")}
GRC={"C":"0.35 0.85 0.4","L":"0.95 0.75 0.2","S":"0.9 0.35 0.3"}
SKOS={"exactMatch":"skos:exactMatch","closeMatch":"skos:closeMatch","broadMatch":"skos:broadMatch","narrowMatch":"skos:narrowMatch","relatedMatch":"skos:relatedMatch"}
R=4.0; ang={l[0]:2*math.pi*i/len(LESSONS) for i,l in enumerate(LESSONS)}
# term placement: circular mean of linked lesson angles, per source ring, spaced apart
terms=collections.OrderedDict()
for les,src,t,rel,g,note in LINKS: terms.setdefault((src,t),[]).append(les)
place={}; YR={"om":1.6,"ml":0.55,"omp":-0.55,"ph":-1.6,"oe":2.6}; RR={"om":8.0,"ml":7.0,"omp":9.0,"ph":8.0,"oe":7.5}
for src in SRC:
    items=[]
    for (s,t),ls in terms.items():
        if s!=src: continue
        a=math.atan2(sum(math.sin(ang[l]) for l in ls),sum(math.cos(ang[l]) for l in ls))%(2*math.pi); items.append([a,t])
    items.sort(); sep=2*math.pi/max(len(items)*1.15,26)
    for i in range(1,len(items)):
        if items[i][0]<items[i-1][0]+sep: items[i][0]=items[i-1][0]+sep
    for a,t in items: place[(src,t)]=(RR[src]*math.cos(a),YR[src],RR[src]*math.sin(a))
lp={l:(R*math.cos(a),0,R*math.sin(a)) for l,a in ang.items()}
cov={}
for l,*_ in LESSONS:
    row={}
    for src in SRC:
        ls=[x for x in LINKS if x[0]==l and x[1]==src]; gp=[g for g in GAPS if g[0]==l and g[1]==src]
        row[src]=dict(links=len(ls),C=sum(x[4]=="C" for x in ls),L=sum(x[4]=="L" for x in ls),S=sum(x[4]=="S" for x in ls),gap=bool(gp and not ls))
    cov[l]=row
def lab(src,t): return T[f"{src}/{t}"]["label"]
def x3d():
    o=['<?xml version="1.0" encoding="UTF-8"?>','<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">',' <head>',
     '  <meta name="title" content="Math Lab concept graph (OntoMathPro, OpenMath, MathML, PhySH, OEIS), v2"/>',
     '  <meta name="description" content="18 Math Lab lessons linked to ontology terms; each link is a graded claim (Confirmed, Likely, Suspected). Lesson ring r=4, term rings r=7 to 9. v2 adds bilingual OntoMathPro matches, OEIS links and corrections to v1."/>',' </head>',' <Scene>',
     '  <NavigationInfo type=\'"EXAMINE" "ANY"\'/>','  <Viewpoint description="overview" position="0 11 17" orientation="1 0 0 -0.6" centerOfRotation="0 0 0"/>',
     '  <Background skyColor="0.04 0.05 0.08"/>','  <DirectionalLight direction="-0.3 -1 -0.4" intensity="0.9"/>']
    # lines per grade
    for g in "CLS":
        pts=[];idx=[]
        for les,src,t,rel,gr,note in LINKS:
            if gr!=g: continue
            a=lp[les];b=place[(src,t)];n=len(pts);pts+= [a,b];idx+=[n,n+1,-1]
        if not pts: continue
        o.append(f'  <Shape DEF="lines_{g}"><Appearance><Material emissiveColor="{GRC[g]}" diffuseColor="0 0 0"/></Appearance><IndexedLineSet coordIndex="{" ".join(map(str,idx))}"><Coordinate point="{", ".join("%.3f %.3f %.3f"%p for p in pts)}"/></IndexedLineSet></Shape>')
    for i,(les,title,acc) in enumerate(LESSONS):
        x,y,z=lp[les]; nC=sum(c["C"] for c in cov[les].values()); r=0.3+0.03*nC
        o.append(f'  <Transform DEF="lesson_{les}" translation="{x:.3f} {y} {z:.3f}">')
        o.append('   <MetadataSet containerField="metadata" name="claims" reference="https://www.w3.org/2004/02/skos/core#">')
        for k,(l2,src,t,rel,g,note) in enumerate(LINKS):
            if l2!=les: continue
            o.append(f'    <MetadataSet name={quoteattr(f"{src}_{k}")}><MetadataString name="relation" value={quoteattr(chr(34)+SKOS[rel]+chr(34))}/><MetadataString name="term" value={quoteattr(chr(34)+T[f"{src}/{t}"]["uri"]+chr(34))}/><MetadataString name="label" value={quoteattr(chr(34)+str(lab(src,t))+chr(34))}/><MetadataString name="grade" value="&quot;{g}&quot;"/></MetadataSet>')
        o.append('   </MetadataSet>')
        o.append(f'   <Shape><Appearance><Material diffuseColor="{" ".join(str(round(int(acc[j:j+2],16)/255,2)) for j in (1,3,5))}" emissiveColor="0.08 0.08 0.1"/></Appearance><Sphere radius="{r:.2f}"/></Shape>')
        o.append(f'   <TouchSensor DEF="ts_{les}" description={quoteattr(title)}/>')
        o.append(f'   <Transform translation="0 {r+0.35:.2f} 0"><Billboard axisOfRotation="0 0 0"><Shape><Appearance><Material emissiveColor="0.95 0.95 0.95"/></Appearance><Text string={quoteattr(chr(34)+les+chr(34))}><FontStyle size="0.3" justify=\'"MIDDLE" "MIDDLE"\'/></Text></Shape></Billboard></Transform>')
        for j,src in enumerate(SRC):   # four coverage ticks: lit when the lesson has at least one link in that source
            c=cov[les][src]; lit=c["links"]>0; col=SRC[src][1] if lit else "0.12 0.12 0.14"
            o.append(f'   <Transform translation="{(j-1.5)*0.28:.2f} {-r-0.28:.2f} 0"><Shape><Appearance><Material diffuseColor="{col}" emissiveColor="{col if lit else "0 0 0"}"/></Appearance><Box size="0.2 0.2 0.2"/></Shape></Transform>')
        o.append('  </Transform>')
    for n,((src,t),(x,y,z)) in enumerate(place.items()):
        col=SRC[src][1]
        best="C" if any(g=="C" for l2,s2,t2,r2,g,_ in LINKS if (s2,t2)==(src,t)) else "L" if any(g=="L" for l2,s2,t2,r2,g,_ in LINKS if (s2,t2)==(src,t)) else "S"
        o.append(f'  <Transform translation="{x:.3f} {y} {z:.3f}"><Shape><Appearance><Material diffuseColor="{col}" emissiveColor="{col}"/></Appearance><Box size="0.3 0.3 0.3"/></Shape><TouchSensor DEF="ts_t{n}" description={quoteattr(str(lab(src,t))[:60])}/></Transform>')
    o+=[' </Scene>','</X3D>']; return "\n".join(o)
ARX=json.load(open(ROOT/"data/arxiv-hits.json"))
def jsonld():
    ctx={"skos":"http://www.w3.org/2004/02/skos/core#","dct":"http://purl.org/dc/terms/","prov":"http://www.w3.org/ns/prov#","x3d":"urn:x3d:vocab:"}
    g=[]
    for les,title,_ in LESSONS:
        node={"@id":f"urn:x3d:mathlab:lesson:{les}","@type":"x3d:MathLabLesson","dct:title":title,"x3d:arxivTitleHits":ARX[les]["n_title"],"x3d:arxivExamples":[{"@id":"https://arxiv.org/abs/"+i} for i in ARX[les]["ids"]]}
        for src in ("exactMatch","closeMatch","broadMatch","narrowMatch","relatedMatch"): pass
        g.append(node)
    for k,(les,src,t,rel,gr,note) in enumerate(LINKS):
        g.append({"@id":f"urn:x3d:math-concept-graph:link:{k}","@type":"x3d:MappingClaim","x3d:lesson":{"@id":f"urn:x3d:mathlab:lesson:{les}"},
          "x3d:relation":{"@id":SKOS[rel]},"x3d:term":{"@id":T[f"{src}/{t}"]["uri"]},"skos:prefLabel":str(lab(src,t)),"x3d:source":SRC[src][0],
          "x3d:grade":{"@id":f"urn:x3d:grade:{gr}"},"dct:description":note,**({"skos:broader":[{"@id":"http://ontomathpro.org/ontology/"+u[0],"skos:prefLabel":u[1]} for u in T[f"{src}/{t}"].get("up",[])]} if src=="omp" else {}),"prov:wasGeneratedBy":"tools/scout.py (live fetch) + tools/mapping.py (hand-authored)"})
        # direct SKOS triple so SPARQL can use plain property paths
        g[[x["@id"] for x in g].index(f"urn:x3d:mathlab:lesson:{les}")].setdefault(SKOS[rel],[]).append({"@id":T[f"{src}/{t}"]["uri"]})
    for k,gp in enumerate(V["gaps"]):
        g.append({"@id":f"urn:x3d:math-concept-graph:gap:{k}","@type":"x3d:GapClaim","x3d:lesson":{"@id":f"urn:x3d:mathlab:lesson:{gp['lesson']}"},
          "x3d:source":SRC[gp["src"]][0],"x3d:searched":gp["regex"],"dct:description":gp["note"],"x3d:grade":{"@id":"urn:x3d:grade:C"},"x3d:negative":True})
    return {"@context":ctx,"@graph":g}
def main():
    x=x3d(); (ROOT/"concept-graph.x3d").write_text(x)
    (ROOT/"claims.jsonld").write_text(json.dumps(jsonld(),indent=1,ensure_ascii=False))
    gc=collections.Counter(l[4] for l in LINKS); tot=dict(lessons=len(LESSONS),links=len(LINKS),terms=len(terms),gaps=len(GAPS),grades=dict(gc),
        lessons_with_any_C_link={s:sum(1 for l,*_ in LESSONS if cov[l][s]["C"]>0) for s in SRC},lessons_with_any_link={s:sum(1 for l,*_ in LESSONS if cov[l][s]["links"]>0) for s in SRC},
        lessons_with_a_confirmed_gap={s:sum(1 for l,*_ in LESSONS if cov[l][s]["gap"]) for s in SRC})
    (ROOT/"coverage.json").write_text(json.dumps(dict(totals=tot,per_lesson=cov,sources={k:v[0] for k,v in SRC.items()}),indent=1))
    h=hashlib.sha256(x.encode()).hexdigest(); print(json.dumps(tot)); print("scene sha256",h,len(x),"bytes")
    if "--gate" in sys.argv:
        sys.path.insert(0,sys.argv[sys.argv.index("--gate")+1]); from validation.validate import validate_xml
        r=validate_xml(x); print(json.dumps({k:r[k] for k in r if k in("valid","errors","warnings")},indent=1)[:2000])
        (ROOT/"validation-v2.json").write_text(json.dumps({"scene_sha256":h,"valid":r.get("valid"),"errors":r.get("errors"),"warnings":r.get("warnings"),"validator":"x3d_mcp fa5dccf validate_xml"},indent=1))
if __name__=="__main__": main()
