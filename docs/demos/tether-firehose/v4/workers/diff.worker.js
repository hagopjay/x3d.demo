/* diff.worker.js — tag-line diffs off the main thread (SPEC §7.3; owner 14-morph; 48-ask may reuse it). Classic worker, own file, no imports.
   Ported from demo/tether-firehose-v3.template.html lines 600–620 (tagLines, LCSdiff, repairStats): one tag per line, LCS over lines, two lines of
   context in the trimmed view. The page keeps the same functions in js/14-morph.js (DIFF.*) for the sync path (< 400 lines) and for the no-worker fallback.
   Protocol (every request carries an id; every answer echoes it; errors → {id, error}):
     {id, type:"ping"}                                   → {id, pong:true}
     {id, type:"diff", a, b, maxShown=100}               → {id, add, del, base, rows:[[sign, text, i]...]}  rows = the context-trimmed view (sign " " | "+" | "-" | "…" for a gap, "~" for the "N more" line; i = index in the full diff)
     {id, type:"lcs", a:[lines], b:[lines]}              → {id, ops:[[sign, text]...]}                        the full LCS diff over two line arrays (no trimming)
     {id, type:"repairStats", pairs:[{id, a, b}]}        → {id, stats:{n, med, frac, big}, per:[{id, changed, base, frac, add, del}]}  changed = non-equal rows; frac = changed / base lines; big = frac > .5
   Anything else → {id, error:"unknown type"}. 48-ask's askFiles aggregation is not here (it lands in 48-ask's own code; this worker only diffs). */
(function(){
"use strict";
const tagLines=x=>String(x).replace(/\r/g,"").replace(/>\s*</g,">\n<").split("\n");
function LCSdiff(a,b){const n=a.length,m=b.length,w=m+1,t=new Uint16Array((n+1)*w);
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)t[i*w+j]=a[i]===b[j]?t[(i+1)*w+j+1]+1:Math.max(t[(i+1)*w+j],t[i*w+j+1]);
  const o=[];let i=0,j=0;while(i<n&&j<m){if(a[i]===b[j]){o.push([" ",a[i]]);i++;j++}else if(t[(i+1)*w+j]>=t[i*w+j+1])o.push(["-",a[i++]]);else o.push(["+",b[j++]])}
  while(i<n)o.push(["-",a[i++]]);while(j<m)o.push(["+",b[j++]]);return o}
/* the trimmed view: changed rows with two lines of context, gaps marked, at most maxShown rows */
function diffRows(a,b,maxShown){const d=LCSdiff(tagLines(a),tagLines(b)),keep=new Array(d.length).fill(false),add=d.filter(r=>r[0]==="+").length,del=d.filter(r=>r[0]==="-").length;
  d.forEach((r,i)=>{if(r[0]!==" ")for(let k=Math.max(0,i-2);k<=Math.min(d.length-1,i+2);k++)keep[k]=true});
  const rows=[];let gap=false,shown=0,seen=0;maxShown=maxShown||100;
  for(let i=0;i<d.length;i++){if(!keep[i]){gap=true;continue}
    if(shown>=maxShown){rows.push(["~",String(add+del-seen),i]);break}
    if(gap&&rows.length)rows.push(["…","",i]);gap=false;shown++;if(d[i][0]!==" ")seen++;rows.push([d[i][0],d[i][1].slice(0,220),i])}
  return{add,del,base:tagLines(a).length,rows,total:d.length}}
function repairStats(pairs){const per=[],ch=[],fr=[],med=x=>{x=x.slice().sort((p,q)=>p-q);return x.length?x[x.length>>1]:0};
  for(const p of pairs){const a=tagLines(p.a),d=LCSdiff(a,tagLines(p.b)),changed=d.filter(r=>r[0]!==" ").length,add=d.filter(r=>r[0]==="+").length,del=d.filter(r=>r[0]==="-").length,frac=changed/Math.max(1,a.length);
    per.push({id:p.id,changed,base:a.length,frac,add,del});ch.push(changed);fr.push(frac)}
  return{stats:{n:ch.length,med:med(ch),frac:med(fr),big:fr.filter(f=>f>.5).length},per}}
self.onmessage=function(ev){const d=ev.data||{},id=d.id;try{
  if(d.type==="ping")return self.postMessage({id,pong:true});
  if(d.type==="diff"){const r=diffRows(String(d.a||""),String(d.b||""),d.maxShown);return self.postMessage({id,add:r.add,del:r.del,base:r.base,total:r.total,rows:r.rows})}
  if(d.type==="lcs")return self.postMessage({id,ops:LCSdiff(d.a||[],d.b||[])});
  if(d.type==="repairStats")return self.postMessage(Object.assign({id},repairStats(d.pairs||[])));
  self.postMessage({id,error:"unknown type "+d.type})}catch(e){self.postMessage({id,error:String(e&&e.message||e)})}};
})();
