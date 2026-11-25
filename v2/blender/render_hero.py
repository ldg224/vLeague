# V2: a photoreal still of the Mixamo footballer (Cycles), for showcase and later per-player portraits. Not used in the live 3D match,
# which keeps the light game model from build_mixamo.py; this only renders images, so it costs nothing in the browser.
#   blender -b --python v2/blender/render_hero.py -- <character.fbx> <out.png> [samples] [save.blend]
# The Mixamo body and kit share one material on one 4K texture sheet, so each part gets its own copy of it (keeping the textures)
# and its own upgrade: skin with subsurface scattering and pores, polyester weave on the kit, synthetic leather boots with grass dirt.
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 256
SAVE = argv[3] if len(argv) > 3 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
sc = bpy.context.scene
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
M = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
print('INSPECT', {n: [s.material.name for s in o.material_slots] for n, o in M.items()}, 'UV', {n: o.data.uv_layers[0].name for n, o in M.items()})

# ---------- pose: frame 150 of Mixamo's soccer idle (an action stance, head up); dual-quaternion skinning keeps volume at the joints ----------
sc.frame_set(150)
for o in M.values():
    for m in o.modifiers:
        if m.type == 'ARMATURE':
            m.use_deform_preserve_volume = True

# ---------- smoothing ----------
for n, o in M.items():
    for p in o.data.polygons: p.use_smooth = True
    if n in ('Ch38_Eyelashes', 'Ch38_Hair'):
        continue   # alpha cards: subdividing them only blurs the strands
    s = o.modifiers.new('subd', 'SUBSURF'); s.levels = 1; s.render_levels = 2; s.quality = 3
    s.uv_smooth = 'PRESERVE_BOUNDARIES'

# ---------- node helpers ----------
base = bpy.data.materials['Ch38_body']
def tex_of(mat, socket):
    for l in mat.node_tree.links:
        if l.to_socket.name == socket and l.from_node.type == 'TEX_IMAGE': return l.from_node.image
        if l.to_socket.name == 'Normal' and socket == 'Normal' and l.from_node.type == 'NORMAL_MAP':
            for l2 in mat.node_tree.links:
                if l2.to_node == l.from_node and l2.from_node.type == 'TEX_IMAGE': return l2.from_node.image
DIFF, NORM, SPEC, GLOSS = tex_of(base, 'Base Color'), tex_of(base, 'Normal'), tex_of(base, 'Specular IOR Level'), tex_of(base, 'Roughness')
print('TEXTURES', DIFF and DIFF.name, NORM and NORM.name, SPEC and SPEC.name, GLOSS and GLOSS.name)

class G:   # a small graph builder so each material reads top to bottom
    def __init__(self, name):
        self.m = bpy.data.materials.new(name); self.m.use_nodes = True
        self.nt = self.m.node_tree; self.nt.nodes.clear()
        self.out = self.n('ShaderNodeOutputMaterial'); self.b = self.n('ShaderNodeBsdfPrincipled')
        self.l(self.b, 'BSDF', self.out, 'Surface')
    def n(self, kind, **kw):
        nd = self.nt.nodes.new(kind)
        for k, v in kw.items():
            if k in nd.inputs: nd.inputs[k].default_value = v
            else: setattr(nd, k, v)
        return nd
    def l(self, a, ao, b, bi):
        self.nt.links.new(a.outputs[ao] if isinstance(ao, str) else a.outputs[ao], b.inputs[bi] if isinstance(bi, str) else b.inputs[bi])
    def img(self, im, non_color=False):
        t = self.n('ShaderNodeTexImage'); t.image = im
        if non_color: im.colorspace_settings.name = 'Non-Color'
        return t
    def albedo(self):
        return self.img(DIFF)
    def roughness_from_gloss(self, lo, hi):   # Mixamo ships glossiness; roughness is its inverse, squeezed into a believable range
        g = self.img(GLOSS, True); inv = self.n('ShaderNodeMath', operation='SUBTRACT'); inv.inputs[0].default_value = 1
        self.l(g, 'Color', inv, 1)
        mr = self.n('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = lo; mr.inputs['To Max'].default_value = hi
        self.l(inv, 0, mr, 'Value'); return mr
    def normal_map(self, strength=1.0):
        t = self.img(NORM, True); nm = self.n('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = strength
        self.l(t, 'Color', nm, 'Color'); return nm
    def bump(self, height_node, out, strength, distance, normal=None):
        b = self.n('ShaderNodeBump'); b.inputs['Strength'].default_value = strength; b.inputs['Distance'].default_value = distance
        self.l(height_node, out, b, 'Height')
        if normal is not None: self.l(normal, 'Normal', b, 'Normal')
        return b

# ---------- skin ----------
def skin():
    g = G('skin'); b = g.b
    alb = g.albedo()
    # the texture's own tone, warmed slightly toward living skin
    warm = g.n('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); warm.inputs['Factor'].default_value = 0.15
    warm.inputs[7].default_value = (1.0, 0.86, 0.80, 1)
    g.l(alb, 'Color', warm, 6); g.l(warm, 2, b, 'Base Color')
    b.subsurface_method = 'RANDOM_WALK'
    b.inputs['Subsurface Weight'].default_value = 0.18
    b.inputs['Subsurface Radius'].default_value = (1.0, 0.42, 0.25)   # red travels furthest: ears, nose and fingers glow when backlit
    b.inputs['Subsurface Scale'].default_value = 0.006
    g.l(alb, 'Color', b, 'Subsurface Weight') if False else None
    b.inputs['Specular IOR Level'].default_value = 0.5
    b.inputs['Coat Weight'].default_value = 0.0
    # pores: fine noise in object space (the mesh is in centimetres), as a very weak bump over the baked normal map
    tc = g.n('ShaderNodeTexCoord')
    pores = g.n('ShaderNodeTexNoise', noise_dimensions='3D'); pores.inputs['Scale'].default_value = 9.0; pores.inputs['Detail'].default_value = 8; pores.inputs['Roughness'].default_value = 0.7
    g.l(tc, 'Object', pores, 'Vector')
    nm = g.normal_map(1.0)
    bp = g.bump(pores, 'Fac', 0.05, 0.02, nm); g.l(bp, 'Normal', b, 'Normal')
    # roughness: gloss map, broken up by the pore noise through a ramp; sweat sheen on the forehead and arms (shinier where it's high)
    rough = g.roughness_from_gloss(0.38, 0.62)
    ramp = g.n('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.4; ramp.color_ramp.elements[0].color = (0.82, 0.82, 0.82, 1)
    ramp.color_ramp.elements[1].position = 0.7; ramp.color_ramp.elements[1].color = (1.1, 1.1, 1.1, 1)
    g.l(pores, 'Fac', ramp, 'Fac')
    mul = g.n('ShaderNodeMath', operation='MULTIPLY'); g.l(rough, 0, mul, 0); g.l(ramp, 'Color', mul, 1)
    # sweat: generated Z (0 at the feet, 1 at the head): the top of the head and the forearms (by a band of noise) get lower roughness
    sep = g.n('ShaderNodeSeparateXYZ'); g.l(tc, 'Generated', sep, 'Vector')
    sweatZ = g.n('ShaderNodeMapRange'); sweatZ.inputs['From Min'].default_value = 0.86; sweatZ.inputs['From Max'].default_value = 0.95
    g.l(sep, 'Z', sweatZ, 'Value')
    patch = g.n('ShaderNodeTexNoise'); patch.inputs['Scale'].default_value = 0.35; g.l(tc, 'Object', patch, 'Vector')
    pr = g.n('ShaderNodeMapRange'); pr.inputs['From Min'].default_value = 0.5; pr.inputs['From Max'].default_value = 0.62; pr.inputs['To Max'].default_value = 0.7
    g.l(patch, 'Fac', pr, 'Value')
    wet = g.n('ShaderNodeMath', operation='MAXIMUM'); g.l(sweatZ, 0, wet, 0); g.l(pr, 0, wet, 1)
    mix = g.n('ShaderNodeMix', data_type='FLOAT'); mix.inputs['B'].default_value = 0.2
    g.l(wet, 0, mix, 'Factor'); g.l(mul, 0, mix, 'A'); g.l(mix, 'Result', b, 'Roughness')
    return g.m

# ---------- fabric: the kit's own colours and crest from the texture sheet, a polyester weave on top ----------
def fabric(name, sheen=0.4, weave_scale=1400.0):
    g = G(name); b = g.b
    g.l(g.albedo(), 'Color', b, 'Base Color')
    uv = g.n('ShaderNodeTexCoord')
    # micro-weave: Voronoi cells (the breathable mesh holes) plus Wave bands (the knit), both very fine on the UV sheet
    vor = g.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); vor.inputs['Scale'].default_value = weave_scale
    wav = g.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL'); wav.inputs['Scale'].default_value = weave_scale * 0.6; wav.inputs['Distortion'].default_value = 1.5
    g.l(uv, 'UV', vor, 'Vector'); g.l(uv, 'UV', wav, 'Vector')
    add = g.n('ShaderNodeMath', operation='MULTIPLY_ADD'); add.inputs[1].default_value = 0.5
    g.l(vor, 'Distance', add, 0); g.l(wav, 'Fac', add, 2)
    nm = g.normal_map(0.8)
    bp = g.bump(add, 0, 0.12, 0.002, nm); g.l(bp, 'Normal', b, 'Normal')
    b.inputs['Roughness'].default_value = 0.62
    b.inputs['Sheen Weight'].default_value = sheen; b.inputs['Sheen Roughness'].default_value = 0.4
    b.inputs['Specular IOR Level'].default_value = 0.35
    return g.m

# ---------- boots: glossy synthetic upper, rougher soles and studs, grass and mud toward the bottom ----------
def boots():
    g = G('boots'); b = g.b
    alb = g.albedo(); tc = g.n('ShaderNodeTexCoord')
    sep = g.n('ShaderNodeSeparateXYZ'); g.l(tc, 'Generated', sep, 'Vector')
    sole = g.n('ShaderNodeMapRange'); sole.inputs['From Min'].default_value = 0.22; sole.inputs['From Max'].default_value = 0.12
    g.l(sep, 'Z', sole, 'Value')                       # 1 at the sole, 0 up the upper
    n = g.n('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 3.0; n.inputs['Detail'].default_value = 10; g.l(tc, 'Object', n, 'Vector')
    lowz = g.n('ShaderNodeMapRange'); lowz.inputs['From Min'].default_value = 0.45; lowz.inputs['From Max'].default_value = 0.15; g.l(sep, 'Z', lowz, 'Value')
    dirt = g.n('ShaderNodeMath', operation='MULTIPLY'); g.l(lowz, 0, dirt, 0); g.l(n, 'Fac', dirt, 1)
    dm = g.n('ShaderNodeMapRange'); dm.inputs['From Min'].default_value = 0.3; dm.inputs['From Max'].default_value = 0.55; g.l(dirt, 0, dm, 'Value')
    grass = g.n('ShaderNodeMix', data_type='RGBA'); grass.inputs[6].default_value = (0.11, 0.09, 0.06, 1); grass.inputs[7].default_value = (0.12, 0.2, 0.06, 1)
    g.l(n, 'Color', grass, 'Factor')                   # mud and grass stain, mixed by the same noise
    col = g.n('ShaderNodeMix', data_type='RGBA'); g.l(dm, 0, col, 'Factor'); g.l(alb, 'Color', col, 6); g.l(grass, 2, col, 7)
    g.l(col, 2, b, 'Base Color')
    r = g.n('ShaderNodeMath', operation='MAXIMUM')
    rs = g.n('ShaderNodeMapRange'); rs.inputs['To Min'].default_value = 0.16; rs.inputs['To Max'].default_value = 0.75; g.l(sole, 0, rs, 'Value')
    g.l(rs, 0, r, 0); g.l(dm, 0, r, 1)
    rr = g.n('ShaderNodeMapRange'); rr.inputs['To Min'].default_value = 0.16; rr.inputs['To Max'].default_value = 0.85; g.l(r, 0, rr, 'Value')
    g.l(rr, 0, b, 'Roughness')
    b.inputs['Coat Weight'].default_value = 0.35; b.inputs['Coat Roughness'].default_value = 0.12   # the synthetic leather's lacquer
    g.l(g.normal_map(1.0), 'Normal', b, 'Normal')
    return g.m

def hair():
    h = bpy.data.materials['Ch38_hair']
    bs = h.node_tree.nodes['Principled BSDF']
    bs.inputs['Roughness'].default_value = 0.42; bs.inputs['Coat Weight'].default_value = 0.0
    if hasattr(h, 'surface_render_method'): h.surface_render_method = 'DITHERED'
    return h

ASSIGN = {'Ch38_Body': skin(), 'Ch38_Shirt': fabric('jersey', 0.5), 'Ch38_Shorts': fabric('shorts', 0.6, 1600.0),
          'Ch38_Socks': fabric('socks', 0.7, 1100.0), 'Ch38_Shoes': boots()}
for n, m in ASSIGN.items():
    M[n].data.materials.clear(); M[n].data.materials.append(m)
hair()

# ---------- where things are: the eyes from the head bone ----------
bpy.context.view_layer.update()
pb = rig.pose.bones
head = next(b for b in pb if b.name.endswith(':Head'))
H = rig.matrix_world @ head.head
top = rig.matrix_world @ next(b for b in pb if b.name.endswith(':HeadTop_End')).head if any(b.name.endswith(':HeadTop_End') for b in pb) else H + Vector((0, 0, 0.2))
# the body faces -Y after the FBX import; eyes sit forward of the head joint and a little up
fwd = (rig.matrix_world.to_3x3() @ head.matrix.to_3x3() @ Vector((0, 0, 1))).normalized()
fwd.z = 0; fwd = fwd.normalized() if fwd.length > 1e-3 else Vector((0, -1, 0))
EYES = H + (top - H) * 0.45 + fwd * 0.09
print('EYES', tuple(round(c, 3) for c in EYES), 'facing', tuple(round(c, 2) for c in fwd))

# ---------- the ground: floodlit grass, out of focus ----------
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
ground = bpy.context.active_object
gm = G('grass'); gtc = gm.n('ShaderNodeTexCoord')
gn = gm.n('ShaderNodeTexNoise'); gn.inputs['Scale'].default_value = 400; gn.inputs['Detail'].default_value = 6; gm.l(gtc, 'Object', gn, 'Vector')
stripe = gm.n('ShaderNodeTexWave', wave_type='BANDS'); stripe.inputs['Scale'].default_value = 0.6; stripe.inputs['Distortion'].default_value = 0
stripe.bands_direction = 'X'; gm.l(gtc, 'Object', stripe, 'Vector')
st = gm.n('ShaderNodeMath', operation='GREATER_THAN'); st.inputs[1].default_value = 0.5; gm.l(stripe, 'Fac', st, 0)
gc = gm.n('ShaderNodeMix', data_type='RGBA'); gc.inputs[6].default_value = (0.035, 0.11, 0.025, 1); gc.inputs[7].default_value = (0.05, 0.15, 0.03, 1)
gm.l(st, 0, gc, 'Factor'); gm.l(gc, 2, gm.b, 'Base Color')
gm.b.inputs['Roughness'].default_value = 0.85
gm.l(gm.bump(gn, 'Fac', 0.4, 0.01), 'Normal', gm.b, 'Normal')
ground.data.materials.append(gm.m)

# ---------- stadium at night: cool floodlights overhead, a hard rim behind, a soft fill on the face ----------
def area(name, loc, target, energy, size, color, shape='RECTANGLE', sx=None):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.color = color; d.shape = shape
    d.size = size; d.size_y = sx or size
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o
back = -fwd; side = Vector((-fwd.y, fwd.x, 0))
C = Vector((EYES.x, EYES.y, 0))
area('flood_left', C + side * 9 + back * 6 + Vector((0, 0, 16)), EYES, 2400, 3.0, (0.78, 0.87, 1.0))
area('flood_right', C - side * 11 + back * 3 + Vector((0, 0, 18)), EYES, 1500, 3.0, (0.8, 0.9, 1.0))
area('rim', EYES + back * 2.6 - side * 1.4 + Vector((0, 0, 0.9)), EYES - Vector((0, 0, 0.4)), 3200, 0.5, (0.9, 0.95, 1.0), 'RECTANGLE', 2.4)
area('fill', EYES + fwd * 2.4 + side * 1.6 + Vector((0, 0, 0.2)), EYES, 110, 2.2, (1.0, 0.92, 0.84), 'DISK')
area('kick', EYES + back * 1.5 + side * 2.2 + Vector((0, 0, -0.5)), EYES - Vector((0, 0, 0.5)), 380, 0.6, (0.75, 0.85, 1.0))
w = bpy.data.worlds.new('night'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']
sky = w.node_tree.nodes.new('ShaderNodeTexGradient'); wtc = w.node_tree.nodes.new('ShaderNodeTexCoord')
wsep = w.node_tree.nodes.new('ShaderNodeSeparateXYZ'); wr = w.node_tree.nodes.new('ShaderNodeValToRGB')
w.node_tree.links.new(wtc.outputs['Generated'], wsep.inputs[0]); w.node_tree.links.new(wsep.outputs['Z'], wr.inputs['Fac'])
wr.color_ramp.elements[0].color = (0.012, 0.016, 0.03, 1); wr.color_ramp.elements[1].color = (0.002, 0.003, 0.008, 1)
w.node_tree.links.new(wr.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
# far stand lights as bokeh: small bright emitters behind, well out of focus
import random; random.seed(4)
em = bpy.data.materials.new('standlight'); em.use_nodes = True; en = em.node_tree.nodes; en.clear()
eo = en.new('ShaderNodeOutputMaterial'); ee = en.new('ShaderNodeEmission'); ee.inputs['Strength'].default_value = 60; ee.inputs['Color'].default_value = (0.85, 0.92, 1, 1)
em.node_tree.links.new(ee.outputs[0], eo.inputs['Surface'])
for k in range(22):
    a = random.uniform(-0.35, 0.35)
    dirv = (back * math.cos(a) + side * math.sin(a)).normalized()
    p = C + dirv * random.uniform(70, 95) + Vector((0, 0, random.uniform(3, 9)))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=p, segments=12, ring_count=6)
    s = bpy.context.active_object; s.data.materials.append(em)
    s.visible_shadow = False

# ---------- camera: 85 mm, waist-up action portrait, focused on the eyes ----------
cd = bpy.data.cameras.new('cam85'); cd.lens = 85; cd.sensor_width = 36
cd.dof.use_dof = True; cd.dof.aperture_fstop = 2.0
cam = bpy.data.objects.new('cam85', cd); sc.collection.objects.link(cam); sc.camera = cam
chest = rig.matrix_world @ next(b for b in pb if b.name.endswith(':Spine2')).head
look = Vector((chest.x, chest.y, EYES.z - 0.3))         # centred on the body, eyes in the top third
cam.location = EYES + (fwd * 0.93 + side * 0.37).normalized() * 3.1 - Vector((0, 0, 0.12))
cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
cd.dof.focus_distance = (EYES - cam.location).length
print('CAMERA', tuple(round(c, 2) for c in cam.location), 'focus', round(cd.dof.focus_distance, 3))

# ---------- render: Cycles on the GPU, AgX ----------
sc.render.engine = 'CYCLES'
pr = bpy.context.preferences.addons['cycles'].preferences
for kind in ('OPTIX', 'CUDA'):
    try:
        pr.compute_device_type = kind; pr.get_devices()
        if any(d.type == kind for d in pr.devices):
            for d in pr.devices: d.use = d.type == kind
            sc.cycles.device = 'GPU'; print('DEVICE', kind); break
    except Exception as e: print('device', kind, e)
sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
sc.cycles.use_adaptive_sampling = True; sc.cycles.adaptive_threshold = 0.01
sc.cycles.max_bounces = 8; sc.cycles.transparent_max_bounces = 16
sc.render.resolution_x, sc.render.resolution_y = 1080, 1350
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
sc.view_settings.exposure = 0.0
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = OUT
if SAVE: bpy.ops.wm.save_as_mainfile(filepath=SAVE, compress=True)
bpy.ops.render.render(write_still=True)
print('RENDERED', OUT)
