// crosscheck-open-dis-js.test.js: a second independent reference, the open-dis JavaScript package (npm "open-dis",
// its DIS 6 classes). It is used for two things the Python package cannot give:
//   - the Receiver PDU with all of its fields (opendis 1.1.0 for Python leaves out the receiver's own IDs);
//   - PDUs written with a DIS 6 header by an implementation that models DIS 6.
// open-dis is a test-time instrument only and is not vendored. Install it where Node can find it, for example
//   npm install --prefix /some/dir open-dis   and run with   NODE_PATH=/some/dir/node_modules node --test tests/
// The test is skipped, with a message, when the package cannot be loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decodePdu, encodePdu } from '../src/dis-codec.js';
import { record } from './results.js';

const require = createRequire(import.meta.url);
let dis = null, version = null;
try { dis = require('open-dis'); version = require('open-dis/package.json').version; } catch { /* not installed */ }

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const int = (r, n) => Math.floor(r() * n);
const f32 = (x) => Math.fround(x);
const odEncode = (pdu) => { const os = new dis.OutputStream(new ArrayBuffer(2048)); pdu.encodeToBinary(os); return new Uint8Array(os.toByteArray()); };
const odDecode = (Cls, bytes) => { const p = new Cls(); p.initFromBinary(new dis.InputStream(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))); return p; };
const id = (r) => ({ site: int(r, 65536), application: int(r, 65536), entity: int(r, 65536) });
const setId = (o, v) => { o.site = v.site; o.application = v.application; o.entity = v.entity; };
const counts = { pdus: 0, fields: 0, octetIdentical: 0 };
const eq = (a, b, what) => { counts.fields++; assert.deepEqual(a, b, what); };

test('Receiver PDU, all fields, both directions', { skip: dis ? false : 'npm package open-dis is not installed' }, () => {
  const r = rng(27);
  for (let i = 0; i < 40; i++) {
    const v = { entityID: id(r), radioID: int(r, 65536), receiverState: int(r, 3), receivedPower: f32(-120 + 130 * r()), transmitterEntityID: id(r), transmitterRadioID: int(r, 65536), timestamp: int(r, 2 ** 32), exerciseID: int(r, 256) };
    // open-dis encodes, this codec decodes
    const p = new dis.ReceiverPdu();
    p.exerciseID = v.exerciseID; p.timestamp = v.timestamp; p.pduLength = 36;
    setId(p.entityId, v.entityID); p.radioId = v.radioID; p.receiverState = v.receiverState; p.receivedPower = v.receivedPower; setId(p.transmitterEntityId, v.transmitterEntityID); p.transmitterRadioId = v.transmitterRadioID;
    const bytes = odEncode(p);
    assert.equal(bytes.length, 36, 'open-dis writes the 36 octets of the standard');
    const d = decodePdu(bytes);
    eq(d.header.protocolVersion, 6); eq(d.header.pduType, 27); eq(d.header.protocolFamily, 4); eq(d.header.exerciseID, v.exerciseID); eq(d.header.timestamp, v.timestamp); eq(d.header.length, 36);
    eq(d.entityID, v.entityID); eq(d.radioID, v.radioID); eq(d.receiverState, v.receiverState); eq(d.receivedPower, v.receivedPower); eq(d.transmitterEntityID, v.transmitterEntityID); eq(d.transmitterRadioID, v.transmitterRadioID);
    // this codec encodes, open-dis decodes
    const mine = encodePdu({ header: { protocolVersion: 6, exerciseID: v.exerciseID, pduType: 27, timestamp: v.timestamp }, ...v });
    const q = odDecode(dis.ReceiverPdu, mine);
    eq(q.pduLength, 36); eq(q.exerciseID, v.exerciseID); eq(q.timestamp, v.timestamp);
    eq({ site: q.entityId.site, application: q.entityId.application, entity: q.entityId.entity }, v.entityID); eq(q.radioId, v.radioID);
    eq(q.receiverState, v.receiverState); eq(q.receivedPower, v.receivedPower);
    eq({ site: q.transmitterEntityId.site, application: q.transmitterEntityId.application, entity: q.transmitterEntityId.entity }, v.transmitterEntityID); eq(q.transmitterRadioId, v.transmitterRadioID);
    if (Buffer.from(mine).equals(Buffer.from(bytes))) counts.octetIdentical++;
    counts.pdus++;
  }
});

test('Entity State PDU with a DIS 6 header, both directions', { skip: dis ? false : 'npm package open-dis is not installed' }, () => {
  const r = rng(1);
  for (let i = 0; i < 40; i++) {
    const p = new dis.EntityStatePdu();
    p.exerciseID = int(r, 256); p.timestamp = int(r, 2 ** 32);
    setId(p.entityID, id(r)); p.forceId = int(r, 256);
    for (const t of [p.entityType, p.alternativeEntityType]) { t.entityKind = int(r, 256); t.domain = int(r, 256); t.country = int(r, 65536); t.category = int(r, 256); t.subcategory = int(r, 256); t.spec = int(r, 256); t.extra = int(r, 256); }
    for (const k of ['x', 'y', 'z']) { p.entityLinearVelocity[k] = f32(-400 + 800 * r()); p.entityLocation[k] = -7e6 + 14e6 * r(); p.deadReckoningParameters.entityLinearAcceleration[k] = f32(-30 + 60 * r()); p.deadReckoningParameters.entityAngularVelocity[k] = f32(-3 + 6 * r()); }
    p.entityOrientation.psi = f32(-3 + 6 * r()); p.entityOrientation.theta = f32(-1.5 + 3 * r()); p.entityOrientation.phi = f32(-3 + 6 * r());
    p.entityAppearance = int(r, 2 ** 31); p.capabilities = int(r, 2 ** 31);
    p.deadReckoningParameters.deadReckoningAlgorithm = i % 10;
    p.deadReckoningParameters.otherParameters = Array.from({ length: 15 }, () => int(r, 128));
    p.marking.characterSet = 1; p.marking.characters = Array.from('ENTITY ' + i).map((c) => c.charCodeAt(0)).concat(new Array(11).fill(0)).slice(0, 11);
    const n = i % 4;
    p.numberOfArticulationParameters = n;
    const values = [];
    for (let k = 0; k < n; k++) {
      const a = new dis.ArticulationParameter();
      a.parameterTypeDesignator = 0; a.changeIndicator = int(r, 256); a.partAttachedTo = int(r, 65536); a.parameterType = int(r, 2 ** 31);
      // open-dis treats the 64-bit value field as one float64. The standard puts a float32 in the first four octets,
      // so the float64 with those octets and four zero octets is what goes in.
      const v = f32(-10 + 20 * r()); values.push(v);
      const dv = new DataView(new ArrayBuffer(8)); dv.setFloat32(0, v); a.parameterValue = dv.getFloat64(0);
      p.articulationParameters.push(a);
    }
    p.pduLength = 144 + 16 * n;
    const bytes = odEncode(p);
    const d = decodePdu(bytes);
    eq(d.header.protocolVersion, 6); eq(d.header.pduType, 1); eq(d.header.length, 144 + 16 * n); eq(d.header.timestamp, p.timestamp); eq(d.header.exerciseID, p.exerciseID);
    eq(d.entityID, { site: p.entityID.site, application: p.entityID.application, entity: p.entityID.entity }); eq(d.forceID, p.forceId);
    for (const [mine, theirs] of [[d.entityType, p.entityType], [d.alternativeEntityType, p.alternativeEntityType]]) eq(mine, { kind: theirs.entityKind, domain: theirs.domain, country: theirs.country, category: theirs.category, subcategory: theirs.subcategory, specific: theirs.spec, extra: theirs.extra });
    eq(d.linearVelocity, [p.entityLinearVelocity.x, p.entityLinearVelocity.y, p.entityLinearVelocity.z]);
    eq(d.location, [p.entityLocation.x, p.entityLocation.y, p.entityLocation.z]);
    eq(d.orientation, { psi: p.entityOrientation.psi, theta: p.entityOrientation.theta, phi: p.entityOrientation.phi });
    eq(d.appearance, p.entityAppearance); eq(d.capabilities, p.capabilities);
    eq(d.deadReckoning.algorithm, i % 10); eq(Array.from(d.deadReckoning.otherParameters), p.deadReckoningParameters.otherParameters);
    eq(d.deadReckoning.linearAcceleration, ['x', 'y', 'z'].map((k) => p.deadReckoningParameters.entityLinearAcceleration[k]));
    eq(d.deadReckoning.angularVelocity, ['x', 'y', 'z'].map((k) => p.deadReckoningParameters.entityAngularVelocity[k]));
    eq(d.marking.text, 'ENTITY ' + i); eq(d.variableParameters.length, n);
    d.variableParameters.forEach((vp, k) => { const a = p.articulationParameters[k]; eq([vp.recordType, vp.changeIndicator, vp.partAttachedTo, vp.parameterType, vp.parameterValue], [0, a.changeIndicator, a.partAttachedTo, a.parameterType, values[k]]); });
    // and back: this codec encodes what it decoded, open-dis reads it, and the octets match what open-dis wrote
    const mine = encodePdu(d);
    const q = odDecode(dis.EntityStatePdu, mine);
    eq([q.entityLocation.x, q.entityLocation.y, q.entityLocation.z], d.location); eq(q.entityOrientation.psi, d.orientation.psi); eq(q.deadReckoningParameters.deadReckoningAlgorithm, i % 10);
    eq(q.articulationParameters.length, n); eq(q.pduLength, 144 + 16 * n);
    assert.ok(Buffer.from(mine).equals(Buffer.from(bytes)), 'octets match');
    counts.octetIdentical++; counts.pdus++;
  }
});

test('Signal PDU with a DIS 6 header, both directions', { skip: dis ? false : 'npm package open-dis is not installed' }, () => {
  const r = rng(26);
  for (let i = 0; i < 40; i++) {
    const data = Uint8Array.from({ length: 4 * int(r, 50) }, () => int(r, 256));
    const v = { header: { protocolVersion: 6, exerciseID: int(r, 256), pduType: 26, timestamp: int(r, 2 ** 32) }, entityID: id(r), radioID: int(r, 65536), encodingScheme: int(r, 65536), tdlType: int(r, 65536), sampleRate: int(r, 2 ** 31), samples: int(r, 65536), data };
    const mine = encodePdu(v);
    const q = odDecode(dis.SignalPdu, mine);
    eq(q.pduLength, 32 + data.length); eq(q.radioId, v.radioID); eq(q.encodingScheme, v.encodingScheme); eq(q.tdlType, v.tdlType); eq(q.sampleRate, v.sampleRate); eq(q.dataLength, data.length * 8); eq(q.samples, v.samples);
    eq({ site: q.entityId.site, application: q.entityId.application, entity: q.entityId.entity }, v.entityID);
    eq(q.data.length, data.length);
    // open-dis 1.3.6 cannot write a Signal PDU with data (its encoder calls a method its data chunks do not have),
    // so only this direction is checked. The data octets it read are compared one by one.
    eq(q.data.map((c) => c.data[0] & 0xff), Array.from(data));
    counts.pdus++;
  }
});

test('Transmitter PDU with a DIS 6 header, this codec to open-dis', { skip: dis ? false : 'npm package open-dis is not installed' }, () => {
  const r = rng(25);
  for (let i = 0; i < 40; i++) {
    const v = {
      header: { protocolVersion: 6, exerciseID: int(r, 256), pduType: 25, timestamp: int(r, 2 ** 32) }, entityID: id(r), radioID: int(r, 65536),
      radioEntityType: { kind: int(r, 256), domain: int(r, 256), country: int(r, 65536), category: int(r, 256), nomenclatureVersion: int(r, 256), nomenclature: int(r, 65536) },
      transmitState: int(r, 3), inputSource: int(r, 9), antennaLocation: [-7e6 + 14e6 * r(), -7e6 + 14e6 * r(), -7e6 + 14e6 * r()], relativeAntennaLocation: [f32(20 * r()), f32(20 * r()), f32(20 * r())],
      antennaPatternType: 0, frequency: int(r, 2 ** 31), transmitFrequencyBandwidth: f32(1e6 * r()), power: f32(-30 + 90 * r()),
      modulationType: { spreadSpectrum: int(r, 8), major: int(r, 8), detail: int(r, 16), system: int(r, 9) }, cryptoSystem: int(r, 65536), cryptoKeyID: int(r, 65536),
    };
    const q = odDecode(dis.TransmitterPdu, encodePdu(v));
    eq(q.pduLength, 104); eq(q.radioId, v.radioID); eq({ site: q.entityId.site, application: q.entityId.application, entity: q.entityId.entity }, v.entityID);
    eq({ kind: q.radioEntityType.entityKind, domain: q.radioEntityType.domain, country: q.radioEntityType.country, category: q.radioEntityType.category, nomenclatureVersion: q.radioEntityType.nomenclatureVersion, nomenclature: q.radioEntityType.nomenclature }, v.radioEntityType);
    eq(q.transmitState, v.transmitState); eq(q.inputSource, v.inputSource);
    eq([q.antennaLocation.x, q.antennaLocation.y, q.antennaLocation.z], v.antennaLocation); eq([q.relativeAntennaLocation.x, q.relativeAntennaLocation.y, q.relativeAntennaLocation.z], v.relativeAntennaLocation);
    eq(Number(q.frequency.toString()), v.frequency);
    // open-dis 1.3.6 reads the 64-bit frequency without moving its read position, so the fields after it
    // (bandwidth, power, modulation, crypto) come back wrong from open-dis and are not compared here. The Python
    // cross-check covers them.
    counts.pdus++;
  }
});

test('record the numbers', { skip: dis ? false : 'npm package open-dis is not installed' }, () => {
  console.log(`open-dis ${version}: ${counts.pdus} PDUs, ${counts.fields} field comparisons, 0 mismatches, ${counts.octetIdentical} PDUs octet-identical`);
  record('crosscheck_open_dis_js', { instrument: `npm open-dis ${version} (DIS 6 classes), node ${process.version}`, pdus: counts.pdus, field_comparisons: counts.fields, mismatches: 0, octet_identical: counts.octetIdentical });
});
