"""Gray-Scott reaction-diffusion in 3D: the numerics of the Turing Garden (bound by the case manifests).

  u_t = Du lap(u) - u v^2 + F (1 - u)
  v_t = Dv lap(v) + u v^2 - (F + k) v

Unit grid spacing, periodic boundaries, the 7-point Laplacian, forward Euler. Every cell is updated from
the previous state only, so the parallel loop has no reductions and runs are bitwise reproducible.
Explicit stability needs dt <= 1 / (6 Du) for diffusion (0.83 for Du = 0.2); dt = 0.5 leaves a margin.
"""
from __future__ import annotations

import numpy as np
from numba import njit, prange

DU, DV, DT = 0.2, 0.1, 0.5


@njit(parallel=True, cache=False, fastmath=False)
def _step(u, v, un, vn, Du, Dv, F, k, dt):
    n0, n1, n2 = u.shape
    for i in prange(n0):
        ip = i + 1 if i + 1 < n0 else 0
        im = i - 1 if i > 0 else n0 - 1
        for j in range(n1):
            jp = j + 1 if j + 1 < n1 else 0
            jm = j - 1 if j > 0 else n1 - 1
            for l in range(n2):
                lp = l + 1 if l + 1 < n2 else 0
                lm = l - 1 if l > 0 else n2 - 1
                uc = u[i, j, l]
                vc = v[i, j, l]
                lu = (u[ip, j, l] + u[im, j, l]) + (u[i, jp, l] + u[i, jm, l]) + (u[i, j, lp] + u[i, j, lm]) - 6.0 * uc
                lv = (v[ip, j, l] + v[im, j, l]) + (v[i, jp, l] + v[i, jm, l]) + (v[i, j, lp] + v[i, j, lm]) - 6.0 * vc
                r = uc * vc * vc
                un[i, j, l] = uc + dt * (Du * lu - r + F * (1.0 - uc))
                vn[i, j, l] = vc + dt * (Dv * lv + r - (F + k) * vc)


def run(u, v, F, k, steps, dt=DT, Du=DU, Dv=DV, every=0, on_frame=None):
    """Advance (u, v) by `steps`; call on_frame(step, u, v) every `every` steps (and at 0)."""
    u, v = np.ascontiguousarray(u, np.float64).copy(), np.ascontiguousarray(v, np.float64).copy()
    un, vn = np.empty_like(u), np.empty_like(v)
    if on_frame and every:
        on_frame(0, u, v)
    for s in range(1, steps + 1):
        _step(u, v, un, vn, Du, Dv, F, k, dt)
        u, un, v, vn = un, u, vn, v
        if on_frame and every and s % every == 0:
            on_frame(s, u, v)
    return u, v


def laplacian(a):
    return sum(np.roll(a, 1, ax) + np.roll(a, -1, ax) for ax in range(3)) - 6.0 * a


def seed(n, rng, seeds=3, size=12, noise=0.02):
    """u = 1, v = 0 with `seeds` cubic seed regions (u = 0.5, v = 0.25, Pearson 1993) at random positions on
    the periodic grid, then one-sided noise over the whole domain: u -= noise r, v += noise r / 2, so the state
    starts inside 0 <= u <= 1, v >= 0, the region the scheme preserves for dt <= 0.5 (every update coefficient
    stays positive). The domain-wide noise breaks the seeds' cubic symmetry; without it, growth fronts stay
    nested squares."""
    u, v = np.ones((n, n, n)), np.zeros((n, n, n))
    h = size // 2
    centres = rng.integers(0, n, size=(seeds, 3))
    for c in centres:
        idx = np.ix_(*[(np.arange(-h, h) + ci) % n for ci in c])
        u[idx], v[idx] = 0.5, 0.25
    u -= noise * rng.random(u.shape)
    v += noise * rng.random(v.shape) / 2
    return u, v, centres
