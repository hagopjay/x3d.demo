#!/usr/bin/env python3 -I
"""Writes lumen-interference.x3d (X3D 4.0, Immersive): the LUMEN Interference Atelier field as a live X3D scene.

Same analytic field as the atelier's field.py / WebGL2 shader:
  h = 0.8 + A[ sin(k r1 - phase) + b sin(k r2 - phase + offset) ] exp(-g (x^2+y^2)/36),  k = 2 pi / lambda
The initial mesh and colours are baked at the default recipe so any X3D viewer shows the sheet;
a Script node recomputes the same field per frame in X_ITE (ECMAScript).
Usage: python3 -I build_x3d.py [recipe.json] [out.x3d]
"""
import json, math, sys
N = 100  # vertices per side (the atelier offers 64/128/192)
HALF = 6.0
BOUNDS = {'amplitude': (.1, 1.5), 'wavelength': (.5, 6.), 'separation': (0., 8.), 'balance': (0., 1.), 'offset': (-math.pi, math.pi),
          'damping': (0., 3.), 'phase': (0., math.tau), 'speed': (0., 2.), 'roughness': (.05, .85), 'exposure': (.25, 2.)}
DEFAULT = dict(amplitude=.65, wavelength=2.8, separation=3.6, balance=1., offset=0., damping=1., phase=.9, speed=.7, roughness=.25, exposure=1.)
TEAL, PALE, COPPER = (.18, .70, .66), (.93, .91, .86), (.86, .52, .33)

def params(path=None):
    p = dict(DEFAULT)
    if path:
        d = json.load(open(path))
        assert d['schema'] == 'interference-atelier/v1'
        for k, v in d['parameters'].items():
            if k in BOUNDS:
                lo, hi = BOUNDS[k]; p[k] = min(hi, max(lo, float(v)))
    return p

def comps(x, y, p):
    k = math.tau / p['wavelength']; env = math.exp(-p['damping'] * (x * x + y * y) / 36)
    a = p['amplitude'] * math.sin(k * math.hypot(x + p['separation'] / 2, y) - p['phase']) * env
    b = p['amplitude'] * p['balance'] * math.sin(k * math.hypot(x - p['separation'] / 2, y) - p['phase'] + p['offset']) * env
    return a + b

def colour(h, amp):
    t = max(-1., min(1., h / (1.6 * amp)))
    lo, hi = (TEAL, PALE) if t < 0 else (PALE, COPPER); u = abs(t) if t >= 0 else 1 + t
    return tuple(lo[i] + (hi[i] - lo[i]) * u for i in range(3))

SCRIPT = r"""
ecmascript:
var P = {A:.65, lam:2.8, d:3.6, b:1, off:0, g:1, phase:.9, speed:.7, rough:.25, expo:1, light:0.75};
var playing = false, last = 0, N = %(N)d, HALF = %(HALF)s;
var TEAL=[.18,.70,.66], PALE=[.93,.91,.86], COPPER=[.86,.52,.33];
function field(x, y) {
  var k = 6.283185307179586 / P.lam, e = Math.exp(-P.g * (x*x + y*y) / 36);
  return P.A * (Math.sin(k * Math.hypot(x + P.d/2, y) - P.phase) + P.b * Math.sin(k * Math.hypot(x - P.d/2, y) - P.phase + P.off)) * e;
}
function rebuild() {
  var pts = new MFVec3f(), cols = new MFColor(), i = 0, y, x, h, t, lo, hi, u, c;
  for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
    var px = -HALF + 2*HALF*x/(N-1), pz = -HALF + 2*HALF*y/(N-1);
    h = field(px, pz); pts[i] = new SFVec3f(px, h, pz);
    t = Math.max(-1, Math.min(1, h / (1.6 * P.A)));
    if (t < 0) { lo = TEAL; hi = PALE; u = 1 + t; } else { lo = PALE; hi = COPPER; u = t; }
    cols[i] = new SFColor(lo[0]+(hi[0]-lo[0])*u, lo[1]+(hi[1]-lo[1])*u, lo[2]+(hi[2]-lo[2])*u); i++;
  }
  points = pts; colors = cols;
  srcA = new SFVec3f(-P.d/2, field(-P.d/2, 0) + 0.25, 0); srcB = new SFVec3f(P.d/2, field(P.d/2, 0) + 0.25, 0);
  roughness = P.rough; keyIntensity = 0.9 * P.expo; fillIntensity = 0.35 * P.expo;
  lightDir = new SFVec3f(-Math.sin(P.light) * 0.6, -0.8, -Math.cos(P.light) * 0.6);
  phase_changed = P.phase;
}
function set_params(v) {
  P.A=v[0]; P.lam=v[1]; P.d=v[2]; P.b=v[3]; P.off=v[4]; P.g=v[5]; P.phase=v[6]; P.speed=v[7]; P.rough=v[8]; P.expo=v[9]; P.light=v[10];
  rebuild();
}
function set_playing(v) { playing = v; }
function set_time(t) {
  if (playing && last > 0) { P.phase = (P.phase + (t - last) * P.speed) %% 6.283185307179586; rebuild(); }
  last = t;
}
function initialize() { last = 0; }
"""

def build(p, out):
    pts, cols = [], []
    for j in range(N):
        for i in range(N):
            x, z = -HALF + 2 * HALF * i / (N - 1), -HALF + 2 * HALF * j / (N - 1)
            h = comps(x, z, p); pts.append(f'{x:.4f} {h:.4f} {z:.4f}'); cols.append(' '.join(f'{c:.3f}' for c in colour(h, p['amplitude'])))
    idx = []
    for j in range(N - 1):
        for i in range(N - 1):
            a = j * N + i; b = a + 1; c = a + N; d = c + 1
            idx += [a, c, b, -1, b, c, d, -1]
    ha = comps(-p['separation'] / 2, 0, p) + .25; hb = comps(p['separation'] / 2, 0, p) + .25
    fields = ('<field accessType="inputOnly" type="MFFloat" name="set_params"/><field accessType="inputOnly" type="SFBool" name="set_playing"/>'
              '<field accessType="inputOnly" type="SFTime" name="set_time"/>'
              '<field accessType="outputOnly" type="MFVec3f" name="points"/><field accessType="outputOnly" type="MFColor" name="colors"/>'
              '<field accessType="outputOnly" type="SFVec3f" name="srcA"/><field accessType="outputOnly" type="SFVec3f" name="srcB"/>'
              '<field accessType="outputOnly" type="SFFloat" name="roughness"/><field accessType="outputOnly" type="SFFloat" name="keyIntensity"/>'
              '<field accessType="outputOnly" type="SFFloat" name="fillIntensity"/><field accessType="outputOnly" type="SFVec3f" name="lightDir"/>'
              '<field accessType="outputOnly" type="SFFloat" name="phase_changed"/>')
    xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<X3D profile="Immersive" version="4.0" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-4.0.xsd">
  <head>
    <component name="Shape" level="2"/>
    <meta name="title" content="LUMEN Interference Atelier, X3D port"/>
    <meta name="description" content="Two circular wave sources summed on a height field; live in X_ITE through a Script node. Port of the LUMEN Interference Atelier by HagopJay."/>
    <meta name="generator" content="build_x3d.py (x3d.demo lumen-interference-xite v1)"/>
  </head>
  <Scene>
    <NavigationInfo type='"EXAMINE" "ANY"' headlight="false"/>
    <Background skyColor="0.032 0.056 0.08"/>
    <Viewpoint DEF="PerspView" description="Perspective" position="13.57 15.43 14.55" orientation="-0.62998 0.73595 0.24798 0.98228" fieldOfView="0.76"/>
    <Viewpoint DEF="TopView" description="Top view" position="0 18.29 0.37" orientation="1 0 0 -1.54" fieldOfView="0.76"/>
    <DirectionalLight DEF="Key" direction="-0.45 -0.8 -0.4" intensity="0.9" color="1 0.97 0.92"/>
    <DirectionalLight DEF="Fill" direction="0.5 -0.4 0.6" intensity="0.35" color="0.7 0.85 1"/>
    <Transform translation="0 -2.4 0"><Shape><Appearance><PhysicalMaterial baseColor="0.045 0.07 0.09" roughness="0.8" metallic="0"/></Appearance>
      <IndexedFaceSet coordIndex="0 1 2 -1 2 1 3 -1" solid="false"><Coordinate point="-10 0 -10 -10 0 10 10 0 -10 10 0 10"/></IndexedFaceSet></Shape></Transform>
    <Transform translation="0 0.8 0">
      <Shape>
        <Appearance><PhysicalMaterial DEF="SheetMat" baseColor="1 1 1" roughness="{p['roughness']}" metallic="0"/></Appearance>
        <IndexedFaceSet DEF="Sheet" solid="false" colorPerVertex="true" creaseAngle="3.14159" coordIndex="{' '.join(map(str, idx))}">
          <Coordinate DEF="SheetPts" point="{', '.join(pts)}"/>
          <Color DEF="SheetCols" color="{', '.join(cols)}"/>
        </IndexedFaceSet>
      </Shape>
      <Transform DEF="SrcA" translation="{-p['separation']/2:.4f} {ha:.4f} 0"><Shape><Appearance><Material diffuseColor="0.2 0.8 0.95" emissiveColor="0.1 0.5 0.65"/></Appearance><Sphere radius="0.22"/></Shape></Transform>
      <Transform DEF="SrcB" translation="{p['separation']/2:.4f} {hb:.4f} 0"><Shape><Appearance><Material diffuseColor="0.95 0.5 0.4" emissiveColor="0.55 0.2 0.12"/></Appearance><Sphere radius="0.22"/></Shape></Transform>
    </Transform>
    <TimeSensor DEF="Clock" loop="true" cycleInterval="1000"/>
    <Script DEF="Field" directOutput="true">{fields}<![CDATA[{SCRIPT % dict(N=N, HALF=HALF)}]]></Script>
    <ROUTE fromNode="Clock" fromField="time" toNode="Field" toField="set_time"/>
    <ROUTE fromNode="Field" fromField="points" toNode="SheetPts" toField="set_point"/>
    <ROUTE fromNode="Field" fromField="colors" toNode="SheetCols" toField="set_color"/>
    <ROUTE fromNode="Field" fromField="srcA" toNode="SrcA" toField="set_translation"/>
    <ROUTE fromNode="Field" fromField="srcB" toNode="SrcB" toField="set_translation"/>
    <ROUTE fromNode="Field" fromField="roughness" toNode="SheetMat" toField="set_roughness"/>
    <ROUTE fromNode="Field" fromField="keyIntensity" toNode="Key" toField="set_intensity"/>
    <ROUTE fromNode="Field" fromField="fillIntensity" toNode="Fill" toField="set_intensity"/>
    <ROUTE fromNode="Field" fromField="lightDir" toNode="Key" toField="set_direction"/>
  </Scene>
</X3D>
'''
    open(out, 'w', encoding='utf-8').write(xml)
    print(out, len(xml), 'bytes', N * N, 'vertices', 2 * (N - 1) ** 2, 'triangles')

if __name__ == '__main__':
    build(params(sys.argv[1] if len(sys.argv) > 1 else None), sys.argv[2] if len(sys.argv) > 2 else 'lumen-interference.x3d')
