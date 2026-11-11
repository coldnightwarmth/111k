"""Reusable props for the 111k world: furniture, chairs, debris, room shells.

Everything is built in the current frame of the World (so a prop can be
placed inside a room frame, or inside a tilted frame to knock it over).
Small coloured parts use the shared palette texture: `box(..., 'red')`.
"""
import contextlib
import os
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

    def lathe(self, base, prof, color, sides=10, mat=None, yaw=0.0, pitch=0.0, roll=0.0, caps=True):
        """A turned shape: profile [(radius, height), ...] from the bottom up, spun round the local y axis
        (pots, kettles, jars, bottle necks, buckets)."""
        b, R = np.asarray(base, float), rot(yaw, pitch, roll)
        mat_ = mat or self.M['props']
        uv = None if mat is not None else self.sw(color)
        ang = [2 * math.pi * i / sides for i in range(sides)]
        ring = lambda rr, y: [b + R @ np.array([math.cos(t) * rr, y, -math.sin(t) * rr]) for t in ang]
        rings = [ring(rr, y) for rr, y in prof]
        for (ra, (r0, _)), (rb, (r1, _)) in zip(zip(rings, prof), zip(rings[1:], prof[1:])):
            for i in range(sides):
                j = (i + 1) % sides
                pts = [ra[i], ra[j], rb[j], rb[i]]
                if r0 < 1e-6: pts = [ra[i], rb[j], rb[i]]
                elif r1 < 1e-6: pts = [ra[i], ra[j], rb[i]]
                self.W.face(pts, mat_, uv=np.tile(uv, (len(pts), 1)) if uv is not None else None)
        if caps:
            if prof[0][0] > 1e-6:
                self.W.face(rings[0][::-1], mat_, uv=np.tile(uv, (sides, 1)) if uv is not None else None)
            if prof[-1][0] > 1e-6:
                self.W.face(rings[-1], mat_, uv=np.tile(uv, (sides, 1)) if uv is not None else None)

    def surface(self, fn, nu, nv, color=None, mat=None):
        """A bendy sheet: fn(u, v) -> point for u, v in [0, 1] (draped cloth, sagging tarps, bags).
        Use a double-sided material (the cloth ones) so it reads from both sides."""
        P = [[np.asarray(fn(i / nu, j / nv), float) for j in range(nv + 1)] for i in range(nu + 1)]
        uvc = self.sw(color) if mat is None else None
        for i in range(nu):
            for j in range(nv):
                pts = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]]
                if uvc is not None:
                    self.W.face(pts, self.M['props'], uv=np.tile(uvc, (4, 1)))
                else:
                    t = mat.tile
                    self.W.face(pts, mat, uv=[(i / nu / t, j / nv / t), ((i + 1) / nu / t, j / nv / t),
                                              ((i + 1) / nu / t, (j + 1) / nv / t), (i / nu / t, (j + 1) / nv / t)])

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
                self.tube((sx, 0.02, -0.2), (sx, 0.9, 0.18), 0.012, color, sides=8)
                self.tube((sx, 0.02, 0.2), (sx, 0.45, -0.16), 0.012, color, sides=8)
                for fz in (-0.2, 0.2):
                    self.cyl((sx, 0.0, fz), 0.016, 0.025, 'black', sides=8)             # rubber feet
                self.cyl((sx - 0.012, 0.3, 0.0), 0.009, 0.024, 'steel', axis='x', sides=6)  # pivot rivet
            self.tube((-0.2, 0.08, 0.17), (0.2, 0.08, 0.17), 0.009, color, sides=6)      # foot rail
            self.tube((-0.2, 0.42, -0.14), (0.2, 0.42, -0.14), 0.009, color, sides=6)
            self.rbox((0, 0.46, -0.02), (0.42, 0.03, 0.4), color, ch=0.012)
            self.rbox((0, 0.445, -0.02), (0.38, 0.012, 0.36), 'charcoal', ch=0.004)     # pressed underside
            self.rbox((0, 0.78, 0.14), (0.4, 0.18, 0.025), color, ch=0.01, pitch=-0.15)
            self.rbox((0, 0.78, 0.153), (0.34, 0.12, 0.004), 'slate', ch=0.002, pitch=-0.15)
        if not folded:
            W.collider_circle((x, 0, z), 0.27, 0, 0.9)

    # ------------------------------------------------------------- furniture
    def drawer(self, center, w, h, mat, yaw=0.0, pull='steel', out=0.0, label=True):
        """A drawer front set into a carcass face at `center` (facing local -z of the frame): a small
        gap all round, a recessed pull and a label holder."""
        R = rot(yaw)
        c = np.asarray(center, float) + R @ np.array([0, 0, -out])
        self.W.box(c + R @ np.array([0, 0, -0.006]), (w - 0.008, h - 0.008, 0.014), mat, yaw=yaw)
        if out > 0:   # the drawer box behind the front
            self.box(c + R @ np.array([0, -0.02, out / 2]), (w - 0.04, h - 0.06, out), 'lightgrey', yaw=yaw)
        self.box(c + R @ np.array([0, h * 0.12, -0.016]), (min(0.14, w * 0.4), 0.022, 0.008), 'charcoal', yaw=yaw)   # pull recess
        self.box(c + R @ np.array([0, h * 0.12 - 0.006, -0.02]), (min(0.13, w * 0.37), 0.008, 0.012), pull, yaw=yaw)
        if label and h > 0.15:
            self.box(c + R @ np.array([0, h * 0.3, -0.0145]), (0.08, 0.035, 0.002), 'steel', yaw=yaw)
            self.box(c + R @ np.array([0, h * 0.3, -0.0158]), (0.07, 0.026, 0.001), 'paper', yaw=yaw)

    def desk(self, x, z, yaw, r, clutter=True):
        """A steel 'tanker' office desk: chamfered top with a rubber edge band, two drawer pedestals
        on recessed plinths, a centre drawer and a modesty panel."""
        W, metal = self.W, self.M['metal_grey']
        fronts = self.M['metal_beige'] if r.random() < 0.4 else metal
        with W.frame((x, 0, z), yaw):
            self.rbox((0, 0.752, 0), (1.52, 0.035, 0.77), ch=0.008, mat=metal)
            W.box((0, 0.772, 0), (1.44, 0.006, 0.7), self.M['props'], world_uv=False, uv_const=self.sw('charcoal'))  # lino top
            for sx in (-1, 1):
                self.box((sx * 0.763, 0.752, 0), (0.008, 0.032, 0.77), 'black')
            self.box((0, 0.752, -0.388), (1.52, 0.032, 0.008), 'black')
            for dx in (-0.55, 0.55):
                W.box((dx, 0.39, 0.0), (0.42, 0.67, 0.7), metal)
                W.box((dx, 0.03, 0.03), (0.38, 0.06, 0.62), self.M['props'], world_uv=False, uv_const=self.sw('black'))   # toe kick
                for i, (y, hh) in enumerate([(0.62, 0.17), (0.43, 0.19), (0.19, 0.27)]):
                    out = 0.22 if (clutter and r.random() < 0.12) else 0.0
                    self.drawer((dx, y, -0.352), 0.38, hh, fronts, out=out)
            self.drawer((0, 0.69, -0.35), 0.64, 0.08, fronts, label=False)
            W.box((0, 0.42, 0.33), (0.68, 0.5, 0.02), metal)          # modesty panel
            for dx in (-0.73, 0.73):
                for dz in (-0.33, 0.33):
                    self.cyl((dx * 0.98, 0.0, dz), 0.012, 0.012, 'black', sides=6)   # glides
            if clutter:
                if r.random() < 0.6:
                    self.crt((r.uniform(-0.4, 0.4), 0.775, 0.05), r.uniform(-0.3, 0.3) + math.pi, on=False)
                for _ in range(r.integers(1, 4)):
                    self.box((r.uniform(-0.6, 0.6), 0.778, r.uniform(-0.25, 0.25)), (0.22, 0.004, 0.3), 'paper',
                             yaw=r.uniform(0, 6.28))
                if r.random() < 0.5:   # a mug, a stapler
                    self.cyl((r.uniform(-0.6, 0.6), 0.775, r.uniform(-0.2, 0.2)), 0.04, 0.095, r.choice(['white', 'navy', 'red']), sides=12)
                if r.random() < 0.4:
                    self.rbox((r.uniform(-0.6, 0.6), 0.795, r.uniform(-0.2, 0.2)), (0.16, 0.04, 0.05), 'black', ch=0.01, yaw=r.uniform(0, 6))
        W.collider_box((x, 0, z), 0.76, 0.38, yaw, 0, 0.77)

    def crt(self, base, yaw, on=False, screen_mat=None, color='beige'):
        """A boxy CRT monitor at `base` (bottom centre), facing local -z: tapered back with vents,
        an inset bezel round a slightly domed screen, a tilt-swivel foot, a power button and LED."""
        with self.W.frame(base, yaw):
            self.cyl((0, 0.0, 0.05), 0.12, 0.02, color, sides=14)                       # swivel foot
            self.cyl((0, 0.02, 0.05), 0.06, 0.03, color, sides=10)
            self.rbox((0, 0.2, 0.0), (0.4, 0.34, 0.06), color, ch=0.02)                 # bezel frame
            self.hull([(-0.19, 0.04, 0.03), (0.19, 0.04, 0.03), (-0.19, 0.36, 0.03), (0.19, 0.36, 0.03),
                       (-0.13, 0.09, 0.32), (0.13, 0.09, 0.32), (-0.13, 0.31, 0.32), (0.13, 0.31, 0.32)], color)   # tube housing
            for k_ in range(6):                                                         # vent slots on top
                self.box((-0.1 + k_ * 0.04, 0.3, 0.22 - k_ * 0.0), (0.012, 0.004, 0.12), 'charcoal', pitch=-0.18)
            self.box((0, 0.2, -0.031), (0.33, 0.27, 0.004), 'charcoal')                 # inner bezel shadow
            self.box((0.15, 0.045, -0.03), (0.02, 0.012, 0.006), 'charcoal')            # power button
            self.box((0.12, 0.045, -0.031), (0.008, 0.008, 0.004), 'ledgreen' if on else 'charcoal')
            self.box((-0.13, 0.045, -0.031), (0.06, 0.008, 0.002), 'steel')             # badge
            q = [(-0.15, 0.08, -0.034), (0.15, 0.08, -0.034), (0.15, 0.32, -0.034), (-0.15, 0.32, -0.034)]
            q = orient(q, (0, 0.2, -1))
            if screen_mat is not None:
                # seen from the front (-z), +x is the viewer's left
                self.W.face(q, screen_mat, uv=[((0.15 - p[0]) / 0.3, (0.32 - p[1]) / 0.24) for p in q])
            else:
                self.W.face(q, self.M['props'], uv=np.tile(self.sw('glass'), (4, 1)))

    def cabinet(self, x, z, yaw, drawer_out=False):
        """A four-drawer filing cabinet with a folded top lip, plinth, label frames and pulls."""
        W = self.W
        metal = self.M['metal_grey']
        W.box((x, 0.68, z), (0.7, 1.3, 0.52), metal, yaw=yaw, collide=True)
        R = rot(yaw)
        P = lambda d: np.array([x, 0, z]) + R @ np.asarray(d, float)
        self.rbox(P((0, 1.34, 0)), (0.72, 0.025, 0.54), ch=0.006, mat=metal, yaw=yaw)
        self.box(P((0, 0.025, 0.0)), (0.66, 0.05, 0.48), 'black', yaw=yaw)
        for i, y in enumerate((1.14, 0.83, 0.52, 0.21)):
            out = 0.32 if drawer_out and i == 1 else 0.0
            with W.frame(P((0, 0, 0)), yaw):
                self.drawer((0, y, 0.265), 0.64, 0.3, self.M['metal_beige'], yaw=math.pi, out=out)

    def shelving(self, x, z, yaw, r):
        """Boltless steel shelving: angle-iron posts, lipped shelves, X bracing at the back and
        whatever got left on it."""
        W = self.W
        R = rot(yaw)
        P = lambda d: np.array([x, 0, z]) + R @ np.asarray(d, float)
        for dx in (-0.6, 0.6):
            for dz in (-0.22, 0.22):
                sx, sz = -np.sign(dx), -np.sign(dz)
                self.box(P((dx, 1.0, dz + sz * 0.012)), (0.035, 2.0, 0.008), 'steel', yaw=yaw)     # angle iron:
                self.box(P((dx + sx * 0.012, 1.0, dz)), (0.008, 2.0, 0.035), 'steel', yaw=yaw)    # two flanges
                self.box(P((dx, 0.004, dz)), (0.06, 0.008, 0.06), 'steel', yaw=yaw)               # foot plate
        for y in (0.1, 0.7, 1.3, 1.9):
            W.box(P((0, y, 0)), (1.24, 0.012, 0.46), self.M['metal_galv'], yaw=yaw)
            for dz in (-0.235, 0.235):
                W.box(P((0, y - 0.015, dz)), (1.24, 0.035, 0.01), self.M['metal_galv'], yaw=yaw)  # folded lips
            for k_ in range(r.integers(0, 4)):
                bx = r.uniform(-0.42, 0.42)
                bw, bh, bd = r.uniform(0.25, 0.4), r.uniform(0.18, 0.32), r.uniform(0.28, 0.38)
                byaw = yaw + r.uniform(-0.15, 0.15)
                c = P((bx, y + 0.006 + bh / 2, 0))
                W.box(c, (bw, bh, bd), self.M['cardboard'], yaw=byaw, world_uv=False)
                self.box(c + np.array([0, bh / 2 + 0.001, 0]), (0.05, 0.002, bd + 0.002), 'tan', yaw=byaw)   # tape
        for side in (-1, 1):                                                                       # X bracing
            a0, a1 = P((-0.6, 0.1, 0.235)), P((0.6, 1.9, 0.235))
            if side < 0: a0, a1 = P((-0.6, 1.9, 0.235)), P((0.6, 0.1, 0.235))
            self.tube(a0, a1, 0.004, 'steel', sides=4, caps=False)
        W.collider_box((x, 0, z), 0.64, 0.26, yaw, 0, 2)

    def bottle(self, x, z, color, lying=False, yaw=0.0, y=0.0):
        if lying:
            self.cyl((x, y + 0.035, z), 0.035, 0.17, color, axis='x', yaw=yaw, sides=10)
            return
        self.cyl((x, y, z), 0.035, 0.17, color, sides=10)
        self.cyl((x, y + 0.17, z), 0.035, 0.06, color, sides=10, top=0.013)
        self.cyl((x, y + 0.23, z), 0.013, 0.04, color, sides=8)
        self.box((x, y + 0.09, z - 0.034), (0.05, 0.07, 0.002), 'paper')     # label

    # ----------------------------------------------------------------- debris
    def debris(self, r, x, z, kind=None, y=0.0):
        """One small piece of junk on the floor at (x, z). Lit by the floor it lies on (part 'tiny')."""
        with self.W.using('tiny'):
            self._debris(r, x, z, kind, y)

    # what turns up on the floor, roughly how often. Nothing round and solid thicker than a glow stick
    # (a can or a bottle lying about reads as a spray can you could pick up): cans are crushed flat,
    # bottles broken, cups squashed.
    DEBRIS = {'paper': 3, 'flyer': 2, 'crumple': 2, 'folded': 1, 'can': 3, 'glass': 2, 'caps': 1, 'chunk': 3,
              'bag': 2, 'cardboard': 2, 'pizza': 1, 'cup': 2, 'chips': 2, 'candy': 1, 'butts': 2, 'battery': 1,
              'lighter': 1, 'rag': 1, 'receipt': 1, 'wire': 1}

    def _flat_hull(self, x, y, z, outline, h, color, yaw=0.0, mat=None, dent=None, r=None):
        """A thin irregular slab: outline [(u, w), ...] in the ground plane, height h (crushed things)."""
        co, si = math.cos(yaw), math.sin(yaw)
        pts = []
        for k, (u, w) in enumerate(outline):
            for yy in (0.0, h * (1 if dent is None else (0.55 + 0.45 * r.random()))):
                pts.append((x + u * co + w * si, y + yy, z - u * si + w * co))
        self.hull(pts, color, mat)

    # left out (built and thrown away, so every other piece stays where it was): carrier bags, which
    # read as face masks, one pizza box standing open in the tunnel, and a folded box poking up through the
    # supply room's bottom shelf (B-02's back wall; the shelving's added at runtime). (kind, x, z[, how near])
    SKIP_KINDS = {'bag'}
    SKIP_AT = [('pizza', 32.395, 19.881), ('cardboard', 46.39, -11.45, 0.3)]

    def _debris(self, r, x, z, kind=None, y=0.0):
        names = list(self.DEBRIS)
        wts = np.array([self.DEBRIS[k] for k in names], float)
        kind = kind or names[r.choice(len(names), p=wts / wts.sum())]
        w = self.W.T(np.array([[x, y, z]], float))[0]
        if os.environ.get('DEBRIS_LOG'):
            print(f'DEBRIS {kind} {w[0]:.3f} {w[1]:.3f} {w[2]:.3f}')
        drop = kind in self.SKIP_KINDS or any(k == kind and math.hypot(w[0] - at[0], w[2] - at[1]) < (at[2] if len(at) > 2 else 0.05) for k, *at in self.SKIP_AT)
        with (self.W.discard() if drop else contextlib.nullcontext()):
            self._debris_piece(r, x, z, kind, y)

    def _debris_piece(self, r, x, z, kind, y):
        yaw = r.uniform(0, 6.28)
        co, si = math.cos(yaw), math.sin(yaw)
        local = lambda u, w, h=0.0: (x + u * co + w * si, y + h, z - u * si + w * co)
        if kind == 'paper':                                    # a sheet, lying not quite flat
            self.box((x, y + 0.004, z), (r.uniform(0.18, 0.3), 0.004, r.uniform(0.2, 0.3)), 'paper', yaw=yaw,
                     roll=r.uniform(-0.05, 0.05))
        elif kind == 'flyer':                                  # a printed flyer: a band of colour, a picture, lines of type
            w, d = 0.21, 0.29
            self.box((x, y + 0.003, z), (w, 0.003, d), 'paper', yaw=yaw)
            band = ['red', 'black', 'blue', 'purple', 'orange'][r.integers(5)]
            self.box(local(0, -d * 0.32, 0.0049), (w * 0.86, 0.0012, d * 0.18), band, yaw=yaw)
            self.box(local(-w * 0.14, d * 0.05, 0.0049), (w * 0.44, 0.0012, d * 0.3), ['charcoal', 'teal', 'pink'][r.integers(3)], yaw=yaw)
            for k in range(4):
                self.box(local(w * 0.22, -0.02 + k * 0.025, 0.0049), (w * 0.3, 0.0012, 0.006), 'grey', yaw=yaw)
        elif kind == 'crumple':
            self.blob((x, y, z), (0.04, 0.035, 0.045), 'paper', r, n=11)
        elif kind == 'folded':                                 # a sheet folded in half, standing as a tent
            a = r.uniform(0.35, 0.7)
            for side in (-1, 1):
                self.box(local(side * 0.05 * math.cos(a), 0, 0.05 * math.sin(a) + 0.002), (0.1, 0.004, 0.21), 'paper',
                         yaw=yaw, roll=side * a)
        elif kind == 'can':                                    # stamped flat: torn alloy with a scrap of the print on top
            n, rx, rz, h = 11, r.uniform(0.034, 0.05), r.uniform(0.055, 0.07), r.uniform(0.012, 0.022)
            out = [(math.cos(t) * rx * r.uniform(0.85, 1.12), math.sin(t) * rz * r.uniform(0.85, 1.12)) for t in np.linspace(0, 6.28, n, endpoint=False)]
            self._flat_hull(x, y, z, out, h, 'alu', yaw, dent=True, r=r)
            col = ['canred', 'cangreen', 'navy', 'yellow', 'black', 'white', 'orange'][r.integers(7)]
            patch = [(u * 0.7, w * 0.62) for u, w in out]
            self._flat_hull(x, y + h * 0.5, z, patch, h * 0.55 + 0.002, col, yaw)
        elif kind == 'glass':                                  # a broken bottle: shards and the heavy base
            col = ['bottlebrown', 'bottlegreen', 'glass'][r.integers(3)]
            for k in range(r.integers(4, 8)):
                cx, cz, s_ = r.uniform(-0.09, 0.09), r.uniform(-0.09, 0.09), r.uniform(0.012, 0.035)
                out = [(cx + math.cos(t) * s_ * r.uniform(0.4, 1.3), cz + math.sin(t) * s_ * r.uniform(0.4, 1.3)) for t in np.linspace(0, 6.28, 4, endpoint=False) + r.uniform(0, 1)]
                self._flat_hull(x, y, z, out, 0.003, col, yaw)
            if r.random() < 0.6:
                base = [(math.cos(t) * 0.034, math.sin(t) * 0.034) for t in np.linspace(0, 6.28, 9, endpoint=False)]
                self._flat_hull(x + r.uniform(-0.05, 0.05), y, z + r.uniform(-0.05, 0.05), base, 0.012, col, yaw)
        elif kind == 'caps':                                   # bottle caps
            for k in range(r.integers(2, 5)):
                self.cyl((x + r.uniform(-0.12, 0.12), y, z + r.uniform(-0.12, 0.12)), 0.0145, 0.006,
                         ['steel', 'red', 'ledamber', 'navy'][r.integers(4)], sides=10)
        elif kind == 'chunk':                                  # concrete broken off, the odd bit of rebar sticking out
            s_ = r.uniform(0.04, 0.14)
            self.blob((x, y, z), (s_, s_ * 0.6, s_ * 0.8), 'concrete', r, n=9)
            if s_ > 0.09 and r.random() < 0.5:
                a0 = np.array(local(0, 0, s_ * 0.5)); a1 = np.array(local(s_ * 1.6, s_ * 0.3, s_ * 0.9))
                self.tube(a0, a1, 0.005, 'rust', sides=4)
            for k in range(r.integers(0, 3)):
                q = s_ * 0.3
                self.blob((x + r.uniform(-0.15, 0.15), y, z + r.uniform(-0.15, 0.15)), (q, q * 0.6, q * 0.8), 'concrete', r, n=6)
        elif kind == 'bag':                                    # a carrier bag, slumped, handles up
            col = ['white', 'black', 'lightgrey', 'blue'][r.integers(4)]
            self.blob((x, y, z), (0.15, 0.035, 0.11), col, r, n=14)
            for side in (-1, 1):
                p0 = np.array(local(-0.11, side * 0.035, 0.05)); p1 = np.array(local(-0.17, side * 0.03, 0.065)); p2 = np.array(local(-0.2, side * 0.035, 0.03))
                self.tube(p0, p1, 0.004, col, sides=3, caps=False); self.tube(p1, p2, 0.004, col, sides=3, caps=False)
        elif kind == 'cardboard':                              # a box knocked flat, fold and tape still on it
            w, d = r.uniform(0.3, 0.5), r.uniform(0.25, 0.4)
            self.W.box((x, y + 0.004, z), (w, 0.008, d), self.M['cardboard'], yaw=yaw, world_uv=False)
            fold = r.uniform(0.25, 0.6)
            self.W.box(local(w / 2 + 0.06 * math.cos(fold), 0, 0.06 * math.sin(fold) + 0.004), (0.12, 0.008, d),
                       self.M['cardboard'], yaw=yaw, roll=fold, world_uv=False)
            self.box(local(0, 0, 0.0085), (w * 0.98, 0.001, 0.045), 'tan', yaw=yaw)
        elif kind == 'pizza':                                  # a pizza box, sometimes left open
            w = 0.34
            self.W.box((x, y + 0.012, z), (w, 0.024, w), self.M['cardboard'], yaw=yaw, world_uv=False)
            if r.random() < 0.5:
                self.W.box((x, y + 0.026, z), (w, 0.004, w), self.M['cardboard'], yaw=yaw, world_uv=False)
                self.box(local(0, 0, 0.0285), (0.14, 0.001, 0.1), 'red', yaw=yaw)
            else:
                lid = r.uniform(0.6, 1.4)
                self.W.box(local(0.5 * w * math.cos(lid) - w / 2, 0, 0.5 * w * math.sin(lid) + 0.024), (w, 0.004, w),
                           self.M['cardboard'], yaw=yaw, roll=lid, world_uv=False)
                self.box((x, y + 0.025, z), (0.3, 0.002, 0.3), 'dirty', yaw=yaw)
        elif kind == 'cup':                                    # a takeaway cup trodden flat, the lid nearby
            col = ['white', 'kraft', 'red'][r.integers(3)]
            out = [(-0.05, -0.028), (0.05, -0.044), (0.055, 0.0), (0.05, 0.044), (-0.05, 0.028), (-0.055, 0.0)]
            out = [(u + r.uniform(-0.005, 0.005), w + r.uniform(-0.005, 0.005)) for u, w in out]
            self._flat_hull(x, y, z, out, r.uniform(0.014, 0.024), col, yaw, dent=True, r=r)
            if r.random() < 0.5:
                lid = [(math.cos(t) * 0.045, math.sin(t) * 0.045) for t in np.linspace(0, 6.28, 10, endpoint=False)]
                self._flat_hull(x + r.uniform(-0.12, 0.12), y, z + r.uniform(-0.12, 0.12), lid, 0.006, ['black', 'white'][r.integers(2)], yaw)
        elif kind == 'chips':                                  # an empty crisp packet: a puffy pillow, crimped at the ends
            col = ['red', 'blue', 'yellow', 'orange', 'purple', 'green'][r.integers(6)]
            self.blob((x, y, z), (0.07, 0.014, 0.1), col, r, n=14)
            for end in (-1, 1):
                self.box(local(0, end * 0.105, 0.012), (0.12, 0.004, 0.018), col, yaw=yaw)
        elif kind == 'candy':                                  # sweet wrappers, twisted at both ends
            for k in range(r.integers(1, 4)):
                cx, cz, c = r.uniform(-0.1, 0.1), r.uniform(-0.1, 0.1), ['red', 'yellow', 'pink', 'lime', 'purple'][r.integers(5)]
                self.blob((x + cx, y, z + cz), (0.022, 0.008, 0.014), c, r, n=8)
                for end in (-1, 1):
                    self.blob((x + cx + end * 0.03 * co, y, z + cz - end * 0.03 * si), (0.01, 0.004, 0.01), c, r, n=6)
        elif kind == 'butts':                                  # cigarette ends, filter and all
            for _ in range(r.integers(2, 7)):
                a, px, pz = r.uniform(0, 6.28), x + r.uniform(-0.1, 0.1), z + r.uniform(-0.1, 0.1)
                L = r.uniform(0.012, 0.03)
                self.cyl((px, y + 0.0045, pz), 0.0042, L, 'offwhite', axis='x', yaw=a, sides=5)
                self.cyl((px - math.cos(a) * 0.016, y + 0.0045, pz + math.sin(a) * 0.016), 0.0045, 0.016, 'tan', axis='x', yaw=a, sides=5)
        elif kind == 'battery':
            for _ in range(r.integers(1, 3)):
                a, px, pz = r.uniform(0, 6.28), x + r.uniform(-0.05, 0.05), z + r.uniform(-0.05, 0.05)
                self.cyl((px, y + 0.007, pz), 0.007, 0.05, ['black', 'ledamber', 'charcoal'][r.integers(3)], axis='x', yaw=a, sides=6)
        elif kind == 'lighter':
            col = ['red', 'blue', 'yellow', 'lime', 'pink', 'teal'][r.integers(6)]
            self.rbox((x, y + 0.006, z), (0.022, 0.012, 0.062), col, ch=0.004, yaw=yaw)
            self.box(local(0, 0.034, 0.006), (0.02, 0.01, 0.012), 'steel', yaw=yaw)
        elif kind == 'rag':                                    # an old cloth, flattened into the floor
            m = self.M['cloth_' + ['khaki', 'denim', 'red', 'white', 'navy'][r.integers(5)]]
            self.blob((x, y, z), (0.13, 0.012, 0.1), None, r, n=12, mat=m)
        elif kind == 'receipt':                                # a curl of till roll
            L, curl = r.uniform(0.15, 0.3), r.uniform(1.5, 4.0)
            def fn(u, v, L=L, curl=curl):
                a = u * curl
                rr = L / curl
                return local((math.sin(a) * rr) - L / 2, (v - 0.5) * 0.06, rr * (1 - math.cos(a)) * 0.6 + 0.002)
            self.surface(fn, 10, 1, 'paper')
        elif kind == 'wire':
            pts = [np.array([x, y + 0.006, z])]
            a = yaw
            for _ in range(6):
                a += r.uniform(-0.8, 0.8)
                pts.append(pts[-1] + np.array([math.cos(a) * 0.1, 0, math.sin(a) * 0.1]))
            col = ['black', 'red', 'orange', 'white'][r.integers(4)]
            for p, q in zip(pts[:-1], pts[1:]):
                self.tube(p, q, 0.004, col, sides=4, caps=False)

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
        """Steel frame in the wall opening and a leaf hinged on its left jamb. Unless the room is
        locked (opened == 0) the leaf is its own mesh that swings in the game when people walk into it."""
        W, Z0, T_W, DOOR_W, DOOR_H = self.W, self.Z0, self.T_W, self.DOOR_W, self.DOOR_H
        metal = self.M['metal_grey']
        dl, dr = door_x - DOOR_W / 2, door_x + DOOR_W / 2
        fz = Z0 - T_W / 2
        # the frame: two jambs and a head, which also line the opening (no separate reveal faces to fight with)
        for (c, s) in [((dl - 0.04, DOOR_H / 2, fz), (0.08, DOOR_H + 0.08, T_W + 0.04)),
                       ((dr + 0.04, DOOR_H / 2, fz), (0.08, DOOR_H + 0.08, T_W + 0.04)),
                       ((door_x, DOOR_H + 0.04, fz), (DOOR_W, 0.08, T_W + 0.04))]:
            W.box(c, s, metal)
        hinge = np.array([dl + 0.02, 0, fz])            # mid-frame, so the leaf swings clear either way
        lw = DOOR_W - 0.04
        yaw = -opened
        R = rot(yaw)
        swing = opened > 0
        k = len(W.meta.setdefault('doors', []))
        with W.using(f'door{k}' if swing else None):
            centre = hinge + R @ np.array([lw / 2, DOOR_H / 2 - 0.01, 0.0])
            W.box(centre, (lw, DOOR_H - 0.03, 0.05), leaf_mat, yaw=yaw, collide=not swing)
            for off, size, col in [((0, 0.25, 0.0285), (0.36, 0.6, 0.004), 'glass'), ((0, 0.25, -0.0285), (0.36, 0.6, 0.004), 'glass'),
                                   ((0, -1.08, 0.0285), (lw - 0.1, 0.28, 0.004), 'steel'),
                                   ((0.38, -0.18, 0.055), (0.03, 0.03, 0.06), 'steel'), ((0.38, -0.18, 0.09), (0.14, 0.03, 0.03), 'steel'),
                                   ((0.38, -0.18, -0.055), (0.03, 0.03, 0.06), 'steel'), ((0.38, -0.18, -0.09), (0.14, 0.03, 0.03), 'steel'),
                                   ((0.38, -0.18, 0.027), (0.06, 0.13, 0.006), 'steel'), ((0.38, -0.18, -0.027), (0.06, 0.13, 0.006), 'steel')]:
                p = hinge + R @ (np.array([lw / 2, DOOR_H / 2, 0]) + np.array(off))
                self.box(p, size, col, yaw=yaw)
            for hy in (0.25, DOOR_H - 0.3):     # hinge knuckles
                self.cyl(hinge + np.array([-0.01, hy, 0.0]), 0.012, 0.1, 'steel')
        if swing:
            h = W.T(hinge)
            to = lambda d: (lambda v: math.atan2(-v[2], v[0]))(W.T(hinge + d) - h)
            baked, closed = to(R @ np.array([1.0, 0, 0])), to(np.array([1.0, 0, 0]))
            centre_off = math.atan2(math.sin(closed - baked), math.cos(closed - baked))
            W.meta['doorStyle'] = 2                     # handle on the free edge, pivot mid-frame (the game stops correcting)
            W.meta['doors'].append({'index': k, 'hinge': [round(float(h[0]), 3), round(float(h[2]), 3)],
                                    'yaw': round(baked, 4), 'closed': round(centre_off, 4), 'width': round(lw, 3), 'thick': 0.05})

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
        W.box((door_x, (self.DOOR_H + CEIL) / 2, Z0 - T_W / 2), (self.DOOR_W, CEIL - self.DOOR_H, T_W), wall, faces='+z')   # the frame's head lines the opening's top
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
