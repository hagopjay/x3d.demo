// Module worker: the lane's optimiser and gates (forge.bundle.js, built from x3d.gltf web/forge.mjs) run here, off the page's main thread.
// Messages in:  {type:'forge', id, profile, bytes: ArrayBuffer}   {type:'inspect', id, bytes}
// Messages out: {type:'ready', profiles}  {type:'step', id, rec}  {type:'done', id, report, bytes (transferred), ms}  {type:'inspected', id, result}  {type:'error', id, message}
import { PROFILES, PROFILE_IDS, forge, inspectBytes } from './forge.bundle.js';

const meta = {};
for (const id of PROFILE_IDS) { const p = PROFILES[id]; meta[id] = { summary: p.summary, identity: p.identity, geometry: p.geometry, writes: p.writes, trap: !!p.trap }; }
self.postMessage({ type: 'ready', profiles: meta, ids: PROFILE_IDS });

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'forge') {
      const t0 = performance.now();
      const r = await forge(new Uint8Array(m.bytes), m.profile, { onStep: (rec) => self.postMessage({ type: 'step', id: m.id, rec }) });
      const ms = Math.round(performance.now() - t0);
      const out = r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength);
      self.postMessage({ type: 'done', id: m.id, report: r.report, bytes: out, ms }, [out]);
    } else if (m.type === 'inspect') {
      self.postMessage({ type: 'inspected', id: m.id, result: await inspectBytes(new Uint8Array(m.bytes)) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
