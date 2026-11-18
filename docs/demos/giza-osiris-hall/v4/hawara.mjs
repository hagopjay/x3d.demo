// Architectural dimensions, lower walls and water elevation are illustrative.
import {lookAt,fitOrtho} from './review-core.mjs';
export const HAWARA_LIGHTS={
 study:{key:[1,.83,.61],direction:[-.4,-1,-.3],intensity:.85,fill:[.48,.69,1],fillIntensity:.24,background:[.012,.025,.04]},
 raking:{key:[1,.69,.36],direction:[-.95,-.2,-.3],intensity:1,fill:[.38,.58,.9],fillIntensity:.12,background:[.018,.019,.025]},
 night:{key:[.42,.66,1],direction:[-.2,-.75,-.5],intensity:.55,fill:[.55,.36,.72],fillIntensity:.16,background:[.004,.009,.021]}
};
export function hawaraCamera(view,aspect=1){
 if(!Number.isFinite(aspect)||aspect<=0)throw Error('Camera aspect must be positive');
 if(!['plan','section','oblique'].includes(view))throw Error('Unknown Hawara camera');
 if(view==='plan')return {position:[0,500,-71],target:[0,0,-71],orientation:lookAt([0,500,-71],[0,0,-71]),fov:fitOrtho([-158,-196,158,196],aspect)};
 if(view==='section')return {position:[0,-10,500],target:[0,-10,0],orientation:[0,1,0,0],fov:fitOrtho([-158,-71,158,71],aspect)};
 // Fit the entire scene bounding sphere on the smaller viewport axis.
 const target=[0,-10,-71],radius=260,fov=.8,distance=radius/Math.sin(fov/2)*1.06;
 const position=[0,target[1]+distance*.52,target[2]+distance*.854];
 return {position,target,orientation:lookAt(position,target),fov};
}
export function hawaraScene({view='oblique',depth=-10,lower=false,ghost=.75,water=true,light='study',aspect=1}={}) {
 if(!Number.isFinite(depth)||depth< -70||depth> -8)throw Error('Illustrative depth must be between -70 and -8');
 if(!Number.isFinite(ghost)||ghost<0||ghost>1)throw Error('Transparency must be between 0 and 1');
 const c=hawaraCamera(view,aspect),lighting=HAWARA_LIGHTS[light];if(!lighting)throw Error('Unknown Hawara lighting');
 const defined=new Set();
 const material=(id,color,alpha=0)=>{if(defined.has(id))return `<Material USE='${id}'/>`;defined.add(id);return `<Material DEF='${id}' diffuseColor='${color}' specularColor='.12 .11 .09' shininess='.16' transparency='${alpha}'/>`;};
 const box=(x,y,z,w,h,d,id,color,alpha=0)=>`<Transform translation='${x} ${y} ${z}'><Shape><Appearance>${material(id,color,alpha)}</Appearance><Box size='${w} ${h} ${d}'/></Shape></Transform>`;
 let geometry=box(0,-1,0,300,2,240,'H_Ground','.22 .17 .10',lower?.95:.25),walls='';
 for(let row=0;row<2;row++)for(let col=0;col<6;col++){
  const x=-125+col*50,z=-60+row*120;
  geometry+=box(x,1,z,46,2,108,'H_Floor','.6 .43 .23',lower?ghost:0);
  for(const dz of [-52,52])geometry+=box(x,9,z+dz,46,16,2,'H_Shell','.9 .7 .4',ghost);
  for(const dx of [-22,22])geometry+=box(x+dx,9,z,2,16,104,'H_Shell','.9 .7 .4',ghost);
  for(let k=0;k<5;k++)for(const dx of [-17,17])geometry+=`<Transform translation='${x+dx} 7 ${z-40+k*20}'><Shape><Appearance>${material('H_Column','.85 .65 .35')}</Appearance><Cylinder radius='1.5' height='12'/></Shape></Transform>`;
  for(let k=0;k<4;k++)walls+=box(x,-4,z-40+k*26,40,7,2,'H_Lower','.65 .12 .55',.25);
 }
 geometry+=`<Switch DEF='H_LowerSwitch' whichChoice='${lower?0:-1}'><Transform DEF='H_LowerRig' translation='0 ${depth} 0'>${walls}</Transform></Switch>`;
 geometry+=`<Transform translation='0 0 -215'><Shape><Appearance>${material('H_Pyramid','.48 .32 .18')}</Appearance><IndexedFaceSet coordIndex='0 1 4 -1 1 2 4 -1 2 3 4 -1 3 0 4 -1' solid='false'><Coordinate point='-52 0 -52 52 0 -52 52 0 52 -52 0 52 0 58 0'/></IndexedFaceSet></Shape></Transform>`;
 geometry+=`<Switch DEF='WATER' whichChoice='${water?0:-1}'>${box(0,-5,0,310,.3,250,'H_Water','.08 .5 .8',.76)}</Switch>`;
 const camera=`<${view==='oblique'?'Viewpoint':'OrthoViewpoint'} DEF='H_Camera' position='${c.position.join(' ')}' centerOfRotation='${c.target.join(' ')}' orientation='${c.orientation.join(' ')}' fieldOfView='${Array.isArray(c.fov)?c.fov.join(' '):c.fov}'/>`;
 return `<X3D profile='Immersive' version='4.0'><head><component name='Rendering' level='5'/><component name='Navigation' level='3'/><meta name='geometry-status' content='Artistic reconstruction; dimensions illustrative; no survey registration'/></head><Scene><WorldInfo title='Hawara / illustrative twelve-court model'/><Background DEF='H_BG' skyColor='${lighting.background.join(' ')}'/><NavigationInfo type='"EXAMINE" "ANY"' headlight='false' transitionType='"ANIMATE"' transitionTime='.65'/>${camera}<DirectionalLight DEF='H_Key' global='true' color='${lighting.key.join(' ')}' direction='${lighting.direction.join(' ')}' intensity='${lighting.intensity}' ambientIntensity='.16'/><DirectionalLight DEF='H_Fill' global='true' direction='.4 -.3 .8' color='${lighting.fill.join(' ')}' intensity='${lighting.fillIntensity}'/><Group>${view==='section'?"<ClipPlane plane='0 0 -1 0'/>":''}${geometry}</Group></Scene></X3D>`;
}
export const chapters=[
 {year:'c. 1850 BCE',title:'From plateau to provincial cosmos',tier:'ARCHAEOLOGICAL CONTEXT',body:'Hawara belongs to Amenemhat III’s Middle Kingdom pyramid landscape in the Faiyum. It is a separate site, roughly 90 km south of Giza: this chapter is a comparison across place and time, not a newly found extension beneath the plateau. Monumental enclosure and repeated courts offer a visual counterpoint to Giza’s concentrated silhouettes.',url:'https://www.ucl.ac.uk/museums-static/digitalegypt/archaeology/sitesindex.html'},
 {year:'5th century BCE',title:'Herodotus: seeing and hearing',tier:'CLASSICAL TESTIMONY',body:'Histories 2.148 describes twelve courts and 3,000 chambers divided equally above and below ground. Herodotus says he saw the upper rooms; the lower rooms, associated with kings and sacred crocodiles, were reported to him by custodians. His numbers are testimony, not a measured floor plan. Our twelve-court colonnade is a new artistic arrangement.',url:'https://lexundria.com/hdt/2.148/mcly'},
 {year:'1st century BCE–1st century CE',title:'An architecture remembered in words',tier:'CLASSICAL ACCOUNTS / READING TRAIL',body:'Compare Strabo, Geography 17.1.37; Diodorus, Library 1.61; and Pliny, Natural History 36.84–89. Their narratives emphasize administrative multiplicity, monumental stonework and difficult circulation. These references are a reading trail; this edition did not independently read all three passages and does not treat them as three independent surveys.',url:'https://www.perseus.tufts.edu/hopper/'},
 {year:'1888–1911',title:'The ruin, the archive and the portrait',tier:'EXCAVATION HISTORY',body:'Petrie investigated the pyramid, temple ruins and cemeteries. Hawara’s later funerary portraits add another stylistic evolution: individual faces and painted memory beside royal monumental architecture. The surviving evidence and incomplete excavation contexts constrain reconstruction. This model does not reproduce a Petrie plan or claim an exact foundation footprint.',url:'https://www.ucl.ac.uk/3dpetriemuseum/stories/excavation-and-rediscovery/tour-of-the-nile/hawara-1.html'},
 {year:'2008',title:'A field response is not a room photograph',tier:'GEOPHYSICAL INTERPRETATION',body:'The Mataha project reports geophysical investigations with NRIAG and Ghent University, including possible wall-like anomalies. Reports of an 8–12 m grid remain interpretations here: no raw radar volume is loaded into this Atlas. Groundwater, salinity, geology, calibration and excavation context matter. The blue sheet is a qualitative water-risk illustration, not a measured water elevation.',url:'https://archaeologicalrescue.org/hawara/'},
 {year:'2026',title:'Fieldwork reports, with provenance attached',tier:'PROJECT-REPORTED / NOT INDEPENDENTLY VERIFIED',body:'The Archaeological Rescue Foundation reports renewed digging and an exposed large wall. This pass found that advocate’s update but did not locate an authoritative excavation publication establishing date, depth, stratigraphy or an intact underground complex. The scene therefore adds no newly confirmed excavation geometry.',url:'https://archaeologicalrescue.org/2026/10/26/hawara-update-3/'},
 {year:'Contemporary',title:'From podcast narrative to a testable claim',tier:'UNVERIFIED / OPTIONAL IMAGINATION',body:'Podcast and independent-research narratives, including the Ben van Kerkwyk discussion supplied with this request, amplify deep multi-level and “metallic object” interpretations. This edition has not verified a Bob Lazar attribution. Claims of four levels at 60–70 m or a 40 m metallic object are not established excavation findings here. We omit the object rather than assign an invented material or scan signature. Enable the magenta lower-layout illustration to explore how easily a persuasive image can outrun its evidence.',url:'https://archaeologicalrescue.org/hawara/'}
];
