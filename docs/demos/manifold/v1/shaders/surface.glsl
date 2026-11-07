//// VERTEX
// The manifold's surface: an ElevationGrid of 513 x 513 rest heights (what a browser without shaders shows),
// re-evaluated here every frame from the live metric. Under a Transform of (-11.2, 0, -11.2), so the grid's
// local x and z are p + 11.2.
in vec4 x3d_Vertex;
uniform mat4 x3d_ProjectionMatrix, x3d_ModelViewMatrix;
uniform float uAOStrength;
out vec3 vPos, vNormal; out vec2 vXZ; out float vLambda, vK, vFold, vAO;
// Ambient occlusion from the true height function (exceeds the original's screen-space estimate: no halos,
// no view dependence). Horizon slopes in eight directions at three radii, per vertex.
float occlusion(vec2 p, float h0){
 float occ=0.;
 for(int k=0;k<8;k++){
  float a=float(k)*.785398+.3927; vec2 d=vec2(cos(a),sin(a)); float best=0.;
  for(int j=0;j<3;j++){float r=.45*pow(2.1,float(j));float dh=heightAt(p+d*r)-h0;best=max(best,dh/sqrt(r*r+dh*dh)*(1.-.18*float(j)));}
  occ+=max(0.,best-.06);
 }
 return 1.-clamp(occ/8.*uAOStrength,0.,.42);
}
void main(){
 vec2 aXZ=x3d_Vertex.xz-11.2;
 vec4 m=metric(aXZ); vec3 s=surface(aXZ,m);
 vPos=vec3(aXZ.x,s.x,aXZ.y); vNormal=normalize(vec3(-s.y,1.,-s.z)); vXZ=aXZ; vLambda=m.x;
 vFold=s.x+1.72*log(m.x);
 vK=-(m.w/m.x-dot(m.yz,m.yz)/(m.x*m.x))/(m.x*m.x);        // Gaussian curvature of g = lambda^2 I
 vAO=uAOStrength>0.?occlusion(aXZ,s.x):1.;
 gl_Position=x3d_ProjectionMatrix*x3d_ModelViewMatrix*vec4(x3d_Vertex.x,s.x,x3d_Vertex.z,1.);
}
//// FRAGMENT
in vec3 vPos, vNormal; in vec2 vXZ; in float vLambda, vK, vFold, vAO;
uniform vec3 uEye; uniform float uLineScale;
out vec4 outColor;
// Line widths are in device pixels (fwidth); uLineScale = supersampling factor keeps them the original's width on screen.
float line(float f,float w){w*=uLineScale;float a=max(fwidth(f),1e-5);return 1.-smoothstep(a*w,a*(w+1.),abs(fract(f-.5)-.5));}
float ggx(vec3 n,vec3 v,vec3 l,float rough){vec3 h=normalize(l+v);float nh=max(dot(n,h),0.),nv=max(dot(n,v),.01),nl=max(dot(n,l),.01),vh=max(dot(v,h),0.);float a=rough*rough,a2=a*a,d=a2/(PI*pow(nh*nh*(a2-1.)+1.,2.));float k=pow(rough+1.,2.)/8.;float g=(nl/(nl*(1.-k)+k))*(nv/(nv*(1.-k)+k));return d*g/(4.*nv*nl+.0001);}
vec3 environment(vec3 r){vec3 c=mix(vec3(.025,.034,.065),vec3(.085,.13,.20),smoothstep(-.2,.9,r.y));float strip=pow(max(0.,dot(r,normalize(vec3(-.5,.85,-.4)))),60.);float strip2=pow(max(0.,dot(r,normalize(vec3(.7,.4,.2)))),22.);float strip3=pow(max(0.,dot(r,normalize(vec3(-.2,.3,1.)))),36.);float softbox=pow(max(0.,dot(r,normalize(vec3(.1,.9,-.3)))),16.);float blade=pow(max(0.,dot(r,normalize(vec3(-.8,.25,.1)))),110.);
return c+vec3(1.5,1.7,1.9)*strip+uC*strip2*1.25+uA*strip3*1.1+mix(uA,uB,.4)*softbox*.45+uC*blade*.9;}
void main(){float edge=max(abs(vXZ.x),abs(vXZ.y));float fade=1.-smoothstep(9.7,11.2,edge);if(fade<.015)discard;vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;
vec2 micro=vec2(cos(vXZ.x*19.+vXZ.y*11.+uTime*.18),sin(vXZ.y*23.-vXZ.x*9.-uTime*.14));
n=normalize(n+vec3(micro.x,0.,micro.y)*.006*uMicro*(.3+uMetal));vec3 v=normalize(uEye-vPos);float nv=max(dot(n,v),.001);float K=tanh(vK*11.);float swirl=.5+.5*sin(log(vLambda)*2.9+vXZ.x*.17-vXZ.y*.11+uTime*.085);vec3 base=mix(uB,uA,smoothstep(-.5,.7,K*.7+swirl*.5));float heart=smoothstep(.3,.95,K);base=mix(base,uC,heart*.7);base*=.16+.12*swirl;vec3 f0=mix(vec3(.055),base,.55*uMetal);vec3 fres=f0+(1.-f0)*pow(1.-nv,5.);vec3 r=reflect(-v,n);float rough=mix(.36,.20,uMetal);vec3 light=vec3(.020,.032,.05)*base;vec3 l1=normalize(vec3(-.45,.84,.35)),l2=normalize(vec3(.7,.32,-.6));float nl=max(dot(n,l1),0.);light+=base*(.18+nl*.55);light+=ggx(n,v,l1,rough)*nl*vec3(3.0,3.1,3.4)*fres;light+=ggx(n,v,l2,rough+.1)*max(dot(n,l2),0.)*uC*2.*fres;light+=environment(r)*fres*(.65+uMetal*.8);vec3 film=.5+.5*cos(vec3(0.,2.1,4.2)+(1.-nv)*6.5+log(vLambda)*1.4);vec3 spectral=.5+.5*cos(vec3(5.2,3.1,1.0)+(1.-nv)*10.+log(vLambda)*2.8+vFold*.18);
light+=mix(uA,uB,film.r)*pow(1.-nv,2.)*.22;
light+=spectral*environment(r)*(.025+.12*pow(1.-nv,2.))*uMicro;
vec3 tangent=vec3(n.z,0.,-n.x)+vec3(.0001,0.,.0001);tangent=normalize(tangent-n*dot(tangent,n));vec3 bitangent=cross(n,tangent),halfway=normalize(v+l1);
float ax=.38,ay=.11,ht=dot(halfway,tangent),hb=dot(halfway,bitangent),hn=max(.001,dot(halfway,n));
float aniso=1./(PI*ax*ay*pow(ht*ht/(ax*ax)+hb*hb/(ay*ay)+hn*hn,2.));
light+=mix(vec3(.85,.94,1.),uC,.3)*min(aniso*nl*.018,.48)*fres*(.25+uMetal);
float coat=ggx(n,v,l1,.13)*nl*.025;light+=vec3(.9,1.,1.08)*min(coat,1.3)*(.25+uMetal*.75);
float contour=line(log(vLambda)*4.2+vFold*.22, .5);float secondary=line(log(vLambda)*15.,.20)*.15;float grid=max(line(vXZ.x*1.1,.3),line(vXZ.y*1.1,.3));float pulse=.65+.35*sin(log(vLambda)*9.-uTime*.8);vec3 lineColor=mix(uA,uC,smoothstep(-.04,.07,vK));float front=pow(.5+.5*sin(log(vLambda)*11.-uTime*.9+vXZ.x*.07),18.);
light+=(contour*(.26+front*.38)+secondary)*lineColor*(.4+uGlow*1.7)*uContours;
float interference=pow(.5+.5*cos(log(vLambda)*33.+vFold*.8-uTime*.11),28.);
light+=mix(uA,uC,swirl)*interference*.026*uMicro*(.25+heart);
vec2 water=vXZ*.76+vec2(sin(log(vLambda)*1.3+uTime*.07),cos(log(vLambda)*1.1-uTime*.06))*.45;
float network=sin(water.x*2.6+sin(water.y*1.3)+uTime*.16)+cos(water.y*3.2-sin(water.x*1.6)-uTime*.12);
float caustic=1.-smoothstep(.025,max(.075,fwidth(network)*1.6),abs(network));
float beneath=smoothstep(1.15,3.0,vLambda);light+=mix(uA,uC,.55)*caustic*beneath*(.045+uGlow*.085)*uCurrents;light+=grid*mix(uA,vec3(.4,.55,.8),.4)*.038*uContours;light+=base*pow(1.-nv,3.)*.5;light+=lineColor*pow(heart,3.)*.12*pulse*uGlow;float cavity=clamp(.7+vPos.y*.035,.45,1.);light*=cavity;vec3 fog=vec3(.008,.015,.028);float dist=length(uEye-vPos);light=mix(light,fog,1.-exp(-dist*.006));light=mix(fog,light,fade);
outColor=vec4(display(light*vAO),1.);}
