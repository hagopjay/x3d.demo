#version 300 es
precision highp float;
uniform vec3 u_eye,u_base;
uniform float u_kind,u_metal,u_rough,u_mode,u_exposure,u_detail,u_reflections,u_shadowStrength;
uniform float u_debug;
uniform vec4 u_probe;
uniform int u_boxCount;
uniform vec3 u_boxMin[24],u_boxMax[24];
uniform sampler2D u_prefilter,u_irradiance,u_brdf,u_material,u_params,u_shadow;
in vec3 world,normalWorld,localPosition,localNormal,grainWorld;
out vec4 fragColor;
const float PI=3.14159265359;
vec3 linearize(vec3 x){return pow(max(x,vec3(.001)),vec3(2.2));}
vec3 film(vec3 x){return pow(clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.),vec3(1./2.2));}
vec2 ll(vec3 d){return vec2(atan(d.z,d.x)/(2.*PI)+.5,acos(clamp(d.y,-1.,1.))/PI);}
vec3 decode(vec4 x){return x.rgb*x.a*16.;}
vec3 env(vec3 d,float rough){vec2 uv=ll(d);float level=clamp(rough,0.,1.)*5.,a=floor(level),b=min(5.,a+1.);return mix(decode(texture(u_prefilter,vec2(uv.x,(a*130.+1.5+uv.y*127.)/780.))),decode(texture(u_prefilter,vec2(uv.x,(b*130.+1.5+uv.y*127.)/780.))),fract(level));}
vec4 tile(sampler2D t,vec2 uv,float row){return texture(t,vec2((fract(uv.x)*255.+2.5)/260.,(row*260.+fract(uv.y)*255.+2.5)/780.));}
vec4 tri(sampler2D t,vec3 p,vec3 n,float row){vec3 w=pow(abs(n),vec3(5.));w/=max(dot(w,vec3(1)),.00001);return tile(t,p.zy,row)*w.x+tile(t,p.xz,row)*w.y+tile(t,p.xy,row)*w.z;}
vec3 F(vec3 f0,float v){return f0+(1.-f0)*pow(1.-v,5.);}
vec3 brdf(vec3 n,vec3 v,vec3 l,vec3 base,float rough,vec3 power){vec3 h=normalize(v+l);float nv=max(dot(n,v),.001),nl=max(dot(n,l),.0),nh=max(dot(n,h),0.),vh=max(dot(v,h),0.),a=rough*rough,a2=a*a,d=nh*nh*(a2-1.)+1.,D=a2/(PI*d*d),k=(rough+1.)*(rough+1.)/8.;float G=nv/(nv*(1.-k)+k)*nl/max(nl*(1.-k)+k,.001);vec3 fr=F(mix(vec3(.04),base,u_metal),vh);return ((1.-fr)*(1.-u_metal)*base/PI+D*G*fr/max(4.*nv*nl,.001))*power*nl;}
float proxyVisibility(vec3 p,vec3 direction){
 vec3 inv=1./(direction+vec3(.000001));
 for(int i=0;i<24;i++){if(i>=u_boxCount)break;vec3 a=(u_boxMin[i]-p)*inv,b=(u_boxMax[i]-p)*inv,lo=min(a,b),hi=max(a,b);float near=max(max(lo.x,lo.y),lo.z),far=min(min(hi.x,hi.y),hi.z);if(far>max(near,.025))return .10;}
 return 1.;
}
void main(){
 if(u_debug>1.5){vec4 a;if(u_probe.z<.5)a=texture(u_material,u_probe.xy);else if(u_probe.z<1.5)a=texture(u_params,u_probe.xy);else if(u_probe.z<2.5)a=texture(u_prefilter,u_probe.xy);else if(u_probe.z<3.5)a=texture(u_brdf,u_probe.xy);else if(u_probe.z<4.5)a=texture(u_shadow,u_probe.xy);else a=texture(u_irradiance,u_probe.xy);fragColor=vec4(u_probe.w>.5?a.aaa:a.rgb,1.);return;}
 vec3 N=normalize(normalWorld),V=normalize(u_eye-world);if(dot(N,V)<0.)N=-N;vec3 base=u_base;float rough=u_rough;
 if(u_kind<2.5){float row=u_kind<.5?2.:u_kind<1.5?0.:1.;vec3 p=localPosition*(u_kind<.5?.7:u_kind<1.5?.40:1.5);vec4 a=tri(u_material,p,localNormal,row);vec3 avg=row<.5?vec3(.30,.137,.057):row<1.5?vec3(.63,.48,.26):vec3(.15,.18,.20);float detail=u_detail*(1.-smoothstep(1.0,6.,max(length(dFdx(p)),length(dFdy(p)))*256.));base*=mix(vec3(1),a.rgb/avg,detail*(u_kind<.5?.09:.4));rough+= (tri(u_params,p,localNormal,row).r-.4)*detail*.18;}
 if(u_kind>3.5&&u_kind<4.5){N=normalize(N+vec3(sin(world.x*5.+world.z*2.)*.006,0,cos(world.z*7.-world.x)*.008));}
 rough=sqrt(clamp(rough*rough+min(.16,dot(dFdx(N),dFdx(N))+dot(dFdy(N),dFdy(N))),.015,.95));
 if(u_kind<.5&&world.y<.51&&N.y>.75){vec2 cell=abs(fract(world.xz*.75)-.5);float joint=1.-smoothstep(.48,.495,max(cell.x,cell.y));base*=mix(.65,1.,joint);}
 vec3 rgb=linearize(clamp(base,.001,.99));float night=clamp(u_mode,0.,1.);vec3 sun=normalize(vec3(-.65,1.,-.38));vec2 visibility=vec2(1);
 if(world.y<.51&&N.y>.75)visibility=mix(vec2(1),texture(u_shadow,vec2((world.x+24.)/48.,(world.z+20.)/40.)).rg,u_shadowStrength);
 float direct=world.y>.51?mix(1.,proxyVisibility(world+N*.025,sun),u_shadowStrength):visibility.x;
 vec3 light=brdf(N,V,sun,rgb,rough,mix(vec3(3.4,2.85,2.05),vec3(.22,.31,.57),night))*direct;
 light+=brdf(N,V,normalize(vec3(.5,.35,.9)),rgb,rough,mix(vec3(.24,.36,.5),vec3(.25,.32,.45),night));
 float nv=max(dot(N,V),.001);vec3 f0=mix(vec3(.04),rgb,u_metal);vec2 dfg=texture(u_brdf,vec2(nv,rough)).rg;
 light+=decode(texture(u_irradiance,ll(N)))*rgb*(1.-u_metal)*(1.-F(f0,nv))*mix(.48,.075,night)*visibility.y*mix(.65,1.,direct);
 light+=env(reflect(-V,N),rough)*(f0*dfg.x+dfg.y)*u_reflections*mix(.85,.26,night);
 if(abs(u_kind-7.)<.25)light=rgb*mix(1.8,5.,night);
 // Warm ceiling/portal fill is an authored area-light approximation, not light transport.
 float under=exp(-pow(abs(world.x)-7.,2.)*.14)*exp(-pow(world.z+1.,2.)*.012);light+=rgb*vec3(1.2,.56,.18)*night*under*.45*(1.-smoothstep(3.8,4.2,world.y));
 if(u_mode>1.5){vec3 ink=mix(vec3(.018,.045,.075),base*.35,.7);float edge=pow(1.-max(dot(N,V),0.),3.);light=ink+vec3(.12,.44,.55)*edge;}
 float haze=exp(-length(u_eye-world)*.004);light=mix(mix(vec3(.22,.29,.35),vec3(.012,.025,.05),night),light,haze);
 fragColor=vec4(film(light*u_exposure),u_kind>2.5&&u_kind<3.5?.34:1.);
}
