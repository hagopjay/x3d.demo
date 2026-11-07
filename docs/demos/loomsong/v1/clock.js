/* Loomsong master clock.
 *
 * The page owns time (X_ITE has no browser.currentTime). The master is decoded once into a Web Audio buffer and played from it, so the clock is sample-accurate:
 *     heard context time = getOutputTimestamp().contextTime + (now - performanceTime), mapped to screen time;  t = heard - start + trim.
 * Where Web Audio cannot decode the file, an <audio> element plays it and the time is interpolated between its updates (a phone's fallback).
 * Manual mode (?clock=manual) belongs to the witnesses: time is set by hand, so a whole piece can be stepped through without waiting for it.
 *
 * Plain script, no modules, no eval. Exposes window.LoomClock.
 */
(function (global) {
  'use strict';

  function LoomClock() {
    this.D = 0;                 // seconds in the piece (the scene's length, read from its SecondsBus)
    this.mode = 'none';         // 'webaudio' | 'element' | 'manual' | 'none'
    this.playing = false;
    this.ended = false;
    this.offset = 0;            // piece seconds at the last start, seek or pause
    this.trim = 0;              // seconds added to every reading: a device's measured latency error, if any
    this.ctx = null; this.buf = null; this.src = null; this.gain = null; this.startCtx = 0;
    this.el = null; this.elMedia = 0; this.elPerf = 0;
    this.manualT = 0;
    this.onend = null;
    this.lastError = null;
  }

  LoomClock.prototype.useManual = function (D) { this.mode = 'manual'; this.D = D; this.offset = 0; this.manualT = 0; this.ended = false; this.playing = false; };

  LoomClock.prototype._context = function () {
    if (!this.ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  };

  /** Fetch and decode the master. D is the scene's length: the clock ends there. Resolves to the mode used. */
  LoomClock.prototype.load = async function (url, D) {
    this.stop();
    this.D = D; this.offset = 0; this.ended = false; this.buf = null; this.el = null; this.mode = 'none';
    var ctx = this._context();
    if (ctx) {
      try {
        var res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
        this.buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.mode = 'webaudio';
        return this.mode;
      } catch (e) { this.lastError = String(e); }
    }
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.src = url;
    this.mode = 'element';
    return this.mode;
  };

  LoomClock.prototype._ctxHeard = function () {
    var ctx = this.ctx, ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (global.performance.now() - ts.performanceTime) / 1000;
    return ctx.currentTime - (ctx.outputLatency || 0);
  };

  /** The position in the piece, in seconds, as it is being heard now. */
  LoomClock.prototype.now = function () {
    var t;
    if (this.mode === 'manual') t = this.manualT;
    else if (!this.playing) t = this.offset;
    else if (this.mode === 'webaudio') t = Math.max(this.offset, this._ctxHeard() - this.startCtx);
    else if (this.mode === 'element' && this.el) {
      var m = this.el.currentTime, p = global.performance.now();
      if (m !== this.elMedia) { this.elMedia = m; this.elPerf = p; }
      t = this.elMedia + Math.min((p - this.elPerf) / 1000, 0.25);
    } else t = this.offset;
    t += this.trim;
    if (this.playing && this.D > 0 && t >= this.D) { this._finish(); t = this.D; }
    return Math.max(0, Math.min(this.D || t, t));
  };

  LoomClock.prototype._finish = function () {
    if (this.mode !== 'manual') this._silence();
    this.playing = false; this.ended = true; this.offset = this.D;
    if (this.onend) this.onend();
  };

  LoomClock.prototype._silence = function () {
    if (this.src) { try { this.src.onended = null; this.src.stop(); } catch (e) { /* already stopped */ } try { this.src.disconnect(); } catch (e) { /* ok */ } this.src = null; }
    if (this.el) this.el.pause();
  };

  /** Start or resume at the current offset. Must be called from a user gesture the first time (autoplay policy). */
  LoomClock.prototype.play = async function () {
    if (this.playing) return;
    if (this.ended || this.offset >= this.D - 0.05) { this.offset = 0; this.ended = false; }
    if (this.mode === 'manual') { this.playing = true; return; }
    if (this.mode === 'webaudio') {
      var ctx = this.ctx;
      if (ctx.state !== 'running') await ctx.resume();
      var src = ctx.createBufferSource();
      src.buffer = this.buf; src.connect(this.gain);
      var when = ctx.currentTime + 0.04;
      this.startCtx = when - this.offset;
      src.start(when, this.offset);
      this.src = src; this.playing = true;
    } else if (this.mode === 'element') {
      this.el.currentTime = this.offset; this.elMedia = this.offset; this.elPerf = global.performance.now();
      await this.el.play();
      this.playing = true;
    }
  };

  LoomClock.prototype.pause = function () {
    if (!this.playing) return;
    var t = this.now();
    this._silence();
    this.playing = false; this.offset = t;
  };

  LoomClock.prototype.toggle = function () { return this.playing ? this.pause() : this.play(); };

  /** Jump to t (seconds). Keeps playing if it was playing. */
  LoomClock.prototype.seek = async function (t) {
    t = Math.max(0, Math.min(this.D, t));
    var was = this.playing;
    if (was && this.mode !== 'manual') { this._silence(); this.playing = false; }
    this.offset = t; this.manualT = t; this.ended = false;
    if (was) { if (this.mode === 'manual') this.playing = true; else await this.play(); }
  };

  LoomClock.prototype.stop = function () { this._silence(); this.playing = false; this.offset = 0; this.manualT = 0; this.ended = false; };

  /** Manual mode: set the time by hand (witnesses only). */
  LoomClock.prototype.setTime = function (t) { this.manualT = t; this.offset = t; };

  LoomClock.prototype.setVolume = function (v) { if (this.gain) this.gain.gain.value = v; if (this.el) this.el.volume = v; };

  /** What the Sync witness and the host self-test read: the mode and the latencies the browser reports. */
  LoomClock.prototype.info = function () {
    var c = this.ctx;
    return { mode: this.mode, state: c ? c.state : null, sampleRate: c ? c.sampleRate : null, baseLatency: c ? c.baseLatency : null, outputLatency: c ? (c.outputLatency || 0) : null, bufferSeconds: this.buf ? this.buf.duration : null, trim: this.trim, lastError: this.lastError };
  };

  global.LoomClock = LoomClock;
})(window);
