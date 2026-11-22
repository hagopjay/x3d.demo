// SPDX-License-Identifier: GPL-3.0-or-later
// Wire Lab core: the X3D behaviour graph in the browser. No DOM in this file, so node can test it (build/test_core.mjs).
// It mirrors x3d-blender-io source/behaviour_graph.py: the same catalogue (catalogue.json is generated from it), the same
// rule (a ROUTE joins an output to an input of one field type), the same error codes, and the same 55 shared cases.

export const COLOURS = {
  SFBool: '#e64d4d', MFBool: '#b34040', SFTime: '#f2b333', SFFloat: '#a1a1a1', MFFloat: '#737373',
  SFInt32: '#59bf73', MFInt32: '#408c54', SFVec2f: '#59b3e6', MFVec2f: '#4085ad', SFVec3f: '#6363e6', MFVec3f: '#4747ad',
  SFRotation: '#bf66e6', MFRotation: '#8f4dad', SFColor: '#e6d940', MFColor: '#ada330', SFColorRGBA: '#e69940',
  MFColorRGBA: '#ad7330', SFString: '#4dcccc', MFString: '#389999', SFNode: '#cccccc', MFNode: '#999999',
};
export const PLAIN = {
  SFBool: 'yes / no', SFTime: 'a time', SFFloat: 'a number', SFInt32: 'a whole number', SFVec3f: 'a place (x y z)',
  SFVec2f: 'a point (x y)', SFRotation: 'a turn (axis + angle)', SFColor: 'a colour', SFString: 'text',
  MFFloat: 'numbers', MFVec3f: 'places', MFRotation: 'turns', MFColor: 'colours', MFString: 'texts', MFInt32: 'whole numbers',
  MFBool: 'yes / no list', MFVec2f: 'points', SFColorRGBA: 'a colour with alpha', MFColorRGBA: 'colours with alpha',
  SFNode: 'a node', MFNode: 'nodes',
};

export class WireError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class Catalogue {
  constructor(data) { this.data = data; }
  rows(type) {
    if (this.data.nodes[type]) return this.data.nodes[type].fields;
    return this.data.targets[type] || null;
  }
  isBehaviour(type) { return !!this.data.nodes[type]; }
  isPlaced(type) { return this.data.placed.includes(type); }
  groups() {
    const out = {};
    for (const [name, node] of Object.entries(this.data.nodes)) (out[node.group] ||= []).push(name);
    return out;
  }
  // (canonical field name, field type) of `name` used as a ROUTE source ('out') or destination ('in').
  resolve(type, name, direction) {
    const rows = this.rows(type);
    if (!rows) throw new WireError('unknown-node', `${type} is not in the catalogue`);
    const table = Object.fromEntries(rows.map(r => [r[0], r]));
    const candidates = [name];
    if (direction === 'in' && name.startsWith('set_')) candidates.push(name.slice(4));
    if (direction === 'out' && name.endsWith('_changed')) candidates.push(name.slice(0, -8));
    for (const candidate of candidates) {
      const row = table[candidate];
      if (!row) continue;
      const access = row[2];
      if (candidate !== name && access !== 'inputOutput') continue;
      const allowed = direction === 'out' ? ['outputOnly', 'inputOutput'] : ['inputOnly', 'inputOutput'];
      if (!allowed.includes(access)) {
        throw new WireError('wrong-direction', `${type}.${name} is ${access}: it cannot be ${direction === 'out' ? 'a ROUTE source' : 'a ROUTE destination'}`);
      }
      return [candidate, row[1]];
    }
    throw new WireError('unknown-field', `${type} has no field '${name}'`);
  }
  verdict(fromType, fromField, toType, toField) {
    try {
      const a = this.resolve(fromType, fromField, 'out')[1], b = this.resolve(toType, toField, 'in')[1];
      return a === b ? 'ok' : 'type-mismatch';
    } catch (e) { if (e instanceof WireError) return e.code; throw e; }
  }
  outputs(type) { return (this.rows(type) || []).filter(r => r[2] === 'outputOnly' || r[2] === 'inputOutput'); }
  inputs(type) { return (this.rows(type) || []).filter(r => r[2] === 'inputOnly' || r[2] === 'inputOutput'); }
  settable(type) { return (this.rows(type) || []).filter(r => r[2] === 'initializeOnly' || r[2] === 'inputOutput'); }
}

// The graph is plain data in the schema x3d-blender-io.behaviour-graph/v0:
//   { schema, nodes: [{id, type, role: 'behaviour'|'target', fields?, parent?, position?}], routes: [[from, field, to, field]] }
export class Graph {
  constructor(catalogue, data) {
    this.cat = catalogue;
    this.nodes = new Map();
    this.routes = [];
    for (const n of (data?.nodes || [])) this.nodes.set(n.id, { fields: {}, ...structuredClone(n) });
    for (const r of (data?.routes || [])) this.routes.push([...r]);
  }
  toJSON() {
    return { schema: 'x3d-blender-io.behaviour-graph/v0', nodes: [...this.nodes.values()].map(n => structuredClone(n)), routes: this.routes.map(r => [...r]) };
  }
  freshId(type) { let i = 1; while (this.nodes.has(`${type}${i}`)) i++; return `${type}${i}`; }
  add(type, id, extra = {}) {
    if (!this.cat.isBehaviour(type)) throw new WireError('unknown-node', `${type} is not a behaviour node`);
    id = id || this.freshId(type);
    if (this.nodes.has(id)) throw new WireError('duplicate-def', `DEF '${id}' is already in the graph`);
    if (!/^[A-Za-z_][\w.\-]*$/.test(id)) throw new WireError('bad-def', `'${id}' is not a legal DEF name`);
    const node = { id, type, role: 'behaviour', fields: {}, ...extra };
    this.nodes.set(id, node);
    return node;
  }
  // Why a ROUTE is not legal X3D, or null.
  problem(from, fromField, to, toField) {
    const a = this.nodes.get(from), b = this.nodes.get(to);
    if (!a || !b) return ['unknown-def', `no node named '${!a ? from : to}' in the graph`];
    let ta, tb;
    try { ta = this.cat.resolve(a.type, fromField, 'out')[1]; tb = this.cat.resolve(b.type, toField, 'in')[1]; }
    catch (e) { if (e instanceof WireError) return [e.code, e.message]; throw e; }
    if (ta !== tb) return ['type-mismatch', `${from}.${fromField} is ${ta} but ${to}.${toField} is ${tb}: a ROUTE joins fields of one type`];
    return null;
  }
  route(from, fromField, to, toField) {
    const p = this.problem(from, fromField, to, toField);
    if (p) throw new WireError(p[0], p[1]);
    if (!this.routes.some(r => r[0] === from && r[1] === fromField && r[2] === to && r[3] === toField)) this.routes.push([from, fromField, to, toField]);
  }
  unroute(index) { this.routes.splice(index, 1); }
  remove(id) { this.nodes.delete(id); this.routes = this.routes.filter(r => r[0] !== id && r[2] !== id); }
  typeOfRoute(r) { try { return this.cat.resolve(this.nodes.get(r[0]).type, r[1], 'out')[1]; } catch { return '?'; } }
  explain() {
    return this.routes.map(r => {
      const a = this.nodes.get(r[0]), b = this.nodes.get(r[2]);
      return `${a.type} ${a.id}.${r[1]} --${this.typeOfRoute(r)}--> ${b.type} ${b.id}.${r[3]}`;
    }).join('\n');
  }
  // A node "spec" in a challenge is a DEF or a node type.
  matches(spec, id) { const n = this.nodes.get(id); return !!n && (n.id === spec || n.type === spec); }
  hasRoute([from, fromField, to, toField]) {
    const canon = (id, f, dir) => { try { return this.cat.resolve(this.nodes.get(id).type, f, dir)[0]; } catch { return f; } };
    return this.routes.some(r => this.matches(from, r[0]) && this.matches(to, r[2]) &&
      canon(r[0], r[1], 'out') === canon(r[0], fromField, 'out') && canon(r[2], r[3], 'in') === canon(r[2], toField, 'in'));
  }
  solved(challenge) {
    return (challenge.needs || []).every(p => this.hasRoute(p)) && !(challenge.lacks || []).some(p => this.hasRoute(p));
  }
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// The behaviour part of the file: [lines inside parents by DEF, lines at the scene root, ROUTE lines].
export function emit(graph) {
  const children = {}, root = [], routes = [];
  for (const n of graph.nodes.values()) {
    if (n.role !== 'behaviour') continue;
    const order = (graph.cat.rows(n.type) || []).map(r => r[0]);
    const names = order.filter(f => n.fields[f] !== undefined && n.fields[f] !== '');
    const text = `<${n.type} DEF="${esc(n.id)}"${names.map(f => ` ${f}="${esc(n.fields[f])}"`).join('')}/>`;
    if (n.parent) (children[n.parent] ||= []).push(text); else root.push(text);
  }
  for (const r of graph.routes) routes.push(`<ROUTE fromNode="${esc(r[0])}" fromField="${esc(r[1])}" toNode="${esc(r[2])}" toField="${esc(r[3])}"/>`);
  return { children, root, routes };
}

// The whole X3D document: the scene text with the graph written in. Pure string work (the scene is known and tidy).
export function weave(sceneText, graph) {
  const { children, root, routes } = emit(graph);
  let text = sceneText;
  for (const [parent, lines] of Object.entries(children)) {
    const open = new RegExp(`(<Transform DEF="${parent}"[^>]*>)`);
    if (!open.test(text)) throw new WireError('unknown-def', `'${parent}' is not a Transform in the scene`);
    text = text.replace(open, `$1${lines.join('')}`);
  }
  const tail = [...root, ...routes].map(l => `    ${l}\n`).join('');
  return text.replace(/  <\/Scene>/, `${tail}  </Scene>`);
}

const pyValue = (value, type) => {
  if (type === 'SFBool') return value === 'true' ? 'True' : 'False';
  if (type === 'SFString') return JSON.stringify(value);
  if (type === 'MFString') return JSON.stringify(value);
  const numbers = value.trim().split(/[\s,]+/).filter(Boolean);
  if (numbers.some(x => Number.isNaN(Number(x)))) return JSON.stringify(value);
  const size = { SFVec3f: 3, MFVec3f: 3, SFColor: 3, MFColor: 3, SFRotation: 4, MFRotation: 4, SFVec2f: 2, MFVec2f: 2 }[type];
  if (type.startsWith('SF') && !size) return numbers[0];
  if (type.startsWith('SF')) return `(${numbers.join(', ')})`;
  if (!size) return `[${numbers.join(', ')}]`;
  const groups = [];
  for (let i = 0; i < numbers.length; i += size) groups.push(`(${numbers.slice(i, i + size).join(', ')})`);
  return `[${groups.join(', ')}]`;
};
const pyName = id => id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1').replace(/^./, c => c.toLowerCase());

// The graph as a script in the scripting methods of x3d-blender-io (source/behaviour_graph.py).
export function toPython(graph) {
  const lines = ['b = Behaviour()'];
  const used = [...new Set(graph.routes.flatMap(r => [r[0], r[2]]))];
  for (const n of graph.nodes.values()) {
    if (n.role === 'behaviour') {
      const types = Object.fromEntries((graph.cat.rows(n.type) || []).map(r => [r[0], r[1]]));
      const args = [`"${n.type}"`, `"${n.id}"`];
      if (n.parent) args.push(`parent="${n.parent}"`);
      for (const [f, v] of Object.entries(n.fields)) if (v !== '') args.push(`${f}=${pyValue(v, types[f] || 'SFString')}`);
      lines.push(`${pyName(n.id)} = b.add(${args.join(', ')})`);
    } else if (used.includes(n.id)) {
      lines.push(`${pyName(n.id)} = b.target("${n.type}", "${n.id}")`);
    }
  }
  for (const r of graph.routes) lines.push(`${pyName(r[0])}.${r[1]} >> ${pyName(r[2])}.${r[3]}`);
  return lines.join('\n') + '\n';
}

// Left-to-right columns by longest path from a source (same idea as behaviour_graph.layout).
export function layout(graph, column = 300, row = 170) {
  const ids = [...graph.nodes.keys()], out = Object.fromEntries(ids.map(i => [i, []])), indeg = Object.fromEntries(ids.map(i => [i, 0]));
  for (const r of graph.routes) if (r[0] !== r[2] && !out[r[0]].includes(r[2])) { out[r[0]].push(r[2]); indeg[r[2]]++; }
  const depth = Object.fromEntries(ids.map(i => [i, 0])), state = {};
  const visit = (id, level) => {
    if (state[id] === 1) return;
    if (level > depth[id] || !(id in state)) depth[id] = Math.max(depth[id], level); else return;
    state[id] = 1; for (const next of out[id]) visit(next, depth[id] + 1); state[id] = 2;
  };
  ids.filter(i => indeg[i] === 0).forEach(i => visit(i, 0));
  ids.filter(i => !(i in state)).forEach(i => visit(i, 0));
  const columns = {}, positions = {};
  ids.forEach(i => (columns[depth[i]] ||= []).push(i));
  for (const [level, names] of Object.entries(columns)) names.forEach((id, k) => { positions[id] = [level * column, -k * row]; });
  return positions;
}
