/* js-port-of-8dd0d3e -- Web Worker proxy for x3dval.js.
 * Works as a classic Worker (importScripts) and as a module Worker (dynamic import()).
 * Protocol: {id, op:'load'|'validate'|'validateXml'|'validateSemantic'|'semanticDiagnostics'|'precompile'|'info', args:[...]}
 *        -> {id, ok:true, result} | {id, ok:false, error:{name, message, stack}}; load also posts {id, progress:{stage,...}}.
 * The worker posts {type:'booted'} once x3dval.js is evaluated. A 'load' message may carry {base} (required for blob: workers).
 */
(function () {
  var BASE = (typeof location !== 'undefined' && location.href && !/^blob:/.test(location.href)) ? location.href.replace(/[^/]*$/, '') : '';
  var queue = [];
  var ready = false;

  function boot() {
    if (typeof importScripts === 'function') {
      importScripts(BASE + 'x3dval.js');
      return Promise.resolve();
    }
    return import(BASE + 'x3dval.js');
  }

  function fail(id, e) {
    self.postMessage({ id: id, ok: false, error: { name: e && e.name || 'Error', message: String(e && e.message || e), stack: e && e.stack || '' } });
  }

  function handle(m) {
    var id = m.id, op = m.op, args = m.args || [];
    var X3DVAL = self.X3DVAL;
    try {
      if (op === 'load') {
        var o = args[0] || {};
        X3DVAL.load({
          base: o.base || BASE,
          precompile: o.precompile,
          onProgress: function (p) { self.postMessage({ id: id, progress: p }); }
        }).then(function () { self.postMessage({ id: id, ok: true, result: X3DVAL.info() }); }, function (e) { fail(id, e); });
        return;
      }
      if (typeof X3DVAL[op] !== 'function') throw new Error('unknown op ' + op);
      var result = X3DVAL[op].apply(X3DVAL, args);
      self.postMessage({ id: id, ok: true, result: result === undefined ? null : result });
    } catch (e) { fail(id, e); }
  }

  self.onmessage = function (ev) {
    if (!ready) queue.push(ev.data);
    else handle(ev.data);
  };

  boot().then(function () {
    ready = true;
    self.postMessage({ type: 'booted' });
    var q = queue; queue = [];
    q.forEach(handle);
  }, function (e) {
    var q = queue; queue = [];
    q.forEach(function (m) { fail(m.id, e); });
    throw e;
  });
})();
