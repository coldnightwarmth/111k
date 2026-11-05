"""Build the 111k world: a loop of abandoned collider tunnel with twenty doors
on its outer side, each opening onto a small room. One has been taken over
for a party (tools/office.py); others are a control room, a restroom, a room
someone lives in, and abandoned offices (tools/rooms.py).

    python3 tools/build_world.py [--fast] [--preview]

Writes assets/env/world.{glb,json}, world-lightmap.webp, world-flicker.webp
and src/world-items.js. --fast bakes small and noisy for iteration;
--preview renders views into tools/previews/.

Coordinates: metres, y up. The loop is centred on the origin; angle a runs
around it, with a point at radius r being (r cos a, y, -r sin a).
"""
import json, math, os, sys, time
from types import SimpleNamespace
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'blender'))
import textures as T  # noqa: E402
import graffiti as G  # noqa: E402
from kit import World, Mat, orient, rot  # noqa: E402
from props import Props  # noqa: E402
import rooms  # noqa: E402
import office  # noqa: E402

FAST = '--fast' in sys.argv
OUT = os.path.join(HERE, '..', 'assets', 'env', 'world')
t0 = time.time()

# ------------------------------------------------------------------ layout
RL = 38.0                      # loop centreline radius (~240 m around)
RT, CY = 3.3, 2.0              # tunnel bore radius, height of its centre above the floor
XF = math.sqrt(RT ** 2 - CY ** 2)  # floor half-width (2.62 m)
CROWN = CY + RT                # 5.3 m
DOORS = 20
VW, VTOP = 1.6, 2.9            # door passage width and height
VD = XF + 1.15                 # radial distance of the room's door wall: a thick passage through the lining
ROOM_C = VD + 3.2              # room centre: 3 m inside its door wall + 0.2 m wall
DOOR_W, DOOR_H = 1.2, 2.5
X0, X1, Z0, Z1, CEIL, T_W = -3.5, 3.5, -3.0, 3.0, 3.0, 0.2
door_angles = [2 * math.pi * i / DOORS for i in range(DOORS)]  # door 0 is the party
PARTY, BATHROOM, SQUAT, CONTROL = 0, 4, 7, 10
DARK = math.pi                 # the far side of the loop, where the lamps are out


def u_(a):
    return np.array([math.cos(a), 0.0, -math.sin(a)])


def t_(a):
    return np.array([-math.sin(a), 0.0, -math.cos(a)])


def P(a, x, y):
    """Point at loop angle a, radial offset x from the centreline, height y."""
    return np.array([(RL + x) * math.cos(a), y, -(RL + x) * math.sin(a)])


def wall_x(y):
    return math.sqrt(max(0.0, RT ** 2 - (y - CY) ** 2))


def adist(a, b):
    return abs(math.remainder(a - b, 2 * math.pi))


# cross-section: outer floor edge, up the outer wall (door top), over the crown, down to the inner floor edge
th_f = -math.asin(CY / RT)
th_d = math.asin((VTOP - CY) / RT)
angles = [th_f, (th_f + th_d) / 2, th_d] + list(np.linspace(th_d, math.pi - th_f, 14)[1:])
PROF = np.array([(RT * math.cos(t), max(0.0, CY + RT * math.sin(t))) for t in angles])
PROF[0] = (XF, 0.0); PROF[-1] = (-XF, 0.0)
PROF_S = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(PROF, axis=0), axis=1))])
DOOR_EDGES = {0, 1}            # profile edges removed where a door opens

base = list(np.linspace(0, 2 * math.pi, 129)[:-1])
half = VW / 2 / (RL + 2.8)
bounds = [b for b in base if all(adist(b, d) > half + 0.5 / RL for d in door_angles)]
for d in door_angles:
    bounds += [(d - half) % (2 * math.pi), (d + half) % (2 * math.pi)]
bounds = sorted(bounds)
SEGS = [(bounds[i], bounds[i + 1] if i + 1 < len(bounds) else bounds[0] + 2 * math.pi) for i in range(len(bounds))]
DOOR_SEG = {i for i, (a0, a1) in enumerate(SEGS) if any(adist((a0 + a1) / 2, d) < 1e-6 for d in door_angles)}

# ---------------------------------------------------------------- materials
pal_img = T.palette()
PAL = T.PALETTE
M = {}


def mat(name, *a, **k):
    M[name] = Mat(name, *a, **k)
    return M[name]


mat('tunnel_lining', T.tunnel_lining(), tile=1.6)
mat('tunnel_floor', T.tunnel_floor(), tile=2.0)
mat('safety_paint', T.safety_paint(), tile=1.0)
mat('metal_grey', T.painted_metal(), tile=1.0)
mat('metal_galv', T.painted_metal((0.55, 0.56, 0.55), seed=44), tile=1.0)
mat('metal_teal', T.painted_metal((0.30, 0.42, 0.43), seed=41), tile=1.0)
mat('metal_red', T.painted_metal((0.45, 0.16, 0.12), seed=42), tile=1.0)
mat('metal_beige', T.painted_metal((0.62, 0.58, 0.48), seed=43), tile=1.0)
mat('props', pal_img, tile=1.0)
mat('glow', pal_img, emit=6.0)
mat('lens_dead', pal_img)
mat('lens', pal_img, emit=9.0, lightmap=False)
for g in (1, 2, 3):
    mat(f'lens_g{g}', pal_img, emit=9.0, lightmap=False, group=g)
mat('tube', pal_img, emit=9.0, lightmap=False, group=0)
mat('led_a', pal_img, emit=4.0, lightmap=False, flicker='blink_a')
mat('led_b', pal_img, emit=4.0, lightmap=False, flicker='blink_b')
exit_img = Image.new('RGB', (256, 128), (60, 6, 4)); _d = ImageDraw.Draw(exit_img)
_d.text((22, 14), 'EXIT', font=T._font(92), fill=(255, 70, 50))
mat('exit_sign', exit_img, emit=2.0)
mat('exit_dead', exit_img.point(lambda v: v // 5))
mat('wood', T.wood(), tile=0.9)
mat('cardboard', T.cardboard(), tile=0.6)
mat('ceiling_tile', T.ceiling_tile(), tile=1.2)
mat('floor_vct', T.vct_floor(), tile=1.2)
mat('fabric_chair', T.fabric((0.13, 0.14, 0.16), seed=54), tile=0.4)
mat('fabric_mattress', T.fabric((0.62, 0.6, 0.55), seed=53), tile=0.8)
for name, col in [('navy', (0.12, 0.17, 0.4)), ('green', (0.15, 0.35, 0.18)), ('blue', (0.12, 0.3, 0.62)),
                  ('denim', (0.25, 0.32, 0.5)), ('red', (0.6, 0.12, 0.1)), ('khaki', (0.55, 0.5, 0.35)),
                  ('white', (0.85, 0.84, 0.8)), ('olive', (0.35, 0.38, 0.2))]:
    mat('cloth_' + name, T.fabric(col, seed=60 + len(M)), tile=0.5, double=True)
mat('tile_wall', T.bathroom_tile(), tile=0.6)
mat('mosaic', T.mosaic_floor(), tile=0.6)
mat('mirror', T.painted_metal((0.16, 0.19, 0.2), seed=45), tile=1.0)
mat('console', T.console_panel())
mat('rack', T.rack_front())
mat('mimic', T.mimic_board())
for k in ('term', 'amber', 'blue'):
    mat('screen_' + k, T.screen(k), emit=2.5)
WALLS = [mat('wall_green', T.cinderblock((0.6, 0.67, 0.56), seed=12), tile=0.8),
         mat('wall_beige', T.cinderblock((0.72, 0.67, 0.56), seed=13), tile=0.8),
         mat('wall_blue', T.cinderblock((0.56, 0.62, 0.68), seed=14), tile=0.8)]

# ------------------------------------------------------------------- world
W = World('world')
Pr = Props(W, M, PAL, (X0, X1, Z0, Z1, CEIL, T_W, DOOR_W, DOOR_H))
ITEMS = []


def sweep(profile, mat_, closed=False, skip=None, segs=None, uv_tile=None, axis_pt=(0.0, CY), outward=False):
    """Extrude a 2D cross-section (radial offset, height) around the loop."""
    prof = np.asarray(profile, float)
    edges = [(j, j + 1) for j in range(len(prof) - 1)] + ([(len(prof) - 1, 0)] if closed else [])
    s = np.concatenate([[0], np.cumsum([np.linalg.norm(prof[b] - prof[a]) for a, b in edges])])
    tile = uv_tile or mat_.tile
    for k, (a0, a1) in enumerate(segs if segs is not None else SEGS):
        for e, (ja, jb) in enumerate(edges):
            if skip and skip(k, e):
                continue
            pa, pb = prof[ja], prof[jb]
            pts = [P(a0, *pa), P(a1, *pa), P(a1, *pb), P(a0, *pb)]
            uv = [(s[e] / tile, -a0 * RL / tile), (s[e] / tile, -a1 * RL / tile),
                  (s[e + 1] / tile, -a1 * RL / tile), (s[e + 1] / tile, -a0 * RL / tile)]
            n = np.cross(pts[1] - pts[0], pts[3] - pts[0])
            if (np.dot(n, P((a0 + a1) / 2, *axis_pt) - np.mean(pts, 0)) < 0) != outward:
                pts, uv = pts[::-1], uv[::-1]
            W.face(pts, mat_, uv=uv, world=True)


# ------------------------------------------------------------------ tunnel
with W.using('tunnel', density=1.0):
    sweep(PROF, M['tunnel_lining'], skip=lambda k, e: k in DOOR_SEG and e in DOOR_EDGES)
    sweep([(XF, 0.0), (-XF, 0.0)], M['tunnel_floor'], axis_pt=(0.0, 2.0))
    sweep([(2.35, 0.004), (2.2, 0.004)], M['safety_paint'], axis_pt=(2.27, 1.0))
    sweep([(-2.2, 0.004), (-2.35, 0.004)], M['safety_paint'], axis_pt=(-2.27, 1.0))

with W.using('services', density=0.5):
    ty = 2.75
    sweep([(-2.72, ty + 0.08), (-2.72, ty), (-wall_x(ty) + 0.04, ty)], M['metal_galv'], axis_pt=(0.0, 1.5))
    sweep([(-3.1, ty + 0.01), (-2.78, ty + 0.01), (-2.8, ty + 0.07), (-3.08, ty + 0.07)], M['props'], closed=True,
          axis_pt=(-2.94, ty + 0.04), outward=True, uv_tile=100)
    for (cy, r, mt) in [(4.1, 0.12, M['metal_grey']), (4.45, 0.08, M['metal_galv'])]:
        cx = wall_x(cy) - r - 0.03
        ring = [(cx + r * math.cos(2 * math.pi * i / 8), cy + r * math.sin(2 * math.pi * i / 8)) for i in range(8)]
        sweep(ring, mt, closed=True, axis_pt=(cx, cy), outward=True)
    sweep([(0.22, CROWN - 0.03), (0.3, CROWN - 0.03), (0.3, CROWN - 0.08), (0.22, CROWN - 0.08)], M['metal_galv'],
          closed=True, axis_pt=(0.26, CROWN - 0.055), outward=True)

# the bore's walls as colliders (a box per segment each side), open at the doorways
for k, (a0, a1) in enumerate(SEGS):
    am = (a0 + a1) / 2
    for side in (-1, 1):
        if side == 1 and k in DOOR_SEG:
            continue
        r = RL + side * 2.85
        W.collider_box(P(am, side * 2.85, 0), 0.25, r * math.sin((a1 - a0) / 2) + 0.06, am, 0.0, CROWN)

# ---------------------------------------------------------------- graffiti
room_numbers = [f'B-{i + 1:02d}' for i in range(DOORS)]
stencils = [(f'st_{n.lower()}', (n, (0.86, 0.86, 0.8))) for n in room_numbers]
stencils += [(f'st_ch{k}', (f'N15+{240 + 45 * k:03d}', (0.9, 0.78, 0.18))) for k in range(5)]
pieces = G.build_pieces(seed=11, stencils=stencils)
pages = G.pack_pages(pieces)
rects = {}
for pi, (img, rr) in enumerate(pages):
    mat(f'graffiti_{pi}', img, alpha='BLEND')
    for k, v in rr.items():
        rects[k] = dict(v, page=pi)
print(f'graffiti: {len(pieces)} pieces on {len(pages)} pages ({time.time() - t0:.1f}s)')


def gmat(name):
    return M[f"graffiti_{rects[name]['page']}"]


def prof_at(s):
    s = float(np.clip(s, 0, PROF_S[-1]))
    j = min(int(np.searchsorted(PROF_S, s, side='right')) - 1, len(PROF) - 2)
    f = (s - PROF_S[j]) / (PROF_S[j + 1] - PROF_S[j])
    return PROF[j] + (PROF[j + 1] - PROF[j]) * f


_SS = np.linspace(0, PROF_S[-1], 3000)
_PTS = np.array([prof_at(v) for v in _SS])


def s_for_height(y, side):
    mask = _PTS[:, 0] * side > 0
    return float(_SS[mask][np.argmin(np.abs(_PTS[mask, 1] - y))])


def tunnel_decal(name, a, side, y, scale=1.0, eps=0.012):
    """A decal conforming to the curved wall: a grid over (angle, arc length)."""
    rect = rects[name]
    w, h = rect['size'][0] * scale, rect['size'][1] * scale
    sc = s_for_height(y, side)
    xc = prof_at(sc)[0]
    da = w / 2 / (RL + xc)
    s0, s1 = sc - h / 2, sc + h / 2
    a_s = sorted({a - da, a + da, *[b + k * 2 * math.pi for b in bounds for k in (-1, 0, 1) if a - da < b + k * 2 * math.pi < a + da]})
    s_s = sorted({s0, s1, *[v for v in PROF_S if s0 < v < s1]})
    u0, vb, u1, vt = rect['uv']
    m = gmat(name)
    with W.using('decals', density=0.6):
        for i in range(len(a_s) - 1):
            for j in range(len(s_s) - 1):
                quad, uv = [], []
                for (aa, ss) in [(a_s[i], s_s[j]), (a_s[i + 1], s_s[j]), (a_s[i + 1], s_s[j + 1]), (a_s[i], s_s[j + 1])]:
                    x, yy = prof_at(ss)
                    n = np.array([-x, CY - yy]); n /= np.linalg.norm(n)
                    quad.append(P(aa, x + n[0] * eps, yy + n[1] * eps))
                    fu = (aa - (a - da)) / (2 * da)
                    fu = 1 - fu if side > 0 else fu
                    fv = (ss - s0) / (s1 - s0)
                    fv = fv if side > 0 else 1 - fv
                    uv.append((u0 + (u1 - u0) * fu, vb + (vt - vb) * fv))
                centre = P((a_s[i] + a_s[i + 1]) / 2, 0, CY)
                if np.dot(np.cross(quad[1] - quad[0], quad[3] - quad[0]), centre - np.mean(quad, 0)) < 0:
                    quad, uv = quad[::-1], uv[::-1]
                W.face(quad, m, uv=uv, world=True)


def plane_decal(name, center, right, scale=1.0, up=(0, 1, 0)):
    """A flat decal in the current frame: centre point (already off the wall), right and up vectors."""
    rect = rects[name]
    w, h = rect['size'][0] * scale, rect['size'][1] * scale
    u0, vb, u1, vt = rect['uv']
    c, right, up = np.asarray(center, float), np.asarray(right, float), np.asarray(up, float)
    pts = [c - right * w / 2 - up * h / 2, c + right * w / 2 - up * h / 2, c + right * w / 2 + up * h / 2,
           c - right * w / 2 + up * h / 2]
    with W.using('decals', density=0.6):
        W.face(pts, gmat(name), uv=[(u0, vb), (u1, vb), (u1, vt), (u0, vt)])


WALL_SPEC = {'S': ((0, 0, Z1), (-1, 0, 0), (0, 0, -1)), 'N': ((0, 0, Z0), (1, 0, 0), (0, 0, 1)),
             'W': ((X0, 0, 0), (0, 0, -1), (1, 0, 0)), 'E': ((X1, 0, 0), (0, 0, 1), (-1, 0, 0))}


def room_wall_decal(name, wall, along, y, scale=1.0, eps=0.012):
    """Decal on a room wall in the current room frame; along = offset to the viewer's right."""
    base_, right, inward = (np.array(v, float) for v in WALL_SPEC[wall])
    plane_decal(name, base_ + right * along + np.array([0, y, 0]) + inward * eps, right, scale)


# ------------------------------------------------------------- vestibules
def room_frame(a, door_x):
    yaw = math.atan2(math.cos(a), -math.sin(a))
    return (RL + ROOM_C) * u_(a) - door_x * t_(a), yaw


def vestibule(a, door_x, i):
    """The passage through the lining from the tunnel to a room's door."""
    a0, a1 = a - half, a + half
    origin, yaw = room_frame(a, door_x)
    R = rot(yaw)
    room = lambda p: origin + R @ np.asarray(p, float)
    lo, hi = door_x - VW / 2, door_x + VW / 2
    pl = [P(a0, *PROF[j]) for j in (0, 1, 2)]
    pr = [P(a1, *PROF[j]) for j in (0, 1, 2)]
    ql = [room((lo, 0, Z0 - T_W)), room((lo, VTOP, Z0 - T_W))]
    qr = [room((hi, 0, Z0 - T_W)), room((hi, VTOP, Z0 - T_W))]
    centre = room((door_x, 1.2, Z0 - T_W - 0.5))
    with W.using('tunnel'):
        for poly in ([pl[0], pl[1], pl[2], ql[1], ql[0]], [pr[0], pr[1], pr[2], qr[1], qr[0]], [pl[2], pr[2], qr[1], ql[1]]):
            W.face(orient(poly, centre), M['tunnel_lining'], world=True)
        W.face(orient([pl[0], pr[0], qr[0], ql[0]], centre + np.array([0, 2, 0])), M['tunnel_floor'], world=True)
    with W.frame(origin, yaw):
        dl, dr = door_x - DOOR_W / 2, door_x + DOOR_W / 2
        z = Z0 - T_W
        with W.using('rooms'):
            for x0, x1, y0, y1 in [(lo, dl, 0, VTOP), (dr, hi, 0, VTOP), (dl, dr, DOOR_H, VTOP)]:
                W.face([(x1, y0, z), (x0, y0, z), (x0, y1, z), (x1, y1, z)], WALLS[1])
        depth = VD - XF + 0.4
        for x in (lo - 0.1, hi + 0.1):
            W.collider_box((x, 0, z - depth / 2), 0.1, depth / 2, 0, 0, VTOP)
        plane_decal(f'st_b-{i + 1:02d}', (door_x, (DOOR_H + VTOP) / 2, z - 0.01), (-1, 0, 0))


# ------------------------------------------------------------- the rooms
C = SimpleNamespace(P=Pr, W=W, M=M, WALLS=WALLS)
ctx = dict(W=W, P=Pr, M=M, props=M['props'], glow=M['glow'], metal=M['metal_grey'], door_teal=M['metal_teal'],
           wood=M['wood'], card=M['cardboard'], ceiling=M['ceiling_tile'], vct=M['floor_vct'], tube=M['tube'],
           PAL=PAL, Mat=Mat, T=T, rot=rot, room_wall_decal=room_wall_decal, ITEMS=ITEMS,
           X0=X0, X1=X1, Z0=Z0, Z1=Z1, CEIL=CEIL, DOOR_W=DOOR_W, DOOR_H=DOOR_H, T_W=T_W)
VARIANTS = {1: 'empty', 2: 'office', 3: 'storage', 5: 'office', 6: 'break', 8: 'locked', 9: 'storage', 11: 'locked',
            12: 'break', 13: 'office', 14: 'storage', 15: 'empty', 16: 'locked', 17: 'office', 18: 'empty', 19: 'office'}
LIT = {2, 9, 14, 17}
ROOM_DOOR_X = {}
flicker_lights = []   # (position, assign_group callback) for greedy grouping below

# flicker groups: 0 is the party room's tube; 1-3 go to lamps far enough apart that sharing a group is unnoticeable
GROUP_OF = {}
candidates = []
for i in range(DOORS):
    if i in LIT or i == BATHROOM:
        candidates.append(('room', i, door_angles[i], RL + ROOM_C))
fix_r = np.random.default_rng(9)
FIX = 34
fixture_state = []
prev_on = True
for k in range(FIX):
    a = 2 * math.pi * (k + 0.5) / FIX
    near_party = adist(a, door_angles[PARTY]) < 0.4
    dark = adist(a, DARK) < 0.3
    on = not dark and (near_party or fix_r.random() < 0.58 or not prev_on)
    prev_on = on or dark
    flick = on and not near_party and fix_r.random() < 0.38
    fixture_state.append((a, on, flick))
    if flick:
        candidates.append(('fix', k, a, RL))
assigned = []
for kind, key, a, r in sorted(candidates, key=lambda c: c[2]):
    p = np.array([r * math.cos(a), -r * math.sin(a)])
    best, best_d = 1, -1
    for g in (1, 2, 3):
        d = min([np.linalg.norm(p - q) for q, gg in assigned if gg == g] or [1e9])
        if d > best_d:
            best, best_d = g, d
    assigned.append((p, best))
    GROUP_OF[(kind, key)] = best

for i in range(DOORS):
    a = door_angles[i]
    r = np.random.default_rng(100 + i)
    door_x = 1.6 if i == PARTY else round(float(r.uniform(-1.8, 1.8)), 2)
    ROOM_DOOR_X[i] = door_x
    vestibule(a, door_x, i)
    origin, yaw = room_frame(a, door_x)
    with W.frame(origin, yaw):
        if i == PARTY:
            with W.using('party', density=2.0):
                office.build(ctx, door_x)
            continue
        with W.using('rooms', density=1.0):
            g = GROUP_OF.get(('room', i))
            if i == CONTROL:
                rooms.control_room(C, door_x, r)
            elif i == BATHROOM:
                rooms.bathroom(C, door_x, r, group=g)
            elif i == SQUAT:
                rooms.squatter_room(C, door_x, r)
            else:
                rooms.plain_room(C, i, door_x, VARIANTS[i], r, lit=i in LIT, group=g)

# ------------------------------------------------------------ tunnel lights
for k, (a, on, flick) in enumerate(fixture_state):
    g = GROUP_OF.get(('fix', k)) if flick else None
    with W.using('services'), W.frame(P(a, 0, CROWN - 0.14), a):
        Pr.box((0, 0.07, 0), (0.28, 0.1, 0.5), 'charcoal')
        for dz in (-0.18, 0, 0.18):
            Pr.box((0, -0.04, dz), (0.24, 0.02, 0.015), 'steel')
        lens = (M[f'lens_g{g}'] if g else M['lens']) if on else M['lens_dead']
        W.face(orient([(-0.09, -0.02, -0.2), (0.09, -0.02, -0.2), (0.09, -0.02, 0.2), (-0.09, -0.02, 0.2)], (0, -1, 0)),
               lens, uv=np.tile(Pr.sw('white' if on else 'glass'), (4, 1)))
    if on:
        cold = fix_r.random() < 0.7
        W.light(P(a, 0, CROWN - 0.35), (0.8, 0.9, 1.0) if cold else (1.0, 0.72, 0.42), 3.6, 12.0, radius=0.12,
                name=f'fix{k}', flicker='fluorescent' if g else None, runtime_intensity=1.6, group=g)

# ------------------------------------------------------------ tunnel props
party_a = door_angles[PARTY]


def at(a, x, y=0.0):
    return P(a, x, y)


with W.using('props', density=1.0):
    # generator outside the party room, cords running in
    ga = party_a + 0.045
    with W.frame(at(ga, 1.95), ga):
        W.box((0, 0.32, 0), (0.55, 0.5, 0.8), M['metal_red'], collide=True)
        Pr.rbox((0, 0.62, 0), (0.6, 0.06, 0.85), 'black', ch=0.02)
        Pr.cyl((0, 0.06, -0.3), 0.08, 0.06, 'black', axis='x', sides=8)
        Pr.cyl((0, 0.06, 0.3), 0.08, 0.06, 'black', axis='x', sides=8)
        Pr.tube((-0.28, 0.1, 0.4), (-0.28, 0.65, 0.4), 0.015, 'black')
        Pr.tube((0.28, 0.1, 0.4), (0.28, 0.65, 0.4), 0.015, 'black')
    cord = [at(ga, 1.7, 0.01), at(party_a + 0.02, 2.0, 0.01), at(party_a + 0.004, 2.8, 0.01), at(party_a, VD, 0.01)]
    for p, q in zip(cord[:-1], cord[1:]):
        Pr.tube(p, q, 0.011, 'orange', sides=4)
    Pr.camp_chair(*at(party_a - 0.05, 1.5)[[0, 2]], party_a + 1.2, 'navy')
    Pr.camp_chair(*at(party_a - 0.075, 0.9)[[0, 2]], party_a + 2.3, 'green')
    Pr.camp_chair(*at(party_a + 0.08, -1.6)[[0, 2]], party_a - 1.3, 'red')

    def strand(a0, a1, x, y, sag, n, colors, name):
        pts = [P(a0 + (a1 - a0) * t, x, y - sag * 4 * t * (1 - t)) for t in np.linspace(0, 1, 25)]
        for p, q in zip(pts[:-1], pts[1:]):
            Pr.tube(p, q, 0.004, 'black', sides=3, caps=False)
        bulbs = []
        for i in range(n):
            t = (i + 0.5) / n
            p = P(a0 + (a1 - a0) * t, x, y - sag * 4 * t * (1 - t) - 0.04)
            Pr.rbox(p, (0.035, 0.05, 0.035), colors[i % len(colors)], mat=M['glow'], ch=0.008)
            bulbs.append(p)
        W.light(np.mean(bulbs, 0), (1.0, 0.55, 0.35), 0.5, 6.0, radius=1.2, name=name, bake=False)
        for p in bulbs[::3]:
            W.bake_lights.append({'pos': p, 'color': (1.0, 0.6, 0.35), 'intensity': 0.06, 'radius': 0.03, 'area': None})
    strand(party_a - 0.13, party_a - half - 0.01, 2.45, 3.1, 0.25, 22, ['warm', 'orange', 'warm', 'red'], 'str_out_a')
    strand(party_a + half + 0.01, party_a + 0.11, 2.45, 3.1, 0.3, 18, ['warm', 'yellow', 'warm', 'red'], 'str_out_b')
    gr_ = np.random.default_rng(13)
    for k in range(9):   # glow sticks
        p = at(party_a + gr_.uniform(-0.12, 0.12), gr_.uniform(-2.0, 2.0), 0.012)
        W.box(p, (0.15, 0.015, 0.015), M['glow'], yaw=gr_.uniform(0, 6.28), world_uv=False,
              uv_const=Pr.sw(['ledgreen', 'pink', 'yellow', 'ledblue'][k % 4]))
    # abandoned stuff around the loop
    junk_r = np.random.default_rng(21)
    for k in range(30):
        aa = junk_r.uniform(0, 2 * math.pi)
        if adist(aa, party_a) < 0.2 or any(adist(aa, d) < 0.05 for d in door_angles):
            continue
        x = junk_r.choice([-1, 1]) * junk_r.uniform(1.6, 2.1)
        kind = junk_r.choice(['pallet', 'spool', 'cones', 'drum', 'boxes', 'pipes', 'ladder', 'bucket', 'chair', 'cart'])
        with W.frame(at(aa, x), aa + junk_r.uniform(-0.3, 0.3)):
            if kind == 'pallet':
                for dz in (-0.45, 0, 0.45):
                    W.box((0, 0.05, dz), (1.0, 0.1, 0.1), M['wood'])
                for dx in (-0.42, -0.14, 0.14, 0.42):
                    W.box((dx, 0.12, 0), (0.12, 0.02, 1.1), M['wood'])
                W.collider_box((0, 0, 0), 0.5, 0.55, 0, 0, 0.14)
            elif kind == 'spool':
                for dz in (-0.3, 0.3):
                    W.cylinder((0, 0.45, dz), 0.45, 0.05, M['wood'], axis='z', sides=12)
                W.cylinder((0, 0.45, -0.3), 0.18, 0.6, M['wood'], axis='z', sides=8, caps=False)
                W.collider_circle((0, 0, 0), 0.45, 0, 0.9)
            elif kind == 'cones':
                for j in range(junk_r.integers(1, 4)):
                    c = (junk_r.uniform(-0.4, 0.4), 0, junk_r.uniform(-0.6, 0.6))
                    Pr.box((c[0], 0.01, c[2]), (0.3, 0.02, 0.3), 'orange')
                    Pr.cyl(c, 0.13, 0.5, 'orange', sides=8, top=0.02)
            elif kind == 'drum':
                Pr.cyl((0, 0, 0), 0.29, 0.88, 'blue' if junk_r.random() < 0.5 else 'rust', sides=12, collide=True)
            elif kind == 'boxes':
                for j in range(junk_r.integers(2, 5)):
                    W.box((junk_r.uniform(-0.3, 0.3), 0.2 + 0.4 * (j // 2), junk_r.uniform(-0.4, 0.4)), (0.5, 0.4, 0.45),
                          M['cardboard'], yaw=junk_r.uniform(-0.4, 0.4), world_uv=False)
                W.collider_box((0, 0, 0), 0.45, 0.55, 0, 0, 0.8)
            elif kind == 'pipes':
                for j in range(3):
                    Pr.cyl(((-0.11, 0.11, 0.0)[j], 0.1 + 0.19 * (j == 2), -1.0), 0.1, 2.0, 'steel', axis='z', sides=8)
                W.collider_box((0, 0, 0), 0.3, 1.0, 0, 0, 0.35)
            elif kind == 'ladder':
                for dx in (-0.22, 0.22):
                    Pr.box((dx, 0.03, 0), (0.06, 0.06, 2.4), 'yellow')
                for j in range(8):
                    Pr.box((0, 0.03, -1.05 + j * 0.3), (0.44, 0.03, 0.04), 'yellow')
            elif kind == 'chair':
                Pr.office_chair(0, 0, junk_r.uniform(0, 6.28), tipped=junk_r.random() < 0.6)
            elif kind == 'cart':
                Pr.rbox((0, 0.35, 0), (0.5, 0.5, 0.8), 'grey', ch=0.03)
                for sx in (-0.2, 0.2):
                    for sz in (-0.32, 0.32):
                        Pr.cyl((sx, 0.04, sz), 0.05, 0.04, 'black', axis='x', sides=6)
                W.collider_box((0, 0, 0), 0.26, 0.42, 0, 0, 0.6)
            else:
                Pr.cyl((0, 0, 0), 0.15, 0.36, 'white', sides=8, top=0.17)
    # small debris all the way round: along the walls mostly, some down the middle
    deb_r = np.random.default_rng(23)
    for k in range(420):
        aa = deb_r.uniform(0, 2 * math.pi)
        x = deb_r.choice([-1, 1]) * (2.45 - abs(deb_r.normal(0, 0.55)))
        if deb_r.random() < 0.2:
            x = deb_r.uniform(-1.5, 1.5)
        if abs(x) > 2.5:
            continue
        p = at(aa, x)
        Pr.debris(deb_r, p[0], p[2])

ITEMS.append({'type': 'flashlight', **{k: round(float(v), 3) for k, v in zip('xyz', at(DARK - 0.42, -1.3, 0.03))}, 'yaw': 1.1})

# ------------------------------------------------------ graffiti placement
with W.using('decals', density=0.6):
    gr = np.random.default_rng(33)
    door_keepout = lambda a, w: any(adist(a, d) < half + (w / 2 + 0.3) / RL for d in door_angles)
    cat = lambda *pre: [k for k in rects if k.startswith(pre)]
    big, mids = cat('tu_', 'pc_', 'rl_', 'fx_'), cat('tag_', 'sc_', 'dd_', 'sn_')
    small = cat('mk_')
    # the party door gets the most paint
    plan = [('pc_waxy', -0.075, 1, 1.4), ('tu_nova', 0.07, 1, 1.3), ('tag_111k_big', -0.035, 1, 2.2),
            ('mk_hum', 0.035, 1, 1.2), ('tu_ssc', 0.0, -1, 1.5), ('tu_echo', -0.09, -1, 1.4), ('tag_jinx', 0.06, -1, 1.8),
            ('dd_arrow', 0.03, 1, 1.0), ('mk_loop', 0.1, 1, 1.5), ('pc_gremlins', 0.16, -1, 1.45),
            ('sc_wecould', -0.12, 1, 2.3), ('tu_creamy', -0.17, -1, 1.5), ('hs_drifella', 0.13, 1, 1.9),
            ('buff_grey', 0.24, -1, 1.4), ('tag_mute', 0.242, -1, 1.5)]
    used = set()
    for name, da, side, y in plan:
        if name in rects:
            tunnel_decal(name, party_a + da, side, y, eps=0.012 + 0.004 * (name == 'tag_mute'))
            used.add(name)
    # everything else, at least once, spread round the loop; bigger work low, tags high, notes at eye level
    order = [k for k in big + mids + small + cat('hs_', 'ex_') if k not in used]
    gr.shuffle(order)
    order += list(gr.choice(big + mids, size=24))  # favourites turn up more than once
    for n, name in enumerate(order):
        w, h = rects[name]['size']
        for _ in range(20):
            aa = (party_a + 0.3 + (n + gr.uniform(-0.4, 0.4)) / len(order) * (2 * math.pi - 0.6)) % (2 * math.pi)
            side = gr.choice([-1, 1])
            if side == 1 and door_keepout(aa, w):
                continue
            break
        if name.startswith(('tu_', 'pc_', 'rl_')):
            y = h / 2 + gr.uniform(0.35, 0.7)
        elif name.startswith(('mk_', 'ex_')):
            y = gr.uniform(1.15, 1.7)
        else:
            y = gr.uniform(1.4, 2.6)
        tunnel_decal(name, aa, side, min(y, 3.0), eps=0.011 + 0.003 * (n % 4))
    for k in range(5):
        tunnel_decal(f'st_ch{k}', 0.6 + k * 1.2, -1, 1.25)
    # rooms: a few pieces on random walls (not the party room, which has its own plan)
    room_pool = cat('tag_', 'mk_', 'dd_', 'sc_', 'hs_', 'ex_')
    for i in range(DOORS):
        if i in (PARTY,) or VARIANTS.get(i) == 'locked':
            continue
        origin, yaw = room_frame(door_angles[i], ROOM_DOOR_X[i])
        with W.frame(origin, yaw):
            n = 2 if i == CONTROL else 6 if i in (BATHROOM, SQUAT) else int(gr.integers(2, 5))
            for j in range(n):
                name = gr.choice(room_pool)
                w = rects[name]['size'][0]
                wall = gr.choice(['S', 'W', 'E'] if i != CONTROL else ['S'])
                span = (X1 - X0) if wall == 'S' else (Z1 - Z0)
                along = gr.uniform(-span / 2 + w / 2 + 0.2, max(-span / 2 + w / 2 + 0.25, span / 2 - w / 2 - 0.2))
                room_wall_decal(name, wall, along, float(gr.uniform(1.2, 2.2)), eps=0.012 + 0.003 * j)
            if i == BATHROOM:  # tags on the stall partitions and doors
                for j, z in enumerate((-2.2, -1.2, -0.2)):
                    name = gr.choice(cat('mk_', 'ex_', 'tag_'))
                    plane_decal(name, (2.7, 1.3, z - 0.02), (1, 0, 0), scale=0.6)
print(f'geometry done ({time.time() - t0:.1f}s)')


# ------------------------------------------------------------------- grime
def noise3(p, scale, seed=0):
    r = np.random.default_rng(seed)
    acc = np.zeros(len(p))
    for k in range(5):
        dvec = r.normal(size=3); dvec /= np.linalg.norm(dvec)
        acc += np.sin(p @ dvec * scale * (1.7 ** k) + r.random() * 6.28) / (1.6 ** k)
    return acc / 2.2 * 0.5 + 0.5


def grime(Pp, N):
    y = Pp[:, 1]
    rr = np.hypot(Pp[:, 0], Pp[:, 2]) - RL
    tunnel = (np.abs(rr) < RT + 0.15) & (y < CROWN + 0.2)
    g = 0.82 + 0.3 * noise3(Pp, 0.7, 3)
    wall = np.abs(N[:, 1]) < 0.7
    floor = N[:, 1] >= 0.7
    g[wall] *= 1 - 0.35 * np.exp(-y[wall] / 0.4)
    streak = noise3(np.stack([Pp[:, 0] * 4, Pp[:, 1] * 0.12, Pp[:, 2] * 4], 1), 1.0, 5)
    g[wall] *= 1 - 0.25 * np.clip(streak[wall] - 0.6, 0, 1) * 3
    tf = floor & tunnel
    g[tf] *= 1 - 0.4 * np.exp(-(XF - np.abs(rr[tf])) / 0.4)
    damp = noise3(Pp * np.array([0.6, 0, 0.6]), 0.5, 8)
    g[tf] *= 1 - 0.3 * np.clip(damp[tf] - 0.55, 0, 1) * 3
    crown = tunnel & (y > CROWN - 1.0)
    g[crown] *= 0.85 + 0.15 * noise3(Pp[crown], 2.0, 9)
    ceil = N[:, 1] < -0.7
    g[ceil & ~tunnel] *= 0.9 + 0.1 * noise3(Pp[ceil & ~tunnel], 1.5, 11)
    return g


# ------------------------------------------------------------------- meta
W.meta = {'name': 'world', 'ambient': [0.035, 0.035, 0.045], 'fog': {'color': '#060607', 'near': 14, 'far': 62},
          'bore': {'loop': RL, 'radius': RT, 'centre': CY, 'floorHalf': XF, 'passage': VD, 'passageTop': VTOP, 'roomCeiling': CEIL},
          'loop': {'radius': RL, 'doors': [{'angle': round(a, 5), 'room': room_numbers[i]} for i, a in enumerate(door_angles)]}}


def write_items():
    items = [{'id': f'fl{k + 1}', **it} for k, it in enumerate(ITEMS)]
    with open(os.path.join(HERE, '..', 'src', 'world-items.js'), 'w') as f:
        f.write('// Written by tools/build_world.py: where held items start. Shared by the client and the server.\n')
        f.write(f'export const ITEM_SPAWNS = Object.freeze({json.dumps(items)});\n')


if __name__ == '__main__':
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    write_items()
    pr = os.path.join(HERE, 'previews')
    os.makedirs(pr, exist_ok=True)

    def room_cam(i, x, z, yaw, pitch=0.0, fov=60):
        origin, ry = room_frame(door_angles[i], ROOM_DOOR_X[i])
        p = origin + rot(ry) @ np.array([x, 1.6, z])
        return (tuple(p), ry + yaw, pitch, fov)

    def tun_cam(a, x, yaw, pitch=0.0, fov=62):
        return (tuple(P(a, x, 1.6)), yaw, pitch, fov)
    cams = []
    if '--preview' in sys.argv:
        pa = party_a
        cams = [
            ('office_a', room_cam(PARTY, 0.0, 1.6, 0.55)),
            ('office_b', room_cam(PARTY, -0.2, -1.6, math.pi - 0.4)),
            ('tunnel_door', tun_cam(pa - 0.12, -0.9, pa - 0.3)),
            ('tunnel_back', tun_cam(pa + 0.16, 0.7, pa + math.pi + 0.35, 0.02)),
            ('tunnel_dark', tun_cam(DARK - 0.45, 0.3, DARK - 0.45, 0.04)),
            ('control', room_cam(CONTROL, 0.0, -1.8, math.pi, -0.05)),
            ('bathroom', room_cam(BATHROOM, -1.8, -1.8, math.pi * 0.8, -0.1)),
            ('squat', room_cam(SQUAT, 1.8, -1.6, math.pi * 1.2, -0.15)),
        ]
    W.build(OUT, lm_size=1024 if FAST else 2048, samples=24 if FAST else 160, ambient=(0.004, 0.004, 0.005),
            grime=grime, previews=cams, preview_dir=pr, fill=(0.03, 0.03, 0.034), group_samples=16 if FAST else 64,
            chunk=lambda c: (np.floor((np.arctan2(-c[:, 2], c[:, 0]) % (2 * math.pi)) / (2 * math.pi) * 16 + 0.5) % 16).astype(int))
    print(f'done in {time.time() - t0:.1f}s')
