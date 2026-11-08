"""GGX importance sampled analytic studio; deterministic finite quadrature, linear RGBM8 atlas."""
import numpy as np
from PIL import Image
import json,hashlib
W,H,LEVELS,SAMPLES,RANGE=256,128,6,96,8.
def radical(i):
 v=0.;s=.5
 while i:v+=(i&1)*s;i>>=1;s*=.5
 return v
def directions(w,h):
 y,x=np.mgrid[:h,:w];phi=(x+.5)/w*2*np.pi-np.pi;theta=(y+.5)/h*np.pi
 return np.stack([np.sin(theta)*np.cos(phi),np.cos(theta),np.sin(theta)*np.sin(phi)],-1)
def environment(d):
 out=np.full(d.shape,.018)
 for direction,color,power,width in [((-.45,.6,.66),(1,.78,.48),3.5,.2),((.6,.25,-.7),(.25,.67,1),1.4,.17),((0,1,0),(1,.92,.8),.45,.55)]:
  n=np.array(direction,dtype=float);n/=np.linalg.norm(n);out+=np.exp((d@n-1)/width**2)[...,None]*np.array(color)*power
 return out
def prefilter(n,rough,samples=SAMPLES):
 if rough==0:return environment(n)
 up=np.zeros_like(n);up[...,1]=1;up[np.abs(n[...,1])>.99]=[1,0,0]
 t=np.cross(up,n);t/=np.linalg.norm(t,axis=-1,keepdims=True);b=np.cross(n,t)
 acc=np.zeros_like(n);weights=np.zeros(n.shape[:-1]);a=rough*rough
 for i in range(samples):
  phi=2*np.pi*(i+.5)/samples;u=radical(i);ct=np.sqrt((1-u)/(1+(a*a-1)*u));st=np.sqrt(1-ct*ct)
  half=t*(np.cos(phi)*st)+b*(np.sin(phi)*st)+n*ct;l=2*ct*half-n;nl=np.maximum(np.sum(n*l,-1),0)
  acc+=environment(l)*nl[...,None];weights+=nl
 return acc/np.maximum(weights[...,None],1e-12)
def encode(a):
 m=np.maximum(np.ceil(a.max(-1,keepdims=True)/RANGE*255)/255,1/255)
 if m.max()>1:raise ValueError('Radiance exceeds RGBM range')
 return np.uint8(np.rint(np.concatenate([a/(m*RANGE),m],-1)*255))
def decode(a):
 b=a.astype(float)/255;return b[...,:3]*b[...,3:]*RANGE
def bake(out):
 n=directions(W,H);tiles=[];errors=[]
 for level in range(LEVELS):
  linear=prefilter(n,level/5);encoded=encode(linear);errors.append(float(np.max(np.abs(decode(encoded)-linear))));tiles.append(np.pad(encoded,((1,1),(0,0),(0,0)),mode='edge'))
 Image.fromarray(np.concatenate(tiles)).save(out/'studio-rgbm.png')
 return {'algorithm':'GGX importance sampled N=V radiance convolution; NdotL weighted','environment':'authored analytic studio, view aligned in FacetShader; not reflected scene geometry','encoding':'linear RGBM8','dimensions':[W,(H+2)*LEVELS],'roughness_levels':[i/5 for i in range(LEVELS)],'samples':SAMPLES,'gutter':1,'max_decode_error_by_level':errors,'baker_sha256':hashlib.sha256(open(__file__,'rb').read()).hexdigest(),'limits':['Finite quadrature and 8-bit quantisation.','Bilinear RGBM within a level is approximate; roughness levels are decoded before interpolation.','No path tracing, screen-space reflection or dynamic scene capture.']}
