import {Vector2,Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color4} from '@babylonjs/core/Maths/math.color';
import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {ArcRotateCamera} from '@babylonjs/core/Cameras/arcRotateCamera';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import {CreateIcoSphere} from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import {CreatePolyhedron} from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Effect} from '@babylonjs/core/Materials/effect';
import {Constants} from '@babylonjs/core/Engines/constants';
import {SpriteManager} from '@babylonjs/core/Sprites/spriteManager';
import {Sprite} from '@babylonjs/core/Sprites/sprite';
import '@babylonjs/core/Sprites/spriteSceneComponent';
import {DefaultRenderingPipeline} from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
const MeshBuilder={CreateIcoSphere,CreatePolyhedron};
const $=id=>document.getElementById(id);
const hex=h=>[parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255];
Effect.ShadersStore.hgNodeVertexShader=`precision highp float;attribute vec3 position;attribute vec3 normal;attribute vec4 world0;attribute vec4 world1;attribute vec4 world2;attribute vec4 world3;attribute vec4 icol;uniform mat4 viewProjection;uniform mat4 view;varying vec3 vN;varying vec4 vC;varying float vZ;varying vec3 vV;
void main(){mat4 w=mat4(world0,world1,world2,world3);vec4 wp=w*vec4(position,1.0);vec3 n=normalize(mat3(w)*normal);vN=(view*vec4(n,0.0)).xyz;vC=icol;vec4 vp=view*wp;vZ=-vp.z;vV=-normalize(vp.xyz);gl_Position=viewProjection*wp;}`;
Effect.ShadersStore.hgNodeFragmentShader=`precision highp float;varying vec3 vN;varying vec4 vC;varying float vZ;varying vec3 vV;uniform vec2 uFade;
void main(){vec3 n=normalize(vN);float ndl=max(dot(n,normalize(vec3(-0.4,0.6,0.7))),0.0);float fr=pow(1.0-max(dot(n,normalize(vV)),0.0),2.4);vec3 b=vC.rgb;float depth=clamp(1.0-0.5*(vZ-uFade.x)/uFade.y,0.4,1.0);
vec3 col=b*(0.28+0.9*ndl)+b*fr*1.15+vec3(0.10)*fr;col*=mix(0.07,1.0,vC.a)*depth;gl_FragColor=vec4(col,1.0);}`;
Effect.ShadersStore.hgLineVertexShader=`precision highp float;attribute vec3 position;attribute vec4 color;uniform mat4 viewProjection;varying vec4 vCol;void main(){vCol=color;gl_Position=viewProjection*vec4(position,1.0);}`;
Effect.ShadersStore.hgLineFragmentShader=`precision highp float;varying vec4 vCol;void main(){gl_FragColor=vec4(vCol.rgb*vCol.a,vCol.a);}`;
const VN_ORDER=['A','B','C','D','E'];
const TYPE_LABEL={volume:'ECO volumes',family:'Opening families',firstmove:'First move',transposition:'Transposition meeting points',dsa:'DSA',engine:'Engine',bridge:'Bridges (chess to DSA)'};
const TYPE_ALPHA={volume:0,family:.26,firstmove:.10,transposition:.50,dsa:.26,engine:.40,bridge:.55};
const AURA_ALPHA={volume:.007,family:.05,firstmove:0,transposition:.08,dsa:.05,engine:.06,bridge:.07};
const st={a:[0,0,0],lens:4,layer:'both',spin:false,sel:null,selHe:null,hover:null,hq:true,on:{volume:true,family:true,firstmove:false,transposition:true,dsa:true,engine:true,bridge:true},dirty:true};
let D,N,H,engine,scene,cam,nodeMesh,hubMesh,lineMesh,lineMat,sm,sprites=[],pipeline,W=1,Hh=1;
let NM,NC,HM,HC,LP,LC,pos4,P3,SX,SY,SZ,vis,tvis,dimN,tdimN,hvis,hdim,hubP,hCenters,hRad,segs,idxOf={},nbrs=[],heOf=[];
const dpr=Math.min(window.devicePixelRatio||1,2);
function rot(p,a){let [x,y,z,w]=p,c,s;c=Math.cos(a[0]);s=Math.sin(a[0]);[x,w]=[x*c-w*s,x*s+w*c];c=Math.cos(a[1]);s=Math.sin(a[1]);[y,w]=[y*c-w*s,y*s+w*c];c=Math.cos(a[2]);s=Math.sin(a[2]);[z,w]=[z*c-w*s,z*s+w*c];return [x,y,z,w]}
function proj(i){const q=rot([pos4[i*4],pos4[i*4+1],pos4[i*4+2],pos4[i*4+3]],st.a);if(st.lens==2){P3[i*3]=q[0]*1.1;P3[i*3+1]=q[1]*1.1;P3[i*3+2]=0;return}
 if(st.lens==3){P3[i*3]=q[0];P3[i*3+1]=q[1];P3[i*3+2]=q[2];return}const s=.85*Math.exp(-.12*q[3]);P3[i*3]=q[0]*s;P3[i*3+1]=q[1]*s;P3[i*3+2]=q[2]*s}
const layerNode=n=>st.layer=='both'||(st.layer=='dsa'?n.kind=='dsa':n.kind!='dsa');
const layerHe=h=>st.layer=='both'||h.layer==st.layer;
const heOn=h=>layerHe(h)&&st.on[h.type];
function baseR(n){if(n.kind=='eco')return .075+.019*Math.sqrt(n.nl);return n.kind=='dsa'?.17:.18}
function build(){
 N=D.nodes.length;H=D.hes.length;pos4=new Float32Array(N*4);P3=new Float32Array(N*3);SX=new Float32Array(N);SY=new Float32Array(N);SZ=new Float32Array(N);
 vis=new Float32Array(N);tvis=new Float32Array(N);dimN=new Float32Array(N).fill(1);tdimN=new Float32Array(N).fill(1);
 D.nodes.forEach((n,i)=>{idxOf[n.id]=i;pos4.set(n.p,i*4);n.i=i;n.rgb=hex(n.color);heOf[i]=[]});
 D.hes.forEach((h,k)=>{h.k=k;h.mi=h.m.map(m=>idxOf[m]);h.rgb=hex(h.color);h.mi.forEach(i=>heOf[i].push(k))});
 hvis=new Float32Array(H);hdim=new Float32Array(H).fill(1);hubP=new Float32Array(H*3);hRad=new Float32Array(H);
 segs=[];D.hes.forEach(h=>{if(h.spokes||st.on.firstmove)h.mi.forEach(i=>segs.push([h.k,i]))});
 D.hes.forEach(h=>{if(!h.spokes)h.mi.forEach(i=>segs.push([h.k,i]))});
}
function makeScene(){
 const cv=$('cv');engine=new Engine(cv,true,{antialias:true,preserveDrawingBuffer:true,stencil:false},true);
 scene=new Scene(engine);scene.clearColor=new Color4(.012,.016,.035,1);
 cam=new ArcRotateCamera('c',-1.2,1.22,22,Vector3.Zero(),scene);cam.attachControl(cv,true);cam.wheelDeltaPercentage=.012;cam.lowerRadiusLimit=2.5;cam.upperRadiusLimit=90;cam.inertia=.88;cam.panningInertia=.88;cam.minZ=.05;cam.maxZ=400;cam.fov=.8;cam.angularSensibilityX=cam.angularSensibilityY=700;cam.panningSensibility=900;cam.pinchPrecision=60;
 const sph=MeshBuilder.CreateIcoSphere('s',{radius:1,subdivisions:3,flat:false},scene);
 const mat=new ShaderMaterial('nm',scene,'hgNode',{attributes:['position','normal','world0','world1','world2','world3','icol'],uniforms:['viewProjection','view','uFade']});
 sph.material=mat;sph.alwaysSelectAsActiveMesh=true;sph.isPickable=false;nodeMesh=sph;
 const oct=MeshBuilder.CreatePolyhedron('h',{type:1,size:1},scene);oct.material=mat;oct.alwaysSelectAsActiveMesh=true;oct.isPickable=false;hubMesh=oct;
 nodeMesh._mat=mat;
 // lines
 lineMesh=new Mesh('lines',scene);lineMat=new ShaderMaterial('lm',scene,'hgLine',{attributes:['position','color'],uniforms:['viewProjection']});
 lineMat.alpha=.999;lineMat.alphaMode=Constants.ALPHA_ADD;lineMat.backFaceCulling=false;lineMat.disableDepthWrite=true;lineMat.fillMode=Constants.MATERIAL_LineListDrawMode;lineMesh.material=lineMat;lineMesh.hasVertexAlpha=true;lineMesh.alwaysSelectAsActiveMesh=true;lineMesh.isPickable=false;lineMesh.alphaIndex=5;
 const vd=new VertexData();vd.positions=new Float32Array(segs.length*6);vd.colors=new Float32Array(segs.length*8);vd.indices=Array.from({length:segs.length*2},(_,i)=>i);vd.applyToMesh(lineMesh,true);
 // aura sprites
 const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d'),gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.35,'rgba(255,255,255,.35)');gr.addColorStop(.7,'rgba(255,255,255,.08)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);
 sm=new SpriteManager('aura',c.toDataURL(),H,128,scene);sm.blendMode=Constants.ALPHA_ADD;sm.disableDepthWrite=true;sm.isPickable=false;
 D.hes.forEach(h=>{const s=new Sprite('a'+h.k,sm);s.size=.01;s.color.set(h.rgb[0],h.rgb[1],h.rgb[2],0);sprites.push(s)});
 NM=new Float32Array(N*16);NC=new Float32Array(N*4);HM=new Float32Array(H*16);HC=new Float32Array(H*4);LP=new Float32Array(segs.length*6);LC=new Float32Array(segs.length*8);
 nodeMesh.thinInstanceSetBuffer('matrix',NM,16,false);nodeMesh.thinInstanceSetBuffer('icol',NC,4,false);
 hubMesh.thinInstanceSetBuffer('matrix',HM,16,false);hubMesh.thinInstanceSetBuffer('icol',HC,4,false);
 pipeline=new DefaultRenderingPipeline('p',true,scene,[cam]);pipeline.bloomEnabled=true;pipeline.bloomThreshold=.72;pipeline.bloomWeight=.42;pipeline.bloomKernel=56;pipeline.bloomScale=.5;pipeline.fxaaEnabled=true;pipeline.imageProcessingEnabled=true;pipeline.imageProcessing.toneMappingEnabled=true;pipeline.imageProcessing.exposure=1.05;pipeline.imageProcessing.contrast=1.12;
 setQuality(true);
 window.addEventListener('resize',()=>{engine.resize();sizeInfo()});
}
function setQuality(hq){st.hq=hq;engine.setHardwareScalingLevel(1/(hq?dpr:Math.min(dpr,1)));pipeline.bloomEnabled=hq;pipeline.fxaaEnabled=hq;[...document.querySelectorAll('[data-q]')].forEach(b=>b.classList.toggle('on',(b.dataset.q=='hq')==hq))}
function sizeInfo(){const r=$('cv').getBoundingClientRect();W=r.width;Hh=r.height}
function fit(){let c=[0,0,0],n=0;for(let i=0;i<N;i++){if(!layerNode(D.nodes[i]))continue;c[0]+=P3[i*3];c[1]+=P3[i*3+1];c[2]+=P3[i*3+2];n++}if(!n)return;c=c.map(v=>v/n);let m=0;for(let i=0;i<N;i++){if(!layerNode(D.nodes[i]))continue;m=Math.max(m,Math.hypot(P3[i*3]-c[0],P3[i*3+1]-c[1],P3[i*3+2]-c[2]))}
 EXT=m;camAnim={tx:new Vector3(c[0],c[1],c[2]),r:Math.max(6,m/Math.tan(cam.fov/2)*1.0)}}
let LB=[];function mkLabels(){const box=$('labels');for(let i=0;i<64;i++){const d=document.createElement('div');d.className='lb';d.style.display='none';box.appendChild(d);LB.push(d)}}
const mc=document.createElement('canvas').getContext('2d');mc.font='600 11.5px system-ui,sans-serif';const wcache={};const tw=t=>wcache[t]??(wcache[t]=mc.measureText(t).width);
function selSet(){const S=new Set();if(st.sel!=null){S.add(st.sel);heOf[st.sel].forEach(k=>{if(heOn(D.hes[k]))D.hes[k].mi.forEach(i=>S.add(i))})}else if(st.selHe!=null)D.hes[st.selHe].mi.forEach(i=>S.add(i));return S}
function update(){
 const T=st,anySel=T.sel!=null||T.selHe!=null,S=anySel?selSet():null;
 for(let i=0;i<N;i++){tvis[i]=layerNode(D.nodes[i])?1:0;const td=(!anySel||S.has(i))?1:0;vis[i]+=(tvis[i]-vis[i])*KF;dimN[i]+=(td-dimN[i])*KF;proj(i)}
 for(let k=0;k<H;k++){const h=D.hes[k];hvis[k]+=((heOn(h)?1:0)-hvis[k])*KF;const td=!anySel?1:(T.sel!=null?(h.mi.includes(T.sel)?1:.07):(T.selHe==k?1:.07));hdim[k]+=(td-hdim[k])*KF}
 for(let k=0;k<H;k++){const h=D.hes[k];let cx=0,cy=0,cz=0,n=0;for(const i of h.mi){if(!tvis[i])continue;cx+=P3[i*3];cy+=P3[i*3+1];cz+=P3[i*3+2];n++}
  if(n){cx/=n;cy/=n;cz/=n;hubP[k*3]=cx;hubP[k*3+1]=cy;hubP[k*3+2]=cz;let r=0;for(const i of h.mi){if(!tvis[i])continue;r=Math.max(r,Math.hypot(P3[i*3]-cx,P3[i*3+1]-cy,P3[i*3+2]-cz))}hRad[k]=r}}
 for(let i=0;i<N;i++){const n=D.nodes[i],s=baseR(n)*vis[i]*(i==T.sel?1.7:(i==T.hover?1.4:1)),o=i*16;NM[o]=s;NM[o+5]=s;NM[o+10]=s;NM[o+12]=P3[i*3];NM[o+13]=P3[i*3+1];NM[o+14]=P3[i*3+2];NM[o+15]=1;NC[i*4]=n.rgb[0];NC[i*4+1]=n.rgb[1];NC[i*4+2]=n.rgb[2];NC[i*4+3]=(i==T.sel||i==T.hover)?1:dimN[i]}
 nodeMesh.thinInstanceBufferUpdated('matrix');nodeMesh.thinInstanceBufferUpdated('icol');
 for(let k=0;k<H;k++){const h=D.hes[k],s=(h.type=='firstmove'||h.type=='volume'?0:.12)*hvis[k]*(k==T.selHe?1.7:1),o=k*16;HM[o]=s;HM[o+5]=s;HM[o+10]=s;HM[o+12]=hubP[k*3];HM[o+13]=hubP[k*3+1];HM[o+14]=hubP[k*3+2];HM[o+15]=1;HC[k*4]=h.rgb[0];HC[k*4+1]=h.rgb[1];HC[k*4+2]=h.rgb[2];HC[k*4+3]=Math.max(hdim[k],.3)}
 hubMesh.thinInstanceBufferUpdated('matrix');hubMesh.thinInstanceBufferUpdated('icol');
 for(let s=0;s<segs.length;s++){const k=segs[s][0],i=segs[s][1],h=D.hes[k],o=s*6;LP[o]=hubP[k*3];LP[o+1]=hubP[k*3+1];LP[o+2]=hubP[k*3+2];LP[o+3]=P3[i*3];LP[o+4]=P3[i*3+1];LP[o+5]=P3[i*3+2];
  const boost=(T.selHe==k||(T.sel!=null&&h.mi.includes(T.sel)))?1.9:1,a=(TYPE_ALPHA[h.type]||.3)*hvis[k]*vis[i]*(.05+.95*hdim[k])*boost,q=s*8;
  for(let v=0;v<2;v++){LC[q+v*4]=h.rgb[0];LC[q+v*4+1]=h.rgb[1];LC[q+v*4+2]=h.rgb[2];LC[q+v*4+3]=a*(v?.5:1)}}
 lineMesh.updateVerticesData('position',LP);lineMesh.updateVerticesData('color',LC);
 for(let k=0;k<H;k++){const h=D.hes[k],sp=sprites[k],boost=(T.selHe==k||(T.sel!=null&&h.mi.includes(T.sel)))?1.7:1,a=(AURA_ALPHA[h.type]||0)*hvis[k]*(.1+.9*hdim[k])*boost;sp.position.set(hubP[k*3],hubP[k*3+1],hubP[k*3+2]);sp.size=Math.max(.01,hRad[k]*(h.type=='volume'?1.5:2.1)+.45);sp.color.set(h.rgb[0],h.rgb[1],h.rgb[2],Math.min(a,.6))}
 nodeMesh._mat.setVector2('uFade',fadeV);
}
const fadeV=new Vector2(10,20);let EXT=8,KF=.18,KC=.12;
// ---------- labels
function project(){const m=scene.getTransformMatrix().m,w=W,h=Hh;for(let i=0;i<N;i++){const x=P3[i*3],y=P3[i*3+1],z=P3[i*3+2];const cx=x*m[0]+y*m[4]+z*m[8]+m[12],cy=x*m[1]+y*m[5]+z*m[9]+m[13],cw=x*m[3]+y*m[7]+z*m[11]+m[15];if(cw<=0){SX[i]=-1e4;SY[i]=-1e4;SZ[i]=-1;continue}SX[i]=(cx/cw*.5+.5)*w;SY[i]=(1-(cy/cw*.5+.5))*h;SZ[i]=cw}}
function projPt(x,y,z){const m=scene.getTransformMatrix().m;const cx=x*m[0]+y*m[4]+z*m[8]+m[12],cy=x*m[1]+y*m[5]+z*m[9]+m[13],cw=x*m[3]+y*m[7]+z*m[11]+m[15];if(cw<=0)return null;return [(cx/cw*.5+.5)*W,(1-(cy/cw*.5+.5))*Hh,cw]}
function labels(){
 const c=[],T=st,mouse=st.mouse;
 const sel=T.sel;
 if(sel!=null){c.push({t:nodeText(sel),x:SX[sel],y:SY[sel]-16,p:100,col:D.nodes[sel].color,cls:'lb sel'})
  const S=selSet();let n=0;S.forEach(i=>{if(i!=sel&&n<24&&vis[i]>.5){n++;c.push({t:D.nodes[i].kind=='eco'?D.nodes[i].label:D.nodes[i].label,x:SX[i],y:SY[i]-10,p:70,col:D.nodes[i].color,cls:'lb nb'})}})}
 if(T.selHe!=null){let n=0;D.hes[T.selHe].mi.forEach(i=>{if(n<40&&vis[i]>.5){n++;c.push({t:D.nodes[i].label,x:SX[i],y:SY[i]-10,p:75,col:D.nodes[i].color,cls:'lb nb'})}})}
 if(T.hover!=null&&T.hover!==sel)c.push({t:nodeText(T.hover),x:SX[T.hover],y:SY[T.hover]-16,p:95,col:D.nodes[T.hover].color,cls:'lb sel'});
 if(mouse&&T.hover==null||mouse){let near=[];for(let i=0;i<N;i++){if(vis[i]<.5||SZ[i]<0)continue;const d=Math.hypot(SX[i]-mouse.x,SY[i]-mouse.y);if(d<70&&i!=sel&&i!=T.hover)near.push([d,i])}near.sort((a,b)=>a[0]-b[0]).slice(0,14).forEach(([d,i])=>c.push({t:D.nodes[i].label,x:SX[i],y:SY[i]-10,p:60-d/10,col:D.nodes[i].color,cls:'lb nb'}))}
 if(T.selHe==null)for(let i=0;i<N;i++){const n=D.nodes[i];if(n.kind=='eco'||vis[i]<.5||SZ[i]<0)continue;if(sel!=null&&dimN[i]<.5)continue;c.push({t:n.label,x:SX[i],y:SY[i]-12,p:45,col:n.color,cls:'lb nb'})}
 for(let k=0;k<H;k++){const h=D.hes[k];if(hvis[k]<.5)continue;const p=projPt(hubP[k*3],hubP[k*3+1],hubP[k*3+2]);if(!p)continue;
  let pr=0,cls='lb he '+h.type;if(h.type=='volume')pr=62;else if(h.type=='family')pr=30+Math.min(h.m.length,60)/3;else if(h.type=='bridge')pr=66;else if(h.type=='dsa'||h.type=='engine')pr=34;else if(h.type=='firstmove')pr=40;else if(h.type=='transposition')pr=(sel!=null&&h.mi.includes(sel))||T.selHe==k?88:0;
  if(sel!=null&&h.mi.includes(sel))pr=80;if(T.selHe==k)pr=99;if(!pr)continue;
  if((sel!=null||T.selHe!=null)&&hdim[k]<.5)continue;
  c.push({t:h.type=='volume'?'ECO '+h.name.slice(4,5)+' · '+D.VN[h.name.slice(4,5)]:h.name.replace('Meeting point: ','⇄ '),x:p[0],y:p[1],p:pr,col:h.color,cls})}
 c.sort((a,b)=>b.p-a.p);const used=[];let n=0;
 for(const l of c){if(n>=LB.length)break;if(!(l.x>-50&&l.x<W+50&&l.y>-20&&l.y<Hh+20))continue;const w=tw(l.t)+8,r=[l.x-w/2,l.y-9,l.x+w/2,l.y+9];let ok=true;for(const u of used){if(r[0]<u[2]&&r[2]>u[0]&&r[1]<u[3]&&r[3]>u[1]){ok=false;break}}if(!ok&&l.p<90)continue;used.push(r);const d=LB[n++];d.style.display='block';d.className=l.cls;d.textContent=l.t;d.style.color=l.col;d.style.transform=`translate(${(l.x-w/2+4).toFixed(1)}px,${(l.y-9).toFixed(1)}px)`}
 for(;n<LB.length;n++)LB[n].style.display='none';
}
function nodeText(i){const n=D.nodes[i];return n.kind=='eco'?n.label+' · '+n.name:n.label}
function hoverTest(){const mo=st.mouse;if(!mo){st.hover=null;return}let best=null,bd=16;for(let i=0;i<N;i++){if(vis[i]<.5||SZ[i]<0||(st.sel!=null||st.selHe!=null)&&dimN[i]<.5)continue;const d=Math.hypot(SX[i]-mo.x,SY[i]-mo.y)-Math.min(baseR(D.nodes[i])*(700/SZ[i]),8);if(d<bd){bd=d;best=i}}st.hover=best;$('cv').style.cursor=best!=null?'pointer':'grab'}
// ---------- UI
const PIECES={K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
function board(fen){let h='<div class="bd">';fen.split('/').forEach((row,r)=>{let f=0;for(const ch of row){if(/\d/.test(ch)){for(let k=0;k<+ch;k++){h+=`<i class="${(r+f)%2?'d':'l'}"></i>`;f++}}else{h+=`<i class="${(r+f)%2?'d':'l'} ${ch==ch.toUpperCase()?'w':'b'}">${PIECES[ch]}</i>`;f++}}});return h+'</div>'}
function setSel(i,he){st.sel=i;st.selHe=he??null;info();syncList();if(he!=null)fitSet(D.hes[he].mi)}
function fitSet(ix){let c=[0,0,0],n=0;ix.forEach(i=>{c[0]+=P3[i*3];c[1]+=P3[i*3+1];c[2]+=P3[i*3+2];n++});if(!n)return;c=c.map(v=>v/n);let m=0;ix.forEach(i=>{m=Math.max(m,Math.hypot(P3[i*3]-c[0],P3[i*3+1]-c[1],P3[i*3+2]-c[2]))});camAnim={tx:new Vector3(c[0],c[1],c[2]),r:Math.max(5,m/Math.tan(cam.fov/2)*1.5)}}
function info(){const el=$('info');
 if(st.sel==null&&st.selHe==null){el.innerHTML='<p class="mut">Hover a point for its ECO code and opening. Click to light every hyperedge it belongs to. Click a name in the list to isolate a whole hyperedge.</p>';return}
 if(st.selHe!=null){const h=D.hes[st.selHe];el.innerHTML=`<h3 style="color:${h.color}">${h.name}</h3><p class="mut">${TYPE_LABEL[h.type]} · ${h.m.length} members${h.pgn?`<br>Position reached by: <code>${h.pgn}</code>`:''}</p><p class="chips">${h.m.map(m=>`<a data-n="${m}">${m.replace('eng:','')}</a>`).join('')}</p>`;bindChips();return}
 const n=D.nodes[st.sel],hs=heOf[st.sel].map(k=>D.hes[k]);
 let h=`<h3 style="color:${n.color}">${n.kind=='eco'?n.label+' · '+n.name:n.label}</h3>`;
 if(n.kind=='eco'){h+=`<div class="two">${board(n.fen)}<div class="kv"><span>Volume</span><b>${n.vol} · ${D.VN[n.vol]}</b><span>Family</span><b>${n.family}</b><span>Shortest line</span><b>${n.ply} plies</b><span>Named lines</span><b>${n.nl}</b><span>First move</span><b>1.${n.fm}</b></div></div><p class="mut">Line shown: <code>${n.pgn}</code></p>`}
 else h+=`<p class="mut">${n.kind=='dsa'?'DSA concept':'Chess-engine concept'}, tier ${n.tier} (w axis)</p>`;
 const nb=new Set();hs.forEach(x=>x.mi.forEach(i=>nb.add(i)));nb.delete(st.sel);
 h+=`<p class="mut">In <b>${hs.length}</b> hyperedges, <b>${nb.size}</b> hyper-neighbours</p><p class="chips">${hs.map(x=>`<a data-h="${x.k}" style="border-color:${x.color}">${x.name.replace('Meeting point: ','⇄ ')}</a>`).join('')}</p>`;
 el.innerHTML=h;bindChips()}
function bindChips(){document.querySelectorAll('#info [data-h]').forEach(a=>a.onclick=()=>setSel(null,+a.dataset.h));document.querySelectorAll('#info [data-n]').forEach(a=>a.onclick=()=>setSel(idxOf[a.dataset.n]))}
function listHtml(){const g={};D.hes.forEach(h=>(g[h.type]=g[h.type]||[]).push(h));return ['volume','family','transposition','firstmove','dsa','engine','bridge'].filter(t=>g[t]).map(t=>`<details ${t=='family'?'open':''}><summary><label><input type="checkbox" data-t="${t}" ${st.on[t]?'checked':''}> ${TYPE_LABEL[t]} <span class="mut">(${g[t].length})</span></label></summary>${g[t].map(h=>`<a class="hl" data-k="${h.k}"><i style="background:${h.color}"></i>${h.name.replace('Meeting point: ','⇄ ')}<span class="mut">${h.m.length}</span></a>`).join('')}</details>`).join('')}
function syncList(){document.querySelectorAll('#hlist .hl').forEach(a=>a.classList.toggle('on',+a.dataset.k===st.selHe))}
function stats(){const s=D.stats,row=(a,b,c)=>`<tr><td>${a}</td><td><b>${b}</b></td><td class=mut>${c}</td></tr>`;
 $('stats').innerHTML='<tr><th>Metric</th><th>Value</th><th>Source</th></tr>'+row('ECO codes',s.codes,'Lichess table, 5 files')+row('Named lines',s.rows.toLocaleString(),'same table')+row('Opening families',s.families+' ('+s.family_hyperedges+' with 3+ codes)','name before the colon')+
 row('Median / max shortest line',s.median_ply+' / '+s.max_ply+' plies','python-chess replay')+row('Transposition events',s.transposition_events,'a line passes through another line\'s position by a different move order')+
 row('Meeting-point positions',s.meeting_positions+' ('+s.meeting_ge3+' join 3+ codes)','same replay')+row('Shown as hyperedges',s.meeting_shown+' ('+s.meeting_cross_volume_shown+' span volumes)','top by volumes spanned, then size')+
 row('All hyperedges / incidences',s.hyperedges+' / '+s.incidences,'data.json')+row('Nodes (codes+DSA+engine)',s.nodes,'data.json')}
function legend(){$('legend').innerHTML=VN_ORDER.map(v=>`<span><i style="background:${D.VC[v]}"></i>${v} ${D.VN[v]} <em>${D.stats.lines_per_vol[v]} lines</em></span>`).join('')}
function search(q){const out=$('sres');q=q.trim().toLowerCase();if(!q){out.innerHTML='';return}const r=D.nodes.filter(n=>(n.label+' '+(n.name||'')).toLowerCase().includes(q)).slice(0,8);out.innerHTML=r.map(n=>`<a data-i="${n.i}"><b style="color:${n.color}">${n.label}</b> ${n.name||''}</a>`).join('');out.querySelectorAll('a').forEach(a=>a.onclick=()=>{setSel(+a.dataset.i);focusOn(+a.dataset.i);out.innerHTML='';$('q').value=''})}
var camAnim=null;function focusOn(i){camAnim={tx:new Vector3(P3[i*3],P3[i*3+1],P3[i*3+2]),r:Math.min(cam.radius,Math.max(5,cam.radius*.6))}}
function bind(){
 ['xw','yw','zw'].forEach((a,i)=>{$('r'+a).oninput=e=>{st.a[i]=+e.target.value;$('v'+a).textContent=(+e.target.value).toFixed(2)};$('r'+a).onchange=()=>{if(!st.spin)setTimeout(fit,30)}});
 document.querySelectorAll('[data-lens]').forEach(b=>b.onclick=()=>{st.lens=+b.dataset.lens;setTimeout(fit,30);document.querySelectorAll('[data-lens]').forEach(x=>x.classList.toggle('on',x==b))});
 document.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>{st.layer=b.dataset.layer;document.querySelectorAll('[data-layer]').forEach(x=>x.classList.toggle('on',x==b));if(st.sel!=null&&!layerNode(D.nodes[st.sel]))setSel(null);setTimeout(fit,30)});
 document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>setQuality(b.dataset.q=='hq'));
 $('spin').onclick=()=>{st.spin=!st.spin;$('spin').classList.toggle('on',st.spin)};
 $('reset').onclick=()=>{st.a=[0,0,0];['xw','yw','zw'].forEach(a=>{$('r'+a).value=0;$('v'+a).textContent='0.00'});cam.alpha=-1.2;cam.beta=1.22;fit()};
 $('hlist').innerHTML=listHtml();
 $('hlist').addEventListener('click',e=>{const a=e.target.closest('.hl');if(a){setSel(null,+a.dataset.k);e.preventDefault()}});
 $('hlist').addEventListener('change',e=>{const t=e.target.dataset.t;if(t)st.on[t]=e.target.checked});
 $('q').oninput=e=>search(e.target.value);
 const cv=$('cv');let down=null;
 cv.addEventListener('pointermove',e=>{const r=cv.getBoundingClientRect();st.mouse={x:e.clientX-r.left,y:e.clientY-r.top};hoverTest()});
 cv.addEventListener('pointerleave',()=>{st.mouse=null;st.hover=null});
 cv.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY}});
 cv.addEventListener('pointerup',e=>{if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(moved>5)return;if(st.hover!=null)setSel(st.hover===st.sel?null:st.hover);else setSel(null)});
 window.addEventListener('keydown',e=>{if(e.key=='Escape')setSel(null)});
}
async function main(){
 D=await (await fetch('data.json')).json();
 build();sizeInfo();makeScene();mkLabels();bind();stats();legend();info();
 for(let i=0;i<N;i++){proj(i);tvis[i]=1}
 for(let i=0;i<N;i++)vis[i]=1;fit();if(camAnim){cam.target=camAnim.tx.clone();cam.radius=camAnim.r;camAnim=null}
 let f=0;
 engine.runRenderLoop(()=>{
  if(st.spin){st.a[0]+=.0035;st.a[1]+=.0024;st.a[2]+=.0015;['xw','yw','zw'].forEach((a,i)=>{const v=((st.a[i]+Math.PI)%(2*Math.PI))-Math.PI;$('r'+a).value=v;$('v'+a).textContent=v.toFixed(2)})}
    const dt=Math.min(engine.getDeltaTime(),120);KF=1-Math.exp(-dt/1000*12);KC=1-Math.exp(-dt/1000*7);
  if(camAnim){cam.target=Vector3.Lerp(cam.target,camAnim.tx,KC);cam.radius+=(camAnim.r-cam.radius)*KC;if(Vector3.Distance(cam.target,camAnim.tx)<.02&&Math.abs(cam.radius-camAnim.r)<.05)camAnim=null}
  fadeV.set(cam.radius-EXT,EXT*2.2);update();project();hoverTest();labels();scene.render();f++;window.__hgFrames=f});
 window.__hg={st,D,cam,ready:true,setSel,N,H,scr:i=>[SX[i],SY[i]+0],hubs:()=>hubP};
}
main().catch(e=>{console.error(e);document.body.insertAdjacentHTML('afterbegin','<pre style="color:#f66;position:fixed;z-index:9">'+e+'</pre>')});
