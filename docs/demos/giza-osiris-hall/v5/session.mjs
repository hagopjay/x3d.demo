/** Bounded Tesla scenario files, with migration from both Horizon prototypes. */
import { sanitizeSettings } from './resonance.mjs';
import { TESLA_DEFAULTS, sanitizeTesla } from './tesla.mjs';

const SCHEMA = 'giza-tesla/1';
const HORIZON_SCHEMAS = ['giza-horizon/1', 'giza-horizon/2'];
const VIEWS = ['V_Overview', 'V_Cutaway', 'V_Chamber', 'V_Ritual', 'V_Stars', 'V_Immersive', 'V_Witness', 'V_Tesla', 'V_Regional', 'V_Atmosphere', 'V_Earth'];
const LENSES = ['archaeology', 'lab', 'mythic'];
const CAMERA_MODES = ['witness', 'first-person'];
const ENCOUNTER_LEVELS = ['geometry', 'craft', 'beings'];
const MODEL = 'Assumed dimensionless SDOF RF and separate RC piezo analogies, with a rated fictional lumped energy reservoir and authored Tesla scenario. Not a Maxwell solution, measured pyramid output, or measurement of Earth’s energy, atmosphere or ionosphere.';

function record(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${name} must be a plain object.`);
  return value;
}

function member(value, allowed, name) {
  if (!allowed.includes(value)) throw new RangeError(`Invalid ${name}.`);
  return value;
}

function number(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and within [${min}, ${max}].`);
  }
  return value;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
  return value;
}

function timestamp(value) {
  // A small canonical UTC value avoids carrying arbitrary imported text.
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) {
    throw new TypeError('created must be an ISO UTC timestamp.');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new RangeError('created is not a valid calendar timestamp.');
  }
  return value;
}

/**
 * Validate and copy a session into canonical giza-tesla/1. Only recognized
 * configuration data is returned. Horizon imports begin with Tesla disabled.
 * Transient voltage, reservoir charge, arc ledger, playback, audio and camera
 * offsets are intentionally absent: importing always starts fresh dynamics.
 */
export function validateSession(value) {
  record(value, 'Session');
  const horizon = HORIZON_SCHEMAS.includes(value.schema);
  const legacy = value.schema === 'giza-horizon/1';
  if (!horizon && value.schema !== SCHEMA) throw new Error('This is not a supported Giza experiment file.');
  if (!Object.hasOwn(value, 'settings')) throw new TypeError('Session settings are required.');
  const settings = sanitizeSettings(record(value.settings, 'Settings'));
  const sourceStage = record(value.stage, 'Stage');
  const stage = {
    water: number(sourceStage.water, -2, 3, 'Floodplain level'),
    device: 0,
    quality: member(sourceStage.quality, [0.7, 1, 1.5], 'render quality'),
    motion: boolean(sourceStage.motion, 'Reduced motion'),
    fields: boolean(sourceStage.fields, 'Field visibility'),
    cutaway: boolean(sourceStage.cutaway, 'Cutaway'),
  };
  member(sourceStage.device, legacy ? [0, 1, 2] : [0], 'ritual device');
  if (legacy) boolean(sourceStage.contact, 'Legacy contact switch');
  const comparison = value.comparison === null || value.comparison === undefined
    ? null : sanitizeSettings(record(value.comparison, 'Comparison'));
  if (!horizon && !Object.hasOwn(value, 'tesla')) throw new TypeError('Tesla settings are required.');
  const tesla = horizon
    ? sanitizeTesla({ ...TESLA_DEFAULTS, enabled: false })
    : sanitizeTesla(record(value.tesla, 'Tesla settings'));
  const out = {
    schema: SCHEMA,
    settings,
    tesla,
    comparison,
    seconds: number(value.seconds, 0, 108, 'Passage time'),
    lens: member(value.lens, LENSES, 'lens'),
    view: member(value.view, VIEWS, 'viewpoint'),
    stage,
    cameraMode: legacy ? 'witness' : member(value.cameraMode, CAMERA_MODES, 'camera mode'),
    encounterLevel: legacy ? (sourceStage.contact ? 'beings' : 'geometry')
      : member(value.encounterLevel, ENCOUNTER_LEVELS, 'encounter level'),
    model: MODEL,
    sources: 'evidence.json',
  };
  if ((out.view === 'V_Immersive' && out.cameraMode !== 'first-person') ||
      (out.view === 'V_Witness' && out.cameraMode !== 'witness')) {
    throw new RangeError('Dynamic viewpoint does not match camera mode.');
  }
  if (value.created !== undefined) out.created = timestamp(value.created);
  return out;
}

/** Create a dated Tesla export from bounded configuration, never live energy. */
export function makeSession(input) {
  record(input, 'Session input');
  return validateSession({
    ...input,
    schema: SCHEMA,
    tesla: input.tesla === undefined ? { ...TESLA_DEFAULTS } : input.tesla,
    created: input.created === undefined ? new Date().toISOString() : input.created,
  });
}
