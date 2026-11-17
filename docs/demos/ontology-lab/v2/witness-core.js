/* Local experiments over the shipped data. No ontology or gate is fetched remotely. */
(function (G) {
  'use strict';
  const L=G.E_lab_stack,D=L.DataFactory,nn=D.namedNode;
  const RDF='http://www.w3.org/1999/02/22-rdf-syntax-ns#',RDFS='http://www.w3.org/2000/01/rdf-schema#';
  const BASE='https://semantic-twin-lab.example/TheCabinet.ttl#',X='https://www.web3d.org/specifications/X3dOntology4.1#';
  const first=nn(RDF+'first'),rest=nn(RDF+'rest'),nil=RDF+'nil';
  const textEncoder=new TextEncoder();
  const key=t=>JSON.stringify([t.termType,t.value,t.language||'',t.datatype?.value||'']);
  function term(t){return t?{termType:t.termType,value:t.value,...(t.termType==='Literal'?{datatype:t.datatype?.value||'',language:t.language||''}:{})}:null;}
  async function sha256(value){const bytes=typeof value==='string'?textEncoder.encode(value):value;const hash=await G.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function inspectList(store,head,{maxItems=128}={}){
    const cells=[],seen=new Set();let cursor=head;
    while(cursor.value!==nil){
      if(cells.length>=maxItems)throw new Error('List exceeds the traversal budget');
      if(!['BlankNode','NamedNode'].includes(cursor.termType))throw new Error('List rest must be an RDF node');
      const id=key(cursor);if(seen.has(id))throw new Error('Cyclic RDF list');seen.add(id);
      const f=store.getObjects(cursor,first,null),r=store.getObjects(cursor,rest,null);
      if(f.length!==1||r.length!==1)throw new Error(`Malformed RDF list at cell ${cells.length}: expected exactly one rdf:first and rdf:rest`);
      cells.push({index:cells.length,cell:term(cursor),value:term(f[0])});cursor=r[0];
    }
    if(cursor.termType!=='NamedNode')throw new Error('rdf:nil must be a named node');
    const values=cells.map(c=>c.value);const unique=[...new Map(cells.map(c=>[key(store.getObjects(D[c.cell.termType==='BlankNode'?'blankNode':'namedNode'](c.cell.value),first,null)[0]),c.value])).values()];
    return {length:cells.length,distinctValueCount:unique.length,cells,values,unique,order:'rdf:rest traversal',multiplicity:'preserved'};
  }
  function scanTags(xml){
    const tags=[];let i=0;
    while((i=xml.indexOf('<',i))!==-1){
      if(xml.startsWith('<!--',i)){const e=xml.indexOf('-->',i+4);if(e<0)throw new Error('Unclosed XML comment');i=e+3;continue;}
      if(xml.startsWith('<![CDATA[',i)){const e=xml.indexOf(']]>',i+9);if(e<0)throw new Error('Unclosed CDATA');i=e+3;continue;}
      if(xml.startsWith('<?',i)){const e=xml.indexOf('?>',i+2);if(e<0)throw new Error('Unclosed XML processing instruction');i=e+2;continue;}
      let quote=null,depth=0,end=i+1;
      for(;end<xml.length;end++){const c=xml[end];if(quote){if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==='[')depth++;else if(c===']')depth--;else if(c==='>'&&depth===0)break;}
      if(end===xml.length)throw new Error('Unclosed XML tag');
      const raw=xml.slice(i,end+1);if(!raw.startsWith('<!')&&!raw.startsWith('</'))tags.push({start:i,end:end+1,raw});i=end+1;
    }
    return tags;
  }
  function attributeWitness(xml,defName,attribute){
    if(!/^[A-Za-z_][\w:.-]*$/.test(attribute))throw new Error('Invalid XML attribute name');
    const hits=[];
    for(const tag of scanTags(xml)){
      const name=/^<([A-Za-z_][\w:.-]*)/.exec(tag.raw)?.[1];if(!name)continue;
      const attrs=new Map();const re=/([A-Za-z_][\w:.-]*)\s*=\s*(['"])([\s\S]*?)\2/g;let m;
      while((m=re.exec(tag.raw))){if(attrs.has(m[1]))throw new Error('Duplicate XML attribute');const localStart=m.index+m[0].indexOf(m[2])+1;attrs.set(m[1],{value:m[3],start:tag.start+localStart,end:tag.start+localStart+m[3].length,quote:m[2]});}
      if(attrs.get('DEF')?.value===defName){if(!attrs.has(attribute))throw new Error('Target attribute is absent');hits.push({nodeType:name,...attrs.get(attribute)});}
    }
    if(hits.length!==1)throw new Error(`Expected exactly one DEF ${defName}; found ${hits.length}`);
    const hit=hits[0],line=xml.slice(0,hit.start).split('\n').length;
    return {...hit,def:defName,attribute,line,byteStart:textEncoder.encode(xml.slice(0,hit.start)).length,byteEnd:textEncoder.encode(xml.slice(0,hit.end)).length,lineText:xml.split('\n')[line-1]};
  }
  async function repairRuby(xml,components,expectedSha){
    if(!Array.isArray(components)||components.length!==3||!components.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1))throw new Error('Colour must have three finite components in [0,1]');
    const beforeSha=await sha256(xml);if(beforeSha!==expectedSha)throw new Error('Stale source witness: input SHA-256 changed');
    const witness=attributeWitness(xml,'Ruby','diffuseColor');if(witness.nodeType!=='Material')throw new Error('Ruby is not a Material');
    const value=components.map(String).join(' '),repaired=xml.slice(0,witness.start)+value+xml.slice(witness.end);
    return {xml:repaired,witness:{...witness,oldValue:witness.value,newValue:value,beforeSha256:beforeSha,afterSha256:await sha256(repaired),change:'one attribute value',scope:'fixture-scoped lexical X3D edit; not a schema validator'}};
  }
  let fetcher,manifest,stations;
  const cached=new Map();
  async function load(path){if(!cached.has(path))cached.set(path,fetcher(path));return cached.get(path);}
  function init(fetchText,man,st){fetcher=fetchText;manifest=man;stations=st;cached.clear();}
  async function graph(name){const path=manifest.graphs[name];if(!path)throw new Error('Unknown graph');return new L.Store(new L.Parser().parse(await load(path)));}
  async function sourceInputs(paths){return Promise.all(paths.map(async path=>{const text=await load(path);return {path,sha256:await sha256(text),bytes:textEncoder.encode(text).length};}));}
  async function listExperiment({scene='cabinet',subject='Pearl'}={}){
    if(!/^[A-Za-z_][\w.-]*$/.test(subject))throw new Error('Invalid specimen name');
    const store=await graph(scene),heads=store.getObjects(nn(BASE+subject),nn(X+'diffuseColor'),null);
    if(heads.length!==1)throw new Error('Specimen must have exactly one diffuseColor list');
    const list=inspectList(store,heads[0]);
    const query=`PREFIX : <${BASE}>\nPREFIX x3do: <${X}>\nPREFIX rdf: <${RDF}>\nSELECT ?component WHERE { :${subject} x3do:diffuseColor/rdf:rest*/rdf:first ?component }`;
    const bag=await G.LabEngine.run({kind:'select',graph:[scene],query});
    const distinct=await G.LabEngine.run({kind:'select',graph:[scene],query:query.replace('SELECT ?component','SELECT DISTINCT ?component')});
    return {operation:'ordered-list',scene,subject:BASE+subject,list,query,bag,distinct,inputs:await sourceInputs([manifest.graphs[scene]]),note:'Plain SELECT preserves solution multiplicity here. DISTINCT and SHACL value-node sets are different projections; neither assigns an RGB axis.'};
  }
  async function reasonExperiment({scene='fault-F5',profile='rdfs'}={}){
    if(!['none','subclass','rdfs'].includes(profile))throw new Error('Unknown reasoning profile');
    const st=await graph(scene);const box=st.getSubjects(nn(RDF+'type'),nn(X+'Box'),null).find(t=>t.value.endsWith('Box_2_12_3_6'))||st.getSubjects(nn(RDF+'type'),nn(X+'Box'),null)[0];
    const report=await G.LabEngine.inspectReasoning({graphs:[scene,'slice'],profile,focus:box?[box.value]:[]});
    const shape=stations.stations.find(s=>s.id==='T3.4').jobs.main.spec.shapes_ttl;
    const baseline=await G.LabEngine.run({kind:'shacl',graph:[scene,'slice'],inference:'none',shapes_ttl:shape});
    const after=profile==='none'?baseline:await G.LabEngine.run({kind:'shacl',graph:[scene,'slice'],inference:profile,shapes_ttl:shape});
    const paths=[manifest.graphs[scene],manifest.graphs.slice];if(profile!=='none')paths.push(manifest.content_paths[`rules/${profile}.n3`]);
    return {operation:'reasoning-counterfactual',scene,profile,report,baseline,after,inputs:await sourceInputs(paths),shapesSha256:await sha256(shape),scope:'Only S7 placement membership is checked; this is not full X3D validation.',sourceChanged:false};
  }
  async function validation(store,shapeText,slice){
    const shapes=new L.Store(new L.Parser().parse(shapeText));for(const q of slice.match(null,nn(RDFS+'subClassOf'),null))shapes.add(q);
    const r=await new L.Validator(shapes,{factory:D,validations:L.sparqlValidations}).validate({dataset:store});
    return {conforms:r.conforms,count:r.results.length,results:r.results.slice(0,30).map(v=>({focus:term(v.focusNode?.term),value:term(v.value?.term),severity:term(v.severity),message:(v.message||[]).map(x=>x.value).join(' | ')}))};
  }
  async function repairExperiment({components=[.85,.08,.16]}={}){
    const path='data/scenes/fault-F1.xml',xml=await load(path),fixed=await repairRuby(xml,components,await sha256(xml));
    const st=await graph('fault-F1'),slice=await graph('slice');
    const head=st.getObjects(nn(BASE+'Ruby'),nn(X+'diffuseColor'),null)[0];const list=inspectList(st,head);if(list.length!==3)throw new Error('Ruby RDF colour has unexpected arity');
    const projected=new L.Store(st.getQuads(null,null,null,null));
    let cursor=head;
    for(let i=0;i<3;i++){const old=projected.getObjects(cursor,first,null)[0];projected.removeQuad(D.quad(cursor,first,old));projected.addQuad(D.quad(cursor,first,D.literal(String(components[i]),old.datatype)));cursor=projected.getObjects(cursor,rest,null)[0];}
    const shape=stations.stations.find(s=>s.id==='T4.2').jobs.main.spec.shapes_ttl;
    const before=await validation(st,shape,slice),after=await validation(projected,shape,slice);
    return {operation:'repair-witness',...fixed,before,after,inputs:await sourceInputs([path,manifest.graphs['fault-F1'],manifest.graphs.slice]),shapesSha256:await sha256(shape),projection:'The same RGB values were applied to the existing RDF list and checked with S1. This is not an independent XML-to-RDF rebuild or a full XSD gate.'};
  }
  G.WitnessCore={term,sha256,inspectList,attributeWitness,repairRuby,init,listExperiment,reasonExperiment,repairExperiment};
})(typeof self==='undefined'?globalThis:self);
