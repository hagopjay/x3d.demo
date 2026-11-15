// "Kinetic orrery": a scene that is the same in X_ITE, the three.js bridge and Babylon, animated by ONE GSAP timeline.
// scene(): the static X3D (24 satellites on three rings, a glowing core, a world transform the timeline dollies and turns); rest(): the state tree; build(gsap, t): the timeline.
// The timeline is about 40 lines of JS; stagger is what GSAP is for, and it is what an authoring tool saves you from hand-writing as keys.
export const RINGS = [{ n: 8, r: 3.2, y: 0.0 }, { n: 8, r: 5.0, y: 0.9 }, { n: 8, r: 6.8, y: -0.9 }];
export const SATS = RINGS.flatMap((g, ri) => Array.from({ length: g.n }, (_, i) => ({ id: ri * 8 + i, ring: ri, i, a: (i / g.n) * Math.PI * 2 + ri * 0.4, r: g.r, y: g.y })));
const hsv = (h, s, v) => { const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c, k = Math.floor(h / 60) % 6, t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k]; return [t[0] + m, t[1] + m, t[2] + m]; };
export const baseColour = (s) => hsv((s.id / 24) * 300 + 10, 0.65, 0.95);
const f = (x) => +x.toFixed(4);
export const ringPos = (s, extra = 0) => [Math.cos(s.a + extra) * s.r, s.y, Math.sin(s.a + extra) * s.r];

export function sceneX3d() {
  const sat = (s) => { const c = baseColour(s).map(f).join(' '), p = ringPos(s).map(f).join(' ');
    return `    <Transform DEF='S${s.id}' translation='${p}'><Shape><Appearance><Material DEF='SM${s.id}' diffuseColor='${c}' specularColor='0.5 0.5 0.5' shininess='0.5'/></Appearance><Sphere radius='0.42'/></Shape></Transform>`; };
  return `<?xml version="1.0" encoding="UTF-8"?>
<X3D profile='Full' version='4.0'>
  <head><meta name='title' content='kinetic orrery: 24 satellites, one core, one camera rig; animated by one GSAP timeline'/></head>
  <Scene>
    <Background skyColor='0.02 0.03 0.07 0.05 0.07 0.16' skyAngle='1.5708' groundColor='0.01 0.01 0.03 0.03 0.04 0.1' groundAngle='1.5708'/>
    <NavigationInfo type='"NONE"' headlight='false'/>
    <Viewpoint DEF='Cam' position='0 3.2 15' orientation='1 0 0 -0.2' fieldOfView='0.8' description='orrery'/>
    <Transform DEF='World'>
    <DirectionalLight direction='-0.5 -0.7 -0.6' intensity='0.65' color='0.85 0.9 1'/>
    <PointLight location='0 0 0' intensity='1.2' color='1 0.85 0.6' radius='40'/>
    <Transform DEF='Core'><Shape><Appearance><Material DEF='CoreMat' diffuseColor='0 0 0' emissiveColor='1 0.72 0.35'/></Appearance><Sphere radius='1.1'/></Shape></Transform>
${SATS.map(sat).join('\n')}
    <!--GHOST-->
    </Transform>
  </Scene>
</X3D>
`; }

export function rest() {
  const r = { World: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }, Core: { scale: { x: 1, y: 1, z: 1 } }, CoreMat: { emissiveColor: { r: 1, g: 0.72, b: 0.35 } } };
  for (const s of SATS) { const p = ringPos(s), c = baseColour(s); r['S' + s.id] = { translation: { x: p[0], y: p[1], z: p[2] }, scale: { x: 1, y: 1, z: 1 } }; r['SM' + s.id] = { diffuseColor: { r: c[0], g: c[1], b: c[2] } }; }
  return r;
}
// 6.5 s: burst out of the core, settle on the rings, travel a quarter turn, a colour wave runs round, the core pulses, the camera dollies in and orbits
export function build(gsap, t) {
  const tl = gsap.timeline(), P = (s) => ringPos(s);
  tl.fromTo(t.Core.scale, { x: 0.2, y: 0.2, z: 0.2 }, { x: 1, y: 1, z: 1, duration: 1.4, ease: 'elastic.out(1,0.45)' }, 0)
    .to(t.Core.scale, { x: 1.35, y: 1.35, z: 1.35, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: 3 }, 1.6)
    .fromTo(t.CoreMat.emissiveColor, { r: 1, g: 0.2, b: 0.1 }, { r: 1, g: 0.72, b: 0.35, duration: 2.2, ease: 'power2.out' }, 0);
  SATS.forEach((s, k) => {
    const d = k * 0.035, a = t['S' + s.id], c = t['SM' + s.id].diffuseColor, p = P(s), q = ringPos(s, Math.PI / 2);
    tl.fromTo(a.translation, { x: 0, y: 0, z: 0 }, { x: p[0], y: p[1], z: p[2], duration: 1.5, ease: 'back.out(1.5)' }, 0.2 + d)
      .fromTo(a.scale, { x: 0.01, y: 0.01, z: 0.01 }, { x: 1, y: 1, z: 1, duration: 0.9, ease: 'back.out(2.2)' }, 0.2 + d)
      .to(a.translation, { x: q[0], y: q[1] + Math.sin(s.i) * 0.5, z: q[2], duration: 2.4, ease: 'power2.inOut' }, 2.4 + d)
      .to(a.scale, { x: 1.5, y: 1.5, z: 1.5, duration: 0.35, ease: 'power2.out', yoyo: true, repeat: 1 }, 4.6 + d * 2)
      .to(c, { r: 1, g: 1, b: 1, duration: 0.3, ease: 'none', yoyo: true, repeat: 1 }, 4.6 + d * 2);
  });
  // the camera is fixed; the world moves the other way (a Viewpoint under an animated Transform is not followed by the three.js body: see README, findings)
  tl.fromTo(t.World.translation, { x: 0, y: -1, z: -6 }, { x: 0, y: 0, z: 3, duration: 6.5, ease: 'power1.inOut' }, 0)
    .fromTo(t.World.rotation, { x: 0, y: 40, z: 0 }, { x: 0, y: -40, z: 0, duration: 6.5, ease: 'sine.inOut' }, 0);
  return tl;
}
