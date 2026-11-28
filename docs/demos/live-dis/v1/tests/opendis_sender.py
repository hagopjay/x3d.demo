#!/usr/bin/env python3
"""Send Entity State PDUs built by the open-dis Python package (opendis) on UDP, for the end-to-end test.
One invented entity, 1:1:21 "PYTHON 21", flies a straight line at constant velocity (dead-reckoning algorithm 2).
Prints one JSON object describing exactly what was sent, so that the receiving side can be compared with it.
Usage: python3 tests/opendis_sender.py [address] [port] [seconds] [rate_hz]
Do not run it from inside the opendis package directory (its types.py shadows the standard library)."""
import io, json, socket, struct, sys, time
from importlib import metadata
from opendis import dis7
from opendis.stream import DataOutputStream

address = sys.argv[1] if len(sys.argv) > 1 else "239.1.2.3"
port = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
seconds = float(sys.argv[3]) if len(sys.argv) > 3 else 5.0
rate = float(sys.argv[4]) if len(sys.argv) > 4 else 5.0

# A point 800 m above the exercise origin (36.6 N, 122.5 W), as geocentric coordinates computed by opendis itself.
from opendis.RangeCoordinates import GPS
P0 = list(GPS().lla2ecef((36.6, -122.5, 800.0)))
V = [struct.unpack(">f", struct.pack(">f", x))[0] for x in (40.0, -25.0, 10.0)]  # m/s, geocentric axes, exact float32 values

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_LOOP, 1)

t0 = time.time()
sent = []
while True:
    t = time.time()
    if t - t0 > seconds:
        break
    p = dis7.EntityStatePdu()
    p.protocolVersion = 7
    p.exerciseID = 1
    p.timestamp = (int(round((t % 3600) / (3600 / 2 ** 31))) % 2 ** 31) * 2 + 1  # absolute timestamp
    p.entityID = dis7.EntityIdentifier(dis7.SimulationAddress(1, 1), 21)
    p.forceId = 2
    p.entityType = dis7.EntityType(1, 2, 0, 1, 0, 0, 0)
    p.entityLinearVelocity = dis7.Vector3Float(*V)
    loc = [P0[i] + V[i] * (t - t0) for i in range(3)]
    p.entityLocation = dis7.WorldCoordinates(*loc)
    p.entityOrientation = dis7.EulerAngles(0.5, 0.25, 0.125)
    p.deadReckoningParameters.deadReckoningAlgorithm = 2
    p.marking.characterSet = 1
    p.marking.setString("PYTHON 21")
    p.length = 144
    s = io.BytesIO()
    p.serialize(DataOutputStream(s))
    sock.sendto(s.getvalue(), (address, port))
    sent.append({"t": t, "location": loc, "timestamp": p.timestamp})
    time.sleep(1.0 / rate)

print(json.dumps({"instrument": "opendis %s, python %s" % (metadata.version("opendis"), sys.version.split()[0]), "address": address, "port": port,
                  "count": len(sent), "t0": t0, "p0": P0, "velocity": V, "marking": "PYTHON 21", "entity": [1, 1, 21], "type": [1, 2, 0, 1, 0, 0, 0],
                  "orientation": [0.5, 0.25, 0.125], "last": sent[-1]}))
