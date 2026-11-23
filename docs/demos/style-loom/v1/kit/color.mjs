// Colour maths for the X3D style kit. No dependencies; runs in Node and in the browser.
// sRGB (IEC 61966-2-1) <-> linear <-> OKLab (Ottosson 2020), WCAG 2.x contrast,
// colour-vision-deficiency simulation (Machado, Oliveira, Fernandes 2009, severity 1.0).

export const clamp01 = v => Math.min(1, Math.max(0, v));
const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255);
}
export function rgbToHex(rgb) {
  return '#' + rgb.map(c => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('');
}
export const rgbToLinear = rgb => rgb.map(toLin);
export const linearToRgb = lin => lin.map(c => clamp01(toSrgb(Math.max(0, c))));

export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
export function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
export const hexToOklab = hex => linearToOklab(rgbToLinear(hexToRgb(hex)));
export const oklabToHex = lab => rgbToHex(linearToRgb(oklabToLinear(lab)));
export function hexToOklch(hex) {
  const [L, a, b] = hexToOklab(hex);
  return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}
export function oklchToHex([L, C, h]) {
  const r = h * Math.PI / 180;
  return oklabToHex([L, C * Math.cos(r), C * Math.sin(r)]);
}

/** Mix two hex colours in OKLab. t = 0 gives a, t = 1 gives b. */
export function mix(a, b, t) {
  const A = hexToOklab(a), B = hexToOklab(b);
  return oklabToHex(A.map((v, i) => v + (B[i] - v) * t));
}
/** Sample a ramp of hex stops at t in 0..1, interpolating in OKLab. */
export function ramp(stops, t) {
  if (stops.length === 1) return stops[0];
  const x = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}
/** Lighten (amount > 0) or darken (amount < 0) by shifting OKLab lightness. */
export function tone(hex, amount) {
  const [L, a, b] = hexToOklab(hex);
  return oklabToHex([clamp01(L + amount), a, b]);
}
/** Multiply a colour's linear light by k (shade). */
export function shade(hex, k) {
  return rgbToHex(linearToRgb(rgbToLinear(hexToRgb(hex)).map(c => c * k)));
}
/** Flip OKLab lightness, keeping hue and chroma: the day/night operator. */
export function invertLightness(hex) {
  const [L, C, h] = hexToOklch(hex);
  return oklchToHex([clamp01(1 - L), C, h]);
}
export const lightness = hex => hexToOklab(hex)[0];
export const chroma = hex => hexToOklch(hex)[1];

/** Euclidean distance in OKLab (Delta E OK). 0.02 is about one just-noticeable difference. */
export function deltaE(a, b) {
  const A = hexToOklab(a), B = hexToOklab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
export function luminance(hex) {
  const [r, g, b] = rgbToLinear(hexToRgb(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
/** Simulate a dichromat's view of a hex colour (matrices applied in linear RGB). */
export function simulate(hex, kind) {
  const m = CVD[kind];
  const lin = rgbToLinear(hexToRgb(hex));
  return rgbToHex(linearToRgb(m.map(r => r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2])));
}
/** Smallest pairwise Delta E OK in a list, for normal vision or a simulated deficiency. */
export function minPairDeltaE(list, kind) {
  const c = kind ? list.map(h => simulate(h, kind)) : list;
  let best = Infinity, pair = null;
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
    const d = deltaE(c[i], c[j]);
    if (d < best) { best = d; pair = [list[i], list[j]]; }
  }
  return { min: best, pair };
}
/** X3D SFColor text for a hex colour (sRGB components, 3 decimals). */
export const sf = hex => hexToRgb(hex).map(c => +c.toFixed(3)).join(' ');
