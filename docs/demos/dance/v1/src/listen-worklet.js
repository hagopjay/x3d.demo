// AudioWorklet: runs the Listener on the audio thread and posts features,
// fresh onsets and section events to the page about 30 times a second.
import { Listener } from "./dsp.js";

class ListenProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = new Listener(sampleRate);
    this.mono = new Float32Array(128);
    this.sentOnsets = 0; this.n = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    if (inp && inp.length) {
      const ch = inp.length;
      for (let i = 0; i < 128; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) s += inp[c][i] ?? 0;
        this.mono[i] = s / ch;
      }
      this.L.feed(this.mono, currentTime);
      // pass audio through so the worklet can sit in the chain
      const out = outputs[0];
      for (let c = 0; c < out.length; c++) out[c].set(inp[c] ?? inp[0]);
    }
    if (++this.n % 12 === 0) {
      const ons = this.L.onsets.slice(this.sentOnsets > this.L.onsets.length ? 0 : this.sentOnsets);
      this.sentOnsets = this.L.onsets.length;
      this.port.postMessage({ f: this.L.features(), onsets: ons, events: this.L.events.splice(0) });
    }
    return true;
  }
}
registerProcessor("x3d-dance-listen", ListenProcessor);
