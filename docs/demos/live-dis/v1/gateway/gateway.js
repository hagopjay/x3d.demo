#!/usr/bin/env node
// gateway.js: relays raw DIS PDUs between UDP and browsers. A browser cannot open a UDP socket; this can.
//
//   node gateway.js [--ws-port 8765] [--ws-host 127.0.0.1] [--interface 0.0.0.0]
//
// A browser opens one WebSocket per DIS channel and names the channel in the URL, with the values of the
// address and port fields of the X3D DIS nodes:
//   ws://127.0.0.1:8765/?address=239.1.2.3&port=3000
// Every binary WebSocket message is exactly one PDU, octet for octet as it travels on UDP, in both directions.
// Nothing is added, removed or interpreted, apart from reading octet 2 (the PDU type) for the counters.
//
// The address decides the kind of UDP traffic:
//   multicast (224.0.0.0 to 239.255.255.255)  the gateway joins the group on the port and sends to the group
//   broadcast (ends in .255)                   the gateway listens on the port and sends broadcasts
//   anything else (unicast, "localhost")       the gateway listens on the port and sends to that host
// The default DIS port is 3000. GET /stats on the same port returns the counters as JSON.
//
// Dependency: the "ws" package (npm install). The gateway listens on the loopback interface for WebSockets unless
// told otherwise, because it will send any datagram a connected page asks for.
import dgram from 'node:dgram';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; }

const isMulticast = (a) => { const first = Number(String(a).split('.')[0]); return first >= 224 && first <= 239; };
const isBroadcast = (a) => /\.255$/.test(String(a));
const normalise = (a) => (!a || a === 'localhost' ? '127.0.0.1' : a);

export function startGateway(options = {}) {
  const wsPort = Number(options.wsPort ?? 8765), wsHost = options.wsHost ?? '127.0.0.1', iface = options.interface ?? '0.0.0.0';
  const log = options.log ?? ((m) => console.log(`[gateway] ${m}`));
  const channels = new Map(); // "address:port" -> { address, port, socket, clients, ready }
  const stats = { udpIn: 0, udpOut: 0, wsIn: 0, wsOut: 0, dropped: 0, byType: {}, clients: 0, channels: [] };
  const sender = dgram.createSocket({ type: 'udp4', reuseAddr: true }); // all outgoing datagrams leave from this socket
  let senderPort = 0;
  const senderReady = new Promise((resolve) => sender.bind(0, iface === '0.0.0.0' ? undefined : iface, () => {
    senderPort = sender.address().port;
    try { sender.setBroadcast(true); sender.setMulticastLoopback(true); sender.setMulticastTTL(1); } catch { /* not fatal */ }
    resolve();
  }));

  function openChannel(address, port) {
    const key = `${address}:${port}`;
    if (channels.has(key)) return channels.get(key);
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const ch = { address, port, socket, clients: new Set(), kind: isMulticast(address) ? 'multicast' : isBroadcast(address) ? 'broadcast' : 'unicast' };
    ch.ready = new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, () => {
        try { if (ch.kind === 'multicast') socket.addMembership(address, iface === '0.0.0.0' ? undefined : iface); if (ch.kind === 'broadcast') socket.setBroadcast(true); }
        catch (e) { return reject(e); }
        log(`listening on UDP ${port} for ${ch.kind} ${address}`);
        resolve();
      });
    });
    socket.on('message', (msg, rinfo) => {
      // A datagram that this gateway sent comes back on multicast and broadcast channels; it is not relayed again.
      if (rinfo.port === senderPort) { stats.dropped++; return; }
      stats.udpIn++; if (msg.length > 2) stats.byType[msg[2]] = (stats.byType[msg[2]] ?? 0) + 1;
      for (const c of ch.clients) if (c.readyState === 1) { c.send(msg, { binary: true }); stats.wsOut++; }
    });
    channels.set(key, ch);
    return ch;
  }

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/stats')) {
      stats.channels = [...channels.values()].map((c) => ({ address: c.address, port: c.port, kind: c.kind, clients: c.clients.size }));
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify(stats));
    }
    res.writeHead(426, { 'content-type': 'text/plain' }); res.end('This is a WebSocket endpoint: ws://host:port/?address=239.1.2.3&port=3000\n');
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const address = normalise(url.searchParams.get('address')), port = Number(url.searchParams.get('port') ?? 3000);
    if (!(port > 0 && port < 65536) || !/^[\d.]+$/.test(address)) { ws.close(1008, 'address must be an IPv4 address and port a UDP port'); return; }
    let ch;
    try { ch = openChannel(address, port); await ch.ready; await senderReady; }
    catch (e) { log(`cannot open ${address}:${port}: ${e.message}`); channels.delete(`${address}:${port}`); ws.close(1011, `cannot open UDP channel: ${e.message}`.slice(0, 120)); return; }
    ch.clients.add(ws); stats.clients++;
    log(`browser joined ${address}:${port} (${ch.clients.size} on this channel)`);
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return; // only PDUs travel here
      stats.wsIn++;
      sender.send(data, port, address, (err) => { if (err) log(`send failed: ${err.message}`); else stats.udpOut++; });
      // other browsers on the same channel hear it as they would on the network
      for (const c of ch.clients) if (c !== ws && c.readyState === 1) { c.send(data, { binary: true }); stats.wsOut++; }
    });
    ws.on('close', () => { ch.clients.delete(ws); stats.clients--; });
  });
  const listening = new Promise((resolve) => server.listen(wsPort, wsHost, () => { log(`WebSocket on ws://${wsHost}:${server.address().port}/`); resolve(server.address().port); }));
  return {
    listening, stats,
    close: () => new Promise((resolve) => { for (const c of channels.values()) { try { c.socket.close(); } catch { /* closed */ } } try { sender.close(); } catch { /* closed */ } for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => resolve()); }),
  };
}

if (process.argv[1] && import.meta.url.endsWith('/gateway/gateway.js') && process.argv[1].endsWith('gateway.js')) {
  startGateway({ wsPort: arg('ws-port', 8765), wsHost: arg('ws-host', '127.0.0.1'), interface: arg('interface', '0.0.0.0') });
}
