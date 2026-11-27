# V2 faces: dresses a scanned Mixamo head (headswap.py) so it matches a player's site portrait (js/portrait.js): skin tone, hair style
# and colour as strand hair (hairgen.py), and beard. The traits come from v2/faces/traits.mjs (the same picks portrait.js makes).
# Used by render_hero.py --traits <player.json>.
import bpy, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import hairgen

# The portrait's flat skin colours (js/portrait.js SKIN) as believable skin albedo (sRGB 0-255, the median of a face texture): the
# same order from light to dark, the last one the East Asian tone.
SKIN_REAL = {'#f6d5bd': (206, 160, 138), '#eab98f': (190, 140, 108), '#d19a6c': (166, 116, 82), '#b07548': (136, 90, 60),
             '#8a5530': (106, 68, 45), '#5e3a22': (72, 46, 31), '#f0cfa5': (200, 158, 124)}
# portrait hair colours -> hair BSDF melanin, redness, and a flat colour for the scalp under the strands (sRGB 0-1)
HAIR_COL = {'#1d1d22': (1.0, 0.05, (0.02, 0.018, 0.018)), '#3b2a20': (0.93, 0.12, (0.045, 0.03, 0.022)),
            '#6b4528': (0.62, 0.32, (0.12, 0.075, 0.045)), '#8e3b1f': (0.5, 0.75, (0.2, 0.08, 0.04)),
            '#d9b45a': (0.2, 0.32, (0.5, 0.4, 0.22)), '#c4521e': (0.42, 1.0, (0.36, 0.13, 0.05))}

def srgb_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def tint_to(skin_hex, measured_srgb):
    """multiplier (linear RGB, for the shader) that turns a texture whose median is measured_srgb into the portrait's skin tone"""
    target = srgb_lin(np.array(SKIN_REAL.get(skin_hex, SKIN_REAL['#eab98f'])) / 255)
    return tuple(float(x) for x in np.clip(target / np.maximum(srgb_lin(measured_srgb), 1e-4), 0.15, 4.0))

# hair styles in the head's own frame: comb = (side, back, up) weights, turned into world space per head
def _style(kind, mel, red, scalp):
    base = dict(melanin=mel, redness=red, root_r=0.00008, tip_r=0.00004, scalp=scalp, reach=0.05, hairline=0.012)
    S = {
        'buzz':     dict(count=170000, length=0.004, comb=(0, 0.6, 0.3), lift=0.75, curl=0, segs=4, root_r=0.00006, tip_r=0.00004),
        'short':    dict(count=150000, length=0.032, cut=(0.35, 0.015, 0.06), comb=(0, 1.0, 0.35), crown=True, comb_from_w=0.4, lift=0.3, curl=0.12, segs=8, volume=0.012),
        'sidepart': dict(count=150000, length=0.05, cut=(0.35, 0.015, 0.06), comb=(1.0, 0.35, 0.1), parting=True, lift=0.25, curl=0.05, segs=10, volume=0.013),
        'quiff':    dict(count=180000, length=0.06, cut=(0.12, 0.03, 0.07), comb=(0, 1.0, 0.45), lift=0.65, curl=0.05, segs=14, volume=0.018),
        'fringe':   dict(count=150000, length=0.055, cut=(0.4, 0.03, 0.08), comb=(0, -1.0, -0.2), crown=True, comb_from_w=0.6, lift=0.2, curl=0, segs=12, volume=0.012),
        'curly':    dict(count=150000, length=0.03, comb=(0, 0.3, 0.6), lift=0.6, curl=2.2, segs=9, volume=0.018),
        'afro':     dict(count=170000, length=0.06, comb=(0, 0.2, 0.8), lift=0.9, curl=3.0, segs=10, volume=0.045, reach=0.08),
        'hightop':  dict(count=170000, length=0.06, cut=(0.08, 0.05, 0.09), comb=(0, 0.0, 1.0), lift=1.0, curl=2.5, segs=9, volume=0.04, top_only=True),
        'twists':   dict(count=150000, length=0.05, comb=(0, 0.3, 0.7), lift=0.6, curl=1.2, segs=10, volume=0.025),
    }[kind]
    base.update(S); return base

def _scalp_mask(body, hair_mesh, reach=0.05):
    """per vertex of the face mesh, 0..1: how much it sits under the donor's hair (soft at the edge), stored as attribute 'scalp'"""
    dg = bpy.context.evaluated_depsgraph_get()
    hv, _, ht = hairgen._eval_mesh(hair_mesh)
    tree = BVHTree.FromPolygons([tuple(v) for v in hv], [tuple(t) for t in ht])
    subd = [m for m in body.modifiers if m.type == 'SUBSURF']
    for m in subd: m.show_viewport = False            # measure on the mesh's own vertices (the attribute lives on them)
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg); me = ev.to_mesh(); mw = body.matrix_world
    hit = np.array([tree.ray_cast(mw @ v.co - (mw.to_3x3() @ v.normal).normalized() * 0.002, (mw.to_3x3() @ v.normal).normalized(), reach)[0] is not None
                    for v in me.vertices], float)
    ev.to_mesh_clear()
    for m in subd: m.show_viewport = True
    # soften: two passes of neighbour averaging over the mesh edges
    edges = np.array([tuple(e.vertices) for e in body.data.edges])
    for _ in range(3):
        acc = hit.copy(); cnt = np.ones(len(hit))
        np.add.at(acc, edges[:, 0], hit[edges[:, 1]]); np.add.at(acc, edges[:, 1], hit[edges[:, 0]])
        np.add.at(cnt, edges[:, 0], 1); np.add.at(cnt, edges[:, 1], 1)
        hit = acc / cnt
    a = body.data.attributes.get('scalp') or body.data.attributes.new('scalp', 'FLOAT', 'POINT')
    a.data.foreach_set('value', np.clip(hit * 1.4, 0, 1).astype(np.float32))
    return hit

def _paint_scalp(mat, colour, strength=1.0, attr='scalp', breakup=0.0):
    """over the face material's albedo, paint the scalp (attribute 'scalp') in one colour: the skin for a shaved head, the hair's own
    colour under strands, so the donor's painted hair never shows through"""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    src = b.inputs['Base Color'].links[0].from_socket
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = attr
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 60
    jitter = nt.nodes.new('ShaderNodeMix'); jitter.data_type = 'RGBA'; jitter.blend_type = 'MULTIPLY'; jitter.inputs['Factor'].default_value = 0.12
    jitter.inputs[6].default_value = (*colour, 1); nt.links.new(noise.outputs['Color'], jitter.inputs[7])
    k = nt.nodes.new('ShaderNodeMath'); k.operation = 'MULTIPLY'; k.inputs[1].default_value = strength
    if breakup:   # a ragged, hair-like edge instead of the mesh's polygon outline: the mask plus fine noise, clipped
        bn = nt.nodes.new('ShaderNodeTexNoise'); bn.inputs['Scale'].default_value = 900; bn.inputs['Detail'].default_value = 4
        mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.0; mr.inputs['From Max'].default_value = 1.0
        ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'MULTIPLY_ADD'; ad.inputs[1].default_value = breakup
        sub = nt.nodes.new('ShaderNodeMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = breakup * 0.5
        nt.links.new(bn.outputs['Fac'], ad.inputs[0]); nt.links.new(at.outputs['Fac'], ad.inputs[2])
        nt.links.new(ad.outputs[0], sub.inputs[0]); nt.links.new(sub.outputs[0], mr.inputs['Value'])
        nt.links.new(mr.outputs[0], k.inputs[0])
    else:
        nt.links.new(at.outputs['Fac'], k.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    nt.links.new(k.outputs[0], mix.inputs['Factor']); nt.links.new(src, mix.inputs[6]); nt.links.new(jitter.outputs[2], mix.inputs[7])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])

def _frame(fwd):
    up = Vector((0, 0, 1)); f = Vector(fwd).normalized(); side = f.cross(up).normalized()
    return side, -f, up      # side, back, up

def _soften(body, val, passes=3):
    edges = np.array([tuple(e.vertices) for e in body.data.edges])
    for _ in range(passes):
        acc = val.copy(); cnt = np.ones(len(val))
        np.add.at(acc, edges[:, 0], val[edges[:, 1]]); np.add.at(acc, edges[:, 1], val[edges[:, 0]])
        np.add.at(cnt, edges[:, 0], 1); np.add.at(cnt, edges[:, 1], 1)
        val = acc / cnt
    return val

def _own_verts(body):
    """the face mesh's own vertices (no subdivision) in world space, posed"""
    subd = [m for m in body.modifiers if m.type == 'SUBSURF']
    for m in subd: m.show_viewport = False
    bpy.context.view_layer.update()
    v, n, t = hairgen._eval_mesh(body)
    for m in subd: m.show_viewport = True
    bpy.context.view_layer.update()
    return v, n, t

def _beard_region(verts, eyes, fwd, kind):
    """beard regions measured from the nose tip (the face's most forward point below the eyes), in the head's frame (metres)"""
    side, back, up = (np.array(v) for v in _frame(fwd))
    rel = verts - np.array(eyes)
    near = np.linalg.norm(rel, axis=1) < 0.13
    zc = rel @ up
    cand = near & (zc < -0.02) & (zc > -0.08)
    N = verts[cand][np.argmin((rel[cand] @ back))]      # most forward = least 'back'
    r = verts - N
    x, y, z = r @ side, r @ back, r @ up; ax = np.abs(x)
    front = (y < 0.075) & (np.linalg.norm(rel, axis=1) < 0.16)
    nose = (ax < 0.024) & (z > -0.016)
    lips = (ax < 0.027) & (z < -0.022) & (z > -0.05) & (y < 0.03)
    cheek_line = z < (-0.022 + 0.9 * np.maximum(0, ax - 0.03))
    under = (z < -0.07) & (y > 0.035)                 # under the chin and jaw, toward the throat
    jaw = front & cheek_line & (z > -0.1) & (ax < 0.078) & (z < 0.02) & ~nose & ~under
    lip_top = front & (ax < 0.032) & (z < -0.012) & (z > -0.026)
    chin = front & (ax < 0.034) & (z < -0.048) & (z > -0.1) & ~under
    print('NOSE TIP', tuple(round(c, 3) for c in N))
    return {'stubble': jaw & ~lips, 'beard': (jaw | lip_top) & ~lips, 'goatee': (chin | lip_top) & ~lips, 'moustache': lip_top & ~lips}[kind]

def _beard(body, eyes, fwd, kind, mel, red, face_mat, hair_rgb, skin_rgb, seed=3):
    """facial hair: a shadow painted into the skin (attribute 'beard'), plus strands for anything longer than stubble"""
    if kind == 'none': return None
    rng = np.random.default_rng(seed)
    ov, _, _ = _own_verts(body)
    reg = _beard_region(ov, eyes, fwd, kind).astype(float)
    print('BEARD', kind, 'region verts', int(reg.sum()))
    soft = _soften(body, reg, 4)
    a = body.data.attributes.get('beard') or body.data.attributes.new('beard', 'FLOAT', 'POINT')
    a.data.foreach_set('value', np.clip(soft * 1.3, 0, 1).astype(np.float32))
    # the shadow of hair under the skin: the skin itself, darkened and pulled toward the hair colour, laid on lightly
    shadow = tuple(float(c) for c in srgb_lin(np.array(skin_rgb) * 0.5 + np.array(hair_rgb) * 0.35))
    _paint_scalp(face_mat, shadow, {'stubble': 0.4, 'beard': 0.55, 'goatee': 0.5, 'moustache': 0.5}[kind], 'beard', 0.6)
    if kind == 'stubble': return None
    verts, normals, tris = hairgen._eval_mesh(body)          # subdivided: smoother roots
    reg2 = _beard_region(verts, eyes, fwd, kind)
    rt = hairgen._region_tris(verts, tris, reg2)
    print('BEARD', kind, 'tris', len(rt))
    if not len(rt): return None
    side, back, up = _frame(fwd)
    n = {'beard': 32000, 'goatee': 12000, 'moustache': 5000}[kind]   # a real beard: ~150 hairs per cm2
    roots, nr = hairgen._sample(verts, normals, rt, n, rng)
    # thin out toward the edges (a real beard fades on the cheeks and neck), by the softened mask at the nearest own vertex
    from mathutils.kdtree import KDTree
    kd = KDTree(len(ov))
    for i, v in enumerate(ov): kd.insert(Vector(v), i)
    kd.balance()
    dens = np.array([soft[kd.find(Vector(r))[1]] for r in roots])
    keep = rng.random(len(roots)) < np.clip(dens, 0, 1) ** 1.6
    roots, nr = roots[keep], nr[keep]; n = len(roots)
    down = np.tile(np.array(-up * 1.0 + back * 0.15), (n, 1))
    surf = BVHTree.FromPolygons([tuple(v) for v in verts], [tuple(t) for t in tris])
    pts = hairgen._grow(roots + nr * 0.0003, nr, 0.01, down, 0.55, 0.9, 6, rng, 0.0, surf, 0.006)
    mat = hairgen.hair_material(body.name + '_beard', mel, red, 0.4)
    return hairgen._curves(body.name + '_beard', pts, 0.00007, 0.00003, mat)

def _neck_mask(body, eyes, fwd):
    """attribute 'neck': 1 on the neck below the jaw line, fading in over 2 cm, 0 on the face"""
    ov, _, _ = _own_verts(body)
    side, back, up = (np.array(v) for v in _frame(fwd))
    rel = ov - np.array(eyes); zc = rel @ up
    cand = (np.linalg.norm(rel, axis=1) < 0.13) & (zc < -0.02) & (zc > -0.08)
    N = ov[cand][np.argmin(rel[cand] @ back)]
    r = ov - N; y, z = r @ back, r @ up
    # the jaw line runs from the chin (about 8 cm under the nose tip) up and back toward the ear
    jaw_z = -0.085 + 0.45 * np.clip(y - 0.02, 0, 0.12)
    v = np.clip((jaw_z - z) / 0.02, 0, 1)
    a = body.data.attributes.get('neck') or body.data.attributes.new('neck', 'FLOAT', 'POINT')
    a.data.foreach_set('value', _soften(body, v, 2).astype(np.float32))

def _set_tint(mat, tint):
    n = next((n for n in mat.node_tree.nodes if n.label == 'TINT'), None)
    if n is not None: n.inputs[7].default_value = (*tint, 1)

def cheek_tone(body, eyes, fwd, img):
    """the face texture's colour on the cheeks (sRGB 0-1): skin only, no painted hair, brows or lips"""
    import headswap
    ov, _, _ = _own_verts(body)
    side, back, up = (np.array(v) for v in _frame(fwd))
    rel = ov - np.array(eyes); zc = rel @ up
    cand = (np.linalg.norm(rel, axis=1) < 0.13) & (zc < -0.02) & (zc > -0.08)
    N = ov[cand][np.argmin(rel[cand] @ back)]
    r = ov - N; x, y, z = r @ side, r @ back, r @ up; ax = np.abs(x)
    idx = np.where((ax > 0.028) & (ax < 0.058) & (z > -0.02) & (z < 0.012) & (y < 0.06))[0]
    t = headswap._avg_skin(body, img, set(int(i) for i in idx))
    print('CHEEKS', len(idx), 'verts, tone', np.round(t, 3))
    return t

def dress(traits, heads, eyes, fwd, face_mat, face_img=None, body=None, body_mat=None, body_tone=None, seed=1):
    """heads: headswap's objects by part (Head_Body, Head_Hair, Head_Beard, ...). Replaces the donor's hair and beard with the
    portrait's, and paints the scalp. Returns the new objects."""
    H = {o.name.split('_', 1)[1]: o for o in heads}
    body, hair_mesh = H['Body'], H.get('Hair')
    for part in ('Beard', 'Moustache', 'Mustache'):
        if part in H: H[part].hide_render = True; H[part].hide_viewport = True
    mel, red, scalp_col = HAIR_COL.get(traits['hairC'], HAIR_COL['#1d1d22'])
    skin = tuple(float(c) for c in srgb_lin(np.array(SKIN_REAL[traits['skin']]) / 255 * 0.9))   # a touch under the face's tone: the neck sits in the jaw's shade
    made = []
    if face_img is not None:   # skin: tint the face from its measured cheek colour, the footballer's body from its hands
        _set_tint(face_mat, tint_to(traits['skin'], cheek_tone(body, eyes, fwd, face_img)))
    if body_mat is not None and body_tone is not None:
        _set_tint(body_mat, tint_to(traits['skin'], body_tone))
    _neck_mask(body, eyes, fwd)
    _paint_scalp(face_mat, skin, 1.0, 'neck')   # the donor's neck under his own collar is baked dark: paint it in skin
    if hair_mesh is not None:
        _scalp_mask(body, hair_mesh)
        if traits['hair'] == 'bald':
            _paint_scalp(face_mat, skin)
        else:
            _paint_scalp(face_mat, tuple(float(c) for c in srgb_lin(scalp_col)), 0.95)
            st = _style(traits['hair'], mel, red, None)
            side, back, up = _frame(fwd)
            c = st['comb']; comb = side * c[0] + back * c[1] + up * c[2]
            st['comb'] = tuple(comb)
            crown = Vector(eyes) + back * 0.09 + up * 0.1
            if st.pop('crown', False): st['comb_from'] = tuple(crown)
            if st.pop('parting', False): st['comb_from'] = tuple(Vector(eyes) + side * -0.045 + up * 0.11); st['comb_from_w'] = 0.8
            st.pop('top_only', None)
            if 'cut' in st:
                f, lo, hi = st.pop('cut'); st['len_profile'] = dict(eyes=tuple(eyes), up=(0, 0, 1), side=f, low=lo, high=hi)
            o = hairgen.scalp_hair(body, hair_mesh, st, seed)
            made.append(o)
        hair_mesh.hide_render = True; hair_mesh.hide_viewport = True
    b = _beard(body, eyes, fwd, traits['beard'], mel, red, face_mat, scalp_col, np.array(SKIN_REAL[traits['skin']]) / 255)
    if b: made.append(b)
    return made
