// dis-codec.js: decode and encode IEEE 1278.1 (DIS) PDUs. No dependencies. ES module for browsers and Node.
//
// Covered PDU types: Entity State (1), Transmitter (25), Signal (26), Receiver (27).
// Header versions: DIS 6 (IEEE 1278.1a-1998) and DIS 7 (IEEE 1278.1-2012). The two differ, for these four PDUs, in
// the last two header octets (padding in 6; PDU status and padding in 7) and in one Transmitter field (padding in 6;
// the count of variable transmitter parameters in 7). All multi-octet fields are big-endian.
//
// The layouts below were written from the field tables of the standard and then checked, field for field, against
// two independent open implementations (see ../tests/crosscheck_opendis.py and ../tests/crosscheck-open-dis-js.test.js).

export const PDU_TYPE = Object.freeze({ ENTITY_STATE: 1, TRANSMITTER: 25, SIGNAL: 26, RECEIVER: 27 });
export const PDU_TYPE_NAME = Object.freeze({ 1: 'Entity State', 25: 'Transmitter', 26: 'Signal', 27: 'Receiver' });
export const PROTOCOL_FAMILY = Object.freeze({ ENTITY_INFORMATION: 1, RADIO_COMMUNICATIONS: 4 });
export const HEADER_LENGTH = 12;
export const ESPDU_FIXED_LENGTH = 144;
export const TRANSMITTER_FIXED_LENGTH = 104;
export const SIGNAL_FIXED_LENGTH = 32;
export const RECEIVER_LENGTH = 36;

// One timestamp unit is 3600 s / 2^31. The least significant bit says absolute (1, synchronised to UTC) or
// relative (0). The upper 31 bits count units since the top of the hour.
export const TIMESTAMP_UNIT = 3600 / 2147483648;

export class DisDecodeError extends Error {
  constructor(message) { super(message); this.name = 'DisDecodeError'; }
}

export function secondsToTimestamp(secondsPastHour, absolute = true) {
  let s = secondsPastHour % 3600;
  if (s < 0) s += 3600;
  let units = Math.round(s / TIMESTAMP_UNIT);
  if (units >= 2147483648) units = 0; // rounds up into the next hour
  return (units * 2 + (absolute ? 1 : 0)) >>> 0;
}

export function timestampToSeconds(raw) {
  return { seconds: Math.floor(raw / 2) * TIMESTAMP_UNIT, absolute: (raw & 1) === 1 };
}

// Turn a DIS timestamp into seconds since 1970 by attaching it to the hour nearest to `nowUnixSeconds`.
export function timestampToUnixSeconds(raw, nowUnixSeconds) {
  const { seconds } = timestampToSeconds(raw);
  const hour = Math.floor(nowUnixSeconds / 3600) * 3600;
  let t = hour + seconds;
  if (t - nowUnixSeconds > 1800) t -= 3600;
  else if (nowUnixSeconds - t > 1800) t += 3600;
  return t;
}

function toView(bytes) {
  if (bytes instanceof DataView) return bytes;
  if (bytes instanceof ArrayBuffer) return new DataView(bytes);
  if (ArrayBuffer.isView(bytes)) return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new DisDecodeError('expected an ArrayBuffer or a typed array');
}

class Reader {
  constructor(view) { this.v = view; this.o = 0; }
  need(n) { if (this.o + n > this.v.byteLength) throw new DisDecodeError(`PDU is truncated: need ${n} octets at offset ${this.o}, have ${this.v.byteLength - this.o}`); }
  u8() { this.need(1); return this.v.getUint8(this.o++); }
  u16() { this.need(2); const x = this.v.getUint16(this.o); this.o += 2; return x; }
  u32() { this.need(4); const x = this.v.getUint32(this.o); this.o += 4; return x; }
  u64() { this.need(8); const x = this.v.getBigUint64(this.o); this.o += 8; return x; }
  f32() { this.need(4); const x = this.v.getFloat32(this.o); this.o += 4; return x; }
  f64() { this.need(8); const x = this.v.getFloat64(this.o); this.o += 8; return x; }
  bytes(n) { this.need(n); const b = new Uint8Array(this.v.buffer.slice(this.v.byteOffset + this.o, this.v.byteOffset + this.o + n)); this.o += n; return b; }
  vec3f() { return [this.f32(), this.f32(), this.f32()]; }
  vec3d() { return [this.f64(), this.f64(), this.f64()]; }
  get left() { return this.v.byteLength - this.o; }
}

class Writer {
  constructor(n) { this.b = new Uint8Array(n); this.v = new DataView(this.b.buffer); this.o = 0; }
  u8(x) { this.v.setUint8(this.o++, x & 0xff); }
  u16(x) { this.v.setUint16(this.o, x & 0xffff); this.o += 2; }
  u32(x) { this.v.setUint32(this.o, x >>> 0); this.o += 4; }
  u64(x) { this.v.setBigUint64(this.o, BigInt.asUintN(64, typeof x === 'bigint' ? x : BigInt(Math.round(x)))); this.o += 8; }
  f32(x) { this.v.setFloat32(this.o, x); this.o += 4; }
  f64(x) { this.v.setFloat64(this.o, x); this.o += 8; }
  bytes(a) { this.b.set(a, this.o); this.o += a.length; }
  vec3f(a) { this.f32(a[0]); this.f32(a[1]); this.f32(a[2]); }
  vec3d(a) { this.f64(a[0]); this.f64(a[1]); this.f64(a[2]); }
}

// ---- records ---------------------------------------------------------------------------------------------------

function readHeader(r) {
  const h = {
    protocolVersion: r.u8(), exerciseID: r.u8(), pduType: r.u8(), protocolFamily: r.u8(),
    timestamp: r.u32(), length: r.u16(), pduStatus: 0, padding: 0,
  };
  if (h.protocolVersion >= 7) { h.pduStatus = r.u8(); h.padding = r.u8(); } else { h.padding = r.u16(); }
  return h;
}

function writeHeader(w, h, pduType, family, length) {
  const version = h?.protocolVersion ?? 7;
  w.u8(version); w.u8(h?.exerciseID ?? 1); w.u8(pduType); w.u8(family);
  w.u32(h?.timestamp ?? 0); w.u16(length);
  if (version >= 7) { w.u8(h?.pduStatus ?? 0); w.u8(0); } else { w.u16(0); }
}

const readEntityID = (r) => ({ site: r.u16(), application: r.u16(), entity: r.u16() });
const writeEntityID = (w, e) => { w.u16(e?.site ?? 0); w.u16(e?.application ?? 0); w.u16(e?.entity ?? 0); };

const readEntityType = (r) => ({ kind: r.u8(), domain: r.u8(), country: r.u16(), category: r.u8(), subcategory: r.u8(), specific: r.u8(), extra: r.u8() });
const writeEntityType = (w, t) => { w.u8(t?.kind ?? 0); w.u8(t?.domain ?? 0); w.u16(t?.country ?? 0); w.u8(t?.category ?? 0); w.u8(t?.subcategory ?? 0); w.u8(t?.specific ?? 0); w.u8(t?.extra ?? 0); };

function readMarking(r) {
  const characterSet = r.u8(); const raw = r.bytes(11);
  let end = raw.indexOf(0); if (end < 0) end = 11;
  return { characterSet, text: String.fromCharCode(...raw.subarray(0, end)) };
}
function writeMarking(w, m) {
  w.u8(m?.characterSet ?? 1); // 1 is ASCII
  const text = String(m?.text ?? '');
  for (let i = 0; i < 11; i++) w.u8(i < text.length ? text.charCodeAt(i) & 0x7f : 0);
}

// A variable parameter record is 16 octets. Record type 0 is an articulated part: change indicator, the part it is
// attached to, the parameter type (part class plus type metric) and a 32-bit float value followed by 32 zero bits.
// Record type 1 is an attached part: detached indicator, the part it is attached to, the station and an entity type.
function readVariableParameter(r) {
  const raw = r.bytes(16); const v = new DataView(raw.buffer);
  const p = { recordType: v.getUint8(0), changeIndicator: v.getUint8(1), partAttachedTo: v.getUint16(2), parameterType: v.getUint32(4), raw };
  if (p.recordType === 1) {
    p.attachedPartType = { kind: v.getUint8(8), domain: v.getUint8(9), country: v.getUint16(10), category: v.getUint8(12), subcategory: v.getUint8(13), specific: v.getUint8(14), extra: v.getUint8(15) };
    p.parameterValue = 0;
  } else {
    p.parameterValue = v.getFloat32(8);
  }
  return p;
}
function writeVariableParameter(w, p) {
  w.u8(p.recordType ?? 0); w.u8(p.changeIndicator ?? 0); w.u16(p.partAttachedTo ?? 0); w.u32(p.parameterType ?? 0);
  if ((p.recordType ?? 0) === 1) writeEntityType(w, p.attachedPartType);
  else { w.f32(p.parameterValue ?? 0); w.u32(0); }
}

// ---- Entity State PDU (type 1) -----------------------------------------------------------------------------------

function decodeEntityState(r, header) {
  const p = { header, entityID: readEntityID(r), forceID: r.u8() };
  const count = r.u8();
  p.entityType = readEntityType(r);
  p.alternativeEntityType = readEntityType(r);
  p.linearVelocity = r.vec3f();
  p.location = r.vec3d();
  p.orientation = { psi: r.f32(), theta: r.f32(), phi: r.f32() };
  p.appearance = r.u32();
  p.deadReckoning = { algorithm: r.u8(), otherParameters: r.bytes(15), linearAcceleration: r.vec3f(), angularVelocity: r.vec3f() };
  p.marking = readMarking(r);
  p.capabilities = r.u32();
  p.variableParameters = [];
  for (let i = 0; i < count; i++) p.variableParameters.push(readVariableParameter(r));
  return p;
}

function encodeEntityState(p) {
  const params = p.variableParameters ?? [];
  if (params.length > 255) throw new RangeError('an Entity State PDU carries at most 255 variable parameters');
  const length = ESPDU_FIXED_LENGTH + 16 * params.length;
  const w = new Writer(length);
  writeHeader(w, p.header, PDU_TYPE.ENTITY_STATE, PROTOCOL_FAMILY.ENTITY_INFORMATION, length);
  writeEntityID(w, p.entityID); w.u8(p.forceID ?? 0); w.u8(params.length);
  writeEntityType(w, p.entityType); writeEntityType(w, p.alternativeEntityType);
  w.vec3f(p.linearVelocity ?? [0, 0, 0]); w.vec3d(p.location ?? [0, 0, 0]);
  w.f32(p.orientation?.psi ?? 0); w.f32(p.orientation?.theta ?? 0); w.f32(p.orientation?.phi ?? 0);
  w.u32(p.appearance ?? 0);
  const dr = p.deadReckoning ?? {};
  w.u8(dr.algorithm ?? 0);
  const other = new Uint8Array(15); if (dr.otherParameters) other.set(Array.from(dr.otherParameters).slice(0, 15));
  w.bytes(other);
  w.vec3f(dr.linearAcceleration ?? [0, 0, 0]); w.vec3f(dr.angularVelocity ?? [0, 0, 0]);
  writeMarking(w, p.marking); w.u32(p.capabilities ?? 0);
  for (const vp of params) writeVariableParameter(w, vp);
  return w.b;
}

// ---- Transmitter PDU (type 25) -----------------------------------------------------------------------------------

function decodeTransmitter(r, header) {
  const p = { header, entityID: readEntityID(r), radioID: r.u16() };
  p.radioEntityType = { kind: r.u8(), domain: r.u8(), country: r.u16(), category: r.u8(), nomenclatureVersion: r.u8(), nomenclature: r.u16() };
  p.transmitState = r.u8(); p.inputSource = r.u8();
  p.variableTransmitterParameterCount = r.u16(); // padding in DIS 6
  p.antennaLocation = r.vec3d(); p.relativeAntennaLocation = r.vec3f();
  p.antennaPatternType = r.u16(); p.antennaPatternLength = r.u16();
  p.frequencyBig = r.u64(); p.frequency = Number(p.frequencyBig);
  p.transmitFrequencyBandwidth = r.f32(); p.power = r.f32();
  p.modulationType = { spreadSpectrum: r.u16(), major: r.u16(), detail: r.u16(), system: r.u16() };
  p.cryptoSystem = r.u16(); p.cryptoKeyID = r.u16();
  p.modulationParametersLength = r.u8(); r.u16(); r.u8();
  p.modulationParameters = r.bytes(p.modulationParametersLength);
  p.antennaPattern = r.bytes(p.antennaPatternLength);
  p.variableTransmitterParameters = r.bytes(r.left); // DIS 7 records, kept as octets
  return p;
}

function encodeTransmitter(p) {
  const mod = p.modulationParameters ?? new Uint8Array(0), ant = p.antennaPattern ?? new Uint8Array(0), vtp = p.variableTransmitterParameters ?? new Uint8Array(0);
  const length = TRANSMITTER_FIXED_LENGTH + mod.length + ant.length + vtp.length;
  const w = new Writer(length);
  writeHeader(w, p.header, PDU_TYPE.TRANSMITTER, PROTOCOL_FAMILY.RADIO_COMMUNICATIONS, length);
  writeEntityID(w, p.entityID); w.u16(p.radioID ?? 0);
  const t = p.radioEntityType ?? {};
  w.u8(t.kind ?? 0); w.u8(t.domain ?? 0); w.u16(t.country ?? 0); w.u8(t.category ?? 0); w.u8(t.nomenclatureVersion ?? 0); w.u16(t.nomenclature ?? 0);
  w.u8(p.transmitState ?? 0); w.u8(p.inputSource ?? 0);
  w.u16((p.header?.protocolVersion ?? 7) >= 7 ? (p.variableTransmitterParameterCount ?? 0) : 0);
  w.vec3d(p.antennaLocation ?? [0, 0, 0]); w.vec3f(p.relativeAntennaLocation ?? [0, 0, 0]);
  w.u16(p.antennaPatternType ?? 0); w.u16(ant.length);
  w.u64(p.frequencyBig ?? p.frequency ?? 0);
  w.f32(p.transmitFrequencyBandwidth ?? 0); w.f32(p.power ?? 0);
  const m = p.modulationType ?? {};
  w.u16(m.spreadSpectrum ?? 0); w.u16(m.major ?? 0); w.u16(m.detail ?? 0); w.u16(m.system ?? 0);
  w.u16(p.cryptoSystem ?? 0); w.u16(p.cryptoKeyID ?? 0);
  w.u8(mod.length); w.u16(0); w.u8(0);
  w.bytes(mod); w.bytes(ant); w.bytes(vtp);
  return w.b;
}

// ---- Signal PDU (type 26) ----------------------------------------------------------------------------------------

// The encoding scheme is 16 bits: the top two are the encoding class (0 encoded audio, 1 raw binary data,
// 2 application-specific data, 3 database index) and the lower fourteen the encoding type (for audio: 1 is 8-bit
// mu-law, 4 is 16-bit linear PCM big-endian, and so on) or the number of tactical data link messages.
export const encodingClass = (scheme) => (scheme >> 14) & 3;
export const encodingType = (scheme) => scheme & 0x3fff;

function decodeSignal(r, header) {
  const p = { header, entityID: readEntityID(r), radioID: r.u16(), encodingScheme: r.u16(), tdlType: r.u16(), sampleRate: r.u32(), dataLength: r.u16(), samples: r.u16() };
  const n = Math.ceil(p.dataLength / 8);
  p.data = r.bytes(n); // any padding to the 32-bit boundary is left unread
  return p;
}

function encodeSignal(p) {
  const data = p.data ?? new Uint8Array(0);
  const bits = p.dataLength ?? data.length * 8;
  if (bits > 0xffff) throw new RangeError('Signal PDU data length is a 16-bit count of bits');
  const padded = Math.ceil(data.length / 4) * 4;
  const length = SIGNAL_FIXED_LENGTH + padded;
  const w = new Writer(length);
  writeHeader(w, p.header, PDU_TYPE.SIGNAL, PROTOCOL_FAMILY.RADIO_COMMUNICATIONS, length);
  writeEntityID(w, p.entityID); w.u16(p.radioID ?? 0);
  w.u16(p.encodingScheme ?? 0); w.u16(p.tdlType ?? 0); w.u32(p.sampleRate ?? 0); w.u16(bits); w.u16(p.samples ?? 0);
  w.bytes(data);
  return w.b;
}

// ---- Receiver PDU (type 27) --------------------------------------------------------------------------------------

function decodeReceiver(r, header) {
  const p = { header, entityID: readEntityID(r), radioID: r.u16(), receiverState: r.u16() };
  r.u16();
  p.receivedPower = r.f32();
  p.transmitterEntityID = readEntityID(r);
  p.transmitterRadioID = r.u16();
  return p;
}

function encodeReceiver(p) {
  const w = new Writer(RECEIVER_LENGTH);
  writeHeader(w, p.header, PDU_TYPE.RECEIVER, PROTOCOL_FAMILY.RADIO_COMMUNICATIONS, RECEIVER_LENGTH);
  writeEntityID(w, p.entityID); w.u16(p.radioID ?? 0);
  w.u16(p.receiverState ?? 0); w.u16(0); w.f32(p.receivedPower ?? 0);
  writeEntityID(w, p.transmitterEntityID); w.u16(p.transmitterRadioID ?? 0);
  return w.b;
}

// ---- public API --------------------------------------------------------------------------------------------------

export function decodeHeader(bytes) {
  const r = new Reader(toView(bytes));
  if (r.left < HEADER_LENGTH) throw new DisDecodeError(`a PDU header is 12 octets, got ${r.left}`);
  return readHeader(r);
}

// Decode one PDU. Returns an object with `header` and the fields of the PDU. A PDU of another type comes back as
// { header, unsupported: true }. Throws DisDecodeError when the octets are too short for their own type.
export function decodePdu(bytes) {
  const view = toView(bytes);
  const r = new Reader(view);
  if (r.left < HEADER_LENGTH) throw new DisDecodeError(`a PDU header is 12 octets, got ${r.left}`);
  const header = readHeader(r);
  if (header.protocolVersion < 5 || header.protocolVersion > 7) throw new DisDecodeError(`unsupported DIS protocol version ${header.protocolVersion}`);
  switch (header.pduType) {
    case PDU_TYPE.ENTITY_STATE: return decodeEntityState(r, header);
    case PDU_TYPE.TRANSMITTER: return decodeTransmitter(r, header);
    case PDU_TYPE.SIGNAL: return decodeSignal(r, header);
    case PDU_TYPE.RECEIVER: return decodeReceiver(r, header);
    default: return { header, unsupported: true };
  }
}

// Encode one PDU from the object shape that decodePdu returns. `header.pduType` picks the type; the length field
// and the protocol family are computed here.
export function encodePdu(pdu) {
  switch (pdu?.header?.pduType) {
    case PDU_TYPE.ENTITY_STATE: return encodeEntityState(pdu);
    case PDU_TYPE.TRANSMITTER: return encodeTransmitter(pdu);
    case PDU_TYPE.SIGNAL: return encodeSignal(pdu);
    case PDU_TYPE.RECEIVER: return encodeReceiver(pdu);
    default: throw new RangeError(`cannot encode PDU type ${pdu?.header?.pduType}`);
  }
}

export const entityKey = (id) => `${id.site}:${id.application}:${id.entity}`;

export function hexDump(bytes, perLine = 16) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const lines = [];
  for (let i = 0; i < b.length; i += perLine) {
    const row = Array.from(b.subarray(i, i + perLine), (x) => x.toString(16).padStart(2, '0'));
    lines.push(i.toString(16).padStart(4, '0') + '  ' + row.join(' '));
  }
  return lines.join('\n');
}

// Flatten a decoded PDU into [name, value] rows for display.
export function describePdu(pdu) {
  const rows = [];
  const fmt = (v) => {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : (Math.abs(v) >= 1e5 ? v.toFixed(3) : v.toPrecision(7).replace(/\.?0+$/, ''));
    return String(v);
  };
  const walk = (prefix, v) => {
    if (v instanceof Uint8Array) { rows.push([prefix, v.length ? `${v.length} octets` : 'none']); return; }
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x === 'number')) rows.push([prefix, v.map(fmt).join('  ')]);
      else v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
      return;
    }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) { if (k !== 'raw' && k !== 'frequencyBig') walk(prefix ? `${prefix}.${k}` : k, v[k]); } return; }
    rows.push([prefix, fmt(v)]);
  };
  walk('', pdu);
  return rows;
}
