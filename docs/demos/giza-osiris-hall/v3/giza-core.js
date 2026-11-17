/* Shared data/session contracts. The scene is metric, RH, +X east,+Y up,+Z south. */
(function(G){
'use strict';
function finite(value,name,min=-1e7,max=1e7){const n=Number(value);if(typeof value!=='number'||!Number.isFinite(n)||n<min||n>max)throw new Error(`${name} must be finite and within [${min},${max}]`);return n;}
function validateStates(states,bytes){
 if(!states||!Array.isArray(states.meshes)||!states.meshes.length||!Array.isArray(states.states)||!states.states.length)throw new Error('Invalid baked-light manifest');
 const names=new Set(),ids=new Set();let stride=0;
 for(const m of states.meshes){if(!m||typeof m.name!=='string'||!/^\w+$/.test(m.name)||names.has(m.name)||!Number.isSafeInteger(m.n)||m.n<1||m.n>2000000)throw new Error('Invalid or duplicate baked mesh');names.add(m.name);stride+=m.n*3;}
 for(const s of states.states){if(!s||typeof s.id!=='string'||ids.has(s.id)||!['sunrise','midday','afternoon','night'].includes(s.id))throw new Error('Invalid or duplicate lighting state');ids.add(s.id);}
 if(ids.size!==4)throw new Error('All four named lighting states are required');
 const size=bytes instanceof Uint8Array?bytes.byteLength:bytes;
 const expected=stride*states.states.length;
 if(!Number.isSafeInteger(expected)||expected>64000000||size!==expected||states.bytes!==expected)throw new Error(`Baked-light byte count mismatch: expected ${expected}, received ${size}`);
 return {stride,bytes:expected,vertices:stride/3,states:states.states.length,meshes:states.meshes.length};
}
function decodeState(states,bytes,id){
 const meta=validateStates(states,bytes),i=states.states.findIndex(s=>s.id===id);if(i<0)throw new Error('Unknown lighting state');
 let offset=i*meta.stride;const out={};
 for(const mesh of states.meshes){const colors=new Float32Array(mesh.n*3);for(let j=0;j<colors.length;j++)colors[j]=bytes[offset+j]/255;offset+=colors.length;out[mesh.name]=colors;}
 return out;
}
function vector(value,n,name){if(!Array.isArray(value)||value.length!==n)throw new Error(`${name} must contain ${n} numbers`);return value.map((x,i)=>finite(x,`${name}[${i}]`));}
function camera(value){
 if(!value)return null;const position=vector(value.position,3,'camera position'),center=vector(value.center,3,'camera centre'),rotation=vector(value.orientation,4,'camera orientation');
 const length=Math.hypot(...rotation.slice(0,3));if(length<1e-10&&Math.abs(rotation[3])>1e-8)throw new Error('Nonzero camera rotation needs an axis');
 const orientation=length<1e-10?[0,1,0,0]:[rotation[0]/length,rotation[1]/length,rotation[2]/length,rotation[3]];
 const fov=finite(value.fov??.8,'camera FOV',0,Math.PI);if(fov<=0||fov>=Math.PI)throw new Error('Camera FOV must lie strictly between 0 and pi');
 return {position,center,orientation,fov};
}
function cameraFromMatrix(matrix, distance=10, fov=.8){
 const m=Array.from(matrix);if(m.length!==16||!m.every(Number.isFinite))throw new Error('Camera matrix must contain 16 finite values');
 const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];
 const trace=a+e+i;let x,y,z,w;
 if(trace>0){const s=Math.sqrt(trace+1)*2;w=.25*s;x=(h-f)/s;y=(c-g)/s;z=(d-b)/s;}
 else if(a>e&&a>i){const s=Math.sqrt(1+a-e-i)*2;w=(h-f)/s;x=.25*s;y=(b+d)/s;z=(c+g)/s;}
 else if(e>i){const s=Math.sqrt(1+e-a-i)*2;w=(c-g)/s;x=(b+d)/s;y=.25*s;z=(f+h)/s;}
 else{const s=Math.sqrt(1+i-a-e)*2;w=(d-b)/s;x=(c+g)/s;y=(f+h)/s;z=.25*s;}
 const qn=Math.hypot(x,y,z,w);x/=qn;y/=qn;z/=qn;w/=qn;const sn=Math.hypot(x,y,z);
 const orientation=sn<1e-9?[0,1,0,0]:[x/sn,y/sn,z/sn,2*Math.atan2(sn,w)];
 const position=m.slice(12,15),r=Number.isFinite(distance)&&distance>.05?distance:10;
 return camera({position,orientation,center:[position[0]-m[8]*r,position[1]-m[9]*r,position[2]-m[10]*r],fov});
}
function normalizeSession(data,{views,epochMin=-13000,epochMax=2100}={}){
 if(!data||data.schema!=='giza-evidence-atlas-session/v1')throw new Error('This is not a Giza Evidence Atlas session');
 const source=data.state;if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('Session state is missing');
 const bool=(v,f=false)=>typeof v==='boolean'?v:f;
 const light=['sunrise','midday','afternoon','night'].includes(source.light)?source.light:'sunrise';
 const labels=['auto','all','off'].includes(source.labels)?source.labels:'auto';
 const quality=['performance','balanced','ultra'].includes(source.quality)?source.quality:'balanced';
 const view=typeof source.view==='string'&&(!views||views.includes(source.view))?source.view:'V_Overview';
 return {view,light,labels,quality,epoch:finite(source.epoch,'epoch',epochMin,epochMax),lst:((finite(source.lst,'LST',-2400,2400)%24)+24)%24,
  ground:finite(source.ground??.45,'ground transparency',0,.95),pyramid:finite(source.pyramid??0,'pyramid transparency',0,.95),exposure:finite(source.exposure??1,'exposure',.25,2.5),
  layers:{documented:bool(source.layers?.documented,true),theorized:bool(source.layers?.theorized,true),speculative:bool(source.layers?.speculative),orion:bool(source.layers?.orion),gaze:bool(source.layers?.gaze),stars:bool(source.layers?.stars,true)},
  survey:bool(source.survey),scale:bool(source.scale),section:{enabled:bool(source.section?.enabled),z:finite(source.section?.z??-28,'section z',-700,600)},camera:camera(source.camera)};
}
const api={finite,validateStates,decodeState,camera,cameraFromMatrix,normalizeSession};G.GizaCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
