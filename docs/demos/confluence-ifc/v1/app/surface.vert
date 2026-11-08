#version 300 es
precision highp float;
uniform mat4 x3d_ProjectionMatrix,x3d_ModelViewMatrix,x3d_CameraSpaceMatrix;
uniform mat3 x3d_NormalMatrix;
in vec4 x3d_Vertex;
in vec3 x3d_Normal;
out vec3 world;
out vec3 normalWorld;
out vec3 localPosition,localNormal,grainWorld;
void main(){
 vec4 view=x3d_ModelViewMatrix*x3d_Vertex;
 world=(x3d_CameraSpaceMatrix*view).xyz;
 normalWorld=normalize(mat3(x3d_CameraSpaceMatrix)*x3d_NormalMatrix*x3d_Normal);
 localPosition=x3d_Vertex.xyz;localNormal=x3d_Normal;
 vec3 axis=abs(x3d_Normal.y)<.95?vec3(0,1,0):vec3(1,0,0);
 grainWorld=normalize(mat3(x3d_CameraSpaceMatrix*x3d_ModelViewMatrix)*cross(axis,x3d_Normal));
 gl_Position=x3d_ProjectionMatrix*view;
}
