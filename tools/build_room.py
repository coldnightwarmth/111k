"""Build the first space: a small abandoned office off the collider tunnel,
taken over for a party. Run: python3 tools/build_room.py  (writes assets/env/office.*)

Coordinates: metres, y up. Room interior x -3.5..3.5, z -3..3, ceiling 3.0.
The door to the tunnel (closed for now) is on the north wall (z = -3).
"""
import math, os, sys, time
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import textures as T
from levelkit import Level, Material

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'env', 'office')
X0, X1, Z0, Z1, CEIL = -3.5, 3.5, -3.0, 3.0, 3.0
DOOR_X, DOOR_W, DOOR_H = 1.6, 1.2, 2.5

t0 = time.time()
pal_img = T.palette()
P = T.PALETTE

# ---------------------------------------------------------------- materials
wall = Material('wall_block', T.cinderblock(), tile=0.8)
floor = Material('floor_vct', T.vct_floor(), tile=1.2)
ceiling = Material('ceiling_tile', T.ceiling_tile(), tile=1.2)
metal = Material('metal_grey', T.painted_metal(), tile=1.0)
door_metal = Material('metal_teal', T.painted_metal((0.30, 0.42, 0.43), seed=41), tile=1.0)
fab = Material('fabric_couch', T.fabric(), tile=0.5)
wd = Material('wood', T.wood(), tile=0.9)
card = Material('cardboard', T.cardboard(), tile=0.6)
pal = Material('props', pal_img, tile=1.0)
graf_img, graf_rects = T.graffiti_atlas()
graf = Material('graffiti', graf_img, alpha='BLEND')
glow = Material('glow', pal_img, emissive=True)
tube = Material('tube', pal_img, emissive=True)
# exit sign face
ex = Image.new('RGB', (256, 128), (60, 6, 4)); d = ImageDraw.Draw(ex)
d.text((22, 14), 'EXIT', font=T._font(92), fill=(255, 70, 50))
exit_mat = Material('exit_sign', ex, emissive=True)

L = Level(density=22, lm_width=1024)


# ------------------------------------------------------------------ helpers
def noise3(p, scale, seed=0):
    """Cheap smooth-ish noise from summed sines (deterministic, no tiling needed)."""
    r = np.random.default_rng(seed)
    acc = np.zeros(len(p))
    for k in range(5):
        dvec = r.normal(size=3); dvec /= np.linalg.norm(dvec)
        acc += np.sin(p @ dvec * scale * (1.7 ** k) + r.random() * 6.28) / (1.6 ** k)
    return acc / 2.2 * 0.5 + 0.5


def wall_grime(p, n):
    y = p[:, 1]
    base = 1 - 0.38 * np.exp(-y / 0.35)                      # dirty skirting band
    base *= 1 - 0.25 * np.exp(-(CEIL - y) / 0.25)            # smoke near ceiling
    blotch = noise3(p, 1.4, 3)
    base *= 0.82 + 0.3 * blotch
    streak = noise3(np.stack([p[:, 0] * 6, p[:, 1] * 0.2, p[:, 2] * 6], 1), 1.0, 5)  # vertical water streaks
    base *= 1 - 0.22 * np.clip(streak - 0.62, 0, 1) * 3
    return base


def floor_grime(p, n):
    edge = np.minimum.reduce([p[:, 0] - X0, X1 - p[:, 0], p[:, 2] - Z0, Z1 - p[:, 2]])
    g = 1 - 0.32 * np.exp(-edge / 0.45)
    path = np.exp(-((p[:, 0] - 0.4 * p[:, 2] - 0.4) ** 2) / 1.4)  # worn walking path to the door
    g *= (0.84 + 0.28 * noise3(p, 0.9, 7)) * (1 + 0.08 * path)
    return g


def ceil_grime(p, n):
    return 0.8 + 0.3 * noise3(p, 1.1, 9)


def prop_grime(p, n):
    return 0.85 + 0.25 * noise3(p, 3.0, 11)


def swatch(name):
    u, v = P[name]
    return np.array([[u, v]] * 4)


def pbox(center, size, color, **kw):
    """Small prop box coloured from the palette swatch."""
    c = np.asarray(center, float); h = np.asarray(size, float) / 2
    yaw, pitch, roll = kw.pop('yaw', 0.0), kw.pop('pitch', 0.0), kw.pop('roll', 0.0)
    mat = kw.pop('mat', pal)
    start = len(L.faces)
    L.box(c, size, mat, yaw=yaw, pitch=pitch, roll=roll, world_uv=False, grime=kw.pop('grime', prop_grime), **kw)
    for f in L.faces[start:]:
        f['uv'] = swatch(color)[:len(f['pts'])]


def pcyl(base, r, h, color, mat=None, **kw):
    start = len(L.faces)
    L.cylinder(base, r, h, mat or pal, grime=kw.pop('grime', prop_grime), **kw)
    for f in L.faces[start:]:
        f['uv'] = swatch(color)[:len(f['pts'])]


def decal(name, corners):
    """corners: bottom-left, bottom-right, top-right, top-left (as seen from the room)."""
    u0, v0, u1, v1 = graf_rects[name]
    L.face(corners, graf, uv=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


# ------------------------------------------------------------------- shell
T_W = 0.2
# floor and walls (only the faces seen from inside are emitted)
L.box((0, -0.1, 0), (X1 - X0, 0.2, Z1 - Z0), floor, faces='+y', collide=False, grime=floor_grime)
L.box((0, CEIL / 2, Z1 + T_W / 2), (X1 - X0 + 2 * T_W, CEIL, T_W), wall, faces='-z', collide=True, grime=wall_grime)
L.box((X0 - T_W / 2, CEIL / 2, 0), (T_W, CEIL, Z1 - Z0), wall, faces='+x', collide=True, grime=wall_grime)
L.box((X1 + T_W / 2, CEIL / 2, 0), (T_W, CEIL, Z1 - Z0), wall, faces='-x', collide=True, grime=wall_grime)
# north wall with a door opening
dl, dr = DOOR_X - DOOR_W / 2, DOOR_X + DOOR_W / 2
L.box(((X0 - T_W + dl) / 2, CEIL / 2, Z0 - T_W / 2), (dl - X0 + T_W, CEIL, T_W), wall, faces='+z', collide=True, grime=wall_grime)
L.box(((dr + X1 + T_W) / 2, CEIL / 2, Z0 - T_W / 2), (X1 + T_W - dr, CEIL, T_W), wall, faces='+z', collide=True, grime=wall_grime)
L.box((DOOR_X, (DOOR_H + CEIL) / 2, Z0 - T_W / 2), (DOOR_W, CEIL - DOOR_H, T_W), wall, faces='+z-y', grime=wall_grime)

# baseboard (rubber cove base)
for (c, s) in [((0, 0.05, Z1 - 0.006), (X1 - X0, 0.1, 0.012)), ((X0 + 0.006, 0.05, 0), (0.012, 0.1, Z1 - Z0)),
               ((X1 - 0.006, 0.05, 0), (0.012, 0.1, Z1 - Z0)),
               (((X0 + dl) / 2, 0.05, Z0 + 0.006), (dl - X0, 0.1, 0.012)), (((dr + X1) / 2, 0.05, Z0 + 0.006), (X1 - dr, 0.1, 0.012))]:
    pbox(c, s, 'rubber', occlude=False)

# drop ceiling with one missing tile (hole at x -0.6..0, z 1.2..1.8)
HX0, HX1, HZ0, HZ1 = -0.6, 0.0, 1.2, 1.8
for (x0, x1, z0, z1) in [(X0, X1, Z0, HZ0), (X0, X1, HZ1, Z1), (X0, HX0, HZ0, HZ1), (HX1, X1, HZ0, HZ1)]:
    L.box(((x0 + x1) / 2, CEIL + 0.02, (z0 + z1) / 2), (x1 - x0, 0.04, z1 - z0), ceiling, faces='-y', grime=ceil_grime)
# dark plenum above the hole, with a dangling cable
cx, cz = (HX0 + HX1) / 2, (HZ0 + HZ1) / 2
hw = (HX1 - HX0) / 2
y0, y1 = CEIL + 0.04, CEIL + 0.6
for pts in [  # inward-facing plenum walls + top
    [(cx - hw, y0, cz - hw), (cx + hw, y0, cz - hw), (cx + hw, y1, cz - hw), (cx - hw, y1, cz - hw)],
    [(cx + hw, y0, cz + hw), (cx - hw, y0, cz + hw), (cx - hw, y1, cz + hw), (cx + hw, y1, cz + hw)],
    [(cx - hw, y0, cz + hw), (cx - hw, y0, cz - hw), (cx - hw, y1, cz - hw), (cx - hw, y1, cz + hw)],
    [(cx + hw, y0, cz - hw), (cx + hw, y0, cz + hw), (cx + hw, y1, cz + hw), (cx + hw, y1, cz - hw)],
    [(cx - hw, y1, cz - hw), (cx + hw, y1, cz - hw), (cx + hw, y1, cz + hw), (cx - hw, y1, cz + hw)]]:
    L.face(pts, pal, uv=swatch('black'))
L.occluders.append((np.array([cx, y1 + 0.05, cz]), np.array([hw, 0.05, hw]), np.eye(3)))
pbox((cx + 0.12, CEIL - 0.25, cz - 0.05), (0.02, 0.8, 0.02), 'black', roll=0.12, occlude=False)

# fluorescent troffers: one working, one dead with a cracked diffuser
LIT = (-1.2, 0.3)
DEAD = (1.5, -1.2)
for (x, z), on in [(LIT, True), (DEAD, False)]:
    pbox((x, CEIL - 0.01, z), (0.66, 0.02, 1.26), 'lightgrey', occlude=False)  # frame
    if on:
        L.face([(x - 0.27, CEIL - 0.022, z - 0.57), (x + 0.27, CEIL - 0.022, z - 0.57),
                (x + 0.27, CEIL - 0.022, z + 0.57), (x - 0.27, CEIL - 0.022, z + 0.57)], tube, uv=swatch('white'))
    else:
        pbox((x, CEIL - 0.022, z), (0.54, 0.004, 1.14), 'offwhite', occlude=False)
L.light((LIT[0], CEIL - 0.08, LIT[1]), (0.78, 0.9, 1.0), 1.7, 8.0,
        samples=[(dx, 0, dz) for dx in (-0.18, 0.18) for dz in (-0.45, -0.15, 0.15, 0.45)], name='fluorescent',
        flicker='fluorescent')

# exit sign over the door
pbox((DOOR_X, DOOR_H + 0.28, Z0 + 0.06), (0.36, 0.2, 0.1), 'charcoal', occlude=False)
L.face([(DOOR_X - 0.15, DOOR_H + 0.2, Z0 + 0.111), (DOOR_X + 0.15, DOOR_H + 0.2, Z0 + 0.111),
        (DOOR_X + 0.15, DOOR_H + 0.36, Z0 + 0.111), (DOOR_X - 0.15, DOOR_H + 0.36, Z0 + 0.111)], exit_mat,
       uv=[(0, 1), (1, 1), (1, 0), (0, 0)])
L.light((DOOR_X, DOOR_H + 0.25, Z0 + 0.25), (1.0, 0.1, 0.06), 0.45, 3.6, name='exit')

# ------------------------------------------------------------------- door
fz = Z0
for (c, s) in [((dl - 0.04, DOOR_H / 2, fz + 0.02), (0.08, DOOR_H, 0.1)), ((dr + 0.04, DOOR_H / 2, fz + 0.02), (0.08, DOOR_H, 0.1)),
               ((DOOR_X, DOOR_H + 0.04, fz + 0.02), (DOOR_W + 0.16, 0.08, 0.1))]:
    L.box(c, s, metal, grime=prop_grime)
L.box((DOOR_X, DOOR_H / 2 - 0.01, fz - 0.03), (DOOR_W - 0.02, DOOR_H - 0.02, 0.05), door_metal, collide=True,
      grime=lambda p, n: 0.78 + 0.25 * noise3(p, 2.0, 13) - 0.2 * np.exp(-p[:, 1] / 0.3))
# wired glass window, kick plate, lever
L.face([(DOOR_X - 0.18, 1.45, fz - 0.004), (DOOR_X + 0.18, 1.45, fz - 0.004), (DOOR_X + 0.18, 2.05, fz - 0.004),
        (DOOR_X - 0.18, 2.05, fz - 0.004)], pal, uv=swatch('glass'))
pbox((DOOR_X, 0.15, fz - 0.003), (DOOR_W - 0.1, 0.28, 0.006), 'steel', occlude=False)
pbox((DOOR_X - 0.42, 1.05, fz + 0.03), (0.05, 0.05, 0.06), 'steel', occlude=False)
pbox((DOOR_X - 0.34, 1.05, fz + 0.06), (0.2, 0.035, 0.035), 'steel', occlude=False)
# light switch + outlet
pbox((dl - 0.35, 1.2, Z0 + 0.008), (0.08, 0.12, 0.016), 'offwhite', occlude=False)
pbox((-2.4, 0.35, Z0 + 0.008), (0.07, 0.11, 0.016), 'offwhite', occlude=False)

# ----------------------------------------------------------------- couch
cx_, cz_ = -3.05, 0.25
cyaw = 0.04
def local(dx, dy, dz):  # couch local -> world (couch faces +x)
    c, s = math.cos(cyaw), math.sin(cyaw)
    return (cx_ + dx * c + dz * s, dy, cz_ - dx * s + dz * c)
L.box(local(0, 0.22, 0), (0.9, 0.28, 2.2), fab, yaw=cyaw, collide=True, grime=prop_grime)            # base
L.box(local(-0.33, 0.62, 0), (0.24, 0.52, 2.2), fab, yaw=cyaw, grime=prop_grime)                       # back
for dz in (-0.98, 0.98):
    L.box(local(0.02, 0.48, dz), (0.86, 0.32, 0.24), fab, yaw=cyaw, grime=prop_grime)                  # arms
for dz in (-0.43, 0.43):
    L.box(local(0.08, 0.42, dz), (0.66, 0.13, 0.84), fab, yaw=cyaw, roll=0.0, pitch=0.02 * dz, grime=prop_grime)  # cushions
for dz in (-1.0, 1.0):
    for dx in (-0.35, 0.35):
        pbox(local(dx, 0.04, dz), (0.06, 0.08, 0.06), 'darkwood', yaw=cyaw, occlude=False)

# ----------------------------------------------- cable spool table + party stuff
sx, sz = -1.75, 0.35
L.cylinder((sx, 0.0, sz), 0.5, 0.06, wd, sides=12, grime=prop_grime)
L.cylinder((sx, 0.06, sz), 0.2, 0.56, wd, sides=10, caps=False, grime=prop_grime)
L.cylinder((sx, 0.62, sz), 0.56, 0.06, wd, sides=12, collide=True, grime=prop_grime)
# lantern
pcyl((sx + 0.12, 0.68, sz - 0.1), 0.07, 0.03, 'charcoal', sides=8)
pcyl((sx + 0.12, 0.71, sz - 0.1), 0.055, 0.14, 'warm', mat=glow, sides=8, occlude=False)
pcyl((sx + 0.12, 0.85, sz - 0.1), 0.07, 0.03, 'charcoal', sides=8, occlude=False)
L.light((sx + 0.12, 0.8, sz - 0.1), (1.0, 0.68, 0.36), 1.0, 4.8, name='lantern', flicker='candle')
# cans on the spool
for (dx, dz, col) in [(-0.2, 0.15, 'canred'), (-0.05, 0.28, 'cangreen'), (0.25, 0.18, 'steel'), (-0.28, -0.12, 'canred')]:
    pcyl((sx + dx, 0.68, sz + dz), 0.033, 0.12, col, sides=7, occlude=False)
# milk crates as seats
def crate(c, color, yaw=0.0):
    x, y, z = c
    co, si = math.cos(yaw), math.sin(yaw)
    def w(dx, dz):
        return (x + dx * co + dz * si, z - dx * si + dz * co)
    for dx, dz, sx_, sz_ in [(0, 0.16, 0.34, 0.02), (0, -0.16, 0.34, 0.02), (0.16, 0, 0.02, 0.34), (-0.16, 0, 0.02, 0.34)]:
        wx, wz = w(dx, dz)
        pbox((wx, y + 0.15, wz), (sx_, 0.3, sz_), color, yaw=yaw)
    pbox((x, y + 0.01, z), (0.34, 0.02, 0.34), color, yaw=yaw)
    L.colliders.append({'x': x, 'z': z, 'hx': 0.17, 'hz': 0.17, 'yaw': yaw, 'y0': y, 'y1': y + 0.3})
crate((-1.0, 0, 0.95), 'red', 0.3)
crate((-1.05, 0, -0.35), 'blue', -0.2)
crate((-1.75, 0, 1.25), 'blue', 0.1)
crate((-1.75, 0.3, 1.25), 'red', 0.5)

# boombox
bx, bz = -2.35, -0.9
pbox((bx, 0.17, bz), (0.6, 0.3, 0.2), 'charcoal', yaw=0.5)
for dxs in (-0.17, 0.17):
    c, s = math.cos(0.5), math.sin(0.5)
    pcyl((bx + dxs * c + 0.1 * s, 0.17, bz - dxs * s + 0.1 * c), 0.09, 0.012, 'black', axis='z', yaw=0.5, occlude=False)
pbox((bx, 0.36, bz), (0.42, 0.03, 0.04), 'steel', yaw=0.5, occlude=False)
L.colliders.append({'x': bx, 'z': bz, 'r': 0.32, 'y0': 0, 'y1': 0.35})
# cooler
pbox((-2.55, 0.2, 1.75), (0.6, 0.38, 0.38), 'blue', yaw=-0.25, collide=True)
pbox((-2.55, 0.41, 1.75), (0.62, 0.05, 0.4), 'white', yaw=-0.25)
# floor litter
rng = np.random.default_rng(4)
for i in range(9):
    x, z = rng.uniform(-2.8, 1.5), rng.uniform(-2.5, 2.5)
    if math.hypot(x - sx, z - sz) < 0.6:
        continue
    if i % 3 == 0:
        pcyl((x, 0.033, z), 0.033, 0.12, ['canred', 'cangreen', 'steel'][i % 3], axis='x', yaw=rng.uniform(0, 6.28), sides=7, occlude=False)
    else:
        pbox((x, 0.008, z), (rng.uniform(0.12, 0.22), 0.016, rng.uniform(0.1, 0.2)), 'paper', yaw=rng.uniform(0, 6.28), occlude=False)

# ------------------------------------------------------- desk, chair, CRT
dx0, dz0 = 3.1, 0.95
L.box((dx0, 0.75, dz0), (0.75, 0.04, 1.6), metal, collide=False, grime=prop_grime)                 # top
L.box((dx0, 0.37, dz0 + 0.55), (0.72, 0.72, 0.42), metal, collide=True, grime=prop_grime)          # drawer pedestal
L.box((dx0 + 0.33, 0.4, dz0 - 0.2), (0.03, 0.6, 1.1), metal, grime=prop_grime)                     # modesty panel
L.box((dx0, 0.37, dz0 - 0.77), (0.72, 0.72, 0.03), metal, grime=prop_grime)                        # side
L.colliders.append({'x': dx0, 'z': dz0, 'hx': 0.38, 'hz': 0.8, 'yaw': 0, 'y0': 0, 'y1': 0.77})
for i, y in enumerate((0.58, 0.36, 0.14)):
    pbox((dx0 - 0.365, y, dz0 + 0.55), (0.01, 0.2, 0.38), 'lightgrey', occlude=False)
    pbox((dx0 - 0.38, y + 0.04, dz0 + 0.55), (0.02, 0.02, 0.12), 'steel', occlude=False)
# CRT monitor
pbox((dx0 + 0.05, 0.98, dz0 - 0.2), (0.42, 0.4, 0.42), 'beige', yaw=-0.2)
pbox((dx0 + 0.18, 0.96, dz0 - 0.22), (0.3, 0.3, 0.3), 'beige', yaw=-0.2)
c, s = math.cos(-0.2), math.sin(-0.2)
pbox((dx0 + 0.05 - 0.212 * c, 0.97, dz0 - 0.2 + 0.212 * s), (0.01, 0.27, 0.32), 'glass', yaw=-0.2, occlude=False)
pbox((dx0 - 0.15, 0.785, dz0 + 0.2), (0.18, 0.03, 0.45), 'charcoal', yaw=0.1, occlude=False)  # keyboard
# office chair (tipped back slightly, swivelled)
chx, chz, chy = 2.15, 1.15, 0.9
for k in range(5):
    a = k * 2 * math.pi / 5 + 0.3
    pbox((chx + math.cos(a) * 0.17, 0.06, chz + math.sin(a) * 0.17), (0.34, 0.04, 0.05), 'charcoal', yaw=-a, occlude=False)
pcyl((chx, 0.08, chz), 0.03, 0.36, 'steel', sides=6, occlude=False)
pbox((chx, 0.47, chz), (0.5, 0.09, 0.48), 'charcoal', yaw=chy)
c, s = math.cos(chy), math.sin(chy)
pbox((chx + 0.24 * c, 0.82, chz - 0.24 * s), (0.06, 0.5, 0.44), 'charcoal', yaw=chy, roll=0.15)
L.colliders.append({'x': chx, 'z': chz, 'r': 0.3, 'y0': 0, 'y1': 1.0})

# filing cabinet with an open drawer
fx0, fz0 = 3.2, -2.6
L.box((fx0, 0.66, fz0), (0.52, 1.32, 0.7), metal, yaw=math.pi / 2 * 0, collide=True, grime=prop_grime)
for i, y in enumerate((1.12, 0.8, 0.48, 0.16)):
    out = 0.32 if i == 1 else 0.0
    pbox((fx0 - 0.265 - out / 2, y, fz0), (0.012 + out, 0.28, 0.62), 'lightgrey', occlude=out > 0)
    pbox((fx0 - 0.28 - out, y + 0.06, fz0), (0.02, 0.03, 0.14), 'steel', occlude=False)
pbox((fx0 - 0.25, 0.86, fz0 - 0.1), (0.24, 0.02, 0.3), 'paper', yaw=0.1, occlude=False)  # loose files

# cardboard boxes in the corner
for (c, s, yaw) in [((2.95, 0.25, 2.55), (0.6, 0.5, 0.5), 0.1), ((3.05, 0.7, 2.6), (0.5, 0.4, 0.45), -0.2),
                    ((2.35, 0.2, 2.65), (0.45, 0.4, 0.4), 0.4), ((-3.05, 0.2, -2.55), (0.5, 0.4, 0.5), 0.2)]:
    L.box(c, s, card, yaw=yaw, collide=True, grime=prop_grime, world_uv=False)
# fallen ceiling tile, leaning against the south wall
L.box((-0.3, 0.32, 2.88), (0.6, 0.62, 0.02), ceiling, pitch=-0.25, world_uv=False)

# wall clock (stopped)
pcyl((-0.9, 2.3, Z1), 0.16, 0.04, 'offwhite', axis='z', yaw=math.pi, sides=12)
pbox((-0.9, 2.33, Z1 - 0.045), (0.012, 0.11, 0.004), 'black', roll=0.6, occlude=False)
pbox((-0.9, 2.3, Z1 - 0.046), (0.01, 0.08, 0.004), 'black', roll=2.3, occlude=False)
# conduit along the east wall
pcyl((X1 - 0.05, 2.85, Z0), 0.025, Z1 - Z0, 'steel', axis='z', sides=6, occlude=False)
# HVAC grille
pbox((X0 + 0.01, 2.6, -1.8), (0.02, 0.3, 0.5), 'lightgrey', occlude=False)
for k in range(5):
    pbox((X0 + 0.022, 2.48 + k * 0.06, -1.8), (0.008, 0.012, 0.46), 'charcoal', occlude=False)


# ------------------------------------------------------- string lights
def strand(a, b, sag, n_bulbs, colors):
    a, b = np.asarray(a, float), np.asarray(b, float)
    pts = []
    for i in range(41):
        t = i / 40
        p = a + (b - a) * t; p[1] -= sag * 4 * t * (1 - t)
        pts.append(p)
    for i in range(40):
        p, q = pts[i], pts[i + 1]
        mid, d = (p + q) / 2, q - p
        yaw = math.atan2(-d[2], d[0]); pitch = 0
        roll = math.atan2(d[1], math.hypot(d[0], d[2]))
        pbox(mid, (np.linalg.norm(d) + 0.005, 0.008, 0.008), 'black', yaw=yaw, roll=roll, occlude=False)
    bulbs = []
    for i in range(n_bulbs):
        t = (i + 0.5) / n_bulbs
        p = a + (b - a) * t; p[1] -= sag * 4 * t * (1 - t) + 0.04
        pbox(p, (0.035, 0.05, 0.035), colors[i % len(colors)], mat=glow, occlude=False)
        bulbs.append(p)
    return bulbs

warm_cols = ['warm', 'warm', 'orange', 'warm', 'yellow']
b1 = strand((X0 + 0.05, 2.78, -2.6), (0.6, 2.82, Z1 - 0.05), 0.45, 18, warm_cols)
b2 = strand((X0 + 0.05, 2.74, 2.4), (X1 - 0.05, 2.8, -0.4), 0.55, 20, warm_cols)
for bulbs, name in ((b1, 'string_a'), (b2, 'string_b')):
    sample = bulbs[::3]
    c = np.mean(sample, 0)
    L.light(c, (1.0, 0.6, 0.3), 0.34, 5.0, samples=[tuple(p - c) for p in sample], name=name)

# ------------------------------------------------------------- graffiti
eps = 0.012
decal('loop', [(-2.8, 1.0, Z1 - eps), (0.2, 1.0, Z1 - eps), (0.2, 2.25, Z1 - eps), (-2.8, 2.25, Z1 - eps)][::-1][::-1])
# south wall faces -z: viewer looks +z, so +x is on the viewer's left. Mirror the u axis.
L.faces[-1]['pts'] = np.array([(0.2, 1.0, Z1 - eps), (-2.8, 1.0, Z1 - eps), (-2.8, 2.25, Z1 - eps), (0.2, 2.25, Z1 - eps)])
decal('smiley', [(1.75, 1.45, Z1 - eps), (1.05, 1.45, Z1 - eps), (1.05, 2.15, Z1 - eps), (1.75, 2.15, Z1 - eps)])
decal('111k', [(X0 + eps, 1.35, -0.75), (X0 + eps, 1.35, 1.25), (X0 + eps, 2.35, 1.25), (X0 + eps, 2.35, -0.75)][::-1])
L.faces[-1]['pts'] = np.array([(X0 + eps, 1.35, 1.25), (X0 + eps, 1.35, -0.75), (X0 + eps, 2.35, -0.75), (X0 + eps, 2.35, 1.25)])
decal('star', [(X0 + eps, 1.6, -1.9), (X0 + eps, 1.6, -2.55), (X0 + eps, 2.25, -2.55), (X0 + eps, 2.25, -1.9)])
decal('arrow', [(-0.3, 1.3, Z0 + eps), (0.5, 1.3, Z0 + eps), (0.5, 1.7, Z0 + eps), (-0.3, 1.7, Z0 + eps)])
decal('scrawl', [(-3.1, 1.55, Z0 + eps), (-1.5, 1.55, Z0 + eps), (-1.5, 2.15, Z0 + eps), (-3.1, 2.15, Z0 + eps)])
decal('ssc', [(X1 - eps, 0.3, -1.7), (X1 - eps, 0.3, -0.2), (X1 - eps, 0.86, -0.2), (X1 - eps, 0.86, -1.7)])

# --------------------------------------------------------------- meta
L.spawns = [{'x': x, 'z': z, 'yaw': 0.0} for x, z in [(0.0, 1.8), (0.6, 1.6), (-0.4, 2.1), (0.9, 2.2), (0.2, 1.2)]]
L.meta = {'name': 'office', 'bounds': {'x0': X0, 'x1': X1, 'z0': Z0, 'z1': Z1, 'ceiling': CEIL},
          'ambient': [0.05, 0.05, 0.06], 'fog': None}

if __name__ == '__main__':
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    info = L.export(OUT)
    print(info, f'{time.time() - t0:.1f}s')
