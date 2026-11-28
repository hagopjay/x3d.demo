// exercise.test.js: the scripted exercise is self-consistent. The PDUs it writes carry velocities, accelerations
// and angular velocities that really are the rates of its own truth, in world or body coordinates as each
// algorithm needs.   Run:  node --test tests/exercise.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ScriptedExercise, ExerciseSource, ENTITIES, RADIO, RADIO_MESSAGE_SECONDS } from '../src/dis-exercise.js';
import { decodePdu } from '../src/dis-codec.js';
import { deadReckon, distance, angleBetween, DRM_NAME } from '../src/dis-dr.js';
import { ecefToGeodetic } from '../src/dis-geo.js';
import { muLawDecode } from '../src/dis-signal.js';
import { record } from './results.js';

const ex = new ScriptedExercise();
const T0 = 1_800_000_000; // a fixed instant, so that every run sees the same motion
const stateOf = (d) => ({ algorithm: d.deadReckoning.algorithm, location: d.location, linearVelocity: d.linearVelocity, linearAcceleration: d.deadReckoning.linearAcceleration, angularVelocity: d.deadReckoning.angularVelocity, orientation: d.orientation });

test('dead reckoning from the exercise PDUs follows the exercise truth over a short step', () => {
  const table = {};
  for (let alg = 1; alg <= 9; alg++) {
    let worstPos = 0, worstAng = 0;
    for (const e of ENTITIES) {
      for (let i = 0; i < 40; i++) {
        const t = T0 + i * 3.7 + e.entity, dt = 0.1;
        const d = decodePdu(ex.entityStatePdu(e.entity, t, alg));
        const g = deadReckon(stateOf(d), dt), k = ex.truth(e.entity, t + dt), k0 = ex.truth(e.entity, t);
        assert.ok(distance(d.location, k0.ecef) === 0, 'the PDU location is the truth at its timestamp');
        worstPos = Math.max(worstPos, distance(g.location, k.ecef)); worstAng = Math.max(worstAng, angleBetween(g.matrix, k.worldToBody));
      }
    }
    table[`${alg} ${DRM_NAME[alg]}`] = { max_position_error_m_after_0_1_s: worstPos, max_orientation_error_rad_after_0_1_s: worstAng };
    console.log(`algorithm ${alg} ${DRM_NAME[alg]}: after 0.1 s, worst position error ${worstPos.toFixed(4)} m, worst orientation error ${worstAng.toFixed(5)} rad`);
  }
  // Static ignores the speed (100 m/s for 0.1 s is 10 m). Constant velocity misses only the acceleration term
  // (the aircraft pulls 16.7 m/s^2 in its turns: 0.083 m after 0.1 s). With acceleration the error is smaller still.
  assert.ok(table['1 Static'].max_position_error_m_after_0_1_s > 9 && table['1 Static'].max_position_error_m_after_0_1_s < 11);
  // FVB holds the orientation, so in a steady turn its body-frame acceleration is near zero and it misses the turn as FPW does.
  for (const k of ['2 FPW', '3 RPW', '6 FPB', '9 FVB']) assert.ok(table[k].max_position_error_m_after_0_1_s < 0.12, k);
  for (const k of ['4 RVW', '5 FVW', '7 RPB', '8 RVB']) assert.ok(table[k].max_position_error_m_after_0_1_s < 0.03, k);
  for (const k of ['3 RPW', '4 RVW', '7 RPB', '8 RVB']) assert.ok(table[k].max_orientation_error_rad_after_0_1_s < 0.01, k);
  record('exercise_consistency', { instrument: `node ${process.version}`, step_seconds: 0.1, algorithms: table });
});

test('the entities are where the script says, in real geodetic terms', () => {
  const [lat, lon, h] = ecefToGeodetic(ex.truth(1, T0).ecef);
  assert.ok(Math.abs(lat - 36.6) < 0.05 && Math.abs(lon + 122.5) < 0.05 && Math.abs(h - 600) < 2);
  const k = ex.truth(1, T0);
  assert.ok(Math.abs(Math.hypot(...k.velWorld) - 100) < 0.01, 'the aircraft flies at 100 m/s');
  assert.ok(Math.abs(k.velBody[0] - 100) < 0.01 && Math.abs(k.velBody[1]) < 0.01, 'and all of it is along its nose');
});

test('the source keeps the dead-reckoning error under its threshold, and issues the radio PDUs', () => {
  const src = new ExerciseSource({ rate: 0, algorithm: 0 });
  const last = new Map(); let worst = 0, n = 0, signal = 0, tx = 0, rx = 0, helo = 0;
  for (let i = 0; i <= 80 * 50; i++) {
    const t = T0 + i / 50;
    for (const bytes of src.step(t)) {
      const d = decodePdu(bytes);
      if (d.header.pduType === 1) { last.set(d.entityID.entity, { t, s: stateOf(d) }); n++; if (d.entityID.entity === 4) helo++; }
      if (d.header.pduType === 26) { signal++; assert.equal(d.data.length, RADIO.frameSamples); assert.equal(d.sampleRate, 8000); }
      if (d.header.pduType === 25) tx++; if (d.header.pduType === 27) rx++;
    }
    for (const [id, l] of last) if (ex.isActive(ENTITIES.find((e) => e.entity === id), t)) worst = Math.max(worst, distance(deadReckon(l.s, t - l.t).location, ex.truth(id, t).ecef));
  }
  console.log(`threshold rule over 80 s at 50 steps per second: ${n} Entity State PDUs (${helo} from the helicopter), ${tx} Transmitter, ${signal} Signal, ${rx} Receiver; worst receiver-side error ${worst.toFixed(3)} m`);
  assert.ok(worst < 1.6, 'one metre plus what builds up in one 20 ms step');
  assert.ok(signal >= 5 * Math.floor(RADIO_MESSAGE_SECONDS * 50) - 5 && tx >= 40 && rx >= 40 && helo > 5);
  record('exercise_threshold', { instrument: `node ${process.version}`, seconds: 80, entity_state_pdus: n, transmitter_pdus: tx, signal_pdus: signal, receiver_pdus: rx, worst_error_m: worst });
});

test('the Signal PDUs carry a real tone', () => {
  const frame = Math.floor((T0 - (T0 % RADIO.cycle) + RADIO.start + 0.1) * 50);
  const d = decodePdu(ex.signalPdu(frame));
  const pcm = Array.from(d.data, muLawDecode);
  let crossings = 0; for (let i = 1; i < pcm.length; i++) if ((pcm[i - 1] < 0) !== (pcm[i] < 0)) crossings++;
  // 700 Hz for 20 ms is 14 cycles, 28 zero crossings
  assert.ok(Math.abs(crossings - 28) <= 2, `zero crossings ${crossings}`);
  assert.ok(Math.max(...pcm) > 10000);
});

test('dead-reckoning error by algorithm and send rate, over one full lap of the aircraft', () => {
  // A simulated receiver: it gets a PDU every 1/rate seconds, dead-reckons in between, and is compared with the
  // truth 50 times a second for one lap of the racetrack (77.7 s: two straights, two banked turns).
  const lap = (2 * 2000 + 2 * Math.PI * 600) / 100, table = {};
  for (let alg = 1; alg <= 9; alg++) {
    const row = {};
    for (const rate of [0.2, 1, 5]) {
      let last = null, sum = 0, n = 0, worst = 0;
      for (let i = 0; i <= lap * 50; i++) {
        const t = T0 + i / 50;
        if (!last || t - last.t >= 1 / rate - 1e-9) last = { t, s: stateOf(decodePdu(ex.entityStatePdu(1, t, alg))) };
        const e = distance(deadReckon(last.s, t - last.t).location, ex.truth(1, t).ecef);
        sum += e; n++; worst = Math.max(worst, e);
      }
      row[`${rate} per second`] = { mean_m: sum / n, worst_m: worst };
    }
    table[`${alg} ${DRM_NAME[alg]}`] = row;
    console.log(`algorithm ${alg} ${DRM_NAME[alg].padEnd(6)} mean / worst error in metres:  0.2 Hz ${row['0.2 per second'].mean_m.toFixed(2)} / ${row['0.2 per second'].worst_m.toFixed(2)}   1 Hz ${row['1 per second'].mean_m.toFixed(3)} / ${row['1 per second'].worst_m.toFixed(3)}   5 Hz ${row['5 per second'].mean_m.toFixed(4)} / ${row['5 per second'].worst_m.toFixed(4)}`);
  }
  assert.ok(table['4 RVW']['1 per second'].mean_m < table['2 FPW']['1 per second'].mean_m);
  assert.ok(table['8 RVB']['1 per second'].mean_m < table['2 FPW']['1 per second'].mean_m);
  assert.ok(table['2 FPW']['5 per second'].worst_m < table['2 FPW']['1 per second'].worst_m);
  record('exercise_lap', { instrument: `node ${process.version}`, entity: 'KITE 01, one lap of 77.7 s, compared 50 times per second', error_m: table });
});
