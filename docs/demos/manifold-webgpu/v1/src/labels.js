/* A sparse English / Simplified Chinese annotation layer. The categories are
 * illustrative names for source regions, not measurements of a viewer's mind.
 * Pass the same sources, heightAt and column-major VP used by the renderer.
 */
(function(global){
 'use strict';
 const NS='http://www.w3.org/2000/svg';
 const categories=Object.freeze([
  Object.freeze({en:'Joy',zh:'喜悦',tint:'#f3d7a4'}),
  Object.freeze({en:'Serenity',zh:'宁静',tint:'#a1e1d8'}),
  Object.freeze({en:'Curiosity',zh:'好奇',tint:'#b8c9f2'}),
  Object.freeze({en:'Longing',zh:'渴望',tint:'#dfb7e0'}),
  Object.freeze({en:'Awe',zh:'敬畏',tint:'#c6beef'}),
  Object.freeze({en:'Tension',zh:'紧张',tint:'#f2b0ad'}),
  Object.freeze({en:'Tenderness',zh:'温柔',tint:'#ebc5b9'})
 ]);
 let layer,svg,items=[],enabled=false,active=false,lastW=0,lastH=0,lastCompact=false,lastBlockClock=-1000;
 let blockerNodes=[],blockers=[],candidates=[],placed=[];
 const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 function element(tag,cls){const e=document.createElement(tag);if(cls)e.className=cls;return e}
 function shape(tag,attrs){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);return e}
 function init(){
  if(layer)return layer;
  layer=element('div');layer.id='affect-labels';layer.hidden=true;layer.setAttribute('role','group');layer.setAttribute('aria-label','Illustrative affect categories, English and Chinese');layer.setAttribute('aria-hidden','true');
  svg=shape('svg',{'class':'affect-leaders','aria-hidden':'true','focusable':'false'});layer.append(svg);
  categories.forEach((c,i)=>{
   const group=shape('g',{'class':'affect-leader'});group.style.setProperty('--affect-tint',c.tint);
   const path=shape('path',{}),halo=shape('circle',{'class':'affect-halo',r:'6'}),ring=shape('circle',{'class':'affect-ring',r:'2.6'}),core=shape('circle',{'class':'affect-core',r:'.85'});group.append(path,halo,ring,core);svg.append(group);
   const el=element('div','affect-label');el.style.setProperty('--affect-tint',c.tint);el.dataset.index=String(i+1).padStart(2,'0');el.dataset.category=c.en;
   const en=element('span','affect-en'),slash=element('span','affect-slash'),zh=element('span','affect-zh');en.textContent=c.en;slash.textContent='/';zh.textContent=c.zh;zh.lang='zh-Hans';el.append(en,slash,zh);layer.append(el);
   items.push({i,c,el,group,path,halo,ring,core,w:130,h:28,x:0,y:0,ax:0,ay:0,depth:0,visible:false,seen:false,hasPlacement:false,dx:0,dy:0,occ:false,occClock:-1000});
  });
  document.body.append(layer);
  blockerNodes=Array.from(document.querySelectorAll('.mast,.dock,.intro,.panel,.foot,#journeyInfo'));
  return layer;
 }
 function setEnabled(on){enabled=!!on;init();if(!enabled){active=false;layer.hidden=true;layer.setAttribute('aria-hidden','true')}return enabled}
 function show(item,on){if(item.visible!==on){item.visible=on;item.el.dataset.visible=String(on);item.group.dataset.visible=String(on)}}
 function bounds(r,pad=0){return {x:r.left-pad,y:r.top-pad,w:r.width+pad*2,h:r.height+pad*2}}
 function overlaps(a,b,gap=0){return a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y}
 function project(x,y,z,m,W,H,out){
  const cw=m[3]*x+m[7]*y+m[11]*z+m[15];
  if(cw<=.05){out.valid=false;return}
  const nx=(m[0]*x+m[4]*y+m[8]*z+m[12])/cw,ny=(m[1]*x+m[5]*y+m[9]*z+m[13])/cw,nz=(m[2]*x+m[6]*y+m[10]*z+m[14])/cw;
  out.ax=(nx*.5+.5)*W;out.ay=(.5-ny*.5)*H;out.depth=nz;out.valid=nz>-1&&nz<1&&out.ax>10&&out.ax<W-10&&out.ay>55&&out.ay<H-35;
 }
 function occluded(x,y,z,eye,heightAt){
  if(!eye)return false;
  // Coarse ray tests catch intervening terrain; the last part is omitted so
  // a region can be named at its own steep basin rather than losing its tag.
  for(let k=0;k<8;k++){
   const t=.42+k*.055,px=eye[0]+(x-eye[0])*t,pz=eye[2]+(z-eye[2])*t;
   if(Math.abs(px)>10.8||Math.abs(pz)>10.8)continue;
   const py=eye[1]+(y-eye[1])*t;
   if(heightAt(px,pz)>py+.20)return true;
  }return false;
 }
 function measure(W,H,compact){
  if(W===lastW&&H===lastH&&compact===lastCompact)return;
  lastW=W;lastH=H;lastCompact=compact;svg.setAttribute('viewBox','0 0 '+W+' '+H);
  for(const item of items){const r=item.el.getBoundingClientRect();item.w=r.width||130;item.h=r.height||28;item.hasPlacement=false}
 }
 function updateBlockers(opts,now){
  // Callers may supply viewport-coordinate rectangles to avoid other overlays.
  // Native chrome rectangles are cached because querying them every frame is
  // needlessly expensive. Panel changes invalidate within one short interval.
  if(now-lastBlockClock<150&&!opts.blockedRects&&!opts.controlsRect)return;
  lastBlockClock=now;blockers.length=0;
  for(const node of blockerNodes){if(node.hidden||node.getAttribute('aria-hidden')==='true')continue;const r=node.getBoundingClientRect();if(r.width&&r.height)blockers.push(bounds(r,7))}
  if(opts.controlsRect){const r=opts.controlsRect;blockers.push(r.left!=null?bounds(r,8):{x:r.x-8,y:r.y-8,w:r.w+16,h:r.h+16})}
  if(opts.blockedRects)for(const r of opts.blockedRects)blockers.push(r.left!=null?bounds(r,7):{x:r.x-7,y:r.y-7,w:r.w+14,h:r.h+14});
 }
 function canPlace(x,y,w,h,W,H,compact){
  const margin=compact?13:18;
  if(x<margin||y<Math.max(72,margin)||x+w>W-margin||y+h>H-margin)return false;
  const r={x,y,w,h};for(const b of blockers)if(overlaps(r,b))return false;for(const b of placed)if(overlaps(r,b,9))return false;
  return true;
 }
 function place(item,W,H,compact){
  const w=item.w,h=item.h,ax=item.ax,ay=item.ay,side=item.i%2===0?1:-1;
  // Preserve an existing relative placement when possible, then try a small
  // fan of callouts. Stable choices prevent position jitter during breathing.
  const tries=[];
  if(item.hasPlacement)tries.push([item.dx,item.dy]);
  tries.push([side>0?28:-w-28,-h-28],[side>0?30:-w-30,22],[-w*.5,-h-47],[-w*.5,40],[side>0?-w-28:28,-h-28],[side>0?-w-30:30,22],[-w*.5,-h-72],[-w*.5,65]);
  for(const delta of tries){
   const x=ax+delta[0],y=ay+delta[1];if(!canPlace(x,y,w,h,W,H,compact))continue;
   item.x=x;item.y=y;item.dx=delta[0];item.dy=delta[1];item.hasPlacement=true;placed.push({x,y,w,h});
   let ex,ey;if(ax<x){ex=x;ey=y+h*.5}else if(ax>x+w){ex=x+w;ey=y+h*.5}else{ex=clamp(ax,x+12,x+w-12);ey=ay<y?y:y+h}
   const elbowX=ex+(ax<ex?-12:12);
   item.path.setAttribute('d','M'+ax.toFixed(1)+' '+ay.toFixed(1)+' L'+elbowX.toFixed(1)+' '+ey.toFixed(1)+' L'+ex.toFixed(1)+' '+ey.toFixed(1));
   for(const node of [item.halo,item.ring,item.core]){node.setAttribute('cx',ax.toFixed(1));node.setAttribute('cy',ay.toFixed(1))}
   item.el.style.transform='translate3d('+x.toFixed(1)+'px,'+y.toFixed(1)+'px,0)';show(item,true);return true;
  }show(item,false);return false;
 }
 function update(opts){
  init();const on=opts.enabled===undefined?enabled:!!opts.enabled;
  active=on&&!opts.immersive;
  if(!active){layer.hidden=true;layer.setAttribute('aria-hidden','true');return}
  layer.hidden=false;layer.setAttribute('aria-hidden','false');
  if(!opts.sources||!opts.heightAt||!opts.vp)return;
  const W=layer.clientWidth||innerWidth,H=layer.clientHeight||innerHeight,compact=opts.compact??W<600,now=performance.now();
  measure(W,H,compact);updateBlockers(opts,now);candidates.length=0;placed.length=0;
  for(const item of items){
   item.seen=false;const s=opts.sources[item.i];if(!s){show(item,false);continue}
   const y=opts.heightAt(s.x,s.z)+.22;project(s.x,y,s.z,opts.vp,W,H,item);
   if(!item.valid){show(item,false);continue}
   if(now-item.occClock>180){item.occ=occluded(s.x,y,s.z,opts.eye,opts.heightAt);item.occClock=now}
   if(item.occ){show(item,false);continue}
   // A slight preference for established tags prevents depth-sort flicker.
   item.rank=item.depth-(item.visible?.00012:0);candidates.push(item);
  }
  candidates.sort((a,b)=>a.rank-b.rank||a.i-b.i);const limit=compact?4:7;let count=0;
  for(const item of candidates){if(count<limit&&place(item,W,H,compact)){item.seen=true;count++}else show(item,false)}
 }
 function drawToCanvas(ctx,scaleX=1,scaleY=scaleX){
  if(!active)return;ctx.save();ctx.scale(scaleX,scaleY);
  for(const item of items){if(!item.visible)continue;const x=item.x,y=item.y,w=item.w,h=item.h,ax=item.ax,ay=item.ay;let ex=ax<x?x:ax>x+w?x+w:clamp(ax,x+12,x+w-12),ey=ax<x||ax>x+w?y+h*.5:ay<y?y:y+h;
   ctx.strokeStyle=item.c.tint+'80';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ex+(ax<ex?-12:12),ey);ctx.lineTo(ex,ey);ctx.stroke();ctx.fillStyle=item.c.tint+'20';ctx.beginPath();ctx.arc(ax,ay,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#0b1521';ctx.strokeStyle=item.c.tint;ctx.beginPath();ctx.arc(ax,ay,2.6,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=item.c.tint;ctx.beginPath();ctx.arc(ax,ay,.85,0,Math.PI*2);ctx.fill();
   const backing=ctx.createLinearGradient(x,y,x+w,y+h*.36);backing.addColorStop(0,'rgba(7,15,26,.62)');backing.addColorStop(1,'rgba(9,18,31,.36)');ctx.fillStyle=backing;ctx.strokeStyle='rgba(181,214,232,.25)';ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,3);else ctx.rect(x,y,w,h);ctx.fill();ctx.stroke();ctx.strokeStyle=item.c.tint;ctx.beginPath();ctx.moveTo(x,y+2);ctx.lineTo(x,y+h-2);ctx.stroke();ctx.fillStyle=item.c.tint;ctx.font='7px ui-monospace,Consolas,monospace';ctx.textBaseline='middle';ctx.fillText(String(item.i+1).padStart(2,'0'),x+9,y+h*.5);ctx.fillStyle='#e3edf6';ctx.font=(lastCompact?'8px':'9px')+' "Manifold CJK",system-ui,"Microsoft YaHei","PingFang SC",sans-serif';ctx.fillText(item.c.en.toUpperCase()+' / '+item.c.zh,x+27,y+h*.5);
  }ctx.restore();
 }
 function getVisible(){return items.filter(i=>i.visible&&active).map(i=>({en:i.c.en,zh:i.c.zh,x:i.x,y:i.y,width:i.w,height:i.h,anchorX:i.ax,anchorY:i.ay}))}
 global.AffectLabels=Object.freeze({init,update,setEnabled,paint:drawToCanvas,drawToCanvas,getVisible,categories,invalidate(){lastW=0;lastH=0;lastBlockClock=-1000;}});
})(window);

