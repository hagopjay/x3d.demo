#!/usr/bin/env python3
"""medical-provenance v2 builder (stdlib only).

Reads the existing torso and brain scenes of brain-torso-xite/v1 (not copied), looks each organ up
in FMA (EBI OLS4), crosswalks FMA -> Wikidata -> Uberon -> SNOMED CT / MeSH / UMLS ids, maps bones to
H-Anim segment names (checked against the X3D XSD enumeration), checks BodyParts3D coverage, runs a few
local checks (laterality, bbox), then writes:
  structures.json, claims.json, claims.jsonld, scene/torso-fma.x3dz, scene/brain-fma.x3dz,
  data/ledger.json (every network call: url, sha256, bytes, UTC time)

  python3 -I build.py                  # offline: uses data/cache/*.json
  python3 -I build.py --refresh        # re-fetch from the network (OLS4, Wikidata, BP3D)
  python3 -I build.py --gate <x3d_mcp>/src   # also validate both scenes (x3d_mcp validate_xml)
"""
import json, sys, re, gzip, hashlib, pathlib, time, datetime, urllib.request, urllib.parse, collections
from xml.sax.saxutils import quoteattr

HERE = pathlib.Path(__file__).resolve().parent
BT = HERE.parent.parent / "brain-torso-xite" / "v1"
CACHE = HERE / "data" / "cache"
REFRESH = "--refresh" in sys.argv
GATE = sys.argv[sys.argv.index("--gate") + 1] if "--gate" in sys.argv else None
UA = {"User-Agent": "x3d-demo-medical-provenance/1.0 (research PoC)"}
LEDGER = []

def sha(b): return hashlib.sha256(b).hexdigest()

def fetch(key, url, headers=None):
    """Cached GET. Cache file holds the raw body; ledger records url, sha256, bytes, time."""
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / (re.sub(r"[^A-Za-z0-9._-]", "_", key) + ".json")
    meta = CACHE / (p.name + ".meta")
    if p.exists() and not REFRESH:
        body = p.read_bytes(); m = json.loads(meta.read_text()) if meta.exists() else {}
        LEDGER.append(dict(key=key, url=url, sha256=sha(body), bytes=len(body), fetched=m.get("fetched", "cache"), from_cache=True))
        return body
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    body = urllib.request.urlopen(req, timeout=60).read()
    p.write_bytes(body)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta.write_text(json.dumps(dict(url=url, fetched=now)))
    LEDGER.append(dict(key=key, url=url, sha256=sha(body), bytes=len(body), fetched=now, from_cache=False))
    return body

# ---------------------------------------------------------------- source scenes
TORSO_X3DZ = BT / "scenes" / "torso_ct_lite.x3dz"
BRAIN_X3DZ = BT / "scenes" / "brain_hero_lite.x3dz"
regions = json.loads((BT / "data" / "torso_regions.json").read_text())
REG = {r["id"]: r for r in regions["regions"]}

# ---------------------------------------------------------------- name tables
ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"]
def fma_label(s):
    """TotalSegmentator-style id (no STRUCT_ prefix) -> (candidate FMA label, note, grade_override)"""
    m = re.fullmatch(r"rib_(left|right)_(\d+)", s)
    if m: return f"{m[1].capitalize()} {ORD[int(m[2]) - 1]} rib", "", None
    m = re.fullmatch(r"vertebrae_([CTLS])(\d+)", s)
    if m:
        k, n = m[1], int(m[2])
        if k == "C": return ({1: "Atlas", 2: "Axis"}.get(n) or f"{ORD[n - 1].capitalize()} cervical vertebra"), "", None
        if k == "T": return f"{ORD[n - 1].capitalize()} thoracic vertebra", "", None
        if k == "L": return f"{ORD[n - 1].capitalize()} lumbar vertebra", "", None
        return "First sacral vertebra", "S1 is part of the fused sacrum; the scene also has a separate `sacrum` shape, so the two overlap.", "S"
    return None
SPECIAL = {
 "skin": ("Skin", "CT threshold of the body surface (HU above -300), not a histological skin layer; includes whatever the threshold catches.", "S"),
 "adrenal_gland_left": ("Left adrenal gland", "FMA has no 'suprarenal gland' label; 'adrenal gland' is the FMA preferred name.", None),
 "adrenal_gland_right": ("Right adrenal gland", "", None),
 "aorta": ("Aorta", "", None), "brachiocephalic_trunk": ("Brachiocephalic artery", "TotalSegmentator says trunk, FMA says artery: same vessel by name.", None),
 "brain": ("Brain", "CT brain mask of the subject (no folds).", None),
 "clavicula_left": ("Left clavicle", "", None), "clavicula_right": ("Right clavicle", "", None),
 "colon": ("Colon", "TotalSegmentator colon may include rectum; FMA 'Colon' excludes it. Scope not verified.", "S"),
 "duodenum": ("Duodenum", "", None), "esophagus": ("Esophagus", "", None),
 "femur_left": ("Left femur", "", None), "femur_right": ("Right femur", "", None), "gallbladder": ("Gallbladder", "", None),
 "heart": ("Heart", "", None), "hip_left": ("Left hip bone", "", None), "hip_right": ("Right hip bone", "", None),
 "humerus_left": ("Left humerus", "", None), "humerus_right": ("Right humerus", "", None),
 "inferior_vena_cava": ("Inferior vena cava", "", None), "kidney_left": ("Left kidney", "", None), "kidney_right": ("Right kidney", "", None),
 "liver": ("Liver", "", None),
 "lung_upper_lobe_left": ("Upper lobe of left lung", "", None), "lung_lower_lobe_left": ("Lower lobe of left lung", "", None),
 "lung_upper_lobe_right": ("Upper lobe of right lung", "", None), "lung_middle_lobe_right": ("Middle lobe of right lung", "", None),
 "lung_lower_lobe_right": ("Lower lobe of right lung", "", None),
 "pancreas": ("Pancreas", "", None), "prostate": ("Prostate", "", None), "sacrum": ("Sacrum", "", None),
 "scapula_left": ("Left scapula", "", None), "scapula_right": ("Right scapula", "", None), "skull": ("Skull", "", None),
 "small_bowel": ("Small intestine", "FMA 'Small intestine' includes the duodenum, which the scene also draws separately; the shapes may overlap in meaning.", "S"),
 "spinal_cord": ("Spinal cord", "", None), "spleen": ("Spleen", "", None), "sternum": ("Sternum", "", None), "stomach": ("Stomach", "", None),
 "superior_vena_cava": ("Superior vena cava", "", None), "thyroid_gland": ("Thyroid gland", "", None), "trachea": ("Trachea", "", None),
 "urinary_bladder": ("Urinary bladder", "", None),
 "costal_cartilages": ("Costal cartilage", "One shape for all costal cartilages; FMA has one class per cartilage plus a generic class. Mapped to the generic class.", "S"),
 "pulmonary_vein": ("Pulmonary vein", "One shape for the pulmonary veins as a set; mapped to the generic class.", "S"),
 "portal_vein_and_splenic_vein": ("Portal vein", "TotalSegmentator merges the portal and splenic veins in one label; FMA 'Portal vein' alone is narrower.", "S"),
 "common_carotid_artery_left": ("Left common carotid artery", "", None), "common_carotid_artery_right": ("Right common carotid artery", "", None),
 "subclavian_artery_left": ("Left subclavian artery", "", None), "subclavian_artery_right": ("Right subclavian artery", "", None),
 "iliac_artery_left": ("Left common iliac artery", "TotalSegmentator 'iliac_artery' may run past the common iliac into external/internal branches; extent not verified.", "S"),
 "iliac_artery_right": ("Right common iliac artery", "Same extent caveat as the left.", "S"),
 "iliac_vena_left": ("Left common iliac vein", "Same extent caveat as the arteries.", "S"), "iliac_vena_right": ("Right common iliac vein", "Same extent caveat as the arteries.", "S"),
 "brachiocephalic_vein_left": ("Left brachiocephalic vein", "", None), "brachiocephalic_vein_right": ("Right brachiocephalic vein", "", None),
 "atrial_appendage_left": ("Left auricle", "FMA names the left atrial appendage 'Left auricle'.", None),
 "lungvessels": (None, "CT iso-surface of vessels inside the lungs; no single FMA class (it is many small vessels).", "S"),
 "cortex_left": ("Cerebral cortex", "Template cortex of one hemisphere, ILLUSTRATIVE fit; FMA 'Cerebral cortex' is not hemisphere-specific.", "S"),
 "cortex_right": ("Cerebral cortex", "Template cortex of one hemisphere, ILLUSTRATIVE fit; FMA 'Cerebral cortex' is not hemisphere-specific.", "S"),
 "cerebellum": ("Cerebellum", "Template cerebellum (MNI152 aseg) fitted into the subject, ILLUSTRATIVE.", "S"),
 "brainstem": ("Brainstem", "Template brainstem fitted into the subject, ILLUSTRATIVE.", "S"),
}
# brain tab (template MNI152 aseg deep structures, DEFs STRUCT_<name> in brain_hero_lite)
BRAIN = {
 "thalamus": ("Thalamus", ""), "caudate": ("Caudate nucleus", ""), "putamen": ("Putamen", ""),
 "pallidum": ("Globus pallidus", "aseg 'pallidum' = globus pallidus."), "hippocampus": ("Hippocampus", "Name only: FMA distinguishes the hippocampus proper from the hippocampal formation; scope not checked."),
 "amygdala": ("Amygdala", ""), "accumbens": ("Nucleus accumbens", ""),
 "ventricles": ("Ventricular system of brain", "aseg lateral ventricles, mapped to the wider FMA ventricular system; scope not verified."),
 "brainstem": ("Brainstem", ""), "cerebellum": ("Cerebellum", ""),
}
BRAIN_DOUBT = {"hippocampus", "ventricles"}   # scope of the aseg label vs the FMA class not verified
# bones -> H-Anim segment (checked against the XSD)
def hanim_for(s):
    m = re.fullmatch(r"vertebrae_([CTL])(\d+)", s)
    if m: return f"{m[1].lower()}{m[2]}"
    m = re.fullmatch(r"(clavicula|scapula|humerus|femur)_(left|right)", s)
    if m:
        side = "l" if m[2] == "left" else "r"
        return f"{side}_" + {"clavicula": "clavicle", "scapula": "scapula", "humerus": "upperarm", "femur": "thigh"}[m[1]]
    return {"skull": "skull", "sacrum": "sacrum", "vertebrae_S1": "sacrum"}.get(s)
# H-Anim 'pelvis' is the segment above the hip joints; hip bones map there by name only
HANIM_LOOSE = {"hip_left": "pelvis", "hip_right": "pelvis"}

def ols_ancestors(iri):
    q = urllib.parse.quote(urllib.parse.quote(iri, safe=""), safe="")
    d = json.loads(fetch("ols-anc-" + iri.rsplit("/", 1)[1], f"https://www.ebi.ac.uk/ols4/api/ontologies/fma/terms/{q}/hierarchicalAncestors?size=200"))
    return [x["label"] for x in d.get("_embedded", {}).get("terms", [])]

# ---------------------------------------------------------------- fetch: FMA (OLS4)
def ols_fma(label):
    u = "https://www.ebi.ac.uk/ols4/api/search?" + urllib.parse.urlencode(dict(q=label, ontology="fma", exact="true", queryFields="label", rows=3))
    d = json.loads(fetch("ols-fma-" + label.lower().replace(" ", "-"), u))["response"]["docs"]
    d = [x for x in d if x["label"].lower() == label.lower() and x.get("type") == "class"]
    return d[0] if d else None

# ---------------------------------------------------------------- assemble candidate list
items = []   # dict per structure
for sid in REG:
    s = sid.replace("STRUCT_", "")
    cand = fma_label(s) or SPECIAL.get(s)
    if not cand: raise SystemExit("unmapped structure " + s)
    items.append(dict(scene="torso", id=sid, uid=s, key=s, label_in=cand[0], note=cand[1], grade_override=cand[2], region=REG[sid]))
for k, (lab, note) in BRAIN.items():
    items.append(dict(scene="brain", id="STRUCT_" + k, uid="brain." + k, key=k, label_in=lab, note=note, grade_override=("S" if k in BRAIN_DOUBT else None), region=None))

labels = sorted({i["label_in"] for i in items if i["label_in"]})
fma = {}
for l in labels:
    fma[l] = ols_fma(l)
unresolved = [l for l in labels if not fma[l]]
print("FMA labels:", len(labels), "resolved:", len(labels) - len(unresolved), "unresolved:", unresolved)

# FMA numeric ids
def fma_num(d): return int(re.sub(r"\D", "", d["short_form"]))
ids = sorted({fma_num(d) for d in fma.values() if d})

# ---------------------------------------------------------------- Wikidata crosswalk FMA -> Q -> Uberon
vals = " ".join(f'"{i}"' for i in ids)
sparql = f'SELECT ?fma ?item ?itemLabel ?ub WHERE {{ VALUES ?fma {{ {vals} }} ?item wdt:P1402 ?fma . OPTIONAL {{ ?item wdt:P1554 ?ub }} SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }} }}'
wd_raw = fetch("wikidata-fma-batch", "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(sparql), {"Accept": "application/sparql-results+json"})
WD = collections.defaultdict(list)
for b in json.loads(wd_raw)["results"]["bindings"]:
    WD[int(b["fma"]["value"])].append(dict(qid=b["item"]["value"].rsplit("/", 1)[1], label=b["itemLabel"]["value"], uberon=b.get("ub", {}).get("value")))

def uberon_xrefs(ub):
    iri = urllib.parse.quote(urllib.parse.quote("http://purl.obolibrary.org/obo/UBERON_" + ub, safe=""), safe="")
    d = json.loads(fetch("uberon-" + ub, f"https://www.ebi.ac.uk/ols4/api/ontologies/uberon/terms/{iri}"))
    out = collections.defaultdict(list)
    for x in d.get("obo_xref") or []:
        if x["database"] in ("SCTID", "MESH", "UMLS", "NCIT", "FMA"): out[x["database"]].append(x["id"])
    return d.get("label"), dict(out)

# ---------------------------------------------------------------- BodyParts3D coverage
bp_part = {}
for f in ("partof_parts_list_e.txt", "isa_parts_list_e.txt"):
    for ln in fetch("bp3d-" + f, "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/" + f).decode("utf8", "replace").splitlines()[1:]:
        c = ln.split("\t")
        if len(c) >= 3 and c[0].startswith("FMA"): bp_part.setdefault(int(c[0][3:]), (c[1], c[2], f))

# ---------------------------------------------------------------- H-Anim names from the XSD
def hanim_names(src):
    t = (pathlib.Path(src) / "validation" / "schemas" / "x3d-4.1.xsd").read_text()
    i = t.index('name="hanimSegmentNameValues"'); j = t.index("</xs:simpleType>", i)
    return set(re.findall(r'xs:enumeration value="([^"]+)"', t[i:j]))
HX = pathlib.Path(sys.argv[sys.argv.index("--gate") + 1]) if GATE else None
hcache = HERE / "data" / "hanim-segments-x3d-4.1.json"
if HX and (HX / "validation" / "schemas" / "x3d-4.1.xsd").exists():
    HSEG = sorted(hanim_names(HX)); hcache.write_text(json.dumps(dict(source="x3d_mcp src/validation/schemas/x3d-4.1.xsd simpleType hanimSegmentNameValues", count=len(HSEG), names=HSEG), indent=1))
else:
    HSEG = json.loads(hcache.read_text())["names"]
HSEG = set(HSEG)

# ---------------------------------------------------------------- build structure records and claims
CL = []   # claims
def claim(sid, kind, pred, obj, stmt, grade, instrument, source):
    cid = f"{sid}.{kind}"
    CL.append(dict(id=cid, struct=sid, kind=kind, predicate=pred, object=obj, statement=stmt, grade=grade, instrument=instrument, source=source))
    return cid

_bt = gzip.open(BRAIN_X3DZ).read().decode("utf8")
def brain_geom(sid):
    i = _bt.index("DEF='" + sid + "'"); j = _bt.index("point='", i); k = _bt.index("'", j + 7)
    v = [float(x) for x in _bt[j + 7:k].split()]; xs, ys, zs = v[0::3], v[1::3], v[2::3]
    return [round(sum(a) / len(a), 1) for a in (xs, ys, zs)], [round(min(a), 1) for a in (xs, ys, zs)], [round(max(a), 1) for a in (xs, ys, zs)], len(xs)
STR = []
for it in items:
    sid, s = it["uid"], it["key"]
    rec = dict(id=it["id"], uid=sid, scene=it["scene"], label_in=it["label_in"], note=it["note"], claims=[])
    d = fma.get(it["label_in"]) if it["label_in"] else None
    if it["scene"] == "torso":
        r = it["region"]; rec.update(group=r["group"], source=r["source"], volume_ml=r["volume_ml"], centroid_mm=r["centroid_mm"])
    if it["scene"] == "brain":
        c, lo, hi, nv = brain_geom(it["id"]); rec.update(centroid_mm=c, bbox_min_mm=lo, bbox_max_mm=hi, vertices=nv)
    if d:
        n = fma_num(d); rec.update(fma_id=f"FMA:{n}", fma_label=d["label"], fma_iri=d["iri"])
        rec["claims"].append(claim(sid, "fma-term", "x3d:fmaClass", d["iri"],
            f"FMA 5.1.0 has class '{d['label']}' (FMA:{n}); OLS4 exact-label search returned it.", "C", "EBI OLS4 /api/search ontology=fma exact=true (fetched this build)", "https://www.ebi.ac.uk/ols4/ontologies/fma"))
        g = it["grade_override"] or "L"
        why = it["note"] or "Same name after stripping side and case; judged by the builder, no anatomist review."
        rec["claims"].append(claim(sid, "denotes", "x3d:denotes", d["iri"],
            f"Shape {it['id']} ({it['scene']} scene) denotes FMA class '{d['label']}'. {why}", g, "builder name match (human judgement not applied)", "tools: build.py SPECIAL table"))
        rec["denotes_grade"] = g
        anc = ols_ancestors(d["iri"]); rec["fma_ancestors"] = anc
        rec["claims"].append(claim(sid, "isa", "rdfs:subClassOf", d["iri"],
            f"FMA says '{d['label']}' is a kind of: {', '.join(a for a in anc if a not in ('Anatomical entity', 'Physical anatomical entity', 'Material anatomical entity', 'Postnatal anatomical structure', 'Anatomical structure')) or 'only generic anatomical classes'} ({len(anc)} ancestors).", "C", "EBI OLS4 hierarchicalAncestors, ontology fma (fetched this build)", "https://www.ebi.ac.uk/ols4/ontologies/fma"))
        # crosswalk
        w = WD.get(n, [])
        if w:
            q = w[0]; rec["wikidata"] = q["qid"]
            rec["claims"].append(claim(sid, "wikidata", "skos:exactMatch", "http://www.wikidata.org/entity/" + q["qid"],
                f"Wikidata item {q['qid']} ('{q['label']}') carries FMA ID {n} (P1402).", "C", "Wikidata SPARQL P1402 (fetched this build)", "https://query.wikidata.org/"))
            if q.get("uberon"):
                rec["uberon"] = "UBERON:" + q["uberon"]
                ul, xr = uberon_xrefs(q["uberon"])
                rec["uberon_label"] = ul; rec["xrefs"] = xr
                bad = [x for x in xr.get("FMA", []) if x != str(n)]
                if xr.get("FMA") and str(n) not in xr["FMA"]:
                    rec["claims"].append(claim(sid, "uberon", "skos:closeMatch", "http://purl.obolibrary.org/obo/UBERON_" + q["uberon"],
                        f"Uberon {q['uberon']} ('{ul}') is linked via Wikidata but its own FMA xref is {xr['FMA']}, not {n}.", "S", "Uberon xref via OLS4 (fetched this build)", "CC BY 3.0"))
                else:
                    rec["claims"].append(claim(sid, "uberon", "skos:exactMatch", "http://purl.obolibrary.org/obo/UBERON_" + q["uberon"],
                        f"Uberon {q['uberon']} ('{ul}') lists FMA:{n} among its xrefs, agreeing with the Wikidata link.", "C", "Uberon xref via OLS4 (fetched this build)", "CC BY 3.0, OBO registry"))
                if xr.get("SCTID"):
                    rec["snomed_ct"] = xr["SCTID"]
                    rec["claims"].append(claim(sid, "snomed", "skos:closeMatch", "http://purl.bioontology.org/ontology/SNOMEDCT/" + xr["SCTID"][0],
                        f"SNOMED CT concept id {', '.join(xr['SCTID'])} asserted by Uberon for this organ; not looked up in SNOMED itself (affiliate licence needed to browse).", "L", "Uberon xref SCTID via OLS4", "SNOMED International affiliate licence applies to the content, not just ids"))
                if xr.get("MESH"): rec["mesh"] = xr["MESH"]
                if xr.get("UMLS"): rec["umls"] = xr["UMLS"]
        if not rec.get("snomed_ct"):
            rec["claims"].append(claim(sid, "snomed", "skos:closeMatch", None, "No SNOMED CT id found through this chain (FMA -> Wikidata -> Uberon xref).", "S", "same chain", "gap, not a claim of absence in SNOMED"))
        bp = bp_part.get(n)
        if bp:
            rec["bp3d"] = dict(representation=bp[0], name=bp[1], list=bp[2])
            rec["claims"].append(claim(sid, "bp3d", "x3d:hasOpenMesh", f"bp3d:{bp[0]}",
                f"BodyParts3D lists FMA:{n} as '{bp[1]}' (representation {bp[0]}, {bp[2]}): an open mesh exists for this class (not downloaded here).", "C", "BodyParts3D LATEST parts list (fetched this build)", "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html (CC BY 4.0)"))
    else:
        rec["claims"].append(claim(sid, "fma-term", "x3d:fmaClass", None,
            f"No FMA class found for '{it['label_in']}'." if it["label_in"] else f"No single FMA class: {it['note']}", "S", "EBI OLS4 exact-label search" if it["label_in"] else "builder judgement", "gap"))
        rec["denotes_grade"] = "S"
    # H-Anim
    hn = hanim_for(s) if it["scene"] == "torso" else None
    loose = HANIM_LOOSE.get(s)
    if hn and hn in HSEG:
        rec["hanim_segment"] = hn
        rec["claims"].append(claim(sid, "hanim", "x3d:hanimSegment", "hanim:" + hn,
            f"H-Anim segment name '{hn}' exists in the X3D 4.1 XSD enumeration, and this bone is that segment by name.", "C", "x3d_mcp x3d-4.1.xsd hanimSegmentNameValues (parsed this build)", "ISO/IEC 19774 via X3D 4.1 XSD"))
    elif loose and loose in HSEG:
        rec["hanim_segment"] = loose
        rec["claims"].append(claim(sid, "hanim", "x3d:hanimSegment", "hanim:" + loose,
            f"H-Anim segment '{loose}' exists, but it is the whole pelvis block, not only the hip bone.", "L", "x3d_mcp x3d-4.1.xsd (name exists)", "ISO/IEC 19774"))
    elif it["scene"] == "torso" and it["region"]["group"] in ("RIBCAGE", "SPINE", "LIMBGIRDLE", "SKULL"):
        rec["claims"].append(claim(sid, "hanim", "x3d:hanimSegment", None,
            "No H-Anim segment for this bone: the XSD list has vertebrae, skull, sacrum, pelvis, clavicle, scapula, arm and leg segments but no ribs, sternum or costal cartilage.", "C", "x3d_mcp x3d-4.1.xsd hanimSegmentNameValues (parsed this build)", "gap in H-Anim, checked"))
    # local geometry checks (torso)
    if it["scene"] == "torso":
        r = it["region"]
        side = "left" if s.endswith("_left") or "_left_" in s else ("right" if s.endswith("_right") or "_right_" in s else None)
        if side and r["centroid_mm"]:
            x = r["centroid_mm"][0]; ok = (x < 0) if side == "left" else (x > 0)
            rec["laterality_ok"] = ok
            rec["claims"].append(claim(sid, "laterality", "x3d:lateralityCheck", None,
                f"Named {side}; centroid x = {x} mm (scene convention: patient-right is +X). " + ("Consistent." if ok else "INCONSISTENT with the name."), "C" if ok else "S", "build.py check on torso_regions.json centroids", "data/structures.json"))
        if r["volume_ml"] is not None:
            vox = round(r["volume_ml"] / 0.027)
            rec["voxels_3mm"] = vox
            g = "S" if r["volume_ml"] < 5 else "L"
            rec["claims"].append(claim(sid, "volume", "x3d:volumeMl", str(r["volume_ml"]),
                f"Volume {r['volume_ml']} mL (about {vox} voxels of 27 mm3). " + ("Under 5 mL: one voxel is 0.027 mL and 3 mm sampling dominates the error." if g == "S" else "From the torso builder, not re-measured in this build."),
                g, "torso builder tools/build_torso_scene.py sha256 prefix 23cea36ce451fdc9 (earlier build)", "brain-torso-xite/v1/data/torso_regions.json"))
    if it["scene"] == "brain" or (it["scene"] == "torso" and it["region"]["source"].startswith("template")):
        rec["claims"].append(claim(sid, "illustrative", "x3d:status", None, "Template-brain geometry fitted into a head: ILLUSTRATIVE, not this subject's anatomy.", "S", "brain-torso-xite NOTICE (read)", "brain-torso-xite/v1/NOTICE-TORSO.md"))
    STR.append(rec)

# ---------------------------------------------------------------- scenes with injected metadata
def md(rec):
    def ms(name, v): return f'<MetadataString name={quoteattr(name)} value={quoteattr(chr(34) + str(v).replace(chr(34), chr(39)) + chr(34))}/>'
    out = [ms("grade", rec.get("denotes_grade", "S")), ms("claims", " ".join(rec["claims"]))]
    for k, nm in (("fma_id", "fma"), ("fma_label", "fma_label"), ("fma_iri", "fma_iri"), ("uberon", "uberon"), ("wikidata", "wikidata"), ("hanim_segment", "hanim")):
        if rec.get(k): out.append(ms(nm, rec[k]))
    if rec.get("snomed_ct"): out.append(ms("snomed_ct", ",".join(rec["snomed_ct"])))
    if rec.get("mesh"): out.append(ms("mesh", ",".join(rec["mesh"])))
    if rec.get("bp3d"): out.append(ms("bp3d", rec["bp3d"]["representation"]))
    if rec.get("fma_ancestors"): out.append(ms("fma_ancestors", "; ".join(rec["fma_ancestors"])))
    ref = rec.get("fma_iri") or ""
    return f"<MetadataSet name={quoteattr('provenance')} reference={quoteattr(ref)} containerField='metadata'>" + "".join(out) + "</MetadataSet>"

def inject(src, recs, title, desc):
    t = gzip.open(src).read().decode("utf8")
    n = 0
    t = t.replace('\'"tex/', '\'"../../../brain-torso-xite/v1/scenes/tex/')   # textures stay in the old folder, no copy
    for rec in recs:
        pat = re.compile(r"(<Shape DEF='" + re.escape(rec["id"]) + r"'>)")
        t, c = pat.subn(lambda m: m.group(1) + md(rec), t, count=1); n += c
    t = re.sub(r"<meta name='title' content='[^']*'/>", f"<meta name='title' content={quoteattr(title)}/>", t, count=1)
    t = t.replace("</head>", f"<meta name='description' content={quoteattr(desc)}/><meta name='generator' content='x3d.demo medical-provenance v2 build.py'/><meta name='source-scene-sha256' content='{sha(gzip.open(src).read())}'/></head>", 1)
    t = re.sub(r"(<meta name='description' content='[^']*'/>)(?=.*<meta name='description')", "", t, count=1, flags=re.S)
    return t, n

(HERE / "scene").mkdir(exist_ok=True)
tt, tn = inject(TORSO_X3DZ, [r for r in STR if r["scene"] == "torso"], "Torso CT with FMA provenance (medical-provenance v2)",
                "Torso CT scene of brain-torso-xite v1 with every organ shape carrying an FMA class, Uberon, SNOMED CT id, H-Anim segment and graded claims as MetadataSet. Educational PoC, not medical advice.")
bt, bn = inject(BRAIN_X3DZ, [r for r in STR if r["scene"] == "brain"], "Brain with FMA provenance (medical-provenance v2)",
                "Brain scene of brain-torso-xite v1 with the ten deep structures carrying FMA classes and graded claims. Template brain, educational PoC, not medical advice.")
for name, txt in (("torso-fma.x3d", tt), ("brain-fma.x3d", bt)):
    (HERE / "scene" / name).write_text(txt, encoding="utf8")
    with gzip.GzipFile(HERE / "scene" / (name + "z"), "wb", mtime=0) as g: g.write(txt.encode("utf8"))
print("injected: torso", tn, "of", sum(r["scene"] == "torso" for r in STR), " brain", bn, "of", sum(r["scene"] == "brain" for r in STR))

# ---------------------------------------------------------------- outputs
cnt = collections.Counter(c["grade"] for c in CL)
(HERE / "data").mkdir(exist_ok=True)
(HERE / "structures.json").write_text(json.dumps(STR, indent=1))
(HERE / "claims.json").write_text(json.dumps(CL, indent=1))
ctx = {"fma": "http://purl.org/sig/ont/fma/", "skos": "http://www.w3.org/2004/02/skos/core#", "prov": "http://www.w3.org/ns/prov#", "dct": "http://purl.org/dc/terms/", "x3d": "urn:x3d:vocab:"}
graph = []
for c in CL:
    graph.append({"@id": f"urn:x3d:medprov:{c['id']}", "@type": ["prov:Entity", "x3d:Claim"],
                  "x3d:subject": {"@id": f"urn:x3d:medprov:struct:{c['struct']}"},
                  "x3d:predicate": c["predicate"], "x3d:object": ({"@id": c["object"]} if c["object"] and str(c["object"]).startswith(("http", "hanim:", "bp3d:")) else c["object"]),
                  "rdfs:comment": c["statement"], "x3d:grade": {"@id": "urn:x3d:grade:" + c["grade"]},
                  "prov:wasGeneratedBy": c["instrument"], "dct:source": c["source"]})
ctx["rdfs"] = "http://www.w3.org/2000/01/rdf-schema#"
(HERE / "claims.jsonld").write_text(json.dumps({"@context": ctx, "@graph": graph}, indent=1))
(HERE / "data" / "ledger.json").write_text(json.dumps(LEDGER, indent=1))

fma_hit = sum(1 for r in STR if r.get("fma_id")); snm = sum(1 for r in STR if r.get("snomed_ct"))
summary = dict(structures=len(STR), torso=sum(r["scene"] == "torso" for r in STR), brain=sum(r["scene"] == "brain" for r in STR),
               fma_mapped=fma_hit, snomed=snm, uberon=sum(1 for r in STR if r.get("uberon")), hanim=sum(1 for r in STR if r.get("hanim_segment")),
               bp3d=sum(1 for r in STR if r.get("bp3d")), claims=len(CL), grades=dict(cnt), denotes_grades=dict(collections.Counter(r.get("denotes_grade") for r in STR)),
               laterality_checked=sum(1 for r in STR if "laterality_ok" in r), laterality_bad=[r["id"] for r in STR if r.get("laterality_ok") is False],
               unresolved_fma=unresolved, network_calls=len([l for l in LEDGER if not l["from_cache"]]), cache_reads=len([l for l in LEDGER if l["from_cache"]]),
               hanim_segment_names=len(HSEG), scene_sha256={n: sha((HERE / "scene" / n).read_bytes()) for n in ("torso-fma.x3d", "brain-fma.x3d")})
print(json.dumps(summary, indent=1))
(HERE / "data" / "summary.json").write_text(json.dumps(summary, indent=1))

if GATE:
    sys.path.insert(0, GATE)
    from validation.validate import validate_xml
    rcpt = {}
    for name in ("torso-fma.x3d", "brain-fma.x3d"):
        x = (HERE / "scene" / name).read_text(encoding="utf8"); t0 = time.time(); r = validate_xml(x)
        rcpt[name] = dict(sha256=sha(x.encode()), valid=r.get("valid"), errors=r.get("errors"), warnings=r.get("warnings"), seconds=round(time.time() - t0, 2))
        print(name, rcpt[name]["valid"], len(rcpt[name]["errors"] or []), "errors", rcpt[name]["seconds"], "s")
    base = {}
    for name, src in (("torso", TORSO_X3DZ), ("brain", BRAIN_X3DZ)):
        x = gzip.open(src).read().decode(); r = validate_xml(x); base[name] = dict(valid=r.get("valid"), errors=len(r.get("errors") or []))
    rcpt["baseline_source_scenes"] = base
    rcpt["validator"] = "x3d_mcp validate_xml, commit given in README"
    (HERE / "validation-v2.json").write_text(json.dumps(rcpt, indent=1))
