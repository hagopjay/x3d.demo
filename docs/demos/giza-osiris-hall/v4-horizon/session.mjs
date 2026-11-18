/** Bounded experiment files, with migration from the first Horizon prototype. */
import { sanitizeSettings } from './resonance.mjs';

const SCHEMA = 'giza-horizon/2';
const LEGACY_SCHEMA = 'giza-horizon/1';
const VIEWS = ['V_Overview', 'V_Cutaway', 'V_Chamber', 'V_Ritual', 'V_Stars', 'V_Immersive', 'V_Witness'];
const LENSES = ['archaeology', 'lab', 'mythic'];
const CAMERA_MODES = ['witness', 'first-person'];
const ENCOUNTER_LEVELS = ['geometry', 'craft', 'beings'];
const MODEL = 'Assumed dimensionless SDOF RF analogy and separate RC piezo analogy. Authored cinematic journey; not a Maxwell solution or measured pyramid output.';

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
 * Validate and copy a session into canonical schema 2. Only recognized data is
 * returned. Legacy contact/device selections migrate to the accepted Was story.
 * Transient voltage, free-camera offsets, playback and audio are never restored.
 */
export function validateSession(value) {
  record(value, 'Session');
  const legacy = value.schema === LEGACY_SCHEMA;
  if (!legacy && value.schema !== SCHEMA) throw new Error('This is not a supported Giza IV experiment file.');
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
  const out = {
    schema: SCHEMA,
    settings,
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

/** Create a dated schema-2 export from the current bounded application state. */
export function makeSession(input) {
  record(input, 'Session input');
  return validateSession({
    ...input,
    schema: SCHEMA,
    created: input.created === undefined ? new Date().toISOString() : input.created,
  });
}
