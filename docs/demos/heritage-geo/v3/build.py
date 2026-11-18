#!/usr/bin/env python3
"""heritage-geo v3 builder (stdlib only).
Writes giza-provenance-twin.x3d, burruss-geo.x3d, claims.json, claims.jsonld, data/findings.json, ifc-placement.json.
v3 (18 Nov 2026, external review defect 6): every grade shown anywhere (page, JSON-LD, README table) is generated
from ATOMIC records here; a finding that joins a measured number with an interpretation shows the weakest grade
of its parts (C > L > S), never the strongest. Background lost its groundAngle (one groundColor needs zero angles).
Inputs: data/pleiades-giza.json (Pleiades dump rows), data/elevation-reconcile.json (reconcile_elevation.py).
Run: python3 -I build.py [--gate PATH_TO_x3d_mcp/src]"""
import json, math, sys, hashlib, pathlib
from xml.sax.saxutils import quoteattr
HERE = pathlib.Path(__file__).resolve().parent
PL = json.loads((HERE/'data/pleiades-giza.json').read_text(encoding='utf8'))['places']

# Grades: C = run/read in this build, L = published and not re-opened here, S = suspected / proposal.
DIMS = {  # published dimensions, grade L (not re-measured)
 "khufu": ("Great Pyramid (Khufu)", 230.3, 138.5, "0.85 0.72 0.45"),
 "khafre": ("Pyramid of Khafre", 215.3, 143.5, "0.80 0.68 0.42"),
 "menkaure": ("Pyramid of Menkaure", 102.2, 65.5, "0.78 0.64 0.40"),
 "sphinx": ("Great Sphinx", 19.0, 20.0, "0.70 0.60 0.45")}
SITES = [dict(id=k, name=v[0], base=v[1], h=v[2], color=v[3], lat=PL[k]['lat'], lon=PL[k]['lon'], pid=PL[k]['pleiades_id']) for k, v in DIMS.items()]
CLAIMS = [  # id, site, CRM class, CRM path, statement, grade, source
 ("c1","khufu","E22_Human-Made_Object","P108i_was_produced_by -> E12_Production -> P4_has_time-span","Built in the 4th Dynasty, c. 2560 BCE.","L","Published chronology; not re-opened here"),
 ("c2","khufu","E22_Human-Made_Object","P14_carried_out_by -> E21_Person (Khufu)","Commissioned by Khufu.","L","Published consensus; not re-opened here"),
 ("c3","khufu","E27_Site","P168_place_is_defined_by; P87_is_identified_by Pleiades 704360201","Placed at the Pleiades representative point 29.97916 N, 31.13422 E.","C","Pleiades dump of 17 Nov 2026 read here (locationPrecision: precise); that the monument is there is L"),
 ("c4","khafre","E22_Human-Made_Object","P108i_was_produced_by -> E12_Production","Attributed to Khafre, son of Khufu.","L","Published consensus"),
 ("c5","sphinx","E22_Human-Made_Object","P14_carried_out_by -> E21_Person (Khafre?)","Sphinx attributed to Khafre's reign; the attribution is argued, not proven.","S","Contested literature; see GIZA-EVIDENCE-ATLAS GZ-1"),
 ("c6","menkaure","E22_Human-Made_Object","P43_has_dimension -> E54_Dimension","Base about 102 m, height about 65 m; drawn here as a schematic box-pyramid.","L","Published figures; geometry status is schematic (GZ-1)"),
 ("c7","khufu","E13_Attribute_Assignment","P140_assigned_attribute_to / P141_assigned","Each claim is an E13 Attribute Assignment carrying its grade, so the grade is queryable.","C","claims.jsonld built and parsed here"),
 ("c8","khafre","E27_Site","P168_place_is_defined_by; P87_is_identified_by Pleiades 866839043",
  "v1 placed Khafre 208 m from its Pleiades point (and Menkaure 64 m); v2 uses the Pleiades points.","C","Offsets computed in data/pleiades-giza.json; v1 coordinates were typed from memory, not read from a source"),
 ("c9","sphinx","E27_Site","P87_is_identified_by Pleiades 536839380","Sphinx point from Pleiades 536839380 (v1 differed by 4.3 m).","C","Pleiades dump read here")]

# Atomic records behind each page finding. One record = one claim with one grade and one instrument.
# A finding's displayed grade is composed here (weakest part), so the page cannot show C for an S interpretation.
ATOMS = [  # id, finding, statement, grade, instrument
 ("e1", "elevation", "Median of EPQS minus (617 + DSM) is +0.03 m over 140 points at 30 m spacing.", "C", "USGS EPQS 1 m, 18 Nov 2026; reconcile_elevation.py"),
 ("e2", "elevation", "Ground across the 400 x 300 m tile spans 619.8 to 632.9 m in EPQS, so 627.175 m is one point on the slope.", "C", "USGS EPQS 1 m, 18 Nov 2026"),
 ("e3", "elevation", "The tile centre (37.2284, -80.4234) and z-southward orientation are assumptions (correlation 0.51 vs -0.40).", "S", "reconcile_elevation.py fit; not surveyed"),
 ("e4", "elevation", "Therefore 627 vs 617 m is not a datum conflict: 617 m is the right reference for the DSM.", "S", "interpretation that rests on e1-e3"),
 ("p1", "pleiades", "v1 put Khafre 208 m and Menkaure 64 m from their Pleiades points (typed from memory); v2 and v3 use the Pleiades points.", "C", "Pleiades dump 17 Nov 2026"),
 ("i1", "ifc", "The confluence-ifc model.ifc has no site placement and no IfcMapConversion.", "C", "grep of model.ifc (2,030 lines)"),
 ("i2", "ifc", "The placement shown here is authored, not read from the file.", "S", "authored in build.py"),
]
FINDINGS = [  # id, headline
 ("elevation", "Elevation 627 vs 617 m: measured residual near zero; the 'not a datum conflict' reading depends on an assumed tile centre."),
 ("pleiades", "Correction: Khafre and Menkaure moved to their Pleiades points."),
 ("ifc", "IFC model carries no placement; the placement here is authored."),
]
ORDER = {"C": 0, "L": 1, "S": 2}

def weakest(grades): return max(grades, key=ORDER.__getitem__)

def findings():
    out = []
    for fid, head in FINDINGS:
        parts = [dict(id=a[0], statement=a[2], grade=a[3], instrument=a[4]) for a in ATOMS if a[1] == fid]
        out.append(dict(id=fid, headline=head, grade=weakest([x["grade"] for x in parts]),
                        grade_rule="weakest of its atomic parts (C > L > S)", parts=parts))
    return out

def pyramid(base, h):
    b = base/2
    return f"{-b} 0 {-b}  {b} 0 {-b}  {b} 0 {b}  {-b} 0 {b}  0 {h} 0", "0 1 2 3 -1  0 4 1 -1  1 4 2 -1  2 4 3 -1  3 4 0 -1"

def ms(name, val): return f'<MetadataString name="{name}" value={quoteattr(chr(34)+val+chr(34))}/>'

def meta_for(sid):
    out = []
    for cid, s, cls, prop, stmt, g, src in CLAIMS:
        if s != sid: continue
        out.append(f'     <MetadataSet name="{cid}" reference="http://www.cidoc-crm.org/cidoc-crm/{cls.split("_")[0]}">' +
                   ms("crm_class", cls) + ms("crm_path", prop) + ms("statement", stmt) + ms("grade", g) + ms("source", src) + '</MetadataSet>')
    return "\n".join(out)

HEAD = ['<?xml version="1.0" encoding="UTF-8"?>',
 '<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">']

def giza():
    s = HEAD + [' <head>', '  <component name="Geospatial" level="1"/>',
     '  <meta name="title" content="Giza provenance twin v3 (Pleiades-placed, atomic grades)"/>',
     '  <meta name="description" content="Four Giza monuments placed at Pleiades representative points; each CRM claim is a MetadataSet with a grade. Geometry is schematic."/>',
     '  <meta name="generator" content="x3d.demo heritage-geo v3 build.py"/>', ' </head>', ' <Scene>',
     '  <NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>',
     '  <Background skyColor="0.55 0.7 0.9 0.85 0.8 0.7" skyAngle="1.5" groundColor="0.7 0.6 0.4"/>',
     '  <DirectionalLight direction="-0.4 -1 -0.3" intensity="0.9"/>',
     '  <GeoViewpoint DEF="vp_giza" description="Giza overview" geoSystem=\'"GD" "WE"\' position="29.9640 31.1330 900" orientation="1 0 0 -0.62" centerOfRotation="29.9755 31.1325 60"/>']
    for st in SITES:
        pts, idx = pyramid(st["base"], st["h"])
        s += [f'  <GeoLocation DEF="gl_{st["id"]}" geoSystem=\'"GD" "WE"\' geoCoords="{st["lat"]:.7f} {st["lon"]:.7f} 60">',
              f'   <Transform DEF="t_{st["id"]}">',
              f'    <MetadataSet name="site" containerField="metadata">{ms("label", st["name"])}{ms("pleiades", "https://pleiades.stoa.org/places/"+st["pid"])}',
              meta_for(st["id"]), '    </MetadataSet>',
              f'    <Shape DEF="shape_{st["id"]}"><Appearance><Material diffuseColor="{st["color"]}"/></Appearance>',
              f'     <IndexedFaceSet coordIndex="{idx}" solid="false"><Coordinate point="{pts}"/></IndexedFaceSet></Shape>',
              f'    <TouchSensor DEF="ts_{st["id"]}" description={quoteattr(st["name"])}/>',
              '   </Transform>', '  </GeoLocation>']
    s += [' </Scene>', '</X3D>']
    return "\n".join(s) + "\n"

# --- UTM 17N (EPSG:32617) forward projection, WGS84, Krueger series (stdlib) ---
def utm(lat, lon, zone=17):
    a, f = 6378137.0, 1/298.257223563; k0 = 0.9996
    n = f/(2-f); A = a/(1+n)*(1+n**2/4+n**4/64)
    al = [n/2-2*n**2/3+5*n**3/16, 13*n**2/48-3*n**3/5, 61*n**3/240]
    e = math.sqrt(f*(2-f)); phi = math.radians(lat); lam = math.radians(lon-(zone*6-183))
    t = math.sinh(math.atanh(math.sin(phi))-e*math.atanh(e*math.sin(phi)))
    xi = math.atan2(t, math.cos(lam)); eta = math.atanh(math.sin(lam)/math.sqrt(1+t*t))
    x = eta + sum(al[j]*math.cos(2*(j+1)*xi)*math.sinh(2*(j+1)*eta) for j in range(3))
    y = xi + sum(al[j]*math.sin(2*(j+1)*xi)*math.cosh(2*(j+1)*eta) for j in range(3))
    return 500000+k0*A*x, k0*A*y

def burruss(rec):
    c = rec["assumed_centre"]; lat0, lon0 = c
    # IFC marker: 24 x 16 m slab footprint from IFCRECTANGLEPROFILEDEF(24000,16000) in confluence-ifc model.ifc
    east_off = 90.0  # m east of the Drillfield centre, a demo choice (S), not a real site
    lat = lat0; lon = lon0+east_off/(111320*math.cos(math.radians(lat0)))
    E, N = utm(lat, lon); E0, N0 = utm(lat0, lon0)
    ground = rec["ground_m"]  # reconciled DSM reference (617 m) used for the Drillfield GeoLocation
    import re
    t = (HERE.parent.parent/'gobbler-worlds-within/v1/data/worlds/drillfield/drillfield.x3d').read_text(encoding='utf8')
    hh = [float(v) for v in re.search(r"<ElevationGrid DEF='DSM'[^>]*height='([^']+)'", t).group(1).split()]
    site_h = ground + hh[150*401 + 200 + int(east_off)]   # DSM surface at the marker (m ASL)
    marker_h = site_h + 2.2                                # box centre so its base sits on that surface
    s = HEAD + [' <head>', '  <component name="Geospatial" level="1"/>',
     '  <meta name="title" content="Burruss Drillfield with reconciled elevation and an IFC footprint marker (heritage-geo v3)"/>',
     '  <meta name="attribution" content="Imagery and data: Google (Drillfield world, academic proof of concept only)"/>', ' </head>', ' <Scene>',
     '  <NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>',
     f'  <GeoViewpoint DEF="vp_burruss" description="Drillfield overview" geoSystem=\'"GD" "WE"\' position="{lat0} {lon0} {ground+400:.1f}" orientation="1 0 0 -1.5707963" centerOfRotation="{lat0} {lon0} {ground:.1f}"/>',
     f'  <GeoLocation DEF="gl_drillfield" geoSystem=\'"GD" "WE"\' geoCoords="{lat0} {lon0} {ground:.3f}">',
     '   <Transform DEF="t_drillfield"><Inline DEF="drillfield" url=\'"../../gobbler-worlds-within/v1/data/worlds/drillfield/drillfield.x3d"\'/></Transform>',
     '  </GeoLocation>',
     f'  <GeoLocation DEF="gl_ifc_marker" geoSystem=\'"GD" "WE"\' geoCoords="{lat:.8f} {lon:.8f} {marker_h:.3f}">',
     '   <Transform DEF="t_ifc">',
     f'    <MetadataSet name="ifc_placement" containerField="metadata">{ms("label","Illustrative marker: footprint of the Confluence IFC gallery pavilion, not Burruss Hall and not a real site")}{ms("ifc_source","docs/demos/confluence-ifc/v1/snapshot/model.ifc sha256 32dc72111d14d91964ba523f8f04ef65e0b6909fd161d5e068ab0cfb5ceef0fb")}{ms("ifc_project_globalid","0mF5c0HZTIqPqOOn9j7JEG")}{ms("crs","EPSG:32617 UTM 17N (proposed IfcProjectedCRS)")}{ms("eastings_m",f"{E:.3f}")}{ms("northings_m",f"{N:.3f}")}{ms("orthogonal_height_m",f"{site_h:.3f}")}{ms("grade","S: placement is authored here; the IFC file carries no IfcMapConversion")}</MetadataSet>',
     '    <Shape><Appearance><Material diffuseColor="0.85 0.35 0.25" transparency="0.35"/></Appearance><Box size="24 4.4 16"/></Shape>',
     '   </Transform>', '  </GeoLocation>', ' </Scene>', '</X3D>']
    placement = dict(
        note="Authored placement, grade S. confluence-ifc/v1/snapshot/model.ifc has IFCSITE with every placement and lat/lon field null and no IFCMAPCONVERSION or IFCPROJECTEDCRS (grep, 2,030 lines).",
        ifc_units="IFCSIUNIT LENGTHUNIT MILLI METRE (model coordinates are millimetres)",
        footprint_mm=[24000, 16000], height_m_approx=4.4,
        ifcmapconversion_proposed=dict(SourceCRS="IfcGeometricRepresentationContext 'Model'", TargetCRS="IfcProjectedCRS EPSG:32617 (WGS84 / UTM 17N)",
            Eastings=round(E, 3), Northings=round(N, 3), OrthogonalHeight=round(site_h, 3), XAxisAbscissa=1.0, XAxisOrdinate=0.0, Scale=0.001,
            Scale_note="0.001 because the model is in millimetres and the target CRS is in metres"),
        x3d_geolocation=dict(geoSystem=["GD","WE"], geoCoords=[round(lat, 8), round(lon, 8), round(marker_h, 3)], site_surface_m=round(site_h, 3), site_surface_source='Drillfield DSM at the marker (surface incl. objects), 617 m reference'),
        drillfield_centre_utm=[round(E0, 3), round(N0, 3)],
        projection="UTM 17N forward Krueger series, stdlib, WGS84; accuracy not checked against PROJ (pyproj not installed here)")
    return "\n".join(s) + "\n", placement

def jsonld():
    g = [{"@id": f"urn:x3d:heritage-geo:{c[0]}", "@type": "crm:E13_Attribute_Assignment",
          "crm:P140_assigned_attribute_to": {"@id": f"urn:x3d:heritage-geo:site:{c[1]}"},
          "crm:P87_is_identified_by": ({"@id": "https://pleiades.stoa.org/places/"+PL[c[1]]['pleiades_id']}),
          "crm:P141_assigned": c[4], "crm:P2_has_type": {"@id": f"urn:x3d:grade:{c[5]}"}, "dct:source": c[6],
          "x3d:crmClass": c[2], "x3d:crmPath": c[3]} for c in CLAIMS]
    for f in findings():
        for a in f["parts"]:
            g.append({"@id": f"urn:x3d:heritage-geo:finding:{f['id']}:{a['id']}", "@type": "crm:E13_Attribute_Assignment",
                      "crm:P141_assigned": a["statement"], "crm:P2_has_type": {"@id": f"urn:x3d:grade:{a['grade']}"},
                      "dct:source": a["instrument"], "x3d:finding": f["id"]})
        g.append({"@id": f"urn:x3d:heritage-geo:finding:{f['id']}", "@type": "crm:E13_Attribute_Assignment",
                  "crm:P141_assigned": f["headline"], "crm:P2_has_type": {"@id": f"urn:x3d:grade:{f['grade']}"},
                  "x3d:gradeRule": f["grade_rule"], "x3d:hasPart": [{"@id": f"urn:x3d:heritage-geo:finding:{f['id']}:{a['id']}"} for a in f["parts"]]})
    return {"@context": {"crm": "http://www.cidoc-crm.org/cidoc-crm/", "dct": "http://purl.org/dc/terms/", "x3d": "urn:x3d:vocab:"}, "@graph": g}

def main():
    rec = json.loads((HERE/'data/elevation-reconcile.json').read_text())
    gz = giza(); (HERE/'giza-provenance-twin.x3d').write_text(gz, encoding='utf8')
    bx, pl = burruss(rec); (HERE/'burruss-geo.x3d').write_text(bx, encoding='utf8')
    (HERE/'ifc-placement.json').write_text(json.dumps(pl, indent=1))
    (HERE/'claims.jsonld').write_text(json.dumps(jsonld(), indent=1), encoding='utf8')
    (HERE/'claims.json').write_text(json.dumps([dict(id=c[0], site=c[1], crm_class=c[2], crm_path=c[3], statement=c[4], grade=c[5], source=c[6]) for c in CLAIMS], indent=1), encoding='utf8')
    hs = {n: hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ('giza-provenance-twin.x3d', 'burruss-geo.x3d')}
    print(hs)
    (HERE/'data/findings.json').write_text(json.dumps(findings(), indent=1), encoding='utf8')
    rd = (HERE/'README.md').read_text(encoding='utf8'); a, b = '<!-- findings:begin -->', '<!-- findings:end -->'
    rows = ['| Finding | Part | Grade | Instrument |', '|---|---|---|---|']
    for f in findings():
        rows.append(f"| **{f['id']}** | {f['headline']} | **{f['grade']}** (weakest part) | |")
        rows += [f"| | {x['statement']} | {x['grade']} | {x['instrument']} |" for x in f['parts']]
    (HERE/'README.md').write_text(rd[:rd.index(a)+len(a)] + "\n" + "\n".join(rows) + "\n" + rd[rd.index(b):], encoding='utf8')
    if "--gate" in sys.argv:  # v3: the shared tool derives the validator identity and fails on XSD or semantic errors
        import subprocess
        mcp = pathlib.Path(sys.argv[sys.argv.index("--gate")+1]).resolve()
        mcp = mcp.parent if mcp.name == "src" else mcp
        tool = HERE.parents[3] / "tools/assurance/validate_scenes.py"
        r = subprocess.run([sys.executable, "-I", str(tool), str(HERE), "--x3d-mcp", str(mcp), "--glob", "*.x3d",
                            "--expect", "2", "--semantic", "--out", "validation-v3.json", "--force"])
        sys.exit(r.returncode)
if __name__ == "__main__": main()
