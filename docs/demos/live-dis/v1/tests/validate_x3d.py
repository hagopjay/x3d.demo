#!/usr/bin/env python3
"""Validate the X3D files of this demo against the X3D 4.0 XML Schema with lxml.
Usage: python3 tests/validate_x3d.py /path/to/x3d-4.0.xsd
The schema is published by the Web3D Consortium at https://www.web3d.org/specifications/x3d-4.0.xsd (it imports
two small extension schemas that must sit beside it)."""
import glob, json, os, sys
from lxml import etree

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    schema = etree.XMLSchema(etree.parse(sys.argv[1]))
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    files = sorted(glob.glob(os.path.join(here, 'scene', '**', '*.x3d'), recursive=True) + glob.glob(os.path.join(here, 'tests', 'fixtures', '*.x3d')))
    out, bad = {}, 0
    for f in files:
        doc = etree.parse(f)
        ok = schema.validate(doc)
        names = [e.tag for e in doc.iter() if isinstance(e.tag, str)]
        out[os.path.relpath(f, here)] = {'valid': ok, 'errors': [str(e) for e in schema.error_log][:5],
            'dis_nodes': {t: names.count(t) for t in ('DISEntityManager', 'DISEntityTypeMapping', 'EspduTransform', 'TransmitterPdu', 'SignalPdu', 'ReceiverPdu')}}
        bad += 0 if ok else 1
    print(json.dumps({'instrument': 'lxml %s, X3D 4.0 XSD' % etree.__version__, 'files': out}, indent=1))
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
