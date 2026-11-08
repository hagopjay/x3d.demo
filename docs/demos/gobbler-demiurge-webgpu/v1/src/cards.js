/* Tooltip and card content for Gobbler v4. Pure functions from the graph (graph-v3.json) and the trimmed ontology block
 * (data/onto-hover.json) to HTML strings; no DOM, so the node tests run the same code as the page.
 * Rules: every card names provenance and grade; only fields that exist in the graph are shown; every dynamic string is escaped.
 *   var C = Cards.create(G, ONTO)       // ONTO optional
 *   C.tip(i, extra)    -> {label, meta, hex, fam}
 *   C.card(i, tier)    -> {html, hex, fam, long}         tier 2 = card (0.45 s), tier 3 = deep (1.2 s or click)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Cards = factory();
})(this, function () {
  'use strict';
  var PAL = { Standard: '#facc73', Component: '#facc73', NodeType: '#facc73', Tool: '#57dbf5', Validator: '#57dbf5', Repo: '#57dbf5', Org: '#f575a8', Person: '#f575a8', Event: '#f575a8',
              Workstream: '#ff9e42', Document: '#ff9e42', Dataset: '#ff9e42', Scene: '#ff9e42', Experiment: '#9ef275', Finding: '#9ef275', Metric: '#9ef275', Rule: '#ad85ff', Decision: '#ad85ff', Loop: '#fff2cc' };
  var FAM = { Standard: 'spec', Component: 'spec', NodeType: 'spec', Tool: 'tool', Validator: 'tool', Repo: 'tool', Org: 'people', Person: 'people', Event: 'people',
              Workstream: 'work', Document: 'work', Dataset: 'work', Scene: 'work', Experiment: 'learn', Finding: 'learn', Metric: 'learn', Rule: 'rule', Decision: 'rule', Loop: 'loop' };
  var FAMHEX = { spec: '#facc73', tool: '#57dbf5', people: '#f575a8', work: '#ff9e42', learn: '#9ef275', rule: '#ad85ff', loop: '#fff2cc' };
  var PROV = { data: ['live data', 'dat'], doc: ['quoted', 'doc'], model_recall: ['recalled', 'rec'], simulated: ['simulated', 'sim'] };
  var GRADE = { Confirmed: 3, Likely: 2, Suspected: 1 };
  var REL_ROWS = 4, QUOTE_MAX = 220, LONG_TITLE = 30;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
  function rank(e) { return (GRADE[e.grade] || 0) * 10 + (e.prov === 'data' ? 5 : 0); }
  function provTag(p) { var v = PROV[p] || [p || 'unknown', '']; return '<span class="gv4-tag ' + v[1] + '">' + esc(v[0]) + '</span>'; }
  function gradeTag(g) { return '<span class="gv4-tag g-' + esc(g || 'none') + '">' + esc(g || 'ungraded') + '</span>'; }
  function tierDots(n) { return '<span class="gv4-tier" title="' + (n >= 3 ? 'deep' : 'card') + '"><i class="on"></i><i class="on"></i><i' + (n >= 3 ? ' class="on"' : '') + '></i></span>'; }

  function create(G, ONTO) {
    if (!G.adj) { G.adj = G.nodes.map(function () { return []; }); G.edges.forEach(function (x, k) { G.adj[x.s].push(k); G.adj[x.t].push(k); }); }
    var relCache = {};
    function rels(i) {
      if (relCache[i]) return relCache[i];
      var list = G.adj[i].slice().sort(function (a, b) { return (rank(G.edges[b]) - rank(G.edges[a])) || (G.nodes[otherEnd(G.edges[b], i)].deg - G.nodes[otherEnd(G.edges[a], i)].deg) || (a - b); });
      return (relCache[i] = list);
    }
    function otherEnd(e, i) { return e.s === i ? e.t : e.s; }
    function hex(n) { return PAL[n.cls] || '#b9b2a5'; }
    function onto(n) {
      if (!ONTO || (n.cls !== 'NodeType' && n.cls !== 'Component')) return null;
      var has = Object.prototype.hasOwnProperty, key = String(n.label).toLowerCase(), id = has.call(ONTO.by_lower, key) ? ONTO.by_lower[key] : null;      /* own keys only: a star called "constructor" is not a class */
      return id && has.call(ONTO.c, id) ? { id: id, c: ONTO.c[id] } : null;
    }

    function relRows(i, list, k) {
      return list.slice(0, k).map(function (ei) {
        var e = G.edges[ei], o = otherEnd(e, i), on = G.nodes[o], out = e.s === i;
        return '<li data-go="' + o + '"><span class="p">' + (out ? '→ ' : '← ') + esc(String(e.p).replace(/_/g, ' ')) + '</span><span class="n">' + esc(on.label) + '</span><span class="c">' + esc(on.cls) + '</span><i class="gv4-gd ' + esc(e.grade) + '" title="' + esc(e.grade) + '"></i></li>';
      }).join('');
    }
    function bestQuote(i, list) {
      for (var k = 0; k < Math.min(list.length, 6); k++) { var e = G.edges[list[k]]; if (e.ev && e.ev[0]) return { text: e.ev[0], doc: e.docs && e.docs[0], prov: e.prov }; }
      return null;
    }
    function metricTiles(n) {
      return '<div class="gv4-met">' + n.metrics.slice(0, 3).map(function (m) {
        var v = String(m.value == null ? '' : m.value), k = v.match(/^([~≈<>≤≥$]*\s*\d[\d.,]*%?)\s*(.*)$/), big = k ? k[1] : v, unit = k ? k[2] : '';
        return '<div><b' + (big.length > 9 ? ' class="s"' : '') + '>' + esc(big) + (unit ? '<small>' + esc(clip(unit, 14)) + '</small>' : '') + '</b><span>' + esc(clip(m.name, 70)) + '</span></div>';
      }).join('') + '</div>';
    }
    function ontoBlock(n, o) {
      var c = o.c, h = '<div class="gv4-crumb">' + c.a.map(esc).join(' › ') + (c.a.length ? ' › ' : '') + '<b>' + esc(o.id) + '</b></div>';
      if (c.d) h += '<blockquote>“' + esc(c.d) + '”<cite>ontology 4.1 definition' + (c.cp ? ' · component ' + esc(c.cp) : '') + ' · ' + c.nf + ' fields</cite></blockquote>';
      if (c.n > 0) {
        h += '<div class="gv4-bar" title="XSD verdicts on the ontology’s predicted placements"><i class="a" style="flex:' + c.A + '"></i><i class="r" style="flex:' + c.R + '"></i><i class="i" style="flex:' + c.I + '"></i></div>' +
          '<div class="gv4-barcap">The ontology predicts <b>' + c.n + '</b> placements for ' + esc(o.id) + '; XSD 4.1 accepts <b>' + c.A + '</b>, rejects <b>' + c.R + '</b>, <b>' + c.I + '</b> inconclusive <em>map, not gate</em></div>';
        if (c.aps && c.aps.length) h += '<div class="gv4-small">accepted under ' + c.aps.map(esc).join(', ') + (c.ap > c.aps.length ? ' +' + (c.ap - c.aps.length) + ' more' : '') + '</div>';
      }
      return h;
    }
    function footOnto(o) { var m = ONTO.meta; return 'ontology 4.1 sha ' + esc(m.ontology_sha256_16.slice(0, 8)) + '… · ' + esc(m.xsd) + (m.mcp_commit ? ' · x3d_mcp ' + esc(m.mcp_commit) : ''); }

    function card(i, tier) {
      var n = G.nodes[i], list = rels(i), o = onto(n), h = '', q = bestQuote(i, list), deep = tier >= 3;
      h += '<div class="gv4-hd"><i class="gv4-sw" style="--c:' + hex(n) + '"></i><span class="cls">' + esc(n.cls) + '</span>' + tierDots(deep ? 3 : 2) + '<span class="tags">' + provTag(n.prov) + gradeTag(n.grade) + '</span></div>';
      var long = String(n.label).length > LONG_TITLE;
      h += '<h4' + (long ? ' class="long"' : '') + '>' + esc(n.label) + '</h4>';
      if (n.metrics && n.metrics.length) h += metricTiles(n);
      else if (q) h += '<blockquote>“' + esc(clip(q.text, QUOTE_MAX)) + '”<cite>' + esc(q.doc || '') + (q.prov ? ' · ' + esc((PROV[q.prov] || [q.prov])[0]) : '') + '</cite></blockquote>';
      else if (n.notes && n.notes[0]) h += '<blockquote>“' + esc(clip(n.notes[0], QUOTE_MAX)) + '”</blockquote>';
      if (deep && o) h += ontoBlock(n, o);
      if (list.length) {
        h += '<div class="gv4-nbh">Connected to · ' + list.length + ' relation' + (list.length === 1 ? '' : 's') + '</div><ul class="gv4-nb">' + relRows(i, list, REL_ROWS) +
          (list.length > REL_ROWS ? '<li class="more">+ ' + (list.length - REL_ROWS) + ' more</li>' : '') + '</ul>';
      } else h += '<div class="gv4-nbh">Untethered · no relations</div>';
      if (deep) {
        var first = list.length && G.edges[list[0]];
        if (first && first.ev && first.ev[0] && q && q.text !== first.ev[0]) h += '<blockquote class="edge">“' + esc(clip(first.ev[0], QUOTE_MAX)) + '”<cite>edge evidence · ' + esc((first.docs && first.docs[0]) || '') + '</cite></blockquote>';
        var pk = Object.keys(n.props || {}).slice(0, 4);
        if (pk.length) h += '<ul class="gv4-kv">' + pk.map(function (k) { return '<li><span>' + esc(k) + '</span>' + esc(clip(n.props[k], 60)) + '</li>'; }).join('') + '</ul>';
        if (n.loops && n.loops.length) h += '<div class="gv4-small">in loop' + (n.loops.length > 1 ? 's' : '') + ' ' + n.loops.slice(0, 3).map(function (li) { var L = G.loops[li]; if (!L) return ''; var at = L.steps.indexOf(i); return esc(L.name) + (at >= 0 ? ' (step ' + (at + 1) + ' of ' + L.steps.length + ')' : ''); }).filter(Boolean).join(' · ') + '</div>';
        if (n.docs && n.docs.length) h += '<div class="gv4-small">sources ' + n.docs.slice(0, 2).map(esc).join(' · ') + (n.docs.length > 2 ? ' +' + (n.docs.length - 2) + ' more' : '') + '</div>';
      }
      var foot = (n.metrics && n.metrics.length && n.metrics[0].check) ? 'measured: ' + esc(n.metrics[0].check) + (n.metrics[0].doc ? ' · ' + esc(n.metrics[0].doc) : '') + '<br>' : '';
      if (deep && o) foot = footOnto(o) + '<br>';
      h += '<div class="gv4-ft">' + foot + '<span class="hk"><kbd>click</kbd> pin</span> · <span class="hk"><kbd>F</kbd> fly</span> · <span class="hk"><kbd>Esc</kbd> close</span></div>';
      return { html: h, hex: hex(n), fam: FAM[n.cls] || 'spec', long: long, onto: !!o };
    }
    function tip(i, extra) {
      var n = G.nodes[i], l = String(n.label), label = l.length > 38 ? l.slice(0, 37) + '\u2026' : l, meta = n.cls + ' \u00b7 ' + (PROV[n.prov] || [n.prov || 'unknown'])[0], hx = hex(n);
      return { label: label, meta: meta, hex: hx, fam: FAM[n.cls] || 'spec', extra: extra || 0,
               html: '<i class="gv4-sw" style="--c:' + hx + '"></i><b>' + esc(label) + '</b><span class="m">' + esc(meta) + '</span>' + (extra > 0 ? '<span class="k" title="more stars within 12 px: arrows cycle">+' + extra + '</span>' : '') };
    }
    return { card: card, tip: tip, rels: rels, onto: onto, hex: hex, esc: esc };
  }
  return { create: create, esc: esc, clip: clip, PAL: PAL, FAM: FAM, FAMHEX: FAMHEX, PROV: PROV };
});
