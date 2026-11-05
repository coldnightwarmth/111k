"""Build the 111k world: a loop of abandoned collider tunnel with twenty doors
on its outer side, each opening onto a small office. One office has been
taken over for a party (tools/office.py); the rest are in various states of
abandonment.

    python3 tools/build_world.py [--fast] [--preview]

Writes assets/env/world.{glb,json} and world-lightmap.png. --fast bakes a
small, noisy lightmap for quick iteration; --preview renders a few views
into tools/previews/.

Coordinates: metres, y up. The loop is centred on the origin; angle a runs
around it, with a point at radius r being (r cos a, y, -r sin a).
"""
import math, os, sys, time
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'blender'))
import textures as T  # noqa: E402
import graffiti as G  # noqa: E402
from kit import World, Mat, orient, rot  # noqa: E402

FAST = '--fast' in sys.argv
OUT = os.path.join(HERE, '..', 'assets', 'env', 'world')
t0 = time.time()

# ------------------------------------------------------------------ layout
RL = 36.0                      # loop centreline radius (~226 m around)
RT, CY = 2.8, 1.7              # tunnel bore radius, height of its centre above the floor
XF = math.sqrt(RT ** 2 - CY ** 2)  # floor half-width (2.22 m)
DOORS = 20
VW, VTOP, VD = 1.6, 2.9, 3.3   # vestibule width, height, radial distance of the office wall
ROOM_C = VD + 3.2              # office centre: 3 m inside its door wall + 0.2 m wall
DOOR_W, DOOR_H = 1.2, 2.5
X0, X1, Z0, Z1, CEIL, T_W = -3.5, 3.5, -3.0, 3.0, 3.0, 0.2
door_angles = [2 * math.pi * i / DOORS for i in range(DOORS)]  # door 0 is the party


def u_(a):
    return np.array([math.cos(a), 0.0, -math.sin(a)])


def t_(a):
    return np.array([-math.sin(a), 0.0, -math.cos(a)])


def P(a, x, y):
    """Point at loop angle a, radial offset x from the centreline, height y."""
    return np.array([(RL + x) * math.cos(a), y, -(RL + x) * math.sin(a)])


# tunnel cross-section: outer floor edge, up the outer wall (door top), over the crown, down to the inner floor edge
th_f = -math.asin(CY / RT)
th_d = math.asin((VTOP - CY) / RT)
angles = [th_f, (th_f + th_d) / 2, th_d] + list(np.linspace(th_d, math.pi - th_f, 13)[1:])
PROF = np.array([(RT * math.cos(t), max(0.0, CY + RT * math.sin(t))) for t in angles])
PROF[0] = (XF, 0.0); PROF[-1] = (-XF, 0.0)
PROF_S = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(PROF, axis=0), axis=1))])
DOOR_EDGES = {0, 1}            # profile edges removed where a door opens

# loop segmentation: uniform, plus exact boundaries at each doorway
base = list(np.linspace(0, 2 * math.pi, 129)[:-1])
half = VW / 2 / (RL + 2.4)
bounds = []
for b in base:
    if all(abs(math.remainder(b - d, 2 * math.pi)) > half + 0.5 / RL for d in door_angles):
        bounds.append(b)
for d in door_angles:
    bounds += [(d - half) % (2 * math.pi), (d + half) % (2 * math.pi)]
bounds = sorted(bounds)
SEGS = [(bounds[i], bounds[i + 1] if i + 1 < len(bounds) else bounds[0] + 2 * math.pi) for i in range(len(bounds))]
DOOR_SEG = {i for i, (a0, a1) in enumerate(SEGS)
            if any(abs(math.remainder((a0 + a1) / 2 - d, 2 * math.pi)) < 1e-6 for d in door_angles)}

# ---------------------------------------------------------------- materials
pal_img = T.palette()
PAL = T.PALETTE
lining = Mat('tunnel_lining', T.tunnel_lining(), tile=1.5)
tfloor = Mat('tunnel_floor', T.tunnel_floor(), tile=2.0)
safety = Mat('safety_paint', T.safety_paint(), tile=1.0)
metal = Mat('metal_grey', T.painted_metal(), tile=1.0)
galv = Mat('metal_galv', T.painted_metal((0.55, 0.56, 0.55), seed=44), tile=1.0)
door_teal = Mat('metal_teal', T.painted_metal((0.30, 0.42, 0.43), seed=41), tile=1.0)
door_red = Mat('metal_red', T.painted_metal((0.45, 0.16, 0.12), seed=42), tile=1.0)
props = Mat('props', pal_img, tile=1.0)
glow = Mat('glow', pal_img, emit=6.0)
dead_glass = Mat('lens_dead', pal_img)
lens = Mat('lens', pal_img, emit=9.0, lightmap=False)
exit_img = Image.new('RGB', (256, 128), (60, 6, 4)); _d = ImageDraw.Draw(exit_img)
_d.text((22, 14), 'EXIT', font=T._font(92), fill=(255, 70, 50))
exit_mat = Mat('exit_sign', exit_img, emit=2.0)
exit_dead = Mat('exit_dead', exit_img.point(lambda v: v // 5), lightmap=True)
wood = Mat('wood', T.wood(), tile=0.9)
card = Mat('cardboard', T.cardboard(), tile=0.6)
ceiling = Mat('ceiling_tile', T.ceiling_tile(), tile=1.2)
vct = Mat('floor_vct', T.vct_floor(), tile=1.2)
WALLS = {'green': Mat('wall_green', T.cinderblock((0.6, 0.67, 0.56), seed=12), tile=0.8),
         'beige': Mat('wall_beige', T.cinderblock((0.72, 0.67, 0.56), seed=13), tile=0.8),
         'blue': Mat('wall_blue', T.cinderblock((0.56, 0.62, 0.68), seed=14), tile=0.8)}


def sw(name):
    return PAL[name]


# ------------------------------------------------------------------- world
W = World('world')


def pbox(center, size, color, mat=None, **kw):
    W.box(center, size, mat or props, world_uv=False, uv_const=sw(color), **kw)


def pcyl(base, r, h, color, mat=None, **kw):
    W.cylinder(base, r, h, mat or props, uv_const=sw(color), **kw)


# ------------------------------------------------------------------ sweeps
def sweep(profile, mat, closed=False, skip=None, facing=None, segs=None, uv_tile=None, axis_pt=(0.0, CY),
          outward=False):
    """Extrude a 2D cross-section (radial offset, height) around the loop."""
    prof = np.asarray(profile, float)
    edges = [(j, j + 1) for j in range(len(prof) - 1)] + ([(len(prof) - 1, 0)] if closed else [])
    s = np.concatenate([[0], np.cumsum([np.linalg.norm(prof[b] - prof[a]) for a, b in edges])])
    tile = uv_tile or mat.tile
    for k, (a0, a1) in enumerate(segs if segs is not None else SEGS):
        for e, (ja, jb) in enumerate(edges):
            if skip and skip(k, e):
                continue
            pa, pb = prof[ja], prof[jb]
            pts = [P(a0, *pa), P(a1, *pa), P(a1, *pb), P(a0, *pb)]
            uv = [(s[e] / tile, -a0 * RL / tile), (s[e] / tile, -a1 * RL / tile),
                  (s[e + 1] / tile, -a1 * RL / tile), (s[e + 1] / tile, -a0 * RL / tile)]
            n = np.cross(pts[1] - pts[0], pts[3] - pts[0])
            flip = np.dot(n, P((a0 + a1) / 2, *axis_pt) - np.mean(pts, 0)) < 0
            if flip != outward:
                pts, uv = pts[::-1], uv[::-1]
            W.face(pts, mat, uv=uv, world=True)


def seg_of(a):
    a %= 2 * math.pi
    for k, (a0, a1) in enumerate(SEGS):
        if a0 <= a < a1 or a0 <= a + 2 * math.pi < a1:
            return k
    return 0


# ------------------------------------------------------------------ tunnel
with W.using('tunnel', density=1.0):
    sweep(PROF, lining, skip=lambda k, e: k in DOOR_SEG and e in DOOR_EDGES)
    sweep([(XF, 0.0), (-XF, 0.0)], tfloor, axis_pt=(0.0, 2.0))
    # worn safety lines along both floor edges
    sweep([(1.95, 0.004), (1.8, 0.004)], safety, axis_pt=(1.9, 1.0))
    sweep([(-1.8, 0.004), (-1.95, 0.004)], safety, axis_pt=(-1.9, 1.0))

with W.using('services', density=0.5):
    # cable tray + cable bundle on the inner wall, two pipes high on the outer wall, crown conduit
    sweep([(-2.2, 2.53), (-2.2, 2.45), (-2.62, 2.45)], galv, axis_pt=(0.0, 1.5))
    sweep([(-2.55, 2.46), (-2.25, 2.46), (-2.27, 2.52), (-2.53, 2.52)], props, closed=True, axis_pt=(-2.4, 2.49),
          outward=True, uv_tile=100)
    for (cx, cy, r, mt) in [(1.95, 3.5, 0.11, metal), (1.66, 3.82, 0.075, galv)]:
        ring = [(cx + r * math.cos(2 * math.pi * i / 8), cy + r * math.sin(2 * math.pi * i / 8)) for i in range(8)]
        sweep(ring, mt, closed=True, axis_pt=(cx, cy), outward=True)
    sweep([(0.22, 4.47), (0.3, 4.47), (0.3, 4.42), (0.22, 4.42)], galv, closed=True, axis_pt=(0.26, 4.445), outward=True)

# floor colliders: walls of the bore (a box per segment each side), skipping doorways
for k, (a0, a1) in enumerate(SEGS):
    am = (a0 + a1) / 2
    for side in (-1, 1):
        if side == 1 and k in DOOR_SEG:
            continue
        r = RL + side * 2.45
        half_len = r * math.sin((a1 - a0) / 2) + 0.06
        c = P(am, side * 2.45, 0)
        W.collider_box(c, 0.25, half_len, am, 0.0, 4.5)  # local x radial: yaw am turns +x onto u(am)

# ------------------------------------------------------------- tunnel decals
def prof_at(s):
    s = float(np.clip(s, 0, PROF_S[-1]))
    j = min(int(np.searchsorted(PROF_S, s, side='right')) - 1, len(PROF) - 2)
    f = (s - PROF_S[j]) / (PROF_S[j + 1] - PROF_S[j])
    return PROF[j] + (PROF[j + 1] - PROF[j]) * f


def s_for_height(y, side):
    """Arc length on the profile at height y on the outer (+1) or inner (-1) wall."""
    ss = np.linspace(0, PROF_S[-1], 2000)
    pts = np.array([prof_at(v) for v in ss])
    mask = pts[:, 0] * side > 0
    return float(ss[mask][np.argmin(np.abs(pts[mask, 1] - y))])


def tunnel_decal(mat, rects, name, a, side, y, scale=1.0, eps=0.012):
    """A decal conforming to the curved wall: a grid over (angle, arc length)."""
    rect = rects[name]
    w, h = rect['size'][0] * scale, rect['size'][1] * scale
    sc = s_for_height(y, side)
    xc = prof_at(sc)[0]
    da = w / 2 / (RL + xc)
    s0, s1 = sc - h / 2, sc + h / 2
    a_s = sorted({a - da, a + da, *[b for b in bounds if a - da < b < a + da],
                  *[b + 2 * math.pi for b in bounds if a - da < b + 2 * math.pi < a + da]})
    s_s = sorted({s0, s1, *[v for v in PROF_S if s0 < v < s1]})
    u0, vb, u1, vt = rect['uv']
    for i in range(len(a_s) - 1):
        for j in range(len(s_s) - 1):
            quad, uv = [], []
            for (aa, ss) in [(a_s[i], s_s[j]), (a_s[i + 1], s_s[j]), (a_s[i + 1], s_s[j + 1]), (a_s[i], s_s[j + 1])]:
                x, yy = prof_at(ss)
                n = np.array([-x, CY - yy]); n /= np.linalg.norm(n)
                quad.append(P(aa, x + n[0] * eps, yy + n[1] * eps))
                fu = (aa - (a - da)) / (2 * da)
                fu = 1 - fu if side > 0 else fu        # read left-to-right from inside the tunnel
                fv = (ss - s0) / (s1 - s0)
                fv = fv if side > 0 else 1 - fv        # up the wall
                uv.append((u0 + (u1 - u0) * fu, vb + (vt - vb) * fv))
            # wind toward the tunnel axis
            centre = P((a_s[i] + a_s[i + 1]) / 2, 0, CY)
            n_ = np.cross(quad[1] - quad[0], quad[3] - quad[0])
            if np.dot(n_, centre - np.mean(quad, 0)) < 0:
                quad, uv = quad[::-1], uv[::-1]
            W.face(quad, mat, uv=uv, world=True)


# ------------------------------------------------------------- vestibules
def room_frame(a, door_x):
    yaw = math.atan2(math.cos(a), -math.sin(a))
    origin = (RL + ROOM_C) * u_(a) - door_x * t_(a)
    return origin, yaw


def vestibule(a, door_x, stencil_name=None):
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
        for poly in ([pl[0], pl[1], pl[2], ql[1], ql[0]], [pr[0], pr[1], pr[2], qr[1], qr[0]],
                     [pl[2], pr[2], qr[1], ql[1]]):
            W.face(orient(poly, centre), lining, world=True)
        W.face(orient([pl[0], pr[0], qr[0], ql[0]], centre + np.array([0, 2, 0])), tfloor, world=True)
    with W.frame(origin, yaw):
        wall = WALLS['beige']
        dl, dr = door_x - DOOR_W / 2, door_x + DOOR_W / 2
        z = Z0 - T_W
        with W.using('rooms'):
            for x0, x1, y0, y1 in [(lo, dl, 0, VTOP), (dr, hi, 0, VTOP), (dl, dr, DOOR_H, VTOP)]:
                W.face([(x1, y0, z), (x0, y0, z), (x0, y1, z), (x1, y1, z)], wall)
        # side walls of the passage, as colliders
        for x in (lo - 0.1, hi + 0.1):
            W.collider_box((x, 0, z - 0.75), 0.1, 0.75, 0, 0, VTOP)
        if stencil_name:
            with W.using('decals', density=0.6):
                r_ = rects[stencil_name]; w, h = r_['size']
                u0, vb, u1, vt = r_['uv']; yc = (DOOR_H + VTOP) / 2; zz = z - 0.01
                W.face([(door_x + w / 2, yc - h / 2, zz), (door_x - w / 2, yc - h / 2, zz), (door_x - w / 2, yc + h / 2, zz),
                        (door_x + w / 2, yc + h / 2, zz)], graf, uv=[(u0, vb), (u1, vb), (u1, vt), (u0, vt)])


# ---------------------------------------------------------------- graffiti
room_numbers = [f'B-{i + 1:02d}' for i in range(DOORS)]
stencils = [(f'st_{n.lower()}', (n, (0.86, 0.86, 0.8))) for n in room_numbers]
stencils += [(f'st_ch{k}', (f'N15+{240 + 45 * k:03d}', (0.9, 0.78, 0.18))) for k in range(5)]
pieces = G.build_pieces(seed=11, stencils=stencils)
graf_img, rects = G.pack(pieces)
graf = Mat('graffiti', graf_img, alpha='BLEND')
print(f'graffiti atlas {graf_img.size} ({time.time() - t0:.1f}s)')

# ------------------------------------------------------------------ office
import office  # noqa: E402

ctx = dict(W=W, pbox=pbox, pcyl=pcyl, props=props, glow=glow, metal=metal, door_teal=door_teal, wood=wood, card=card,
           graf=graf, rects=rects, exit_mat=exit_mat, tube=Mat('tube', pal_img, emit=9.0, lightmap=False), PAL=PAL, Mat=Mat, T=T, ceiling=ceiling, vct=vct, rot=rot)

# ---------------------------------------------------------- plain offices
rng = np.random.default_rng(5)
VARIANTS = ['empty', 'office', 'storage', 'locked', 'office', 'break', 'empty', 'locked', 'storage', 'office',
            'empty', 'locked', 'break', 'office', 'storage', 'empty', 'locked', 'office', 'empty']
LIT = {2, 9, 14}  # rooms with one fluorescent still working


def ceiling_with_holes(holes, mat=ceiling, plenum=True):
    """Drop ceiling of 0.6 m tiles; `holes` is a set of (col, row) missing tiles."""
    cols, rows = int((X1 - X0) / 0.6) + 1, int((Z1 - Z0) / 0.6) + 1
    for r in range(rows):
        z0, z1 = Z0 + r * 0.6, min(Z1, Z0 + (r + 1) * 0.6)
        if z0 >= Z1:
            break
        c = 0
        while c < cols:
            if (c, r) in holes:
                c += 1; continue
            c1 = c
            while c1 < cols and (c1, r) not in holes:
                c1 += 1
            x0, x1 = X0 + c * 0.6, min(X1, X0 + c1 * 0.6)
            W.face([(x0, CEIL, z0), (x0, CEIL, z1), (x1, CEIL, z1), (x1, CEIL, z0)], mat,
                   uv=[(x0 / 1.2, -z0 / 1.2), (x0 / 1.2, -z1 / 1.2), (x1 / 1.2, -z1 / 1.2), (x1 / 1.2, -z0 / 1.2)])
            c = c1
    if plenum:
        for (c, r) in holes:
            x0, z0 = X0 + c * 0.6, Z0 + r * 0.6
            x1, z1 = min(X1, x0 + 0.6), min(Z1, z0 + 0.6)
            pbox(((x0 + x1) / 2, CEIL + 0.45, (z0 + z1) / 2), (x1 - x0, 0.9, z1 - z0), 'black', faces='-y+x-x+z-z')


def room_shell(wall, door_x, door_state, rng, holes=(), exit_live=False, door_mat=None, floor_mat=None, ceil_mat=None):
    """Walls, floor, ceiling, door. door_state: angle in radians the door has swung open (0 = shut)."""
    dl, dr = door_x - DOOR_W / 2, door_x + DOOR_W / 2
    W.box((0, -0.1, 0), (X1 - X0, 0.2, Z1 - Z0), floor_mat or vct, faces='+y')
    W.box((0, CEIL / 2, Z1 + T_W / 2), (X1 - X0 + 2 * T_W, CEIL, T_W), wall, faces='-z', collide=True)
    W.box((X0 - T_W / 2, CEIL / 2, 0), (T_W, CEIL, Z1 - Z0), wall, faces='+x', collide=True)
    W.box((X1 + T_W / 2, CEIL / 2, 0), (T_W, CEIL, Z1 - Z0), wall, faces='-x', collide=True)
    W.box(((X0 - T_W + dl) / 2, CEIL / 2, Z0 - T_W / 2), (dl - X0 + T_W, CEIL, T_W), wall, faces='+z', collide=True)
    W.box(((dr + X1 + T_W) / 2, CEIL / 2, Z0 - T_W / 2), (X1 + T_W - dr, CEIL, T_W), wall, faces='+z', collide=True)
    W.box((door_x, (DOOR_H + CEIL) / 2, Z0 - T_W / 2), (DOOR_W, CEIL - DOOR_H, T_W), wall, faces='+z-y')
    for (c, s) in [((0, 0.05, Z1 - 0.006), (X1 - X0, 0.1, 0.012)), ((X0 + 0.006, 0.05, 0), (0.012, 0.1, Z1 - Z0)),
                   ((X1 - 0.006, 0.05, 0), (0.012, 0.1, Z1 - Z0)),
                   (((X0 + dl) / 2, 0.05, Z0 + 0.006), (dl - X0, 0.1, 0.012)), (((dr + X1) / 2, 0.05, Z0 + 0.006), (X1 - dr, 0.1, 0.012))]:
        pbox(c, s, 'rubber')
    ceiling_with_holes(set(holes), mat=ceil_mat or ceiling)
    door(door_x, door_state, door_mat or door_teal)
    pbox((door_x, DOOR_H + 0.28, Z0 + 0.06), (0.36, 0.2, 0.1), 'charcoal')
    W.face([(door_x - 0.15, DOOR_H + 0.2, Z0 + 0.111), (door_x + 0.15, DOOR_H + 0.2, Z0 + 0.111),
            (door_x + 0.15, DOOR_H + 0.36, Z0 + 0.111), (door_x - 0.15, DOOR_H + 0.36, Z0 + 0.111)],
           exit_mat if exit_live else exit_dead, uv=[(0, 1), (1, 1), (1, 0), (0, 0)])


def door(door_x, opened, leaf_mat):
    """Steel frame in the wall opening and a leaf hinged on its left jamb, swinging into the room."""
    dl, dr = door_x - DOOR_W / 2, door_x + DOOR_W / 2
    fz = Z0 - T_W / 2
    for (c, s) in [((dl - 0.04, DOOR_H / 2, fz), (0.08, DOOR_H, T_W + 0.04)), ((dr + 0.04, DOOR_H / 2, fz), (0.08, DOOR_H, T_W + 0.04)),
                   ((door_x, DOOR_H + 0.04, fz), (DOOR_W + 0.16, 0.08, T_W + 0.04))]:
        W.box(c, s, metal)
    # jamb reveal inside the opening
    W.face([(dl, 0, Z0 - T_W), (dl, 0, Z0), (dl, DOOR_H, Z0), (dl, DOOR_H, Z0 - T_W)], metal)
    W.face([(dr, 0, Z0), (dr, 0, Z0 - T_W), (dr, DOOR_H, Z0 - T_W), (dr, DOOR_H, Z0)], metal)
    W.face([(dl, DOOR_H, Z0 - T_W), (dl, DOOR_H, Z0), (dr, DOOR_H, Z0), (dr, DOOR_H, Z0 - T_W)], metal)
    hinge = np.array([dl + 0.02, 0, Z0 + 0.03])
    lw = DOOR_W - 0.04
    yaw = -opened  # swing so the free edge moves into the room (+z)
    R = rot(yaw)
    centre = hinge + R @ np.array([lw / 2, DOOR_H / 2 - 0.01, 0.025])
    W.box(centre, (lw, DOOR_H - 0.02, 0.05), leaf_mat, yaw=yaw, collide=True)
    # wired glass window, kick plate, lever (on the room side)
    for off, size, col in [((0, 0.25, 0.028), (0.36, 0.6, 0.004), 'glass'), ((0, -1.08, 0.028), (lw - 0.1, 0.28, 0.006), 'steel'),
                           ((-0.42, -0.2, 0.06), (0.2, 0.035, 0.035), 'steel')]:
        p = hinge + R @ (np.array([lw / 2, DOOR_H / 2, 0]) + np.array(off))
        pbox(p, size, col, yaw=yaw)


def troffer(x, z, on, name=None, lens_mat=None):
    pbox((x, CEIL - 0.01, z), (0.66, 0.02, 1.26), 'lightgrey')
    if on:
        W.face([(x - 0.27, CEIL - 0.022, z - 0.57), (x + 0.27, CEIL - 0.022, z - 0.57),
                (x + 0.27, CEIL - 0.022, z + 0.57), (x - 0.27, CEIL - 0.022, z + 0.57)], lens_mat or lens, uv=np.tile(sw('white'), (4, 1)))
        W.light((x, CEIL - 0.08, z), (0.78, 0.9, 1.0), 1.1, 7.0, area=(0.5, 1.1, 0), name=name, flicker='fluorescent')
    else:
        pbox((x, CEIL - 0.022, z), (0.54, 0.004, 1.14), 'offwhite')


def desk(x, z, yaw, r):
    c, s = math.cos(yaw), math.sin(yaw)
    L = lambda dx, dz: (x + dx * c + dz * s, z - dx * s + dz * c)
    W.box((*L(0, 0)[:1], 0.75, L(0, 0)[1]), (1.5, 0.04, 0.75), metal, yaw=yaw)
    for dx in (-0.55, 0.55):
        px, pz = L(dx, 0)
        W.box((px, 0.37, pz), (0.42, 0.72, 0.72), metal, yaw=yaw)
    W.collider_box((x, 0, z), 0.76, 0.38, yaw, 0, 0.77)
    if r.random() < 0.6:
        px, pz = L(r.uniform(-0.4, 0.4), 0.05)
        pbox((px, 0.85, pz), (0.3, 0.16, 0.24), 'beige', yaw=yaw + r.uniform(-0.3, 0.3))  # dead terminal
    for _ in range(r.integers(1, 4)):
        px, pz = L(r.uniform(-0.6, 0.6), r.uniform(-0.25, 0.25))
        pbox((px, 0.775, pz), (0.22, 0.01, 0.3), 'paper', yaw=r.uniform(0, 6.28))


def chair(x, z, yaw, tipped=False):
    if tipped:
        pbox((x, 0.25, z), (0.48, 0.48, 0.09), 'charcoal', yaw=yaw, pitch=0)
        pbox((x, 0.06, z + 0.3), (0.44, 0.06, 0.5), 'charcoal', yaw=yaw)
        pcyl((x - 0.1, 0.08, z - 0.2), 0.03, 0.36, 'steel', axis='x', yaw=yaw, sides=6)
        return
    pcyl((x, 0.0, z), 0.03, 0.45, 'steel', sides=6)
    for k in range(5):
        a = k * 2 * math.pi / 5
        pbox((x + math.cos(a) * 0.17, 0.04, z + math.sin(a) * 0.17), (0.34, 0.04, 0.05), 'charcoal', yaw=-a)
    pbox((x, 0.47, z), (0.48, 0.08, 0.46), 'charcoal', yaw=yaw)
    c, s = math.cos(yaw), math.sin(yaw)
    pbox((x + 0.23 * c, 0.8, z - 0.23 * s), (0.05, 0.5, 0.42), 'charcoal', yaw=yaw)
    W.collider_circle((x, 0, z), 0.28, 0, 1)


def cabinet(x, z, yaw, drawer_out=False):
    W.box((x, 0.66, z), (0.7, 1.32, 0.52), metal, yaw=yaw, collide=True)
    R = rot(yaw)
    for i, y in enumerate((1.12, 0.8, 0.48, 0.16)):
        out = 0.3 if drawer_out and i == 1 else 0.0
        p = np.array([x, y, z]) + R @ np.array([0, 0, 0.265 + out / 2])
        pbox(p, (0.62, 0.28, 0.012 + out), 'lightgrey', yaw=yaw)


def shelving(x, z, yaw, r):
    R = rot(yaw)
    for dx in (-0.6, 0.6):
        for dz in (-0.22, 0.22):
            p = np.array([x, 1.0, z]) + R @ np.array([dx, 0, dz])
            pbox(p, (0.04, 2.0, 0.04), 'steel', yaw=yaw)
    for y in (0.1, 0.7, 1.3, 1.9):
        W.box((x, y, z), (1.24, 0.03, 0.48), galv, yaw=yaw)
        n = r.integers(0, 4)
        for k in range(n):
            p = np.array([x, y + 0.17, z]) + R @ np.array([r.uniform(-0.4, 0.4), 0, 0])
            W.box(p, (r.uniform(0.25, 0.4), 0.3, 0.35), card, yaw=yaw + r.uniform(-0.15, 0.15), world_uv=False)
    W.collider_box((x, 0, z), 0.64, 0.26, yaw, 0, 2)


def debris(r, n, avoid=()):
    for _ in range(n):
        x, z = r.uniform(X0 + 0.4, X1 - 0.4), r.uniform(Z0 + 0.6, Z1 - 0.4)
        if any(abs(x - ax) < 0.9 and abs(z - az) < 0.9 for ax, az in avoid):
            continue
        k = r.random()
        if k < 0.5:
            pbox((x, 0.008, z), (r.uniform(0.15, 0.3), 0.012, r.uniform(0.12, 0.22)), 'paper', yaw=r.uniform(0, 6.28))
        elif k < 0.75:  # fallen ceiling tile
            W.box((x, 0.015, z), (0.6, 0.02, 0.6), ceiling, yaw=r.uniform(0, 6.28), world_uv=False)
        else:
            W.box((x, 0.2, z), (0.45, 0.4, 0.4), card, yaw=r.uniform(0, 6.28), world_uv=False, collide=True)


ROOM_DOOR_X = {}


def plain_room(i, a, variant, r):
    door_x = round(float(r.uniform(-1.8, 1.8)), 2)
    ROOM_DOOR_X[i] = door_x
    origin, yaw = room_frame(a, door_x)
    wall = list(WALLS.values())[i % 3]
    opened = 0.0 if variant == 'locked' else float(r.uniform(0.5, 1.9))
    vestibule(a, door_x, stencil_name=f'st_b-{i + 1:02d}')
    with W.frame(origin, yaw), W.using('rooms', density=1.0):
        if variant == 'locked':
            door(door_x, 0.0, door_red if r.random() < 0.5 else door_teal)
            return
        holes = {(int(r.integers(0, 12)), int(r.integers(0, 10))) for _ in range(r.integers(1, 6))}
        room_shell(wall, door_x, opened, r, holes=holes, exit_live=r.random() < 0.3)
        lit = i in LIT
        troffer(-1.2, 0.3, lit, name=f'room{i}')
        troffer(1.5, 0.3, False)
        avoid = [(door_x, Z0 + 0.6)]
        if variant == 'office':
            desk(-1.5, 1.6, r.uniform(-0.2, 0.2), r); avoid.append((-1.5, 1.6))
            if r.random() < 0.7:
                desk(1.6, 1.8, math.pi + r.uniform(-0.2, 0.2), r); avoid.append((1.6, 1.8))
            chair(-1.3, 0.8, r.uniform(0, 6.28), tipped=r.random() < 0.4)
            cabinet(X1 - 0.3, -1.6, math.pi / 2, drawer_out=r.random() < 0.5); avoid.append((X1 - 0.3, -1.6))
        elif variant == 'storage':
            for k, z in enumerate((-1.2, 0.4, 2.0)):
                shelving(X0 + 0.3, z, math.pi / 2, r); avoid.append((X0 + 0.3, z))
            shelving(1.0, 2.6, 0, r); avoid.append((1.0, 2.6))
        elif variant == 'break':
            W.box((-0.5, 0.72, 1.2), (1.2, 0.04, 0.8), wood, collide=False)
            for dx in (-0.5, 0.5):
                for dz in (-0.35, 0.35):
                    pbox((-0.5 + dx, 0.36, 1.2 + dz), (0.04, 0.72, 0.04), 'steel')
            W.collider_box((-0.5, 0, 1.2), 0.62, 0.42, 0, 0, 0.75)
            for (cx, cz) in [(-1.3, 1.0), (0.3, 1.5), (-0.6, 0.4)]:
                chair(cx, cz, r.uniform(0, 6.28), tipped=r.random() < 0.3)
            pbox((X1 - 0.4, 0.85, 2.4), (0.7, 1.7, 0.65), 'offwhite', collide=True)  # fridge, door ajar
            pbox((X1 - 0.75, 0.85, 2.0), (0.04, 1.6, 0.6), 'offwhite', yaw=0.7)
            W.box((X1 - 0.35, 0.45, 0.6), (0.6, 0.9, 1.8), wood, collide=True)  # counter
            avoid += [(-0.5, 1.2), (X1 - 0.4, 2.4), (X1 - 0.35, 0.6)]
        debris(r, int(r.integers(4, 12)), avoid)
        # a little writing in some of them
        if r.random() < 0.6:
            name = r.choice([k for k in rects if k.startswith(('tag_', 'mk_', 'dd_'))])
            room_wall_decal(name, 'S', float(r.uniform(-2, 2)), float(r.uniform(1.1, 1.9)))


def room_wall_decal(name, wall, along, y, scale=1.0, eps=0.012):
    """Decal on a room wall in the current room frame. along = position along the wall
    from the viewer's left as they face it (metres from the wall centre)."""
    rect = rects[name]
    w, h = rect['size'][0] * scale, rect['size'][1] * scale
    u0, vb, u1, vt = rect['uv']
    spec = {'S': (np.array([0, 0, Z1 - eps]), np.array([-1, 0, 0])), 'N': (np.array([0, 0, Z0 + eps]), np.array([1, 0, 0])),
            'W': (np.array([X0 + eps, 0, 0]), np.array([0, 0, -1])), 'E': (np.array([X1 - eps, 0, 0]), np.array([0, 0, 1]))}
    c, right = spec[wall]
    c = c + right * along + np.array([0, y, 0])
    up = np.array([0, 1.0, 0])
    pts = [c - right * w / 2 - up * h / 2, c + right * w / 2 - up * h / 2, c + right * w / 2 + up * h / 2,
           c - right * w / 2 + up * h / 2]
    with W.using('decals', density=0.6):
        W.face(pts, graf, uv=[(u0, vb), (u1, vb), (u1, vt), (u0, vt)])


ctx['room_wall_decal'] = room_wall_decal
ctx.update(room_shell=room_shell, troffer=troffer, door=door, ceiling_with_holes=ceiling_with_holes,
           X0=X0, X1=X1, Z0=Z0, Z1=Z1, CEIL=CEIL, DOOR_W=DOOR_W, DOOR_H=DOOR_H, T_W=T_W)

# party office at door 0
party_x = 1.6
vestibule(door_angles[0], party_x, stencil_name='st_b-01')
origin, yaw = room_frame(door_angles[0], party_x)
with W.frame(origin, yaw), W.using('party', density=2.0):
    office.build(ctx, party_x)
for i in range(1, DOORS):
    plain_room(i, door_angles[i], VARIANTS[i - 1], np.random.default_rng(100 + i))

# ------------------------------------------------------------ tunnel lights
FIX = 32
fix_r = np.random.default_rng(9)
prev_on = True
for k in range(FIX):
    a = 2 * math.pi * (k + 0.5) / FIX
    near_party = min(abs(math.remainder(a, 2 * math.pi)), 9) < 0.45
    on = near_party or fix_r.random() < 0.55 or not prev_on
    prev_on = on
    c = P(a, 0, 4.36)
    yaw_f = a
    with W.using('services'):
        with W.frame(c, yaw_f):
            pbox((0, 0.07, 0), (0.28, 0.1, 0.5), 'charcoal')
            for dz in (-0.18, 0, 0.18):
                pbox((0, -0.04, dz), (0.24, 0.02, 0.015), 'steel')
            W.face(orient([(-0.09, -0.02, -0.2), (0.09, -0.02, -0.2), (0.09, -0.02, 0.2), (-0.09, -0.02, 0.2)], (0, -1, 0)),
                   lens if on else dead_glass, uv=np.tile(sw('white' if on else 'glass'), (4, 1)))
    if on:
        cold = fix_r.random() < 0.7
        col = (0.8, 0.9, 1.0) if cold else (1.0, 0.72, 0.42)
        flick = 'fluorescent' if fix_r.random() < 0.2 else None
        W.light(P(a, 0, 4.15), col, 3.2, 11.0, radius=0.12, name=f'fix{k}', flicker=flick, runtime_intensity=1.6)

# ------------------------------------------------------------ tunnel props
party_a = door_angles[0]


def at(a, x, y=0.0):
    return P(a, x, y)


with W.using('props', density=1.0):
    # generator outside the party room, cords running in
    ga = party_a + 0.045
    with W.frame(at(ga, 1.55), ga):
        W.box((0, 0.32, 0), (0.55, 0.5, 0.8), door_red, collide=True)
        pbox((0, 0.62, 0), (0.6, 0.06, 0.85), 'black')
        pcyl((0, 0.06, -0.3), 0.08, 0.06, 'black', axis='x', sides=8)
        pcyl((0, 0.06, 0.3), 0.08, 0.06, 'black', axis='x', sides=8)
    cord = [at(ga, 1.3, 0.01), at(party_a + 0.02, 1.6, 0.01), at(party_a + 0.004, 2.4, 0.01), at(party_a, 3.3, 0.01)]
    for p, q in zip(cord[:-1], cord[1:]):
        d = q - p; mid = (p + q) / 2
        W.box(mid, (np.linalg.norm(d), 0.012, 0.025), props, world_uv=False, uv_const=sw('orange'),
              yaw=math.atan2(-d[2], d[0]))
    # camping chairs and a cooler by the door
    for k, (da, x) in enumerate([(-0.05, 1.1), (-0.07, 0.6)]):
        aa = party_a + da
        with W.frame(at(aa, x), aa + 0.6 * (k - 0.5)):
            pbox((0, 0.45, 0), (0.5, 0.03, 0.45), 'navy' if k else 'green')
            pbox((0.24, 0.7, 0), (0.03, 0.5, 0.45), 'navy' if k else 'green', roll=0.15)
            for dx in (-0.22, 0.22):
                for dz in (-0.2, 0.2):
                    pbox((dx, 0.22, dz), (0.025, 0.46, 0.025), 'steel')
        W.collider_circle(at(aa, x), 0.3, 0, 0.9)
    # string lights hung along the outer wall either side of the door
    def strand(a0, a1, x, y, sag, n, colors, name):
        pts = [P(a0 + (a1 - a0) * t, x, y - sag * 4 * t * (1 - t)) for t in np.linspace(0, 1, 25)]
        for p, q in zip(pts[:-1], pts[1:]):
            d = q - p
            W.box((p + q) / 2, (np.linalg.norm(d) + 0.005, 0.008, 0.008), props, world_uv=False, uv_const=sw('black'),
                  yaw=math.atan2(-d[2], d[0]), roll=math.atan2(d[1], math.hypot(d[0], d[2])))
        bulbs = []
        for i in range(n):
            t = (i + 0.5) / n
            p = P(a0 + (a1 - a0) * t, x, y - sag * 4 * t * (1 - t) - 0.04)
            W.box(p, (0.035, 0.05, 0.035), glow, world_uv=False, uv_const=sw(colors[i % len(colors)]))
            bulbs.append(p)
        c = np.mean(bulbs, 0)
        W.light(c, (1.0, 0.55, 0.35), 0.5, 6.0, radius=1.2, name=name, bake=False)
        for p in bulbs[::3]:
            W.bake_lights.append({'pos': p, 'color': (1.0, 0.6, 0.35), 'intensity': 0.06, 'radius': 0.03, 'area': None})
    strand(party_a - 0.14, party_a - half - 0.01, 2.0, 2.75, 0.25, 22, ['warm', 'orange', 'warm', 'red'], 'str_out_a')
    strand(party_a + half + 0.01, party_a + 0.12, 2.0, 2.75, 0.3, 18, ['warm', 'yellow', 'warm', 'red'], 'str_out_b')
    # glow sticks on the floor
    for k in range(7):
        aa = party_a + fix_r.uniform(-0.12, 0.12)
        x = fix_r.uniform(-1.6, 1.6)
        p = at(aa, x, 0.012)
        W.box(p, (0.15, 0.015, 0.015), glow, yaw=fix_r.uniform(0, 6.28), world_uv=False,
              uv_const=sw(['green', 'purple', 'yellow', 'canred'][k % 4]))
    # abandoned stuff around the loop
    junk_r = np.random.default_rng(21)
    for k in range(26):
        aa = junk_r.uniform(0, 2 * math.pi)
        if abs(math.remainder(aa - party_a, 2 * math.pi)) < 0.2:
            continue
        if any(abs(math.remainder(aa - d, 2 * math.pi)) < 0.06 for d in door_angles):
            continue
        side = junk_r.choice([-1, 1])
        x = side * junk_r.uniform(1.3, 1.75)
        kind = junk_r.choice(['pallet', 'spool', 'cones', 'drum', 'boxes', 'pipes', 'ladder', 'bucket'])
        with W.frame(at(aa, x), aa + junk_r.uniform(-0.3, 0.3)):
            if kind == 'pallet':
                for dz in (-0.45, 0, 0.45):
                    W.box((0, 0.05, dz), (1.0, 0.1, 0.1), wood)
                for dx in (-0.42, -0.14, 0.14, 0.42):
                    W.box((dx, 0.12, 0), (0.12, 0.02, 1.1), wood)
                W.collider_box((0, 0, 0), 0.5, 0.55, 0, 0, 0.14)
            elif kind == 'spool':
                for dz in (-0.3, 0.3):
                    W.cylinder((0, 0.45, dz), 0.45, 0.05, wood, axis='z', sides=12)
                W.cylinder((0, 0.45, -0.3), 0.18, 0.6, wood, axis='z', sides=8, caps=False)
                W.collider_circle((0, 0, 0), 0.45, 0, 0.9)
            elif kind == 'cones':
                for j in range(junk_r.integers(1, 4)):
                    pcyl((junk_r.uniform(-0.4, 0.4), 0, junk_r.uniform(-0.6, 0.6)), 0.1, 0.45, 'orange', sides=6)
            elif kind == 'drum':
                pcyl((0, 0, 0), 0.29, 0.88, 'blue' if junk_r.random() < 0.5 else 'darkred', sides=10, collide=True)
            elif kind == 'boxes':
                for j in range(junk_r.integers(2, 5)):
                    W.box((junk_r.uniform(-0.3, 0.3), 0.2 + 0.4 * (j // 2), junk_r.uniform(-0.4, 0.4)), (0.5, 0.4, 0.45), card,
                          yaw=junk_r.uniform(-0.4, 0.4), world_uv=False)
                W.collider_box((0, 0, 0), 0.45, 0.55, 0, 0, 0.8)
            elif kind == 'pipes':
                for j in range(3):
                    pcyl(((-0.11, 0.11, 0.0)[j], 0.1 + 0.19 * (j == 2), -1.0), 0.1, 2.0, 'steel', axis='z', sides=8)
                W.collider_box((0, 0, 0), 0.3, 1.0, 0, 0, 0.35)
            elif kind == 'ladder':
                for dx in (-0.22, 0.22):
                    pbox((dx, 0.03, 0), (0.06, 0.06, 2.4), 'yellow')
                for j in range(8):
                    pbox((0, 0.03, -1.05 + j * 0.3), (0.44, 0.03, 0.04), 'yellow')
            else:
                pcyl((0, 0, 0), 0.15, 0.36, 'white', sides=8)

# ------------------------------------------------------ graffiti in the tunnel
tunnel_tags = [k for k in rects if k.startswith(('tag_', 'mk_', 'dd_', 'tu_'))]
with W.using('decals', density=0.6):
    gr = np.random.default_rng(33)
    # heavy around the party door
    plan = [('tu_waxy', -0.075, 1, 1.55, 1.0), ('tu_nova', 0.07, 1, 1.4, 1.0), ('tag_111k_big', -0.035, 1, 2.0, 1.0),
            ('mk_hum', 0.035, 1, 1.15, 1.0), ('tu_ssc', 0.0, -1, 1.5, 1.0), ('tu_echo', -0.09, -1, 1.45, 1.0),
            ('tag_jinx', 0.06, -1, 1.7, 1.0), ('dd_arrow', 0.03, 1, 1.0, 0.9), ('tag_veks', 0.11, -1, 1.2, 1.0),
            ('mk_loop', 0.1, 1, 1.5, 1.0), ('dd_smiley', -0.12, 1, 1.9, 1.0), ('tu_drift', 0.15, -1, 1.5, 1.0),
            ('tag_remo', -0.15, -1, 1.9, 1.0), ('tu_void', -0.2, 1, 1.5, 1.0), ('tag_ozie', 0.21, 1, 1.6, 1.0),
            ('buff_grey', 0.26, -1, 1.4, 1.0), ('tag_mute', 0.262, -1, 1.5, 1.0)]
    for name, da, side, y, s in plan:
        tunnel_decal(graf, rects, name, party_a + da, side, y, s, eps=0.012 + 0.004 * (name == 'tag_mute'))
    # sparse elsewhere, thinning out with distance from the party
    placed = 0
    for k in range(70):
        aa = gr.uniform(0.35, 2 * math.pi - 0.35)
        dist = min(aa, 2 * math.pi - aa)
        if gr.random() > 1.1 - dist / math.pi:
            continue
        side = gr.choice([-1, 1])
        if side == 1 and any(abs(math.remainder(aa - d, 2 * math.pi)) < 0.06 for d in door_angles):
            continue
        name = gr.choice(tunnel_tags)
        tunnel_decal(graf, rects, name, aa, side, float(gr.uniform(1.2, 1.9)), 1.0)
        placed += 1
    for k in range(5):  # chainage stencils on the inner wall
        tunnel_decal(graf, rects, f'st_ch{k}', 0.6 + k * 1.2, -1, 1.25)
    tunnel_decal(graf, rects, 'tu_kilo_old', math.pi, -1, 1.5)
    tunnel_decal(graf, rects, 'mk_17', door_angles[16] + 0.05, 1, 1.4)
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
    tunnel = (np.abs(rr) < 2.95) & (y < 4.7)
    g = 0.82 + 0.3 * noise3(Pp, 0.7, 3)
    wall = np.abs(N[:, 1]) < 0.7
    floor = N[:, 1] >= 0.7
    g[wall] *= 1 - 0.35 * np.exp(-y[wall] / 0.4)
    streak = noise3(np.stack([Pp[:, 0] * 4, Pp[:, 1] * 0.12, Pp[:, 2] * 4], 1), 1.0, 5)
    g[wall] *= 1 - 0.25 * np.clip(streak[wall] - 0.6, 0, 1) * 3
    tf = floor & tunnel
    g[tf] *= 1 - 0.4 * np.exp(-(XF - np.abs(rr[tf])) / 0.35)
    damp = noise3(Pp * np.array([0.6, 0, 0.6]), 0.5, 8)
    g[tf] *= 1 - 0.3 * np.clip(damp[tf] - 0.55, 0, 1) * 3
    crown = tunnel & (y > 3.6)
    g[crown] *= 0.85 + 0.15 * noise3(Pp[crown], 2.0, 9)
    return g


# ------------------------------------------------------------------- meta
W.meta = {'name': 'world', 'ambient': [0.035, 0.035, 0.045], 'fog': {'color': '#060607', 'near': 14, 'far': 58},
          'loop': {'radius': RL, 'doors': [{'angle': round(a, 5), 'room': room_numbers[i]} for i, a in enumerate(door_angles)]}}

if __name__ == '__main__':
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    pr = os.path.join(HERE, 'previews')
    os.makedirs(pr, exist_ok=True)
    sp = W.spawns[0]

    def room_cam(a, door_x, x, z, yaw, pitch=0.0, fov=60):
        origin, ry = room_frame(a, door_x)
        p = origin + rot(ry) @ np.array([x, 1.6, z])
        return (tuple(p), ry + yaw, pitch, fov)

    def tun_cam(a, x, yaw, pitch=0.0, fov=62):
        return (tuple(P(a, x, 1.6)), yaw, pitch, fov)
    cams = []
    if '--preview' in sys.argv:
        pa = party_a
        cams = [
            ('office_a', room_cam(pa, party_x, 0.0, 1.6, 0.55)),             # toward the door + couch
            ('office_b', room_cam(pa, party_x, -0.2, -1.6, math.pi - 0.4)),  # back toward the mattress wall
            ('office_c', room_cam(pa, party_x, 1.2, 0.6, 1.4, -0.05)),        # toward the couch / west wall
            ('tunnel_door', tun_cam(pa - 0.12, -0.7, pa - 0.3)),
            ('tunnel_back', tun_cam(pa + 0.16, 0.6, pa + math.pi + 0.35, 0.02)),
            ('tunnel_far', tun_cam(1.6, 0.3, 1.6, 0.04)),
            ('room_plain', room_cam(door_angles[9], ROOM_DOOR_X[9], 0.0, 2.2, 0.15, -0.05)),
        ]
    W.build(OUT, lm_size=1024 if FAST else 2048, samples=24 if FAST else 160, ambient=(0.004, 0.004, 0.005),
            grime=grime, previews=cams, preview_dir=pr, fill=(0.03, 0.03, 0.034),
            chunk=lambda c: (np.floor((np.arctan2(-c[:, 2], c[:, 0]) % (2 * math.pi)) / (2 * math.pi) * 16 + 0.5) % 16).astype(int))
    print(f'done in {time.time() - t0:.1f}s')
