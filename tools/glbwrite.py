"""Write a level GLB in the format src/level.js expects.

Each material becomes one mesh with flat-shaded triangles, KHR_materials_unlit,
WebP base textures and (for lightmapped materials) a quantized TEXCOORD_1.
"""
import io, json, struct
import numpy as np


def write_glb(path, materials, webp_quality=86):
    """materials: list of dicts with
         name, image (PIL or None), color (rgb), alpha (None|'BLEND'|'MASK'), double (bool),
         lightmap (bool), emissive (bool),
         pos (n,3) float, nor (n,3), uv0 (n,2), uv1 (n,2) or None, idx (m,) int
       or, instead of the geometry keys, 'chunks': a list of dicts with those keys (one mesh each,
       all sharing the material, so the renderer can cull what is off screen)."""
    chunks, size, views, accessors = [], 0, [], []

    def add_view(data, target=None):
        nonlocal size
        pad = (-size) % 4
        if pad:
            chunks.append(b'\0' * pad); size += pad
        v = {'buffer': 0, 'byteOffset': size, 'byteLength': len(data)}
        if target:
            v['target'] = target
        chunks.append(data); size += len(data); views.append(v)
        return len(views) - 1

    def add_acc(arr, ctype, typ, normalized=False, target=34962, minmax=False):
        acc = {'bufferView': add_view(np.ascontiguousarray(arr).tobytes(), target), 'componentType': ctype,
               'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            acc['normalized'] = True
        if minmax:
            acc['min'] = [float(x) for x in arr.min(0)]; acc['max'] = [float(x) for x in arr.max(0)]
        accessors.append(acc)
        return len(accessors) - 1

    images, textures, mats, meshes, nodes, img_index = [], [], [], [], [], {}
    for m in materials:
        chunks_ = m.get('chunks') or [m]
        chunks_ = [c for c in chunks_ if len(c['idx'])]
        if not chunks_:
            continue
        mat = {'name': m['name'], 'pbrMetallicRoughness': {'baseColorFactor': list(m.get('color', (1, 1, 1))) + [1.0],
                                                             'metallicFactor': 0.0, 'roughnessFactor': 1.0},
               'extensions': {'KHR_materials_unlit': {}},
               'extras': {'lightmap': bool(m['lightmap']), 'emissive': bool(m['emissive']), **m.get('extras', {})}}
        if m.get('double'):
            mat['doubleSided'] = True
        if m.get('alpha') == 'BLEND':
            mat['alphaMode'] = 'BLEND'
        elif m.get('alpha'):
            mat['alphaMode'] = 'MASK'; mat['alphaCutoff'] = 0.5
        if m.get('image') is not None:
            key = id(m['image'])
            if key not in img_index:
                buf = io.BytesIO()
                m['image'].convert('RGBA' if m.get('alpha') else 'RGB').save(buf, 'WEBP', quality=webp_quality, method=6)
                images.append({'mimeType': 'image/webp', 'bufferView': add_view(buf.getvalue()), 'name': m['name']})
                textures.append({'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(images) - 1}}})
                img_index[key] = len(textures) - 1
            mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': img_index[key]}
        mats.append(mat)
        for ci, c in enumerate(chunks_):
            attrs = {'POSITION': add_acc(c['pos'].astype(np.float32), 5126, 'VEC3', minmax=True),
                     'TEXCOORD_0': add_acc(c['uv0'].astype(np.float32), 5126, 'VEC2')}
            if c.get('nor') is not None:  # unlit level geometry doesn't need them
                attrs['NORMAL'] = add_acc(c['nor'].astype(np.float32), 5126, 'VEC3')
            if m['lightmap'] and c.get('uv1') is not None:
                attrs['TEXCOORD_1'] = add_acc(np.round(np.clip(c['uv1'], 0, 1) * 65535).astype(np.uint16), 5123, 'VEC2',
                                              normalized=True)
            I = np.asarray(c['idx'])
            big = I.max() >= 65536
            iacc = add_acc(I.astype(np.uint32 if big else np.uint16), 5125 if big else 5123, 'SCALAR', target=34963)
            name = m['name'] if len(chunks_) == 1 else f"{m['name']}#{c.get('chunk', ci)}"
            meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': iacc, 'material': len(mats) - 1}]})
            nodes.append({'name': name, 'mesh': len(meshes) - 1})
    gl = {'asset': {'version': '2.0', 'generator': '111k blender pipeline'}, 'scene': 0,
          'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes, 'materials': mats,
          'accessors': accessors, 'bufferViews': views,
          'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
          'extensionsUsed': ['KHR_materials_unlit', 'KHR_mesh_quantization', 'EXT_texture_webp'],
          'extensionsRequired': ['KHR_mesh_quantization', 'EXT_texture_webp']}
    if images:
        gl['images'] = images; gl['textures'] = textures
    binbytes = b''.join(chunks); binbytes += b'\0' * ((-len(binbytes)) % 4)
    gl['buffers'] = [{'byteLength': len(binbytes)}]
    js = json.dumps(gl, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binbytes)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binbytes), 0x004E4942)); f.write(binbytes)
    return 28 + len(js) + len(binbytes)
