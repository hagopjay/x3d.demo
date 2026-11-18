#!/usr/bin/env python3
"""medical-provenance v7: the v6 CT series with the open NIH pancreas label as a real FMA-linked segment (numpy, pydicom, nibabel).
Reads the v6 shipped volumes (hash-checked against v6/data/summary.json), the DICOM series (v6 cache or the NBIA API) and the
TCIA pancreas label zip (cached under data/cache, never committed). Writes scene/ct-organ.x3d, scene/ct-organ-labels.nrrd,
claims.json, claims.jsonld, data/summary.json, validation-v7.json.
  python3 -I build.py --gate <x3d_mcp>/src      (needs numpy, pydicom, nibabel)"""
import sys, io, json, gzip, hashlib, pathlib, zipfile, urllib.request, collections, time, itertools
import numpy as np, pydicom, nibabel as nib, tempfile
from xml.sax.saxutils import quoteattr
HERE = pathlib.Path(__file__).resolve().parent; V6 = HERE.parent / "v6"
LAB_URL = "https://www.cancerimagingarchive.net/wp-content/uploads/TCIA_pancreas_labels-02-05-2017.zip"
LAB_MEMBER = "TCIA_pancreas_labels-02-05-2017/label0051.nii.gz"
NBIA = "https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?SeriesInstanceUID="
sha = lambda b: hashlib.sha256(b).hexdigest()
arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
UA = {"User-Agent": "x3d-demo-medical-provenance/1.0"}
cache = HERE / "data" / "cache"
s6 = json.loads((V6 / "data" / "summary.json").read_text()); SERIES = s6["series"]
def get(url, path, t=300):
    if not path.exists(): path.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t).read())
    return path.read_bytes()
# ---- base volumes from v6, hash-checked ----
base_i = (V6 / "scene" / "ct-intensity.nrrd").read_bytes(); base_l = (V6 / "scene" / "ct-labels.nrrd").read_bytes()
assert sha(base_i) == s6["intensity_sha256"] and sha(base_l) == s6["labels_sha256"], "v6 volumes differ from v6/data/summary.json"
def rd(b):
    i = b.index(b"\n\n"); sz = [int(x) for x in [l for l in b[:i].decode().split("\n") if l.startswith("sizes")][0].split()[1:]]
    return np.frombuffer(gzip.decompress(b[i + 2:]), np.uint8).reshape(sz[2], sz[1], sz[0])     # [a, s, l]
lab6 = rd(base_l); na, ns, nl = lab6.shape
# ---- DICOM HU at full resolution ----
zp = V6 / "data" / "cache" / "series.zip"
zb = zp.read_bytes() if zp.exists() else get(NBIA + SERIES, cache / "series.zip", 560)
Z = zipfile.ZipFile(io.BytesIO(zb)); dsl = []
for n in Z.namelist():
    try: d = pydicom.dcmread(io.BytesIO(Z.read(n)))
    except Exception: continue
    if hasattr(d, "PixelData"): dsl.append(d)
dsl.sort(key=lambda d: float(d.ImagePositionPatient[2]))
pix = hashlib.sha256()
for d in dsl: pix.update(d.PixelData)
assert pix.hexdigest() == s6["pixel_data_sha256"], "DICOM pixels differ from the pinned series"
HU = np.stack([d.pixel_array.astype(np.int16) * float(d.RescaleSlope) + float(d.RescaleIntercept) for d in dsl]).astype(np.float32)   # [k superior, row, col]
ps = [float(v) for v in dsl[0].PixelSpacing]; dz = float(np.median(np.diff([float(d.ImagePositionPatient[2]) for d in dsl])))
# ---- the label ----
lz = get(LAB_URL, cache / "labels.zip", 120); LZ = zipfile.ZipFile(io.BytesIO(lz)); nb = LZ.read(LAB_MEMBER)
tmp = pathlib.Path(tempfile.mkdtemp()) / "label.nii.gz"; tmp.write_bytes(nb); im = nib.load(str(tmp)); M = np.asarray(im.dataobj)
assert M.shape == (512, 512, len(dsl)) and set(np.unique(M)) <= {0, 1}
B = M.transpose(2, 1, 0)                                     # [k_label (inferior first index ... see test), row, col]
trial = {}
for fk, fr, fc in itertools.product([0, 1], repeat=3):       # try all 8 flips of the three axes; keep the HU statistics of each
    b = B[::-1] if fk else B; b = b[:, ::-1] if fr else b; b = b[:, :, ::-1] if fc else b
    v = HU[b > 0]; trial["".join(map(str, (fk, fr, fc)))] = dict(mean_hu=round(float(v.mean()), 1), std_hu=round(float(v.std()), 1), frac_soft=round(float(((v > -30) & (v < 250)).mean()), 3))
best = min(trial, key=lambda k: trial[k]["std_hu"]); assert best == "100", trial      # flip along the slice axis only
Bf = B[::-1]
vox_ml_full = ps[0] * ps[1] * dz / 1000; n_full = int((Bf > 0).sum()); hv = HU[Bf > 0]
full = dict(voxels=n_full, volume_ml=round(n_full * vox_ml_full, 1), mean_hu=round(float(hv.mean()), 1), std_hu=round(float(hv.std()), 1), min_hu=float(hv.min()), max_hu=float(hv.max()),
            slices=int((Bf.any(axis=(1, 2))).sum()), z_range_mm=[int(np.where(Bf.any(axis=(1, 2)))[0].min() * dz), int(np.where(Bf.any(axis=(1, 2)))[0].max() * dz)])
# ---- resample the mask like v6 (4 x 2 x 4 blocks, grid [a, s, l]) then fraction >= 0.5 ----
V = Bf.astype(np.float32).transpose(1, 0, 2)                  # [row = anterior, k, col = left]
Vd = V[:na * 4, :ns * 2, :nl * 4].reshape(na, 4, ns, 2, nl, 4).mean(axis=(1, 3, 5))
pan = Vd >= 0.5
lab = lab6.copy(); lab[pan] = 5
vox_ml_ds = (ps[0] * 4) * (ps[1] * 4) * (dz * 2) / 1000
ds_ = dict(voxels=int(pan.sum()), volume_ml=round(float(pan.sum()) * vox_ml_ds, 1), ratio_to_full=round(float(pan.sum()) * vox_ml_ds / full["volume_ml"], 3),
           mean_hu_of_v6_intensity_window=None)
inside_soft = float((lab6[pan] == 3).mean()); ds_["fraction_in_v6_soft_band"] = round(inside_soft, 3)
def nrrd(arr, kind):
    h = f"NRRD0004\n# x3d-demo medical-provenance v7; {kind}\ntype: uint8\ndimension: 3\nsizes: {arr.shape[2]} {arr.shape[1]} {arr.shape[0]}\nencoding: gzip\nendian: little\n\n"
    return h.encode() + gzip.compress(np.ascontiguousarray(arr).tobytes(), 9, mtime=0)
nL = nrrd(lab, "labels: 0 outside, 1 gas/lung, 2 fat band, 3 soft band, 4 dense band, 5 pancreas (NIH label, TCIA)"); (HERE / "scene" / "ct-organ-labels.nrrd").write_bytes(nL)
# ---- scene ----
def ms(n, v): return f"<MetadataString name={quoteattr(n)} value={quoteattr(chr(34) + str(v).replace(chr(34), chr(39)) + chr(34))}/>"
def mset(n, items, top=False): return f'<MetadataSet {"containerField=\'metadata\' " if top else ""}name={quoteattr(n)} reference="x3d-demo:medprov">' + "".join(items) + "</MetadataSet>"
dims = " ".join(f"{x:.5f}" for x in (360.0 / 1000, 184.0 / 1000, 360.0 / 1000))
meta = mset("provenance", top=True, items=[
 mset("source", [ms("series-instance-uid", SERIES), ms("license", "CC BY 3.0 (TCIA Pancreas-CT)"), ms("doi", "https://doi.org/10.7937/K9/TCIA.2016.tNB1kqBU"), ms("pixel-data-sha256", s6["pixel_data_sha256"]), ms("intensity-from", "v6/scene/ct-intensity.nrrd sha256 " + s6["intensity_sha256"])]),
 mset("label", [ms("source-file", LAB_MEMBER), ms("source-zip-sha256", sha(lz)), ms("labelled-by", "medical student, verified or modified by a radiologist (collection page)"), ms("axis-fix", "slice axis flipped; chosen by lowest HU std inside the label of 8 flips"), ms("labels-sha256", sha(nL))]),
 mset("segment-5", [ms("name", "pancreas"), ms("term", "FMA:7198 Pancreas (exact label, FMA 5.1.0, EBI OLS4)"), ms("grade", "L: dataset naming and annotator trust, not re-checked by this build")])])
SEG = {1: ("0.55 0.75 1.0", 0), 2: ("1.0 0.85 0.3", 0), 3: ("0.85 0.45 0.4", 0), 4: ("0.95 0.95 0.9", 0), 5: ("0.2 1.0 0.3", 0)}
sty = "\n ".join(f'<ShadedVolumeStyle DEF="STY_{i}" containerField="renderStyle" lighting="true"><Material diffuseColor="{c}" specularColor="0.3 0.3 0.3"/></ShadedVolumeStyle>' for i, (c, _) in SEG.items())
scene = f'''<?xml version="1.0" encoding="UTF-8"?>
<X3D profile="Full" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="http://www.web3d.org/specifications/x3d-4.0.xsd">
<head><meta name="title" content="medical-provenance v7: CT with the NIH pancreas label"/><meta name="description" content="Open TCIA Pancreas-CT series with the open pancreas label as an FMA-linked segment; educational proof of concept, not medical advice."/></head>
<Scene>
<NavigationInfo type='"EXAMINE" "ANY"' headlight="true"/>
<Viewpoint DEF="VP_FRONT" description="Front (anterior)" position="0 0 0.9" orientation="0 0 1 0" centerOfRotation="0 0 0"/>
<Transform DEF="VOL_T">
{meta}
<SegmentedVolumeData DEF="VOL" dimensions="{dims}" segmentEnabled="false false false false false true">
 <ImageTexture3D containerField="voxels" url='"../../v6/scene/ct-intensity.nrrd"'/>
 <ImageTexture3D containerField="segmentIdentifiers" url='"ct-organ-labels.nrrd"'/>
 {sty}
</SegmentedVolumeData>
</Transform>
</Scene></X3D>'''
(HERE / "scene" / "ct-organ.x3d").write_text(scene)
# ---- claims ----
SRC = f"TCIA Pancreas-CT series {SERIES} plus NIH pancreas labels {LAB_MEMBER}"
claims = [
 ("label.provenance", "provenance", "C", f"Label file {LAB_MEMBER} from {LAB_URL} (zip sha256 {sha(lz)}, {len(lz)} bytes): a 512 x 512 x {len(dsl)} uint8 NIfTI mask with values 0 and 1, grid {tuple(round(float(z), 6) for z in im.header.get_zooms())} mm, axis codes {''.join(nib.aff2axcodes(im.affine))}.", "nibabel header read in build.py"),
 ("label.method", "provenance", "L", "The collection page states that a medical student segmented the pancreas slice by slice and an experienced radiologist verified or modified it; the DICOM files were made from anonymized NIfTI volumes with ITK. Quoted from the collection page read on 2026-11-18, not independently audited.", "TCIA collection page"),
 ("label.licence", "licence", "L", "The collection is CC BY 3.0 (archive API, checked in v6 for the image series). The label zip is offered on the same collection page; this build did not find a separate licence for it, so it is treated as covered by the collection licence and the derived label volume is shipped under CC BY 3.0 with the same notice. Check before reuse.", "TCIA collection page"),
 ("label.alignment", "geometry", "C", "The label NIfTI affine has an arbitrary origin, so alignment to the DICOM was tested, not assumed. All 8 flips of the three axes were tried; the winner (slice axis flipped only) puts the label on HU " + f"{trial[best]['mean_hu']} +/- {trial[best]['std_hu']} with {trial[best]['frac_soft']*100:.0f} percent of voxels in -30..250 HU. The other seven give std HU {sorted(v['std_hu'] for k,v in trial.items() if k != best)[0]} to {max(v['std_hu'] for v in trial.values())}.", "build.py, HU read under each flip"),
 ("label.stats-full", "measurement", "C", f"At full resolution: {full['voxels']} voxels = {full['volume_ml']} mL over {full['slices']} slices ({full['z_range_mm'][0]} to {full['z_range_mm'][1]} mm from the lowest slice); HU mean {full['mean_hu']}, std {full['std_hu']}, range {full['min_hu']:.0f} to {full['max_hu']:.0f}. A mean near 105 HU matches portal-venous enhancement, which the collection page states.", "build.py on DICOM and label"),
 ("label.stats-shipped", "processing", "C", f"Block-resampled like v6 (4 x 2 x 4, kept where at least half the block is label): {ds_['voxels']} voxels = {ds_['volume_ml']} mL, {ds_['ratio_to_full']*100:.0f} percent of the full-resolution volume; {ds_['fraction_in_v6_soft_band']*100:.0f} percent of those voxels sit in the v6 soft-tissue band. Segment id 5 replaces the band id wherever it applies. Labels file sha256 {sha(nL)}.", "build.py on the shipped arrays"),
 ("segment.fma-pancreas", "denotes", "L", "Segment 5 denotes FMA:7198 Pancreas (exact-label hit in FMA 5.1.0 through EBI OLS4 on 2026-11-18). Unlike the v6 density bands this is a named organ from a human annotation, so the denotes claim is L rather than S; it is L and not C because the annotation itself was not re-checked.", "EBI OLS4 exact label search"),
 ("scope.one-case", "scope", "S", "One patient, one annotator, one scan. This shows that an open label can carry a real FMA term into a volume scene with its evidence; it says nothing about annotation accuracy, inter-rater spread, or other organs. The other 79 labels in the same zip were not used.", "scope note"),
 ("scope.no-registration", "scope", "S", "Still not registered to the v3 torso, BodyParts3D (v5) or the v4 skeleton; the pancreas here is this patient's, compared with nothing. A cross-subject comparison would use the BodyParts3D pancreas (FMA:7198) after a registration.", "scope note"),
]
CL = [dict(id=i, struct="pancreas", kind=k, grade=g, statement=s, instrument=ins, source=SRC) for i, k, g, s, ins in claims]
(HERE / "claims.json").write_text(json.dumps(CL, indent=1))
ctx = {"prov": "http://www.w3.org/ns/prov#", "skos": "http://www.w3.org/2004/02/skos/core#", "rdfs": "http://www.w3.org/2000/01/rdf-schema#", "grade": "urn:x3d:medprov:grade", "instrument": "urn:x3d:medprov:instrument"}
(HERE / "claims.jsonld").write_text(json.dumps({"@context": ctx, "@graph": [{"@id": "urn:x3d:medprov:v7:" + c["id"], "@type": "prov:Entity", "rdfs:label": c["id"], "skos:note": c["statement"], "grade": c["grade"], "instrument": c["instrument"], "prov:wasDerivedFrom": {"@id": c["source"].replace(" ", "_")}} for c in CL]}, indent=1))
summary = dict(series=SERIES, label_member=LAB_MEMBER, label_zip_sha256=sha(lz), labels_nrrd_bytes=len(nL), labels_sha256=sha(nL), flips_tried=trial, flip_chosen=best, full=full, shipped=ds_,
               claim_grades=dict(collections.Counter(c["grade"] for c in CL)), v6_intensity_sha256=s6["intensity_sha256"], scene_sha256=sha(scene.encode()))
(HERE / "data" / "summary.json").write_text(json.dumps(summary, indent=1)); print(json.dumps({k: summary[k] for k in ("flip_chosen", "full", "shipped", "claim_grades")}, indent=1))
if arg("--gate"):
    sys.path.insert(0, arg("--gate")); from validation.validate import validate_xml
    t0 = time.time(); r = validate_xml(scene); rc = {"ct-organ": dict(sha256=sha(scene.encode()), valid=r.get("valid"), errors=r.get("errors"), seconds=round(time.time() - t0, 2)), "validator": "x3d_mcp validate_xml"}
    print("ct-organ valid", rc["ct-organ"]["valid"], str(rc["ct-organ"]["errors"])[:600]); (HERE / "validation-v7.json").write_text(json.dumps(rc, indent=1))
