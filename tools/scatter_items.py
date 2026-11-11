"""Things lying about besides what the level builder put down: more spray cans and markers through the tunnel
and the rooms, paintball guns in a couple of the dark rooms. Writes src/scatter.js (picked up by src/shelves.js,
so the server and the client both have them). Every spot is on open floor: clear of the level's colliders, the
crates, the shelves and each other.
    python3 tools/scatter_items.py
"""
import json, math, os, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
# the level builder's layout (tools/build_world.py)
RL, RT, CY = 38.0, 3.3, 2.0
XF = math.sqrt(RT ** 2 - CY ** 2)
VD = XF + 1.15
ROOM_C = VD + 3.2
DOORS = 20
LOCKED = {8, 11, 16}                       # rooms behind locked doors
LIT = {2, 9, 14, 17}
PARTY, SUPPLY, BATHROOM, CONTROL = 0, 1, 4, 10
MACHINE_ANGLE = -0.2

def door_x(i):
    return 1.6 if i == PARTY else round(float(np.random.default_rng(100 + i).uniform(-1.8, 1.8)), 2)

def room_to_world(i, x, z):
    a = 2 * math.pi * i / DOORS
    ox = (RL + ROOM_C) * math.cos(a) + door_x(i) * math.sin(a)
    oz = -(RL + ROOM_C) * math.sin(a) + door_x(i) * math.cos(a)
    yaw = math.atan2(math.cos(a), -math.sin(a))
    c, s = math.cos(yaw), math.sin(yaw)
    return ox + c * x + s * z, oz - s * x + c * z

def loop_point(a, x):
    return (RL + x) * math.cos(a), -(RL + x) * math.sin(a)

# everything that stands on the floor
world = json.load(open(os.path.join(ROOT, 'assets', 'env', 'world.json')))
cols = [c for c in world['colliders'] if c.get('y0', 0) < .4]
txt = open(os.path.join(ROOT, 'src', 'crates-placed.js')).read()
cols += json.loads(txt[txt.index('['):txt.rindex(']') + 1])
cols += json.loads(os.environ.get('EXTRA_COLLIDERS', '[]'))   # (the supply room's shelves: passed in by the caller)

def clearance(x, z):
    best = 1e9
    for c in cols:
        if 'r' in c:
            d = math.hypot(x - c['x'], z - c['z']) - c['r']
        else:
            dx, dz = x - c['x'], z - c['z']
            co, si = math.cos(c.get('yaw', 0)), math.sin(c.get('yaw', 0))
            lx, lz = abs(dx * co - dz * si) - c['hx'], abs(dx * si + dz * co) - c['hz']
            d = math.hypot(max(lx, 0), max(lz, 0)) if lx > 0 or lz > 0 else max(lx, lz)
        best = min(best, d)
    return best

taken = []
# what's already lying about (the level's own items and the shelves' stock are elsewhere or off the floor)
wi = open(os.path.join(ROOT, 'src', 'world-items.js')).read()
for m in re.finditer(r'"x": (-?[\d.]+), "y": ([\d.]+), "z": (-?[\d.]+)', wi):
    if float(m.group(2)) < .2: taken.append((float(m.group(1)), float(m.group(3))))

def free(x, z, room=None):
    if clearance(x, z) < .4: return False
    if any(math.hypot(x - a, z - b) < .9 for a, b in taken): return False
    return True

rng = np.random.default_rng(1111)
out = []
def place(kind, prefix, n, spot):
    for k in range(n):
        for _ in range(4000):
            got = spot()
            if got and free(*got):
                x, z = got
                taken.append((x, z))
                out.append({'id': f'{prefix}{k + 1}', 'type': kind, 'x': round(x, 3), 'y': .03, 'z': round(z, 3), 'yaw': round(float(rng.uniform(0, 2 * math.pi)), 3)})
                break
        else:
            raise SystemExit(f'no room for {prefix}{k + 1}')

def tunnel_spot(spread):
    def f():
        a = rng.uniform(0, 2 * math.pi)
        if abs(math.remainder(a - MACHINE_ANGLE, 2 * math.pi)) < .15: return None   # not at the lap machine
        x = rng.uniform(-spread, spread)
        return loop_point(a, x)
    return f

def room_spot(rooms):
    def f():
        i = int(rng.choice(rooms))
        x, z = rng.uniform(-3.0, 3.0), rng.uniform(-1.9, 2.5)   # (not in the doorway)
        return room_to_world(i, x, z)
    return f

open_rooms = [i for i in range(2, DOORS) if i not in LOCKED and i not in (BATHROOM, CONTROL)]
dark_rooms = [i for i in open_rooms if i not in LIT]
place('spray', 'spx', 10, tunnel_spot(2.0))
place('spray', 'spr', 6, room_spot(open_rooms))
place('marker', 'mkx', 10, tunnel_spot(2.0))
# a paintball gun each in two of the dark rooms
for k, room in enumerate([12, 18]):
    assert room in dark_rooms
    before = len(out)
    place('paintball', f'pbd{k + 1}_', 1, room_spot([room]))
    out[before]['id'] = f'pbd{k + 1}'

path = os.path.join(ROOT, 'src', 'scatter.js')
with open(path, 'w') as f:
    f.write('// Written by tools/scatter_items.py: spray cans and markers through the tunnel and the rooms, paintball guns\n')
    f.write('// in two of the dark rooms (with the shelves\' stock in src/shelves.js, shared by the server and the client).\n')
    f.write('export const SCATTERED = ' + json.dumps(out) + ';\n')
print(f'{len(out)} items -> {path}')
for o in out: print(o['id'], o['type'], o['x'], o['z'], round(clearance(o['x'], o['z']), 2))
