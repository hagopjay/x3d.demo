//// VERTEX
// 900 motes drifting above the surface (the original's seeds, baked by the builder).
in vec4 x3d_Vertex; in vec4 x3d_Color; uniform mat4 x3d_ProjectionMatrix, x3d_ModelViewMatrix; uniform float uPixelRatio, uSpriteScale; out float vAlpha; out vec3 vCol;
void main(){vec4 aSeed=vec4(x3d_Vertex.x,x3d_Vertex.z,x3d_Vertex.y,x3d_Color.r);float t=uTime;vec2 p=aSeed.xy+vec2(sin(t*.035+aSeed.z*4.),cos(t*.04+aSeed.z*3.))*.45;vec4 m=metric(p);vec3 s=surface(p,m);float lift=.18+pow(aSeed.z,3.)*3.8;vec3 pos=vec3(p.x,s.x+lift+.15*sin(t*.4+aSeed.w*10.),p.y);vec4 clip=x3d_ProjectionMatrix*x3d_ModelViewMatrix*vec4(pos,1.);gl_Position=clip;gl_PointSize=clamp((1.+pow(aSeed.w,8.)*3.)*uPixelRatio*22./max(4.,clip.w),1.,9.)*uSpriteScale;vAlpha=(.1+.7*pow(aSeed.w,5.))*(.65+.35*sin(t*.7+aSeed.z*23.));vAlpha*=1.-smoothstep(9.0,11.,max(abs(p.x),abs(p.y)));vCol=mix(uA,uC,aSeed.w);}
//// FRAGMENT
in float vAlpha; in vec3 vCol; out vec4 outColor;
void main(){float r=length(gl_PointCoord-.5)*2.;float a=exp(-r*r*4.)*(1.-smoothstep(.65,1.,r));outColor=lightOut(vCol*1.7*a*vAlpha);}
