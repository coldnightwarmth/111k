"""Take the wall's underside out of each room doorway in the baked level without rebaking. It sat exactly
on the steel frame head's underside, so the two flickered against each other; the head covers it anyway.
Its triangles become degenerate (the bake's own fix in tools/props.py leaves the face out)."""
import json, struct, sys
import numpy as np
glb_path = sys.argv[1]
b = bytearray(open(glb_path, 'rb').read())
n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); bin0 = 20 + n + 8
CT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
def view(acc):
    a = j['accessors'][acc]; bv = j['bufferViews'][a['bufferView']]
    comp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    off = bin0 + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    dt = np.dtype(CT[a['componentType']])
    return np.frombuffer(b, dt, a['count'] * comp, off).reshape(a['count'], comp), off, dt
mats = [m['name'] for m in j['materials']]
def world(node):   # level nodes carry at most a translation
    assert 'rotation' not in node and 'scale' not in node and 'matrix' not in node
    return np.array(node.get('translation', [0, 0, 0]), float)
def tris(mesh_i, t):
    for p in j['meshes'][mesh_i]['primitives']:
        pos, _, _ = view(p['attributes']['POSITION'])
        idx, off, dt = view(p['indices'])
        tri = idx.reshape(-1, 3).astype(np.int64)
        yield p, pos.astype(float)[tri] + t, tri, off, dt
def down(P):
    nrm = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    return (nrm[:, 1] < 0) & (np.abs(nrm[:, [0, 2]]).max(1) < 1e-6 * np.abs(nrm[:, 1]).clip(1e-12)) | (
        (nrm[:, 1] < 0) & (np.hypot(nrm[:, 0], nrm[:, 2]) < 1e-4 * np.linalg.norm(nrm, axis=1)))
heads = []      # downward faces of the door frames (metal_grey), as triangles
for node in j['nodes']:
    if 'mesh' not in node: continue
    for p, P, *_ in tris(node['mesh'], world(node)):
        if mats[p['material']] != 'metal_grey': continue
        keep = down(P) & (np.ptp(P[..., 1], axis=1) < 1e-4) & (np.abs(P[:, 0, 1] - 2.5) < .002)
        heads += list(P[keep])
heads = np.array(heads); print('frame head faces', len(heads))
def inside(pt, T):   # xz point inside any xz triangle (with a hair of slack)
    a, b_, c = T[:, 0][:, [0, 2]], T[:, 1][:, [0, 2]], T[:, 2][:, [0, 2]]
    def s(u, v): return (v[:, 0] - u[:, 0]) * (pt[1] - u[:, 1]) - (v[:, 1] - u[:, 1]) * (pt[0] - u[:, 0])
    d1, d2, d3 = s(a, b_), s(b_, c), s(c, a)
    e = -1e-6
    return (((d1 >= e) & (d2 >= e) & (d3 >= e)) | ((d1 <= -e) & (d2 <= -e) & (d3 <= -e))).any()
total = 0
for node in j['nodes']:
    if 'mesh' not in node: continue
    for p, P, tri, off, dt in tris(node['mesh'], world(node)):
        m = mats[p['material']]
        if not (m.startswith('wall_') or m in ('tile_wall', 'office_wall')): continue
        cand = down(P) & (np.ptp(P[..., 1], axis=1) < 1e-4) & (np.abs(P[:, 0, 1] - 2.5) < .002)
        kill = np.zeros(len(tri), bool)
        for i in np.where(cand)[0]:
            near = heads[np.abs(heads[:, 0, 1] - P[i, 0, 1]) < .002]
            kill[i] = all(inside(v[[0, 2]], near) for v in list(P[i]) + [P[i].mean(0)])
        if kill.any():
            new = tri.copy(); new[kill] = new[kill][:, :1]
            b[off:off + new.size * dt.itemsize] = new.astype(dt).tobytes()
            total += int(kill.sum())
print('removed', total)
open(glb_path, 'wb').write(bytes(b))
