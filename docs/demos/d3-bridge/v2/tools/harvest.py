"""Harvest real data for the D3 -> X3D bridge gallery, from the x3d.* repos themselves.

Everything is computed from local git clones and the X3D 4.0 X3DUOM; no author names,
emails or messages are kept (counts and timestamps only).
Usage: python3 -I harvest.py <repos_root> <uom_xml> <out.json>
"""
import json, os, subprocess, sys, collections, hashlib
from lxml import etree

root, uom_path, out = sys.argv[1:4]
REPOS = sorted(d for d in os.listdir(root) if d.startswith('x3d') and os.path.isdir(os.path.join(root, d, '.git')))

def git(repo, *a):
    return subprocess.run(['git', '-C', os.path.join(root, repo), *a], capture_output=True, text=True, check=True).stdout

data = {'repos': [], 'source': {}}
# 1. commits: unix author time per repo (counts + timestamps only)
commits = {}
for r in REPOS:
    ts = [int(x) for x in git(r, 'log', '--format=%at', 'HEAD').split()]
    commits[r] = sorted(ts)
    data['repos'].append({'name': r, 'head': git(r, 'rev-parse', '--short', 'HEAD').strip(), 'commits': len(ts)})
data['commits'] = commits

# 2. X3DUOM: node -> component, inheritance
uom = etree.parse(uom_path).getroot()
node_comp, inherit = {}, {}
for el in uom.iter('ConcreteNode', 'AbstractNodeType'):
    n = el.get('name'); ci = el.find('.//componentInfo'); ih = el.find('.//Inheritance')
    node_comp[n] = ci.get('name') if ci is not None else 'Core'
    inherit[n] = ih.get('baseType') if ih is not None else None
    if el.tag == 'ConcreteNode':
        node_comp.setdefault('__concrete__', None)
concrete = sorted(el.get('name') for el in uom.iter('ConcreteNode'))
data['uom'] = {'components': {n: node_comp[n] for n in node_comp if n != '__concrete__'}, 'inherit': inherit, 'concrete': concrete}

# 3. X3D node usage across every .x3d file in x3d.demo/docs/demos
demos_dir = os.path.join(root, 'x3d.demo', 'docs', 'demos')
files = []
usage = collections.defaultdict(collections.Counter)  # demo -> node -> count
for dp, dn, fn in os.walk(demos_dir):
    if 'vendor' in dp or 'node_modules' in dp: continue
    for f in fn:
        if not f.endswith('.x3d'): continue
        p = os.path.join(dp, f); rel = os.path.relpath(p, demos_dir)
        demo = rel.split(os.sep)[0]
        cnt = collections.Counter(); depth = 0; maxd = 0
        try:
            for ev, el in etree.iterparse(p, events=('start', 'end'), huge_tree=True, recover=True):
                if ev == 'start':
                    depth += 1; maxd = max(maxd, depth)
                    if isinstance(el.tag, str) and el.tag in node_comp: cnt[el.tag] += 1
                else:
                    depth -= 1; el.clear()
        except Exception as e:
            continue
        usage[demo].update(cnt)
        files.append({'path': rel, 'demo': demo, 'bytes': os.path.getsize(p), 'nodes': sum(cnt.values()),
                      'kinds': len(cnt), 'depth': maxd, 'types': sorted(cnt)})
data['x3d_files'] = files
data['usage'] = {d: dict(c) for d, c in usage.items()}

# 4. file tree of x3d.demo docs/demos (tracked files, bytes) and x3d.loom dirs
def tree(repo, prefix, maxdepth):
    out = git(repo, 'ls-files', '-z', *(['--', prefix] if prefix else [])).split('\0')
    t = {}
    for f in out:
        if not f: continue
        p = os.path.join(root, repo, f)
        if not os.path.isfile(p): continue
        parts = f[len(prefix):].strip('/').split('/')
        parts = parts[:maxdepth] if len(parts) > maxdepth else parts
        node = t
        for q in parts[:-1]: node = node.setdefault(q, {})
        leaf = parts[-1]
        if isinstance(node.get(leaf), dict): node = node[leaf]; leaf = '(files)'
        node[leaf] = node.get(leaf, 0) + os.path.getsize(p) if not isinstance(node.get(leaf), dict) else node[leaf]
    return t
data['demo_tree'] = tree('x3d.demo', 'docs/demos/', 3)
data['loom_tree'] = tree('x3d.loom', '', 3)
data['source'] = {'harvested_utc': subprocess.run(['date', '-u', '+%Y-%m-%dT%H:%MZ'], capture_output=True, text=True).stdout.strip(),
                  'uom': os.path.basename(uom_path), 'uom_sha256': hashlib.sha256(open(uom_path, 'rb').read()).hexdigest()[:16]}
json.dump(data, open(out, 'w'))
print(len(REPOS), 'repos', sum(len(v) for v in commits.values()), 'commits', len(files), 'x3d files', len(concrete), 'concrete nodes')
