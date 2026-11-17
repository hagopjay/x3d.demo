'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const Sky = require('../sky-math.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../stars_v2.json'), 'utf8'));
const model = Sky.createModel(data), { DEG, RAD } = Sky;
const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b} by more than ${tolerance}`);
const norm = v => Math.hypot(...v);
const vector = (raHours, decDeg) => [Math.cos(decDeg * DEG) * Math.cos(raHours * Math.PI / 12), Math.cos(decDeg * DEG) * Math.sin(raHours * Math.PI / 12), Math.sin(decDeg * DEG)];
const mul = (m, v) => [m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
const zrot = a => [Math.cos(a),-Math.sin(a),0,Math.sin(a),Math.cos(a),0,0,0,1];
function proper(m) {
 const rows = [m.slice(0,3),m.slice(3,6),m.slice(6,9)];
 for(let i=0;i<3;i++){near(norm(rows[i]),1,1e-12);for(let j=i+1;j<3;j++)near(rows[i].reduce((s,x,k)=>s+x*rows[j][k],0),0,1e-12);}
 const det = m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);near(det,1,1e-12);
}

test('astronomical years map to BCE/CE without a historical year zero', () => {
 assert.equal(Sky.formatYear(1),'1 CE');assert.equal(Sky.formatYear(0),'1 BCE');assert.equal(Sky.formatYear(-1),'2 BCE');assert.equal(Sky.formatYear(-10499),'10500 BCE');assert.equal(Sky.formatYear(-10500),'10501 BCE');
 assert.throws(()=>Sky.formatYear(NaN),/finite/);assert.throws(()=>Sky.formatYear(Number.MAX_VALUE),/safe/);
});
test('supplied sample range and catalogue counts are read rather than invented', () => {
 assert.equal(model.minEpoch,-13000);assert.equal(model.maxEpoch,2100);assert.equal(model.sampleCount,152);assert.equal(data.field.length,978);assert.equal(data.named.length,40);
});
test('every rounded sample anchor becomes a nearby proper rotation', () => {
 for(let i=0;i<data.epochs.length;i++){
  const r=model.matrixAt(data.epochs[i]);assert.equal(r.interpolated,false);assert.equal(r.lowerEpoch,data.epochs[i]);assert.equal(r.upperEpoch,data.epochs[i]);proper(r.matrix);
  assert.ok(r.matrix.every((v,k)=>Math.abs(v-data.mats[i][k])<2e-6));
 }
});
test('every between-sample midpoint remains orthonormal and preserves vector lengths', () => {
 for(let i=0;i<data.epochs.length-1;i++){
  const epoch=(data.epochs[i]+data.epochs[i+1])/2,r=model.matrixAt(epoch);assert.equal(r.interpolated,true);near(r.t,.5);proper(r.matrix);near(norm(mul(r.matrix,[.2,-.3,.9])),Math.sqrt(.94),1e-12);
 }
});
test('epoch changes remain continuous across an old nearest-century jump', () => {
 const a=model.matrixAt(-10550-.001).matrix,b=model.matrixAt(-10550+.001).matrix;
 assert.ok(Sky.angularSeparation(mul(a,[1,0,0]),mul(b,[1,0,0]))<1e-5);
 const anchors=Sky.angularSeparation(mul(model.matrixAt(-10600).matrix,[1,0,0]),mul(model.matrixAt(-10500).matrix,[1,0,0]));assert.ok(anchors>.01);
});
test('SLERP follows the short rotation arc through the 180-degree boundary', () => {
 const m=Sky.createModel({epochs:[0,1],mats:[zrot(170*DEG),zrot(-170*DEG)]}).matrixAt(.5).matrix;const out=mul(m,[1,0,0]);near(out[0],-1,1e-12);near(out[1],0,1e-12);proper(m);
});
test('out-of-range epochs explicitly clamp or reject and cannot mutate cached samples', () => {
 const r=model.matrixAt(-14000);assert.equal(r.clamped,true);assert.equal(r.requestedEpoch,-14000);assert.equal(r.epoch,-13000);assert.throws(()=>model.matrixAt(-14000,{outOfRange:'error'}),/within/);assert.throws(()=>model.matrixAt(Infinity),/finite/);
 const before=model.matrixAt(2000).matrix[0];model.matrixAt(2000).matrix[0]=123;near(model.matrixAt(2000).matrix[0],before);
});
test('invalid epoch tables and improper or heavily deformed rotations are rejected', () => {
 assert.throws(()=>Sky.createModel({epochs:[1,0],mats:[zrot(0),zrot(1)]}),/increase/);
 assert.throws(()=>Sky.createModel({epochs:[0,1],mats:[zrot(0),[-1,0,0,0,1,0,0,0,1]]}),/proper/);
 assert.throws(()=>Sky.createModel({epochs:[0,1],mats:[zrot(0),[2,0,0,0,1,0,0,0,1]]}),/proper/);
});
test('equatorial cardinal directions match north-clockwise azimuth and X3D east/up/south', () => {
 const east=Sky.horizontal(vector(0,0),18,0),west=Sky.horizontal(vector(0,0),6,0),north=Sky.horizontal(vector(0,90),0,0);
 near(east.alt,0);near(east.az,90*DEG);near(west.alt,0);near(west.az,270*DEG);near(north.alt,0);near(north.az,0);
 const ex=Sky.toXYZ(east,10),wx=Sky.toXYZ(west,10),nx=Sky.toXYZ(north,10);near(ex[0],10);near(wx[0],-10);near(nx[2],-10);
});
test('upper transit is not incorrectly mirrored for a north-of-zenith star', () => {
 near(Sky.meridianAltitude(80*DEG,30),40);near(Sky.meridianAltitude(-20*DEG,30),40);near(Sky.horizontal(vector(2,80),2,30).alt*RAD,40);
 near(Sky.meridianAltitude(30*DEG,30),90);near(Sky.meridianAltitude(-90*DEG,30),-30);
});
test('LST is periodic and normalized vectors avoid asin rounding failures', () => {
 const a=Sky.horizontal([0,0,1.0000001],-1,30),b=Sky.horizontal([0,0,1],23,30);near(a.alt,b.alt);near(a.az,b.az);near(a.lstHours,23);
 const z=Sky.horizontal(vector(4,30),4,30);assert.equal(z.azUndefined,true);near(z.alt,Math.PI/2,2e-8);near(norm(Sky.toXYZ(z,4500)),4500,1e-9);
});
test('geometric rise/set crossings evaluate back onto the chosen horizon', () => {
 for(const dec of [-40,0,50]){
  const v=vector(6,dec),r=Sky.rising(v,29.9753);assert.equal(r.status,'rises-and-sets');near(Sky.horizontal(v,r.risingLST,29.9753).alt,0,1e-12);near(Sky.horizontal(v,r.settingLST,29.9753).alt,0,1e-12);assert.ok(r.risingAzimuthDeg<180);assert.ok(r.settingAzimuthDeg>180);
 }
 const r=Sky.rising(vector(6,0),30,5);near(Sky.horizontal(vector(6,0),r.risingLST,30).alt*RAD,5,1e-10);
});
test('circumpolar, never-rising, and grazing cases return no fabricated rising time', () => {
 const above=Sky.rising(vector(6,80),30),below=Sky.rising(vector(6,-80),30),grazes=Sky.rising(vector(6,-60),30);
 assert.equal(above.status,'always-above');assert.equal(below.status,'always-below');assert.equal(grazes.status,'grazes');
 for(const r of [above,below,grazes]){assert.equal(r.risingLST,null);assert.equal(r.settingLST,null);}
 near(grazes.tangentLST,6);assert.equal(Sky.rising(vector(6,0),90).status,'grazes');
});
test('named-star sample anchors retain the independently shipped rounded reference values', () => {
 for(const [epoch,refs]of Object.entries(data.info))for(const [name,expected]of Object.entries(refs)){
  const s=data.named.find(x=>x.n===name),d=Sky.dated(s.v,model.matrixAt(Number(epoch)).matrix),eq=Sky.equatorial(d);
  near(eq.dec*RAD,expected.dec,.015);near(eq.ra*12/Math.PI,expected.ra_h,.0015);near(Sky.meridianAltitude(eq.dec),expected.culm_alt,.11);
 }
});
test('invalid public numeric inputs fail explicitly instead of leaking NaNs', () => {
 assert.throws(()=>Sky.horizontal([0,0,0],0),/zero/);assert.throws(()=>Sky.horizontal([1,0,0],NaN),/finite/);assert.throws(()=>Sky.horizontal([1,0,0],0,91),/latitude/);assert.throws(()=>Sky.toXYZ({alt:0,az:0},-1),/nonnegative/);assert.throws(()=>Sky.rising([1,0,0],30,91),/horizon/);assert.throws(()=>Sky.dated([1,0,0],[NaN]),/nine/);
});
test('the exported limitations never claim civil-time, proper-motion, or archaeological intent calculations', () => {
 assert.ok(Sky.LIMITATIONS.omitted.includes('proper motion'));assert.ok(Sky.LIMITATIONS.omitted.includes('solar ephemeris'));assert.match(Sky.LIMITATIONS.siderealTime,/not civil time/);assert.match(Sky.LIMITATIONS.interpretation,/cannot establish/);
});

test('normalization remains finite for extreme nonzero finite vector scales', () => {
 const a=Sky.horizontal([Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE],0),b=Sky.horizontal([1,1,1],0),tiny=Sky.horizontal([1e-300,1e-300,1e-300],0);
 near(a.alt,b.alt);near(a.az,b.az);near(tiny.alt,b.alt);near(tiny.az,b.az);near(Sky.angularSeparation([Number.MAX_VALUE,Number.MAX_VALUE,0],[1,1,0]),0);
});
