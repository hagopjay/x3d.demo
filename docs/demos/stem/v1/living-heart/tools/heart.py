"""Living Heart builder: paced tissue, a spiral wave, and a scroll wave in a ventricle-shaped wall.

  python3 -E -s tools/heart.py            # every case (about 3 minutes)
  python3 -E -s tools/heart.py spiral

Numerics in tools/ap.py (Aliev-Panfilov, h = 0.5, dt = 0.01). Each case publishes one period of computed
states (36 frames) as 8-bit voltage on a display grid of every other cell (h = 1); the heart case also
publishes its wall geometry (a smooth 16-bit field) so the page can mesh the wall itself.

Limits declared here before the first build (exploration, 4 Nov: Nagumo speed order 2.05 / 2.03,
Richardson 1.4e-4; spiral period 33.5 at h = 0.5 vs 33.25 at h = 0.25; ventricle probes 33.2 to 33.4).
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

import ap                                # noqa: E402
from stemkit import mesh                 # noqa: E402
from stemkit.core import Study, need, sha, witness, write_json   # noqa: E402

H, FRAMES = 0.5, 36
DT = 0.04 * H * H
DEPENDENCIES = ["tools/ap.py"]
STEM_LIB = ["core.py", "mesh.py"]
RO, ZO, RI, ZI, ZCUT = 28.0, 48.0, 20.0, 40.0, 17.0        # ventricle wall: outer and inner ellipsoids, base cut
PACE = 60.0

CASES = {
    "paced": dict(title="Paced tissue", line="A strip of heart muscle paced from the left edge: each beat a wave of voltage that sweeps across and recovers behind."),
    "spiral": dict(title="Spiral wave", line="A broken wave curls into a spiral that drives the tissue by itself, faster than any heartbeat: the shape of re-entrant tachycardia."),
    "heart": dict(title="Scroll wave in a ventricle", line="The same spiral wrapped onto a ventricle's wall, where it becomes a scroll wave: the electrical engine of ventricular tachycardia."),
}


def run2d(u, v, T, probes=(), record=None, every=None):
    un, vn = np.empty_like(u), np.empty_like(v)
    tr, frames = {p: [] for p in probes}, []
    every_probe = int(round(0.2 / DT))
    for s in range(int(round(T / DT))):
        ap.step2d(u, v, un, vn, DT, H, ap.K, ap.A, ap.EPS0, ap.MU1, ap.MU2, ap.D)
        u, un, v, vn = un, u, vn, v
        t = (s + 1) * DT
        if s % every_probe == 0:
            for p in probes:
                tr[p].append((t, u[p]))
        if record and record(t, s + 1):
            frames.append((t, u.copy()))
    return u, v, tr, frames


def activations(trace):
    a = np.array(trace)
    up = np.nonzero((a[1:, 1] >= 0.5) & (a[:-1, 1] < 0.5))[0]
    return a[up, 0] + (0.5 - a[up, 1]) / (a[up + 1, 1] - a[up, 1]) * (a[up + 1, 0] - a[up, 0])


def linear_mode(n=64, steps=40, amp=1e-9):
    """Exact discrete control: a small Neumann cosine mode of u about rest decays by (1 - dt (D lam + k a))^steps."""
    i = np.arange(n)
    m1, m2 = 3, 5
    cx, cy = np.cos(np.pi * m1 * (i + 0.5) / n), np.cos(np.pi * m2 * (i + 0.5) / n)
    u = amp * np.outer(cx, cy)
    v = np.zeros_like(u)
    un, vn = np.empty_like(u), np.empty_like(v)
    for _ in range(steps):
        ap.step2d(u, v, un, vn, DT, H, ap.K, ap.A, ap.EPS0, ap.MU1, ap.MU2, ap.D)
        u, un, v, vn = un, u, vn, v
    lam = ((2 - 2 * math.cos(math.pi * m1 / n)) + (2 - 2 * math.cos(math.pi * m2 / n))) / H**2
    ref = amp * (1 - DT * (ap.D * lam + ap.K * ap.A)) ** steps
    got = float((u * np.outer(cx, cy)).sum() / (np.outer(cx, cy) ** 2).sum())
    return abs(got / ref - 1)


def common_witnesses():
    c = ap.nagumo_speed()
    s1, s2 = ap.front_speed(H, DT), ap.front_speed(H / 2, DT / 4)
    s0 = ap.front_speed(2 * H, DT * 4)
    order = math.log2(abs(s0 - c) / abs(s1 - c))
    rich = (4 * s2 - s1) / 3
    ws = [witness(f"Nagumo front (recovery off) vs exact sqrt(kD/2)(1-2a) = {c}: observed order in h, |p - 2|", abs(order - 2), 0.1, note=f"observed {order:.4f}"),
          witness("Nagumo front speed, Richardson over h = 0.5 and 0.25, relative error", abs(rich / c - 1), 1e-3),
          witness("resting state: a small Neumann mode decays at the exact discrete rate, relative error", linear_mode(), 1e-6)]
    return ws, dict(nagumo_exact=c, nagumo_h=s1, nagumo_h2=s2, nagumo_2h=s0, nagumo_richardson=rich)


def display2d(u):
    return u[::2, ::2]          # every other cell: the display grid has h = 1


def quantize(u):
    clipped = int(np.count_nonzero((u < 0) | (u > 1)))
    return np.rint(np.clip(u, 0, 1) * 255).astype(np.uint8), clipped


def publish_frames(study, out, frames, shape_note, mask_display=None):
    for f in out.glob("*.bin"):
        f.unlink()
    entries, clipped_total = [], 0
    for k, (t, u) in enumerate(frames):
        q, clipped = quantize(u)
        clipped_total += clipped
        active = int(np.count_nonzero(q[mask_display] > 127)) if mask_display is not None else int(np.count_nonzero(q > 127))
        entries.append(study.publish_deflate(q.tobytes(order="C"), out / f"u{k:03d}.bin", time=float(t), clipped_values=clipped,
                                             quantization_max=0.5 / 255, encoding=f"uint8 voltage u (0..1), C order, {shape_note}, deflate",
                                             shape=list(q.shape), active_cells=active))
    return entries, clipped_total


def build_paced(log, common):
    t0 = time.time()
    nx, ny = int(100 / H), int(60 / H)
    u, v = np.zeros((nx, ny)), np.zeros((nx, ny))
    p1, p2 = (int(30 / H), ny // 2), (int(70 / H), ny // 2)
    # pace: every PACE time units, depolarize the leftmost 1.5 units
    beats = 10
    un, vn = np.empty_like(u), np.empty_like(v)
    tr = {p1: [], p2: []}
    frames, t_last = [], (beats - 1) * PACE
    every = int(round(PACE / FRAMES / DT))
    for s in range(int(round(beats * PACE / DT))):
        t = s * DT
        if s % int(round(PACE / DT)) == 0:
            u[: int(1.5 / H), :] = 1.0
        ap.step2d(u, v, un, vn, DT, H, ap.K, ap.A, ap.EPS0, ap.MU1, ap.MU2, ap.D)
        u, un, v, vn = un, u, vn, v
        if s % int(round(0.2 / DT)) == 0:
            tr[p1].append((t + DT, u[p1])); tr[p2].append((t + DT, u[p2]))
        k = s - int(round(t_last / DT))
        if k >= 0 and k % every == 0 and len(frames) < FRAMES:
            frames.append((t + DT, display2d(u).copy()))
    a1, a2 = activations(tr[p1]), activations(tr[p2])
    dist = (p2[0] - p1[0]) * H
    first = float(dist / (a2[0] - a1[0]))
    speed = float(np.mean(dist / (a2[-3:] - a1[-3:])))
    cable = ap.front_speed(H, DT, nagumo=False)
    # The first build compared the steady paced speed with a single wave into rested tissue (4.1 % apart):
    # unlike things, since paced tissue has not fully recovered. Like with like: the first beat vs the cable;
    # the slowdown under pacing (conduction-velocity restitution) is then its own measured claim.
    ws = list(common) + [
        witness("paced sheet: first beat's conduction speed vs a 1D cable with the same numerics, relative difference", abs(first / cable - 1), 0.02, note=f"sheet {first:.4f}, cable {cable:.4f}"),
        witness("restitution: steady paced beats conduct slower than the first (steady / first)", speed / first, 0.999, note=f"steady {speed:.4f}"),
        witness("paced sheet: every beat conducts (activations at the far probe = beats)", abs(len(a2) - beats), 0),
        witness("bounded voltage: values outside [0, 1] in the published frames", 0, 0)]
    return finish("paced", ws, frames, {"conduction_speed": speed, "first_beat_speed": first, "cable_speed": cable, "pacing_period": PACE, "beats": beats, "domain_units": [100, 60]}, t0, log)


def make_spiral(T, h_scale=1):
    """Developed 2D spiral from a broken wave (120 x 120 units)."""
    h = H / h_scale
    n = int(round(120 / h))
    x = (np.arange(n) + 0.5) * h
    X, Y = np.meshgrid(x, x, indexing="ij")
    u, v = np.zeros((n, n)), np.zeros((n, n))
    u[(X > 54) & (X < 60) & (Y < 60)] = 1.0
    v[(X > 44) & (X <= 54) & (Y < 60)] = 1.5
    return u, v, n


def spiral_period(h_scale, T=600.0):
    global DT, H
    h0, dt0 = H, DT
    H, DT = h0 / h_scale, dt0 / h_scale**2
    try:
        u, v, n = make_spiral(T, 1)
        probe = (n // 4, n // 4)
        u, v, tr, _ = run2d(u, v, T, probes=[probe])
    finally:
        H, DT = h0, dt0
    acts = activations(tr[probe])
    return float(np.mean(np.diff(acts)[-6:])), np.diff(acts)


def build_spiral(log, common):
    t0 = time.time()
    T_h, per_h = spiral_period(1)
    T_h2, _ = spiral_period(2)
    u, v, n = make_spiral(0)
    probe = (n // 4, n // 4)
    u, v, tr, _ = run2d(u, v, 400.0, probes=[probe])
    acts = activations(tr[probe])
    period = T_h
    start = acts[-1] + period                     # the next cycle: entirely after the recording run begins
    steps = {int(round((start + k * period / FRAMES - 400.0) / DT)) for k in range(FRAMES)}
    u, v, tr2, frames = run2d(u, v, (max(steps) + 1) * DT, record=lambda t, s: s in steps)
    frames = [(t + 400.0, display2d(f)) for t, f in frames]
    need(len(frames) == FRAMES, "FRAME_COUNT", str(len(frames)))
    tail = per_h[-6:]
    ws = list(common) + [
        witness("spiral period under refinement: |T(h = 0.5) / T(h = 0.25) - 1|", abs(T_h / T_h2 - 1), 0.02, note=f"{T_h:.3f} vs {T_h2:.3f}"),
        witness("spiral is steady: spread of the last six periods / mean", float((tail.max() - tail.min()) / tail.mean()), 0.02),
        witness("bounded voltage: values outside [0, 1] in the published frames", 0, 0)]
    return finish("spiral", ws, frames, {"period": T_h, "period_h2": T_h2, "period_ms": T_h * ap.MS_PER_UNIT, "rate_bpm": 60000 / (T_h * ap.MS_PER_UNIT),
                                         "domain_units": [120, 120]}, t0, log)


def ventricle(h):
    xs = np.arange(-29, 29, h) + h / 2
    zs = np.arange(-49, ZCUT + 1, h) + h / 2
    X, Y, Z = np.meshgrid(xs, xs, zs, indexing="ij")
    r2 = X**2 + Y**2
    # smooth wall field: positive inside the tissue (outer ellipsoid, outside the inner one, below the base cut)
    g = np.minimum(np.minimum(1 - r2 / RO**2 - Z**2 / ZO**2, r2 / RI**2 + Z**2 / ZI**2 - 1), (ZCUT - Z) / ZO)
    return X, Y, Z, g


def build_heart(log, common, spiral_T):
    t0 = time.time()
    # seed: a developed 2D spiral (both fields) mapped onto the wall by arc length around the axis and height
    u2, v2, n2 = make_spiral(0)
    u2, v2, _, _ = run2d(u2, v2, 200.0)
    X, Y, Z, g = ventricle(H)
    mask = g > 0
    th = np.arctan2(Y, X)
    rmid = (RO * np.sqrt(np.clip(1 - Z**2 / ZO**2, 0, 1)) + RI * np.sqrt(np.clip(1 - Z**2 / ZI**2, 0, 1))) / 2
    S1, S2 = th * rmid + 60.0, Z + 75.0
    inside = (S1 >= 0) & (S1 < 120) & (S2 >= 0) & (S2 < 120) & mask
    ii, jj = np.clip((S1 / H).astype(int), 0, n2 - 1), np.clip((S2 / H).astype(int), 0, n2 - 1)
    u0, v0 = np.where(inside, u2[ii, jj], 0.0), np.where(inside, v2[ii, jj], 0.0)
    m8 = mask.astype(np.uint8)

    def run3d(u, v, T, probes=(), frame_steps=()):
        un, vn = np.empty_like(u), np.empty_like(v)
        tr, frames = {p: [] for p in probes}, []
        lo, hi = 0.0, 1.0
        every = int(round(0.2 / DT))
        for s in range(int(round(T / DT))):
            ap.step3d(u, v, un, vn, m8, DT, H, ap.K, ap.A, ap.EPS0, ap.MU1, ap.MU2, ap.D)
            u, un, v, vn = un, u, vn, v
            t = (s + 1) * DT
            if s % every == 0:
                for p in probes:
                    tr[p].append((t, u[p]))
            if (s + 1) in frame_steps:
                frames.append((t, u[::2, ::2, ::2].copy()))
        return u, v, tr, frames

    def idx(x, y, z):
        return int((x + 29) / H), int((y + 29) / H), int((z + 49) / H)
    probes = [idx(-26.5, 0, -8), idx(0, 18, -30), idx(0, -26, 8), idx(26.5, 3, -5)]
    for p in probes:
        need(mask[p], "PROBE_OUTSIDE_TISSUE", str(p))
    # reproducibility: the first 2,000 steps twice
    a1 = run3d(u0.copy(), v0.copy(), 2000 * DT)[0]
    a2 = run3d(u0.copy(), v0.copy(), 2000 * DT)[0]
    differing = int(np.count_nonzero(a1 != a2))
    T1 = 400.0
    u, v, tr, _ = run3d(u0.copy(), v0.copy(), T1, probes)
    periods = [float(np.mean(np.diff(activations(tr[p]))[-6:])) for p in probes]
    T3 = float(np.mean(periods))
    start = max(activations(tr[probes[0]])[-1], T1) + T3
    steps = {int(round((start - T1 + k * T3 / FRAMES) / DT)) for k in range(FRAMES)}
    u, v, _, frames = run3d(u, v, (max(steps) + 1) * DT, frame_steps=steps)
    frames = [(t + T1, f) for t, f in frames]
    need(len(frames) == FRAMES, "FRAME_COUNT", str(len(frames)))
    lap = float(np.abs(ap.masked_laplacian_sum(u, m8).sum()) / np.abs(u[mask]).sum())
    tissue_u = u[mask]
    ws = list(common) + [
        witness("no-flux walls: |sum of the masked Laplacian over the tissue| / sum |u|", lap, 1e-12),
        witness("scroll period vs the flat spiral's, relative difference", abs(T3 / spiral_T - 1), 0.03, note=f"{T3:.3f} vs {spiral_T:.3f}"),
        witness("every probe beats at the same period: spread / mean", (max(periods) - min(periods)) / T3, 0.02),
        witness("reproducibility: cells differing on a 2,000-step rerun", differing, 0),
        witness("bounded voltage: tissue values outside [-0.05, 1.05] at the end", int(np.count_nonzero((tissue_u < -0.05) | (tissue_u > 1.05))), 0)]
    # wall geometry on the display grid, published for the page to mesh, with the reference mesh counts
    gd = g[::2, ::2, ::2]
    gmax = float(np.abs(gd).max())
    gq = np.rint((np.clip(gd / gmax, -1, 1) + 1) / 2 * 65535).astype("<u2")
    gfield = mesh.pad_field(gq.astype(np.float64) / 65535 * 2 - 1, -1.0)
    verts, faces = mesh.surface_nets(gfield, 0.0)
    use = mesh.edge_use(faces)
    tri = verts[faces]
    vol = float(np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6)
    ws += [witness("wall mesh is closed: boundary edges", int(np.count_nonzero(use % 2 == 1)), 0)]
    mask_d = gd > 0
    extra = {"geometry": {"verts": len(verts), "faces": len(faces), "volume": vol, "gq": gq, "gmax": gmax}, "mask_display": mask_d}
    return finish("heart", ws, frames, {"period": T3, "probe_periods": periods, "period_ms": T3 * ap.MS_PER_UNIT, "rate_bpm": 60000 / (T3 * ap.MS_PER_UNIT),
                                        "wall": {"outer": [RO, RO, ZO], "inner": [RI, RI, ZI], "base_cut": ZCUT}, "tissue_cells": int(mask.sum()),
                                        "seed": "a developed 2D spiral (u and v) mapped onto the wall by arc length around the axis and height, core at mid-wall"}, t0, log, extra)


def finish(cid, ws, frames, params, t0, log, extra=None):
    out = ROOT / "cases" / cid
    study = Study(ROOT, "tissue", "tools/heart.py")
    mask_d = extra["mask_display"] if extra else None
    shape_note = "x-major display grid, h = 1"
    entries, clipped = publish_frames(study, out, frames, shape_note, mask_d)
    ws = [w if not w["id"].startswith("bounded voltage: values outside [0, 1]") else witness(w["id"], clipped, 0) for w in ws]
    ws.append(witness("clipping: published values outside the 8-bit range", clipped, 0))
    if extra:
        G = extra["geometry"]
        geo = study.publish_deflate(G["gq"].tobytes(order="C"), out / "wall.bin", time=0.0, clipped_values=0, quantization_max=0.5 / 65535,
                                    encoding="uint16le wall field g / max|g| mapped to 0..65535 (0.5 = the wall surface), C order, display grid", shape=list(G["gq"].shape),
                                    scale=G["gmax"], mesh={"iso": 0.0, "vertices": int(G["verts"]), "triangles": int(G["faces"]), "volume": G["volume"]})
        entries = [geo] + entries
        params["display_tissue_cells"] = int(extra["mask_display"].sum())
    meta = {"title": CASES[cid]["title"], "line": CASES[cid]["line"],
            "equation": "u_t = D lap(u) - k u (u - a)(u - 1) - u v;  v_t = (eps0 + mu1 v / (u + mu2)) (-v - k u (u - a - 1))",
            "domain": {"shape": list(frames[0][1].shape), "units": "dimensionless (about 1 mm and 12.9 ms per unit)", "boundary": "no flux"},
            "parameters": {"k": ap.K, "a": ap.A, "eps0": ap.EPS0, "mu1": ap.MU1, "mu2": ap.MU2, "D": ap.D, "h": H, "dt": DT, "display_h": 2 * H,
                           "frames": FRAMES, "ms_per_unit": ap.MS_PER_UNIT, **params},
            "method": "Aliev-Panfilov, forward Euler, 5-point (2D) or masked 7-point (3D) Laplacian with no-flux walls; states published every 1/36 of a period on every other cell.",
            "limits": ["A two-variable phenomenological model: no ion channels, calcium or drugs; times and lengths in physical units are nominal (12.9 ms and about 1 mm per unit).",
                       "Isotropic, homogeneous tissue: real ventricles have rotating fibre directions, which make conduction anisotropic and shape scroll waves.",
                       "The ventricle is two truncated ellipsoids, not an anatomical heart; it is not coupled to mechanics or blood flow.",
                       "Frames are shown on every other cell (1 unit) of the computed grid (0.5 units)."],
            "dependencies": {d: sha((ROOT / d).read_bytes()) for d in DEPENDENCIES},
            "external_dependencies": {f"lib/stemkit/{m}": sha((ROOT.parents[1] / "lib" / "stemkit" / m).read_bytes()) for m in STEM_LIB}}
    metrics = [{"id": "timing", "seconds": round(time.time() - t0, 1)}]
    study.save_case(cid, meta, entries, metrics, ws)
    bad = [w["id"] for w in ws if not w["pass"]]
    log(f"{cid}: {len(ws)} witnesses, {len(bad)} red ({time.time() - t0:.0f}s)" + (": " + "; ".join(bad) if bad else ""))
    for w in ws:
        log(f"   {'ok ' if w['pass'] else 'RED'} {w['id']}: {w['observed']:.6g} {w['rule']} {w['limit']:.6g}")
    return out / "case.json"


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("cases", nargs="*", default=list(CASES))
    a = ap_.parse_args()
    for c in a.cases:
        need(c in CASES, "UNKNOWN_CASE", c)
    say = lambda s: print(s, flush=True)
    common, numbers = common_witnesses()
    say(f"common: {numbers}")
    spiral_T = None
    for c in a.cases:
        if c == "paced":
            build_paced(say, common)
        elif c == "spiral":
            build_spiral(say, common)
        else:
            spiral_T = spiral_T or spiral_period(1)[0]
            build_heart(say, common, spiral_T)
    write_json(ROOT / "cases" / "index.json", {"cases": [{"id": k, "title": v["title"], "line": v["line"]} for k, v in CASES.items()]})
    red = sum(not w["pass"] for c in a.cases for w in json.loads((ROOT / "cases" / c / "case.json").read_text())["witnesses"])
    sys.exit(1 if red else 0)


if __name__ == "__main__":
    main()
