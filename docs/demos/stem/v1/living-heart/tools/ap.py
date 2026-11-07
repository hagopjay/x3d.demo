"""Aliev-Panfilov cardiac tissue (Aliev & Panfilov 1996), explicit finite differences, no-flux walls.

  u_t = D lap(u) - k u (u - a)(u - 1) - u v
  v_t = eps(u, v) (-v - k u (u - a - 1)),   eps = eps0 + mu1 v / (u + mu2)

u is the normalized transmembrane voltage, v the recovery variable; dimensionless time and space
(about 12.9 ms per time unit and 1 mm per space unit for ventricular tissue). Forward Euler, 5-point (2D)
or 7-point masked (3D) Laplacian with no-flux walls: a neighbour outside the tissue simply does not
contribute, so the discrete Laplacian sums to zero over the tissue (a witness checks it). Every cell is
updated from the previous state only: parallel loops without reductions, bitwise-reproducible runs.

With eps0 = mu1 = 0 and v = 0 the voltage obeys the Nagumo equation, whose travelling front has the
exact speed c = sqrt(k D / 2) (1 - 2a): the builder's reference control.
"""
from __future__ import annotations

import math

import numpy as np
from numba import njit, prange

K, A, EPS0, MU1, MU2, D = 8.0, 0.15, 0.002, 0.2, 0.3, 1.0
MS_PER_UNIT = 12.9


@njit(cache=False, fastmath=False, inline="always")
def _reaction(u, v, k, a, eps0, mu1, mu2):
    du = -k * u * (u - a) * (u - 1.0) - u * v
    eps = eps0 + mu1 * v / (u + mu2)
    dv = eps * (-v - k * u * (u - a - 1.0))
    return du, dv


@njit(parallel=True, cache=False, fastmath=False)
def step1d(u, v, un, vn, dt, h, k, a, eps0, mu1, mu2, d):
    n = u.shape[0]
    c = d * dt / (h * h)
    for i in prange(n):
        um = u[i - 1] if i > 0 else u[i + 1]          # mirror: no-flux
        up = u[i + 1] if i < n - 1 else u[i - 1]
        du, dv = _reaction(u[i], v[i], k, a, eps0, mu1, mu2)
        un[i] = u[i] + c * (um + up - 2.0 * u[i]) + dt * du
        vn[i] = v[i] + dt * dv


@njit(parallel=True, cache=False, fastmath=False)
def step2d(u, v, un, vn, dt, h, k, a, eps0, mu1, mu2, d):
    nx, ny = u.shape
    c = d * dt / (h * h)
    for i in prange(nx):
        for j in range(ny):
            uc = u[i, j]
            s = 0.0
            if i > 0:
                s += u[i - 1, j] - uc
            if i < nx - 1:
                s += u[i + 1, j] - uc
            if j > 0:
                s += u[i, j - 1] - uc
            if j < ny - 1:
                s += u[i, j + 1] - uc
            du, dv = _reaction(uc, v[i, j], k, a, eps0, mu1, mu2)
            un[i, j] = uc + c * s + dt * du
            vn[i, j] = v[i, j] + dt * dv


@njit(parallel=True, cache=False, fastmath=False)
def step3d(u, v, un, vn, mask, dt, h, k, a, eps0, mu1, mu2, d):
    nx, ny, nz = u.shape
    c = d * dt / (h * h)
    for i in prange(nx):
        for j in range(ny):
            for l in range(nz):
                if not mask[i, j, l]:
                    un[i, j, l] = 0.0
                    vn[i, j, l] = 0.0
                    continue
                uc = u[i, j, l]
                s = 0.0
                if i > 0 and mask[i - 1, j, l]:
                    s += u[i - 1, j, l] - uc
                if i < nx - 1 and mask[i + 1, j, l]:
                    s += u[i + 1, j, l] - uc
                if j > 0 and mask[i, j - 1, l]:
                    s += u[i, j - 1, l] - uc
                if j < ny - 1 and mask[i, j + 1, l]:
                    s += u[i, j + 1, l] - uc
                if l > 0 and mask[i, j, l - 1]:
                    s += u[i, j, l - 1] - uc
                if l < nz - 1 and mask[i, j, l + 1]:
                    s += u[i, j, l + 1] - uc
                du, dv = _reaction(uc, v[i, j, l], k, a, eps0, mu1, mu2)
                un[i, j, l] = uc + c * s + dt * du
                vn[i, j, l] = v[i, j, l] + dt * dv


@njit(parallel=True, cache=False, fastmath=False)
def masked_laplacian_sum(u, mask):
    """Sum over the tissue of the masked discrete Laplacian (times h^2): zero for no-flux walls."""
    nx, ny, nz = u.shape
    acc = np.zeros(nx)
    for i in prange(nx):
        t = 0.0
        for j in range(ny):
            for l in range(nz):
                if not mask[i, j, l]:
                    continue
                uc = u[i, j, l]
                for di, dj, dl in ((-1, 0, 0), (1, 0, 0), (0, -1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1)):
                    ii, jj, ll = i + di, j + dj, l + dl
                    if 0 <= ii < nx and 0 <= jj < ny and 0 <= ll < nz and mask[ii, jj, ll]:
                        t += u[ii, jj, ll] - uc
        acc[i] = t
    return acc


def nagumo_speed(k=K, a=A, d=D):
    return math.sqrt(k * d / 2) * (1 - 2 * a)


def front_speed(h, dt, length=400.0, nagumo=True, steps_skip=None):
    """Speed of a front in a 1D cable stimulated at the left end, from the times it crosses two probes."""
    n = int(round(length / h)) + 1
    u, v = np.zeros(n), np.zeros(n)
    u[: max(3, int(5 / h))] = 1.0
    un, vn = np.empty_like(u), np.empty_like(v)
    eps0, mu1 = (0.0, 0.0) if nagumo else (EPS0, MU1)
    x1, x2 = int(round(0.4 * length / h)), int(round(0.8 * length / h))
    t, t1, t2, prev1, prev2 = 0.0, None, None, 0.0, 0.0
    while t2 is None:
        step1d(u, v, un, vn, dt, h, K, A, eps0, mu1, MU2, D)
        u, un, v, vn = un, u, vn, v
        t += dt
        if t1 is None and u[x1] >= 0.5:
            t1 = t - dt * (u[x1] - 0.5) / (u[x1] - prev1)
        if t2 is None and u[x2] >= 0.5:
            t2 = t - dt * (u[x2] - 0.5) / (u[x2] - prev2)
        prev1, prev2 = u[x1], u[x2]
        if t > 10 * length:
            raise RuntimeError("front did not arrive")
    return (x2 - x1) * h / (t2 - t1)
