# V2: puts another Mixamo character's head (face, hair, beard, eyelashes) on the footballer's body, so every player can have his own
# face on the same build and kit. Used by render_hero.py (--head <fbx>). Both characters are Mixamo rigs, so the head's skin weights
# carry straight over by bone name.
# How: in the rest pose, the donor head is moved and scaled onto the footballer's head bone; the donor keeps only the head and upper
# neck, the footballer loses the visible neck and head; the two overlap inside the shirt collar, so the join is never seen.
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HEAD_PARTS = ('Body', 'Beard', 'Hair', 'Eyelashes', 'Eyes', 'Moustache', 'Mustache', 'Brows', 'Eyebrows', 'Teeth', 'Tongue')

def _bone(rig, short):
    return next(b for b in rig.data.bones if b.name.split(':')[-1] == short)

def _world(rig, short, end='head'):
    b = _bone(rig, short)
    return rig.matrix_world @ (b.head_local if end == 'head' else b.tail_local)

def _avg_skin(obj, img, verts):
    """Average albedo of the texture under the given vertices: the face's skin tone."""
    me = obj.data; uv = me.uv_layers.active.data
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
    vs = set(verts); cols = []
    for poly in me.polygons:
        for li in poly.loop_indices:
            if me.loops[li].vertex_index in vs:
                u, v = uv[li].uv
                cols.append(px[int((v % 1) * (h - 1)), int((u % 1) * (w - 1)), :3])
    return np.median(np.array(cols), axis=0) if cols else np.array([0.5, 0.5, 0.5])

def swap(body_rig, body_meshes, donor_fbx, diffuse_of):
    """body_meshes: the footballer's meshes by name. diffuse_of(mat) -> albedo image. Returns (new head objects, skin tint for the
    footballer's own skin as an RGB ratio)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=donor_fbx)
    new = [o for o in bpy.data.objects if o not in before]
    drig = next(o for o in new if o.type == 'ARMATURE')
    dmeshes = {o.name: o for o in new if o.type == 'MESH'}
    # rest pose for both, so the mesh data is the bind shape
    for r in (body_rig, drig): r.data.pose_position = 'REST'
    bpy.context.view_layer.update()

    # place: the donor's head bone onto ours, scaled so the skull is the same size (head bone to the top of the head)
    bh, bt = _world(body_rig, 'Head'), _world(body_rig, 'HeadTop_End')
    dh, dt = _world(drig, 'Head'), _world(drig, 'HeadTop_End')
    k = (bt - bh).length / (dt - dh).length
    place = Matrix.Translation(bh) @ Matrix.Scale(k, 4) @ Matrix.Translation(-dh)
    neck_base = _world(body_rig, 'Neck')
    axis_xy = Vector((bh.x, bh.y))
    print('HEADSWAP scale', round(k, 3), 'neck base z', round(neck_base.z, 3))

    # the footballer's shirt, to tell which of his neck is hidden under the collar
    dg = bpy.context.evaluated_depsgraph_get()
    shirt = body_meshes['Ch38_Shirt']
    tree = BVHTree.FromObject(shirt, dg)
    si = shirt.matrix_world.inverted()
    def under_shirt(p, n):
        lp, ln = si @ p, (si.to_3x3() @ n).normalized()
        return tree.ray_cast(lp, ln, 0.05 / shirt.matrix_world.to_scale()[0])[0] is not None

    # the footballer: drop his head and the visible neck (everything above the neck base that the shirt doesn't cover)
    body = body_meshes['Ch38_Body']
    face_verts = []
    bm = bmesh.new(); bm.from_mesh(body.data); bm.normal_update()
    mw = body.matrix_world
    gone = set()
    for v in bm.verts:
        p = mw @ v.co
        if p.z > neck_base.z - 0.03 and (Vector((p.x, p.y)) - axis_xy).length < 0.16:
            if p.z > bh.z + 0.02: face_verts.append(v.index)
            if not under_shirt(p, (mw.to_3x3() @ v.normal).normalized()):
                gone.add(v.index)
    our_tone = _avg_skin(body, diffuse_of(body.data.materials[0]), face_verts)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if any(v.index in gone for v in f.verts)], context='FACES')
    bm.to_mesh(body.data); bm.free()

    # the donor: keep his head parts; of his body keep the head and the neck down into the collar (narrow, so his shoulders don't
    # poke through our shirt)
    prefix = _bone(body_rig, 'Head').name.split(':')[0] + ':'
    heads, their_tone = [], None
    for name, o in dmeshes.items():
        part = name.split('_')[-1]
        if part not in HEAD_PARTS:
            bpy.data.objects.remove(o, do_unlink=True); continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        ow = o.matrix_world
        drop = []
        face = []
        for v in bm.verts:
            p = place @ (ow @ v.co)
            r = (Vector((p.x, p.y)) - axis_xy).length
            keep = p.z > neck_base.z + 0.04 or (p.z > neck_base.z - 0.045 and r < 0.075)
            if not keep: drop.append(v)
            elif part == 'Body' and p.z > bh.z + 0.02: face.append(v.index)
        if part == 'Body':
            their_tone = _avg_skin(o, diffuse_of(o.data.materials[0]), face)
        bmesh.ops.delete(bm, geom=drop, context='VERTS')
        # move the kept geometry into our frame: world position after placing, expressed in the footballer body's object space
        tf = mw.inverted() @ place @ ow
        for v in bm.verts: v.co = tf @ v.co
        bm.to_mesh(o.data); bm.free()
        o.parent = body_rig; o.matrix_world = mw.copy()
        for m in o.modifiers:
            if m.type == 'ARMATURE': m.object = body_rig
        for vg in o.vertex_groups:
            vg.name = prefix + vg.name.split(':')[-1]
        o.name = 'Head_' + part
        heads.append(o)
    bpy.data.objects.remove(drig, do_unlink=True)
    body_rig.data.pose_position = 'POSE'
    bpy.context.view_layer.update()
    tint = np.clip(their_tone / np.maximum(our_tone, 1e-3), 0.2, 2.5) if their_tone is not None else np.ones(3)
    print('HEADSWAP kept', [h.name for h in heads], 'tone ours', our_tone.round(3), 'theirs', None if their_tone is None else their_tone.round(3), 'tint', tint.round(3))
    return heads, tuple(float(c) for c in tint)
