// HAnim forward kinematics. A joint rotates its subtree about its `center`
// (X3D HAnimJoint = Transform with center): x -> R(x - c) + c, composed down
// the tree. Used for foot planting, sliding metrics and the recorder.
import { quatFromEuler, qMul, qRot, qIdentity, vAdd, vSub, clamp } from "./math.js";

export class Skeleton {
  constructor(data) {
    this.name = data.name;
    this.joints = data.joints; // [{name,parent,center,llimit?,ulimit?}] in depth-first order
    this.byName = Object.fromEntries(this.joints.map((j) => [j.name, j]));
    this.rest = Object.fromEntries(this.joints.map((j) => [j.name, j.center]));
    this.feet = ["l", "r"].map((s) => ({
      side: s,
      ankle: `${s}_talocrural`,
      toe: this.byName[`${s}_metatarsophalangeal_2`] ? `${s}_metatarsophalangeal_2` : `${s}_tarsal_distal_interphalangeal_2`,
    }));
  }

  /** Clamp a pose (degrees) to HAnimJoint llimit/ulimit; returns count of clamps. */
  clampPose(pose) {
    let n = 0;
    for (const [jn, v] of Object.entries(pose)) {
      const j = this.byName[jn];
      if (!j || !j.llimit) continue;
      for (let i = 0; i < 3; i++) {
        const lo = j.llimit[i] / (Math.PI / 180), hi = j.ulimit[i] / (Math.PI / 180);
        const c = clamp(v[i], lo, hi);
        if (c !== v[i]) { v[i] = c; n++; }
      }
    }
    return n;
  }

  /** World transforms for a pose {joint: [x,y,z] deg}, root = [dx,dy,dz,yaw]. */
  fk(pose, root = [0, 0, 0, 0], only = null) {
    const out = {};
    for (const j of this.joints) {
      if (only && !only.has(j.name)) continue;
      const e = pose[j.name];
      let q = e ? quatFromEuler(e[0], e[1], e[2]) : qIdentity();
      if (j.name === "humanoid_root" && root[3]) q = qMul(quatFromEuler(0, root[3], 0), q);
      const local = { q, t: vSub(j.center, qRot(q, j.center)) }; // T(c) R T(-c)
      if (j.name === "humanoid_root") local.t = vAdd(local.t, [root[0], root[1], root[2]]);
      const p = j.parent ? out[j.parent] : null;
      out[j.name] = p ? { q: qMul(p.q, local.q), t: vAdd(qRot(p.q, local.t), p.t) } : local;
    }
    return out;
  }

  point(world, joint) {
    const w = world[joint];
    return vAdd(qRot(w.q, this.rest[joint]), w.t);
  }

  /** Lift/lower the root so the lowest foot point sits where it rests. */
  plant(pose, root) {
    const need = this._need ||= new Set(this.feet.flatMap((f) => this.chain(f.ankle).concat(this.chain(f.toe))));
    const w = this.fk(pose, root, need);
    let drop = Infinity;
    const feet = this.feet.map((f) => {
      const a = this.point(w, f.ankle), t = this.point(w, f.toe);
      const h = Math.min(a[1] - this.rest[f.ankle][1], t[1] - this.rest[f.toe][1]);
      drop = Math.min(drop, h);
      return { side: f.side, ankle: a, toe: t, h };
    });
    return { dy: -drop, feet };
  }

  chain(name) {
    const c = [];
    for (let n = name; n; n = this.byName[n]?.parent) c.push(n);
    return c;
  }
}
