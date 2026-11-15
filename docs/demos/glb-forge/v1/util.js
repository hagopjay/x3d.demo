// Small helpers shared by the page's modules.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => (n == null || Number.isNaN(n) ? 'n/a' : Math.round(n).toLocaleString('en-US'));
export const kib = (n, d) => (n == null ? 'n/a' : (n / 1024).toLocaleString('en-US', { minimumFractionDigits: d ?? (n < 10240 ? 2 : 1), maximumFractionDigits: d ?? (n < 10240 ? 2 : 1) }) + ' KiB');
export const mib = (n) => (n / 1048576).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MiB';
export const pct = (a, b, d = 1) => (b ? ((a / b) * 100).toFixed(d) + '%' : 'n/a');
export const delta = (a, b) => (a ? (((b - a) / a) * 100) : 0);
export const sign = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
export const sci = (v) => (v == null ? 'n/a' : v === 0 ? '0' : v.toExponential(2));
export const short = (h) => (h ? h.slice(0, 8) + '…' + h.slice(-6) : 'n/a');
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function el(tag, cls, html, attrs) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export async function sha256hex(buf) {
  if (!(globalThis.crypto && crypto.subtle)) return null;
  const d = await crypto.subtle.digest('SHA-256', buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// gzip length with the browser's CompressionStream (default level; the receipts use zlib level 9, so the two differ a little and the page says so)
export async function gzipLength(buf) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip')));
  return (await cs.arrayBuffer()).byteLength;
}

export function adapterName() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { name: null, software: false };
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    const name = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'adapter name hidden by the browser';
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return { name, software: /swiftshader|llvmpipe|software|basic render|softpipe/i.test(name) };
  } catch { return { name: null, software: false }; }
}

// fetch with progress; `total` is the expected size when the server sends no usable content-length
export async function fetchBytes(url, onProgress, total) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const len = total || +r.headers.get('content-length') || 0;
  if (!r.body || !r.body.getReader) { const b = await r.arrayBuffer(); onProgress && onProgress(b.byteLength, b.byteLength); return b; }
  const rd = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onProgress && onProgress(got, len); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

// the colour of a "percent of original" cell: teal below 100, coral above
export function heat(p) {
  if (p == null) return 'transparent';
  if (p <= 100) { const t = Math.min(1, (100 - p) / 90); return `rgba(55,213,194,${(0.08 + 0.36 * t).toFixed(3)})`; }
  const t = Math.min(1, (p - 100) / 40); return `rgba(255,122,92,${(0.14 + 0.34 * t).toFixed(3)})`;
}
