# SPDX-License-Identifier: GPL-3.0-or-later
"""Demo 65: check every Great Pyramid number claim against published surveys, with error bars.

Writes claims.json: for each claim the claimed value, the surveyed value with its uncertainty, the relative error,
how many significant digits agree, how many digits the survey can support, a grade and the sources.
Grades: Confirmed, Likely, Suspected, False. Pure Python, no dependencies.
Usage: python verify_numbers.py OUT_JSON
"""
import json
import math
import sys

FT = 0.3048
MILE = 1609.344
ACRE = 4046.8564224
CUBIT = 0.5236          # royal cubit, metres (Lehner, Petrie's 20.62 in)

SRC = {
    "dash": "Dash 2015 survey for AERA: mean base side 230.363 m; east 230.295-230.373 m, west 230.378-230.436 m (95%)",
    "petrie": "Petrie 1883, The Pyramids and Temples of Gizeh: base 230.348 m, casing slope 51 deg 52 min +/- 2 min, casing joints mean 0.02 in",
    "cole": "Cole 1925, Survey of Egypt Paper 39: sides 230.253 (N) to 230.454 m (S); mean skew about 3 min west of true north",
    "lehner": "Lehner 1997, The Complete Pyramids: 280 x 440 royal cubits, seked 5 1/2 palms, platform level within about 2.1 cm (secondary report)",
    "aera_gpmp": "AERA Giza Plateau Mapping Project: brass disk on the summit at N 29 58' 44.3830\", E 31 07' 57.0194\" (Helmert 1906 spheroid)",
    "wgs84": "Common WGS84 position of the pyramid's centre: 29.979175 N, 31.134358 E (Wikipedia and mapping services)",
    "si": "SI: speed of light 299 792 458 m/s exactly since the 1983 metre; metre first defined in 1791 as 1/10 000 000 of the pole-to-equator quadrant",
    "iau": "IAU nominal solar radius 695 700 km; Moon radius 1737.4 km; mean distances 149 597 871 km and 384 400 km; Moon sidereal rotation 27.32 d",
    "trimble": "Trimble 1964 and Badawy 1964: King's Chamber shafts at about 45 deg (south) and 32 deg 30 min (north); Gantenbrink 1993: Queen's south shaft about 39 deg 30 min",
    "krupp": "Krupp 1997 and later critiques of the Orion correlation (Bauval and Gilbert 1994)",
    "greaves": "Greaves, Pyramidographia (1646), from his 1638-39 survey; Newton, A Dissertation upon the Sacred Cubit (published 1737)",
}

# ---- surveyed geometry ----------------------------------------------------------------------------------------------
BASE, BASE_U = 230.363, 0.07                 # m, Dash mean; +/- half the side-to-side spread
SLOPE, SLOPE_U = math.radians(51 + 52 / 60), math.radians(2 / 60)
HALF = BASE / 2
H = HALF * math.tan(SLOPE)
H_U = math.sqrt((HALF * (1 / math.cos(SLOPE)) ** 2 * SLOPE_U) ** 2 + (math.tan(SLOPE) * BASE_U / 2) ** 2)


def mc(f, n=20000, seed=1):
    """Monte Carlo mean and 1-sigma of f(base, slope) with the survey uncertainties."""
    import random
    r = random.Random(seed)
    vals = [f(r.gauss(BASE, BASE_U), r.gauss(SLOPE, SLOPE_U)) for _ in range(n)]
    m = sum(vals) / n
    return m, math.sqrt(sum((v - m) ** 2 for v in vals) / (n - 1))


def sig_agree(a, b):
    """Leading significant digits shared by a and b after rounding (how far the coincidence goes)."""
    if a == b:
        return 15
    for d in range(1, 16):
        fa = float("%.*g" % (d, a))
        fb = float("%.*g" % (d, b))
        if fa != fb:
            return d - 1
    return 15


def sig_supported(v, u):
    """Significant digits a value with 1-sigma u can support."""
    if u <= 0:
        return 15
    return max(0, int(math.floor(math.log10(abs(v) / u))))


claims = []


def claim(key, title, claimed, measured, unit, grade, verdict, sources, u=0.0, claim_text=None, section="Dimensions", show=None):
    rel = (measured - claimed) / claimed if claimed else None
    claims.append({
        "key": key, "section": section, "title": title, "claim": claim_text or title,
        "claimed": claimed, "measured": round(measured, 10), "u": round(u, 10), "unit": unit,
        "rel_error_pct": None if rel is None else round(100 * rel, 4),
        "digits_agree": sig_agree(claimed, measured) if claimed else None,
        "digits_supported": sig_supported(measured, u) if u else None,
        "sigma_off": None if not u else round(abs(measured - claimed) / u, 2),
        "grade": grade, "verdict": verdict, "sources": sources, "show": show,
    })


# 1. dimensions
claim("base", "Base side 756 ft", 756.0, BASE / FT, "ft", "Confirmed",
      "755.78 ft (230.363 m). 756 ft rounds it; the design is 440 royal cubits.", ["dash", "petrie", "lehner"], u=BASE_U / FT)
claim("height", "Height 480 ft without the capstone, 1/11 mile", 480.0, H / FT, "ft", "Suspected",
      "5280/11 = 480 is true arithmetic. The surveyed apex height is about 481.3 ft (146.7 m). 480 ft 'without the capstone' needs a cap only "
      "0.4 m tall; the pyramidion is lost and its size unknown (Amenemhat III's surviving one is about 1.3 m).",
      ["petrie", "dash", "lehner"], u=H_U / FT)
claim("ratio711", "Height : base = 7 : 11", 7 / 11, H / BASE, "", "Confirmed",
      "0.6368 against 0.6364: 280 : 440 royal cubits, the slope of a seked of 5 1/2 palms per cubit.", ["petrie", "lehner"], u=H_U / BASE)
claim("acres", "Base area about 13 acres", 13.0, BASE ** 2 / ACRE, "acres", "Confirmed", "53 067 m2 = 13.11 acres.", ["dash"],
      u=2 * BASE * BASE_U / ACRE)
claim("blocks", "2.3 million blocks", 2.3e6, 2.3e6, "blocks", "Likely",
      "An estimate (volume about 2.6 million m3 over an assumed mean block), never a count.", ["lehner"])

# 2. precision
claim("level", "Base level to within 15 mm", 15.0, 21.0, "mm", "Likely",
      "Reported deviation of the platform is about 2.1 cm (secondary report of the Cole/Lehner work); Petrie found a 40 ft stretch of the first course level to 0.02 in. "
      "Same order of magnitude, not the exact 15 mm.", ["lehner", "petrie"], section="Precision")
claim("joints", "Casing joints under 0.5 mm", 0.5, 0.02 * 25.4, "mm", "Confirmed",
      "Petrie's mean joint thickness is 1/50 inch (0.51 mm), measured on the few casing stones left at the base.", ["petrie"], section="Precision")
claim("north", "Aligned to true north within 0.1%", 0.1, 100 * (3.1 / 60) / 360, "% of a turn", "Confirmed",
      "About 3 arcminutes west of north (0.052 deg). '0.1%' is a loose way to say it: as a fraction of a full turn the error is 0.014%.",
      ["cole", "petrie"], section="Precision")

# 3. constants
pi_m, pi_u = mc(lambda b, s: 4 * b / (2 * (b / 2) * math.tan(s)))
claim("pi", "Perimeter / (2 x height) = pi", math.pi, pi_m, "", "Confirmed",
      "%.4f +/- %.4f: pi to 3 significant digits. The seked of 5 1/2 palms makes it 22/7 = 3.1429 by design, so this pi is the "
      "builders' 22/7, not the transcendental number." % (pi_m, pi_u), ["petrie", "dash", "lehner"], u=pi_u, section="Constants", show="pi")
tau_m, tau_u = mc(lambda b, s: 4 * b / ((b / 2) * math.tan(s)))
claim("tau", "Perimeter / height = tau (2 pi)", 2 * math.pi, tau_m, "", "Confirmed",
      "The same ratio as pi, doubled: %.3f. One coincidence, not two." % tau_m, ["petrie", "dash"], u=tau_u, section="Constants", show="tau")
phi_m, phi_u = mc(lambda b, s: 1 / math.cos(s))
PHI = (1 + 5 ** 0.5) / 2
claim("phi", "Slant height / half-base = phi", PHI, phi_m, "", "Likely",
      "%.4f +/- %.4f against 1.6180: phi to 3 significant digits. 14/11 gives 1.6186. pi and phi cannot both be meant exactly: "
      "the pi slope is 51.854 deg, the phi slope 51.827 deg, and the survey (51.867 +/- 0.033 deg) cannot tell them apart." % (phi_m, phi_u),
      ["petrie", "dash"], u=phi_u, section="Constants", show="phi")

# 4. latitude
A_H, F_H = 6378200.0, 1 / 298.3          # Helmert 1906
A_W, F_W = 6378137.0, 1 / 298.257223563  # WGS84
SHIFT = (-130.0, 110.0, -13.0)           # Egypt 1907 -> WGS84 (EPSG 1148, accuracy several metres)


def to_ecef(lat, lon, a, f, h=0.0):
    e2 = f * (2 - f)
    la, lo = math.radians(lat), math.radians(lon)
    n = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
    return ((n + h) * math.cos(la) * math.cos(lo), (n + h) * math.cos(la) * math.sin(lo), (n * (1 - e2) + h) * math.sin(la))


def from_ecef(x, y, z, a, f):
    e2 = f * (2 - f)
    lon = math.atan2(y, x)
    p = math.hypot(x, y)
    lat = math.atan2(z, p * (1 - e2))
    for _ in range(10):
        n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        h = p / math.cos(lat) - n
        lat = math.atan2(z, p * (1 - e2 * n / (n + h)))
    return math.degrees(lat), math.degrees(lon)


disk = (29 + 58 / 60 + 44.3830 / 3600, 31 + 7 / 60 + 57.0194 / 3600)
x, y, z = to_ecef(*disk, A_H, F_H, h=139.0 + 60.0)
disk_w = from_ecef(x + SHIFT[0], y + SHIFT[1], z + SHIFT[2], A_W, F_W)
WGS_CENTRE = 29.979175
M_PER_DEG = 110852.4      # metres per degree of latitude at 30 N (WGS84)
gallery = (-0.6, 41.3)    # north offsets of the Grand Gallery's ends from the pyramid's centre, m (Petrie, as in Demo 63)
g_mid = sum(gallery) / 2
C_LAT = 29.9792458
claim_point_m = (C_LAT - WGS_CENTRE) * M_PER_DEG
lat_lines = BASE / (1e-7 * M_PER_DEG)
claim("latitude", "Latitude of the Grand Gallery's centre = 29.9792458 N", C_LAT, WGS_CENTRE + g_mid / M_PER_DEG, "deg N", "False",
      "A 1e-7 degree step is %.1f cm, so the 230 m pyramid spans about %d such latitude lines; one of them must read 29.9792458, and it lies "
      "%.1f m north of the centre, inside the Gallery but %.1f m south of the Gallery's midpoint (29.979358 N). The building supports 4 to 5 "
      "significant digits (29.979). The summit disk on the old Egyptian datum reads %.6f N; moved to WGS84 it is %.6f N: the datum alone moves the "
      "4th decimal place. The metre is from 1791 and the second's value for c was fixed in 1983."
      % (1e-7 * M_PER_DEG * 100, round(lat_lines, -2), claim_point_m, g_mid - claim_point_m, disk[0], disk_w[0]),
      ["aera_gpmp", "wgs84", "si"], u=5.0 / M_PER_DEG, section="Latitude", show="latitude")

# 5. the "numbers game"
claim("day", "86 400 seconds in a day", 86400, 86400, "s", "Confirmed", "True by definition: 24 x 60 x 60.", ["si"], section="Numbers game")
SUN_D_MI = 2 * 695700e3 / MILE
claim("sun", "Sun's diameter 864 000 miles", 864000, SUN_D_MI, "mi", "Confirmed", "864 576 miles from the IAU nominal solar radius: 864 000 is 0.07% low.", ["iau"], section="Numbers game")
claim("sun_r", "Sun's radius 432 000 miles", 432000, 695700e3 / MILE, "mi", "Confirmed", "432 288 miles: 0.07% off. Only in miles: 695 700 km.", ["iau"], section="Numbers game")
claim("moon_r", "Moon's radius 1 080 miles", 1080, 1737.4e3 / MILE, "mi", "Confirmed", "1 079.6 miles: 0.04% off. Only in miles: 1 737.4 km.", ["iau"], section="Numbers game")
claim("sun_earth", "The Sun is 108 Earths wide", 108, 695700 / 6371.0, "x", "Likely", "109.2 (mean Earth radius 6 371 km): 1% off.", ["iau"], section="Numbers game")
claim("sun_dist", "The Sun is 108 of its own diameters away", 108, 149597871 / (2 * 695700), "x", "Likely", "107.5 on the mean distance; 105.7 to 109.3 over the year.", ["iau"], section="Numbers game")
claim("meridian", "Meridian 40 000 km", 40000.0, 40007.86, "km", "Confirmed",
      "40 007.86 km. True because the metre was defined from it in 1791: it says nothing about Giza.", ["si"], section="Numbers game")
claim("canon_size", "Moon 400 times smaller than the Sun", 400.0, 695700 / 1737.4, "x", "Confirmed", "400.4.", ["iau"], section="Numbers game")
claim("canon_dist", "Moon 400 times closer than the Sun", 400.0, 149597871 / 384400, "x", "Likely",
      "389 on mean distances; it swings from about 363 to 425 over the orbits.", ["iau"], section="Numbers game")
claim("canon_spin", "Earth rotates 400 times faster than the Moon", 400.0, 27.3217 / 0.99727, "x", "False",
      "27.4 times faster (sidereal days). No reading gives 400.", ["iau"], section="Numbers game")

# 6. history and sky
claim("greaves", "Greaves surveyed it in 1637", 1637, 1638, "year", "Likely",
      "He was at Giza in 1638-39 and published Pyramidographia in 1646; Newton used his figures for the sacred cubit.", ["greaves"], section="History and sky")
claim("greaves_foot", "Greaves inscribed one English foot in the King's Chamber", 1, 1, "", "Suspected",
      "No source found for an inscription; his book prints an English foot so that readers could compare it.", ["greaves"], section="History and sky")
claim("shafts_king", "King's Chamber shafts: Orion's Belt (south), the pole star Thuban (north)", 1, 1, "", "Likely",
      "The shaft angles (about 45 deg and 32.5 deg) meet Alnitak and Thuban around 2500 BC, if the date is chosen to fit; within about 1 deg.",
      ["trimble"], section="History and sky")
claim("shafts_queen", "Queen's Chamber shafts: Sirius (south), the pole star (north)", 1, 1, "", "Suspected",
      "The south shaft (about 39.5 deg) fits Sirius near 2400 BC, but both shafts are closed and bend: they never saw the sky.",
      ["trimble"], section="History and sky")
claim("orion", "The three pyramids copy Orion's Belt and point to Heliopolis", 1, 1, "", "Suspected",
      "Contested: the match needs the map turned and the sizes read loosely.", ["krupp"], section="History and sky")

out = {"generated_by": "verify_numbers.py", "base_m": BASE, "base_u_m": BASE_U, "slope_deg": math.degrees(SLOPE), "slope_u_deg": math.degrees(SLOPE_U),
       "height_m": round(H, 3), "height_u_m": round(H_U, 3),
       "slopes_deg": {"measured": round(math.degrees(SLOPE), 3), "pi": round(math.degrees(math.atan(4 / math.pi)), 3),
                      "phi": round(math.degrees(math.acos(1 / PHI)), 3), "seked_5_5": round(math.degrees(math.atan(28 / 22)), 3)},
       "latitude": {"claim": C_LAT, "wgs84_centre": WGS_CENTRE, "gallery_m": gallery, "gallery_mid_lat": round(WGS_CENTRE + g_mid / M_PER_DEG, 7),
                    "claim_point_north_of_centre_m": round(claim_point_m, 2), "south_edge_lat": round(WGS_CENTRE - HALF / M_PER_DEG, 7),
                    "north_edge_lat": round(WGS_CENTRE + HALF / M_PER_DEG, 7), "cm_per_1e-7_deg": round(1e-7 * M_PER_DEG * 100, 2),
                    "lines_through_pyramid": int(round(lat_lines)), "disk_egypt1907": round(disk[0], 7), "disk_wgs84": round(disk_w[0], 7),
                    "disk_lon_wgs84": round(disk_w[1], 7)},
       "sources": SRC, "claims": claims}
json.dump(out, open(sys.argv[1], "w"), indent=1)
for c in claims:
    print("%-13s %-10s claimed %-14s measured %-16s agree %s  supported %s" % (c["key"], c["grade"], c["claimed"], c["measured"], c["digits_agree"], c["digits_supported"]))
print("H %.3f +/- %.3f m" % (H, H_U), "pi %.5f +/- %.5f" % (pi_m, pi_u), "phi %.5f +/- %.5f" % (phi_m, phi_u))
print("latitude", json.dumps(out["latitude"]))
print("slopes", out["slopes_deg"])
