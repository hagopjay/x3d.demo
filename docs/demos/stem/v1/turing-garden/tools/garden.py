"""Turing Garden builder: 3D Gray-Scott gardens grown from seeds, with the witnesses that check them.

  python3 -E -s tools/garden.py            # all cases
  python3 -E -s tools/garden.py spots      # one case

Per case: 16,000 forward-Euler steps (dt 0.5, t = 0..8000) on a periodic 64^3 grid from three random
seeds; 41 frames of v (every 200 time units) published as 8-bit deflated fields; the browser meshes them
itself (src/nets.js) and checks its mesh against the reference counts recorded here.

Witnesses (limits declared in this file before the first build):
  linear mode decay (exact discrete)   u and v Fourier modes about (1, 0) vs (1 + dt lambda)^n
  budget identity                      sum(u + v) changes by exactly dt * sum(F (1 - u) - (F + k) v)
  convergence order                    observed order in dt of a smooth short run is 1 (forward Euler)
  reproducibility                      the first 2,000 steps rerun bit for bit
  bounded fields                       0 <= u <= 1 and v >= 0 at every step (discrete maximum principle)
  closed meshes                        no boundary edges in any frame's reference mesh
  mesh volume                          divergence-theorem volume vs Monte Carlo on the field (gross errors)
  display quantization                 the published fields move the isosurface by at most 0.05 cells (p99
                                       of the worst frame); 8-bit unless that fails, then 16-bit for the case
  vertices on the surface              the mesher leaves vertices at most 0.01 cells off it (p99, worst frame)
  clipping                             no value above the 8-bit range
  morphology                           the case's name is a measured claim (components, Euler
                                       characteristic, mean curvature, late activity)
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT.parents[1] / "lib"))

import numpy as np                       # noqa: E402
from scipy import ndimage               # noqa: E402

import gs                                # noqa: E402
from stemkit import mesh                 # noqa: E402
from stemkit.core import Study, need, sha, witness, write_json   # noqa: E402

N, DT, STEPS, EVERY, ISO, VMAX, SEED = 64, gs.DT, 16000, 400, 0.2, 0.6, 7
DEPENDENCIES = ["tools/gs.py"]
STEM_LIB = ["core.py", "mesh.py"]

CASES = {
    "spots": dict(F=0.0367, k=0.0649, title="Dividing spots",
                  line="Three seeds split again and again until about forty blobs share the space."),
    "holes": dict(F=0.039, k=0.058, title="Swiss cheese",
                  line="The same chemistry with a little more feed: now the empty phase forms the droplets."),
    "coral": dict(F=0.0545, k=0.062, title="Coral network",
                  line="Tubes branch and fuse into a single network that fills half the box."),
    "sheets": dict(F=0.029, k=0.057, title="Perforated sheets",
                   line="What draws a maze in 2D stacks into layers in 3D, pierced by holes."),
    "chaos": dict(F=0.018, k=0.051, title="Restless garden",
                  line="Spatiotemporal chaos: patches grow, split and vanish, and never settle."),
}

# Morphology claims, declared before the first build. Late activity is the mean |dv| over the last 200
# time units; stationary patterns measured 0.001-0.003 and the chaotic one 0.16 in exploration (4 Nov).
CLAIMS = {
    "spots": [("components of v > iso", "at least", 20), ("largest component share", "at most", 0.3),
              ("late activity", "at most", 0.01)],
    "holes": [("largest component share", "at least", 0.9), ("holes (components of v < iso)", "at least", 20),
              ("late activity", "at most", 0.01)],
    "coral": [("largest component share", "at least", 0.9), ("Euler characteristic", "at most", -1),
              ("late activity", "at most", 0.01)],
    "sheets": [("largest component share", "at least", 0.9), ("|median mean curvature|", "at most", 0.03),
               ("late activity", "at most", 0.01)],
    "chaos": [("late activity", "at least", 0.05)],
}


SHIFT_LIMIT = 0.05
ENCODINGS = {8: (np.uint8, "uint8"), 16: (np.dtype("<u2"), "uint16le")}


def quantize(v, bits=8):
    top = 2**bits - 1
    q = np.rint(np.clip(v / VMAX, 0.0, 1.0) * top).astype(ENCODINGS[bits][0])
    return q, int(np.count_nonzero(v > VMAX)), float(np.abs(q.astype(np.float64) / top * VMAX - v).max())


def display_field(q, bits=8):
    """Exactly what the browser builds: pad with 0, then (q / (2^bits - 1)) * VMAX in float64."""
    return mesh.pad_field(q.astype(np.float64) / (2**bits - 1) * VMAX, 0.0)


def surface_errors_p99(v, fd, verts):
    """Two first-order distances at the published mesh's vertices, in cells, kept apart on purpose (the
    first build mixed them): quantization moves the isosurface by |f_display - f| / |grad f|; the mesher
    leaves each vertex |f_display - iso| / |grad f_display| from the surface it was asked for."""
    ff = mesh.pad_field(v, 0.0)
    quant = np.abs(mesh.trilinear(fd, verts) - mesh.trilinear(ff, verts)) / np.maximum(np.linalg.norm(mesh.trilinear_grad(ff, verts), axis=1), 1e-12)
    onsurf = np.abs(mesh.trilinear(fd, verts) - ISO) / np.maximum(np.linalg.norm(mesh.trilinear_grad(fd, verts), axis=1), 1e-12)
    return float(np.percentile(quant, 99)), float(np.percentile(onsurf, 99))


def mesh_frames(g, bits):
    rows, worst, onsurf = [], 0.0, 0.0
    for s, v in g["frames"]:
        q, clipped, qerr = quantize(v, bits)
        fd = display_field(q, bits)
        verts, faces = mesh.surface_nets(fd, ISO)
        if len(verts):
            a, b = surface_errors_p99(v, fd, verts)
            worst, onsurf = max(worst, a), max(onsurf, b)
        rows.append((s, v, q, clipped, qerr, verts, faces))
    return rows, worst, onsurf


def euler_characteristic(verts, faces):
    e = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    e.sort(axis=1)
    return int(len(verts) - len(np.unique(e, axis=0)) + len(faces))


# ---------- exact and reference witnesses (independent of the long runs) ----------

def linear_modes(F, k, n=32, steps=40, eps=1e-6):
    """Small Fourier modes about (u, v) = (1, 0) obey the linearized scheme exactly: amplitude after n
    steps is eps (1 + dt lambda)^n with lambda = -D sum_d (2 - 2 cos(2 pi m_d / n)) - rate. The u mode runs
    along x, the v mode along y and z, so every stencil direction and both diffusivities are exercised."""
    x = np.arange(n)
    X, Y, Z = np.meshgrid(x, x, x, indexing="ij")
    pu, pv = 2 * np.pi * 3 * X / n, 2 * np.pi * (5 * Y + 2 * Z) / n
    u, v = gs.run(1 + eps * np.cos(pu), eps * np.cos(pv), F, k, steps)
    amp_u = 2 * np.mean((u - 1) * np.cos(pu))
    amp_v = 2 * np.mean(v * np.cos(pv))
    lam_u = -gs.DU * (2 - 2 * np.cos(2 * np.pi * 3 / n)) - F
    lam_v = -gs.DV * ((2 - 2 * np.cos(2 * np.pi * 5 / n)) + (2 - 2 * np.cos(2 * np.pi * 2 / n))) - (F + k)
    ref_u, ref_v = eps * (1 + DT * lam_u) ** steps, eps * (1 + DT * lam_v) ** steps
    return abs(amp_u / ref_u - 1), abs(amp_v / ref_v - 1)


def convergence_order(F, k, n=32, T=20.0):
    """Observed order p = log2(|X(dt) - X(dt/2)| / |X(dt/2) - X(dt/4)|) of a smooth short run."""
    x = np.arange(n) - n / 2
    X, Y, Z = np.meshgrid(x, x, x, indexing="ij")
    v0 = 0.25 * np.exp(-(X**2 + Y**2 + Z**2) / 16)
    u0 = 1 - 0.5 * v0
    sol = [gs.run(u0, v0, F, k, int(round(T / dt)), dt=dt)[1] for dt in (0.2, 0.1, 0.05)]
    e1, e2 = np.abs(sol[0] - sol[1]).max(), np.abs(sol[1] - sol[2]).max()
    return math.log2(e1 / e2)


# ---------- the long run ----------

def grow(F, k, rng_seed=SEED, steps=STEPS, every=EVERY, keep_frames=True):
    rng = np.random.default_rng(rng_seed)
    u, v, centres = gs.seed(N, rng)
    un, vn = np.empty_like(u), np.empty_like(v)
    frames, budget, lo_u, hi_u, lo_v = [], 0.0, float(u.min()), float(u.max()), float(v.min())
    if keep_frames:
        frames.append((0, v.copy()))
    su, sv = u.sum(), v.sum()
    for s in range(1, steps + 1):
        gs._step(u, v, un, vn, gs.DU, gs.DV, F, k, DT)
        u, un, v, vn = un, u, vn, v
        nu, nv = u.sum(), v.sum()
        predicted = DT * (F * u.size - F * su - (F + k) * sv)
        scale = DT * (F * u.size + F * abs(su) + (F + k) * abs(sv))
        budget = max(budget, abs((nu + nv) - (su + sv) - predicted) / scale)
        su, sv = nu, nv
        lo_u, hi_u, lo_v = min(lo_u, u.min()), max(hi_u, u.max()), min(lo_v, v.min())
        if keep_frames and s % every == 0:
            frames.append((s, v.copy()))
    return dict(u=u, v=v, frames=frames, budget=budget, lo_u=lo_u, hi_u=hi_u, lo_v=lo_v, centres=centres)


def morphology(v_final, v_before, verts, faces, f_disp):
    m = v_final > ISO
    lab, nc = ndimage.label(m)
    share = float(np.bincount(lab.ravel())[1:].max() / m.sum()) if nc else 0.0
    _, holes = ndimage.label(~m)
    H = mesh.mean_curvature(f_disp, verts)
    return {"components of v > iso": nc, "largest component share": share, "holes (components of v < iso)": holes,
            "Euler characteristic": euler_characteristic(verts, faces), "|median mean curvature|": float(abs(np.median(H))),
            "late activity": float(np.abs(v_final - v_before).mean()), "fraction above iso": float(m.mean())}


def build(name: str, study: Study, log) -> Path:
    c = CASES[name]
    F, k = c["F"], c["k"]
    t0 = time.time()
    lin_u, lin_v = linear_modes(F, k)
    p = convergence_order(F, k)
    g = grow(F, k)
    rerun = grow(F, k, steps=2000, keep_frames=False)
    first = grow(F, k, steps=2000, keep_frames=False)
    differing = int(np.count_nonzero(rerun["v"] != first["v"]) + np.count_nonzero(rerun["u"] != first["u"]))
    log(f"{name}: run {time.time() - t0:.1f}s")

    out = ROOT / "cases" / name
    frames, clipped_total, qmax, closed_bad, mesh_rows = [], 0, 0.0, 0, []
    rng = np.random.default_rng(11)
    bits = 8
    rows, shift, onsurf = mesh_frames(g, bits)
    if shift > SHIFT_LIMIT:
        log(f"{name}: 8-bit surface shift {shift:.4f} > {SHIFT_LIMIT}; publishing 16-bit fields")
        bits = 16
        rows, shift, onsurf = mesh_frames(g, bits)
    for f_old in out.glob("v*.bin"):
        f_old.unlink()
    for i, (s, v, q, clipped, qerr, verts, faces) in enumerate(rows):
        clipped_total += clipped
        qmax = max(qmax, qerr)
        use = mesh.edge_use(faces) if len(faces) else np.zeros(0, int)
        closed_bad += int(np.count_nonzero(use % 2 == 1))
        tri = verts[faces] if len(faces) else np.zeros((0, 3, 3))
        vol = float(np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6) if len(faces) else 0.0
        entry = study.publish_deflate(q.tobytes(order="C"), out / f"v{i:03d}.bin", time=s * DT, step=s,
                                      clipped_values=clipped, quantization_max=qerr / VMAX,
                                      encoding=f"{ENCODINGS[bits][1]} v / 0.6, C order [x][y][z], 64^3, deflate", bits=bits,
                                      mesh={"iso": ISO, "vertices": int(len(verts)), "triangles": int(len(faces)), "volume": vol})
        frames.append(entry)
        mesh_rows.append((s, len(verts), len(faces)))

    # final-frame mesh: volume and display-quantization witnesses, morphology
    s_last, v_last = g["frames"][-1]
    v_before = g["frames"][-2][1]
    q, verts, faces = rows[-1][2], rows[-1][5], rows[-1][6]
    fd = display_field(q, bits)
    chk = mesh.checks(fd, ISO, verts, faces, rng, samples=1_000_000)
    morph = morphology(v_last, v_before, verts, faces, fd)

    ws = [
        witness("linear mode decay, u (exact discrete), relative error", lin_u, 1e-8),
        witness("linear mode decay, v (exact discrete), relative error", lin_v, 1e-8),
        witness("budget identity: sum(u + v) per step, worst relative residual", g["budget"], 1e-11),
        witness("convergence order in dt: |observed - 1|", abs(p - 1), 0.05, note=f"observed order {p:.4f}"),
        witness("reproducibility: cells differing on a 2,000-step rerun", differing, 0),
        witness("bounded fields: worst excursion below 0 or above 1", max(0.0, -g["lo_u"], g["hi_u"] - 1, -g["lo_v"]), 0.0),
        witness("closed meshes: boundary edges over all frames", closed_bad, 0),
        witness("mesh volume vs Monte Carlo on the field, relative difference (gross-error check)", chk["volume_rel_diff"], 0.05),
        witness(f"display quantization ({bits}-bit): isosurface shift p99, worst frame (cells)", shift, SHIFT_LIMIT),
        witness("mesh vertices on the displayed surface: distance p99, worst frame (cells)", onsurf, 0.01),
        witness("clipping: values above the 8-bit range", clipped_total, 0),
    ]
    for key, rule, limit in CLAIMS[name]:
        ws.append(witness(f"morphology '{name}': {key}", morph[key], limit, rule))

    meta = {
        "title": c["title"], "line": c["line"],
        "equation": "u_t = Du lap(u) - u v^2 + F (1 - u);  v_t = Dv lap(v) + u v^2 - (F + k) v",
        "domain": {"shape": [N, N, N], "units": "grid cells (dx = 1) and model time units", "boundary": "periodic"},
        "parameters": {"display_bits": bits, "F": F, "k": k, "Du": gs.DU, "Dv": gs.DV, "dt": DT, "steps": STEPS, "frame_every_steps": EVERY,
                       "seed": SEED, "seeds": 3, "seed_centres": g["centres"].tolist(), "iso": ISO, "display_vmax": VMAX},
        "method": "7-point Laplacian, forward Euler, float64; three cubic seeds (u 0.5, v 0.25, 12 cells) at random "
                  "positions plus domain-wide noise; isosurfaces by surface nets with two Newton projections.",
        "limits": [
            "A nondimensional model on a 64-cell periodic box: no units of real chemistry, and patterns are a few wavelengths across.",
            "Forward Euler is first order in time; fine structure of the chaotic case depends on dt and on rounding (only its statistics are claims).",
            "The displayed surface is the iso level v = 0.2 of an 8-bit copy of the field; the walls of the box are cut faces, not physics.",
            "Morphology names are measured claims about these runs, not a classification of the parameter plane.",
        ],
        "dependencies": {d: sha((ROOT / d).read_bytes()) for d in DEPENDENCIES},
        "external_dependencies": {f"lib/stemkit/{m}": sha((ROOT.parents[1] / "lib" / "stemkit" / m).read_bytes()) for m in STEM_LIB},
    }
    metrics = [{"id": "morphology", **morph}, {"id": "final mesh", **chk},
               {"id": "mesh sizes", "frames": [{"step": s, "vertices": int(a), "triangles": int(b)} for s, a, b in mesh_rows]},
               {"id": "timing", "seconds": round(time.time() - t0, 1)}]
    path = study.save_case(name, meta, frames, metrics, ws)
    bad = [w["id"] for w in ws if not w["pass"]]
    log(f"{name}: {len(ws)} witnesses, {len(bad)} red" + (": " + "; ".join(bad) if bad else "") + f"  ({time.time() - t0:.1f}s)")
    for w in ws:
        log(f"   {'ok ' if w['pass'] else 'RED'} {w['id']}: {w['observed']:.6g} {w['rule']} {w['limit']:.6g}")
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cases", nargs="*", default=list(CASES))
    a = ap.parse_args()
    for n in a.cases:
        need(n in CASES, "UNKNOWN_CASE", n)
    study = Study(ROOT, "turing-garden", "tools/garden.py")
    red = 0
    for n in a.cases:
        build(n, study, lambda m: print(m, flush=True))
        case = __import__("json").loads((ROOT / "cases" / n / "case.json").read_text())
        red += sum(not w["pass"] for w in case["witnesses"])
    write_json(ROOT / "cases" / "index.json", {"cases": [{"id": n, "title": CASES[n]["title"], "line": CASES[n]["line"]} for n in CASES]})
    sys.exit(1 if red else 0)


if __name__ == "__main__":
    main()
