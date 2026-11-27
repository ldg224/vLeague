# V2: strand hair for the MakeHuman faces (build_faces.py). Real CG hair is tens of thousands of curves rooted in the scalp and shaded
# with a physically based hair BSDF (colour from melanin, as in real hair). MakeHuman's own hair mesh is used only to find the scalp:
# body faces close to it get roots; the mesh itself is then hidden.
import bpy, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def _eval_mesh(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    mw = obj.matrix_world
    verts = np.array([tuple(mw @ v.co) for v in me.vertices])
    normals = np.array([tuple((mw.to_3x3() @ v.normal).normalized()) for v in me.vertices])
    tris = []
    me.calc_loop_triangles()
    for t in me.loop_triangles: tris.append(tuple(t.vertices))
    ev.to_mesh_clear()
    return verts, normals, np.array(tris)

def _region_tris(verts, tris, keep):
    """triangles whose three corners pass keep (a bool per vertex)"""
    return tris[keep[tris].all(axis=1)]

def _sample(verts, normals, tris, n, rng):
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    pick = rng.choice(len(tris), size=n, p=area / area.sum())
    u, v = rng.random(n), rng.random(n); flip = u + v > 1; u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    w = 1 - u - v
    p = a[pick] * w[:, None] + b[pick] * u[:, None] + c[pick] * v[:, None]
    nn = normals[tris[pick, 0]] * w[:, None] + normals[tris[pick, 1]] * u[:, None] + normals[tris[pick, 2]] * v[:, None]
    nn /= np.linalg.norm(nn, axis=1)[:, None]
    return p, nn

def _grow(roots, normals, length, comb, lift, curl, segs, rng, gravity=0.0, surface=None, volume=0.0):
    """strands: start along the normal, bend toward the comb direction (kept on the scalp's tangent plane), with a little curl."""
    n = len(roots); pts = np.zeros((n, segs, 3)); pts[:, 0] = roots
    L = length * (0.75 + 0.5 * rng.random(n))
    c = comb - (comb * normals).sum(1)[:, None] * normals; c /= np.maximum(np.linalg.norm(c, axis=1), 1e-6)[:, None]
    phase = rng.random(n) * 6.28
    layer = 0.35 + 0.65 * rng.random(n)   # strands sit at different depths in the hair
    side = np.cross(normals, c)
    for k in range(1, segs):
        t = k / (segs - 1)
        d = normals * (lift * (1 - t)) + c * (1 - lift * (1 - t))
        if curl:
            ang = phase + t * curl * 6.28
            d = d + (side * np.cos(ang)[:, None] + normals * np.sin(ang)[:, None]) * 0.6
        d[:, 2] -= gravity * t
        d += rng.normal(0, 0.05, (n, 3))
        d /= np.linalg.norm(d, axis=1)[:, None]
        pts[:, k] = pts[:, k - 1] + d * (L / (segs - 1))[:, None]
        if surface is not None:
            # a cut style hugs the head: pull each point back to a height over the scalp that grows along the strand
            h = volume * layer * math.sqrt(t) + 0.0006
            for i in range(n):
                q = surface.find_nearest(Vector(pts[i, k]))
                if q[0] is not None:
                    pts[i, k] = np.array(q[0] + q[1] * h[i]) if True else pts[i, k]
    return pts

def _curves(name, pts, root_r, tip_r, material):
    n, segs, _ = pts.shape
    hc = bpy.data.hair_curves.new(name)
    hc.add_curves([segs] * n)
    hc.position_data.foreach_set('vector', pts.reshape(-1).astype(np.float32))
    rad = hc.attributes.new('radius', 'FLOAT', 'POINT') if 'radius' not in hc.attributes else hc.attributes['radius']
    t = np.tile(np.linspace(0, 1, segs), n)
    rad.data.foreach_set('value', (root_r + (tip_r - root_r) * t).astype(np.float32))
    hc.materials.append(material)
    o = bpy.data.objects.new(name, hc); bpy.context.scene.collection.objects.link(o)
    return o

def hair_material(name, melanin, redness, roughness=0.32):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); h = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    h.parametrization = 'MELANIN'
    h.inputs['Melanin'].default_value = melanin; h.inputs['Melanin Redness'].default_value = redness
    h.inputs['Roughness'].default_value = roughness
    if 'Random Color' in h.inputs: h.inputs['Random Color'].default_value = 0.08
    if 'Random Roughness' in h.inputs: h.inputs['Random Roughness'].default_value = 0.15
    # per-strand variation in melanin, as real hair is never one colour
    info = nt.nodes.new('ShaderNodeHairInfo')
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = melanin * 0.85; mr.inputs['To Max'].default_value = min(1, melanin * 1.1)
    nt.links.new(info.outputs['Random'], mr.inputs['Value']); nt.links.new(mr.outputs['Result'], h.inputs['Melanin'])
    nt.links.new(h.outputs[0], out.inputs['Surface'])
    return m

def scalp_hair(body, hair_mesh, style, seed=1):
    """style: dict(count, length, comb (x,y,z), lift, curl, segs, melanin, redness, root_r, tip_r, gravity, margin)"""
    rng = np.random.default_rng(seed)
    verts, normals, tris = _eval_mesh(body)
    hv, _, ht = _eval_mesh(hair_mesh)
    tree = BVHTree.FromPolygons([tuple(v) for v in hv], [tuple(t) for t in ht])
    reach = style.get('reach', 0.06)
    near = np.array([tree.ray_cast(Vector(v) - Vector(nv) * 0.002, Vector(nv), reach)[0] is not None for v, nv in zip(verts, normals)])
    rt = _region_tris(verts, tris, near)
    print('HAIR region tris', len(rt))
    roots, nr = _sample(verts, normals, rt, style['count'], rng)
    # a soft hairline: near the region's edge, strands thin out (as on a real head), so there's no hard painted line
    edge_v = np.zeros(len(verts), bool)
    for t in tris[(near[tris].sum(axis=1) > 0) & (near[tris].sum(axis=1) < 3)]: edge_v[t] = True
    ev = verts[edge_v]
    if len(ev):
        etree = BVHTree.FromPolygons([tuple(v) for v in ev], [(i, i, i) for i in range(len(ev))]) if False else None
        from mathutils.kdtree import KDTree
        kd = KDTree(len(ev))
        for i, v in enumerate(ev): kd.insert(Vector(v), i)
        kd.balance()
        dist = np.array([kd.find(Vector(r))[2] for r in roots])
        soft = style.get('hairline', 0.012)
        keep = rng.random(len(roots)) < np.clip(dist / soft, 0.15, 1.0)
        roots, nr = roots[keep], nr[keep]
    # a scalp layer coloured like the hair, kept about 1 cm inside the hairline (strands alone make the edge), so gaps between
    # strands show hair colour, not bare skin
    if style.get('scalp') and len(ev):
        vd = np.array([kd.find(Vector(v))[2] if near[i] else 0.0 for i, v in enumerate(verts)])
        inner = rt[(vd[rt] > style.get('scalp_inset', 0.01)).all(axis=1)]
        used = np.unique(inner); remap = {int(v): i for i, v in enumerate(used)}
        cv = verts[used] + normals[used] * 0.0005
        me = bpy.data.meshes.new(body.name + '_scalp'); me.from_pydata(cv.tolist(), [], [[remap[int(a)] for a in t] for t in inner])
        for pl in me.polygons: pl.use_smooth = True
        sm = bpy.data.materials.new(body.name + '_scalp'); sm.use_nodes = True; b = sm.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*style['scalp'], 1); b.inputs['Roughness'].default_value = 0.6
        me.materials.append(sm)
        so = bpy.data.objects.new(body.name + '_scalp', me); bpy.context.scene.collection.objects.link(so)
    roots = roots + nr * 0.0004
    length = style['length']
    if style.get('len_profile'):   # a cut: long on top, short at the sides and back (height over the eyes, in metres)
        lp = style['len_profile']; h = (roots - np.array(lp['eyes'])) @ np.array(lp['up'])
        length = style['length'] * (lp['side'] + (1 - lp['side']) * np.clip((h - lp['low']) / (lp['high'] - lp['low']), 0, 1))
    comb = np.tile(np.array(style['comb'], dtype=float), (len(roots), 1))
    if style.get('comb_from'):   # comb away from a point (a crown or a parting)
        d = roots - np.array(style['comb_from']); d[:, 2] *= style.get('comb_from_z', 0.3)
        comb = comb + d / np.linalg.norm(d, axis=1)[:, None] * style.get('comb_from_w', 1.0)
    surf = BVHTree.FromPolygons([tuple(v) for v in verts], [tuple(t) for t in tris]) if style.get('volume') else None
    pts = _grow(roots, nr, length, comb, style['lift'], style['curl'], style['segs'], rng, style.get('gravity', 0.0), surf, style.get('volume', 0.0))
    mat = hair_material(body.name + '_hair', style['melanin'], style['redness'], style.get('roughness', 0.32))
    hair_mesh.hide_render = True; hair_mesh.hide_viewport = True
    return _curves(body.name + '_strands', pts, style['root_r'], style['tip_r'], mat)

def stubble(body, eyes_center, melanin, redness, count=110000, length=0.0016, seed=2):
    """short beard shadow on the jaw, chin, cheeks below the cheekbone and upper lip; lips left clear"""
    rng = np.random.default_rng(seed)
    verts, normals, tris = _eval_mesh(body)
    E = np.array(eyes_center)
    rel = verts - E
    front = rel[:, 1] < 0.045
    z = rel[:, 2]; ax = np.abs(rel[:, 0])
    jaw = front & (z < -0.055) & (z > -0.175) & (ax < 0.075)
    cheek_line = z < (-0.055 - 0.25 * np.maximum(0, 0.06 - ax))      # the beard line rises toward the sideburns
    lips = (ax < 0.03) & (z > -0.112) & (z < -0.072) & (rel[:, 1] < -0.06)
    neck_front = (z < -0.13) & (rel[:, 1] > -0.02)                    # under the jaw, toward the throat: stop
    keep = jaw & cheek_line & ~lips & ~neck_front
    rt = _region_tris(verts, tris, keep)
    print('STUBBLE region tris', len(rt))
    if not len(rt): return None
    # beard shadow: the skin under real stubble is darkened by the hairs below the surface; a thin see-through layer does that
    used = np.unique(rt); remap = {int(v): i for i, v in enumerate(used)}
    me = bpy.data.meshes.new(body.name + '_beardshadow'); me.from_pydata((verts[used] + normals[used] * 0.0002).tolist(), [], [[remap[int(a)] for a in t] for t in rt])
    for pl in me.polygons: pl.use_smooth = True
    sm = bpy.data.materials.new('beardshadow'); sm.use_nodes = True; b = sm.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.02, 0.016, 0.014, 1); b.inputs['Alpha'].default_value = 0.38; b.inputs['Roughness'].default_value = 0.7
    me.materials.append(sm); so = bpy.data.objects.new(body.name + '_beardshadow', me); bpy.context.scene.collection.objects.link(so)
    roots, nr = _sample(verts, normals, rt, count, rng)
    pts = _grow(roots, nr, length, np.tile([0, 0, -1.0], (count, 1)), 0.6, 0, 3, rng)
    mat = hair_material(body.name + '_stubble', melanin, redness, 0.45)
    return _curves(body.name + '_stubble', pts, 0.00005, 0.00003, mat)
