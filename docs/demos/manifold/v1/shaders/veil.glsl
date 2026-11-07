//// VERTEX
// The veil: a second sheet lifted above the basins. The original refracts a copy of the frame through it;
// X3D has no frame copy, so its transmitted light is the surface itself (screen-blended) and the veil adds
// only what it reflects and diffracts: rim tint, spectrum, softbox and travelling fringes.
in vec4 x3d_Vertex; uniform mat4 x3d_ProjectionMatrix, x3d_ModelViewMatrix;
out vec3 vPos, vNormal; out vec2 vXZ; out float vLambda;
void main(){vec2 aXZ=x3d_Vertex.xz-11.2;vec4 m=metric(aXZ);vec3 s=surface(aXZ,m);float phase=log(m.x)*.7-uTime*.14;float lift=.36+.19*sin(phase);vec2 slope=s.yz+.133*cos(phase)*m.yz/m.x;vPos=vec3(aXZ.x,s.x+lift,aXZ.y);vNormal=normalize(vec3(-slope.x,1.,-slope.y));vXZ=aXZ;vLambda=m.x;gl_Position=x3d_ProjectionMatrix*x3d_ModelViewMatrix*vec4(x3d_Vertex.x,vPos.y,x3d_Vertex.z,1.);}
//// FRAGMENT
in vec3 vPos, vNormal; in vec2 vXZ; in float vLambda; uniform vec3 uEye; uniform float uVeil; out vec4 outColor;
void main(){float mask=smoothstep(1.18,2.6,vLambda)*(1.-smoothstep(9.,10.7,max(abs(vXZ.x),abs(vXZ.y))))*uVeil;if(mask<.002)discard;vec3 n=normalize(vNormal),v=normalize(uEye-vPos);if(dot(n,v)<0.)n=-n;float rim=pow(1.-max(0.,dot(n,v)),3.);
vec3 spectrum=.5+.5*cos(vec3(.3,2.4,4.6)+rim*7.+log(vLambda)*1.8-uTime*.045);
float crest=abs(fract(log(vLambda)*6.5-uTime*.024)-.5);float fringe=1.-smoothstep(.012,.04,crest);
float softbox=pow(max(0.,dot(reflect(-v,n),normalize(vec3(-.4,.85,.3)))),45.);
vec3 tint=mix(uA,uB,.5+.5*sin(log(vLambda)*1.7));vec3 extra=tint*rim*.16+spectrum*rim*.06+mix(uC,vec3(1.),.6)*softbox*.24+tint*fringe*.06;
outColor=lightOut(extra*mask*(.22+rim*.25));}
