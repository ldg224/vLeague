# V2-2: builds v2/models/footballer.glb from the Mixamo footballer (Ch38) and the football animations downloaded on the league's
# Mixamo account. The raw Mixamo files stay in the private workspace (C:\Claude\Plans\vLeague\v2-mixamo): Mixamo's terms allow them
# inside a game but not as files to download, so only this built model goes in the site.
#   blender -b --python v2/blender/build_mixamo.py -- <anims folder> <out.glb> [preview.png]
# Steps: the body loses the faces hidden under the kit; every piece is cut down for phones; the textures become grey so the browser
# tints the shirt, shorts, socks, skin and hair per player; finger bones are dropped; every animation goes in as its own clip.
import bpy, bmesh, sys, os, glob
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None
TRIS = {'Ch38_Body': 3200, 'Ch38_Shirt': 2200, 'Ch38_Shorts': 1500, 'Ch38_Socks': 600, 'Ch38_Shoes': 900, 'Ch38_Hair': 900}
PART = {'Ch38_Body': 'skin', 'Ch38_Shirt': 'shirt', 'Ch38_Shorts': 'shorts', 'Ch38_Socks': 'socks', 'Ch38_Shoes': 'boots', 'Ch38_Hair': 'hair'}
KEEP_BONES = ('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
              'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, 'character.fbx'), automatic_bone_orientation=False)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
prefix = rig.data.bones[0].name.split(':')[0] + ':'
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name not in PART:
        bpy.data.objects.remove(o, do_unlink=True)
meshes = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}

# ---------- the body under the kit: a body face whose outward ray hits clothing within 3 cm is never seen ----------
dg = bpy.context.evaluated_depsgraph_get()
cloth = [meshes[n] for n in ('Ch38_Shirt', 'Ch38_Shorts', 'Ch38_Socks', 'Ch38_Shoes')]
trees = [BVHTree.FromObject(c, dg) for c in cloth]
body = meshes['Ch38_Body']
mw, mwi = body.matrix_world, body.matrix_world.inverted()
bm = bmesh.new(); bm.from_mesh(body.data); bm.normal_update()
# work in world space: the clothes' trees are in their own object space, so map through each object's matrix
def covered(v):
    p = mw @ v.co; n = (mw.to_3x3() @ v.normal).normalized()
    for c, t in zip(cloth, trees):
        ci = c.matrix_world.inverted()
        lp = ci @ p; ln = (ci.to_3x3() @ n).normalized()
        hit = t.ray_cast(lp, ln, 0.04 / max(1e-6, c.matrix_world.to_scale()[0]))
        if hit[0] is not None:
            return True
    return False
cov = {v.index: covered(v) for v in bm.verts}
dead = [f for f in bm.faces if all(cov[v.index] for v in f.verts)]
bmesh.ops.delete(bm, geom=dead, context='FACES')
bm.to_mesh(body.data); bm.free()
print('BODY hidden faces removed', len(dead))

# ---------- grey textures: one tint per part in the browser ----------
def grey_copy(img, size, name):
    g = img.copy(); g.name = name
    g.scale(size, size)
    px = list(g.pixels)
    for i in range(0, len(px), 4):
        l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
        px[i] = px[i + 1] = px[i + 2] = l
    g.pixels = px
    g.filepath_raw = '//' + name + '.png'; g.file_format = 'PNG'
    return g
imgs = {}
for o in meshes.values():
    for m in o.data.materials:
        for nd in (m.node_tree.nodes if m and m.use_nodes else []):
            if nd.type == 'TEX_IMAGE' and nd.image and 'Diffuse' in (nd.image.filepath or nd.image.name):
                imgs.setdefault(m.name, nd.image)
body_img = next(i for k, i in imgs.items() if 'body' in k.lower())
hair_img = next((i for k, i in imgs.items() if 'hair' in k.lower()), None)
grey_body = grey_copy(body_img, 1024, 'kit_grey')
grey_hair = grey_copy(hair_img, 256, 'hair_grey') if hair_img else None

def make_mat(name, img):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if name == 'hair':
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha']); m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else None
    bsdf.inputs['Roughness'].default_value = 0.8
    return m
mats = {}
for name, o in meshes.items():
    part = PART[name]
    if part not in mats:
        mats[part] = make_mat(part, grey_hair if part == 'hair' and grey_hair else grey_body)
    o.data.materials.clear(); o.data.materials.append(mats[part])

# ---------- cut down for phones ----------
for name, o in meshes.items():
    t0 = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if t0 > TRIS[name]:
        d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = TRIS[name] / t0; d.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=d.name)
total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes.values())
print('TRIS', total, {n: sum(len(p.vertices) - 2 for p in o.data.polygons) for n, o in meshes.items()})

# ---------- animations: each file's action, re-pointed at this rig's bone names, as its own clip ----------
def bone_of(path):
    if 'pose.bones["' not in path: return None
    return path.split('pose.bones["')[1].split('"]')[0]
rig.animation_data_create()
clips = []
for f in sorted(glob.glob(os.path.join(SRC, '*.fbx'))):
    label = os.path.splitext(os.path.basename(f))[0]
    if label == 'character': continue
    before = set(bpy.data.objects); acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=f, automatic_bone_orientation=False)
    new_objs = [o for o in bpy.data.objects if o not in before]
    act = next((a for a in bpy.data.actions if a not in acts_before), None)
    for o in new_objs: bpy.data.objects.remove(o, do_unlink=True)
    if not act: print('NOACT', label); continue
    act.name = label
    # bone names may carry another prefix (mixamorig:, mixamorig5:): point them at ours; drop fingers and ends
    fcs = act.fcurves if hasattr(act, 'fcurves') else None
    if fcs is None:   # layered actions (Blender 4.4+): the curves sit in a channelbag
        fcs = act.layers[0].strips[0].channelbags[0].fcurves
    for fc in list(fcs):
        b = bone_of(fc.data_path)
        if not b: continue
        short = b.split(':')[-1]
        if short not in KEEP_BONES:
            fcs.remove(fc); continue
        fc.data_path = fc.data_path.replace(f'pose.bones["{b}"]', f'pose.bones["{prefix}{short}"]')
    tr = rig.animation_data.nla_tracks.new(); tr.name = label
    st = tr.strips.new(label, int(act.frame_range[0]), act); st.name = label
    tr.mute = True
    clips.append(label)
print('CLIPS', len(clips), clips)
for a in list(bpy.data.actions):
    if a.name not in clips and a.users == 0: bpy.data.actions.remove(a)
# the rest pose (no clip) for the exporter
rig.animation_data.action = None

# drop the finger and end bones from the skeleton itself
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for eb in list(rig.data.edit_bones):
    if eb.name.split(':')[-1] not in KEEP_BONES:
        # their weights fold into the parent so nothing is left hanging
        rig.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode='OBJECT')
for o in meshes.values():
    names = {b.name for b in rig.data.bones}
    for vg in list(o.vertex_groups):
        if vg.name not in names:
            # hand off to the hand bone of that side
            side = 'Left' if 'Left' in vg.name else 'Right' if 'Right' in vg.name else None
            tgt = f'{prefix}{side}Hand' if side else None
            if tgt and tgt in names:
                tv = o.vertex_groups.get(tgt) or o.vertex_groups.new(name=tgt)
                for v in o.data.vertices:
                    for g in v.groups:
                        if g.group == vg.index and g.weight > 0: tv.add([v.index], g.weight, 'ADD')
            o.vertex_groups.remove(vg)

bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for o in meshes.values(): o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True, export_animations=True,
                          export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
                          export_image_format='WEBP', export_image_quality=80, export_yup=True)
print('EXPORTED', OUT, os.path.getsize(OUT))
