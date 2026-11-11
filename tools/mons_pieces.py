"""The Super Metal Mons figures for B-10 (src/pieces.js): 3D-print STLs (millimetres, Z up, on their stamp bases,
a million or more triangles each) cut down to a few thousand triangles, stood up (Y up, facing +z, base on y = 0,
centred), scaled to stand in one of the board's squares, and packed into one small model:
assets/mons/pieces.glb, a mesh per figure named 'mon-<name>' (positions and indices only: the game works out
smooth normals and gives each its glaze).

    python3 tools/mons_pieces.py <folder of STLs>     # (cut-down meshes are cached next to them, in _cut/)

Needs Blender as a Python module (`pip install bpy`), as tools/blender/kit.py does.
"""
import json, os, re, struct, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'mons', 'pieces.glb')
TRIS = 4500              # about this many triangles a figure
SCALE = 4.4              # metres per metre of the print (a 50 mm figure stands 22 cm)
MAX_W, MAX_H = 0.22, 0.30   # but none wider than this (a square is 2.9 / 11 = 0.264 m) or taller


def name_of(path):
    n = os.path.basename(path)[:-4]
    n = re.sub(r'\s*w(ith)? stamp\s*$', '', n, flags=re.I)
    return re.sub(r'[^a-z0-9]+', '-', n.lower()).strip('-')


def cut(path):
    """A figure's triangles, cut down by Blender's decimate (fast-simplification's quadrics blow these up into
    spikes); each in its own Blender, one at a time (a 4M-triangle print takes ~5 GB). Cached in _cut/."""
    cache = os.path.join(os.path.dirname(path), '_cut', name_of(path) + '.npz')
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        subprocess.run([sys.executable, __file__, '--cut', path, cache], check=True)
    d = np.load(cache)
    return name_of(path), d['p'], d['f']


def blender_cut(src, dst):
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.stl_import(filepath=src)            # (it welds the corners as it reads)
    o = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = o
    m = o.modifiers.new('cut', 'DECIMATE')
    m.decimate_type, m.ratio, m.use_collapse_triangulate = 'COLLAPSE', min(1, TRIS / max(1, len(o.data.polygons))), True
    bpy.ops.object.modifier_apply(modifier='cut')
    me = o.data
    me.calc_loop_triangles()
    p = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', p)
    f = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get('vertices', f)
    np.savez(dst, p=p.reshape(-1, 3), f=f.reshape(-1, 3))


def stand(p):
    """millimetres, Z up -> metres, Y up, facing +z, base on y = 0, centred over its footprint, scaled to fit."""
    q = np.stack([p[:, 0], p[:, 2], -p[:, 1]], 1) / 1000.0
    lo, hi = q.min(0), q.max(0)
    q -= [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]
    w, h = max(hi[0] - lo[0], hi[2] - lo[2]), hi[1] - lo[1]
    return q * min(SCALE, MAX_W / w, MAX_H / h)


def write_glb(meshes, path):
    bins, views, accs, gl_meshes, nodes = bytearray(), [], [], [], []
    def add(arr, target, comp, ctype, kind, minmax=False):
        while len(bins) % 4:
            bins.append(0)
        views.append({'buffer': 0, 'byteOffset': len(bins), 'byteLength': arr.nbytes, 'target': target})
        bins.extend(arr.tobytes())
        a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': len(arr), 'type': kind}
        if minmax:
            a['min'], a['max'] = arr.min(0).tolist(), arr.max(0).tolist()
        accs.append(a)
        return len(accs) - 1
    for name, p, f in meshes:
        pos = add(p.astype(np.float32), 34962, 3, 5126, 'VEC3', True)
        idx = add(f.astype(np.uint16 if len(p) < 65536 else np.uint32).reshape(-1), 34963, 1, 5123 if len(p) < 65536 else 5125, 'SCALAR')
        gl_meshes.append({'name': f'mon-{name}', 'primitives': [{'attributes': {'POSITION': pos}, 'indices': idx}]})
        nodes.append({'name': f'mon-{name}', 'mesh': len(gl_meshes) - 1})
    j = {'asset': {'version': '2.0', 'generator': 'tools/mons_pieces.py'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
         'nodes': nodes, 'meshes': gl_meshes, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(bins)}]}
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    while len(bins) % 4:
        bins.append(0)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bins)) + struct.pack('<II', len(js), 0x4E4F534A) + js \
        + struct.pack('<II', len(bins), 0x004E4942) + bytes(bins)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(out)
    return len(out)


if __name__ == '__main__' and sys.argv[1:2] == ['--cut']:
    blender_cut(sys.argv[2], sys.argv[3])
    sys.exit()

if __name__ == '__main__':
    src = sys.argv[1]
    files = sorted(os.path.join(src, f) for f in os.listdir(src) if f.lower().endswith('.stl'))
    got = [cut(f) for f in files]
    meshes = sorted((n, stand(p), f) for n, p, f in got)
    for n, p, f in meshes:
        sz = p.max(0) - p.min(0)
        print(f'{n:22s} {len(f):6d} tris  {sz[0]:.3f} x {sz[1]:.3f} x {sz[2]:.3f} m')
    print(OUT, write_glb(meshes, OUT) // 1024, 'KB')
