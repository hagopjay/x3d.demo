/* Semantic Twin Lab engine worker: keeps SPARQL, SHACL and N3 reasoning off the render thread (X_ITE keeps drawing). */
importScripts('vendor/lab-stack.js', 'engine.js');
const fetchText = p => fetch(p, { cache: 'force-cache' }).then(r => { if (!r.ok) throw new Error(p + ' HTTP ' + r.status); return r.text(); });
let ready = null;
self.onmessage = async e => {
  const { id, op, args } = e.data;
  try {
    if (op === 'init') { ready = fetchText('data/manifest.json').then(t => { self.LabEngine.init(fetchText, JSON.parse(t)); return true; }); await ready; return postMessage({ id, ok: true, result: true }); }
    await ready;
    let result;
    if (op === 'run') result = await self.LabEngine.run(args.job, args.editText);
    else if (op === 'warm') result = await self.LabEngine.warm();
    else if (op === 'preload') result = await self.LabEngine.preload(args.graphs);
    postMessage({ id, ok: true, result });
  } catch (err) { postMessage({ id, ok: false, error: String(err && err.message || err).slice(0, 600) }); }
};
