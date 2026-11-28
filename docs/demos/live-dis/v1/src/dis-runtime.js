// dis-runtime.js: makes the six X3D 4.0 DIS nodes do their work inside X_ITE.
//
// X_ITE (checked with 16.8.1) parses DISEntityManager, DISEntityTypeMapping, EspduTransform, TransmitterPdu,
// SignalPdu and ReceiverPdu and gives them every field of the specification, but its own source marks each one
// "THIS NODE IS NOT SUPPORTED": the nodes hold values and do nothing with them. This runtime supplies the
// behaviour from outside. It finds the DIS nodes in the loaded scene through the Scene Access Interface (SAI) and
//   - in networkMode "networkReader" writes decoded PDU values into the fields of those same nodes;
//   - in networkMode "networkWriter" reads their fields and hands encoded PDUs to `onSend`;
//   - dead-reckons every reading EspduTransform on each tick;
//   - creates and removes EspduTransform nodes for a DISEntityManager and reports them on addedEntities and
//     removedEntities, choosing a model url from the manager's DISEntityTypeMapping children.
// Field names are the ones in the X3D 4.0 specification, so ROUTEs written in the X3D file work on them.
//
// Two things reach past the documented SAI and are kept in one place each:
//   - outputOnly fields (isActive, timestamp, addedEntities, ...) cannot be set through the SAI node object, so
//     setOutput() uses node.getValue().getField(name).setValue(value);
//   - X_ITE's EspduTransform draws its children but ignores its own translation and rotation, so wrap() moves the
//     children into an ordinary Transform and adds ROUTEs from the EspduTransform fields to it.

import { decodePdu, encodePdu, PDU_TYPE, entityKey, timestampToUnixSeconds, timestampToSeconds, secondsToTimestamp } from './dis-codec.js';
import { deadReckon, eulerToMatrix, matrixToEuler, apply, drmUsesBody } from './dis-dr.js';
import { LocalFrame, ecefToGeodetic, matrixToAxisAngle, axisAngleToMatrix } from './dis-geo.js';

export const DIS_NODE_TYPES = Object.freeze(['DISEntityManager', 'DISEntityTypeMapping', 'EspduTransform', 'TransmitterPdu', 'SignalPdu', 'ReceiverPdu']);
const BODY_TO_MODEL = [1, 0, 0, 0, 0, -1, 0, 1, 0]; // body (x, y, z) -> model (x, -z, y)
const MODEL_TO_BODY = [1, 0, 0, 0, 0, 1, 0, -1, 0];
const INT32_MAX = 2147483647;

const sameAddress = (a, b) => {
  const norm = (x) => { const s = String(x ?? '').trim().toLowerCase(); return s === '' || s === 'localhost' ? '127.0.0.1' : s; };
  return norm(a) === norm(b);
};

export class LiveDisRuntime {
  // options: X3D (the X_ITE namespace), browser, scene, origin { lat, lon, h } of the local frame,
  //          now() -> seconds since 1970, heartbeatTimeout (seconds without a PDU before isActive goes false),
  //          onSend(bytes, { address, port }, nodeTypeName)
  constructor(options) {
    this.X3D = options.X3D; this.browser = options.browser; this.scene = options.scene ?? options.browser.currentScene;
    this.frame = new LocalFrame(options.origin.lat, options.origin.lon, options.origin.h ?? 0);
    this.now = options.now ?? (() => Date.now() / 1000);
    this.heartbeatTimeout = options.heartbeatTimeout ?? 12;
    this.onSend = options.onSend ?? (() => {});
    this.applyDeadReckoning = true;
    this.useTimestamps = true; // extrapolate from the PDU's own absolute timestamp when it has one
    this.exerciseID = options.exerciseID ?? 1;
    this.espdus = []; this.radios = []; this.managers = []; this.mappings = [];
    this.stats = { received: 0, decoded: 0, errors: 0, unsupported: 0, unmatched: 0, sent: 0, byType: { 1: 0, 25: 0, 26: 0, 27: 0 }, sentByType: { 1: 0, 25: 0, 26: 0, 27: 0 }, added: 0, removed: 0, lastError: '' };
    this.lastPdu = {}; // pduType -> { bytes, pdu, time, direction }
    this.listeners = [];
  }

  // ---- SAI helpers -------------------------------------------------------------------------------------------------

  setOutput(node, name, value) { node.getValue().getField(name).setValue(value); }

  set(node, name, value) { // inputOutput field, written only when the value differs, to keep event traffic down
    const cur = node[name];
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') { if (cur !== value) node[name] = value; return; }
    node[name] = value;
  }

  vec3f(a) { return new this.X3D.SFVec3f(a[0], a[1], a[2]); }

  _walk(node, visit, seen) {
    if (!node || seen.has(node.getValue())) return;
    seen.add(node.getValue());
    visit(node);
    const defs = node.getFieldDefinitions(), C = this.X3D.X3DConstants;
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (d.accessType === C.outputOnly || d.accessType === C.inputOnly) continue;
      if (d.dataType === C.SFNode) { const c = node[d.name]; if (c) this._walk(c, visit, seen); }
      else if (d.dataType === C.MFNode) { const m = node[d.name]; for (let k = 0; k < m.length; k++) this._walk(m[k], visit, seen); }
    }
  }

  // Find the DIS nodes of the scene and take charge of them. Returns the number of nodes of each type.
  bind() {
    const seen = new Set(), found = Object.fromEntries(DIS_NODE_TYPES.map((t) => [t, 0]));
    const roots = this.scene.rootNodes;
    for (let i = 0; i < roots.length; i++) {
      this._walk(roots[i], (node) => {
        const type = node.getNodeTypeName();
        if (!(type in found)) return;
        found[type]++;
        if (type === 'EspduTransform') this._adoptEspdu(node, null);
        else if (type === 'DISEntityManager') this.managers.push({ node, entities: new Map(), added: [], removed: [] });
        else if (type === 'DISEntityTypeMapping') this.mappings.push(node);
        else this._adoptRadio(node, type);
      }, seen);
    }
    this.found = found;
    return found;
  }

  wrap(node) {
    const xf = this.scene.createNode('Transform');
    const kids = node.children, list = [];
    for (let i = 0; i < kids.length; i++) list.push(kids[i]);
    xf.children = new this.X3D.MFNode(...list);
    xf.translation = node.translation; xf.rotation = node.rotation; xf.scale = node.scale; xf.center = node.center; xf.scaleOrientation = node.scaleOrientation;
    node.children = new this.X3D.MFNode(xf);
    for (const f of ['translation', 'rotation', 'scale', 'center', 'scaleOrientation']) this.scene.addRoute(node, f, xf, f);
    return xf;
  }

  _adoptEspdu(node, manager) {
    const rec = { node, manager, wrapper: this.wrap(node), state: null, tRef: 0, lastHeard: -Infinity, lastApplied: -Infinity, pending: null, lastWrite: -Infinity, active: false, pdus: 0, written: 0, drEcef: null, drMatrix: null, lastSample: null, estVel: [0, 0, 0], mode: '' };
    this.espdus.push(rec);
    this._modeFlags(rec);
    return rec;
  }

  _adoptRadio(node, type) {
    const rec = { node, type, lastHeard: -Infinity, lastWrite: -Infinity, active: false, pdus: 0, written: 0, dirty: false, mode: '', lastApplied: -Infinity, pending: null };
    // A writer sends at once when the thing its PDU is about changes: new signal data, or a radio changing state.
    if (type === 'SignalPdu') node.addFieldCallback(rec, 'data', () => { if (!rec.applying) rec.dirty = true; });
    if (type === 'TransmitterPdu') node.addFieldCallback(rec, 'transmitState', () => { rec.dirty = true; });
    if (type === 'ReceiverPdu') node.addFieldCallback(rec, 'receiverState', () => { rec.dirty = true; });
    this.radios.push(rec);
    this._modeFlags(rec);
  }

  _modeFlags(rec) {
    const mode = String(rec.node.networkMode);
    if (mode === rec.mode) return mode;
    rec.mode = mode;
    this.setOutput(rec.node, 'isNetworkReader', mode === 'networkReader');
    this.setOutput(rec.node, 'isNetworkWriter', mode === 'networkWriter');
    this.setOutput(rec.node, 'isStandAlone', mode !== 'networkReader' && mode !== 'networkWriter');
    return mode;
  }

  _onChannel(node, channel) { return !channel || (Number(node.port) === Number(channel.port) && sameAddress(node.address, channel.address)); }

  // Every distinct address and port that the DIS nodes of the scene name.
  channels() {
    const map = new Map();
    for (const r of [...this.espdus, ...this.radios, ...this.managers]) { const a = String(r.node.address), p = Number(r.node.port); map.set(`${a}:${p}`, { address: a, port: p }); }
    return [...map.values()];
  }

  // ---- reading ----------------------------------------------------------------------------------------------------------

  // Feed one PDU, as octets, into the nodes. `channel` is { address, port } of the network channel it arrived on.
  receive(bytes, channel, direction = 'received') {
    this.stats.received++;
    let pdu;
    try { pdu = decodePdu(bytes); } catch (e) { this.stats.errors++; this.stats.lastError = String(e.message ?? e); return null; }
    if (pdu.unsupported) { this.stats.unsupported++; return pdu; }
    this.stats.decoded++; this.stats.byType[pdu.header.pduType]++;
    const now = this.now();
    this.lastPdu[pdu.header.pduType] = { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), pdu, time: now, direction };
    for (const l of this.listeners) l(pdu, bytes, direction);
    if (direction !== 'received') return pdu;
    let matched = false;
    if (pdu.header.pduType === PDU_TYPE.ENTITY_STATE) {
      const id = pdu.entityID;
      let declared = false;
      for (const rec of this.espdus) {
        const n = rec.node;
        if (n.siteID !== id.site || n.applicationID !== id.application || n.entityID !== id.entity) continue;
        declared = true;
        if (this._modeFlags(rec) !== 'networkReader' || !n.enabled || !this._onChannel(n, channel)) continue;
        rec.pending = { pdu, arrival: now }; rec.lastHeard = now; rec.pdus++; matched = true;
      }
      if (!declared) {
        for (const m of this.managers) {
          if (!this._onChannel(m.node, channel)) continue;
          const rec = this._createEntity(m, pdu, channel);
          rec.pending = { pdu, arrival: now }; rec.lastHeard = now; rec.pdus++; matched = true;
          this._applyEspdu(rec, now); // so that the node carries its values when it is announced
          m.added.push(rec.node); // announced on the next tick, all new entities of that frame in one event
          this.stats.added++;
        }
      }
    } else {
      const type = { 25: 'TransmitterPdu', 26: 'SignalPdu', 27: 'ReceiverPdu' }[pdu.header.pduType];
      for (const rec of this.radios) {
        const n = rec.node;
        if (rec.type !== type || n.siteID !== pdu.entityID.site || n.applicationID !== pdu.entityID.application || n.entityID !== pdu.entityID.entity || n.radioID !== pdu.radioID) continue;
        if (this._modeFlags(rec) !== 'networkReader' || !n.enabled || !this._onChannel(n, channel)) continue;
        rec.lastHeard = now; rec.pdus++; matched = true;
        // Signal PDUs are a stream: each one is applied as it comes. The others wait for readInterval.
        if (type === 'SignalPdu') this._applyRadio(rec, pdu, now); else rec.pending = { pdu, arrival: now };
      }
    }
    if (!matched) this.stats.unmatched++;
    return pdu;
  }

  _pduTime(pdu, arrival) {
    const ts = timestampToSeconds(pdu.header.timestamp);
    if (this.useTimestamps && ts.absolute) {
      const t = timestampToUnixSeconds(pdu.header.timestamp, arrival);
      if (Math.abs(t - arrival) < 5) return t; // clocks agree well enough to trust it
    }
    return arrival;
  }

  _applyEspdu(rec, now) {
    const { pdu, arrival } = rec.pending; rec.pending = null; rec.lastApplied = now;
    const n = rec.node, X3D = this.X3D, dr = pdu.deadReckoning, alg = dr.algorithm;
    rec.state = { algorithm: alg, location: pdu.location, linearVelocity: pdu.linearVelocity, linearAcceleration: dr.linearAcceleration, angularVelocity: dr.angularVelocity, orientation: pdu.orientation };
    rec.tRef = this._pduTime(pdu, arrival);
    rec.lastPdu = pdu;
    const t = pdu.entityType;
    this.set(n, 'entityKind', t.kind); this.set(n, 'entityDomain', t.domain); this.set(n, 'entityCountry', t.country); this.set(n, 'entityCategory', t.category);
    this.set(n, 'entitySubcategory', t.subcategory); this.set(n, 'entitySpecific', t.specific); this.set(n, 'entityExtra', t.extra);
    this.set(n, 'forceID', pdu.forceID); this.set(n, 'marking', pdu.marking.text); this.set(n, 'deadReckoning', alg);
    // Velocity and acceleration are shown in the axes the children are drawn in: scene axes for the world
    // algorithms, model axes (x forward, y up, z right) for the body algorithms.
    const toLocal = drmUsesBody(alg) ? (v) => apply(BODY_TO_MODEL, v) : (v) => this.frame.ecefVectorToLocal(v);
    n.linearVelocity = this.vec3f(toLocal(pdu.linearVelocity)); n.linearAcceleration = this.vec3f(toLocal(dr.linearAcceleration));
    const g = ecefToGeodetic(pdu.location);
    n.geoCoords = new X3D.SFVec3d(g[0], g[1], g[2]);
    const vp = pdu.variableParameters;
    this.set(n, 'articulationParameterCount', vp.length);
    if (vp.length || n.articulationParameterArray.length) {
      n.articulationParameterDesignatorArray = new X3D.MFInt32(...vp.map((p) => p.recordType));
      n.articulationParameterChangeIndicatorArray = new X3D.MFInt32(...vp.map((p) => p.changeIndicator));
      n.articulationParameterIdPartAttachedToArray = new X3D.MFInt32(...vp.map((p) => p.partAttachedTo));
      n.articulationParameterTypeArray = new X3D.MFInt32(...vp.map((p) => p.parameterType));
      n.articulationParameterArray = new X3D.MFFloat(...vp.map((p) => p.parameterValue));
      for (let i = 0; i < Math.min(8, vp.length); i++) this.setOutput(n, `articulationParameterValue${i}_changed`, vp[i].parameterValue);
    }
    this.setOutput(n, 'timestamp', timestampToUnixSeconds(pdu.header.timestamp, arrival));
    if (!rec.active) { rec.active = true; this.setOutput(n, 'isActive', true); }
  }

  _applyRadio(rec, pdu, now) {
    const n = rec.node, X3D = this.X3D;
    rec.lastApplied = now; rec.lastPdu = pdu;
    if (rec.type === 'TransmitterPdu') {
      const t = pdu.radioEntityType, m = pdu.modulationType;
      n.antennaLocation = this.vec3f(this.frame.ecefToLocal(pdu.antennaLocation));
      n.relativeAntennaLocation = this.vec3f(apply(BODY_TO_MODEL, pdu.relativeAntennaLocation));
      const g = ecefToGeodetic(pdu.antennaLocation); n.geoCoords = new X3D.SFVec3d(g[0], g[1], g[2]);
      this.set(n, 'antennaPatternLength', pdu.antennaPatternLength); this.set(n, 'antennaPatternType', pdu.antennaPatternType);
      this.set(n, 'cryptoKeyID', pdu.cryptoKeyID); this.set(n, 'cryptoSystem', pdu.cryptoSystem);
      this.set(n, 'frequency', Math.min(INT32_MAX, pdu.frequency)); // the X3D field is SFInt32; the PDU field has 64 bits
      this.set(n, 'inputSource', pdu.inputSource); this.set(n, 'lengthOfModulationParameters', pdu.modulationParametersLength);
      this.set(n, 'modulationTypeDetail', m.detail); this.set(n, 'modulationTypeMajor', m.major); this.set(n, 'modulationTypeSpreadSpectrum', m.spreadSpectrum); this.set(n, 'modulationTypeSystem', m.system);
      this.set(n, 'power', pdu.power);
      this.set(n, 'radioEntityTypeCategory', t.category); this.set(n, 'radioEntityTypeCountry', t.country); this.set(n, 'radioEntityTypeDomain', t.domain); this.set(n, 'radioEntityTypeKind', t.kind);
      this.set(n, 'radioEntityTypeNomenclature', t.nomenclature); this.set(n, 'radioEntityTypeNomenclatureVersion', t.nomenclatureVersion);
      this.set(n, 'transmitFrequencyBandwidth', pdu.transmitFrequencyBandwidth); this.set(n, 'transmitState', pdu.transmitState);
    } else if (rec.type === 'SignalPdu') {
      rec.applying = true;
      this.set(n, 'encodingScheme', pdu.encodingScheme); this.set(n, 'tdlType', pdu.tdlType); this.set(n, 'sampleRate', Math.min(INT32_MAX, pdu.sampleRate));
      this.set(n, 'samples', pdu.samples); this.set(n, 'dataLength', pdu.dataLength);
      n.data = new X3D.MFInt32(...pdu.data); // one value per octet
      rec.applying = false;
    } else {
      this.set(n, 'receiverState', pdu.receiverState); this.set(n, 'receivedPower', pdu.receivedPower);
      this.set(n, 'transmitterSiteID', pdu.transmitterEntityID.site); this.set(n, 'transmitterApplicationID', pdu.transmitterEntityID.application);
      this.set(n, 'transmitterEntityID', pdu.transmitterEntityID.entity); this.set(n, 'transmitterRadioID', pdu.transmitterRadioID);
    }
    this.setOutput(n, 'timestamp', timestampToUnixSeconds(pdu.header.timestamp, now));
    if (!rec.active) { rec.active = true; this.setOutput(n, 'isActive', true); }
  }

  // ---- DISEntityManager and DISEntityTypeMapping -------------------------------------------------------------------------

  // Best match: every non-zero field of a mapping must equal the entity type; the mapping with the most non-zero
  // fields wins; a mapping of all zeros matches anything and loses to any other match.
  pickMapping(manager, type) {
    let best = null, bestScore = -1;
    const kids = manager.node.children;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i];
      if (!m || m.getNodeTypeName() !== 'DISEntityTypeMapping') continue;
      const pairs = [[m.kind, type.kind], [m.domain, type.domain], [m.country, type.country], [m.category, type.category], [m.subcategory, type.subcategory], [m.specific, type.specific], [m.extra, type.extra]];
      if (pairs.some(([a, b]) => a !== 0 && a !== b)) continue;
      const score = pairs.filter(([a]) => a !== 0).length;
      if (score > bestScore) { best = m; bestScore = score; }
    }
    return best;
  }

  _createEntity(manager, pdu, channel) {
    const node = this.scene.createNode('EspduTransform');
    node.siteID = pdu.entityID.site; node.applicationID = pdu.entityID.application; node.entityID = pdu.entityID.entity;
    node.address = channel?.address ?? String(manager.node.address); node.port = channel?.port ?? Number(manager.node.port);
    node.networkMode = 'networkReader';
    const mapping = this.pickMapping(manager, pdu.entityType);
    if (mapping && mapping.url.length) {
      const inline = this.scene.createNode('Inline');
      inline.url = mapping.url;
      node.children = new this.X3D.MFNode(inline);
    }
    const rec = this._adoptEspdu(node, manager);
    rec.mapping = mapping;
    manager.entities.set(entityKey(pdu.entityID), rec);
    return rec;
  }

  // ---- the clock ------------------------------------------------------------------------------------------------------------

  // Call once per frame. Dead-reckons the readers, times out silent nodes, and lets the writers send.
  tick() {
    const now = this.now(), X3D = this.X3D;
    for (let i = this.espdus.length - 1; i >= 0; i--) {
      const rec = this.espdus[i], n = rec.node, mode = this._modeFlags(rec);
      if (mode === 'networkReader') {
        const interval = Number(n.readInterval);
        if (rec.pending && interval > 0 && now - rec.lastApplied >= interval) this._applyEspdu(rec, now);
        if (rec.active && now - rec.lastHeard > this.heartbeatTimeout) {
          rec.active = false; this.setOutput(n, 'isActive', false);
          if (rec.manager) {
            rec.manager.removed.push(n);
            rec.manager.entities.delete(entityKey({ site: n.siteID, application: n.applicationID, entity: n.entityID }));
            this.espdus.splice(i, 1); this.stats.removed++;
            continue;
          }
        }
        if (rec.state && rec.active) {
          const dt = this.applyDeadReckoning ? Math.max(0, now - rec.tRef) : 0;
          const g = deadReckon(rec.state, dt);
          rec.drEcef = g.location; rec.drMatrix = g.matrix; rec.drAge = now - rec.tRef;
          n.translation = this.vec3f(this.frame.ecefToLocal(g.location));
          const a = matrixToAxisAngle(this.frame.modelToSceneMatrix(g.matrix));
          n.rotation = new X3D.SFRotation(a[0], a[1], a[2], a[3]);
        }
      } else if (mode === 'networkWriter' && n.enabled) {
        this._sampleMotion(rec, now);
        const interval = Number(n.writeInterval);
        if (interval > 0 && now - rec.lastWrite >= interval) { rec.lastWrite = now; this._writeEspdu(rec, now); }
      }
    }
    for (const m of this.managers) {
      if (m.added.length) { this.setOutput(m.node, 'addedEntities', new X3D.MFNode(...m.added)); m.added = []; }
      if (m.removed.length) { this.setOutput(m.node, 'removedEntities', new X3D.MFNode(...m.removed)); m.removed = []; }
    }
    for (const rec of this.radios) {
      const n = rec.node, mode = this._modeFlags(rec);
      if (mode === 'networkReader') {
        const interval = Number(n.readInterval);
        if (rec.pending && interval > 0 && now - rec.lastApplied >= interval) { const p = rec.pending; rec.pending = null; this._applyRadio(rec, p.pdu, now); }
        if (rec.active && now - rec.lastHeard > this.heartbeatTimeout) { rec.active = false; this.setOutput(n, 'isActive', false); }
      } else if (mode === 'networkWriter' && n.enabled) {
        const interval = Number(n.writeInterval);
        if (rec.type === 'SignalPdu') { if (rec.dirty) { rec.dirty = false; this._writeRadio(rec, now); } }
        else if (rec.dirty || (interval > 0 && now - rec.lastWrite >= interval)) { rec.dirty = false; rec.lastWrite = now; this._writeRadio(rec, now); }
      }
    }
  }

  // ---- writing -----------------------------------------------------------------------------------------------------------

  _header(pduType, now) { return { protocolVersion: 7, exerciseID: this.exerciseID, pduType, timestamp: secondsToTimestamp(now % 3600, true), pduStatus: 0 }; }

  _emit(rec, pdu, now) {
    const bytes = encodePdu(pdu);
    rec.written++; this.stats.sent++; this.stats.sentByType[pdu.header.pduType]++;
    this.setOutput(rec.node, 'timestamp', now);
    if (!rec.active) { rec.active = true; this.setOutput(rec.node, 'isActive', true); }
    this.lastPdu[pdu.header.pduType + 100] = { bytes, pdu, time: now, direction: 'sent' };
    for (const l of this.listeners) l(pdu, bytes, 'sent');
    this.onSend(bytes, { address: String(rec.node.address), port: Number(rec.node.port) }, rec.type ?? 'EspduTransform');
    return bytes;
  }

  // A writer whose author left linearVelocity at zero still needs a velocity for dead reckoning, so the runtime
  // measures one from the motion of the translation field (a least-squares slope over the last half second).
  _sampleMotion(rec, now) {
    const t = rec.node.translation;
    rec.samples ??= [];
    rec.samples.push([now, t.x, t.y, t.z]);
    while (rec.samples.length > 2 && now - rec.samples[0][0] > 0.5) rec.samples.shift();
    const s = rec.samples;
    if (s.length < 3) return;
    const n = s.length, mt = s.reduce((a, x) => a + x[0], 0) / n;
    let den = 0; const num = [0, 0, 0], mean = [1, 2, 3].map((k) => s.reduce((a, x) => a + x[k], 0) / n);
    for (const x of s) { den += (x[0] - mt) ** 2; for (let k = 0; k < 3; k++) num[k] += (x[0] - mt) * (x[k + 1] - mean[k]); }
    if (den > 0) rec.estVel = num.map((v) => v / den);
  }

  _writeEspdu(rec, now) {
    const n = rec.node, alg = Number(n.deadReckoning) || 2;
    const tr = n.translation, ro = n.rotation, lv = n.linearVelocity, la = n.linearAcceleration;
    const location = this.frame.localToEcef([tr.x, tr.y, tr.z]);
    const worldToBody = this.frame.worldToBodyFromModelMatrix(axisAngleToMatrix([ro.x, ro.y, ro.z, ro.angle]));
    const given = Math.hypot(lv.x, lv.y, lv.z) > 0;
    const vLocal = given ? [lv.x, lv.y, lv.z] : rec.estVel;
    let velocity = this.frame.localVectorToEcef(vLocal), acceleration = this.frame.localVectorToEcef([la.x, la.y, la.z]);
    if (drmUsesBody(alg)) { velocity = apply(worldToBody, velocity); acceleration = apply(worldToBody, acceleration); }
    const count = Math.min(Number(n.articulationParameterCount), n.articulationParameterArray.length);
    const variableParameters = [];
    for (let i = 0; i < count; i++) variableParameters.push({ recordType: n.articulationParameterDesignatorArray[i] ?? 0, changeIndicator: n.articulationParameterChangeIndicatorArray[i] ?? 0, partAttachedTo: n.articulationParameterIdPartAttachedToArray[i] ?? 0, parameterType: n.articulationParameterTypeArray[i] ?? 0, parameterValue: n.articulationParameterArray[i] });
    const type = { kind: n.entityKind, domain: n.entityDomain, country: n.entityCountry, category: n.entityCategory, subcategory: n.entitySubcategory, specific: n.entitySpecific, extra: n.entityExtra };
    rec.drEcef = location;
    return this._emit(rec, {
      header: this._header(PDU_TYPE.ENTITY_STATE, now), entityID: { site: n.siteID, application: n.applicationID, entity: n.entityID }, forceID: n.forceID,
      entityType: type, alternativeEntityType: type, linearVelocity: alg === 1 ? [0, 0, 0] : velocity, location, orientation: matrixToEuler(worldToBody), appearance: 0,
      deadReckoning: { algorithm: alg, linearAcceleration: acceleration, angularVelocity: [0, 0, 0] }, marking: { characterSet: 1, text: String(n.marking) }, capabilities: 0, variableParameters,
    }, now);
  }

  _writeRadio(rec, now) {
    const n = rec.node, id = { site: n.siteID, application: n.applicationID, entity: n.entityID };
    if (rec.type === 'TransmitterPdu') {
      const a = n.antennaLocation, r = n.relativeAntennaLocation;
      return this._emit(rec, {
        header: this._header(PDU_TYPE.TRANSMITTER, now), entityID: id, radioID: n.radioID,
        radioEntityType: { kind: n.radioEntityTypeKind, domain: n.radioEntityTypeDomain, country: n.radioEntityTypeCountry, category: n.radioEntityTypeCategory, nomenclatureVersion: n.radioEntityTypeNomenclatureVersion, nomenclature: n.radioEntityTypeNomenclature },
        transmitState: n.transmitState, inputSource: n.inputSource, antennaLocation: this.frame.localToEcef([a.x, a.y, a.z]), relativeAntennaLocation: apply(MODEL_TO_BODY, [r.x, r.y, r.z]),
        antennaPatternType: n.antennaPatternType, frequency: n.frequency, transmitFrequencyBandwidth: n.transmitFrequencyBandwidth, power: n.power,
        modulationType: { spreadSpectrum: n.modulationTypeSpreadSpectrum, major: n.modulationTypeMajor, detail: n.modulationTypeDetail, system: n.modulationTypeSystem }, cryptoSystem: n.cryptoSystem, cryptoKeyID: n.cryptoKeyID,
      }, now);
    }
    if (rec.type === 'SignalPdu') {
      const d = n.data, data = new Uint8Array(d.length);
      for (let i = 0; i < d.length; i++) data[i] = d[i] & 0xff;
      return this._emit(rec, { header: this._header(PDU_TYPE.SIGNAL, now), entityID: id, radioID: n.radioID, encodingScheme: n.encodingScheme, tdlType: n.tdlType, sampleRate: n.sampleRate, samples: n.samples, dataLength: n.dataLength || data.length * 8, data }, now);
    }
    return this._emit(rec, {
      header: this._header(PDU_TYPE.RECEIVER, now), entityID: id, radioID: n.radioID, receiverState: n.receiverState, receivedPower: n.receivedPower,
      transmitterEntityID: { site: n.transmitterSiteID, application: n.transmitterApplicationID, entity: n.transmitterEntityID }, transmitterRadioID: n.transmitterRadioID,
    }, now);
  }

  // ---- for displays and tests ---------------------------------------------------------------------------------------------

  entityRecord(site, application, entity) { return this.espdus.find((r) => r.node.siteID === site && r.node.applicationID === application && r.node.entityID === entity) ?? null; }
  radioRecord(type, entity, radioID = 1) { return this.radios.find((r) => r.type === type && r.node.entityID === entity && r.node.radioID === radioID) ?? null; }
}
