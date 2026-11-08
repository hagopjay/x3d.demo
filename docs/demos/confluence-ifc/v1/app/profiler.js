/* Pinned X_ITE display hooks. GPU queries are optional and polled without stalls. */
'use strict';
window.LoomProfiler=class {
 constructor(browser){
  this.browser=browser;this.gl=browser.getContext();this.ext=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');this.enabled=false;this.pending=[];this.active=null;this.disjointCount=0;this.reset();
  browser.displayEvents().addFieldCallback('confluence-start',()=>this.begin());
  browser.displayFinishEvents().addFieldCallback('confluence-end',()=>this.end());
 }
 reset(){this.disjointCount=0;this.gpu=[];this.cpu=[];this.frames=[];this.submission=[];this.previous=0;this.epoch=(this.epoch||0)+1;}
 enable(value){this.enabled=Boolean(value);if(value)this.reset();}
 begin(){
  if(!this.enabled)return;const now=performance.now();if(this.previous)this.frames.push(now-this.previous);this.previous=now;this.started=now;
  const g=this.gl,e=this.ext;if(!e)return;
  if(g.getParameter(e.GPU_DISJOINT_EXT)){this.disjointCount++;for(const p of this.pending)g.deleteQuery(p.query);this.pending=[];this.gpu=[];return;}
  while(this.pending.length&&g.getQueryParameter(this.pending[0].query,g.QUERY_RESULT_AVAILABLE)){
   const p=this.pending.shift(),ns=g.getQueryParameter(p.query,g.QUERY_RESULT);g.deleteQuery(p.query);if(p.epoch===this.epoch&&Number.isFinite(ns)&&ns>0)this.gpu.push(ns/1e6);
  }
  if(!this.active&&this.pending.length<4){const query=g.createQuery();g.beginQuery(e.TIME_ELAPSED_EXT,query);this.active={query,epoch:this.epoch};}
 }
 end(){
  if(this.active){this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.pending.push(this.active);this.active=null;}
  if(this.enabled&&this.started)this.cpu.push(performance.now()-this.started);
  for(const a of [this.gpu,this.cpu,this.frames,this.submission])if(a.length>12000)a.splice(0,a.length-12000);
 }
 stats(a){const s=[...a].sort((x,y)=>x-y),q=p=>s.length?s[Math.min(s.length-1,Math.floor(s.length*p))]:null;return {samples:s.length,median_ms:q(.5),p95_ms:q(.95),p99_ms:q(.99)};}
 report(){return {schema:'confluence.profile/1',draw_intervals:this.stats(this.frames),cpu_display_submission:this.stats(this.cpu),cpu_scene_update:this.stats(this.submission),gpu:{available:Boolean(this.ext),...this.stats(this.gpu),disjoint_events:this.disjointCount,pending_queries:this.pending.length},scope:'CPU display callback span excludes final blit; GPU query brackets X_ITE display traversal, not compositor or physical latency. Missing GPU measurements remain null.'};}
};
