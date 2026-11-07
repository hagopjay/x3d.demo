"""Chirp builder: three binary black-hole inspirals, their gravitational waves, and their sound.

  python3 -E -s tools/chirp.py            # every case
  python3 -E -s tools/chirp.py equal

Per case: integrate tools/inspiral.py to r = 6 M; publish the relative orbit and the quadrupole's second
derivative at 128 samples per orbit (float32, deflated), the face-on strain as audio at its real pitch
(44.1 kHz, 16-bit WAV), and a sonification three octaves up with the same timing (the strain's phase
times 8). The page draws the holes, their trails and the wave pattern in the orbital plane from the
published samples and plays the audio from verified bytes.

Limits declared here before the first build (exploration, 4 Nov: energy budget <= 3.7e-11, Peters a(t)
<= 9.7e-5, Peters a(e) <= 2.9e-4, quadrupole luminosity vs radiation-reaction work <= 1.5e-4 circular and
3.2e-3 eccentric, residual eccentricity of circular starts <= 3.8e-3).
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT.parents[1] / "lib"))

import numpy as np                     # noqa: E402

import inspiral as I                   # noqa: E402
from stemkit.core import Study, atomic_bytes, need, sha, witness, write_json   # noqa: E402

MSUN_S, MSUN_M, MPC_M = 4.925490947641267e-6, 1476.6250, 3.0856775814913673e22
RATE, SPO, UP = 44100, 192, 8   # 192 samples per orbit: 128 left the eccentric case's interpolation at 3.04e-3 (first build)
DEPENDENCIES = ["tools/inspiral.py"]
STEM_LIB = ["core.py"]
ADIABATIC = 10.0     # Peters and chirp-law witnesses use orbits with a > 10 M, where the adiabatic picture holds

CASES = {
    "equal": dict(m1=30.0, m2=30.0, a0=20.1, e0=0.0, distance_mpc=410.0, title="30 + 30 suns",
                  line="Two black holes like LIGO's first catch spiral in from 12 Hz; the last orbit takes 27 ms."),
    "q4": dict(m1=48.0, m2=12.0, a0=20.1, e0=0.0, distance_mpc=410.0, title="48 + 12 suns",
               line="Unequal masses: the light hole races round the heavy one, and the chirp lasts longer."),
    "eccentric": dict(m1=30.0, m2=30.0, a0=40.0, e0=0.6, distance_mpc=410.0, title="Eccentric orbit",
                      line="An oval orbit sings in bursts at each close pass, and gravitational waves round it off."),
}


def orbit_slices(phi):
    """Index ranges of whole orbits (samples are uniform in orbital phase, SPO per orbit)."""
    k = np.arange(0, len(phi), SPO)
    return [(k[i], k[i + 1]) for i in range(len(k) - 1)]


def write_wav(samples: np.ndarray, path: Path, study: Study, **extra) -> dict:
    need(np.isfinite(samples).all(), "AUDIO_NONFINITE", str(path))
    clipped = int(np.count_nonzero(np.abs(samples) > 1.0))
    pcm = np.rint(np.clip(samples, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())
    atomic_bytes(path, buf.getvalue())
    data = path.read_bytes()
    with wave.open(io.BytesIO(data)) as w:        # open what you publish (law 24)
        back = np.frombuffer(w.readframes(w.getnframes()), "<i2")
        need(w.getframerate() == RATE and np.array_equal(back, pcm), "PUBLICATION_ROUNDTRIP", str(path))
    return {"file": study.rel(path), "sha256": sha(data), "bytes": len(data), "time": 0.0, "clipped_values": clipped,
            "quantization_max": 0.5 / 32767, "rate": RATE, "seconds": len(pcm) / RATE, **extra}, back.astype(np.float64) / 32767


def zero_cross_freq(x: np.ndarray, centres: np.ndarray, half: int) -> np.ndarray:
    """Frequency from zero crossings in a window around each centre sample."""
    out = []
    for c in centres:
        seg = x[max(0, c - half):c + half]
        s = np.signbit(seg)
        idx = np.nonzero(s[1:] != s[:-1])[0]
        out.append((len(idx) - 1) / 2 / ((idx[-1] - idx[0]) / RATE) if len(idx) > 2 else float("nan"))
    return np.array(out)


def build(cid: str, log) -> Path:
    t0 = time.time()
    c = CASES[cid]
    M = c["m1"] + c["m2"]
    eta = c["m1"] * c["m2"] / M**2
    Ms = M * MSUN_S
    sol, t_end, ts = I.integrate(eta, c["a0"], c["e0"], samples_per_orbit=SPO)
    sol2, t_end2, ts2 = I.integrate(eta, c["a0"], c["e0"], rtol=1e-10, samples_per_orbit=SPO)
    d = I.diagnostics(sol, eta, ts)
    orbits = d["phi"][-1] / (2 * math.pi)
    orbits2 = I.diagnostics(sol2, eta, ts2)["phi"][-1] / (2 * math.pi)
    budget = float(np.abs((d["E"] - d["E"][0]) - d["W"]).max() / abs(d["E"][-1] - d["E"][0]))
    sl = orbit_slices(d["phi"])
    A = np.array([d["a"][i:j].mean() for i, j in sl])
    Tm = np.array([ts[i:j].mean() for i, j in sl])
    Em = np.array([d["e"][i:j].mean() for i, j in sl])
    Om = np.array([(d["phi"][j] - d["phi"][i]) / (ts[j] - ts[i]) for i, j in sl])
    sel = A > ADIABATIC
    need(sel.sum() >= 5, "TOO_FEW_ADIABATIC_ORBITS", cid)
    Lq = I.quadrupole_luminosity(d["x"], d["y"], d["vx"], d["vy"], eta)
    Pw = np.gradient(d["W"], ts)
    lum = [abs(np.trapezoid(Lq[i:j + 1], ts[i:j + 1]) / -np.trapezoid(Pw[i:j + 1], ts[i:j + 1]) - 1) for (i, j), s in zip(sl, sel) if s]

    ws = [witness("energy budget: orbital energy lost vs work done by radiation reaction, worst relative residual", budget, 1e-9),
          witness("refinement: orbits to r = 6M at rtol 1e-10 vs 1e-12, relative change", abs(orbits2 / orbits - 1), 1e-6),
          witness("quadrupole luminosity vs radiation-reaction work, orbit averages (a > 10M), worst relative difference",
                  max(lum), 1e-3 if c["e0"] == 0 else 1e-2)]
    if c["e0"] == 0:
        tc = c["a0"] ** 4 / ((256 / 5) * eta)
        f_chirp = (5 / (256 * eta * (tc - Tm[sel]))) ** (3 / 8)          # Newtonian chirp law, orbital angular frequency
        ws += [witness("Peters orbital decay a(t) = (a0^4 - 256/5 eta t)^(1/4), orbit averages (a > 10M), worst relative error",
                       float(np.abs(A[sel] / I.peters_a(eta, c["a0"], Tm[sel]) - 1).max()), 5e-4),
               witness("Newtonian chirp law Omega(tau) = (5 / (256 eta tau))^(3/8), orbit averages (a > 10M), worst relative error",
                       float(np.abs(Om[sel] / f_chirp - 1).max()), 1e-3),
               witness("Kepler's third law Omega^2 a^3 = M, orbit averages (a > 10M), worst relative error",
                       float(np.abs(Om[sel] ** 2 * A[sel] ** 3 - 1).max()), 1e-3),
               witness("circular start stays circular: mean osculating eccentricity (a > 10M)", float(Em[sel].mean()), 1e-2)]
    else:
        g = I.peters_g(Em[sel])
        ratio = A[sel] / g
        ws += [witness("Peters a(e) relation, orbit averages (a > 10M), worst relative error", float(np.abs(ratio / ratio[0] - 1).max()), 2e-3),
               witness("eccentricity only decreases: orbit-to-orbit increases", int(np.count_nonzero(np.diff(Em) > 0)), 0)]

    # strain (face-on, h+ = (Qdd_xx - Qdd_yy) / R) and its harmonic content
    tt = np.arange(0, t_end, 1 / (RATE * Ms))
    xs, ys, vxs, vys, _ = sol.sol(tt)
    qxx, qxy, qyy = I.quadrupole_dd(xs, ys, vxs, vys, eta)
    hp, hx = qxx - qyy, 2 * qxy
    Phi = np.unwrap(np.arctan2(-hx, hp))
    amp = np.hypot(hp, hx)
    fade = np.minimum(1, np.minimum(np.arange(len(tt)) / (0.02 * RATE), (len(tt) - 1 - np.arange(len(tt))) / (0.01 * RATE)))
    real = 0.89 * hp / np.abs(hp).max() * fade
    up = 0.89 * amp / amp.max() * np.cos(UP * Phi) * fade
    phi_t = np.unwrap(np.arctan2(ys, xs))
    crossings = int(np.count_nonzero(np.signbit(hp[1:]) != np.signbit(hp[:-1])))
    if c["e0"] == 0:
        ws.append(witness("gravitational-wave frequency is twice the orbital: strain zero crossings per orbit, |observed - 4|",
                          abs(crossings / (phi_t[-1] / (2 * math.pi)) - 4), 0.01))

    out = ROOT / "cases" / cid
    study = Study(ROOT, "inspiral", "tools/chirp.py")
    for f in list(out.glob("*.bin")) + list(out.glob("*.wav")):
        f.unlink()
    f_real, back_real = write_wav(real, out / "chirp-real.wav", study, role="strain h+ at its real pitch, face-on, normalized")
    f_up, back_up = write_wav(up, out / "chirp-3oct.wav", study, role="sonification: strain amplitude with 8 x its phase (three octaves up, same timing)")
    # Ear witness: pitch of the published audio vs the computed wave frequency, where it is audible-scale
    f_gw = np.abs(np.gradient(Phi, tt)) / (2 * math.pi) / Ms           # Hz, from the strain phase (its sign is a convention)
    # Ear witness, stated exactly: by construction h+ = A cos(Phi) and the upper track = A' cos(8 Phi), so in any
    # window the audio must cross zero (Phi advance) / pi times, to within one crossing at the window edges.
    # (First build: a windowed pitch against the instantaneous frequency at the window centre, which an
    # eccentric orbit sweeps within every orbit; second: crossings divided by the span between the first and
    # last crossing rather than by the window. Both runs are kept in evidence/history.)
    def crossing_error(audio, factor, half):
        worst = 0.0
        for c in centres:
            lo, hi = c - half, c + half
            seg = np.signbit(audio[lo:hi])
            n = int(np.count_nonzero(seg[1:] != seg[:-1]))
            expect = factor * abs(Phi[hi - 1] - Phi[lo]) / math.pi
            worst = max(worst, abs(n - expect))
        return worst
    centres = np.arange(int(0.3 * RATE), len(tt) - int(0.1 * RATE), int(0.1 * RATE))
    ws += [witness("ear: zero crossings of the real-pitch audio vs the strain's phase advance / pi, worst window (crossings)",
                   crossing_error(back_real, 1, int(0.05 * RATE)), 1.5),
           witness("ear: zero crossings of the three-octave audio vs 8 x the phase advance / pi, worst window (crossings)",
                   crossing_error(back_up, UP, int(0.02 * RATE)), 1.5),
           witness("negative control: the three-octave track resampled 2 % fast must fail the ear witness (crossings)",
                   crossing_error(np.interp(np.arange(len(back_up)) * 1.02, np.arange(len(back_up)), back_up, right=0.0), UP, int(0.02 * RATE)),
                   1.5, "at least"),
           witness("clipping: audio samples beyond full scale", f_real["clipped_values"] + f_up["clipped_values"], 0)]

    # orbit samples for the page: t, x, y, Qdd_xx, Qdd_xy, Qdd_yy (float32, 128 per orbit)
    qx, qxy_, qy = I.quadrupole_dd(d["x"], d["y"], d["vx"], d["vy"], eta)
    arr = np.stack([ts, d["x"], d["y"], qx, qxy_, qy], axis=1).astype("<f4")
    f_orbit = study.publish_deflate(arr.tobytes(), out / "orbit.bin", time=0.0, clipped_values=0, quantization_max=0.0,
                                    encoding="float32 little-endian rows (t, x, y, Qdd_xx, Qdd_xy, Qdd_yy), geometric units M = 1", rows=len(arr))
    dec = arr.astype(np.float64)
    # how much linear interpolation of the published samples departs from the dense solution (worst, mid-samples)
    mid = (dec[1:, 0] + dec[:-1, 0]) / 2
    mx, my, mvx, mvy, _ = sol.sol(mid)
    exact = I.quadrupole_dd(mx, my, mvx, mvy, eta)
    lin = [(dec[1:, k] + dec[:-1, k]) / 2 for k in (3, 4, 5)]
    scale = np.max(np.abs(np.stack(exact)), axis=0)
    interp_err = float(max(np.max(np.abs(l - e) / scale) for l, e in zip(lin, exact)))
    ws.append(witness("display: linear interpolation of the published quadrupole samples vs the dense solution, worst relative error", interp_err, 3e-3))
    # reference wave heights the page must reproduce: h+ for in-plane observers, -Qdd_phiphi(t - R) / R
    rng = np.random.default_rng(1)
    ref = []
    for frac in (0.25, 0.6, 0.97):
        t = frac * t_end
        for _ in range(12):
            R, ph = float(rng.uniform(12, 300)), float(rng.uniform(0, 2 * math.pi))
            tr = t - R
            if tr < 0:
                h = 0.0
            else:
                q = [float(np.interp(tr, dec[:, 0], dec[:, k])) for k in (3, 4, 5)]
                s_, c_ = math.sin(ph), math.cos(ph)
                h = -(q[0] * s_ * s_ - 2 * q[1] * s_ * c_ + q[2] * c_ * c_) / R
            ref.append({"t": t, "R": R, "phi": ph, "h": h})

    r_dist = c["distance_mpc"] * MPC_M / (M * MSUN_M)
    meta = {"title": c["title"], "line": c["line"],
            "equation": "x'' = -M x / r^3 + (8/5) eta M^2 / r^3 [ (3 v^2 + 17 M / (3 r)) rdot n - (v^2 + 3 M / r) v ];  h_ij = 2 Qdd_ij^TT / R",
            "domain": {"shape": [len(ts)], "units": "geometric units G = c = M = 1; physical seconds and hertz for M in solar masses",
                       "boundary": f"start at a = {c['a0']} M, e = {c['e0']}; stop at r = 6 M"},
            "parameters": {"m1_msun": c["m1"], "m2_msun": c["m2"], "eta": eta, "a0_M": c["a0"], "e0": c["e0"], "rtol": 1e-12,
                           "samples_per_orbit": SPO, "audio_rate": RATE, "octave_factor": UP, "distance_mpc": c["distance_mpc"],
                           "M_seconds": Ms, "t_end_M": t_end, "t_end_s": t_end * Ms, "orbits": orbits,
                           "f_gw_start_hz": float(f_gw[int(0.05 * RATE)]), "f_gw_end_hz": float(np.median(f_gw[-200:])),
                           "peak_strain_at_distance": float(np.abs(hp).max() / r_dist), "chirp_mass_msun": M * eta ** 0.6},
            "method": "Relative two-body motion with the Damour-Deruelle 2.5PN radiation-reaction acceleration, DOP853 at rtol 1e-12, "
                      "stopped at r = 6M; quadrupole strain from the Newtonian second derivative of mu x_i x_j.",
            "limits": ["The quadrupole-inspiral model: Newtonian orbits plus the leading radiation reaction, no conservative post-Newtonian terms, no spins.",
                       "It stops at r = 6M; merger and ringdown, the loudest part of a real signal, are not modelled, so the sound ends where the model ends.",
                       "The wave pattern in the orbital plane uses the far-field quadrupole formula at every radius, including inside a wavelength where it is not the true field; heights are exaggerated for display.",
                       "The three-octave track multiplies the strain's phase by 8: a sonification with real timing, not the signal itself."],
            "dependencies": {dd: sha((ROOT / dd).read_bytes()) for dd in DEPENDENCIES},
            "external_dependencies": {f"lib/stemkit/{m}": sha((ROOT.parents[1] / "lib" / "stemkit" / m).read_bytes()) for m in STEM_LIB},
            "ripple_reference": ref}
    metrics = [{"id": "orbits", "a_mean": A.tolist(), "e_mean": Em.tolist(), "omega": Om.tolist(), "t_mean": Tm.tolist()},
               {"id": "timing", "seconds": round(time.time() - t0, 1)}]
    path = study.save_case(cid, meta, [f_orbit, f_real, f_up], metrics, ws)
    bad = [w["id"] for w in ws if not w["pass"]]
    log(f"{cid}: {len(ws)} witnesses, {len(bad)} red ({time.time() - t0:.1f}s)" + (": " + "; ".join(bad) if bad else ""))
    for w in ws:
        log(f"   {'ok ' if w['pass'] else 'RED'} {w['id']}: {w['observed']:.6g} {w['rule']} {w['limit']:.6g}")
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cases", nargs="*", default=list(CASES))
    a = ap.parse_args()
    for cid in a.cases:
        need(cid in CASES, "UNKNOWN_CASE", cid)
    for cid in a.cases:
        build(cid, lambda m: print(m, flush=True))
    write_json(ROOT / "cases" / "index.json", {"cases": [{"id": k, "title": v["title"], "line": v["line"]} for k, v in CASES.items()]})
    red = sum(not w["pass"] for cid in a.cases for w in json.loads((ROOT / "cases" / cid / "case.json").read_text())["witnesses"])
    sys.exit(1 if red else 0)


if __name__ == "__main__":
    main()
