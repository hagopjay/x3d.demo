#!/usr/bin/env python3
"""Locally authored content for Giza v2 (method items, ledger, invented list).
Numbers marked COMPUTED were produced in this build (scripts in this folder).
usage: local_content.py OUT.json [KHUFU_ROWS.json]"""
import json, sys, os

H = os.path.dirname(os.path.abspath(__file__))
O = lambda label, url: dict(label=label, url=url, opened=True)     # opened and read
N = lambda label, url: dict(label=label, url=url, opened=False)    # not opened: recalled or summary

HAWASS = O('Hawass 2007, CASAE 36 (full text read)', 'https://d1g9lvwdq3dcse.cloudfront.net/images/MFA-images/Giza/GizaImage/full/library/hawass_fs_oconnor.pdf')
HASSAN = O('Hassan 1944, Excavations at Giza V (text read)', 'https://gizapyramids.org/static/pdf%20library/hassan_giza_5.pdf')
WP_GP = O('Wikipedia, Great Pyramid of Giza', 'https://en.wikipedia.org/wiki/Great_Pyramid_of_Giza')
WP_SPH = O('Wikipedia, Great Sphinx of Giza', 'https://en.wikipedia.org/wiki/Great_Sphinx_of_Giza')
WP_CX = O('Wikipedia, Giza pyramid complex (coordinates)', 'https://en.wikipedia.org/wiki/Giza_pyramid_complex')
WP_KH = O('Wikipedia, Pyramid of Khafre (coordinates via REST summary)', 'https://en.wikipedia.org/wiki/Pyramid_of_Khafre')
WP_MK = O('Wikipedia, Pyramid of Menkaure (coordinates via REST summary)', 'https://en.wikipedia.org/wiki/Pyramid_of_Menkaure')
STARS = O('x3d-blender-io brag page star catalogue', 'https://github.com/hagopjay/x3d-blender-io/blob/main/docs/brag/stars.json')
SESAME = O('CDS Sesame name resolver (queried through astropy)', 'https://cds.unistra.fr/cgi-bin/Sesame')
LTPB = N('ERFA ltpb (long-term precession matrix)', 'https://github.com/liberfa/erfa')
VONDRAK = N('Vondrak, Capitaine and Wallace 2011, A&A 534, A22', 'https://doi.org/10.1051/0004-6361/201117274')
DOLPHIN = O('Dolphin, geophysical studies around the Sphinx (1978)', 'https://www.ldolphin.org/egypt/sphinx.html')
HB = O('Hancock and Bauval, The Message of the Sphinx (archive.org text)', 'https://archive.org/stream/themessageofthesphinx.aquestforthehiddenlegacyofmankindbygrahamhancockrobertbauval/The%20Message%20of%20the%20Sphinx.%20A%20Quest%20for%20the%20Hidden%20Legacy%20of%20Mankind%20by%20Graham%20Hancock%2C%20Robert%20Bauval_djvu.txt')
HERO = O('Herodotus 2.124-126, Rawlinson (Wikisource)', 'https://en.wikisource.org/wiki/The_History_of_Herodotus_(Rawlinson)/Book_2')
CRX = O('Dobecki and Schoch 1992, Geoarchaeology 7(6) (Crossref abstract)', 'https://api.crossref.org/works/10.1002/gea.3340070603')
PETRIE7 = O('Petrie 1883, ch. 7, Inside of the Great Pyramid (transcription mirror)', 'https://www.rombergintegrali.org/gizapiramitleri/Pyramids_and_Temples_of_Gizeh/c7.html')
ARXIV = O('Morishima et al. 2017 manuscript, arXiv 1711.01576', 'https://arxiv.org/abs/1711.01576')
NFC = O('Procureur et al. 2023, Nature Communications 14:1144 (PMC)', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9981702/')
WP_OCT = O('Wikipedia, Orion correlation theory', 'https://en.wikipedia.org/wiki/Orion_correlation_theory')
LEGON = O('Legon 1995, The Orion Correlation and Air-Shaft Theories', 'https://www.hallofmaat.com/?p=648')
RW648 = O('Retraction Watch, 31 Aug 2026', 'https://retractionwatch.com/2026/08/31/retraction-corridors-inside-great-pyramid-giza/')
RECEIPT_STATES = O('states.json (bake receipts, this build)', 'states.json')
RECEIPT_BAKE = O('build/bake.py (the Blender script)', 'build/bake.py')
RECEIPT_VAL = O('validation.json (validator receipt)', 'validation.json')

items = []
def item(id, lens, view, title, body, grade, numbers=None, sources=None, rebuttal=None):
    d = dict(id=id, lens=lens, view=view, title=title, body=body, grade=grade, numbers=numbers or [], sources=sources or [])
    if rebuttal is not None: d['rebuttal'] = rebuttal
    items.append(d)
def num(label, value, source): return dict(label=label, value=value, source=source)

# ---------------- TECHNICAL: method ----------------
item('m-frame', 'technical', 'V_Top', 'Where things are: the frame, and how far to trust it',
 "Above ground, everything sits on a metre grid with the Sphinx at the origin, x pointing east, z south and y up. The three pyramids are placed from their published coordinates, so their bearing and spacing are real to within the rounding of those coordinates, which are given to the arcsecond (about 31 m north-south and 27 m east-west). Underground, depths follow the published lengths, but where each chamber sits in plan, how it is oriented and how big the imagined Hall is are drawn for clarity, not surveyed.",
 'Likely',
 [num('Khufu from the Sphinx', '330 m west, 430 m north', 'COMPUTED from Wikipedia coordinates, arcsecond rounding'),
  num('Khafre from the Sphinx', '650 m west, 90 m north', 'COMPUTED, same'),
  num('Menkaure from the Sphinx', '890 m west, 310 m south', 'COMPUTED, same'),
  num('Khufu to Khafre, Khafre to Menkaure', '468 m and 469 m', 'COMPUTED from the drawn centres'),
  num('One degree of longitude at 29.975 N', '96.4 km', 'COMPUTED'),
  num('Position error of any one pyramid', 'up to about 15 m', 'half an arcsecond of rounding')],
 [WP_CX, WP_KH, WP_MK, WP_GP])

item('m-light', 'technical', 'V_Sunrise', 'How the light was made: real Cycles bakes, not a painted gradient',
 "The surface shading is not a hand-made gradient. Blender's Cycles path tracer lit the pyramids, Sphinx, causeway and ground once per time of day, sun plus a physical sky, with real cast shadows and real bounce light, and each result was stored as vertex colour. The page swaps between the stored sets, so moving the light slider costs nothing at run time. The trade is that the light is fixed to those states: the X-ray and layer sliders do not re-light anything, and the starlight state is the albedo dimmed to a blue night tone, not a bake.",
 'Confirmed',
 [num('Renderer', 'Blender 5.2.2 LTS, Cycles, CPU', 'states.json receipt'),
  num('Samples per state', '192', 'receipt'),
  num('Sunrise sun', 'azimuth 90, elevation 7 degrees, 5.0 strength', 'receipt'),
  num('Midday sun', 'azimuth 165, elevation 62 degrees', 'receipt'),
  num('Late afternoon sun', 'azimuth 250, elevation 22 degrees', 'receipt'),
  num('Sky', 'Multiple Scattering, strength 0.25', 'receipt'),
  num('Bake time', '17 to 26 s each', 'receipt'),
  num('Vertices lit', '42,536 across 10 meshes x 4 states = 510,432 bytes', 'states.bin size'),
  num('Script fingerprint', 'sha256 2ca5c251...', 'states.json')],
 [RECEIPT_STATES, RECEIPT_BAKE])

item('m-sky', 'technical', 'V_Orion', 'How the sky was made: catalogue, frame, precession',
 "The page reuses the star catalogue from the x3d-blender-io demo page: 978 stars from the HYG database, the real directions of the neighbours within 50 light-years. Those are a faint, true-direction field, not the naked-eye sky, so 41 bright named stars (Orion, Leo, the Plough, Sirius, Arcturus and others) were added from Sesame coordinates, with stick figures for three constellations. The catalogue frame was matched to the sky with one rotation fitted on Sirius and Procyon, and eleven other named stars land within 0.16 degrees of where they should. Precession uses the long-term Vondrak model in 100-year steps from 13,000 BC to 2100 AD; alt-azimuth follows from Giza's latitude and the sidereal hour you set. Proper motion is ignored, which is harmless for Orion's belt (under 0.1 degrees over 12,000 years) but not for near, fast stars: Arcturus is off by about 8 degrees at 10,500 BC and Sirius by about 4.",
 'Likely',
 [num('Field stars', '978 (HYG v4.1, within 50 ly)', 'stars.json source note'),
  num('Named stars added', '41', 'Sesame ICRS J2000'),
  num('Frame fit check', '11 stars within 0.16 degrees (worst: Proxima Centauri 0.16)', 'COMPUTED'),
  num('Epochs', '152, from -13,000 to +2,100 in steps of 100 years', 'build/stars_build.py'),
  num('Orion belt culminates at', '58 to 60 deg (2000 AD), 45 deg (2600 BC), 9 to 11 deg (10,500 BC)', 'COMPUTED, altitude 90 - latitude + declination'),
  num('Refraction', 'ignored (about 0.5 degrees at the horizon)', 'omitted')],
 [STARS, SESAME, LTPB, VONDRAK])

item('m-orion-numbers', 'technical', 'V_Orion', 'Two more Orion checks: the kink, and the mirror',
 "The Orion Correlation says Khufu, Khafre and Menkaure repeat Alnitak, Alnilam and Mintaka. Beyond the tilt check in the Contested lens, these are three numbers anyone can recompute. Both patterns are three nearly equally spaced points with a slight kink, but the kinks differ: the belt bends 7.5 degrees off straight at Alnilam, the pyramids about 12.5 degrees at Khafre. The pyramid coordinates are rounded to the arcsecond, which moves that bend by several degrees (95 per cent of random roundings land between 163 and 172), and the belt's value is reached in only about 2 per cent of them, so the pyramids' kink really does look sharper. Each published coordinate may also point at a slightly different spot on its pyramid, so read this as a hint of a mismatch, not a measurement of one. Two more checks: the belt's two gaps differ by 2 per cent where the pyramids' differ by 0.1 per cent, and the kinks bend in opposite senses if both are drawn with east to the right, so the correlation needs the sky mirrored, east to the left as you see it looking south.",
 'Likely',
 [num('Alnitak to Alnilam', '1.356 degrees', 'COMPUTED, J2000 coordinates, tangent plane at Alnilam'),
  num('Alnilam to Mintaka', '1.386 degrees', 'COMPUTED'),
  num('Belt interior angle at Alnilam', '172.5 degrees', 'COMPUTED'),
  num('Pyramid interior angle at Khafre', '167.5 degrees (95% range 162.9 to 172.3; the belt value is reached in 2% of draws)', 'COMPUTED, Monte Carlo over arcsecond rounding, 200,000 draws'),
  num('Gap ratio, belt', '1.022', 'COMPUTED'),
  num('Gap ratio, pyramids', '1.001', 'COMPUTED'),
  num('Handedness, east to the right', 'belt turns one way, pyramids the other', 'COMPUTED, sign of the cross product')],
 [SESAME, WP_CX, WP_KH, WP_MK, WP_OCT])

item('m-validation', 'technical', 'V_Overview', 'The scene is checked, not just drawn',
 "The whole world is one X3D 4.0 file in the Immersive profile, generated by script and checked by the x3d_mcp validator (XSD 4.0, semantic rules and profile conformance) before the page ever loads it. Vertex colours are UnlitMaterial colours below 1 because X_ITE draws them unlit; star points need the Shape level 5 component, which the validator caught when a first build left it out. The file is the same one the browser draws, so what the validator passed is what you are looking at.",
 'Confirmed',
 [num('Validator', 'x3d_mcp main 13121b6', 'validation.json'),
  num('XSD 4.0, semantic, profile', 'valid, 0 errors', 'validation.json'),
  num('Scene size', '{{BYTES}} bytes', 'file on disk'),
  num('Renderer', 'X_ITE 16.6.0 (vendored)', 'vendor/x_ite/')],
 [RECEIPT_VAL])

# ---------------- WONDER ----------------
item('sphinx-sunrise', 'wonder', 'V_Sunrise', 'The sun walks straight down the lion\'s gaze',
 "The Sphinx faces due east, so on the equinoxes the sun rises exactly along its line of sight. Choose Equinox sunrise: the light comes in low (the baked sun is 7 degrees up, about half an hour after sunrise at Giza's latitude), and at that angle a 20 m lion throws a shadow more than 160 m long, back across the enclosure toward the pyramids. The builders did not need a calendar to know the sun's path; the stone does it for them.",
 'Likely',
 [num('Sphinx length, height', '73 m, 20 m', 'Wikipedia (AERA gives 72 m)'),
  num('Equinox sunrise azimuth', '90 degrees, due east', 'astronomy'),
  num('Shadow of a 20 m object at 7 degrees', '163 m', 'COMPUTED, 20 / tan 7 degrees'),
  num('Time from sunrise to 7 degrees', 'about 32 minutes at latitude 30', 'COMPUTED')],
 [WP_SPH])

# ---------------- CONTESTED: the page's own invention ----------------
item('one-system', 'contested', 'V_Anomaly', 'The "one system" idea: everything is connected underground',
 "In popular retellings the Hall of Records under the paw, the Osiris Shaft, the Great Pyramid's chambers and the deep shafts claimed under Khafre are parts of one planned underground complex, joined by tunnels, with Herodotus's account of a tomb on an island ringed by Nile water as supporting colour. The glowing network on this page draws that idea, with three pulses travelling along it.",
 'Suspected',
 [num('Links between these places found by any source opened for this page', '0', 'none of the sources listed on this page reports one')],
 [HERO, HAWASS, HB],
 rebuttal="The network is the page's own illustration of the claim, not a map of anything. The excavators describe the Osiris Shaft as a closed three-level complex reached from above, not a junction; the 1991 survey's anomaly has never been drilled or opened; the Great Pyramid's void is measured inside the pyramid; the Khafre claim is unpublished. Each of the five places is a separate question with a separate evidence file, and joining them multiplies unknowns instead of adding support. Herodotus's island tomb (2.124) is a report about Khufu's tomb heard from priests, which the Osiris Level 3 island chamber resembles, but resemblance is not a link. Treat the glowing lines as a picture of the question 'what if', not of an answer.")

# ---------------- LEDGER ----------------
D, T, S = 'D', 'T', 'S'
def link(label, url): return '<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>' % (url, label)
L = [
 dict(tier=D, what='Osiris Shaft: Shaft A 9.62 m, Shaft B 13.25 m, Shaft C 7.50 m', basis='%s: measured lengths; Hassan 1944 gives about 10 m for Shaft C (datum or flooding may explain).' % link('Hawass 2007, CASAE 36', HAWASS['url']), grade='Confirmed'),
 dict(tier=D, what='Chamber A: 8.60 m long, up to 3.85 m wide, up to 2.70 m high (floor not level)', basis='%s. Orientation in the drawing is schematic: the text puts Chamber B\'s long axis north-south.' % link('Hawass 2007', HAWASS['url']), grade='Confirmed'),
 dict(tier=D, what='Chamber B 6.80 x 3.65 x 2.60 m with side chambers (drawn: six, C to H)', basis='%s. Hassan counted seven burial chambers in 1944.' % link('Hawass 2007', HAWASS['url']), grade='Confirmed'),
 dict(tier=D, what='Level 3, Chamber I: walls 8.60 to 9.20 m, water-filled trench round a rock-cut emplacement (walls 5.24 to 6.04 m, drawn 5.8), four pillar stumps about 1.5 m square, basalt sarcophagus 228 x 108 cm', basis='%s: trench generally water-filled, shaped like the house hieroglyph; chamber pumped in 1999. Heights are drawn.' % link('Hawass 2007', HAWASS['url']), grade='Confirmed'),
 dict(tier=D, what='Osiris Shaft position: Shaft A directly under Khafre\'s causeway, about halfway from the Sphinx to the funerary temple (drawn 223 m west of the Sphinx, on the causeway centre line)', basis='%s p. 381: the entrance lies in the floor of a shallow N-S tunnel under the causeway, 10.30 m from its south end and 0.60 m from the west wall. The tunnel and the exact metre are this model\'s.' % link('Hawass 2007, CASAE 36', HAWASS['url']), grade='Confirmed (location in words); drawn position Likely'),
 dict(tier=D, what='Depth ruler: 29.9 / 30.37 / ~33 / 35.45 m, and 41.48 m flagged', basis='29.9 m = 98 ft (Reuters 2000); 30.37 m = 9.62+13.25+7.50 summed here; ~33 m = Hassan rounded; 35.45 m = deepest label read from Hawass Fig. 2 at 300 dpi; 41.48 m was in no source opened. Whiting 2021 could not be opened.', grade='Likely (35.45 read from a scan)'),
 dict(tier=D, what='Pyramid positions: Khufu, Khafre, Menkaure and the Sphinx origin', basis='%s, %s, %s (coordinates to the arcsecond, so up to about 15 m each).' % (link('Giza complex', WP_CX['url']), link('Khafre', WP_KH['url']), link('Menkaure', WP_MK['url'])), grade='Likely'),
 dict(tier=D, what='Pyramid sizes: Great Pyramid base 230.33 m, 138.5 m today (146.6 m original); Khafre base 215.25 m, 136.4 m today (143.5 m original), drawn at 143.5 m; Menkaure base about 103 m, 65.5 m original (61 m today)', basis='%s infobox; %s and %s infoboxes and text; Petrie measured 230.35 m and 215.26 m by hand in the 1880s. Khafre stands on bedrock about 10 m higher than Khufu, so its summit really is the higher; the ground here is flat, and drawing Khafre at its original 143.5 m keeps that skyline order.' % (link('Great Pyramid', WP_GP['url']), link('Khafre', WP_KH['url']), link('Menkaure', WP_MK['url'])), grade='Likely'),

 dict(tier=D, what='Great Pyramid descending passage: door 16.97 m above the pavement, 13.31 m inside the north casing edge, 7.29 m east of the axis, slope 26 deg 31 min, about 105 m to the Subterranean Chamber', basis='%s (668.2 in up, 524.1 in in, 287.0 in east; slope and length from his tables). v1 of this page drew it on the west side; corrected.' % link('Petrie 1883, ch. 7', PETRIE7['url']), grade='Confirmed'),
 dict(tier=D, what='Subterranean Chamber: about 14.0 x 8.3 m plan, roof about 26.8 m, floor about 30 to 32 m below the pavement (plan position drawn)', basis='Petrie (table garbled in the transcription, so approximate); Wikipedia gives 8.4 x 14.1 m, about 4 m high, about 27 m below the base; NOVA gives 30 m. The values may be roof versus floor.', grade='Likely'),
 dict(tier=D, what='Grand Gallery: 46.7 m long, about 26 deg slope (plan position drawn)', basis='%s, reference sizes.' % link('arXiv 1711.01576', ARXIV['url']), grade='Likely'),
 dict(tier=D, what='King\'s Chamber 10.47 x 5.23 m in plan, long axis east-west (height drawn 5.85 m)', basis='Plan from %s (north wall 412 in, end wall 206 in); height recalled, not re-opened. v1 drew the long axis north-south; corrected.' % link('Petrie 1883, ch. 7', PETRIE7['url']), grade='Confirmed (plan); Suspected (height)'),
 dict(tier=D, what='Queen\'s Chamber 5.75 x 5.23 m, gable peak 6.23 m', basis='Petrie\'s table is garbled in the transcription (226.5 and 205.7 in appear); the metre values and the 6.23 m peak are encyclopaedia figures not re-opened. v1 had the box transposed; corrected.', grade='Likely'),
 dict(tier=D, what='Big Void: at least 30 m long, above the Grand Gallery (drawn 2.6 x 8 x 30 m, position schematic)', basis='%s (manuscript read; the Nature version was not opened): three techniques, 34 authors, centre 40 to 50 m above the Queen\'s Chamber floor. Muons measure missing density, not shape.' % link('arXiv 1711.01576', ARXIV['url']), grade='Confirmed (existence, length); shape and position schematic'),
 dict(tier=D, what='North Face Corridor: 9.06 x 2.02 x 2.18 m, horizontal, about 0.84 m behind the chevron stones (position along the face drawn)', basis='%s, read in full: two independent muon analyses, above 10 sigma.' % link('Procureur et al. 2023', NFC['url']), grade='Confirmed'),
 dict(tier=D, what='Sphinx: 73 m long, 20 m high, faces due east (massing only)', basis='%s; AERA gives 72 m. The silhouette is a smooth loft, not a scan.' % link('Wikipedia, Great Sphinx', WP_SPH['url']), grade='Likely'),
 dict(tier=D, what='Khafre causeway, 494.6 m (drawn straight from valley temple to pyramid)', basis='Length carried over from the v1 ledger and matched by the drawn geometry (495 m); not re-opened in a source this session. Valley temple is a box.', grade='Suspected'),
]
extra_rows = []
if len(sys.argv) > 2: extra_rows = json.load(open(sys.argv[2]))
L += extra_rows
L += [
 dict(tier=T, what='Seismic anomaly under the paws: about 12 x 9 m, buried less than 5 m (thickness not stated; drawn 3 m)', basis='%s; quote as printed in %s. Which paw is disputed: the 1991 survey was left paw in Hawass 1997 and Schoch 1995, right paw in Cayce and Wikipedia. Never drilled.' % (link('Dobecki and Schoch 1992', CRX['url']), link('Hancock and Bauval', HB['url'])), grade='Likely (numbers); Suspected (paw)'),
 dict(tier=T, what='Orion Correlation overlay: belt stars over the three pyramids', basis='Bauval, Discussions in Egyptology 13 (1989) and The Orion Mystery (1994, with Gilbert); read via %s. Computed kink check on the Technical lens (belt 172.5 deg, pyramids 167.5 deg, rounding margin 163 to 172 with the belt value reached in 2 per cent of draws). Most Egyptologists and astronomers reject it.' % link('Wikipedia, Orion correlation theory', WP_OCT['url']), grade='Likely (numbers); the theory is contested'),
 dict(tier=T, what='Sphinx gaze due east and the equinox sunrise', basis='Orientation documented (Wikipedia); the Leo-at-dawn reading of 10,500 BC is a theory, shown on the sky scrub.', grade='Likely (orientation)'),
 dict(tier=S, what='Cayce\'s Hall of Records: right forepaw, between Sphinx and Nile, about 10,500 BC; box size, depth (26 m below ground) and the tunnel to the paw are drawn', basis='%s. Cayce gave no depth or dimensions; the Hall box, 16 columns, 26 tablet niches, dais and orb are invented.' % link('A.R.E. summary of the readings', 'https://content.edgarcayce.org/about-us/blog/blog-posts/our-research-into-cayce-s-hall-of-records/'), grade='Suspected'),
 dict(tier=S, what='"648 m" claim: eight vertical cylinders wrapped by spirals to about 648 m and two cubes (drawn 90 m a side) under Khafre, announced March 2025', basis='Press-conference claim by Biondi, Malanga and Mei from satellite SAR; not peer reviewed; critics (ESA, Parcak, Conyers, Dibble, Hawass) say radar reaches about 10 m at best. Their 2022 Khufu paper was retracted on 10 Aug 2026 (see %s). Drawn geometry (80 m ring, 4 m radius, spiral pitch, cube positions) is invented to the order of magnitude only. Reported figures conflict: 640 m to 2 km, cubes 80 to 90 m.' % link('Retraction Watch', RW648['url']), grade='Suspected'),
 dict(tier=S, what='"One system" network with three travelling pulses', basis='The page\'s own illustration. No source reports these links.', grade='Suspected'),
 dict(tier=S, what='Sky: star field, precession and the Orion/Leo presets', basis='See the Technical lens: catalogue, frame fit (0.16 deg), Vondrak precession, proper motion ignored.', grade='Likely'),
 dict(tier=S, what='Light: Blender Cycles bakes at sunrise, midday and late afternoon', basis='%s: 192 samples, Blender 5.2.2 LTS, receipts in the repository.' % link('states.json', 'states.json'), grade='Confirmed (the bake); the scene it lights is schematic'),
]

invented = ("every underground position in plan (the three Osiris shafts are offset 4 m and 6 m from each other to read clearly); the heights of Chamber I and the sizes of the six side chambers (drawn as equal boxes; the text gives each its own size); the compass orientation of every chamber; "
            "the Khufu interior beyond published lengths (positions and the Big Void's location are schematic); the Sphinx silhouette; the box that stands for the seismic anomaly (thickness 3 m); "
            "the whole interior of Cayce's Hall (box size, 16 columns, 26 niches, dais, orb, light) and its 26 m depth; the radius, spiral pitch and cube positions of the \"648 m\" claim; "
            "the one-system links and pulses; the causeway and valley temple shapes; the colour grading of the Blender bakes (exposure rules in states.json).")

extra = ("<div class='disc'><b>Receipts in this folder:</b> "
         + ' · '.join(link(x, x) for x in ('states.json', 'validation.json', 'NOTICE.md', 'build/bake.py', 'build/build_scene2.py', 'build/stars_build.py'))
         + ". Grades: Confirmed means the source was opened and read; Likely means consistent across sources or computed here from inputs of that kind; Suspected means a summary or recollection.</div>")

out = dict(items=items, ledger=L, invented=invented, extra=extra)
json.dump(out, open(sys.argv[1], 'w'), indent=1, ensure_ascii=False)
print(len(items), 'local items,', len(L), 'ledger rows')
