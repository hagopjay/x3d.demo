/* Semantic Twin Lab worker. The caller owns its wall-clock watchdog and may
   terminate this worker: a synchronous reasoner cannot cancel its own event loop. */
importScripts('vendor/lab-stack.js', 'engine.js');
const fetchText = p => {
  const url = new URL(p, self.location.href);
  if (url.origin !== self.location.origin || url.username || url.password) throw new Error('Worker assets must stay on this origin.');
  return fetch(url.href, { cache: 'force-cache', credentials: 'same-origin', redirect: 'error' }).then(r => { if (!r.ok) throw new Error(p + ' HTTP ' + r.status); return r.text(); });
};
let ready = null, queue = Promise.resolve(), queued = 0;
const OPS = new Set(['init', 'run', 'warm', 'preload', 'inspectReasoning']);
const replyError = (id, err) => postMessage({ id, ok: false, error: String(err && err.message || err).slice(0, 600), error_code: err && err.code || 'LAB_ENGINE_ERROR' });
self.onmessage = e => {
  const message = e.data;
  if (!message || typeof message !== 'object' || !Number.isSafeInteger(message.id) || message.id < 1) return;
  const { id, op, args = {} } = message;
  if (!OPS.has(op)) return replyError(id, Object.assign(new Error('Unknown engine operation.'), { code: 'LAB_WORKER_OPERATION' }));
  if (!args || typeof args !== 'object' || Array.isArray(args)) return replyError(id, Object.assign(new Error('Worker arguments must be an object.'), { code: 'LAB_WORKER_ARGUMENTS' }));
  if (queued >= 8) return replyError(id, Object.assign(new Error('The worker queue is full; wait for the running job or restart the worker.'), { code: 'LAB_WORKER_BUSY' }));
  queued++;
  queue = queue.then(async () => {
    try {
      if (op === 'init') {
        if (!ready) ready = fetchText('data/manifest.json').then(t => { self.LabEngine.init(fetchText, JSON.parse(t)); return true; }).catch(err => { ready = null; throw err; });
        await ready; return postMessage({ id, ok: true, result: true });
      }
      if (!ready) throw Object.assign(new Error('Initialize the engine worker before submitting jobs.'), { code: 'LAB_NOT_INITIALIZED' });
      await ready;
      let result;
      if (op === 'run') result = await self.LabEngine.run(args.job, args.editText);
      else if (op === 'warm') result = await self.LabEngine.warm();
      else if (op === 'preload') result = await self.LabEngine.preload(args.graphs);
      else if (op === 'inspectReasoning') result = await self.LabEngine.inspectReasoning(args);
      postMessage({ id, ok: true, result });
    } catch (err) { replyError(id, err); }
    finally { queued--; }
  }).catch(err => replyError(id, err));
};
