/* gfx-guard-v2.js: an explicit failure state for WebGL demos (x3d.demo, 18 Nov 2026).
 *
 * v2 (second external review, 18 Nov 2026): v1's slow branch built `style + div` and appended only
 * `firstChild`, which is the STYLE element, so the "taking longer" alert never appeared. v2 appends every node,
 * removes the slow note once the page reports ready, and refuses non-http(s)/relative fallback links
 * (javascript: and data: URLs). v1 (gfx-guard.js) is kept unchanged for the pages that load it.
 *
 * Written after the external accountability review of 18 Nov 2026 (defect 9): when graphics could not start,
 * Giza VI kept its boot overlay forever and the D3 bridge dereferenced an undefined browser. A reader saw a blank
 * panel or an endless "loading" and no reason. This guard runs BEFORE the demo's own code and:
 *   1. probes the graphics API the demo needs (webgl2 or webgl) on a throwaway canvas;
 *   2. if it is missing, writes a visible failure panel (role=alert) with the reason, what to try, a still
 *      image and links that work without graphics, and returns false so the page does not start its engine;
 *   3. if the probe passes, listens for uncaught errors and rejections until the page reports ready
 *      (GfxGuard.ready(), or the boot element gaining the class named in readyClass), and turns any of them
 *      into the same panel instead of a frozen overlay;
 *   4. after timeoutMs without ready, adds a "taking longer than expected" note with the same fallbacks
 *      (a slow software rasteriser is not a failure, so the page keeps trying).
 * Every outcome is logged as [gfx-guard] on the console and kept on window.GfxGuard.state for test rigs.
 * No network, no dependencies. Classic script: include it with <script src> before the demo's scripts.
 */
(function () {
  'use strict';
  var state = { api: null, probe: null, outcome: 'pending', reason: '', renderer: '', t0: Date.now() };
  var opts = null, readyFlag = false, shown = false, slowNode = null;

  function log(msg) { try { console.log('[gfx-guard] ' + msg); } catch (e) { /* no console */ } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeHref(h) { h = String(h || '').trim(); return /^(https?:|\/|\.{0,2}\/|#|[\w.-]+(\/|$|\?|#))/i.test(h) && !/^\s*(javascript|data|vbscript):/i.test(h) ? h : null; }

  function probe(api) {
    var c = document.createElement('canvas'), gl = null, err = '';
    try { gl = c.getContext(api) || (api === 'webgl' ? c.getContext('experimental-webgl') : null); } catch (e) { err = e && e.message || String(e); }
    if (!gl) return { ok: false, reason: (api === 'webgl2' ? 'WebGL 2' : 'WebGL') + ' is not available in this browser' + (err ? ': ' + err : '') };
    var r = '';
    try { var x = gl.getExtension('WEBGL_debug_renderer_info'); r = x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { /* masked */ }
    try { var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (e) { /* fine */ }
    return { ok: true, renderer: String(r || '') };
  }

  function panel(kind, reason) {
    var host = (opts.bootId && document.getElementById(opts.bootId)) || document.body;
    var links = (opts.fallbacks || []).map(function (f) { var h = safeHref(f.href); return h ? '<li><a href="' + esc(h) + '">' + esc(f.label) + '</a></li>' : ''; }).join('');
    var still = opts.still ? '<img src="' + esc(opts.still) + '" alt="' + esc(opts.stillAlt || 'A still frame of this demo') + '" style="max-width:min(640px,100%);height:auto;border-radius:6px;margin:8px 0">' : '';
    var title = kind === 'slow' ? (opts.title || 'This demo') + ' is taking longer than expected' : (opts.title || 'This demo') + ' could not start its 3D view';
    var tips = kind === 'slow'
      ? '<p>It is still trying. Software rendering (no GPU) can take a minute or more.</p>'
      : '<p><b>Reason:</b> ' + esc(reason) + '</p><p>Try: turn on hardware acceleration in the browser settings, update the graphics driver, or open the page in another browser. In Chrome, <code>chrome://gpu</code> shows whether WebGL is blocked on this machine.</p>';
    // the host page's own boot-screen CSS (big letter-spaced <b>, centred <p>) must not restyle the panel
    var css = '<style>.gfx-guard,.gfx-guard *{letter-spacing:normal!important;text-transform:none!important;font-family:system-ui,sans-serif!important}'
      + '.gfx-guard b,.gfx-guard p,.gfx-guard li,.gfx-guard td{font-size:15px!important;font-weight:400;margin:6px 0;text-align:left!important;color:inherit}'
      + '.gfx-guard b{font-weight:700!important}.gfx-guard .gg-t{font-size:18px!important}.gfx-guard a{color:#9cd0ff}.gfx-guard td{padding:2px 6px;vertical-align:top;font-size:13px!important}</style>';
    var html = css + '<div class="gfx-guard" role="alert" style="font:15px/1.45 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:16px 20px;border:1px solid #c66;border-radius:8px;background:#1b1214;color:#f3e9e9;text-align:left">'
      + '<b class="gg-t">' + esc(title) + '</b>' + tips + still
      + (links ? '<p>These work without 3D graphics:</p><ul>' + links + '</ul>' : '')
      + (kind === 'slow' ? '' : '<p><button type="button" onclick="location.reload()">Try again</button></p>') + '</div>';
    if (kind === 'slow') {
      var d = document.createElement('div'); d.className = 'gfx-guard-slow'; d.innerHTML = html; slowNode = d;
      // the whole note (style AND alert), and above the boot overlay's own content
      host.appendChild(d);
    }
    else { host.innerHTML = html; host.classList && host.classList.remove('done'); host.style.display = ''; host.style.opacity = '1'; host.style.pointerEvents = 'auto'; host.style.overflow = 'auto'; }
    if (kind !== 'slow' && typeof opts.onFail === 'function') { try { opts.onFail(reason); } catch (e) { /* the fallback is optional */ } }
  }

  function fail(reason) {
    if (readyFlag || (shown && state.outcome === 'failed')) return;
    shown = true; state.outcome = 'failed'; state.reason = reason;
    log('FAILED after ' + (Date.now() - state.t0) + ' ms: ' + reason);
    panel('fail', reason);
  }

  var G = {
    state: state,
    /* require({api, bootId, readyClass, timeoutMs, title, still, stillAlt, fallbacks:[{href,label}], onFail}) -> bool */
    require: function (o) {
      opts = o || {}; state.api = opts.api || 'webgl2';
      var p = probe(state.api); state.probe = p; state.renderer = p.renderer || '';
      if (!p.ok) { fail(p.reason); return false; }
      log(state.api + ' ok, renderer "' + state.renderer + '"');
      window.addEventListener('error', function (e) { if (!readyFlag) fail('script error during start-up: ' + (e.message || (e.error && e.error.message) || 'unknown')); });
      window.addEventListener('unhandledrejection', function (e) { if (!readyFlag) fail('start-up promise rejected: ' + ((e.reason && e.reason.message) || e.reason)); });
      var boot = opts.bootId && document.getElementById(opts.bootId);
      if (boot && opts.readyClass && window.MutationObserver) {
        new MutationObserver(function () { if (boot.classList.contains(opts.readyClass) && state.outcome !== 'failed') G.ready(); })
          .observe(boot, { attributes: true, attributeFilter: ['class'] });
      }
      if (opts.timeoutMs) setTimeout(function () { if (!readyFlag && state.outcome === 'pending') { state.outcome = 'slow'; log('not ready after ' + opts.timeoutMs + ' ms'); panel('slow', ''); } }, opts.timeoutMs);
      return true;
    },
    ready: function () {
      if (readyFlag) return; readyFlag = true; if (state.outcome !== 'failed') state.outcome = 'ready';
      if (slowNode && slowNode.parentNode) { slowNode.parentNode.removeChild(slowNode); slowNode = null; }
      log('ready after ' + (Date.now() - state.t0) + ' ms');
    },
    version: 2,
    fail: fail
  };
  window.GfxGuard = G;
})();
