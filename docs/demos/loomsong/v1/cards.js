/* Loomsong cards: the animated pictures that frame the music.
 *
 *   title    loops, muted, behind the title card until the first press
 *   open     a piece's opening: plays once over the world as the music starts, carries the piece's name, and dissolves into the world
 *   between  loops, muted, behind the end card when a piece is over (the hall between the pieces)
 *
 * A card is a layer over the page, never part of the timing: the clock starts when the press says so and never waits for a picture. A card exists only when the build shipped its video and its
 * poster (page/build_page.py checks both against the media manifest); with none, the page is exactly what it was without this file. Every card is an AI-made animated picture (or, in the tests,
 * a test pattern that says so): the card says it, the corner says it, and so do the credits.
 * Cards are muted, have no controls and take no pointer events: Escape or Enter, or the Skip chip, ends an opening early. Calm (and reduced motion, which starts Calm) holds a looping card on its
 * poster and leaves out the opening. The opening runs on the page's own timer, not the video's clock, so a slow connection can freeze the picture but never the page.
 * The address wants cards=on to play them under the test clock (?clock=manual leaves them out otherwise, so a world is never covered while a witness is looking at it).
 * All text goes in through textContent. No eval, no inline handlers.
 */
(function (global) {
  'use strict';
  var d = global.document;

  var OPEN_S = 8, FADE_S = 2.2, NAME_IN_S = 0.9, SKIP_MS = 450;

  function el(tag, cls, text, parent) {
    var e = d.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /** One card: a layer holding a muted video (with its poster) and nothing else. */
  function Layer(kind, spec, loop) {
    this.kind = kind; this.spec = spec; this.loop = loop; this.loaded = false;
    this.box = el('div', 'ls-card');
    this.box.setAttribute('data-kind', kind);
    this.box.setAttribute('aria-hidden', 'true');
    var v = this.video = el('video', 'ls-card-video', null, this.box);
    v.muted = true; v.defaultMuted = true; v.loop = !!loop; v.controls = false; v.tabIndex = -1;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('disablepictureinpicture', ''); v.setAttribute('disableremoteplayback', '');
    v.preload = 'none';
    if (spec.poster) v.poster = spec.poster;
  }
  /** Ask for the video file (once). Until it arrives the poster is what shows. */
  Layer.prototype.load = function () {
    if (this.loaded) return;
    this.loaded = true;
    this.video.preload = 'auto';
    this.video.src = this.spec.video;
    try { this.video.load(); } catch (e) { /* the poster stays */ }
  };
  Layer.prototype.play = function () {
    var p;
    this.load();
    try { p = this.video.play(); } catch (e) { return; }
    if (p && p.catch) p.catch(function () { /* autoplay refused or the file did not load: the poster stays */ });
  };
  Layer.prototype.pause = function () { try { this.video.pause(); } catch (e) { /* nothing playing */ } };
  Layer.prototype.state = function () {
    var v = this.video;
    return { loaded: this.loaded, ready: v.readyState, playing: !v.paused && !v.ended && v.readyState > 2, time: Math.round(v.currentTime * 100) / 100, error: v.error ? v.error.code : 0, seconds: isFinite(v.duration) ? Math.round(v.duration * 100) / 100 : 0 };
  };

  function Cards(app, ui, root) {
    var self = this, cfg = app.cfg.cards || {};
    this.app = app; this.ui = ui; this.root = root;
    this.on = !!(cfg.title || cfg.between || cfg.open) && (!app.manual || /[?&]cards=on/.test(global.location.search));
    this.title = this.between = null; this.open = {};
    this.epoch = 0; this.openedFor = -1; this.cur = null; this.t0 = 0; this.skipT = 0;
    this.shown = { title: false, between: false };
    if (!this.on) return;
    if (cfg.title) { this.title = new Layer('title', cfg.title, true); ui.splash.insertBefore(this.title.box, ui.splash.firstChild); }
    if (cfg.between) { this.between = new Layer('between', cfg.between, true); ui.credits.insertBefore(this.between.box, ui.credits.firstChild); ui.credits.setAttribute('data-card', '1'); }
    Object.keys(cfg.open || {}).forEach(function (id) { self.open[id] = new Layer('open', cfg.open[id], false); });
    // the opening sits between the world and the interface, so the corner, the compass and the lyric stay usable above it
    this.layer = el('div', 'ls-card-open', null, null);
    this.layer.hidden = true;
    root.insertBefore(this.layer, root.children[1] || null);
    this.name = el('div', 'ls-card-name', '', this.layer);
    this.by = el('div', 'ls-card-by', '', this.layer);
    this.tag = el('div', 'ls-card-ai', '', this.layer);
    this.skip = el('button', 'ls-chip ls-skip', null, this.layer);
    this.skip.type = 'button';
    el('span', null, 'Skip', this.skip); el('kbd', null, 'Esc', this.skip);
    this.skip.addEventListener('click', function () { self.endOpening(true); });
    d.addEventListener('keydown', function (e) { if (self.cur && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); self.endOpening(true); } });
    app.on('opening', function (p) { self.begin(p); });
    app.on('loading', function (p) { self.epoch++; self.endOpening(false); if (self.open[p.id]) self.open[p.id].load(); });
    app.on('frame', function (t, perf) { self.frame(perf); });
    app.on('calm', function (on) { self.calm(on); });
    if (this.title) { this.title.load(); }
    this.calm(app.calm);
  }

  /** Looping cards move only when the viewer has not asked for calm and while they are on screen. */
  Cards.prototype.calm = function (on) {
    var self = this;
    ['title', 'between'].forEach(function (k) {
      var L = self[k];
      if (!L) return;
      if (on || !self.shown[k]) L.pause(); else L.play();
    });
  };

  /** The title card is on screen with the splash. */
  Cards.prototype.splash = function (show) {
    if (!this.on || !this.title) return;
    this.shown.title = !!show;
    if (show && !this.app.calm) this.title.play(); else this.title.pause();
  };

  /** The end card is on screen. */
  Cards.prototype.credits = function (show) {
    if (!this.on || !this.between) return;
    this.shown.between = !!show;
    if (show) this.between.load();
    if (show && !this.app.calm) this.between.play(); else this.between.pause();
  };

  /** A piece starts from its first moment: its opening plays over the world, once. */
  Cards.prototype.begin = function (p) {
    var L = this.open[p.id];
    if (!this.on || !L || this.openedFor === this.epoch || this.app.calm) return;
    this.openedFor = this.epoch;
    this.cur = L;
    this.name.textContent = p.title; this.by.textContent = p.by;
    this.tag.textContent = L.spec.label || 'AI-made animated picture';
    this.layer.insertBefore(L.box, this.layer.firstChild);
    this.layer.hidden = false;
    this.layer.style.opacity = '1'; this.name.style.opacity = '0'; this.by.style.opacity = '0';
    this.t0 = global.performance.now(); this.skipT = 0;
    try { L.video.currentTime = 0; } catch (e) { /* not loaded yet: it starts at the beginning anyway */ }
    L.play();
  };

  Cards.prototype.frame = function (perf) {
    if (!this.cur) return;
    var s = (perf - this.t0) / 1000, dur = Math.min(OPEN_S, this.cur.spec.seconds || OPEN_S), fade = Math.min(FADE_S, dur * 0.4);
    var k = s < dur - fade ? 1 : Math.max(0, (dur - s) / fade);
    if (this.skipT) k = Math.min(k, Math.max(0, 1 - (perf - this.skipT) / SKIP_MS));
    if (k <= 0) { this.endOpening(false); return; }
    this.layer.style.opacity = String(Math.round(k * 1000) / 1000);
    var n = Math.min(1, s / NAME_IN_S);
    this.name.style.opacity = this.by.style.opacity = String(Math.round(n * 1000) / 1000);
  };

  /** early: the viewer asked, so the card dissolves in under half a second instead of cutting. */
  Cards.prototype.endOpening = function (early) {
    if (!this.cur) return;
    if (early) { if (!this.skipT) this.skipT = global.performance.now(); return; }
    this.cur.pause();
    this.layer.hidden = true;
    this.cur = null;
  };

  Cards.prototype.status = function () {
    var out = { on: this.on, open: {} };
    if (this.title) out.title = this.title.state();
    if (this.between) out.between = this.between.state();
    for (var k in this.open) out.open[k] = this.open[k].state();
    out.opening = !!this.cur;
    return out;
  };

  global.LoomCards = Cards;
})(window);
