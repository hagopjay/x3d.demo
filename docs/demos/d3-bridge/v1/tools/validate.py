import sys, json, glob, os, hashlib
sys.path.insert(0, os.environ.get('X3D_MCP_SRC', '../../../../../../x3d_mcp/src'))
from validation.validate import validate_xml_with_hints
import lxml
out = {}
for p in sorted(glob.glob(os.path.join(sys.argv[1], 'scenes', '*.x3d'))):
    s = open(p, encoding='utf-8').read(); r = validate_xml_with_hints(s)
    out[os.path.basename(p)] = {'valid': r['valid'], 'schema': r.get('schema_version'), 'errors': r['errors'][:5], 'hints': r.get('hints', [])[:3], 'sha256': hashlib.sha256(s.encode()).hexdigest()}
    print(os.path.basename(p), r['valid'], r['errors'][:3])
json.dump({'validator': f"x3d_mcp validation.validate.validate_xml, lxml {lxml.__version__}, main fa5dccf", 'results': out}, open(os.path.join(sys.argv[1], 'receipt-xsd.json'), 'w'), indent=1)
print(sum(v['valid'] for v in out.values()), 'of', len(out), 'valid')
