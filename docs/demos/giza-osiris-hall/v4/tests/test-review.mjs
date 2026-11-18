import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {lookAt,sampleTour,colorBlend,fitOrtho,TOUR_STOPS} from '../review-core.mjs';
const close=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
function rotate([x,y,z,angle],v){const c=Math.cos(angle),s=Math.sin(angle),dot=x*v[0]+y*v[1]+z*v[2];return [v[0]*c+(y*v[2]-z*v[1])*s+x*dot*(1-c),v[1]*c+(z*v[0]-x*v[2])*s+y*dot*(1-c),v[2]*c+(x*v[1]-y*v[0])*s+z*dot*(1-c)];}
function checkGaze(position,target,orientation){const d=target.map((x,i)=>x-position[i]),n=Math.hypot(...d),g=rotate(orientation,[0,0,-1]);for(let i=0;i<3;i++)close(g[i],d[i]/n,1e-8);close(Math.hypot(...orientation.slice(0,3)),1);}
test('lookAt handles identity, reverse, vertical and oblique gaze with unit rotation axes',()=>{for(const target of [[0,0,-1],[0,0,1],[0,1,0],[0,-1,0],[3,7,-9],[-1,-.4,2],[1e-10,1,-1e-10]]){const o=lookAt([0,0,0],target);assert.ok(o.every(Number.isFinite));checkGaze([0,0,0],target,o);}});
test('lookAt rejects malformed or coincident vectors',()=>{for(const [p,t]of [[[0,0,0],[0,0,0]],[[NaN,0,0],[0,0,-1]],[[0,0],[0,0,-1]],[[0,0,0],['1',0,0]]])assert.throws(()=>lookAt(p,t));});
test('tour endpoints and dwell preserve authored camera poses without mutating source',()=>{const before=JSON.stringify(TOUR_STOPS);for(const stop of TOUR_STOPS){assert.deepEqual(sampleTour(TOUR_STOPS,stop.t).position,stop.position);assert.deepEqual(sampleTour(TOUR_STOPS,stop.t).target,stop.target);}assert.deepEqual(sampleTour(TOUR_STOPS,-20).position,TOUR_STOPS[0].position);assert.deepEqual(sampleTour(TOUR_STOPS,100).position,TOUR_STOPS.at(-1).position);assert.deepEqual(sampleTour(TOUR_STOPS,.8).position,TOUR_STOPS[0].position);assert.equal(JSON.stringify(TOUR_STOPS),before);});
test('tour samples keep target gaze exact and stay inside each segment bounds',()=>{for(let time=0;time<=68;time+=.17){const s=sampleTour(TOUR_STOPS,time),a=TOUR_STOPS[s.index],b=TOUR_STOPS[Math.min(s.index+1,TOUR_STOPS.length-1)];checkGaze(s.position,s.target,s.orientation);for(const k of ['position','target'])for(let i=0;i<3;i++)assert.ok(s[k][i]>=Math.min(a[k][i],b[k][i])-1e-9&&s[k][i]<=Math.max(a[k][i],b[k][i])+1e-9);}});
test('cuts use preceding stop and linear movement has exact midpoint',()=>{assert.deepEqual(sampleTour(TOUR_STOPS,6.9,{motion:'cuts'}).position,TOUR_STOPS[0].position);assert.deepEqual(sampleTour(TOUR_STOPS,7,{motion:'cuts'}).position,TOUR_STOPS[1].position);const mid=sampleTour(TOUR_STOPS,3.5,{motion:'linear'});mid.position.forEach((v,i)=>close(v,(TOUR_STOPS[0].position[i]+TOUR_STOPS[1].position[i])/2));});
test('tour validation rejects ambiguous times, invalid options and malformed coordinates',()=>{for(const stops of [[],[{},{}],[TOUR_STOPS[0],TOUR_STOPS[0]],[{t:0,position:[0,0,0],target:[0,0,0]}]])assert.throws(()=>sampleTour(stops,0));for(const opts of [{hold:-1},{hold:NaN},{motion:'warp'}])assert.throws(()=>sampleTour(TOUR_STOPS,0,opts));assert.throws(()=>sampleTour(TOUR_STOPS,Infinity));});
test('colour blending has exact endpoints, linear midpoint and immutable inputs',()=>{const a=new Float32Array([0,.2,1]),b=new Float32Array([1,.6,0]);assert.deepEqual(colorBlend(a,b,0),a);assert.deepEqual(colorBlend(a,b,1),b);const m=colorBlend(a,b,.5);close(m[0],.5,1e-7);close(m[1],.4,1e-7);assert.equal(a[0],0);assert.deepEqual(colorBlend(a,b,-4),a);assert.deepEqual(colorBlend(a,b,5),b);for(const args of [[a,[1],.5],[[NaN],[0],.5],[a,b,Infinity]])assert.throws(()=>colorBlend(...args));});
test('orthographic frames fit all bounds at wide, tall and square aspect ratios',()=>{for(const aspect of [.3,1,2.2,4]){const bounds=[-155,-80,155,58],f=fitOrtho(bounds,aspect);close((f[2]-f[0])/(f[3]-f[1]),aspect);assert.ok(f[0]<=bounds[0]&&f[1]<=bounds[1]&&f[2]>=bounds[2]&&f[3]>=bounds[3]);close((f[0]+f[2])/2,0);close((f[1]+f[3])/2,-11);}for(const args of [[[0,0,0,0],1],[[0,0,1,1],0],[[0,0,1,1],1,.9],[[0,NaN,1,1],1]])assert.throws(()=>fitOrtho(...args));});
test('camera manifest tour remains identical to exported source stops',()=>{const data=JSON.parse(fs.readFileSync(new URL('../cameras.json',import.meta.url)));assert.deepEqual(data.tour,TOUR_STOPS);assert.equal(Object.keys(data.views).length,16);});

test('all sixteen authored Giza cameras have finite poses, valid FOV and target-aligned gaze',()=>{
 const {views}=JSON.parse(fs.readFileSync(new URL('../cameras.json',import.meta.url)));
 assert.equal(views.length,16);assert.equal(new Set(views.map(v=>v.id)).size,16);
 for(const view of views){
  for(const key of ['position','target','orientation'])assert.ok(view[key].every(Number.isFinite),`${view.id} ${key}`);
  assert.equal(view.position.length,3);assert.equal(view.target.length,3);assert.equal(view.orientation.length,4);
  assert.ok(view.fov>0&&view.fov<Math.PI,view.id);
  const axisLength=Math.hypot(...view.orientation.slice(0,3));close(axisLength,1,1e-4);
  const rotation=[...view.orientation.slice(0,3).map(v=>v/axisLength),view.orientation[3]];
  const actual=rotate(rotation,[0,0,-1]),delta=view.target.map((v,i)=>v-view.position[i]),distance=Math.hypot(...delta),desired=delta.map(v=>v/distance);
  const angle=Math.acos(Math.max(-1,Math.min(1,actual.reduce((sum,v,i)=>sum+v*desired[i],0))));
  // Source XML rounds axis-angle values to four significant digits.
  assert.ok(angle<.0003,`${view.id} points ${(angle*180/Math.PI).toFixed(5)} degrees away`);
  const up=rotate(rotation,[0,1,0]),right=rotate(rotation,[1,0,0]);
  assert.ok(Math.abs(right[1])<.0001,`${view.id} has unexpected roll`);
  if(Math.abs(desired[1])<.99999)assert.ok(up[1]>0,`${view.id} is upside down`);
  else assert.ok(up[2]<-.9999,`${view.id} vertical gaze must keep north toward screen top`);
 }
});

test('Hawara cameras fit the complete scene at narrow, square and wide aspect, including depth minus70',async()=>{
 const {hawaraCamera,hawaraScene}=await import('../hawara.mjs');
 const corners=[];for(const x of [-155,155])for(const y of [-77.5,58])for(const z of [-267,125])corners.push([x,y,z]);
 for(const aspect of [.4,1,2.4])for(const view of ['plan','section','oblique']){
  const c=hawaraCamera(view,aspect);assert.ok([...c.position,...c.target,...c.orientation].every(Number.isFinite));checkGaze(c.position,c.target,c.orientation);
  const inverse=[...c.orientation.slice(0,3),-c.orientation[3]];
  const points=corners.map(p=>rotate(inverse,p.map((v,i)=>v-c.position[i])));
  if(view==='oblique'){
   const horizontal=Math.tan(c.fov/2)*Math.max(1,aspect),vertical=Math.tan(c.fov/2)/Math.min(1,aspect);
   for(const [x,y,z]of points){assert.ok(z<0);assert.ok(Math.abs(x)/-z<horizontal,`oblique horizontal crop at aspect ${aspect}`);assert.ok(Math.abs(y)/-z<vertical,`oblique vertical crop at aspect ${aspect}`);}
  }else{
   const [left,bottom,right,top]=c.fov;close((right-left)/(top-bottom),aspect);
   for(const [x,y]of points){assert.ok(x>=left-1e-8&&x<=right+1e-8,`${view} horizontal crop`);assert.ok(y>=bottom-1e-8&&y<=top+1e-8,`${view} vertical crop`);}
  }
  const xml=hawaraScene({view,aspect,depth:-70,lower:true});
  assert.match(xml,/DEF='H_Camera'/);assert.match(xml,/DEF='H_LowerRig' translation='0 -70 0'/);
  assert.ok(!xml.includes('NaN')&&!xml.includes('Infinity'));
 }
});
