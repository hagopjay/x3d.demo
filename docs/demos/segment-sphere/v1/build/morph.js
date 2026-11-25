ecmascript:
// Segment Sphere morph engine. The hot math lives inside ENG (a closure), so every name it touches is a local
// variable: free names at Script top level resolve through the browser's field scope, which costs ~10x per lookup.
var ENG = null, t0 = -1, m = 0, target = 1, tumble = 0, flow = 0, spin = true, sel = -1, hov = -1, dirty = true, fiberOn = false;
var frames = 0, msAcc = 0, FAST = true;
function plain(mf) { var a = []; for (var i = 0; i < mf.length; i++) a.push(mf[i]); return a; }
function makeEngine(sLon, sRing, sStat, sPh, cNV, cA0, cSp, FN, TN) {
  var sin = Math.sin, cos = Math.cos, sqrt = Math.sqrt, tanh = Math.tanh, max = Math.max, PI = Math.PI;
  var D2R = PI / 180, R = 6.0, RM = 24, RT = [40, 90, 140], RH = [35, 70, 105], TH0 = 10, TH1 = 170, NU = 10;
  var LIFE = [1.02, 1.14, 0.88, 0.0], GS = [0.15, 0.26, 0.15, 0.12], WZ = [0.1, 0.6, -0.4, -2.6], WR = [2.04, 4.44, 6.84];
  var OCT = [1,0,0, -1,0,0, 0,1,0, 0,-1,0, 0,0,1, 0,0,-1];
  var NS = sLon.length, np = 0, c;
  for (c = 0; c < cNV.length; c++) np += (NU + 1) * (cNV[c] + 1);
  var PB = new Float32Array(np * 3), GB = new Float32Array(NS * 18), HB = new Float32Array(NS * 3), GP = new Float32Array(NS * 3);
  var FB = new Float32Array(NS * FN * 3), TB = new Float32Array(3 * TN * TN * 3);
  var A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], O = [0, 0, 0];
  function ease(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
  function sph(th, ph, r, o) { var t = th * D2R, p = ph * D2R, st = sin(t); o[0] = r * st * sin(p); o[1] = r * st * cos(p); o[2] = r * cos(t); }
  function wheel(r, ph, z, o) { var p = ph * D2R; o[0] = r * sin(p); o[1] = r * cos(p); o[2] = z; }
  // Hopf fibration: base point (th, ph) on S2 and fiber phase psi -> unit quaternion on S3;
  // isoclinic rotation by beta in the (x1,x3) and (x2,x4) planes (maps fibers to fibers);
  // stereographic projection from (0,0,0,1); soft horizon RM*tanh(r/RM) so arcs through infinity hug a far sphere.
  function hopf(th, ph, psi, cb, sb, o) {
    var h = th * D2R * 0.5, p = ph * D2R, ch = cos(h), shh = sin(h);
    var a = ch * cos(psi), b = ch * sin(psi), cc = shh * cos(psi + p), d = shh * sin(psi + p);
    var a2 = cb * a - sb * cc, c2 = sb * a + cb * cc, b2 = cb * b - sb * d, d2 = sb * b + cb * d;
    var k = 3.0 / max(1 - d2, 1e-4), x = a2 * k, y = c2 * k, z = b2 * k, L = sqrt(x * x + y * y + z * z);
    if (L > 1e-6) { var s = RM * tanh(L / RM) / L; x *= s; y *= s; z *= s; }
    o[0] = x; o[1] = y; o[2] = z;
  }
  function mix(w, o) {
    var e;
    if (w <= 1) { e = ease(w); o[0] = A[0] + (B[0] - A[0]) * e; o[1] = A[1] + (B[1] - A[1]) * e; o[2] = A[2] + (B[2] - A[2]) * e; }
    else { e = ease(w - 1); o[0] = B[0] + (C[0] - B[0]) * e; o[1] = B[1] + (C[1] - B[1]) * e; o[2] = B[2] + (C[2] - B[2]) * e; }
  }
  function frame(w, beta, flow, sel, hov) {
    var cb = cos(beta), sb = sin(beta), k = 0, iu, iv, i, j, t;
    for (c = 0; c < cNV.length; c++) {
      var nv = cNV[c], a0 = cA0[c], sp = cSp[c], mid = a0 + sp / 2;
      for (iu = 0; iu <= NU; iu++) {
        var u = iu / NU, th = TH0 + (TH1 - TH0) * u, rw = 1.9 + (9.25 - 1.9) * u, thH = 25 + (115 - 25) * u;
        for (iv = 0; iv <= nv; iv++) {
          var ph = a0 + sp * iv / nv;
          wheel(rw, ph, 0, A); sph(th, ph, R * 0.995, B);
          if (w > 1) hopf(thH, mid, 2 * PI * iv / nv, cb, sb, C);
          mix(w, O); PB[k++] = O[0]; PB[k++] = O[1]; PB[k++] = O[2];
        }
      }
    }
    k = 0;
    for (i = 0; i < NS; i++) {
      var st = sStat[i], rg = sRing[i];
      wheel(WR[rg], sLon[i], WZ[st], A);
      sph(RT[rg], sLon[i], st == 3 ? 2.35 : R * LIFE[st], B);
      if (w > 1) hopf(RH[rg], sLon[i], sPh[i] + flow, cb, sb, C);
      mix(w, O);
      GP[3 * i] = HB[3 * i] = O[0]; GP[3 * i + 1] = HB[3 * i + 1] = O[1]; GP[3 * i + 2] = HB[3 * i + 2] = O[2];
      var s = GS[st] * (i == sel ? 2.2 : i == hov ? 1.6 : 1) * (w > 1 ? 1 + 0.9 * ease(w - 1) : 1), zs = st == 1 ? 1.6 : 1;
      for (j = 0; j < 6; j++) { GB[k++] = O[0] + OCT[3 * j] * s; GB[k++] = O[1] + OCT[3 * j + 1] * s; GB[k++] = O[2] + OCT[3 * j + 2] * s * zs; }
    }
    if (w > 1.02) {
      k = 0;
      for (i = 0; i < NS; i++) for (j = 0; j < FN; j++) { hopf(RH[sRing[i]], sLon[i], 2 * PI * j / FN, cb, sb, O); FB[k++] = O[0]; FB[k++] = O[1]; FB[k++] = O[2]; }
      k = 0;
      for (t = 0; t < 3; t++) for (iu = 0; iu < TN; iu++) for (iv = 0; iv < TN; iv++) { hopf(RH[t], 360 * iu / TN, 2 * PI * iv / TN, cb, sb, O); TB[k++] = O[0]; TB[k++] = O[1]; TB[k++] = O[2]; }
    }
  }
  function nearest(x, y, z) {
    var best = -1, bd = 1e9;
    for (var i = 0; i < NS; i++) { var dx = GP[3 * i] - x, dy = GP[3 * i + 1] - y, dz = GP[3 * i + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = i; } }
    return bd < 1.0 ? best : -1;
  }
  return { frame: frame, nearest: nearest, ease: ease, PB: PB, GB: GB, HB: HB, GP: GP, FB: FB, TB: TB, NS: NS };
}
function setPts(node, arr) {
  // X_ITE: MFVec3f.setValue(Float32Array) copies a flat array in one call; other browsers take the portable path.
  if (FAST) { try { node.point.setValue(arr); return; } catch (e) { FAST = false; Browser.println('segment-sphere: portable point path (' + e + ')'); } }
  var n = arr.length / 3, mf = new MFVec3f(); mf.length = n;
  for (var i = 0; i < n; i++) mf[i] = new SFVec3f(arr[3 * i], arr[3 * i + 1], arr[3 * i + 2]);
  node.point = mf;
}
function initialize() {
  ENG = makeEngine(plain(svcLon), plain(svcRing), plain(svcStatus), plain(svcPhase), plain(catNV), plain(catA0), plain(catSpan), fibN, torN);
}
function rebuild() {
  var E = ENG, w = m;
  E.frame(w, tumble, flow, sel, hov);
  setPts(patchCoord, E.PB); setPts(gemCoord, E.GB); setPts(haloCoord, E.HB);
  var on = w > 1.02;
  if (on) {
    setPts(fiberCoord, E.FB); setPts(torusCoord, E.TB);
    var fade = 1 - E.ease(w - 1);
    fiberMat.transparency = 0.25 + 0.75 * fade; torusMat.transparency = 0.72 + 0.28 * fade;
  }
  if (on != fiberOn) { hopfSwitch.whichChoice = on ? 0 : -1; fiberOn = on; }
  patchMat.transparency = w <= 1 ? 0.22 : 0.22 + 0.78 * E.ease(w - 1);  // the fibers carry the bands in S3
  var lab = Math.abs(w) < 0.01 ? 0 : Math.abs(w - 1) < 0.01 ? 1 : -1;
  if (labelSwitch.whichChoice != lab) labelSwitch.whichChoice = lab;
  if (sel >= 0) selT.translation = new SFVec3f(E.GP[3 * sel], E.GP[3 * sel + 1], E.GP[3 * sel + 2]);
  if (hov >= 0) hovT.translation = new SFVec3f(E.GP[3 * hov], E.GP[3 * hov + 1], E.GP[3 * hov + 2]);
  mode_changed = w;
}
function set_time(v, ts) {
  var dt = t0 < 0 ? 0 : Math.min(v - t0, 0.1); t0 = v;
  var go = false;
  if (Math.abs(m - target) > 1e-4) { var sp = 0.55 * dt; m = Math.abs(target - m) < sp ? target : m + (target > m ? sp : -sp); go = true; }
  if (m > 1.02) { flow += dt * 0.35; if (spin) tumble += dt * 0.07; go = true; }
  if (go || dirty) {
    var q = Date.now(); rebuild(); dirty = false; msAcc += Date.now() - q; frames++;
    if (frames % 10 == 0) { stats_changed = msAcc / 10; msAcc = 0; }
  }
}
function set_mode(v, ts) { target = v < 0 ? 0 : v > 2 ? 2 : v; }
function set_jump(v, ts) { target = m = v < 0 ? 0 : v > 2 ? 2 : v; dirty = true; }
function set_spin(v, ts) { spin = v; }
function set_hit(p, ts) {
  var h = ENG.nearest(p.x, p.y, p.z);
  if (h != hov) { hov = h; hover_changed = h; hovSwitch.whichChoice = h >= 0 ? 0 : -1; if (h >= 0) hovText.string = new MFString(svcName[h]); dirty = true; }
}
function set_click(v, ts) { if (hov >= 0) set_select(hov, ts); }
function set_select(v, ts) { sel = v; selected_changed = v; selSwitch.whichChoice = v >= 0 ? 0 : -1; if (v >= 0) selText.string = new MFString(svcName[v], catName[svcCat[v]]); dirty = true; }
