"""Hide chosen debris in the baked level without rebaking: their triangles (all three corners inside
a small footprint round each item, on the props/cardboard materials) become degenerate."""
import json, struct, sys, math
import numpy as np
glb_path, log_path = sys.argv[1], sys.argv[2]
items = []
for l in open(log_path):
    if not l.startswith('DEBRIS '): continue
    _, k, x, y, z = l.split(); x, y, z = float(x), float(y), float(z)
    if k == 'bag': items.append((x, y, z, 0.27, 0.14))
    if k == 'pizza' and math.hypot(x - 32.395, z - 19.881) < 0.05: items.append((x, y, z, 0.42, 0.4))
print('items', len(items))
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
C = np.array([[x, y, z] for x, y, z, _, _ in items]); R = np.array([r for *_, r, _ in items]); Y = np.array([h for *_, h in items])
total = 0
for mesh in j['meshes']:
    for p in mesh['primitives']:
        if mats[p['material']] not in ('props', 'cardboard'): continue
        pos, _, _ = view(p['attributes']['POSITION'])
        idx, off, dt = view(p['indices'])
        tri = idx.reshape(-1, 3).astype(np.int64)
        P = pos[tri]                                                     # (T,3,3)
        kill = np.zeros(len(tri), bool)
        for c, r, h in zip(C, R, Y):
            d = np.hypot(P[..., 0] - c[0], P[..., 2] - c[2])
            kill |= ((d < r) & (P[..., 1] < c[1] + h)).all(1)
        if kill.any():
            new = tri.copy(); new[kill] = new[kill][:, :1]
            b[off:off + new.size * dt.itemsize] = new.astype(dt).tobytes()
            total += int(kill.sum())
open(glb_path, 'wb').write(bytes(b))
print('triangles hidden', total)
