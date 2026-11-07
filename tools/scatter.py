"""Loose flashlights scattered round the tunnel, clear of props and other items.
Pure python so it can run inside the build or on its own against a built level's colliders."""
import json
import math
import random

RL = 38.0


def _inside(c, x, z, pad):
    if 'r' in c:
        return math.hypot(x - c['x'], z - c['z']) < c['r'] + pad
    dx, dz = x - c['x'], z - c['z']
    co, si = math.cos(c.get('yaw', 0)), math.sin(c.get('yaw', 0))
    lx, lz = dx * co - dz * si, dx * si + dz * co
    return abs(lx) < c['hx'] + pad and abs(lz) < c['hz'] + pad


def scatter_flashlights(colliders, items, count=12, seed=97):
    """Flashlights around the loop, every other one left switched on (lying where it was dropped)."""
    rng = random.Random(seed)
    out = []
    for k in range(count):
        for _ in range(60):
            a = 2 * math.pi * (k + 0.62 + rng.uniform(-0.3, 0.3)) / count
            x = rng.choice([-1, 1]) * rng.uniform(1.0, 2.3)
            px, pz = (RL + x) * math.cos(a), -(RL + x) * math.sin(a)
            if any(_inside(c, px, pz, 0.35) for c in colliders if c.get('y1', 9) > 0.1 and c.get('y0', 0) < 1):
                continue
            if any(math.hypot(px - it['x'], pz - it['z']) < 1.5 for it in items + out):
                continue
            out.append({'type': 'flashlight', 'x': round(px, 3), 'y': 0.03, 'z': round(pz, 3),
                        'yaw': round(rng.uniform(0, 2 * math.pi), 3), 'on': k % 2 == 0})
            break
    return out


def scatter_buckets(colliders, items, count=3, seed=211):
    """Cleaning buckets left by the tunnel walls."""
    rng = random.Random(seed)
    out = []
    for k in range(count):
        for _ in range(60):
            a = 2 * math.pi * (k + 0.27 + rng.uniform(-0.2, 0.2)) / count
            x = rng.choice([-1, 1]) * rng.uniform(1.9, 2.3)
            px, pz = (RL + x) * math.cos(a), -(RL + x) * math.sin(a)
            if any(_inside(c, px, pz, 0.4) for c in colliders if c.get('y1', 9) > 0.1 and c.get('y0', 0) < 1):
                continue
            if any(math.hypot(px - it['x'], pz - it['z']) < 1.5 for it in items + out):
                continue
            out.append({'type': 'bucket', 'x': round(px, 3), 'y': 0.0, 'z': round(pz, 3), 'yaw': round(rng.uniform(0, 2 * math.pi), 3)})
            break
    return out


PREFIX = {'flashlight': 'fl', 'paintball': 'pb', 'spray': 'sp', 'bucket': 'bk', 'crown': 'cr', 'painting': 'pt'}


def write_spawns(path, items):
    """The spawn list the client and server share; the supply room's shelf stock is appended from src/shelves.js."""
    count, out = {}, []
    for it in items:
        count[it['type']] = count.get(it['type'], 0) + 1
        out.append({'id': f"{PREFIX[it['type']]}{count[it['type']]}", **{k: v for k, v in it.items() if k not in ('id', 'scattered')}})
    with open(path, 'w') as f:
        f.write('// Written by tools/build_world.py: where held items start. Shared by the client and the server.\n')
        f.write("import {SHELF_ITEMS} from './shelves.js';\n")
        f.write(f'const PLACED = {json.dumps(out)};\n')
        f.write('export const ITEM_SPAWNS = Object.freeze([...PLACED, ...SHELF_ITEMS]);\n')
    return out


if __name__ == '__main__':
    # re-scatter against an already built level: python3 tools/scatter.py
    import os, re
    here = os.path.dirname(os.path.abspath(__file__))
    meta = json.load(open(os.path.join(here, '..', 'assets', 'env', 'world.json')))
    path = os.path.join(here, '..', 'src', 'world-items.js')
    src = open(path).read()
    m = re.search(r'(?:freeze\(|PLACED = )(\[.*?\]);?\)?;?\n', src)
    items = json.loads(m.group(1))
    base = [{k: v for k, v in it.items() if k != 'id'} for it in items
            if (it['type'] != 'flashlight' or int(re.sub(r'\D', '', it['id'])) <= 3) and it['type'] != 'bucket']
    lights = scatter_flashlights(meta['colliders'], base)
    buckets = scatter_buckets(meta['colliders'], base + lights)
    out = write_spawns(path, base + lights + buckets)
    print(f'{len(lights)} flashlights ({sum(1 for it in lights if it["on"])} on) and {len(buckets)} buckets scattered, {len(out)} placed items')
