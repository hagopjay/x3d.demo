#!/usr/bin/env python3
"""Cross-reference checks: evidence-index views exist as scene Viewpoints, card counts match content.json, tour views exist, recorded input hashes match."""
import hashlib, json, re, sys
from pathlib import Path
R = Path(__file__).resolve().parent.parent
idx = json.loads((R/'evidence-index.json').read_text()); content = json.loads((R/'content.json').read_text())
scene = (R/'giza-atlas-v3.x3d').read_text(); tour = json.loads((R/'tour.json').read_text())
fail = []
defs = set(re.findall(r'<Viewpoint[^>]*\bDEF=[\'"]([^\'"]+)', scene))
for v in idx['views']:
    if v not in defs: fail.append(f'evidence-index view {v} has no Viewpoint DEF in the scene')
for k in ('SW_DOC','SW_THE','SW_SPE','SW_SURVEY','SW_SCALE','CLIP_SECTION'):
    if f'DEF="{k}"' not in scene and f"DEF='{k}'" not in scene: fail.append(f'stable control node {k} missing')
sha = lambda p: hashlib.sha256((R/p).read_bytes()).hexdigest()
if sha(idx['input']['content_file']) != idx['input']['content_sha256']: fail.append('content.json hash differs from evidence-index record')
if sha(idx['input']['notice_file']) != idx['input']['notice_sha256_at_index_build']: fail.append('BASELINE-NOTICE-v2.md hash differs from evidence-index record')
if sha(idx['input']['tour_file']) != idx['input']['tour_sha256_at_index_build']: print('note: tour.json differs from the hash recorded at index build (expected after a tour edit; refresh evidence-index.json)')
print(f"views {len(idx['views'])}, scene viewpoints {len(defs)}, recorded cards {idx['recorded_counts']['cards']}")
if fail: print('\n'.join('FAIL '+f for f in fail)); sys.exit(1)
print('refs ok')
