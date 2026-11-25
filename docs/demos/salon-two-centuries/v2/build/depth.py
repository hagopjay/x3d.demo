import sys,os,json,numpy as np,torch
from PIL import Image
from transformers import pipeline
torch.set_num_threads(4)
pipe=pipeline("depth-estimation",model="depth-anything/Depth-Anything-V2-Small-hf",device="cpu")
for src,dst in zip(sys.argv[1::2],sys.argv[2::2]):
    im=Image.open(src).convert("RGB")
    d=pipe(im)["predicted_depth"]
    d=d.squeeze().numpy().astype("float32"); d=(d-d.min())/(d.max()-d.min()+1e-9)
    Image.fromarray((d*255).astype("uint8")).resize(im.size).save(dst)
    print("depth",src,d.shape,flush=True)
