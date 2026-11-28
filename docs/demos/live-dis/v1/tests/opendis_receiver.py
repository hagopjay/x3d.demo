#!/usr/bin/env python3
"""Listen for DIS PDUs on UDP and decode them with the open-dis Python package (opendis), for the end-to-end test
of the writer nodes. Prints one JSON object with every PDU heard.
Usage: python3 tests/opendis_receiver.py [address] [port] [seconds]
Do not run it from inside the opendis package directory (its types.py shadows the standard library)."""
import json, socket, struct, sys, time
from importlib import metadata
from opendis.PduFactory import createPdu

address = sys.argv[1] if len(sys.argv) > 1 else "239.1.2.3"
port = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
seconds = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("", port))
first = int(address.split(".")[0])
if 224 <= first <= 239:
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, struct.pack("4sl", socket.inet_aton(address), socket.INADDR_ANY))
sock.settimeout(0.2)

def ident(e):
    return [e.simulationAddress.site, e.simulationAddress.application, e.entityNumber]

out = []
end = time.time() + seconds
print("READY", flush=True)
while time.time() < end:
    try:
        data, _ = sock.recvfrom(4096)
    except socket.timeout:
        continue
    kind = data[2]
    rec = {"type": kind, "octets": len(data), "hex": data.hex()}
    if kind == 27:
        # opendis 1.1.0 has no fields for the receiver's own entity ID and radio ID (octets 12 to 19 of the standard
        # layout), so those are read here directly and the rest is given to opendis without them.
        own = struct.unpack(">HHHH", data[12:20])
        p = createPdu(data[:12] + data[20:])
        rec.update(entity=list(own[:3]), radioID=own[3], receiverState=p.receiverState, receivedPower=p.receivedPower, transmitter=ident(p.transmitterEntityID), transmitterRadioID=p.transmitterRadioId)
    else:
        p = createPdu(data)
        if kind == 1:
            rec.update(entity=ident(p.entityID), marking=p.marking.charactersString(), location=[p.entityLocation.x, p.entityLocation.y, p.entityLocation.z],
                       velocity=[p.entityLinearVelocity.x, p.entityLinearVelocity.y, p.entityLinearVelocity.z], orientation=[p.entityOrientation.psi, p.entityOrientation.theta, p.entityOrientation.phi],
                       algorithm=p.deadReckoningParameters.deadReckoningAlgorithm, kind=p.entityType.entityKind, domain=p.entityType.domain, category=p.entityType.category, forceID=p.forceId)
        elif kind == 25:
            rec.update(entity=ident(p.radioReferenceID), radioID=p.radioNumber, transmitState=p.transmitState, frequency=p.frequency, power=p.power, bandwidth=p.transmitFrequencyBandwidth,
                       antennaLocation=[p.antennaLocation.x, p.antennaLocation.y, p.antennaLocation.z], inputSource=p.inputSource, major=p.modulationType.majorModulation, radioKind=p.radioEntityType.entityKind)
        elif kind == 26:
            rec.update(entity=ident(p.entityID), radioID=p.radioID, encodingScheme=p.encodingScheme, sampleRate=p.sampleRate, samples=p.samples, data=list(p.data))
    rec["timestamp"] = p.timestamp
    rec["version"] = p.protocolVersion
    out.append(rec)
print(json.dumps({"instrument": "opendis %s, python %s" % (metadata.version("opendis"), sys.version.split()[0]), "pdus": out}))
