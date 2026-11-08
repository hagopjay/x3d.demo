#version 300 es
precision highp float;
in vec4 x3d_Vertex;
out vec3 world,normalWorld,localPosition,localNormal,grainWorld;
void main(){world=vec3(0.);normalWorld=vec3(0,1,0);localPosition=vec3(0.);localNormal=normalWorld;grainWorld=vec3(1,0,0);gl_Position=vec4(x3d_Vertex.xy,-.99999,1.);}
