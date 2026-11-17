#!/usr/bin/env bash
# All offline checks. Exit non-zero on the first failure. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$1"; }
step "JavaScript syntax"; for f in giza.js giza-core.js sky-math.js; do node --check "$f" && echo "ok $f"; done
step "Python syntax"; python3 -I -m py_compile serve.py build/*.py tests/*.py && echo ok
step "JSON parses"; for f in *.json build/*.json; do python3 -I -c "import json,sys;json.load(open(sys.argv[1]))" "$f" && echo "ok $f"; done
step "Node tests"; node --test tests/*.js
step "Python tests (includes byte-identical scene rebuild)"; python3 -I -m unittest discover -s tests
step "Evidence index and content cross-references"; python3 -I scripts/check_refs.py
step "Scene identity"; python3 -I - <<'P'
import hashlib,json
s=open('giza-atlas-v3.x3d','rb').read(); b=open('states.bin','rb').read()
print(len(s),hashlib.sha256(s).hexdigest()); print(len(b),hashlib.sha256(b).hexdigest())
r=json.load(open('validation-v3.json')) if __import__('os').path.exists('validation-v3.json') else None
if r: assert r['sha256']==hashlib.sha256(s).hexdigest(), 'validation-v3.json receipt is for different bytes: rerun make gate'; print('receipt matches scene bytes')
P
printf '\nALL OFFLINE CHECKS PASSED\n'
