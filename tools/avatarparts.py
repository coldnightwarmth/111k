"""Split the cards.art avatar models into a small base and one file per trait.

The cards.art editor ships every wearable trait inside a few very large GLBs.
A visitor here only wears one hat, one shirt and so on, so each trait becomes its
own compressed file and the client fetches just the parts an avatar uses.

Usage: python3 tools/avatarparts.py /path/to/cardbinder [--only drifella|drilady] [--limit N]

Writes assets/avatars/<character>/base.glb, parts/<Drif_...>.glb and index.json.
Needs gltfpack (npm i -g gltfpack, or set GLTFPACK=/path/to/gltfpack).
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
from glbslim import load, subset, subtree

SOURCES = {
    'drifella': ['assets/models/drifmaker/drifella-customizable.glb', 'assets/models/drifmaker/drifella-collection-wave.glb'],
    'drilady': ['assets/models/drilady/drilady-base.glb', 'assets/models/drilady/drilady-archive.glb',
                'assets/models/drilady/drilady-collection-wave.glb', 'assets/models/drilady/drilady-bunny-study.glb'],
}
IN_BASE = re.compile(r'^Drif_(Body|Tail)(_|$)')
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'avatars')
GLTFPACK = os.environ.get('GLTFPACK') or shutil.which('gltfpack') or 'gltfpack'


def roots(g):
    nodes = g['nodes']
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    name = lambda i: nodes[i].get('name', '')
    return [(i, name(parent[i]) if i in parent else None) for i in range(len(nodes))
            if name(i).startswith('Drif_') and not (i in parent and name(parent[i]).startswith('Drif_'))]


def pack(raw, dst, tmp, simplify):
    src = os.path.join(tmp, os.path.basename(dst) + '.in.glb')
    open(src, 'wb').write(raw)
    cmd = [GLTFPACK, '-i', src, '-o', dst, '-cc', '-kn', '-km', '-ke', '-vp', '14']
    if simplify < 1: cmd += ['-si', str(simplify)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode or not os.path.exists(dst):
        raise RuntimeError(f'gltfpack failed for {dst}: {r.stderr[-400:]}')
    os.remove(src)
    return os.path.getsize(dst)


def build(cardbinder, character, limit=None, simplify=1.0, tex=512):
    out = os.path.join(OUT, character)
    os.makedirs(os.path.join(out, 'parts'), exist_ok=True)
    index = {'base': 'base.glb', 'parts': {}}
    tmp = tempfile.mkdtemp()
    jobs, total = [], 0
    for k, rel in enumerate(SOURCES[character]):
        g, binary = load(os.path.join(cardbinder, rel))
        rs = roots(g)
        nodes = g['nodes']
        if k == 0:  # the rig, body and animation library
            drop = set()
            for i, _ in rs:
                if not IN_BASE.match(nodes[i]['name']): drop |= subtree(nodes, i)
            data, info = subset(g, binary, drop, max_tex=tex, webp=82, quantize=False)
            jobs.append((data, os.path.join(out, 'base.glb'), 1.0))
            print(f'  base: {info}')
        for n, (i, parent) in enumerate(rs):
            name = nodes[i]['name']
            if k == 0 and IN_BASE.match(name): continue
            if limit and n >= limit: break
            if name in index['parts']: continue
            keep = subtree(nodes, i)
            drop = set()
            for j, _ in rs:
                if j != i: drop |= subtree(nodes, j)
            drop -= keep
            data, _ = subset(g, binary, drop, max_tex=tex, webp=82, quantize=False, animations=False)
            fn = re.sub(r'[^A-Za-z0-9_.-]', '_', name) + '.glb'
            index['parts'][name] = {'file': 'parts/' + fn, 'parent': parent}
            jobs.append((data, os.path.join(out, 'parts', fn), simplify))
        print(f'  {rel}: {len(rs)} parts')
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        sizes = list(ex.map(lambda j: pack(j[0], j[1], tmp, j[2]), jobs))
    shutil.rmtree(tmp, ignore_errors=True)
    for (_, dst, _), s in zip(jobs, sizes):
        rel = os.path.relpath(dst, out)
        for v in index['parts'].values():
            if v['file'] == rel: v['bytes'] = s
    index['baseBytes'] = os.path.getsize(os.path.join(out, 'base.glb'))
    json.dump(index, open(os.path.join(out, 'index.json'), 'w'), separators=(',', ':'))
    print(f'{character}: base {index["baseBytes"]/1e6:.2f} MB, {len(index["parts"])} parts, '
          f'{sum(sizes)/1e6:.1f} MB in all ({time.time()-t0:.0f}s packing)')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('cardbinder')
    p.add_argument('--only')
    p.add_argument('--limit', type=int)
    p.add_argument('--simplify', type=float, default=1.0)
    a = p.parse_args()
    for c in SOURCES:
        if not a.only or a.only == c:
            build(a.cardbinder, c, a.limit, a.simplify)
