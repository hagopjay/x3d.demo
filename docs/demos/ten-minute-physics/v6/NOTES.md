# Batch 6 notes (13 Nov 2026)

Ports of the ideas of Ten Minute Physics 19 (integrators), 23 (sweep and prune) and 24 (Morton codes and a BVH). Own code, no code copied.

## How the limits were set
`witness/limits6.json` was committed first (commit `01bb9dda88744c7c4a620bb542d15fed65f02eb7`, "Declare batch 6 witness limits before the run") and pushed; `witness/tmp6.py` refuses to run if the file differs from its commit and writes the commit and the file's sha256 into every record. So 'limits before the run' is provable from git history here, which it was not in v5. Caveat: git history can be rewritten by whoever owns the repo, and development runs came before the limits and **informed their scale** (orders were known from theory; the 0.01 RK4 position limit, the 5% BVH test share and the 10% SAP share were set with a dev run in view).

## What happened in development, kept in the open
* **Order depends on where you measure.** Symplectic Euler gave order 2.0 at T = 2 pi (a full period) and 1.0 at T = 1 and T = pi/2. The first limits file had one order per method; it now has two tables.
* **Explicit Euler at a full period reads 1.10**, not 1.00; the tolerance is 0.15, so it passes with 0.05 spare. Not a bug (pre-asymptotic), but a reminder that a tolerance is a claim.
* **Sweep and prune bounce bug.** The field's wall bounce first indexed the wrong array and broadcast badly; fixed before any record was written.
* **Sort by centre misses pairs** (905 in 180 frames); this is the control, not a result about the real algorithm.
* **Vacuous mutation controls.** The first run of my 11 edits caught 9: two edits scaled a limit of 0 and changed nothing. Fixed in `mutate.py` by choosing a reference with a nonzero limit. 11 of 11 now.
* **Two renders were redrawn** (Euler's orbit left the frame; the grey all-pairs line left the chart; the query square was too faint).

## Not shown
Stiff systems, adaptive steps, an incrementally updated sweep, moving-object BVH refits, 3D, wall-clock time (all numbers here are counted tests, not seconds), another machine, a real GPU. One CPython, numpy, X_ITE 16.7.1 with software GL. Scenes: x3d_mcp fork 13121b6, XSD 4.0 plus semantic check, 0 errors.
