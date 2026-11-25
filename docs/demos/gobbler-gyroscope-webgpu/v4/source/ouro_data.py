#!/usr/bin/env python3
"""Build ouro/data.json for Gobbler Gyroscope v4 (the Ouroboros) from records, no model call, no network.

Reads sibling checkouts (pass --repos, the folder that holds them):
  x3d.gobbler  flyte/runs/sim-2026-11-18-r5 tape (the newest recorded sim day), its assay report, the frontier board,
               mascot/loom_counts.py (the counter the glass bird uses) and the glass render receipts
  x3d.loom     LOOM-v1.md (laws, failure modes), R2R facts quoted from LEARNINGS-r2r-engine.md are typed below with
               their source line
  and the default branch of each public repo listed in REPOS for the newest commit subjects (git log, local).
Every number in the output carries where it came from."""
import argparse, collections, hashlib, json, pathlib, re, subprocess, sys, tempfile

REPOS = ['x3d.gobbler', 'x3d.loom', 'x3d.demo', 'x3d.docs', 'x3d-blender-io', 'x3d_mcp', 'x3d.wgpu']

def git(repo, *a):
    return subprocess.run(['git', '-C', str(repo), *a], capture_output=True, text=True, check=True).stdout.strip()

def head_branch(repo):
    for b in ('main', 'gh-pages'):
        try:
            git(repo, 'rev-parse', '--verify', '-q', f'origin/{b}'); return b
        except subprocess.CalledProcessError: pass
    raise SystemExit(f'no default branch in {repo}')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--repos', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--since', default='2026-11-18'); a = ap.parse_args()
    root = pathlib.Path(a.repos); gob = root / 'x3d.gobbler'; loom = root / 'x3d.loom'
    run = gob / 'flyte/runs/sim-2026-11-18-r5'
    tape_bytes = (run / 'tape.jsonl').read_bytes()
    rows = [json.loads(l) for l in tape_bytes.decode().splitlines() if l.strip()]
    kinds = collections.Counter(r['kind'] for r in rows)
    cycles = kinds['open']

    # --- phase 1, raw: what the scout swept, and what it set aside
    swept = collections.Counter(); per_source = collections.Counter()
    for r in rows:
        if r['kind'] == 'sweep':
            for k, v in r['data']['counts'].items(): swept[k] += v
            for s in r['data']['per_source']: per_source[s['source']] += s.get('items', 0)
    raw_items = sum(swept.values())
    # --- phase 2, structured: proposals by action family, weave attempts
    actions = collections.Counter(); targets = collections.Counter()
    for r in rows:
        if r['kind'] == 'proposal': actions[r['data']['proposal']['action']] += 1
        if r['kind'] == 'foldback':
            m = re.search(r'for (\S+)', r['text']); targets[m.group(1) if m else '?'] += 1
    assay = json.loads((run / 'assay-report.json').read_text())
    # --- sample lines, verbatim from the tape (text field only), for the page's tail feed
    def lines(kind, n):
        out = []
        for r in rows:
            if r['kind'] == kind and len(out) < n: out.append({'cycle': r['cycle'], 'node': r['node'], 'text': r['text'][:150]})
        return out
    samples = {k: lines(k, 10) for k in ('signal', 'namesake', 'verdict', 'commit', 'foldback', 'assay', 'ask')}

    # --- Loom counts through the bird's own counter
    with tempfile.TemporaryDirectory() as td:
        out = pathlib.Path(td) / 'counts.json'
        subprocess.run([sys.executable, str(gob / 'mascot/loom_counts.py'), '--loom', str(loom), '--out', str(out)], check=True, capture_output=True)
        counts = json.loads(out.read_text())
    loom_branch = head_branch(loom)

    # --- frontier board, first five of the balanced ranking (ranks are judged scores: Suspected)
    board = json.loads((gob / 'frontier/runs/frontier-2026-11-23/board.json').read_text())
    frows = board['rows']
    def rank(r):
        for k in ('rank_balanced', 'rank'):
            if k in r: return r[k]
        return (r.get('ranks') or {}).get('balanced', 999)
    top = sorted(frows, key=rank)[:6]
    frontiers = [{'id': r.get('id'), 'title': r.get('title') or r.get('name'), 'rank': rank(r)} for r in top]

    # --- the project's own newest work: commit subjects on default branches (public repos only)
    pulse = []
    for name in REPOS:
        repo = root / name; b = head_branch(repo)
        log = git(repo, 'log', f'origin/{b}', f'--since={a.since}', '--no-merges', '--format=%cs\t%h\t%s')
        for l in log.splitlines()[:14]:
            d, h, s = l.split('\t', 2)
            if re.search(r'claude\.ai|session_', s): continue
            pulse.append({'repo': name, 'date': d, 'sha': h, 'subject': s[:140]})
    pulse.sort(key=lambda p: p['date'], reverse=True)
    heads = {name: git(root / name, 'rev-parse', '--short', f'origin/{head_branch(root / name)}') for name in REPOS}

    # --- Blender sci-viz: what the lens has really rendered so far (by hand, not yet as a running organ)
    br = json.loads((gob / 'mascot/glass/stills/blender-render.json').read_text())
    spin = json.loads((gob / 'mascot/glass/spin/blender-spin.json').read_text())

    data = {
        'schema': 'gobbler.ouroboros/1',
        'sources': {'tape': 'x3d.gobbler flyte/runs/sim-2026-11-18-r5/tape.jsonl', 'tape_sha256': hashlib.sha256(tape_bytes).hexdigest(),
                    'tape_rows': len(rows), 'heads': heads, 'note': 'recorded sim day: fixtures for feeds, simulated Haiku, zero model calls'},
        'cycle': {
            'cycles': cycles, 'raw_items': raw_items, 'raw_by_class': dict(swept), 'raw_by_source': dict(per_source),
            'namesakes_set_aside': kinds['namesake'], 'signals': kinds['signal'], 'proposals': kinds['proposal'],
            'weaves': kinds['weave'], 'verdicts': kinds['verdict'], 'refused': sum(assay['refusal_codes'].values()),
            'asks': kinds['ask'], 'commits': kinds['commit'], 'foldbacks': kinds['foldback'], 'assays': kinds['assay'],
            'actions': dict(actions), 'foldback_targets': dict(targets),
        },
        'assayer': {'checks': assay['checks'], 'stops': assay['stops'], 'first_attempt_admission_rate': assay['turns']['first_attempt_admission_rate'],
                    'theses_total': 13, 'checks_live': len(assay['checks']), 'atlas': 'AI Engineering Atlas rev 28 (pinned in x3d.gobbler flyte/atlas)',
                    'not_tested': ['T5 judge validity (no model judge yet)', 'T9 swarms (one demiurge)', 'T4 same-signal reliability (needs repeated trials)', 'T12 is the stop-the-line itself']},
        'loom': {'counts': counts, 'head': git(loom, 'rev-parse', '--short', f'origin/{loom_branch}'),
                 'r2r': {'candidate_rules': 28, 'confirmed': 15, 'audit_predictions_right': 265, 'audit_wrong': 0, 'closed_on_addon_2_7_4': 25, 'still_live': 0,
                         'source': 'x3d.loom LEARNINGS-r2r-engine.md and R2R.md (23 Nov 2026 runs)'}},
        'frontiers': frontiers, 'frontiers_note': 'balanced ranking of the 23 Nov board; ranks are judged scores (Suspected), talk in tiers',
        'sciviz': {'status': 'staged: runs by hand today, not yet an organ of the graph',
                   'blender': br['blender'], 'engine': br['engine'] + ' ' + br['device'], 'stills': len(br['renders']), 'still_samples': br['samples_max'],
                   'spin_frames': spin['frames'], 'spin_samples': spin['samples_max'], 'addon': 'x3d-blender-io 2.7.4',
                   'baked_faces': 11616, 'baked_note': 'Gobbler 6.2: Cycles light baked to one colour per face (x3d.gobbler mascot/baked)', 'source': 'x3d.gobbler mascot/glass (stills/blender-render.json, spin/blender-spin.json)'},
        'samples': samples, 'pulse': pulse[:60], 'pulse_since': a.since,
    }
    pathlib.Path(a.out).write_text(json.dumps(data, indent=1, sort_keys=True) + '\n')
    print('cycles', cycles, 'raw', raw_items, dict(swept), 'pulse', len(pulse), 'loom', counts)

if __name__ == '__main__':
    main()
