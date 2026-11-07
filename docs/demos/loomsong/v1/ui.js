/* Loomsong interface: none, minimal or learn; the picture stays on its own until asked.
 *
 *   None     the picture only (the title card and Play stay until sound starts: browsers allow sound only after a press)
 *   Minimal  one corner: piece, bar and beat, section, a thin progress line, play and pause, next piece, view, camera, calm
 *   Learn    Minimal plus the harmony compass (chord and its Roman numeral), Schiller's line with an English gloss for the Ode,
 *            and a card for whatever the pointer rests on (a thread, a hole, a pin, a tile): its note, instrument, bar and beat, who wrote it
 *
 * Keys: Space play and pause, Left and Right a bar, 1 and 2 pick the piece, U cycles the view, C directed or free camera, K calm, P moves the corner.
 * All text goes in through textContent. No eval, no inline handlers, no web fonts.
 */
(function (global) {
  'use strict';
  var d = global.document;

  function el(tag, cls, text, parent) {
    var e = d.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmt(t) { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }
  var PC = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  function pitchName(m) { return PC[m % 12] + (Math.floor(m / 12) - 1); }
  var QUAL = { M: 'major', m: 'minor', '7': 'dominant seventh', dim: 'diminished' };
  var MODES = ['none', 'minimal', 'learn'];
  var CORNERS = ['bl', 'br', 'tr', 'tl'];

  function LoomUI(app, root) {
    var self = this;
    this.app = app; this.root = root;
    this.mode = 'minimal'; this.corner = 'bl'; this.seeking = false; this.lastLyric = null; this.lastHarmony = -1;
    this.started = false;
    this.cards = null;                                      // page/cards.js, when the build shipped any animated pictures (boot.js sets it)

    // ----- the title card, which is also the Play button the browser needs
    var splash = this.splash = el('div', 'ls-splash', null, root);
    this.splashTitle = el('h1', 'ls-title', 'Loomsong', splash);
    this.splashPiece = el('p', 'ls-piece', '', splash);
    this.splashNote = el('p', 'ls-note', 'Loading the world and its sound', splash);
    this.playBig = el('button', 'ls-big', 'Play', splash);
    this.playBig.type = 'button'; this.playBig.disabled = true;
    this.playBig.addEventListener('click', function () { self.begin(); });
    this.splashSmall = el('p', 'ls-small', 'Sound starts only when you press Play. Every light is a real note of the score.', splash);
    this.splashAi = el('p', 'ls-splash-ai', '', splash);          // says so when a generated picture moves behind the title
    this.splashAi.hidden = true;

    // ----- the corner
    var c = this.card = el('div', 'ls-ui ls-corner', null, root);
    c.setAttribute('data-corner', this.corner);
    var row = el('div', 'ls-row', null, c);
    this.btnPlay = el('button', 'ls-btn ls-play', '▶', row);
    this.btnPlay.type = 'button'; this.btnPlay.setAttribute('aria-label', 'Play or pause');
    this.btnPlay.addEventListener('click', function () { self.toggle(); });
    var tt = el('div', 'ls-tt', null, row);
    this.name = el('div', 'ls-name', '', tt);
    this.where = el('div', 'ls-where', '', tt);
    this.btnNext = el('button', 'ls-btn', 'Next piece', row);
    this.btnNext.type = 'button'; this.btnNext.addEventListener('click', function () { app.nextPiece(); });
    this.section = el('div', 'ls-section', '', c);
    var bar = el('div', 'ls-bar', null, c);
    this.range = el('input', 'ls-range', null, bar);
    this.range.type = 'range'; this.range.min = '0'; this.range.max = '1000'; this.range.value = '0'; this.range.setAttribute('aria-label', 'Position in the piece');
    this.clockText = el('span', 'ls-time', '0:00', bar);
    this.range.addEventListener('input', function () { self.seeking = true; app.seek(self.range.value / 1000 * app.D); });
    this.range.addEventListener('change', function () { self.seeking = false; });
    var keys = el('div', 'ls-row ls-keys', null, c);
    this.btnView = this._chip(keys, 'View', 'U', function () { self.cycle(); });
    this.btnCam = this._chip(keys, 'Camera: directed', 'C', function () { app.rig && app.rig.toggleFree(global.performance.now()); });
    this.btnCalm = this._chip(keys, 'Calm: off', 'K', function () { app.setCalm(!app.calm); });
    this.btnPos = this._chip(keys, 'Corner', 'P', function () { self.moveCorner(); });
    this.ai = el('div', 'ls-ai', '', c);

    // ----- learn extras
    this.compass = el('div', 'ls-ui ls-compass', null, root);
    this.compassHead = el('div', 'ls-chord', '', this.compass);
    this.compassSub = el('div', 'ls-key', '', this.compass);
    this.lyric = el('div', 'ls-lyric', null, root);
    this.lyricDe = el('div', 'ls-de', '', this.lyric);
    this.lyricEn = el('div', 'ls-en', '', this.lyric);
    this.tip = el('div', 'ls-tip', '', root);
    this.tip.setAttribute('role', 'status');

    // ----- the end card
    this.credits = el('div', 'ls-credits', null, root);
    this.credTitle = el('h2', null, '', this.credits);
    this.credBody = el('div', 'ls-credbody', '', this.credits);

    app.on('loading', function (p) { self.onLoading(p); });
    app.on('piece', function (p, m) { self.onPiece(p, m); });
    app.on('frame', function (t) { self.onFrame(t); });
    app.on('state', function () { self.syncPlay(); });
    app.on('camera', function (m) { self.btnCam.firstChild.textContent = 'Camera: ' + (m === 'free' ? 'free' : m === 'grabbed' ? 'yours' : 'directed'); });
    app.on('calm', function (on) { self.btnCalm.firstChild.textContent = 'Calm: ' + (on ? 'on' : 'off'); });
    app.clock.onend = function () { self.syncPlay(); self.showCredits(true); };
    d.addEventListener('keydown', function (e) { self.key(e); });
    root.addEventListener('dblclick', function (e) { if (!(e.target.closest && e.target.closest('.ls-ui, .ls-splash'))) self.cycle(); });
    this.setMode(this.mode);
  }

  LoomUI.prototype._chip = function (parent, label, key, fn) {
    var b = el('button', 'ls-chip', null, parent);
    b.type = 'button';
    el('span', null, label, b);
    el('kbd', null, key, b);
    b.addEventListener('click', fn);
    return b;
  };

  LoomUI.prototype.setMode = function (m) {
    this.mode = m;
    this.root.setAttribute('data-mode', m);
    this.btnView.firstChild.textContent = 'View: ' + m;
    this.app.emit('mode', m);
  };
  LoomUI.prototype.cycle = function () { this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]); };
  LoomUI.prototype.moveCorner = function () { this.corner = CORNERS[(CORNERS.indexOf(this.corner) + 1) % CORNERS.length]; this.card.setAttribute('data-corner', this.corner); this.root.setAttribute('data-corner', this.corner); };

  /** The title card on or off, and the picture behind it with it. */
  LoomUI.prototype._splash = function (show) {
    this.splash.hidden = !show;
    if (this.cards) this.cards.splash(show);
  };

  LoomUI.prototype.onLoading = function (p) {
    this._splash(true); this.playBig.disabled = true;
    this.splashPiece.textContent = p.title + ' · ' + p.by;
    this.splashNote.textContent = 'Loading the world and its sound';
    this.showCredits(false);
  };

  LoomUI.prototype.onPiece = function (p, meta) {
    this.name.textContent = p.title;
    this.splashPiece.textContent = p.title + ' · ' + p.by;
    this.splashNote.textContent = this.app.clock.mode === 'manual' ? 'Test clock: time is set by hand.' : (this.app.clock.mode === 'element' ? 'Plain audio fallback: sound may lag a few frames.' : 'Ready.');
    this.playBig.disabled = false;
    this.ai.textContent = (p.ai && p.ai.length) ? 'AI-made scenery: ' + p.ai.join('; ') : '';
    this.ai.hidden = !(p.ai && p.ai.length);
    this.lastHarmony = -1; this.lastLyric = null;
    this.lyricDe.textContent = ''; this.lyricEn.textContent = ''; this.compassHead.textContent = ''; this.compassSub.textContent = '';
    this.credTitle.textContent = p.title;
    this.credBody.textContent = '';
    (p.credits || []).forEach(function (line, i) { el('p', null, line, this.credBody); }, this);
    if (p.ai && p.ai.length) el('p', 'ls-aicred', 'AI-made in this scene: ' + p.ai.join('; ') + '.', this.credBody);
    else el('p', 'ls-aicred', 'Nothing in this scene is AI-made: the sound is synthesised in code from the score, the pictures are drawn by code.', this.credBody);
    var shared = this.app.cfg.pageAi || [];
    if (shared.length) el('p', 'ls-aicred', 'Also AI-made, around the pieces: ' + shared.join('; ') + '.', this.credBody);
    this.splashAi.textContent = shared.length ? 'AI-made: ' + shared.join('; ') + '.' : '';
    this.splashAi.hidden = !shared.length;
    if (this.started) this._splash(false);
    this.syncPlay();
  };

  /** The first press: the browser lets sound start now, and the title card goes. */
  LoomUI.prototype.begin = function () {
    var self = this;
    this.started = true;
    this.app.play().then(function () { self._splash(false); self.root.setAttribute('data-started', '1'); self.syncPlay(); }, function (e) { self.splashNote.textContent = 'Sound could not start: ' + e; });
  };

  LoomUI.prototype.toggle = function () {
    if (!this.started) { this.begin(); return; }
    var self = this;
    this.showCredits(false);
    Promise.resolve(this.app.toggle()).then(function () { self.syncPlay(); });
  };

  LoomUI.prototype.syncPlay = function () {
    var on = this.app.clock.playing;
    this.btnPlay.textContent = on ? '❚❚' : '▶';
    this.root.setAttribute('data-playing', on ? '1' : '0');
  };

  LoomUI.prototype.showCredits = function (on) {
    this.credits.setAttribute('data-show', on ? '1' : '0');
    if (this.cards) this.cards.credits(on);
  };

  LoomUI.prototype.onFrame = function (t) {
    var app = this.app, m = app.meta;
    if (!m) return;
    var w = app.where(t);
    if (w) {
      this.where.textContent = 'bar ' + w.bar + ' · beat ' + Math.floor(w.beat + 1e-6);
      this.section.textContent = w.pass ? w.pass.id + (w.pass.rep > 1 ? ' (again)' : '') + ' — ' + w.pass.label : '';
    }
    if (!this.seeking) this.range.value = String(Math.round(t / app.D * 1000));
    this.clockText.textContent = fmt(t) + ' / ' + fmt(app.D);
    if (this.mode === 'learn') this.learn(t, m);
    if (app.clock.ended) this.showCredits(true);
  };

  LoomUI.prototype.learn = function (t, m) {
    // the chord now: the last harmony entry that started at or before t
    var H = m.harmony, lo = 0, hi = H.length - 1, k = 0;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (H[mid][0] <= t + 1e-6) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    if (k !== this.lastHarmony && H.length) {
      this.lastHarmony = k;
      var h = H[k];
      this.compassHead.textContent = PC[h[4] % 12] + ' ' + (QUAL[h[5]] || h[5]) + '  ·  ' + h[3];
      this.compassSub.textContent = 'key ' + h[2] + ' · tension ' + h[6].toFixed(2);
    }
    if (m.lyrics && m.lyrics.length) {
      var L = null;
      for (var i = 0; i < m.lyrics.length; i++) if (t >= m.lyrics[i].t0 && t < m.lyrics[i].t1) L = m.lyrics[i];
      if (L !== this.lastLyric) {
        this.lastLyric = L;
        this.lyricDe.textContent = L ? L.de : ''; this.lyricEn.textContent = L ? L.en : '';
      }
    }
  };

  /** The card for a note: what the pointer rests on. n is an index into meta.notes; where names what was touched ("thread", "hole", "pin", "tile"). */
  LoomUI.prototype.noteInfo = function (n, what, extra) {
    var m = this.app.meta;
    if (!m || n == null || !m.notes[n]) return null;
    // bar and beat are the score card's own record of the note (columns 5 and 6 of its row), not a sum redone from its seconds: the table keeps four decimals, and a note that sits on a bar line
    // (the Ode's choir has one at 280 quarters) could be put on the bar before it with beat 5 by a rounding. The transport's bar and beat (where()) are still worked out from the clock.
    var r = m.notes[n], inst = m.inst[r[0]], bar = r[5], beat = r[6];
    return {
      what: what, line1: pitchName(r[1]) + ' · ' + inst,
      line2: 'bar ' + bar + ' · beat ' + (Math.round(beat * 100) / 100) + ' · ' + (r[7] === 0 ? 'composer' : 'arrangement') + ' · velocity ' + r[2],
      line3: m.ids[n] + (extra ? ' · ' + extra : '')
    };
  };

  /** The page's hover hook: called with an info object (or null) and the pointer position. Shown in Learn mode only. */
  LoomUI.prototype.hover = function (info, x, y) {
    if (!info || this.mode !== 'learn') { this.tip.setAttribute('data-show', '0'); return; }
    this.tip.textContent = '';
    el('div', 'ls-tip-what', info.what, this.tip);
    el('div', 'ls-tip-1', info.line1, this.tip);
    if (info.line2) el('div', 'ls-tip-2', info.line2, this.tip);
    if (info.line3) el('div', 'ls-tip-3', info.line3, this.tip);
    this.tip.style.left = Math.min(x + 16, global.innerWidth - 260) + 'px';
    this.tip.style.top = Math.min(y + 16, global.innerHeight - 100) + 'px';
    this.tip.setAttribute('data-show', '1');
  };

  LoomUI.prototype.key = function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var app = this.app, k = e.key;
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); this.toggle(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); app.seekBar(-1); }
    else if (k === 'ArrowRight') { e.preventDefault(); app.seekBar(+1); }
    else if (k === '1' || k === '2') { var p = app.pieces[Number(k) - 1]; if (p && (!app.piece || p.id !== app.piece.id)) app.openPiece(p.id, this.started && (app.clock.playing || app.clock.ended)); }
    else if (k === 'u' || k === 'U') this.cycle();
    else if (k === 'c' || k === 'C') app.rig && app.rig.toggleFree(global.performance.now());
    else if (k === 'k' || k === 'K') app.setCalm(!app.calm);
    else if (k === 'p' || k === 'P') this.moveCorner();
  };

  global.LoomUI = LoomUI;
})(window);
