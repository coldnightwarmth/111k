"""The offices off the loop (all built in a room frame: interior x -3.5..3.5,
z -3..3, ceiling 3 m, door in the north wall at x = door_x).

plain_room     abandoned office / storage / break room, maybe locked
control_room   the ring's control room: consoles, CRTs, racks, a mimic board
bathroom       tiled restroom: stalls, toilets, urinals, sinks
squatter_room  someone has been living here
"""
import math
import numpy as np

from kit import orient

# troffer positions on the 0.6 m ceiling grid (grid starts at x = -3.5, z = -3)
TROFFERS = [(-1.4, 0.0), (1.6, 0.0)]


def crate(P, c, color, yaw=0.0):
    x, y, z = c
    co, si = math.cos(yaw), math.sin(yaw)
    for dx, dz, sx_, sz_ in [(0, 0.16, 0.34, 0.02), (0, -0.16, 0.34, 0.02), (0.16, 0, 0.02, 0.34), (-0.16, 0, 0.02, 0.34)]:
        P.box((x + dx * co + dz * si, y + 0.15, z - dx * si + dz * co), (sx_, 0.3, sz_), color, yaw=yaw)
    P.box((x, y + 0.01, z), (0.34, 0.02, 0.34), color, yaw=yaw)
    P.W.collider_box((x, 0, z), 0.17, 0.17, yaw, y, y + 0.3)


def plain_room(C, i, door_x, variant, r, lit=False, group=None):
    P, W, M = C.P, C.W, C.M
    opened = 0.0 if variant == 'locked' else float(r.uniform(0.5, 1.9))
    if variant == 'locked':
        P.door(door_x, 0.0, M['metal_red'] if r.random() < 0.5 else M['metal_teal'])
        return
    holes = {(int(r.integers(0, 12)), int(r.integers(0, 10))) for _ in range(r.integers(1, 6))}
    holes -= {(c, rr) for (c, rr) in holes if c in (3, 8) and rr in (4, 5)}  # keep the light fixtures intact
    P.shell(C.WALLS[i % 3], door_x, opened, holes=holes, exit_live=r.random() < 0.3)
    P.troffer(*TROFFERS[0], lit, name=f'room{i}', group=group, flicker='fluorescent' if group is not None else None)
    P.troffer(*TROFFERS[1], False)
    avoid = [(door_x, P.Z0 + 0.7, 0.9)]
    if variant == 'office':
        P.desk(-1.5, 1.6, r.uniform(-0.2, 0.2), r); avoid.append((-1.5, 1.6, 1.0))
        if r.random() < 0.7:
            P.desk(1.6, 1.8, math.pi + r.uniform(-0.2, 0.2), r); avoid.append((1.6, 1.8, 1.0))
        P.office_chair(-1.3, 0.75, r.uniform(0, 6.28), tipped=r.random() < 0.4); avoid.append((-1.3, 0.75, 0.6))
        P.cabinet(P.X1 - 0.3, -1.6, math.pi / 2, drawer_out=r.random() < 0.5); avoid.append((P.X1 - 0.3, -1.6, 0.6))
    elif variant == 'storage':
        for z in (-1.2, 0.4, 2.0):
            P.shelving(P.X0 + 0.3, z, math.pi / 2, r); avoid.append((P.X0 + 0.3, z, 0.8))
        P.shelving(1.0, 2.6, 0, r); avoid.append((1.0, 2.6, 0.8))
        P.folding_chair(1.8, -0.5, r.uniform(0, 6.28), folded=r.random() < 0.5)
    elif variant == 'break':
        W.box((-0.5, 0.72, 1.2), (1.2, 0.04, 0.8), M['wood'])
        for dx in (-0.5, 0.5):
            for dz in (-0.35, 0.35):
                P.box((-0.5 + dx, 0.36, 1.2 + dz), (0.04, 0.72, 0.04), 'steel')
        W.collider_box((-0.5, 0, 1.2), 0.62, 0.42, 0, 0, 0.75)
        for (cx, cz) in [(-1.3, 1.0), (0.3, 1.5), (-0.6, 0.4)]:
            P.folding_chair(cx, cz, r.uniform(0, 6.28), color=['slate', 'navy', 'beige'][r.integers(3)])
        P.box((P.X1 - 0.4, 0.85, 2.4), (0.7, 1.7, 0.65), 'offwhite', collide=True)  # fridge, door ajar
        P.box((P.X1 - 0.75, 0.85, 2.0), (0.04, 1.6, 0.6), 'offwhite', yaw=0.7)
        W.box((P.X1 - 0.35, 0.45, 0.6), (0.6, 0.9, 1.8), M['wood'], collide=True)
        P.box((P.X1 - 0.35, 0.96, 0.3), (0.45, 0.25, 0.35), 'white')  # microwave
        avoid += [(-0.5, 1.2, 1.0), (P.X1 - 0.4, 2.4, 0.6), (P.X1 - 0.35, 0.6, 1.0)]
    else:  # empty: just a couple of fallen tiles and whatever got left
        for _ in range(r.integers(1, 4)):
            W.box((r.uniform(-2.5, 2.5), 0.012, r.uniform(-1.5, 2.5)), (0.6, 0.02, 0.6), M['ceiling_tile'],
                  yaw=r.uniform(0, 6.28), world_uv=False)
    P.scatter(r, int(r.integers(10, 22)), (P.X0 + 0.3, P.X1 - 0.3, P.Z0 + 0.4, P.Z1 - 0.3), avoid)


def control_room(C, door_x, r, group=None):
    """Consoles along the back wall under a row of live CRTs, racks on one side,
    the ring's mimic board on the other. Overhead lights are dead; the screens
    and LEDs light the room."""
    P, W, M = C.P, C.W, C.M
    P.shell(C.WALLS[2], door_x, 1.55, holes={(9, 2), (2, 8)}, exit_live=True)
    P.troffer(*TROFFERS[0], False)
    P.troffer(*TROFFERS[1], False)
    screens = [M['screen_term'], M['screen_amber'], M['screen_blue']]
    led = [M['led_a'], M['led_b']]
    # three console desks along the south wall
    for k, x in enumerate((-2.1, 0.0, 2.1)):
        with W.frame((x, 0, 2.55), 0.0):  # local -z faces into the room
            W.box((0, 0.36, 0), (1.95, 0.72, 0.7), M['metal_grey'])
            W.box((0, 0.74, 0.12), (1.95, 0.04, 0.5), M['metal_grey'])
            # sloped instrument panel
            q = orient([(-0.95, 0.76, -0.12), (0.95, 0.76, -0.12), (0.95, 1.08, 0.3), (-0.95, 1.08, 0.3)], (0, 2, -1))
            W.face(q, M['console'], uv=[((0.95 - p[0]) / 1.9, 1 - (p[1] - 0.76) / 0.32) for p in q])
            W.box((0, 0.92, 0.34), (1.95, 0.36, 0.08), M['metal_grey'])
            W.box((0, 1.11, 0.45), (1.95, 0.04, 0.35), M['metal_grey'])
            for j, sx in enumerate((-0.55, 0.0, 0.55)):
                P.crt((sx, 1.13, 0.45), 0.0 + r.uniform(-0.08, 0.08), screen_mat=screens[(j + k) % 3], color='lightgrey')
            for j in range(16):   # status LEDs along the panel lip
                P.box((-0.9 + j * 0.12, 0.775, -0.125), (0.03, 0.02, 0.012), ['ledgreen', 'ledred', 'ledamber', 'ledgreen'][j % 4],
                      mat=led[(j + k) % 2])
        W.collider_box((x, 0, 2.55), 0.98, 0.36, 0, 0, 1.2)
    W.light((0, 1.45, 2.0), (0.45, 0.9, 0.75), 0.22, 4.5, radius=0.6, name='screens')
    # equipment racks along the east wall
    for k, z in enumerate((-1.6, -0.9, -0.2)):
        with W.frame((P.X1 - 0.42, 0, z), math.pi / 2):
            W.box((0, 1.0, 0), (0.62, 2.0, 0.8), M['metal_grey'], faces='+x-x+y+z')
            q = orient([(-0.3, 0.05, -0.401), (0.3, 0.05, -0.401), (0.3, 1.95, -0.401), (-0.3, 1.95, -0.401)], (0, 1, -1))
            W.face(q, M['rack'], uv=[((0.3 - p[0]) / 0.6, (1.95 - p[1]) / 1.9) for p in q])
            for j in range(10):
                P.box((0.2, 0.25 + j * 0.17, -0.405), (0.02, 0.012, 0.008), ['ledgreen', 'ledamber', 'ledblue'][j % 3],
                      mat=led[(j + k) % 2])
        W.collider_box((P.X1 - 0.42, 0, z), 0.4, 0.31, math.pi / 2, 0, 2.0)
    # the mimic board on the west wall, with a lamp per bay
    bw, bh, by = 3.2, 1.6, 1.75
    fx = P.X0 + 0.024   # clear of the backing panel's face at +0.02, so the two never fight
    W.face([(fx, by - bh / 2, 1.6), (fx, by - bh / 2, -1.6), (fx, by + bh / 2, -1.6),
            (fx, by + bh / 2, 1.6)], M['mimic'], uv=[(0, 1), (1, 1), (1, 0), (0, 0)])
    P.box((P.X0 + 0.01, by, 0), (0.02, bh + 0.08, bw + 0.08), 'charcoal')
    for i in range(20):
        a = 2 * math.pi * i / 20
        u, v = 0.5 + (150 + 30) / 1024 * math.cos(a), (256 + 22 - (150 + 30) * math.sin(a)) / 512
        z, y = 1.6 - u * 3.2, by + bh / 2 - v * bh
        P.box((P.X0 + 0.035, y, z), (0.012, 0.03, 0.04), 'ledred' if i in (10, 11) else 'ledgreen', mat=led[i % 2])
    # chairs, a printer, binders, paper everywhere
    P.office_chair(-1.6, 1.6, math.pi + 0.3)
    P.office_chair(0.4, 1.4, math.pi - 0.5)
    P.office_chair(1.9, 0.2, 2.1, tipped=True)
    P.rbox((2.6, 0.45, 2.0), (0.55, 0.3, 0.45), 'lightgrey', ch=0.03)
    for k in range(5):
        P.box((-3.0 + k * 0.07, 0.15, -2.6), (0.05, 0.3, 0.25), ['navy', 'darkred', 'charcoal', 'green', 'navy'][k], roll=0.1 * k)
    P.scatter(r, 26, (P.X0 + 0.3, P.X1 - 0.6, P.Z0 + 0.4, 2.0), [(door_x, P.Z0 + 0.7, 0.9)])
    for _ in range(14):
        P.debris(r, r.uniform(-2.8, 2.8), r.uniform(-1.5, 1.8), 'paper')


def bathroom(C, door_x, r, group=None):
    P, W, M = C.P, C.W, C.M
    P.shell(M['tile_wall'], door_x, 1.4, holes={(6, 6)}, exit_live=False, floor_mat=M['mosaic'], baseboard=None)
    P.troffer(*TROFFERS[0], True, name='bathroom', group=group, flicker='fluorescent', intensity=0.9)
    P.troffer(*TROFFERS[1], False)
    part = M['metal_beige']
    # three stalls along the east wall
    x_front, x_back = 1.9, P.X1
    zs = [-2.2, -1.2, -0.2, 0.8]
    for z in zs:  # partitions, raised off the floor on pilasters
        W.box(((x_front + x_back) / 2, 1.05, z), (x_back - x_front, 1.7, 0.03), part, collide=True)
        P.box((x_front, 0.1, z), (0.05, 0.2, 0.05), 'steel')
        P.box((x_front + 0.02, 0.012, z), (0.09, 0.024, 0.07), 'steel')                       # pilaster shoe
        for y in (0.4, 1.6):                                                                   # wall brackets
            P.box((x_back - 0.03, y, z + 0.02), (0.05, 0.04, 0.008), 'steel')
            P.box((x_back - 0.03, y, z - 0.02), (0.05, 0.04, 0.008), 'steel')
    P.tube((x_front, 1.93, zs[0]), (x_front, 1.93, zs[-1]), 0.02, 'steel', sides=6)             # head rail
    doors = [0.2, None, 1.4]   # ajar, missing (lying on the floor), wide open
    for k in range(3):
        z0, z1 = zs[k], zs[k + 1]
        zc = (z0 + z1) / 2
        W.box((x_front, 1.05, z0 + 0.09), (0.03, 1.7, 0.15), part)
        W.box((x_front, 1.05, z1 - 0.09), (0.03, 1.7, 0.15), part)
        W.collider_box((x_front, 0, z0 + 0.09), 0.03, 0.08, 0, 0, 1.9)
        W.collider_box((x_front, 0, z1 - 0.09), 0.03, 0.08, 0, 0, 1.9)
        if doors[k] is not None:
            hinge = np.array([x_front, 0, z0 + 0.17])
            a = doors[k]
            with W.frame(hinge, -math.pi / 2 + a):
                W.box((0.33, 1.05, 0), (0.64, 1.55, 0.03), part)
                for hy in (0.45, 1.6):
                    P.box((0.03, hy, 0), (0.07, 0.1, 0.036), 'steel')                          # hinge plates
                P.box((0.6, 1.0, -0.022), (0.05, 0.09, 0.012), 'steel')                       # latch
                P.box((0.6, 1.0, 0.022), (0.05, 0.09, 0.012), 'steel')
                P.box((0.6, 1.0, -0.035), (0.012, 0.03, 0.02), 'black')
                P.tube((0.3, 1.62, 0.016), (0.3, 1.62, 0.07), 0.008, 'steel', sides=6)       # coat hook
        else:
            W.box((x_front - 0.7, 0.03, zc + 0.2), (0.66, 0.03, 1.55), part, yaw=0.3)
        # toilet
        tx = x_back - 0.45
        with W.frame((tx, 0, zc), math.pi / 2):      # tank against the back wall, bowl toward the stall door
            P.cyl((0, 0, 0.06), 0.12, 0.05, 'porcelain', sides=16)                               # foot
            P.cyl((0, 0.05, 0.04), 0.115, 0.22, 'porcelain', sides=16, top=0.16)                 # pedestal
            P.cyl((0, 0.27, 0.0), 0.16, 0.08, 'porcelain', sides=18, top=0.2)                    # bowl
            P.cyl((0, 0.35, 0.0), 0.2, 0.025, 'porcelain', sides=18)                             # rim
            P.cyl((0, 0.352, 0.0), 0.15, 0.026, 'dirty', sides=18)                               # inside, stained
            P.cyl((-0.09, 0.0, 0.05), 0.014, 0.02, 'white', sides=6)                             # bolt caps
            P.cyl((0.09, 0.0, 0.05), 0.014, 0.02, 'white', sides=6)
            if k != 2:   # seat: a horseshoe of two halves, and the lid up
                for s_ in (-1, 1):
                    P.rbox((s_ * 0.13, 0.385, -0.02), (0.08, 0.025, 0.36), 'black' if k == 0 else 'white', ch=0.01, yaw=s_ * 0.18)
                P.rbox((0, 0.385, 0.16), (0.3, 0.025, 0.06), 'black' if k == 0 else 'white', ch=0.01)
            if k != 1:
                P.rbox((0, 0.62, 0.28), (0.46, 0.36, 0.17), 'porcelain', ch=0.025)              # tank
                P.rbox((0, 0.81, 0.28), (0.48, 0.035, 0.19), 'porcelain', ch=0.012)             # tank lid
                P.box((-0.17, 0.74, 0.19), (0.07, 0.015, 0.015), 'steel')                       # flush lever
                P.rbox((0, 0.97, 0.12), (0.4, 0.03, 0.42), 'porcelain', ch=0.01, pitch=-1.45)  # seat lid up
            else:
                P.tube((0, 0.45, 0.33), (0, 1.0, 0.36), 0.02, 'steel', sides=8)              # flush valve, no tank
                P.cyl((0, 0.98, 0.33), 0.045, 0.1, 'steel', sides=10)
                P.tube((0, 0.4, 0.05), (0, 0.45, 0.33), 0.022, 'steel', sides=8)
        W.collider_circle((tx, 0, zc), 0.25, 0, 0.5)
        P.cyl((x_back - 0.06, 0.75, z0 + 0.3), 0.06, 0.1, 'white', axis='x', sides=8)  # toilet roll
    # urinals on the south wall
    for k, x in enumerate((-0.4, 0.5)):
        # a rounded wall-hung bowl: wide at the lip, tapering into the wall
        pts = []
        for t in np.linspace(0, 2 * math.pi, 14, endpoint=False):
            for yy, rx, rz in ((0.52, 0.17, 0.13), (0.7, 0.2, 0.17), (0.95, 0.19, 0.16), (1.18, 0.15, 0.1)):
                pts.append((x + math.cos(t) * rx, yy, P.Z1 - 0.16 + min(0.0, math.sin(t)) * rz * 1.4 + max(0.0, math.sin(t)) * 0.12))
        P.hull(pts, 'porcelain')
        P.box((x, 0.86, P.Z1 - 0.31), (0.24, 0.34, 0.02), 'dirty')
        P.cyl((x, 0.6, P.Z1 - 0.2), 0.03, 0.01, 'steel', sides=8)                                 # drain
        P.box((x + 0.45, 1.05, P.Z1 - 0.22), (0.03, 0.9, 0.42), 'beige')
        P.tube((x, 1.2, P.Z1 - 0.06), (x, 1.75, P.Z1 - 0.06), 0.015, 'steel')
    W.collider_box((0.05, 0, P.Z1 - 0.2), 0.7, 0.2, 0, 0, 1.2)
    # sinks and mirror on the west wall
    W.box((P.X0 + 0.3, 0.84, -0.6), (0.58, 0.06, 2.6), M['tile_wall'])
    W.box((P.X0 + 0.3, 0.42, -0.6), (0.5, 0.8, 0.04), part)
    for z in (-1.4, -0.2):
        P.rbox((P.X0 + 0.3, 0.86, z), (0.42, 0.04, 0.46), 'porcelain', ch=0.015)                 # basin rim
        P.box((P.X0 + 0.3, 0.875, z), (0.32, 0.012, 0.36), 'dirty')                               # bowl
        P.cyl((P.X0 + 0.3, 0.878, z), 0.02, 0.006, 'steel', sides=8)                              # plug hole
        P.cyl((P.X0 + 0.07, 0.88, z), 0.025, 0.02, 'steel', sides=10)                             # faucet base
        P.tube((P.X0 + 0.07, 0.88, z), (P.X0 + 0.07, 1.04, z), 0.013, 'steel', sides=8)
        P.tube((P.X0 + 0.07, 1.04, z), (P.X0 + 0.2, 1.01, z), 0.011, 'steel', sides=8)
        for s_ in (-1, 1):
            P.rbox((P.X0 + 0.08, 0.92, z + s_ * 0.1), (0.04, 0.03, 0.06), 'steel', ch=0.008)  # taps
        P.tube((P.X0 + 0.3, 0.84, z), (P.X0 + 0.3, 0.55, z), 0.018, 'steel', sides=8)       # trap
        P.tube((P.X0 + 0.3, 0.55, z), (P.X0 + 0.02, 0.5, z), 0.018, 'steel', sides=8)
    P.rbox((P.X0 + 0.06, 1.25, -0.8), (0.1, 0.2, 0.12), 'white', ch=0.02)                         # soap dispenser
    W.collider_box((P.X0 + 0.3, 0, -0.6), 0.3, 1.3, 0, 0, 0.9)
    W.face([(P.X0 + 0.015, 1.15, 0.6), (P.X0 + 0.015, 1.15, -1.8), (P.X0 + 0.015, 2.05, -1.8), (P.X0 + 0.015, 2.05, 0.6)],
           M['mirror'], uv=[(0, 1), (2.4, 1), (2.4, 0), (0, 0)])
    P.rbox((P.X0 + 0.12, 1.4, 1.1), (0.22, 0.36, 0.3), 'steel', ch=0.03)     # paper towels
    P.rbox((P.X0 + 0.12, 1.2, 1.7), (0.2, 0.26, 0.3), 'white', ch=0.06)      # hand dryer
    # wet floor sign, rolls and broken tile
    with W.frame((0.2, 0, -0.6), 0.6):
        P.box((0, 0.32, -0.12), (0.3, 0.64, 0.015), 'yellow', pitch=0.22)
        P.box((0, 0.32, 0.12), (0.3, 0.64, 0.015), 'yellow', pitch=-0.22)
    for _ in range(4):
        P.cyl((r.uniform(-1.5, 1.2), 0.06, r.uniform(-1.5, 2.2)), 0.06, 0.1, 'white', axis='x', yaw=r.uniform(0, 6), sides=8)
    for _ in range(8):
        P.box((r.uniform(-2.5, 1.5), 0.006, r.uniform(-2.5, 2.5)), (0.15, 0.012, 0.15), 'mint', yaw=r.uniform(0, 6))
    P.scatter(r, 10, (-2.8, 1.6, -2.4, 2.5), [(door_x, P.Z0 + 0.7, 0.9), (0.2, -0.6, 0.4)])


def squatter_room(C, door_x, r):
    """Somebody lives here: a mattress under a tarp lean-to, a cart full of bags, a crate kitchen
    with a camp stove, candles and a lantern, washing on a line across the room."""
    P, W, M = C.P, C.W, C.M
    P.shell(C.WALLS[1], door_x, 1.2, holes={(1, 6), (2, 6), (9, 1), (10, 8)}, exit_live=False)
    P.troffer(*TROFFERS[0], False)
    P.troffer(*TROFFERS[1], False)
    X0, X1, Z1 = P.X0, P.X1, P.Z1
    wave = lambda a, b, c=0.0: math.sin(a * 17.3 + b * 9.1 + c) * 0.6 + math.sin(a * 7.7 - b * 13.9 + 2 * c) * 0.4

    # ---- the camp floor: an old rug and flattened boxes laid down under the bed
    P.rbox((-2.2, 0.004, 1.7), (1.9, 0.008, 2.4), mat=M['cloth_red'], ch=0.003, yaw=0.04)
    for k in range(6):
        W.box((r.uniform(-3.1, -1.5), 0.01 + 0.002 * k, r.uniform(0.6, 2.7)), (r.uniform(0.6, 0.95), 0.006, r.uniform(0.5, 0.85)),
              M['cardboard'], yaw=r.uniform(-0.4, 0.4), world_uv=False)

    # ---- the bed: a mattress (piped edges, a stain), a sleeping bag thrown over and spilling onto the floor
    mx, mz, mw, ml = -2.85, 1.85, 0.95, 1.95
    P.rbox((mx, 0.115, mz), (mw, 0.2, ml), mat=M['fabric_mattress'], ch=0.06, yaw=0.03)
    for sx in (-1, 1):
        P.tube((mx + sx * (mw / 2 - 0.02), 0.2, mz - ml / 2 + 0.05), (mx + sx * (mw / 2 - 0.02) + 0.06 * 0.03, 0.2, mz + ml / 2 - 0.05), 0.008, 'offwhite', sides=4)
    P.box((mx - 0.15, 0.2155, mz - 0.45), (0.3, 0.001, 0.22), 'dirty', yaw=0.6)
    W.collider_box((mx, 0, mz), mw / 2, ml / 2, 0.03, 0, 0.3)

    def bag_fn(u, v):
        z = 0.95 + u * 1.55
        x = -3.25 + v * 1.2
        e = x - (mx + mw / 2 - 0.03)
        y = 0.26 + 0.035 * wave(u, v) if e < 0 else max(0.02 + 0.01 * wave(u, v, 1), 0.26 - e * 3.2)
        x_ = x if e < 0 else (mx + mw / 2 - 0.03) + min(e, 0.05) + max(0, e - 0.05) * 0.8
        return (x_, y + 0.01 * wave(v, u, 2), z)
    P.surface(bag_fn, 18, 14, mat=M['cloth_olive'])
    P.rbox((mx + 0.05, 0.29, 2.6), (0.55, 0.13, 0.33), 'offwhite', ch=0.055, yaw=-0.12)          # pillow
    P.rbox((mx + 0.05, 0.36, 2.6), (0.4, 0.001, 0.2), 'beige', ch=0.0, yaw=-0.12)
    P.blob((-2.4, 0.25, 1.25), (0.25, 0.11, 0.28), None, r, mat=M['cloth_khaki'])                 # bundled clothes

    # ---- the lean-to: a blue tarp from nails in the wall over a rope ridge on two timber poles,
    #      its flap guyed out to bricks on the floor
    tarp = M['cloth_blue']
    wall_t, ridge, foot = (X0 + 0.03, 2.05), (-2.0, 1.2), (-1.72, 0.22)
    z0, z1 = 0.62, 3.05

    def tarp_fn(u, v):
        z = z0 + (z1 - z0) * u
        hang = 0.06 * abs(math.sin(u * math.pi * 2))          # droops between its tie points
        if v < 0.62:
            t = v / 0.62
            x = wall_t[0] + (ridge[0] - wall_t[0]) * t
            y = wall_t[1] + (ridge[1] - wall_t[1]) * t - 0.11 * math.sin(math.pi * t) - hang * (1 - abs(2 * t - 1))
        else:
            t = (v - 0.62) / 0.38
            x = ridge[0] + (foot[0] - ridge[0]) * t + 0.05 * math.sin(math.pi * t)
            y = ridge[1] + (foot[1] - ridge[1]) * t
        return (x + 0.012 * wave(u, v), y + 0.01 * wave(v, u, 1), z)
    P.surface(tarp_fn, 16, 14, mat=tarp)
    for z in (z0 + 0.06, (z0 + z1) / 2, z1 - 0.06):                                              # nails in the wall
        P.box((X0 + 0.02, wall_t[1] + 0.02, z), (0.04, 0.012, 0.012), 'steel')
    for z in (0.75, 2.95):                                                                        # 2x4 poles
        W.box((ridge[0], ridge[1] / 2, z), (0.09, ridge[1] + 0.05, 0.045), M['wood'], world_uv=False)
    rope = [np.array([ridge[0], ridge[1] + 0.04 - 0.05 * math.sin(math.pi * t), 0.75 + 2.2 * t]) for t in np.linspace(0, 1, 8)]
    for a, b in zip(rope[:-1], rope[1:]):
        P.tube(a, b, 0.006, 'rope', sides=4, caps=False)
    for z in (z0 + 0.05, z1 - 0.05):                                                              # guy lines to bricks
        a, b = np.array([foot[0], foot[1], z]), np.array([-1.35, 0.06, z + (0.15 if z > 1.5 else -0.15)])
        P.tube(a, b, 0.004, 'rope', sides=3, caps=False)
        P.rbox((b[0] + 0.05, 0.035, b[2]), (0.21, 0.065, 0.1), 'darkred', ch=0.008, yaw=0.3)

    # ---- the shopping cart, stuffed
    with W.frame((-0.9, 0, 2.3), 0.4):
        base_y, top_y = 0.45, 0.95
        bx, bz, tx_, tz_ = 0.25, 0.38, 0.3, 0.46                     # basket narrower at the bottom
        for sx in (-1, 1):
            for sz in (-1, 1):
                P.cyl((sx * 0.22, 0.0, sz * 0.36), 0.04, 0.028, 'black', axis='x', sides=8)       # casters
                P.box((sx * 0.22, 0.06, sz * 0.36), (0.035, 0.04, 0.03), 'steel')
            P.tube((sx * 0.22, 0.08, -0.36), (sx * 0.22, 0.08, 0.36), 0.009, 'steel', sides=4)       # chassis rails
            P.tube((sx * 0.22, 0.08, 0.36), (sx * tx_, top_y, tz_), 0.009, 'steel', sides=4)
            P.tube((sx * 0.22, 0.08, -0.36), (sx * bx, base_y, -bz), 0.009, 'steel', sides=4)
        P.box((0, 0.13, 0), (0.42, 0.01, 0.66), 'steel')                                            # bottom rack
        rim = lambda y, w, d: [(-w, y, -d), (w, y, -d), (w, y, d), (-w, y, d)]
        for ring in (rim(base_y, bx, bz), rim((base_y + top_y) / 2, (bx + tx_) / 2, (bz + tz_) / 2), rim(top_y, tx_, tz_)):
            for a, b in zip(ring, ring[1:] + ring[:1]):
                P.tube(a, b, 0.006, 'steel', sides=4, caps=False)
        for t in np.linspace(-1, 1, 9):                                                            # wire walls
            for sx in (-1, 1):
                P.tube((sx * bx, base_y, t * bz), (sx * tx_, top_y, t * tz_), 0.003, 'steel', sides=3, caps=False)
            for sz in (-1, 1):
                P.tube((t * bx, base_y, sz * bz), (t * tx_, top_y, sz * tz_), 0.003, 'steel', sides=3, caps=False)
        for t in np.linspace(-1, 1, 7):
            P.tube((t * bx, base_y, -bz), (t * bx, base_y, bz), 0.003, 'steel', sides=3, caps=False)
        P.tube((-0.31, 1.02, 0.56), (0.31, 1.02, 0.56), 0.016, 'red', sides=6)                       # handle grip
        for sx in (-1, 1):
            P.tube((sx * tx_, top_y, tz_), (sx * 0.31, 1.02, 0.56), 0.008, 'steel', sides=4)
        for k, col in enumerate(['black', 'white', 'blue', 'black', 'lightgrey']):
            c = (r.uniform(-0.12, 0.12), 0.6 + 0.11 * k, r.uniform(-0.22, 0.22))
            P.blob(c, (0.19, 0.13, 0.21), col, r, n=14)
            P.blob((c[0], c[1] + 0.2, c[2]), (0.04, 0.04, 0.04), col, r, n=7)                         # tied neck
        W.box((0.05, 1.05, -0.3), (0.42, 0.32, 0.012), M['cardboard'], roll=0.12, world_uv=False)  # a sign, face down
    W.collider_box((-0.9, 0, 2.3), 0.32, 0.5, 0.4, 0, 1.0)

    # ---- bin bags piled against the east wall, necks tied off
    for k in range(6):
        c = (X1 - 0.38 - r.uniform(0, 0.45), 0, r.uniform(-1.8, 0.4))
        s_ = r.uniform(0.85, 1.15)
        P.blob(c, (0.27 * s_, 0.23 * s_, 0.24 * s_), 'black', r, n=16)
        top = (c[0] + r.uniform(-0.05, 0.05), 0.42 * s_, c[2] + r.uniform(-0.05, 0.05))
        P.blob(top, (0.05, 0.05, 0.05), 'black', r, n=8, flatten_bottom=False)
        for e in (-1, 1):
            P.blob((top[0] + e * 0.05, top[1] + 0.05, top[2]), (0.035, 0.015, 0.02), 'black', r, n=6, flatten_bottom=False)
    W.collider_box((X1 - 0.6, 0, -0.7), 0.45, 1.25, 0, 0, 0.6)

    # ---- kitchen: two milk crates under a plank, a camp stove and a pot, water jugs, a jar
    def milk_crate(c, color, yaw=0.0):
        with W.frame(c, yaw):
            s_ = 0.17
            for y in (0.015, 0.15, 0.29):                                            # rails round the sides
                for a, b in [((-s_, y, -s_), (s_, y, -s_)), ((s_, y, -s_), (s_, y, s_)), ((s_, y, s_), (-s_, y, s_)), ((-s_, y, s_), (-s_, y, -s_))]:
                    P.tube(a, b, 0.012, color, sides=4)
            for t in np.linspace(-1, 1, 5):                                          # uprights
                for a, b in [((t * s_, 0.0, -s_), (t * s_, 0.3, -s_)), ((t * s_, 0.0, s_), (t * s_, 0.3, s_)),
                             ((-s_, 0.0, t * s_), (-s_, 0.3, t * s_)), ((s_, 0.0, t * s_), (s_, 0.3, t * s_))]:
                    P.tube(a, b, 0.008, color, sides=4, caps=False)
            for t in np.linspace(-0.8, 0.8, 5):
                P.box((t * s_, 0.008, 0), (0.025, 0.016, 0.33), color)                # base grid
        W.collider_box(c, 0.17, 0.17, yaw, c[1], c[1] + 0.3)
    milk_crate((-1.2, 0, 0.6), 'blue', 0.2)
    milk_crate((-1.2, 0.3, 0.6), 'red', -0.1)
    W.box((-1.2, 0.615, 0.6), (0.62, 0.03, 0.38), M['wood'], yaw=0.05, world_uv=False)           # plank top
    with W.frame((-1.33, 0.63, 0.6), 0.2):                                                         # butane camp stove
        P.rbox((0, 0.045, 0), (0.33, 0.09, 0.26), 'charcoal', ch=0.01)
        P.cyl((0.02, 0.09, 0), 0.055, 0.012, 'steel', sides=12)
        for k in range(4):
            a = k * math.pi / 2 + 0.4
            P.tube((0.02 + math.cos(a) * 0.03, 0.105, math.sin(a) * 0.03), (0.02 + math.cos(a) * 0.08, 0.115, math.sin(a) * 0.08), 0.004, 'black', sides=3)
        P.cyl((-0.13, 0.05, 0.1), 0.012, 0.02, 'black', axis='z', sides=6)                        # knob
        P.lathe((0.02, 0.115, 0), [(0.0, 0.0), (0.08, 0.0), (0.085, 0.01), (0.09, 0.1), (0.094, 0.104)], 'steel', sides=14, caps=False)  # pot
        P.lathe((0.02, 0.118, 0), [(0.0, 0.0), (0.083, 0.0)], 'charcoal', sides=14)
        P.tube((0.11, 0.2, 0), (0.24, 0.205, 0.02), 0.006, 'black', sides=4)                       # handle
    P.lathe((-0.98, 0.63, 0.47), [(0.0, 0.0), (0.032, 0.0), (0.035, 0.01), (0.035, 0.075), (0.027, 0.085), (0.027, 0.095), (0.0, 0.095)],
            'glass', sides=10)                                                                     # a jar of something
    P.lathe((-0.98, 0.725, 0.47), [(0.0, 0.0), (0.029, 0.0), (0.029, 0.014), (0.0, 0.014)], 'red', sides=10)
    P.rbox((-1.45, 0.75, 0.68), (0.07, 0.24, 0.17), 'yellow', ch=0.004, yaw=0.3)                   # cereal box
    P.box((-1.45, 0.78, 0.592), (0.05, 0.08, 0.001), 'red', yaw=0.3)
    for k in range(3):                                                                              # water jugs
        with W.frame((-0.6 + 0.24 * k, 0, -0.1), 0.2 * k):
            P.rbox((0, 0.14, 0), (0.17, 0.28, 0.17), 'jug', ch=0.035)
            P.cyl((0.04, 0.28, 0.04), 0.022, 0.035, 'jug', sides=8)
            P.cyl((0.04, 0.315, 0.04), 0.024, 0.015, 'blue', sides=8)
            P.tube((-0.05, 0.27, -0.05), (-0.06, 0.2, 0.06), 0.012, 'jug', sides=5)
    P.camp_chair(-0.55, 1.05, 2.6, 'green')

    # ---- light: candles on saucers, a camping lantern, a radio
    for (x, z, h) in [(-1.25, 0.82, 0.08), (-1.5, 0.25, 0.12), (-2.35, 2.75, 0.06)]:
        y0 = 0.63 if x == -1.25 else 0.0
        P.cyl((x, y0, z), 0.05, 0.008, 'white', sides=12)                                          # saucer
        P.cyl((x, y0 + 0.008, z), 0.022, h, 'offwhite', sides=8)
        for k in range(3):
            a = r.uniform(0, 6.28)
            P.blob((x + math.cos(a) * 0.022, y0 + 0.008 + h * r.uniform(0.3, 0.8), z + math.sin(a) * 0.022), (0.006, 0.014, 0.006),
                   'offwhite', r, n=6, flatten_bottom=False)                                          # wax drips
        P.cyl((x, y0 + 0.008 + h, z), 0.0015, 0.012, 'black', sides=3)                               # wick
        P.lathe((x, y0 + 0.012 + h, z), [(0.0, 0.0), (0.008, 0.008), (0.005, 0.022), (0.0, 0.032)], 'warm', mat=M['glow'], sides=6)
        W.light((x, y0 + h + 0.05, z), (1.0, 0.6, 0.3), 0.1, 2.0, radius=0.02, runtime=False)
    with W.frame((-1.7, 0, 1.15), 0.3):                                                             # camping lantern
        P.rbox((0, 0.04, 0), (0.15, 0.08, 0.15), 'navy', ch=0.015)
        P.lathe((0, 0.08, 0), [(0.0, 0.0), (0.05, 0.0), (0.056, 0.05), (0.05, 0.11), (0.0, 0.11)], 'warm', mat=M['glow'], sides=10)
        for k in range(3):
            a = k * 2 * math.pi / 3
            P.tube((math.cos(a) * 0.058, 0.08, math.sin(a) * 0.058), (math.cos(a) * 0.058, 0.195, math.sin(a) * 0.058), 0.004, 'navy', sides=3)
        P.lathe((0, 0.19, 0), [(0.0, 0.0), (0.07, 0.0), (0.04, 0.03), (0.0, 0.035)], 'navy', sides=10)
        handle = [np.array([math.cos(t) * 0.055, 0.225 + math.sin(t) * 0.04, 0]) for t in np.linspace(0, math.pi, 7)]
        for a, b in zip(handle[:-1], handle[1:]):
            P.tube(a, b, 0.004, 'steel', sides=3, caps=False)
    W.light((-1.7, 0.4, 1.15), (1.0, 0.72, 0.42), 0.85, 6.0, radius=0.06, name='squat_lantern', flicker='candle')
    with W.frame((-0.3, 0, 0.9), 0.5):                                                              # boombox
        P.rbox((0, 0.11, 0), (0.36, 0.2, 0.11), 'charcoal', ch=0.02)
        for sx in (-0.11, 0.11):
            P.cyl((sx, 0.1, -0.056), 0.055, 0.006, 'black', axis='z', sides=12)
            P.cyl((sx, 0.1, -0.06), 0.02, 0.006, 'grey', axis='z', sides=8)
        P.box((0, 0.17, -0.057), (0.1, 0.035, 0.004), 'screen')
        P.tube((-0.15, 0.21, 0), (0.15, 0.21, 0), 0.008, 'black', sides=4)
        P.tube((0.16, 0.21, 0.02), (0.05, 0.62, 0.0), 0.003, 'steel', sides=3)                      # antenna

    # ---- washing on a line from wall to wall over the lean-to, pegged on
    a, b = np.array([X1 - 0.02, 2.15, 1.6]), np.array([X0 + 0.02, 2.3, 1.6])
    line = [a + (b - a) * t - np.array([0, 0.18 * math.sin(math.pi * t), 0]) for t in np.linspace(0, 1, 16)]
    for p, q in zip(line[:-1], line[1:]):
        P.tube(p, q, 0.004, 'rope', sides=3, caps=False)
    for e in (a, b):
        P.box(e, (0.04, 0.02, 0.02), 'steel')
    line_at = lambda t: a + (b - a) * t - np.array([0, 0.18 * math.sin(math.pi * t), 0])

    def hang(t, shape, mat):
        p = line_at(t)
        outline = [p + np.array([dx, dy, 0.0]) for dx, dy in shape]
        W.face(outline, mat)
        top = [q for q in outline if q[1] > p[1] - 0.03]
        for q in top[:2]:
            P.box(q + np.array([0, 0.012, 0]), (0.012, 0.04, 0.02), 'tan')                          # pegs
    shirt = [(-0.17, -0.01), (-0.06, 0.0), (0.06, 0.0), (0.17, -0.01), (0.26, -0.12), (0.2, -0.17), (0.15, -0.12),
             (0.15, -0.6), (-0.15, -0.6), (-0.15, -0.12), (-0.2, -0.17), (-0.26, -0.12)]
    jeans = [(-0.19, 0.0), (0.19, 0.0), (0.2, -0.85), (0.04, -0.85), (0.0, -0.28), (-0.04, -0.85), (-0.2, -0.85)]
    towel = [(-0.22, 0.0), (0.22, 0.0), (0.21, -0.55), (-0.23, -0.53)]
    sock = [(-0.04, 0.0), (0.04, 0.0), (0.04, -0.2), (0.12, -0.24), (0.11, -0.3), (-0.04, -0.27)]
    for t, shape, col in [(0.12, shirt, 'red'), (0.3, jeans, 'denim'), (0.47, towel, 'white'), (0.6, shirt, 'khaki'), (0.7, sock, 'navy'), (0.74, sock, 'navy')]:
        hang(t, shape, M['cloth_' + col])

    # ---- books, shoes, a broom, a photo taped to the wall
    for k in range(6):
        y, yaw = 0.03 + 0.045 * k, r.uniform(-0.3, 0.3)
        P.box((-3.25, y, 0.4), (0.18, 0.04, 0.25), ['navy', 'red', 'green', 'beige', 'brown', 'khaki'][k], yaw=yaw)
        P.box((-3.25 + 0.006, y, 0.4), (0.175, 0.03, 0.235), 'paper', yaw=yaw)                    # page edges
    for k in range(2):                                                                              # sneakers
        with W.frame((-1.75 + 0.15 * k, 0, 2.95), 0.15 * k - 0.1):
            P.rbox((0, 0.015, 0), (0.1, 0.03, 0.28), 'white', ch=0.012)
            P.blob((0, 0.03, -0.02), (0.05, 0.05, 0.12), 'charcoal', r, n=12)
            P.box((0, 0.09, 0.02), (0.06, 0.004, 0.08), 'white')
    P.tube((X1 - 0.12, 0.08, 2.6), (X1 - 0.3, 1.32, 2.75), 0.012, 'darkwood')                      # broom
    with W.frame((X1 - 0.12, 0.0, 2.6), 0.3):
        P.rbox((0, 0.07, 0), (0.3, 0.05, 0.06), 'red', ch=0.01)
        P.box((0, 0.025, 0), (0.29, 0.05, 0.05), 'tan')
    P.box((X1 - 0.012, 1.45, -1.7), (0.004, 0.16, 0.11), 'paper')                                     # a photo, taped up
    P.box((X1 - 0.015, 1.45, -1.7), (0.004, 0.13, 0.085), 'teal')
    for dy in (-0.08, 0.08):
        P.box((X1 - 0.017, 1.45 + dy, -1.7), (0.002, 0.018, 0.05), 'beige')
    P.scatter(r, 24, (P.X0 + 0.3, P.X1 - 0.3, P.Z0 + 0.4, 0.3), [(door_x, P.Z0 + 0.7, 0.8)])
