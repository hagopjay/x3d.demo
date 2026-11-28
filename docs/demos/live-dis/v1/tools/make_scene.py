#!/usr/bin/env python3
"""Writes scene/live-dis.x3d and the three model files. Run from the demo folder: python3 tools/make_scene.py
The scene is plain X3D 4.0 with the DIS component. Scene axes: x east, y up, z south, metres.
Models are drawn nose along +x, top along +y, right side along +z, and enlarged 12 times so that they can be seen
from four kilometres away."""
import math, os

HEAD = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Immersive' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
  <head>
%s    <meta name='title' content='%s'/>
    <meta name='description' content='%s'/>
    <meta name='license' content='MIT'/>
  </head>
  <Scene>
%s  </Scene>
</X3D>
'''

def mat(color, emissive=None, transparency=None):
    s = "<Appearance><Material diffuseColor='%s'" % color
    if emissive: s += " emissiveColor='%s'" % emissive
    if transparency: s += " transparency='%s'" % transparency
    return s + "/></Appearance>"

def box(size, color, at='0 0 0'):
    return "<Transform translation='%s'><Shape><Box size='%s'/>%s</Shape></Transform>" % (at, size, mat(color))

ALONG_X = "0 0 1 -1.5708"   # turns the +y axis of a Cylinder or Cone onto +x

AIRCRAFT = "\n".join([
    "<Transform rotation='%s'><Shape><Cylinder radius='1' height='12'/>%s</Shape></Transform>" % (ALONG_X, mat('0.82 0.84 0.88')),
    "<Transform translation='7.5 0 0' rotation='%s'><Shape><Cone bottomRadius='1' height='3'/>%s</Shape></Transform>" % (ALONG_X, mat('0.9 0.35 0.2')),
    box('3 0.25 15', '0.82 0.84 0.88', '0.5 0 0'), box('1.6 0.2 5.5', '0.82 0.84 0.88', '-5.2 0 0'), box('2 2.6 0.2', '0.9 0.35 0.2', '-5.2 1.4 0'),
])
ROVER = "\n".join([
    box('7 1.6 3.6', '0.42 0.5 0.3', '0 0.9 0'),
    "<Transform DEF='TURRET' translation='0 1.9 0'>" + box('3 1 2.6', '0.5 0.58 0.36', '0 0.4 0') +
    "<Transform DEF='GUN' translation='1.2 0.5 0'><Transform translation='2.4 0 0' rotation='%s'><Shape><Cylinder radius='0.18' height='4.8'/>%s</Shape></Transform></Transform></Transform>" % (ALONG_X, mat('0.2 0.22 0.18')),
])
SHIP = "\n".join([
    box('30 3 6', '0.5 0.53 0.58', '0 1 0'), box('8 3.5 4.4', '0.86 0.86 0.84', '-3 4.2 0'), box('1 5 1', '0.3 0.3 0.32', '-3 8 0'),
    "<Transform translation='16.5 1 0' rotation='%s'><Shape><Cone bottomRadius='3' height='4'/>%s</Shape></Transform>" % (ALONG_X, mat('0.5 0.53 0.58')),
])
HELICOPTER = "\n".join([
    "<Transform scale='1.6 1 1'><Shape><Sphere radius='2'/>%s</Shape></Transform>" % mat('0.85 0.7 0.2'),
    box('7 0.5 0.5', '0.85 0.7 0.2', '-5.5 0.4 0'), box('0.3 1.8 1.2', '0.2 0.2 0.22', '-8.8 1 0'),
    "<Transform translation='0 2.4 0'><Shape><Cylinder radius='6' height='0.12'/>%s</Shape></Transform>" % mat('0.6 0.6 0.62', transparency='0.6'),
])
UNKNOWN = "<Shape><Sphere radius='2.5'/>%s</Shape>" % mat('0.9 0.2 0.8')
BUOY = "\n".join([
    "<Transform translation='0 1 0'><Shape><Cylinder radius='1.6' height='2'/>%s</Shape></Transform>" % mat('0.95 0.75 0.1'),
    "<Transform translation='0 4 0'><Shape><Cylinder radius='0.15' height='4'/>%s</Shape></Transform>" % mat('0.2 0.2 0.2'),
    "<Transform translation='0 6.3 0'><Shape><Sphere radius='0.5'/>%s</Shape></Transform>" % mat('1 0.2 0.1', emissive='0.8 0.1 0.05'),
])

def ring(radius, color, transparency):
    return "<Shape><Sphere radius='%s'/><Appearance><Material diffuseColor='0 0 0' emissiveColor='%s' transparency='%s'/></Appearance></Shape>" % (radius, color, transparency)

def racetrack_points(L=2000.0, R=600.0, h=600.0, n=24):
    pts = [(R, -L/2), (R, L/2)]
    pts += [(R*math.cos(math.pi*i/n), L/2 + R*math.sin(math.pi*i/n)) for i in range(1, n+1)]
    pts += [(-R, -L/2)]
    pts += [(-R*math.cos(math.pi*i/n), -L/2 - R*math.sin(math.pi*i/n)) for i in range(1, n+1)]
    return " ".join("%.1f %.1f %.1f" % (e, h, -nn) for e, nn in pts), len(pts)

def circle_points(ce, cn, r, h, n=48):
    return " ".join("%.1f %.1f %.1f" % (ce + r*math.sin(2*math.pi*i/n), h, -(cn + r*math.cos(2*math.pi*i/n))) for i in range(n+1)), n+1

def line(points, count, color):
    return "<Shape><IndexedLineSet coordIndex='%s -1'><Coordinate point='%s'/></IndexedLineSet><Appearance><Material emissiveColor='%s'/></Appearance></Shape>" % (" ".join(str(i) for i in range(count)), points, color)

def ghost(n):
    return "<Transform DEF='GHOST_%d' translation='0 -500 0'><Shape><Sphere radius='30'/><Appearance><Material diffuseColor='0 0 0' emissiveColor='1 0.85 0.2' transparency='0.55'/></Appearance></Shape></Transform>" % n

def main():
    rt, rtn = racetrack_points()
    rv, rvn = circle_points(-1400, -600, 250, 7)
    sh, shn = circle_points(1500, -500, 900, 1)
    DIS = "address='239.1.2.3' port='3000' siteID='1' applicationID='1'"
    scene = f'''    <WorldInfo title='Live DIS' info='"Every entity here is moved by IEEE 1278.1 PDUs." "All PDUs are generated; none is a recording."'/>
    <NavigationInfo type='"EXAMINE" "ANY"' speed='200' visibilityLimit='30000'/>
    <Background skyColor='0.05 0.09 0.18 0.25 0.4 0.6 0.62 0.74 0.86' skyAngle='1.2 1.5708' groundColor='0.02 0.08 0.14'/>
    <Viewpoint DEF='VP_OVERVIEW' description='Overview' position='-200 2900 4700' orientation='1 0 0 -0.56' centerOfRotation='0 0 0' fieldOfView='0.7'/>
    <Viewpoint DEF='VP_TOP' description='From above' position='0 7500 0' orientation='1 0 0 -1.5708' centerOfRotation='0 0 0' fieldOfView='0.7'/>
    <Viewpoint DEF='VP_ISLAND' description='Island and rover' position='-1400 500 1700' orientation='1 0 0 -0.42' centerOfRotation='-1400 0 600' fieldOfView='0.7'/>
    <DirectionalLight direction='-0.4 -1 -0.5' intensity='0.9' ambientIntensity='0.5'/>

    <!-- sea, island, and the planned paths of the scripted exercise -->
    <Transform translation='0 -1 0'><Shape><Box size='9000 2 9000'/><Appearance><Material diffuseColor='0.06 0.25 0.42' specularColor='0.2 0.2 0.2'/></Appearance></Shape></Transform>
    <Transform translation='-1400 3 600'><Shape><Cylinder radius='520' height='6'/><Appearance><Material diffuseColor='0.55 0.5 0.34'/></Appearance></Shape></Transform>
    {line(rt, rtn, '0.55 0.75 1')}
    {line(rv, rvn, '0.75 0.9 0.5')}
    {line(sh, shn, '0.7 0.8 0.9')}

    <!-- DISEntityManager: entities that no EspduTransform below claims are created here, with a model chosen by type -->
    <DISEntityManager DEF='MGR' {DIS}>
      <MetadataSet name='LiveDIS' containerField='metadata'>
        <MetadataDouble name='localOriginLatLonHeight' value='36.6 -122.5 0' containerField='value'/>
        <MetadataString name='note' value='"Origin of the local frame, WGS 84 degrees and metres. Scene axes: x east, y up, z south."' containerField='value'/>
      </MetadataSet>
      <DISEntityTypeMapping DEF='MAP_SHIP' kind='1' domain='3' url='"models/ship.x3d"' description='any surface platform'/>
      <DISEntityTypeMapping DEF='MAP_HELICOPTER' kind='1' domain='2' category='21' url='"models/helicopter.x3d"' description='air platform, category 21'/>
      <DISEntityTypeMapping DEF='MAP_ANY' url='"models/unknown.x3d"' description='anything else'/>
    </DISEntityManager>
    <Group DEF='ENTITIES'/>
    <ROUTE fromNode='MGR' fromField='addedEntities' toNode='ENTITIES' toField='addChildren'/>
    <ROUTE fromNode='MGR' fromField='removedEntities' toNode='ENTITIES' toField='removeChildren'/>

    <!-- EspduTransform, reading: the aircraft. Its radio state picks one child of a Switch. -->
    <EspduTransform DEF='AIRCRAFT' networkMode='networkReader' {DIS} entityID='1' scale='12 12 12' description='KITE 01'>
      {AIRCRAFT}
      <Switch DEF='TX_SWITCH' whichChoice='0'>
        <Group/>
        {ring(4, '0.2 0.6 1', '0.8')}
        {ring(11, '1 0.3 0.2', '0.65')}
      </Switch>
    </EspduTransform>
    <TransmitterPdu DEF='TX' networkMode='networkReader' {DIS} entityID='1' radioID='1' description='radio 1 of KITE 01'/>
    <SignalPdu DEF='SIG' networkMode='networkReader' {DIS} entityID='1' radioID='1' description='what radio 1 of KITE 01 sends'/>
    <ROUTE fromNode='TX' fromField='transmitState' toNode='TX_SWITCH' toField='whichChoice'/>

    <!-- EspduTransform, reading: the rover. Two articulated parts turn its turret and raise its gun through a Script. -->
    <EspduTransform DEF='ROVER' networkMode='networkReader' {DIS} entityID='2' scale='12 12 12' description='ROVER 02'>
      {ROVER}
      <Transform translation='-2.5 3.6 0'>
        <Switch DEF='RX_SWITCH' whichChoice='0'>
          <Group/>
          <Shape><Sphere radius='0.5'/><Appearance><Material diffuseColor='0.1 0.2 0.1' emissiveColor='0.05 0.25 0.05'/></Appearance></Shape>
          <Shape><Sphere radius='1.1'/><Appearance><Material diffuseColor='0.1 0.4 0.1' emissiveColor='0.3 1 0.3'/></Appearance></Shape>
        </Switch>
      </Transform>
    </EspduTransform>
    <ReceiverPdu DEF='RX' networkMode='networkReader' {DIS} entityID='2' radioID='1' description='radio 1 of ROVER 02'/>
    <ROUTE fromNode='RX' fromField='receiverState' toNode='RX_SWITCH' toField='whichChoice'/>
    <Script DEF='PARTS' directOutput='false' mustEvaluate='false'>
      <field name='set_azimuth' type='SFFloat' accessType='inputOnly'/>
      <field name='set_elevation' type='SFFloat' accessType='inputOnly'/>
      <field name='turret_changed' type='SFRotation' accessType='outputOnly'/>
      <field name='gun_changed' type='SFRotation' accessType='outputOnly'/>
      <![CDATA[ecmascript:
// DIS body axes are x forward, y right, z down; the model is x forward, y up, z right.
// Azimuth turns about body z, which is the model's -y. Elevation turns about body y, which is the model's +z.
function set_azimuth (value) {{ turret_changed = new SFRotation (0, -1, 0, value); }}
function set_elevation (value) {{ gun_changed = new SFRotation (0, 0, 1, value); }}
]]>
    </Script>
    <ROUTE fromNode='ROVER' fromField='articulationParameterValue0_changed' toNode='PARTS' toField='set_azimuth'/>
    <ROUTE fromNode='ROVER' fromField='articulationParameterValue1_changed' toNode='PARTS' toField='set_elevation'/>
    <ROUTE fromNode='PARTS' fromField='turret_changed' toNode='TURRET' toField='set_rotation'/>
    <ROUTE fromNode='PARTS' fromField='gun_changed' toNode='GUN' toField='set_rotation'/>

    <!-- EspduTransform, writing: a buoy moved by ordinary X3D interpolators. The runtime turns its fields into PDUs. -->
    <EspduTransform DEF='BUOY' networkMode='networkWriter' {DIS} entityID='9' writeInterval='1' deadReckoning='2' marking='BUOY 09' entityKind='1' entityDomain='3' entityCategory='61' forceID='3' translation='300 0 1700' scale='12 12 12' description='BUOY 09'>
      {BUOY}
    </EspduTransform>
    <TimeSensor DEF='BUOY_CLOCK' cycleInterval='40' loop='true'/>
    <PositionInterpolator DEF='BUOY_PATH' key='0 0.25 0.5 0.75 1' keyValue='300 0 1700 500 3 1800 700 0 1700 500 -3 1600 300 0 1700'/>
    <OrientationInterpolator DEF='BUOY_TURN' key='0 0.25 0.5 0.75 1' keyValue='0 1 0 0 0 1 0 1.5708 0 1 0 3.1416 0 1 0 4.7124 0 1 0 6.2832'/>
    <ROUTE fromNode='BUOY_CLOCK' fromField='fraction_changed' toNode='BUOY_PATH' toField='set_fraction'/>
    <ROUTE fromNode='BUOY_CLOCK' fromField='fraction_changed' toNode='BUOY_TURN' toField='set_fraction'/>
    <ROUTE fromNode='BUOY_PATH' fromField='value_changed' toNode='BUOY' toField='set_translation'/>
    <ROUTE fromNode='BUOY_TURN' fromField='value_changed' toNode='BUOY' toField='set_rotation'/>
    <TransmitterPdu DEF='BUOY_TX' networkMode='networkWriter' {DIS} entityID='9' radioID='1' writeInterval='2' transmitState='1' frequency='156800000' power='30' transmitFrequencyBandwidth='25000' radioEntityTypeKind='7' radioEntityTypeDomain='3' modulationTypeMajor='3' modulationTypeDetail='1' modulationTypeSystem='1' inputSource='2' description='radio 1 of BUOY 09'/>
    <SignalPdu DEF='BUOY_SIG' networkMode='networkWriter' {DIS} entityID='9' radioID='1' encodingScheme='1' sampleRate='8000' description='what radio 1 of BUOY 09 sends'/>
    <ReceiverPdu DEF='BUOY_RX' networkMode='networkWriter' {DIS} entityID='9' radioID='1' writeInterval='2' transmitterSiteID='1' transmitterApplicationID='1' transmitterEntityID='1' transmitterRadioID='1' description='radio 1 of BUOY 09, listening to KITE 01'/>
    <ROUTE fromNode='BUOY' fromField='translation_changed' toNode='BUOY_TX' toField='set_antennaLocation'/>
    <ROUTE fromNode='TX' fromField='transmitState' toNode='BUOY_RX' toField='set_receiverState'/>

    <!-- yellow markers that the page puts at the sender's true positions, for comparison with dead reckoning -->
    <Switch DEF='GHOSTS' whichChoice='0'>
      <Group>
        {ghost(1)}
        {ghost(2)}
        {ghost(3)}
        {ghost(4)}
      </Group>
    </Switch>
'''
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    comp = "    <component name='DIS' level='2'/>\n"
    with open(os.path.join(here, 'scene', 'live-dis.x3d'), 'w') as f:
        f.write(HEAD % (comp, 'Live DIS', 'The six nodes of the X3D 4.0 DIS component, driven by generated IEEE 1278.1 PDUs. No recorded traffic.', scene))
    for name, body, title in (('ship', SHIP, 'Ship model'), ('helicopter', HELICOPTER, 'Helicopter model'), ('unknown', UNKNOWN, 'Marker for an entity of unknown type')):
        with open(os.path.join(here, 'scene', 'models', name + '.x3d'), 'w') as f:
            f.write(HEAD % ('', title, 'Drawn nose along +x, top along +y, and enlarged 12 times.', "    <Transform scale='12 12 12'>\n" + body + "\n    </Transform>\n"))

if __name__ == '__main__':
    main()
