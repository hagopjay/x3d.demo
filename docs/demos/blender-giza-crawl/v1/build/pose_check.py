import bpy,sys,math
sys.path.insert(0,'.')
import rig
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene
out=sys.argv[-1]
xs=[]
for k,m in enumerate(["walk","stoop","crawl","climb","kneel"]):
    r_,pb=rig.build_figure(sc,"F"+m,(0.8,0.5,0.1))
    r_.location=(0,k*1.6,0)
    s,r=rig.forward_sign(r_,pb)
    rig.pose(pb,s,r,rig.MODES[m],0.25)
cam=bpy.data.objects.new("c",bpy.data.cameras.new("c"));sc.collection.objects.link(cam)
cam.location=(9,3.2,0.9);cam.rotation_euler=(math.radians(90),0,math.radians(90));cam.data.lens=30
sc.camera=cam
l=bpy.data.objects.new("s",bpy.data.lights.new("s","SUN"));sc.collection.objects.link(l)
sc.render.engine="CYCLES";sc.cycles.samples=8;sc.cycles.device="CPU";sc.render.resolution_x=960;sc.render.resolution_y=360
sc.render.filepath=out;bpy.ops.render.render(write_still=True)
