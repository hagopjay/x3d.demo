// Pure camera and presentation math. Coordinates are X3D metres, +Y up, -Z gaze.
function number(value, label) {
 if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
 return value;
}
function vector(value, label) {
 if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 3) throw new TypeError(`${label} must have three coordinates`);
 return Array.from(value, (v, i) => number(v, `${label}[${i}]`));
}
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function normalize(v) {
 const length = Math.hypot(...v);
 if (!Number.isFinite(length) || length === 0) throw new RangeError('Camera direction must be finite and nonzero');
 return v.map(x => x/length);
}
const clamp = t => Math.min(1, Math.max(0, t));
const mix = (a, b, t) => a.map((v, i) => v*(1-t)+b[i]*t);
/** Return an X3D axis-angle orientation whose local -Z points at target. */
export function lookAt(position, target) {
 const p = vector(position, 'position'), t = vector(target, 'target');
 const forward = normalize(t.map((v, i) => v-p[i]));
 // Looking vertically leaves roll undefined; choose a deterministic north-facing up.
 const up = Math.abs(forward[1]) > .999999 ? [0, 0, -1] : [0, 1, 0];
 const right = normalize(cross(forward, up)), trueUp = cross(right, forward), back = forward.map(v => -v);
 const m00=right[0],m01=trueUp[0],m02=back[0],m10=right[1],m11=trueUp[1],m12=back[1],m20=right[2],m21=trueUp[2],m22=back[2];
 let x,y,z,w;
 const trace=m00+m11+m22;
 if(trace>0){const s=2*Math.sqrt(trace+1);w=s/4;x=(m21-m12)/s;y=(m02-m20)/s;z=(m10-m01)/s;}
 else if(m00>m11&&m00>m22){const s=2*Math.sqrt(Math.max(0,1+m00-m11-m22));w=(m21-m12)/s;x=s/4;y=(m01+m10)/s;z=(m02+m20)/s;}
 else if(m11>m22){const s=2*Math.sqrt(Math.max(0,1+m11-m00-m22));w=(m02-m20)/s;x=(m01+m10)/s;y=s/4;z=(m12+m21)/s;}
 else {const s=2*Math.sqrt(Math.max(0,1+m22-m00-m11));w=(m10-m01)/s;x=(m02+m20)/s;y=(m12+m21)/s;z=s/4;}
 if(w<0){x=-x;y=-y;z=-z;w=-w;}
 const sinHalf=Math.hypot(x,y,z);
 if(sinHalf<1e-12)return [0,1,0,0];
 return [x/sinHalf,y/sinHalf,z/sinHalf,2*Math.atan2(sinHalf,w)];
}
/** Sample a position AND attention target, then derive the gaze; never SLERP unrelated aims. */
export function sampleTour(stops, seconds, {motion='smooth',hold=1.2}={}) {
 number(seconds,'seconds');number(hold,'hold');
 if(hold<0)throw new RangeError('hold must be nonnegative');
 if(!['smooth','linear','cuts','cut'].includes(motion))throw new RangeError('Unknown tour motion');
 if(!Array.isArray(stops)||!stops.length)throw new TypeError('Tour requires at least one stop');
 const checked=stops.map((stop,i)=>{
  if(!stop||typeof stop!=='object')throw new TypeError('Invalid tour stop');
  const t=number(stop.t,'stop time'),position=vector(stop.position,'stop position'),target=vector(stop.target,'stop target');
  if(i&&t<=stops[i-1].t)throw new RangeError('Tour times must strictly increase');
  lookAt(position,target);return {t,position,target};
 });
 let index=0;for(let i=1;i<checked.length;i++){if(checked[i].t<=seconds)index=i;else break;}
 const from=checked[index],to=checked[index+1];
 let position=from.position.slice(),target=from.target.slice();
 if(to&&seconds>from.t&&motion!=='cuts'&&motion!=='cut'){
  const span=to.t-from.t;
  // Very short imported spans retain a nonzero transition interval.
  const dwell=motion==='smooth'?Math.min(hold,span*.8):0;
  let u=clamp((seconds-from.t-dwell)/(span-dwell));
  if(motion==='smooth')u=u*u*(3-2*u);
  position=mix(from.position,to.position,u);target=mix(from.target,to.target,u);
 }
 return {position,target,orientation:lookAt(position,target),index};
}
/** Blend equal-length flat colour arrays without mutating either input. */
export function colorBlend(from,to,t) {
 number(t,'blend fraction');
 if((!Array.isArray(from)&&!ArrayBuffer.isView(from))||(!Array.isArray(to)&&!ArrayBuffer.isView(to))||from.length!==to.length)throw new TypeError('Colour arrays must have equal lengths');
 const u=clamp(t),out=new Float32Array(from.length);
 for(let i=0;i<from.length;i++){
  const a=number(from[i],'colour'),b=number(to[i],'colour');out[i]=a*(1-u)+b*u;
  if(!Number.isFinite(out[i]))throw new RangeError('Colour is outside Float32 range');
 }
 return out;
}
/** Fit [minX,minY,maxX,maxY] into an orthographic viewport without cropping. */
export function fitOrtho(bounds,aspect,padding=1.08) {
 if((!Array.isArray(bounds)&&!ArrayBuffer.isView(bounds))||bounds.length!==4)throw new TypeError('Bounds require four coordinates');
 const [minX,minY,maxX,maxY]=Array.from(bounds,(v)=>number(v,'bound'));
 number(aspect,'aspect');number(padding,'padding');
 if(aspect<=0||padding<1||maxX<=minX||maxY<=minY)throw new RangeError('Bounds, aspect and padding must define a positive uncropped frame');
 const cx=minX/2+maxX/2,cy=minY/2+maxY/2;
 let width=(maxX-minX)*padding,height=(maxY-minY)*padding;
 if(width/height<aspect)width=height*aspect;else height=width/aspect;
 const result=[cx-width/2,cy-height/2,cx+width/2,cy+height/2];
 if(!result.every(Number.isFinite))throw new RangeError('Frame exceeds numeric range');
 return result;
}

// Authored v3 tour attention points; schematic model coordinates.
export const TOUR_STOPS = [{"t":0,"position":[-80.0,420.0,760.0],"target":[-330,-40,-120]},{"t":7,"position":[110.0,18.0,95.0],"target":[0,12,-6]},{"t":14,"position":[-193.0,14.0,32.0],"target":[-223,-5,-28]},{"t":20,"position":[-224.0,-17.0,6.0],"target":[-224,-17,-28]},{"t":26,"position":[-222.0,-21.6,-26.8],"target":[-216,-22,-28.3]},{"t":32,"position":[62.0,-4.0,38.0],"target":[30,-8,0]},{"t":38,"position":[40.0,30.0,130.0],"target":[125,-21,18]},{"t":44,"position":[100.0,-29.2,18.0],"target":[139,-28.5,18]},{"t":52,"position":[-171.0,-330.0,565.0],"target":[-651,-330,-95]},{"t":60,"position":[-159.0,60.0,-235.0],"target":[-329,40,-435]},{"t":68,"position":[-80.0,420.0,760.0],"target":[-330,-40,-120]}];
