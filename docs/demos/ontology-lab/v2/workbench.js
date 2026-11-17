(function () {
  'use strict';
  const $=id=>document.getElementById(id),$$=q=>[...document.querySelectorAll(q)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const X='https://www.web3d.org/specifications/X3dOntology4.1#',B='https://semantic-twin-lab.example/TheCabinet.ttl#';
  const short=v=>String(v??'').replace(B,':').replace(X,'x3do:').replace('http://www.w3.org/2002/07/owl#','owl:');
  const fmt=n=>Number(n).toLocaleString('en-US');
  const client=new TwinWorkerClient({url:'workbench-worker.js',timeoutMs:20000});
  const state={busy:false,manifest:null,manifestText:null,instrument:null,receipts:[],repaired:null,opToken:0};
  const stable=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  const stableText=v=>JSON.stringify(stable(v));
  const fetchText=async path=>{const r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw new Error(`${path}: HTTP ${r.status}`);return r.text();};
  const fetchJSON=path=>fetchText(path).then(JSON.parse);
  const hash=WitnessCore.sha256;
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6500);}
  function showError(message){$('alert').textContent=message;$('alert').hidden=false;}
  function session(message,working=false){$('session-state').lastChild?.nodeType===3&&$('session-state').lastChild.remove();$('session-state').innerHTML=`<i${working?' class="working"':''}></i> ${esc(message)}`;}
  function setBusy(on,message){state.busy=on;$$('button[id^="run-"], #scene, #profile, #material, #red').forEach(el=>el.disabled=on);$$('.cancel').forEach(el=>el.hidden=!on);session(message||'Ready · local computation',on);}
  function showTab(name){$$('[data-tab]').forEach(b=>{const active=b.dataset.tab===name;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;$('pane-'+b.dataset.tab).hidden=!active;});history.replaceState(null,'','#'+name);}
  $$('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
  document.querySelector('.tabs').addEventListener('keydown',e=>{const tabs=$$('[data-tab]'),i=tabs.indexOf(document.activeElement);if(i<0)return;let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;else if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();tabs[next].focus();showTab(tabs[next].dataset.tab);});
  function download(data,name,type='application/json'){const blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  async function record(operation,result,elapsed){
    const content={...result};if(content.xml)delete content.xml;
    const receipt={schema:'semantic-twin-browser-witness/v1',hash_algorithm:'SHA-256(sorted-key JSON with JavaScript number serialization)',created_utc:new Date().toISOString(),operation,execution:'computed in this browser',elapsed_ms:Math.round(elapsed),instrument:state.instrument,result:content};
    receipt.receipt_sha256=await hash(stableText(receipt));
    state.receipts.push(receipt);$('notebook-count').textContent=state.receipts.length;
    $('elapsed').textContent=`${(elapsed/1000).toFixed(2)} s · receipt ${receipt.receipt_sha256.slice(0,12)}…`;
  }
  async function run(op,args,render){
    if(state.busy)return;
    if(state.receipts.length>=30){toast('The notebook holds 30 runs. Export it and reload to begin another notebook.');return;}
    const token=++state.opToken,t0=performance.now();$('alert').hidden=true;setBusy(true,'Computing · '+op);
    try{const result=await client.call(op,args);if(token!==state.opToken)return;render(result);await record(op,result,performance.now()-t0);if(token!==state.opToken)return;session('Computed here · evidence retained');}
    catch(e){if(token!==state.opToken)return;showError(e.message||String(e));session('No completed verdict · retry available');}
    finally{if(token===state.opToken){setBusy(false);if(!$('alert').hidden)session('No completed verdict · retry available');else session('Computed here · evidence retained');}}
  }
  $$('.cancel').forEach(b=>b.addEventListener('click',()=>{++state.opToken;client.cancel();setBusy(false);showError('Operation cancelled. Its worker was terminated; no completed result was added to the notebook.');session('Cancelled · retry starts a fresh worker');}));
  function metrics(id,values){const strong=$$('#'+id+' strong');values.forEach((v,i)=>{if(strong[i])strong[i].textContent=typeof v==='number'?fmt(v):v;});}
  function chips(values,kind){return values.map(v=>`<span class="type-chip ${kind}" title="${esc(v)}">${esc(short(v))}</span>`).join('');}
  function renderReason(r){
    metrics('reason-metrics',[r.report.assertedSceneTriples,r.report.derivedTriples,`${r.baseline.count} → ${r.after.count}`,0]);
    const f=r.report.focus[0];
    $('type-witness').classList.remove('empty');
    $('type-witness').innerHTML=f?`<code class="witness-uri">${esc(short(f.iri))}</code><h4>Asserted in the input <small>${f.assertedTypes.length}</small></h4><div class="type-cloud">${chips(f.assertedTypes,'asserted')}</div><h4>Added by ${esc(r.profile)} <small>${fmt(f.derivedTypes.length)}</small></h4><div class="type-cloud">${chips(f.derivedTypes.slice(0,24),'derived')||'<span class="fine">No additional types on this specimen.</span>'}</div>${f.derivedTypes.length>24?`<p class="fine">${f.derivedTypes.length-24} more types are retained in the result.</p>`:''}`:'No Box is present in the selected graph.';
    $('constraint-witness').classList.remove('empty');
    $('constraint-witness').innerHTML=`<div class="verdict-pair"><div class="${r.baseline.count?'verdict-fail':'verdict-pass'}"><span>ORIGINAL DATA</span><b>${r.baseline.count?'✕ '+r.baseline.count+' result(s)':'✓ no results'}</b></div><span class="verdict-arrow">→</span><div class="${r.after.count?'verdict-fail':'verdict-pass'}"><span>SELECTED CLOSURE</span><b>${r.after.count?'✕ '+r.after.count+' result(s)':'✓ no results'}</b></div></div><p>${esc(r.scope)}</p><p class="fine">${esc(r.report.evidence)} The installed RDFS rules are a bounded rule subset, not a complete standards conformance implementation.</p>${r.baseline.results.slice(0,3).map(v=>`<div class="finding"><code>${esc(v.focus)}</code><p>${esc(v.message)}</p></div>`).join('')}`;
    const masked=r.baseline.count>0&&r.after.count===0;
    $('reason-conclusion').innerHTML=`<span class="eyebrow">${masked?'A DISAPPEARING VIOLATION · ZERO SOURCE EDITS':'WHAT THIS RUN ESTABLISHES'}</span><p>${masked?'S7 stopped flagging the Box after inference added a child-node membership. The XML placement is unchanged. This is a change in the validation input, not a repair.':'The comparison isolates the selected inference profile. A result for one membership constraint does not establish schema validity, source-order correctness, visibility, or complete scene quality.'}</p>`;
    $('reason-conclusion').classList.toggle('masked',masked);$('reason-json').textContent=JSON.stringify(r,null,2);
  }
  $('run-reason').addEventListener('click',()=>run('reason',{scene:$('scene').value,profile:$('profile').value},renderReason));
  function literal(v){return v?.value??'unbound';}
  function renderLists(r){
    $('list-cells').classList.remove('empty');
    $('list-cells').innerHTML=`<span class="list-origin">${esc(short(r.subject))}<small>diffuseColor</small></span>`+r.list.cells.map((c,i)=>`<span class="list-arrow" aria-hidden="true">→</span><article class="list-cell"><span class="axis">[${i}] ${['R','G','B'][i]||''}</span><strong class="value">${esc(literal(c.value))}</strong><small>cell ${i}<br>${esc(c.value.datatype.split('#').pop())}</small></article>`).join('')+'<span class="list-arrow">→</span><code>rdf:nil</code>';
    const cards=$$('#list-comparison article');
    const ordered=r.list.cells.map(c=>literal(c.value)),bag=r.bag.rows.map(row=>row.component),distinct=r.distinct.rows.map(row=>row.component);
    [ordered,bag,distinct].forEach((v,i)=>{cards[i].querySelector('strong').textContent='['+v.join(', ')+']';});
    cards[0].querySelector('p').textContent=`${r.list.length} cells. RGB axes come from the X3D field’s positional contract.`;
    cards[1].querySelector('p').textContent=`${r.bag.count} solution rows. Actual engine order is shown; no order is guaranteed without an index and ORDER BY.`;
    cards[2].querySelector('p').textContent=`${r.distinct.count} distinct terms. This can be smaller than the list’s length.`;
    $('lists-json').textContent=JSON.stringify(r,null,2);
  }
  $('run-lists').addEventListener('click',()=>run('lists',{scene:$('scene').value,subject:$('material').value},renderLists));
  $('red').addEventListener('input',()=>{$('red-value').textContent=Number($('red').value).toFixed(2);});
  function renderRepair(r){
    state.repaired=r;$('download-repair').disabled=false;const w=r.witness;
    $('repair-source').classList.remove('empty');$('repair-verdict').classList.remove('empty');
    $('repair-source').innerHTML=`<code class="witness-uri">Material DEF="Ruby"</code><dl><dt>Attribute</dt><dd>diffuseColor</dd><dt>Line</dt><dd>${w.line}</dd><dt>UTF-8 byte span</dt><dd>[${w.byteStart}, ${w.byteEnd})</dd><dt>Input SHA-256</dt><dd class="hash">${esc(w.beforeSha256)}</dd></dl>`;
    $('repair-verdict').innerHTML=`<div class="verdict-pair"><div class="verdict-fail"><span>BEFORE / S1</span><b>${r.before.count} result(s)</b></div><span class="verdict-arrow">→</span><div class="${r.after.count?'verdict-fail':'verdict-pass'}"><span>AFTER / S1</span><b>${r.after.count} result(s)</b></div></div><p>${esc(r.projection)}</p>`;
    const afterLine=r.xml.split('\n')[w.line-1];$('repair-diff').textContent=`Line ${w.line} · ${w.change}\n− ${w.lineText}\n+ ${afterLine}`;
    const {xml,...receipt}=r;$('repair-json').textContent=JSON.stringify(receipt,null,2);
  }
  $('run-repair').addEventListener('click',()=>run('repair',{components:[Number($('red').value),.08,.16]},renderRepair));
  $('download-repair').addEventListener('click',()=>{if(state.repaired)download(state.repaired.xml,'Ruby-F1-repaired.x3d','model/x3d+xml');});
  $('export-notebook').addEventListener('click',async()=>{
    const result={schema:'semantic-twin-notebook/v1',hash_algorithm:'SHA-256(sorted-key JSON with JavaScript number serialization)',exported_utc:new Date().toISOString(),scope:'Local browser experiments; historical upstream sessions were not rerun.',integrity_note:'Digests establish internal consistency, not publisher authenticity or independent verification.',receipts:state.receipts};
    result.notebook_sha256=await hash(stableText(result));download(result,'Semantic-Twin-Witness-Notebook.json');toast(`Exported ${state.receipts.length} local run(s).`);
  });
  $('scene').addEventListener('change',()=>{$('scene-note').textContent=`Selected ${$('scene').selectedOptions[0].textContent}. Existing results retain the specimen named in their receipts; run again to compare this selection.`;});
  async function integrity(){
    if(state.busy)return;
    if(state.receipts.length>=30){toast('Export this 30-run notebook and reload to begin another.');return;}
    const token=++state.opToken,t0=performance.now();$('alert').hidden=true;setBusy(true,'Verifying local file bytes');
    try{
      const entries=Object.entries(state.manifest.files),rows=[];let checked=0;
      for(let offset=0;offset<entries.length;offset+=4){
        const batch=await Promise.all(entries.slice(offset,offset+4).map(async([path,expected])=>{try{const r=await fetch(path,{cache:'no-cache'});if(!r.ok)throw new Error('HTTP '+r.status);const data=await r.arrayBuffer(),actual=await hash(data);return {path,status:actual===expected.sha256?'match':'mismatch',expected_sha256:expected.sha256,actual_sha256:actual,bytes:data.byteLength,source_sha256:expected.source_sha256,source_comparison:expected.sha256===expected.source_sha256?'same recorded digest':'different recorded digest',source_available:false};}catch(e){return {path,status:'unavailable',error:e.message};}}));
        if(token!==state.opToken)return;rows.push(...batch);checked+=batch.length;session(`Verified ${checked} / ${entries.length} file entries`,true);
      }
      const result={operation:'manifest-integrity',authority:'colocated supplied manifest, not an independent trust root',manifest_sha256:await hash(state.manifestText),checked:rows.length,matched:rows.filter(r=>r.status==='match').length,mismatched:rows.filter(r=>r.status==='mismatch').length,unavailable:rows.filter(r=>r.status==='unavailable').length,source_differs:rows.filter(r=>r.status!=='unavailable'&&r.source_sha256!==r.expected_sha256).length,upstream_reexecuted:false,rows};
      metrics('integrity-metrics',[result.checked,result.matched,result.source_differs,0]);
      $('integrity-rows').innerHTML=rows.map(r=>`<tr><td title="${esc(r.actual_sha256||r.error)}">${esc(r.path)}</td><td class="${r.status==='match'?'file-match':'source-diff'}">${r.status==='match'?'✓ matched':esc(r.status)}</td><td>${r.source_comparison==='different recorded digest'?'<span class="source-diff">≠ earlier source</span>':r.status==='unavailable'?'not checked':'same recorded digest'}</td></tr>`).join('');
      $('integrity-json').textContent=JSON.stringify(result,null,2);await record('manifest-integrity',result,performance.now()-t0);
    }catch(e){showError(e.message);}finally{if(token===state.opToken)setBusy(false);}
  }
  $('run-integrity').addEventListener('click',integrity);
  async function orderWitness(){
    try{const [a,b]=await Promise.all(['cabinet','fault-F6'].map(n=>fetchJSON(`companion/examples/${n}-audit.json`)));
      const same=a.rdf.graph_sha256===b.rdf.graph_sha256;
      $('order-witness-body').innerHTML=`<div class="order-comparison"><div><span class="eyebrow">CABINET</span><p class="file-match">${a.xml.clean?'✓ source checks clean':'Source findings'}</p><code>${esc(a.source.sha256.slice(0,18))}…</code></div><span>≠ source bytes<br><b>${same?'= RDF graph fingerprint':'≠ RDF graph fingerprint'}</b></span><div><span class="eyebrow">F6 · USE BEFORE DEF</span><p class="source-diff">${esc(b.xml.findings.map(x=>x.code).join(', '))}</p><code>${esc(b.source.sha256.slice(0,18))}…</code></div></div><p>The companion computed the same bounded graph fingerprint for these two supplied Turtle files while its XML audit caught F6’s forward USE. The graph cannot witness this lexical ordering fault.</p><p class="fine">Algorithm: ${esc(a.rdf.algorithm)}; ${fmt(a.rdf.triples)} triples. These saved companion computations inspect XML and Turtle independently. They do not certify the XML-to-RDF derivation. Reproduce with <code>python3 -m companion audit</code>.</p>`;
    }catch(e){$('order-witness-body').textContent='Companion example reports are unavailable: '+e.message;}
  }
  async function boot(){
    try{
      setBusy(true,'Preparing local instruments');
      state.manifestText=await fetchText('data/manifest.json'); state.manifest=JSON.parse(state.manifestText);
      const codeFiles=['engine.js','witness-core.js','workbench-worker.js','worker-client.js','workbench.js','vendor/lab-stack.js'];
      state.instrument={name:'semantic-twin-browser-workbench',version:'2.0.0',data_scope:'installed ontology slice and scenes',engines:await fetchJSON('vendor/lab-stack.json'),code:await Promise.all(codeFiles.map(async path=>({path,sha256:await hash(await fetchText(path))})))};
      await client.init();setBusy(false);session('Ready · local semantic engine');
      const tab=location.hash.slice(1);if(['reason','lists','integrity','repair'].includes(tab))showTab(tab);
      orderWitness();if(!tab||tab==='reason')$('run-reason').click();
    }catch(e){setBusy(false);showError(e.message);session('Startup incomplete');}
  }
  window.addEventListener('beforeunload',()=>client.dispose());
  boot();
})();
