"""Mutation controls on my own records: each edit must be refused with its own code (kit physics witness)."""
import sys, json, copy
# usage: python3 -I mutate.py LOOM_KIT_DIR REPO_ROOT   (LOOM_KIT_DIR is x3d.loom/kit)
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from loomkit import physics
from loomkit.core import GateError
ROOT = Path(sys.argv[2]); recs = sorted((ROOT/'docs/demos/ten-minute-physics/v4/witness/records').glob('*.physics.json'))
base = {p.name: json.loads(p.read_text()) for p in recs}
def run(r, **kw):
    kw.setdefault('required_hosts', ['numpy-fresh-process']); return physics.check_run(r, ROOT, **kw)
out = []
def expect(name, code, mut, rec='tmp-ports-05'):
    key = [k for k in base if k.startswith('25-')][0] if rec == 'bead' else [k for k in base if k.startswith('11-')][0] if rec == 'cannon' else [k for k in base if k.startswith('17-')][0] if rec == 'pair' else [k for k in base if k.startswith('25-')][0]
    r = copy.deepcopy(base[key]); mut(r)
    try: run(r)
    except GateError as e:
        out.append(dict(control=name, expected=code, got=e.code, ok=e.code == code)); return
    out.append(dict(control=name, expected=code, got=None, ok=False))
def tamper(r): r['recorded']['hashes'][100] ^= 1
def drop_replay(r): r['replays'] = [x for x in r['replays'] if x['host'] != 'numpy-fresh-process']
def widen(r): r['references'][0]['limit'] *= 1e3
def false_green(r): r['references'][0]['observed'] = r['references'][0]['limit']*10; r['references'][0]['declared_limit'] = r['references'][0]['limit']*100; r['references'][0]['status'] = 'pass'
def ref_fail(r): r['references'][0]['observed'] = r['references'][0]['limit']*10; r['references'][0]['status'] = 'fail'
def drop_refs(r): r['references'] = []
def surviving(r): r['controls'][0]['observed_failed'] = False
def drift(r): r['replays'][0]['mismatches'] = 3; r['replays'][0]['first_mismatch'] = 7
def stale(r): r['model']['sha256'] = '0'*64
def steps(r): r['replays'][0]['steps'] = 5
def engine(r): r['replays'][0]['engine_version'] = 'numpy-0.0'
expect('edited step hash', 'PHYS_TRACE_TAMPERED', tamper, 'bead')
expect('replay host removed', 'PHYS_REPLAY_MISSING', drop_replay, 'cannon')
expect('limit widened after the fact', 'PHYS_LIMIT_WIDENED', widen, 'water')
expect('fail marked pass', 'PHYS_FALSE_GREEN', false_green, 'pair')
expect('reference misses its limit', 'PHYS_REFERENCE_FAIL', ref_fail, 'bead')
expect('no reference', 'PHYS_NO_REFERENCE', drop_refs, 'water')
expect('control that survives', 'PHYS_CONTROL_SURVIVED', surviving, 'pair')
expect('replay hash drift', 'PHYS_HASH_DRIFT', drift, 'cannon')
expect('scene changed under the record', 'PHYS_MODEL_STALE', stale, 'bead')
expect('replay of the wrong length', 'PHYS_REPLAY_STEPS', steps, 'water')
expect('engine version drift', 'PHYS_ENGINE_DRIFT', engine, 'pair')
print(json.dumps(out, indent=1)); print('caught', sum(o['ok'] for o in out), 'of', len(out))
Path(__file__).with_name('mutation-controls.json').write_text(json.dumps(dict(controls=out, caught=sum(o['ok'] for o in out), total=len(out)), indent=1))
