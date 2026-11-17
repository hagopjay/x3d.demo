"""Cycles vertex-light bake of the Giza massing. usage: python3 -I bake.py STATE az el sun_r sun_g sun_b sun_strength sky_strength [samples]
Writes light_STATE.json {mesh: [[r,g,b]...]} (light only, linear, before albedo/exposure) + receipt."""
import sys, json, math, time, hashlib
sys.path.insert(0, '.')
import bpy, bmesh, geo
from mathutils import Vector
state = sys.argv[1]; az, el = float(sys.argv[2]), float(sys.argv[3])
sun_col = tuple(float(x) for x in sys.argv[4:7]); sun_str = float(sys.argv[7]); sky_str = float(sys.argv[8])
samples = int(sys.argv[9]) if len(sys.argv) > 9 else 128
t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = samples
sc.cycles.use_denoising = False; sc.cycles.sample_clamp_indirect = 4.0; sc.cycles.max_bounces = 3
sc.render.threads_mode = 'FIXED'; sc.render.threads = 3
sc.render.bake.target = 'VERTEX_COLORS'; sc.render.bake.use_clear = True
sc.render.bake.use_pass_direct = True; sc.render.bake.use_pass_indirect = True; sc.render.bake.use_pass_color = False
def b(p): return (p[0], -p[2], p[1])  # X3D (x east, y up, z south) -> Blender (x east, y north, z up)
mat = bpy.data.materials.new('white'); mat.use_nodes = True
mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.8, .8, .8, 1)
objs = []
for m in geo.all_meshes():
    geo.orient(m)
    me = bpy.data.meshes.new(m['name']); me.from_pydata([b(v) for v in m['verts']], [], m['faces']); me.update()
    me.color_attributes.new('Bake', 'FLOAT_COLOR', 'POINT')
    ob = bpy.data.objects.new(m['name'], me); ob.data.materials.append(mat); ob.visible_shadow = m['name'] != 'causeway'; sc.collection.objects.link(ob); objs.append((ob, m))
# sun
saz, sel = math.radians(az), math.radians(el)
sd = Vector((math.sin(saz)*math.cos(sel), math.cos(saz)*math.cos(sel), math.sin(sel)))   # toward the sun, Blender frame
ld = bpy.data.lights.new('sun', 'SUN'); ld.energy = sun_str; ld.color = sun_col; ld.angle = math.radians(1.5)
lo = bpy.data.objects.new('sun', ld); sc.collection.objects.link(lo)
lo.rotation_euler = (-sd).to_track_quat('-Z', 'Y').to_euler()
# sky: ambient only, disc off (recipe)
w = bpy.data.worlds.new('w'); w.use_nodes = True; sc.world = w; nt = w.node_tree
sky = nt.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'MULTIPLE_SCATTERING' if 'MULTIPLE_SCATTERING' in [i.identifier for i in sky.bl_rna.properties['sky_type'].enum_items] else 'NISHITA'
if hasattr(sky, 'sun_disc'): sky.sun_disc = False
sky.sun_elevation = sel; sky.sun_rotation = math.radians(180-az)
bg = nt.nodes['Background']; bg.inputs['Strength'].default_value = sky_str; nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
res = {}
for ob, m in objs:
    for o in bpy.context.view_layer.objects: o.select_set(False)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    me = ob.data; me.attributes.active_color = me.color_attributes['Bake']
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, target='VERTEX_COLORS')
    ca = me.color_attributes['Bake']; vals = [tuple(round(c, 4) for c in d.color[:3]) for d in ca.data]
    res[m['name']] = vals
    print(m['name'], len(vals), 'mean', round(sum(sum(v) for v in vals)/(3*len(vals)), 4), round(time.time()-t0, 1), 's', flush=True)
meta = dict(state=state, az=az, el=el, sun_color=sun_col, sun_strength=sun_str, sky_strength=sky_str, sky_type=sky.sky_type, samples=samples,
            blender=bpy.app.version_string, cycles_device='CPU', seconds=round(time.time()-t0, 1), script_sha256=hashlib.sha256(open(__file__, 'rb').read()).hexdigest())
json.dump(dict(meta=meta, light=res), open('light_%s.json' % state, 'w'), separators=(',', ':'))
print('done', meta)
