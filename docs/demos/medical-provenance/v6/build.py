#!/usr/bin/env python3
"""medical-provenance v6: one open TCIA CT series (Pancreas-CT, CC BY 3.0) as X3D VolumeData with graded claims.
Fetches the series from the NBIA API (cached under data/cache, never committed), reads the DICOM headers and pixels,
resamples to a small voxel grid in X3D axes (x = patient left, y = superior, z = anterior), writes two gzip NRRD
volumes (windowed intensity, HU class labels), two scenes, claims.json and the validation receipt.
  python3 -I build.py --gate <x3d_mcp>/src [--zip PATH]      (needs numpy and pydicom)"""
import sys, io, json, gzip, hashlib, pathlib, zipfile, urllib.request, urllib.parse, collections, time, tempfile
import numpy as np, pydicom
from xml.sax.saxutils import quoteattr
HERE = pathlib.Path(__file__).resolve().parent
NBIA = "https://services.cancerimagingarchive.net/nbia-api/services/v1/"
COLL, PATIENT = "Pancreas-CT", "PANCREAS_0051"
SERIES = "1.2.826.0.1.3680043.2.1125.1.77419915248783746629465382576486048"
PIXEL_SHA = None  # filled by the first build, then pinned in data/summary.json and checked on rebuild
FXY, FZ = 4, 2                     # block-mean factors in plane and along the patient axis
WIN_LO, WIN_HI = -200, 500         # HU window for the u8 intensity volume
sha = lambda b: hashlib.sha256(b).hexdigest()
arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
cache = HERE / "data" / "cache"; cache.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "x3d-demo-medical-provenance/1.0"}

def get(url, path, timeout=300):
    if not path.exists():
        path.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read())
    return path.read_bytes()

# ---- provenance from the archive API (checked in this build) ----
meta = json.loads(get(NBIA + "getSeries?" + urllib.parse.urlencode(dict(Collection=COLL, PatientID=PATIENT)), cache / "getSeries.json"))
ser = [m for m in meta if m["SeriesInstanceUID"] == SERIES][0]
zp = pathlib.Path(arg("--zip") or cache / "series.zip")
zb = get(NBIA + "getImage?SeriesInstanceUID=" + SERIES, zp, 560)
Z = zipfile.ZipFile(io.BytesIO(zb))
dsl = []
for n in Z.namelist():
    if n.lower().endswith(".dcm") or (not n.endswith("/") and "LICENSE" not in n):
        try: dsl.append(pydicom.dcmread(io.BytesIO(Z.read(n))))
        except Exception: pass
dsl = [d for d in dsl if hasattr(d, "PixelData")]
dsl.sort(key=lambda d: float(d.ImagePositionPatient[2]))
d0 = dsl[0]
assert len(dsl) == ser["ImageCount"], (len(dsl), ser["ImageCount"])
pix = hashlib.sha256()
for d in dsl: pix.update(d.PixelData)
pixel_sha = pix.hexdigest()
iop = [float(v) for v in d0.ImageOrientationPatient]; ps = [float(v) for v in d0.PixelSpacing]
zs = np.array([float(d.ImagePositionPatient[2]) for d in dsl]); dz = float(np.median(np.diff(zs)))
assert iop == [1, 0, 0, 0, -1, 0], iop      # this builder only handles the axis-aligned case seen in this series
slope, icpt = float(d0.RescaleSlope), float(d0.RescaleIntercept)
HU = np.stack([d.pixel_array.astype(np.int16) * slope + icpt for d in dsl]).astype(np.float32)   # [k superior, row, col]
K, R, C = HU.shape
# DICOM LPS: col -> patient left (+x), row -> +y_LPS is posterior, iop row vector (0,-1,0) means row index increases toward anterior.
# X3D grid V[a, s, l] with a anterior (slowest), s superior, l patient left (fastest). (x,y,z) = (L,S,A) is right-handed;
# (R,S,A) would be a mirror image, so x is patient LEFT and a camera on +z (looking at the front) shows patient left on screen right.
V = HU.transpose(1, 0, 2)
a, s, r = V.shape
na, ns, nr = a // FXY, K // FZ, C // FXY
Vd = V[:na * FXY, :ns * FZ, :nr * FXY].reshape(na, FXY, ns, FZ, nr, FXY).mean(axis=(1, 3, 5))     # block mean HU
vox = np.array([ps[1] * FXY, dz * FZ, ps[0] * FXY])       # mm per voxel (left, superior, anterior) -> sizes below
size_mm = dict(left=nr * ps[0] * FXY, superior=ns * dz * FZ, anterior=na * ps[1] * FXY)

# ---- body mask: outside air = HU < -300 connected to the slice border (2D flood fill per slice) ----
def outside(sl):
    low = sl < -300; out = np.zeros_like(low); st = collections.deque()
    H, W = low.shape
    for i in range(H):
        for j in (0, W - 1):
            if low[i, j] and not out[i, j]: out[i, j] = True; st.append((i, j))
    for j in range(W):
        for i in (0, H - 1):
            if low[i, j] and not out[i, j]: out[i, j] = True; st.append((i, j))
    while st:
        i, j = st.pop()
        for p, q in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
            if 0 <= p < H and 0 <= q < W and low[p, q] and not out[p, q]: out[p, q] = True; st.append((p, q))
    return out
OUT = np.stack([outside(Vd[:, k, :]) for k in range(ns)], axis=1)            # [a, s, r]
lab = np.zeros(Vd.shape, np.uint8)                                            # 0 outside / background
inside = ~OUT
lab[inside & (Vd < -500)] = 1       # low density inside body (gas or lung)
lab[inside & (Vd >= -500) & (Vd < -30)] = 2   # fat band (-150..-30 HU plus partial volume)
lab[inside & (Vd >= -30) & (Vd < 250)] = 3    # soft tissue band
lab[inside & (Vd >= 250)] = 4                 # bone / dense (contrast, calcification, table edge)
inten = np.clip((Vd - WIN_LO) / (WIN_HI - WIN_LO) * 255, 0, 255).round().astype(np.uint8)

def nrrd(arr, kind):
    h = f"NRRD0004\n# x3d-demo medical-provenance v6; source TCIA {COLL} series {SERIES}; {kind}\ntype: uint8\ndimension: 3\nsizes: {arr.shape[2]} {arr.shape[1]} {arr.shape[0]}\nencoding: gzip\nendian: little\n\n"
    return h.encode() + gzip.compress(np.ascontiguousarray(arr).tobytes(), 9, mtime=0)
(HERE / "scene").mkdir(exist_ok=True); (HERE / "data").mkdir(exist_ok=True)
nI, nL = nrrd(inten, f"intensity u8 = clip((HU-({WIN_LO}))/{WIN_HI - WIN_LO}*255)"), nrrd(lab, "class labels 0 outside, 1 gas/lung, 2 fat band, 3 soft band, 4 dense")
(HERE / "scene" / "ct-intensity.nrrd").write_bytes(nI); (HERE / "scene" / "ct-labels.nrrd").write_bytes(nL)

# ---- checks measured on the resampled grid (the instrument is this script on the shipped arrays) ----
body = inside.sum(); gas = lab == 1
aa = np.arange(na)[:, None, None] * np.ones_like(Vd)
body_a = aa[inside].mean(); gas_a = aa[gas].mean()      # gas rises in a supine patient: it should sit anterior of the body centroid
cls_frac = {int(k): float((lab == k).sum() / body) for k in (1, 2, 3, 4)}
checks = dict(
    voxels=[nr, ns, na], voxel_mm=[round(float(x), 3) for x in vox], size_mm={k: round(float(v), 1) for k, v in size_mm.items()},
    hu_min=float(HU.min()), hu_max=float(HU.max()), body_voxels=int(body), class_fraction_of_body=cls_frac,
    gas_mean_anterior_index=round(float(gas_a), 1), body_mean_anterior_index=round(float(body_a), 1),
    gas_anterior_to_body_centroid=bool(gas_a > body_a), dense_in_posterior_half_fraction=round(float((aa[lab == 4] < na / 2).mean()), 3), a_axis_voxels=na)
print(json.dumps(checks, indent=1))

# ---- scene ----
def ms(name, v): return f"<MetadataString name={quoteattr(name)} value={quoteattr(chr(34) + str(v).replace(chr(34), chr(39)) + chr(34))}/>"
def mset(name, items, top=False): return f'<MetadataSet {"containerField=\'metadata\' " if top else ""}name={quoteattr(name)} reference="x3d-demo:medprov">' + "".join(items) + "</MetadataSet>"
dims = f"{size_mm['left'] / 1000:.5f} {size_mm['superior'] / 1000:.5f} {size_mm['anterior'] / 1000:.5f}"     # metres
src_meta = mset("source", [ms("collection", COLL), ms("patient-id-coded", PATIENT), ms("series-instance-uid", SERIES), ms("doi", ser["CollectionURI"]),
                           ms("license", ser["LicenseName"]), ms("license-uri", ser["LicenseURI"]), ms("images", ser["ImageCount"]),
                           ms("pixel-data-sha256", pixel_sha), ms("not-medical-advice", "educational proof of concept")])
proc_meta = mset("processing", [ms("block-mean-factors-xyz", f"{FXY} {FZ} {FXY}"), ms("window-hu", f"{WIN_LO}..{WIN_HI}"),
                                ms("axes", "x patient left, y superior, z anterior (right-handed; from DICOM LPS)"), ms("intensity-sha256", sha(nI)), ms("labels-sha256", sha(nL))])
SEG = [(0, "outside / background", None, None), (1, "low density inside body (gas or lung)", "FMA:7195 Lung", "0.55 0.75 1.0"),
       (2, "fat band", "FMA:20110 Adipose tissue", "1.0 0.85 0.3"), (3, "soft-tissue band", None, "0.85 0.45 0.4"), (4, "dense band (bone, calcification, contrast)", "FMA:224804 Bone tissue", "0.95 0.95 0.9")]
seg_meta = mset("segments", [ms(f"segment-{i}", f"{n} | term {t or 'none, no single anatomical term fits'} | grade S (HU band, not an anatomical segmentation)") for i, n, t, c in SEG])
WRAP_CT = mset("provenance", [src_meta, proc_meta], top=True)
WRAP_SEG = mset("provenance", [src_meta, proc_meta, seg_meta], top=True)
def tf(fn):
    """1 x 256 RGBA PixelTexture transfer function; fn(i) -> (r, g, b, a) in 0..255."""
    px = " ".join("0x%02X%02X%02X%02X" % tuple(int(max(0, min(255, v))) for v in fn(i)) for i in range(256))
    return f'<PixelTexture containerField="transferFunction" image="256 1 4 {px}"/>'
def hu2i(h): return (h - WIN_LO) / (WIN_HI - WIN_LO) * 255
def ramp(i):   # fat and soft tissue faint, dense bone strong
    h = WIN_LO + i / 255 * (WIN_HI - WIN_LO)
    if h < -150: return (0, 0, 0, 0)
    if h < 0: return (230, 200, 110, 6)
    if h < 120: return (210, 120, 110, 14)
    if h < 250: return (230, 190, 170, 40)
    return (245, 245, 235, 200)
HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<X3D profile="Full" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="http://www.web3d.org/specifications/x3d-4.0.xsd">\n'
def common(title):
    return (f'<head><meta name="title" content="{title}"/><meta name="description" content="Open TCIA Pancreas-CT series as volume rendering; educational proof of concept, not medical advice."/></head>\n'
            '<Scene>\n<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>\n'
            '<Viewpoint DEF="VP_FRONT" description="Front (anterior)" position="0 0 0.9" orientation="0 0 1 0" centerOfRotation="0 0 0"/>\n')
def ctscene():
    return HEAD + common("medical-provenance v6: CT volume, intensity") + f'''<Transform DEF="VOL_T">
{WRAP_CT}
<VolumeData DEF="VOL" dimensions="{dims}">
 <ImageTexture3D DEF="TEX" containerField="voxels" url=\'"ct-intensity.nrrd"\'/>
 <ComposedVolumeStyle DEF="STY"><BoundaryEnhancementVolumeStyle retainedOpacity="0.15" boundaryOpacity="0.9" opacityFactor="2"/><ToneMappedVolumeStyle coolColor="0.2 0.3 0.6 1" warmColor="1 0.85 0.6 1"/></ComposedVolumeStyle>
</VolumeData>
</Transform>
</Scene></X3D>'''
def segscene():
    st = []
    for i, n, term, col in SEG[1:]:
        r, g, b = [float(c) * 255 for c in col.split()]
        a = {1: 5, 2: 8, 3: 18, 4: 190}[i]
        st.append(f'<ShadedVolumeStyle DEF="STY_{i}" containerField="renderStyle" lighting="true"><Material diffuseColor="{col}" specularColor="0.3 0.3 0.3"/></ShadedVolumeStyle>')
    return HEAD + common("medical-provenance v6: CT volume, HU-band segments") + f'''<Transform DEF="VOL_T">
{WRAP_SEG}
<SegmentedVolumeData DEF="VOL" dimensions="{dims}" segmentEnabled="false true true true true">
 <ImageTexture3D containerField="voxels" url=\'"ct-intensity.nrrd"\'/>
 <ImageTexture3D containerField="segmentIdentifiers" url=\'"ct-labels.nrrd"\'/>
 {chr(10).join(st)}
</SegmentedVolumeData>
</Transform>
</Scene></X3D>'''
SCENE_CT = ctscene()
SCENE_SEG = segscene()
(HERE / "scene" / "ct-volume.x3d").write_text(SCENE_CT); (HERE / "scene" / "ct-segments.x3d").write_text(SCENE_SEG)
# ---- claims (grades: C checked in this build, L third-party or not re-checked, S judgement or scope doubt) ----
INSTR_API = "NBIA API getSeries (cached response in data/cache/getSeries.json)"
INSTR_PY = "build.py (numpy, pydicom) on the shipped arrays"
SRC = f"TCIA {COLL} series {SERIES}"
claims = [
 ("series.provenance", "provenance", "C", f"Series {SERIES} of collection {COLL} (patient id as coded by the archive, {PATIENT}), {ser['ImageCount']} CT images, {ser['FileSize']} bytes, released {ser['DateReleased'][:10]}, DOI {ser['CollectionURI']}.", INSTR_API),
 ("series.licence", "licence", "C", f"The archive API reports the licence as '{ser['LicenseName']}' ({ser['LicenseURI']}). Attribution to the dataset DOI is carried in the scene MetadataSet and in NOTICE-TCIA.md. The licence applies to the images; the derived 128-cube volume is shipped under the same terms.", INSTR_API),
 ("series.pixel-sha", "integrity", "C", f"SHA-256 over the concatenated PixelData of all {len(dsl)} slices, sorted by z: {pixel_sha}. A rebuild from the archive must reproduce it.", INSTR_PY),
 ("series.geometry", "geometry", "C", f"From the DICOM headers: {R}x{C} pixels at {ps[0]} x {ps[1]} mm, {K} slices at {dz} mm, orientation {iop}, rescale slope {slope} intercept {icpt}; HU range {HU.min():.0f} to {HU.max():.0f}.", "pydicom headers"),
 ("volume.resample", "processing", "C", f"Block mean of HU by {FXY} x {FZ} x {FXY} gives {nr} x {ns} x {na} voxels of {vox[0]:.3f} x {vox[1]:.1f} x {vox[2]:.3f} mm ({size_mm['left']:.0f} x {size_mm['superior']:.0f} x {size_mm['anterior']:.0f} mm); intensity = clip((HU+{-WIN_LO})/{WIN_HI - WIN_LO}*255) as u8. {len(nI)} bytes gzip NRRD, sha256 {sha(nI)}. The window clips HU above {WIN_HI}; the block mean blurs thin structures and partial-volumes boundaries.", INSTR_PY),
 ("volume.axes", "geometry", "L", "Axes: x = patient left, y = superior, z = anterior, which is right-handed (the DICOM LPS columns map straight to x). Checked by eye on axial slices (spine, kidneys and CT table at the low-z side, bowel gas at the high-z side) and numerically only weakly: the mean position of internal gas is " + f"{gas_a:.1f} against a body mean of {body_a:.1f} of {na} (anterior of centre by {gas_a - body_a:.1f} voxels). Left versus right is taken from the header, not from an organ-position test.", INSTR_PY + " plus visual check"),
 ("segments.hu-bands", "segmentation", "S", "The four segment ids are HU bands inside the body mask, not an anatomical segmentation: low density < -500 (gas or lung, " + f"{cls_frac[1]*100:.0f} percent of body voxels), fat band -500 to -30 ({cls_frac[2]*100:.0f}), soft band -30 to 250 ({cls_frac[3]*100:.0f}), dense >= 250 ({cls_frac[4]*100:.0f}). Block-mean partial volume pushes boundary voxels into the wrong band; contrast-filled bowel and the CT table land in the dense band; the body mask is a 2D flood fill of HU < -300 from the slice border.", INSTR_PY),
 ("segments.fma-terms", "denotes", "S", "Terms offered for the bands: gas/lung FMA:7195 Lung, fat FMA:20110 Adipose tissue, dense FMA:224804 Bone tissue (all three exact-label hits in FMA 5.1.0 through EBI OLS4 on 2026-11-18); the soft band has no single anatomical term and carries none. The mapping from band to term is a judgement: the gas band is mostly bowel gas in this series, so Lung is wrong here, and the dense band includes non-bone.", "EBI OLS4 exact label search, then judgement"),
 ("series.no-registration", "scope", "S", "The volume is not registered to the v3 CT torso scene, to BodyParts3D (v5) or to the v4 H-Anim skeleton; it is a different person, abdomen only (184 mm, upper abdomen), shown in its own scene. Linking organs across these needs a segmentation, for example the TotalSegmentator labels (Zenodo 10047292, CC BY 4.0), which was not used.", "scope note"),
 ("series.deid", "privacy", "L", "The first slice header has PatientName equal to the coded id, empty birth date, sex and referring physician, InstitutionName NIH, a retained study date (2015-11-24), and no PatientIdentityRemoved or DeidentificationMethod tag; the archive states the collection is de-identified, which this build did not audit pixel by pixel. An abdominal field of view carries no face.", "pydicom header read plus archive statement"),
]
CL = [dict(id=i, struct="series", kind=k, grade=g, statement=s, instrument=ins, source=SRC) for i, k, g, s, ins in claims]
(HERE / "claims.json").write_text(json.dumps(CL, indent=1))
ctx = {"prov": "http://www.w3.org/ns/prov#", "skos": "http://www.w3.org/2004/02/skos/core#", "rdfs": "http://www.w3.org/2000/01/rdf-schema#", "grade": "urn:x3d:medprov:grade", "instrument": "urn:x3d:medprov:instrument"}
(HERE / "claims.jsonld").write_text(json.dumps({"@context": ctx, "@graph": [{"@id": "urn:x3d:medprov:v6:" + c["id"], "@type": "prov:Entity", "rdfs:label": c["id"], "skos:note": c["statement"], "grade": c["grade"], "instrument": c["instrument"], "prov:wasDerivedFrom": {"@id": c["source"].replace(" ", "_")}} for c in CL]}, indent=1))
print("claims", dict(collections.Counter(c["grade"] for c in CL)))
summary = dict(series=SERIES, collection=COLL, license=ser["LicenseName"], images=ser["ImageCount"], pixel_data_sha256=pixel_sha,
               intensity_nrrd_bytes=len(nI), labels_nrrd_bytes=len(nL), claim_grades=dict(collections.Counter(c['grade'] for c in CL)), intensity_sha256=sha(nI), labels_sha256=sha(nL), checks=checks)
(HERE / "data" / "summary.json").write_text(json.dumps(summary, indent=1))
if arg("--gate"):
    sys.path.insert(0, arg("--gate")); from validation.validate import validate_xml
    rc = {}
    for nm, x in (("ct-volume", SCENE_CT), ("ct-segments", SCENE_SEG)):
        t0 = time.time(); rr_ = validate_xml(x); rc[nm] = dict(sha256=sha(x.encode()), valid=rr_.get("valid"), errors=rr_.get("errors"), seconds=round(time.time() - t0, 2))
        print(nm, "valid", rc[nm]["valid"], str(rc[nm]["errors"])[:800])
    rc["validator"] = "x3d_mcp validate_xml"; (HERE / "validation-v6.json").write_text(json.dumps(rc, indent=1))
