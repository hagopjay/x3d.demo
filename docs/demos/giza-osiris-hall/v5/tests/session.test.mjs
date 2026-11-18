import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../resonance.mjs';
import { TESLA_DEFAULTS } from '../tesla.mjs';
import { makeSession, validateSession } from '../session.mjs';

const timestamp = '2026-11-17T01:00:00.000Z';
function sample(overrides = {}) {
  return {
    schema: 'giza-tesla/1', created: timestamp,
    tesla: { ...TESLA_DEFAULTS },
    settings: { ...DEFAULTS }, comparison: null, seconds: 82.5,
    lens: 'mythic', view: 'V_Immersive', cameraMode: 'first-person', encounterLevel: 'beings',
    stage: { water: 0.3, device: 0, quality: 1, motion: false, fields: true, cutaway: true },
    ...overrides,
  };
}

test('Tesla schema survives JSON export/import with accepted creative settings', () => {
  const input = sample({ comparison: { ...DEFAULTS, drive: 0 } });
  const saved = makeSession(input);
  const restored = validateSession(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored, saved);
  assert.equal(restored.cameraMode, 'first-person');
  assert.equal(restored.encounterLevel, 'beings');
  assert.equal(restored.stage.device, 0);
  assert.equal(restored.created, timestamp);
  assert.notEqual(restored.settings, input.settings);
  assert.deepEqual(restored.tesla, input.tesla);
  assert.notEqual(restored.tesla, input.tesla);
  assert.notEqual(restored.comparison, input.comparison);
});

test('legacy contact settings migrate predictably and all legacy devices become Was', () => {
  for (const device of [0, 1, 2]) {
    for (const contact of [false, true]) {
      const legacy = sample({ schema: 'giza-horizon/1', view: 'V_Ritual' });
      delete legacy.cameraMode; delete legacy.encounterLevel;
      legacy.stage = { ...legacy.stage, device, contact };
      const saved = validateSession(legacy);
      assert.equal(saved.schema, 'giza-tesla/1');
      assert.equal(saved.tesla.enabled, false);
      assert.equal(saved.cameraMode, 'witness');
      assert.equal(saved.encounterLevel, contact ? 'beings' : 'geometry');
      assert.equal(saved.stage.device, 0);
      assert.equal(Object.hasOwn(saved.stage, 'contact'), false);
      assert.equal(legacy.stage.device, device);
    }
  }
});

test('Horizon schema 2 preserves camera state while beginning with Tesla disabled', () => {
  const old = sample({ schema: 'giza-horizon/2', tesla: { enabled: true, untrusted: 1 } });
  const migrated = validateSession(old);
  assert.equal(migrated.schema, 'giza-tesla/1');
  assert.equal(migrated.cameraMode, 'first-person');
  assert.equal(migrated.encounterLevel, 'beings');
  assert.deepEqual(migrated.tesla, { ...TESLA_DEFAULTS, enabled: false });
});

test('all accepted camera/encounter choices and timeline endpoints remain valid', () => {
  for (const cameraMode of ['witness', 'first-person']) {
    for (const encounterLevel of ['geometry', 'craft', 'beings']) {
      for (const seconds of [0, 108]) {
        const view = cameraMode === 'witness' ? 'V_Witness' : 'V_Immersive';
        const session = validateSession(sample({ cameraMode, encounterLevel, seconds, view }));
        assert.equal(session.cameraMode, cameraMode);
        assert.equal(session.encounterLevel, encounterLevel);
        assert.equal(session.seconds, seconds);
      }
    }
  }
});

test('Tesla, regional, atmospheric and Earth viewpoints are valid saved configurations', () => {
  for (const view of ['V_Tesla', 'V_Regional', 'V_Atmosphere', 'V_Earth']) {
    assert.equal(validateSession(sample({ view, cameraMode: 'witness' })).view, view);
  }
});

test('malformed session objects and unsupported schemas are rejected', () => {
  for (const value of [null, [], 'session', new Date(), {}, sample({ schema: 'giza-tesla/2' }), sample({ schema: 'giza-horizon/3' })]) {
    assert.throws(() => validateSession(value));
  }
  const missing = sample(); delete missing.settings;
  assert.throws(() => validateSession(missing), /settings are required/);
  for (const settings of [null, [], 4, new Date()]) {
    assert.throws(() => validateSession(sample({ settings })));
  }
  assert.throws(() => makeSession(null));
});

test('current imports require bounded Tesla settings, while exports can use defaults', () => {
  const input = sample(); delete input.tesla;
  assert.throws(() => validateSession(input), /Tesla settings are required/);
  assert.deepEqual(makeSession(input).tesla, { ...TESLA_DEFAULTS });
  for (const tesla of [null, [], 1, 'enabled', new Date(), { ...TESLA_DEFAULTS, enabled: 'true' }, { ...TESLA_DEFAULTS, charge: 1000 }]) {
    assert.throws(() => validateSession(sample({ tesla })));
  }
  for (const [key, value] of Object.entries(TESLA_DEFAULTS)) {
    if (typeof value === 'number') {
      for (const invalid of [NaN, Infinity, '1']) {
        assert.throws(() => validateSession(sample({ tesla: { ...TESLA_DEFAULTS, [key]: invalid } })));
      }
    }
  }
});

test('unknown camera, encounter, viewpoint, lens and current device choices are rejected', () => {
  for (const field of ['cameraMode', 'encounterLevel', 'view', 'lens']) {
    for (const value of ['unexpected', 0, null]) {
      assert.throws(() => validateSession(sample({ [field]: value })));
    }
  }
  for (const device of [1, 2, '0', null]) {
    const input = sample(); input.stage.device = device;
    assert.throws(() => validateSession(input), /ritual device/);
  }
  assert.throws(() => validateSession(sample({ view: 'V_Witness', cameraMode: 'first-person' })), /does not match/);
  assert.throws(() => validateSession(sample({ view: 'V_Immersive', cameraMode: 'witness' })), /does not match/);
});

test('nonfinite and out-of-range time, settings and stage values are rejected', () => {
  for (const seconds of [-0.01, 108.01, Infinity, NaN, '82']) {
    assert.throws(() => validateSession(sample({ seconds })));
  }
  for (const frequency of [0.49, 1.51, Infinity, NaN, '0.95']) {
    assert.throws(() => validateSession(sample({ settings: { ...DEFAULTS, frequency } })));
  }
  for (const water of [-2.01, 3.01, Infinity, NaN, '0.3']) {
    const input = sample(); input.stage.water = water;
    assert.throws(() => validateSession(input));
  }
  for (const quality of [0, 2, '1', NaN]) {
    const input = sample(); input.stage.quality = quality;
    assert.throws(() => validateSession(input));
  }
});

test('stage switches require booleans and legacy contact cannot be inferred from text', () => {
  for (const key of ['motion', 'fields', 'cutaway']) {
    const input = sample(); input.stage[key] = 1;
    assert.throws(() => validateSession(input));
    delete input.stage[key];
    assert.throws(() => validateSession(input));
  }
  const legacy = sample({ schema: 'giza-horizon/1' });
  legacy.stage.contact = 'true';
  assert.throws(() => validateSession(legacy));
});

test('import strips arbitrary data and never restores energy or arc runtime state', () => {
  const input = sample({ model: '<script>invented</script>', response: { gain: 100000 }, sources: 'https://example.invalid', notes: 'untrusted', charge: 1000, arcLedger: [{ energy: 1000 }], reservoir: { energy: 1000 }, reset: false });
  input.stage.custom = 'untrusted';
  const restored = validateSession(input);
  assert.equal(restored.sources, 'evidence.json');
  assert.match(restored.model, /not a Maxwell/i);
  assert.match(restored.model, /fictional lumped energy reservoir/);
  assert.equal(Object.hasOwn(restored, 'notes'), false);
  assert.equal(Object.hasOwn(restored, 'response'), false);
  assert.equal(Object.hasOwn(restored.stage, 'custom'), false);
  for (const field of ['charge', 'arcLedger', 'reservoir', 'reset']) assert.equal(Object.hasOwn(restored, field), false);
  assert.throws(() => validateSession(sample({ comparison: { ...DEFAULTS, extra: 'untrusted' } })));
});

test('exports use bounded canonical UTC creation times and reject invalid dates', () => {
  const input = sample(); delete input.created;
  const saved = makeSession(input);
  assert.equal(saved.created, new Date(saved.created).toISOString());
  assert.equal(validateSession(input).created, undefined);
  for (const created of ['no date', '2026-02-30T01:00:00.000Z', '2026-11-17', '2026-11-17T01:00:00Z', 1, null]) {
    assert.throws(() => validateSession(sample({ created })));
    assert.throws(() => makeSession(sample({ created })));
  }
});
