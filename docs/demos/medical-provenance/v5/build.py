#!/usr/bin/env python3
"""medical-provenance v5: open BodyParts3D meshes compared with the CT surfaces (numpy + stdlib).
Reads ../v3/structures.json (FMA per CT shape), the CT torso scene of ../../brain-torso-xite/v1, and the BodyParts3D
99%-reduced PART-OF OBJ zip (pinned by sha256; downloaded on demand, never committed).
Writes scene/bp3d-overlay.x3dz, scene/compare.x3dz, data/fit.json, data/metrics.json, claims.json, validation-v5.json.
  python3 -I build.py --gate <x3d_mcp>/src [--zip PATH]      (needs numpy)"""
import sys, json, re, gzip, hashlib, pathlib, zipfile, urllib.request, collections, time, io
import numpy as np
from xml.sax.saxutils import quoteattr
HERE = pathlib.Path(__file__).resolve().parent
ZIP_URL = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_BP3D_4.0_obj_99.zip"
ELEM_URL = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_element_parts.txt"
ZIP_SHA = "9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97"
TARGET_FACES = 1800
sha = lambda b: hashlib.sha256(b).hexdigest()
arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
cache = HERE / "data" / "cache"; cache.mkdir(parents=True, exist_ok=True)
zp = pathlib.Path(arg("--zip") or cache / "partof99.zip")
if not zp.exists():
    print("downloading", ZIP_URL); zp.write_bytes(urllib.request.urlopen(urllib.request.Request(ZIP_URL, headers={"User-Agent": "x3d-demo-medical-provenance/1.0"}), timeout=280).read())
zbytes = zp.read_bytes(); assert sha(zbytes) == ZIP_SHA, "zip sha256 differs from the pinned file: " + sha(zbytes)
ep = cache / "partof_element_parts.txt"
if not ep.exists(): ep.write_bytes(urllib.request.urlopen(urllib.request.Request(ELEM_URL, headers={"User-Agent": "x3d-demo-medical-provenance/1.0"}), timeout=60).read())
EL = collections.defaultdict(list)
for l in ep.read_text().splitlines()[1:]:
    c = l.split("\t"); EL[c[0]].append(c[2])
Z = zipfile.ZipFile(io.BytesIO(zbytes)); names = {pathlib.Path(n).stem: n for n in Z.namelist() if n.endswith(".obj")}
S = {r["uid"]: r for r in json.loads((HERE.parent / "v3" / "structures.json").read_text())}
TORSO = HERE.parent.parent / "brain-torso-xite" / "v1" / "scenes" / "torso_ct_lite.x3dz"
txt = gzip.open(TORSO).read().decode("utf8")
def ct(uid):
    i = txt.index(f"<Shape DEF='STRUCT_{uid}'>"); j = txt.index("</Shape>", i)
    return np.array(re.search(r"<Coordinate point='([^']*)'", txt[i:j]).group(1).split(), float).reshape(-1, 3)
def obj(fj):
    v = []; f = []
    for l in Z.read(names[fj]).decode().splitlines():
        if l.startswith("v "): v.append([float(x) for x in l.split()[1:4]])
        elif l.startswith("f "):
            ix = [int(x.split("/")[0]) - 1 for x in l.split()[1:]]
            for k in range(1, len(ix) - 1): f.append([ix[0], ix[k], ix[k + 1]])
    return np.array(v), np.array(f, int)

# ---- gather BP3D union meshes for the CT shapes that have an FMA class with elements
rows = []
for uid, r in S.items():
    if r["scene"] != "torso" or not r.get("fma_id"): continue
    els = [e for e in EL.get(r["fma_id"].replace(":", ""), []) if e in names]
    if not els: continue
    vs = []; fs = []; off = 0
    for e in els:
        v, f = obj(e); vs.append(v); fs.append(f + off); off += len(v)
    rows.append(dict(uid=uid, fma=r["fma_id"], label=r["fma_label"], group=r["group"], elements=els, V=np.vstack(vs), F=np.vstack(fs), C=ct(uid)))
print("structures with a BodyParts3D mesh:", len(rows), "elements:", sum(len(r["elements"]) for r in rows), "source faces:", sum(len(r["F"]) for r in rows))

# ---- axes: BP3D is +X patient-left, +Y posterior, +Z up (mm); CT scene is +X patient-right, +Y up, +Z posterior
R0 = np.array([[-1, 0, 0], [0, 0, 1], [0, 1, 0]], float)
def umey(X, Y):
    mx, my = X.mean(0), Y.mean(0); Xc, Yc = X - mx, Y - my
    U, D, Vt = np.linalg.svd(Yc.T @ Xc / len(X)); d = np.sign(np.linalg.det(U @ Vt)); Sg = np.diag([1, 1, d])
    R = U @ Sg @ Vt; s = np.trace(np.diag(D) @ Sg) / Xc.var(0).sum(); return s, R, my - s * R @ mx
for r in rows: r["a"] = (r["V"] @ R0.T).mean(0); r["b"] = r["C"].mean(0)
FITGROUPS = ("RIBCAGE", "SPINE", "ORGANS", "LUNGS", "HEART", "VESSELS", "VISCERA")
trunk = [i for i, r in enumerate(rows) if r["group"] in FITGROUPS]
A = np.array([r["a"] for r in rows]); B = np.array([r["b"] for r in rows]); idx = list(trunk); log = []
for it in range(6):
    s, R, t = umey(A[idx], B[idx]); res = np.linalg.norm((s * (R @ A.T).T + t) - B, axis=1)
    log.append(dict(iter=it, used=len(idx), scale=round(float(s), 4), median_mm=round(float(np.median(res[idx])), 1)))
    idx = [i for i in trunk if res[i] <= np.percentile(res[trunk], 80)]
s, R, t = umey(A[idx], B[idx]); fitset = set(rows[i]["uid"] for i in idx)
rot_deg = float(np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))))
print("fit: scale", round(float(s), 4), "rotation deg", round(rot_deg, 1), "structures in final fit", len(idx))
def tf(V): return s * ((V @ R0.T) @ R.T) + t
def chamfer(P, Q, n=2500):
    rng = np.random.default_rng(7)
    P = P[rng.choice(len(P), min(n, len(P)), replace=False)]; Q = Q[rng.choice(len(Q), min(n, len(Q)), replace=False)]
    d = np.sqrt(((P[:, None, :] - Q[None, :, :]) ** 2).sum(2)); return float(d.min(1).mean()), float(d.min(0).mean())
def decimate(V, F, target):
    h = float((V.max(0) - V.min(0)).max()) / 200.0; best = (V, F)
    for _ in range(25):
        key = np.floor((V - V.min(0)) / h).astype(np.int64); uk, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1)
        nv = np.zeros((len(uk), 3)); np.add.at(nv, inv, V); nv /= np.bincount(inv, minlength=len(uk))[:, None]
        nf = inv[F]; ok = (nf[:, 0] != nf[:, 1]) & (nf[:, 1] != nf[:, 2]) & (nf[:, 0] != nf[:, 2]); nf = nf[ok]
        nf = np.unique(np.sort(nf, axis=1), axis=0) if len(nf) else nf
        best = (nv, nf)
        if len(nf) <= target: break
        h *= 1.25
    return best

# ---- per-structure metrics and shipped meshes
metrics = []; shapes = []; groups_color = {"RIBCAGE": "0.35 0.75 0.95", "SPINE": "0.35 0.75 0.95", "LIMBGIRDLE": "0.35 0.75 0.95", "SKULL": "0.35 0.75 0.95", "HEART": "1 0.55 0.45", "VESSELS": "1 0.45 0.45", "LUNGS": "0.75 0.85 1", "ORGANS": "0.95 0.8 0.35", "VISCERA": "0.95 0.8 0.35"}
def ms(name, v): return f"<MetadataString name={quoteattr(name)} value={quoteattr(chr(34) + str(v).replace(chr(34), chr(39)) + chr(34))}/>"
shipped_faces = 0
for r in rows:
    W = tf(r["V"]); c1, c2 = chamfer(W, r["C"])
    ext_bp = W.max(0) - W.min(0); ext_ct = r["C"].max(0) - r["C"].min(0)
    cen_off = float(np.linalg.norm(W.mean(0) - r["C"].mean(0)))
    nv, nf = decimate(W, r["F"], TARGET_FACES); shipped_faces += len(nf)
    infit = r["uid"] in fitset
    ch = (c1 + c2) / 2
    grade = "C"   # numbers are measured in this build; whether the CT surface and the BP3D surface are the same anatomy is judged by the residual
    m = dict(uid=r["uid"], fma=r["fma"], label=r["label"], group=r["group"], elements=len(r["elements"]), src_faces=int(len(r["F"])), shipped_faces=int(len(nf)), in_fit=infit,
             centroid_offset_mm=round(cen_off, 1), chamfer_bp_to_ct_mm=round(c1, 1), chamfer_ct_to_bp_mm=round(c2, 1), chamfer_mean_mm=round(ch, 1),
             extent_ratio=[round(float(a / b), 2) if b > 1 else None for a, b in zip(ext_bp, ext_ct)], agree="close" if ch < 15 else ("partial" if ch < 40 else "far"))
    metrics.append(m)
    pts = " ".join(f"{x:.1f}" for x in nv.ravel()); idxs = " ".join(map(str, nf.ravel()))
    col = groups_color.get(r["group"], "0.7 0.9 0.7")
    shapes.append(f"<Shape DEF='BP_{r['uid']}'><MetadataSet name='bp3d' containerField='metadata' reference={quoteattr('http://purl.org/sig/ont/fma/fma' + r['fma'].split(':')[1])}>{ms('fma', r['fma'])}{ms('bp3d_elements', ' '.join(r['elements'][:12]) + (' ...' if len(r['elements']) > 12 else ''))}{ms('chamfer_mean_mm', round(ch, 1))}{ms('agree', m['agree'])}{ms('licence', 'BodyParts3D, DBCLS, file headers: CC BY-SA 2.1 Japan; lic.html 2025/02/27: CC BY 4.0 (conflict, see NOTICE-BP3D.md); decimated and transformed by us')}</MetadataSet>"
                  f"<Appearance><Material DEF='M_{r['uid']}' diffuseColor='{col}' emissiveColor='0 0 0' transparency='0.45'/></Appearance><IndexedTriangleSet solid='false' index='{idxs}'><Coordinate point='{pts}'/></IndexedTriangleSet></Shape>")
print("shipped faces:", shipped_faces)

overlay = f"""<?xml version='1.0' encoding='UTF-8'?>
<X3D profile='Interchange' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
<head><meta name='title' content='BodyParts3D overlay in the CT frame (medical-provenance v5)'/><meta name='rights' content='BodyParts3D (c) The Database Center for Life Science. File headers state CC BY-SA 2.1 Japan; the current licence page states CC BY 4.0. Meshes here are decimated and transformed. See NOTICE-BP3D.md'/><meta name='source-zip-sha256' content='{ZIP_SHA}'/><meta name='fit' content='similarity fit scale {s:.4f}, rotation {rot_deg:.1f} deg, on {len(idx)} trunk structures; see data/fit.json'/></head>
<Scene><Group DEF='BP_ALL'>{''.join(shapes)}</Group>{''.join(f"<EXPORT localDEF='M_{m['uid']}' AS='M_{m['uid']}'/>" for m in metrics)}</Scene></X3D>
"""
(HERE / "scene").mkdir(exist_ok=True)
(HERE / "scene" / "bp3d-overlay.x3d").write_text(overlay, encoding="utf8")
with gzip.GzipFile(HERE / "scene" / "bp3d-overlay.x3dz", "wb", mtime=0) as g: g.write(overlay.encode("utf8"))
compare = """<?xml version='1.0' encoding='UTF-8'?>
<X3D profile='Full' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
<head><meta name='title' content='CT torso and BodyParts3D overlay (medical-provenance v5)'/></head>
<Scene><NavigationInfo type='"EXAMINE" "ANY"' headlight='true'/><Background skyColor='0.02 0.04 0.07'/><Viewpoint DEF='VP_FRONT' description='Front' position='0 0 -1500' orientation='0 1 0 3.14159' fieldOfView='0.7'/>
<Inline DEF='IN_CT' url='"../../v3/scene/torso-fma.x3dz"' load='true'/>
<Inline DEF='IN_BP' url='"bp3d-overlay.x3dz"' load='true'/>
""" + "".join(f"<IMPORT inlineDEF='IN_BP' importedDEF='M_{m['uid']}' AS='M_{m['uid']}'/>" for m in metrics) + "</Scene></X3D>\n"
(HERE / "scene" / "compare.x3d").write_text(compare)
with gzip.GzipFile(HERE / "scene" / "compare.x3dz", "wb", mtime=0) as g: g.write(compare.encode("utf8"))

# ---- outputs
fit = dict(axes="CT = (-x, z, y) of BP3D, found by comparing left/right kidney and sternum/vertebra sides", scale=round(float(s), 4), rotation_deg=round(rot_deg, 1), translation_mm=[round(float(x), 1) for x in t],
           R=[[round(float(x), 5) for x in row] for row in R], fit_structures=len(idx), candidates=len(trunk), robust_log=log, zip_sha256=ZIP_SHA, zip_bytes=len(zbytes), elements_in_zip=len(names),
           groups_fitted=list(FITGROUPS), note="similarity (scale, rotation, translation) on vertex-mean centroids, 6 rounds dropping the worst 20 percent; limbs, skin and head are not fitted")
(HERE / "data" / "fit.json").write_text(json.dumps(fit, indent=1)); (HERE / "data" / "metrics.json").write_text(json.dumps(metrics, indent=1))
claims = []
for m in metrics:
    claims.append(dict(id=f"{m['uid']}.bp3d-fit", struct=m["uid"], kind="bp3d-fit", grade="C" if m["in_fit"] or m["agree"] != "far" else "S",
        statement=f"BodyParts3D '{m['label']}' ({m['fma']}, {m['elements']} elements) vs the CT surface after the similarity fit: mean surface distance {m['chamfer_mean_mm']} mm (bp to ct {m['chamfer_bp_to_ct_mm']}, ct to bp {m['chamfer_ct_to_bp_mm']}), centroid offset {m['centroid_offset_mm']} mm, agreement '{m['agree']}'. " + ("Used in the fit." if m["in_fit"] else "Not used in the fit."),
        instrument="build.py numpy: Umeyama similarity fit, 2500-point mean nearest-vertex distance, seed 7", source="BodyParts3D partof_BP3D_4.0_obj_99.zip sha256 " + ZIP_SHA[:16]))
(HERE / "claims.json").write_text(json.dumps(claims, indent=1))
cnt = collections.Counter(m["agree"] for m in metrics); gc = collections.Counter(c["grade"] for c in claims)
summary = dict(structures=len(metrics), elements=sum(m["elements"] for m in metrics), src_faces=sum(m["src_faces"] for m in metrics), shipped_faces=shipped_faces, in_fit=len(idx), agree=dict(cnt), claim_grades=dict(gc),
               scale=fit["scale"], rotation_deg=fit["rotation_deg"], overlay_bytes_x3dz=(HERE / "scene" / "bp3d-overlay.x3dz").stat().st_size, overlay_sha256=sha(overlay.encode()))
(HERE / "data" / "summary.json").write_text(json.dumps(summary, indent=1)); print(json.dumps(summary, indent=1))
if arg("--gate"):
    sys.path.insert(0, arg("--gate")); from validation.validate import validate_xml
    rc = {}
    for nm, x in (("bp3d-overlay", overlay), ("compare", compare)):
        t0 = time.time(); r = validate_xml(x); rc[nm] = dict(sha256=sha(x.encode()), valid=r.get("valid"), errors=r.get("errors"), warnings=r.get("warnings"), seconds=round(time.time() - t0, 2))
        print(nm, "valid", rc[nm]["valid"], len(rc[nm]["errors"] or []), "errors", str(rc[nm]["errors"])[:600])
    rc["validator"] = "x3d_mcp validate_xml"; (HERE / "validation-v5.json").write_text(json.dumps(rc, indent=1))
