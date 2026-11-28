// codec.test.js: the PDU codec on its own, with no other implementation involved.
// Octet offsets in the hand-built PDUs below are typed from the field tables of IEEE 1278.1 and do not use the
// codec's own writer.   Run:  node --test tests/codec.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePdu, encodePdu, decodeHeader, DisDecodeError, secondsToTimestamp, timestampToSeconds, timestampToUnixSeconds, TIMESTAMP_UNIT, hexDump, describePdu, encodingClass, encodingType } from '../src/dis-codec.js';
import { muLawEncode, muLawDecode } from '../src/dis-signal.js';
import { record } from './results.js';

const sample = {
  espdu: (version) => ({
    header: { protocolVersion: version, exerciseID: 3, pduType: 1, timestamp: 0x12345679, pduStatus: version === 7 ? 5 : 0 },
    entityID: { site: 1, application: 2, entity: 3 }, forceID: 1,
    entityType: { kind: 1, domain: 2, country: 225, category: 1, subcategory: 3, specific: 4, extra: 5 },
    alternativeEntityType: { kind: 1, domain: 2, country: 222, category: 6, subcategory: 7, specific: 8, extra: 9 },
    linearVelocity: [1.5, -2.25, 3.125], location: [4429530.123456, -4429530.5, 123456.789], orientation: { psi: 0.5, theta: -0.25, phi: 0.125 },
    appearance: 0x00400000, deadReckoning: { algorithm: 4, otherParameters: new Uint8Array(15).fill(7), linearAcceleration: [0.5, 0.25, -0.125], angularVelocity: [0.0625, -0.5, 0.75] },
    marking: { characterSet: 1, text: 'KITE 01' }, capabilities: 9,
    variableParameters: [{ recordType: 0, changeIndicator: 2, partAttachedTo: 0, parameterType: 4107, parameterValue: 0.75 }, { recordType: 1, changeIndicator: 0, partAttachedTo: 1, parameterType: 896, attachedPartType: { kind: 2, domain: 1, country: 225, category: 1, subcategory: 2, specific: 3, extra: 4 } }],
  }),
};

test('Entity State PDU matches a hand-built octet layout', () => {
  const b = new Uint8Array(144 + 32), v = new DataView(b.buffer);
  v.setUint8(0, 7); v.setUint8(1, 3); v.setUint8(2, 1); v.setUint8(3, 1); v.setUint32(4, 0x12345679); v.setUint16(8, 176); v.setUint8(10, 5); v.setUint8(11, 0);
  v.setUint16(12, 1); v.setUint16(14, 2); v.setUint16(16, 3); v.setUint8(18, 1); v.setUint8(19, 2);
  v.setUint8(20, 1); v.setUint8(21, 2); v.setUint16(22, 225); v.setUint8(24, 1); v.setUint8(25, 3); v.setUint8(26, 4); v.setUint8(27, 5);
  v.setUint8(28, 1); v.setUint8(29, 2); v.setUint16(30, 222); v.setUint8(32, 6); v.setUint8(33, 7); v.setUint8(34, 8); v.setUint8(35, 9);
  v.setFloat32(36, 1.5); v.setFloat32(40, -2.25); v.setFloat32(44, 3.125);
  v.setFloat64(48, 4429530.123456); v.setFloat64(56, -4429530.5); v.setFloat64(64, 123456.789);
  v.setFloat32(72, 0.5); v.setFloat32(76, -0.25); v.setFloat32(80, 0.125);
  v.setUint32(84, 0x00400000);
  v.setUint8(88, 4); for (let i = 0; i < 15; i++) v.setUint8(89 + i, 7);
  v.setFloat32(104, 0.5); v.setFloat32(108, 0.25); v.setFloat32(112, -0.125);
  v.setFloat32(116, 0.0625); v.setFloat32(120, -0.5); v.setFloat32(124, 0.75);
  v.setUint8(128, 1); Array.from('KITE 01').forEach((c, i) => v.setUint8(129 + i, c.charCodeAt(0)));
  v.setUint32(140, 9);
  v.setUint8(144, 0); v.setUint8(145, 2); v.setUint16(146, 0); v.setUint32(148, 4107); v.setFloat32(152, 0.75);
  v.setUint8(160, 1); v.setUint8(161, 0); v.setUint16(162, 1); v.setUint32(164, 896); v.setUint8(168, 2); v.setUint8(169, 1); v.setUint16(170, 225); v.setUint8(172, 1); v.setUint8(173, 2); v.setUint8(174, 3); v.setUint8(175, 4);
  const mine = encodePdu(sample.espdu(7));
  assert.deepEqual(Array.from(mine), Array.from(b));
  const d = decodePdu(b);
  assert.equal(d.location[0], 4429530.123456); assert.equal(d.marking.text, 'KITE 01'); assert.equal(d.deadReckoning.algorithm, 4);
  assert.equal(d.variableParameters[0].parameterValue, 0.75); assert.deepEqual(d.variableParameters[1].attachedPartType.country, 225);
  assert.equal(d.header.pduStatus, 5); assert.equal(d.header.length, 176);
});

test('Receiver PDU matches a hand-built octet layout of 36 octets', () => {
  const b = new Uint8Array(36), v = new DataView(b.buffer);
  v.setUint8(0, 7); v.setUint8(1, 1); v.setUint8(2, 27); v.setUint8(3, 4); v.setUint32(4, 99); v.setUint16(8, 36);
  v.setUint16(12, 1); v.setUint16(14, 1); v.setUint16(16, 2); v.setUint16(18, 1); v.setUint16(20, 2); v.setFloat32(24, -71.5); v.setUint16(28, 1); v.setUint16(30, 1); v.setUint16(32, 1); v.setUint16(34, 1);
  const p = { header: { protocolVersion: 7, exerciseID: 1, pduType: 27, timestamp: 99 }, entityID: { site: 1, application: 1, entity: 2 }, radioID: 1, receiverState: 2, receivedPower: -71.5, transmitterEntityID: { site: 1, application: 1, entity: 1 }, transmitterRadioID: 1 };
  assert.deepEqual(Array.from(encodePdu(p)), Array.from(b));
  assert.deepEqual(decodePdu(b).transmitterEntityID, { site: 1, application: 1, entity: 1 });
});

test('Transmitter and Signal PDUs match hand-built layouts', () => {
  const t = new Uint8Array(104), v = new DataView(t.buffer);
  v.setUint8(0, 7); v.setUint8(1, 1); v.setUint8(2, 25); v.setUint8(3, 4); v.setUint32(4, 7); v.setUint16(8, 104);
  v.setUint16(12, 1); v.setUint16(14, 1); v.setUint16(16, 1); v.setUint16(18, 1);
  v.setUint8(20, 7); v.setUint8(21, 2); v.setUint16(22, 0); v.setUint8(24, 1); v.setUint8(25, 2); v.setUint16(26, 300);
  v.setUint8(28, 2); v.setUint8(29, 1); v.setUint16(30, 0);
  v.setFloat64(32, 1.5); v.setFloat64(40, 2.5); v.setFloat64(48, 3.5); v.setFloat32(56, 1); v.setFloat32(60, 2); v.setFloat32(64, 3);
  v.setUint16(68, 0); v.setUint16(70, 0); v.setBigUint64(72, 305000000n); v.setFloat32(80, 25000); v.setFloat32(84, 40);
  v.setUint16(88, 0); v.setUint16(90, 3); v.setUint16(92, 1); v.setUint16(94, 1); v.setUint16(96, 0); v.setUint16(98, 0); v.setUint8(100, 0);
  const tx = { header: { protocolVersion: 7, exerciseID: 1, pduType: 25, timestamp: 7 }, entityID: { site: 1, application: 1, entity: 1 }, radioID: 1, radioEntityType: { kind: 7, domain: 2, country: 0, category: 1, nomenclatureVersion: 2, nomenclature: 300 }, transmitState: 2, inputSource: 1, antennaLocation: [1.5, 2.5, 3.5], relativeAntennaLocation: [1, 2, 3], frequency: 305000000, transmitFrequencyBandwidth: 25000, power: 40, modulationType: { spreadSpectrum: 0, major: 3, detail: 1, system: 1 } };
  assert.deepEqual(Array.from(encodePdu(tx)), Array.from(t));
  assert.equal(decodePdu(t).frequency, 305000000);

  const s = new Uint8Array(32 + 8), w = new DataView(s.buffer);
  w.setUint8(0, 7); w.setUint8(1, 1); w.setUint8(2, 26); w.setUint8(3, 4); w.setUint32(4, 7); w.setUint16(8, 40);
  w.setUint16(12, 1); w.setUint16(14, 1); w.setUint16(16, 1); w.setUint16(18, 1); w.setUint16(20, 1); w.setUint16(22, 0); w.setUint32(24, 8000); w.setUint16(28, 40); w.setUint16(30, 5);
  [10, 20, 30, 40, 50].forEach((x, i) => w.setUint8(32 + i, x));
  const sig = { header: { protocolVersion: 7, exerciseID: 1, pduType: 26, timestamp: 7 }, entityID: { site: 1, application: 1, entity: 1 }, radioID: 1, encodingScheme: 1, tdlType: 0, sampleRate: 8000, samples: 5, data: Uint8Array.from([10, 20, 30, 40, 50]) };
  assert.deepEqual(Array.from(encodePdu(sig)), Array.from(s), 'five data octets are padded to eight');
  const d = decodePdu(s);
  assert.equal(d.dataLength, 40); assert.deepEqual(Array.from(d.data), [10, 20, 30, 40, 50]);
  assert.equal(encodingClass(1), 0); assert.equal(encodingType(1), 1); assert.equal(encodingClass(0x4000 | 5), 1);
});

test('round trip for both header versions', () => {
  for (const version of [6, 7]) {
    const p = sample.espdu(version);
    const d = decodePdu(encodePdu(p));
    assert.equal(d.header.protocolVersion, version);
    assert.deepEqual(Array.from(encodePdu(d)), Array.from(encodePdu(p)));
    const bytes = encodePdu(p);
    assert.equal(bytes[10], version === 7 ? 5 : 0, 'octet 10 is PDU status in DIS 7 and padding in DIS 6');
  }
});

test('bad input is refused with a reason', () => {
  assert.throws(() => decodePdu(new Uint8Array(5)), DisDecodeError);
  assert.throws(() => decodePdu(encodePdu(sample.espdu(7)).subarray(0, 100)), /truncated/);
  const other = new Uint8Array(12); other[0] = 7; other[2] = 2;
  assert.equal(decodePdu(other).unsupported, true);
  other[0] = 99; assert.throws(() => decodePdu(other), /version/);
  assert.equal(decodeHeader(encodePdu(sample.espdu(6))).pduType, 1);
});

test('timestamps', () => {
  assert.equal(TIMESTAMP_UNIT, 3600 / 2 ** 31);
  const raw = secondsToTimestamp(1800, true);
  assert.equal(raw, 0x80000001);
  assert.deepEqual(timestampToSeconds(raw), { seconds: 1800, absolute: true });
  assert.equal(timestampToSeconds(secondsToTimestamp(12.5, false)).absolute, false);
  let worst = 0;
  for (let s = 0; s < 3600; s += 7.123) worst = Math.max(worst, Math.abs(timestampToSeconds(secondsToTimestamp(s)).seconds - s));
  assert.ok(worst <= TIMESTAMP_UNIT / 2 + 1e-12);
  // a timestamp taken just before the hour and read just after it lands in the right hour
  const now = 1_800_000_000 + 2; // two seconds past an hour boundary (1.8e9 is a multiple of 3600)
  assert.ok(Math.abs(timestampToUnixSeconds(secondsToTimestamp(3599), now) - (1_800_000_000 - 1)) < 1e-5);
  assert.ok(Math.abs(timestampToUnixSeconds(secondsToTimestamp(1), now) - (1_800_000_000 + 1)) < 1e-5);
});

test('mu-law audio coding round trip', () => {
  let worst = 0;
  for (let x = -32000; x <= 32000; x += 37) { const y = muLawDecode(muLawEncode(x)); worst = Math.max(worst, Math.abs(y - x) / Math.max(256, Math.abs(x))); }
  assert.ok(worst < 0.07, `relative error ${worst}`);
  assert.equal(muLawDecode(muLawEncode(0)), 0);
});

test('display helpers', () => {
  const bytes = encodePdu(sample.espdu(7));
  assert.ok(hexDump(bytes).startsWith('0000  07 03 01 01'));
  assert.ok(describePdu(decodePdu(bytes)).some(([k, v]) => k === 'marking.text' && v === 'KITE 01'));
  record('codec_unit', { instrument: `node ${process.version}`, hand_built_layouts: ['Entity State 176 octets', 'Transmitter 104 octets', 'Signal 40 octets', 'Receiver 36 octets'] });
});
