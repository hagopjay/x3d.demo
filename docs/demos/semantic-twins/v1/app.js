/* Semantic Twin Cases: X3D scene (X_ITE) + its RDF twin + a domain graph in an open ontology, queried live in the page.
   Engines: N3.js, Comunica, shacl-engine (vendor/lab-stack.js). Every answer is compared with the Python oracle (rdflib + pyshacl). */
(async function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const txt = p => fetch(p, { cache: 'force-cache' }).then(r => { if (!r.ok) throw new Error(p + ' HTTP ' + r.status); return r.text(); });
  const json = p => txt(p).then(JSON.parse);
  const L = window.E_lab_stack, DF = L.DataFactory, nn = DF.namedNode;
  const engine = new L.QueryEngine();
  const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  const PR_URL = 'https://github.com/hagopjay/x3d_mcp/pull/20';

  const COL = { gold: [1, .82, .4], red: [1, .3, .32], green: [.37, .85, .54], teal: [.27, .88, .81], amber: [1, .72, .3] };
  const CASES = {
    heritage: {
      eyebrow: 'Heritage \u00b7 Giza plateau', title: 'The Osiris Shaft as a living record',
      lede: 'A study model of the Osiris Shaft, the Sphinx and the Great Pyramid, joined to a museum-grade record in CIDOC-CRM. The model shows where things are and how big they are drawn. The record says who claimed each thing, how sure we are, and what was measured. Together they keep fact, theory and speculation apart in the picture itself.',
      chips: ['CIDOC-CRM 7.1.3', 'E13 Attribute Assignment', 'E16 Measurement', 'P46 is composed of', 'QUDT unit:M'],
      x3d: ['Where each shaft, chamber and void sits, in metres', 'How big each one is drawn (Box sizes)', 'Its colour tier and the viewpoints to visit it'],
      ont: ['What each drawn thing represents (P138)', 'Which source asserted it, at what grade (E13 + E31)', 'What was actually measured, by whom (E16 + E54)', 'What is part of what (P46)'],
      both: ['Find every drawn element whose only support is speculative', 'Show where three sources disagree about one depth', 'Check the drawing against the measurement, element by element'],
      insight: 'The 3D model becomes the index of the archive. Click a chamber and you reach its sources; ask a question of the archive and the answer lights up in place. A rendering can no longer pass a guess off as a find, because a shape refuses any drawn element the record does not vouch for.',
      legend: [['#2fb8c4', 'documented'], ['#e0a040', 'theorized'], ['#d24fc6', 'speculative'], ['#ffd166', 'answer'], ['#ff5f66', 'check failed']],
      sources: [
        ['Hawass 2007, The Discovery of the Osiris Shaft at Giza (ASAE 36), via giza.fas.harvard.edu', 'shaft and chamber sizes; graded S in the Giza study ledger because the copy read was secondary'],
        ['Whiting 2021, MS thesis, University of Montana; Hawass on guardians.net', 'two of the three total-depth accounts (30 m, 25 m)'],
        ['Petrie 1883, The Pyramids and Temples of Gizeh', "King's Chamber length 10.47 m (C)"],
        ['Morishima et al. 2017, Nature 552, doi 10.1038/nature24647', 'the Big Void (L: detected, purpose unknown)'],
        ['Wikipedia, Hall of Records', 'the Cayce readings, kept as speculation'],
      ],
      note: 'Geometry and claims come from the Giza Osiris Hall study (demo v1 in x3d.demo), drawn schematically. The 41.48 m depth is from a diagram of unknown origin and is kept only to show disagreement.',
    },
    factory: {
      eyebrow: 'Industry 4.0 \u00b7 assembly cell', title: 'Cell 7, the line that checks its own layout',
      lede: 'A robot cell drawn in X3D, joined to Asset Administration Shells (the IDTA digital nameplate), SOSA sensor observations and QUDT units. The scene knows where the stations stand. The shells know what each machine is rated for. The observations arrive in mixed units. Together they check the layout against the datasheets before anything is bolted down.',
      chips: ['AAS 3.2 RDF', 'SOSA / SSN', 'QUDT units', 'qudt:conversionMultiplier', 'sosa:isHostedBy'],
      x3d: ['Where the robot base, stations, pick and place points stand', 'The arm animation (TimeSensor + interpolator)', 'Where each sensor is mounted'],
      ont: ['Each asset\'s shell: rated temperature, max reach, payload (AAS)', 'Which sensor sits on which machine, what it observes (SOSA)', 'How degF, degC, mm/s and in/s convert (QUDT)', 'Which station feeds which'],
      both: ['Turn red every machine running hotter than its rating, after unit conversion', 'Light the line downstream of a stopped station', 'Refuse a layout that puts a place point beyond the robot\'s rated reach'],
      insight: 'The twin becomes the operator\'s screen and the layout\'s first inspector. A unit mix-up that would hide an overheating station (55 \u00b0C reported as 131 \u00b0F) is resolved inside the query by QUDT, and a station moved 0.98 m in a CAD edit is caught by a rule written against the robot\'s own datasheet.',
      legend: [['#ffd166', 'answer'], ['#ff5f66', 'over limit / check failed'], ['#45e0cf', 'inferred'], ['#5fd18a', 'ok']],
      sources: [
        ['IDTA, Asset Administration Shell specification, RDF schema 3.2 (aas-specs)', 'class and property names'],
        ['W3C, Semantic Sensor Network Ontology (SOSA / SSN)', 'observations, hosting'],
        ['QUDT unit vocabulary (qudt.org/vocab/unit, downloaded 16 Nov 2026)', 'conversion multipliers and offsets for DEG_C, DEG_F, MilliM-PER-SEC, IN-PER-SEC'],
      ],
      note: 'Cell 7 is an invented example: the machines, ratings and readings are illustrative, not a real plant. Shells link submodels directly here; real AAS data links them through References.',
    },
    hospital: {
      eyebrow: 'Healthcare \u00b7 surgical suite', title: 'Operating Room 4, ready or not',
      lede: 'An operating room drawn in X3D, joined to HL7 FHIR resources (devices, locations, today\'s procedure) and the W3C Building Topology Ontology. The scene knows where the table, lights, cart and sterile field are. FHIR knows what the procedure needs and what state each device is in. BOT knows which rooms connect. Together they answer "can we start at 13:00?" with a picture.',
      chips: ['HL7 FHIR R5 RDF', 'fhir:Device', 'fhir:Procedure', 'BOT', 'bot:adjacentZone'],
      x3d: ['Where every device stands, and the sterile field\'s radius', 'The room, doors and sink', 'Viewpoints for the surgeon and the circulating nurse'],
      ont: ['What the procedure uses, its time and its room (FHIR Procedure)', 'Each device\'s status, location and service date (FHIR Device)', 'Building, floor, rooms, and which rooms touch (BOT)'],
      both: ['Light green what is present and in service; name what is missing', 'Turn red the device past its service date, where it stands', 'Refuse a non-sterile cart inside the sterile field, and a device the record puts in another room'],
      insight: 'Facilities data, the surgical schedule and the room\'s geometry meet in one view, and readiness is checked rather than assumed. The defibrillator the procedure lists is in storage, so the page names it and the route a porter takes; a cart pushed 1.25 m from the table\'s centre is refused because it is inside the 1.6 m sterile radius.',
      legend: [['#5fd18a', 'ready'], ['#ff5f66', 'not ready / check failed'], ['#ffd166', 'answer'], ['#45e0cf', 'inferred']],
      sources: [
        ['HL7 FHIR R5, RDF (fhir.ttl)', 'Device, Procedure, Location; fhir:v and fhir:l value links'],
        ['W3C Linked Building Data CG, Building Topology Ontology (BOT)', 'building, storey, space, element, adjacency'],
      ],
      note: 'OR 4 is an invented example: devices, dates and the schedule are illustrative. Core FHIR Device has no next-service field, so it is carried as an extension (twin:nextServiceDue). SNOMED CT codes are left out because SNOMED needs a licence.',
    },
    building: {
      eyebrow: 'Buildings \u00b7 office floor', title: 'Floor 3 heats an empty room',
      lede: 'An office floor drawn in X3D, joined to a Brick model of its air system: two air handlers feed six VAV boxes, each serving a zone that holds one room, with temperature, setpoint and occupancy points. The scene knows where every room, box and sensor is. Brick knows what serves what and what each sensor reads. Together they show where the energy goes and catch the sensor that was screwed to the wrong wall.',
      chips: ['Brick 1.4.2', 'brick:feeds', 'brick:hasPoint', 'Zone_Air_Temperature_Sensor', 'QUDT DEG_C'],
      x3d: ['Each room\'s footprint and the sensor\'s mounting point', 'Where the air handlers, ducts and VAV boxes are', 'A plan view for the facilities team'],
      ont: ['The air path: AHU feeds VAV feeds zone (brick:feeds)', 'Which point belongs to which room (hasLocation, hasPoint)', 'Readings, setpoints and units'],
      both: ['Turn red every empty room heated 1 K over setpoint', 'Light everything that goes warm if an air handler trips', 'Refuse a sensor drawn outside the room it controls'],
      insight: 'A commissioning error that costs a building for years (a thermostat wired to the wrong room) is invisible in a points list and obvious in 3D. Written as a shape, it is caught every time the model or the drawing changes, not once at handover.',
      legend: [['#ff5f66', 'waste / check failed'], ['#ffb84d', 'off setpoint'], ['#ffd166', 'answer'], ['#45e0cf', 'served by']],
      sources: [['Brick Schema 1.4.2 (brickschema.org, Brick.ttl downloaded 16 Nov 2026)', 'classes and relations; every Brick term used is declared there']],
      note: 'Floor 3 is an invented example: readings and setpoints are illustrative.',
    },
    warehouse: {
      eyebrow: 'Supply chain \u00b7 distribution centre', title: 'Recall lot L-2291 before lunch',
      lede: 'A warehouse aisle drawn in X3D (racks, bins, pallets and a cold room), joined to product master data in the GS1 Web Vocabulary: GTINs, product names, batch or lot numbers and expiry dates. The scene knows where each pallet physically sits. The record knows what is on it, down to the lot. Together they turn a supplier\'s recall notice into a walk list.',
      chips: ['GS1 Web Vocabulary', 'gs1:gtin', 'gs1:hasBatchLotNumber', 'gs1:expirationDate', 'contains+'],
      x3d: ['Racks, bins and levels in metres', 'Where each pallet is actually standing', 'The cold room\'s walls'],
      ont: ['Each product\'s GTIN, name and handling text (GS1)', 'Which lot is in which case, and which case on which pallet', 'Expiry dates and the recall notice'],
      both: ['Light every pallet holding the recalled lot, mixed pallets included', 'Pick the cereal that expires first', 'Refuse a chilled pallet drawn outside the cold room'],
      insight: 'Pallet P07 is mostly orange juice, so a search on the product would miss it. Following contains from the lot finds the one case of recalled yoghurt on it, and the scene shows the driver which bin to empty.',
      legend: [['#ff5f66', 'recall / check failed'], ['#ffd166', 'answer'], ['#45e0cf', 'inferred']],
      sources: [['GS1 Web Vocabulary (ref.gs1.org/voc, JSON-LD downloaded 16 Nov 2026)', 'Product, Place, gtin, productName, hasBatchLotNumber, expirationDate, consumerHandlingStorage, globalLocationNumber']],
      note: 'An invented example. GTINs use the GS1 example prefix 950 and are not real products. GS1 publishes EPCIS events separately; here, pallet and case containment are simple twin: links.',
    },
    city: {
      eyebrow: 'Cities \u00b7 planning', title: 'The block that knows its shadows',
      lede: 'A city block drawn in X3D (parcels, buildings, a park, a flood zone and a new light-rail stop), joined to a GeoSPARQL record of the same features with WKT footprints, zoning districts and permits. The scene knows heights and positions. The record knows the rules and the boundaries. Together they let a planning board see shadows, flood exposure and transit reach before anything is built.',
      chips: ['GeoSPARQL 1.1', 'geo:Feature', 'geo:asWKT', 'geo:sfWithin', 'EPSG:32618'],
      x3d: ['Each building\'s height and footprint', 'The park, the flood zone and the stop', 'Views a planning board can walk'],
      ont: ['Each feature\'s geometry as WKT in UTM 18N', 'Which parcel sits in which district (sfWithin)', 'Each district\'s height limit and the sun\'s angle'],
      both: ['Find whose solstice-noon shadow reaches the park', 'List the buildings in the flood zone, and those within 400 m of the stop', 'Refuse a building taller than its district allows'],
      insight: 'Height limits are written as zoning data, not hidden in a drawing note. When the tower grows from 36 m to 48 m in the model, the check fails, and the same change pushes its winter shadow from 74 m to 99 m across the park.',
      legend: [['#ff5f66', 'over limit / check failed'], ['#ffb84d', 'shadow / flood'], ['#ffd166', 'answer'], ['#45e0cf', 'inferred']],
      sources: [['OGC GeoSPARQL 1.1 (opengis.net/ont/geosparql, downloaded 16 Nov 2026)', 'Feature, Geometry, hasGeometry, asWKT, wktLiteral, sfWithin'],
        ['Solar elevation at noon on 21 December at 40.7\u00b0 N: 90 \u2212 40.7 \u2212 23.44 = 25.86\u00b0', 'so a shadow runs 2.06 m per metre of height']],
      note: 'An invented block. None of the engines on this page runs GeoSPARQL\'s geof: functions, so positions come from the X3D. A GeoSPARQL store would test the WKT directly.',
    },
    concert: {
      eyebrow: 'Arts \u00b7 live music', title: 'A stage plot that knows the setlist',
      lede: 'A stage plot drawn in X3D (performers, instruments, mics, wedges, followspots and the FOH desk), joined to the show in the Music Ontology with the Timeline and Event ontologies: show, sets, songs, who plays what, and when. The scene knows where everyone stands. The record knows the running order. Together, the stage manager, the monitor engineer and the lighting desk all work from one source.',
      chips: ['Music Ontology', 'mo:Performance', 'mo:performer', 'event:sub_event', 'tl:Interval'],
      x3d: ['Where each performer, amp, mic and wedge stands', 'The followspots\' positions on the FOH truss', 'A plan view for the stage plot'],
      ont: ['Show, sets and songs (Event sub_event)', 'Who performs which song on which instrument (Music Ontology)', 'Each song\'s start and length on the show timeline (Timeline)'],
      both: ['Show who is on at 00:12:30', 'List what the crew brings on and takes off between songs', 'Refuse an instrument with no mic within 1 m'],
      insight: 'A kicked mic stand or a wedge set on the wrong side is the kind of mistake that ruins a soundcheck. Once the stage plot and the setlist are one graph, a rule catches it before the doors open.',
      legend: [['#ff5f66', 'check failed'], ['#ffd166', 'answer'], ['#45e0cf', 'in Set 2']],
      sources: [['Music Ontology (motools, musicontology.rdfs)', 'Performance, performer, MusicArtist, Instrument, instrument'],
        ['Timeline and Event ontologies (C4DM, timeline.n3 and event.n3)', 'Interval, onTimeLine, beginsAtDuration, durationXSD; sub_event, time']],
      note: 'The band, songs and timings are invented. The show is named after Loomsong, your music project.',
    },
    firecode: {
      eyebrow: 'Life safety \u00b7 building code', title: 'Can everyone get out of Floor 4?',
      lede: 'An office floor drawn in X3D (rooms, corridor, doors and two exit stairs), joined to a BOT model of its spaces and doors and to the code clauses themselves, written as data. The scene gives areas, door widths and distances. BOT gives which door joins which spaces. The clauses give the numbers. Together they screen a floor plan for egress before it reaches the fire marshal.',
      chips: ['BOT', 'bot:Interface', 'bot:interfaceOf', 'code clauses as data', 'IBC 2021 (as read)'],
      x3d: ['Each room\'s floor area, from the drawn size', 'Each door\'s drawn clear width', 'Distances from rooms to the exit doors'],
      ont: ['Which door joins which spaces (BOT interfaces)', 'Which stairs are exits, and whether they are open', 'The clauses: 13.94 m\u00b2 per occupant, 49 occupants, 91.4 m travel, 0.813 m doors'],
      both: ['Compute each room\'s occupant load from its drawn area', 'Measure each room\'s distance to the nearest open exit', 'Refuse a narrow door, or a room left too far from an open exit'],
      insight: 'Writing the clauses as data, not code, means changing one number (a sprinklered floor, a new code edition) reruns every check across the plan. One locked stair puts three rooms out of compliance, and the plan shows which.',
      legend: [['#ff5f66', 'check failed'], ['#ffd166', 'answer'], ['#45e0cf', 'reachable']],
      sources: [['W3C LBD Building Topology Ontology (BOT)', 'Space, Interface, interfaceOf, hasSpace, Storey'],
        ['International Building Code 2021, Tables 1004.5, 1006.2.1, 1017.2 and section 1010.1.1 (values as we read them)', 'business load factor 150 sq ft gross; 49 occupants; 300 ft sprinklered; 32 in clear']],
      note: 'An invented floor. This is a screening example and not a code review: real travel distance follows the walking path, and local amendments apply.',
    },
    farm: {
      eyebrow: 'Agriculture \u00b7 greenhouse', title: 'Greenhouse 2 waters what is thirsty',
      lede: 'A greenhouse drawn in X3D (beds, soil probes, valves, humidity sensors and roof vents), joined to SOSA observations and to crops named by AGROVOC, the FAO\'s multilingual agricultural thesaurus. The scene knows where each probe and valve is. SOSA knows what each probe read. AGROVOC knows what each crop is. Together they tell a grower what to water, what to vent and what is actually a vegetable.',
      chips: ['AGROVOC (SKOS)', 'skos:broader', 'SOSA / SSN', 'agrovoc:c_7208 soil water content', 'QUDT PERCENT'],
      x3d: ['Each bed\'s footprint and the probe in it', 'Where the valves and roof vents are', 'A plan view of the house'],
      ont: ['Each crop as an AGROVOC concept, with its broader chain (fetched live)', 'Probe readings and humidity as SOSA observations', 'Which valve waters which bed'],
      both: ['List the thirsty beds and the litres they need', 'Flag mildew risk where humidity is high over susceptible crops', 'Refuse a probe drawn in the wrong bed'],
      insight: 'AGROVOC files basil under culinary herbs, not vegetables, so the question "show me the vegetables" lights seven beds and leaves the basil dark. Nobody wrote that rule for this greenhouse; it comes from a thesaurus maintained for the world.',
      legend: [['#ff5f66', 'thirsty / check failed'], ['#ffb84d', 'mildew risk'], ['#ffd166', 'answer'], ['#45e0cf', 'vegetables']],
      sources: [['AGROVOC (FAO), concept data from agrovoc.fao.org, 16 Nov 2026', 'tomatoes c_7805, lettuces c_12151, cucumbers c_10195, basil c_9093, powdery mildews c_13557, soil water content c_7208, relative humidity c_6496'],
        ['W3C SOSA / SSN; QUDT units', 'Sensor, Observation, Actuator; PERCENT']],
      note: 'An invented greenhouse. Moisture thresholds and the 85 % mildew rule are illustrative, not agronomic advice.',
    },
  };

  // ------------------------------------------------------------------ X_ITE: dress the shadow root (artifact CSP blocks its stylesheet)
  const el = $('#x3d');
  const css = await txt('vendor/x_ite/x_ite.css').catch(() => '');
  const DRESS = ':host{display:block;overflow:hidden}.x_ite-private-browser{height:100%;outline:none;overflow:hidden;position:relative;background:transparent}.x_ite-private-surface{height:100%}.x_ite-private-canvas{height:100%;width:100%}.x_ite-private-splash-screen{display:none}';
  const dress = () => { const root = el.shadowRoot; if (!root) return; if (!root.querySelector('style[data-st]')) { const st = document.createElement('style'); st.setAttribute('data-st', '1'); st.textContent = css + '\n' + DRESS; root.appendChild(st); }
    const b = root.querySelector('.x_ite-private-browser'); if (b && b.style.display === 'none') b.style.display = ''; };
  { let n = 0; const iv = setInterval(() => { dress(); if (++n > 24) clearInterval(iv); }, 250); }
  const browser = el.browser;

  // ------------------------------------------------------------------ state
  const S = { name: null, variant: 'clean', store: null, shapes: null, Q: null, oracle: null, mcp: null, scene: null, defs: [], saved: new Map(), xml: '' };
  const msg = h => { $('#stageMsg').innerHTML = h; };
  const local = v => { const s = String(v); const i = Math.max(s.lastIndexOf('#'), s.lastIndexOf('/')); return s.startsWith('http') ? s.slice(i + 1) : s; };
  const show = t => { if (!t) return null; if (t.termType === 'Literal') { const dt = t.datatype ? t.datatype.value : ''; if (/#(decimal|double|float|integer)$/.test(dt)) { const n = Number(t.value); return Number.isInteger(n) ? n : +n.toFixed(3); } return t.value; } return local(t.value); };
  const norm = v => { if (v === null || v === undefined || v === 'None') return ''; const s = String(v).toLowerCase(); return /^-?\d+(\.\d+)?(e-?\d+)?$/.test(s) ? Number(s).toFixed(3) : s; };
  const rowKey = (r, vars) => vars.map(k => norm(r[k])).join('|');

  async function select(q) {
    const t0 = performance.now();
    const r = await engine.query(S.Q.prefixes + q, { sources: [S.store] });
    const bs = await (await r.execute()).toArray();
    const vars = (await r.metadata()).variables.map(v => (v.variable || v).value);
    return { vars, rows: bs.map(b => Object.fromEntries(vars.map(v => [v, show(b.get(v))]))), ms: +(performance.now() - t0).toFixed(1) };
  }

  // ------------------------------------------------------------------ 3D highlight: write emissive + transparency on each Shape's material
  function mat(def) { try { const sh = S.scene.getNamedNode(def + '_Shape'); return sh && sh.appearance && sh.appearance.material; } catch (e) { return null; } }
  function clearLights() {
    for (const [def, o] of S.saved) { const m = mat(def); if (m) { m.emissiveColor = new X3D.SFColor(...o.e); if (o.b) m.baseColor = new X3D.SFColor(...o.b); m.transparency = o.t; } }
    S.saved.clear(); document.querySelectorAll('.q.on').forEach(q => q.classList.remove('on'));
  }
  function light(map) {               // map: DEF -> colour
    clearLights();
    if (!S.scene) return;
    for (const def of S.defs) {
      const m = mat(def); if (!m) continue;
      const e = m.emissiveColor, bc = m.baseColor; S.saved.set(def, { e: [e.r, e.g, e.b], b: bc ? [bc.r, bc.g, bc.b] : null, t: m.transparency });
      if (map.has(def)) { const c = map.get(def); m.emissiveColor = new X3D.SFColor(...c); if (bc) m.baseColor = new X3D.SFColor(...c); m.transparency = 0; }
      else m.transparency = Math.max(m.transparency, 0.72);
    }
  }

  // a SHACL focus or value -> the scene DEF that shows it
  const P = { dep: 'https://example.org/scen/twin#depictedBy', rep: 'http://www.cidoc-crm.org/cidoc-crm/P138i_has_representation',
    meas: 'http://www.cidoc-crm.org/cidoc-crm/P39_measured', sensor: 'http://www.w3.org/ns/sosa/madeBySensor' };
  function defOf(term) {
    if (!term) return null;
    const base = S.base;
    if (term.value.startsWith(base)) return term.value.slice(base.length);
    for (const p of [P.dep, P.rep]) { const o = S.store.getObjects(term, nn(p), null)[0]; if (o && o.value.startsWith(base)) return o.value.slice(base.length); }
    for (const p of [P.meas, P.sensor]) { const o = S.store.getObjects(term, nn(p), null)[0]; if (o) { const d = defOf(o); if (d) return d; } }
    return null;
  }

  // ------------------------------------------------------------------ render a case
  function oracleCheck(id, vars, rows) {
    const o = S.oracle[S.variant]; const want = id === 'INF' ? o.inference : o.questions[id];
    if (!want) return '';
    const a = rows.map(r => rowKey(r, vars)).sort().join('\n'), b = want.map(r => rowKey(r, vars)).sort().join('\n');
    return a === b ? `<span class="pill ok" title="Same rows as rdflib in Python">matches Python oracle \u00b7 ${want.length} rows</span>`
      : `<span class="pill warn" title="Edited, or the engines differ">differs from Python oracle (${want.length} rows there)</span>`;
  }
  function table(vars, rows) {
    if (!rows.length) return '<div class="meta">No rows.</div>';
    return `<div class="out"><table><thead><tr>${vars.map(v => `<th>${esc(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${vars.map(v => {
      const x = r[v]; const cls = typeof x === 'number' ? ' class="mono"' : '';
      if (v === 'ready') return `<td>${x === 'true' || x === true ? '<span class="pill ok">ready</span>' : '<span class="pill bad">not ready</span>'}</td>`;
      return `<td${cls}>${x === null ? '<span class="meta">not in this room</span>' : esc(x)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function colourFor(id, r) {
    if ('ready' in r) return (r.ready === 'true' || r.ready === true) ? COL.green : COL.red;
    if (['F1', 'P2', 'B1', 'W1', 'A1'].includes(id)) return COL.red;
    if (['B3', 'C1', 'C2', 'A2'].includes(id)) return COL.amber;
    if (id === 'INF') return COL.teal;
    return COL.gold;
  }

  async function runQ(card, q, id) {
    const out = card.querySelector('.res'); const ta = card.querySelector('textarea');
    out.innerHTML = '<div class="meta">Running in this browser\u2026</div>';
    try {
      const r = await select(ta.value);
      const lights = new Map();
      if (q.lights !== null) for (const row of r.rows) { const d = row.o || row[q.lights]; if (d) lights.set(d, colourFor(id, row)); }
      if (id === 'H2') for (const d of ['OsirisShaftA', 'OsirisShaftB', 'OsirisShaftC']) lights.set(d, COL.amber);
      light(lights); card.classList.add('on');
      out.innerHTML = `<div class="qhead"><span class="meta">${r.rows.length} rows \u00b7 ${r.ms} ms (Comunica)</span>${oracleCheck(id, r.vars, r.rows)}</div>${table(r.vars, r.rows)}`;
      msg(lights.size ? `<b>${esc(q.title)}</b> \u00b7 ${lights.size} element${lights.size > 1 ? 's' : ''} lit` : `<b>${esc(q.title)}</b>`);
    } catch (e) { out.innerHTML = `<div class="viol"><b>Query error</b><p>${esc(e.message || e)}</p></div>`; }
  }

  async function runInf(card) {
    const inf = S.Q.inference; const out = card.querySelector('.res');
    const n3pre = S.Q.prefixes.split('\n').filter(Boolean).map(l => l.replace(/^PREFIX (\S+) (<[^>]+>)$/, '@prefix $1 $2 .')).join('\n');
    let added = '?';
    try { const copy = new L.Store(S.store.getQuads(null, null, null, null)); const before = copy.size;
      new L.Reasoner(copy).reason(new L.Store(new L.Parser({ format: 'text/n3' }).parse(n3pre + '\n' + inf.n3))); added = copy.size - before; } catch (e) { added = 'error: ' + (e.message || e); }
    const r = await select(inf.sparql);
    const lights = new Map(r.rows.map(row => [row.o, COL.teal]).filter(x => x[0]));
    light(lights); card.classList.add('on');
    out.innerHTML = `<div class="qhead"><span class="meta">rule adds ${added} triples (N3.js reasoner) \u00b7 query ${r.rows.length} rows</span>${oracleCheck('INF', r.vars, r.rows)}</div>${table(r.vars, r.rows)}`;
    msg(`<b>${esc(inf.title)}</b> \u00b7 ${lights.size} inferred`);
  }

  async function runChecks() {
    const box = $('#checksOut'); box.innerHTML = '<div class="meta">Validating in this browser\u2026</div>';
    const t0 = performance.now();
    const rep = await new L.Validator(S.shapes, { factory: DF, validations: L.sparqlValidations }).validate({ dataset: S.store });
    const ms = +(performance.now() - t0).toFixed(1);
    const res = rep.results.map(r => ({ focus: r.focusNode && r.focusNode.term, value: r.value && r.value.term,
      msg: (r.message || []).map(m => m.value).join(' ') || '', shape: r.shape && r.shape.ptr ? local(r.shape.ptr.term.value) : '' }));
    const lights = new Map();
    for (const r of res) { const d = (r.value && defOf(r.value)) || defOf(r.focus); if (d) lights.set(d, COL.red); }
    light(lights);
    const ora = S.oracle[S.variant].shacl;
    const same = ora.length === res.length && ora.every(o => res.some(r => local(r.focus.value) === o.focus && norm(show(r.value)) === norm(o.value)));
    const tag = same ? `<span class="pill ok">matches pyshacl \u00b7 ${ora.length} results</span>` : `<span class="pill warn">differs from pyshacl (${ora.length} there)</span>`;
    box.innerHTML = `<div class="qhead"><span class="meta">${res.length} violations \u00b7 ${ms} ms (shacl-engine)</span>${tag}</div>` + (res.length ? res.map(r =>
      `<div class="viol"><b>${esc(r.shape)}</b> on <span class="mono">${esc(local(r.focus.value))}</span>${r.value ? ` \u00b7 value <span class="mono">${esc(show(r.value))}</span>` : ''}<p>${esc(r.msg)}</p></div>`).join('')
      : '<div class="okbox">Both checks pass: the scene and the record agree. Switch to \u201cWith planted faults\u201d to see them catch something.</div>');
    msg(res.length ? `<b>${res.length} check${res.length > 1 ? 's' : ''} failed</b> \u00b7 shown in red` : '<b>Both checks pass</b>');
    $('#checksCard').classList.add('on');
  }

  function render() {
    const C = CASES[S.name], Q = S.Q;
    const qCard = (q, id) => `<article class="q" data-id="${id}"><div class="qhead"><h3><span class="qid">${id}</span>${esc(q.title)}</h3><button class="btn run">Ask</button></div>
      <p class="why">${esc(q.why)}</p><details><summary>SPARQL (edit and ask again)</summary><textarea spellcheck="false" id="ta-${S.name}-${id}">${esc(q.sparql)}</textarea></details><div class="res"></div></article>`;
    const runs = S.mcp.runs[S.variant];
    const callRow = c => { const r = c.reply; const res = r.error ? 'error: ' + r.error : 'conforms' in r && r.conforms !== undefined && c.tool === 'shacl_validate' ? (r.conforms ? 'conforms' : `${r.counts.Violation} violations`) : 'total' in r ? `${r.total} rows` : `${r.triples} triples, base ${local(r.base) || r.base}`;
      const a = Object.entries(c.args).map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '\u2026' : v}`).join(', ');
      return `<div class="call"><code>${esc(c.tool)}</code><span class="a">${esc(a)}</span><span class="meta">${esc(res)} \u00b7 ${c.wall_ms} ms</span></div>`; };
    $('#case').innerHTML = `
      <section class="block"><div><div class="eyebrow">${esc(C.eyebrow)}</div><h1>${esc(C.title)}</h1><p class="lede">${esc(C.lede)}</p>
        <div class="ont">${C.chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div></div>
      <div class="three"><div><h4>X3D knows</h4><ul>${C.x3d.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div><div><h4>The ontology knows</h4><ul>${C.ont.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div class="both"><h4>Only together</h4><ul>${C.both.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div></section>
      <section class="block"><div><h2>Three questions that need both graphs</h2><p class="sub">Each runs live in your browser over the scene's RDF twin (${S.twinN.toLocaleString('en')} triples, from the x3d_mcp converter) joined with the record (${S.domN.toLocaleString('en')} triples). The answer lights up in the scene.</p></div>
        ${Q.questions.map(q => qCard(q, q.id)).join('')}</section>
      <section class="block"><div><h2>One inference</h2></div>
        <article class="q" data-id="INF"><div class="qhead"><h3><span class="qid">rule</span>${esc(Q.inference.title)}</h3><button class="btn run">Infer</button></div><p class="why">${esc(Q.inference.why)}</p>
        <details><summary>The rule (N3) and the query</summary><textarea spellcheck="false" readonly id="ta-${S.name}-INF">${esc(Q.inference.n3 + '\n\n' + Q.inference.sparql)}</textarea></details><div class="res"></div></article></section>
      <section class="block"><div><h2>Two checks, written as SHACL shapes</h2><p class="sub">${esc(S.variant === 'fault' ? 'Planted faults: ' + Q.fault_text : 'The record and the scene agree. The planted version: ' + Q.fault_text)}</p></div>
        <article class="q" id="checksCard"><div class="qhead"><h3>Hold the scene to the record, and the record to the scene</h3><button class="btn" id="runChecks">Validate</button></div>
        <details><summary>The shapes (Turtle with SHACL-SPARQL)</summary><textarea spellcheck="false" readonly id="ta-${S.name}-shapes">${esc(S.shapesText)}</textarea></details><div id="checksOut"></div></article></section>
      <section class="insight"><div class="eyebrow">Why it takes both</div><p>${esc(C.insight)}</p></section>
      <section class="block"><div><h2>The same work, through the MCP server</h2><p class="sub">An LLM gets these answers by calling the x3d_mcp tools. These calls were made to the real server over stdio for the ${S.variant === 'fault' ? 'planted' : 'recorded'} version, and every count matches the page. Joining a record to a scene needed a new <span class="mono">data_ttl</span> argument on <span class="mono">sparql_scene</span> and <span class="mono">shacl_validate</span>, added for these cases (<a href="${PR_URL}" target="_blank" rel="noopener">pull request on the x3d_mcp fork</a>).</p></div>
        <div class="calls">${runs.map(callRow).join('')}</div></section>
      <section class="block"><div><h2>Sources</h2></div><ul class="src">${C.sources.map(([a, b]) => `<li><b>${esc(a)}</b>: ${esc(b)}</li>`).join('')}</ul><p class="sub">${esc(C.note)}</p></section>`;
    $('#case').querySelectorAll('article.q[data-id]').forEach(card => {
      const id = card.dataset.id; const q = id === 'INF' ? null : Q.questions.find(x => x.id === id);
      card.querySelector('.run').addEventListener('click', () => id === 'INF' ? runInf(card) : runQ(card, q, id));
    });
    $('#runChecks').addEventListener('click', runChecks);
    $('#legend').innerHTML = C.legend.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join('');
  }

  async function load(name, variant) {
    S.name = name; S.variant = variant; document.body.dataset.scen = name;
    document.querySelectorAll('nav a').forEach(a => a.setAttribute('aria-current', a.dataset.s === name ? 'page' : 'false'));
    $('#vClean').setAttribute('aria-pressed', variant === 'clean'); $('#vFault').setAttribute('aria-pressed', variant === 'fault');
    msg('Loading the scene\u2026');
    const v = variant === 'fault' ? '-fault' : '';
    const [Q, oracle, mcp, twin, dom, shapes, xml] = await Promise.all([json(`data/${name}/questions.json`), json(`data/${name}/oracle.json`), json(`data/${name}/mcp.json`),
      txt(`data/${name}/twin${v}.ttl.txt`), txt(`data/${name}/domain${v}.ttl.txt`), txt(`data/${name}/shapes.ttl.txt`), txt(`data/${name}/scene${v}.xml`)]);
    if (S.name !== name || S.variant !== variant) return;
    Object.assign(S, { Q, oracle, mcp, shapesText: shapes, xml });
    const tq = new L.Parser().parse(twin), dq = new L.Parser().parse(dom);
    S.store = new L.Store(); S.store.addQuads(tq); S.store.addQuads(dq); S.twinN = tq.length; S.domN = dq.length;
    S.shapes = new L.Store(new L.Parser().parse(shapes));
    S.base = `https://example.org/scen/${name}/scene.ttl#`;
    S.defs = [...xml.matchAll(/DEF='([A-Za-z0-9]+)_Shape'/g)].map(m => m[1]);
    S.saved.clear();
    render();
    try { await browser.loadURL(new X3D.MFString(`data/${name}/scene${v}.xml`)); S.scene = browser.currentScene; dress();
      msg(`<b>${esc(CASES[name].title)}</b> \u00b7 ${variant === 'fault' ? 'planted faults' : 'as recorded'} \u00b7 drag to orbit, press Ask to light an answer`);
    } catch (e) { msg('The 3D view could not load: ' + esc(e.message || e)); }
  }

  const pick = () => { const h = location.hash.slice(1); return CASES[h] ? h : 'heritage'; };
  window.addEventListener('hashchange', () => load(pick(), S.variant));
  $('#vClean').addEventListener('click', () => load(S.name, 'clean'));
  $('#vFault').addEventListener('click', () => load(S.name, 'fault'));
  $('#viewBtn').addEventListener('click', () => { try { browser.nextViewpoint(); } catch (e) {} });
  $('#clearBtn').addEventListener('click', () => { clearLights(); msg(`<b>${esc(CASES[S.name].title)}</b>`); });
  $('#checkBtn').addEventListener('click', () => { runChecks(); $('#checksCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  $('#foot').innerHTML = 'Scenes validated with the x3d_mcp XSD and semantic checks (0 errors, 0 warnings). Engines in this page: N3.js 2.13.12, Comunica 5.4.1, shacl-engine 1.1.3, X_ITE 16.5.1. Oracle: rdflib + pyshacl. Every class and property the nine records take from a published vocabulary (116 uses) is declared in that publisher\u2019s own file, read on 16 Nov 2026; twin: terms are this page\u2019s own extensions.';
  await load(pick(), 'clean');
})();
