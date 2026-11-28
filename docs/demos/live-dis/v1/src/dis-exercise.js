// dis-exercise.js: a small scripted exercise that writes real DIS PDUs. No dependencies beyond this folder.
// Every PDU that leaves this module is generated here. No recorded traffic is used anywhere.
//
// The exercise is a pure function of UTC time, so a page that receives these PDUs over a network can compute the
// sender's true state for the same instant and measure the dead-reckoning error against it.
//
// Entities (site 1, application 1), all invented:
//   1  KITE 01    aircraft on a racetrack pattern, 100 m/s, 600 m up, radio 1 sends a Morse tone as Signal PDUs
//   2  ROVER 02   ground vehicle on a circle, 12 m/s, with a turret (two articulated parts) and a radio receiver
//   3  CUTTER 03  ship on a wide circle, 9 m/s, rolling and pitching a little
//   4  HAWK 04    helicopter that sends for 48 s of every 80 s and then goes silent, so that it times out
// The place is an arbitrary point of the Pacific Ocean (36.6 N, 122.5 W). The local frame is a flat tangent plane.

import { encodePdu, decodePdu, secondsToTimestamp, PDU_TYPE } from './dis-codec.js';
import { deadReckon, eulerToMatrix, matrixToEuler, transpose, mul, apply, angleBetween, distance, drmUsesBody, drmUsesAcceleration, drmRotates } from './dis-dr.js';
import { LocalFrame } from './dis-geo.js';
import { morseKeying, toneFrame } from './dis-signal.js';

export const EXERCISE_ORIGIN = Object.freeze({ lat: 36.6, lon: -122.5, h: 0 });
export const EXERCISE_ID = 1;
const SITE = 1, APP = 1;
const G = 9.80665;

const smooth = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

// ---- paths: position as [east, north, up] metres, plus optional roll and pitch ------------------------------------------

const TRACK = { straight: 2000, radius: 600, speed: 100, height: 600 };
TRACK.perimeter = 2 * TRACK.straight + 2 * Math.PI * TRACK.radius;
TRACK.period = TRACK.perimeter / TRACK.speed;
TRACK.bank = Math.atan(TRACK.speed ** 2 / (TRACK.radius * G));

function racetrack(t) {
  const { straight: L, radius: R, speed, height, perimeter, bank } = TRACK;
  let s = (speed * t) % perimeter; if (s < 0) s += perimeter;
  const arc = Math.PI * R, ramp = 150; // metres over which the bank is rolled in and out
  let e, n, roll = 0;
  if (s < L) { e = R; n = -L / 2 + s; }
  else if (s < L + arc) { const a = (s - L) / R; e = R * Math.cos(a); n = L / 2 + R * Math.sin(a); roll = -bank * smooth((s - L) / ramp) * smooth((L + arc - s) / ramp); }
  else if (s < 2 * L + arc) { e = -R; n = L / 2 - (s - L - arc); }
  else { const a = (s - 2 * L - arc) / R; e = -R * Math.cos(a); n = -L / 2 - R * Math.sin(a); roll = -bank * smooth((s - 2 * L - arc) / ramp) * smooth((perimeter - s) / ramp); }
  return { p: [e, n, height], roll };
}

const ROVER = { centre: [-1400, -600], radius: 250, speed: 12, height: 6 };
function roverPath(t) {
  const a = ROVER.speed * t / ROVER.radius;
  return { p: [ROVER.centre[0] + ROVER.radius * Math.sin(a), ROVER.centre[1] + ROVER.radius * Math.cos(a), ROVER.height], roll: 0 };
}

const SHIP = { centre: [1500, -500], radius: 900, speed: 9 };
function shipPath(t) {
  const a = -SHIP.speed * t / SHIP.radius;
  return { p: [SHIP.centre[0] + SHIP.radius * Math.sin(a), SHIP.centre[1] + SHIP.radius * Math.cos(a), 0], roll: 0.08 * Math.sin(0.7 * t), pitch: 0.03 * Math.sin(0.5 * t) };
}

const HELO = { cycle: 80, active: 48 };
function heloPath(t) {
  const w = 2 * Math.PI / HELO.cycle;
  return { p: [-300 + 700 * Math.sin(w * t), 1900 + 350 * Math.sin(2 * w * t), 260 + 40 * Math.sin(3 * w * t)], roll: 0 };
}

export const ENTITIES = Object.freeze([
  { entity: 1, marking: 'KITE 01', path: racetrack, type: { kind: 1, domain: 2, country: 0, category: 1, subcategory: 0, specific: 0, extra: 0 }, forceID: 1, defaultAlgorithm: 4 },
  { entity: 2, marking: 'ROVER 02', path: roverPath, type: { kind: 1, domain: 1, country: 0, category: 1, subcategory: 0, specific: 0, extra: 0 }, forceID: 1, defaultAlgorithm: 2, level: true },
  { entity: 3, marking: 'CUTTER 03', path: shipPath, type: { kind: 1, domain: 3, country: 0, category: 6, subcategory: 0, specific: 0, extra: 0 }, forceID: 3, defaultAlgorithm: 7, level: true },
  { entity: 4, marking: 'HAWK 04', path: heloPath, type: { kind: 1, domain: 2, country: 0, category: 21, subcategory: 0, specific: 0, extra: 0 }, forceID: 2, defaultAlgorithm: 5, activeWindow: [0, HELO.active], cycle: HELO.cycle },
]);

// Radio script: KITE 01 keys its radio for one Morse message in every 16 s.
export const RADIO = Object.freeze({ cycle: 16, start: 2, text: 'DIS X3D', sampleRate: 8000, frameSamples: 160, frequencyHz: 305000000, powerDbm: 40, bandwidthHz: 25000, toneHz: 700 });
const KEYING = morseKeying(RADIO.text);
export const RADIO_MESSAGE_SECONDS = Math.ceil(KEYING.duration * 50) / 50;

const ENU_TO_NED = (p) => [p[1], p[0], -p[2]];

export class ScriptedExercise {
  constructor(origin = EXERCISE_ORIGIN) {
    this.frame = new LocalFrame(origin.lat, origin.lon, origin.h);
  }

  isActive(e, t) {
    if (!e.activeWindow) return true;
    let tau = t % e.cycle; if (tau < 0) tau += e.cycle;
    return tau >= e.activeWindow[0] && tau < e.activeWindow[1];
  }

  // Kinematic state in the local NED frame at time t, by central differences of the path.
  _ned(e, t) {
    const h = 0.01;
    const at = (x) => { const q = e.path(x); return { p: ENU_TO_NED(q.p), roll: q.roll ?? 0, pitchAdd: q.pitch ?? 0 }; };
    const c = at(t), a = at(t - h), b = at(t + h);
    const v = [0, 1, 2].map((i) => (b.p[i] - a.p[i]) / (2 * h));
    const acc = [0, 1, 2].map((i) => (b.p[i] - 2 * c.p[i] + a.p[i]) / (h * h));
    const heading = Math.atan2(v[1], v[0]);
    const pitch = (e.level ? 0 : Math.atan2(-v[2], Math.hypot(v[0], v[1]))) + c.pitchAdd;
    return { p: c.p, v, acc, heading, pitch, roll: c.roll };
  }

  // Body-to-ECEF matrix at time t.
  _attitude(e, t) {
    const s = this._ned(e, t);
    const nedToBody = eulerToMatrix(s.heading, s.pitch, s.roll);
    return transpose(mul(nedToBody, this.frame.ecefToNed)); // body to ECEF
  }

  // The true state at time t: position, attitude and their rates, in the forms the nine algorithms need.
  truth(entityNumber, t) {
    const e = ENTITIES.find((x) => x.entity === entityNumber);
    if (!e) return null;
    const s = this._ned(e, t), h = 0.01;
    const B = this._attitude(e, t), Bp = this._attitude(e, t + h), Bm = this._attitude(e, t - h);
    const dB = Bp.map((x, i) => (x - Bm[i]) / (2 * h));
    const S = mul(transpose(B), dB); // skew matrix of the body angular velocity
    const omegaBody = [(S[7] - S[5]) / 2, (S[2] - S[6]) / 2, (S[3] - S[1]) / 2];
    const worldToBody = transpose(B);
    const velWorld = apply(this.frame.nedToEcef, s.v), accWorld = apply(this.frame.nedToEcef, s.acc);
    const velBody = apply(worldToBody, velWorld);
    const vb = (x) => { const q = this._ned(e, x); return apply(transpose(this._attitude(e, x)), apply(this.frame.nedToEcef, q.v)); };
    const vbp = vb(t + h), vbm = vb(t - h);
    const accBody = [0, 1, 2].map((i) => (vbp[i] - vbm[i]) / (2 * h));
    return {
      entity: e, active: this.isActive(e, t), ecef: this.frame.nedToEcefPoint(s.p), worldToBody, euler: matrixToEuler(worldToBody),
      velWorld, accWorld, velBody, accBody, omegaBody, heading: s.heading, pitch: s.pitch, roll: s.roll,
    };
  }

  articulation(entityNumber, t) {
    if (entityNumber !== 2) return [];
    return [
      { recordType: 0, changeIndicator: Math.floor(t * 10) & 0xff, partAttachedTo: 0, parameterType: 4096 + 11, parameterValue: Math.fround(0.9 * Math.sin(0.5 * t)) }, // primary turret 1, azimuth
      { recordType: 0, changeIndicator: Math.floor(t * 10) & 0xff, partAttachedTo: 1, parameterType: 4416 + 13, parameterValue: Math.fround(0.2 + 0.15 * Math.sin(0.9 * t)) }, // primary gun 1, elevation
    ];
  }

  header(pduType, t, version = 7) {
    return { protocolVersion: version, exerciseID: EXERCISE_ID, pduType, timestamp: secondsToTimestamp(t % 3600, true), pduStatus: 0 };
  }

  // The Entity State PDU of one entity at time t with the given dead-reckoning algorithm (1 to 9).
  entityStatePdu(entityNumber, t, algorithm, version = 7) {
    const k = this.truth(entityNumber, t), e = k.entity, alg = algorithm || e.defaultAlgorithm;
    const body = drmUsesBody(alg);
    return encodePdu({
      header: this.header(PDU_TYPE.ENTITY_STATE, t, version),
      entityID: { site: SITE, application: APP, entity: e.entity }, forceID: e.forceID, entityType: e.type, alternativeEntityType: e.type,
      linearVelocity: alg === 1 ? [0, 0, 0] : (body ? k.velBody : k.velWorld), location: k.ecef, orientation: k.euler, appearance: 0,
      deadReckoning: {
        algorithm: alg,
        linearAcceleration: drmUsesAcceleration(alg) ? (body ? k.accBody : k.accWorld) : [0, 0, 0],
        angularVelocity: drmRotates(alg) ? k.omegaBody : [0, 0, 0],
      },
      marking: { characterSet: 1, text: e.marking }, capabilities: 0, variableParameters: this.articulation(e.entity, t),
    });
  }

  radioState(t) {
    let tau = t % RADIO.cycle; if (tau < 0) tau += RADIO.cycle;
    const keyed = tau >= RADIO.start && tau < RADIO.start + RADIO_MESSAGE_SECONDS;
    return { keyed, tau, messageTime: tau - RADIO.start };
  }

  transmitterPdu(t, version = 7) {
    const k = this.truth(1, t), r = this.radioState(t);
    return encodePdu({
      header: this.header(PDU_TYPE.TRANSMITTER, t, version), entityID: { site: SITE, application: APP, entity: 1 }, radioID: 1,
      radioEntityType: { kind: 7, domain: 2, country: 0, category: 1, nomenclatureVersion: 1, nomenclature: 1 },
      transmitState: r.keyed ? 2 : 1, inputSource: 1, antennaLocation: k.ecef, relativeAntennaLocation: [0, 0, -1.5], antennaPatternType: 0,
      frequency: RADIO.frequencyHz, transmitFrequencyBandwidth: RADIO.bandwidthHz, power: RADIO.powerDbm,
      modulationType: { spreadSpectrum: 0, major: 1, detail: 2, system: 1 }, cryptoSystem: 0, cryptoKeyID: 0,
    });
  }

  // Free-space path loss from the aircraft to the rover, at the radio frequency.
  receivedPowerDbm(t) {
    const d = distance(this.truth(1, t).ecef, this.truth(2, t).ecef);
    return RADIO.powerDbm - (20 * Math.log10(d / 1000) + 20 * Math.log10(RADIO.frequencyHz / 1e6) + 32.44);
  }

  receiverPdu(t, version = 7) {
    const r = this.radioState(t);
    return encodePdu({
      header: this.header(PDU_TYPE.RECEIVER, t, version), entityID: { site: SITE, application: APP, entity: 2 }, radioID: 1,
      receiverState: r.keyed ? 2 : 1, receivedPower: r.keyed ? this.receivedPowerDbm(t) : 0,
      transmitterEntityID: { site: SITE, application: APP, entity: 1 }, transmitterRadioID: 1,
    });
  }

  // The Signal PDU for audio frame number `frame` (20 ms each, counted from the start of UTC time).
  signalPdu(frame, version = 7) {
    const t = frame * RADIO.frameSamples / RADIO.sampleRate, r = this.radioState(t + 1e-9);
    if (!r.keyed) return null;
    const data = toneFrame(KEYING, r.messageTime, RADIO.frameSamples, RADIO.sampleRate, RADIO.toneHz);
    return encodePdu({
      header: this.header(PDU_TYPE.SIGNAL, t, version), entityID: { site: SITE, application: APP, entity: 1 }, radioID: 1,
      encodingScheme: 1, tdlType: 0, sampleRate: RADIO.sampleRate, samples: RADIO.frameSamples, data,
    });
  }
}

// Issues PDUs as time passes. Call step(nowUnixSeconds) often; it returns the PDUs that became due.
//   algorithm  0 = each entity's scripted algorithm, 1 to 9 = that algorithm for every entity
//   rate       PDUs per second and entity, or 0 for the rule real simulations use: send when the receiver's dead
//              reckoning would be off by more than `thresholdMetres` or `thresholdRadians`, and at least every
//              `heartbeat` seconds
export class ExerciseSource {
  constructor(options = {}) {
    this.exercise = options.exercise ?? new ScriptedExercise();
    this.algorithm = options.algorithm ?? 0;
    this.rate = options.rate ?? 0;
    this.version = options.version ?? 7;
    this.thresholdMetres = options.thresholdMetres ?? 1;
    this.thresholdRadians = options.thresholdRadians ?? 3 * Math.PI / 180;
    this.heartbeat = options.heartbeat ?? 5;
    this.entities = options.entities ?? ENTITIES.map((e) => e.entity);
    this.radio = options.radio ?? true;
    this.last = new Map(); // entity -> { t, state }
    this.lastFrame = null; this.lastRadioHeartbeat = -Infinity; this.lastKeyed = null;
    this.counts = { 1: 0, 25: 0, 26: 0, 27: 0 };
  }

  reset() { this.last.clear(); }

  step(now) {
    const out = [], ex = this.exercise;
    for (const n of this.entities) {
      const e = ENTITIES.find((x) => x.entity === n);
      if (!ex.isActive(e, now)) { this.last.delete(n); continue; }
      const prev = this.last.get(n);
      const alg = this.algorithm || e.defaultAlgorithm;
      let due = !prev || prev.algorithm !== alg;
      if (!due && this.rate > 0) due = now - prev.t >= 1 / this.rate - 1e-6;
      if (!due && this.rate <= 0) {
        const guess = deadReckon(prev.state, now - prev.t), k = ex.truth(n, now);
        due = now - prev.t >= this.heartbeat || distance(guess.location, k.ecef) > this.thresholdMetres || angleBetween(guess.matrix, k.worldToBody) > this.thresholdRadians;
      }
      if (due) {
        const bytes = ex.entityStatePdu(n, now, alg, this.version), d = decodePdu(bytes);
        this.last.set(n, { t: now, algorithm: alg, state: { algorithm: alg, location: d.location, linearVelocity: d.linearVelocity, linearAcceleration: d.deadReckoning.linearAcceleration, angularVelocity: d.deadReckoning.angularVelocity, orientation: d.orientation } });
        out.push(bytes); this.counts[1]++;
      }
    }
    if (this.radio) {
      const keyed = ex.radioState(now).keyed;
      if (keyed !== this.lastKeyed || now - this.lastRadioHeartbeat >= 2) {
        out.push(ex.transmitterPdu(now, this.version), ex.receiverPdu(now, this.version));
        this.counts[25]++; this.counts[27]++; this.lastKeyed = keyed; this.lastRadioHeartbeat = now;
      }
      const frame = Math.floor(now * RADIO.sampleRate / RADIO.frameSamples);
      const from = this.lastFrame === null ? frame : Math.max(this.lastFrame + 1, frame - 50);
      for (let f = from; f <= frame; f++) { const s = ex.signalPdu(f, this.version); if (s) { out.push(s); this.counts[26]++; } }
      this.lastFrame = frame;
    }
    return out;
  }
}
