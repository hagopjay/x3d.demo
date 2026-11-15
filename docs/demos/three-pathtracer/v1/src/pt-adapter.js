// Adapter between the x3d.threejs bridge body and three-gpu-pathtracer 0.0.28 (ES module; THREE and the bundle's X3DSAI are passed in, nothing is imported from the bridge).
//   freeze(body)                      stop the body's own rAF loop (it would draw a raster frame over the path tracer's canvas)
//   loadScene(body, xml)              parse + replaceWorld + three frames, driving body.frame() by hand
//   preparePT(THREE, body, {lights})  re-set the scene for the path tracer; returns {converted, log, sky}
// What changes, and why (each line is also logged into the result):
//   lights    the bridge sets light = I*PI and bakes the X3D attenuation into a patched shader. The path tracer has no such patch, so each light is re-set in physical terms.
//             lights:'pbr'     light = I           (X_ITE lights PhysicalMaterial as rho/pi * I, so does three.js's Lambert); classic Material gets its diffuse colour x PI to land on rho * I
//             lights:'classic' light = I*PI        (the bridge's own raster convention)
//             attenuation (1 0 0) -> decay 0, (0 0 1) -> decay 2, (0 1 0) -> decay 1, anything else is a fit at half the radius (logged); the X3D radius hard cut-off is not applied.
//   ambient   the AmbientLight the bridge adds for Material.ambientIntensity is dropped (the path tracer has no ambient term; the global illumination is the ambient)
//   materials MeshPhong (X3D Material) -> MeshPhysical, roughness 1 - min(0.9, shininess/128), metalness 0; MeshBasic (UnlitMaterial) -> black + emissive = colour (a light source in the path tracer)
//   emissive  PhysicalMaterial emissiveColor stays emissive, so in the path tracer it LIGHTS the scene (X_ITE does not light from it): the Cornell ceiling panel is the example
//   background the body draws Background as sphere meshes; they are removed and the first skyColor becomes the miss colour (ground colours and angles are not drawn)
export function freeze(body) { if (body._raf) cancelAnimationFrame(body._raf); body._raf = 0; }
export async function loadScene(body, xml) {
  const B = X3DSAI.B, sc = await B.createX3DFromString(xml), p = B.replaceWorld(sc);
  for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); body.frame(); }
  await p; body.fit(); body.updateView(); body.renderAll();
}
export function preparePT(THREE, body, { lights = 'pbr' } = {}) {
  const log = new Set(), classic = lights === 'classic', conv = new Map(); let converted = 0;
  body.scene.traverse((o) => {
    if (o.isAmbientLight) { o.visible = false; o.intensity = 0; log.add('AmbientLight dropped (no ambient term in the path tracer; the bridge holds Material ambientIntensity at a fixed 0.2)'); }
    if ((o.isPointLight || o.isSpotLight || o.isDirectionalLight) && o.intensity === 0) o.visible = false;
    const n = o.userData && o.userData.node;
    if (n && o.isDirectionalLight && !classic) o.intensity = n.f.intensity;
    if (n && (o.isPointLight || o.isSpotLight)) {
      const f = n.f, a = (f.attenuation || [1, 0, 0]).slice(), I = f.intensity * (classic ? Math.PI : 1);
      if (a[1] === 0 && a[2] === 0) { o.decay = 0; o.intensity = I / Math.max(a[0], 1e-6); }
      else if (a[0] === 0 && a[1] === 0) { o.decay = 2; o.intensity = I / a[2]; }
      else if (a[0] === 0 && a[2] === 0) { o.decay = 1; o.intensity = I / a[1]; }
      else { const d = f.radius > 0 ? f.radius * 0.5 : 5; o.decay = 2; o.intensity = I / (a[0] + a[1] * d + a[2] * d * d) * d * d; log.add('light ' + (n.def || n.type) + ' attenuation ' + a.join(' ') + ' fitted at d=' + d); }
      o.distance = 0; if (f.radius > 0) log.add('PointLight/SpotLight radius cut-off not applied (' + (n.def || n.type) + ' radius ' + f.radius + ')');
    }
    if (!o.isMesh) return; const m = o.material; if (!m || m.isMeshPhysicalMaterial || m.isMeshStandardMaterial) return;
    if (m.isMeshPhongMaterial || m.isMeshLambertMaterial) { if (!conv.has(m)) { const p = new THREE.MeshPhysicalMaterial({ color: m.color.clone().multiplyScalar(classic ? 1 : Math.PI), emissive: m.emissive, map: m.map, side: m.side, roughness: 1 - Math.min(0.9, (m.shininess || 30) / 128), metalness: 0 }); p.emissiveIntensity = m.emissiveIntensity; conv.set(m, p); converted++; } o.material = conv.get(m); }
    else if (m.isMeshBasicMaterial) { if (!conv.has(m)) { conv.set(m, new THREE.MeshPhysicalMaterial({ color: 0x000000, emissive: m.color, side: m.side })); converted++; } o.material = conv.get(m); }
  });
  if (body.bgGroup) body.scene.remove(body.bgGroup);
  const bgn = body.world && body.world.nodes.find((n) => n.type === 'Background'), sky = bgn && bgn.f.skyColor && bgn.f.skyColor.length ? bgn.f.skyColor[0] : [0, 0, 0];
  body.scene.background = new THREE.Color(sky[0], sky[1], sky[2]); body.scene.environment = null;
  body.scene.updateMatrixWorld(true); body.cam.updateMatrixWorld(true);
  return { converted, log: [...log], sky };
}
