//// VERTEX
// The seven sources, as point sprites at their anchors on the surface.
in vec4 x3d_Vertex; uniform vec4 uAnchors[7]; uniform mat4 x3d_ProjectionMatrix, x3d_ModelViewMatrix; uniform float uPixelRatio, uSpriteScale; out float vId;
void main(){float aId=x3d_Vertex.x;vec3 pos=uAnchors[int(aId+.5)].xyz;vec4 clip=x3d_ProjectionMatrix*x3d_ModelViewMatrix*vec4(pos,1.);gl_Position=clip;gl_PointSize=clamp(600.*uPixelRatio/max(5.,clip.w),10.,50.)*uSpriteScale;vId=aId;}
//// FRAGMENT
in float vId; out vec4 outColor;
void main(){vec2 q=(gl_PointCoord-.5)*2.;float r=dot(q,q),halo=exp(-r*6.),core=exp(-r*130.);float star=exp(-abs(q.x)*75.-abs(q.y)*6.)+exp(-abs(q.y)*75.-abs(q.x)*6.);vec3 c=mix(uA,uC,.5+.35*sin(vId*1.7));outColor=lightOut(c*(.7+core*7.)*(halo*.25+core*.65+star*.08));}
