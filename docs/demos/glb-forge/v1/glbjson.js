// The page's own glb reader. It parses the JSON chunk of a glb with nothing but JSON.parse, so the tether audit does not depend on the lane's
// identity code or on glTF-Transform. What it counts as an identity is written out in the page ("how this was decided"); this file is that text as code.

export function splitGlb(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb (bad magic)');
  const total = dv.getUint32(8, true);
  let off = 12, json = null, jsonLength = 0, binLength = 0;
  while (off + 8 <= Math.min(total, u8.length)) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) { json = JSON.parse(new TextDecoder().decode(u8.subarray(off + 8, off + 8 + len))); jsonLength = len; }
    else if (type === 0x004e4942) binLength = len;
    off += 8 + len;
  }
  if (!json) throw new Error('glb has no JSON chunk');
  return { json, jsonLength, binLength, total: u8.length };
}

// canonical JSON: object keys sorted, so two extras objects compare equal when they hold the same data
export function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);
const pathText = (p) => (Array.isArray(p) ? p.join(' / ') : p == null ? '' : String(p));

// ---------- identity tokens ----------
// One token per named or tagged thing: node, mesh, material, scene, camera, light, and the file-level extras. A token is kind|name|extras (plus the
// parameters of a camera or a light). Nodes whose extras say x3d_wrapper_of are helper nodes an optimiser inserted: counted separately, not identities.
// A batch node (extras.x3d_instances) stands for the nodes folded into it: each record is a node token located "inside" that batch.
export function identityTokens(json) {
  const T = []; let wrappers = 0;
  const add = (kind, name, extras, params, where) => T.push({ kind, name: name || '', extras: extras || {}, key: `${kind}|${name || ''}|${stable(extras || {})}${params ? '|' + params : ''}`, where });
  (json.nodes || []).forEach((n, i) => {
    const ex = n.extras || {};
    if (ex.x3d_wrapper_of) { wrappers++; return; }
    if (Array.isArray(ex.x3d_instances)) {
      ex.x3d_instances.forEach((r, k) => { if (r) add('node', r.n, r.e, '', { batch: i, rec: k }); });
      const rest = { ...ex }; delete rest.x3d_instances;
      if (n.name || !isEmpty(rest)) add('node', n.name, rest, '', { node: i });
      return;
    }
    if (n.name || !isEmpty(ex)) add('node', n.name, ex, '', { node: i });
  });
  const named = (kind, arr) => (arr || []).forEach((o, i) => { if (o.name || !isEmpty(o.extras)) add(kind, o.name, o.extras, '', { idx: i }); });
  named('mesh', json.meshes); named('material', json.materials); named('scene', json.scenes);
  (json.cameras || []).forEach((c, i) => {
    const p = c.type === 'orthographic' ? c.orthographic || {} : c.perspective || {};
    const params = c.type === 'orthographic' ? [p.xmag, p.ymag, p.znear, p.zfar] : [p.yfov, p.znear, p.zfar ?? null, p.aspectRatio ?? null];
    add('camera', c.name, c.extras, `${c.type}|${params.join(',')}`, { idx: i });
  });
  const lights = json.extensions?.KHR_lights_punctual?.lights || [];
  (json.nodes || []).forEach((n, i) => {
    const li = n.extensions?.KHR_lights_punctual?.light; if (li == null || !lights[li]) return;
    const l = lights[li];
    add('light', l.name, l.extras, `${l.type}|${(l.color || [1, 1, 1]).join(',')}|${l.intensity ?? 1}|${l.range ?? ''}|${l.spot ? stable(l.spot) : ''}`, { node: i });
  });
  if (!isEmpty(json.extras)) add('asset', '', json.extras, '', {});
  return { tokens: T, wrappers };
}

// ---------- audit: where did each source identity go? ----------
// kept  = an output node (not a batch record) has the same name and the same extras
// moved = no such node, but a record n/e in some batch node's extras.x3d_instances does
// lost  = neither. Duplicates are matched one to one. added = output tokens nobody in the source claims.
export function auditPair(srcJson, outJson) {
  const S = identityTokens(srcJson), O = identityTokens(outJson);
  const place = new Map(), moved = new Map();
  for (const t of O.tokens) {
    const m = t.where.batch != null ? moved : place;
    (m.get(t.key) || m.set(t.key, []).get(t.key)).push(t.where);
  }
  const rows = [], byKind = {};
  let kept = 0, movedN = 0, lost = 0;
  for (const t of S.tokens) {
    const k = (byKind[t.kind] ||= { source: 0, kept: 0, moved: 0, lost: 0 });
    k.source++;
    let status, loc = null;
    const p = place.get(t.key), mv = moved.get(t.key);
    if (p && p.length) { status = 'kept'; loc = p.shift(); kept++; k.kept++; }
    else if (mv && mv.length) { status = 'moved'; loc = mv.shift(); movedN++; k.moved++; }
    else { status = 'lost'; lost++; k.lost++; }
    if (t.kind === 'node') {
      const e = t.extras;
      rows.push({ i: rows.length, node: t.where.node ?? t.where.rec, name: t.name, def: e.x3d_def ?? '', defPath: pathText(e.x3d_def_path), use: e.x3d_use ?? '', vp: e.x3d_viewpoint_description ?? '', extras: e, status, loc });
    }
  }
  let added = 0;
  for (const m of [place, moved]) for (const arr of m.values()) added += arr.length;
  const unclaimed = []; // sample of added tokens for display
  for (const m of [place, moved]) for (const [key, arr] of m) if (arr.length && unclaimed.length < 8) unclaimed.push(key);
  return {
    rows, kept, moved: movedN, lost, added, sourceTokens: S.tokens.length, outputTokens: O.tokens.length, preserved: kept + movedN,
    byKind, wrappers: O.wrappers, sourceWrappers: S.wrappers, addedSample: unclaimed,
  };
}

// ---------- facts about a file, for the list header ----------
export function tagStats(json) {
  const N = json.nodes || []; let def = 0, defPath = 0, use = 0, vp = 0, named = 0; const defs = new Set();
  for (const n of N) { const e = n.extras || {}; if (n.name) named++; if (e.x3d_def) { def++; defs.add(e.x3d_def); } if (e.x3d_def_path != null) defPath++; if (e.x3d_use) use++; if (e.x3d_viewpoint_description) vp++; }
  return { nodes: N.length, named, def, defPath, use, vp, distinctDef: defs.size };
}

export function batchNodes(json) {
  const acc = json.accessors || [], out = [];
  (json.nodes || []).forEach((n, i) => {
    const g = n.extensions?.EXT_mesh_gpu_instancing; if (!g) return;
    const a = Object.values(g.attributes || {})[0];
    const count = a != null ? acc[a]?.count ?? null : null;
    const rec = Array.isArray(n.extras?.x3d_instances) ? n.extras.x3d_instances : null;
    out.push({ node: i, name: n.name || '', mesh: n.mesh, meshName: json.meshes?.[n.mesh]?.name || '', count, records: rec ? rec.length : 0, recordsNonNull: rec ? rec.filter(Boolean).length : 0 });
  });
  return out;
}

// ---------- where the bytes sit, from the JSON alone (used for files the browser bundle cannot decode, such as Draco) ----------
export function byteCategories(buf) {
  const { json, jsonLength, binLength, total } = splitGlb(buf);
  const views = json.bufferViews || [], cat = new Array(views.length).fill(null), acc = json.accessors || [];
  const claim = (v, c) => { if (v != null && cat[v] == null) cat[v] = c; };
  const accCat = (n) => n === 'POSITION' ? 'position' : n === 'NORMAL' ? 'normal' : n === 'TANGENT' ? 'tangent' : /^TEXCOORD/.test(n) ? 'uv' : /^COLOR/.test(n) ? 'colour' : /^(JOINTS|WEIGHTS)/.test(n) ? 'skin' : 'attrOther';
  for (const m of json.meshes || []) for (const p of m.primitives || []) {
    for (const [k, a] of Object.entries(p.attributes || {})) claim(acc[a]?.bufferView, accCat(k));
    if (p.indices != null) claim(acc[p.indices]?.bufferView, 'indices');
    for (const t of p.targets || []) for (const a of Object.values(t)) claim(acc[a]?.bufferView, 'morph');
    const d = p.extensions?.KHR_draco_mesh_compression; if (d) claim(d.bufferView, 'draco');
  }
  for (const an of json.animations || []) for (const s of an.samplers || []) { claim(acc[s.input]?.bufferView, 'animation'); claim(acc[s.output]?.bufferView, 'animation'); }
  for (const s of json.skins || []) claim(acc[s.inverseBindMatrices]?.bufferView, 'skin');
  for (const i of json.images || []) claim(i.bufferView, 'image');
  for (const a of acc) if (a.sparse) { claim(a.sparse.indices?.bufferView, 'sparse'); claim(a.sparse.values?.bufferView, 'sparse'); }
  for (const n of json.nodes || []) { const g = n.extensions?.EXT_mesh_gpu_instancing; if (g) for (const a of Object.values(g.attributes || {})) claim(acc[a]?.bufferView, 'instancing'); }
  const out = {}; let counted = 0;
  views.forEach((v, i) => {
    const mo = v.extensions?.EXT_meshopt_compression;
    if (mo && mo.fallback && !mo.byteLength) return;
    const b = mo ? mo.byteLength : v.byteLength, c = cat[i] || 'unreferenced';
    out[c] = (out[c] || 0) + b; counted += b;
  });
  return { totalBytes: total, jsonBytes: jsonLength, binBytes: binLength, header: 28, byCategory: out, paddingAndOther: Math.max(0, binLength - counted) };
}
