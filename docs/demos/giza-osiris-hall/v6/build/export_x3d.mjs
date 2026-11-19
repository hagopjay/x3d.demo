// Writes giza-vi.x3d from the same world.mjs descriptors the Babylon page draws.
// Usage (from v6/): node build/export_x3d.mjs [out=giza-vi.x3d]
// Deterministic: no clock, no randomness beyond world.mjs's seeded RNG, so a rebuild is byte-identical.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { world, census, KHUFU, KING } from '../world.mjs';
import { ACTS } from '../story.mjs';
const AUTHORED_LAYERS = ['horizon', 'coil']; // inventions start hidden in the accountable file

const GRADE = { C: 'Confirmed', L: 'Likely', S: 'Suspected', A: 'Authored (invention, not a truth grade)' };
// X3D 4.0 PhysicalMaterial stand-ins for the Babylon PBR set (no textures: the twin carries geometry and grades).
const MAT = {
  sand: ['.78 .62 .42', .97, 0], limestone: ['.80 .69 .52', .9, 0], casing: ['.89 .82 .70', .55, 0], limestone_old: ['.74 .63 .47', .92, 0],
  limestone_fine: ['.86 .80 .70', .5, 0], sphinx: ['.80 .66 .48', .95, 0], rock_cut: ['.66 .60 .52', .95, 0], basalt: ['.07 .07 .08', .35, 0],
  water_deep: ['.02 .07 .12', .05, 0, '.02 .09 .2', .18], granite: ['.56 .26 .21', .32, 0], king_linen: ['.93 .88 .78', .7, 0], king_skin: ['.55 .3 .18', .55, 0], gold: ['1 .76 .33', .22, 1],
  ankh: ['1 .8 .4', .18, 1, '.35 .9 1'], was: ['.85 .82 .7', .25, 1, '.2 .45 1'], water: ['.03 .11 .13', .04, 0, '0 0 0', .06], beacon: ['.1 .1 .12', .4, 0, '.3 .85 1'],
  conjecture: ['.6 .1 .55', .6, 0, '.55 .08 .5', .45], mudbrick: ['.46 .36 .26', .98, 0], canopy: ['.2 .5 .8', 1, 0, '.25 .6 1', .6],
};
const LINE = { arc: '.6 .85 1', field: '.35 .8 1', link: '1 .75 .35' };
// world.mjs arrays are clockwise-front (Babylon RH, measured); X3D ccw='true' wants counter-clockwise: swap b and c.
const ccw = I => { const o = I.slice(); for (let k = 0; k < o.length; k += 3) { o[k + 1] = I[k + 2]; o[k + 2] = I[k + 1]; } return o; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const num = a => a.map(v => Number.isInteger(v) ? v : +v.toFixed(3)).join(' ');
const meta = d => `<MetadataSet containerField='metadata' name='gizaVI'><MetadataString name='grade' value='"${d.grade}" "${esc(GRADE[d.grade])}"'/><MetadataString name='label' value='"${esc(d.label)}"'/>${d.note ? `<MetadataString name='note' value='"${esc(d.note)}"'/>` : ''}</MetadataSet>`;

function shape(d) {
  if (d.lines) {
    const pts = d.lines.flat();
    return `<Shape DEF='${d.id}'>${meta(d)}<Appearance><Material emissiveColor='${LINE[d.mat] || '1 1 1'}' diffuseColor='0 0 0'/></Appearance><LineSet vertexCount='${d.lines.map(l => l.length).join(' ')}'><Coordinate point='${num(pts.flat())}'/></LineSet></Shape>`;
  }
  const [base, rough, metal, emis = '0 0 0', tr = 0] = MAT[d.mat] || MAT.limestone;
  return `<Shape DEF='${d.id}'>${meta(d)}<Appearance><PhysicalMaterial baseColor='${base}' roughness='${rough}' metallic='${metal}' emissiveColor='${emis}' transparency='${tr}'/></Appearance><IndexedTriangleSet solid='${d.id.includes('chamber') || d.id.startsWith('osiris') || d.id === 'grand_gallery' || d.id === 'canopy' || d.id === 'hawara_water' ? 'false' : 'true'}' index='${ccw(d.indices).join(' ')}'><Coordinate point='${num(d.positions)}'/></IndexedTriangleSet></Shape>`;
}

const meshes = world(), c = census(meshes), layers = {};
for (const m of meshes) (layers[m.layer] ||= []).push(m);
// Navigation: FLY first. EXAMINE (X_ITE 16.6) keeps orbiting after a flick-release until the next click and can swing the
// camera under the plateau, so every pyramid seemed to turn by itself; it stays available second (twin.html's toggle).
// X_ITE's FLY moves drag-pixels x speed x 0.007 m/s, so each Viewpoint carries its own NavigationInfo with a speed that
// crosses the shot's distance in about 10 s on a 100 px drag: ~125 over the plateau, 0.25 in the King's Chamber.
const NAV_TYPES = `'"FLY" "EXAMINE" "ANY"'`;
const flySpeed = s => Math.max(0.25, +(Math.hypot(...s.p1.map((v, i) => v - s.t1[i])) / 7).toPrecision(2));
const navInfo = (speed, field = '') => `<NavigationInfo${field} type=${NAV_TYPES} speed='${speed}' headlight='false' visibilityLimit='60000'/>`;
const vps = ACTS.flatMap(a => a.shots).map(s => `<Viewpoint DEF='VP_${s.id.replace('.', '_')}' description='${esc(s.id + ' ' + s.title)}' position='${num(s.p1)}' centerOfRotation='${num(s.t1)}' orientation='${orient(s.p1, s.t1)}' fieldOfView='${s.fov}'>${navInfo(flySpeed(s), " containerField='navigationInfo'")}</Viewpoint>`).join('\n');
function orient(p, t) { // axis-angle that turns the default view (-z, up +y) toward t
  const f = [t[0] - p[0], t[1] - p[1], t[2] - p[2]], l = Math.hypot(...f); f[0] /= l; f[1] /= l; f[2] /= l;
  const yaw = Math.atan2(-f[0], -f[2]), pitch = Math.asin(f[1]);
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const q = [cy * sp, sy * cp, -sy * sp, cy * cp], ang = 2 * Math.acos(Math.min(1, q[3])), s = Math.sqrt(1 - q[3] * q[3]) || 1;
  return num([q[0] / s, q[1] / s, q[2] / s, ang]);
}
const x3d = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Immersive' version='4.0' xmlns:xsd='http://www.w3.org/2001/XMLSchema-instance' xsd:noNamespaceSchemaLocation='https://www.web3d.org/specifications/x3d-4.0.xsd'>
<head>
<component name='Shape' level='5'/>
<meta name='title' content='giza-vi.x3d'/>
<meta name='description' content='Giza VI, The Five Witnesses: X3D twin of the Babylon.js page. Same vertices (generated from world.mjs). Each Shape carries a grade: Confirmed, Likely, Suspected, or Authored (invention). Geometry is schematic unless its note says otherwise.'/>
<meta name='generator' content='x3d.demo docs/demos/giza-osiris-hall/v6/build/export_x3d.mjs'/>
<meta name='frame' content='x east, y up, z south, metres, Great Sphinx at the origin (v3 frame)'/>
<meta name='census' content='${c.meshes} shapes, ${c.vertices} vertices, ${c.triangles} triangles, ${c.linePoints} line points'/>
<meta name='license' content='See NOTICE.md in this folder'/>
</head>
<Scene>
<WorldInfo title='Giza VI: The Five Witnesses' info='"Measured stone (v3)" "Reported depths and Hawara (v4.1)" "Modelled chamber (Giza IV)" "Imagined coil (Giza V)" "Computed sky (v2/v3)"'/>
${navInfo(flySpeed(ACTS[0].shots[0]))}
<Background skyColor='.05 .07 .13 .55 .42 .36 .93 .62 .38' skyAngle='1.2 1.5' groundColor='.18 .13 .09'/>
<DirectionalLight DEF='SUN' direction='.75 -.1 .34' color='1 .74 .48' intensity='1.6'/>
<DirectionalLight DEF='FILL' direction='-.3 -.9 -.2' color='.55 .62 .8' intensity='.6' ambientIntensity='.35'/>
<DirectionalLight DEF='SKYFILL' direction='-.6 -.35 -.3' color='.62 .55 .5' intensity='.45'/>
<PointLight DEF='CHAMBER_LIGHT' location='${num([KING.c[0] - 0.5, KING.c[1] + 0.5, KING.c[2] + 1.2])}' color='1 .7 .42' intensity='1' radius='14'/>
${vps}
${Object.entries(layers).map(([k, ms]) => AUTHORED_LAYERS.includes(k)
  ? `<!-- authored layer, hidden by default: set whichChoice='0' to show -->\n<Switch DEF='LAYER_${k}' whichChoice='-1'>\n<Group>\n${ms.map(shape).join('\n')}\n</Group>\n</Switch>`
  : `<Group DEF='LAYER_${k}'>\n${ms.map(shape).join('\n')}\n</Group>`).join('\n')}
</Scene>
</X3D>
`;
const out = process.argv[2] || 'giza-vi.x3d';
writeFileSync(out, x3d);
console.log(JSON.stringify({ file: out, bytes: Buffer.byteLength(x3d), sha256: createHash('sha256').update(x3d).digest('hex'), ...c, khufu: KHUFU }));
