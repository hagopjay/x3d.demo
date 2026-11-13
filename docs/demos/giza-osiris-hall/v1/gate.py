import sys, json, hashlib; sys.path.insert(0,'x3d_mcp/src')  # path to a checkout of the validator
from validation.validate import validate_xml
from validation.semantic import semantic_diagnostics
from validation.profile import check_profile
from lxml import etree
p=sys.argv[1]; s=open(p).read()
r=validate_xml(s); d=semantic_diagnostics(s)
root=etree.fromstring(s.encode()); pr=check_profile(root)
E=[x for x in d if x.level=='error']; W=[x for x in d if x.level=='warning']
res={'file':p.split('/')[-1],'ver':r.get('schema_version'),'profile':root.get('profile'),'bytes':len(s),'sha':hashlib.sha256(s.encode()).hexdigest()[:12],'xsd':r['valid'],'xsd_err':r.get('errors',[])[:5],'sem_total':len(d),'sem_e':len(E),'sem_w':len(W),'profile_ok':not getattr(pr,'violations',[]) if hasattr(pr,'violations') else str(pr)[:200]}
print(json.dumps(res)); [print(x) for x in d[:10]]
