"""Prune and quantize a GLB without external tools.

Usage: python3 glbslim.py in.glb out.glb [--keep-regex RE] [--drop-regex RE]
                                         [--max-tex N] [--webp Q]

Nodes whose name matches --drop-regex (and do not match --keep-regex) are
removed with their whole subtree. Unused meshes/materials/textures/accessors
are dropped. Vertex attributes are quantized with KHR_mesh_quantization
(normals/tangents int8, UVs uint16 when in 0..1, joints uint8, weights uint8)
and textures are re-encoded as WebP (EXT_texture_webp). Node names, material
names and animations are kept, so code that looks parts up by name still works.
"""
import argparse, io, json, re, struct
import numpy as np
from PIL import Image

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def load(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    o, chunks = 12, []
    while o < len(b):
        l, t = struct.unpack_from('<II', b, o)
        chunks.append(b[o + 8:o + 8 + l])
        o += 8 + l
    return json.loads(chunks[0]), (chunks[1] if len(chunks) > 1 else b'')


def read_accessor(g, binary, i):
    a = g['accessors'][i]
    n, dt = NC[a['type']], np.dtype(CT[a['componentType']])
    if 'bufferView' in a:
        v = g['bufferViews'][a['bufferView']]
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = v.get('byteStride') or n * dt.itemsize
        raw = np.frombuffer(binary, np.uint8, count=(a['count'] - 1) * stride + n * dt.itemsize if a['count'] else 0, offset=off)
        if a['count']:
            rows = np.lib.stride_tricks.as_strided(raw, (a['count'], n * dt.itemsize), (stride, 1))
            arr = np.ascontiguousarray(rows).view(dt).reshape(a['count'], n)
        else:
            arr = np.zeros((0, n), dt)
    else:
        arr = np.zeros((a['count'], n), dt)
    if 'sparse' in a:
        s = a['sparse']
        iv, vv = g['bufferViews'][s['indices']['bufferView']], g['bufferViews'][s['values']['bufferView']]
        idx = np.frombuffer(binary, CT[s['indices']['componentType']], s['count'], iv.get('byteOffset', 0) + s['indices'].get('byteOffset', 0))
        val = np.frombuffer(binary, dt, s['count'] * n, vv.get('byteOffset', 0) + s['values'].get('byteOffset', 0)).reshape(-1, n)
        arr = arr.copy(); arr[idx] = val
    if a.get('normalized') and dt.kind in 'iu':
        info = np.iinfo(dt)
        arr = np.maximum(arr.astype(np.float32) / info.max, -1.0)
    return arr


class Writer:
    def __init__(self):
        self.chunks, self.size, self.views, self.accessors = [], 0, [], []

    def view(self, data, target=None, stride=None):
        pad = (-self.size) % 4
        if pad:
            self.chunks.append(b'\0' * pad); self.size += pad
        v = {'buffer': 0, 'byteOffset': self.size, 'byteLength': len(data)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        self.chunks.append(data); self.size += len(data)
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, arr, ctype, typ, normalized=False, target=None, stride=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        count, n = arr.shape
        data = arr.tobytes()
        if stride and stride != n * arr.dtype.itemsize:
            row = n * arr.dtype.itemsize
            padded = np.zeros((count, stride), np.uint8)
            padded[:, :row] = np.frombuffer(data, np.uint8).reshape(count, row)
            data = padded.tobytes()
        else:
            stride = None
        acc = {'bufferView': self.view(data, target, stride), 'componentType': ctype, 'count': count, 'type': typ}
        if normalized: acc['normalized'] = True
        if minmax:
            acc['min'] = [float(x) for x in arr.min(0)] if count else [0] * n
            acc['max'] = [float(x) for x in arr.max(0)] if count else [0] * n
            if arr.dtype.kind in 'iu':
                acc['min'] = [int(x) for x in acc['min']]; acc['max'] = [int(x) for x in acc['max']]
        self.accessors.append(acc)
        return len(self.accessors) - 1


def snorm8(v):
    return np.clip(np.round(v * 127), -127, 127).astype(np.int8)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('src'); p.add_argument('dst')
    p.add_argument('--keep-regex', default=None)
    p.add_argument('--drop-regex', default=None)
    p.add_argument('--max-tex', type=int, default=2048)
    p.add_argument('--webp', type=int, default=88)
    p.add_argument('--no-quantize', action='store_true')
    a = p.parse_args()
    g, binary = load(a.src)
    nodes = g.get('nodes', [])
    keep_re = re.compile(a.keep_regex) if a.keep_regex else None
    drop_re = re.compile(a.drop_regex) if a.drop_regex else None

    # ---- nodes -------------------------------------------------------------
    dropped = set()
    def drop_tree(i):
        dropped.add(i)
        for c in nodes[i].get('children', []): drop_tree(c)
    for i, n in enumerate(nodes):
        name = n.get('name', '')
        if drop_re and drop_re.search(name) and not (keep_re and keep_re.search(name)):
            drop_tree(i)
    joints = {j for s in g.get('skins', []) for j in s['joints']}
    assert not (dropped & joints), 'refusing to drop skeleton bones'
    node_map = {}
    for i in range(len(nodes)):
        if i not in dropped: node_map[i] = len(node_map)

    # ---- meshes / materials / textures --------------------------------------
    mesh_map, mat_map, tex_map, img_map, samp_map, skin_map = {}, {}, {}, {}, {}, {}
    for i in node_map:
        n = nodes[i]
        if 'mesh' in n and n['mesh'] not in mesh_map: mesh_map[n['mesh']] = len(mesh_map)
        if 'skin' in n and n['skin'] not in skin_map: skin_map[n['skin']] = len(skin_map)
    def tex_refs(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == 'index' and isinstance(v, int) and 'texCoord' in obj or (k == 'index' and isinstance(v, int)):
                    yield obj
                else:
                    yield from tex_refs(v)
        elif isinstance(obj, list):
            for v in obj: yield from tex_refs(v)
    for mi in mesh_map:
        for prim in g['meshes'][mi]['primitives']:
            if 'material' in prim and prim['material'] not in mat_map: mat_map[prim['material']] = len(mat_map)
    for mi in mat_map:
        for ref in tex_refs(g['materials'][mi]):
            t = ref['index']
            if t not in tex_map: tex_map[t] = len(tex_map)
    for ti in tex_map:
        t = g['textures'][ti]
        src = t.get('source', t.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))
        if src is not None and src not in img_map: img_map[src] = len(img_map)
        if 'sampler' in t and t['sampler'] not in samp_map: samp_map[t['sampler']] = len(samp_map)

    w = Writer()
    quant = not a.no_quantize
    used_quant = False
    acc_cache = {}

    def copy_accessor(i, kind=None):
        key = (i, kind)
        if key in acc_cache: return acc_cache[key]
        nonlocal used_quant
        src = g['accessors'][i]
        arr = read_accessor(g, binary, i)
        typ = src['type']
        if kind == 'indices':
            mx = int(arr.max()) if len(arr) else 0
            if mx < 65536:
                r = w.accessor(arr.astype(np.uint16), 5123, typ, target=34963)
            else:
                r = w.accessor(arr.astype(np.uint32), 5125, typ, target=34963)
        elif quant and kind in ('NORMAL', 'TANGENT'):
            f = arr.astype(np.float32)
            r = w.accessor(snorm8(f), 5120, typ, normalized=True, target=34962, stride=4); used_quant = True
        elif quant and kind and kind.startswith('TEXCOORD') and arr.dtype == np.float32 and len(arr) and arr.min() >= 0 and arr.max() <= 1:
            r = w.accessor(np.round(arr * 65535).astype(np.uint16), 5123, typ, normalized=True, target=34962); used_quant = True
        elif kind and kind.startswith('JOINTS'):
            mx = int(arr.max()) if len(arr) else 0
            r = w.accessor(arr.astype(np.uint8 if mx < 256 else np.uint16), 5121 if mx < 256 else 5123, typ, target=34962)
        elif quant and kind and kind.startswith('WEIGHTS'):
            f = arr.astype(np.float32)
            s = f.sum(1, keepdims=True); s[s == 0] = 1; f = f / s
            q = np.floor(f * 255).astype(np.int32)
            # distribute rounding remainder to the largest weight so rows sum to 255
            rem = 255 - q.sum(1)
            q[np.arange(len(q)), f.argmax(1)] += rem
            r = w.accessor(q.astype(np.uint8), 5121, typ, normalized=True, target=34962)
        elif quant and kind and kind.startswith('COLOR') and arr.dtype == np.float32 and len(arr) and arr.min() >= 0 and arr.max() <= 1:
            r = w.accessor(np.round(arr * 255).astype(np.uint8), 5121, typ, normalized=True, target=34962, stride=4 if typ == 'VEC3' else None)
        else:
            target = 34962 if kind not in (None, 'anim', 'ibm') else None
            dt = arr.dtype
            ct = {np.dtype(np.float32): 5126, np.dtype(np.uint16): 5123, np.dtype(np.uint8): 5121, np.dtype(np.int16): 5122, np.dtype(np.int8): 5120, np.dtype(np.uint32): 5125}[dt]
            stride = None
            if target and (NC[typ] * dt.itemsize) % 4: stride = ((NC[typ] * dt.itemsize + 3) // 4) * 4
            r = w.accessor(arr, ct, typ, normalized=src.get('normalized', False) and dt.kind in 'iu', target=target, stride=stride,
                           minmax=('min' in src or kind == 'POSITION'))
            if 'min' in src and kind != 'POSITION' and dt.kind == 'f':
                w.accessors[r]['min'], w.accessors[r]['max'] = src['min'], src['max']
        acc_cache[key] = r
        return r

    out = {'asset': {'version': '2.0', 'generator': 'glbslim (111k)'}}
    # meshes
    meshes = []
    for mi, _ in sorted(mesh_map.items(), key=lambda x: x[1]):
        m = json.loads(json.dumps(g['meshes'][mi]))
        for prim in m['primitives']:
            prim['attributes'] = {k: copy_accessor(v, k) for k, v in prim['attributes'].items()}
            if 'indices' in prim: prim['indices'] = copy_accessor(prim['indices'], 'indices')
            if 'material' in prim: prim['material'] = mat_map[prim['material']]
            if 'targets' in prim:
                prim['targets'] = [{k: copy_accessor(v, 'target') for k, v in t.items()} for t in prim['targets']]
        meshes.append(m)
    # materials
    materials = []
    for mi, _ in sorted(mat_map.items(), key=lambda x: x[1]):
        m = json.loads(json.dumps(g['materials'][mi]))
        for ref in tex_refs(m): ref['index'] = tex_map[ref['index']]
        materials.append(m)
    # images -> webp
    images, ext_used = [], set(g.get('extensionsUsed', []))
    for ii, _ in sorted(img_map.items(), key=lambda x: x[1]):
        im = g['images'][ii]
        v = g['bufferViews'][im['bufferView']]
        raw = binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        pil = Image.open(io.BytesIO(raw))
        pil.load()
        if max(pil.size) > a.max_tex:
            s = a.max_tex / max(pil.size)
            pil = pil.resize((max(1, round(pil.width * s)), max(1, round(pil.height * s))), Image.LANCZOS)
        mode = 'RGBA' if pil.mode in ('RGBA', 'LA', 'P') and pil.convert('RGBA').getextrema()[3][0] < 255 else 'RGB'
        buf = io.BytesIO(); pil.convert(mode).save(buf, 'WEBP', quality=a.webp, method=6)
        data = buf.getvalue()
        if len(data) >= len(raw):  # keep original if WebP is not smaller
            images.append({'name': im.get('name', ''), 'mimeType': im['mimeType'], 'bufferView': w.view(raw)})
        else:
            images.append({'name': im.get('name', ''), 'mimeType': 'image/webp', 'bufferView': w.view(data)})
    textures = []
    for ti, _ in sorted(tex_map.items(), key=lambda x: x[1]):
        t = g['textures'][ti]
        src = t.get('source', t.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))
        nt = {}
        if 'sampler' in t: nt['sampler'] = samp_map[t['sampler']]
        if images[img_map[src]]['mimeType'] == 'image/webp':
            nt['extensions'] = {'EXT_texture_webp': {'source': img_map[src]}}
            ext_used.add('EXT_texture_webp')
        else:
            nt['source'] = img_map[src]
        if 'name' in t: nt['name'] = t['name']
        textures.append(nt)
    samplers = [g['samplers'][si] for si, _ in sorted(samp_map.items(), key=lambda x: x[1])]
    # skins
    skins = []
    for si, _ in sorted(skin_map.items(), key=lambda x: x[1]):
        s = dict(g['skins'][si])
        s['joints'] = [node_map[j] for j in s['joints']]
        if 'skeleton' in s: s['skeleton'] = node_map[s['skeleton']]
        if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = copy_accessor(s['inverseBindMatrices'], 'ibm')
        skins.append(s)
    # nodes
    out_nodes = []
    for i, _ in sorted(node_map.items(), key=lambda x: x[1]):
        n = dict(nodes[i])
        if 'children' in n:
            n['children'] = [node_map[c] for c in n['children'] if c in node_map]
            if not n['children']: del n['children']
        if 'mesh' in n: n['mesh'] = mesh_map[n['mesh']]
        if 'skin' in n: n['skin'] = skin_map[n['skin']]
        out_nodes.append(n)
    # animations
    anims = []
    for an in g.get('animations', []):
        chans = [c for c in an['channels'] if c['target'].get('node') in node_map]
        if not chans: continue
        used = sorted({c['sampler'] for c in chans})
        smap = {s: k for k, s in enumerate(used)}
        samplers_a = []
        for s in used:
            sm = dict(an['samplers'][s])
            sm['input'] = copy_accessor(sm['input'], 'anim')
            sm['output'] = copy_accessor(sm['output'], 'anim')
            samplers_a.append(sm)
        for c in chans:
            c['sampler'] = smap[c['sampler']]; c['target']['node'] = node_map[c['target']['node']]
        anims.append({**({'name': an['name']} if 'name' in an else {}), 'channels': chans, 'samplers': samplers_a})
    scenes = []
    for sc in g.get('scenes', []):
        scenes.append({**sc, 'nodes': [node_map[n] for n in sc['nodes'] if n in node_map]})

    out.update({k: v for k, v in {'scene': g.get('scene', 0), 'scenes': scenes, 'nodes': out_nodes, 'meshes': meshes,
                'materials': materials, 'textures': textures, 'images': images, 'samplers': samplers, 'skins': skins,
                'animations': anims, 'accessors': w.accessors, 'bufferViews': w.views}.items() if v != [] or k == 'scenes'})
    if used_quant: ext_used.add('KHR_mesh_quantization')
    ext_used -= {'KHR_draco_mesh_compression', 'EXT_meshopt_compression'}
    # only keep material extensions that are still referenced
    text = json.dumps(out['materials'] if materials else [])
    ext_used = {e for e in ext_used if e in ('KHR_mesh_quantization', 'EXT_texture_webp') or e in text}
    if ext_used: out['extensionsUsed'] = sorted(ext_used)
    req = sorted(e for e in ext_used if e in ('KHR_mesh_quantization', 'EXT_texture_webp'))
    if req: out['extensionsRequired'] = req
    binbytes = b''.join(w.chunks)
    binbytes += b'\0' * ((-len(binbytes)) % 4)
    out['buffers'] = [{'byteLength': len(binbytes)}]
    js = json.dumps(out, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binbytes)
    with open(a.dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binbytes), 0x004E4942)); f.write(binbytes)
    print(f'{a.src} -> {a.dst}: {total/1e6:.2f} MB, nodes {len(out_nodes)}, meshes {len(meshes)}, materials {len(materials)}, images {len(images)}')


if __name__ == '__main__':
    main()
