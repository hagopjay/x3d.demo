import sys, collections, json, hashlib, subprocess
fork = '/home/claude/src/x3d_mcp'; sys.path.insert(0, fork + '/src')
from validation.validate import validate_xml
from validation import semantic
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
x = validate_xml(s); d = semantic.semantic_diagnostics(s)
c = collections.Counter(f"{getattr(g,'level','?')}:{getattr(g,'check','?')}" for g in d)
commit = subprocess.run(['git', '-C', fork, 'log', '-1', '--format=%h'], capture_output=True, text=True).stdout.strip()
rec = dict(file=p.split('/')[-1], sha256=hashlib.sha256(s.encode()).hexdigest(), validator=f'x3d_mcp fork {commit} (validate_xml + semantic)',
           xsd=x.get('schema_version'), xsd_valid=x['valid'], xsd_errors=x['errors'][:10], semantic=dict(c),
           notes=[f"{getattr(g,'level','')}: {str(getattr(g,'message',g))[:200]}" for g in d if getattr(g, 'level', '') != 'info'])
json.dump(rec, open(sys.argv[2], 'w'), indent=1); print(json.dumps({k: rec[k] for k in ('xsd', 'xsd_valid', 'xsd_errors', 'semantic', 'notes')}, indent=1))
