// Performances and lineage back into X3D: what the dancers did becomes plain
// HAnimMotion (ISO/IEC 19774-2 channels, degrees, order ZXY), and what they
// learned becomes MetadataSets. Pure string functions (page and node tests).

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const num = (v) => (Math.abs(v) < 5e-5 ? "0" : (+v.toFixed(4)).toString());

export class Recorder {
  constructor(skeleton, fps = 30) {
    this.sk = skeleton; this.fps = fps; this.frames = []; this.joints = new Set(); this.next = 0;
  }
  maybe(t, pose, root, info) {
    if (t < this.next) return;
    this.next = (this.next || t) + 1 / this.fps;
    const p = {};
    for (const [j, v] of Object.entries(pose)) {
      if (!this.sk.byName[j]) continue;
      this.joints.add(j); p[j] = v.slice();
    }
    this.frames.push({ t, pose: p, root: root.slice(), move: info?.move });
  }
  /** One HAnimMotion element string. */
  motion(prefix, name, { loop = true, enabled = true } = {}) {
    const order = this.sk.joints.map((j) => j.name).filter((n) => n === "humanoid_root" || this.joints.has(n));
    if (!order.includes("humanoid_root")) order.unshift("humanoid_root");
    const ch = order.map((n) => (n === "humanoid_root" ? "6 Xposition Yposition Zposition Zrotation Xrotation Yrotation" : "3 Zrotation Xrotation Yrotation")).join(" ");
    const vals = [];
    for (const f of this.frames) {
      for (const n of order) {
        const e = f.pose[n] ?? [0, 0, 0];
        if (n === "humanoid_root") vals.push(f.root[0], f.root[1], f.root[2], e[2], e[0], e[1] + f.root[3]);
        else vals.push(e[2], e[0], e[1]);
      }
    }
    const moves = [];
    for (const f of this.frames) if (moves[moves.length - 1]?.move !== f.move) moves.push({ move: f.move, t: f.t });
    const t0 = this.frames[0]?.t ?? 0;
    return `<HAnimMotion DEF='${esc(prefix)}_motion_${esc(name)}' name='${esc(name)}' description='${esc(prefix)} performance, ${this.frames.length} frames at ${this.fps} fps'` +
      ` enabled='${enabled}' loop='${loop}' frameDuration='${num(1 / this.fps)}' loa='-1'` +
      ` joints='${order.join(" ")}' channels='${ch}' endFrame='${Math.max(0, this.frames.length - 1)}' values='${vals.map(num).join(" ")}'>\n` +
      `  <MetadataSet name='x3d.dance.performance' containerField='metadata'>\n` +
      `    <MetadataString name='moves' containerField='value' value='${moves.map((m) => `"${esc(m.move)}@${num(m.t - t0)}"`).join(" ")}'/>\n` +
      `  </MetadataSet>\n</HAnimMotion>`;
  }
}

/** JSON → nested MetadataSet (strings for leaves; arrays of numbers as MetadataFloat). */
export function metadataXML(name, obj, cf = "metadata", depth = 0) {
  const pad = "  ".repeat(depth);
  const kids = Object.entries(obj).map(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v)) return metadataXML(k, v, "value", depth + 1);
    if (Array.isArray(v) && v.every((x) => typeof x === "number")) return `${pad}  <MetadataFloat name='${esc(k)}' containerField='value' value='${v.map(num).join(" ")}'/>`;
    if (typeof v === "number") return `${pad}  <MetadataDouble name='${esc(k)}' containerField='value' value='${num(v)}'/>`;
    if (typeof v === "boolean") return `${pad}  <MetadataBoolean name='${esc(k)}' containerField='value' value='${v}'/>`;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${pad}  <MetadataString name='${esc(k)}' containerField='value' value='"${esc(s).replace(/\\/g, "\\\\")}"'/>`;
  });
  return `${pad}<MetadataSet name='${esc(name)}' containerField='${cf}'>\n${kids.join("\n")}\n${pad}</MetadataSet>`;
}

export async function sha256(s) {
  const buf = new TextEncoder().encode(s);
  const h = await (globalThis.crypto?.subtle ?? (await import("node:crypto")).webcrypto.subtle).digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lineage records with a hash chain: changing any past byte breaks every later hash. */
export async function chain(records) {
  let prev = "0".repeat(64);
  const out = [];
  for (const r of records) {
    const body = JSON.stringify(r);
    const hash = await sha256(prev + body);
    out.push({ ...r, prev, hash });
    prev = hash;
  }
  return out;
}

/**
 * Splice performance motions + lineage into the stage scene text.
 * motions: {Ada: "<HAnimMotion…>", Rex: …}; meta: plain object for WorldInfo.
 */
export function performanceScene(stageXML, motions, meta) {
  let x = stageXML;
  for (const [prefix, m] of Object.entries(motions)) {
    const mm = new RegExp(`<HAnimHumanoid DEF=["']${prefix}_humanoid["']`).exec(x);
    if (!mm) throw new Error(`no HAnimHumanoid ${prefix}_humanoid in stage`);
    const open = mm.index;
    const tagEnd = x.indexOf(">", open);
    x = x.slice(0, tagEnd) + ` motionsEnabled='true'` + x.slice(tagEnd);
    const close = x.indexOf("</HAnimHumanoid>", open);
    x = x.slice(0, close) + m.replace(/^/gm, "      ") + "\n    " + x.slice(close);
  }
  const wi = x.indexOf("<WorldInfo ");
  const wiEnd = x.indexOf("/>", wi);
  return x.slice(0, wiEnd) + ">\n" + metadataXML("x3d.dance.session", meta, "metadata", 3) + "\n    </WorldInfo>" + x.slice(wiEnd + 2);
}
