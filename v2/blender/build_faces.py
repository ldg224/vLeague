# V2: four original faces built with MakeHuman (MPFB2 extension for Blender, CC0 assets), rendered as matched studio portraits in one
# sheet. Each man is a mix of MakeHuman's measured population averages (age, build, ancestry) plus his own face-shape choices (jaw,
# cheekbones, nose, brows, lips, eyes) - no sculpting by hand and no real person's likeness.
#   blender -b --python v2/blender/build_faces.py -- <out folder> [samples] [only name]
# Needs: the mpfb extension enabled, and MakeHuman's CC0 packs (system assets, skins02, hair01, eyebrows01) in its data folder.
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]; SAMPLES = int(argv[1]) if len(argv) > 1 else 128
ONLY = argv[2] if len(argv) > 2 else None
os.makedirs(OUT, exist_ok=True)

import addon_utils
for mod in addon_utils.modules():
    if mod.__name__.endswith('mpfb'):
        addon_utils.enable(mod.__name__, default_set=True); MP = mod.__name__
mp = sys.modules[MP]
from importlib import import_module
HumanService = import_module(MP + '.services.humanservice').HumanService
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hairgen

# strand hair per man (hairgen.py): front of the face is -Y. Lengths in metres; melanin 1 = black, ~0.35 + redness = ginger.
STYLE = {
    'Kwame': dict(count=120000, length=0.005, comb=(0, 0.3, 0.4), lift=0.8, curl=2.5, segs=5, melanin=1.0, redness=0.05, root_r=0.00007, tip_r=0.00005, reach=0.03, scalp=(0.008, 0.006, 0.005)),
    'Kenji': dict(count=140000, length=0.06, comb=(0.5, 1.0, -0.1), lift=0.2, curl=0.0, segs=12, gravity=0.0, volume=0.012, melanin=0.97, redness=0.05, root_r=0.00008, tip_r=0.00004, roughness=0.25, scalp=(0.01, 0.008, 0.007)),
    'Callum': dict(count=140000, length=0.035, comb=(0, -0.6, 0.5), comb_from=True, comb_from_w=0.6, lift=0.3, curl=0.35, segs=8, volume=0.014, melanin=0.62, redness=1.0, root_r=0.00008, tip_r=0.00004, scalp=(0.22, 0.06, 0.02)),
    'Mateo': dict(count=140000, length=0.032, comb=(0, 1.0, 0.35), comb_from=True, comb_from_w=0.4, lift=0.3, curl=0.15, segs=8, volume=0.012, melanin=0.9, redness=0.22, root_r=0.00008, tip_r=0.00004, scalp=(0.02, 0.013, 0.008)),
}
STUBBLE = {}   # stubble (hairgen.stubble) still needs work: the beard shadow covered the lips

def age(years):   # MakeHuman's age dial: 0.1875 = 11, 0.5 = 25, 1.0 = 90 years
    return 0.1875 + (years - 11) / 14 * 0.3125 if years <= 25 else 0.5 + (years - 25) / 65 * 0.5

# name, phenotype, face shape targets, skin, hair, eyebrows, eye iris colours (minor, major), hair colour tint (None keeps the asset's)
MEN = [
    ('Kwame', dict(age=age(24), muscle=0.68, weight=0.52, height=0.6, proportions=0.6, race=dict(african=0.9, caucasian=0.05, asian=0.05)),
     {'head-square': 0.35, 'chin-width-incr': 0.35, 'l-cheek-bones-incr': 0.4, 'r-cheek-bones-incr': 0.4, 'mouth-lowerlip-volume-incr': 0.25,
      'nose-flaring-incr': 0.15, 'eyebrows-trans-down': 0.15, 'neck-scale-horiz-incr': 0.3, 'forehead-scale-vert-decr': 0.15},
     'young_african_male/young_african_male.mhmat', 'afro01/afro01.mhclo', 'eyebrow010/eyebrow010.mhclo', ((0.09, 0.04, 0.015), (0.16, 0.08, 0.03)), (0.02, 0.015, 0.012)),
    ('Kenji', dict(age=age(22), muscle=0.58, weight=0.42, height=0.48, proportions=0.6, race=dict(asian=0.92, caucasian=0.06, african=0.02)),
     {'head-oval': 0.4, 'chin-width-decr': 0.2, 'chin-height-incr': 0.1, 'l-cheek-bones-incr': 0.15, 'r-cheek-bones-incr': 0.15,
      'nose-scale-horiz-decr': 0.1, 'mouth-scale-horiz-decr': 0.1, 'head-fat-decr': 0.25},
     'young_asian_male/young_asian_male.mhmat', 'short02/short02.mhclo', 'eyebrow002/eyebrow002.mhclo', ((0.07, 0.035, 0.015), (0.12, 0.06, 0.025)), (0.012, 0.01, 0.01)),
    ('Callum', dict(age=age(27), muscle=0.6, weight=0.45, height=0.62, proportions=0.6, race=dict(caucasian=0.95, asian=0.03, african=0.02)),
     {'head-scale-vert-incr': 0.25, 'head-scale-horiz-decr': 0.15, 'nose-hump-incr': 0.3, 'nose-scale-vert-incr': 0.2, 'chin-prominent-incr': 0.3,
      'l-cheek-inner-decr': 0.25, 'r-cheek-inner-decr': 0.25, 'mouth-upperlip-volume-decr': 0.2, 'eyebrows-angle-up': 0.15},
     'toigo_light_skin_male_ginger/toigo_light_skin_male_ginger.mhmat', 'short02/short02.mhclo', 'eyebrow006/eyebrow006.mhclo', ((0.15, 0.3, 0.27), (0.3, 0.45, 0.4)), (0.42, 0.14, 0.05)),
    ('Mateo', dict(age=age(29), muscle=0.62, weight=0.55, height=0.52, proportions=0.6, race=dict(caucasian=0.7, african=0.12, asian=0.18)),
     {'head-rectangular': 0.35, 'chin-width-incr': 0.3, 'chin-cleft-incr': 0.3, 'eyebrows-trans-down': 0.25, 'forehead-nubian-incr': 0.2,
      'nose-scale-horiz-incr': 0.1, 'nose-hump-incr': 0.15, 'mouth-scale-horiz-incr': 0.1, 'l-eye-bag-incr': 0.2, 'r-eye-bag-incr': 0.2},
     'toigo_light_skin_male_bronze/toigo_light_skin_male_bronze.mhmat', 'short01/short01.mhclo', 'eyebrow011/eyebrow011.mhclo', ((0.12, 0.09, 0.03), (0.22, 0.16, 0.06)), (0.03, 0.02, 0.014)),
]

def build(name, pheno, shape, skin, hair, brows, iris, hair_col):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for mod in addon_utils.modules():
        if mod.__name__ == MP: addon_utils.enable(MP, default_set=True)
    info = HumanService._create_default_human_info_dict()
    ph = info['phenotype']; ph.update({k: v for k, v in pheno.items() if k != 'race'}); ph['gender'] = 1.0
    ph['race'] = pheno['race']
    info['name'] = name
    info['targets'] = [{'target': k, 'value': v} for k, v in shape.items()]
    info['eyes'] = 'high-poly/high-poly.mhclo'; info['eyelashes'] = 'eyelashes02/eyelashes02.mhclo'; info['eyebrows'] = brows
    info['teeth'] = 'teeth_base/teeth_base.mhclo'; info['tongue'] = 'tongue01/tongue01.mhclo'; info['hair'] = hair
    info['clothes'] = ['male_casualsuit06/male_casualsuit06.mhclo']
    info['skin_mhmat'] = skin; info['skin_material_type'] = 'ENHANCED_SSS'
    info['eyes_material_type'] = 'PROCEDURAL_EYES'
    st = HumanService.get_default_deserialization_settings(); st['subdiv_levels'] = 1; st['load_clothes'] = True
    body = HumanService.deserialize_from_dict(info, st)
    print('BUILT', name, body.name, [o.name for o in bpy.data.objects])
    # eyes: iris colours on MakeHuman's procedural eye shader
    for o in bpy.data.objects:
        for m in (o.data.materials if o.type == 'MESH' else []):
            if not m or not m.use_nodes: continue
            for nd in m.node_tree.nodes:
                if nd.type == 'GROUP' and 'IrisMinorColor' in nd.inputs:
                    nd.inputs['IrisMinorColor'].default_value = (*iris[0], 1); nd.inputs['IrisMajorColor'].default_value = (*iris[1], 1)
    # hair colour: multiply the asset's texture toward this man's colour
    if hair_col:
        for o in bpy.data.objects:
            if o.type == 'MESH' and any(k in o.name.lower() for k in ('hair', 'afro', 'short', 'eyebrow')):
                for m in o.data.materials:
                    if not m or not m.use_nodes: continue
                    nt = m.node_tree
                    for l in list(nt.links):
                        if l.to_socket.name == 'Base Color' and l.from_node.type == 'TEX_IMAGE':
                            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
                            mix.inputs[7].default_value = (*[c * 2.2 for c in hair_col], 1)
                            nt.links.new(l.from_socket, mix.inputs[6]); nt.links.new(mix.outputs[2], l.to_socket)
    # a plain training top instead of the asset's printed T-shirt
    for o in bpy.data.objects:
        if o.type == 'MESH' and 'casualsuit' in o.name:
            m = bpy.data.materials.new('top'); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
            b.inputs['Base Color'].default_value = (0.025, 0.035, 0.07, 1); b.inputs['Roughness'].default_value = 0.75
            b.inputs['Sheen Weight'].default_value = 0.5; b.inputs['Sheen Roughness'].default_value = 0.35
            o.data.materials.clear(); o.data.materials.append(m)
    return body

def _eyes(body):
    eyes = next((o for o in bpy.data.objects if o.type == 'MESH' and o.name.lower().endswith(('high-poly', 'low-poly'))), None)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = eyes.evaluated_get(dg); pts = [ev.matrix_world @ v.co for v in ev.data.vertices]
    return sum(pts, Vector()) / len(pts)

def light_and_camera(body):
    sc = bpy.context.scene
    E = _eyes(body)
    fwd = Vector((0, -1, 0)); side = Vector((1, 0, 0))
    print('EYES', tuple(round(c, 3) for c in E))
    def area(nm, loc, energy, size, color, sy=None):
        d = bpy.data.lights.new(nm, 'AREA'); d.energy = energy; d.color = color; d.shape = 'RECTANGLE'; d.size = size; d.size_y = sy or size
        o = bpy.data.objects.new(nm, d); sc.collection.objects.link(o); o.location = loc
        o.rotation_euler = (E - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    area('key', E + fwd * 0.9 + side * 1.25 + Vector((0, 0, 0.55)), 150, 1.0, (1.0, 0.95, 0.9), 1.3)     # big soft key, about 55 deg off
    area('fill', E + fwd * 1.6 - side * 1.2 + Vector((0, 0, -0.1)), 16, 1.5, (0.92, 0.95, 1.0))
    area('rimL', E - fwd * 0.9 - side * 0.8 + Vector((0, 0, 0.35)), 70, 0.3, (0.8, 0.88, 1.0), 1.2)
    area('rimR', E - fwd * 0.9 + side * 0.9 + Vector((0, 0, 0.2)), 45, 0.3, (0.85, 0.9, 1.0), 1.2)
    # a dark backdrop with a soft pool of light behind the head
    bpy.ops.mesh.primitive_plane_add(size=8, location=(E.x, E.y + 1.6, E.z), rotation=(math.pi / 2, 0, 0))
    bd = bpy.context.active_object; m = bpy.data.materials.new('backdrop'); m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.018, 0.02, 0.026, 1); m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    bd.data.materials.append(m)
    area('bg', E - fwd * 0.6 + Vector((0, 0, -0.3)), 40, 0.6, (0.75, 0.82, 1.0))
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    cd = bpy.data.cameras.new('cam'); cd.lens = 85; cd.sensor_width = 36; cd.sensor_fit = 'VERTICAL'; cd.sensor_height = 36
    cd.dof.use_dof = True; cd.dof.aperture_fstop = 2.8
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    a = math.radians(18)   # a slight three-quarter view shows the nose and cheekbones
    cam.location = E + (fwd * math.cos(a) + side * math.sin(a)) * 1.12
    look = E + Vector((0, 0, -0.07))
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cd.dof.focus_distance = (E - cam.location).length - 0.015
    sc.render.engine = 'CYCLES'
    pr = bpy.context.preferences.addons['cycles'].preferences
    try:
        pr.compute_device_type = 'OPTIX'; pr.get_devices()
        for d in pr.devices: d.use = d.type == 'OPTIX'
        sc.cycles.device = 'GPU'
    except Exception as e: print('device', e)
    sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True; sc.cycles.max_bounces = 10; sc.cycles.transparent_max_bounces = 32
    sc.render.resolution_x, sc.render.resolution_y = 800, 1000
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'; sc.view_settings.exposure = -0.35

for spec in MEN:
    if ONLY and spec[0] != ONLY: continue
    body = build(*spec)
    hm = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith(spec[4].split('/')[0]))
    st = dict(STYLE[spec[0]])
    E0 = _eyes(body)
    if st.get('comb_from'): st['comb_from'] = (0, E0.y + 0.11, E0.z + 0.11)   # the crown, behind and above the eyes
    hairgen.scalp_hair(body, hm, st)
    if spec[0] in STUBBLE: hairgen.stubble(body, tuple(E0), *STUBBLE[spec[0]])
    light_and_camera(body)
    sc = bpy.context.scene; sc.render.filepath = os.path.join(OUT, spec[0] + '.png')
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, spec[0] + '.blend'), compress=True)
    print('RENDERED', spec[0])
