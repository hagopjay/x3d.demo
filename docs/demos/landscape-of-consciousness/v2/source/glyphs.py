"""Text as geometry: glyph outlines from a TrueType font, flattened and triangulated once, reused by DEF/USE.

Why: a browser that cannot fetch font files (a sandboxed page, a strict CSP, an X3D reader with no font
machinery) still draws every label, because the letters are ordinary IndexedFaceSets in the file.
"""
import numpy as np
import mapbox_earcut as earcut
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen


class _Flatten(BasePen):
    def __init__(self, glyphset, steps=5):
        super().__init__(glyphset); self.steps = steps; self.contours = []; self.cur = []
    def _moveTo(self, p): self.cur = [p]
    def _lineTo(self, p): self.cur.append(p)
    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            self.cur.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 2):
            t = i / (self.steps + 1); u = 1 - t
            self.cur.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0], u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    def _closePath(self):
        if len(self.cur) > 2:
            if self.cur[0] == self.cur[-1]: self.cur.pop()
            self.contours.append(self.cur)
        self.cur = []
    _endPath = _closePath


def _area(c):
    a = np.asarray(c); x, y = a[:, 0], a[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _inside(pt, poly):
    x, y = pt; n = len(poly); c = False
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1: c = not c
    return c


class GlyphLib:
    def __init__(self, path, key):
        self.font = TTFont(path); self.key = key
        self.upem = self.font["head"].unitsPerEm
        self.cmap = self.font.getBestCmap(); self.gs = self.font.getGlyphSet()
        self.hmtx = self.font["hmtx"]; self.cache = {}

    def advance(self, ch):
        g = self.cmap.get(ord(ch)) or self.cmap.get(ord("?"))
        return self.hmtx[g][0] / self.upem

    def mesh(self, ch):
        """(points Nx2 in em, triangles) or None for blank glyphs."""
        if ch in self.cache: return self.cache[ch]
        g = self.cmap.get(ord(ch)) or self.cmap.get(ord("?"))
        pen = _Flatten(self.gs); self.gs[g].draw(pen)
        cs = [np.asarray(c, float) / self.upem for c in pen.contours if len(c) >= 3]
        if not cs: self.cache[ch] = None; return None
        areas = [_area(c) for c in cs]
        outer_sign = np.sign(areas[int(np.argmax(np.abs(areas)))])
        outers = [i for i, a in enumerate(areas) if np.sign(a) == outer_sign]
        holes = [i for i, a in enumerate(areas) if np.sign(a) != outer_sign]
        groups = {o: [] for o in outers}
        for h in holes:
            best = None
            for o in outers:
                if _inside(cs[h][0], cs[o]) and (best is None or abs(areas[o]) < abs(areas[best])): best = o
            if best is not None: groups[best].append(h)
        P, T = [], []
        for o, hs in groups.items():
            rings = [cs[o]] + [cs[h] for h in hs]
            verts = np.vstack(rings).astype(np.float32)
            ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
            tri = earcut.triangulate_float32(verts, ends).reshape(-1, 3)
            base = len(P); P.extend(verts.tolist()); T.extend((tri + base).tolist())
        self.cache[ch] = (np.asarray(P), T)
        return self.cache[ch]

    def width(self, s): return sum(self.advance(ch) for ch in s)
