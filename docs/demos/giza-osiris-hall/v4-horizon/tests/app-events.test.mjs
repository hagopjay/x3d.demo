/**
 * Browserless event integration: executes the real app module against the real
 * HTML control IDs and X3D DEF names, with small DOM/scene test doubles.
 * These checks do NOT validate CSS, WebGL rendering, or the X_ITE API itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [html, xml, evidence, source] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('horizon.x3d', root), 'utf8'),
  readFile(new URL('evidence.json', root), 'utf8'),
  readFile(new URL('app.mjs', root), 'utf8'),
]);

class Element {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.id = attrs.id || '';
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value]));
    this.value = attrs.value || ''; this.checked = Object.hasOwn(attrs, 'checked');
    this.hidden = Object.hasOwn(attrs, 'hidden'); this.children = []; this.listeners = {};
    this.textContent = ''; this.width = Number(attrs.width || 0); this.height = Number(attrs.height || 0);
    this.classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      add: name => this.classes.add(name), remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !this.classes.has(name) : force;
        on ? this.classes.add(name) : this.classes.delete(name); return on;
      },
    };
  }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  addEventListener(type, action) { (this.listeners[type] ||= []).push(action); }
  async fire(type) {
    const event = { target: this, preventDefault() {} };
    for (const action of this.listeners[type] || []) await action(event);
    await this['on' + type]?.(event);
  }
  click() { return this.fire('click'); }
  append(...nodes) { this.children.push(...nodes); }
  showModal() { this.open = true; } close() { this.open = false; }
  getContext() { return new Proxy({}, { get: (target, key) => target[key] || (() => {}), set: (target, key, value) => (target[key] = value, true) }); }
}

function attributes(text) {
  return Object.fromEntries([...text.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']));
}

async function harness() {
  const elements = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].map(([, tag, attrs]) => new Element(tag, attributes(attrs)));
  const ids = new Map(elements.filter(e => e.id).map(e => [e.id, e]));
  for (const [, attrs, content] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const options = [...content.matchAll(/<option\b([^>]*)>/g)].map(([, value]) => attributes(value));
    ids.get(attributes(attrs).id).value = (options.find(o => Object.hasOwn(o, 'selected')) || options[0]).value;
  }
  const nodes = new Map([...xml.matchAll(/\bDEF="([^"]+)"/g)].map(([, name]) => [name, {}]));
  let activeView;
  for (const [name, node] of nodes) Object.defineProperty(node, 'set_bind', { set(value) { if (value) activeView = name; } });
  const frames = [], documentListeners = {};
  const document = {
    body: elements.find(e => e.tagName === 'BODY'), documentElement: elements.find(e => e.tagName === 'HTML'), hidden: false,
    getElementById: id => ids.get(id) || null,
    querySelectorAll: selector => {
      const match = /^\[data-([\w-]+)\]$/.exec(selector);
      assert.ok(match, `Unsupported selector in event fixture: ${selector}`);
      return elements.filter(e => Object.hasOwn(e.dataset, match[1]));
    },
    createElement: tag => new Element(tag),
    addEventListener: (type, action) => { (documentListeners[type] ||= []).push(action); },
  };
  ids.get('world').browser = {
    currentScene: { getNamedNode(name) { assert.ok(nodes.has(name), `Missing scene DEF: ${name}`); return nodes.get(name); } },
    getCurrentFrameRate: () => 30,
  };
  const old = new Map();
  function install(key, value) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
  install('document', document); install('window', {}); install('innerWidth', 1440);
  install('matchMedia', () => ({ matches: false })); install('customElements', { whenDefined: () => Promise.resolve() });
  install('requestAnimationFrame', callback => frames.push(callback));
  install('fetch', async url => { assert.equal(url, 'evidence.json'); return { ok: true, json: async () => JSON.parse(evidence) }; });
  class Field extends Array { constructor(...values) { super(...values); } }
  install('X3D', { SFVec3f: Field, SFRotation: Field, SFColor: Field });
  let exported;
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => { exported = blob; return 'blob:test-export'; }; URL.revokeObjectURL = () => {};
  await import(new URL('app.mjs?browserless-events', root));
  await new Promise(resolve => setImmediate(resolve));
  let clock = performance.now();
  return {
    ids, nodes, document, get state() { return window.GizaHorizon.state; }, get activeView() { return activeView; },
    select: (key, value) => elements.find(e => e.dataset[key] === value),
    async seek(seconds) { ids.get('timeline').value = String(seconds); await ids.get('timeline').fire('input'); },
    async level(value) { ids.get('encounter').value = value; await ids.get('encounter').fire('change'); },
    async tick(count, milliseconds = 100) { for (let i = 0; i < count; i++) { const callback = frames.shift(); assert.ok(callback); callback(clock += milliseconds); } },
    async exported() { await ids.get('export').click(); return JSON.parse(await exported.text()); },
    async restore(value) { ids.get('session-file').files = [{ size: JSON.stringify(value).length, text: async () => JSON.stringify(value) }]; await ids.get('session-file').fire('change'); },
    cleanup() { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; for (const [key, descriptor] of old) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; },
  };
}

test('actual application events preserve the accepted journey contracts without a browser', async t => {
  const h = await harness();
  try {
    await t.test('boot resolves actual control IDs and scene DEFs, and loads eight evidence cards', () => {
      for (const [, id] of source.matchAll(/\$\('([^']+)'\)/g)) assert.ok(h.ids.has(id), `Missing HTML id: ${id}`);
      assert.equal(h.document.documentElement.dataset.ready, 'true'); assert.equal(h.state.ready, true);
      assert.equal(h.ids.get('failure').hidden, true); assert.equal(h.ids.get('evidence-cards').children.length, 8);
    });
    await t.test('perspective switches preserve time and isolate first-person from the royal bodies', async () => {
      await h.seek(90); const seconds = h.state.seconds;
      await h.select('camera', 'first-person').click();
      assert.equal(h.state.seconds, seconds); assert.equal(h.state.cameraMode, 'first-person'); assert.equal(h.activeView, 'V_Immersive');
      assert.equal(h.nodes.get('SW_ROYAL_BODY').whichChoice, -1); assert.equal(h.nodes.get('SW_KA').whichChoice, -1);
      assert.equal(h.nodes.get('SW_DEVICE').whichChoice, 0);
      await h.select('camera', 'witness').click();
      assert.equal(h.state.seconds, seconds); assert.equal(h.activeView, 'V_Witness');
      assert.equal(h.nodes.get('SW_ROYAL_BODY').whichChoice, 0); assert.equal(h.nodes.get('SW_KA').whichChoice, 0);
    });
    await t.test('encounter caps change actual reveal switches without seeking or changing perspective', async () => {
      for (const [level, expected] of [['geometry', [-1, -1, -1]], ['craft', [0, 0, -1]], ['beings', [0, 0, 0]]]) {
        await h.level(level);
        assert.deepEqual(['SW_MACHINERY', 'SW_CRAFT', 'SW_BEINGS'].map(name => h.nodes.get(name).whichChoice), expected);
        assert.equal(h.nodes.get('SW_COSMIC').whichChoice, 0); assert.equal(h.state.seconds, 90); assert.equal(h.state.cameraMode, 'witness');
      }
    });
    await t.test('reduced motion holds the camera during playback and explicit seeking reframes it', async () => {
      await h.seek(54); await h.select('camera', 'first-person').click();
      h.ids.get('motion').checked = true; await h.ids.get('motion').fire('change'); await h.ids.get('play').click();
      const held = [...h.nodes.get('V_Immersive').position]; await h.tick(1);
      const beforeLongFrame = h.state.seconds; await h.tick(1, 500);
      assert.ok(Math.abs(h.state.seconds - beforeLongFrame - 0.5) < 1e-9, 'a slow frame must not slow the narrative clock');
      await h.tick(14);
      assert.ok(h.state.seconds > 55); assert.deepEqual([...h.nodes.get('V_Immersive').position], held);
      await h.seek(72); assert.notDeepEqual([...h.nodes.get('V_Immersive').position], held); assert.equal(h.state.playing, false);
    });
    await t.test('real export/import events preserve schema 2 and migrate legacy files to the Was story', async () => {
      await h.seek(90); await h.level('beings'); const saved = await h.exported();
      assert.equal(saved.schema, 'giza-horizon/2'); assert.equal(saved.cameraMode, 'first-person'); assert.equal(saved.stage.device, 0);
      await h.ids.get('reset').click(); await h.level('geometry'); await h.restore(saved);
      assert.equal(h.state.cameraMode, 'first-person'); assert.equal(h.state.encounterLevel, 'beings'); assert.equal(h.state.seconds, 90);
      assert.equal(h.nodes.get('SW_ROYAL_BODY').whichChoice, -1); assert.equal(h.state.playing, false);
      await h.restore({ ...saved, schema: 'giza-horizon/1', view: 'V_Ritual', stage: { ...saved.stage, device: 2, contact: false } });
      assert.equal(h.state.cameraMode, 'witness'); assert.equal(h.state.encounterLevel, 'geometry'); assert.equal(h.state.view, 'V_Ritual');
      assert.equal(h.nodes.get('SW_DEVICE').whichChoice, 0); assert.equal(h.nodes.get('SW_CRAFT').whichChoice, -1);
      assert.match(h.ids.get('change-note').textContent, /^Experiment restored/);
    });
  } finally { h.cleanup(); }
});
