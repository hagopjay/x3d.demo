#!/usr/bin/env python3
"""Cross-check the JavaScript DIS codec and dead reckoning against the open-dis Python package (opendis).

Three parts, each printed and returned in the JSON summary:

  A. opendis encodes PDUs with seeded random field values; the JavaScript codec decodes them; every field is compared.
  B. The JavaScript codec encodes the same field values; opendis decodes them; every field is compared, and the
     octets are compared with the octets opendis produced.
  C. opendis.DeadReckoning and opendis.RangeCoordinates are run on seeded random states and compared with
     ../src/dis-dr.js and ../src/dis-geo.js.

opendis is a test-time instrument only. Nothing from it is copied into this folder.

Run:  pip install opendis numpy   then   python3 tests/crosscheck_opendis.py [--out results.json]
Do not run it with the opendis package directory as the working directory: the package contains a types.py that
would shadow the standard library module of the same name.
"""
import io
import json
import math
import os
import random
import struct
import subprocess
import sys
from importlib import metadata

from opendis import dis7
from opendis.PduFactory import createPdu
from opendis.stream import DataOutputStream

HERE = os.path.dirname(os.path.abspath(__file__))
HELPER = os.path.join(HERE, "crosscheck-helper.js")
DR_HELPER = os.path.join(HERE, "dr-helper.js")


def f32(x):
    return struct.unpack(">f", struct.pack(">f", x))[0]


def ser(obj):
    s = io.BytesIO()
    obj.serialize(DataOutputStream(s))
    return s.getvalue()


def node(script, mode, payload):
    r = subprocess.run(["node", script, mode], input=json.dumps(payload), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


# ---- field naming shared with crosscheck-helper.js -------------------------------------------------------------

def flat_header(p, out):
    out["header.protocolVersion"] = p.protocolVersion
    out["header.exerciseID"] = p.exerciseID
    out["header.pduType"] = p.pduType
    out["header.protocolFamily"] = p.protocolFamily
    out["header.timestamp"] = p.timestamp
    out["header.length"] = p.length
    out["header.pduStatus"] = p.pduStatus if p.protocolVersion >= 7 else 0


def flat_id(prefix, e, out):
    out[prefix + ".site"] = e.simulationAddress.site
    out[prefix + ".application"] = e.simulationAddress.application
    out[prefix + ".entity"] = e.entityNumber


def flat_type(prefix, t, out):
    out[prefix + ".kind"] = t.entityKind
    out[prefix + ".domain"] = t.domain
    out[prefix + ".country"] = t.country
    out[prefix + ".category"] = t.category
    out[prefix + ".subcategory"] = t.subcategory
    out[prefix + ".specific"] = t.specific
    out[prefix + ".extra"] = t.extra


def v3(v):
    return [v.x, v.y, v.z]


def flat_espdu(p):
    out = {}
    flat_header(p, out)
    flat_id("entityID", p.entityID, out)
    out["forceID"] = p.forceId
    flat_type("entityType", p.entityType, out)
    flat_type("alternativeEntityType", p.alternativeEntityType, out)
    out["linearVelocity"] = v3(p.entityLinearVelocity)
    out["location"] = v3(p.entityLocation)
    out["orientation.psi"] = p.entityOrientation.psi
    out["orientation.theta"] = p.entityOrientation.theta
    out["orientation.phi"] = p.entityOrientation.phi
    out["appearance"] = p.entityAppearance
    d = p.deadReckoningParameters
    out["deadReckoning.algorithm"] = d.deadReckoningAlgorithm
    out["deadReckoning.otherParameters"] = list(d.parameters)
    out["deadReckoning.linearAcceleration"] = v3(d.entityLinearAcceleration)
    out["deadReckoning.angularVelocity"] = v3(d.entityAngularVelocity)
    out["marking.characterSet"] = p.marking.characterSet
    out["marking.text"] = p.marking.charactersString()
    out["capabilities"] = p.capabilities
    out["variableParameters.count"] = len(p.variableParameters)
    for i, vp in enumerate(p.variableParameters):
        # opendis 1.1.0 parses each 16-octet record into a generic VariableParameter (type, float64, uint32, uint16,
        # uint8). Its own ArticulatedParts class has the articulated-part layout, so the record is re-read with it.
        a = dis7.ArticulatedParts()
        a.parse(dis7.DataInputStream(io.BytesIO(ser(vp))))
        k = "variableParameters.%d." % i
        out[k + "recordType"] = a.recordType
        out[k + "changeIndicator"] = a.changeIndicator
        out[k + "partAttachedTo"] = a.partAttachedTo
        out[k + "parameterType"] = a.parameterType
        # opendis reads the 64-bit value field as one signed integer; the standard puts a float32 in its first four
        # octets and zero in the rest, so the float is unpacked here from the integer opendis returned.
        raw = struct.pack(">q", a.parameterValue)
        out[k + "parameterValue"] = struct.unpack(">f", raw[:4])[0]
        out[k + "valuePadding"] = struct.unpack(">I", raw[4:])[0]
    return out


def flat_transmitter(p):
    out = {}
    flat_header(p, out)
    flat_id("entityID", p.radioReferenceID, out)
    out["radioID"] = p.radioNumber
    t = p.radioEntityType
    out["radioEntityType.kind"] = t.entityKind
    out["radioEntityType.domain"] = t.domain
    out["radioEntityType.country"] = t.country
    out["radioEntityType.category"] = t.category
    out["radioEntityType.nomenclatureVersion"] = t.subcategory
    out["radioEntityType.nomenclature"] = t.specific * 256 + t.extra
    out["transmitState"] = p.transmitState
    out["inputSource"] = p.inputSource
    out["variableTransmitterParameterCount"] = len(p.variableTransmitterParameters)
    out["antennaLocation"] = v3(p.antennaLocation)
    out["relativeAntennaLocation"] = v3(p.relativeAntennaLocation)
    out["antennaPatternType"] = p.antennaPatternType
    out["antennaPatternLength"] = p.antennaPatternLength
    out["frequencyBig"] = str(p.frequency)
    out["transmitFrequencyBandwidth"] = p.transmitFrequencyBandwidth
    out["power"] = p.power
    m = p.modulationType
    out["modulationType.spreadSpectrum"] = struct.unpack(">H", ser(m.spreadSpectrum))[0]
    out["modulationType.major"] = m.majorModulation
    out["modulationType.detail"] = m.detail
    out["modulationType.system"] = m.radioSystem
    out["cryptoSystem"] = p.cryptoSystem
    out["cryptoKeyID"] = p.cryptoKeyId
    out["modulationParametersLength"] = p.modulationParametersLength
    out["modulationParameters"] = list(ser(p.modulationParameters)) if p.modulationParameters else []
    out["antennaPattern"] = list(ser(p.antennaPattern)) if p.antennaPattern else []
    out["variableTransmitterParameters"] = []
    return out


def flat_signal(p):
    out = {}
    flat_header(p, out)
    flat_id("entityID", p.entityID, out)
    out["radioID"] = p.radioID
    out["encodingScheme"] = p.encodingScheme
    out["tdlType"] = p.tdlType
    out["sampleRate"] = p.sampleRate
    out["dataLength"] = len(p.data) * 8
    out["samples"] = p.samples
    out["data"] = list(p.data)
    return out


def flat_receiver(p, own_id):
    out = {}
    flat_header(p, out)
    out.update(own_id)  # opendis 1.1.0 has no fields for the receiver's own entity ID and radio ID
    out["receiverState"] = p.receiverState
    out["receivedPower"] = p.receivedPower
    flat_id("transmitterEntityID", p.transmitterEntityID, out)
    out["transmitterRadioID"] = p.transmitterRadioId
    return out


# ---- seeded random PDUs built with opendis ---------------------------------------------------------------------------

def rnd_id(r):
    return dis7.EntityIdentifier(dis7.SimulationAddress(r.randrange(65536), r.randrange(65536)), r.randrange(65536))


def rnd_type(r):
    return dis7.EntityType(r.randrange(256), r.randrange(256), r.randrange(65536), r.randrange(256), r.randrange(256), r.randrange(256), r.randrange(256))


def rnd_v3f(r, scale):
    return dis7.Vector3Float(f32(r.uniform(-scale, scale)), f32(r.uniform(-scale, scale)), f32(r.uniform(-scale, scale)))


def header(p, r, i):
    p.protocolVersion = 6 if i % 4 == 3 else 7
    p.exerciseID = r.randrange(256)
    p.timestamp = r.randrange(2 ** 32)
    p.pduStatus = r.randrange(256) if p.protocolVersion == 7 else 0


def make_espdu(r, i):
    p = dis7.EntityStatePdu()
    header(p, r, i)
    p.entityID = rnd_id(r)
    p.forceId = r.randrange(256)
    p.entityType = rnd_type(r)
    p.alternativeEntityType = rnd_type(r)
    p.entityLinearVelocity = rnd_v3f(r, 400)
    p.entityLocation = dis7.WorldCoordinates(r.uniform(-7e6, 7e6), r.uniform(-7e6, 7e6), r.uniform(-7e6, 7e6))
    p.entityOrientation = dis7.EulerAngles(f32(r.uniform(-math.pi, math.pi)), f32(r.uniform(-1.5, 1.5)), f32(r.uniform(-math.pi, math.pi)))
    p.entityAppearance = r.randrange(2 ** 32)
    p.deadReckoningParameters = dis7.DeadReckoningParameters(i % 10, [r.randrange(256) for _ in range(15)], rnd_v3f(r, 30), rnd_v3f(r, 3))
    p.marking.characterSet = 1
    p.marking.setString("".join(r.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -") for _ in range(r.randrange(0, 12))).strip())
    p.capabilities = r.randrange(2 ** 32)
    for _ in range(i % 5):
        value = f32(r.uniform(-10, 10))
        as_int = struct.unpack(">q", struct.pack(">f", value) + b"\0\0\0\0")[0]
        p.variableParameters.append(dis7.ArticulatedParts(r.randrange(256), r.randrange(65536), r.randrange(2 ** 32), as_int))
    p.length = 144 + 16 * len(p.variableParameters)
    return p, flat_espdu_built(p)


def flat_espdu_built(p):
    # The PDU was built with ArticulatedParts objects; flat_espdu expects what opendis's parser returns, so round-trip it.
    return flat_espdu(createPdu(ser(p)))


def make_transmitter(r, i):
    p = dis7.TransmitterPdu()
    header(p, r, i)
    p.radioReferenceID = rnd_id(r)
    p.radioNumber = r.randrange(65536)
    p.radioEntityType = rnd_type(r)
    p.transmitState = r.randrange(3)
    p.inputSource = r.randrange(9)
    p.antennaLocation = dis7.WorldCoordinates(r.uniform(-7e6, 7e6), r.uniform(-7e6, 7e6), r.uniform(-7e6, 7e6))
    p.relativeAntennaLocation = rnd_v3f(r, 20)
    p.frequency = r.randrange(2 ** 40)
    p.transmitFrequencyBandwidth = f32(r.uniform(0, 1e6))
    p.power = f32(r.uniform(-30, 60))
    p.modulationType.majorModulation = r.randrange(8)
    p.modulationType.detail = r.randrange(16)
    p.modulationType.radioSystem = r.choice([0, 5, 7, 8])  # systems whose parameters opendis keeps as plain octets
    p.cryptoSystem = r.randrange(65536)
    p.cryptoKeyId = r.randrange(65536)
    if i % 3 == 1:
        p.modulationParameters = dis7.UnknownRadio(bytes(r.randrange(256) for _ in range(8)))
    if i % 3 == 2:
        # A beam antenna pattern (type 1, 40 octets). opendis 1.1.0 cannot round-trip an antenna pattern of unknown type:
        # its UnknownAntennaPattern writes N octets and reads back N - 6.
        p.antennaPatternType = 1
        p.antennaPattern = dis7.BeamAntennaPattern(dis7.EulerAngles(f32(r.uniform(-3, 3)), f32(r.uniform(-1, 1)), f32(r.uniform(-3, 3))),
                                                   f32(r.uniform(0, 1)), f32(r.uniform(0, 1)), r.randrange(3), f32(r.uniform(0, 1)), f32(r.uniform(0, 1)), f32(r.uniform(-3, 3)))
    p.length = 104 + p.modulationParametersLength + p.antennaPatternLength
    return p, flat_transmitter(createPdu(ser(p)))


def make_signal(r, i):
    p = dis7.SignalPdu()
    header(p, r, i)
    p.entityID = rnd_id(r)
    p.radioID = r.randrange(65536)
    p.encodingScheme = r.randrange(65536)
    p.tdlType = r.randrange(65536)
    p.sampleRate = r.randrange(2 ** 32)
    n = 4 * r.randrange(0, 60)  # a multiple of four octets, so that no padding is involved
    p.data = [r.randrange(256) for _ in range(n)]
    p.samples = r.randrange(65536)
    p.length = 32 + n
    return p, flat_signal(p)


def make_receiver(r, i):
    p = dis7.ReceiverPdu()
    header(p, r, i)
    p.receiverState = r.randrange(3)
    p.receivedPower = f32(r.uniform(-120, 10))
    p.transmitterEntityID = rnd_id(r)
    p.transmitterRadioId = r.randrange(65536)
    p.length = 36
    own = {"entityID.site": r.randrange(65536), "entityID.application": r.randrange(65536), "entityID.entity": r.randrange(65536), "radioID": r.randrange(65536)}
    return p, flat_receiver(p, own)


def receiver_splice_in(octets, own):
    """opendis 1.1.0 writes a Receiver PDU without the receiver's own entity ID and radio ID (28 octets where the
    standard has 36). Insert those eight octets after the header so that the layout is the standard one."""
    return octets[:12] + struct.pack(">HHHH", own["entityID.site"], own["entityID.application"], own["entityID.entity"], own["radioID"]) + octets[12:]


def receiver_splice_out(octets):
    return octets[:12] + octets[20:]


def same(a, b):
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, float) or isinstance(b, float):
        return float(a) == float(b)
    return a == b


def compare(expected, got, label, failures):
    n = 0
    for k in sorted(set(expected) | set(got)):
        if k.endswith(".valuePadding"):
            # only opendis reports this; it must be zero
            n += 1
            if expected.get(k, got.get(k)) != 0:
                failures.append("%s %s: padding not zero" % (label, k))
            continue
        n += 1
        if k not in expected or k not in got or not same(expected[k], got[k]):
            failures.append("%s %s: expected %r got %r" % (label, k, expected.get(k), got.get(k)))
    return n


def codec_crosscheck(seed=1278, per_type=40):
    r = random.Random(seed)
    makers = [("EntityState", make_espdu), ("Transmitter", make_transmitter), ("Signal", make_signal), ("Receiver", make_receiver)]
    summary = {}
    for name, make in makers:
        built = [make(r, i) for i in range(per_type)]
        octets = []
        for p, fields in built:
            b = ser(p)
            if name == "Receiver":
                b = receiver_splice_in(b, fields)
            octets.append(b)
        failures = []
        # A: opendis encodes, JavaScript decodes
        dec = node(HELPER, "decode", {"cases": [{"hex": b.hex()} for b in octets]})["cases"]
        fields_a = 0
        for i, ((p, fields), d) in enumerate(zip(built, dec)):
            if "error" in d:
                failures.append("A %s case %d: %s" % (name, i, d["error"]))
                continue
            exp = {k: v for k, v in fields.items() if not k.endswith(".valuePadding")}
            fields_a += compare(exp, d["fields"], "A %s case %d" % (name, i), failures)
        # B: JavaScript encodes, opendis decodes
        enc = node(HELPER, "encode", {"cases": [{"fields": {k: v for k, v in f.items() if not k.endswith(".valuePadding")}} for _, f in built]})["cases"]
        fields_b = 0
        identical = 0
        for i, ((p, fields), e, b0) in enumerate(zip(built, enc, octets)):
            if "error" in e:
                failures.append("B %s case %d: %s" % (name, i, e["error"]))
                continue
            b = bytes.fromhex(e["hex"])
            identical += int(b == b0)
            if name == "Receiver":
                q = createPdu(receiver_splice_out(b))
                got = flat_receiver(q, {k: fields[k] for k in ("entityID.site", "entityID.application", "entityID.entity", "radioID")})
            else:
                q = createPdu(b)
                got = {"EntityState": flat_espdu, "Transmitter": flat_transmitter, "Signal": flat_signal}[name](q)
            fields_b += compare(fields, got, "B %s case %d" % (name, i), failures)
        summary[name] = {"pdus": per_type, "fields_opendis_to_js": fields_a, "fields_js_to_opendis": fields_b,
                         "octet_identical": identical, "mismatches": len(failures), "first_mismatches": failures[:5]}
    # Signal data that is not a multiple of four octets: the standard pads to a 32-bit boundary, opendis does not.
    r2 = random.Random(seed + 1)
    odd_fail = []
    odd_n = 0
    for n in (1, 2, 3, 5, 161):
        p = dis7.SignalPdu()
        p.entityID = rnd_id(r2); p.radioID = 3; p.encodingScheme = 1; p.sampleRate = 8000; p.samples = n
        p.data = [r2.randrange(256) for _ in range(n)]
        p.length = 32 + n
        d = node(HELPER, "decode", {"cases": [{"hex": ser(p).hex()}]})["cases"][0]
        e = node(HELPER, "encode", {"cases": [{"fields": flat_signal(p)}]})["cases"][0]
        js = bytes.fromhex(e["hex"])
        q = createPdu(js)
        ok = d.get("fields", {}).get("data") == list(p.data) and list(q.data) == list(p.data) and len(js) == 32 + 4 * math.ceil(n / 4)
        odd_n += 1
        if not ok:
            odd_fail.append(n)
    summary["SignalUnpadded"] = {"pdus": odd_n, "mismatches": len(odd_fail), "note": "data lengths 1, 2, 3, 5 and 161 octets; the JavaScript encoder pads to 32 bits, opendis 1.1.0 does not, and each side reads the other's octets"}
    # Receiver PDU size, measured rather than assumed
    summary["Receiver"]["opendis_serialised_octets"] = len(ser(dis7.ReceiverPdu()))
    summary["Receiver"]["note"] = ("opendis 1.1.0 serialises a Receiver PDU as 28 octets: it has no field for the receiver's own entity ID and radio ID. "
                                   "Eight octets were spliced in or out for this comparison, so those four values are not checked here; "
                                   "crosscheck-open-dis-js.test.js checks them against the open-dis JavaScript package.")
    return summary


# ---- dead reckoning and geodesy ------------------------------------------------------------------------------------

def dr_crosscheck(seed=1278, n=200):
    import numpy as np
    from opendis import DeadReckoning as DR
    r = random.Random(seed)
    cases = []
    for i in range(n):
        alg = 1 + i % 9
        pure_yaw = (i // 9) % 2 == 0
        o = [r.uniform(-3, 3), 0.0 if pure_yaw else r.uniform(-1.2, 1.2), 0.0 if pure_yaw else r.uniform(-3, 3)]
        w = [0.0, 0.0, r.uniform(-0.5, 0.5)] if pure_yaw else [r.uniform(-0.5, 0.5) for _ in range(3)]
        cases.append({"algorithm": alg, "location": [r.uniform(-7e6, 7e6) for _ in range(3)], "linearVelocity": [r.uniform(-300, 300) for _ in range(3)],
                      "linearAcceleration": [r.uniform(-20, 20) for _ in range(3)], "angularVelocity": w,
                      "orientation": {"psi": o[0], "theta": o[1], "phi": o[2]}, "dt": r.choice([0.01, 0.1, 1.0, 5.0]), "pureYaw": pure_yaw})
    js = node(DR_HELPER, "deadreckon", {"cases": cases})["cases"]
    names = [None, "Static", "FPW", "RPW", "RVW", "FVW", "FPB", "RPB", "RVB", "FVB"]
    rows = {}
    for c, j in zip(cases, js):
        P, V, A, W, dt = c["location"], c["linearVelocity"], c["linearAcceleration"], c["angularVelocity"], c["dt"]
        O = [c["orientation"]["psi"], c["orientation"]["theta"], c["orientation"]["phi"]]
        a = c["algorithm"]
        if a == 1: pos, ori = DR.drm_static(P, O)
        elif a == 2: pos, ori = DR.drm_fpw(P, V, dt, O)
        elif a == 3: pos, ori = DR.drm_rpw(P, V, dt, O, W)
        elif a == 4: pos, ori = DR.drm_rvw(P, V, A, dt, O, W)
        elif a == 5: pos, ori = DR.drm_fvw(P, V, A, dt, O)
        elif a == 6: pos, ori = DR.drm_fpb(P, V, dt, O)
        elif a == 7: pos, ori = DR.drm_rpb(P, V, dt, O, W)
        elif a == 8: pos, ori = DR.drm_rvb(P, V, A, dt, O, W)
        else: pos, ori = DR.drm_fvb(P, V, A, dt, O)
        dpos = float(np.linalg.norm(np.array(pos) - np.array(j["location"])))
        Ra = DR.get_rotation_matrix(*ori)  # body to world
        Rb = DR.get_rotation_matrix(j["orientation"]["psi"], j["orientation"]["theta"], j["orientation"]["phi"])
        dang = 2 * math.asin(min(1.0, float(np.linalg.norm(Ra - Rb)) / (2 * math.sqrt(2))))
        key = names[a]
        row = rows.setdefault(key, {"cases": 0, "max_position_diff_m_all": 0.0, "max_angle_diff_rad_all": 0.0,
                                    "position_cases_same_model": 0, "max_position_diff_m_same_model": None,
                                    "orientation_cases_same_model": 0, "max_angle_diff_rad_same_model": None})
        row["cases"] += 1
        row["max_position_diff_m_all"] = max(row["max_position_diff_m_all"], dpos)
        row["max_angle_diff_rad_all"] = max(row["max_angle_diff_rad_all"], dang)
        # opendis integrates Euler rates to first order and, for the body algorithms, moves along the initial
        # heading. That equals the standard's closed form only when the orientation is not extrapolated, or, for
        # orientation, when the rotation is pure yaw from level. Position for RPB and RVB differs whenever the
        # entity turns; position for FPB and FVB differs when the angular velocity is not zero (see dis-dr.js).
        orientation_agrees = a in (1, 2, 5, 6, 9) or c["pureYaw"]
        position_agrees = a in (1, 2, 3, 4, 5)
        if orientation_agrees:
            row["orientation_cases_same_model"] += 1
            row["max_angle_diff_rad_same_model"] = max(row["max_angle_diff_rad_same_model"] or 0.0, dang)
        if position_agrees:
            row["position_cases_same_model"] += 1
            row["max_position_diff_m_same_model"] = max(row["max_position_diff_m_same_model"] or 0.0, dpos)
    # body algorithms with zero angular velocity: both models are a straight line along the initial body axes
    cases0 = []
    for i in range(80):
        alg = 6 + i % 4
        cases0.append({"algorithm": alg, "location": [r.uniform(-7e6, 7e6) for _ in range(3)], "linearVelocity": [r.uniform(-300, 300) for _ in range(3)],
                       "linearAcceleration": [r.uniform(-20, 20) for _ in range(3)], "angularVelocity": [0.0, 0.0, 0.0],
                       "orientation": {"psi": r.uniform(-3, 3), "theta": r.uniform(-1.2, 1.2), "phi": r.uniform(-3, 3)}, "dt": r.choice([0.1, 1.0, 5.0])})
    js0 = node(DR_HELPER, "deadreckon", {"cases": cases0})["cases"]
    body0 = {}
    for c, j in zip(cases0, js0):
        P, V, A, dt = c["location"], c["linearVelocity"], c["linearAcceleration"], c["dt"]
        O = [c["orientation"]["psi"], c["orientation"]["theta"], c["orientation"]["phi"]]
        a = c["algorithm"]
        if a == 6: pos, _ = DR.drm_fpb(P, V, dt, O)
        elif a == 7: pos, _ = DR.drm_rpb(P, V, dt, O, [0, 0, 0])
        elif a == 8: pos, _ = DR.drm_rvb(P, V, A, dt, O, [0, 0, 0])
        else: pos, _ = DR.drm_fvb(P, V, A, dt, O)
        d = float(np.linalg.norm(np.array(pos) - np.array(j["location"])))
        row = body0.setdefault(names[a], {"cases": 0, "max_position_diff_m": 0.0})
        row["cases"] += 1
        row["max_position_diff_m"] = max(row["max_position_diff_m"], d)
    return {"random_states": rows, "body_algorithms_zero_angular_velocity": body0}


def geo_crosscheck(seed=1278, n=200):
    from opendis.RangeCoordinates import GPS
    gps = GPS()
    r = random.Random(seed)
    cases = [{"lat": r.uniform(-89, 89), "lon": r.uniform(-180, 180), "h": r.uniform(-100, 20000),
              "heading": r.uniform(-3.1, 3.1), "pitch": r.uniform(-1.4, 1.4), "roll": r.uniform(-3.1, 3.1)} for _ in range(n)]
    js = node(DR_HELPER, "geo", {"cases": cases})["cases"]
    max_ecef = max_back = max_att = 0.0
    for c, j in zip(cases, js):
        e = gps.lla2ecef((c["lat"], c["lon"], c["h"]))
        max_ecef = max(max_ecef, math.dist(e, j["ecef"]))
        lla = gps.ecef2lla(j["ecef"])
        max_back = max(max_back, abs(lla[0] - j["geodetic"][0]) * 111e3, abs(lla[1] - j["geodetic"][1]) * 111e3 * math.cos(math.radians(c["lat"])), abs(lla[2] - j["geodetic"][2]))
        # attitude: the JavaScript side turned heading, pitch, roll into DIS Euler angles; opendis turns them back
        out = gps.ecef2llarpy(j["ecef"][0], j["ecef"][1], j["ecef"][2], j["euler"]["psi"], j["euler"]["theta"], j["euler"]["phi"])
        roll, pitch, yaw = out[3], out[4], out[5]
        for got, want in ((yaw, c["heading"]), (pitch, c["pitch"]), (roll, c["roll"])):
            d = abs((got - want + math.pi) % (2 * math.pi) - math.pi)
            max_att = max(max_att, d)
    return {"cases": n, "max_geodetic_to_ecef_diff_m": max_ecef, "max_ecef_to_geodetic_diff_m": max_back, "max_attitude_diff_rad": max_att}


def main():
    out = {
        "instrument": {"opendis": metadata.version("opendis"), "numpy": metadata.version("numpy"), "python": sys.version.split()[0],
                       "node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()},
        "codec": codec_crosscheck(),
        "dead_reckoning": dr_crosscheck(),
        "geodesy": geo_crosscheck(),
    }
    print(json.dumps(out, indent=1))
    if "--out" in sys.argv:
        with open(sys.argv[sys.argv.index("--out") + 1], "w") as f:
            json.dump(out, f, indent=1)
    bad = sum(v.get("mismatches", 0) for v in out["codec"].values())
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
