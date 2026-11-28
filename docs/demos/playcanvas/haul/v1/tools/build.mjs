// Builds HAUL's X3D files: the truck, the trailer (its cargo for each level in a Switch) and the five levels.
//   node tools/build.mjs
// The truck and trailer are written in the simulation's frame (x forward, y up, z left, origin at the centre of
// mass, src/sim/spec.js) so the renderer places them with the bodies' transforms as they are.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRUCK, TRAILER } from '../src/sim/spec.js';
import { generate, toX3D } from '../src/sim/level.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const f = (v) => (Math.round(v * 1000) / 1000).toString();
const vec = (a) => a.map(f).join(' ');

const MAT = {
  paint: "<PhysicalMaterial DEF='Paint' baseColor='0.85 0.22 0.015' metallic='0.25' roughness='0.35'/>",
  black: "<PhysicalMaterial DEF='Frame' baseColor='0.05 0.05 0.06' metallic='0.4' roughness='0.6'/>",
  chrome: "<PhysicalMaterial DEF='Chrome' baseColor='0.85 0.86 0.88' metallic='1' roughness='0.15'/>",
  glass: "<PhysicalMaterial DEF='Glass' baseColor='0.08 0.12 0.16' metallic='0.1' roughness='0.05' transparency='0.25'/>",
  rubber: "<PhysicalMaterial DEF='Rubber' baseColor='0.03 0.03 0.03' metallic='0' roughness='0.9'/>",
  rim: "<PhysicalMaterial DEF='Rim' baseColor='0.6 0.6 0.62' metallic='0.9' roughness='0.35'/>",
  lamp: "<PhysicalMaterial DEF='Lamp' baseColor='1 0.95 0.8' emissiveColor='1 0.9 0.7' metallic='0' roughness='0.2'/>",
  amber: "<PhysicalMaterial DEF='Beacon' baseColor='1 0.55 0.05' emissiveColor='1 0.45 0' metallic='0' roughness='0.3'/>",
  red: "<PhysicalMaterial DEF='Tail' baseColor='0.9 0.05 0.05' emissiveColor='0.6 0 0' metallic='0' roughness='0.3'/>",
  deck: "<PhysicalMaterial DEF='Deck' baseColor='0.32 0.30 0.28' metallic='0.6' roughness='0.55'/>",
  steel: "<PhysicalMaterial DEF='Steel' baseColor='0.42 0.44 0.46' metallic='0.8' roughness='0.4'/>",
  wood: "<PhysicalMaterial DEF='Wood' baseColor='0.55 0.36 0.2' metallic='0' roughness='0.85'/>",
  yellow: "<PhysicalMaterial DEF='Yellow' baseColor='0.96 0.78 0.1' metallic='0.2' roughness='0.45'/>",
  green: "<PhysicalMaterial DEF='Green' baseColor='0.18 0.35 0.22' metallic='0.3' roughness='0.5'/>",
};
const used = new Set();
function mat(name) {
  if (used.has(name)) return `<Appearance><PhysicalMaterial USE='${MAT[name].match(/DEF='(\w+)'/)[1]}'/></Appearance>`;
  used.add(name);
  return `<Appearance>${MAT[name]}</Appearance>`;
}
const box = (name, at, size, m, extra = '') => `<Transform DEF='${name}' translation='${vec(at)}'${extra}><Shape>${mat(m)}<Box size='${vec(size)}'/></Shape></Transform>`;
const cyl = (name, at, radius, height, m, rot = '') => `<Transform DEF='${name}' translation='${vec(at)}'${rot ? ` rotation='${rot}'` : ''}><Shape>${mat(m)}<Cylinder radius='${f(radius)}' height='${f(height)}'/></Shape></Transform>`;
const ALONG_Z = '1 0 0 1.5708', ALONG_X = '0 0 1 1.5708';

function wheel(def, radius, width) {
  // a wheel turns about z (the axle); the game sets this Transform's rotation and position every frame
  const lugs = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2;
    return cyl(`${def}_lug${k}`, [Math.cos(a) * radius * 0.38, Math.sin(a) * radius * 0.38, width * 0.5 + 0.01], 0.035, 0.04, 'chrome', ALONG_Z);
  }).join('');
  return `<Transform DEF='${def}'>${cyl(`${def}_tyre`, [0, 0, 0], radius, width, 'rubber', ALONG_Z)}${cyl(`${def}_rim`, [0, 0, 0.005], radius * 0.62, width + 0.01, 'rim', ALONG_Z)}${lugs}${box(`${def}_tread`, [radius * 0.97, 0, 0], [0.05, 0.09, width * 0.96], 'rubber')}</Transform>`;
}

function header(title, description) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 4.0//EN" "https://www.web3d.org/specifications/x3d-4.0.dtd">
<X3D profile='Interchange' version='4.0'>
<head>
<meta name='title' content='${title}'/>
<meta name='description' content='${description}'/>
<meta name='generator' content='x3d.kansei-haul/tools/build.mjs'/>
<meta name='license' content='MIT'/>
</head>
<Scene>
`;
}

function truck() {
  used.clear();
  const r = TRUCK.wheelRadius, gy = -TRUCK.cgHeight;            // ground under the centre of mass
  const hubs = [];
  TRUCK.axles.forEach((a) => { for (const side of [1, -1]) hubs.push([a.x, gy + r, side * TRUCK.track / 2]); });
  const body = [
    box('Rails', [-0.3, gy + 0.85, 0], [9.0, 0.28, 1.0], 'black'),
    box('Hood', [3.95, gy + 1.55, 0], [1.75, 1.05, 2.15], 'paint'),
    box('Grille', [4.84, gy + 1.5, 0], [0.06, 0.9, 1.3], 'chrome'),
    box('Bumper', [5.0, gy + 0.85, 0], [0.32, 0.36, 2.5], 'chrome'),
    box('Cab', [2.15, gy + 2.15, 0], [2.4, 2.1, 2.45], 'paint'),
    box('Roof', [2.0, gy + 3.25, 0], [2.0, 0.12, 2.3], 'paint'),
    box('Windscreen', [3.36, gy + 2.55, 0], [0.04, 0.85, 2.2], 'glass'),
    box('SideGlassL', [2.4, gy + 2.6, 1.23], [1.3, 0.75, 0.03], 'glass'),
    box('SideGlassR', [2.4, gy + 2.6, -1.23], [1.3, 0.75, 0.03], 'glass'),
    box('HeadL', [4.86, gy + 1.15, 0.85], [0.06, 0.22, 0.34], 'lamp'),
    box('HeadR', [4.86, gy + 1.15, -0.85], [0.06, 0.22, 0.34], 'lamp'),
    box('BeaconL', [2.3, gy + 3.37, 0.75], [0.25, 0.14, 0.25], 'amber'),
    box('BeaconR', [2.3, gy + 3.37, -0.75], [0.25, 0.14, 0.25], 'amber'),
    box('Deck', [-2.3, gy + 1.12, 0], [4.6, 0.12, 2.4], 'deck'),
    box('TailL', [-4.62, gy + 1.0, 1.0], [0.06, 0.15, 0.3], 'red'),
    box('TailR', [-4.62, gy + 1.0, -1.0], [0.06, 0.15, 0.3], 'red'),
    cyl('FifthWheel', [TRUCK.hitch[0], gy + 1.25, 0], 0.72, 0.12, 'steel'),
    box('Ballast', [-0.6, gy + 1.6, 0], [1.6, 0.85, 2.1], 'steel', ` scale='1 1 1'`),
    cyl('TankL', [1.0, gy + 1.0, 1.1], 0.36, 1.5, 'chrome', ALONG_X),
    cyl('TankR', [1.0, gy + 1.0, -1.1], 0.36, 1.5, 'chrome', ALONG_X),
    ...TRUCK.exhaust.map(([x, y, z], k) => cyl(`Stack${k}`, [x, (gy + 1.0 + y) / 2, z], 0.13, y - gy - 1.0, 'chrome')),
    ...TRUCK.exhaust.map(([x, y, z], k) => cyl(`StackCap${k}`, [x, y, z], 0.16, 0.08, 'black')),
    box('FenderF', [TRUCK.axles[0].x, gy + r + 0.55, 0], [1.4, 0.08, 2.65], 'black'),
  ].join('\n');
  const wheels = hubs.map((h, k) => `<Transform DEF='Hub${k}' translation='${vec(h)}'>${wheel(`Wheel${k}`, r, 0.4)}</Transform>`).join('\n');
  return header('HAUL 6x6 truck', 'An original heavy 6x6: conventional cab, twin stacks, fifth wheel, ballast deck. Faces +X, y up, origin at the centre of mass.') + `<WorldInfo title='HAUL 6x6'/>
<Transform DEF='Truck'>
<MetadataSet name='kansei:haul-truck' containerField='metadata'>
<MetadataString name='id' value='"haul6x6"' containerField='value'/>
<MetadataDouble name='hubs' value='${vec(hubs.flat())}' containerField='value'/>
<MetadataDouble name='wheelRadius' value='${f(r)}' containerField='value'/>
<MetadataDouble name='cgHeight' value='${f(TRUCK.cgHeight)}' containerField='value'/>
<MetadataDouble name='exhaust' value='${vec(TRUCK.exhaust.flat())}' containerField='value'/>
<MetadataDouble name='hitch' value='${vec(TRUCK.hitch)}' containerField='value'/>
<MetadataDouble name='cab' value='2.6 ${f(gy + 2.75)} 0.55' containerField='value'/>
</MetadataSet>
${body}
${wheels}
</Transform>
</Scene>
</X3D>
`;
}

function trailer() {
  used.clear();
  // the trailer's frame: origin at its centre of mass for the level's payload is set by the game; this file is in the
  // deck-centre frame (x forward from the deck centre, y up from the ground)
  const tr = TRAILER.wheelRadius, deckY = 1.05;
  const hubs = [];
  for (const ax of TRAILER.axles) for (const side of [1, -1]) hubs.push([ax, tr, side * TRAILER.track / 2]);
  const body = [
    box('DeckT', [-0.8, deckY, 0], [TRAILER.deck[0] - 1.6, 0.25, TRAILER.deck[2]], 'deck'),
    box('Neck', [4.3, deckY + 0.55, 0], [2.0, 0.35, 2.3], 'paint'),
    box('NeckRamp', [3.0, deckY + 0.3, 0], [0.8, 0.5, 2.2], 'paint'),
    cyl('Kingpin', [TRAILER.kingpin[0], deckY + 0.3, 0], 0.08, 0.3, 'steel'),
    box('RailL', [-0.8, deckY - 0.25, 0.9], [TRAILER.deck[0] - 1.6, 0.3, 0.12], 'black'),
    box('RailR', [-0.8, deckY - 0.25, -0.9], [TRAILER.deck[0] - 1.6, 0.3, 0.12], 'black'),
    box('TrTailL', [-6.32, deckY - 0.1, 1.0], [0.06, 0.15, 0.3], 'red'),
    box('TrTailR', [-6.32, deckY - 0.1, -1.0], [0.06, 0.15, 0.3], 'red'),
  ].join('\n');
  const deckTop = deckY + 0.125;
  const pipes = Array.from({ length: 6 }, (_, k) => cyl(`Pipe${k}`, [-1.4, deckTop + 0.3 + (k > 2 ? 0.55 : 0), -0.6 + (k % 3) * 0.6], 0.27, 8.5, 'green', ALONG_X)).join('');
  const logs = Array.from({ length: 9 }, (_, k) => cyl(`Log${k}`, [-1.5, deckTop + 0.3 + Math.floor(k / 3) * 0.5, -0.65 + (k % 3) * 0.65 + (Math.floor(k / 3) % 2) * 0.1], 0.3, 8.0, 'wood', ALONG_X)).join('');
  const excavator = [
    box('ExTracks', [-1.5, deckTop + 0.4, 0], [4.2, 0.8, 2.4], 'black'),
    box('ExBody', [-1.6, deckTop + 1.35, 0], [3.0, 1.1, 2.3], 'yellow'),
    box('ExCab', [-0.6, deckTop + 2.3, 0.6], [1.0, 1.0, 0.9], 'yellow'),
    box('ExBoom', [0.8, deckTop + 1.9, -0.2], [2.8, 0.35, 0.4], 'yellow', ` rotation='0 0 1 0.5'`),
    box('ExArm', [2.3, deckTop + 1.4, -0.2], [0.35, 1.8, 0.35], 'yellow'),
  ].join('');
  const generator = [box('GenBox', [-1.2, deckTop + 1.1, 0], [5.8, 2.2, 2.4], 'green'), box('GenVent', [-1.2, deckTop + 2.25, 0], [3.0, 0.12, 1.6], 'steel')].join('');
  const wheels = hubs.map((h, k) => `<Transform DEF='TrHub${k}' translation='${vec(h)}'>${wheel(`TrWheel${k}`, tr, 0.38)}</Transform>`).join('\n');
  return header('HAUL gooseneck lowboy', 'An original gooseneck lowboy trailer; its cargo for each level is a Switch (pipe, excavator, logs, generator). Deck-centre frame, +X forward, y up from the ground.') + `<WorldInfo title='HAUL lowboy'/>
<Transform DEF='Trailer'>
<MetadataSet name='kansei:haul-trailer' containerField='metadata'>
<MetadataDouble name='hubs' value='${vec(hubs.flat())}' containerField='value'/>
<MetadataDouble name='wheelRadius' value='${f(tr)}' containerField='value'/>
<MetadataDouble name='kingpin' value='${vec(TRAILER.kingpin)}' containerField='value'/>
<MetadataString name='cargo' value='"pipe" "excavator" "logs" "generator"' containerField='value'/>
</MetadataSet>
${body}
<Switch DEF='Cargo' whichChoice='0'>
<Group DEF='Cargo_pipe'>${pipes}</Group>
<Group DEF='Cargo_excavator'>${excavator}</Group>
<Group DEF='Cargo_logs'>${logs}</Group>
<Group DEF='Cargo_generator'>${generator}</Group>
</Switch>
${wheels}
</Transform>
</Scene>
</X3D>
`;
}

mkdirSync(join(ROOT, 'assets'), { recursive: true });
mkdirSync(join(ROOT, 'levels'), { recursive: true });
writeFileSync(join(ROOT, 'assets/truck.x3d'), truck());
writeFileSync(join(ROOT, 'assets/trailer.x3d'), trailer());
const manifest = [];
for (let k = 1; k <= 5; k++) {
  const L = generate(k);
  const file = `level${k}.x3d`;
  writeFileSync(join(ROOT, 'levels', file), toX3D(L));
  manifest.push({ level: k, file, name: L.name, tagline: L.tagline, cargo: L.cargo, payload: L.payload, steepest: Math.max(...L.pitches.map((p) => p.g)), sky: L.sky });
}
writeFileSync(join(ROOT, 'levels/MANIFEST.json'), JSON.stringify({ levels: manifest }, null, 1) + '\n');
console.log('wrote assets/truck.x3d, assets/trailer.x3d, levels/level1..5.x3d, levels/MANIFEST.json');
