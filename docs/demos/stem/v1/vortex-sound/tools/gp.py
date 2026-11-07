"""Gross-Pitaevskii superfluid in a periodic box, split-step Fourier (Strang), dimensionless units.

  i psi_t = -1/2 lap(psi) + (|psi|^2 - 1) psi

Background density 1, sound speed c = 1, healing length xi = 1/sqrt(2) (hbar = m = 1, circulation
kappa = 2 pi). Each Strang step is a product of exactly unitary maps (kinetic in Fourier space, the
nonlinear phase rotation in real space), so the norm is conserved to rounding; the energy is conserved to
O(dt^2). Exact references used by the builder: the Bogoliubov dispersion of small waves on the background,
omega = k sqrt(1 + k^2 / 4), and (asymptotically, for rings much larger than the core) the Roberts-Grant
speed of a vortex ring.
"""
from __future__ import annotations

import math

import numpy as np
import scipy.fft as sfft

WORKERS = -1
XI = 1 / math.sqrt(2)


class Box:
    def __init__(self, n: int, L: float):
        self.n, self.L, self.h = n, L, L / n
        x = (np.arange(n) - n / 2 + 0.5) * self.h
        self.x = x
        k = 2 * np.pi * sfft.fftfreq(n, d=self.h)
        KX, KY, KZ = np.meshgrid(k, k, k, indexing="ij", sparse=True)
        self.k2 = KX**2 + KY**2 + KZ**2
        self.k = (KX, KY, KZ)

    def grid(self):
        return np.meshgrid(self.x, self.x, self.x, indexing="ij", sparse=True)

    def stepper(self, dt: float):
        half = np.exp(-0.5j * self.k2 * dt / 2).astype(np.complex128)
        def step(psi):
            psi = sfft.ifftn(sfft.fftn(psi, workers=WORKERS) * half, workers=WORKERS)
            psi *= np.exp(-1j * (np.abs(psi) ** 2 - 1) * dt)
            return sfft.ifftn(sfft.fftn(psi, workers=WORKERS) * half, workers=WORKERS)
        return step

    def relax(self, psi, steps=60, dtau=0.05):
        """Short imaginary-time relaxation: lets the approximate cores settle to the GP profile before the
        clock starts (the ring barely moves; its radius shrinks by about dtau * steps / R)."""
        half = np.exp(-0.5 * self.k2 * dtau / 2)
        for _ in range(steps):
            psi = sfft.ifftn(sfft.fftn(psi, workers=WORKERS) * half, workers=WORKERS)
            psi *= np.exp(-(np.abs(psi) ** 2 - 1) * dtau)
            psi = sfft.ifftn(sfft.fftn(psi, workers=WORKERS) * half, workers=WORKERS)
            psi /= np.sqrt(np.mean(np.abs(psi) ** 2))
        return psi

    def norm(self, psi):
        return float(np.sum(np.abs(psi) ** 2) * self.h**3)

    def energy(self, psi):
        """E = integral of 1/2 |grad psi|^2 + 1/2 (|psi|^2 - 1)^2 (spectral gradient)."""
        ph = sfft.fftn(psi, workers=WORKERS)
        kin = 0.5 * float(np.sum(self.k2 * np.abs(ph) ** 2)) / psi.size * self.h**3
        pot = 0.5 * float(np.sum((np.abs(psi) ** 2 - 1) ** 2)) * self.h**3
        return kin + pot

    def momentum(self, psi):
        """P = integral of Im(conj(psi) grad psi), spectral."""
        ph = sfft.fftn(psi, workers=WORKERS)
        out = []
        for K in self.k:
            g = sfft.ifftn(1j * K * ph, workers=WORKERS)
            out.append(float(np.sum(np.imag(np.conj(psi) * g)) * self.h**3))
        return np.array(out)


def vortex2d(a, b):
    """A straight vortex of winding +1 in the (a, b) plane: Pade-like core f(r) = r / sqrt(r^2 + 2 xi^2)... rescaled."""
    r2 = a * a + b * b
    return np.sqrt(r2 / (r2 + 2 * XI**2 * 2)) * np.exp(1j * np.arctan2(b, a))


def ring(box, R, centre, axis):
    """A vortex ring of radius R travelling along +axis: a vortex/antivortex pair in each meridional plane."""
    X, Y, Z = box.grid()
    c = np.asarray(centre, float)
    n = np.asarray(axis, float) / np.linalg.norm(axis)
    dx, dy, dz = X - c[0], Y - c[1], Z - c[2]
    z = dx * n[0] + dy * n[1] + dz * n[2]
    s = np.sqrt(np.maximum((dx - z * n[0]) ** 2 + (dy - z * n[1]) ** 2 + (dz - z * n[2]) ** 2, 0))
    return np.conj(vortex2d(s - R, z)) * vortex2d(s + R, z)     # orientation chosen so the ring moves along +axis


def periodize(box, psi):
    """Make an analytic initial state periodic: a ring's phase does not return to the same value across the
    box faces (a jump of about 0.6 rad for a ring 16 units from a face), which the FFT would treat as real and
    which drove a spurious flow (rings 7 to 14 % fast in the first exploration). For each axis, a linear phase
    ramp removes the mismatch between the last and first planes; physically it is the uniform backflow a
    periodic box must carry to balance the ring's impulse."""
    for ax in range(3):
        first = np.take(psi, [0], axis=ax)
        last = np.take(psi, [-1], axis=ax)
        jump = np.angle(first * np.conj(last))          # phase step across the periodic face
        inner = np.angle(np.take(psi, [1], axis=ax) * np.conj(first))   # a typical interior step
        mismatch = np.angle(np.exp(1j * (jump - inner)))
        shape = [1, 1, 1]
        shape[ax] = box.n
        ramp = (np.arange(box.n).reshape(shape) / box.n)
        psi = psi * np.exp(1j * mismatch * ramp)
    return psi


def backflow(R, L):
    """Uniform counterflow in a periodic box of side L that balances a ring's impulse kappa pi R^2."""
    return -2 * math.pi * math.pi * R * R / L**3


def roberts_grant_speed(R):
    """Asymptotic speed of a GP vortex ring of radius R >> xi (Roberts & Grant 1971), in these units."""
    return (1 / (2 * R)) * (math.log(8 * R / XI) - 0.615)


def bogoliubov_omega(k):
    return k * math.sqrt(1 + k * k / 4)


def _faces(psi):
    """Phase winding through every grid face: (face plane axes, third axis, integer winding array).
    A face at index p spans p, p + e1, p + e1 + e2, p + e2 (periodic)."""
    th = np.angle(psi)
    def d(a, b):
        return np.angle(np.exp(1j * (b - a)))
    for ax1, ax2, ax3 in ((0, 1, 2), (1, 2, 0), (0, 2, 1)):
        a = th
        b = np.roll(th, -1, ax1)
        c = np.roll(b, -1, ax2)
        e = np.roll(th, -1, ax2)
        yield ax1, ax2, ax3, np.rint((d(a, b) + d(b, c) + d(c, e) + d(e, a)) / (2 * np.pi)).astype(int)


def pierce_points(box, psi):
    """Centres of the faces a vortex line pierces (the discrete vortex lines)."""
    pts = []
    for ax1, ax2, ax3, w in _faces(psi):
        idx = np.argwhere(w != 0).astype(float)
        if len(idx):
            q = box.x[0] + idx * box.h
            q[:, ax1] += box.h / 2
            q[:, ax2] += box.h / 2
            pts.append(q)
    return np.concatenate(pts) if pts else np.zeros((0, 3))


def vortex_cells(psi):
    """Cells a vortex line passes through: the two cells on either side of every pierced face, along its
    normal (cell p has lower corner p). The first version marked neighbours in the face's own plane, which
    can leave gaps along a line and split one loop into two (vortex-sound exploration, 5 Nov)."""
    hit = np.zeros(psi.shape, bool)
    for ax1, ax2, ax3, w in _faces(psi):
        face = w != 0
        hit |= face | np.roll(face, 1, ax3)
    return hit


def loops(psi):
    """Number of distinct vortex loops: connected components (26-neighbour) of the pierced cells."""
    from scipy import ndimage
    lab, n = ndimage.label(vortex_cells(psi), structure=np.ones((3, 3, 3)))
    return n, lab
