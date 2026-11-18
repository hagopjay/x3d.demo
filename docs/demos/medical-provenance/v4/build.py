#!/usr/bin/env python3
"""medical-provenance v4: a jointed H-Anim skeleton built from the CT torso bones (stdlib only).
Reads ../v3/structures.json and the torso scene of ../../brain-torso-xite/v1 (no copy of those).
Writes hanim-skeleton.x3dz, joints.json, joint-claims.json, validation-v4.json.
  python3 -I build.py --gate <x3d_mcp>/src"""
import json, gzip, re, sys, math, hashlib, pathlib, time, collections
from xml.sax.saxutils import quoteattr
HERE = pathlib.Path(__file__).resolve().parent
TORSO = HERE.parent.parent / "brain-torso-xite" / "v1" / "scenes" / "torso_ct_lite.x3dz"
S3 = {r["uid"]: r for r in json.loads((HERE.parent / "v3" / "structures.json").read_text())}
sha = lambda b: hashlib.sha256(b).hexdigest()
txt = gzip.open(TORSO).read().decode("utf8")

def shape(uid):
    i = txt.index(f"<Shape DEF='STRUCT_{uid}'>"); j = txt.index("</Shape>", i)
    g = txt[i:j]
    k = g.index("<IndexedTriangleSet"); geo = g[k:]
    pts = [float(x) for x in re.search(r"<Coordinate point='([^']*)'", geo).group(1).split()]
    return geo + "</IndexedTriangleSet>" if "</IndexedTriangleSet>" not in geo else geo, [pts[i:i + 3] for i in range(0, len(pts), 3)]
P = {}; GEO = {}
def load(uid):
    if uid not in GEO: GEO[uid], P[uid] = shape(uid)
    return P[uid]
mean = lambda v: [sum(c) / len(v) for c in zip(*v)]
cen = lambda uid: mean(load(uid))
def top(uid, frac=0.15, axis=1):
    v = load(uid); m = max(p[axis] for p in v); lo = min(p[axis] for p in v)
    return mean([p for p in v if p[axis] >= m - frac * (m - lo)])
def extreme_x(uid, towards_mid):
    v = load(uid); key = (lambda p: abs(p[0]))
    return min(v, key=key) if towards_mid else max(v, key=key)

# ---- absolute joint positions (scene mm), each with a method string (all grade S: estimated from the mesh, not landmarked)
ABS = {}; HOW = {}
def setj(n, pos, how): ABS[n] = [round(x, 1) for x in pos]; HOW[n] = how
for side, sc in (("l", "left"), ("r", "right")):
    setj(f"{side}_hip", top(f"femur_{sc}"), "mean of the top 15 percent (by height) of the femur vertices: stands in for the femoral head centre")
    setj(f"{side}_shoulder", top(f"humerus_{sc}"), "mean of the top 15 percent of the humerus vertices: stands in for the humeral head centre")
    setj(f"{side}_sternoclavicular", extreme_x(f"clavicula_{sc}", True), "clavicle vertex nearest the midline")
    setj(f"{side}_acromioclavicular", extreme_x(f"clavicula_{sc}", False), "clavicle vertex farthest from the midline")
setj("sacroiliac", cen("sacrum"), "sacrum vertex mean")
setj("humanoid_root", [(ABS["l_hip"][i] + ABS["r_hip"][i]) / 2 for i in range(3)], "midpoint of the two hip joints")
names = [("c", i) for i in range(1, 8)] + [("t", i) for i in range(1, 13)] + [("l", i) for i in range(1, 6)]
below = {"vl5": "sacrum"}
order = ["l5", "l4", "l3", "l2", "l1", "t12", "t11", "t10", "t9", "t8", "t7", "t6", "t5", "t4", "t3", "t2", "t1", "c7", "c6", "c5", "c4", "c3", "c2", "c1"]
def vuid(s): return "vertebrae_" + s[0].upper() + s[1:]
for k, s in enumerate(order):
    here = cen(vuid(s)); prev = cen("sacrum") if k == 0 else cen(vuid(order[k - 1]))
    setj("v" + s, [(here[i] + prev[i]) / 2 for i in range(3)], "midpoint of this vertebra centroid and the one below it (sacrum for L5): the joint sits at the base of its segment")
c1 = load("vertebrae_C1"); setj("skullbase", [mean(c1)[0], max(p[1] for p in c1), mean(c1)[2]], "top of the C1 mesh")

# ---- hierarchy from the X3D XSD-derived table in x3d.loom hanim-all.json is not available here: encode the chain explicitly
PARENT = {"sacroiliac": "humanoid_root", "l_hip": "sacroiliac", "r_hip": "sacroiliac", "vl5": "humanoid_root", "skullbase": "vc1"}
chain = ["vl5", "vl4", "vl3", "vl2", "vl1", "vt12", "vt11", "vt10", "vt9", "vt8", "vt7", "vt6", "vt5", "vt4", "vt3", "vt2", "vt1", "vc7", "vc6", "vc5", "vc4", "vc3", "vc2", "vc1"]
for a, b in zip(chain, chain[1:]): PARENT[b] = a
for side in "lr":
    PARENT[f"{side}_sternoclavicular"] = "vt1"; PARENT[f"{side}_acromioclavicular"] = f"{side}_sternoclavicular"; PARENT[f"{side}_shoulder"] = f"{side}_acromioclavicular"
# segment -> (joint it hangs on, structure uid)
SEG = {"sacrum": ("sacroiliac", "sacrum"), "pelvis_l": None}
SEGS = [("sacrum", "sacroiliac", "sacrum"), ("l_thigh", "l_hip", "femur_left"), ("r_thigh", "r_hip", "femur_right"),
        ("l_upperarm", "l_shoulder", "humerus_left"), ("r_upperarm", "r_shoulder", "humerus_right"),
        ("l_clavicle", "l_sternoclavicular", "clavicula_left"), ("r_clavicle", "r_sternoclavicular", "clavicula_right"),
        ("l_scapula", "l_acromioclavicular", "scapula_left"), ("r_scapula", "r_acromioclavicular", "scapula_right"),
        ("skull", "skullbase", "skull")] + [(s, "v" + s, vuid(s)[0:0] + "vertebrae_" + s[0].upper() + s[1:]) for s in order]
# pelvis segment: both hip bones on humanoid_root (H-Anim has one pelvis segment)
PELVIS = ["hip_left", "hip_right"]
SEGNAMES = {s[0] for s in SEGS} | {"pelvis"}
# ---- check names against the XSD lists
def xsd_names(src, typ):
    t = (pathlib.Path(src) / "validation" / "schemas" / "x3d-4.1.xsd").read_text()
    i = t.index(f'name="{typ}"'); j = t.index("</xs:simpleType>", i)
    return set(re.findall(r'xs:enumeration value="([^"]+)"', t[i:j]))
GATE = sys.argv[sys.argv.index("--gate") + 1] if "--gate" in sys.argv else None
jn = sorted(ABS)
if GATE:
    JX = xsd_names(GATE, "hanimJointNameValues"); SX = xsd_names(GATE, "hanimSegmentNameValues")
    badj = [j for j in jn if j not in JX]; bads = [s for s in SEGNAMES if s not in SX]
    print("joint names in XSD:", len(jn) - len(badj), "of", len(jn), badj, "| segment names in XSD:", len(SEGNAMES) - len(bads), "of", len(SEGNAMES), bads)
    (HERE / "data").mkdir(exist_ok=True)
    (HERE / "data" / "xsd-name-check.json").write_text(json.dumps(dict(joints=len(jn), joints_in_xsd=len(jn) - len(badj), segments=len(SEGNAMES), segments_in_xsd=len(SEGNAMES) - len(bads), joint_enum_size=len(JX), segment_enum_size=len(SX)), indent=1))

# ---- emit
M = 0.001
def rel(n):
    p = PARENT.get(n); a = ABS[n]
    return [round((a[i] - (ABS[p][i] if p else 0)) * M, 5) for i in range(3)]
children = collections.defaultdict(list)
for n in jn: children[PARENT.get(n)].append(n)
def ms(name, v): return f"<MetadataString name={quoteattr(name)} value={quoteattr(chr(34) + str(v).replace(chr(34), chr(39)) + chr(34))}/>"
def seg_xml(sname, juid, uids):
    a = ABS[juid]; out = []
    rec0 = S3[uids[0]]
    meta = f"<MetadataSet name='provenance' containerField='metadata' reference={quoteattr(rec0.get('fma_iri') or '')}>" + ms("fma", rec0.get("fma_id", "")) + ms("fma_label", rec0.get("fma_label", "")) + ms("structure", rec0["id"]) + ms("claims_digest", rec0.get("claims_digest", "")) + ms("grade", rec0.get("denotes_grade", "S")) + "</MetadataSet>"
    for u in uids:
        load(u)
        out.append(f"<Transform translation='{-a[0]*M:.5f} {-a[1]*M:.5f} {-a[2]*M:.5f}' scale='{M} {M} {M}'><Shape><Appearance><Material diffuseColor='0.93 0.9 0.8' specularColor='0.25 0.25 0.25' shininess='0.3'/></Appearance>{GEO[u]}</Shape></Transform>")
    return f"<HAnimSegment DEF='SEG_{sname}' name='{sname}'>{meta}{''.join(out)}</HAnimSegment>"
def joint_xml(n):
    segs = [seg_xml(s, j, [u]) for s, j, u in SEGS if j == n]
    if n == "humanoid_root": segs.append(seg_xml("pelvis", "humanoid_root", PELVIS))
    kids = [joint_xml(c) for c in children[n]]
    meta = f"<MetadataSet name='joint' containerField='metadata'>" + ms("grade", "S") + ms("how", HOW[n]) + ms("abs_mm", " ".join(map(str, ABS[n]))) + "</MetadataSet>"
    tr = rel(n)
    cont = " containerField='skeleton'" if n == "humanoid_root" else ""
    return f"<HAnimJoint DEF='J_{n}' name='{n}'{cont} translation='{tr[0]} {tr[1]} {tr[2]}'>{meta}{''.join(kids)}{''.join(segs)}</HAnimJoint>"
root_abs = ABS["humanoid_root"]
joints_xml = joint_xml("humanoid_root")
# humanoid_root translation is absolute (parent None): rel() used 0 origin
uses = "".join(f"<HAnimJoint USE='J_{n}' containerField='joints'/>" for n in jn) + "".join(f"<HAnimSegment USE='SEG_{s}' containerField='segments'/>" for s in sorted(SEGNAMES))
# non-H-Anim bones (ribs, sternum, costal cartilage): shown, flagged as having no segment
extra = []
for u in S3:
    r = S3[u]
    if r["scene"] == "torso" and (u.startswith("rib_") or u in ("sternum", "costal_cartilages")):
        load(u); extra.append(f"<Shape DEF='NOSEG_{u}'><Appearance><Material diffuseColor='0.55 0.7 0.9' transparency='0.45'/></Appearance>{GEO[u]}</Shape>")
meta_nohanim = "<MetadataSet name='hanim-gap' containerField='metadata'>" + ms("note", "ribs, sternum and costal cartilage have no H-Anim segment name (checked against the X3D 4.1 XSD enumeration)") + ms("grade", "C") + "</MetadataSet>"
x3d = f"""<?xml version='1.0' encoding='UTF-8'?>
<X3D profile='Full' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
<head><component name='HAnim' level='2'/><meta name='title' content='Jointed H-Anim skeleton from CT torso bones (medical-provenance v4)'/><meta name='description' content='{len(jn)} HAnimJoints and {len(SEGNAMES)} HAnimSegments built from the torso CT bone meshes. Joint centres are estimated from the meshes (grade S). Educational PoC, not medical advice.'/><meta name='generator' content='x3d.demo medical-provenance v4 build.py'/><meta name='source-scene-sha256' content='{sha(txt.encode())}'/></head>
<Scene>
<NavigationInfo type='"EXAMINE" "ANY"' headlight='true'/>
<Background skyColor='0.02 0.04 0.07'/>
<Viewpoint DEF='VP_FRONT' description='Front' position='0 {root_abs[1]*M + 0.28:.3f} -2.4' orientation='0 1 0 3.14159' fieldOfView='0.6'/>
<Transform DEF='FLIP' rotation='0 1 0 3.14159'>
<HAnimHumanoid DEF='HUM' name='ct_torso_skeleton' version='2.0' skeletalConfiguration='BASIC' loa='-1' translation='0 0 0'>
<MetadataSet name='about' containerField='metadata'>{ms('note','Scene axes: +X patient-right, +Y up, +Z posterior; the Transform FLIP turns the body to face +Z as H-Anim requires')}{ms('grade','C')}</MetadataSet>
{joints_xml}
{uses}
</HAnimHumanoid>
<Transform scale='{M} {M} {M}'>{meta_nohanim}{''.join(extra)}</Transform>
</Transform>
</Scene></X3D>
"""
(HERE / "hanim-skeleton.x3d").write_text(x3d, encoding="utf8")
with gzip.GzipFile(HERE / "hanim-skeleton.x3dz", "wb", mtime=0) as g: g.write(x3d.encode("utf8"))

# ---- forward-kinematics check: walk the emitted translations and compare with the intended absolute positions
def fk(n, base):
    r = [float(v) for v in re.search(rf"<HAnimJoint DEF='J_{n}' name='{n}'(?: containerField='skeleton')? translation='([^']*)'", x3d).group(1).split()]
    return [base[i] + r[i] for i in range(3)]
err = 0.0; stack = [("humanoid_root", [0, 0, 0])]
while stack:
    n, base = stack.pop(); a = fk(n, base)
    err = max(err, max(abs(a[i] - ABS[n][i] * M) for i in range(3)))
    for c in children[n]: stack.append((c, a))
print("forward-kinematics max error (m):", f"{err:.6f}", "joints:", len(jn))
joints = [dict(name=n, parent=PARENT.get(n), abs_mm=ABS[n], rel_m=rel(n), how=HOW[n], grade="S") for n in jn]
(HERE / "joints.json").write_text(json.dumps(joints, indent=1))
segs = [dict(segment=s, joint=j, structure=u, fma=S3[u].get("fma_id"), hanim_claim=f"{u}.hanim", grade="C" if True else "") for s, j, u in SEGS] + [dict(segment="pelvis", joint="humanoid_root", structure=",".join(PELVIS), fma="FMA:16587,FMA:16586", grade="L")]
(HERE / "segments.json").write_text(json.dumps(segs, indent=1))
summary = dict(joints=len(jn), segments=len(SEGNAMES), extra_non_hanim_shapes=len(extra), fk_max_error_m=round(err, 9), scene_sha256=sha(x3d.encode()), bytes_x3d=len(x3d.encode()), bytes_x3dz=(HERE / "hanim-skeleton.x3dz").stat().st_size)
(HERE / "data").mkdir(exist_ok=True); (HERE / "data" / "summary.json").write_text(json.dumps(summary, indent=1)); print(json.dumps(summary, indent=1))
if GATE:
    sys.path.insert(0, GATE); from validation.validate import validate_xml
    t0 = time.time(); r = validate_xml(x3d)
    rc = dict(sha256=sha(x3d.encode()), valid=r.get("valid"), errors=r.get("errors"), warnings=r.get("warnings"), seconds=round(time.time() - t0, 2), validator="x3d_mcp validate_xml")
    (HERE / "validation-v4.json").write_text(json.dumps(rc, indent=1)); print("valid", rc["valid"], "errors", len(rc["errors"] or []), str(rc["errors"])[:1500])
