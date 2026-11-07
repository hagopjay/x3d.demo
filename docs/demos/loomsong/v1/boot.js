/* Loomsong boot: read the config, build the app and its interface, open the first piece. The page wants #ode or #turca in the address for the first piece. */
(function (global) {
  'use strict';
  var d = global.document;
  var cfg = JSON.parse(d.getElementById('ls-cfg').textContent);
  var root = d.getElementById('ls-root'), host = d.getElementById('ls-stage');
  var app = new global.LoomApp(cfg);
  app.host = host;
  global.Loomsong = app;
  var ui = new global.LoomUI(app, root);
  app.ui = ui;
  app.cards = ui.cards = new global.LoomCards(app, ui, root);          // the animated pictures, when the build shipped any
  var hover = new global.LoomHover(app);
  hover.ui = ui;
  app.hover = hover;
  app.on('piece', function (p, meta) { hover.attach(app.browser.currentScene, meta); });
  // How this browser ran the page, written to the page's own store for its builder: only where the host gives the page that store; anywhere else the report is off and says nothing.
  // The host's runtime object is named by the build (LOOM_HOST_API when page/build_page.py runs, kept in the config), not by this source. The witnesses name a stand-in in the address (?clock=manual&hostapi=NAME).
  var hostName = cfg.hostApi || '', standIn = /[?&]hostapi=([A-Za-z_$][\w$]*)/.exec(global.location.search);
  if (standIn && /[?&]clock=manual/.test(global.location.search)) hostName = standIn[1];
  var hostDb = function () {
    if (!hostName) return null;
    return new Promise(function (resolve) {
      var tries = 0;
      (function look() {
        var api = global[hostName];
        if (api && typeof api.use === 'function') { resolve(api.use('db')); return; }
        if (++tries > 20) { resolve(null); return; }                // the host did not give this page its runtime object within two seconds: no store
        global.setTimeout(look, 100);
      })();
    });
  };
  app.report = new global.LoomReport(app, hostDb);
  app.report.ready.then(function (on) {
    if (on) ui.splashSmall.textContent += ' This preview tells its builder how it ran: browser, graphics card, frame rate. No names, no clicks.';
  });
  if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) app.calm = true;     // calm mode by default for people who ask for less motion
  var want = (global.location.hash || '').replace('#', '');
  var first = cfg.pieces.some(function (p) { return p.id === want; }) ? want : cfg.pieces[0].id;
  app.start(host, first).catch(function (e) { ui.splashNote.textContent = 'Could not load: ' + e; global.console.error(String(e)); });
})(window);
