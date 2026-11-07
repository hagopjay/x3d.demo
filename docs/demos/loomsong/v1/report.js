/* Loomsong report: what this browser did, written to the artifact's own store so the build can read it back.
 *
 * Only where the host gives the page its `db` capability (the host's runtime object, whose name the build config holds, answers `use('db')`; see boot.js). Anywhere else (the witnesses, a plain server) nothing is probed,
 * nothing is written and the page does not know it is here.
 * One document a page load, reports/<id>:
 *   env         the browser, the graphics renderer, the screen
 *   policy      what the host lets the page do: WebAssembly compile, a blob worker
 *   pieces      seconds from asking for a world to having it, and the clock's mode (webaudio = the .mp4 master decoded; element = it did not) with its latencies
 *   play        frame times while a piece plays: median and 1 % low in frames a second, frames over 33 and 50 ms. The Fps witness on a real graphics card
 *   cards       where the build shipped animated cards: for each, whether its video loaded, plays, or failed (the media error code); shows whether the host plays video at all
 *   violations  what the host's content policy refused;  pageErrors, errors  what the page threw
 *   log         the first 60 things that happened, with seconds since the page opened
 * No names, no addresses, no pointer or key data. Writes go one at a time, on a real change (a piece ready, play, pause, end, the page hidden) and once a minute while playing.
 * Plain script. Exposes window.LoomReport.
 */
(function (global) {
  'use strict';

  var BUCKET = 0.25, NB = 400;          // frame times in quarter-millisecond buckets up to 100 ms; a slower frame lands in the last bucket

  function round(v, d) { var k = Math.pow(10, d); return Math.round(v * k) / k; }
  function str(v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n); }
  function now() { return global.performance.now(); }

  /** Frame times for one piece in a fixed histogram: a long session costs no memory, and a percentile is exact to a quarter millisecond. */
  function FrameStats() { this.h = new Uint32Array(NB + 1); this.n = 0; this.sum = 0; this.over33 = 0; this.over50 = 0; this.max = 0; }
  FrameStats.prototype.add = function (dt) {
    this.h[Math.min(NB, Math.floor(dt / BUCKET))]++;
    this.n++; this.sum += dt;
    if (dt > 33.4) this.over33++;
    if (dt > 50) this.over50++;
    if (dt > this.max) this.max = dt;
  };
  /** The frame time in ms that a share p of the frames took at most: the upper edge of the bucket that holds the ceil(p n)-th frame, so it never flatters. */
  FrameStats.prototype.pct = function (p) {
    var need = Math.max(1, Math.ceil(p * this.n)), c = 0, i;
    for (i = 0; i <= NB; i++) { c += this.h[i]; if (c >= need) return (i + 1) * BUCKET; }
    return (NB + 1) * BUCKET;
  };
  FrameStats.prototype.summary = function () {
    return { frames: this.n, seconds: round(this.sum / 1000, 1), medianFps: round(1000 / this.pct(0.5), 1), low1Fps: round(1000 / this.pct(0.99), 1), over33ms: this.over33, over50ms: this.over50, maxMs: round(this.max, 1) };
  };

  function glInfo() {
    try {
      var c = global.document.createElement('canvas'), gl = c.getContext('webgl2'), v2 = !!gl;
      if (!gl) gl = c.getContext('webgl');
      if (!gl) return { webgl: false };
      var x = gl.getExtension('WEBGL_debug_renderer_info'), out = {
        webgl2: v2, renderer: str(x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), 200), vendor: str(x ? gl.getParameter(x.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), 100),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE)
      };
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return out;
    } catch (e) { return { error: str(e, 100) }; }
  }

  function envInfo() {
    var n = global.navigator, s = global.screen || {};
    return {
      userAgent: str(n.userAgent, 300), platform: str(n.platform, 40), language: str(n.language, 20), cores: n.hardwareConcurrency || null, memoryGB: n.deviceMemory || null,
      screen: [s.width || 0, s.height || 0], dpr: global.devicePixelRatio || 1, viewport: [global.innerWidth, global.innerHeight],
      reducedMotion: !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches), gl: glInfo()
    };
  }

  /** Two things the page might want and the host might refuse. Resolves with the answers; a worker that never answers is recorded as such after two seconds. */
  function probePolicy() {
    var out = {};
    try { new global.WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); out.wasm = 'ok'; } catch (e) { out.wasm = str(e.name + ': ' + e.message, 160); }
    return new Promise(function (resolve) {
      var done = false, url = null, w = null;
      function end(v) {
        if (done) return;
        done = true; out.blobWorker = v;
        try { if (w) w.terminate(); if (url) global.URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
        resolve(out);
      }
      try {
        url = global.URL.createObjectURL(new global.Blob(['postMessage(1)'], { type: 'text/javascript' }));
        w = new global.Worker(url);
        w.onmessage = function () { end('ok'); };
        w.onerror = function (e) { end('error: ' + str(e && e.message, 120)); };
        global.setTimeout(function () { end('no answer in 2 s'); }, 2000);
      } catch (e) { end(str(e.name + ': ' + e.message, 160)); }
    });
  }

  /** app: the LoomApp. getDb: returns the db namespace, or a promise of it, or null when there is no store here (on the host it answers the runtime object's use('db')). */
  function Report(app, getDb) {
    var self = this;
    this.app = app;
    this.id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.t0 = now();
    this.doc = { id: this.id, version: 1, startedAt: new Date().toISOString(), pieces: {}, play: {}, violations: [], pageErrors: [], errors: [], log: [] };
    this.stats = {}; this.loading = {};
    this.lastPerf = 0; this.wasPlaying = false; this.wasEnded = false;
    this.busy = false; this.dirty = false; this.holdUntil = 0; this.timer = 0; this.writes = 0; this.retry = 0;
    this.db = undefined;                 // undefined: not known yet; null: no store here, so the report is off; otherwise the namespace
    this.ready = Promise.resolve().then(getDb).then(function (db) {
      self.db = db || null;
      if (!self.db) return false;
      self.doc.env = envInfo();
      return probePolicy().then(function (p) { self.doc.policy = p; self.log('policy probed'); return true; });
    }).catch(function () { self.db = null; return false; });

    app.on('loading', function (p) { self.lastPerf = 0; self.loading[p.id] = now(); self.log('asked for ' + p.id); });
    app.on('piece', function (p) {
      var t = self.loading[p.id], info = null;
      try { info = JSON.parse(JSON.stringify(app.clock.info(), function (k, v) { return v instanceof Error ? str(v, 160) : v; })); } catch (e) { info = null; }
      self.lastPerf = 0;
      self.doc.pieces[p.id] = { loadSeconds: t ? round((now() - t) / 1000, 2) : null, clock: info };
      self.log(p.id + ' ready');
      self.flush();
    });
    app.on('frame', function (t, perf) { self.frame(perf); });
    global.document.addEventListener('securitypolicyviolation', function (e) {
      if (self.doc.violations.length < 20) self.doc.violations.push({ directive: str(e.violatedDirective, 60), blocked: str(e.blockedURI, 120), sample: str(e.sample, 60) });
      self.log('policy refused ' + str(e.violatedDirective, 40));
      self.dirty = true;
    });
    global.addEventListener('error', function (e) { if (self.doc.pageErrors.length < 20) self.doc.pageErrors.push(str(e.message, 160) + (e.filename ? ' @' + str(String(e.filename).split('/').pop(), 40) + ':' + (e.lineno || 0) : '')); self.dirty = true; });
    global.addEventListener('unhandledrejection', function (e) { if (self.doc.pageErrors.length < 20) self.doc.pageErrors.push('rejected: ' + str(e.reason && (e.reason.message || e.reason), 160)); self.dirty = true; });
    global.document.addEventListener('visibilitychange', function () { if (global.document.hidden) self.flush(); });
    global.addEventListener('pagehide', function () { self.flush(); });
  }

  Report.prototype.log = function (what) {
    if (this.db !== null && this.doc.log.length < 60) this.doc.log.push([round((now() - this.t0) / 1000, 1), what]);
  };

  /** Called every frame. Notes play, pause and end the frame they happen (the driver's own play and pause do not announce them), then times the frame if a piece is playing in view. */
  Report.prototype.frame = function (perf) {
    if (this.db === null) return;
    var app = this.app, c = app.clock, playing = !!c.playing, ended = !!c.ended, id = app.piece ? app.piece.id : '', self = this;
    if (playing !== this.wasPlaying || ended !== this.wasEnded) {
      this.wasPlaying = playing; this.wasEnded = ended; this.lastPerf = 0;
      this.log((ended ? 'ended ' : playing ? 'play ' : 'pause ') + id);
      if (playing && !this.timer) this.timer = global.setInterval(function () {
        if (!app.clock.playing) { global.clearInterval(self.timer); self.timer = 0; return; }
        self.flush();
      }, 60000);
      this.flush();
    }
    if (!playing || global.document.hidden || !id) { this.lastPerf = 0; return; }
    var dt = this.lastPerf ? perf - this.lastPerf : 0;
    this.lastPerf = perf;
    if (dt <= 0 || dt > 1000) return;       // the first frame, or a gap (a hidden tab, a stall to load) that was not a frame
    (this.stats[id] || (this.stats[id] = new FrameStats())).add(dt);
  };

  Report.prototype.snapshot = function () {
    var d = this.doc, self = this;
    Object.keys(this.stats).forEach(function (id) { if (self.stats[id].n) d.play[id] = self.stats[id].summary(); });
    d.errors = this.app.errors.slice(0, 20).map(function (e) { return str(e, 160); });
    try { var f = this.app.browser && this.app.browser.currentFrameRate; if (typeof f === 'number' && isFinite(f)) d.xiteFps = round(f, 1); } catch (e) { /* no such reading */ }
    try { if (this.app.cards && this.app.cards.on) d.cards = this.app.cards.status(); } catch (e) { /* no cards */ }       // whether the host plays the cards' video: ready state, playing, error code
    d.updatedAt = new Date().toISOString();
    d.pageSeconds = round((now() - this.t0) / 1000, 1);
    return d;
  };

  /** Write the document, one write at a time. A write asked for while one is in flight, or too soon after the last, is made once, later. A refused write waits half a minute. Never throws. */
  Report.prototype.flush = function () {
    var self = this;
    if (this.db === null) return Promise.resolve(false);
    if (this.busy) { this.dirty = true; return Promise.resolve(false); }
    this.busy = true; this.dirty = false;
    return this.ready.then(function (on) {
      if (!on) return false;
      var wait = self.holdUntil - now();
      if (wait > 0) { self.dirty = true; return false; }
      var doc = JSON.parse(JSON.stringify(self.snapshot()));
      return self.db.doc('reports/' + self.id).set(doc).then(function () { self.writes++; self.holdUntil = now() + 2000; delete self.doc.writeError; return true; });
    }).catch(function (e) {
      self.doc.writeError = str(e && (e.code || e.message) || e, 100);
      self.holdUntil = now() + 30000; self.dirty = true;
      return false;
    }).then(function (ok) {
      self.busy = false;
      if (self.dirty && self.db && !self.retry) {
        self.retry = global.setTimeout(function () { self.retry = 0; self.flush(); }, Math.max(1000, self.holdUntil - now()));
      }
      return ok;
    });
  };

  Report.FrameStats = FrameStats;
  global.LoomReport = Report;
})(window);
