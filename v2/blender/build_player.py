# V2-2: builds the shared footballer model (v2/models/player.glb) from Blender Studio's Human Base Meshes bundle (CC0,
# https://www.blender.org/download/demo-files/ "Human Base Meshes"). Run headless:
#   blender -b --python v2/blender/build_player.py -- <path to human_base_meshes_bundle.blend> <out.glb> [preview.png]
# What it does, all in code so it can be re-run and tweaked:
#   1. takes the realistic male body, drops the sculpt detail and stands him 1.80 m tall;
#   2. dresses him: each face goes to a kit region by where it sits (boots, socks, skin, shorts, shirt with short sleeves, hair),
#      and the shirt, shorts, socks and boots are puffed out from the skin a little so they read as clothes, not paint;
#   3. cuts him down to about 4,000 triangles for phones;
#   4. adds a skeleton (hips, spine, chest, neck, head, arms, legs, feet) placed from the body's own shape, weighted automatically;
#   5. exports one GLB. Colours are set per player in the browser (each region is its own material), so one file dresses every club.
import bpy, bmesh, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 and argv[2] != '-' else None
MIXAMO = '--mixamo' in argv   # export the dressed body without a skeleton, as FBX, for Mixamo's auto-rigger
H = 1.80
TARGET_TRIS = 7000

bpy.ops.wm.open_mainfile(filepath=SRC)
body = bpy.data.objects['GEO-body_male_realistic']
keep = {body.name}
for o in list(bpy.data.objects):
    if o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
if body.name not in scene.collection.objects and not any(body.name in c.objects for c in bpy.data.collections):
    scene.collection.objects.link(body)
for c in bpy.data.collections:
    if body.name not in c.objects:
        continue
bpy.context.view_layer.objects.active = body
body.select_set(True)
for m in list(body.modifiers):
    body.modifiers.remove(m)          # the sculpt detail (multires) is far too heavy for a phone
body.parent = None

# stand him on the ground, 1.80 m tall, facing -Y (Blender's front)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = body.data
zs = [v.co.z for v in me.vertices]
zmin, zmax = min(zs), max(zs)
k = H / (zmax - zmin)
cx = sum(v.co.x for v in me.vertices) / len(me.vertices)
cy = sum(v.co.y for v in me.vertices) / len(me.vertices)
for v in me.vertices:
    v.co = Vector(((v.co.x - cx) * k, (v.co.y - cy) * k, (v.co.z - zmin) * k))
me.update()

# ---------- landmarks from the shape ----------
verts = [v.co.copy() for v in me.vertices]
def band(z0, z1):
    return [p for p in verts if z0 <= p.z <= z1]
hand_tip = max(verts, key=lambda p: p.x)                  # the left hand's furthest point (A pose)
shoulder_z = H * 0.815
sh_band = [p for p in band(shoulder_z - 0.03, shoulder_z + 0.03)]
shoulder_x = max(p.x for p in sh_band if abs(p.y) < 0.12) - 0.06
SHOULDER = Vector((shoulder_x, 0.0, shoulder_z))
WRIST = SHOULDER.lerp(hand_tip, 0.88)
ELBOW = SHOULDER.lerp(WRIST, 0.47) + Vector((0, 0.02, 0))
HIP_Z = H * 0.53
KNEE_Z = H * 0.285
ANKLE_Z = H * 0.045
leg_x = sum(p.x for p in band(KNEE_Z - 0.02, KNEE_Z + 0.02) if p.x > 0) / max(1, len([p for p in band(KNEE_Z - 0.02, KNEE_Z + 0.02) if p.x > 0]))

# ---------- kit regions ----------
MATS = ['skin', 'shirt', 'shorts', 'socks', 'boots', 'hair']
me.materials.clear()
for n in MATS:
    m = bpy.data.materials.get(n) or bpy.data.materials.new(n)
    me.materials.append(m)
arm_len = (WRIST - SHOULDER).length

def region(p, n):
    z = p.z
    ax = abs(p.x)
    # the arm: close to the line from the shoulder to the fingertips (0 at the shoulder, 1 at the wrist)
    q = Vector((ax, p.y, z)); a = SHOULDER; tip = Vector((hand_tip.x, hand_tip.y, hand_tip.z))
    u = max(0.0, min(1.0, (q - a).dot(tip - a) / (tip - a).length_squared))
    near = (a + (tip - a) * u - q).length
    if ax > SHOULDER.x - 0.035 and u > 0.04 and near < 0.075 + 0.02 * (1 - u):
        t = (q - a).dot(WRIST - a) / (arm_len ** 2)
        return 'shirt' if t < 0.36 else 'skin'
    if z < H * 0.065:
        return 'boots'
    if z < H * 0.30:
        return 'socks'
    if z < H * 0.385:
        return 'skin'
    if z < H * 0.565:
        return 'shorts'
    if z < H * 0.835:
        return 'shirt'
    if z < H * 0.865:
        return 'shirt' if abs(p.y) > 0.03 or ax > 0.06 else 'skin'   # a round collar
    # the head: hair over the crown and the back, the face and ears stay skin
    if z > H * 0.955 or (z > H * 0.905 and n.y > 0.25) or (z > H * 0.93 and n.y > -0.2 and ax > 0.055):
        return 'hair'
    return 'skin'

PUFF = {'shirt': 0.012, 'shorts': 0.022, 'socks': 0.006, 'boots': 0.009, 'hair': 0.006, 'skin': 0.0}
bm = bmesh.new(); bm.from_mesh(me)
bm.normal_update()
vreg = {}
for f in bm.faces:
    c = f.calc_center_median()
    r = region(c, f.normal)
    f.material_index = MATS.index(r)
    for v in f.verts:
        # a vertex shared by two regions takes the bigger puff, so seams don't split open
        if PUFF[r] >= PUFF.get(vreg.get(v.index), -1):
            vreg[v.index] = r
for v in bm.verts:
    v.co += v.normal * PUFF[vreg.get(v.index, 'skin')]
# shorts hang loose: widen the legs of the shorts a touch more at the hem
for v in bm.verts:
    if vreg.get(v.index) == 'shorts' and v.co.z < H * 0.47:
        v.co.x += (0.012 if v.co.x > 0 else -0.012)
bm.to_mesh(me); bm.free(); me.update()

# ---------- down to phone size ----------
dec = body.modifiers.new('decimate', 'DECIMATE')
tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
dec.ratio = min(1.0, TARGET_TRIS / tris0)
dec.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=dec.name)
bpy.ops.object.shade_smooth()
tris = sum(len(p.vertices) - 2 for p in body.data.polygons)

if MIXAMO:
    bpy.ops.object.select_all(action='DESELECT'); body.select_set(True)
    for n, c in {'skin': (0.85, 0.62, 0.48, 1), 'shirt': (0.1, 0.55, 0.85, 1), 'shorts': (0.95, 0.95, 0.95, 1), 'socks': (0.1, 0.55, 0.85, 1), 'boots': (0.05, 0.05, 0.06, 1), 'hair': (0.12, 0.08, 0.05, 1)}.items():
        m = bpy.data.materials[n]; m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = c
    bpy.ops.export_scene.fbx(filepath=OUT, use_selection=True, object_types={'MESH'}, apply_unit_scale=True, axis_forward='-Z', axis_up='Y', path_mode='COPY', embed_textures=True)
    print(f'MIXAMO tris={tris} -> {OUT}')
    raise SystemExit
# ---------- skeleton ----------
arm = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', arm)
scene.collection.objects.link(rig)
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.edit_bones
def bone(name, head, tail, parent=None, roll_to=Vector((1, 0, 0))):
    b = eb.new(name); b.head = head; b.tail = tail
    if parent: b.parent = eb[parent]; b.use_connect = False
    b.align_roll(roll_to)      # local X stays the body's left-right axis, so a turn about X swings a limb forward and back
    return b
bone('hips', Vector((0, 0, HIP_Z)), Vector((0, 0, HIP_Z + 0.12)))
bone('spine', Vector((0, 0, HIP_Z + 0.12)), Vector((0, 0, H * 0.70)), 'hips')
bone('chest', Vector((0, 0, H * 0.70)), Vector((0, 0, H * 0.85)), 'spine')
bone('neck', Vector((0, 0, H * 0.85)), Vector((0, 0, H * 0.90)), 'chest')
bone('head', Vector((0, 0, H * 0.90)), Vector((0, 0, H * 1.0)), 'neck')
for s, side in ((1, 'L'), (-1, 'R')):
    sh = Vector((SHOULDER.x * s, SHOULDER.y, SHOULDER.z)); el = Vector((ELBOW.x * s, ELBOW.y, ELBOW.z)); wr = Vector((WRIST.x * s, WRIST.y, WRIST.z))
    hand_end = Vector((hand_tip.x * s, hand_tip.y, hand_tip.z))
    bone(f'clavicle.{side}', Vector((0.03 * s, 0, H * 0.82)), sh, 'chest')
    bone(f'upperarm.{side}', sh, el, f'clavicle.{side}')
    bone(f'forearm.{side}', el, wr, f'upperarm.{side}')
    bone(f'hand.{side}', wr, hand_end, f'forearm.{side}')
    hip = Vector((leg_x * s, 0, HIP_Z)); kn = Vector((leg_x * s, -0.01, KNEE_Z)); an = Vector((leg_x * s, 0.02, ANKLE_Z))
    bone(f'thigh.{side}', hip, kn, 'hips')
    bone(f'shin.{side}', kn, an, f'thigh.{side}')
    bone(f'foot.{side}', an, Vector((leg_x * s, -0.13, 0.015)), f'shin.{side}', roll_to=Vector((1, 0, 0)))
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
weighted = sum(1 for v in body.data.vertices if len(v.groups))
print(f'BUILD tris={tris} verts={len(body.data.vertices)} weighted={weighted} shoulder={tuple(round(c, 3) for c in SHOULDER)} wrist={tuple(round(c, 3) for c in WRIST)} leg_x={leg_x:.3f}')

# simple colours so the preview reads (the browser sets the real ones)
COL = {'skin': (0.85, 0.62, 0.48, 1), 'shirt': (0.1, 0.55, 0.85, 1), 'shorts': (0.95, 0.95, 0.95, 1), 'socks': (0.1, 0.55, 0.85, 1), 'boots': (0.05, 0.05, 0.06, 1), 'hair': (0.12, 0.08, 0.05, 1)}
for n in MATS:
    m = bpy.data.materials[n]; m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf: bsdf.inputs['Base Color'].default_value = COL[n]; bsdf.inputs['Roughness'].default_value = 0.8
    m.diffuse_color = COL[n]

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_skins=True, export_animations=False, export_yup=True, export_apply=False)
print('EXPORTED', OUT)

if PREVIEW:
    # a quick look: front and side by the workbench renderer
    cam_data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam)
    cam_data.type = 'ORTHO'; cam_data.ortho_scale = 2.1
    cam.location = (1.8, -3.2, 0.95); cam.rotation_euler = (1.5708, 0, 0.5236)
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'MATERIAL'
    scene.render.resolution_x = 700; scene.render.resolution_y = 800
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('PREVIEW', PREVIEW)
