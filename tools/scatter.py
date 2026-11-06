"""Loose flashlights scattered round the tunnel, clear of props and other items.
Pure python so it can run inside the build or on its own against a built level's colliders."""
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


if __name__ == '__main__':
    # re-scatter against an already built level: python3 tools/scatter.py
    import json, os, re
    here = os.path.dirname(os.path.abspath(__file__))
    meta = json.load(open(os.path.join(here, '..', 'assets', 'env', 'world.json')))
    path = os.path.join(here, '..', 'src', 'world-items.js')
    src = open(path).read()
    items = [it for it in json.loads(re.search(r'freeze\((.*)\);', src).group(1)) if not it.get('scattered')]
    base = [{k: v for k, v in it.items() if k != 'id'} for it in items if int(re.sub(r'\D', '', it['id'])) <= 3 or it['type'] != 'flashlight']
    new = [dict(it, scattered=True) for it in scatter_flashlights(meta['colliders'], base)]
    prefix, count, out = {'flashlight': 'fl', 'paintball': 'pb', 'spray': 'sp'}, {}, []
    for it in base + new:
        count[it['type']] = count.get(it['type'], 0) + 1
        out.append({'id': f"{prefix[it['type']]}{count[it['type']]}", **{k: v for k, v in it.items() if k != 'scattered'}})
    with open(path, 'w') as f:
        f.write('// Written by tools/build_world.py: where held items start. Shared by the client and the server.\n')
        f.write(f'export const ITEM_SPAWNS = Object.freeze({json.dumps(out)});\n')
    print(f'{len(new)} flashlights scattered ({sum(1 for it in new if it["on"])} on), {len(out)} items in all')
