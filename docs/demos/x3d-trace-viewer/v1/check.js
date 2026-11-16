/* Live check for the trace viewer: FIND and a number/version COMPARE, in the browser, on whatever text is on screen.
   Not the full engine: no reworded verdict, no conversions, no policy; those come from the recorded report (x3dtrace, Python).
   Pure functions, no DOM, so node can run the same file (test/check.test.mjs). */
(function (root) {
  'use strict';
  var NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Every place `quote` stands in `text` as a whole run: whitespace is flexible, case is not, and a quote that starts or ends
     with a letter or digit may not be glued to more of them (intensity="12" is not in intensity="120", 1.5 is not in 1.55). */
  function findAll(text, quote) {
    var q = (quote || '').trim();
    if (!q) return [];
    var parts = q.split(/\s+/).map(esc).join('\\s+');
    var pre = /^[0-9A-Za-z_]/.test(q) ? '(?<![0-9A-Za-z_.])' : '';
    var post = /[0-9A-Za-z_]$/.test(q) ? '(?![0-9A-Za-z_]|\\.\\d)' : '';
    var re = new RegExp(pre + parts + post, 'g'), out = [], m;
    while ((m = re.exec(text)) !== null) { out.push({ s: m.index, e: m.index + m[0].length }); if (m[0].length === 0) re.lastIndex++; }
    return out;
  }

  function numbers(str) { return (String(str).match(NUM) || []).map(Number); }
  function flat(v) { return Array.isArray(v) ? v.map(Number) : (typeof v === 'number' ? [v] : null); }

  /* A version is a string: a whole dotted token, optional leading v, not 5.8.40, 15.8.4, 5.8.4.1 or 4.8.5. */
  function versionInQuote(value, quote) {
    return new RegExp('(?<![0-9A-Za-z.])v?' + esc(String(value).trim()) + '(?![0-9A-Za-z]|\\.\\d)').test(quote);
  }

  function words(s) { return (String(s).toLowerCase().match(/[a-z0-9]+/g) || []); }
  function contains(hay, needle) {
    if (!needle.length) return false;
    for (var i = 0; i + needle.length <= hay.length; i++) { var ok = true; for (var j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; } if (ok) return true; }
    return false;
  }

  function compareValue(value, quote, ftype) {
    var qn = numbers(quote), vn = flat(value), tol = 1e-6;
    if (ftype === 'version') return versionInQuote(value, quote) ? 'match' : 'mismatch';
    if (vn) {
      if (vn.length === 1) return qn.some(function (x) { return Math.abs(x - vn[0]) < tol; }) ? 'match' : 'mismatch';
      for (var i = 0; i + vn.length <= qn.length; i++) { var ok = true; for (var j = 0; j < vn.length; j++) if (!(Math.abs(qn[i + j] - vn[j]) < tol)) { ok = false; break; } if (ok) return 'match'; }
      return 'mismatch';
    }
    if (typeof value === 'string') return contains(words(quote), words(value)) ? 'match' : 'mismatch';
    return 'unchecked';
  }

  /* verdict for one claim against one text */
  function live(text, claim) {
    if (!claim.quote || !claim.quote.trim()) return { verdict: 'unchecked', status: 'no_quote', places: [], value: 'unchecked' };
    var places = findAll(text, claim.quote);
    if (!places.length) return { verdict: 'check', status: 'not_found', places: [], value: 'unchecked' };
    var v = compareValue(claim.value, claim.quote, claim.ftype);
    return { verdict: v === 'match' ? 'verified' : 'check', status: 'found', places: places, value: v };
  }

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha256Hex(text) {
    if (root.crypto && root.crypto.subtle) return root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(hex);
    return Promise.resolve('');
  }

  var api = { findAll: findAll, numbers: numbers, compareValue: compareValue, versionInQuote: versionInQuote, live: live, sha256Hex: sha256Hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TraceCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
