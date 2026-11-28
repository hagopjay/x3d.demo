// The sailplane's look as an X3D 4.0 file (assets/glider.x3d): a 15 m span, a 6.6 m fuselage, a T-tail.
// Body axes for the renderer: +x nose, +y up, +z right wing (PlayCanvas and X3D are y-up).
import { AIRFRAME } from './glider.js';

export function gliderX3D() {
  const span = 15, c = AIRFRAME.c, arm = -AIRFRAME.xt;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Interchange' version='4.0'>
<head><meta name='title' content='THERMAL sailplane'/><meta name='generator' content='x3d.thermal tools/build.mjs (src/sim/model.js)'/><meta name='license' content='MIT'/></head>
<Scene>
<WorldInfo title='THERMAL sailplane'>
<MetadataSet name='kansei:thermal-glider' containerField='metadata'>
<MetadataString name='polar' value='"ASW-28 (15m), XCSoar PolarStore.cpp, from SeeYou"'/>
<MetadataDouble name='span' value='${span}'/>
<MetadataDouble name='tailArm' value='${arm}'/>
</MetadataSet>
</WorldInfo>
<Transform DEF='Glider'>
  <Transform DEF='Fuselage' translation='-1.2 0 0' rotation='0 0 1 1.5708'>
    <Shape><Appearance><PhysicalMaterial DEF='Gelcoat' baseColor='0.92 0.92 0.9' metallic='0' roughness='0.25'/></Appearance><Cylinder radius='0.32' height='4.2'/></Shape>
  </Transform>
  <Transform DEF='Nose' translation='1.25 0 0' rotation='0 0 1 -1.5708'>
    <Shape><Appearance><PhysicalMaterial USE='Gelcoat'/></Appearance><Cone bottomRadius='0.32' height='0.9'/></Shape>
  </Transform>
  <Transform DEF='Canopy' translation='0.55 0.26 0' scale='1.4 0.55 0.75'>
    <Shape><Appearance><PhysicalMaterial baseColor='0.05 0.08 0.12' metallic='0.1' roughness='0.05' transparency='0.15'/></Appearance><Sphere radius='0.42'/></Shape>
  </Transform>
  <Transform DEF='Boom' translation='-4.2 0.05 0' rotation='0 0 1 1.5708'>
    <Shape><Appearance><PhysicalMaterial USE='Gelcoat'/></Appearance><Cylinder radius='0.13' height='2.6'/></Shape>
  </Transform>
  <Transform DEF='Wing' translation='0.1 0.18 0'>
    <Shape><Appearance><PhysicalMaterial USE='Gelcoat'/></Appearance><Box size='${c} 0.09 ${span}'/></Shape>
  </Transform>
  <Transform DEF='WingTipL' translation='0.08 0.3 ${-span / 2 + 0.05}'>
    <Shape><Appearance><PhysicalMaterial DEF='Beni' baseColor='1 0.05 0.25' metallic='0' roughness='0.4'/></Appearance><Box size='${c * 0.7} 0.25 0.06'/></Shape>
  </Transform>
  <Transform DEF='WingTipR' translation='0.08 0.3 ${span / 2 - 0.05}'>
    <Shape><Appearance><PhysicalMaterial USE='Beni'/></Appearance><Box size='${c * 0.7} 0.25 0.06'/></Shape>
  </Transform>
  <Transform DEF='Fin' translation='-${arm - 0.1} 0.75 0'>
    <Shape><Appearance><PhysicalMaterial USE='Gelcoat'/></Appearance><Box size='0.85 1.3 0.08'/></Shape>
  </Transform>
  <Transform DEF='Tailplane' translation='-${arm} 1.38 0'>
    <Shape><Appearance><PhysicalMaterial USE='Beni'/></Appearance><Box size='0.55 0.06 2.6'/></Shape>
  </Transform>
</Transform>
</Scene>
</X3D>
`;
}
