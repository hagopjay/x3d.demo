precision highp float;
#define PI 3.141592653589793
// Shared by every shader of the scene; ported from the original page's `common` block (reference/
// Manifold-of-Emotion.html). The metric, the fold and the ripple surface are the original's, unchanged.
uniform float uTime, uEnergy, uBreath, uFold, uGlow, uMetal, uContours, uMicro, uCurrents;
uniform vec4 uSources[7];   // x, z, amplitude, sigma_x
uniform vec4 uShape[7];     // cos(angle), sin(angle), sigma_z / sigma_x, 0
uniform vec4 uPulse[8];     // x, z, start time, amplitude
uniform vec3 uA, uB, uC;    // the mood's three colours
// Exact spatial derivatives of seven positive anisotropic Gaussian sources:
// returns (lambda - 0, d lambda/dx, d lambda/dz, Laplacian of lambda) with lambda = 1 + sum.
vec4 metric(vec2 p){vec4 r=vec4(1.,0.,0.,0.);for(int i=0;i<7;i++){vec2 d=p-uSources[i].xy;vec2 q=vec2(uShape[i].x*d.x+uShape[i].y*d.y,-uShape[i].y*d.x+uShape[i].x*d.y);vec2 a=1./(uSources[i].ww*uSources[i].ww*vec2(1.,uShape[i].z*uShape[i].z));float v=uSources[i].z*exp(-.5*dot(q*q,a));vec2 l=-q*a;vec2 grad=vec2(uShape[i].x*l.x-uShape[i].y*l.y,uShape[i].y*l.x+uShape[i].x*l.y);r+=vec4(v,v*grad,v*(dot(l,l)-a.x-a.y));}return r;}
// A rotating R4 coordinate, projected into the display height only (it does not enter the metric).
vec3 foldSurface(vec2 p){
 float a=uTime*.12,c=cos(a),s=sin(a),c2=cos(a*.73),s2=sin(a*.73);
 float ax=p.x*.19+uTime*.13,bz=p.y*.21-uTime*.11;
 vec4 q=vec4(p*.25,sin(ax),cos(bz));
 vec4 Q=vec4(c*q.x-s*q.w,c2*q.y-s2*q.z,s2*q.y+c2*q.z,s*q.x+c*q.w);
 vec4 dx=vec4(c*.25,-s2*.19*cos(ax),c2*.19*cos(ax),s*.25);
 vec4 dz=vec4(s*.21*sin(bz),c2*.25,s2*.25,-c*.21*sin(bz));
 float d=1.8-.23*Q.w;vec3 v=Q.xyz/d;
 vec3 vx=(dx.xyz*d+.23*Q.xyz*dx.w)/(d*d),vz=(dz.xyz*d+.23*Q.xyz*dz.w)/(d*d);
 float A=v.x*2.6+v.z,B=v.y*2.2,C=v.z*3.7+v.y;
 vec3 gradient=vec3(.65*cos(A)*cos(B)*2.6,-.65*sin(A)*sin(B)*2.2+.24*cos(C),.65*cos(A)*cos(B)+.24*cos(C)*3.7);
 return uFold*vec3(.65*sin(A)*cos(B)+.24*sin(C),dot(gradient,vx),dot(gradient,vz));
}
// Height and its gradient: -1.72 ln(lambda) + fold + ripples.
vec3 surface(vec2 p,vec4 m){float h=-1.72*log(m.x);vec2 g=-1.72*m.yz/m.x;vec3 folded=foldSurface(p);h+=folded.x;g+=folded.yz;for(int i=0;i<8;i++){if(uPulse[i].w<.001)continue;float age=uTime-uPulse[i].z;if(age>18.||age<0.)continue;float len=length(p-uPulse[i].xy),r=len-age*2.15;float envelope=exp(-r*r*.75-age*.53)*uPulse[i].w*step(0.,age);float wave=sin(r*4.2)*envelope;h+=wave;float slope=(4.2*cos(r*4.2)-1.5*r*sin(r*4.2))*envelope;g+=slope*(p-uPulse[i].xy)/max(.01,len);}return vec3(h,g);}
float heightAt(vec2 p){return surface(p,metric(p)).x;}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
// The original's display transform (its post pass), applied per fragment: ACES (Narkowicz) of 1.32 x radiance, then gamma 2.2.
vec3 display(vec3 c){c=max(c*1.32,0.);c=clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);return pow(c,vec3(1./2.2));}
// The light layers' contribution in display space, for screen blending (ONE_MINUS_DST_COLOR, ONE): the curve
// tools/blend_fit.py fits so that d + (1 - d) overlay(F) tracks the original's T(S + F) (mean error 0.0096).
vec3 overlay(vec3 F){F=max(F,0.);return clamp(6.1615*F/pow(1.+4.9597*F,vec3(1.0704)),0.,1.);}
// As an RGBA for standard alpha blending (SRC_ALPHA, ONE_MINUS_SRC_ALPHA): (g / max g, max g) gives
// g + d (1 - max g), the screen blend d + (1 - d) g exactly for grey light and nearly for coloured light,
// in any X3D browser, with no blending extension (the first saved moment, under plain alpha, drew opaque sheets).
// The colour is pulled toward white by mu = 0.3, the typical surface value under these layers: the error
// (d - mu)(g_k - max g) then cancels on average instead of darkening coloured light (second run, 6 Nov).
vec4 lightOut(vec3 F){vec3 g=overlay(F);float a=max(max(g.r,g.g),g.b);return a>1e-5?vec4(mix(g/a,vec3(1.),.3),a):vec4(0.);}
