"""Derive the swarm's stage-transition table from the recorded Gobbler.flyte sim tapes.

Input: x3d.gobbler flyte/runs/sim-*/tape.jsonl (five recorded sim days, no model calls; mode "sim").
Output: ../swarm/calibration.json (counts, probabilities, and the sha256 of every tape read).
Usage: python3 calibrate.py <path to x3d.gobbler/flyte/runs>
"""
import collections, glob, hashlib, json, os, re, sys

runs = sys.argv[1]
tapes = sorted(glob.glob(os.path.join(runs, 'sim-*/tape.jsonl')))
src, cyc = [], collections.defaultdict(list)
for f in tapes:
    b = open(f, 'rb').read()
    src.append({'file': os.path.relpath(f, os.path.dirname(runs.rstrip('/'))), 'rows': b.count(b'\n'), 'sha256': hashlib.sha256(b).hexdigest()})
    for line in b.decode().splitlines():
        r = json.loads(line)
        cyc[(f, r['cycle'])].append(r)

C = collections.Counter(); att = collections.Counter(); refusals = collections.Counter(); spend = []
for rows in cyc.values():
    C['cycles'] += 1
    sig = any(r['node'] == 'scout' and r['kind'] == 'signal' for r in rows)
    C['signal' if sig else 'no_signal'] += 1
    w = [r for r in rows if r['node'] == 'weaver' and r['kind'] == 'weave']
    if w: att[len(w)] += 1
    C['haiku_weaves'] += sum('Haiku wrote' in r['text'] for r in w)
    C['procedural_weaves'] += sum('procedural fallback' in r['text'] for r in w)
    for r in rows:
        t = r['text']
        if r['node'] == 'witness':
            if 'PASS' in t and 'REFUSED' not in t: C['witness_pass'] += 1
            m = re.search(r'REFUSED attempt \d+: (\w+)', t)
            if m: C['witness_refused'] += 1; refusals[m.group(1)] += 1
        if r['node'] == 'gobbler' and r['kind'] == 'council':
            for k in ('PROCEED', 'ASK', 'HOLD'):
                if '-> ' + k in t: C['council_' + k.lower()] += 1
        if r['node'] == 'keeper' and r['kind'] == 'commit': C['keeper_commit'] += 1
        if r['node'] == 'gobbler' and r['kind'] == 'close':
            m = re.search(r'spend \$([0-9.]+)', t)
            if m: spend.append(float(m.group(1)))
        if r['node'] == 'assayer': C['assayer_rows'] += 1
kinds = collections.Counter((r['node'], r['kind']) for rows in cyc.values() for r in rows)
n_att = sum(att.values())
out = {
    'source': src,
    'mode': 'sim (recorded; no live model calls)',
    'counts': dict(C),
    'weave_attempts_hist': {str(k): v for k, v in sorted(att.items())},
    'refusal_codes': dict(refusals.most_common()),
    'p': {
        'signal': C['signal'] / C['cycles'],
        'witness_pass_per_attempt': C['witness_pass'] / max(1, C['witness_pass'] + C['witness_refused']),
        'attempts': [att[1] / n_att, att[2] / n_att, att[3] / n_att],
        'council': [C['council_proceed'] / max(1, C['signal']), C['council_ask'] / max(1, C['signal']), C['council_hold'] / max(1, C['signal'])],
    },
    'spend_usd': {'cycles_with_spend': len(spend), 'mean': sum(spend) / max(1, len(spend)), 'max': max(spend or [0])},
    'node_kind_counts': {f'{a}.{b}': v for (a, b), v in sorted(kinds.items())},
}
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'swarm', 'calibration.json')
json.dump(out, open(dst, 'w'), indent=1)
print(json.dumps({k: out[k] for k in ('counts', 'weave_attempts_hist', 'p', 'spend_usd')}, indent=1))
