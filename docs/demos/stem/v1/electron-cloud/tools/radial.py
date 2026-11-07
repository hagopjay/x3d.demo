"""Hydrogen, solved numerically: the radial Schrodinger equation in atomic units (infinite nuclear mass).

  -1/2 u'' + [ l(l+1) / (2 r^2) - 1/r ] u = E u,   u(0) = u(R) = 0,   R_nl(r) = u(r) / r

Uniform grid r_i = i h (i = 1..N), three-point second difference: a symmetric tridiagonal matrix whose
lowest eigenpairs are found by LAPACK (scipy eigh_tridiagonal). The method is second order in h, so the
builder also solves at 2h and Richardson-extrapolates the energies, and witnesses the observed order.
The exact results (energies -1/(2 n^2), Laguerre radial functions, <r>, <1/r>) live in this file only as
references for witnesses; the displayed clouds are built from the numerical u.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.linalg import eigh_tridiagonal
from scipy.special import genlaguerre

H, RMAX = 0.01, 200.0


def solve(l: int, count: int, h: float = H, rmax: float = RMAX):
    """Lowest `count` states for angular momentum l: energies (count,), u on the grid (count, N), r (N,).
    Each u is normalized (sum u^2 h = 1) and signed positive near the origin."""
    n_pts = int(round(rmax / h)) - 1
    r = h * np.arange(1, n_pts + 1)
    diag = 1.0 / h**2 + l * (l + 1) / (2 * r**2) - 1.0 / r
    off = np.full(n_pts - 1, -0.5 / h**2)
    E, V = eigh_tridiagonal(diag, off, select="i", select_range=(0, count - 1))
    U = V.T / math.sqrt(h)
    for k in range(count):
        first = U[k][np.argmax(np.abs(U[k]) > 1e-6 * np.abs(U[k]).max())]
        if first < 0:
            U[k] = -U[k]
    return E, U, r


def exact_energy(n: int) -> float:
    return -0.5 / n**2


def exact_u(n: int, l: int, r: np.ndarray) -> np.ndarray:
    rho = 2 * r / n
    norm = math.sqrt((2 / n) ** 3 * math.factorial(n - l - 1) / (2 * n * math.factorial(n + l)))
    return r * norm * np.exp(-rho / 2) * rho**l * genlaguerre(n - l - 1, 2 * l + 1)(rho)


def exact_mean_r(n: int, l: int) -> float:
    return (3 * n**2 - l * (l + 1)) / 2


def nodes(u: np.ndarray) -> int:
    """Sign changes of u, ignoring the numerically flat tail."""
    s = u[np.abs(u) > 1e-7 * np.abs(u).max()]
    return int(np.count_nonzero(np.sign(s[1:]) != np.sign(s[:-1])))
