/* Corner placement for the hover card (Gobbler v4 cornerstone UI).
 * Pure function, no DOM: the same file runs in the live viewer, the mock (docs/v4/mock keeps its frozen first version) and the node tests.
 *   W,H        viewport size in px
 *   hover      {x,y} screen position of the hovered star
 *   size       {w,h} card size in px
 *   density    function (x,y) -> 0..1, how much "subject" is at a screen point (clamped here; NaN, throws and out-of-range read as 0)
 *   margin     distance from the viewport edge (the viewer's 22 px stage padding)
 *   reserved   per-corner height already used by always-on chips: {TL:{h},TR:{h},BL:{h},BR:{h}}
 *   obstacles  extra rectangles {x,y,w,h} no card may touch (the measured chip boxes); optional
 *   halo       radius around the hovered star that no card may cover
 *   prev       the slot used last time (hysteresis: the card does not jump while the mouse drifts)
 * Result: {slot, rect, leader, kept, shrunk, fallback, scores}. slot is TL|TR|BL|BR or SHEET (narrow viewports; edge is then 'bottom' or 'top').
 *   leader is the point on the card nearest the star, or null for a sheet. shrunk: the card was cut to fit (caller clips it).
 *   fallback: nothing fit even shrunk, so the corner farthest from the star was used and the star may be covered.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Place = factory();
})(this, function () {
  'use strict';
  var SLOTS = ['TL', 'TR', 'BL', 'BR'];
  var WEIGHT = { density: 2.0, leader: 0.6, dist: 0.35 };
  var KEEP_MARGIN = 0.12;                 /* keep the previous slot unless another beats it by more than this */
  var NARROW = 720;                       /* below this width the card becomes a bottom sheet */
  var SHRINK = [1, 0.75, 0.55, 0.4];      /* card height fractions tried before giving up */
  var MIN_H = 120;

  function safeDensity(f) {
    return function (x, y) {
      var v; try { v = +f(x, y); } catch (e) { v = 0; }
      return v > 0 ? (v < 1 ? v : 1) : 0;      /* NaN and negatives become 0 */
    };
  }
  function slotRect(slot, W, H, size, m, reserved) {
    var r = (reserved && reserved[slot]) || { h: 0 };
    return {
      x: slot.charAt(1) === 'L' ? m : W - m - size.w,
      y: slot.charAt(0) === 'T' ? m + r.h : H - m - r.h - size.h,
      w: size.w, h: size.h
    };
  }
  function circleHitsRect(c, r) {
    var nx = Math.max(r.x, Math.min(c.x, r.x + r.w)), ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
    var dx = c.x - nx, dy = c.y - ny; return dx * dx + dy * dy < c.r * c.r;
  }
  function rectsHit(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  function inside(r, W, H) { return r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H; }
  function meanDensity(r, density, n) {
    var s = 0, c = 0, i, j; n = n || 8;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) { s += density(r.x + (i + 0.5) * r.w / n, r.y + (j + 0.5) * r.h / n); c++; }
    return s / c;
  }
  /* the leader line runs from the hovered star to the nearest point of the card */
  function nearestOnRect(p, r) { return { x: Math.max(r.x, Math.min(p.x, r.x + r.w)), y: Math.max(r.y, Math.min(p.y, r.y + r.h)) }; }
  function leaderDensity(p, r, density) {
    var q = nearestOnRect(p, r), s = 0, n = 24, i;
    for (i = 1; i < n; i++) s += density(p.x + (q.x - p.x) * i / n, p.y + (q.y - p.y) * i / n);
    return s / (n - 1);
  }

  /* narrow viewports: a card across the bottom or the top edge, whichever leaves the star its halo; the corner chips stay clear */
  function sheet(o, m, halo, obstacles) {
    var W = o.W, H = o.H, res = o.reserved || {}, hy = isFinite(o.hover.y) ? o.hover.y : H / 2, i;
    var top = m + Math.max((res.TL && res.TL.h) || 0, (res.TR && res.TR.h) || 0), bot = H - m - Math.max((res.BL && res.BL.h) || 0, (res.BR && res.BR.h) || 0);
    for (i = 0; i < obstacles.length; i++) { var q = obstacles[i]; if (q.y + q.h / 2 < H / 2) top = Math.max(top, q.y + q.h); else bot = Math.min(bot, q.y); }
    var want = Math.min(o.size.h, Math.round(H * 0.5)), below = bot - (hy + halo), above = (hy - halo) - top;
    var atBottom = below >= want || (above < want && below >= above);          /* the bottom edge is nearest the thumb: it wins unless the top has more room and the bottom cannot hold the card */
    var room = atBottom ? below : above, h = Math.min(want, Math.max(MIN_H, Math.floor(room)), H), y = atBottom ? bot - h : top;
    return { slot: 'SHEET', edge: atBottom ? 'bottom' : 'top', rect: { x: m, y: Math.max(0, Math.min(y, H - h)), w: Math.max(1, W - 2 * m), h: h }, scores: [], kept: false, leader: null, shrunk: h < o.size.h, fallback: room < MIN_H };
  }

  function attempt(o, size, m, halo, density, obstacles) {
    var W = o.W, H = o.H, diag = Math.hypot(W, H), circle = { x: o.hover.x, y: o.hover.y, r: halo }, scores = [], best = null, prevRow = null, k;
    for (k = 0; k < SLOTS.length; k++) {
      var s = SLOTS[k], r = slotRect(s, W, H, size, m, o.reserved), c = r.x + r.w / 2, d = r.y + r.h / 2, feasible = inside(r, W, H) && !circleHitsRect(circle, r), j;
      for (j = 0; feasible && j < obstacles.length; j++) if (rectsHit(r, obstacles[j])) feasible = false;
      var den = meanDensity(r, density), led = leaderDensity(o.hover, r, density);
      var dist = Math.hypot(c - o.hover.x, d - o.hover.y) / diag;
      var score = WEIGHT.density * den + WEIGHT.leader * led + WEIGHT.dist * dist + (feasible ? 0 : 10);
      var row = { slot: s, rect: r, feasible: feasible, density: den, leader: led, dist: dist, score: score };
      scores.push(row);
      if (feasible && (!best || score < best.score)) best = row;
      if (o.prev === s && feasible) prevRow = row;
    }
    return { best: best, prevRow: prevRow, scores: scores };
  }

  function choose(o) {
    var m = o.margin == null ? 22 : o.margin, halo = o.halo == null ? 96 : o.halo, density = safeDensity(o.density || function () { return 0; });
    var obstacles = o.obstacles || [], i, a, size, last;
    if (o.W < NARROW) return sheet(o, m, halo, obstacles);
    for (i = 0; i < SHRINK.length; i++) {
      size = { w: o.size.w, h: i === 0 ? o.size.h : Math.max(MIN_H, Math.round(o.size.h * SHRINK[i])) };
      if (i > 0 && size.h >= last) continue;
      last = size.h;
      a = attempt(o, size, m, halo, density, obstacles);
      if (a.best) {
        var best = a.best, kept = false;
        if (a.prevRow && a.prevRow.score - best.score <= KEEP_MARGIN) { best = a.prevRow; kept = true; }
        return { slot: best.slot, rect: best.rect, scores: a.scores, kept: kept, leader: nearestOnRect(o.hover, best.rect), shrunk: i > 0, fallback: false };
      }
    }
    /* nothing fits even shrunk: the corner farthest from the star, at the smallest size tried */
    var far = a.scores.slice().sort(function (p, q) {
      return Math.hypot(q.rect.x + q.rect.w / 2 - o.hover.x, q.rect.y + q.rect.h / 2 - o.hover.y) - Math.hypot(p.rect.x + p.rect.w / 2 - o.hover.x, p.rect.y + p.rect.h / 2 - o.hover.y);
    })[0];
    return { slot: far.slot, rect: far.rect, scores: a.scores, kept: false, leader: nearestOnRect(o.hover, far.rect), shrunk: true, fallback: true };
  }

  return { choose: choose, slotRect: slotRect, meanDensity: meanDensity, nearestOnRect: nearestOnRect, WEIGHT: WEIGHT, SLOTS: SLOTS, NARROW: NARROW, KEEP_MARGIN: KEEP_MARGIN, MIN_H: MIN_H };
});
