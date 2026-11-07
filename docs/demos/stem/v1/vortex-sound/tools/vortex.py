"""Vortex Reconnection & Sound builder: a vortex ring, and two rings that collide, reconnect and radiate.

  python3 -E -s tools/vortex.py            # both cases (about 16 minutes)
  python3 -E -s tools/vortex.py ring

Numerics in tools/gp.py (Gross-Pitaevskii, split-step Fourier, periodic box L = 64, dt = 0.05). Each case
is run on two grids (96^3, h = 0.667, and 128^3, h = 0.5); frames come from the finer run, as 8-bit density
on a crop around the action. The page meshes the vortex cores (density 0.25) itself.

Topology before claims: the page may call the event a reconnection only because the vortex-loop count,
taken from the phase's winding, follows the same sequence on both grids with the events at matching times.

Limits declared here before the first build (exploration, 5 Nov: Bogoliubov dispersion 4e-6 to 1e-4; ring
speed within 1.4 to 2.9 % of Roberts-Grant plus a periodic-box term, 0.5 % change between grids; the
collision went 2 -> 1 -> 2 loops near t = 48 on the 96^3 grid, compressible energy rising after).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT.parents[1] / "lib"))

import numpy as np                       # noqa: E402
import scipy.fft as sfft                 # noqa: E402
from scipy.spatial import cKDTree        # noqa: E402

import gp                                # noqa: E402
from stemkit import mesh                 # noqa: E402
from stemkit.core import Study, need, sha, witness, write_json   # noqa: E402

L, DT, FRAMES, RHO_MAX, CORE = 64.0, 0.05, 48, 1.25, 0.25
GRIDS = (96, 128)
DEPENDENCIES = ["tools/gp.py"]
STEM_LIB = ["core.py", "mesh.py"]

CASES = {
    "ring": dict(title="A vortex ring", T=30.0, crop=((-24, 24), (-12, 12), (-12, 12)),
                 line="A smoke ring in a superfluid: a loop of whirling quantum fluid that carries itself forward."),
    "reconnection": dict(title="Two rings collide", T=90.0, frame_window=(30.0, 77.0), crop=((-24, 24), (-24, 24), (-12, 12)),
                         line="Two vortex rings meet off-centre, cut and rejoin into new rings that fly apart, and the snap sends sound through the fluid."),
}


def initial(box, cid):
    if cid == "ring":
        psi = gp.ring(box, 8.0, (-10, 0, 0), (1, 0, 0))
    else:
        psi = gp.ring(box, 8.0, (-10, -4, 0), (1, 0, 0)) * gp.ring(box, 8.0, (10, 4, 0), (-1, 0, 0))
    return box.relax(gp.periodize(box, psi))


def compressible_energy(box, psi):
    a = np.maximum(np.abs(psi), 1e-8)
    ph = sfft.fftn(psi, workers=-1)
    w = [np.imag(np.conj(psi) * sfft.ifftn(1j * K * ph, workers=-1)) / a for K in box.k]
    W = [sfft.fftn(x, workers=-1) for x in w]
    kk = box.k2.copy()
    kk[0, 0, 0] = 1
    div = sum(K * Wi for K, Wi in zip(box.k, W)) / kk
    return 0.5 * sum(float(np.sum(np.abs(K * div) ** 2)) for K in box.k) / psi.size * box.h**3


def crop_index(box, crop):
    sl = []
    for lo, hi in crop:
        i0 = int(np.searchsorted(box.x, lo)); i1 = int(np.searchsorted(box.x, hi))
        sl.append(slice(i0, i1))
    return tuple(sl), [float(box.x[s.start]) for s in sl]


def run(cid, n, log, keep_frames):
    c = CASES[cid]
    box = gp.Box(n, L)
    step = box.stepper(DT)
    psi = initial(box, cid)
    N0, E0 = box.norm(psi), box.energy(psi)
    steps = int(round(c["T"] / DT))
    loops, centre, radius, ecomp, frames = [], [], [], [], []
    win = c.get("frame_window", (0.0, c["T"]))
    frame_steps = {int(round((win[0] + k * (win[1] - win[0]) / (FRAMES - 1)) / DT)) for k in range(FRAMES)}
    sl, origin = crop_index(box, c["crop"])
    t0 = time.time()
    for s in range(steps + 1):
        t = s * DT
        if s % 10 == 0:
            nl, _ = gp.loops(psi)
            loops.append((t, nl))
            if cid == "ring":
                p = gp.pierce_points(box, psi)
                centre.append((t, float(p[:, 0].mean())))
                radius.append(float(np.hypot(p[:, 1], p[:, 2]).mean()))
        if s % 100 == 0:
            ecomp.append((t, compressible_energy(box, psi)))
        if keep_frames and s in frame_steps:
            rho = np.abs(psi[sl]) ** 2
            frames.append((t, rho.astype(np.float64), gp.loops(psi)[0]))
        if s < steps:
            psi = step(psi)
    log(f"  {cid} n={n}: {time.time() - t0:.0f}s, loops {sorted({x[1] for x in loops})}")
    return dict(box=box, loops=loops, centre=centre, radius=radius, ecomp=ecomp, frames=frames, origin=origin,
                norm=abs(box.norm(psi) / N0 - 1), energy=abs(box.energy(psi) / E0 - 1))


def events(loops):
    """(time, new count) wherever the loop count changes."""
    return [(t, n) for (t0, n0), (t, n) in zip(loops, loops[1:]) if n != n0]


def bogoliubov():
    """Exact reference for sound: small density waves on the background oscillate at omega = k sqrt(1 + k^2/4)."""
    rows = []
    for m in (1, 3, 6):
        errs = []
        for dt in (0.05, 0.025):
            b = gp.Box(32, 32.0)
            st = b.stepper(dt)
            X, _, _ = b.grid()
            k = 2 * math.pi * m / 32.0
            c = np.cos(k * X) * np.ones((1, 32, 32))
            psi = (1 + 1e-5 * c) + 0j
            amp, ts = [], []
            for s in range(int(round(200 / dt))):
                amp.append(float(np.sum((np.abs(psi) ** 2 - 1) * c)) / c.size); ts.append(s * dt); psi = st(psi)
            a, ts = np.array(amp), np.array(ts)
            zc = np.nonzero(np.signbit(a[1:]) != np.signbit(a[:-1]))[0]
            tz = ts[zc] - a[zc] * dt / (a[zc + 1] - a[zc])
            om = math.pi / np.mean(np.diff(tz))
            errs.append(abs(om / gp.bogoliubov_omega(k) - 1))
        rows.append((m, errs[0], math.log2(errs[0] / errs[1])))
    worst = max(r[1] for r in rows)
    order = rows[-1][2]
    return [witness("sound: small waves vs the Bogoliubov dispersion omega = k sqrt(1 + k^2/4), worst relative error (3 wavenumbers)", worst, 1e-3),
            witness("sound: observed order in dt of that error (largest k), |p - 2|", abs(order - 2), 0.2, note=f"observed {order:.3f}")], rows


def publish(cid, runs, ws, params, log, t_start):
    fine = runs[GRIDS[-1]]
    out = ROOT / "cases" / cid
    study = Study(ROOT, "superfluid", "tools/vortex.py")
    for f in out.glob("*.bin"):
        f.unlink()
    entries, clipped_total, closed_bad, shift = [], 0, 0, 0.0
    h = fine["box"].h
    for k, (t, rho, nl) in enumerate(fine["frames"]):
        q = np.rint(np.clip(rho / RHO_MAX, 0, 1) * 255).astype(np.uint8)
        clipped = int(np.count_nonzero(rho > RHO_MAX))
        clipped_total += clipped
        fd = mesh.pad_field(1 - (q.astype(np.float64) / 255) * RHO_MAX, 0.0)
        verts, faces = mesh.surface_nets(fd, 1 - CORE)
        vol = 0.0
        if len(faces):
            use = mesh.edge_use(faces)
            closed_bad += int(np.count_nonzero(use % 2 == 1))
            tri = verts[faces]
            vol = float(np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6)
            ff = mesh.pad_field(1 - rho, 0.0)
            g = np.linalg.norm(mesh.trilinear_grad(ff, verts), axis=1)
            shift = max(shift, float(np.percentile(np.abs(mesh.trilinear(fd, verts) - mesh.trilinear(ff, verts)) / np.maximum(g, 1e-12), 99)))
        entries.append(study.publish_deflate(q.tobytes(order="C"), out / f"rho{k:03d}.bin", time=float(t), clipped_values=clipped,
                                             quantization_max=0.5 / 255, encoding="uint8 density / 1.25, C order, cropped grid, deflate",
                                             shape=list(q.shape), origin=fine["origin"], h=h, slice_k=int(q.shape[2] // 2), loops=int(nl),
                                             mesh={"iso": 1 - CORE, "vertices": int(len(verts)), "triangles": int(len(faces)), "volume": vol}))
    ws += [witness("closed core meshes: boundary edges over all frames", closed_bad, 0),
           witness("display quantization (8-bit): core-surface shift p99, worst frame (cells)", shift, 0.05),
           witness("clipping: density above the 8-bit range", clipped_total, 0)]
    meta = {"title": CASES[cid]["title"], "line": CASES[cid]["line"],
            "equation": "i psi_t = -1/2 lap(psi) + (|psi|^2 - 1) psi",
            "domain": {"shape": [GRIDS[-1]] * 3, "units": "healing-length units: sound speed 1, healing length 1/sqrt(2), circulation 2 pi", "boundary": "periodic, L = 64"},
            "parameters": {"L": L, "dt": DT, "grids": list(GRIDS), "frames": FRAMES, "core_density": CORE, **params},
            "method": "Strang split-step Fourier (exactly unitary sub-steps); rings from vortex/antivortex pairs in meridional planes, made periodic by a phase ramp and relaxed briefly in imaginary time; vortex lines from the phase winding through grid faces; loops are connected components of the pierced cells.",
            "limits": ["A zero-temperature, weakly interacting superfluid (Gross-Pitaevskii): no thermal cloud, no dissipation, no normal fluid; real superfluid helium has a core about one angstrom across and is strongly interacting.",
                       "A periodic box: rings feel their images (a measured speed-up of about 2 pi^2 R^2 / L^3), and emitted sound wraps round instead of leaving.",
                       "The rings start from an approximate profile, relaxed briefly in imaginary time; the first few time units carry a small transient.",
                       "Vortex positions come from a grid with spacing 0.5 (0.71 healing lengths): separations below about one cell are not resolved."],
            "dependencies": {d: sha((ROOT / d).read_bytes()) for d in DEPENDENCIES},
            "external_dependencies": {f"lib/stemkit/{m}": sha((ROOT.parents[1] / "lib" / "stemkit" / m).read_bytes()) for m in STEM_LIB}}
    metrics = [{"id": f"loops n={n}", "samples": r["loops"]} for n, r in runs.items()] + \
              [{"id": f"compressible energy n={n}", "samples": r["ecomp"]} for n, r in runs.items()] + \
              [{"id": "timing", "seconds": round(time.time() - t_start, 1)}]
    study.save_case(cid, meta, entries, metrics, ws)
    bad = [w["id"] for w in ws if not w["pass"]]
    log(f"{cid}: {len(ws)} witnesses, {len(bad)} red ({time.time() - t_start:.0f}s)" + (": " + "; ".join(bad) if bad else ""))
    for w in ws:
        log(f"   {'ok ' if w['pass'] else 'RED'} {w['id']}: {w['observed']:.6g} {w['rule']} {w['limit']:.6g}")


def build_ring(log, common):
    t0 = time.time()
    runs = {n: run("ring", n, log, keep_frames=(n == GRIDS[-1])) for n in GRIDS}
    speeds = {}
    for n, r in runs.items():
        t, x = np.array(r["centre"]).T
        speeds[n] = float(np.polyfit(t, x, 1)[0])
    R = float(np.mean(runs[GRIDS[-1]]["radius"]))
    ref = gp.roberts_grant_speed(R) + 2 * math.pi**2 * R**2 / L**3
    ws = list(common) + [
        {**witness("ring speed vs Roberts-Grant plus the periodic-box speed-up 2 pi^2 R^2 / L^3, relative difference",
                   abs(speeds[GRIDS[-1]] / ref - 1), 0.05,
                   note="Grade L: a large-ring asymptote (R/xi ~ 11 here) plus a box term whose sign and size were measured in exploration (two box sizes)"), "grade": "L"},
        witness("ring speed between grids (h = 0.667 vs 0.5), relative change", abs(speeds[GRIDS[0]] / speeds[GRIDS[-1]] - 1), 0.02),
        witness("one loop throughout, both grids: samples with any other count", sum(1 for r in runs.values() for _, nl in r["loops"] if nl != 1), 0),
        witness("norm conserved (exactly unitary steps), worst grid, relative", max(r["norm"] for r in runs.values()), 1e-12),
        witness("energy drift, worst grid, relative", max(r["energy"] for r in runs.values()), 1e-4)]
    publish("ring", runs, ws, {"radius": R, "speed": speeds[GRIDS[-1]], "speed_coarse": speeds[GRIDS[0]], "roberts_grant": gp.roberts_grant_speed(R), "reference": ref,
                               "explorer": ["The fluid flows through the ring and around its rim; the ring is carried along by its own flow, slower the bigger it is.",
                                            "Each whirl is quantized: the fluid can only circulate by one fixed amount, so the dark core is a hole where the fluid's wave vanishes."],
                               "lab": [f"Radius {R:.2f}, speed {speeds[GRIDS[-1]]:.4f} (h = 0.5) and {speeds[GRIDS[0]]:.4f} (h = 0.667); Roberts-Grant {gp.roberts_grant_speed(R):.4f}, plus box term {ref:.4f}."]},
            log, t0)


def build_reconnection(log, common):
    t0 = time.time()
    runs = {n: run("reconnection", n, log, keep_frames=(n == GRIDS[-1])) for n in GRIDS}
    ev = {n: events(r["loops"]) for n, r in runs.items()}
    seq = {n: [x[1] for x in e] for n, e in ev.items()}
    same = seq[GRIDS[0]] == seq[GRIDS[1]]
    dt_ev = max((abs(a[0] - b[0]) for a, b in zip(ev[GRIDS[0]], ev[GRIDS[1]])), default=float("inf")) if same else float("inf")
    fine = runs[GRIDS[-1]]
    need(ev[GRIDS[-1]], "NO_EVENT", "the rings did not change topology")
    tr = ev[GRIDS[-1]][0][0]
    e = np.array(fine["ecomp"])
    before = e[(e[:, 0] >= tr - 15) & (e[:, 0] <= tr - 5), 1].mean()
    after = e[(e[:, 0] >= tr + 5) & (e[:, 0] <= tr + 15), 1].mean()
    # strand separation before the first event (a reported measurement, not a gate: sampled once per 0.5
    # time units and resolved only to about a cell, its exponent was not robust in exploration)
    sep = []
    box = fine["box"]
    ws = list(common) + [
        witness("topology agrees between grids: loop-count sequences differ (0 = same)", 0 if same else 1, 0,
                note=f"96^3 {seq[GRIDS[0]]}, 128^3 {seq[GRIDS[1]]}"),
        witness("topology agrees between grids: worst event-time difference (time units)", dt_ev if math.isfinite(dt_ev) else 1e9, 1.5),
        witness("a reconnection happened: loop-count changes on the fine grid", len(ev[GRIDS[-1]]), 1, "at least"),
        witness("sound: compressible kinetic energy after / before the reconnection (5 to 15 time units either side)", after / before, 1.2, "at least"),
        witness("norm conserved (exactly unitary steps), worst grid, relative", max(r["norm"] for r in runs.values()), 1e-12),
        witness("energy drift, worst grid, relative", max(r["energy"] for r in runs.values()), 1e-4)]
    publish("reconnection", runs, ws, {"events_fine": ev[GRIDS[-1]], "events_coarse": ev[GRIDS[0]], "reconnection_time": tr,
                                       "compressible_before": before, "compressible_after": after,
                                       "explorer": ["Two quantum whirlpools cannot pass through each other. Where they touch, the lines cut and swap partners: one loop for a moment, then two new rings flying off.",
                                                    "The cut is sudden, and the fluid rings with it: watch the ripples spread across the slice. In superfluid helium, reconnections like this are how turbulence turns into sound."],
                                       "lab": [f"Loop count {seq[GRIDS[-1]]} at t = {', '.join(f'{x[0]:.1f}' for x in ev[GRIDS[-1]])} (128^3) and {', '.join(f'{x[0]:.1f}' for x in ev[GRIDS[0]])} (96^3).",
                                               f"Compressible kinetic energy {before:.1f} before and {after:.1f} after (5 to 15 time units either side)."]},
            log, t0)


def main():
    a = argparse.ArgumentParser()
    a.add_argument("cases", nargs="*", default=list(CASES))
    args = a.parse_args()
    for c in args.cases:
        need(c in CASES, "UNKNOWN_CASE", c)
    say = lambda m: print(m, flush=True)
    common, rows = bogoliubov()
    say(f"bogoliubov: {rows}")
    for c in args.cases:
        (build_ring if c == "ring" else build_reconnection)(say, common)
    write_json(ROOT / "cases" / "index.json", {"cases": [{"id": k, "title": v["title"], "line": v["line"]} for k, v in CASES.items()]})
    red = sum(not w["pass"] for c in args.cases for w in json.loads((ROOT / "cases" / c / "case.json").read_text())["witnesses"])
    sys.exit(1 if red else 0)


if __name__ == "__main__":
    main()
