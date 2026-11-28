// The minimal X3D (XML encoding) reader shared by the simulation and the renderer. No DOM is needed,
// so Node runs the identical loader for tests. Adapted from KANSEI's engine/x3d.js
// (hagopjay/platformer, kansei/v1, MIT), which adapted it from NIB's.

const ENT = { '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const decode = s => s.replace(/&(quot|apos|lt|gt|amp);/g, m => ENT[m]);
const WS = c => c === ' ' || c === '\n' || c === '\t' || c === '\r';

/** Minimal XML reader for X3D's XML encoding: elements, attributes, comments, CDATA, PI, DOCTYPE. */
export function parseXML(text) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); if (e < 0) throw new Error('XML: unclosed comment'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); if (e < 0) throw new Error('XML: unclosed CDATA'); i = e + 3; continue; }
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt + 2); i = e + 2; continue; }
    if (text.startsWith('<!', lt)) { const e = text.indexOf('>', lt + 2); i = e + 1; continue; }
    if (text[lt + 1] === '/') {
      const e = text.indexOf('>', lt);
      const name = text.slice(lt + 2, e).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`XML: </${name}> closes <${top && top.name}>`);
      i = e + 1; continue;
    }
    let j = lt + 1;
    while (j < n && !WS(text[j]) && text[j] !== '/' && text[j] !== '>') j++;
    const el = { name: text.slice(lt + 1, j), attrs: {}, children: [] };
    for (;;) {
      while (j < n && WS(text[j])) j++;
      if (j >= n) throw new Error('XML: unterminated tag ' + el.name);
      if (text[j] === '/' && text[j + 1] === '>') { j += 2; stack[stack.length - 1].children.push(el); break; }
      if (text[j] === '>') { j += 1; stack[stack.length - 1].children.push(el); stack.push(el); break; }
      let k = j;
      while (k < n && !WS(text[k]) && text[k] !== '=') k++;
      const an = text.slice(j, k);
      while (k < n && text[k] !== '=') k++;
      k++;
      while (k < n && WS(text[k])) k++;
      const q = text[k];
      const end = text.indexOf(q, k + 1);
      if (end < 0) throw new Error('XML: unterminated attribute ' + an);
      el.attrs[an] = decode(text.slice(k + 1, end));
      j = end + 1;
    }
    i = j;
  }
  if (stack.length !== 1) throw new Error('XML: unclosed element ' + stack[stack.length - 1].name);
  return root;
}

export const nums = s => {
  const t = (s || '').trim();
  if (t === '') return [];
  const parts = t.split(/[\s,]+/);
  const out = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) out[i] = Number(parts[i]);
  return out;
};
export const strs = s => { const out = []; const re = /"((?:[^"\\]|\\.)*)"/g; let m; while ((m = re.exec(s || ''))) out.push(m[1].replace(/\\(.)/g, '$1')); return out; };
/** Read a MetadataSet's children into a plain object. Numeric fields are always arrays here. */
export function readMeta(set) {
  const o = {};
  for (const m of set.children) {
    const key = m.attrs.name;
    if (!key) continue;
    if (m.name === 'MetadataString') o[key] = strs(m.attrs.value);
    else if (m.name === 'MetadataDouble' || m.name === 'MetadataFloat' || m.name === 'MetadataInteger') o[key] = nums(m.attrs.value);
    else if (m.name === 'MetadataBoolean') o[key] = (m.attrs.value || '').trim().split(/\s+/).map(x => x === 'true');
    else if (m.name === 'MetadataSet') o[key] = readMeta(m);
  }
  return o;
}

export { decode };

/** Depth-first search for elements by name (and an optional attribute test). */
export function findAll(node, name, test) {
  const out = [];
  (function walk(n) {
    for (const c of n.children) {
      if (c.name === name && (!test || test(c))) out.push(c);
      walk(c);
    }
  })(node);
  return out;
}

/** The first MetadataSet named setName under node, read into a plain object (numbers as arrays). */
export function metaSet(node, setName) {
  const set = findAll(node, 'MetadataSet', (c) => c.attrs.name === setName)[0];
  return set ? readMeta(set) : null;
}

// ---- writing (added for SLAB: X3D is the save format, so the codec writes as well as reads) ----

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>'"]/g, (c) => ESC[c]);

/**
 * A number exactly as it will read back: JS's shortest round-trip form for a double, with -0 kept as "-0"
 * (String(-0) is "0", which would change the bits). With float32 the value is first rounded to a float32 and
 * written with 9 significant digits, which round-trips a float32 but not a double.
 */
export function fmt(v, float32 = false) {
  if (Object.is(v, -0)) return '-0';
  if (float32) return String(Number(Math.fround(v).toPrecision(9)));
  return String(v);
}

/** Serialise a { name, attrs, children } tree (the shape parseXML returns) as X3D's XML encoding. */
export function writeXML(node, indent = '') {
  if (node.name === '#root') return node.children.map((c) => writeXML(c, indent)).join('\n');
  const a = Object.entries(node.attrs || {}).map(([k, v]) => ` ${k}='${esc(v)}'`).join('');
  if (!node.children || node.children.length === 0) return `${indent}<${node.name}${a}/>`;
  return `${indent}<${node.name}${a}>\n${node.children.map((c) => writeXML(c, indent + ' ')).join('\n')}\n${indent}</${node.name}>`;
}

/** Shorthand for building element trees: el('Shape', { DEF: 'S' }, child, child). */
export const el = (name, attrs = {}, ...children) => ({ name, attrs, children: children.flat().filter(Boolean) });
