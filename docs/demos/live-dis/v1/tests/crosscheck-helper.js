// crosscheck-helper.js: the JavaScript half of the cross-checks against other DIS implementations.
// Reads JSON on stdin and writes JSON on stdout.
//   node crosscheck-helper.js decode   input: { cases: [{ hex }] }      output: { cases: [{ fields }] }
//   node crosscheck-helper.js encode   input: { cases: [{ fields }] }   output: { cases: [{ hex }] }
// `fields` is a flat object: dotted names to numbers, strings, or arrays of numbers.
import { decodePdu, encodePdu } from '../src/dis-codec.js';

export const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
export const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function flatten(pdu) {
  const out = {};
  const walk = (prefix, v) => {
    if (typeof v === 'bigint') { out[prefix] = v.toString(); return; }
    if (v instanceof Uint8Array) { out[prefix] = Array.from(v); return; }
    if (Array.isArray(v)) {
      if (prefix === 'variableParameters') v.forEach((x, i) => walk(`${prefix}.${i}`, x));
      else if (v.every((x) => typeof x === 'number')) out[prefix] = v;
      else v.forEach((x, i) => walk(`${prefix}.${i}`, x));
      return;
    }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) if (k !== 'raw' && k !== 'frequency' && k !== 'padding') walk(prefix ? `${prefix}.${k}` : k, v[k]); return; }
    out[prefix] = v;
  };
  walk('', pdu);
  if (pdu.variableParameters) out['variableParameters.count'] = pdu.variableParameters.length;
  return out;
}

export function unflatten(fields) {
  const root = {};
  for (const [name, value] of Object.entries(fields)) {
    if (name === 'variableParameters.count') continue;
    const parts = name.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i], nextIsIndex = /^\d+$/.test(parts[i + 1]);
      if (node[key] === undefined) node[key] = nextIsIndex ? [] : {};
      node = node[key];
    }
    node[parts[parts.length - 1]] = value;
  }
  // octet arrays and the 64-bit frequency go back to their binary types
  const fix = (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (['otherParameters', 'data', 'modulationParameters', 'antennaPattern', 'variableTransmitterParameters'].includes(k) && Array.isArray(v)) o[k] = Uint8Array.from(v);
      else if (k === 'frequencyBig') o[k] = BigInt(v);
      else if (v && typeof v === 'object' && !(v instanceof Uint8Array)) fix(v);
    }
  };
  fix(root);
  if (fields['variableParameters.count'] === 0) root.variableParameters = [];
  return root;
}

async function main() {
  const mode = process.argv[2];
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const input = JSON.parse(text);
  const cases = input.cases.map((c) => {
    try {
      if (mode === 'decode') return { fields: flatten(decodePdu(hexToBytes(c.hex))) };
      if (mode === 'encode') return { hex: bytesToHex(encodePdu(unflatten(c.fields))) };
      throw new Error('mode must be decode or encode');
    } catch (e) { return { error: String(e.message ?? e) }; }
  });
  process.stdout.write(JSON.stringify({ cases }));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
