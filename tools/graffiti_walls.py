"""Puts revised graffiti onto the walls without rebuilding the level: regenerates the level's graffiti pages
(tools/graffiti.py, which applies the reviewed revisions at the same sizes, so the layout and every
placement stay put), swaps them into assets/env/world.glb, and gives renamed pieces their new names in
assets/env/world.json. Refuses if the layout would move.

    python3 tools/graffiti_walls.py
"""
import io, json, os, re, struct, sys, time
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import graffiti as G   # noqa: E402

ENV = os.path.join(HERE, '..', 'assets', 'env')
DOORS = int(re.search(r'^DOORS = (\d+)', open(os.path.join(HERE, 'build_world.py')).read(), re.M).group(1))


def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    gl = json.loads(b[20:20 + jl])
    bl = struct.unpack('<I', b[20 + jl:24 + jl])[0]
    return gl, bytearray(b[28 + jl:28 + jl + bl])


def write_glb(path, gl, views):
    """views: the bytes of every buffer view, in order (packed again, 4-byte aligned)."""
    out = bytearray()
    for i, data in enumerate(views):
        while len(out) % 4:
            out.append(0)
        gl['bufferViews'][i]['byteOffset'] = len(out)
        gl['bufferViews'][i]['byteLength'] = len(data)
        out += data
    while len(out) % 4:
        out.append(0)
    gl['buffers'][0]['byteLength'] = len(out)
    js = json.dumps(gl, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)


if __name__ == '__main__':
    t = time.time()
    P = G.build_pieces(seed=11, stencils=G.world_stencils(DOORS))
    pages = G.pack_pages(P)
    meta_path = os.path.join(ENV, 'world.json')
    meta = json.load(open(meta_path))
    # the layout must be exactly the baked one: same page and patch for every piece
    rects = {n: (pi, rr['uv']) for pi, (_, r) in enumerate(pages) for n, rr in r.items()}
    rename = G.DISPLAY_NAMES
    back = {v: k for k, v in rename.items()}
    for p in meta['graffiti']:
        orig = back.get(p['name'], p['name'])
        pi, uv = rects[orig]
        assert pi == p['page'] and all(abs(a - b) < 1e-4 for a, b in zip(uv, p['uv'])), f'layout moved for {orig}'
        p['name'] = rename.get(orig, orig)
    glb = os.path.join(ENV, 'world.glb')
    gl, binary = read_glb(glb)
    views = [bytes(binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]) for v in gl['bufferViews']]
    done = 0
    for m in gl['materials']:
        k = re.fullmatch(r'graffiti_(\d+)', m['name'])
        if not k:
            continue
        tex = gl['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]
        img = gl['images'][tex.get('source', tex.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))]
        page = pages[int(k.group(1))][0]
        assert img['mimeType'] == 'image/webp'
        buf = io.BytesIO(); page.save(buf, 'WEBP', quality=88, alpha_quality=60, method=6)   # the size the baked pages had
        old = Image.open(io.BytesIO(views[img['bufferView']])).size
        assert old == page.size, (m['name'], old, page.size)
        views[img['bufferView']] = buf.getvalue()
        done += 1
    write_glb(glb, gl, views)
    json.dump(meta, open(meta_path, 'w'), separators=(',', ':'))
    print(f'{done} pages replaced, {len(rename)} renamed ({time.time() - t:.0f}s)')
