# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 65 v4: verify the sacred-geometry claims that v1-v3 did not test. Writes claims-v4.json.
usage: verify_sacred.py <dir of sky_math.py> <hygdata_v41.csv> <out.json>
Every survey figure is Petrie 1883 (The Pyramids and Temples of Gizeh), read from the Birdsall transcription;
section numbers are given per claim. Sky: HYG v4.1 + ERFA ltp (Vondrak 2011). Nothing here uses refraction."""
import json, math, sys
sys.path.insert(0, sys.argv[1])
import numpy as np
import erfa
from sky_math import load_hyg, vec, precession, dec_of_date, culminations, LAT, PC_LY

IN = 0.0254
rows = load_hyg(sys.argv[2])
by = {r["proper"]: r for r in rows if r["proper"]}
claims = []


def mant(x, n=12):
    return ("%.*e" % (n - 1, abs(x))).split("e")[0].replace(".", "")


def literal(a, b, n=12):
    x, y = mant(a, n), mant(b, n)
    k = 0
    while k < n and x[k] == y[k]:
        k += 1
    return k


def add(key, title, wonder, measured, target, unit, grade, verdict, source, **extra):
    c = dict(key=key, title=title, wonder=wonder, measured=measured, target=target, unit=unit,
             literal_digits=literal(measured, target) if measured and target else None,
             rel_error=(measured - target) / target if measured and target else None,
             grade=grade, verdict=verdict, source=source)
    c["rounding_digits"] = max([d for d in range(1, 13) if float("%.*g" % (d, measured)) == float("%.*g" % (d, target))] or [0]) if measured and target else None
    c.update(extra)
    claims.append(c)


# ---- 1. the royal cubit and pi/6 metres -------------------------------------------------------------------------
cubit_in, cubit_pm = 20.620, 0.005                     # Petrie s.136 weighted mean
cubit_kc = 20.632                                      # Petrie s.52 King's Chamber mean (+-0.004)
cubit_m = cubit_in * IN
add("cubit_pi6", "The royal cubit is π/6 of a metre",
    "Divide π by six and you get 0.5236. That is the royal cubit in metres, a unit defined in France in 1791.",
    cubit_m, math.pi / 6, "m", "Confirmed (3 digits) / False as design",
    "Petrie's cubit is 20.620 ± 0.005 in = %.5f ± %.5f m; π/6 = %.5f m sits %.2f Petrie errors below it. "
    "Three literal digits agree. The metre was defined 4,300 years later from a survey of the Paris meridian, so the "
    "match cannot have been designed; and a 0.52 m cubit is simply forearm-sized." % (
        cubit_m, cubit_pm * IN, math.pi / 6, (cubit_m - math.pi / 6) / (cubit_pm * IN)),
    "Petrie 1883 s.136 (20.620 ± .005), s.52 (20.632 ± .004 in the King's Chamber)",
    sigma=(cubit_m - math.pi / 6) / (cubit_pm * IN), also={"base_over_440_m": 230.363 / 440, "phi2_over_5": ((1 + 5 ** .5) / 2) ** 2 / 5,
    "pi_minus_phi2": math.pi - ((1 + 5 ** .5) / 2) ** 2, "kings_chamber_cubit_m": cubit_kc * IN})

# ---- 2. Khafre: the 3-4-5 triangle --------------------------------------------------------------------------------
khafre_base, khafre_h, khafre_h_pm = 8474.9, 5664.0, 13.0   # s.66, s.67
khafre_ang, khafre_ang_pm = 53 + 10 / 60, 4 / 60
t345 = math.degrees(math.atan2(4, 3))
h345 = khafre_base / 2 * 4 / 3
add("khafre_345", "Khafre's pyramid is a 3-4-5 triangle",
    "Half the base, the height and the sloping face of the second pyramid stand as 3 : 4 : 5, the first Pythagorean triple.",
    khafre_h / (khafre_base / 2), 4 / 3, "rise ÷ run", "Confirmed",
    "Petrie's casing angle is 53°10′ ± 4′; a 3-4-5 face is %.4f° (53°07′48″), inside his error. The height a 3-4-5 needs is "
    "%.1f in against his 5,664 ± 13 in (%.2f errors). In Egyptian terms this is a seked of 5¼ palms, the slope the Rhind "
    "papyrus uses in its pyramid problems. Designed, most likely, but as a builder's ratio: no evidence they knew 3²+4²=5² as a theorem." % (
        t345, h345, (khafre_h - h345) / khafre_h_pm),
    "Petrie 1883 s.66 (base mean 8474.9 in), s.67 (53°10′ ± 4′; height 5,664 ± 13 in)",
    angle_deg=khafre_ang, angle_pm_deg=khafre_ang_pm, triple_angle_deg=t345, sigma_angle=(khafre_ang - t345) / khafre_ang_pm,
    base_m=khafre_base * IN, height_m=khafre_h * IN)

# ---- 3. Menkaure ------------------------------------------------------------------------------------------------------
menk_base, menk_h = 4153.6, 2564.0
add("menkaure_slope", "Menkaure repeats the Great Pyramid's slope",
    "The third pyramid rises at the same 51° and a fraction as the first: the π slope, a third of the size.",
    math.degrees(math.atan2(menk_h, menk_base / 2)), math.degrees(math.atan2(14, 11)), "degrees", "Likely",
    "Petrie: 51°0′ ± 10′ (or 51°10′30″ from the granite courses); seked 5½ gives 51°50′34″, five of his errors away, and "
    "a 5:4 rise-to-run gives 51°20′25″, two errors away. A steep-fifties family slope, yes; the same π slope, not shown.",
    "Petrie 1883 s.80 (base mean 4153.6 in), s.81 (51°0′ ± 10′; height 2564 ± 15 in)",
    base_m=menk_base * IN, height_m=menk_h * IN, seked_5_5=math.degrees(math.atan2(14, 11)), ratio_5_4=math.degrees(math.atan2(5, 4)))

# ---- 4. King's Chamber 2:1 and the 15-20-25 ---------------------------------------------------------------------------
kc_w, kc_l, kc_h, kc_h_pm = 206.12, 412.24, 230.09, 0.15    # Petrie s.155 (c21): the figures he uses for this very theory
kc_cubit = 20.612                                        # the cubit his width and length give
wall_base, floor_, roof = (1686.3, 1688.5), (1691.4, 1693.7), (1921.6, 1923.7)   # s.55, s.64 levels above pavement
h_floor = (roof[0] - floor_[1], roof[1] - floor_[0])
h_wall = (roof[0] - wall_base[1], roof[1] - wall_base[0])
h_need = 5 * 5 ** .5 * kc_cubit
add("kings_chamber", "The King's Chamber hides a 3-4-5 triangle in three dimensions",
    "The room is 10 by 20 cubits. Its height is 5√5 cubits, so the end-wall diagonal is 15, the floor is 20 long, "
    "and the diagonal through the room is 25: a 3-4-5 triangle scaled by five.",
    kc_h, h_need, "in", "Confirmed (2:1) / Likely (15-20-25)",
    "Length ÷ width is %.4f: the 10 × 20 cubit plan is real. The height that closes the triangle is %.2f in; Petrie measured "
    "%.2f ± %.2f in from the floor, %.1f of his errors short (0.16 %%). This is Petrie's own theory (squares of 100, 400 and 125 "
    "square cubits) and he judged it to agree 'within little more than the small range of the probable errors'. One free choice "
    "remains: the walls run 5.11 in below the floor, and from the wall base the triangle fails." % (
        kc_l / kc_w, h_need, kc_h, kc_h_pm, (h_need - kc_h) / kc_h_pm),
    "Petrie 1883 s.155 (206.12, 412.24, 230.09 ± .15 in; floor raised 5.11 ± .12 in above the wall base), s.55 and s.64 (levels)",
    width_in=kc_w, length_in=kc_l, height_in=kc_h, height_needed_in=h_need, sigma=(h_need - kc_h) / kc_h_pm,
    ratio=kc_l / kc_w, height_from_floor_levels_in=h_floor, height_from_wall_base_levels_in=h_wall,
    end_diagonal_cubits=math.hypot(kc_w, kc_h) / kc_cubit, space_diagonal_cubits=math.sqrt(kc_w ** 2 + kc_l ** 2 + kc_h ** 2) / kc_cubit)

# ---- 5. the 1:43,200 scale ---------------------------------------------------------------------------------------------
base_m = 230.363                                           # Dash 2015 mean side (v1 receipt)
height_m = base_m / 2 * math.tan(math.radians(51 + 52 / 60))
eq_circ, polar_r = 40075.017, 6356.752                      # WGS84 km
add("scale_43200_perimeter", "The pyramid is the northern hemisphere at 1 : 43,200",
    "43,200 is half the seconds in a day. Multiply the perimeter by it and you get the Earth's equator.",
    4 * base_m * 43200 / 1000, eq_circ, "km", "Likely (2 digits) / Suspected as design",
    "Perimeter × 43,200 = %.1f km against 40,075.0 km: %.2f %% short. The scale that fits the equator is 1 : %s, a number "
    "nobody has a story for." % (4 * base_m * 43.2, (1 - 4 * base_m * 43.2 / eq_circ) * 100,
        format(round(eq_circ * 1000 / (4 * base_m)), ",")),
    "Dash 2015 base; WGS84 equator", best_integer=round(eq_circ * 1000 / (4 * base_m)))
add("scale_43200_height", "… and its height is the polar radius",
    "Multiply the height by the same 43,200 and you get the distance from the Earth's centre to the pole.",
    height_m * 43200 / 1000, polar_r, "km", "Likely (2 digits) / Suspected as design",
    "Height × 43,200 = %.1f km against 6,356.8 km: %.2f %% short. Both matches are one fact, not two: the pyramid's "
    "perimeter ÷ height is 2π to 3 digits (the seked), and so is equator ÷ radius. Once the scale fits one, the other is free." % (
        height_m * 43.2, (1 - height_m * 43.2 / polar_r) * 100), "Petrie slope 51°52′; WGS84 polar radius",
    best_integer=round(polar_r * 1000 / height_m))
au_km = 149597870.7
add("height_au", "The height times a billion is the distance to the Sun",
    "Stack a thousand million Great Pyramids and you reach the Sun.",
    height_m * 1e9 / 1000, au_km, "km", "Confirmed (2 digits) / False as design",
    "Height × 10⁹ = %.1f million km against 149.6 million: %.1f %% short, and the Earth's own distance swings between 147.1 and "
    "152.1 million km each year, so %s. Powers of ten are free in the metric system the builders did not have." % (
        height_m * 1e6 / 1e6, (1 - height_m * 1e6 / au_km) * 100,
        "it lands below even the closest approach" if height_m * 1e6 < 147.1e6 else "it lands inside the yearly swing"),
    "IAU 2012 astronomical unit")

# ---- 6. Orion's belt and the three pyramids ----------------------------------------------------------------------------
g1, g2 = np.array([-13165.8, -13931.6]), np.array([-9450.2, -15170.4])     # (east, north) inches, Petrie s.92
ground_ratio = np.linalg.norm(g1) / np.linalg.norm(g2)
ground_kink = math.degrees(math.acos(np.dot(g1, g2) / np.linalg.norm(g1) / np.linalg.norm(g2)))


def tangent(year):
    """Belt stars on the tangent plane at Alnilam for a given year: (east, north) in degrees."""
    P = precession(year)
    u = {n: P @ vec(by[n], year)[0] for n in ("Alnitak", "Alnilam", "Mintaka")}
    c = u["Alnilam"]
    north = np.array([0, 0, 1.0]) - c[2] * c; north /= np.linalg.norm(north)
    east = np.cross(north, c)                              # east on the sky as seen from inside
    east = -east if np.dot(east, np.cross(np.array([0, 0, 1.0]), c)) < 0 else east
    return {n: np.degrees(np.array([np.dot(v - c, east), np.dot(v - c, north)])) for n, v in u.items()}


def belt(year):
    t = tangent(year)
    s1, s2 = t["Alnilam"] - t["Alnitak"], t["Mintaka"] - t["Alnilam"]
    ratio = np.linalg.norm(s1) / np.linalg.norm(s2)
    kink = math.degrees(math.acos(np.dot(s1, s2) / np.linalg.norm(s1) / np.linalg.norm(s2)))
    pa = math.degrees(math.atan2(s1[0] + s2[0], s1[1] + s2[1]))    # position angle of Alnitak -> Mintaka, east of north
    cross = s1[0] * s2[1] - s1[1] * s2[0]
    return dict(ratio=float(ratio), kink_deg=kink, pa_deg=pa, turn="left" if cross > 0 else "right",
                sep1_deg=float(np.linalg.norm(s1)), sep2_deg=float(np.linalg.norm(s2)))


b2560, b2000, b10500 = belt(-2559), belt(2000), belt(-10499)


def belt_fit(year):
    """Lay the belt on the plan the way the story does (sky east stays east, sky north becomes ground south), pin Alnitak on
    Khufu and Mintaka on Menkaure with one rotation and one scale, and see where Alnilam lands."""
    t = tangent(year)
    sky = {n: complex(v[0], -v[1]) for n, v in t.items()}                 # (east, -north)
    gk, gm = complex(0, 0), complex(*(g1 + g2)) * IN                       # Khufu, Menkaure centres (east, north) metres
    gf = complex(*g1) * IN
    a = (gm - gk) / (sky["Mintaka"] - sky["Alnitak"])
    land = gk + a * (sky["Alnilam"] - sky["Alnitak"])
    import cmath
    return dict(alnilam_lands_m=[land.real, land.imag], khafre_m=[gf.real, gf.imag], miss_m=abs(land - gf),
                metres_per_degree=abs(a), map_rotation_deg=math.degrees(cmath.phase(a)),
                points={n: [(gk + a * (sky[n] - sky["Alnitak"])).real, (gk + a * (sky[n] - sky["Alnitak"])).imag] for n in sky})


fit2560, fit10500 = belt_fit(-2559), belt_fit(-10499)
gcross = g1[0] * g2[1] - g1[1] * g2[0]
ground_pa = math.degrees(math.atan2(g1[0] + g2[0], g1[1] + g2[1]))
mags = {n: float(by[n]["mag"]) for n in ("Alnitak", "Alnilam", "Mintaka")}
add("orion_belt", "The three pyramids are Orion's belt laid on the ground",
    "Three stars in a slightly bent row, the third one fainter and off the line. Three pyramids in a slightly bent row, the third "
    "one smaller and off the line.",
    ground_ratio, b2560["ratio"], "spacing ratio", "Likely (shape) / Suspected as design",
    "Shape: the pyramids' spacing ratio is %.3f against the belt's %.3f, and the bend is %.1f° against %.1f°. That is a fair "
    "likeness, 4 degrees apart in the bend. Against it: the brightest belt star is the middle one (Alnilam, %.2f mag) while the "
    "biggest pyramid is the end one; to lay the belt on the plan you must put south at the top; and three points always make a "
    "bent row, so only two numbers (ratio and bend) are tested. Pin the two end stars on Khufu and Menkaure and the middle star "
    "lands %.0f m from Khafre's centre (its base is 215 m wide); and the pinned map sits %.0f° away from south-up in 2560 BC, "
    "%.0f° in 10,500 BC. Bauval's wider map (Dahshur, Abu Roash as other Orion stars) is not tested here." % (
        ground_ratio, b2560["ratio"], ground_kink, b2560["kink_deg"], mags["Alnilam"], fit2560["miss_m"],
        abs(fit2560["map_rotation_deg"]), abs(fit10500["map_rotation_deg"])),
    "Petrie 1883 s.92 centre offsets (13931.6, 13165.8; 15170.4, 9450.2 in; the transcription flags the derived distances of "
    "this table as needing correction); HYG v4.1 with space motion; ERFA ltp",
    ground=dict(ratio=float(ground_ratio), kink_deg=ground_kink, pa_deg=ground_pa, turn="left" if gcross > 0 else "right"),
    belt_2560BC=b2560, belt_2000AD=b2000, belt_10500BC=b10500, magnitudes=mags, fit_2560BC=fit2560, fit_10500BC=fit10500)

# ---- 7. the shafts and their stars --------------------------------------------------------------------------------------
SHAFTS = [
    ("KS", "King's Chamber, south", "Alnitak", "upper", 45.0, 45 + 13 / 60 + 40 / 3600, "Orion's belt (Osiris)"),
    ("KN", "King's Chamber, north", "Thuban", "upper", 32 + 28 / 60, 31 + 33 / 60, "the old pole star"),
    ("QS", "Queen's Chamber, south", "Sirius", "upper", 39 + 36 / 60 + 28 / 3600, 38 + 28 / 60, "Sirius (Isis)"),
    ("QN", "Queen's Chamber, north", "Kochab", "upper", 39 + 7 / 60 + 28 / 3600, 37 + 28 / 60, "Kochab, Little Dipper"),
]


def alt(star, year, which):
    up, side, low = culminations(dec_of_date(by[star], year))
    return up if which == "upper" else low


def solve(star, target, which, lo=-3600, hi=-1600):
    f = lambda y: alt(star, y, which) - target
    ys = list(range(lo, hi + 1, 10))
    out = []
    for a, b in zip(ys, ys[1:]):
        if f(a) == 0 or f(a) * f(b) < 0:
            for _ in range(40):
                m = (a + b) / 2
                if f(a) * f(m) <= 0: b = m
                else: a = m
            out.append((a + b) / 2)
    return out


def bc(y):
    """Astronomical year -> historical label (year 0 = 1 BC)."""
    y = int(round(y))
    return "%d BC" % (1 - y) if y <= 0 else "AD %d" % y


shafts = []
for key, name, star, which, gant, petrie, lore in SHAFTS:
    yrs = solve(star, gant, which)
    yrs_p = solve(star, petrie, which)
    a2560 = alt(star, -2559, which)
    shafts.append(dict(key=key, name=name, star=star, lore=lore, gantenbrink_deg=gant, petrie_deg=petrie,
                       altitude_2560BC=a2560, miss_2560BC_deg=a2560 - gant,
                       match_years=[round(y) for y in yrs], match_labels=[bc(y) for y in yrs],
                       petrie_match_labels=[bc(y) for y in yrs_p],
                       side="south" if key.endswith("S") else "north",
                       track=[[y, alt(star, y, which)] for y in range(-3600, -1599, 50)]))
for s in shafts:
    s["nearest_year"] = min(s["match_years"], key=lambda y: abs(y + 2559)) if s["match_years"] else None
    s["nearest_label"] = bc(s["nearest_year"]) if s["match_years"] else "never"
dates = [s["nearest_year"] for s in shafts if s["match_years"]]
add("shaft_stars", "Four shafts aim at four stars",
    "From the King's Chamber one shaft points at Orion's belt and one at the pole star of the age. From the Queen's Chamber, "
    "one at Sirius and one at the Little Dipper. All four, in the century the pyramid was built.",
    shafts[0]["altitude_2560BC"], 45.0, "degrees", "Likely (within about 1°) / Suspected as dating",
    "In 2560 BC the four stars crossed the meridian %.2f°, %.2f°, %.2f° and %.2f° from the shaft angles. Each shaft matches its star "
    "exactly in a different year: %s. The spread is %d years, and all four dates fall after Khufu's reign, so the shafts cannot date the "
    "pyramid to better than about a century (Thuban also fits a second time, in %s, on its way in to the pole); and "
    "the shafts bend on their way out, so 'the' angle is itself a choice (Petrie and Gantenbrink differ by up to 2°)." % (
        *[s["miss_2560BC_deg"] for s in shafts], ", ".join("%s %s" % (s["key"], s["nearest_label"]) for s in shafts),
        max(dates) - min(dates), shafts[1]["match_labels"][0]),
    "Shaft angles: Gantenbrink 1993 as commonly cited (not re-read in this session: Likely); Petrie 1883 s.56 (31°33′, 45°13′40″), "
    "s.44 (37°28′, 38°28′). Sky: HYG v4.1 space motion + ERFA ltp; geometric altitudes, no refraction",
    shafts=shafts, spread_years=max(dates) - min(dates))

# Thuban as pole star
best = min(range(-3600, -1600, 5), key=lambda y: 90 - dec_of_date(by["Thuban"], y))
add("thuban_pole", "Thuban stood still over the pyramid",
    "When the pyramid was built the sky turned around Thuban, in the Dragon, not around Polaris.",
    90 - dec_of_date(by["Thuban"], -2559), 0.0001, "degrees from the pole", "Confirmed",
    "Thuban was %.2f° from the pole in 2560 BC and closest, %.2f°, in %s. Polaris was then %.1f° away. Today Polaris is %.2f° off." % (
        90 - dec_of_date(by["Thuban"], -2559), 90 - dec_of_date(by["Thuban"], best), bc(best),
        90 - dec_of_date(by["Polaris"], -2559), 90 - dec_of_date(by["Polaris"], 2026)),
    "HYG v4.1 + ERFA ltp", closest_year=best, polaris_2560BC=90 - dec_of_date(by["Polaris"], -2559))
claims[-1]["literal_digits"] = None; claims[-1]["rel_error"] = None

out = dict(schema="x3d.io/giza-sacred-claims/1", generated_by="verify_sacred.py",
           tools=dict(erfa=erfa.__version__, numpy=np.__version__, catalogue="HYG v4.1 (David Nash, CC BY-SA 4.0)"),
           latitude=LAT, claims=claims)
json.dump(out, open(sys.argv[3], "w"), indent=1, ensure_ascii=False)
for c in claims:
    print("==", c["key"], "|", c["grade"], "| literal", c["literal_digits"]); print("  ", c["verdict"])
