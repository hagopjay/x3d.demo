import json,sys,time,urllib.request,urllib.parse
UA="x3d-art-slice/1.0 (research demo)"
PRE="""PREFIX wd: <http://www.wikidata.org/entity/> PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX schema: <http://schema.org/> PREFIX p: <http://www.wikidata.org/prop/> PREFIX ps: <http://www.wikidata.org/prop/statement/> PREFIX pq: <http://www.wikidata.org/prop/qualifier/> PREFIX wikibase: <http://wikiba.se/ontology#> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> PREFIX geo: <http://www.opengis.net/ont/geosparql#>
"""
def q(s):
    d=urllib.parse.urlencode({"query":PRE+s}).encode()
    for t in range(4):
        try:
            r=urllib.request.urlopen(urllib.request.Request("https://qlever.dev/api/wikidata",data=d,headers={"User-Agent":UA,"Accept":"application/sparql-results+json","Content-Type":"application/x-www-form-urlencoded"}),timeout=180)
            return [{k:v["value"] for k,v in b.items()} for b in json.load(r)["results"]["bindings"]]
        except Exception as e: print("retry",e,file=sys.stderr); time.sleep(5*(t+1))
    raise SystemExit("qlever failed")
if __name__=="__main__":
    for r in q(sys.stdin.read()): print(r)
