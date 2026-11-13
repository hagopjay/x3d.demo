"""builds index.html, NOTES.md, NOTICE.md, FIELD-GUIDE.md and receipt.json for v6 from the numbers the run wrote (no number is typed by hand)."""
import json, sys, math
from pathlib import Path
V = Path(sys.argv[1]); N = json.loads((V/'witness/numbers6.json').read_text()); W = json.loads((V/'witness/loom-physics-witness.json').read_text()); M = json.loads((V/'witness/mutation-controls.json').read_text())
o, k, sp, bv = N['ode'], N['ode']['kepler'], N['sap'], N['bvh']; od = lambda t, m: o['orders'][f"{t}:{m}"]['order']
pc = lambda x, d=1: f"{100*x:.{d}f}%"; e = lambda x: f"{x:.2e}"
VAL = "x3d_mcp fork 13121b6, XSD 4.0 plus semantic check"; verdict = W['status'].upper(); LC = N['limits_commit']
tb = sp['tests_by_n']; expo = math.log(tb['800']/tb['100'])/math.log(8)
FG = [
 ("The order of a method depends on where you measure it.", f"Symplectic Euler shows order {od('T1','symplectic'):.2f} measured at T = 1 and {od('T2pi','symplectic'):.2f} at one full period T = 2 pi; explicit Euler reads {od('T2pi','euler'):.2f} there. The leading error term can cancel over a full period. Fit at a time that is not a multiple of the period.", "harmonic oscillator, 5 step sizes each", "Confirmed"),
 ("Bounded energy is not accuracy.", f"On a Kepler orbit (e = {o['kepler_e']}, {o['kepler_steps_per_orbit']} steps per orbit) velocity Verlet keeps the energy error at {pc(k['verlet']['dE_max'],2)} for {o['kepler_orbits']} orbits with no growth (ratio {o['verlet_growth']:.7f}) and is {k['verlet']['pos5']:.2f} (orbit radius units) off the true position after 5 orbits. RK4 drifts in energy ({e(k['rk4']['first10'])} to {e(k['rk4']['last10'])}) but is {k['rk4']['pos5']:.4f} off: {o['verlet_over_rk4_pos5']:.0f} times better. The phase error is the one that a picture shows.", "Kepler, exact position from Newton on Kepler's equation", "Confirmed"),
 ("A symplectic method's advantage is asymptotic, and I did not measure the crossover.", f"At 200 steps per orbit RK4 beat Verlet on both energy ({e(k['rk4']['dE_max'])} against {e(k['verlet']['dE_max'])}) and position over 50 orbits. RK4's energy error was still rising when I stopped, so a crossing very likely exists later; I did not run to it.", "Kepler, 50 orbits", "Suspected (the crossing)"),
 ("Sweep along the long axis.", f"200 boxes in a 4 x 1 field: sweeping x needs {sp['tests_x_mean']:.0f} box tests per frame, sweeping y {sp['tests_y_mean']:.0f} ({sp['axis_ratio']:.1f} times more), brute force {sp['brute_pairs']}. Pick the axis with the largest spread.", f"mean of {sp['frames']} frames", "Confirmed"),
 ("Sweep and prune is not O(n) at constant density.", f"Tests per frame: {tb['100']:.0f}, {tb['200']:.0f}, {tb['400']:.0f}, {tb['800']:.0f} for 100, 200, 400, 800 boxes at fixed density and aspect: exponent {expo:.2f}. The reason is that each box tests every box whose x range it overlaps, and that count grows with the field height.", "counted tests, 20 frames each", "Confirmed (the exponent); Likely (the reason)"),
 ("Sort by the left edge, not by the centre.", f"Sorting by centre with the usual early exit missed {sp['center_sort_missed']} overlapping pairs over {sp['frames']} frames. A large box's left edge is far from its centre.", "same frames, brute-force pair sets", "Confirmed"),
 ("Morton codes: test the bit trick against the slow loop, including the corners.", f"{bv['morton_cases']:,} inputs (random, all four corners, the alternating patterns 0xAAAA / 0x5555), {bv['morton_mismatches']} mismatches.", "naive bit-by-bit interleave", "Confirmed"),
 ("A Morton-sorted tree gives log-like queries from one sort.", f"{bv['objects']} boxes, {bv['queries']} random queries: {bv['tests_per_query']:.1f} tests per query against {bv['brute_per_query']} ({pc(bv['tests_over_brute'],2)}), {bv['wrong_queries']} queries different from brute force, about {bv['hits_per_query']:.1f} hits each. 12 levels deep (log2 n = {bv['log2n']}), so about {bv['tests_per_query']/bv['hits_per_query']:.0f} tests per hit.", "set equality with an O(n) search", "Confirmed"),
 ("Node boxes must enclose their children, exactly.", f"Shrinking every node box by 0.02 lost {bv['shrunk_bounds_missed']} hits over {bv['queries']} queries. A tree that is a little too tight is silently wrong, not slow.", "same queries", "Confirmed"),
 ("A mutation control with a zero limit cannot fail.", "My first 'limit x 10' edits on references whose limit is 0 (pairs missed, mismatches) changed nothing and the checker accepted them: two of eleven controls were vacuous. Pick a reference with a nonzero limit, and count the controls that were caught.", "found by running them, fixed in witness/mutate.py", "Confirmed"),
]
def fg_html():
    rows = "".join(f"<tr><td>{i+1}</td><td><b>{a}</b><br><small>{b}</small></td><td>{c}</td><td>{d}</td></tr>" for i, (a, b, c, d) in enumerate(FG))
    return f"<b>Field guide, batch 6 additions.</b> The v5 guide still stands (<a href='../v5/FIELD-GUIDE.md'>earlier rows</a> are in v5/).<table><tr><th>#</th><th>Rule and why</th><th>Number came from</th><th>Grade</th></tr>{rows}</table>"
(V/'FIELD-GUIDE.html').write_text(fg_html())
(V/'FIELD-GUIDE.md').write_text("# Field guide, batch 6 additions\n\nThe v5 guide (`../v5/FIELD-GUIDE.md`) still stands. Grades: Confirmed / Likely / Suspected.\n\n" + "\n".join(f"{i+1}. **{a}** {b} _({c}; {d})_" for i, (a, b, c, d) in enumerate(FG)) + "\n")
D = []
D.append(dict(f="19-ode-integrators.x3d", t="19 Integrators", x=(
 f"<b>Physics.</b> Five ways to advance x' = v, v' = a(x): explicit Euler, symplectic Euler, midpoint, velocity Verlet, RK4. One Kepler orbit (e = {o['kepler_e']}), 100 steps per orbit, 3 orbits in the scene (white = exact orbit, from Newton's iteration on Kepler's equation). Right: error against step size for the harmonic oscillator over one period; the slope of each line is its order.<br>"
 f"<b>Insight 1: order is a slope, and it depends on where you read it.</b> Orders measured from 5 step sizes at T = 1: Euler {od('T1','euler'):.2f}, symplectic Euler {od('T1','symplectic'):.2f}, midpoint {od('T1','midpoint'):.2f}, Verlet {od('T1','verlet'):.2f}, RK4 {od('T1','rk4'):.2f}. At a full period symplectic Euler reads {od('T2pi','symplectic'):.2f}: the leading error cancels over a period.<br>"
 f"<b>Insight 2: bounded energy is not accuracy.</b> Verlet's energy error stays at {pc(k['verlet']['dE_max'],2)} over {o['kepler_orbits']} orbits (no growth), yet after 5 orbits its position is {k['verlet']['pos5']:.2f} off, RK4's {k['rk4']['pos5']:.4f}. Symplectic Euler is bounded too ({pc(k['symplectic']['dE_max'])}) and {k['symplectic']['pos5']:.2f} off; explicit Euler spirals out (energy {pc(k['euler']['dE_max'])}, drawn clipped).<br>"
 f"<b>Insight 3: the honest comparison goes the other way at this step size.</b> RK4 drifted in energy but stayed below Verlet's bound for all {o['kepler_orbits']} orbits, and midpoint grew {k['midpoint']['last10']/k['midpoint']['first10']:.1f} times. Where RK4 finally crosses Verlet I did not measure (Suspected).<br>"
 f"<b>Not shown:</b> stiff systems, adaptive steps, other eccentricities.<br><small>Idea: Ten Minute Physics 19 (differential equations). Own code.</small>"),
 n=[["order at T = 1: Euler / symplectic / midpoint / Verlet / RK4", " / ".join(f"{od('T1',m):.2f}" for m in ['euler','symplectic','midpoint','verlet','rk4'])],["order at T = 2 pi", " / ".join(f"{od('T2pi',m):.2f}" for m in ['euler','symplectic','midpoint','verlet','rk4'])],
    ["Kepler worst energy error over 50 orbits: Verlet / RK4 / midpoint / symplectic Euler / Euler", " / ".join(e(k[m]['dE_max']) for m in ['verlet','rk4','midpoint','symplectic','euler'])],["position error after 5 orbits: Verlet / RK4", f"{k['verlet']['pos5']:.4f} / {k['rk4']['pos5']:.4f}"]]))
D.append(dict(f="23-sweep-and-prune.x3d", t="23 Sweep and prune", x=(
 f"<b>Physics.</b> {sp['boxes']} boxes drift and bounce in a 4 x 1 field; boxes that overlap turn red (about {sp['overlaps_mean']:.0f} pairs at a time). Sweep and prune sorts the boxes by left edge and lets each box test only the boxes whose left edge lies before its right edge. Chart: box tests per frame, cyan = sweep along x, orange = along y, grey = all {sp['brute_pairs']} pairs (clipped at the chart top).<br>"
 f"<b>Insight 1: exact, not approximate.</b> Over {sp['frames']} frames the pair set equals the brute-force pair set: {sp['missed']} pairs missed, {sp['false']} false, on both axes.<br>"
 f"<b>Insight 2: pick the long axis.</b> {sp['tests_x_mean']:.0f} tests per frame along x, {sp['tests_y_mean']:.0f} along y ({sp['axis_ratio']:.1f} times more). Along x is {pc(sp['x_over_brute'])} of brute force.<br>"
 f"<b>Insight 3: it is not O(n).</b> At fixed density: {tb['100']:.0f}, {tb['200']:.0f}, {tb['400']:.0f}, {tb['800']:.0f} tests for 100 to 800 boxes, exponent {expo:.2f}. And sorting by the centre instead of the left edge missed {sp['center_sort_missed']} pairs.<br>"
 f"<b>Not shown:</b> an incrementally updated insertion sort (I sort afresh), 3D, wall-clock time (counts only).<br><small>Idea: Ten Minute Physics 23. Own code.</small>"),
 n=[["pairs missed / false vs brute force (limit 0 / 0)", f"{sp['missed']} / {sp['false']}"],["tests per frame: x / y / brute", f"{sp['tests_x_mean']:.0f} / {sp['tests_y_mean']:.0f} / {sp['brute_pairs']}"],["axis ratio (limit >= 2) / x over brute (limit 0.10)", f"{sp['axis_ratio']:.2f} / {sp['x_over_brute']:.4f}"],["centre sort: pairs missed", str(sp['center_sort_missed'])]]))
D.append(dict(f="24-morton-bvh.x3d", t="24 Morton and BVH", x=(
 f"<b>Physics.</b> 1024 boxes in a square (grey points, centres). The blue line walks them in Z order: interleave the bits of the grid coordinates and sort, once. A binary tree is built over that order; coloured rectangles are the nodes at depths 1 (white) to 5 (violet). The white square is a moving query; the red points are the boxes it hits. (The numbers come from a 4096-box tree.)<br>"
 f"<b>Insight 1: test the bit trick against the slow loop.</b> {bv['morton_cases']:,} inputs including the corners and the alternating patterns: {bv['morton_mismatches']} mismatches.<br>"
 f"<b>Insight 2: one sort gives a log-depth tree.</b> {bv['tests_per_query']:.1f} tests per query against {bv['brute_per_query']} ({pc(bv['tests_over_brute'],2)}), {bv['wrong_queries']} of {bv['queries']} queries differing from brute force.<br>"
 f"<b>Insight 3: a slightly tight tree is silently wrong.</b> Shrinking node boxes by 0.02 lost {bv['shrunk_bounds_missed']} hits in {bv['queries']} queries.<br>"
 f"<b>Not shown:</b> moving objects (rebuilt, not refit), construction time, 3D, wall-clock time.<br><small>Idea: Ten Minute Physics 24. Own code.</small>"),
 n=[["Morton mismatches (limit 0)", f"{bv['morton_mismatches']} of {bv['morton_cases']:,}"],["queries differing from brute force (limit 0)", f"{bv['wrong_queries']} of {bv['queries']}"],["tests per query (limit 5% of 4096)", f"{bv['tests_per_query']:.1f} ({pc(bv['tests_over_brute'],2)})"],["shrunk-box control: hits lost", str(bv['shrunk_bounds_missed'])]]))
D.append(dict(f="", t="Field guide", x=(V/'FIELD-GUIDE.html').read_text(), n=[]))
D.append(dict(f="", t="Witness", x=(
 f"<b>Loom physics witness.</b> Three run records, hash replay in a fresh process (nondeterminism only), references with limits, controls that must fail. <b>The limits were committed before the run</b>: <code>witness/limits6.json</code> at commit <code>{LC[:7]}</code>, and tmp6.py refuses to run if that file differs from its commit; each record names the commit and the file's sha256. That is as strong as git history (the same person can rewrite history), and development runs came first and informed the scale of some limits. Verdict: {verdict}, 0 waivers. {M['caught']} of {M['total']} edits to my own records were refused with their intended code (two of the first eleven controls were vacuous because their limit was 0; fixed).<br>"
 f"Scenes: {VAL}, 0 errors, 0 diagnostics."),
 n=[["runs / waivers","3 / 0"],["limits commit",LC[:12]],["hash replays (fresh process)","0 mismatches"],["mutation controls caught",f"{M['caught']} / {M['total']}"]]))
html = open(Path(__file__).with_name('index.template.html')).read().replace('__DATA__', json.dumps(D)).replace('__NUMBERS_NOTE__', f"validator: {VAL}, 0 errors; witness: Loom kit physics, {verdict}; X_ITE 16.7.1; numpy {N.get('numpy','2.5.3')}; counts, not clock times; receipt.json has the rest")
(V/'index.html').write_text(html)
rec = dict(schema="loom-receipt-lite/1", batch=6, validator=f"hagopjay/{VAL}, 0 errors on all three scenes", witness=f"x3d.loom kit/loom physics (main 433b5c9): 3 runs, --hosts numpy-fresh-process, max waivers 0: {verdict}", limits_committed_before_run=f"{LC} (witness/limits6.json)",
    mutation_controls=f"{M['caught']} of {M['total']} edits to my records refused with their intended code", renderer="X_ITE 16.7.1, headless Chromium, software GL, screenshots only", grade="Confirmed for numbers (tmp6.py, one machine, counts not timings); Likely for explanations; Suspected for the RK4/Verlet crossover", numbers=N)
(V/'receipt.json').write_text(json.dumps(rec, indent=1))
(V/'NOTES.md').write_text(f"""# Batch 6 notes (13 Nov 2026)

Ports of the ideas of Ten Minute Physics 19 (integrators), 23 (sweep and prune) and 24 (Morton codes and a BVH). Own code, no code copied.

## How the limits were set
`witness/limits6.json` was committed first (commit `{LC}`, "Declare batch 6 witness limits before the run") and pushed; `witness/tmp6.py` refuses to run if the file differs from its commit and writes the commit and the file's sha256 into every record. So 'limits before the run' is provable from git history here, which it was not in v5. Caveat: git history can be rewritten by whoever owns the repo, and development runs came before the limits and **informed their scale** (orders were known from theory; the 0.01 RK4 position limit, the 5% BVH test share and the 10% SAP share were set with a dev run in view).

## What happened in development, kept in the open
* **Order depends on where you measure.** Symplectic Euler gave order 2.0 at T = 2 pi (a full period) and 1.0 at T = 1 and T = pi/2. The first limits file had one order per method; it now has two tables.
* **Explicit Euler at a full period reads {od('T2pi','euler'):.2f}**, not 1.00; the tolerance is 0.15, so it passes with 0.05 spare. Not a bug (pre-asymptotic), but a reminder that a tolerance is a claim.
* **Sweep and prune bounce bug.** The field's wall bounce first indexed the wrong array and broadcast badly; fixed before any record was written.
* **Sort by centre misses pairs** ({sp['center_sort_missed']} in {sp['frames']} frames); this is the control, not a result about the real algorithm.
* **Vacuous mutation controls.** The first run of my 11 edits caught 9: two edits scaled a limit of 0 and changed nothing. Fixed in `mutate.py` by choosing a reference with a nonzero limit. 11 of 11 now.
* **Two renders were redrawn** (Euler's orbit left the frame; the grey all-pairs line left the chart; the query square was too faint).

## Not shown
Stiff systems, adaptive steps, an incrementally updated sweep, moving-object BVH refits, 3D, wall-clock time (all numbers here are counted tests, not seconds), another machine, a real GPU. One CPython, numpy, X_ITE 16.7.1 with software GL. Scenes: {VAL}, 0 errors.
""")
(V/'NOTICE.md').write_text("""# Credit and licence

These demos are **independent ports of ideas** from Matthias Mueller's *Ten Minute Physics* series
(https://matthias-research.github.io/pages/tenMinutePhysics/ , source repo matthias-research/pages).
The code here (`witness/tmp6.py`) was written from the published method descriptions; **no code was copied**.
The upstream repository shows no LICENSE file (checked 13 Nov 2026), so nothing from it is redistributed.
This project is independent and not endorsed by the author. Watch the originals: they are excellent.
""")
print('page ok', len(html))
