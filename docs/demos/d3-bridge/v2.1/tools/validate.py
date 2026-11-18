"""XSD + semantic gate for the d3-bridge scenes. Exit 0 all clean, 1 any invalid or semantic error, 2 empty or unexpected set.
Usage: python3 -I validate3.py <demo_dir> --x3d-mcp <path to x3d_mcp checkout> [--expect N]"""
import sys, json, glob, os, hashlib, subprocess, argparse
ap = argparse.ArgumentParser(); ap.add_argument('demo'); ap.add_argument('--x3d-mcp', required=True); ap.add_argument('--expect', type=int)
a = ap.parse_args()
sys.path.insert(0, os.path.join(a.x3d_mcp, 'src'))
from validation.validate import validate_xml_with_hints, XSD_PATHS
from validation.semantic import semantic_diagnostics
import lxml.etree as ET
git = lambda *c: subprocess.run(['git', '-C', a.x3d_mcp, *c], capture_output=True, text=True).stdout.strip()
commit, dirty = git('rev-parse', '--short', 'HEAD'), bool(git('status', '--porcelain'))
files = sorted(glob.glob(os.path.join(a.demo, 'scenes', '*.x3d')))
if not files or (a.expect and len(files) != a.expect):
    print(f'expected {a.expect} scenes, found {len(files)}'); sys.exit(2)
out, bad = {}, 0
for p in files:
    s = open(p, encoding='utf-8').read(); r = validate_xml_with_hints(s); sem = semantic_diagnostics(s)
    errs = [d for d in sem if d.level == 'error']; warns = [d for d in sem if d.level != 'error']
    ok = r['valid'] and not errs; bad += not ok
    out[os.path.basename(p)] = {'valid': r['valid'], 'schema': r.get('schema_version'), 'errors': r['errors'], 'hints': r.get('hints', []),
        'semanticErrors': [f'{d.check}: {d.message}' for d in errs], 'semanticWarnings': len(warns), 'sha256': hashlib.sha256(s.encode()).hexdigest()}
    print(os.path.basename(p), 'OK' if ok else 'FAIL', r['errors'][:2], [d.message for d in errs][:2], f'{len(warns)} warnings')
rec = {'validator': f"x3d_mcp validation.validate.validate_xml + semantic.semantic_diagnostics, commit {commit}{' (dirty)' if dirty else ''}",
       'xsd_sha256': hashlib.sha256(open(XSD_PATHS['4.0'], 'rb').read()).hexdigest(), 'lxml': ET.__version__, 'libxml2': '.'.join(map(str, ET.LIBXML_VERSION)),
       'passed': len(files) - bad, 'total': len(files), 'results': out}
json.dump(rec, open(os.path.join(a.demo, 'receipt-xsd.json'), 'w'), indent=1)
print(f'{len(files) - bad} of {len(files)} pass (XSD + semantic), validator {rec["validator"]}'); sys.exit(1 if bad else 0)
