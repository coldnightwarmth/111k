"""Loose flashlights scattered round the tunnel, clear of props and other items, and paintings
hung, leant and laid about the tunnel and the rooms.
Pure python (numpy for the paintings) so it can run inside the build or on its own against a
built level's colliders and mesh."""
import json
import math
import os
import random
import re

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


# ---------------------------------------------------------------------------- paintings
# A painting goes where a player could have put it: the game's own placing (planPlace in src/main.js,
# with fitOn and leanOn) is run here against the built level's mesh, aimed from a standing eye, so a
# spawned painting sits exactly as one put there by hand. On top of that: it has to be clear of every
# solid bit of the level and of the colliders, flush on what it's on, off the graffiti, away from doorways,
# the lap timer and the supply room (both built at runtime, so not in the mesh), and apart from other items.

XF = math.sqrt(3.3 ** 2 - 2.0 ** 2)   # the tunnel floor's half-width
VD = XF + 1.15                       # radial offset of the rooms' door walls
ROOM_C = VD + 3.2                    # radial offset of a room's middle
PAINTING_LONG, PAINTING_DEPTH = 0.8, 0.05
WALLS = {'tunnel_lining', 'office_wall', 'wall_beige', 'wall_blue', 'wall_green', 'tile_wall'}   # what a painting hangs on
SUPPLY_ROOM = 1                      # shelving built at runtime (src/shelves.js)
MACHINE = (-0.2, 2.6)                # the lap timer (src/race.js): loop angle, offset from the centreline


def _P(a, x, y):
    import numpy as np
    return np.array([(RL + x) * math.cos(a), y, -(RL + x) * math.sin(a)])


def _U(a):
    import numpy as np
    return np.array([math.cos(a), 0.0, -math.sin(a)])


def _T(a):
    import numpy as np
    return np.array([-math.sin(a), 0.0, -math.cos(a)])


def read_art(path):
    """The art ids and pixel sizes from ART in src/paintings.js."""
    src = open(path).read()
    return {int(m.group(1)): (int(m.group(2)), int(m.group(3)))
            for m in re.finditer(r'(\d+): \{url: `\$\{CDN\}\d+\.png`, w: (\d+), h: (\d+)\}', src)}


def painting_size(art_px):
    w, h = art_px
    k = PAINTING_LONG / max(w, h)
    return w * k, h * k


class Hit:
    __slots__ = ('distance', 'point', 'normal', 'mat')

    def __init__(self, distance, point, normal, mat):
        self.distance, self.point, self.normal, self.mat = distance, point, normal, mat


class LevelMesh:
    """The built level's triangles (assets/env/world.glb) with a ray test like the game's (src/decals.js
    createWorldHits): what the game hits is the opaque meshes with lightmap uvs, door leaves left out.
    `solid=True` tests every opaque triangle (light tubes and lenses too), for clearance; `graffiti=True`
    only the graffiti (the see-through decal quads on the walls), so paintings can keep off it."""
    CELL = 1.0

    def __init__(self, path):
        import numpy as np
        import struct
        b = open(path, 'rb').read()
        assert b[:4] == b'glTF'
        o, chunks = 12, []
        while o < len(b):
            n, _ = struct.unpack_from('<II', b, o)
            chunks.append(b[o + 8:o + 8 + n])
            o += 8 + n
        g, binc = json.loads(chunks[0]), chunks[1]
        acc, views = g['accessors'], g['bufferViews']

        def read(i):
            a = acc[i]
            v = views[a['bufferView']]
            comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
            dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
            assert v.get('byteStride') in (None, comps * np.dtype(dt).itemsize)
            arr = np.frombuffer(binc, dt, a['count'] * comps, v.get('byteOffset', 0) + a.get('byteOffset', 0))
            return arr.reshape(-1, comps) if comps > 1 else arr
        tris, hit, mats, names, decal = [], [], [], [], []
        for node in g['nodes']:
            if 'mesh' not in node:
                continue
            assert not any(k in node for k in ('matrix', 'translation', 'rotation', 'scale'))
            if re.search(r'#10\d\d$', node.get('name', '')):
                continue                     # door leaves: modelled round their hinges, and they swing
            for p in g['meshes'][node['mesh']]['primitives']:
                m = g['materials'][p['material']]
                if 'indices' not in p:
                    continue
                pos = read(p['attributes']['POSITION']).astype(np.float64)
                idx = read(p['indices']).reshape(-1, 3)
                if m['name'] not in names:
                    names.append(m['name'])
                tris.append(pos[idx])
                see_through = m.get('alphaMode') == 'BLEND'
                hit.append(np.full(len(idx), 'TEXCOORD_1' in p['attributes'] and not see_through))
                decal.append(np.full(len(idx), see_through))
                mats.append(np.full(len(idx), names.index(m['name'])))
        T = np.concatenate(tris)
        self.names = names
        self.hit = np.concatenate(hit)
        self.decal = np.concatenate(decal)
        self.mat = np.concatenate(mats)
        self.V0, self.E1, self.E2 = T[:, 0], T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
        N = np.cross(T[:, 2] - T[:, 1], T[:, 0] - T[:, 1])     # (three's Triangle.getNormal)
        self.N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
        lo = np.floor(T[:, :, [0, 2]].min(1) / self.CELL).astype(int)
        hi = np.floor(T[:, :, [0, 2]].max(1) / self.CELL).astype(int)
        grid = {}
        for i in range(len(T)):
            for cx in range(lo[i, 0], hi[i, 0] + 1):
                for cz in range(lo[i, 1], hi[i, 1] + 1):
                    grid.setdefault((cx, cz), []).append(i)
        self.grid = {k: np.array(v) for k, v in grid.items()}
        self._cache = {}

    def _near(self, o, e):
        import numpy as np
        x0, x1 = sorted((o[0], e[0]))
        z0, z1 = sorted((o[2], e[2]))
        key = (math.floor(x0 / self.CELL), math.floor(x1 / self.CELL), math.floor(z0 / self.CELL), math.floor(z1 / self.CELL))
        if key not in self._cache:
            parts = [self.grid[(cx, cz)] for cx in range(key[0], key[1] + 1) for cz in range(key[2], key[3] + 1) if (cx, cz) in self.grid]
            self._cache[key] = np.unique(np.concatenate(parts)) if parts else np.zeros(0, int)
        return self._cache[key]

    def raycast(self, o, d, far, solid=False, graffiti=False):
        """Nearest hit along a segment, its normal turned to face the ray (both sides count), or None."""
        import numpy as np
        idx = self._near(o, o + d * far)
        idx = idx[self.decal[idx]] if graffiti else idx[~self.decal[idx]] if solid else idx[self.hit[idx]]
        if not len(idx):
            return None
        E1, E2, V0 = self.E1[idx], self.E2[idx], self.V0[idx]
        p = np.cross(d, E2)
        det = np.einsum('ij,ij->i', E1, p)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        tv = o - V0
        u = np.einsum('ij,ij->i', tv, p) * inv
        q = np.cross(tv, E1)
        v = (q @ d) * inv
        t = np.einsum('ij,ij->i', E2, q) * inv
        ok &= (u >= 0) & (v >= 0) & (u + v <= 1) & (t >= 0) & (t <= far)
        if not ok.any():
            return None
        k = np.flatnonzero(ok)[np.argmin(t[ok])]
        n = self.N[idx[k]].copy()
        if n @ d > 0:
            n = -n
        return Hit(float(t[k]), o + d * t[k], n, self.names[self.mat[idx[k]]])


def _unit(v):
    import numpy as np
    return v / np.linalg.norm(v)


class Placer:
    """planPlace, fitOn and leanOn from src/main.js, line for line."""
    REACH, MIN_LEAN, MAX_LEAN = 3.2, 0.12, 1.25

    def __init__(self, mesh):
        self.m = mesh

    def ray(self, o, d, far):
        return self.m.raycast(o, d, far)

    def plan(self, o, d, w, ht):
        import numpy as np
        hit = self.ray(o, d, self.REACH)
        if hit is None:
            return None
        n, P = hit.normal, hit.point
        if n[1] <= -.6:
            return None
        if n[1] < .7:
            plan = self.fit_on(P, n, w, ht, np.array([0.0, 1.0, 0.0]))
            return plan and {**plan, 'how': 'hang', 'aim': P, 'on': hit.mat}
        fwd = np.array([d[0], 0.0, d[2]])
        if fwd @ fwd > 1e-6:
            fwd = _unit(fwd)
            plan = self.lean_on(P, n, fwd, w, ht)
            if plan:
                return {**plan, 'aim': P, 'on': hit.mat}
        plan = self.fit_on(P, n, w, ht, fwd if fwd @ fwd > 1e-6 else np.array([0.0, 0.0, -1.0]))
        return plan and {**plan, 'how': 'lay', 'aim': P, 'on': hit.mat}

    def lean_on(self, P, floor_n, fwd, w, ht):
        import numpy as np
        Y = np.array([0.0, 1.0, 0.0])
        wall = self.ray(P + Y * .3 - fwd * .05, fwd, 1)
        if wall is None or wall.normal[1] > .75 or wall.normal[1] < -.5:
            return None
        out = np.array([wall.normal[0], 0.0, wall.normal[2]])
        if out @ out < 1e-4:
            return None
        out = _unit(out)
        side = _unit(np.cross(Y, out))

        def up_at(t):
            return np.array([0.0, math.cos(t), 0.0]) - out * math.sin(t)

        def touches(F, t):
            u = up_at(t)
            return any(self.ray(F + side * (k * w * .96) + u * .03, u, ht - .03) is not None for k in (-.5, 0, .5))
        F = P.copy()
        k = 0
        while touches(F, self.MIN_LEAN):
            if k > 20:
                return None
            F = F + out * .03
            k += 1
        if not touches(F, self.MAX_LEAN):
            return None
        lo, hi = self.MIN_LEAN, self.MAX_LEAN
        for _ in range(12):
            mid = (lo + hi) / 2
            if touches(F, mid):
                hi = mid
            else:
                lo = mid
        t = hi
        at = F + up_at(t) * (ht / 2) + Y * .002
        return {'x': at[0], 'y': at[1], 'z': at[2], 'yaw': math.atan2(out[0], out[2]), 'tilt': -t, 'roll': 0.0, 'how': 'lean',
                'foot': F, 'rest': F + up_at(t) * ht - out * .01, 'against': wall.mat}

    def fit_on(self, P, n0, w, ht, top):
        import numpy as np
        n, c = n0.copy(), P.copy()
        fr = {}

        def frame():
            up = top - n * (top @ n)
            if up @ up < 1e-4:
                up = np.array([0.0, 0.0, 1.0]) - n * n[2]
            up = _unit(up)
            fr['up'], fr['right'] = up, _unit(np.cross(up, n))

        def feel():
            pts = []
            back = -n
            for sx in (-1, -.5, 0, .5, 1):
                for sy in (-1, -.5, 0, .5, 1):
                    x, y = sx * w / 2 * .97, sy * ht / 2 * .97
                    h = self.ray(c + fr['right'] * x + fr['up'] * y + n * .35, back, 1)
                    if h is not None and h.normal @ n0 > .5:
                        pts.append((x, y, (h.point - c) @ n, h.mat))
            return pts
        for _ in range(3):
            frame()
            pts = feel()
            if len(pts) < 12:
                return None
            q = np.array([p[:3] for p in pts])
            M = np.array([[q[:, 0] @ q[:, 0], q[:, 0] @ q[:, 1], q[:, 0].sum()],
                          [q[:, 0] @ q[:, 1], q[:, 1] @ q[:, 1], q[:, 1].sum()],
                          [q[:, 0].sum(), q[:, 1].sum(), len(q)]])
            if abs(np.linalg.det(M)) < 1e-9:
                break
            a, b, k = np.linalg.inv(M) @ np.array([q[:, 0] @ q[:, 2], q[:, 1] @ q[:, 2], q[:, 2].sum()])
            c = c + n * k
            n = _unit(n - fr['right'] * a - fr['up'] * b)
            if n @ n0 < .7:
                return None
        frame()
        right, up = fr['right'], fr['up']

        def settle():
            nonlocal c
            pts = feel()
            if len(pts) < 12:
                return None
            c = c + n * (max(p[2] for p in pts) + .003)
            return pts
        if settle() is None:
            return None
        back = -n
        step = 0
        while True:
            ix = iy = count = 0
            for sx in (-1, -.5, 0, .5, 1):
                for sy in (-1, -.5, 0, .5, 1):
                    x, y = sx * (w / 2 + .006), sy * (ht / 2 + .006)
                    h = self.ray(c + right * x + up * y + n * .3, back, .3)
                    mid, to = c + n * .025, right * x + up * y
                    far = float(np.linalg.norm(to))
                    across = far > .01 and self.ray(mid, to / far, far) is not None
                    if (h is not None and h.distance < .296) or across:
                        ix += x
                        iy += y
                        count += 1
            if not count:
                break
            if step >= 10:
                return None
            ln = math.hypot(ix, iy) or 1
            c = c - right * (ix / ln * .05) - up * (iy / ln * .05)
            if settle() is None:
                return None
            step += 1
        if n[1] < .7:                        # hung: bottom edge off the floor, top off the ceiling
            Y = np.array([0.0, 1.0, 0.0])
            lift = 0.0
            for sx in (-1, 0, 1):
                corner = c + right * (sx * w / 2) - up * (ht / 2) + n * .02
                down = self.ray(corner + Y * .6, -Y, 1.2)
                if down is not None and down.normal[1] > .7 and corner[1] < down.point[1] + .02:
                    lift = max(lift, (down.point[1] + .02 - corner[1]) / max(.3, up[1]))
            c = c + up * lift
            above = self.ray(c + n * .05, Y, ht)
            reach = ht / 2 * abs(up[1])
            if above is not None and above.distance < reach + .01:
                c = c - Y * (reach + .01 - above.distance)
        # Euler YXZ of the basis (right, up, n), as three's setFromRotationMatrix
        m23 = n[1]
        tilt = math.asin(-max(-1.0, min(1.0, m23)))
        if abs(m23) < 0.9999999:
            yaw, roll = math.atan2(n[0], n[2]), math.atan2(right[1], up[1])
        else:
            yaw, roll = math.atan2(-right[2], right[0]), 0.0
        return {'x': c[0], 'y': c[1], 'z': c[2], 'yaw': yaw, 'tilt': tilt, 'roll': roll, 'touch': feel()}


def painting_basis(yaw, tilt, roll):
    """Rotation of paintingMatrix (Euler YXZ): columns are the painting's right, up and out."""
    import numpy as np
    cy, sy, cx, sx, cz, sz = math.cos(yaw), math.sin(yaw), math.cos(tilt), math.sin(tilt), math.cos(roll), math.sin(roll)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Ry @ Rx @ Rz


def painting_points(it, w, ht, inset, back):
    """Points through a painting's box (shrunk by `inset` round the edges, from `back` off its back): for colliders."""
    import numpy as np
    R, o = painting_basis(it['yaw'], it['tilt'], it['roll']), np.array([it['x'], it['y'], it['z']])
    pts = [o + R @ np.array([sx * (w / 2 - inset), sy * (ht / 2 - inset), z])
           for sx in (-1, -.5, 0, .5, 1) for sy in (-1, -.5, 0, .5, 1) for z in (back, PAINTING_DEPTH - .003)]
    return np.array(pts)


def painting_clear(mesh, it, w, ht, inset, back):
    """Nothing solid inside the painting's box: segments along its edges and through it every way."""
    import numpy as np
    R, o = painting_basis(it['yaw'], it['tilt'], it['roll']), np.array([it['x'], it['y'], it['z']])
    x, y, z0, z1 = w / 2 - inset, ht / 2 - inset, back, PAINTING_DEPTH - .003
    L = lambda a, b, c: o + R @ np.array([a, b, c])
    segs = []
    for z in (z0, (z0 + z1) / 2, z1):
        for t in np.linspace(-1, 1, 7):
            segs.append((L(-x, t * y, z), L(x, t * y, z)))      # across
            segs.append((L(t * x, -y, z), L(t * x, y, z)))      # up and down
        segs += [(L(-x, -y, z), L(x, y, z)), (L(-x, y, z), L(x, -y, z))]
    for sx in (-1, -.5, 0, .5, 1):
        for sy in (-1, -.5, 0, .5, 1):
            segs.append((L(sx * x, sy * y, z0), L(sx * x, sy * y, z1)))   # front to back
    for a, b in segs:
        d = b - a
        ln = float(np.linalg.norm(d))
        if ln > 1e-6 and (mesh.raycast(a, d / ln, ln, solid=True) is not None or mesh.raycast(b, -d / ln, ln, solid=True) is not None):
            return False
    return True


def painting_covers_graffiti(mesh, it, w, ht):
    """Would it hide any graffiti: rays back from all over its face (and a bit past its edges)."""
    import numpy as np
    R, o = painting_basis(it['yaw'], it['tilt'], it['roll']), np.array([it['x'], it['y'], it['z']])
    back = -R[:, 2]
    for sx in np.linspace(-1, 1, 7):
        for sy in np.linspace(-1, 1, 7):
            p = o + R @ np.array([sx * (w / 2 + .03), sy * (ht / 2 + .03), PAINTING_DEPTH])
            if mesh.raycast(p, back, .6, graffiti=True) is not None:
                return True
    return False


def find_doorways(mesh, loop_doors):
    """Where each room's passage opens out of the tunnel (felt for: the rooms' door offsets are random):
    [(angle, offset along the tunnel)], one per room."""
    import numpy as np
    out = []
    for d in loop_doors:
        a = d['angle']
        open_at = [s for s in np.arange(-3.0, 3.001, .05)
                   if (lambda h: h is None or h.distance > XF + .9)(mesh.raycast(_P(a, 0, 1.4) + _T(a) * s, _U(a), 6, solid=True))]
        out.append((a, float(np.mean(open_at)) if open_at else 0.0))
    return out


def _seg_dist(p, a, b):
    import numpy as np
    ab = b - a
    t = max(0.0, min(1.0, ((p - a) @ ab) / (ab @ ab)))
    return float(np.linalg.norm(p - (a + ab * t)))


def scatter_paintings(meta, mesh, items, art, count=29, seed=1111, log=None, pool=None, per_room=1, spacing=3.0, avoid=()):
    """Paintings round the level: about half in the tunnel (spread round the loop), the rest in the rooms
    (`per_room` to a room on the first pass); some hung on the walls, some leant against walls or
    furniture, some lying on the floor. `art` is {art id: (w, h) pixels}, `pool` the ids to draw from
    (all of them by default); each painting gets a different picture that isn't already up. They keep
    `spacing` apart, from each other and from the paintings in `avoid`."""
    import numpy as np
    rng = random.Random(seed)
    placer = Placer(mesh)
    # the bore's own colliders are upright slabs standing in for its curved wall (for walking): the mesh
    # check is what keeps paintings out of the wall, so they're left out of the collider check
    colliders = [c for c in meta['colliders'] if c.get('y1', 9) < 5.2]
    props = [c for c in colliders if .25 < c.get('y1', 9) < 1.7]    # furniture and junk to lean things on
    doorways = find_doorways(mesh, meta['loop']['doors'])
    corridors = [(_P(a, XF - 1.0, 0) + _T(a) * s, _P(a, VD + 1.8, 0) + _T(a) * s) for a, s in doorways]
    machine = _P(MACHINE[0], MACHINE[1], 0)
    spawns = [np.array([s['x'], 0, s['z']]) for s in meta['spawns']]
    used = {it.get('art') for it in items if it['type'] == 'painting'}
    arts = sorted(a for a in (art if pool is None else pool) if a not in used)
    rng.shuffle(arts)
    n_tunnel = (count + 1) // 2
    modes_t = ['hang'] * round(n_tunnel * .45) + ['lean'] * round(n_tunnel * .3)
    modes_t += ['lay'] * (n_tunnel - len(modes_t))
    n_rooms = count - n_tunnel
    modes_r = ['hang'] * round(n_rooms * .45) + ['lean'] * round(n_rooms * .3)
    modes_r += ['lay'] * (n_rooms - len(modes_r))
    rng.shuffle(modes_t)
    rng.shuffle(modes_r)
    out = []
    Y = np.array([0.0, 1.0, 0.0])

    def room_of(p):
        a = math.atan2(-p[2], p[0]) % (2 * math.pi)
        return round(a / (2 * math.pi / 20)) % 20 if math.hypot(p[0], p[2]) > RL + VD - .1 else None

    def floor_at(x, z, y=1.0):
        h = mesh.raycast(np.array([x, y, z]), -Y, y + .2)
        return h if h is not None and h.normal[1] > .7 and h.point[1] < .05 else None

    def accept(plan, mode, w, ht):
        if plan is None or plan['how'] != mode:
            return None
        it = {k: float(plan[k]) for k in ('x', 'y', 'z', 'yaw', 'tilt', 'roll')}
        if mode == 'hang':
            touch = plan['touch']
            # flat on the wall all over (the tunnel's curve leaves a few cm at most), nothing else under it
            if len(touch) < 25 or any(t[3] not in WALLS for t in touch) or max(t[2] for t in touch) - min(t[2] for t in touch) > .035:
                return None
            if not (1.2 < it['y'] < 2.0):
                return None
            inset, back = .004, .0015
        elif mode == 'lean':
            if plan['foot'][1] > .05 or it['tilt'] < -.75:    # stood on the floor, not slid most of the way down
                return None
            inset, back = .015, .012
        else:
            touch = plan['touch']
            if len(touch) < 25 or plan['aim'][1] > .05 or max(t[2] for t in touch) - min(t[2] for t in touch) > .01:
                return None
            inset, back = .004, .0015
        if not painting_clear(mesh, it, w, ht, inset, back) or painting_covers_graffiti(mesh, it, w, ht):
            return None
        pts = painting_points(it, w, ht, inset + .01, back)
        # what it's leant on is touching it on purpose (the mesh check above keeps it out of it)
        rest = plan['rest'] if mode == 'lean' else None
        near = [c for c in colliders if rest is None or not (_inside(c, rest[0], rest[2], .12) and c.get('y0', 0) - .1 < rest[1] < c.get('y1', 9) + .1)]
        for p in pts:
            if any(_inside(c, p[0], p[2], 0) and c.get('y0', 0) < p[1] < c.get('y1', 9) for c in near):
                return None
            if any(_seg_dist(p * [1, 0, 1], a, b) < 1.0 for a, b in corridors):
                return None
            if math.hypot(p[0] - machine[0], p[2] - machine[2]) < 3.0 or room_of(p) == SUPPLY_ROOM:
                return None
        ctr = np.array([it['x'], 0, it['z']])
        if mode != 'hang' and any(np.linalg.norm(ctr - s) < 1.5 for s in spawns):
            return None
        if any(math.hypot(it['x'] - o['x'], it['z'] - o['z']) < 1.0 for o in items):
            return None
        if any(math.hypot(it['x'] - o['x'], it['z'] - o['z']) < spacing for o in (*out, *avoid)):
            return None
        return it

    def against(c):
        """Aimed at the floor just in front of a prop, facing into it."""
        th = rng.uniform(0, 2 * math.pi)
        d = np.array([math.cos(th), 0, math.sin(th)])            # out from the prop
        if 'r' in c:
            reach = c['r']
        else:
            co, si = math.cos(c.get('yaw', 0)), math.sin(c.get('yaw', 0))
            reach = abs(d[0] * co - d[2] * si) * c['hx'] + abs(d[0] * si + d[2] * co) * c['hz']
        f = np.array([c['x'], 0, c['z']]) + d * (reach + rng.uniform(.15, .4))
        fl = floor_at(f[0], f[2])
        if fl is None:
            return None
        return fl.point + d * rng.uniform(1.1, 1.6) + Y * 1.6, fl.point     # (the eye further out, looking in)

    def try_tunnel(mode, a, w, ht, lo=None, hi=None):
        s = rng.choice([-1, 1])
        if mode == 'lean' and rng.random() < .5:
            near = [c for c in props if lo <= math.atan2(-c['z'], c['x']) % (2 * math.pi) <= hi and math.hypot(c['x'], c['z']) < RL + XF]
            if near:
                return against(rng.choice(near))
        if mode == 'hang':
            yh = rng.uniform(1.35, 1.75)
            eye = _P(a, s * (XF - 1.5), 1.6) + _T(a) * rng.uniform(-.6, .6)
            target = _P(a, s * math.sqrt(3.3 ** 2 - (yh - 2.0) ** 2), yh)
        elif mode == 'lean':
            target = _P(a, s * (XF - rng.uniform(.2, .45)), 0)
            eye = _P(a, s * (XF - 1.7), 1.6) + _T(a) * rng.uniform(-.5, .5)
        else:
            target = _P(a, rng.uniform(-1.6, 1.6), 0)
            eye = target + _T(a) * rng.choice([-1, 1]) * rng.uniform(1.2, 1.8) + _U(a) * rng.uniform(-.4, .4) + Y * 1.6
        return eye, target

    def try_room(mode, i, w, ht):
        a = meta['loop']['doors'][i]['angle']
        eye = _P(a, ROOM_C + rng.uniform(-1.6, 1.6), 1.6) + _T(a) * rng.uniform(-1.6, 1.6)
        th = rng.uniform(0, 2 * math.pi)
        d = np.array([math.cos(th), 0, math.sin(th)])
        if mode == 'hang':
            yh = rng.uniform(1.35, 1.75)
            h = mesh.raycast(np.array([eye[0], yh, eye[2]]), d, 4)
            if h is None or h.mat not in WALLS or not (.8 < h.distance < 3.0):
                return None
            return eye, h.point
        h = mesh.raycast(np.array([eye[0], .3, eye[2]]), d, 4)
        if mode == 'lean':
            mine = [c for c in props if room_of(np.array([c['x'], 0, c['z']])) == i]
            if mine and rng.random() < .6:
                return against(rng.choice(mine))
            if h is None or h.distance < .8:
                return None
            f = h.point - d * rng.uniform(.15, .5)
        else:
            f = eye + d * rng.uniform(.5, 2.0)
            if h is not None and h.distance < np.linalg.norm(f - eye) + 1.2:
                return None
        fl = floor_at(f[0], f[2])
        if fl is None:
            return None
        target = fl.point
        eye = target - d * rng.uniform(1.1, 1.6) + Y * 1.6
        return eye, target

    def place(mode, w, ht, aim):
        for _ in range(120):
            got = aim()
            if got is None:
                continue
            eye, target = got
            # the eye has to be standing somewhere open, with a clear line to where it's aiming
            fl = floor_at(eye[0], eye[2], eye[1])
            if fl is None or any(_inside(c, eye[0], eye[2], .3) for c in colliders if c.get('y0', 0) < 1.6 < c.get('y1', 9)):
                continue
            d = target - eye
            dist = float(np.linalg.norm(d))
            if dist > placer.REACH - .05:
                continue
            plan = placer.plan(eye, d / dist, w, ht)
            if plan is None or np.linalg.norm(plan['aim'] - target) > .1:
                continue
            it = accept(plan, mode, w, ht)
            if it:
                if log is not None:                   # where it was aimed from, to check against the game
                    log.append({'eye': [float(v) for v in eye], 'target': [float(v) for v in target]})
                return it, plan
        return None

    report = []
    k_art = 0
    missed = []                              # modes that found no spot first time round
    for k, mode in enumerate(modes_t):
        w, ht = painting_size(art[arts[k_art]])
        lo, hi = 2 * math.pi * (k + .15) / n_tunnel, 2 * math.pi * (k + .85) / n_tunnel
        got = place(mode, w, ht, lambda: try_tunnel(mode, rng.uniform(lo, hi), w, ht, lo, hi))
        if got:
            it, plan = got
            out.append({**it, 'art': arts[k_art]})
            report.append((mode, 'tunnel', plan.get('against') or plan.get('on')))
            k_art += 1
        else:
            missed.append(mode)
    rooms = [i for i in range(20) if i != SUPPLY_ROOM] * per_room
    rng.shuffle(rooms)
    for mode in modes_r:
        w, ht = painting_size(art[arts[k_art]])
        while rooms:
            i = rooms.pop()
            got = place(mode, w, ht, lambda: try_room(mode, i, w, ht))
            if got:
                it, plan = got
                out.append({**it, 'art': arts[k_art]})
                report.append((mode, f'room {i}', plan.get('against') or plan.get('on')))
                k_art += 1
                break
        else:
            missed.append(mode)
    # whatever missed: anywhere round the loop, or any room
    for mode in missed:
        w, ht = painting_size(art[arts[k_art]])
        for _ in range(40):
            if rng.random() < .5:
                a = rng.uniform(0, 2 * math.pi)
                got = place(mode, w, ht, lambda: try_tunnel(mode, a, w, ht, a - .1, a + .1))
                where = 'tunnel'
            else:
                i = rng.choice([i for i in range(20) if i != SUPPLY_ROOM])
                got = place(mode, w, ht, lambda: try_room(mode, i, w, ht))
                where = f'room {i}'
            if got:
                it, plan = got
                out.append({**it, 'art': arts[k_art]})
                report.append((mode, where, plan.get('against') or plan.get('on')))
                k_art += 1
                break
    items_out = [{'type': 'painting', 'x': round(it['x'], 3), 'y': round(it['y'], 3), 'z': round(it['z'], 3),
                  'yaw': round(it['yaw'], 3), 'tilt': round(it['tilt'], 3), 'roll': round(it['roll'], 3), 'art': it['art']} for it in out]
    return items_out, report


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


# The scattered paintings come in batches, each with its own pictures (the next ones in ART's order,
# after art 1 which hangs in the party room) and seed, so adding a batch leaves the earlier ones where
# they are: (count, seed, paintings to a room on the first pass, spacing).
PAINTING_BATCHES = [(29, 1111, 1, 3.0), (70, 2222, 2, 2.0)]


def add_paintings(here, items, meta, log=None):
    """The scattered paintings, placed against the built level (assets/env/world.glb must be there)."""
    mesh = LevelMesh(os.path.join(here, '..', 'assets', 'env', 'world.glb'))
    art = read_art(os.path.join(here, '..', 'src', 'paintings.js'))
    order = list(art)[1:]
    paintings, report = [], []
    for count, seed, per_room, spacing in PAINTING_BATCHES:
        pool, order = order[:count], order[count:]
        got, rep = scatter_paintings(meta, mesh, items + paintings, art, count=count, seed=seed, log=log, pool=pool,
                                     per_room=per_room, spacing=spacing, avoid=paintings)
        paintings += got
        report += rep
    return paintings, report


def is_scattered(it):
    """Spawns the scatter put down (the rest come from the level's own rooms)."""
    k = int(re.sub(r'\D', '', it['id']))
    return (it['type'] == 'flashlight' and k > 3) or it['type'] == 'bucket' or (it['type'] == 'painting' and k > 1)


if __name__ == '__main__':
    # re-scatter against an already built level: python3 tools/scatter.py
    here = os.path.dirname(os.path.abspath(__file__))
    meta = json.load(open(os.path.join(here, '..', 'assets', 'env', 'world.json')))
    path = os.path.join(here, '..', 'src', 'world-items.js')
    src = open(path).read()
    m = re.search(r'(?:freeze\(|PLACED = )(\[.*?\]);?\)?;?\n', src)
    items = json.loads(m.group(1))
    base = [{k: v for k, v in it.items() if k != 'id'} for it in items if not is_scattered(it)]
    lights = scatter_flashlights(meta['colliders'], base)
    buckets = scatter_buckets(meta['colliders'], base + lights)
    paintings, report = add_paintings(here, base + lights + buckets, meta)
    out = write_spawns(path, base + lights + buckets + paintings)
    for (how, where, on), it in zip(report, paintings):
        print(f'  {how:5} {where:8} on {on:15} art {it["art"]}')
    print(f'{len(lights)} flashlights ({sum(1 for it in lights if it["on"])} on), {len(buckets)} buckets and '
          f'{len(paintings)} paintings scattered, {len(out)} placed items')
