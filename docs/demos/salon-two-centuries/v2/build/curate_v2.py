"""Curate Western.Epic.md's 'Enlightenment & Romantic 1750-1900' branch into four wings. Inputs: raw/v2_*.json (QLever)."""
import json, re, sys, collections
OUT = sys.argv[1]
P = json.load(open('raw/v2_people.json')); L = json.load(open('raw/v2_links.json')); WK = json.load(open('raw/v2_work.json'))
W = json.load(open('raw/v2_works.json')); DT = {x['w'].rsplit('/', 1)[-1]: x for x in json.load(open('raw/v2_dates.json'))}
V1 = json.load(open(sys.argv[2]))
qid = lambda u: u.rsplit('/', 1)[-1]
yr = lambda s: int(s[:4])
def pt(s):
    m = re.match(r'POINT\(([-\d.]+) ([-\d.]+)\)', s); return (round(float(m.group(2)), 3), round(float(m.group(1)), 3)) if m else None
# Names from Western.Epic.md (Enlightenment & Romantic 1750-1900 branch), the field the chart puts them in
EPIC = {'letters': ['Voltaire', 'Jonathan Swift', 'Jane Austen', 'Charles Dickens', 'William Wordsworth', 'Samuel Taylor Coleridge', 'Percy Bysshe Shelley', 'Lord Byron', 'Honoré de Balzac', 'Gustave Flaubert', 'Leo Tolstoy'],
        'ideas': ['John Locke', 'David Hume', 'Jean-Jacques Rousseau', 'Montesquieu', 'Immanuel Kant', 'Georg Wilhelm Friedrich Hegel', 'Karl Marx', 'John Stuart Mill'],
        'music': ['Wolfgang Amadeus Mozart', 'Joseph Haydn', 'Ludwig van Beethoven', 'Franz Schubert', 'Frédéric Chopin', 'Pyotr Ilyich Tchaikovsky', 'Richard Wagner', 'Giuseppe Verdi', 'Antonín Dvořák', 'Edvard Grieg', 'Jean Sibelius'],
        'building': ['Antoni Gaudí', 'Gustave Eiffel', 'Joseph Paxton']}
epic_field = {n: g for g, ns in EPIC.items() for n in ns}
NOVEL = {'Fyodor Dostoyevsky', 'Victor Hugo', 'Johann Wolfgang von Goethe', 'Friedrich Schiller', 'Alexander Pushkin', 'Mark Twain', 'Edgar Allan Poe', 'Walt Whitman', 'Oscar Wilde', 'Hans Christian Andersen', 'Lewis Carroll'}
PREC = ['music', 'building', 'ideas', 'letters']
people = {}
for r in P:
    q = qid(r['a'])
    a = people.setdefault(q, {'id': q, 'name': r['al'], 'born': yr(r['b']), 'died': yr(r['d']), 'groups': set(), 'sitelinks': int(r['sl']), 'birth': None, 'death': None})
    a['groups'].add(r['group'])
    if r.get('bc') and not a['birth']: a['birth'] = (r['bpl'], pt(r['bc']))
    if r.get('dc') and not a['death']: a['death'] = (r['dpl'], pt(r['dc']))
for a in people.values():
    a['field'] = epic_field.get(a['name']) or ('letters' if a['name'] in NOVEL and 'letters' in a['groups'] else next(g for g in PREC if g in a['groups']))
    a['in_epic'] = a['name'] in epic_field
work = collections.defaultdict(list)
for r in WK:
    if r.get('wc'): work[qid(r['a'])].append((yr(r['s']) if r.get('s') else None, r['wl'], pt(r['wc'])))
cities = {}
for a in people.values():
    path = []
    if a['birth']: path.append([a['born'], a['birth'][0]]); cities.setdefault(a['birth'][0], a['birth'][1])
    for k, (s, n, c) in enumerate(sorted(set(work[a['id']]), key=lambda t: t[0] or 0)):
        y = max(a['born'] + 1, min(a['died'] - 1, s if s else a['born'] + 25 + k * 6)); path.append([y, n]); cities.setdefault(n, c)
    if a['death']: path.append([a['died'], a['death'][0]]); cities.setdefault(a['death'][0], a['death'][1])
    path.sort(key=lambda t: t[0]); a['path'] = [p for i, p in enumerate(path) if i == 0 or p[1] != path[i - 1][1]]
CAP = {'letters': 60, 'ideas': 45, 'music': 45, 'building': 40}
sel = []
for g in CAP:
    xs = sorted((a for a in people.values() if a['field'] == g and a['path'] and a['died'] >= 1700), key=lambda a: (not a['in_epic'], -a['sitelinks']))
    sel += xs[:CAP[g]]
ids = {a['id'] for a in sel}; v1ids = {a['id'] for a in V1['artists']}
links = set()
for r in L:
    s, o = qid(r['a']), qid(r['o'])
    if s != o and s in ids | v1ids and o in ids | v1ids and (s in ids or o in ids):
        links.add((o, s, 'influenced' if r['p'].endswith('P737') else 'taught'))
# works per field
works = []
for g, rows in W.items():
    seen = set()
    for r in sorted(rows, key=lambda r: -int(r['sl'])):
        w, a = qid(r['w']), qid(r['a'])
        if w in seen or (a not in ids and g != 'building'): continue
        if g in ('letters', 'ideas') and people[a]['field'] != g:   # a book lands in its author's wing
            continue
        d = DT.get(w, {}); typ = d.get('type', '')
        if g == 'building' and re.search(r'stadium|football|ground', (typ + r['wl']).lower()): continue
        date = d.get('pub') if g in ('letters', 'ideas') else (d.get('open') or d.get('inc') or d.get('pub'))
        date = date or r['d']; y = yr(date)
        if not (1700 <= y <= 1899): continue
        seen.add(w)
        works.append({'id': w, 'title': r['wl'], 'by': a, 'by_name': people[a]['name'] if a in people else '', 'field': people[a]['field'] if g in ('letters', 'ideas') else g, 'year': y,
                      'date_property': 'P577 publication' if (g in ('letters', 'ideas') and d.get('pub')) else ('P1619 opening' if d.get('open') else 'P571 inception'),
                      'type': typ, 'sitelinks': int(r['sl'])})
# The Eiffel Tower's architect (P84) is not one of the harvested people, so the building query missed it; added by id.
works.append({'id': 'Q243', 'title': 'Eiffel Tower', 'by': 'Q20882', 'by_name': 'Gustave Eiffel', 'field': 'building', 'year': 1889,
              'date_property': 'opened 31 Mar 1889 (Confirmed; added by hand)', 'type': 'lattice tower', 'sitelinks': 999})
WCAP = {'letters': 40, 'ideas': 24, 'music': 36, 'building': 30}
keep = []
for g in WCAP:
    keep += sorted([w for w in works if w['field'] == g], key=lambda w: -w['sitelinks'])[:WCAP[g]]
used = {c for a in sel for _, c in a['path']}
out = {'source': 'Wikidata via QLever (qlever.dev/api/wikidata), queried 2026-11-25; CC0',
       'chart': "hagopjay/gcloud.map Western.Epic.md, branch 'Enlightenment & Romantic 1750-1900' (ELIT, EPHIL, EMUSIC, ARCH_19)",
       'counts': {'people_harvested': len(people), 'people_shown': len(sel), 'epic_named_found': sum(a['in_epic'] for a in sel), 'epic_named_total': len(epic_field),
                  'links': len(links), 'links_cross_field': 0, 'works': len(keep), 'places': len(used)},
       'cities': {c: cities[c] for c in sorted(used)},
       'people': [{k: (sorted(v) if isinstance(v, set) else v) for k, v in a.items() if k not in ('birth', 'death')} for a in sel],
       'links': sorted(links), 'works': sorted(keep, key=lambda w: w['year'])}
fld = {a['id']: a['field'] for a in sel}; fld.update({a['id']: 'painting' for a in V1['artists']})
out['counts']['links_cross_field'] = sum(1 for a, b, k in links if fld.get(a) != fld.get(b))
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=0)
print(out['counts']); print(collections.Counter(a['field'] for a in sel)); print(collections.Counter(w['field'] for w in keep))
print('epic missing:', [n for n in epic_field if n not in {a['name'] for a in sel}])
for g in WCAP: print(g, [(w['title'], w['year']) for w in keep if w['field'] == g][:12])
