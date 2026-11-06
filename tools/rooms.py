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
    W.face([(P.X0 + 0.02, by - bh / 2, 1.6), (P.X0 + 0.02, by - bh / 2, -1.6), (P.X0 + 0.02, by + bh / 2, -1.6),
            (P.X0 + 0.02, by + bh / 2, 1.6)], M['mimic'], uv=[(0, 1), (1, 1), (1, 0), (0, 0)])
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
        with W.frame((tx, 0, zc), -math.pi / 2):
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
    """Somebody lives here: a mattress under a tarp lean-to, a cart full of
    bags, a camp stove, candles, a clothesline."""
    P, W, M = C.P, C.W, C.M
    P.shell(C.WALLS[1], door_x, 1.2, holes={(1, 6), (2, 6), (9, 1), (10, 8)}, exit_live=False)
    P.troffer(*TROFFERS[0], False)
    P.troffer(*TROFFERS[1], False)
    # cardboard laid on the floor of the camp
    for k in range(7):
        W.box((r.uniform(-3.1, -1.4), 0.004 + 0.002 * k, r.uniform(0.6, 2.7)), (r.uniform(0.6, 1.0), 0.006, r.uniform(0.5, 0.9)),
              M['cardboard'], yaw=r.uniform(-0.4, 0.4), world_uv=False)
    # mattress, sleeping bag, pillow
    P.rbox((-2.85, 0.1, 1.85), (0.95, 0.2, 1.95), mat=M['fabric_mattress'], ch=0.05, yaw=0.03)
    P.rbox((-2.8, 0.25, 2.0), (0.8, 0.12, 1.5), 'olive', ch=0.05, yaw=0.08)
    P.blob((-2.85, 0.2, 2.65), (0.3, 0.08, 0.17), 'denim', r)
    P.blob((-2.4, 0.2, 1.3), (0.25, 0.12, 0.3), 'khaki', r)   # bundled clothes
    W.collider_box((-2.85, 0, 1.85), 0.48, 0.98, 0.03, 0, 0.3)
    # tarp lean-to over the mattress, on a pole
    tarp = M['cloth_blue']
    W.face([(P.X0 + 0.02, 2.05, 0.7), (P.X0 + 0.02, 2.05, 3.0), (-2.0, 1.05, 3.0), (-2.0, 1.05, 0.7)], tarp)
    W.face([(-2.0, 1.05, 0.7), (-2.0, 1.05, 3.0), (-1.75, 0.2, 3.0), (-1.75, 0.2, 0.7)], tarp)
    for z in (0.75, 2.95):
        P.tube((-2.0, 0, z), (-2.0, 1.08, z), 0.018, 'brown')
    # shopping cart stuffed with bags
    with W.frame((-0.9, 0, 2.3), 0.4):
        for sx in (-0.25, 0.25):
            for sz in (-0.4, 0.4):
                P.cyl((sx, 0.0, sz), 0.04, 0.03, 'black', axis='x', sides=6)
                P.tube((sx, 0.05, sz), (sx * 1.1, 0.5, sz * 1.1), 0.01, 'steel')
        for y in (0.5, 0.95):
            pts = [(-0.29, y, -0.46), (0.29, y, -0.46), (0.29, y, 0.46), (-0.29, y, 0.46)]
            for a, b in zip(pts, pts[1:] + pts[:1]):
                P.tube(a, b, 0.008, 'steel', sides=4)
        for sz in np.linspace(-0.46, 0.46, 7):
            P.tube((-0.29, 0.5, sz), (-0.29, 0.95, sz), 0.005, 'steel', sides=4, caps=False)
            P.tube((0.29, 0.5, sz), (0.29, 0.95, sz), 0.005, 'steel', sides=4, caps=False)
        P.tube((-0.3, 1.0, 0.55), (0.3, 1.0, 0.55), 0.015, 'red')
        for k in range(4):
            P.blob((r.uniform(-0.15, 0.15), 0.62 + 0.12 * k, r.uniform(-0.25, 0.25)), (0.2, 0.14, 0.22),
                   ['black', 'white', 'blue', 'black'][k], r)
    W.collider_box((-0.9, 0, 2.3), 0.32, 0.5, 0.4, 0, 1.0)
    # bags piled against the east wall
    for k in range(6):
        P.blob((P.X1 - 0.4 - r.uniform(0, 0.5), 0, r.uniform(-1.8, 0.4)), (0.28, 0.24, 0.24), 'black', r)
    W.collider_box((P.X1 - 0.6, 0, -0.7), 0.45, 1.25, 0, 0, 0.6)
    # kitchen: crate table with a camp stove, pot, cans, water jugs
    crate(P, (-1.2, 0, 0.6), 'blue', 0.2)
    crate(P, (-1.2, 0.3, 0.6), 'red', -0.1)
    P.box((-1.2, 0.66, 0.6), (0.3, 0.07, 0.24), 'steel', yaw=0.2)
    P.cyl((-1.25, 0.7, 0.6), 0.09, 0.11, 'charcoal', sides=10)
    for k in range(5):
        P.cyl((-0.85 + 0.09 * k, 0, 0.25 + (k % 2) * 0.1), 0.04, 0.11, ['steel', 'red', 'yellow', 'steel', 'green'][k], sides=7)
    for k in range(3):
        P.rbox((-0.6 + 0.25 * k, 0.16, -0.1), (0.2, 0.32, 0.15), 'white', ch=0.03)
    # candles, a lantern and a radio
    for (x, z, h) in [(-1.25, 0.82, 0.08), (-1.5, 0.25, 0.12), (-2.35, 2.75, 0.06)]:
        y0 = 0.6 if x == -1.25 else 0.0
        P.cyl((x, y0, z), 0.025, h, 'offwhite', sides=6)
        P.cyl((x, y0 + h, z), 0.008, 0.025, 'warm', mat=M['glow'], sides=4)
        W.light((x, y0 + h + 0.05, z), (1.0, 0.6, 0.3), 0.1, 2.0, radius=0.02, runtime=False)
    P.rbox((-1.7, 0.12, 1.15), (0.14, 0.24, 0.14), 'navy', ch=0.02)
    P.cyl((-1.7, 0.24, 1.15), 0.05, 0.08, 'warm', mat=M['glow'], sides=8)
    W.light((-1.7, 0.4, 1.15), (1.0, 0.72, 0.42), 0.85, 6.0, radius=0.06, name='squat_lantern', flicker='candle')
    P.rbox((-0.3, 0.1, 0.9), (0.32, 0.2, 0.1), 'charcoal', ch=0.02, yaw=0.5)
    P.tube((-0.4, 0.2, 0.9), (-0.55, 0.55, 0.85), 0.004, 'steel', sides=4)
    # clothesline across the room
    a, b = np.array([P.X1 - 0.02, 2.1, 1.6]), np.array([-1.0, 2.0, 1.6])
    P.tube(a, b, 0.005, 'white', sides=4, caps=False)
    for k, col in enumerate(['denim', 'red', 'khaki', 'white', 'olive']):
        p = a + (b - a) * (0.15 + 0.17 * k)
        W.face(orient([p + (-0.18, -0.02, 0), p + (0.18, -0.02, 0), p + (0.17, -0.62, 0.0), p + (-0.17, -0.62, 0.0)],
                      p + (0, -0.3, -1)), M['cloth_' + col] if 'cloth_' + col in M else M['cloth_navy'])
    # books, shoes, a broom
    for k in range(6):
        P.box((-3.25, 0.03 + 0.045 * k, 0.4), (0.18, 0.04, 0.25), ['navy', 'red', 'green', 'beige', 'brown', 'khaki'][k],
              yaw=r.uniform(-0.3, 0.3))
    for k in range(2):
        P.rbox((-1.75 + 0.14 * k, 0.04, 2.95), (0.1, 0.08, 0.27), 'brown', ch=0.03, yaw=0.15 * k)
    P.tube((P.X1 - 0.1, 0, 2.6), (P.X1 - 0.3, 1.3, 2.75), 0.012, 'darkwood')
    P.box((P.X1 - 0.1, 0.06, 2.6), (0.3, 0.12, 0.05), 'tan', yaw=0.3)
    P.scatter(r, 28, (P.X0 + 0.3, P.X1 - 0.3, P.Z0 + 0.4, 0.3), [(door_x, P.Z0 + 0.7, 0.8)])
