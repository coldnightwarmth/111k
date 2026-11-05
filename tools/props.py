"""Reusable props for the 111k world: furniture, chairs, debris, room shells.

Everything is built in the current frame of the World (so a prop can be
placed inside a room frame, or inside a tilted frame to knock it over).
Small coloured parts use the shared palette texture: `box(..., 'red')`.
"""
import math
import numpy as np
from scipy.spatial import ConvexHull

from kit import orient, rot


class Props:
    def __init__(self, W, mats, pal, room):
        self.W, self.M, self.PAL = W, mats, pal
        self.X0, self.X1, self.Z0, self.Z1, self.CEIL, self.T_W, self.DOOR_W, self.DOOR_H = room

    # ----------------------------------------------------------- primitives
    def sw(self, name):
        return self.PAL[name]

    def box(self, center, size, color, mat=None, **kw):
        self.W.box(center, size, mat or self.M['props'], world_uv=False, uv_const=self.sw(color), **kw)

    def cyl(self, base, r, h, color, mat=None, **kw):
        self.W.cylinder(base, r, h, mat or self.M['props'], uv_const=self.sw(color), **kw)

    def tube(self, p0, p1, r, color, sides=6, mat=None, caps=True):
        """Cylinder from p0 to p1 (for frames, legs, pipes at any angle)."""
        p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
        d = p1 - p0
        L = np.linalg.norm(d)
        if L < 1e-6:
            return
        d /= L
        pitch = math.acos(np.clip(d[1], -1, 1))
        yaw = math.atan2(d[0], d[2]) if abs(d[1]) < 0.9999 else 0.0
        self.W.cylinder(p0, r, L, mat or self.M['props'], sides=sides, caps=caps, yaw=yaw, pitch=pitch,
                        uv_const=None if mat is not None else self.sw(color))

    def hull(self, points, color=None, mat=None, center=(0, 0, 0)):
        """Convex hull of points as flat faces: pillows, rocks, bags, rounded boxes."""
        pts = np.asarray(points, float) + np.asarray(center, float)
        h = ConvexHull(pts)
        c = pts.mean(0)
        for simplex in h.simplices:
            tri = orient(pts[simplex], c)[::-1]   # away from the centre
            if color is not None:
                self.W.face(tri, mat or self.M['props'], uv=np.tile(self.sw(color), (3, 1)))
            else:
                self.W.face(tri, mat)

    def rbox(self, center, size, color=None, ch=0.02, mat=None, yaw=0.0, pitch=0.0, roll=0.0):
        """Box with chamfered edges."""
        h = np.asarray(size, float) / 2
        ch = min(ch, *(h * 0.45))
        R = rot(yaw, pitch, roll)
        pts = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    s = np.array([sx, sy, sz])
                    pts += [s * (h - [0, ch, ch]), s * (h - [ch, 0, ch]), s * (h - [ch, ch, 0])]
        pts = np.array(pts) @ R.T
        self.hull(pts, color, mat, center)

    def blob(self, center, radii, color, r, n=14, mat=None, flatten_bottom=True):
        """Lumpy ellipsoid (garbage bags, rocks, crumpled paper, clothes)."""
        u = r.normal(size=(n, 3)); u /= np.linalg.norm(u, axis=1, keepdims=True)
        p = u * np.asarray(radii) * r.uniform(0.82, 1.12, (n, 1))
        if flatten_bottom:
            p[:, 1] = np.maximum(p[:, 1], -radii[1] * 0.6)
        self.hull(p, color, mat, np.asarray(center) + [0, radii[1] * (0.6 if flatten_bottom else 0), 0])

    # ---------------------------------------------------------------- chairs
    def office_chair(self, x, z, yaw, tipped=False, color='charcoal', collide=True):
        W, fabric = self.W, self.M['fabric_chair']
        origin = (x, 0.31, z) if tipped else (x, 0, z)
        with W.frame(origin, yaw, 0.0, math.pi / 2 if tipped else 0.0):
            for k in range(5):
                a = k * 2 * math.pi / 5 + 0.3
                end = (math.cos(a) * 0.29, 0.065, math.sin(a) * 0.29)
                self.tube((0, 0.1, 0), end, 0.02, 'charcoal', sides=5)
                self.cyl((end[0], 0.0, end[2]), 0.03, 0.045, 'black', axis='z', sides=6, yaw=a)
            self.cyl((0, 0.07, 0), 0.045, 0.07, 'black', sides=8)
            self.cyl((0, 0.13, 0), 0.045, 0.2, 'black', sides=8, top=0.03)
            self.cyl((0, 0.33, 0), 0.022, 0.1, 'steel', sides=6)
            self.box((0, 0.42, 0.02), (0.3, 0.03, 0.3), 'black')
            self.rbox((0, 0.47, 0), (0.5, 0.08, 0.48), ch=0.03, mat=fabric)
            self.tube((0, 0.43, 0.2), (0, 0.62, 0.27), 0.022, 'black', sides=5)
            self.rbox((0, 0.85, 0.27), (0.46, 0.5, 0.07), ch=0.03, mat=fabric, pitch=-0.14)
            for sx in (-1, 1):
                self.tube((sx * 0.24, 0.44, 0.06), (sx * 0.27, 0.65, 0.04), 0.016, 'black', sides=5)
                self.rbox((sx * 0.27, 0.665, -0.02), (0.06, 0.03, 0.25), 'black', ch=0.01)
        if collide:
            W.collider_circle((x, 0, z), 0.32, 0, 1.0)

    def camp_chair(self, x, z, yaw, cloth='navy'):
        W = self.W
        with W.frame((x, 0, z), yaw):
            leg = 'steel'
            for sx in (-0.26, 0.26):   # crossed legs on each side
                self.tube((sx, 0, -0.22), (sx, 0.45, 0.2), 0.012, leg)
                self.tube((sx, 0, 0.2), (sx, 0.45, -0.22), 0.012, leg)
            self.tube((-0.26, 0, -0.22), (0.26, 0.45, -0.22), 0.011, leg)
            self.tube((0.26, 0, -0.22), (-0.26, 0.45, -0.22), 0.011, leg)
            for sx in (-0.26, 0.26):
                self.tube((sx, 0.45, 0.2), (sx * 1.05, 0.98, 0.3), 0.012, leg)
                self.tube((sx, 0.62, -0.2), (sx, 0.62, 0.24), 0.014, 'black')
            # sagging sling seat and back (double-sided cloth)
            m = self.M['cloth_' + cloth]
            seat = [(-0.26, 0.45, -0.22), (0.26, 0.45, -0.22), (0.26, 0.45, 0.2), (-0.26, 0.45, 0.2)]
            mid = [(-0.26, 0.38, -0.01), (0.26, 0.38, -0.01)]
            W.face([seat[0], seat[1], mid[1], mid[0]][::-1], m)
            W.face([mid[0], mid[1], seat[2], seat[3]][::-1], m)
            W.face([(-0.26, 0.47, 0.2), (0.26, 0.47, 0.2), (0.273, 0.96, 0.3), (-0.273, 0.96, 0.3)], m)
            self.cyl((0.27, 0.58, -0.12), 0.04, 0.06, 'black', sides=7, caps=False)  # cup holder
        W.collider_circle((x, 0, z), 0.33, 0, 1.0)

    def folding_chair(self, x, z, yaw, color='slate', folded=False):
        W = self.W
        with W.frame((x, 0, z), yaw, -1.3 if folded else 0.0, 0.0):
            for sx in (-0.2, 0.2):
                self.tube((sx, 0, -0.2), (sx, 0.9, 0.18), 0.012, color)
                self.tube((sx, 0, 0.2), (sx, 0.45, -0.16), 0.012, color)
            self.rbox((0, 0.46, -0.02), (0.42, 0.03, 0.4), color, ch=0.01)
            self.rbox((0, 0.78, 0.14), (0.4, 0.18, 0.025), color, ch=0.008, pitch=-0.15)
        if not folded:
            W.collider_circle((x, 0, z), 0.27, 0, 0.9)

    # ------------------------------------------------------------- furniture
    def desk(self, x, z, yaw, r, clutter=True):
        W, metal = self.W, self.M['metal_grey']
        with W.frame((x, 0, z), yaw):
            W.box((0, 0.75, 0), (1.5, 0.04, 0.75), metal)
            for dx in (-0.55, 0.55):
                W.box((dx, 0.37, 0), (0.42, 0.72, 0.72), metal)
                for y in (0.6, 0.38, 0.16):
                    self.box((dx, y, -0.362), (0.38, 0.18, 0.006), 'lightgrey')
                    self.box((dx, y + 0.04, -0.37), (0.12, 0.02, 0.012), 'steel')
            if clutter:
                if r.random() < 0.6:
                    self.crt((r.uniform(-0.4, 0.4), 0.77, 0.05), r.uniform(-0.3, 0.3) + math.pi, on=False)
                for _ in range(r.integers(1, 4)):
                    self.box((r.uniform(-0.6, 0.6), 0.775, r.uniform(-0.25, 0.25)), (0.22, 0.01, 0.3), 'paper',
                             yaw=r.uniform(0, 6.28))
        W.collider_box((x, 0, z), 0.76, 0.38, yaw, 0, 0.77)

    def crt(self, base, yaw, on=False, screen_mat=None, color='beige'):
        """Boxy CRT monitor sitting at `base` (bottom centre), facing local -z."""
        with self.W.frame(base, yaw):
            self.rbox((0, 0.2, 0.02), (0.4, 0.36, 0.36), color, ch=0.03)
            self.rbox((0, 0.18, 0.2), (0.3, 0.27, 0.12), color, ch=0.03)
            self.box((0, 0.015, 0.05), (0.26, 0.03, 0.22), color)
            q = [(-0.15, 0.08, -0.161), (0.15, 0.08, -0.161), (0.15, 0.32, -0.161), (-0.15, 0.32, -0.161)]
            q = orient(q, (0, 0.2, -1))
            if screen_mat is not None:
                # seen from the front (-z), +x is the viewer's left
                self.W.face(q, screen_mat, uv=[((0.15 - p[0]) / 0.3, (0.32 - p[1]) / 0.24) for p in q])
            else:
                self.W.face(q, self.M['props'], uv=np.tile(self.sw('glass'), (4, 1)))

    def cabinet(self, x, z, yaw, drawer_out=False):
        W = self.W
        W.box((x, 0.66, z), (0.7, 1.32, 0.52), self.M['metal_grey'], yaw=yaw, collide=True)
        R = rot(yaw)
        for i, y in enumerate((1.12, 0.8, 0.48, 0.16)):
            out = 0.3 if drawer_out and i == 1 else 0.0
            p = np.array([x, y, z]) + R @ np.array([0, 0, 0.265 + out / 2])
            self.box(p, (0.62, 0.28, 0.012 + out), 'lightgrey', yaw=yaw)

    def shelving(self, x, z, yaw, r):
        W = self.W
        R = rot(yaw)
        for dx in (-0.6, 0.6):
            for dz in (-0.22, 0.22):
                self.box(np.array([x, 1.0, z]) + R @ np.array([dx, 0, dz]), (0.04, 2.0, 0.04), 'steel', yaw=yaw)
        for y in (0.1, 0.7, 1.3, 1.9):
            W.box((x, y, z), (1.24, 0.03, 0.48), self.M['metal_galv'], yaw=yaw)
            for k in range(r.integers(0, 4)):
                p = np.array([x, y + 0.17, z]) + R @ np.array([r.uniform(-0.4, 0.4), 0, 0])
                W.box(p, (r.uniform(0.25, 0.4), 0.3, 0.35), self.M['cardboard'], yaw=yaw + r.uniform(-0.15, 0.15),
                      world_uv=False)
        W.collider_box((x, 0, z), 0.64, 0.26, yaw, 0, 2)

    def bottle(self, x, z, color, lying=False, yaw=0.0, y=0.0):
        if lying:
            self.cyl((x, y + 0.035, z), 0.035, 0.18, color, axis='x', yaw=yaw, sides=7)
            return
        self.cyl((x, y, z), 0.035, 0.17, color, sides=7)
        self.cyl((x, y + 0.17, z), 0.035, 0.06, color, sides=7, top=0.013)
        self.cyl((x, y + 0.23, z), 0.013, 0.04, color, sides=5)

    # ----------------------------------------------------------------- debris
    def debris(self, r, x, z, kind=None, y=0.0):
        """One small piece of junk on the floor at (x, z). Lit by the floor it lies on (part 'tiny')."""
        with self.W.using('tiny'):
            self._debris(r, x, z, kind, y)

    def _debris(self, r, x, z, kind=None, y=0.0):
        kinds = ['paper', 'paper', 'crumple', 'can', 'can', 'bottle', 'chunk', 'chunk', 'bag', 'scrap', 'cup',
                 'wire', 'wrapper', 'butts']
        kind = kind or kinds[r.integers(len(kinds))]
        yaw = r.uniform(0, 6.28)
        if kind == 'paper':
            self.box((x, y + 0.004, z), (r.uniform(0.18, 0.3), 0.006, r.uniform(0.2, 0.3)), 'paper', yaw=yaw,
                     roll=r.uniform(-0.05, 0.05))
        elif kind == 'crumple':
            self.blob((x, y, z), (0.04, 0.035, 0.045), 'paper', r, n=9)
        elif kind == 'can':
            col = ['canred', 'cangreen', 'steel', 'blue', 'yellow'][r.integers(5)]
            if r.random() < 0.7:
                self.cyl((x, y + 0.033, z), 0.033, 0.12, col, axis='x', yaw=yaw, sides=7)
            else:
                self.cyl((x, y, z), 0.033, r.uniform(0.04, 0.12), col, sides=7)  # crushed
        elif kind == 'bottle':
            self.bottle(x, z, ['bottlebrown', 'bottlegreen', 'glass'][r.integers(3)], lying=True, yaw=yaw, y=y)
        elif kind == 'chunk':
            s = r.uniform(0.04, 0.14)
            self.blob((x, y, z), (s, s * 0.6, s * 0.8), 'concrete', r, n=8)
        elif kind == 'bag':
            self.blob((x, y, z), (0.16, 0.03, 0.12), ['white', 'black', 'blue'][r.integers(3)], r, n=10)
        elif kind == 'scrap':
            self.W.box((x, y + 0.006, z), (r.uniform(0.2, 0.45), 0.012, r.uniform(0.15, 0.35)), self.M['cardboard'],
                       yaw=yaw, world_uv=False)
        elif kind == 'cup':
            self.cyl((x, y + 0.04, z), 0.04, 0.11, ['white', 'red'][r.integers(2)], axis='x', yaw=yaw, sides=6, top=0.03)
        elif kind == 'wire':
            pts = [np.array([x, y + 0.008, z])]
            a = yaw
            for _ in range(5):
                a += r.uniform(-0.8, 0.8)
                pts.append(pts[-1] + np.array([math.cos(a) * 0.12, 0, math.sin(a) * 0.12]))
            for p, q in zip(pts[:-1], pts[1:]):
                self.tube(p, q, 0.005, ['black', 'red', 'orange'][r.integers(3)], sides=4, caps=False)
        elif kind == 'wrapper':
            self.box((x, y + 0.004, z), (0.12, 0.008, 0.07), ['yellow', 'red', 'blue', 'orange'][r.integers(4)], yaw=yaw)
        elif kind == 'butts':
            for _ in range(r.integers(2, 6)):
                self.cyl((x + r.uniform(-0.1, 0.1), y + 0.005, z + r.uniform(-0.1, 0.1)), 0.006, 0.03, 'offwhite',
                         axis='x', yaw=r.uniform(0, 6.28), sides=4, caps=False)

    def scatter(self, r, n, area, avoid=(), y=0.0):
        """Scatter n debris items inside area=(x0, x1, z0, z1), away from `avoid` points (x, z, radius)."""
        x0, x1, z0, z1 = area
        placed = 0
        for _ in range(n * 3):
            if placed >= n:
                break
            x, z = r.uniform(x0, x1), r.uniform(z0, z1)
            if any(math.hypot(x - ax, z - az) < ar for ax, az, ar in avoid):
                continue
            self.debris(r, x, z, y=y)
            placed += 1

    # ----------------------------------------------------------- room shell
    def ceiling(self, holes=(), mat=None, plenum=True):
        """Drop ceiling of 0.6 m tiles; `holes` is a set of (col, row) missing tiles."""
        W, X0, X1, Z0, Z1, CEIL = self.W, self.X0, self.X1, self.Z0, self.Z1, self.CEIL
        mat = mat or self.M['ceiling_tile']
        holes = set(holes)
        cols, rows = int((X1 - X0) / 0.6) + 1, int((Z1 - Z0) / 0.6) + 1
        for rr in range(rows):
            z0, z1 = Z0 + rr * 0.6, min(Z1, Z0 + (rr + 1) * 0.6)
            if z0 >= Z1:
                break
            c = 0
            while c < cols:
                if (c, rr) in holes:
                    c += 1; continue
                c1 = c
                while c1 < cols and (c1, rr) not in holes:
                    c1 += 1
                x0, x1 = X0 + c * 0.6, min(X1, X0 + c1 * 0.6)
                W.face([(x1, CEIL, z0), (x1, CEIL, z1), (x0, CEIL, z1), (x0, CEIL, z0)], mat,
                       uv=[(x1 / 1.2, -z0 / 1.2), (x1 / 1.2, -z1 / 1.2), (x0 / 1.2, -z1 / 1.2), (x0 / 1.2, -z0 / 1.2)])
                c = c1
        if plenum:
            for (c, rr) in holes:
                x0, z0 = X0 + c * 0.6, Z0 + rr * 0.6
                x1, z1 = min(X1, x0 + 0.6), min(Z1, z0 + 0.6)
                self.box(((x0 + x1) / 2, CEIL + 0.45, (z0 + z1) / 2), (x1 - x0, 0.9, z1 - z0), 'black', faces='-y+x-x+z-z')

    def door(self, door_x, opened, leaf_mat):
        """Steel frame in the wall opening and a leaf hinged on its left jamb, swinging into the room."""
        W, Z0, T_W, DOOR_W, DOOR_H = self.W, self.Z0, self.T_W, self.DOOR_W, self.DOOR_H
        metal = self.M['metal_grey']
        dl, dr = door_x - DOOR_W / 2, door_x + DOOR_W / 2
        fz = Z0 - T_W / 2
        for (c, s) in [((dl - 0.04, DOOR_H / 2, fz), (0.08, DOOR_H, T_W + 0.04)), ((dr + 0.04, DOOR_H / 2, fz), (0.08, DOOR_H, T_W + 0.04)),
                       ((door_x, DOOR_H + 0.04, fz), (DOOR_W + 0.16, 0.08, T_W + 0.04))]:
            W.box(c, s, metal)
        mid = (door_x, DOOR_H / 2, Z0 - T_W / 2)
        W.face(orient([(dl, 0, Z0 - T_W), (dl, 0, Z0), (dl, DOOR_H, Z0), (dl, DOOR_H, Z0 - T_W)], mid), metal)
        W.face(orient([(dr, 0, Z0), (dr, 0, Z0 - T_W), (dr, DOOR_H, Z0 - T_W), (dr, DOOR_H, Z0)], mid), metal)
        W.face(orient([(dl, DOOR_H, Z0 - T_W), (dl, DOOR_H, Z0), (dr, DOOR_H, Z0), (dr, DOOR_H, Z0 - T_W)], mid), metal)
        hinge = np.array([dl + 0.02, 0, Z0 + 0.03])
        lw = DOOR_W - 0.04
        yaw = -opened
        R = rot(yaw)
        centre = hinge + R @ np.array([lw / 2, DOOR_H / 2 - 0.01, 0.025])
        W.box(centre, (lw, DOOR_H - 0.02, 0.05), leaf_mat, yaw=yaw, collide=True)
        for off, size, col in [((0, 0.25, 0.028), (0.36, 0.6, 0.004), 'glass'), ((0, -1.08, 0.028), (lw - 0.1, 0.28, 0.006), 'steel'),
                               ((-0.42, -0.2, 0.06), (0.2, 0.035, 0.035), 'steel')]:
            p = hinge + R @ (np.array([lw / 2, DOOR_H / 2, 0]) + np.array(off))
            self.box(p, size, col, yaw=yaw)

    def shell(self, wall, door_x, opened, holes=(), exit_live=False, door_mat=None, floor_mat=None, ceil_mat=None,
              baseboard='rubber'):
        """Walls, floor, ceiling, door, exit sign. opened: radians the door has swung (0 = shut)."""
        W, X0, X1, Z0, Z1, CEIL, T_W = self.W, self.X0, self.X1, self.Z0, self.Z1, self.CEIL, self.T_W
        dl, dr = door_x - self.DOOR_W / 2, door_x + self.DOOR_W / 2
        W.box((0, -0.1, 0), (X1 - X0, 0.2, Z1 - Z0), floor_mat or self.M['floor_vct'], faces='+y')
        W.box((0, CEIL / 2, Z1 + T_W / 2), (X1 - X0 + 2 * T_W, CEIL, T_W), wall, faces='-z', collide=True)
        W.box((X0 - T_W / 2, CEIL / 2, 0), (T_W, CEIL, Z1 - Z0), wall, faces='+x', collide=True)
        W.box((X1 + T_W / 2, CEIL / 2, 0), (T_W, CEIL, Z1 - Z0), wall, faces='-x', collide=True)
        W.box(((X0 - T_W + dl) / 2, CEIL / 2, Z0 - T_W / 2), (dl - X0 + T_W, CEIL, T_W), wall, faces='+z', collide=True)
        W.box(((dr + X1 + T_W) / 2, CEIL / 2, Z0 - T_W / 2), (X1 + T_W - dr, CEIL, T_W), wall, faces='+z', collide=True)
        W.box((door_x, (self.DOOR_H + CEIL) / 2, Z0 - T_W / 2), (self.DOOR_W, CEIL - self.DOOR_H, T_W), wall, faces='+z-y')
        if baseboard:
            for (c, s) in [((0, 0.05, Z1 - 0.006), (X1 - X0, 0.1, 0.012)), ((X0 + 0.006, 0.05, 0), (0.012, 0.1, Z1 - Z0)),
                           ((X1 - 0.006, 0.05, 0), (0.012, 0.1, Z1 - Z0)),
                           (((X0 + dl) / 2, 0.05, Z0 + 0.006), (dl - X0, 0.1, 0.012)), (((dr + X1) / 2, 0.05, Z0 + 0.006), (X1 - dr, 0.1, 0.012))]:
                self.box(c, s, baseboard)
        self.ceiling(holes, mat=ceil_mat)
        self.door(door_x, opened, door_mat or self.M['metal_teal'])
        self.box((door_x, self.DOOR_H + 0.28, Z0 + 0.06), (0.36, 0.2, 0.1), 'charcoal')
        W.face([(door_x - 0.15, self.DOOR_H + 0.2, Z0 + 0.111), (door_x + 0.15, self.DOOR_H + 0.2, Z0 + 0.111),
                (door_x + 0.15, self.DOOR_H + 0.36, Z0 + 0.111), (door_x - 0.15, self.DOOR_H + 0.36, Z0 + 0.111)],
               self.M['exit_sign'] if exit_live else self.M['exit_dead'], uv=[(0, 1), (1, 1), (1, 0), (0, 0)])

    def troffer(self, x, z, on, name=None, lens=None, group=None, flicker=None, intensity=1.1):
        """2 x 4 ft fluorescent fixture filling two ceiling tiles (x, z on the 0.6 m grid centre)."""
        W, CEIL = self.W, self.CEIL
        self.box((x, CEIL - 0.012, z), (0.62, 0.024, 1.22), 'lightgrey')
        if on:
            W.face([(x - 0.27, CEIL - 0.026, z - 0.57), (x + 0.27, CEIL - 0.026, z - 0.57),
                    (x + 0.27, CEIL - 0.026, z + 0.57), (x - 0.27, CEIL - 0.026, z + 0.57)], lens or self.M['lens'],
                   uv=np.tile(self.sw('white'), (4, 1)))
            W.light((x, CEIL - 0.08, z), (0.78, 0.9, 1.0), intensity, 7.0, area=(0.5, 1.1, 0), name=name,
                    flicker=flicker, group=group)
        else:
            self.box((x, CEIL - 0.026, z), (0.54, 0.004, 1.14), 'offwhite')
