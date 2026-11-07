//// VERTEX
// A full-screen triangle at the far plane: the original's screen-space sky (haze, cloud band, aurora, stars).
in vec4 x3d_Vertex; out vec2 vUV;
void main(){vUV=x3d_Vertex.xy*.5+.5;gl_Position=vec4(x3d_Vertex.xy,.999999,1.);}
//// FRAGMENT
in vec2 vUV; uniform vec2 uResolution; out vec4 outColor;
void main(){vec2 p=vUV-.5;p.x*=uResolution.x/uResolution.y;float haze=exp(-dot(p*vec2(.9,1.5),p*vec2(.9,1.5))*2.8);vec3 color=vec3(.008,.013,.025)+mix(uA,uB,vUV.x)*haze*.028;float cloud=sin(p.x*2.+p.y*4.+uTime*.018)*sin(p.x*3.-p.y*2.1);color+=uB*exp(-pow(p.y+.1+cloud*.04,2.)*45.)*.014;
float curtain=sin(p.x*4.1+uTime*.025)+.3*sin(p.x*10.7-uTime*.02);
float aurora=exp(-pow(p.y-.11-curtain*.045,2.)*95.)*exp(-p.x*p.x*.6);
color+=mix(uA,uB,.5+.5*sin(p.x*2.+uTime*.04))*aurora*.023;
color+=uA*exp(-dot((p-vec2(-.18,.08))*vec2(1.,2.),(p-vec2(-.18,.08))*vec2(1.,2.))*7.)*.012;vec2 grid=floor(vUV*uResolution/4.);float star=step(.99965,hash(grid));color+=vec3(.2,.3,.4)*star*pow(hash(grid+1.),3.)*.25;outColor=vec4(display(color),1.);}
