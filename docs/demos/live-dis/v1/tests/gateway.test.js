// gateway.test.js: UDP to WebSocket and back through ../gateway/gateway.js, on this machine only.
// Needs the "ws" package where Node can find it (npm install in ../gateway, or NODE_PATH).
// Run:  node --test tests/gateway.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createRequire } from 'node:module';
import { startGateway } from '../gateway/gateway.js';
import { ScriptedExercise } from '../src/dis-exercise.js';
import { decodePdu } from '../src/dis-codec.js';
import { record } from './results.js';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const wsVersion = require('ws/package.json').version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ex = new ScriptedExercise();
const results = { instrument: `node ${process.version}, ws ${wsVersion}, UDP over the loopback and default interfaces of one machine`, channels: {} };

async function roundTrip(kind, address, port) {
  const gw = startGateway({ wsPort: 0, log: () => {} });
  const wsPort = await gw.listening;
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/?address=${address}&port=${port}`);
  ws.binaryType = 'nodebuffer';
  const got = [];
  ws.on('message', (data, isBinary) => { if (isBinary) got.push(Buffer.from(data)); });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); ws.once('close', (c, r) => reject(new Error(`closed ${c} ${r}`))); });
  await sleep(150);
  // UDP in: four real PDUs from a plain UDP socket
  const pdus = [ex.entityStatePdu(1, 1.8e9, 4), ex.transmitterPdu(1.8e9 + 2.5), ex.signalPdu(Math.floor((1.8e9 + 2.5) * 50)) ?? ex.signalPdu(Math.floor((1.8e9 - (1.8e9 % 16) + 2.5) * 50)), ex.receiverPdu(1.8e9 + 2.5)];
  const out = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise((r) => out.bind(0, r));
  out.setBroadcast(true);
  for (const p of pdus) { out.send(p, port, address); await sleep(20); }
  await sleep(300);
  // UDP out: a listener on the same channel hears what the browser side sends
  let heard = [];
  let listenerOk = true;
  const listener = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  listener.on('message', (m, rinfo) => { if (rinfo.port !== out.address().port) heard.push(Buffer.from(m)); });
  try {
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.bind(port, () => { try { if (kind === 'multicast') listener.addMembership(address); resolve(); } catch (e) { reject(e); } }); });
  } catch { listenerOk = false; }
  for (const p of pdus) { ws.send(p, { binary: true }); await sleep(20); }
  await sleep(300);
  const r = {
    address, port, udp_to_websocket: { sent: pdus.length, received: got.length, octet_identical: got.filter((g, i) => pdus[i] && g.equals(Buffer.from(pdus[i]))).length },
    websocket_to_udp: { sent: pdus.length, received: heard.length, octet_identical: heard.filter((g, i) => pdus[i] && g.equals(Buffer.from(pdus[i]))).length, second_listener_bound: listenerOk },
    echoes_dropped: gw.stats.dropped, types_seen: got.map((g) => decodePdu(g).header.pduType),
  };
  ws.close(); out.close(); try { listener.close(); } catch { /* not bound */ }
  await gw.close();
  results.channels[kind] = r;
  console.log(`${kind} ${address}:${port}  UDP to WebSocket ${r.udp_to_websocket.octet_identical}/${pdus.length} identical, WebSocket to UDP ${r.websocket_to_udp.octet_identical}/${pdus.length} identical, echoes dropped ${r.echoes_dropped}`);
  return r;
}

test('multicast group 239.1.2.4, port 3100', async () => {
  const r = await roundTrip('multicast', '239.1.2.4', 3100);
  assert.equal(r.udp_to_websocket.octet_identical, 4); assert.deepEqual(r.types_seen, [1, 25, 26, 27]);
  assert.equal(r.websocket_to_udp.octet_identical, 4);
});

test('broadcast 127.255.255.255, port 3101', async () => {
  const r = await roundTrip('broadcast', '127.255.255.255', 3101);
  assert.equal(r.udp_to_websocket.octet_identical, 4);
  assert.equal(r.websocket_to_udp.octet_identical, 4);
});

test('unicast 127.0.0.1, port 3102: UDP to WebSocket', async () => {
  // On Linux a second socket bound to the same port with SO_REUSEADDR takes over unicast delivery, which is how the
  // outbound direction can be heard here on one machine. Only the inbound direction is asserted.
  const r = await roundTrip('unicast', '127.0.0.1', 3102);
  assert.equal(r.udp_to_websocket.octet_identical, 4);
  record('gateway', results);
});
