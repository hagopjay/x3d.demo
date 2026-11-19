/* NEXUS: the UI reads measured artifacts; all live geometry is rendered by X_ITE. */
"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {manifest:null, index:0, variant:"source", browser:null, loading:false,
    playing:false, scenePaused:reducedMotion, elapsed:0, lastTick:0, loadSequence:0, cameraIndex:0,viewpoints:[]};
  const metricNames = {objects:"Scene objects",meshes:"Mesh objects",vertices:"Vertices",triangles:"Triangles",
    materials:"Materials",shared_mesh_users:"Users of shared meshes",x3d_bytes:"X3D file size",
    unique_meshes:"Unique mesh data",bounds_min:"World bounds / minimum",bounds_max:"World bounds / maximum",
    ifc_guids:"IFC element identities",camera_labels:"Scene cameras",animated_objects:"Animated objects",
    x3d_nodes:"X3D nodes",geometry_use_count:"Geometry USE references"};
  const number = value => value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-US").format(Number(value)) : "—";
  const size = value => {
    if (value===null||value===undefined||value===""||!Number.isFinite(Number(value))) return "—";
    const n = Number(value);
    if(n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    if(n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  };
  const time = value => `${Math.floor(Math.max(0,value)/60).toString().padStart(2,"0")}:${Math.floor(Math.max(0,value)%60).toString().padStart(2,"0")}`;
  const metricValue = (key,value) => {
    if(key.endsWith("bytes"))return size(value);
    if(Array.isArray(value)){
      if(value.length&&value.length<=4&&value.every(item=>typeof item==="number"))return value.map(item=>Number(item.toFixed(5))).join(", ");
      return `${number(value.length)} ${key==="ifc_guids"?"identities":key==="camera_labels"?"cameras":"entries"}`;
    }
    if(value&&typeof value==="object")return `${number(Object.keys(value).length)} recorded fields`;
    return typeof value==="number"?number(value):String(value);
  };
  const chapter = () => state.manifest?.chapters?.[state.index];
  const kicker = item => (item.kicker || item.source_kind || "OPEN SCENE").replace(/^\d{1,2}\s*[/·—-]\s*/,"");
  function element(tag, className, text) {
    const node=document.createElement(tag);
    if(className) node.className=className;
    if(text !== undefined) node.textContent=text;
    return node;
  }
  function toast(message) {
    $("toast").textContent=message;$("toast").classList.add("visible");
    clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>$("toast").classList.remove("visible"),3500);
  }
  function assetURL(path) {
    if(!path || typeof path !== "string") return null;
    const url=new URL(path,document.baseURI);
    if(url.origin !== location.origin || !["http:","https:"].includes(url.protocol)) return null;
    return url.href;
  }
  function safeDownload(path, label) {
    const href=assetURL(path);if(!href)return null;
    const link=element("a","",label);link.href=href;link.download="";return link;
  }
  function setRenderStatus(label, mode="ready") {
    $("renderLabel").textContent=label;
    $("liveDot").style.background=mode==="error"?"var(--warn)":mode==="loading"?"var(--muted)":"var(--cyan)";
  }
  function showError(message) {
    $("sceneLoading").hidden=true;$("sceneError").hidden=false;$("sceneErrorDetail").textContent=message;
    $("scene").hidden=true;
    $("viewport").setAttribute("aria-busy","false");setRenderStatus(chapter()?.poster?"POSTER / LIVE VIEW UNAVAILABLE":"LIVE VIEW UNAVAILABLE","error");
    const poster=assetURL(chapter()?.poster);
    if(poster){$("scenePoster").src=poster;$("scenePoster").hidden=false;}
  }
  function renderPlaylist() {
    const list=$("playlist");list.replaceChildren();
    state.manifest.chapters.forEach((item,index)=>{
      const li=element("li"),button=element("button","playlist-item");
      button.type="button";button.dataset.index=index;button.setAttribute("aria-label",`Chapter ${index+1}: ${item.title}`);
      const copy=element("span"),title=element("span","chapter-name",item.title || `Chapter ${index+1}`);
      copy.append(title,element("span","chapter-subtitle",kicker(item)));
      button.append(element("span","chapter-number",String(index+1).padStart(2,"0")),copy,element("span","chapter-arrow","→"));
      button.addEventListener("click",()=>selectChapter(index));li.append(button);list.append(li);
    });
    $("chapterCount").textContent=`${state.manifest.chapters.length.toString().padStart(2,"0")} CHAPTERS`;
  }
  function updateChapterUI() {
    const item=chapter();if(!item)return;
    document.querySelectorAll(".playlist-item").forEach(button=>{
      const active=Number(button.dataset.index)===state.index;button.classList.toggle("active",active);
      if(active) button.setAttribute("aria-current","step");else button.removeAttribute("aria-current");
    });
    $("chapterKicker").textContent=`${String(state.index+1).padStart(2,"0")} / ${kicker(item)}`;
    $("chapterTitle").textContent=item.title || "Untitled scene";
    $("chapterDescription").textContent=item.description || "Explore the generated asset and its measured handoffs.";
    $("currentChapter").textContent=item.title || "Untitled scene";
    $("sourceKind").textContent=item.source_kind || "SYNTHETIC DATASET";
    $("duration").textContent=time(item.duration_seconds || 30);
    $("roundtripButton").disabled=!item.roundtrip_x3d;
    $("sourceButton").classList.toggle("selected",state.variant==="source");
    $("roundtripButton").classList.toggle("selected",state.variant==="roundtrip");
    $("sourceButton").setAttribute("aria-pressed",String(state.variant==="source"));
    $("roundtripButton").setAttribute("aria-pressed",String(state.variant==="roundtrip"));
    $("featureChips").replaceChildren(...(item.features || []).slice(0,4).map(feature=>element("span","feature-chip",feature)));
    const metrics=item.metrics || {};
    $("metrics").replaceChildren(...[["objects","OBJECTS",number],["triangles","TRIANGLES",number],["materials","MATERIALS",number],["x3d_bytes","X3D SIZE",value=>size(value).replace(" ","")]].map(([key,label,format])=>{
      const box=element("div","metric");box.append(element("strong","",format(metrics[key])),element("span","",label));return box;
    }));
    const links=[];const source=safeDownload(item.x3d,"X3D 4.0");if(source)links.push(source);
    const labels={blend:"ORIGINAL BLENDER",imported_blend:"IMPORTED BLENDER",glb:"HUB → GLB",gltf:"HUB → glTF",usd:"HUB → USD",usda:"HUB → USD",ifc:"IFC / BONSAI",video:"VIDEO"};
    Object.entries(item.downloads || {}).filter(([kind])=>Object.hasOwn(labels,kind)).forEach(([kind,path])=>{const link=safeDownload(path,labels[kind]);if(link)links.push(link);});
    if(item.roundtrip_x3d){const link=safeDownload(item.roundtrip_x3d,"ROUND TRIP");if(link)links.push(link);}
    $("downloads").replaceChildren(...links);
    if(!links.length)$("downloads").append(element("span","muted","No downloadable artifacts in this chapter"));
    state.cameraIndex=0;$("cameraLabel").textContent="Next camera";
    updateEvidence();updateProgress();
  }
  function updateEvidence() {
    const item=chapter();if(!item)return;
    $("evidenceTitle").textContent=item.title || "Under the surface.";
    $("evidenceDescription").textContent=item.description || "Measured artifacts for this chapter.";
    const labels={pass:"verified",warn:"review",not_run:"not run",info:"information",fail:"failed",failed:"failed"};
    const icons={pass:"✓",warn:"△",not_run:"○",info:"i",fail:"!",failed:"!"};
    const checks=(item.checks || []).map(check=>{
      const status=Object.hasOwn(labels,check.status)?check.status:"info";
      const row=element("div",`check-item ${status}`),copy=element("div"),title=element("strong","",check.label || "Check");
      title.append(element("span","check-status",labels[status]));copy.append(title,element("p","",check.detail || "No additional detail recorded."));
      row.append(element("span","check-symbol",icons[status]),copy);return row;
    });
    if(!checks.length)checks.push(element("p","muted","No checks were recorded for this chapter. Rendering a scene is not a validation result."));
    $("checks").replaceChildren(...checks);
    $("detailedMetrics").replaceChildren(...Object.entries(item.metrics || {}).map(([key,value])=>{
      const row=element("div");row.append(element("dt","",metricNames[key] || key.replaceAll("_"," ")),element("dd","",metricValue(key,value)));return row;
    }));
    $("evidenceFeatures").replaceChildren(...(item.features || []).map(feature=>element("span","feature-chip",feature)));
    const artifactLabels={blend:"Original Blender scene",glb:"X3D → Blender → GLB",gltf:"X3D → Blender → glTF",
      usd:"X3D → Blender → USD",native_glb:"Blender → GLB reference",native_usd:"Blender → USD reference",
      imported_blend:"Imported Blender scene",source:"Original input",x3d:"First X3D export",
      roundtrip_x3d:"Round-trip X3D",evidence:"Measurement record / JSON",ifc:"IFC / Bonsai model",ifc_data:"IFC tessellation / JSON"};
    $("evidenceDownloads").replaceChildren(...Object.entries(item.downloads || {}).map(([kind,path])=>
      safeDownload(path,artifactLabels[kind] || kind.replaceAll("_"," "))).filter(Boolean));
    $("runtimeFingerprint").textContent=`Blender ${state.manifest.runtime?.blender || "version unrecorded"} · commit ${(state.manifest.repo?.commit || "unrecorded").slice(0,12)}`;
  }
  function renderRoutes() {
    const labels={pass:"Verified locally",verified:"Verified locally",warn:"Review required",not_run:"Prepared / not run",prepared:"Prepared / not run",info:"Recorded handoff",fail:"Failed check",failed:"Failed check"};
    const routes=(state.manifest.routes || []).map(route=>{
      const card=element("article","route-card"),direction=element("div","route-direction");
      direction.append(element("span","",route.from),element("span","route-arrow","→"),element("span","",route.to));
      const status=element("div",`route-status ${["pass","verified"].includes(route.status)?"pass":["warn","fail","failed"].includes(route.status)?"warn":""}`,labels[route.status] || "Not verified");
      card.append(direction,status,element("p","route-detail",route.detail || "No handoff detail recorded."));return card;
    });
    $("pipelineRoutes").replaceChildren(...routes);
    if(!routes.length)$("pipelineRoutes").append(element("p","muted","No exchange route checks were recorded."));
  }
  async function renderer() {
    if(state.browser)return state.browser;
    if(window.nexusRuntimeFailed || !window.X3D)throw new Error("The local X_ITE runtime could not be loaded. Serve this folder over HTTP and check that vendor/x_ite is present.");
    await customElements.whenDefined("x3d-canvas");
    const browser=X3D.getBrowser($("scene"));
    browser.setBrowserOption("StraightenHorizon",false);
    state.browser=browser;return browser;
  }
  function sceneViewpoints(browser) {
    const result=[],seen=new Set();
    const groups=new Set(["Transform","Group","Switch","LOD","Billboard","Collision","Anchor","CADAssembly","CADPart","CADLayer","ViewpointGroup"]);
    function visit(node){
      if(!node||seen.has(node))return;seen.add(node);
      const type=node.getNodeTypeName();
      if(["Viewpoint","OrthoViewpoint","GeoViewpoint"].includes(type))result.push(node);
      if(groups.has(type))for(const child of node.children || [])visit(child);
    }
    for(const node of browser.currentScene.rootNodes)visit(node);
    return result;
  }
  async function loadChapter() {
    const item=chapter();if(!item)return;
    const sequence=++state.loadSequence;state.loading=true;
    $("sceneLoading").hidden=false;$("sceneError").hidden=true;$("scenePoster").hidden=true;$("scene").hidden=false;
    $("loadingDetail").textContent=`${state.variant==="roundtrip"?"Round trip":"Source"} · ${item.title}`;
    $("viewport").setAttribute("aria-busy","true");setRenderStatus("LOADING X3D SCENE","loading");
    const path=state.variant==="roundtrip"?item.roundtrip_x3d:item.x3d;
    let timeout;
    try{
      const url=assetURL(path);if(!url)throw new Error("The manifest does not name a local X3D asset for this view.");
      const browser=await Promise.race([renderer(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error("The local X_ITE renderer did not initialize.")),20000);})]);
      clearTimeout(timeout);if(sequence!==state.loadSequence)return;
      browser.beginUpdate();
      await Promise.race([browser.loadURL(new X3D.MFString(url)),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error("Loading this X3D scene exceeded 60 seconds. Try another chapter or inspect the asset files.")),60000);})]);
      clearTimeout(timeout);if(sequence!==state.loadSequence)return;
      browser.beginUpdate();
      state.viewpoints=sceneViewpoints(browser);
      if(item.camera_labels?.length){
        const selected=state.viewpoints.filter(viewpoint=>item.camera_labels.includes(viewpoint.description));
        if(selected.length)state.viewpoints=selected;
      }
      state.viewpoints.forEach((viewpoint,index)=>viewpoint.addFieldCallback("nexus-camera","isBound",bound=>{
        if(bound){state.cameraIndex=index;$("cameraLabel").textContent=viewpoint.description || `Camera ${index+1}`;}
      }));
      // A reduced-motion scene needs an initial rendered frame before its event loop is paused. Bound that wait:
      // an offscreen canvas can deliberately suspend rendering and never deliver a nextFrame notification.
      if(state.scenePaused&&typeof browser.nextFrame==="function")await Promise.race([
        browser.nextFrame(),new Promise(resolve=>setTimeout(resolve,1000))]);
      if(sequence!==state.loadSequence)return;
      if(state.scenePaused)browser.endUpdate();
      $("sceneLoading").hidden=true;$("sceneError").hidden=true;$("viewport").setAttribute("aria-busy","false");
      setRenderStatus(`LIVE X3D / ${state.variant==="roundtrip"?"ROUND TRIP":"SOURCE"}`);
      $("scene").setAttribute("aria-label",`${item.title}, ${state.variant} X3D. Drag to orbit; scroll to zoom.`);
      state.lastTick=performance.now();
    }catch(error){if(sequence===state.loadSequence)showError(error.message || "This X3D scene could not be opened.");}
    finally{clearTimeout(timeout);if(sequence===state.loadSequence)state.loading=false;}
  }
  function selectChapter(index) {
    if(!state.manifest?.chapters.length)return;
    state.index=(index+state.manifest.chapters.length)%state.manifest.chapters.length;
    state.elapsed=0;
    if(state.variant==="roundtrip"&&!chapter().roundtrip_x3d)state.variant="source";
    history.replaceState(null,"",`#${encodeURIComponent(chapter().id)}`);
    updateChapterUI();loadChapter();
  }
  function chooseVariant(variant){if(state.variant===variant || !chapter())return;state.variant=variant;updateChapterUI();loadChapter();}
  function updateProgress(){
    const duration=chapter()?.duration_seconds || 30;
    const progress=Math.min(100,Math.max(0,state.elapsed/duration*100));
    $("progressFill").style.width=`${progress}%`;$("progressTrack").setAttribute("aria-valuenow",String(Math.round(progress)));
    $("elapsed").textContent=time(state.elapsed);
  }
  function setPlaying(value){
    state.playing=value;state.lastTick=performance.now();
    $("playButton").setAttribute("aria-label",value?"Pause the guided playlist":"Play the guided playlist");
    $("playButton").title=value?"Pause the guided playlist (Space)":"Play the guided playlist (Space)";
    $("playIcon").setAttribute("d",value?"M8 5h2v14H8ZM15 5h2v14h-2Z":"m8 5 11 7-11 7Z");
    $("playState").textContent=value?"GUIDED PLAYLIST":"EXPLORE AT YOUR PACE";
  }
  function setMotion(paused){
    state.scenePaused=paused;
    if(state.browser && !state.loading){if(paused)state.browser.endUpdate();else state.browser.beginUpdate();}
    $("motionButton").setAttribute("aria-pressed",String(paused));$("motionLabel").textContent=paused?"Resume motion":"Pause motion";
    $("motionIcon").setAttribute("d",paused?"m8 5 11 7-11 7Z":"M8 5v14M16 5v14");
    $("motionButton").title=paused?"Resume scene animation (M)":"Pause scene animation (M)";
  }
  function tick(now){
    if(state.playing&&!state.loading&&!document.hidden&&!$("filmDialog").open){
      state.elapsed+=Math.max(0,(now-state.lastTick)/1000);
      if(state.elapsed>=(chapter()?.duration_seconds || 30))selectChapter(state.index+1);
      updateProgress();
    }
    state.lastTick=now;requestAnimationFrame(tick);
  }
  function camera(action){
    if(!state.browser || state.loading){toast("Open a live scene to use the camera controls.");return;}
    try{
      // beginUpdate is necessary when a paused scene needs one camera transition to be shown.
      state.browser.beginUpdate();
      if(state.viewpoints.length){
        const current=state.browser.activeViewpoint?.getNodeName();
        const index=state.viewpoints.findIndex(node=>node.getNodeName()===current);
        const next=action==="first"?0:(index+1)%state.viewpoints.length;
        const target=state.viewpoints[next];
        target.set_bind=true;
      }else if(action==="first")state.browser.firstViewpoint();else state.browser.nextViewpoint();
      if(state.scenePaused)setTimeout(()=>{if(state.scenePaused&&!state.loading)state.browser.endUpdate();},reducedMotion?100:1300);
    }catch(error){toast(`Camera control unavailable: ${error.message}`);}
  }
  function openEvidence(){if(!chapter())return;$("evidencePanel").showModal();$("evidenceButton").setAttribute("aria-expanded","true");}
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await $("viewport").requestFullscreen();}catch{toast("Fullscreen is not available in this browser context.");}}
  $("playButton").addEventListener("click",()=>setPlaying(!state.playing));
  $("nextButton").addEventListener("click",()=>selectChapter(state.index+1));$("previousButton").addEventListener("click",()=>selectChapter(state.index-1));
  $("sourceButton").addEventListener("click",()=>chooseVariant("source"));$("roundtripButton").addEventListener("click",()=>chooseVariant("roundtrip"));
  $("motionButton").addEventListener("click",()=>setMotion(!state.scenePaused));
  $("homeViewButton").addEventListener("click",()=>camera("first"));$("cameraButton").addEventListener("click",()=>camera("next"));
  $("fullscreenButton").addEventListener("click",fullscreen);$("retryButton").addEventListener("click",loadChapter);
  $("evidenceButton").addEventListener("click",openEvidence);
  $("evidencePanel").addEventListener("close",()=>$("evidenceButton").setAttribute("aria-expanded","false"));
  $("keyboardButton").addEventListener("click",()=>$("keyboardDialog").showModal());
  $("filmButton").addEventListener("click",()=>{$("filmDialog").showModal();$("reel").play().catch(()=>{});});
  $("filmDialog").addEventListener("close",()=>$("reel").pause());
  document.querySelectorAll("[data-close]").forEach(button=>button.addEventListener("click",()=>$(button.dataset.close).close()));
  document.querySelectorAll("dialog").forEach(dialog=>dialog.addEventListener("click",event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
  document.addEventListener("fullscreenchange",()=>$("fullscreenButton").setAttribute("aria-label",document.fullscreenElement?"Exit fullscreen":"Enter fullscreen"));
  document.addEventListener("visibilitychange",()=>{state.lastTick=performance.now();});
  document.addEventListener("keydown",event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.target.closest("input,textarea,select,[contenteditable=true]")||document.querySelector("dialog[open]"))return;
    if(event.code==="Space"){event.preventDefault();setPlaying(!state.playing);}
    else if(event.key==="ArrowRight"){event.preventDefault();selectChapter(state.index+1);}
    else if(event.key==="ArrowLeft"){event.preventDefault();selectChapter(state.index-1);}
    else if(/^[1-9]$/.test(event.key)){const i=Number(event.key)-1;if(i<(state.manifest?.chapters.length||0))selectChapter(i);}
    else if(event.key.toLowerCase()==="c")camera("next");else if(event.key.toLowerCase()==="r")camera("first");
    else if(event.key.toLowerCase()==="m")setMotion(!state.scenePaused);else if(event.key.toLowerCase()==="e")openEvidence();
    else if(event.key.toLowerCase()==="f")fullscreen();
  });
  async function init(){
    setMotion(state.scenePaused);requestAnimationFrame(tick);
    try{
      const response=await fetch("./data/manifest.json",{cache:"no-cache"});
      if(!response.ok)throw new Error(`Dataset manifest returned HTTP ${response.status}. Generate the dataset, then serve this folder over HTTP.`);
      const manifest=await response.json();
      if(!Array.isArray(manifest.chapters)||!manifest.chapters.length)throw new Error("The dataset manifest contains no playable chapters.");
      state.manifest=manifest;$("commit").textContent=(manifest.repo?.commit || "unrecorded").slice(0,8);
      if(manifest.repo?.commit)$("repoLink").href=`https://github.com/hagopjay/x3d-blender-io/tree/${encodeURIComponent(manifest.repo.commit)}`;
      renderPlaylist();renderRoutes();
      const video=assetURL(manifest.video);if(video){$("reel").src=video;$("filmButton").disabled=false;}
      const hash=decodeURIComponent(location.hash.slice(1));const initial=manifest.chapters.findIndex(item=>item.id===hash);
      selectChapter(initial>=0?initial:0);
      window.NEXUS={state,selectChapter,chooseVariant,loadChapter};window.nexus=window.NEXUS;
    }catch(error){$("playlist").replaceChildren(element("li","playlist-placeholder","Dataset unavailable"));showError(error.message);}
  }
  init();
})();
