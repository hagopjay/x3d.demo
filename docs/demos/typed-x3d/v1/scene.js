// The showpiece scene (an orrery) as X3D JSON, plus the nine mistakes a model really makes, each as a function that
// damages a copy of it. Every vocabulary node used here is in the "animated" preset (19 nodes).
export const VOCAB = {
  primitives: ['Transform', 'Group', 'Shape', 'Appearance', 'Material', 'Box', 'Sphere', 'Cylinder'],
  starter: ['Transform', 'Group', 'Shape', 'Appearance', 'Material', 'Box', 'Sphere', 'Cone', 'Cylinder', 'Viewpoint', 'NavigationInfo', 'WorldInfo'],
  animated: ['Transform', 'Group', 'Shape', 'Appearance', 'Material', 'Box', 'Sphere', 'Cone', 'Cylinder', 'Viewpoint', 'NavigationInfo', 'WorldInfo',
    'TimeSensor', 'PositionInterpolator', 'OrientationInterpolator', 'ScalarInterpolator', 'DirectionalLight', 'PointLight', 'Background'],
};

const mat = (c, e) => ({ '-appearance': { Appearance: { '-material': { Material: { '@diffuseColor': c, '@emissiveColor': e || [0, 0, 0] } } } } });
const planet = (def, orbitR, radius, color, sec) => [
  { TimeSensor: { '@DEF': def + 'Clock', '@cycleInterval': sec, '@loop': true } },
  { OrientationInterpolator: { '@DEF': def + 'Spin', '@key': [0, 0.5, 1], '@keyValue': [0, 1, 0, 0, 0, 1, 0, 3.14159, 0, 1, 0, 6.28318] } },
  { Transform: { '@DEF': def + 'Orbit', '-children': [
    { Transform: { '@translation': [orbitR, 0, 0], '-children': [{ Shape: { ...mat(color), '-geometry': { Sphere: { '@radius': radius } } } }] } },
    { Transform: { '@rotation': [1, 0, 0, 1.5708], '-children': [{ Shape: { ...mat([0.18, 0.2, 0.3], [0.12, 0.14, 0.22]), '-geometry': { Cylinder: { '@radius': orbitR + 0.01, '@height': 0.004, '@top': false, '@bottom': false, '@side': true } } } }] } },
  ] } },
  { ROUTE: { '@fromNode': def + 'Clock', '@fromField': 'fraction_changed', '@toNode': def + 'Spin', '@toField': 'set_fraction' } },
  { ROUTE: { '@fromNode': def + 'Spin', '@fromField': 'value_changed', '@toNode': def + 'Orbit', '@toField': 'set_rotation' } },
];

export function baseDoc() {
  return { X3D: { encoding: 'UTF-8', '@profile': 'Interchange', '@version': '4.0',
    head: { component: [{ '@name': 'Lighting', '@level': 2 }], meta: [{ '@name': 'title', '@content': 'Orrery (typed X3D demo)' }] },
    Scene: { '-children': [
      { WorldInfo: { '@title': 'Orrery' } },
      { NavigationInfo: { '@type': ['EXAMINE', 'ANY'], '@headlight': false } },
      { Viewpoint: { '@position': [0, 5.4, 9.2], '@orientation': [1, 0, 0, -0.5], '@description': 'overview' } },
      { Background: { '@skyColor': [0.01, 0.015, 0.04, 0.02, 0.03, 0.08], '@skyAngle': [1.5708] } },
      { PointLight: { '@location': [0, 0, 0], '@color': [1, 0.85, 0.6], '@intensity': 1.6, '@radius': 40 } },
      { DirectionalLight: { '@direction': [-0.3, -1, -0.4], '@intensity': 0.25 } },
      { Shape: { ...mat([1, 0.7, 0.2], [1, 0.6, 0.12]), '-geometry': { Sphere: { '@radius': 0.9 } } } },
      ...planet('A', 2.0, 0.28, [0.55, 0.6, 0.7], 6),
      ...planet('B', 3.3, 0.46, [0.2, 0.55, 0.95], 11),
      ...planet('C', 4.8, 0.36, [0.9, 0.35, 0.25], 19),
    ] } } };
}

const at = (d, f) => { const kids = d.X3D.Scene['-children']; f(kids); return d; };
const find = (kids, name) => kids.find((k) => k[name])[name];

// id, what a model did, why it happens, damage, the repair a model would be asked for (a scripted replay: no model is called)
export const MISTAKES = [
  { id: 'zod-m1', title: 'Two numbers where three are needed', why: 'A Box size is SFVec3f; the model counted a 2D footprint.',
    damage: (d) => at(d, (k) => { find(k, 'Shape'); const b = k.find((x) => x.Transform && x.Transform['@DEF'] === 'AOrbit'); b.Transform['-children'][0].Transform['-children'][0].Shape['-geometry'] = { Box: { '@size': [0.5, 0.5] } }; }) },
  { id: 'zod-m2', title: 'A node that does not exist', why: 'Torus is in glTF viewers and Blender menus, not in X3D 4.0. The model borrowed it.',
    damage: (d) => at(d, (k) => { const b = k.find((x) => x.Transform && x.Transform['@DEF'] === 'BOrbit'); b.Transform['-children'][0].Transform['-children'][0].Shape['-geometry'] = { Torus: { '@innerRadius': 0.2, '@outerRadius': 0.5 } }; }) },
  { id: 'zod-m3', title: 'A field spelled the British way', why: 'diffuseColour reads as English and as wrong. The schema forbids unknown keys, so it cannot slip through as a no-op.',
    damage: (d) => at(d, (k) => { const s = find(k, 'Shape'); const m = s['-appearance'].Appearance['-material'].Material; m['@diffuseColour'] = m['@diffuseColor']; delete m['@diffuseColor']; }) },
  { id: 'zod-m4', title: 'NavigationInfo type as a bare string', why: 'The model wrote the field the way XML does. In JSON it is an MFString, an array. The Web3D schema as published has this field backwards; the gate carries our one-line correction.',
    damage: (d) => at(d, (k) => { find(k, 'NavigationInfo')['@type'] = 'EXAMINE'; }) },
  { id: 'zod-m5', title: 'Colours on a 0 to 255 scale', why: 'Training data is full of CSS. X3D colours are 0 to 1.',
    damage: (d) => at(d, (k) => { const s = find(k, 'Shape'); s['-appearance'].Appearance['-material'].Material['@emissiveColor'] = [255, 153, 30]; }) },
  { id: 'zod-m6', title: 'XML habits in JSON: geometry without its container', why: 'In XML the child sits under Shape. In JSON it needs the -geometry slot, or the key is just unknown.',
    damage: (d) => at(d, (k) => { const s = find(k, 'Shape'); const g = s['-geometry']; delete s['-geometry']; Object.assign(s, g); }) },
  { id: 'zod-m7', title: 'A number as a string', why: 'Spoken numbers become quoted numbers when a model is unsure it is still in a number slot.',
    damage: (d) => at(d, (k) => { const b = k.find((x) => x.Transform && x.Transform['@DEF'] === 'COrbit'); b.Transform['-children'][0].Transform['-children'][0].Shape['-geometry'].Sphere['@radius'] = '0.36'; }) },
  { id: 'zod-m8', title: 'The model claims X3D 4.1', why: 'It is newer, so it sounds better. The published JSON schema stops at 4.0, so the gate says what it can and cannot vouch for.',
    damage: (d) => { d.X3D['@version'] = '4.1'; return d; } },
  { id: 'zod-m9', title: 'A ROUTE to a node that is not there', why: 'Passes this gate: the JSON schema types a ROUTE as four strings. Only a semantic checker can see that nothing is called ASpinn.',
    damage: (d) => at(d, (k) => { const r = k.find((x) => x.ROUTE && x.ROUTE['@toNode'] === 'ASpin'); r.ROUTE['@toNode'] = 'ASpinn'; }), passes: true },
];
