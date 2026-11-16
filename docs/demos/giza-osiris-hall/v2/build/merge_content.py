#!/usr/bin/env python3
"""Merge the research workflow output (after audit verdicts) with locally authored content into content.json.
usage: merge_content.py JOURNAL.jsonl LOCAL.json OUT_DIR [--log RESEARCH_LOG.md]
Research agents wrote in the first person; the page is impersonal, so a replacement table rewrites those phrases
and any leftover first-person pronoun is printed so it can be fixed by hand."""
import json, sys, os, re

journal, local_path, OUT = sys.argv[1:4]
logp = sys.argv[sys.argv.index('--log') + 1] if '--log' in sys.argv else None
research, audits = [], []
for line in open(journal):
    r = json.loads(line)
    if r['type'] != 'result' or not isinstance(r['result'], dict): continue
    v = r['result']
    if 'items' in v: research.append(v)
    elif 'verdicts' in v: audits.append(v)
verd = {}
for a in audits:
    for v in a['verdicts']: verd[v['id']] = v

VIEW_OVERRIDE = {'swimming-hole': 'V_Osiris', 'sphinx-causeway': 'V_Overview', 'passage-found-by-memory': 'V_Sunrise', 'subterranean-chamber-puzzle': 'V_Khufu',
  'subterranean-chamber-measurements': 'V_Khufu', 'alvarez-phantom-chamber': 'V_Overview', 'sphinx-erosion-mechanisms': 'V_Sunrise', 'sphinx-older-than-pharaohs': 'V_Sunrise',
  'cayce-radiocarbon-test': 'V_Overview', 'precession-clock': 'V_Orion', 'wandering-pole': 'V_Orion', 'orion-belt-altitude': 'V_Orion', 'orion-geometry-check': 'V_Orion',
  'orion-correlation-theory': 'V_Orion', 'leo-first-time-10500': 'V_Sunrise', 'zep-tepi-and-10500-bc': 'V_Orion', 'gpr-2018-2019-rsvp': 'V_Anomaly', 'tallest-structure': 'V_Overview',
  'merer-papyri': 'V_Overview', 'unopened-sarcophagus': 'V_Osiris', 'rostau-water-road': 'V_Osiris', 'secret-tunnels': 'V_Osiris', 'sphinx-openings-documented': 'V_Anomaly'}
VIEW_ORDER = ['V_Overview', 'V_Sunrise', 'V_Osiris', 'V_ChamberB', 'V_Depth', 'V_Anomaly', 'V_Hall', 'V_HallInside', 'V_Khafre', 'V_Khufu', 'V_Orion', 'V_Top']
REPL = [
 (r"No source I could open gives", "No source opened for this page gives"),
 (r"The only route to about 41 m that I found is", "The only route to about 41 m found in any source is"),
 (r"and I found no published survey linking any tunnel to this shaft", "and no published survey linking any tunnel to this shaft was found"),
 (r"; I found no text by either author treating the excavated shaft as confirmation", "; no text by either author treating the excavated shaft as confirmation was found"),
 (r"nothing I read shows it was excavated", "nothing opened for this page shows it was excavated"),
 (r"I found nothing excavated or published that supports", "nothing excavated or published was found that supports"),
 (r"I could not open the full text", "The full text could not be opened for this page"),
 (r"I could not open Waseda's own report", "Waseda's own report could not be opened for this page"),
 (r"and I could not view the official transcripts", "and the official transcripts could not be viewed"),
 (r"I could not view the official reading transcripts", "The official reading transcripts could not be viewed"),
 (r"I found no record of the tablets ever being produced for examination", "No record was found of the tablets ever being produced for examination"),
 (r"the coverage I read reports", "the coverage read for this page reports"),
 (r"; I found no passage where they propose", "; no passage was found in which they propose"),
 (r"I found no record of drilling to test the feature", "No record of drilling to test the feature was found"),
 (r"I found no record of drilling", "No record of drilling was found"),
 (r"no survey report I read describes", "no survey report opened for this page describes"),
 (r" \(my inference\)", " (an inference)"),
 (r"none of the sources I read reports", "none of the sources opened for this page reports"),
 (r"I could not verify it", "it could not be verified"),
 (r"which I could not verify", "which could not be verified"),
 (r"my own computation gives", "a computation made for this page gives"),
 (r"my own computation", "a computation made for this page"),
 (r"\bmy check gave\b", "a check gave"),
 (r"\(our assumption\)", "(an assumption made for this page)"),
 (r"is my reading of", "is a reading of"),
 (r"a figure I saw only in search summaries", "a figure seen only in search summaries"),
 (r"\(my check:", "(a check made for this page:"),
 (r"[Bb]y my computation", lambda m: ("By" if m.group(0)[0]=="B" else "by") + " a computation made for this page"),
 (r"the transcription I read", "the transcription opened for this page"),
 (r"my own calculation", "a calculation made for this page"),
 (r"\(both our assumptions\)", "(both assumptions made for this page)"),
]
def neutral(t):
    for a, b in REPL: t = re.sub(a, b, t)
    return t

DROP = {'osiris-depth-everyday': 'superseded: it used the unsourced 41.48 m; the reconciled depths are on the depth-ruler cards and one-fifth-of-a-pyramid',
        'khufu-dimensions': 'duplicate of khufu-khafre-dimensions (kept: Petrie survey, both pyramids)'}
items, dropped, fixed, seen = [], [], [], set()
for r in research:
    for it in r['items']:
        if it['id'] in seen: continue
        seen.add(it['id'])
        if it['id'] in DROP: dropped.append((it['id'], DROP[it['id']])); continue
        v = verd.get(it['id'])
        if v and v['verdict'] == 'drop': dropped.append((it['id'], v.get('problem', ''))); continue
        if v and v['verdict'] == 'fix':
            if v.get('fixed_body'): it['body'] = v['fixed_body']
            if v.get('fixed_rebuttal'): it['rebuttal'] = v['fixed_rebuttal']
            if v.get('fixed_grade'): it['grade'] = v['fixed_grade']
            fixed.append((it['id'], v.get('problem', '')))
        it['topic'] = r['topic']; items.append(it)
local = json.load(open(local_path))
for it in local['items']:
    if it['id'] in seen: raise SystemExit('duplicate id ' + it['id'])
    items.append(it)

def vkey(it):
    it['view'] = VIEW_OVERRIDE.get(it['id'], it.get('view'))
    v = it.get('view') if it.get('view') in VIEW_ORDER else 'V_Overview'
    it['view'] = v; return VIEW_ORDER.index(v)
items.sort(key=vkey)   # stable: keeps research order inside each view
for it in items:
    for k in ('body', 'rebuttal', 'title'):
        if k in it and it[k]: it[k] = neutral(it[k])
    for n in it.get('numbers', []):
        for k in ('label', 'value', 'source'): n[k] = neutral(n[k])

# Fixes the audit schema could not carry (it returns body, rebuttal and grade only): titles and number rows.
# Each is the audit pass's own wording of the correction, applied by hand and listed in the research log.
TITLE_FIXES = {
 'swimming-hole': "A swimming hole above the 'tomb of Osiris'",
 'gpr-2018-2019-rsvp': 'A 2019 radar look beside the Sphinx Temple',
 'medieval-sphinx-treasure-guide': 'A medieval treasure guide older than Cayce',
 'zep-tepi-and-10500-bc': 'Zep Tepi and the 10,500 BC claim',
 'north-face-corridor': 'North Face Corridor: a 9 m void sized by muons',
 'dixon-cedar-plank': 'The cedar plank rediscovered after 148 years',
 'gobekli-tepe-scale': 'Stone-age crowds moving multi-tonne stones',
 'tallest-structure': 'Tallest human-made structure for more than 3,700 years',
}
NUMBER_FIXES = {
 'orion-geometry-check': {
   'Khufu to Menkaure bearing and distance': dict(value='217.2 degrees (37.2 west of south), about 930 m', source='recomputed in the audit pass (WGS84) from Wikipedia pyramid coordinates (opened); Legon quotes 936.18 m from Petrie'),
   'Belt-line tilt from vertical at meridian, 10,500 BC': dict(value='about 50.3 to 50.4 degrees; shifts nearly 1 degree per century of epoch', source='recomputed in the audit pass with PyERFA long-term precession, by three methods'),
   'Belt-line tilt today': dict(value='about 52.9 degrees', source='recomputed as above')},
 'unopened-sarcophagus': {
   'Sarcophagus lid found on floor of Shaft C': dict(label='Sarcophagus lid found on the floor of Shaft C', value='lid 268 x 108 x 35 cm (the sarcophagus itself is 228 x 108 cm)')},
 'scale-of-the-search': {
   'Dobecki feature footprint': dict(value="9 x 12 m = 108 m2, buried less than 5 m (Dobecki's televised description); Hancock and Bauval, Chapter 12, put the same chamber at about 20 ft (about 6 m)"),
   'Anomaly top depth versus Sphinx height': dict(label='Reported depth versus Sphinx height', value='under 5 m / 20 m = under 25 percent; with the 20 ft (about 6 m) figure, about 30 percent (computed)')},
 'sphinx-erosion-mechanisms': {
   'Heavy rainfall persisted until': dict(label='Heavy rainfall persisted until (Welc and Marks suggest)')},
 'sphinx-older-than-pharaohs': {
   'Heavy rainfall persisted until': dict(label='Heavy rainfall persisted until (Welc and Marks suggest)')},
 'deep-time-gaps': {
   'Gobekli Tepe 9600 BC to Khufu': dict(label='Gobekli Tepe (9600 to 9500 BC) to Khufu', value='about 7,000 years (7,011 from 9600 BC; 6,911 from 9500 BC)', source='computed; 9600 to 8700 BC is the PPNA phase of the mound (Notroff et al. 2017, opened); Wikipedia puts the earliest exposed structures at 9500 to 9000 BC')},
 'younger-dryas-comet': {
   'Platinum spike duration and timing': dict(value='about 14 years; peak about 45 to 50 years after the onset of the Younger Dryas (onset dated 12,870 plus or minus 30 BP)')},
 'suppression-narrative': {
   'Radar survey of the Sphinx and temple floor': dict(label='GPR survey near the Sphinx Temple', value='March 2019, under Hawass and Lehner'),
   'Years the authors say official research was nearly absent': dict(label='Gap the authors describe ("since 1982", written in 1995)', value="about 13 years when they wrote; Lehner's letter, in their own appendix, says the 1982-dated survey was in fact 1978", source='Hancock and Bauval, Chapter 5 and Appendix 2')},
 'hall-of-amenti': {
   'Claimed discovery and translation': dict(label='Translation copy made', value='1925, per the preface', source='Doreal translation, preface; Wikipedia, Emerald Tablets of Thoth the Atlantean'),
   'Lovecraft stories cited as inspiration': dict(label='Stories cited as inspiration', value="'The Dunwich Horror' (Lovecraft, 1928); 'The Hounds of Tindalos' (Frank Belknap Long, 1929)")},
 'base-alignment': {
   'Average deviation (secondary)': dict(label='Average casing angle re-derived from the 1984 survey data', value='3 min 38 sec', source='Dash, AERAGRAM 13-2 (re-derived from the 1984 Lehner-Goodman survey); Wikipedia repeats it. Petrie\'s own best (casing-base) mean was 3 min 43 sec')},
 'casing-joints': {
   'Height lost with casing (computed)': dict(label='Height lost (casing, pyramidion and top stones; sources do not apportion it)', value='8.1 m', source='computed: 146.6 minus 138.5 m')},
 'merer-papyri': {
   'Crew size': dict(value='probably about 40 men under Inspector Merer (inferred from a monthly bread ration)'),
   'Date': dict(value='most likely the year after the 13th census of Khufu (Year 26; Wikipedia also gives Year 27), the last known year of his reign'),
   'Load per trip (secondary)': dict(value='perhaps 30 blocks of 2 to 3 t; about 200 blocks a month (extrapolated from pre-modern Nile boats; Tallet says the load size remains unknown)')},
 'khufu-boat': {
   'Length, three figures': dict(value='43.4 m (Wikipedia); 42 m (138 ft; 2021 news reports from the Egyptian side); about 43.6 m (143 ft; one maritime-news report, seen only in search summaries)')},
 'workers-town': {
   'Housing estimate': dict(label='Barracks capacity estimate', value='barracks could have accommodated 1,600 to 2,000 workers; about 600 buried in a nearby cemetery'),
   'Size in pitches (computed)': dict(source='computed: 70,000 divided by 7,140; Smithsonian gives no hectare figure, only "bigger than ten football fields" (American football)')},
 'aliens-trope': {
   "Merer's crew": dict(value='probably about 40 men')},
 'machining-trope': {
   'Stocks flatness target': dict(label='Flatness standard Stocks asks how the builders met', value='flat to about a hundredth of an inch; his experiments point to rods and string, with mud and gypsum cutting friction when moving blocks')},
}
applied = []
for it in items:
    if it['id'] in TITLE_FIXES: it['title'] = TITLE_FIXES[it['id']]; applied.append((it['id'], 'title', it['title']))
    for lab, ch in NUMBER_FIXES.get(it['id'], {}).items():
        hit = [n for n in it.get('numbers', []) if n['label'] == lab]
        if not hit: raise SystemExit('NUMBER_FIXES: no row %r in %s' % (lab, it['id']))
        for n in hit: n.update(ch)
        applied.append((it['id'], 'number', lab))
for k in list(NUMBER_FIXES) + list(TITLE_FIXES):
    if k not in seen: raise SystemExit('NUMBER/TITLE_FIXES names unknown id ' + k)

PRON = re.compile(r"\bI (could|found|read|did|used|took|treat|saw|checked|opened|have|had|am|would|think|inferred|favour|deliberately|omitted|computed|looked|tried|verified|claim|quote)\b|\b(my|mine|me)\b|\bwe\b|\bour\b", re.I)
left = []
for it in items:
    for k in ('body', 'rebuttal', 'title'):
        for m in re.finditer(r"[^.]*\.", it.get(k) or ''):
            if re.search(r"I am (not an Egyptologist|a technologist)", m.group(0)): continue   # Dunn quoted verbatim
            if PRON.search(m.group(0).replace("Our Research into", "")) and not re.search(r"\b(Hancock and Bauval|their|they) (my|our)", m.group(0)): left.append((it['id'], k, m.group(0).strip()[:220]))
    for n in it.get('numbers', []):
        for k in ('label', 'value', 'source'):
            if PRON.search(n[k]): left.append((it['id'], 'num.' + k, n[k][:160]))
for l in left: print('FIRST PERSON LEFT:', l)

notes = {r['topic']: r['notes'] for r in research}
bytes_ = os.path.getsize(os.path.join(OUT, 'giza-osiris-hall-v2.x3d'))
blob = json.dumps(dict(items=items, ledger=local['ledger'], invented=local['invented'], extra=local.get('extra', '')), ensure_ascii=False).replace('{{BYTES}}', f'{bytes_:,}')
open(os.path.join(OUT, 'content.json'), 'w').write(blob)
print(len(items), 'items;', len(dropped), 'dropped;', len(fixed), 'fixed;', len(left), 'first-person leftovers')
if logp:
    with open(logp, 'w') as f:
        f.write('# Giza v2 research log\n\nAgent-written notes from the research pass, kept as written (first person), plus what the audit pass changed. The page itself draws only on the cards and ledger in `content.json`.\n\n')
        f.write('## Audit pass\n\n| Card | Verdict | Problem found |\n|---|---|---|\n')
        for i, p in fixed: f.write('| %s | fixed | %s |\n' % (i, p.replace('|', '/').replace('\n', ' ')))
        for i, p in dropped: f.write('| %s | dropped | %s |\n' % (i, p.replace('|', '/').replace('\n', ' ')))
        f.write('\n## Corrections applied by hand after the audit (titles and number rows the audit schema could not carry)\n\n| Card | Kind | What |\n|---|---|---|\n')
        for i, k, w in applied: f.write('| %s | %s | %s |\n' % (i, k, w.replace('|', '/')))
        f.write('\n## Research notes by topic\n\n')
        for t, n in notes.items(): f.write('### %s\n\n%s\n\n' % (t, n))
