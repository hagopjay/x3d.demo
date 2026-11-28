#!/usr/bin/env node
// send-exercise.js: sends the scripted exercise of ../src/dis-exercise.js as DIS PDUs on UDP, for the gateway
// (or any DIS listener) to pick up. Every PDU is generated; nothing is replayed from a recording.
//
//   node send-exercise.js [--address 239.1.2.3] [--port 3000] [--algorithm 0..9] [--rate 0|Hz] [--seconds N] [--version 6|7]
//
// algorithm 0 keeps each entity's scripted algorithm; rate 0 sends by the 1 m / 3 degree threshold with a 5 s heartbeat.
import dgram from 'node:dgram';
import { ExerciseSource } from '../src/dis-exercise.js';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; }

export function startSender(options = {}) {
  const address = options.address ?? '239.1.2.3', port = Number(options.port ?? 3000);
  const source = new ExerciseSource({ algorithm: Number(options.algorithm ?? 0), rate: Number(options.rate ?? 0), version: Number(options.version ?? 7) });
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const now = () => (performance.timeOrigin + performance.now()) / 1000;
  let sent = 0, timer = null;
  const ready = new Promise((resolve) => socket.bind(0, () => {
    try { socket.setBroadcast(true); socket.setMulticastLoopback(true); socket.setMulticastTTL(1); } catch { /* not fatal */ }
    timer = setInterval(() => { for (const pdu of source.step(now())) { socket.send(pdu, port, address); sent++; } }, 10);
    resolve();
  }));
  return { ready, source, get sent() { return sent; }, stop: () => { clearInterval(timer); socket.close(); } };
}

if (process.argv[1] && process.argv[1].endsWith('send-exercise.js')) {
  const s = startSender({ address: arg('address'), port: arg('port'), algorithm: arg('algorithm'), rate: arg('rate'), version: arg('version') });
  const seconds = Number(arg('seconds', 0));
  console.log(`[sender] scripted exercise to ${arg('address', '239.1.2.3')}:${arg('port', 3000)}`);
  setInterval(() => console.log(`[sender] ${s.sent} PDUs sent ${JSON.stringify(s.source.counts)}`), 5000).unref?.();
  if (seconds > 0) setTimeout(() => { s.stop(); process.exit(0); }, seconds * 1000);
}
