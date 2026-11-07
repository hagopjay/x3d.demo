"""Electron Cloud Observatory builder: hydrogen states solved numerically, published as verified 3D fields.

  python3 -E -s tools/cloud.py            # every case
  python3 -E -s tools/cloud.py 1s lyman   # some

Orbital cases: one real orbital psi_nlm = (u_nl(r) / r) Y_lm(theta, phi), with u_nl from tools/radial.py,
on an 80^3 cell-centred grid sized to hold all but 1e-4 of the probability; published as int16 psi (sign
kept for colour). The surface shown encloses 90 % of the probability.
Superposition case 'lyman': (1s + 2p_z) / sqrt(2) evolving exactly in time; 24 frames of one period of
the density, published as uint16 amplitude sqrt(rho). Its charge centre swings along z at
omega = E(2) - E(1), the frequency of Lyman-alpha light.

Limits declared here before the first build (exploration of the solver, 4 Nov: raw energy error <= 2.5e-5,
order 2.000, Richardson <= 2.3e-10, radial function <= 1.5e-5, <r> <= 1.7e-5, virial <= 5e-5, 3D norm <= 7e-5).
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

import numpy as np                         # noqa: E402
import scipy.special as sp                 # noqa: E402
from scipy.optimize import brentq          # noqa: E402

import radial                              # noqa: E402
from stemkit import mesh                   # noqa: E402
from stemkit.core import Study, need, sha, witness, write_json   # noqa: E402

N, TAIL, LEVEL, FRAMES = 80, 1e-4, 0.90, 24
DEPENDENCIES = ["tools/radial.py"]
STEM_LIB = ["core.py", "mesh.py"]
# CODATA 2018, used only to turn the computed transition into a wavelength for the caption and a witness.
ALPHA_INV, BOHR_NM, RYD_INF = 137.035999084, 0.0529177210903, 10973731.568160   # -, nm, 1/m

ORBITALS = {   # id: (n, l, m, label, one line)
    "1s": (1, 0, 0, "1s", "The ground state: a fuzzy ball, densest at the nucleus."),
    "2s": (2, 0, 0, "2s", "A ball inside a shell, with a nodal sphere between them: cut it open."),
    "2pz": (2, 1, 0, "2p_z", "Two lobes of opposite sign, with a nodal plane through the nucleus."),
    "3s": (3, 0, 0, "3s", "Three nested shells separated by two nodal spheres; only a cut shows the inner ones."),
    "3dz2": (3, 2, 0, "3d_z²", "Two lobes and a ring: the shape behind many transition-metal bonds."),
    "3dxy": (3, 2, -2, "3d_xy", "Four lobes between the axes, alternating in sign."),
    "4fz3": (4, 3, 0, "4f_z³", "Lobes along the axis and two cones of opposite sign."),
    "4fxyz": (4, 3, -2, "4f_xyz", "Eight lobes, one in each octant, alternating like a three-dimensional chessboard."),
    "4fy3x2": (4, 3, -3, "4f_y(3x²−y²)", "Six lobes around the axis in the plane: three-fold symmetry."),
    "5gz4": (5, 4, 0, "5g_z⁴", "A g orbital: beyond any ground-state element, but the equation does not mind."),
}
LYMAN = "lyman"


def yreal(l, m, th, ph):
    """Real spherical harmonics (Condon-Shortley phase): m > 0 cosine type, m < 0 sine type."""
    Y = sp.sph_harm_y(l, abs(m), th, ph)
    if m > 0:
        return math.sqrt(2) * (-1) ** m * Y.real
    if m < 0:
        return math.sqrt(2) * (-1) ** m * Y.imag
    return Y.real


def radial_states(n, l):
    E1, U1, r = radial.solve(l, n - l)
    E2, _, _ = radial.solve(l, n - l, h=2 * radial.H)
    k = n - l - 1
    return dict(E=E1[k], E2h=E2[k], Erich=(4 * E1[k] - E2[k]) / 3, u=U1[k], r=r)


def box_half_width(u, r):
    cum = np.cumsum(u**2) * radial.H
    return float(r[np.searchsorted(cum, 1 - TAIL)])


def grid(L, n=None):
    n = n or N
    x = -L + (np.arange(n) + 0.5) * 2 * L / n
    X, Y, Z = np.meshgrid(x, x, x, indexing="ij")
    R = np.sqrt(X**2 + Y**2 + Z**2)
    return X, Y, Z, R, np.arccos(np.clip(Z / R, -1, 1)), np.arctan2(Y, X), (2 * L / n) ** 3


CHECK_N = 160   # normalization is witnessed on a grid twice as fine as the display grid: the first build's
                # 80^3 sums under-resolved the s-state cusp at the nucleus (3s: 8.2e-4), which is resolution,
                # not assembly (order 3.4 to 4 under refinement); the display-grid sum is reported as a metric


def psi_on_grid(st, l, m, G):
    X, Y, Z, R, th, ph, dv = G
    return np.interp(R, st["r"], st["u"], left=0.0, right=0.0) / R * yreal(l, m, th, ph)


def level_for(rho, dv, share=LEVEL):
    """Amplitude level whose superlevel set holds `share` of the probability on the grid."""
    flat = np.sort(rho.ravel())[::-1]
    k = np.searchsorted(np.cumsum(flat) * dv / (flat.sum() * dv), share)
    return float(math.sqrt(flat[k]))


def mesh_witnesses(amp_float, q, top, vmax, level, rng, frames_label):
    """Reference meshes and display witnesses over all frames (amp = |psi| or sqrt(rho), float)."""
    rows, closed_bad, shift, onsurf = [], 0, 0.0, 0.0
    for a, qq in zip(amp_float, q):
        fd = mesh.pad_field(np.abs(qq.astype(np.float64)) / top * vmax, 0.0)
        verts, faces = mesh.surface_nets(fd, level)
        use = mesh.edge_use(faces)
        closed_bad += int(np.count_nonzero(use % 2 == 1))
        ff = mesh.pad_field(a, 0.0)
        quant = np.abs(mesh.trilinear(fd, verts) - mesh.trilinear(ff, verts)) / np.maximum(np.linalg.norm(mesh.trilinear_grad(ff, verts), axis=1), 1e-12)
        on = np.abs(mesh.trilinear(fd, verts) - level) / np.maximum(np.linalg.norm(mesh.trilinear_grad(fd, verts), axis=1), 1e-12)
        shift, onsurf = max(shift, float(np.percentile(quant, 99))), max(onsurf, float(np.percentile(on, 99)))
        tri = verts[faces]
        vol = float(np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6)
        rows.append(dict(verts=verts, faces=faces, volume=vol, fd=fd))
    chk = mesh.checks(rows[-1]["fd"], level, rows[-1]["verts"], rows[-1]["faces"], rng, samples=1_000_000)
    ws = [witness(f"closed meshes: boundary edges over {frames_label}", closed_bad, 0),
          witness("mesh volume vs Monte Carlo on the field, relative difference (gross-error check)", chk["volume_rel_diff"], 0.05),
          witness(f"display quantization (16-bit): isosurface shift p99, worst frame (cells)", shift, 0.05),
          witness("mesh vertices on the displayed surface: distance p99, worst frame (cells)", onsurf, 0.01)]
    return rows, ws, chk


def radial_witnesses(n, l):
    st = radial_states(n, l)
    ex = radial.exact_energy(n)
    order = math.log2(abs(st["E2h"] - ex) / abs(st["E"] - ex))
    ue = radial.exact_u(n, l, st["r"])
    h = radial.H
    mean_r = float((st["u"] ** 2 * st["r"]).sum() * h)
    v = float(-(st["u"] ** 2 / st["r"]).sum() * h)
    spread = [radial_states(n, ll)["Erich"] for ll in range(n)]
    ws = [witness(f"energy E({n}) vs -1/(2n²), relative error (h = {h})", abs(st["E"] / ex - 1), 5e-5),
          witness("observed order of the energy in h: |p - 2|", abs(order - 2), 0.05, note=f"observed {order:.4f}"),
          witness("Richardson-extrapolated energy vs -1/(2n²), relative error", abs(st["Erich"] / ex - 1), 1e-8),
          witness(f"l-degeneracy: spread of E({n}, l) over l = 0..{n - 1}, relative", (max(spread) - min(spread)) / abs(ex), 1e-8),
          witness("radial function vs the Laguerre form, max error / max", float(np.abs(st["u"] - ue).max() / np.abs(ue).max()), 5e-5),
          witness("<r> vs (3n² - l(l+1))/2, relative error", abs(mean_r / radial.exact_mean_r(n, l) - 1), 5e-5),
          witness("virial theorem <V> = 2E, relative error", abs(v / (2 * ex) - 1), 1e-4),
          witness(f"radial nodes: |counted - (n - l - 1)|", abs(radial.nodes(st["u"]) - (n - l - 1)), 0)]
    return st, ws, dict(E=st["E"], E_richardson=st["Erich"], observed_order=order, mean_r=mean_r, potential=v)


def common_meta(title, line, equation, params):
    return {"title": title, "line": line, "equation": equation,
            "domain": {"shape": [N, N, N], "units": "bohr (atomic units); energies in hartree", "boundary": "u(0) = u(200 bohr) = 0; display box holds all but 1e-4 of the probability"},
            "parameters": params,
            "method": "Radial equation by three-point finite differences on a uniform 0.01-bohr grid to 200 bohr, lowest eigenpairs of the tridiagonal matrix (LAPACK), Richardson with h = 0.02; 3D field = u(r)/r times a real spherical harmonic, linear interpolation in r, cell-centred 80^3 grid; surfaces by surface nets with three Newton projections.",
            "limits": ["Non-relativistic hydrogen with an infinitely heavy nucleus: no fine structure, spin, Lamb shift or reduced-mass correction (the real Lyman-alpha line is at 121.567 nm, not 121.502 nm).",
                       "The surface is where |psi| (or the square root of the density) crosses a level enclosing 90 % of the probability on the grid; the cloud has no edge.",
                       "Each case has its own box size, so orbitals are not drawn to a common scale; the page states the box width in bohr."],
            "dependencies": {d: sha((ROOT / d).read_bytes()) for d in DEPENDENCIES},
            "external_dependencies": {f"lib/stemkit/{m}": sha((ROOT.parents[1] / "lib" / "stemkit" / m).read_bytes()) for m in STEM_LIB}}


def build_orbital(cid, log):
    t0 = time.time()
    n, l, m, label, line = ORBITALS[cid]
    st, ws, rad = radial_witnesses(n, l)
    L = box_half_width(st["u"], st["r"])
    G = grid(L)
    psi = psi_on_grid(st, l, m, G)
    dv = G[-1]
    display_norm = float((psi**2).sum() * dv)
    Gc = grid(L, CHECK_N)
    norm = float((psi_on_grid(st, l, m, Gc) ** 2).sum() * Gc[-1])
    del Gc
    vmax = float(np.abs(psi).max())
    q = np.rint(psi / vmax * 32767).astype("<i2")
    level = level_for(psi**2, dv)
    rows, mws, chk = mesh_witnesses([np.abs(psi)], [q], 32767, vmax, level, np.random.default_rng(3), "the frame")
    ws += [witness(f"3D normalization on a {CHECK_N}³ check grid: |sum psi² dV - 1|", abs(norm - 1), 5e-4)] + mws + [witness("clipping: values outside the 16-bit range", 0, 0)]
    if cid == "1s":
        # exact control for the 90 % surface pipeline: P(r < R) = 1 - e^(-2R)(1 + 2R + 2R²) = 0.9
        R90 = brentq(lambda R: 1 - math.exp(-2 * R) * (1 + 2 * R + 2 * R * R) - LEVEL, 0.5, 10)
        cell = 2 * L / N
        rv = np.linalg.norm((rows[0]["verts"] - 1 - (N - 1) / 2) * cell, axis=1)
        ws.append(witness(f"90 % surface radius vs analytic {R90:.4f} bohr, relative error", abs(rv.mean() / R90 - 1), 1e-2))
    out = ROOT / "cases" / cid
    study = Study(ROOT, "orbital", "tools/cloud.py")
    for f in out.glob("*.bin"):
        f.unlink()
    frame = study.publish_deflate(q.tobytes(order="C"), out / "psi.bin", time=0.0, clipped_values=0, quantization_max=0.5 / 32767,
                                  encoding="int16le psi / max|psi|, C order [x][y][z], 80^3, deflate", bits=16, signed=True, scale=vmax,
                                  mesh={"iso": level, "vertices": int(len(rows[0]["verts"])), "triangles": int(len(rows[0]["faces"])), "volume": rows[0]["volume"]})
    meta = common_meta(f"{label} orbital", line, "-1/2 laplacian(psi) - psi / r = E psi; psi_nlm = u_nl(r) / r * Y_lm", {
        "n": n, "l": l, "m": m, "label": label, "box_half_width_bohr": L, "cell_bohr": 2 * L / N, "level_share": LEVEL, "level": level,
        "E_hartree": rad["E_richardson"], "E_eV": rad["E_richardson"] * 27.211386245988, "radial_h": radial.H})
    metrics = [{"id": "radial", **rad}, {"id": "display grid", "normalization": display_norm, "cells": N}, {"id": "final mesh", **chk}, {"id": "timing", "seconds": round(time.time() - t0, 1)}]
    path = study.save_case(cid, meta, [frame], metrics, ws)
    report(cid, ws, t0, log)
    return path


def build_lyman(log):
    t0 = time.time()
    s1, w1, r1 = radial_witnesses(1, 0)
    s2, w2, r2 = radial_witnesses(2, 1)
    dE = s2["Erich"] - s1["Erich"]
    d_num = float((s1["u"] * s2["u"] * s1["r"]).sum() * radial.H / math.sqrt(3))   # <1s|z|2p_z>
    d_exact = 128 * math.sqrt(2) / 243
    lam_nm = 2 * math.pi * ALPHA_INV / dE * BOHR_NM
    lam_exact = 4 / (3 * RYD_INF) * 1e9
    L = box_half_width(s2["u"], s2["r"])
    G = grid(L)
    X, Y, Z, R, th, ph, dv = G
    p1, p2 = psi_on_grid(s1, 0, 0, G), psi_on_grid(s2, 1, 0, G)
    T = 2 * math.pi / dE
    times = [k * T / FRAMES for k in range(FRAMES)]
    rhos = [0.5 * (p1**2 + p2**2 + 2 * p1 * p2 * math.cos(dE * t)) for t in times]
    zs = np.array([float((Z * rho).sum() * dv) for rho in rhos])
    c = np.cos(dE * np.array(times))
    d_fit = float((zs * c).sum() / (c * c).sum())
    display_norms = [float(rho.sum() * dv) for rho in rhos]
    Gc = grid(L, CHECK_N)
    c1, c2 = psi_on_grid(s1, 0, 0, Gc), psi_on_grid(s2, 1, 0, Gc)
    a11, a22, a12 = (float((a * b).sum() * Gc[-1]) for a, b in ((c1, c1), (c2, c2), (c1, c2)))
    del Gc, c1, c2
    norms = [abs(0.5 * (a11 + a22 + 2 * a12 * math.cos(dE * t)) - 1) for t in times]
    amps = [np.sqrt(np.maximum(rho, 0)) for rho in rhos]
    amax = float(max(a.max() for a in amps))
    qs = [np.rint(a / amax * 65535).astype("<u2") for a in amps]
    level = level_for(0.5 * (p1**2 + p2**2), dv)
    rows, mws, chk = mesh_witnesses(amps, qs, 65535, amax, level, np.random.default_rng(5), f"all {FRAMES} frames")
    ws = [w for w in w1 if "l-degeneracy" not in w["id"]][:3] + [w2[0], w2[2]]
    ws = [dict(w, id=f"{lbl}: {w['id']}") for w, lbl in zip(ws, ["1s", "1s", "1s", "2p", "2p"])]
    ws += [witness("transition energy E(2) - E(1) vs 3/8 hartree, relative error", abs(dE / 0.375 - 1), 1e-8),
           witness("dipole <1s|z|2p_z> vs 128 sqrt(2) / 243, relative error", abs(d_num / d_exact - 1), 1e-4),
           witness("Lyman-alpha wavelength vs 4 / (3 R_inf) = 121.5023 nm, relative error", abs(lam_nm / lam_exact - 1), 1e-7),
           witness("charge-centre swing on the 3D frames vs the exact dipole, relative error", abs(d_fit / d_exact - 1), 5e-3),
           witness(f"3D normalization on a {CHECK_N}³ check grid, worst frame: |sum rho dV - 1|", max(norms), 5e-4)] + mws + [witness("clipping: values outside the 16-bit range", 0, 0)]
    out = ROOT / "cases" / LYMAN
    study = Study(ROOT, "superposition", "tools/cloud.py")
    for f in out.glob("*.bin"):
        f.unlink()
    frames = []
    for k, (t, qq, row, zc) in enumerate(zip(times, qs, rows, zs)):
        frames.append(study.publish_deflate(qq.tobytes(order="C"), out / f"a{k:03d}.bin", time=t, clipped_values=0, quantization_max=0.5 / 65535,
                                            encoding="uint16le sqrt(rho) / max, C order [x][y][z], 80^3, deflate", bits=16, signed=False, scale=amax,
                                            charge_centre_z_bohr=float(zc),
                                            mesh={"iso": level, "vertices": int(len(row["verts"])), "triangles": int(len(row["faces"])), "volume": row["volume"]}))
    meta = common_meta("Lyman-alpha: an atom that rings", "Half in 1s, half in 2p: the charge sloshes up and down 2.5 million billion times a second, the motion that radiates ultraviolet light at 121.5 nm.",
                       "psi(t) = (psi_1s e^(-i E1 t) + psi_2pz e^(-i E2 t)) / sqrt(2);  rho = (psi_1s² + psi_2pz² + 2 psi_1s psi_2pz cos((E2 - E1) t)) / 2", {
                           "states": ["1s", "2p_z"], "weights": [0.5, 0.5], "box_half_width_bohr": L, "cell_bohr": 2 * L / N, "level": level,
                           "omega_hartree": dE, "period_au": T, "period_fs": T * 2.4188843265857e-2, "frequency_hz": dE / (2 * math.pi) / 2.4188843265857e-17,
                           "wavelength_nm": lam_nm, "dipole_exact": d_exact, "dipole_numerical": d_num, "frames_per_period": FRAMES})
    metrics = [{"id": "charge centre", "z_bohr": zs.tolist(), "fitted_swing": d_fit},
               {"id": "display grid", "normalization_per_frame": display_norms, "cells": N}, {"id": "final mesh", **chk}, {"id": "timing", "seconds": round(time.time() - t0, 1)}]
    path = study.save_case(LYMAN, meta, frames, metrics, ws)
    report(LYMAN, ws, t0, log)
    return path


def report(cid, ws, t0, log):
    bad = [w["id"] for w in ws if not w["pass"]]
    log(f"{cid}: {len(ws)} witnesses, {len(bad)} red ({time.time() - t0:.1f}s)" + (": " + "; ".join(bad) if bad else ""))
    for w in ws:
        log(f"   {'ok ' if w['pass'] else 'RED'} {w['id']}: {w['observed']:.6g} {w['rule']} {w['limit']:.6g}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cases", nargs="*", default=[*ORBITALS, LYMAN])
    a = ap.parse_args()
    for c in a.cases:
        need(c in ORBITALS or c == LYMAN, "UNKNOWN_CASE", c)
    say = lambda s: print(s, flush=True)
    for c in a.cases:
        build_lyman(say) if c == LYMAN else build_orbital(c, say)
    index = [{"id": LYMAN, "title": "Lyman-α · ringing atom", "kind": "superposition"}] + \
            [{"id": k, "title": v[3], "kind": "orbital", "n": v[0]} for k, v in ORBITALS.items()]
    write_json(ROOT / "cases" / "index.json", {"cases": index})
    red = sum(not w["pass"] for c in a.cases for w in json.loads((ROOT / "cases" / c / "case.json").read_text())["witnesses"])
    sys.exit(1 if red else 0)


if __name__ == "__main__":
    main()
