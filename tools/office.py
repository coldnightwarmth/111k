"""The party office: an abandoned office off the loop that people have taken
over. Built in the room's local frame (interior x -3.5..3.5, z -3..3,
ceiling 3 m, door in the north wall at x = door_x, opening onto the tunnel).
Called from build_world.py with the shared helpers in `ctx`.
"""
import math
import numpy as np


def build(ctx, door_x):
    W, P = ctx['W'], ctx['P']
    pbox, pcyl = P.box, P.cyl
    Mat, T, glow, wood, card, metal = ctx['Mat'], ctx['T'], ctx['glow'], ctx['wood'], ctx['card'], ctx['metal']
    X0, X1, Z0, Z1, CEIL = ctx['X0'], ctx['X1'], ctx['Z0'], ctx['Z1'], ctx['CEIL']
    decal = ctx['room_wall_decal']
    r = np.random.default_rng(4)

    def party_cup(x, y, z, col='red'):
        """A plastic party cup: open, tapered, white inside, a rolled rim (not a can)."""
        P.lathe((x, y, z), [(0.0, 0.0), (0.03, 0.0), (0.045, 0.115), (0.047, 0.118)], col, sides=12, caps=False)
        P.lathe((x, y + 0.004, z), [(0.0, 0.0), (0.028, 0.0), (0.043, 0.112)], 'white', sides=12, caps=False)

    def bottle(x, y, z, col):
        """A drinks bottle: shoulders, a neck and a cap, so it reads as a bottle."""
        P.lathe((x, y, z), [(0.0, 0.0), (0.04, 0.0), (0.043, 0.012), (0.043, 0.16), (0.035, 0.2), (0.016, 0.235),
                           (0.014, 0.27), (0.0, 0.27)], col, sides=12)
        P.lathe((x, y + 0.27, z), [(0.0, 0.0), (0.016, 0.0), (0.016, 0.018), (0.0, 0.018)], 'white', sides=10)
        P.lathe((x, y + 0.06, z), [(0.0436, 0.0), (0.0436, 0.07)], 'paper', sides=12, caps=False)    # label

    wall = Mat('office_wall', T.cinderblock(), tile=0.8)
    floor = Mat('office_floor', T.vct_floor(), tile=1.2)
    ceil = Mat('office_ceiling', T.ceiling_tile(), tile=1.2)
    fab = Mat('fabric_couch', T.fabric(), tile=0.5)
    blanket = Mat('fabric_blanket', T.fabric((0.22, 0.3, 0.45), seed=52), tile=0.6)
    mattress_m = ctx['M']['fabric_mattress']

    P.shell(wall, door_x, 1.75, holes=(), exit_live=True, floor_mat=floor, ceil_mat=ceil)
    # the working tube sits over the hangout; its flicker group dims its light in the game
    P.troffer(-1.4, 0.0, True, name='fluorescent', lens=ctx['tube'], group=0, flicker='fluorescent', intensity=1.15)
    P.troffer(1.6, 0.0, False)

    # ----------------------------------------------------------- couch
    cx_, cz_, cyaw = -3.05, 0.25, 0.04

    def local(dx, dy, dz):
        c, s = math.cos(cyaw), math.sin(cyaw)
        return (cx_ + dx * c + dz * s, dy, cz_ - dx * s + dz * c)
    W.box(local(0, 0.22, 0), (0.9, 0.28, 2.2), fab, yaw=cyaw, collide=True)
    W.box(local(-0.33, 0.62, 0), (0.24, 0.52, 2.2), fab, yaw=cyaw)
    for dz in (-0.98, 0.98):
        W.box(local(0.02, 0.48, dz), (0.86, 0.32, 0.24), fab, yaw=cyaw)
    for dz in (-0.43, 0.43):
        W.box(local(0.08, 0.42, dz), (0.66, 0.13, 0.84), fab, yaw=cyaw, pitch=0.02 * dz)
    for dz in (-1.0, 1.0):
        for dx in (-0.35, 0.35):
            pbox(local(dx, 0.04, dz), (0.06, 0.08, 0.06), 'darkwood', yaw=cyaw)
    W.box(local(0.12, 0.52, 0.55), (0.5, 0.05, 0.62), blanket, yaw=cyaw + 0.3, roll=0.05)  # throw blanket

    # ------------------------------------------- cable spool table + party stuff
    sx, sz = -1.75, 0.35
    W.cylinder((sx, 0.0, sz), 0.5, 0.06, wood, sides=12)
    W.cylinder((sx, 0.06, sz), 0.2, 0.56, wood, sides=10, caps=False)
    W.cylinder((sx, 0.62, sz), 0.56, 0.06, wood, sides=12, collide=True)
    pcyl((sx + 0.12, 0.68, sz - 0.1), 0.07, 0.03, 'charcoal', sides=8)
    pcyl((sx + 0.12, 0.71, sz - 0.1), 0.055, 0.14, 'warm', mat=glow, sides=8)
    pcyl((sx + 0.12, 0.85, sz - 0.1), 0.07, 0.03, 'charcoal', sides=8)
    W.light((sx + 0.12, 0.8, sz - 0.1), (1.0, 0.68, 0.36), 0.55, 4.8, radius=0.05, name='lantern', flicker='candle',
            runtime_intensity=1.0)
    for (dx, dz, col) in [(-0.2, 0.15, 'red'), (-0.05, 0.28, 'blue'), (0.25, 0.18, 'red'), (-0.28, -0.12, 'red'),
                          (0.3, -0.15, 'blue')]:
        party_cup(sx + dx, 0.68, sz + dz, col)
    pbox((sx - 0.1, 0.69, sz - 0.3), (0.09, 0.01, 0.06), 'black', yaw=0.4)  # someone's phone

    def crate(c, color, yaw=0.0):
        x, y, z = c
        co, si = math.cos(yaw), math.sin(yaw)
        for dx, dz, sx_, sz_ in [(0, 0.16, 0.34, 0.02), (0, -0.16, 0.34, 0.02), (0.16, 0, 0.02, 0.34), (-0.16, 0, 0.02, 0.34)]:
            pbox((x + dx * co + dz * si, y + 0.15, z - dx * si + dz * co), (sx_, 0.3, sz_), color, yaw=yaw)
        pbox((x, y + 0.01, z), (0.34, 0.02, 0.34), color, yaw=yaw)
        W.collider_box((x, 0, z), 0.17, 0.17, yaw, y, y + 0.3)
    crate((-1.0, 0, 0.95), 'red', 0.3)
    crate((-1.05, 0, -0.35), 'blue', -0.2)
    crate((-1.75, 0, 1.25), 'blue', 0.1)
    crate((-1.75, 0.3, 1.25), 'red', 0.5)

    # boombox, speaker light, cooler, pizza boxes
    bx, bz = -2.35, -0.9
    pbox((bx, 0.17, bz), (0.6, 0.3, 0.2), 'charcoal', yaw=0.5)
    for dxs in (-0.17, 0.17):
        c, s = math.cos(0.5), math.sin(0.5)
        pcyl((bx + dxs * c + 0.1 * s, 0.17, bz - dxs * s + 0.1 * c), 0.09, 0.012, 'black', axis='z', yaw=0.5)
    pbox((bx, 0.36, bz), (0.42, 0.03, 0.04), 'steel', yaw=0.5)
    W.collider_circle((bx, 0, bz), 0.32, 0, 0.35)
    pbox((-2.55, 0.2, 1.75), (0.6, 0.38, 0.38), 'blue', yaw=-0.25, collide=True)
    pbox((-2.55, 0.41, 1.75), (0.62, 0.05, 0.4), 'white', yaw=-0.25)
    for k in range(3):
        W.box((-0.55 + 0.03 * k, 0.025 + 0.045 * k, -1.3 + 0.02 * k), (0.42, 0.045, 0.42), card, yaw=0.2 + 0.25 * k,
              world_uv=False)
    W.box((-0.2, 0.025, -1.0), (0.42, 0.045, 0.42), card, yaw=-0.5, world_uv=False)

    # folding table against the north wall with cups and bags of chips
    tx, tz = -1.0, Z0 + 0.45
    pbox((tx, 0.72, tz), (1.3, 0.03, 0.62), 'offwhite')
    for dx in (-0.58, 0.58):
        pbox((tx + dx, 0.36, tz), (0.03, 0.72, 0.5), 'steel')
    W.collider_box((tx, 0, tz), 0.66, 0.32, 0, 0, 0.75)
    for k in range(9):
        x, z = tx + r.uniform(-0.55, 0.55), tz + r.uniform(-0.22, 0.22)
        party_cup(x, 0.735, z)
    for k, (dx, col) in enumerate([(-0.35, 'yellow'), (0.3, 'blue')]):
        pbox((tx + dx, 0.8, tz + 0.05), (0.2, 0.12, 0.08), col, yaw=0.3 * k, roll=0.2)
    bottle(tx + 0.05, 0.735, tz - 0.05, 'bottlegreen')  # soda bottle

    # mattress on the floor by the south wall, with a blanket
    mx, mz = 0.55, 2.45
    W.box((mx, 0.09, mz), (1.9, 0.18, 0.95), mattress_m, yaw=-0.04, collide=False)
    W.box((mx + 0.3, 0.2, mz - 0.05), (1.1, 0.05, 1.0), blanket, yaw=0.1, roll=-0.03)
    W.box((mx - 0.75, 0.24, mz), (0.35, 0.12, 0.55), mattress_m, yaw=-0.1)  # pillow

    # floor litter
    for i in range(14):
        x, z = r.uniform(-2.8, 1.8), r.uniform(-2.5, 1.8)
        if math.hypot(x - sx, z - sz) < 0.65 or abs(x - tx) < 0.75 and z < tz + 0.4:
            continue
        P.debris(r, x, z, ['can', 'flyer', 'cup', 'chips', 'butts', 'caps'][i % 6])

    # extension cord from the door to a power strip by the boombox
    path = [(door_x - 0.3, Z0 + 0.05), (door_x - 0.6, Z0 + 0.7), (-0.6, -1.7), (-1.9, -1.2), (-2.1, -1.05)]
    for (ax, az), (bx_, bz_) in zip(path[:-1], path[1:]):
        dx, dz = bx_ - ax, bz_ - az
        pbox(((ax + bx_) / 2, 0.006, (az + bz_) / 2), (math.hypot(dx, dz), 0.012, 0.022), 'orange', yaw=math.atan2(-dz, dx))
    pbox((-2.15, 0.02, -1.15), (0.3, 0.04, 0.07), 'black', yaw=0.5)

    # ------------------------------------------------- desk, chair, CRT
    dx0, dz0 = 3.1, 0.95
    W.box((dx0, 0.75, dz0), (0.75, 0.04, 1.6), metal)
    W.box((dx0, 0.37, dz0 + 0.55), (0.72, 0.72, 0.42), metal)
    W.box((dx0 + 0.33, 0.4, dz0 - 0.2), (0.03, 0.6, 1.1), metal)
    W.box((dx0, 0.37, dz0 - 0.77), (0.72, 0.72, 0.03), metal)
    W.collider_box((dx0, 0, dz0), 0.38, 0.8, 0, 0, 0.77)
    for y in (0.58, 0.36, 0.14):
        pbox((dx0 - 0.365, y, dz0 + 0.55), (0.01, 0.2, 0.38), 'lightgrey')
        pbox((dx0 - 0.38, y + 0.04, dz0 + 0.55), (0.02, 0.02, 0.12), 'steel')
    pbox((dx0 + 0.05, 0.98, dz0 - 0.2), (0.42, 0.4, 0.42), 'beige', yaw=-0.2)
    pbox((dx0 + 0.18, 0.96, dz0 - 0.22), (0.3, 0.3, 0.3), 'beige', yaw=-0.2)
    c, s = math.cos(-0.2), math.sin(-0.2)
    pbox((dx0 + 0.05 - 0.212 * c, 0.97, dz0 - 0.2 + 0.212 * s), (0.01, 0.27, 0.32), 'glass', yaw=-0.2)
    pbox((dx0 - 0.15, 0.785, dz0 + 0.2), (0.18, 0.03, 0.45), 'charcoal', yaw=0.1)
    P.office_chair(2.15, 1.15, 0.9 + math.pi / 2)

    # filing cabinet with an open drawer, and a purple clamp light on top of it
    fx0, fz0 = 3.2, -2.6
    W.box((fx0, 0.66, fz0), (0.52, 1.32, 0.7), metal, collide=True)
    for i, y in enumerate((1.12, 0.8, 0.48, 0.16)):
        out = 0.32 if i == 1 else 0.0
        pbox((fx0 - 0.265 - out / 2, y, fz0), (0.012 + out, 0.28, 0.62), 'lightgrey')
        pbox((fx0 - 0.28 - out, y + 0.06, fz0), (0.02, 0.03, 0.14), 'steel')
    pbox((fx0 - 0.25, 0.86, fz0 - 0.1), (0.24, 0.02, 0.3), 'paper', yaw=0.1)
    pcyl((fx0 - 0.05, 1.32, fz0 + 0.1), 0.02, 0.12, 'steel', sides=6)
    pcyl((fx0 - 0.08, 1.4, fz0 + 0.1), 0.11, 0.16, 'steel', sides=10, pitch=0.6, yaw=2.2)
    pcyl((fx0 - 0.14, 1.47, fz0 + 0.16), 0.06, 0.06, 'purple', mat=glow, sides=8)
    W.light((fx0 - 0.25, 1.58, fz0 + 0.3), (0.75, 0.25, 1.0), 0.5, 5.5, radius=0.05, name='purple')

    # cardboard boxes in the corners, a fallen ceiling tile, clock, conduit, grille
    for (c_, s_, yaw) in [((2.95, 0.25, 2.55), (0.6, 0.5, 0.5), 0.1), ((3.05, 0.7, 2.6), (0.5, 0.4, 0.45), -0.2),
                          ((2.35, 0.2, 2.65), (0.45, 0.4, 0.4), 0.4), ((-3.05, 0.2, -2.55), (0.5, 0.4, 0.5), 0.2)]:
        W.box(c_, s_, card, yaw=yaw, collide=True, world_uv=False)
    W.box((-1.45, 0.32, 2.88), (0.6, 0.62, 0.02), ctx['ceiling'], pitch=-0.25, world_uv=False)
    pcyl((-0.9, 2.3, Z1), 0.16, 0.04, 'offwhite', axis='z', yaw=math.pi, sides=12)
    pbox((-0.9, 2.33, Z1 - 0.045), (0.012, 0.11, 0.004), 'black', roll=0.6)
    pbox((-0.9, 2.3, Z1 - 0.046), (0.01, 0.08, 0.004), 'black', roll=2.3)
    pcyl((X1 - 0.05, 2.85, Z0), 0.025, Z1 - Z0, 'steel', axis='z', sides=6)
    pbox((X0 + 0.01, 2.6, -1.8), (0.02, 0.3, 0.5), 'lightgrey')
    for k in range(5):
        pbox((X0 + 0.022, 2.48 + k * 0.06, -1.8), (0.008, 0.012, 0.46), 'charcoal')

    # ------------------------------------------------------ string lights
    def strand(a, b, sag, n_bulbs, colors, name):
        a, b = np.asarray(a, float), np.asarray(b, float)
        pts = [a + (b - a) * t - np.array([0, sag * 4 * t * (1 - t), 0]) for t in np.linspace(0, 1, 41)]
        for p, q in zip(pts[:-1], pts[1:]):
            d = q - p
            pbox((p + q) / 2, (np.linalg.norm(d) + 0.005, 0.008, 0.008), 'black', yaw=math.atan2(-d[2], d[0]),
                 roll=math.atan2(d[1], math.hypot(d[0], d[2])))
        bulbs = []
        for i in range(n_bulbs):
            t = (i + 0.5) / n_bulbs
            p = a + (b - a) * t - np.array([0, sag * 4 * t * (1 - t) + 0.04, 0])
            pbox(p, (0.035, 0.05, 0.035), colors[i % len(colors)], mat=glow)
            bulbs.append(p)
        c = np.mean(bulbs[::3], 0)
        W.light(c, (1.0, 0.6, 0.3), 0.34, 5.0, name=name, bake=False)
        for p in bulbs[::2]:
            W.light(p, (1.0, 0.6, 0.32), 0.035, 1, radius=0.02, runtime=False)
    warm = ['warm', 'warm', 'orange', 'warm', 'yellow']
    strand((X0 + 0.05, 2.78, -2.6), (0.6, 2.82, Z1 - 0.05), 0.45, 18, warm, 'string_a')
    strand((X0 + 0.05, 2.74, 2.4), (X1 - 0.05, 2.8, -0.4), 0.55, 20, warm, 'string_b')

    # ------------------------------------------------------------ graffiti
    # south wall (behind the mattress), west (over the couch), north (door wall), east (desk)
    decal('tu_111k', 'S', -1.3, 1.45, eps=0.012)
    decal('dd_smiley', 'S', 1.9, 1.95, 0.85)
    decal('mk_who', 'S', 2.6, 1.25)
    decal('tag_zeal', 'S', 0.4, 2.25, 0.9)
    decal('tu_loop', 'W', 0.25, 1.75)
    decal('mk_lisa', 'W', -1.9, 1.2)
    decal('tag_remo', 'W', -2.35, 2.25, 0.8)
    decal('dd_heart', 'W', 2.3, 1.15, 0.8)
    decal('tag_nova', 'N', -1.9, 1.95)
    decal('mk_bring', 'N', -2.6, 1.15)
    decal('dd_arrow_w', 'N', 0.3, 1.6, 0.8)
    decal('mk_ok', 'N', -0.2, 2.4)
    decal('buff_beige', 'E', 0.15, 1.45)
    decal('tag_111k_big', 'E', -1.6, 1.85)
    decal('tag_sekt', 'E', 0.2, 1.5, 0.9, eps=0.016)
    decal('mk_names', 'E', 1.7, 1.55)
    decal('mk_93', 'E', -0.3, 2.45)
    decal('dd_tally', 'E', 2.4, 1.2, 0.8)

    # flashlights: one on the spool table, one on the desk (world space, picked up in the game)
    for (x, y, z, yaw) in [(sx - 0.22, 0.68, sz + 0.05, 0.6), (dx0 - 0.12, 0.77, dz0 + 0.5, -1.2)]:
        p = W.T((x, y, z))
        ctx['ITEMS'].append({'type': 'flashlight', 'x': round(float(p[0]), 3), 'y': round(float(p[1]), 3),
                             'z': round(float(p[2]), 3), 'yaw': round(float(yaw + W.yaw), 3)})

    # the paintball gun, on the floor in the middle of the room
    p = W.T((-0.35, 0.03, 0.45))
    ctx['ITEMS'].append({'type': 'paintball', 'x': round(float(p[0]), 3), 'y': 0.03, 'z': round(float(p[2]), 3),
                         'yaw': round(float(0.9 + W.yaw), 3)})

    # a painting hung on the desk wall, over the buffed-out patch (it can be taken down and moved)
    p = W.T((3.5 - 0.003, 1.55, 0.675))
    ctx['ITEMS'].append({'type': 'painting', 'x': round(float(p[0]), 3), 'y': 1.55, 'z': round(float(p[2]), 3),
                         'yaw': 0.0, 'tilt': 0.0, 'art': 1})

    # the golden crown, on top of the stacked boxes in the corner (king of the hill)
    p = W.T((3.05, 0.9, 2.6))
    ctx['ITEMS'].append({'type': 'crown', 'x': round(float(p[0]), 3), 'y': 0.9, 'z': round(float(p[2]), 3),
                         'yaw': round(float(-0.97 + W.yaw), 3)})

    # spawn points (world space), facing the door
    for x, z in [(0.0, 1.5), (0.6, 1.3), (-0.4, 1.8), (0.9, 1.9), (0.2, 0.9)]:
        p = W.T((x, 0, z))
        W.spawns.append({'x': round(float(p[0]), 3), 'z': round(float(p[2]), 3), 'yaw': round(float(W.yaw), 4)})
