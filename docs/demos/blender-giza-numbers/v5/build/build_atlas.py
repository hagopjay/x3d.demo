# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 65 v4: the Sacred Geometry Atlas. One graded record per claim, each with a 3D proof stop.
usage: build_atlas.py <dir of sky_math.py> <hygdata_v41.csv> <v1 claims.json> <claims-v4.json> <out atlas.json>
Three sources of records: the v1 receipt (27 claims, kept with their grades), verify_sacred.py (11 claims) and the
claims computed below. Two grades per record: `number` (does the arithmetic hold: Confirmed, Likely, Suspected, False,
Untested) and `design` (did the builders mean it: Designed, Possible, Coincidence, Unknown)."""
import json, math, sys
sys.path.insert(0, sys.argv[1])
import numpy as np
import erfa
from sky_math import load_hyg, vec, precession, dec_of_date, culminations, LAT

V1 = json.load(open(sys.argv[3]))
V4 = {c["key"]: c for c in json.load(open(sys.argv[4]))["claims"]}
rows = load_hyg(sys.argv[2])
by = {r["proper"]: r for r in rows if r["proper"]}
IN, MILE = 0.0254, 1.609344
PI, PHI = math.pi, (1 + 5 ** .5) / 2
BASE_IN, BASE_PM, H_IN, H_PM = 9068.8, 0.5, 5776.0, 7.0          # Petrie s.21, s.25
BASE_M = 230.363                                                # Dash 2015
SLOPE, SLOPE_PM = 51 + 52 / 60, 2 / 60
H_M = BASE_M / 2 * math.tan(math.radians(SLOPE))
CUBIT_IN = 20.620
atlas = []


def mant(x, n=12):
    return ("%.*e" % (n - 1, abs(x))).split("e")[0].replace(".", "")


def literal(a, b, n=12):
    if not a or not b:
        return None
    x, y = mant(a, n), mant(b, n); k = 0
    while k < n and x[k] == y[k]:
        k += 1
    return k


def rounding(a, b):
    if not a or not b:
        return None
    return max([d for d in range(1, 13) if float("%.*g" % (d, a)) == float("%.*g" % (d, b))] or [0])


def bc(y):
    y = int(round(y)); return "%s BC" % format(1 - y, ",") if y <= 0 else "AD %d" % y


def dms(deg):
    d = int(deg); m = int((deg - d) * 60); s = round(((deg - d) * 60 - m) * 60)
    if s == 60: m, s = m + 1, 0
    return "%d°%02d′%02d″" % (d, m, s)


def add(id, family, title, wonder, test, measured, target, unit, number, design, source, proof, origin="v4", **extra):
    rec = dict(id=id, family=family, title=title, wonder=wonder, test=test, measured=measured, target=target, unit=unit,
               literal=literal(measured, target), rounding=rounding(measured, target),
               rel=((measured - target) / target if measured and target else None), number=number, design=design, source=source,
               proof=proof, origin=origin)
    rec.update(extra); atlas.append(rec)


def P(stop, rig=None, light="day", xray=False, **sky):
    d = dict(stop=stop, rig=rig, light=light, xray=xray)
    if sky:
        d["sky"] = sky
    return d


# ======================================================================================================== v1 records
FAM1 = {"Dimensions": "Shape", "Precision": "Site", "Constants": "Shape", "Latitude": "Earth", "Numbers game": "Sun and Moon", "History and sky": "History"}
DESIGN1 = dict(base="Designed", height="Coincidence", ratio711="Designed", acres="Coincidence", blocks="Unknown", level="Designed", joints="Designed", north="Designed",
               pi="Possible", tau="Possible", phi="Possible", latitude="Coincidence", day="Coincidence", sun="Coincidence", sun_r="Coincidence", moon_r="Coincidence",
               sun_earth="Coincidence", sun_dist="Coincidence", meridian="Coincidence", canon_size="Coincidence", canon_dist="Coincidence", canon_spin="Coincidence",
               greaves="Unknown", greaves_foot="Unknown")
PROOF1 = dict(base=P("khufu", "square"), height=P("khufu", "square"), ratio711=P("khufu", "square"), acres=P("plan", "square"), blocks=P("khufu"), level=P("khufu", "square"),
              joints=P("khufu"), north=P("plan", "cardinal"), pi=P("khufu", "circle"), tau=P("khufu", "circle"), phi=P("khufu", "square"), latitude=P("plan", "latitude"),
              day=P("west"), sun=P("west"), sun_r=P("west"), moon_r=P("west", light="night", year=-2559, culminate="Alnitak"), sun_earth=P("west"), sun_dist=P("west"),
              meridian=P("khufu", "hemisphere"), canon_size=P("west"), canon_dist=P("west"), canon_spin=P("west"), greaves=P("section", "chambers", xray=True),
              greaves_foot=P("section", "chambers", xray=True))
WONDER1 = dict(
    base="Each side of the Great Pyramid is 756 feet long.", height="Without its capstone it stood 480 feet: one eleventh of a mile.",
    ratio711="Height to base is 7 to 11, a ratio you can count on your fingers.", acres="The base covers thirteen acres.",
    blocks="Two million three hundred thousand blocks.", level="The whole base is level to the width of a thumb.", joints="The casing joints are thinner than a fingernail.",
    north="It faces true north more exactly than the Greenwich observatory was built.", pi="Walk around the base, divide by twice the height: π.",
    tau="The perimeter divided by the height is 2π: the pyramid is a squared circle.", phi="The sloping face divided by half the base is the golden ratio.",
    latitude="The latitude of the Great Pyramid is 29.9792458° N. The speed of light is 299,792,458 m/s.", day="A day has 86,400 seconds.",
    sun="The Sun is 864,000 miles across: the day's number, times ten.", sun_r="The Sun's radius is 432,000 miles.", moon_r="The Moon's radius is 1,080 miles.",
    sun_earth="108 Earths fit across the Sun.", sun_dist="The Sun stands 108 of its own diameters away.", meridian="A meridian through the poles is 40,000 km.",
    canon_size="The Moon is 400 times smaller than the Sun…", canon_dist="…and 400 times nearer, so they look the same size.", canon_spin="…and the Earth turns 400 times faster than the Moon.",
    greaves="John Greaves measured it with instruments in 1637.", greaves_foot="He cut one English foot into the King's Chamber wall for those who would come after.")
for c in V1["claims"]:
    if c["key"] in ("shafts_king", "shafts_queen", "orion"):
        continue                                       # superseded by the v4 tests below
    numeric = c["digits_agree"] != 15 and c["unit"] != "year"
    add("v1_" + c["key"], FAM1[c["section"]], c["title"], WONDER1[c["key"]], c["verdict"], c["measured"] if numeric else None, c["claimed"] if numeric else None,
        c["unit"], c["grade"], DESIGN1[c["key"]], "v1 receipt (verify_numbers.py): " + ", ".join(c["sources"]), PROOF1[c["key"]], origin="v1")

# ======================================================================================================== v4 verified records
DESIGN4 = dict(cubit_pi6="Coincidence", khafre_345="Designed", menkaure_slope="Possible", kings_chamber="Possible", scale_43200_perimeter="Coincidence",
               scale_43200_height="Coincidence", height_au="Coincidence", orion_belt="Possible", shaft_stars="Possible", thuban_pole="Unknown")
FAM4 = dict(cubit_pi6="Units", khafre_345="Shape", menkaure_slope="Shape", kings_chamber="Chambers", scale_43200_perimeter="Earth", scale_43200_height="Earth",
            height_au="Sun and Moon", orion_belt="Sky", shaft_stars="Sky", thuban_pole="Sky")
PROOF4 = dict(cubit_pi6=P("khufu", "square"), khafre_345=P("khafre", "triangle345"), menkaure_slope=P("menkaure", "menkaure"), kings_chamber=P("section", "chambers", xray=True),
              scale_43200_perimeter=P("khufu", "hemisphere"), scale_43200_height=P("khufu", "hemisphere"), height_au=P("west"),
              orion_belt=P("plan", "belt"), shaft_stars=P("south", "shafts", light="night", year=-2559, culminate="Alnitak"),
              thuban_pole=P("north", "shafts", light="night", year=-2559, culminate="Thuban"))
for k, c in V4.items():
    number = c["grade"].split(" / ")[0].split(" (")[0]
    add(k, FAM4[k], c["title"], c["wonder"], c["verdict"], c["measured"] if c["literal_digits"] is not None else None, c["target"] if c["literal_digits"] is not None else None,
        c["unit"], number, DESIGN4[k], c["source"], PROOF4[k], grade_text=c["grade"])

# ======================================================================================================== computed here
# --- shape and units
seked = math.degrees(math.atan2(7, 5.5))
add("seked", "Shape", "The slope is a seked of 5½ palms", "Rise one cubit, run five and a half palms. One rule, repeated for every casing stone, makes the whole shape.",
    "Seked 5½ is %s; Petrie measured 51°52′ ± 2′, %.1f′ away. This is the simplest account of the shape: it uses the Egyptians' own slope unit, known from the Rhind papyrus, and "
    "it brings 22/7 for π with it for free." % (dms(seked), (SLOPE - seked) * 60), SLOPE, seked, "degrees", "Confirmed", "Designed",
    "Petrie 1883 s.25 (51°52′ ± 2′); Rhind Mathematical Papyrus problems 56-60 for the seked", P("khufu", "square"))
add("cubits_440_280", "Units", "440 cubits wide, 280 cubits high", "In the builders' own unit the pyramid is two round numbers.",
    "Base ÷ 440 = %.3f in and height ÷ 280 = %.3f in, against Petrie's independent cubit of 20.620 ± 0.005 in: the base cubit is %.1f errors under, the height cubit is inside the "
    "height's own ± 7 in. Petrie: 'Outside form of Pyramid is 280 and 440 cubits, confirmed by the π theory.'" % (BASE_IN / 440, H_IN / 280, abs(BASE_IN / 440 - CUBIT_IN) / 0.005),
    BASE_IN / 440, CUBIT_IN, "in per cubit", "Confirmed", "Designed", "Petrie 1883 s.21, s.25, s.136, s.143, s.157", P("khufu", "square"))
add("perimeter_1760", "Units", "The perimeter is 1,760 cubits, and a mile is 1,760 yards", "Walk around the pyramid: 1,760 cubits. Walk a mile: 1,760 yards.",
    "4 × 440 = 1,760 exactly, by design. The mile got its 1,760 yards in England in 1593 (8 furlongs of 220 yards). Two true numbers with no link: a cubit is not a yard, and the "
    "pyramid's perimeter is %.3f of a mile." % (4 * BASE_M / 1000 / MILE), 1760.0, 1760.0, "count", "Confirmed", "Coincidence", "Arithmetic; statute mile of 1593", P("plan", "square"))
sacred = 25.025
add("pyramid_inch_year", "Units", "The base is 365.24 sacred cubits: one for each day of the year", "Piazzi Smyth, Astronomer Royal for Scotland, 1864: the side of the base counts the days of the year.",
    "Petrie's base is 9,068.8 ± 0.5 in, which is %.2f 'sacred cubits' of 25.025 in, not 365.24: %.1f %% short. Smyth had measured over rubble. Petrie, who went to Giza to test "
    "this, wrote: 'there is no authentic example, that will bear examination, of the use or existence of any such measure as a Pyramid inch.'" % (BASE_IN / sacred, (1 - BASE_IN / sacred / 365.2422) * 100),
    BASE_IN / sacred, 365.2422, "sacred cubits", "False", "Coincidence", "Petrie 1883 s.21, s.143, s.150", P("khufu", "square"))
diag_sum = 2 * BASE_IN * math.sqrt(2) / 1.001
add("diagonals_precession", "Sky", "The two base diagonals add up to the years of the precession", "25,827 pyramid inches across the diagonals: the Great Year, the slow wobble of the Earth's axis.",
    "With Petrie's base the diagonals sum to %s pyramid inches. The precession takes about 25,772 years today, and its rate changes: %.1f %% apart, 2 digits. It needed Smyth's "
    "too-long base to work." % (format(round(diag_sum), ","), abs(diag_sum / 25772 - 1) * 100), diag_sum, 25772.0, "years", "False", "Coincidence",
    "Petrie 1883 s.21; IAU 2006 precession rate 50.288″ per year", P("plan", "square"))
circ_c = PI * BASE_M * (math.sqrt(2) - 1)
circ_pm = PI * 0.07 * (math.sqrt(2) - 1)
add("circles_light", "Earth", "The two circles of the base differ by the speed of light", "Draw one circle around the base and one inside it. Subtract their lengths: 299.79 metres. Light: 299.79 million metres a second.",
    "π × %.3f × (√2 − 1) = %.2f ± %.2f m, against 299.792: four literal digits, and the survey cannot say more. It is the base length in disguise: any square of side 230.39 m "
    "does this, and the base is 440 cubits. Metres and seconds came 4,300 years later." % (BASE_M, circ_c, circ_pm), circ_c, 299.792458, "m", "Confirmed", "Coincidence",
    "Dash 2015 base 230.363 ± 0.07 m; SI", P("plan", "circle"), needs_base_m=299.792458 / PI / (math.sqrt(2) - 1))
add("pi_phi_identity", "Shape", "π and φ both live in the one slope", "The same triangle gives the circle's number and the golden number. Two of the deepest constants in one pile of stone.",
    "They are one fact. 4 ÷ √φ = %.5f, within 0.1 %% of π, for any triangle ever drawn. A π pyramid slopes at %s and a φ pyramid at %s: %.1f′ apart, less than Petrie's ± 2′. "
    "No survey can tell them apart, and the seked of 5½ (%s) sits between them." % (4 / math.sqrt(PHI), dms(math.degrees(math.atan(4 / PI))), dms(math.degrees(math.atan(math.sqrt(PHI)))),
        (math.degrees(math.atan(4 / PI)) - math.degrees(math.atan(math.sqrt(PHI)))) * 60, dms(seked)), 4 / math.sqrt(PHI), PI, "ratio", "Confirmed", "Coincidence",
    "Arithmetic; Petrie 1883 s.25", P("khufu", "square"))
face_area, h2 = BASE_M / 2 * math.hypot(H_M, BASE_M / 2), H_M ** 2
add("herodotus_face", "Shape", "Each face has the area of the height squared", "Said to come from Herodotus: the square on the height equals a face.",
    "Face %s m² against height² %s m²: %.2f %% apart. It is the φ claim again in other words (it holds exactly for a golden pyramid). The wording was put into Herodotus's "
    "mouth by John Taylor in 1859; I did not find it in the Histories in this session." % (format(round(face_area), ","), format(round(h2), ","), abs(face_area / h2 - 1) * 100),
    face_area, h2, "m²", "Likely", "Possible", "Dash 2015 base, Petrie slope; attribution not re-read: Suspected", P("khufu", "square"))
# --- chambers
half_area_level = H_IN * (1 - 1 / math.sqrt(2))
add("kc_half_area", "Chambers", "The King's Chamber floor sits where the pyramid is half its base", "Cut the pyramid level with the chamber floor: the slice is exactly half the area of the base.",
    "Half area comes at height × (1 − 1/√2) = %.1f in. Petrie levelled the floor at 1,692.8 ± 0.6 in: %.1f in apart on a height known to ± 7 in. One of the tightest matches "
    "in the building, and it uses nothing but the pyramid's own height." % (half_area_level, abs(1692.8 - half_area_level)), 1692.8, half_area_level, "in above the pavement",
    "Confirmed", "Possible", "Petrie 1883 s.25 (height), s.55 and s.64 (floor level)", P("section", "chambers", xray=True))
add("qc_half_level", "Chambers", "The Queen's Chamber is at half the King's Chamber's height", "One chamber exactly halfway up to the other.",
    "Queen's floor 834.4 in, half of the King's 1,692.8 is 846.4: %.1f in out (%.1f %%). The Queen's floor is rough and may have lost a paving course; with %.0f in of paving it would fit." % (
        846.4 - 834.4, (846.4 / 834.4 - 1) * 100, 846.4 - 834.4), 834.4, 846.4, "in above the pavement", "Likely", "Possible", "Petrie 1883 s.40, s.41, s.64", P("section", "chambers", xray=True))
add("qc_midplane", "Chambers", "The Queen's Chamber ridge is on the pyramid's exact middle", "The roof ridge of the Queen's Chamber lies in the east-west plane through the apex.",
    "Petrie: 'the ridge of the roof is exactly in the mid-place of the Pyramid, equidistant from N. and S. sides'; his table puts it 0.3 ± 0.8 in north of centre. "
    "The King's Chamber, by contrast, is %.1f m south of centre." % ((330.6 + 537.0) / 2 * IN), 0.3, None, "in off centre", "Confirmed", "Designed",
    "Petrie 1883 s.41, s.55, s.64", P("section", "chambers", xray=True))
half = math.degrees(math.atan(0.5))
add("passage_1_in_2", "Chambers", "The entrance passage falls 1 in 2", "Down into the rock for a hundred metres, one unit down for every two along.",
    "1 in 2 is %s; Petrie's mean axis is 26°31′23″ ± 5″: %.1f′ apart over 105 m, a drift of %.0f cm. The Ascending Passage (26°02′30″) and Grand Gallery (26°16′40″) follow the same "
    "rule more loosely. Petrie: 'far more accurate than any other theory'." % (dms(half), (half - (26 + 31 / 60 + 23 / 3600)) * 60, 105 * math.tan(math.radians(half - (26 + 31 / 60 + 23 / 3600))) * 100),
    26 + 31 / 60 + 23 / 3600, half, "degrees", "Confirmed", "Designed", "Petrie 1883 s.36, s.38, s.45, s.151", P("section", "chambers", xray=True))


def thuban_lower(y):
    return culminations(dec_of_date(by["Thuban"], y))[2]


pa = 26 + 31 / 60 + 23 / 3600
roots = []
ys = list(range(-4000, -1500, 10))
for a, b in zip(ys, ys[1:]):
    if (thuban_lower(a) - pa) * (thuban_lower(b) - pa) < 0:
        lo, hi = a, b
        for _ in range(30):
            m = (lo + hi) / 2
            if (thuban_lower(lo) - pa) * (thuban_lower(m) - pa) <= 0: hi = m
            else: lo = m
        roots.append((lo + hi) / 2)
add("passage_thuban", "Sky", "The entrance passage is a telescope aimed at the pole star", "Sir John Herschel, 1836: from the bottom of the passage the old pole star Thuban shone straight down it, in 2170 BC.",
    "Thuban at its lowest stood %s above the horizon in %s: those are the dates the passage fits, and Herschel's 2170 BC is close to the second. In 2560 BC it stood at %.2f°, "
    "%.1f° too high. So the passage does not date the pyramid; the 1 in 2 slope explains the angle with no star at all." % (
        dms(pa), " and ".join(bc(r) for r in roots), thuban_lower(-2559), thuban_lower(-2559) - pa), thuban_lower(-2559), pa, "degrees", "Suspected", "Coincidence",
    "Petrie 1883 s.36; HYG v4.1 + ERFA ltp; Herschel's date as commonly cited", P("north", "chambers", light="night", xray=True, year=round(roots[-1]) if roots else -2170, culminate="Thuban", lower=True),
    match_years=[round(r) for r in roots])
add("coffer_double", "Chambers", "The coffer's outside is twice its inside", "The granite box in the King's Chamber: its outer volume is exactly double what it holds.",
    "Petrie: contents 72,030 in³, solid bulk 70,500, over all 142,530. Outside ÷ inside = %.3f, 1.1 %% under 2; the granite and the hollow differ by %.1f %%. Rough-sawn granite "
    "with saw marks still on it: a round ratio aimed at, not hit." % (142530 / 72030, (72030 / 70500 - 1) * 100), 142530 / 72030, 2.0, "ratio", "Likely", "Possible",
    "Petrie 1883 s.59, s.61", P("section", "chambers", xray=True))
# --- site
sides = dict(N=9069.4, E=9067.7, S=9069.5, W=9068.6)
spread = max(sides.values()) - min(sides.values())
add("square_sides", "Site", "Four sides equal to within two inches", "Four sides of 230 metres that differ by less than the width of your hand.",
    "Petrie's casing sides: N 9,069.4, E 9,067.7, S 9,069.5, W 9,068.6 in. Spread %.1f in (%.1f cm) in 9,069: 1 part in %s. Corner angles are out by a mean of 12 seconds of arc." % (
        spread, spread * 2.54, format(round(BASE_IN / spread), ",")), spread, None, "in", "Confirmed", "Designed", "Petrie 1883 s.21", P("plan", "square"))
se = {"Khufu": (115.1815, 115.1815), "Khafre": (-13165.8 * IN + 8474.9 * IN / 2, 13931.6 * IN + 8474.9 * IN / 2), "Menkaure": (-22616.0 * IN + 4153.6 * IN / 2, 29102.0 * IN + 4153.6 * IN / 2)}
d = (se["Khafre"][0] - se["Khufu"][0], se["Khafre"][1] - se["Khufu"][1]); dl = math.hypot(*d)
miss = abs((se["Menkaure"][0] - se["Khufu"][0]) * d[1] - (se["Menkaure"][1] - se["Khufu"][1]) * d[0]) / dl
run = math.hypot(se["Menkaure"][0] - se["Khufu"][0], se["Menkaure"][1] - se["Khufu"][1])
add("giza_diagonal", "Site", "The three south-east corners lie on one line", "A ruler laid on the south-east corners of all three pyramids touches each one, and points to Heliopolis.",
    "The line through Khufu's and Khafre's south-east corners passes %.1f m from Menkaure's, over a run of %.0f m: %.1f° out of line. Close enough to look planned from the ground, "
    "not a surveyed line. The Heliopolis bearing is not tested here." % (miss, run, math.degrees(math.atan2(miss, run))), miss, None, "m off the line", "Likely", "Possible",
    "Petrie 1883 s.92 (centres), s.21, s.66, s.80 (bases)", P("plan", "diagonal"))
off = abs(-13165.8 * IN + 13931.6 * IN) / math.sqrt(2)
add("khufu_diagonal", "Site", "Khafre stands on the Great Pyramid's diagonal", "Extend the diagonal of the first pyramid to the south-west and it runs through the heart of the second.",
    "Khafre's centre is 334.4 m west and 353.9 m south of Khufu's: %.1f m off the 45° diagonal, on a base 215 m wide. It passes through the pyramid, not through its centre." % off,
    off, None, "m off the diagonal", "Likely", "Possible", "Petrie 1883 s.92", P("plan", "diagonal"))
add("khafre_137", "Shape", "Khafre's pyramid is built on the number 137", "Its base is 411 cubits: three times 137. Its height is 274: twice 137. And 137 is the fine-structure number that governs light and matter.",
    "True arithmetic: 8,474.9 in ÷ 20.620 = %.1f cubits = 3 × %.2f, and 1/α = 137.036. Nobody claims this. This page's own search turned it up in a minute, which is the point: "
    "a 3-4-5 pyramid of 411 cubits has to contain 137, and there are many famous numbers to bump into." % (8474.9 / CUBIT_IN, 8474.9 / CUBIT_IN / 3), 8474.9 / CUBIT_IN / 3, 137.035999,
    "cubits", "Confirmed", "Coincidence", "Petrie 1883 s.66, s.136; CODATA 1/α. An invented claim, made here to show how easy they are", P("khafre", "triangle345"), invented=True)
conc = None
add("eight_sides", "Site", "The Great Pyramid has eight sides", "At dawn on the equinox a shadow line splits each face in two: the faces are dished, and the pyramid has eight sides, not four.",
    "The core masonry is hollowed along the middle of each face; Petrie measured it and aerial photographs show it. Whether the finished casing was dished, and whether it was "
    "meant, are open. The equinox story is modern. Not measured in this session.", None, None, "", "Suspected", "Unknown", "Petrie 1883 (hollowing of the core faces), not re-read here", P("khufu", "square"))
vol = BASE_M ** 2 * H_M / 3
add("mass_earth", "Earth", "The pyramid's mass, times a thousand million million, is the Earth's", "5.97 million tonnes of stone. The Earth: 5.97 million million million million kilograms.",
    "Volume %.3f million m³. To give 5.972 × 10⁹ kg the mean density must be %.2f t/m³. Limestone runs 2.2 to 2.6, and nobody knows the pyramid's mean density: bedrock core, "
    "voids, mortar, granite. The match is a choice of density." % (vol / 1e6, 5.972e9 / vol / 1000), vol * 2.3e3, 5.972e9, "kg", "Suspected", "Coincidence",
    "Dash 2015 base, Petrie slope; IAU Earth mass", P("khufu"))
# --- Earth
add("latitude_30", "Earth", "It stands one third of the way from the equator to the pole", "Latitude thirty: a third of the way up the world.",
    "The centre is at 29.9792° N: %.2f′ short of 30°, or %.1f km. Good, and easy to do with a gnomon; the plateau's northern edge stops you going further. The usual 'correction for "
    "refraction' story is not needed." % ((30 - LAT) * 60, (30 - LAT) * 110.852), LAT, 30.0, "degrees N", "Likely", "Possible", "WGS84 centre (v1 receipt)", P("plan", "latitude"))
add("land_centre", "Earth", "The pyramid stands at the centre of the Earth's land", "Its parallel and its meridian cross more dry land than any others on Earth.",
    "Not tested here: it needs a global land map and a definition of 'centre'. Published checks put the longest-land meridian and parallel elsewhere. Kept in the atlas so that "
    "'untested' has an honest row.", None, None, "", "Untested", "Unknown", "No measurement in this session", P("plan", "cardinal"))
# --- Sun and Moon
RE, RM = 6371.0088, 1737.4
ratio_em = (RE + RM) / RE
add("earth_moon_triangle", "Sun and Moon", "Set the Moon on the Earth and you have drawn the Great Pyramid", "Earth's radius for the half-base, Earth plus Moon for the height: the triangle has the pyramid's slope.",
    "(Earth + Moon) ÷ Earth = %.5f; the pyramid's 14/11 is %.5f: five literal digits. The slope it gives is %s against Petrie's 51°52′ ± 2′. The strangest match in the "
    "atlas, and it is about the Earth and Moon, whose sizes no builder could know: the Moon's radius is 0.2727 of the Earth's, and 3/11 is 0.2727." % (
        ratio_em, 14 / 11, dms(math.degrees(math.atan(ratio_em)))), ratio_em, 14 / 11, "ratio", "Confirmed", "Coincidence", "IUGG mean Earth radius 6,371.0088 km; Moon 1,737.4 km",
    P("khufu", "hemisphere"))
add("radii_5040", "Sun and Moon", "Earth's radius plus the Moon's is 5,040 miles: 1 × 2 × 3 × 4 × 5 × 6 × 7", "Plato's perfect number of citizens, written in the sky.",
    "%.1f + %.1f = %.1f miles: %.2f %% under 5,040. Only in miles." % (RE / MILE, RM / MILE, (RE + RM) / MILE, (1 - (RE + RM) / MILE / 5040) * 100), (RE + RM) / MILE, 5040.0, "miles",
    "Likely", "Coincidence", "IUGG, IAU; statute mile", P("west"))
add("earth_7920", "Sun and Moon", "Earth's diameter is 7,920 miles: 8 × 9 × 10 × 11", "And 7,920 is 720 × 11.",
    "Mean diameter %.1f miles: %.2f %% under. Only in miles." % (2 * RE / MILE, (1 - 2 * RE / MILE / 7920) * 100), 2 * RE / MILE, 7920.0, "miles", "Likely", "Coincidence", "IUGG; statute mile", P("west"))
add("perimeter_36524", "Units", "The perimeter is 36,524 inches: the days in a hundred years", "A calendar in stone.",
    "Petrie's perimeter is %s in (%s 'pyramid inches'): %.1f %% short of 36,524." % (format(round(4 * BASE_IN), ","), format(round(4 * BASE_IN / 1.001), ","), (1 - 4 * BASE_IN / 1.001 / 36524.22) * 100),
    4 * BASE_IN / 1.001, 36524.22, "pyramid inches", "False", "Coincidence", "Petrie 1883 s.21", P("plan", "square"))


# --- sky
def ecl_lon(name, year):
    u = precession(year) @ vec(by[name], year)[0]              # of date
    P_ = precession(year)
    pecl = P_ @ np.array(erfa.ltpecl(float(year)))             # ecliptic pole in the equator-of-date frame
    eqx = np.array([1.0, 0, 0])
    yax = np.cross(pecl, eqx)
    return math.degrees(math.atan2(float(u @ yax), float(u @ eqx))) % 360


reg, den = ecl_lon("Regulus", -10499), ecl_lon("Denebola", -10499)
alde = ecl_lon("Aldebaran", -2559)
wrap = lambda a: (a + 180) % 360 - 180
add("leo_10500", "Sky", "In 10,500 BC the Sphinx watched its own image rise", "A lion, facing due east. On the spring equinox of 10,500 BC the constellation of the Lion rose before the Sun.",
    "On that date Regulus lay %.0f° and Denebola %.0f° from the equinox point along the ecliptic, both behind it: the spring Sun stood just past Leo's tail, so Leo did rise ahead "
    "of it. In 2560 BC the equinox point was %.0f° from Aldebaran, in the Bull. The sky fits; the date is chosen to make it fit, and the star-figure 'Leo' is not attested "
    "in Egypt that early." % (abs(wrap(reg)), abs(wrap(den)), abs(wrap(alde))), wrap(den), None, "degrees", "Likely", "Unknown",
    "HYG v4.1 + ERFA ltp and ltpecl (ecliptic of date)", P("rise", light="night", year=-10499, lst=round(math.radians(18 * 15), 4)), regulus_lon=wrap(reg), denebola_lon=wrap(den), aldebaran_lon_2560BC=wrap(alde))
decs = [(y, dec_of_date(by["Alnitak"], y)) for y in range(-13000, 3001, 50)]
ymin, dmin = min(decs, key=lambda t: t[1]); ymax, dmax = max(decs, key=lambda t: t[1])
add("orion_lowest", "Sky", "10,500 BC is when Orion stood lowest in the sky", "The belt swings up and down over 26,000 years. The pyramids mark the bottom of the swing: the First Time.",
    "Alnitak's lowest culmination at Giza in this model is %.1f° in %s (highest %.1f° in %s). So yes, the low point falls near 10,500 BC. The link to the pyramids is the "
    "belt-map rotation, which fits %.0f° better then than in 2560 BC but still misses by %.0f°." % (
        culminations(dmin)[0], bc(ymin), culminations(dmax)[0], bc(ymax), abs(V4["orion_belt"]["fit_2560BC"]["map_rotation_deg"]) - abs(V4["orion_belt"]["fit_10500BC"]["map_rotation_deg"]),
        abs(V4["orion_belt"]["fit_10500BC"]["map_rotation_deg"])), float(1 - ymin), 10500.0, "year BC", "Confirmed", "Unknown", "HYG v4.1 + ERFA ltp (Vondrak 2011, valid over this span)",
    P("belt", "belt", light="night", year=int(ymin), culminate="Alnitak"), min_year=int(ymin))


def ra_of_date(name, y):
    u = precession(y) @ vec(by[name], y)[0]
    return math.degrees(math.atan2(u[1], u[0])) % 360


f = lambda y: wrap(ra_of_date("Kochab", y) - ra_of_date("Mizar", y) - 180)
ys = list(range(-3200, -1800, 5)); spence = None
for a, b in zip(ys, ys[1:]):
    if f(a) * f(b) < 0 and abs(f(a)) < 20:
        lo, hi = a, b
        for _ in range(30):
            m = (lo + hi) / 2
            if f(lo) * f(m) <= 0: hi = m
            else: lo = m
        spence = (lo + hi) / 2
add("spence_alignment", "Sky", "Two stars and a plumb line set the pyramid to north", "Kate Spence, 2000: hang a plumb line, wait until Kochab stands exactly over Mizar, and the line is north. It was true only around 2467 BC.",
    "In this model Kochab and Mizar stood on one vertical line through the pole in %s; Spence gave 2467 BC from other star data. The method explains why pyramids before and "
    "after Khufu's are aligned worse, in the order the drift predicts. A way to date the pyramid by its own error; the 3′43″ error itself is Petrie's." % (bc(spence) if spence else "no year found"),
    float(1 - spence) if spence else None, 2467.0, "year BC", "Likely", "Possible", "HYG v4.1 + ERFA ltp; Spence 2000 (Nature) as commonly cited, not re-read here",
    P("north", "cardinal", light="night", year=round(spence) if spence else -2466, culminate="Kochab"), year=round(spence) if spence else None)

order = ["Shape", "Units", "Chambers", "Site", "Earth", "Sun and Moon", "Sky", "History"]
atlas.sort(key=lambda r: order.index(r["family"]))
counts = {}
for r in atlas:
    counts[r["number"]] = counts.get(r["number"], 0) + 1
design = {}
for r in atlas:
    design[r["design"]] = design.get(r["design"], 0) + 1
out = dict(schema="x3d.io/giza-atlas/1", generated_by="build_atlas.py", count=len(atlas), families=order, number_grades=counts, design_grades=design,
           validators="Petrie 1883 via the Birdsall transcription; Dash 2015; HYG v4.1; ERFA %s ltp" % erfa.__version__, claims=atlas)
json.dump(out, open(sys.argv[5], "w"), ensure_ascii=False, indent=1)
print(len(atlas), counts, design)
for r in atlas:
    if r["origin"] != "v1":
        print("-", r["id"], "|", r["number"], "/", r["design"], "| lit", r["literal"], "|", r["test"][:230])
