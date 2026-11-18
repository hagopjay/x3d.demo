#!/usr/bin/env python3
"""Build giza-lodge.x3d: partial Giza rendition for the Masonic Lodge XR overlay.
Metres, y up, x east, z south. Origin = centre of Great Pyramid base.
Dimensions: Wikipedia 'Great Pyramid of Giza' / 'Pyramid of Khafre' / 'Pyramid of Menkaure'
(original height 146.6 m, base 230.34 m; Khafre 215.25 m / 143.5 m orig; Menkaure 102.2 m / 65.5 m).
Interior positions are SCHEMATIC (Likely, not surveyed here)."""
import sys
def pyr(name, cx, cz, base, h, faces, color, tr=0.0):
    b=base/2; v=[(-b,0,-b),(b,0,-b),(b,0,b),(-b,0,b),(0,h,0)]
    # faces: N=(0,1,4) E=(1,2,4) S=(2,3,4) W=(3,0,4)
    idx={'N':(0,1,4),'E':(1,2,4),'S':(2,3,4),'W':(3,0,4)}
    ci=" ".join("%d %d %d -1"%idx[f] for f in faces)
    pts=" ".join("%.2f %.2f %.2f"%p for p in v)
    return f"""<Transform DEF='{name}' translation='{cx} 0 {cz}'><Shape><Appearance><Material diffuseColor='{color}' transparency='{tr}'/></Appearance><IndexedFaceSet solid='false' coordIndex='{ci}'><Coordinate point='{pts}'/></IndexedFaceSet></Shape></Transform>"""
def box(name, t, s, color, rot='0 0 1 0', tr=0.0, emissive='0 0 0'):
    return f"""<Transform DEF='{name}' translation='{t}' rotation='{rot}'><Shape><Appearance><Material diffuseColor='{color}' emissiveColor='{emissive}' transparency='{tr}'/></Appearance><Box size='{s}'/></Shape></Transform>"""
import math
VP='<NavigationInfo type=\'"EXAMINE" "ANY"\' headlight=\'true\' speed=\'60\'/><Viewpoint DEF=\'VP_OVERVIEW\' description=\'Overview from the south-east\' position=\'330 190 640\' orientation=\'-0.3162 0.9487 0 0.4850\' fieldOfView=\'0.9\'/><Background skyColor=\'0.45 0.62 0.85\' groundColor=\'0.45 0.40 0.30\'/>'
a=math.radians(26.17)
out=["<?xml version='1.0' encoding='UTF-8'?>",
"<X3D profile='Interchange' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>",
"<head><meta name='title' content='Giza partial rendition for Masonic Lodge XR'/><meta name='description' content='Cutaway Great Pyramid (south face removed) with schematic King and Queen chambers, Grand Gallery and descending passage, plus Khafre and Menkaure shells. Metres, y up. Interior positions are schematic.'/><meta name='creator' content='HagopJay and Claude'/><meta name='generator' content='tools/build_giza.py'/><meta name='license' content='CC0 (geometry)'/><meta name='sources' content='Wikipedia Great Pyramid of Giza, Pyramid of Khafre, Pyramid of Menkaure (dimensions); interior schematic'/></head>",
"<Scene>",VP,"<Group DEF='GIZA'>",
pyr('KHUFU',0,0,230.34,146.6,'NEW','0.85 0.72 0.45',0.0),
pyr('KHAFRE',-340,-370*0.0+ -420,215.25,143.5,'NESW','0.80 0.68 0.42'),
pyr('MENKAURE',-640,-780,102.2,65.5,'NESW','0.78 0.66 0.40'),
# King's chamber 10.47 x 5.23 x 5.82 at ~43 m up, slightly south of axis
box('KINGS_CHAMBER','0 43 -4','10.47 5.82 5.23','0.95 0.90 0.80',emissive='0.25 0.18 0.05'),
box('QUEENS_CHAMBER','0 21 0','5.75 6.26 5.23','0.92 0.82 0.70',emissive='0.20 0.12 0.05'),
# Grand Gallery 47 m long, 8.6 m high, 26.17 deg, rising north from ~ y=20 to y=43
box('GRAND_GALLERY','0 31.5 -14','2.1 8.6 47','0.90 0.85 0.75',rot=f'1 0 0 {-a:.4f}',emissive='0.15 0.10 0.04'),
box('DESCENDING_PASSAGE','0 -20 -28','1.2 1.1 105','0.70 0.60 0.45',rot=f'1 0 0 {a:.4f}'),
box('SUBTERRANEAN_CHAMBER','0 -30 -1','14 5 8','0.55 0.45 0.35'),
box('GROUND_PLATE','0 -0.05 0','900 0.1 1500','0.55 0.50 0.40',tr=0.35),
"</Group></Scene></X3D>"]
open(sys.argv[1] if len(sys.argv)>1 else 'giza-lodge.x3d','w').write("\n".join(out)+"\n")
