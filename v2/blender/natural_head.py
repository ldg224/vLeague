# V2 faces: settles a scanned Mixamo head (headswap.py) onto the footballer so the join can't be seen. The head keeps its own face,
# hair, beard and texture; this only makes the skin agree across the seam:
#   - the donor's neck below the jaw is painted in his own cheek colour, fading in over 2 cm (a scanned neck is baked dark where his
#     own collar or hood sat, which showed as a band or wedge above our shirt);
#   - the footballer's body (his neck down into the collar, and his hands) is tinted to that same cheek colour.
# Used by render_hero.py whenever --head is given.
import bpy
import numpy as np
from mathutils import Vector
import hairgen

def srgb_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def _frame(fwd):
    up = Vector((0, 0, 1)); f = Vector(fwd).normalized(); side = f.cross(up).normalized()
    return side, -f, up      # side, back, up

def _soften(mesh, val, passes=3):
    edges = np.array([tuple(e.vertices) for e in mesh.data.edges])
    for _ in range(passes):
        acc = val.copy(); cnt = np.ones(len(val))
        np.add.at(acc, edges[:, 0], val[edges[:, 1]]); np.add.at(acc, edges[:, 1], val[edges[:, 0]])
        np.add.at(cnt, edges[:, 0], 1); np.add.at(cnt, edges[:, 1], 1)
        val = acc / cnt
    return val

def _own_verts(obj):
    """the mesh's own vertices (no subdivision) in world space, posed"""
    subd = [m for m in obj.modifiers if m.type == 'SUBSURF']
    for m in subd: m.show_viewport = False
    bpy.context.view_layer.update()
    v, n, t = hairgen._eval_mesh(obj)
    for m in subd: m.show_viewport = True
    bpy.context.view_layer.update()
    return v, n, t

def _nose_frame(verts, eyes, fwd):
    """the nose tip (the face's most forward point below the eyes) and each vertex's offset from it in the head's frame (x across,
    y toward the back, z up; metres)"""
    side, back, up = (np.array(v) for v in _frame(fwd))
    rel = verts - np.array(eyes); zc = rel @ up
    cand = (np.linalg.norm(rel, axis=1) < 0.13) & (zc < -0.02) & (zc > -0.08)
    N = verts[cand][np.argmin(rel[cand] @ back)]
    r = verts - N
    return r @ side, r @ back, r @ up

def _paint(mat, colour, attr, strength=1.0):
    """over the material's albedo, lay one colour (with a little noise) where the vertex attribute says"""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    src = b.inputs['Base Color'].links[0].from_socket
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = attr
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 60
    jitter = nt.nodes.new('ShaderNodeMix'); jitter.data_type = 'RGBA'; jitter.blend_type = 'MULTIPLY'; jitter.inputs['Factor'].default_value = 0.1
    jitter.inputs[6].default_value = (*colour, 1); nt.links.new(noise.outputs['Color'], jitter.inputs[7])
    k = nt.nodes.new('ShaderNodeMath'); k.operation = 'MULTIPLY'; k.inputs[1].default_value = strength
    nt.links.new(at.outputs['Fac'], k.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    nt.links.new(k.outputs[0], mix.inputs['Factor']); nt.links.new(src, mix.inputs[6]); nt.links.new(jitter.outputs[2], mix.inputs[7])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])

def _set_tint(mat, tint):
    n = next((n for n in mat.node_tree.nodes if n.label == 'TINT'), None)
    if n is not None: n.inputs[7].default_value = (*tint, 1)

def _tone(obj, img, idx):
    import headswap
    return np.array(headswap._avg_skin(obj, img, set(int(i) for i in idx)))

def settle(heads, eyes, fwd, face_mat, face_img, body, body_mat, body_img, neck_base_z):
    """heads: headswap's objects (Head_Body, ...). body: the footballer's body mesh, its material and albedo image."""
    head = next(o for o in heads if o.name == 'Head_Body')
    hv, _, _ = _own_verts(head)
    x, y, z = _nose_frame(hv, eyes, fwd); ax = np.abs(x)
    cheeks = np.where((ax > 0.028) & (ax < 0.058) & (z > -0.02) & (z < 0.012) & (y < 0.06))[0]
    cheek = _tone(head, face_img, cheeks)                               # sRGB 0-1
    # the donor's neck: his cheek colour, a little darker (the neck sits in the jaw's shade), from the jaw line down
    jaw_z = -0.085 + 0.45 * np.clip(y - 0.02, 0, 0.12)
    v = np.clip((jaw_z - z) / 0.02, 0, 1)
    a = head.data.attributes.get('neck') or head.data.attributes.new('neck', 'FLOAT', 'POINT')
    a.data.foreach_set('value', _soften(head, v, 2).astype(np.float32))
    neck_col = srgb_lin(cheek * 0.93)
    _paint(face_mat, tuple(float(c) for c in neck_col), 'neck')
    # the footballer: tint his whole skin so his own neck (what's left of it, under and above the collar) matches that neck colour
    bv, _, _ = _own_verts(body)
    hb = np.array(eyes)
    r = np.linalg.norm((bv - hb)[:, :2], axis=1)
    his_neck = np.where((bv[:, 2] > neck_base_z - 0.02) & (bv[:, 2] < neck_base_z + 0.07) & (r < 0.09))[0]
    ours = _tone(body, body_img, his_neck) if len(his_neck) > 20 else None
    if ours is not None:
        tint = np.clip(neck_col / np.maximum(srgb_lin(ours), 1e-4), 0.15, 4.0)
        _set_tint(body_mat, tuple(float(c) for c in tint))
    print('SETTLE cheek', np.round(cheek, 3), 'cheek verts', len(cheeks), 'his neck verts', len(his_neck), 'his tone', None if ours is None else np.round(ours, 3))
    return cheek
