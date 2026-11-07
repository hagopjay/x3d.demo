//// VERTEX
// Aerial filaments: five arcs between source anchors, twisting ribbons with travelling packets.
in vec4 x3d_Vertex; in vec4 aFiber; uniform vec4 uAnchors[7]; uniform mat4 x3d_ProjectionMatrix, x3d_ModelViewMatrix; uniform vec3 uEye; out float vSide,vT,vId; out float vFade;
vec3 curve(vec3 a,vec3 b,float t,float id){vec3 p=mix(a,b,t);float arch=sin(PI*t);p.y+=arch*(5.8+uEnergy*1.1+.35*sin(id*1.7+uTime*.12));vec3 side=normalize(vec3(-(b.z-a.z),0.,b.x-a.x));p+=side*sin(t*PI*2.+id)*arch*.18;return p;}
void main(){int ia=int(aFiber.x),ib=int(aFiber.y);float t=aFiber.z;float id=float(ia)+float(ib)*.37;vec3 a=uAnchors[ia].xyz,b=uAnchors[ib].xyz;vec3 p=curve(a,b,t,id);vec3 tangent=normalize(curve(a,b,min(.9999,t+.004),id)-curve(a,b,max(.0001,t-.004),id));vec3 side=normalize(cross(tangent,normalize(uEye-p)));vec3 up=normalize(cross(tangent,side));float twist=t*9.+uTime*.22+id*.8;side=side*cos(twist)+up*sin(twist);float width=.052+.11*pow(sin(PI*t),2.);p+=side*aFiber.w*width;gl_Position=x3d_ProjectionMatrix*x3d_ModelViewMatrix*vec4(p,1.);vSide=aFiber.w;vT=t;vId=id;vFade=pow(max(0.,sin(PI*t)),.35);}
//// FRAGMENT
in float vSide,vT,vId,vFade; out vec4 outColor;
void main(){float edge=1.-smoothstep(.12,1.,abs(vSide));float packet=pow(max(0.,1.-abs(fract(vT-uTime*.095+vId*.17)-.5)*2.),26.);vec3 c=mix(uA,uC,.5+.4*sin(vId));vec3 iridescence=.5+.5*cos(vec3(0.,2.1,4.2)+vT*5.-uTime*.08+vId);c=mix(c,iridescence,.12);float core=exp(-vSide*vSide*90.);float alpha=edge*vFade*(.075+core*.14+packet*.5);outColor=lightOut(c*(.9+packet*3.5+core*.25)*alpha*(.6+uGlow*.4));}
