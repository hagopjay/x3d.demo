//// VERTEX
// Geodesic ribbons. The page traces the geodesics of g (the original's RK4, at half its step) and streams
// them here as vertex attributes; this shader lays each ribbon on the drawn surface, a constant number of
// pixels wide.
in vec4 x3d_Vertex;
in vec4 aPath;   // x, z, cumulative planar arc length, trace id
in vec3 aRibbon; // planar tangent x/z, side (-1 or +1)
uniform mat4 x3d_ProjectionMatrix, x3d_ModelViewMatrix;
uniform vec3 uEye; uniform vec2 uResolution; uniform float uPixelRatio, uRibbonWidth;
out float vAlong,vId,vSide,vFade;
void main(){
 vec2 p=aPath.xy; vec4 m=metric(p); vec3 s=surface(p,m);
 vec3 pos=vec3(p.x,s.x+.095,p.y);
 vec2 flatTangent=normalize(aRibbon.xy);
 vec3 tangent=normalize(vec3(flatTangent.x,dot(s.yz,flatTangent),flatTangent.y));
 vec3 view=normalize(uEye-pos);
 vec3 side=cross(tangent,view);
 if(dot(side,side)<1e-8)side=vec3(-flatTangent.y,0.,flatTangent.x);
 side=normalize(side);
 mat4 VP=x3d_ProjectionMatrix*x3d_ModelViewMatrix;
 vec4 clip=VP*vec4(pos,1.);
 vec4 projectedSide=VP*vec4(side,0.);
 vec2 screenSide=(projectedSide.xy*clip.w-clip.xy*projectedSide.w)*uResolution;
 if(dot(screenSide,screenSide)<1e-8)screenSide=vec2(1.,0.);
 screenSide=normalize(screenSide);
 float halfWidthCSS=uRibbonWidth;   // the original's 0.90 CSS px, calibrated for multisampled edges (tools/calibrate)
 clip.xy+=screenSide*aRibbon.z*(2.*halfWidthCSS*uPixelRatio/uResolution)*clip.w;
 gl_Position=clip;
 vAlong=aPath.z;vId=aPath.w;vSide=aRibbon.z;
 vFade=(1.-smoothstep(9.4,10.9,max(abs(p.x),abs(p.y))))*exp(-max(0.,length(uEye-pos)-20.)*.01);
}
//// FRAGMENT
in float vAlong,vId,vSide,vFade; uniform float uRibbonGain; out vec4 outColor;
void main(){
 float r=abs(vSide);
 float aa=max(fwidth(vSide),.06);
 float edge=1.-smoothstep(1.-aa*.5,1.+aa*.5,r);
 float core=1.-smoothstep(.10,.43,r);
 float skirt=exp(-r*r*2.2);
 float phase=fract(vAlong*.055-uTime*.10-vId*.137);
 float packet=pow(max(0.,1.-abs(phase-.5)*2.),18.);
 vec3 color=mix(uA,uC,.55+.4*sin(vId*1.4));
 float alpha=edge*skirt*vFade*(.16+.28*core+packet*.8)*(.55+uGlow*.45);
 vec3 radiance=color*(.70+.80*core+packet*(1.8+core*2.5));
 outColor=lightOut(radiance*alpha*uRibbonGain);
}
