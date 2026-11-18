#!/usr/bin/env python3
"""Builds giza-provenance-twin.x3d, claims.jsonld and data/crm-x3d-map.json from CLAIMS below.
Run: python3 -I build.py   (stdlib only; validate with x3d_mcp: python3 build.py --gate PATH_TO_x3d_mcp/src)"""
import json, sys, hashlib, pathlib
from xml.sax.saxutils import quoteattr
HERE = pathlib.Path(__file__).resolve().parent

# Grades: C Confirmed (run/read in this build), L Likely (published, not re-opened here), S Suspected/contested.
# Coordinates and dimensions are widely published figures NOT re-measured here: grade L.
SITES = [
 dict(id="khufu",   name="Great Pyramid (Khufu)",  lat=29.9792, lon=31.1342, base=230.3, h=138.5, color="0.85 0.72 0.45"),
 dict(id="khafre",  name="Pyramid of Khafre",      lat=29.9753, lon=31.1308, base=215.3, h=143.5, color="0.80 0.68 0.42"),
 dict(id="menkaure",name="Pyramid of Menkaure",    lat=29.9725, lon=31.1283, base=102.2, h=65.5,  color="0.78 0.64 0.40"),
 dict(id="sphinx",  name="Great Sphinx",           lat=29.9753, lon=31.1376, base=19.0,  h=20.0,  color="0.70 0.60 0.45"),
]
# claim = (id, subject site, CRM class, CRM property chain, statement, grade, source/instrument)
CLAIMS = [
 ("c1","khufu","E22_Human-Made_Object","P108i_was_produced_by -> E12_Production -> P4_has_time-span",
  "Built in the 4th Dynasty, c. 2560 BCE (E12 Production, E52 Time-Span).","L","Published chronology; not re-opened in this build"),
 ("c2","khufu","E22_Human-Made_Object","P14_carried_out_by -> E21_Person (Khufu)",
  "Commissioned by Khufu.","L","Published consensus; not re-opened here"),
 ("c3","khufu","E27_Site","P168_place_is_defined_by (GeoLocation 29.9792 N 31.1342 E)",
  "Position in WGS84 as placed by GeoLocation.","L","Public coordinates; not surveyed here"),
 ("c4","khafre","E22_Human-Made_Object","P108i_was_produced_by -> E12_Production",
  "Attributed to Khafre, son of Khufu.","L","Published consensus"),
 ("c5","sphinx","E22_Human-Made_Object","P14_carried_out_by -> E21_Person (Khafre?)",
  "Sphinx attributed to Khafre's reign; the attribution is argued, not proven.","S","Contested literature; see GIZA-EVIDENCE-ATLAS GZ-1"),
 ("c6","menkaure","E22_Human-Made_Object","P43_has_dimension -> E54_Dimension",
  "Base about 102 m, height about 65 m.","L","Published figures; the geometry here is a schematic box-pyramid (GZ-1: geometry status != evidence tier)"),
 ("c7","khufu","E13_Attribute_Assignment","P140_assigned_attribute_to / P141_assigned",
  "This twin: each claim above is an E13 Attribute Assignment carrying its grade, so the grade is queryable.","C","jsonld built and parsed in this build (see receipt)"),
]
TERRAIN_NOTE = "Terrain is flat at a 60 m placeholder: grade S, no DEM was fetched for Egypt in this build."
BURRUSS = dict(id="burruss", name="Burruss Hall (stub)", lat=37.2284, lon=-80.4234, elev=627.175)

def pyramid(base,h):
    b=base/2
    pts=f"{-b} 0 {-b}  {b} 0 {-b}  {b} 0 {b}  {-b} 0 {b}  0 {h} 0"
    return pts, "0 1 2 3 -1  0 4 1 -1  1 4 2 -1  2 4 3 -1  3 4 0 -1"

def meta_for(site_id):
    out=[]
    for cid,sid,cls,prop,stmt,g,src in CLAIMS:
        if sid!=site_id: continue
        out.append(f'''          <MetadataSet name={quoteattr(cid)} reference="http://www.cidoc-crm.org/cidoc-crm/{cls.split('_')[0]}">
            <MetadataString name="crm_class" value={quoteattr(f'"{cls}"')}/>
            <MetadataString name="crm_path" value={quoteattr(f'"{prop}"')}/>
            <MetadataString name="statement" value={quoteattr(f'"{stmt}"')}/>
            <MetadataString name="grade" value={quoteattr(f'"{g}"')}/>
            <MetadataString name="source" value={quoteattr(f'"{src}"')}/>
          </MetadataSet>''')
    return "\n".join(out)

def build_x3d():
    s=['<?xml version="1.0" encoding="UTF-8"?>',
       '<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">',
       ' <head>',
       '  <component name="Geospatial" level="1"/>',
       '  <meta name="title" content="Giza provenance twin (heritage + geospatial Loom demo, v1)"/>',
       '  <meta name="description" content="Four Giza monuments placed with GeoLocation; every CRM claim is a MetadataSet carrying a Confirmed/Likely/Suspected grade. Geometry is schematic."/>',
       '  <meta name="generator" content="x3d.demo heritage-geo v1 build.py"/>',
       ' </head>',' <Scene>',
       '  <GeoMetadata DEF="geo" summary="&quot;WGS84 GD, lat lon degrees; placeholder ground 60 m; Burruss stub elevation from USGS EPQS 1 m&quot;"/>',
       '  <NavigationInfo type=\'"EXAMINE" "ANY"\' headlight="true"/>',
       '  <Background skyColor="0.55 0.7 0.9 0.85 0.8 0.7" skyAngle="1.5" groundColor="0.7 0.6 0.4" groundAngle="0"/>',
       '  <DirectionalLight direction="-0.4 -1 -0.3" intensity="0.9"/>',
       '  <GeoViewpoint DEF="vp_giza" description="Giza overview" geoSystem=\'"GD" "WE"\' position="29.9640 31.1330 900" orientation="1 0 0 -0.62" centerOfRotation="29.9755 31.1325 60"/>',
       '  <GeoViewpoint DEF="vp_burruss" description="Burruss stub" geoSystem=\'"GD" "WE"\' position="37.2200 -80.4234 900" orientation="1 0 0 -0.9" centerOfRotation="37.2284 -80.4234 627"/>']
    for st in SITES:
        pts,idx=pyramid(st["base"],st["h"])
        s+=[f'  <GeoLocation DEF="gl_{st["id"]}" geoSystem=\'"GD" "WE"\' geoCoords="{st["lat"]} {st["lon"]} 60">',
            f'   <Transform DEF="t_{st["id"]}">',
            f'    <MetadataSet name="site" containerField="metadata"><MetadataString name="label" value={quoteattr(chr(34)+st["name"]+chr(34))}/>',
            meta_for(st["id"]),'    </MetadataSet>',
            f'    <Shape DEF="shape_{st["id"]}"><Appearance><Material diffuseColor="{st["color"]}"/></Appearance>',
            f'     <IndexedFaceSet coordIndex="{idx}" solid="false"><Coordinate point="{pts}"/>',
            f'     </IndexedFaceSet></Shape>',
            f'    <TouchSensor DEF="ts_{st["id"]}" description={quoteattr(st["name"])}/>',
            '   </Transform>','  </GeoLocation>']
    b=BURRUSS
    s+=[f'  <GeoLocation DEF="gl_burruss" geoSystem=\'"GD" "WE"\' geoCoords="{b["lat"]} {b["lon"]} {b["elev"]}">',
        '   <MetadataSet name="stub" containerField="metadata"><MetadataString name="note" value=\'"Placeholder box, not the building. Elevation 627.175 m from USGS EPQS 1 m (rasterId 58593). IFC to X3D is the next step; see MAPPING.md"\'/></MetadataSet>',
        '   <Shape><Appearance><Material diffuseColor="0.5 0.2 0.2" transparency="0.4"/></Appearance><Box size="60 30 40"/></Shape>',
        '  </GeoLocation>',' </Scene>','</X3D>']
    return "\n".join(s)+"\n"

def build_jsonld():
    g=[]
    for cid,sid,cls,prop,stmt,gr,src in CLAIMS:
        g.append({"@id":f"urn:x3d:heritage-geo:{cid}","@type":"crm:E13_Attribute_Assignment",
                  "crm:P140_assigned_attribute_to":{"@id":f"urn:x3d:heritage-geo:site:{sid}"},
                  "crm:P141_assigned":stmt,"crm:P2_has_type":{"@id":f"urn:x3d:grade:{gr}"},
                  "dct:source":src,"x3d:crmClass":cls,"x3d:crmPath":prop})
    return {"@context":{"crm":"http://www.cidoc-crm.org/cidoc-crm/","dct":"http://purl.org/dc/terms/","x3d":"urn:x3d:vocab:"},"@graph":g}

def main():
    x=build_x3d(); (HERE/"giza-provenance-twin.x3d").write_text(x,encoding="utf8")
    (HERE/"claims.jsonld").write_text(json.dumps(build_jsonld(),indent=1),encoding="utf8")
    (HERE/"claims.json").write_text(json.dumps([dict(id=c[0],site=c[1],crm_class=c[2],crm_path=c[3],statement=c[4],grade=c[5],source=c[6]) for c in CLAIMS],indent=1),encoding="utf8")
    h=hashlib.sha256(x.encode()).hexdigest(); print("x3d bytes",len(x.encode()),"sha256",h)
    if "--gate" in sys.argv:
        src=sys.argv[sys.argv.index("--gate")+1]; sys.path.insert(0,src)
        from validation.validate import validate_xml
        r=validate_xml(x); print(json.dumps({k:r[k] for k in r if k in("valid","errors","warnings")},indent=1)[:1500])
        (HERE/"validation-v1.json").write_text(json.dumps({"scene_sha256":h,"valid":r.get("valid"),"errors":r.get("errors"),"warnings":r.get("warnings"),"validator":"x3d_mcp fa5dccf validate_xml"},indent=1))
if __name__=="__main__": main()
