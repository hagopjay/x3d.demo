// view: three.js. Draws v3's baked pyramid (read from its X3D), the two duellists from the simulation's own
// bodies, and every effect. Reads frames (live or recorded); never writes to the simulation.
import * as THREE from '../vendor/three.module.js';
import { loadX3D } from './x3dload.js';

export const PAINT_HEX = { pink: 0xff4fa3, blue: 0x3ec8ff, yellow: 0xffd23f, green: 0x6dff6a, stone: 0x000000, scorch: 0x2a2018, gone: 0x000000 };
export const PAINT_IDX = ['pink', 'blue', 'yellow', 'green'];
export const TILE_CODES = ['stone', 'pink', 'blue', 'yellow', 'green', 'scorch', 'gone'];
const LOOK = [
  { shirt: 0xd9822b, pistol: 0xff4fa3, name: 'Explorer' },
  { shirt: 0x2e64c9, pistol: 0x6dff6a, name: 'Pusher' },
];
const TROUSER = 0x6f6252, SKIN = 0xe0b48a, HELMET = 0xece2c8, BOOT = 0x3a2e25;

export class View {
  constructor(canvas, data) {
    this.data = data; this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 6000);
    this.time = 0; this.fx = []; this.shake = 0; this.flash = 0;
    this.cam = { mode: 'auto', yaw: 0.8, pitch: 0.28, dist: 16, target: new THREE.Vector3(0, data.khufu.summit + 1, 0), shot: 0, shotT: 0, pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.sky(); this.lights();
    this.summit = data.khufu.summit; this.H = data.khufu.summit_half;
    this.deckGroup = new THREE.Group(); this.deckGroup.position.set(0, this.summit, 0); this.scene.add(this.deckGroup);
    this.makeDeck(); this.makeFxPools();
    this.resize(); addEventListener('resize', () => this.resize());
    this.bindOrbit();
  }
  resize() { const w = this.canvas.clientWidth, h = this.canvas.clientHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }
  sky() {   // v3's Background gradient, as a big sphere
    const b = this.data.background, c = (i) => new THREE.Color(b.skyColor[3 * i], b.skyColor[3 * i + 1], b.skyColor[3 * i + 2]);
    const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { c0: { value: c(0) }, c1: { value: c(1) }, c2: { value: c(2) }, g: { value: new THREE.Color(b.groundColor[0], b.groundColor[1], b.groundColor[2]) }, a1: { value: b.skyAngle[0] }, a2: { value: b.skyAngle[1] }, flash: { value: 0 } },
      vertexShader: 'varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 c0,c1,c2,g; uniform float a1,a2,flash; varying vec3 vd; void main(){ float a = acos(clamp(vd.y,-1.0,1.0)); vec3 col = a < a1 ? mix(c0,c1,a/a1) : a < a2 ? mix(c1,c2,(a-a1)/(a2-a1)) : g; gl_FragColor = vec4(mix(col, vec3(0.9,0.92,1.0), flash), 1.0); }' });
    mat.toneMapped = false; this.skyMat = mat;
    const m = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat); m.frustumCulled = false; this.scene.add(m);
  }
  lights() {
    const L = this.data.lights;
    this.hemi = new THREE.HemisphereLight(0xb8c8ff, 0x8a6a48, 0.9); this.scene.add(this.hemi);
    const s = this.sun = new THREE.DirectionalLight(new THREE.Color(...L.sun.color), 2.6);
    this.sunDir = new THREE.Vector3(...L.sun.direction).normalize();
    s.castShadow = true; s.shadow.mapSize.set(2048, 2048); const sc = s.shadow.camera; sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 200; s.shadow.bias = -0.0004; s.shadow.normalBias = 0.02;
    this.scene.add(s, s.target);
    this.boltLight = new THREE.PointLight(0xc8d8ff, 0, 60, 1.6); this.scene.add(this.boltLight);
  }
  async loadPyramid(url) {
    const { root, report } = await loadX3D(url, { dropDEF: ['OB_Survey_mast'] });
    const detail = this.stoneDetail();
    // v3 baked the fall strip of the north face at high density and the rest at low density. A fall can go down any
    // face here, so the low-density faces are lit live instead (limestone, sun, shadows, grain); the strip keeps its bake.
    const LIVE = new Set(['OB_East__south_and_west_faces', 'OB_North_face__rest']);
    root.traverse(o => {
      if (!o.isMesh) return; o.receiveShadow = true;
      if (LIVE.has(o.name)) { o.material = new THREE.MeshStandardMaterial({ color: 0xd2b98e, roughness: 0.96 }); this.addDetail(o.material, detail, true); o.castShadow = false; }
      else { o.material.toneMapped = false; if (o.material.map) this.addDetail(o.material, detail); }
    });
    this.scene.add(root); this.pyramid = root; this.loadReport = report;
    // the survey mast, drawn here (lightning rod)
    const m = this.data.mast, mast = new THREE.Mesh(new THREE.CylinderGeometry(m.radius, m.radius * 1.4, m.top - m.base, 10), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.35 }));
    mast.position.set(m.x, (m.top + m.base) / 2, m.z); mast.castShadow = true; this.scene.add(mast);
    return report;
  }
  // close up, v3's baked textures are soft (the faces other than the fall strip were baked at low density), so a
  // tiling limestone grain is multiplied in, projected from world position (triplanar), fading out with distance
  stoneDetail() {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), img = x.createImageData(N, N);
    let h = 12345; const r = () => ((h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0) / 4294967296);
    const grid = []; for (let i = 0; i < 32 * 32; i++) grid.push(r());
    const val = (u, v, f) => { const X = u * f, Y = v * f, i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j, g = (a, b) => grid[((a % f + f) % f) * 32 % 1024 + ((b % f + f) % f)];
      const s = (t) => t * t * (3 - 2 * t); return (g(i, j) * (1 - s(fx)) + g(i + 1, j) * s(fx)) * (1 - s(fy)) + (g(i, j + 1) * (1 - s(fx)) + g(i + 1, j + 1) * s(fx)) * s(fy); };
    for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
      const u = xx / N, v = y / N; let n = 0.5 * val(u, v, 4) + 0.3 * val(u, v, 8) + 0.2 * val(u, v, 16); const pit = r() < 0.012 ? -0.35 : 0;
      const k = Math.max(0, Math.min(255, (0.82 + 0.36 * n + pit) * 200)), o = 4 * (y * N + xx); img.data[o] = k; img.data[o + 1] = k * 0.97; img.data[o + 2] = k * 0.92; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  }
  addDetail(mat, tex, lit) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: tex };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vNw;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz; vNw = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detailMap; varying vec3 vW; varying vec3 vNw;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 bw = pow(abs(normalize(vNw)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          float s = 0.45; vec3 d = texture2D(detailMap, vW.zy * s).rgb * bw.x + texture2D(detailMap, vW.xz * s).rgb * bw.y + texture2D(detailMap, vW.xy * s).rgb * bw.z;
          float fade = ${lit ? '1.0' : 'clamp(1.0 - length(vW - cameraPosition) / 90.0, 0.0, 1.0)'};
          diffuseColor.rgb *= mix(vec3(1.0), d * 1.25, ${lit ? '0.6' : '0.75'} * fade);`);
    };
    mat.needsUpdate = true;
  }
  // the capstone: a paint overlay (drawn from the tile colours) and a stone slab shown while it tilts
  makeDeck() {
    const H = this.H, cv = this.paintCanvas = document.createElement('canvas'); cv.width = cv.height = 768;
    this.paintTex = new THREE.CanvasTexture(cv); this.paintTex.colorSpace = THREE.SRGBColorSpace;
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(2 * H, 2 * H), new THREE.MeshStandardMaterial({ map: this.paintTex, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    ov.rotation.x = -Math.PI / 2; ov.position.y = 0.012; ov.receiveShadow = true; this.deckGroup.add(ov);
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(2 * H, 0.55, 2 * H), new THREE.MeshStandardMaterial({ color: 0xc9b48c, roughness: 0.95 }));
    this.slab.position.y = -0.275; this.slab.visible = false; this.slab.receiveShadow = true; this.deckGroup.add(this.slab);
    this.tilesKey = '';
  }
  drawTiles(codes) {
    if (codes === this.tilesKey) return; this.tilesKey = codes; const tiles = Array.from(codes, c => TILE_CODES[c]);
    const c = this.paintCanvas.getContext('2d'), N = Math.sqrt(tiles.length), s = this.paintCanvas.width / N;
    c.clearRect(0, 0, this.paintCanvas.width, this.paintCanvas.height);
    tiles.forEach((p, i) => {
      if (p === 'stone') return; const a = Math.floor(i / N), b = i % N, x = (a + 0.5) * s, y = (b + 0.5) * s;   // tile (a, b) is x = a, z = b
      if (p === 'gone') { c.fillStyle = 'rgba(20,14,8,0.95)'; c.fillRect(a * s, b * s, s, s); return; }
      const col = '#' + PAINT_HEX[p].toString(16).padStart(6, '0'); c.fillStyle = col; c.globalAlpha = p === 'scorch' ? 0.75 : 0.88;
      let h = (i * 2654435761) >>> 0; const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
      for (let k = 0; k < 7; k++) { c.beginPath(); c.arc(x + (rnd() - 0.5) * s * 0.7, y + (rnd() - 0.5) * s * 0.7, s * (0.12 + rnd() * 0.28), 0, 7); c.fill(); }
      c.beginPath(); c.arc(x, y, s * 0.36, 0, 7); c.fill();
    });
    c.globalAlpha = 1; this.paintTex.needsUpdate = true;
  }
  makeFxPools() {
    this.pelletMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 0.6 }), 400);
    this.pelletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.pelletMesh.count = 0; this.pelletMesh.frustumCulled = false; this.scene.add(this.pelletMesh);
    this.debrisGeo = new THREE.BoxGeometry(0.24, 0.18, 0.22); this.debrisMat = new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 0.95 }); this.debris = new Map();
    this.shellMesh = new Map();
    this.markers = new Map();
    // sand for the khamsin
    const n = 2400, pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { pos[3 * i] = (Math.random() - 0.5) * 40; pos[3 * i + 1] = this.data.khufu.summit - 6 + Math.random() * 14; pos[3 * i + 2] = (Math.random() - 0.5) * 40; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sand = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd9b57a, size: 0.07, transparent: true, opacity: 0.0, depthWrite: false })); this.sand.frustumCulled = false; this.scene.add(this.sand);
    // eddy, gates, laser, beam, pole: made once, shown when their omen runs
    this.eddy = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), new THREE.MeshStandardMaterial({ color: 0x7fb8ff, transparent: true, opacity: 0.16, emissive: 0x3060c0, emissiveIntensity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    this.eddyRings = new THREE.Group(); for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 64), new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.7 })); t.rotation.set(i * 1.1, i * 0.7, 0); this.eddyRings.add(t); }
    this.eddy.add(this.eddyRings); this.eddy.visible = false; this.scene.add(this.eddy);
    this.gates = [0, 1].map(i => { const g = new THREE.Group(); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 10, 48), new THREE.MeshStandardMaterial({ color: i ? 0x2fe3c4 : 0xa64dff, emissive: i ? 0x2fe3c4 : 0xa64dff, emissiveIntensity: 1.4 }));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.82, 48), new THREE.MeshBasicMaterial({ color: i ? 0x0a4a44 : 0x2a0a4a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      g.add(ring, disc); g.visible = false; this.scene.add(g); return g; });
    this.laser = new THREE.Group(); const lr = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 40), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, side: THREE.DoubleSide })); lr.rotation.x = -Math.PI / 2;
    const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 300, 6), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.45 })); lb.position.y = 150; this.laser.add(lr, lb); this.laser.visible = false; this.scene.add(this.laser);
    this.beam = new THREE.Mesh(new THREE.BoxGeometry(1.0, 120, 22), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false })); this.beam.visible = false; this.scene.add(this.beam);
    this.pole = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), new THREE.MeshStandardMaterial({ color: 0x9fd3ff, emissive: 0x4fa0ff, emissiveIntensity: 2 })); this.pole.visible = false; this.scene.add(this.pole);
  }

  // ---------- the duellists ----------
  bindSim(sim) {
    if (this.figs) for (const f of this.figs) for (const g of f.groups) this.scene.remove(g);
    for (const [, m] of this.debris) this.scene.remove(m); this.debris.clear();
    for (const [, m] of this.shellMesh) this.scene.remove(m); this.shellMesh.clear();
    for (const [, m] of this.markers) this.scene.remove(m); this.markers.clear();
    for (const e of this.fx) e.dispose?.(); this.fx = [];
    this.figOrder = sim.figs[0].order;
    this.figs = sim.figs.map((f, i) => {
      const look = LOOK[i], groups = [], splats = [];
      for (const n of f.order) {
        const p = f.parts[n], g = new THREE.Group(); groups.push(g); this.scene.add(g);
        const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
        let geo, col = n === 'torso' || n.endsWith('Upper') ? look.shirt : n === 'head' || n.endsWith('Fore') ? (n === 'head' ? SKIN : look.shirt) : TROUSER;
        if (p.kind === 'box') geo = new THREE.BoxGeometry(p.size[0] * 2, p.size[1] * 2, p.size[2] * 2);
        else if (p.kind === 'ball') geo = new THREE.SphereGeometry(p.size[0], 20, 14);
        else geo = new THREE.CapsuleGeometry(p.size[1], Math.max(0.02, p.size[0] - 2 * p.size[1]), 6, 12);
        const m = new THREE.Mesh(geo, mat(col)); m.castShadow = true; g.add(m);
        if (n === 'head') {   // pith helmet and brim, as v3's figures wear
          const hel = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(HELMET)); hel.position.y = 0.02; hel.castShadow = true;
          const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.015, 24), mat(HELMET)); brim.position.y = 0.03; brim.castShadow = true;
          const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.02), new THREE.MeshBasicMaterial({ color: 0x1a1410 })); eyes.position.set(0, -0.01, 0.125);
          g.add(hel, brim, eyes);
        }
        if (n.endsWith('Fore')) { const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mat(SKIN)); hand.position.y = -p.size[0] / 2; g.add(hand); }
        if (n === 'rFore') {   // the paintball pistol
          const gun = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.07), new THREE.MeshStandardMaterial({ color: look.pistol, emissive: look.pistol, emissiveIntensity: 0.35, roughness: 0.35 }));
          const hopper = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })); hopper.position.set(0, 0.04, 0.06);
          gun.add(body, hopper); gun.position.set(0, -p.size[0] / 2 - 0.07, 0.03); g.add(gun);
        }
        if (n.endsWith('Shin')) { const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.23), mat(BOOT)); foot.position.set(0, -p.size[0] / 2 + 0.02, 0.05); foot.castShadow = true; g.add(foot); }
        const glow = new THREE.Mesh(new THREE.SphereGeometry(n === 'torso' ? 0.42 : 0.01, 16, 10), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        if (n === 'torso') g.add(glow);
        g.userData = { n, glow: n === 'torso' ? glow : null };
      }
      const tag = this.label(look.name, i ? '#7fb0ff' : '#ffb36b'); this.scene.add(tag); groups.push(tag);
      return { groups, splats, tag, n: f.order.length };
    });
  }
  label(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
    x.font = '600 30px system-ui, sans-serif'; x.textAlign = 'center'; x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,0.6)'; x.strokeText(text, 128, 42); x.fillStyle = color; x.fillText(text, 128, 42);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(1.2, 0.3, 1); s.renderOrder = 10; return s;
  }
  // ---------- per frame ----------
  // a: previous frame, b: current frame, alpha in [0,1]
  draw(a, b, alpha, dt, hud) {
    this.time += dt;
    const P = b.poses, Q = a ? a.poses : b.poses, q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion();
    let k = 0;
    this.figs.forEach((F, fi) => {
      for (let j = 0; j < F.n; j++, k += 7) {
        const g = F.groups[j];
        g.position.set(Q[k] + (P[k] - Q[k]) * alpha, Q[k + 1] + (P[k + 1] - Q[k + 1]) * alpha, Q[k + 2] + (P[k + 2] - Q[k + 2]) * alpha);
        q0.set(Q[k + 3], Q[k + 4], Q[k + 5], Q[k + 6]); q1.set(P[k + 3], P[k + 4], P[k + 5], P[k + 6]); g.quaternion.slerpQuaternions(q0, q1, alpha);
        if (g.userData.glow) { const ch = b.figs[fi].charge; g.userData.glow.material.opacity = ch ? 0.22 + 0.12 * Math.sin(this.time * 30) : 0; g.userData.glow.material.color.setHex(ch > 0 ? 0xff6a4a : 0x5aa0ff); }
      }
      const hg = F.groups[2]; F.tag.position.set(hg.position.x, hg.position.y + 0.55, hg.position.z);
      F.tag.material.opacity = b.figs[fi].mode === 'fallen' ? 0.5 : 1;
    });
    // deck, tiles, pellets, shells, debris
    this.deckGroup.quaternion.set(b.deck[0], b.deck[1], b.deck[2], b.deck[3]);
    this.slab.visible = Math.abs(b.deck[3]) < 0.99995;
    this.drawTiles(b.tiles);
    const M = new THREE.Matrix4(), col = new THREE.Color(); let n = 0;
    for (let i = 0; i < b.pellets.length; i += 4) { M.makeTranslation(b.pellets[i], b.pellets[i + 1], b.pellets[i + 2]); this.pelletMesh.setMatrixAt(n, M); col.setHex(PAINT_HEX[PAINT_IDX[b.pellets[i + 3]]]); this.pelletMesh.setColorAt(n, col); n++; }
    this.pelletMesh.count = n; this.pelletMesh.instanceMatrix.needsUpdate = true; if (this.pelletMesh.instanceColor) this.pelletMesh.instanceColor.needsUpdate = true;
    const seen = new Set();
    for (let i = 0; i < b.debris.length; i += 8) {
      const id = b.debris[i]; seen.add(id); let m = this.debris.get(id); if (!m) { m = new THREE.Mesh(this.debrisGeo, this.debrisMat); m.castShadow = true; this.scene.add(m); this.debris.set(id, m); }
      m.position.set(b.debris[i + 1], b.debris[i + 2], b.debris[i + 3]); m.quaternion.set(b.debris[i + 4], b.debris[i + 5], b.debris[i + 6], b.debris[i + 7]);
    }
    for (const [id, m] of this.debris) if (!seen.has(id)) { this.scene.remove(m); this.debris.delete(id); }
    this.drawShells(b);
    this.drawOmens(b, dt);
    this.updateFx(dt);
    this.updateCamera(b, dt, hud);
    this.skyMat.uniforms.flash.value = this.flash; this.flash *= Math.exp(-dt * 9); this.boltLight.intensity *= Math.exp(-dt * 10);
    this.renderer.render(this.scene, this.camera);
  }
  drawShells(b) {
    const seen = new Set();
    for (const s of b.shells) {
      seen.add(s.id); let m = this.shellMesh.get(s.id);
      if (!m) {
        m = new THREE.Group(); const body = new THREE.Mesh(new THREE.CapsuleGeometry(s.kind === 'slug' ? 0.08 : 0.12, s.kind === 'slug' ? 0.9 : 0.45, 4, 8), new THREE.MeshStandardMaterial({ color: s.kind === 'slug' ? 0xd0d8ff : 0x3c3f2a, emissive: s.kind === 'slug' ? 0x88aaff : 0x000000, emissiveIntensity: 1.5, metalness: 0.6 }));
        m.add(body); m.userData.trail = []; const tl = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: s.kind === 'slug' ? 0x9fc0ff : 0xcfc4b0, transparent: true, opacity: 0.55 })); tl.frustumCulled = false; m.userData.line = tl; this.scene.add(tl);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(s.tgt[0], s.tgt[1] + 0.03, s.tgt[2]); m.userData.ring = ring; this.scene.add(ring);
        this.scene.add(m); this.shellMesh.set(s.id, m);
      }
      const t = s.t, p = [s.p0[0] + s.v0[0] * t, s.p0[1] + s.v0[1] * t + 0.5 * s.g * t * t, s.p0[2] + s.v0[2] * t], v = new THREE.Vector3(s.v0[0], s.v0[1] + s.g * t, s.v0[2]).normalize();
      m.position.set(...p); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
      const tr = m.userData.trail; tr.push(new THREE.Vector3(...p)); if (tr.length > 60) tr.shift(); m.userData.line.geometry.setFromPoints(tr);
      const left = Math.max(0, s.T - t), ring = m.userData.ring; ring.scale.setScalar(Math.max(0.15, s.R * Math.min(1, left / 3))); ring.material.opacity = 0.5 + 0.4 * Math.sin(this.time * (8 + 20 / (left + 0.3)));
    }
    for (const [id, m] of this.shellMesh) if (!seen.has(id)) { this.scene.remove(m, m.userData.line, m.userData.ring); this.shellMesh.delete(id); }
  }
  drawOmens(b, dt) {
    const o = b.omen;
    this.eddy.visible = !!o.eddy; if (o.eddy) { this.eddy.position.set(...o.eddy.c); this.eddy.scale.setScalar(o.eddy.r); this.eddyRings.rotation.y += dt * 0.4; this.eddyRings.rotation.x += dt * 0.15; }
    this.gates.forEach((g, i) => { g.visible = !!o.gates; if (o.gates) { const p = i ? o.gates.b : o.gates.a; g.position.set(p[0], p[1] + 1.0, p[2]); g.rotation.y += dt * (i ? -1.2 : 1.2); g.children[1].material.opacity = 0.7 + 0.2 * Math.sin(this.time * 5 + i); } });
    this.laser.visible = !!o.laser; if (o.laser) { this.laser.position.set(o.laser[0], o.laser[1] + 0.03, o.laser[2]); this.laser.children[0].scale.setScalar(1 + 0.3 * Math.sin(this.time * 18)); }
    this.beam.visible = !!o.ra; if (o.ra) { this.beam.position.set(o.ra.n[0] * o.ra.s, this.summit + 55, o.ra.n[2] * o.ra.s); this.beam.rotation.y = Math.atan2(o.ra.n[0], o.ra.n[2]) + Math.PI / 2; this.beam.material.opacity = 0.25 + 0.08 * Math.sin(this.time * 7); }
    this.pole.visible = !!o.pole; if (o.pole) this.pole.position.set(...o.pole);
    const w = o.wind, ws = Math.hypot(w[0], w[2]); this.sand.material.opacity += ((ws > 0.5 ? 0.55 : 0) - this.sand.material.opacity) * Math.min(1, dt * 2);
    if (this.sand.material.opacity > 0.01) { const a = this.sand.geometry.attributes.position; for (let i = 0; i < a.count; i++) { let x = a.getX(i) + w[0] * dt * 1.3, z = a.getZ(i) + w[2] * dt * 1.3; if (x > 20) x -= 40; if (x < -20) x += 40; if (z > 20) z -= 40; if (z < -20) z += 40; a.setX(i, x); a.setZ(i, z); a.setY(i, a.getY(i) + Math.sin(this.time * 3 + i) * dt * 0.4); } a.needsUpdate = true; }
  }
  // ---------- one-shot effects from simulation events ----------
  event(e, look) {
    const S = this.scene;
    if (e.type === 'strike') {
      const pts = [], from = new THREE.Vector3(...e.from), to = new THREE.Vector3(e.to.x, e.to.y, e.to.z), N = 14;
      for (let i = 0; i <= N; i++) { const p = from.clone().lerp(to, i / N); if (i && i < N) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.7)); pts.push(p); }
      const sky = [new THREE.Vector3(from.x + 3, from.y + 60, from.z - 2), from.clone().add(new THREE.Vector3(1, 25, 0)), from];
      for (const set of [sky, pts]) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(set), new THREE.LineBasicMaterial({ color: 0xeef4ff, transparent: true })); S.add(l); this.fx.push({ t: 0, life: 0.45, obj: l, fade: true }); }
      this.boltLight.position.copy(from); this.boltLight.intensity = 400; this.flash = 0.8; this.shake = Math.max(this.shake, 0.6);
    } else if (e.type === 'explode') {
      const at = new THREE.Vector3(...e.at), big = e.kind === 'slug' ? 1.3 : 1;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: e.kind === 'slug' ? 0xcfe0ff : 0xffb040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); ball.position.copy(at); S.add(ball);
      this.fx.push({ t: 0, life: 0.6, obj: ball, grow: e.R * 0.9 * big, fade: true });
      for (let i = 0; i < 18; i++) {   // dust and smoke: soft sprites that rise and thin out
        const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex(), color: i % 3 ? 0xb8a488 : 0x6a5a48, transparent: true, depthWrite: false, opacity: 0.7 }));
        p.position.copy(at); const sz = 0.8 + Math.random() * 1.2; p.scale.set(sz, sz, 1);
        const v = new THREE.Vector3((Math.random() - 0.5) * 7, 1.5 + Math.random() * 4, (Math.random() - 0.5) * 7); S.add(p); this.fx.push({ t: 0, life: 1.6 + Math.random() * 1.4, obj: p, vel: v, drag: 2.2, fade: true, grow2: 1.6, base: sz }); }
      this.flash = Math.max(this.flash, 0.35); this.shake = Math.max(this.shake, 1.0 * big);
    } else if (e.type === 'hit') {
      const F = this.figs[e.fig], g = F.groups[this.figOrder.indexOf(e.part)];
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.06 + Math.random() * 0.03, 10, 8), new THREE.MeshStandardMaterial({ color: PAINT_HEX[e.paint], roughness: 0.35 }));
      s.position.set(...e.local); s.scale.set(1, 0.45, 1); g.add(s); F.splats.push([g, s]); if (F.splats.length > 40) { const [pg, ps] = F.splats.shift(); pg.remove(ps); }
      this.burst(e.at, PAINT_HEX[e.paint], 10, 2.5);
    } else if (e.type === 'paint' || e.type === 'splat') this.burst(e.at, PAINT_HEX[e.paint], 6, 1.6);
    else if (e.type === 'fire') { this.burst(e.pos, 0xffffff, 3, 1.2, 0.15); }
    else if (e.type === 'shove') { this.shake = Math.max(this.shake, 0.25); this.burst(e.at, 0xffe9b0, 12, 3); }
    else if (e.type === 'teleport') { for (const p of [e.from, e.to]) this.burst([p[0], p[1] + 1, p[2]], 0xc070ff, 30, 4); }
    else if (e.type === 'sunhit') this.flash = Math.max(this.flash, 0.25);
  }
  puffTex() {
    if (this._puff) return this._puff; const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    this._puff = new THREE.CanvasTexture(c); return this._puff;
  }
  burst(at, color, n, sp, life = 0.6) {
    for (let i = 0; i < n; i++) { const p = new THREE.Mesh(this.dotGeo || (this.dotGeo = new THREE.SphereGeometry(0.03, 6, 4)), new THREE.MeshBasicMaterial({ color, transparent: true })); p.position.set(at[0], at[1], at[2]);
      this.scene.add(p); this.fx.push({ t: 0, life: life + Math.random() * 0.4, obj: p, vel: new THREE.Vector3((Math.random() - 0.5) * sp, Math.random() * sp, (Math.random() - 0.5) * sp), grav: 9.8, fade: true }); }
  }
  updateFx(dt) {
    for (const f of this.fx) {
      f.t += dt; const u = f.t / f.life, o = f.obj;
      if (f.vel) { if (f.grav) f.vel.y -= f.grav * dt; if (f.drag) f.vel.multiplyScalar(Math.exp(-f.drag * dt)); o.position.addScaledVector(f.vel, dt); }
      if (f.grow) o.scale.setScalar(0.3 + f.grow * Math.sqrt(u));
      if (f.grow2) { const k = (f.base || 1) * (1 + f.grow2 * u); o.scale.set(k, k, k); }
      if (f.fade && o.material) o.material.opacity = Math.max(0, 1 - u);
    }
    this.fx = this.fx.filter(f => { if (f.t < f.life) return true; this.scene.remove(f.obj); f.obj.geometry !== this.dotGeo && f.obj.geometry?.dispose(); f.obj.material?.dispose(); return false; });
  }
  // ---------- cameras ----------
  bindOrbit() {
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; if (Math.abs(dx) + Math.abs(dy) > 1 && this.cam.mode === 'auto') this.cam.mode = 'orbit'; this.cam.yaw -= dx * 0.006; this.cam.pitch = Math.max(-0.2, Math.min(1.3, this.cam.pitch + dy * 0.004)); this.onCam?.(this.cam.mode); });
    addEventListener('pointerup', () => { drag = null; });
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.dist = Math.max(3, Math.min(600, this.cam.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  }
  updateCamera(b, dt, hud) {
    const C = this.cam, figs = b.figs, focus = new THREE.Vector3(), desired = new THREE.Vector3(), look = new THREE.Vector3();
    const pel = (i) => new THREE.Vector3(b.poses[i * 77], b.poses[i * 77 + 1], b.poses[i * 77 + 2]);
    const fall = hud && hud.fall, mode = fall && C.mode === 'auto' ? 'fall' : C.mode;
    C.shotT += dt;
    if (mode === 'fall') {
      const f = pel(fall.fig), out = Math.abs(f.x) > Math.abs(f.z) ? new THREE.Vector3(Math.sign(f.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(f.z)), side = new THREE.Vector3(-out.z, 0, out.x);
      const shots = [() => f.clone().addScaledVector(out, 7).addScaledVector(side, 3).add(new THREE.Vector3(0, 3, 0)), () => f.clone().addScaledVector(side, 11).addScaledVector(out, 3).add(new THREE.Vector3(0, 1.5, 0)),
        () => new THREE.Vector3(f.x, 1.7, f.z).addScaledVector(out, Math.max(14, Math.abs(f.x) + Math.abs(f.z) - 100)).addScaledVector(side, 6), () => f.clone().add(new THREE.Vector3(0, 9, 0)).addScaledVector(out, 2.5)];
      if (C.shotT > (fall.cut || 3.5)) { C.shot = (C.shot + 1 + Math.floor(Math.random() * 3)) % shots.length; C.shotT = 0; C.snap = true; }
      desired.copy(shots[C.shot]()); look.copy(f);
    } else if (mode === 'chase0' || mode === 'chase1') {
      const f = pel(mode === 'chase0' ? 0 : 1), o = pel(mode === 'chase0' ? 1 : 0), d = f.clone().sub(o).setY(0).normalize();
      desired.copy(f).addScaledVector(d, 3.2).add(new THREE.Vector3(0, 1.3, 0)); look.copy(o).add(new THREE.Vector3(0, 0.6, 0));
    } else if (mode === 'base') { desired.set(-16, 3, -150); look.copy(pel(0)).lerp(pel(1), 0.5); }
    else {
      focus.copy(pel(0)).lerp(pel(1), 0.5); if (figs.some(f => f.mode === 'fallen')) focus.set(0, this.summit + 1, 0);
      const sep = pel(0).distanceTo(pel(1));
      if (mode === 'auto') {
        const cx = focus.x + Math.sin(C.yaw) * C.dist, cz = focus.z + Math.cos(C.yaw) * C.dist, ex = focus.x - cx, ez = focus.z - cz, L2 = ex * ex + ez * ez || 1;
        const u = Math.max(0, Math.min(1, -(cx * ex + cz * ez) / L2)), mx = cx + ex * u, mz = cz + ez * u;   // closest point to the mast on the sight line
        C.yaw += dt * (Math.hypot(mx, mz) < 0.9 ? 0.9 : 0.06); C.dist += (Math.max(9, sep * 1.6 + 6) - C.dist) * Math.min(1, dt * 0.8); }
      if (mode === 'duel') { const d = pel(1).sub(pel(0)).setY(0).normalize(); C.yaw = Math.atan2(-d.z, d.x) + Math.PI / 2; }
      desired.set(focus.x + Math.sin(C.yaw) * Math.cos(C.pitch) * C.dist, focus.y + 0.6 + Math.sin(C.pitch) * C.dist, focus.z + Math.cos(C.yaw) * Math.cos(C.pitch) * C.dist); look.copy(focus).add(new THREE.Vector3(0, 0.5, 0));
    }
    const k = C.snap ? 1 : 1 - Math.exp(-dt * (mode === 'fall' ? 4 : 3)); C.snap = false;
    C.pos.lerp(desired, k); C.look.lerp(look, k);
    if (C.pos.lengthSq() === 0) { C.pos.copy(desired); C.look.copy(look); }
    this.camera.position.copy(C.pos); if (this.shake > 0.01) { this.camera.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(this.shake * 0.3)); this.shake *= Math.exp(-dt * 5); }
    this.camera.lookAt(C.look);
    // the sun's shadow box follows the action
    this.sun.target.position.copy(C.look); this.sun.position.copy(C.look).addScaledVector(this.sunDir, -80);
  }
}
