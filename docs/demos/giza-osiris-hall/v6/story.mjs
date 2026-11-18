// Giza VI story: five acts, one night, one ledger. Every caption line carries a grade.
// C Confirmed (published measurement or record, opened by an earlier edition), L Likely (computed here from
// sources, or a reported interpretation with support), S Suspected (claim, conjecture or contested reading),
// A Authored (invention for the story: it is not a truth grade, it marks fiction).
import { KHUFU, KHAFRE, OSIRIS, KING, HAWARA_ORIGIN as H } from './world.mjs';

export const GRADES = {
  C: { name: 'Confirmed', color: '#5fd39a', hint: 'Published measurement or record' },
  L: { name: 'Likely', color: '#f1b84b', hint: 'Computed here from sources, or a supported interpretation' },
  S: { name: 'Suspected', color: '#e866d4', hint: 'Claim, conjecture or contested reading' },
  A: { name: 'Authored', color: '#a596ff', hint: 'Invention for the story; not evidence' },
};
const K = KING.c, h = (x, y, z) => [H[0] + x, H[1] + y, H[2] + z];

// sky: sun azimuth from north (deg, east = 90) and altitude (deg). epoch: astronomical year for the star field.
// layers: which world layers are visible. xray: ground/pyramid ghosting. visor: VISOR look.
export const ACTS = [
  { id: 'I', key: 'stone', title: 'Stone', sub: 'What is measured', from: 'v3 Evidence Atlas', grade: 'C', shots: [
    { id: 'I.1', title: 'Dusk over the plateau', dur: 14, p0: [520, 70, 430], p1: [330, 46, 270], t0: [-420, 55, -130], t1: [-450, 60, -140], fov: 0.72, sky: { az: 291, alt: 4.5 },
      cap: [['C', 'Three kings, three mountains of limestone. The plateau as published: Khufu, Khafre, Menkaure, the Sphinx and Khafre\'s causeway.'], ['L', 'Positions are rounded published centre coordinates (v3 geo.py), not a survey; the dunes and the river are drawn for depth.']] },
    { id: 'I.2', title: 'Khufu, 230.33 m a side', dur: 12, p0: [-70, 26, -250], p1: [-150, 34, -300], t0: [-329, 80, -435], t1: [-329, 92, -435], fov: 0.8, sky: { az: 293, alt: 3.2 },
      cap: [['C', 'Base 230.33 m, 138.5 m standing today of an original 146.6 m. The summit is a platform about 12.7 m wide because the top courses are gone.'], ['C', 'Most of the fine white casing was stripped in the Middle Ages; Khafre still wears a cap of it near its summit.']] },
    { id: 'I.3', title: 'The Sphinx faces due east', dur: 12, p0: [105, 16, 78], p1: [74, 11, 52], t0: [-2, 10, 0], t1: [-6, 11, 0], fov: 0.7, sky: { az: 289, alt: 1.8 },
      cap: [['C', 'The Great Sphinx: about 73 m long and 20 m high, carved from the bedrock, facing due east.'], ['C', 'At the equinoxes the sun rises close to due east everywhere on Earth, so the Sphinx looks at that sunrise. Act V returns here for it.']] },
  ] },
  { id: 'II', key: 'below', title: 'Below', sub: 'What is reported', from: 'v3 + Hawara Witness Atlas v4.1', grade: 'L', shots: [
    { id: 'II.1', title: 'Under Khafre\'s causeway', dur: 13, p0: [-150, 26, 46], p1: [-196, -2, 18], t0: [-219, -14, -28], t1: [-218, -18, -28], fov: 0.8, sky: { az: 288, alt: -2.5 }, xray: 1, visor: 0,
      cap: [['C', 'The Osiris Shaft: three rock-cut levels, 9.62 m, then 13.25 m, then about 7.5 m, ending in water around a basalt sarcophagus (Hawass 2007).'], ['L', 'Plan and heights here are schematic; the drops are the published numbers.']] },
    { id: 'II.2', title: 'Depth theatre: 30.37, 35.45, 41.48', dur: 12, p0: [-196, -16, 20], p1: [-206, -26, 8], t0: [-217, -26, -28], t1: [-217, -28, -28], fov: 0.85, sky: { az: 288, alt: -4 }, xray: 1,
      cap: [['C', 'The three drops sum to 30.37 m. The deepest label on the published section reads 35.45 m: a different datum, not a contradiction.'], ['S', 'The popular 41.48 m appears in no source the earlier editions opened. It stays on the board as unsourced.']] },
    { id: 'II.3', title: 'Eighty-two kilometres south: Hawara', dur: 13, p0: h(330, 150, 380), p1: h(230, 95, 270), t0: h(0, 0, -50), t1: h(-20, 0, -40), fov: 0.75, sky: { az: 238, alt: 13 }, cut: true,
      cap: [['C', 'A separate site in the Faiyum: the pyramid of Amenemhat III, about 1850 BCE. Not a tunnel from Giza.'], ['L', 'Great-circle distance from Wikipedia centre coordinates is 81.6 km (Khufu 29.979 N 31.134 E; Hawara site 29.274 N 30.899 E). The v4.1 text says "roughly 90 km", likely a road figure.']] },
    { id: 'II.4', title: 'Herodotus: twelve courts, 3,000 rooms', dur: 14, p0: h(170, 80, 200), p1: h(70, 58, 150), t0: h(-60, -6, -30), t1: h(-40, -8, -40), fov: 0.85, sky: { az: 238, alt: 10 }, visor: 1, lower: 1, xray: 1,
      cap: [['C', 'Histories 2.148: twelve courts, 1,500 rooms above and 1,500 below. Herodotus says he saw the upper rooms and was told about the lower ones.'], ['S', 'The courts, the 120 columns and the magenta lower walls are an invented arrangement prompted by the account. The 2008 geophysics reported wall-like anomalies; the 2026 dig reports are advocacy, not a publication.'], ['A', 'VISOR is a look: edge and false-colour rendering of the model. It is not a sensor and shows no radar data.']] },
  ] },
  { id: 'III', key: 'horizon', title: 'Horizon', sub: 'What is modelled', from: 'Giza IV Horizon Engine', grade: 'A', shots: [
    { id: 'III.1', title: 'Into the Great Pyramid', dur: 12, p0: [-170, 118, -262], p1: [-262, 66, -352], t0: [-329, 40, -410], t1: [-329, 44, -408], fov: 0.8, sky: { az: 270, alt: -9 }, ghost: 1,
      cap: [['C', 'Inside: the Grand Gallery climbs about 46.7 m at roughly 26 degrees to the King\'s Chamber, 10.47 by 5.23 m of red granite under nine granite beams.'], ['L', 'Balezin and colleagues (2018) modelled the pyramid as a simple dielectric and found radio waves of 200 to 600 m could concentrate field in the chambers. A model result, not a measured device.']] },
    { id: 'III.2', title: 'The King\'s Chamber', dur: 13, p0: [K[0] - 4.7, 45.3, K[2] + 2.25], p1: [K[0] - 4.0, 45.0, K[2] + 1.7], t0: [K[0] + 0.8, 44.1, K[2] - 0.2], t1: [K[0] + 1.0, 44.3, K[2]], fov: 1.0, sky: { az: 270, alt: -12 }, interior: 1,
      cap: [['C', 'The granite coffer, about 2.28 by 0.98 m (Petrie), stands at the west end. It was found empty.'], ['A', 'Giza IV\'s king stands here with an ankh at the heart and a Was-sceptre at the brow. Figure, pose and glow are invented.']] },
    { id: 'III.3', title: 'Ankh at the heart, Was at the brow', dur: 12, p0: [K[0] - 0.3, 44.65, K[2] + 1.2], p1: [K[0] - 0.7, 44.75, K[2] + 0.45], t0: [K[0] + 1.0, 44.35, K[2]], t1: [K[0] + 1.1, 44.45, K[2] - 0.1], fov: 0.9, sky: { az: 270, alt: -12 }, interior: 1, instrument: 'resonance',
      cap: [['C', 'The ankh signifies life and the Was-sceptre dominion (Metropolitan Museum).'], ['A', 'Their luminous coupling is the story\'s invention. The curve on the right is Giza IV\'s dimensionless oscillator, a teaching analogy, not a field solver.']] },
  ] },
  { id: 'IV', key: 'coil', title: 'Coil', sub: 'What is imagined', from: 'Giza V Earth\'s Tesla Coil', grade: 'A', shots: [
    { id: 'IV.1', title: 'The sky is one plate', dur: 14, p0: [700, 120, 700], p1: [520, 190, 520], t0: [-329, 300, -435], t1: [-329, 330, -435], fov: 0.85, sky: { az: 290, alt: -16 }, coil: 1, instrument: 'ledger',
      cap: [['A', 'Earth as a Tesla coil: a sky sheet at 80 km, drawn at 571 m with a logarithmic squeeze, arcs standing on Khufu\'s summit.'], ['C', 'Real context: thunderstorms hold the ionosphere near 250 kV above the ground, but fair-weather current is only picoamperes per square metre (Tinsley 2022).']] },
    { id: 'IV.2', title: 'The ledger pays for every arc', dur: 14, p0: [60, 210, -120], p1: [-20, 300, -200], t0: [-329, 330, -435], t1: [-329, 400, -435], fov: 0.85, sky: { az: 290, alt: -18 }, coil: 1, instrument: 'ledger',
      cap: [['L', 'A 10 uF bank at 50 MV holds 12.5 GJ. A 600 MW source against 600 MW of arcs plus 5 MW of leakage drains it slowly; cut the supply and it is empty in 20.66 s.'], ['A', 'The machine is fiction. The arithmetic is not: initial charge plus supplied energy always equals stored plus arcs plus losses (live on the right).']] },
    { id: 'IV.3', title: 'The valley lights', dur: 12, p0: [1250, 330, 1500], p1: [1450, 240, 1050], t0: [1650, -20, -300], t1: [1680, -20, -700], fov: 0.8, sky: { az: 290, alt: -18 }, coil: 1, instrument: 'ledger',
      cap: [['C', 'The Khufu branch of the Nile carried stone to the plateau; Merer\'s logbook records the boat work (Sheisha 2022; Wadi el-Jarf papyri).'], ['A', 'A river as the circuit\'s return path, and the beacons along it, are invented. The river is drawn 1.6 km east; the real Nile is about 8 km away.']] },
  ] },
  { id: 'V', key: 'return', title: 'Return', sub: 'What the sky says', from: 'v2/v3 precession sky', grade: 'L', shots: [
    { id: 'V.1', title: 'Orion, 10,500 BCE', dur: 13, p0: [-420, 22, -1350], p1: [-430, 24, -1290], t0: [-560, 110, 200], t1: [-560, 118, 200], fov: 0.95, sky: { az: 300, alt: -24 }, epoch: -10499, stars: 1, instrument: 'sky',
      cap: [['L', 'Precession computed from ERFA long-term matrices (v3 data): at 10,500 BCE Orion\'s belt crosses the meridian only about 10 degrees above the southern horizon.'], ['S', 'The Orion correlation (Bauval 1989, 1994) reads the three pyramids as the belt. The belt kink is 172.5 degrees against 167.5 for the pyramids, and the handedness is opposite.']] },
    { id: 'V.2', title: 'Twelve thousand years in twenty seconds', dur: 20, p0: [-430, 24, -1290], p1: [-470, 30, -1240], t0: [-560, 118, 200], t1: [-560, 170, 200], fov: 0.95, sky: { az: 300, alt: -24 }, epoch: [-10499, 2000], stars: 1, instrument: 'sky',
      cap: [['L', 'Scrub the epoch: the belt climbs to about 45 degrees in Khufu\'s reign (2560 BCE) and 58.8 degrees today. The sky turns; the stones stay.'], ['C', 'Proper motion, nutation and refraction are left out (v3 SKY-MODEL limits).']] },
    { id: 'V.3', title: 'Equinox dawn over the Sphinx', dur: 16, p0: [-70, 7, -18], p1: [-46, 8, -12], t0: [400, 16, 0], t1: [400, 22, 0], fov: 0.85, sky: { az: 90, alt: 2.4 }, epoch: 2000, stars: 1, dawn: 1,
      cap: [['C', 'The Sphinx faces the equinox sunrise. That orientation is documented; what it meant to its builders is not recorded.'], ['L', 'Five witnesses, one night: measured stone, reported depths, a modelled chamber, an imagined coil, a computed sky. Each keeps its grade.']] },
  ] },
];

// One ledger across all five packs. from: the edition that carried the claim.
export const LEDGER = [
  ['C', 'Khufu base 230.33 m, 138.5 m today, 146.6 m original', 'v3', 'Wikipedia: Great Pyramid of Giza', 'https://en.wikipedia.org/wiki/Great_Pyramid_of_Giza'],
  ['C', 'Khafre 215.25 m base, 136.4 m today, 143.5 m original, casing near the summit', 'v3', 'Wikipedia: Pyramid of Khafre', 'https://en.wikipedia.org/wiki/Pyramid_of_Khafre'],
  ['C', 'Menkaure 103.4 m base, 65.5 m original', 'v3', 'Wikipedia: Pyramid of Menkaure', 'https://en.wikipedia.org/wiki/Pyramid_of_Menkaure'],
  ['C', 'Great Sphinx about 73 m long, 20 m high, faces due east', 'v3', 'Wikipedia: Great Sphinx of Giza', 'https://en.wikipedia.org/wiki/Great_Sphinx_of_Giza'],
  ['C', 'Osiris Shaft drops 9.62 + 13.25 + 7.50 m = 30.37 m; 35.45 m is a section-datum label', 'v3', 'Hawass 2007, CASAE 36 (as read by v2/v3)', ''],
  ['S', '41.48 m Osiris depth: in no source opened', 'v3', 'v2 correction note', ''],
  ['C', 'King\'s Chamber 10.47 x 5.23 m, red granite, nine ceiling beams', 'v3 / IV', 'Petrie 1883, The Pyramids and Temples of Gizeh', 'https://www.ronaldbirdsall.com/gizeh/'],
  ['C', 'Grand Gallery about 46.7 m slope at about 26 deg', 'v3', 'arXiv 1711.01576 (as cited by v3)', 'https://arxiv.org/abs/1711.01576'],
  ['S', 'Hall of Records near the Sphinx (Cayce readings): no chamber found', 'v3', 'v3 Contested lens', ''],
  ['S', '"648 m" shafts and cubes under Khafre (2025): unpublished, rejected by Hawass and Conyers', 'v3', 'v3 Contested lens', ''],
  ['C', 'Hawara: Amenemhat III pyramid complex and the classical Labyrinth', 'v4.1', 'UCL Digital Egypt site index', 'https://www.ucl.ac.uk/museums-static/digitalegypt/archaeology/sitesindex.html'],
  ['C', 'Herodotus 2.148: twelve courts, 3,000 rooms, upper seen, lower reported', 'v4.1', 'Herodotus 2.148, Macaulay translation', 'https://lexundria.com/hdt/2.148/mcly'],
  ['C', 'Petrie explored the Hawara pyramid and cemeteries (1888-1911)', 'v4.1', 'UCL Petrie Museum: Hawara', 'https://www.ucl.ac.uk/3dpetriemuseum/stories/excavation-and-rediscovery/tour-of-the-nile/hawara-1.html'],
  ['L', '2008 Mataha geophysics: possible wall-like anomalies (interpretation, no radar volume loaded)', 'v4.1', 'Archaeological Rescue Foundation: Hawara', 'https://archaeologicalrescue.org/hawara/'],
  ['S', '2026 dig reports of an exposed large wall: advocacy source, no excavation publication found', 'v4.1', 'ARF Update 3 (page dated 26 Oct; body says 21 July)', 'https://archaeologicalrescue.org/2026/10/26/hawara-update-3/'],
  ['S', 'Four levels at 60-70 m, a "metallic object", Bob Lazar attribution: unverified', 'v4.1', 'Podcast narratives (leads only)', ''],
  ['L', 'Giza to Hawara about 82 km great-circle (v4.1 text: roughly 90 km)', 'VI', 'Haversine 81.6 km from Wikipedia pages Great Pyramid of Giza (29.97917 N 31.13417 E) and Hawara (29.27417 N 30.89889 E), opened 18 Nov 2026', 'https://en.wikipedia.org/wiki/Hawara'],
  ['L', 'Great Pyramid RF scattering at 200-600 m wavelengths concentrates field in chambers (simplified dielectric model)', 'IV', 'Balezin et al. 2018, J. Appl. Phys., DOI 10.1063/1.5026556', 'https://doi.org/10.1063/1.5026556'],
  ['C', 'Khufu branch of the Nile supported transport during construction', 'IV', 'Sheisha et al., PNAS 2022', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9477388/'],
  ['C', 'Merer\'s logbook records Giza stone transport', 'IV', 'IFAO: Wadi el-Jarf', 'https://www.ifao.egnet.net/recherche/archeologie/ouadi-el-jarf/'],
  ['C', 'Quartz is piezoelectric; static load gives a transient, not continuing power', 'IV', 'PCB Piezotronics; Tectonophysics 1981', 'https://www.sciencedirect.com/science/article/pii/0040195181902687'],
  ['S', 'Quartz foundation or continuous metal lining as a power system', 'IV', 'IV hypothesis cards (no evidence found)', 'https://mci.si.edu/node/1207798'],
  ['C', 'Ankh = life, Was-sceptre = dominion (symbols)', 'IV', 'Metropolitan Museum of Art', 'https://www.metmuseum.org/art/collection/search/570354'],
  ['A', 'The king, his pose, the luminous ankh-Was coupling, the 108 s passage', 'IV', 'Authored fiction', ''],
  ['A', 'Machines, craft and nonhuman beings of the encounter', 'IV / V', 'Authored fiction (AERA: the builders\' town is documented)', 'https://aeraweb.org/projects/lost-city/'],
  ['C', 'Wardenclyffe (1901): Tesla\'s wireless transmission ambition; no Giza replication documented', 'V', 'Tesla Science Center at Wardenclyffe', 'https://teslasciencecenter.org/history/'],
  ['C', 'Ionosphere from about 48 km; two miles (3.218688 km) is in the troposphere', 'V', 'NASA: Earth\'s atmospheric layers', 'https://www.nasa.gov/image-article/earths-atmospheric-layers-3/'],
  ['C', 'Global circuit: about 250 kV ionospheric potential, picoampere fair-weather current densities', 'V', 'Tinsley 2022, JGR Atmospheres', 'https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2021JD035954'],
  ['L', '10 uF at 50 MV stores 12.5 GJ; with supply off the default load empties it in 20.66 s', 'V / VI', 'E = CV^2/2; tesla.mjs ledger, re-run here (Node 22)', 'https://ntrs.nasa.gov/api/citations/19780010368/downloads/19780010368.pdf'],
  ['A', 'Earth\'s Tesla coil, standing arcs, sky sheet, valley beacons', 'V', 'Authored fiction', ''],
  ['L', 'Orion belt culmination about 10 deg at 10,500 BCE, 45 deg at 2560 BCE, 58.8 deg in 2000 CE', 'v2 / VI', 'ERFA ltpb samples via v3 GizaSky, re-run here', ''],
  ['S', 'Orion correlation: pyramids mirror the belt', 'v2', 'Bauval 1989, 1994; belt kink 172.5 deg vs 167.5 deg (v2 computation)', ''],
  ['C', 'Sphinx faces the equinox sunrise (due east)', 'v3', 'Orientation documented; intent not recorded', ''],
].map(([g, claim, from, src, url], i) => ({ id: 'L' + String(i + 1).padStart(2, '0'), g, claim, from, src, url }));

export const TOTAL = ACTS.reduce((s, a) => s + a.shots.reduce((x, y) => x + y.dur, 0), 0);
export function flatShots() { const out = []; let t = 0; for (const a of ACTS) for (const s of a.shots) { out.push({ ...s, act: a, start: t }); t += s.dur; } return out; }
