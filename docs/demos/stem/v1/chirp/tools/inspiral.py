"""Binary inspiral, integrated: Newtonian two-body motion plus the leading (2.5PN) radiation-reaction force.

Relative motion in geometric units G = c = M = 1 (M the total mass), mass ratio through eta = m1 m2 / M^2:

  a = -x / r^3 + a_RR,
  a_RR = (8/5) eta / r^3 [ (3 v^2 + 17 / (3 r)) rdot n - (v^2 + 3 / r) v ]     (Damour-Deruelle, harmonic gauge)

The radiation-reaction term is the only dissipative piece; no conservative post-Newtonian terms are kept,
so this is the 'quadrupole inspiral' model: exactly the physics behind Peters (1964) and the Newtonian
chirp law, which the builder uses as references. The run stops at r = 6 M (the Schwarzschild ISCO of the
total mass), where this model stops being a fair description; merger and ringdown are not modelled.
The work done by a_RR is integrated alongside (state[4]) so the energy budget can be checked exactly.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.integrate import solve_ivp

R_STOP = 6.0


def rhs(eta):
    def f(t, s):
        x, y, vx, vy, _ = s
        r2 = x * x + y * y
        r = math.sqrt(r2)
        nx, ny = x / r, y / r
        v2 = vx * vx + vy * vy
        rdot = nx * vx + ny * vy
        k = 1.6 * eta / (r2 * r)
        c1, c2 = (3 * v2 + 17 / (3 * r)) * rdot, v2 + 3 / r
        ax_rr, ay_rr = k * (c1 * nx - c2 * vx), k * (c1 * ny - c2 * vy)
        ax, ay = -x / (r2 * r) + ax_rr, -y / (r2 * r) + ay_rr
        return [vx, vy, ax, ay, eta * (ax_rr * vx + ay_rr * vy)]     # last: d/dt of work by a_RR per unit M
    return f


def stop_at(r_stop):
    def ev(t, s):
        return math.hypot(s[0], s[1]) - r_stop
    ev.terminal, ev.direction = True, -1
    return ev


def initial(eta, a0, e0=0.0):
    """Start at apoastron of an osculating Newtonian orbit (a0, e0). For a circular start add the adiabatic
    infall speed da/dt = -(64/5) eta / a^3 (Peters), which removes the eccentricity a bare circular start
    would inject."""
    r0 = a0 * (1 + e0)
    v0 = math.sqrt((1 - e0) / (a0 * (1 + e0)))
    vr = -(64 / 5) * eta / a0**3 if e0 == 0 else 0.0
    return [r0, 0.0, vr, v0, 0.0]


def integrate(eta, a0, e0=0.0, rtol=1e-12, samples_per_orbit=64, r_stop=R_STOP):
    s0 = initial(eta, a0, e0)
    sol = solve_ivp(rhs(eta), (0.0, 1e9), s0, method="DOP853", rtol=rtol, atol=1e-14, events=stop_at(r_stop), dense_output=True)
    if sol.status != 1:
        raise RuntimeError(f"integration did not reach r = {r_stop}: {sol.message}")
    t_end = float(sol.t_events[0][0])
    # sample uniformly in orbital phase: accumulate phase on a fine grid, then invert
    tf = np.linspace(0, t_end, 400_000)
    X = sol.sol(tf)
    phi = np.unwrap(np.arctan2(X[1], X[0]))
    n = int(phi[-1] / (2 * math.pi) * samples_per_orbit)
    ts = np.interp(np.linspace(0, phi[-1], n + 1), phi, tf)
    return sol, t_end, ts


def diagnostics(sol, eta, t):
    x, y, vx, vy, w = sol.sol(t)
    r = np.hypot(x, y)
    v2 = vx**2 + vy**2
    E = eta * (v2 / 2 - 1 / r)                         # Newtonian orbital energy per unit M
    a_osc = 1 / (2 / r - v2)
    L = x * vy - y * vx
    e_osc = np.sqrt(np.maximum(0, 1 - L**2 / a_osc))
    phi = np.unwrap(np.arctan2(y, x))
    return dict(x=x, y=y, vx=vx, vy=vy, r=r, E=E, W=w, a=a_osc, e=e_osc, phi=phi)


def quadrupole_dd(x, y, vx, vy, eta):
    """Second time derivative of the mass quadrupole Q_ij = mu x_i x_j (mu = eta M), Newtonian acceleration."""
    r3 = np.hypot(x, y) ** 3
    ax, ay = -x / r3, -y / r3
    return (eta * (2 * vx * vx + 2 * x * ax), eta * (2 * vx * vy + x * ay + ax * y), eta * (2 * vy * vy + 2 * y * ay))


def quadrupole_luminosity(x, y, vx, vy, eta):
    """L = (1/5) dddQ^TF_ij dddQ^TF_ij from the Newtonian jerk (planar orbit, z components zero)."""
    r = np.hypot(x, y)
    r3, r5 = r**3, r**5
    ax, ay = -x / r3, -y / r3
    xv = x * vx + y * vy
    jx, jy = -(vx / r3 - 3 * x * xv / r5), -(vy / r3 - 3 * y * xv / r5)
    q = {"xx": 6 * vx * ax + 2 * x * jx, "yy": 6 * vy * ay + 2 * y * jy, "xy": 3 * (vx * ay + ax * vy) + x * jy + jx * y}
    q = {k: eta * v for k, v in q.items()}
    tr = (q["xx"] + q["yy"]) / 3
    txx, tyy, tzz = q["xx"] - tr, q["yy"] - tr, -tr
    return (txx**2 + tyy**2 + tzz**2 + 2 * q["xy"] ** 2) / 5


def peters_a(eta, a0, t):
    return (a0**4 - (256 / 5) * eta * t) ** 0.25


def peters_g(e):
    return e ** (12 / 19) / (1 - e**2) * (1 + 121 / 304 * e**2) ** (870 / 2299)
