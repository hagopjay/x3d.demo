// A dancer's sense of the beat. Not the beat clock: an oscillator that hears
// the music late (reaction latency), predicts it, corrects gently, carries a
// personal micro-timing (laid back or on top), and is weakly coupled to the
// partner (Kuramoto) — the "resonance" between two people dancing together.
import { wrapHalf, rng } from "./math.js";

export class BeatMind {
  constructor(genome, seed = 1) {
    this.g = genome;
    this.r = rng(seed);
    this.phase = 0;        // beats since start (float); integer part = beat count
    this.period = 0.5;     // seconds per beat
    this.confidence = 0;   // 0 lost … 1 locked
    this.err = 0.5;        // smoothed |phase error| in beats
    this.jitter = 0;       // this beat's human timing offset (beats)
    this._lastBeatInt = 0;
    this.locked = false;
  }

  /** Advance by dt seconds. obs = listener features; partner = other BeatMind or null. */
  update(dt, t, obs, partner = null) {
    const g = this.g;
    this.phase += dt / this.period;
    if (obs && obs.period > 0.25 && obs.period < 1.2 && obs.confidence > 0.2) {
      // what this dancer believes the music's phase is, heard `latency` late but
      // predicted forward (pros anticipate), plus their personal pocket
      const heardAt = t - g.latency;
      const musicPhase = (heardAt - obs.lastBeat) / obs.period + g.latency / obs.period;
      const pocket = g.laidBack / obs.period; // + = behind the beat
      const e = wrapHalf(musicPhase - pocket - this.phase);
      this.err += (Math.abs(e) - this.err) * Math.min(1, dt * 2);
      this.phase += e * Math.min(1, dt * g.lockGain);
      this.period += (obs.period - this.period) * Math.min(1, dt * g.lockGain * 0.5);
      // octave slips: if the music period halves/doubles, re-find it
      if (Math.abs(obs.period / this.period - 1) > 0.2) { this.period = obs.period; this.confidence *= 0.3; }
    } else {
      this.err += (0.5 - this.err) * Math.min(1, dt * 0.3);
    }
    if (partner) { // resonance: pull gently toward the partner's phase
      const d = wrapHalf(partner.phase - this.phase);
      this.phase += g.coupling * Math.sin(2 * Math.PI * d) / (2 * Math.PI) * dt;
    }
    const target = Math.max(0, 1 - this.err * 6) * (obs ? Math.min(1, obs.confidence * 1.4) : 0);
    this.confidence += (target - this.confidence) * Math.min(1, dt * 1.5);
    this.locked = this.confidence > 0.55;
    const bi = Math.floor(this.phase);
    if (bi !== this._lastBeatInt) { // new beat: draw this beat's human timing slip
      this._lastBeatInt = bi;
      this.jitter = (this.r.normal() * g.jitterMs) / 1000 / this.period;
    }
  }

  /** The phase the body actually moves to (belief + this beat's slip). */
  get bodyPhase() { return this.phase + this.jitter; }

  /** Shock: a section change or a track change makes everyone re-listen. */
  startle(k = 0.5) { this.confidence *= k; this.err = Math.max(this.err, 0.15); }
}
