// dis-signal.js: audio helpers for Signal PDUs. No dependencies.
// Encoded audio of type 1 in a Signal PDU is 8-bit mu-law (ITU-T G.711), one octet per sample.

const BIAS = 0x84, CLIP = 32635;

// 16-bit linear sample to one mu-law octet.
export function muLawEncode(sample) {
  let s = Math.max(-CLIP, Math.min(CLIP, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

// One mu-law octet to a 16-bit linear sample.
export function muLawDecode(octet) {
  const u = ~octet & 0xff;
  const sign = u & 0x80, exponent = (u >> 4) & 7, mantissa = u & 0x0f;
  const s = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -s : s;
}

const MORSE = { D: '-..', I: '..', S: '...', X: '-..-', 3: '...--', ' ': ' ' };

// On and off times of a Morse message, as a list of [startSeconds, endSeconds] of tone, with the given dot length.
export function morseKeying(text, unit = 0.08) {
  const on = []; let t = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') { t += 4 * unit; continue; }
    for (const sym of MORSE[ch] ?? '') { const len = sym === '-' ? 3 * unit : unit; on.push([t, t + len]); t += len + unit; }
    t += 2 * unit;
  }
  return { on, duration: t };
}

// One frame of a keyed sine tone as mu-law octets. `t0` is the time of the first sample within the message.
export function toneFrame(keying, t0, samples, sampleRate = 8000, frequency = 700, amplitude = 12000) {
  const out = new Uint8Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = t0 + i / sampleRate;
    let gain = 0;
    for (const [a, b] of keying.on) {
      if (t >= a && t < b) { gain = Math.min(1, (t - a) / 0.005, (b - t) / 0.005); break; } // 5 ms ramps, no clicks
    }
    out[i] = muLawEncode(gain * amplitude * Math.sin(2 * Math.PI * frequency * t));
  }
  return out;
}
