#!/usr/bin/env python3
"""Build ouro/data.json for Gobbler Gyroscope v5 (the Gobbler returns; v4 was the Ouroboros) from records, no model call, no network.

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

# --- v5: the lanes that feed the serpent. A curated table: every row names its evidence, and the build fails if a
# named path is missing. Grades: live = runs inside the recorded Gobbler graph; built = code and receipts in a public
# repo; touched = first evidence only; planned = on the frontier board with a written first step, not started;
# envisioned = named by the owner on 25 Nov 2026, nothing in the repos yet. `board` is a frontier id (rank is read
# from the board, a judged score: Suspected). `s` is where on the serpent the lane feeds in (fraction of a turn).
LANES = [
    # bridges and data, feeding the raw tail
    ('URDF',  'Robotics: URDF, MJCF, ROS bags', 'bridge', 0.045, 'touched', 'robotics', 'MuJoCo bridge reads MJCF; URDF is a written plan', ['x3d.loom:x3d.physics/mujoco-bridge/PLAN.md']),
    ('PHYS',  'Physics engines', 'bridge', 0.075, 'built', 'physics', 'PhysX and MuJoCo bridges, Rapier lab, a physics playbook', ['x3d.loom:PHYSICS-PLAYBOOK.md', 'x3d.loom:x3d.physics/README.md']),
    ('AEC',   'AEC and BIM through IFC', 'bridge', 0.105, 'planned', 'bim-ifc', 'first step written: one open building, 10 quantities against IfcOpenShell', ['x3d.gobbler:frontier/runs/frontier-2026-11-23/board.json']),
    ('BONSAI', 'Bonsai (Blender BIM)', 'bridge', 0.135, 'envisioned', None, 'named 25 Nov; nothing in the repos yet', []),
    ('USD',   'OpenUSD', 'bridge', 0.165, 'touched', 'openusd', 'the glass Gobbler leaves Blender as usdc; no conformance run yet', ['x3d.gobbler:mascot/glass/exports']),
    ('OMNI',  'Omniverse', 'bridge', 0.195, 'envisioned', None, 'named 25 Nov; nothing in the repos yet', []),
    ('glTF',  'Loom for glTF', 'bridge', 0.222, 'built', None, 'X3D semantics carried in KHR_xmp_json_ld packets', ['x3d.loom:LEARNINGS-loom-gltf.md', 'x3d.loom:formats/gltf/SPEC.md']),
    ('XRAY',  'x3d.xray: binaries as cities', 'bridge', 0.248, 'built', 'xray', 'binaries, code and captures as scenes, traceable to bytes', ['x3d.loom:LEARNINGS-xray-binary.md']),
    # structure
    ('ONTO',  'Ontology', 'structure', 0.290, 'built', 'onto-reason', 'ontology cross-validation in the validator fork; SHACL shapes for style', ['x3d_mcp:evaluation/cross_validate_ontology.py', 'x3d.loom:x3d.style/vocab/xst.shapes.ttl']),
    ('BLENDER', 'Blenderizer IO', 'structure', 0.340, 'built', None, 'x3d-blender-io is at 2.7.4 today; 4.0 is the named target', ['x3d-blender-io:source/blender_manifest.toml']),
    ('VALID', 'Validator (x3d_mcp fork)', 'structure', 0.392, 'built', None, 'the validator behind every number on this page', ['x3d_mcp:src/server.py']),
    # the gate
    ('INJECT', 'Adversarial injection through 3D files', 'gate', 0.436, 'planned', 'x3d-injection', 'untrusted-text guard exists; the 40 hostile scenes are not built', ['x3d.gobbler:flyte/gobbler_flyte/loom/untrusted.py']),
    ('CHAOS', 'Hostile files and chaos rounds', 'gate', 0.462, 'built', 'hostile-all', 'three chaos rounds against the Blender add-on; other readers not yet', ['x3d-blender-io:tools/chaos/hostile.py', 'x3d.loom:LEARNINGS-chaos-round-3-20261123.md']),
    ('ASSAY', 'The Assayer (AI Engineering Atlas)', 'gate', 0.492, 'live', None, '9 of 13 thesis checks on every recorded cycle', ['x3d.gobbler:flyte/gobbler_flyte/organs/assayer.py']),
    ('DSPy',  'DSPy and GEPA', 'gate', 0.520, 'touched', 'dspy-gepa', 'sweep and pilots done; the rule-proposer seam is built and switched off', ['x3d.loom:DSPY-SWEEP-2026-11-18.md', 'x3d.loom:kit/dspy_pilots']),
    # memory
    ('LOOM',  'x3d.loom, the memory', 'memory', 0.560, 'live', None, 'the Scout reads its commit log; every fold-back lands here', ['x3d.loom:LOOM-v1.md']),
    ('R2R',   'Receipt-to-rule engine', 'memory', 0.600, 'built', None, 'failure receipts become candidate rules, replayed against the add-on', ['x3d.loom:kit/loomkit/r2r/cli.py', 'x3d.loom:R2R.md']),
    ('RAG',   'Graph RAG over the Loom', 'memory', 0.640, 'planned', 'rag-loom', 'agent memory module exists; retrieval over the Loom is not built', ['x3d.gobbler:flyte/gobbler_flyte/memory.py']),
    ('MCP',   'The Loom as an MCP server', 'memory', 0.680, 'touched', 'mcp-loom', 'validator MCP server and an r2r command line exist; Loom tools not exposed', ['x3d_mcp:src/server.py', 'x3d.loom:kit/loomkit/r2r/cli.py']),
    # eyes
    ('VISION', 'Vision, OpenCV, picture judge', 'eyes', 0.712, 'touched', 'picture-judge', 'OpenCV used in one kit (posed depth to X3D); the picture judge is not calibrated', ['x3d.loom:grv-study/kit/atlas2x3d.py']),
    ('RENDER', 'Engine debugging and the render oracle', 'eyes', 0.786, 'built', 'cross-render', 'Vulkan validation layers in x3d.wgpu receipts; cross-engine oracle. Profiling: not yet', ['x3d.loom:LEARNINGS-wgpu-vvl.md', 'x3d.loom:LEARNINGS-render-oracle.md']),
    ('XR',    'XR and headsets', 'eyes', 0.808, 'touched', 'xr-headset', 'one XR scene (the lodge); no headset frame-time witness yet', ['x3d.loom:LEARNINGS-masonic-lodge-xr.md']),
    ('DEVTOOLS', 'Chrome DevTools MCP', 'eyes', 0.830, 'envisioned', None, 'headless Chrome rigs check every page today; the MCP is not wired', []),
    # hands
    ('SKILLS', 'Agentic Skills', 'hands', 0.856, 'envisioned', None, 'named 25 Nov; no skill files in the repos yet', []),
    ('GRAPH', 'LangGraph: the Gobbler graph', 'hands', 0.882, 'live', None, 'five organs, one graph; the recorded day is a sim day', ['x3d.gobbler:flyte/gobbler_flyte/gobbler.py']),
    ('HAIKU', 'Haiku weaver', 'hands', 0.906, 'touched', None, 'simulated in the record, zero model calls; live needs a typed spend OK', ['x3d.gobbler:flyte/gobbler_flyte/gobbler.py']),
    ('NVIDIA', 'NVIDIA build APIs', 'hands', 0.930, 'envisioned', None, 'named 25 Nov; no call has been made', []),
]

def build_lanes(root, board):
    ranks = {r['id']: r for r in board['rows']}
    out = []
    for k, name, group, s, grade, bid, fact, ev in LANES:
        for e in ev:
            repo, path = e.split(':', 1)
            if not (root / repo / path).exists(): raise SystemExit(f'lane {k}: evidence missing: {e}')
        b = ranks.get(bid) if bid else None
        if bid and not b: raise SystemExit(f'lane {k}: no frontier {bid}')
        out.append({'k': k, 'name': name, 'group': group, 's': s, 'grade': grade, 'fact': fact, 'evidence': ev,
                    'board': bid, 'rank': b['rank'] if b else None, 'board_status': b['status'] if b else None})
    return out

def build_activity(root, since):
    days = {}; total = {}
    for name in REPOS:
        repo = root / name; b = head_branch(repo)
        log = git(repo, 'log', f'origin/{b}', f'--since={since}T00:00:00+00:00', '--no-merges', '--format=%cs\t%s').splitlines()
        c = collections.Counter(l.split('\t')[0] for l in log if l)
        days[name] = dict(sorted(c.items())); total[name] = sum(c.values())
    return {'since': since, 'commits_by_day': days, 'commits': total, 'note': 'git log of each default branch, no merges'}

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
        log = git(repo, 'log', f'origin/{b}', f'--since={a.since}T00:00:00+00:00', '--no-merges', '--format=%cs\t%h\t%s')
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
        'schema': 'gobbler.ouroboros/2',
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
        'lanes': build_lanes(root, board), 'activity': build_activity(root, a.since),
        'fan': [{'id': r['id'], 'family': r['family'], 'status': r['status'], 'rank': r['rank'], 'title': r['title'][:70]} for r in sorted(frows, key=rank)],
        'board_counts': board['counts'], 'families': board['families'],
    }
    pathlib.Path(a.out).write_text(json.dumps(data, indent=1, sort_keys=True) + '\n')
    print('cycles', cycles, 'raw', raw_items, dict(swept), 'pulse', len(pulse), 'loom', counts)

if __name__ == '__main__':
    main()
