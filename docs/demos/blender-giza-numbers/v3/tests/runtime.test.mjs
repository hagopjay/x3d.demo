// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectRenderer, withTimeout } from '../renderer.mjs';

const canvas = { id: 'test-x3d-canvas' };
const browser = { loadURL: async () => {} };
const registry = { whenDefined: async name => assert.equal(name, 'x3d-canvas') };

test('waits for custom-element definition and runtime readiness before getBrowser', async () => {
  const events = [];
  const customRegistry = { whenDefined: async name => { events.push(`defined:${name}`); } };
  const runtime = async () => { events.push('runtime-ready'); };
  runtime.getBrowser = element => {
    assert.strictEqual(element, canvas);
    events.push('get-browser');
    return browser;
  };
  assert.strictEqual(await connectRenderer({ canvas, runtime, registry: customRegistry }), browser);
  assert.deepEqual(events, ['defined:x3d-canvas', 'runtime-ready', 'get-browser']);
});

test('accepts an already-ready runtime object', async () => {
  const runtime = { getBrowser: element => element === canvas ? browser : undefined };
  assert.strictEqual(await connectRenderer({ canvas, runtime, registry }), browser);
});

test('missing runtime produces an explicit diagnostic', async () => {
  await assert.rejects(connectRenderer({ canvas, runtime: null, registry }), /X_ITE|X3D|runtime|renderer/i);
});

test('runtime initialization rejection propagates', async () => {
  const failure = new Error('GPU initialization intentionally rejected');
  const runtime = async () => { throw failure; };
  runtime.getBrowser = () => browser;
  await assert.rejects(connectRenderer({ canvas, runtime, registry }), error => error === failure);
});

test('undefined browser is rejected before a loadURL call can fail', async () => {
  await assert.rejects(connectRenderer({ canvas, runtime: { getBrowser: () => undefined }, registry }), /browser|loadURL|ready|initializ/i);
});

test('browser without callable loadURL is rejected', async () => {
  await assert.rejects(connectRenderer({ canvas, runtime: { getBrowser: () => ({ loadURL: true }) }, registry }), /browser|loadURL|ready|initializ/i);
});

test('custom-element registration that never completes times out', async () => {
  const blocked = { whenDefined: () => new Promise(() => {}) };
  await assert.rejects(connectRenderer({ canvas, runtime: { getBrowser: () => browser }, registry: blocked, timeoutMs: 12 }), /time|ready|register|initializ/i);
});

test('runtime readiness that never completes times out', async () => {
  const runtime = () => new Promise(() => {});
  runtime.getBrowser = () => browser;
  await assert.rejects(connectRenderer({ canvas, runtime, registry, timeoutMs: 12 }), /time|ready|initializ/i);
});

test('withTimeout preserves successful values and original rejection', async () => {
  assert.equal(await withTimeout(Promise.resolve(47), 100, 'timeout'), 47);
  const failure = new Error('original failure');
  await assert.rejects(withTimeout(Promise.reject(failure), 100, 'timeout'), error => error === failure);
});

test('withTimeout clears its watchdog after success and failure', async t => {
  const setTimer = globalThis.setTimeout;
  const clearTimer = globalThis.clearTimeout;
  const created = new Set();
  const cleared = new Set();
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    const handle = setTimer(callback, ms, ...args);
    created.add(handle);
    return handle;
  });
  t.mock.method(globalThis, 'clearTimeout', handle => {
    cleared.add(handle);
    return clearTimer(handle);
  });
  await withTimeout(Promise.resolve('ready'), 100, 'watchdog');
  await assert.rejects(withTimeout(Promise.reject(new Error('stopped')), 100, 'watchdog'));
  assert.equal(created.size, 2);
  assert.deepEqual(cleared, created);
});

test('withTimeout bounds an unresolved promise and uses the requested diagnostic', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 12, 'Loading the reference scene timed out'), /Loading the reference scene timed out/);
});
