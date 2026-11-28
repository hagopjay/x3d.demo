// app.js: the Live DIS page. Loads the X3D scene in X_ITE, starts the runtime, feeds it PDUs from the in-page
// scripted exercise or from a UDP gateway, and shows what the six DIS nodes hold.
import { LiveDisRuntime } from './dis-runtime.js';
import { ScriptedExercise, ExerciseSource, ENTITIES, EXERCISE_ORIGIN, RADIO } from './dis-exercise.js';
import { hexDump, describePdu, PDU_TYPE_NAME } from './dis-codec.js';
import { DRM_NAME, DRM_LONG_NAME, distance } from './dis-dr.js';
import { muLawDecode, muLawEncode } from './dis-signal.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// `shift` moves the clock of the in-page exercise (tests use it to start at a chosen moment of the script).
const SHIFT = Number(params.get('shift') ?? 0);
const now = () => (performance.timeOrigin + performance.now()) / 1000 + SHIFT;
const X3D = window.X3D;

const guardOk = window.GfxGuard ? window.GfxGuard.require({ api: 'webgl2', bootId: 'boot', readyClass: 'ready', timeoutMs: 25000, title: 'Live DIS', still: 'shot.png', stillAlt: 'A still of the Live DIS page', fallbacks: [{ href: 'README.md', label: 'Read the receipts for this demo' }, { href: 'scene/live-dis.x3d', label: 'Open the X3D file' }] }) : true;

const state = {
  mode: 'starting', sockets: [], gatewayUrl: '', errors: new Map(), history: new Map(), worstSince: now(),
  audio: null, audioHead: 0, scope: [], lastSignalAt: 0, ghosts: true, inspectEntity: 0, inspectDir: 'received', lastEspduByEntity: new Map(),
};
const COLORS = { 1: '#5fb3ff', 2: '#57d18a', 3: '#aab4c3', 4: '#f2a14e' };

async function start() {
  const browser = X3D.getBrowser($('x3d'));
  await browser.loadURL(new X3D.MFString('scene/live-dis.x3d'));
  const scene = browser.currentScene;
  const exercise = new ScriptedExercise(EXERCISE_ORIGIN);
  const runtime = new LiveDisRuntime({
    X3D, browser, scene, origin: EXERCISE_ORIGIN, now, heartbeatTimeout: Number(params.get('timeout') ?? 12),
    onSend: (bytes, channel) => { for (const s of state.sockets) if (s.readyState === 1 && s.channel.port === channel.port && s.channel.address === channel.address) s.send(bytes); },
  });
  const found = runtime.bind();
  const source = new ExerciseSource({ exercise, algorithm: Number(params.get('alg') ?? 0), rate: Number(params.get('rate') ?? 1) });
  $('alg').value = String(source.algorithm); $('rate').value = String(source.rate);
  const channel = runtime.channels()[0];
  const node = (name) => scene.getNamedNode(name);
  const N = { MGR: node('MGR'), AIRCRAFT: node('AIRCRAFT'), ROVER: node('ROVER'), BUOY: node('BUOY'), TX: node('TX'), SIG: node('SIG'), RX: node('RX'), BUOY_TX: node('BUOY_TX'), BUOY_SIG: node('BUOY_SIG'), BUOY_RX: node('BUOY_RX'), MAP_SHIP: node('MAP_SHIP'), MAP_HELICOPTER: node('MAP_HELICOPTER'), MAP_ANY: node('MAP_ANY'), GHOSTS: node('GHOSTS'), ENTITIES: node('ENTITIES') };
  const ghosts = [1, 2, 3, 4].map((n) => node(`GHOST_${n}`));
  const events = { added: [], removed: [] };
  N.MGR.addFieldCallback('app', 'addedEntities', (v) => { for (let i = 0; i < v.length; i++) events.added.push({ t: now(), entityID: v[i].entityID, marking: v[i].marking }); });
  N.MGR.addFieldCallback('app', 'removedEntities', (v) => { for (let i = 0; i < v.length; i++) events.removed.push({ t: now(), entityID: v[i].entityID, marking: v[i].marking }); });

  runtime.listeners.push((pdu, bytes, direction) => { if (pdu.header.pduType === 1) state.lastEspduByEntity.set(pdu.entityID.entity, { bytes, pdu, direction }); });

  // ---- the signal: drawn and played from the SignalPdu node's own data field --------------------------------------
  N.SIG.addFieldCallback('app', 'data', (data) => {
    const pcm = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) pcm[i] = muLawDecode(data[i]) / 32768;
    state.scope.push(pcm); while (state.scope.length > 12) state.scope.shift();
    state.lastSignalAt = now();
    if (state.audio) {
      const ctx = state.audio, buf = ctx.createBuffer(1, pcm.length, N.SIG.sampleRate || 8000);
      buf.copyToChannel(pcm, 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      if (state.audioHead < ctx.currentTime + 0.02) state.audioHead = ctx.currentTime + 0.08; // small buffer against jitter
      src.start(state.audioHead); state.audioHead += buf.duration;
    }
  });

  // ---- sources ---------------------------------------------------------------------------------------------------------
  function setMode(mode, text, cls) { state.mode = mode; const b = $('source'); b.textContent = text; b.className = 'badge ' + (cls ?? ''); resetWorst(); }
  function resetWorst() { state.errors.clear(); state.history.clear(); state.worstSince = now(); }
  function useLocal() {
    for (const s of state.sockets) s.close();
    state.sockets = []; source.reset();
    setMode('local', 'source: in-page scripted exercise (generated PDUs, no network)', 'live');
    $('alg').disabled = $('rate').disabled = false;
  }
  function useGateway(base) {
    for (const s of state.sockets) s.close();
    state.sockets = []; state.gatewayUrl = base;
    setMode('connecting', `source: connecting to gateway ${base}`, 'warn');
    $('alg').disabled = $('rate').disabled = true;
    for (const ch of runtime.channels()) {
      const ws = new WebSocket(`${base.replace(/\/$/, '')}/?address=${encodeURIComponent(ch.address)}&port=${ch.port}`);
      ws.binaryType = 'arraybuffer'; ws.channel = ch;
      ws.onopen = () => setMode('gateway', `source: UDP ${ch.address}:${ch.port} through gateway ${base}`, 'live');
      ws.onmessage = (ev) => { if (ev.data instanceof ArrayBuffer) runtime.receive(new Uint8Array(ev.data), ch); };
      ws.onclose = () => { if (state.mode === 'gateway' || state.mode === 'connecting') setMode('lost', `source: gateway ${base} is not reachable; choose the in-page source or start the gateway`, 'warn'); };
      ws.onerror = () => { /* onclose follows and reports it */ };
      state.sockets.push(ws);
    }
  }

  // ---- controls ---------------------------------------------------------------------------------------------------------
  const describeAlg = () => { const a = source.algorithm; $('algText').textContent = a ? `${a} ${DRM_LONG_NAME[a]}.` : 'Each entity uses the algorithm the script gave it.'; };
  $('alg').onchange = (e) => { source.algorithm = Number(e.target.value); resetWorst(); describeAlg(); };
  $('rate').onchange = (e) => { source.rate = Number(e.target.value); resetWorst(); };
  $('drToggle').onclick = (e) => { runtime.applyDeadReckoning = !runtime.applyDeadReckoning; e.target.classList.toggle('on', runtime.applyDeadReckoning); e.target.textContent = `dead reckoning on receiver: ${runtime.applyDeadReckoning ? 'on' : 'off'}`; resetWorst(); };
  $('ghostToggle').onclick = (e) => { state.ghosts = !state.ghosts; N.GHOSTS.whichChoice = state.ghosts ? 0 : -1; e.target.classList.toggle('on', state.ghosts); e.target.textContent = `truth markers: ${state.ghosts ? 'on' : 'off'}`; };
  $('audio').onclick = async (e) => {
    if (state.audio) { await state.audio.close(); state.audio = null; e.target.classList.remove('on'); e.target.textContent = 'enable audio'; return; }
    state.audio = new (window.AudioContext || window.webkitAudioContext)(); state.audioHead = 0;
    e.target.classList.add('on'); e.target.textContent = 'audio on (the tone comes every 16 s)';
  };
  $('gwConnect').onclick = () => useGateway($('gw').value.trim());
  $('gwLocal').onclick = useLocal;
  $('inspectEntity').onchange = (e) => { state.inspectEntity = Number(e.target.value); };
  $('inspectDir').onchange = (e) => { state.inspectDir = e.target.value; };
  for (const b of document.querySelectorAll('#views button')) b.onclick = () => browser.changeViewpoint(b.dataset.vp);
  // The buoy's radio: the button writes fields of the writer nodes; the runtime turns them into PDUs.
  function keyBuoy() {
    N.BUOY_TX.transmitState = 2;
    const n = 160, data = new Array(n);
    for (let i = 0; i < n; i++) data[i] = muLawEncode(9000 * Math.sin(2 * Math.PI * 440 * i / 8000));
    N.BUOY_SIG.samples = n; N.BUOY_SIG.dataLength = n * 8;
    N.BUOY_SIG.data = new X3D.MFInt32(...data);
    setTimeout(() => { N.BUOY_TX.transmitState = 1; }, 1500);
  }
  $('keyBuoy').onclick = keyBuoy;
  describeAlg();

  // ---- the frame loop ------------------------------------------------------------------------------------------------------
  let lastUi = 0;
  function frame() {
    const t = now();
    if (state.mode === 'local') for (const bytes of source.step(t)) runtime.receive(bytes, channel);
    runtime.tick();
    for (const e of ENTITIES) {
      const k = exercise.truth(e.entity, t), rec = runtime.entityRecord(1, 1, e.entity);
      const p = runtime.frame.ecefToLocal(k.ecef);
      ghosts[e.entity - 1].translation = new X3D.SFVec3f(p[0], k.active ? p[1] : -500, p[2]);
      if (rec && rec.active && rec.drEcef && k.active && rec.mode === 'networkReader') {
        const err = distance(rec.drEcef, k.ecef);
        const s = state.errors.get(e.entity) ?? { now: 0, worst: 0, sum: 0, n: 0 };
        s.now = err; s.sum += err; s.n++;
        if (t - state.worstSince > 1.5) s.worst = Math.max(s.worst, err); // skip the first moments after a change of settings
        state.errors.set(e.entity, s);
        const h = state.history.get(e.entity) ?? []; h.push([t, err]); while (h.length && t - h[0][0] > 30) h.shift(); state.history.set(e.entity, h);
      }
    }
    if (t - lastUi > 0.2) { lastUi = t; drawUi(t); }
    requestAnimationFrame(frame);
  }

  // ---- display -----------------------------------------------------------------------------------------------------------------
  const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '');
  const vec = (v, d = 1) => `${v.x.toFixed(d)} ${v.y.toFixed(d)} ${v.z.toFixed(d)}`;
  const kv = (el, rows) => { el.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span title="${String(v).replace(/"/g, '&quot;')}">${v}</span>`).join(''); };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function drawUi(t) {
    const st = runtime.stats;
    $('hudPdus').textContent = `${st.decoded} PDUs decoded`;
    $('hudEntities').textContent = `${runtime.espdus.filter((r) => r.active).length} entities active`;
    $('hudRadio').textContent = N.TX.transmitState === 2 ? 'KITE 01 transmitting' : 'radio idle';
    // entities
    $('entities').tBodies[0].innerHTML = runtime.espdus.map((r) => {
      const n = r.node, e = state.errors.get(n.entityID), reader = r.mode === 'networkReader';
      const name = r.manager ? 'created by DISEntityManager' : 'EspduTransform in the file';
      return `<tr><td><span class="dot ${r.active ? 'on' : ''}"></span>${esc(n.marking || n.description)}</td><td>${n.siteID}:${n.applicationID}:${n.entityID}</td><td>${name}</td><td>${reader ? 'reader' : 'writer'}</td><td>${n.deadReckoning} ${DRM_NAME[n.deadReckoning] ?? ''}</td>` +
        `<td class="num">${reader ? r.pdus : r.written}</td><td class="num">${reader && r.drAge !== undefined ? fmt(r.drAge) : ''}</td><td class="num">${reader && e ? fmt(e.now, 3) : ''}</td><td class="num">${reader && e ? fmt(e.worst, 3) : ''}</td><td>${n.isActive}</td></tr>`;
    }).join('');
    kv($('counters'), [
      ['PDUs received', st.received], ['decoded', `${st.decoded} (Entity State ${st.byType[1]}, Transmitter ${st.byType[25]}, Signal ${st.byType[26]}, Receiver ${st.byType[27]})`],
      ['decode errors', st.errors + (st.lastError ? ` (${esc(st.lastError)})` : '')], ['other PDU types', st.unsupported], ['no node wanted it', st.unmatched],
      ['sent by writer nodes', `${st.sent} (Entity State ${st.sentByType[1]}, Transmitter ${st.sentByType[25]}, Signal ${st.sentByType[26]}, Receiver ${st.sentByType[27]})`],
      ['addedEntities events', `${st.added}${events.added.length ? ', last ' + esc(events.added.at(-1).marking) : ''}`], ['removedEntities events', `${st.removed}${events.removed.length ? ', last ' + esc(events.removed.at(-1).marking) : ''}`],
    ]);
    // nodes
    const ship = runtime.entityRecord(1, 1, 3), helo = runtime.entityRecord(1, 1, 4);
    const card = (title, text, rows) => `<div class="node"><h3>${title}</h3><p>${text}</p><div class="kv">${rows.map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join('')}</div></div>`;
    const A = N.AIRCRAFT, R = N.ROVER, B = N.BUOY;
    $('nodes').innerHTML = [
      card('EspduTransform', 'DEF AIRCRAFT, networkReader', [['isActive', A.isActive], ['timestamp', new Date(A.timestamp * 1000).toISOString().slice(11, 23)], ['translation', vec(A.translation)], ['rotation', `${vec(A.rotation, 2)} ${A.rotation.angle.toFixed(2)}`], ['linearVelocity', vec(A.linearVelocity)], ['deadReckoning', `${A.deadReckoning} ${DRM_NAME[A.deadReckoning] ?? ''}`], ['marking', A.marking], ['geoCoords', `${A.geoCoords.x.toFixed(5)} ${A.geoCoords.y.toFixed(5)} ${A.geoCoords.z.toFixed(0)}`], ['entity type', `${A.entityKind}.${A.entityDomain}.${A.entityCountry}.${A.entityCategory}`]]),
      card('EspduTransform', 'DEF ROVER, networkReader, articulated', [['isActive', R.isActive], ['translation', vec(R.translation)], ['articulationParameterCount', R.articulationParameterCount], ['articulationParameterTypeArray', Array.from(R.articulationParameterTypeArray).join(' ')], ['articulationParameterArray', Array.from(R.articulationParameterArray, (x) => x.toFixed(3)).join(' ')], ['articulationParameterValue0_changed', fmt(R.articulationParameterValue0_changed, 3)], ['articulationParameterValue1_changed', fmt(R.articulationParameterValue1_changed, 3)]]),
      card('EspduTransform', 'DEF BUOY, networkWriter', [['isNetworkWriter', B.isNetworkWriter], ['isActive', B.isActive], ['translation', vec(B.translation)], ['writeInterval', B.writeInterval], ['PDUs written', runtime.entityRecord(1, 1, 9)?.written ?? 0], ['marking', B.marking]]),
      card('DISEntityManager', `DEF MGR, ${N.MGR.address}:${N.MGR.port}`, [['addedEntities events', st.added], ['removedEntities events', st.removed], ['children of the ENTITIES group', N.ENTITIES.children.length], ['last added', events.added.length ? `${events.added.at(-1).marking} (entity ${events.added.at(-1).entityID})` : 'none yet'], ['last removed', events.removed.length ? `${events.removed.at(-1).marking} (entity ${events.removed.at(-1).entityID})` : 'none yet']]),
      card('DISEntityTypeMapping', '3 children of MGR', [['CUTTER 03 got', ship?.mapping ? `${ship.mapping.getNodeName()} ${ship.mapping.url[0]}` : 'not seen'], ['HAWK 04 got', helo?.mapping ? `${helo.mapping.getNodeName()} ${helo.mapping.url[0]}` : 'not present now'], ['MAP_SHIP', `kind ${N.MAP_SHIP.kind} domain ${N.MAP_SHIP.domain}`], ['MAP_HELICOPTER', `kind ${N.MAP_HELICOPTER.kind} domain ${N.MAP_HELICOPTER.domain} category ${N.MAP_HELICOPTER.category}`], ['MAP_ANY', 'all zero: matches anything']]),
      card('TransmitterPdu', 'DEF TX, networkReader, radio 1 of KITE 01', [['isActive', N.TX.isActive], ['transmitState', `${N.TX.transmitState} ${['off', 'on, not transmitting', 'on and transmitting'][N.TX.transmitState] ?? ''}`], ['frequency', `${N.TX.frequency} Hz`], ['power', `${fmt(N.TX.power, 1)} dBm`], ['transmitFrequencyBandwidth', `${N.TX.transmitFrequencyBandwidth} Hz`], ['antennaLocation', vec(N.TX.antennaLocation)], ['modulation', `major ${N.TX.modulationTypeMajor} detail ${N.TX.modulationTypeDetail} system ${N.TX.modulationTypeSystem}`]]),
      card('SignalPdu', 'DEF SIG, networkReader', [['isActive', N.SIG.isActive], ['encodingScheme', `${N.SIG.encodingScheme} (class ${N.SIG.encodingScheme >> 14}, type ${N.SIG.encodingScheme & 0x3fff})`], ['sampleRate', N.SIG.sampleRate], ['samples', N.SIG.samples], ['dataLength', `${N.SIG.dataLength} bits`], ['data', `${N.SIG.data.length} values: ${Array.from(N.SIG.data).slice(0, 8).join(' ')} ...`], ['PDUs', runtime.radioRecord('SignalPdu', 1)?.pdus ?? 0]]),
      card('ReceiverPdu', 'DEF RX, networkReader, radio 1 of ROVER 02', [['isActive', N.RX.isActive], ['receiverState', `${N.RX.receiverState} ${['off', 'on, not receiving', 'on and receiving'][N.RX.receiverState] ?? ''}`], ['receivedPower', `${fmt(N.RX.receivedPower, 1)} dBm`], ['transmitter', `${N.RX.transmitterSiteID}:${N.RX.transmitterApplicationID}:${N.RX.transmitterEntityID} radio ${N.RX.transmitterRadioID}`]]),
      card('Writer radio nodes', 'BUOY_TX, BUOY_SIG, BUOY_RX, networkWriter', [['BUOY_TX.transmitState', N.BUOY_TX.transmitState], ['BUOY_TX.antennaLocation', vec(N.BUOY_TX.antennaLocation)], ['BUOY_RX.receiverState', `${N.BUOY_RX.receiverState} (ROUTE from TX.transmitState)`], ['Transmitter PDUs written', st.sentByType[25]], ['Signal PDUs written', st.sentByType[26]], ['Receiver PDUs written', st.sentByType[27]]]),
    ].join('');
    // inspector
    const offset = state.inspectDir === 'sent' ? 100 : 0;
    let es = state.inspectEntity ? state.lastEspduByEntity.get(state.inspectEntity) : runtime.lastPdu[1];
    $('who1').textContent = es ? `· ${es.pdu.marking.text} · ${es.direction}` : '';
    const show = (type, rec) => { $(`hex${type}`).textContent = rec ? hexDump(rec.bytes) : 'none yet'; kv($(`f${type}`), rec ? describePdu(rec.pdu).map(([k, v]) => [esc(k), esc(v)]) : []); };
    show(1, es); for (const type of [25, 26, 27]) show(type, runtime.lastPdu[type + offset]);
    drawErrors(t); drawScope(t);
  }

  function drawErrors(t) {
    const c = $('errPlot'), g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const y = (err) => { const l = Math.log10(Math.max(0.01, Math.min(1000, err))); return H - 14 - (l + 2) / 5 * (H - 28); };
    g.font = '18px ui-monospace, monospace'; g.lineWidth = 1;
    for (const [v, label] of [[0.01, '1 cm'], [0.1, '10 cm'], [1, '1 m'], [10, '10 m'], [100, '100 m'], [1000, '1 km']]) { g.strokeStyle = v === 1 ? '#3b4a60' : '#1d2633'; g.beginPath(); g.moveTo(0, y(v)); g.lineTo(W, y(v)); g.stroke(); g.fillStyle = '#6f7c90'; g.fillText(label, 6, y(v) - 4); }
    for (const [id, h] of state.history) {
      g.strokeStyle = COLORS[id]; g.lineWidth = 2.5; g.beginPath();
      h.forEach(([tt, e], i) => { const x = W - (t - tt) / 30 * W; if (i) g.lineTo(x, y(e)); else g.moveTo(x, y(e)); });
      g.stroke();
    }
  }

  function drawScope(t) {
    const c = $('scope'), g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = '#1d2633'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    const fresh = t - state.lastSignalAt < 0.6;
    const all = state.scope.reduce((a, f) => a + f.length, 0);
    if (all) {
      g.strokeStyle = fresh ? '#ff6b6b' : '#45546b'; g.lineWidth = 2; g.beginPath();
      let i = 0;
      for (const f of state.scope) for (const s of f) { const x = i / all * W, yy = H / 2 - s * H * 1.1; if (i++) g.lineTo(x, yy); else g.moveTo(x, yy); }
      g.stroke();
    }
    g.fillStyle = '#6f7c90'; g.font = '18px ui-monospace, monospace';
    g.fillText(fresh ? `receiving: last ${all} samples of SIG.data` : (all ? 'silent: last samples received shown dimmed' : 'no Signal PDU yet (the tone comes every 16 s)'), 8, 22);
  }

  window.liveDis = { runtime, exercise, source, state, events, nodes: N, now, useGateway, useLocal, keyBuoy, found, RADIO };
  const gw = params.get('gateway');
  if (gw) { $('gw').value = gw; useGateway(gw); } else if (params.get('source') === 'none') setMode('none', 'source: none', 'warn'); else useLocal();
  $('boot').classList.add('ready');
  requestAnimationFrame(frame);
}

if (guardOk) X3D(() => start().catch((e) => { console.error(e); if (window.GfxGuard) window.GfxGuard.fail('the scene could not start: ' + e.message); }));
