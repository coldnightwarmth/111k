"""Shipping crates for the paintings: a closed one, an opened one (its lid off) and the bits of smashed
ones, modelled low-poly with one small painted atlas, then scattered round about half the rooms (stacked
against walls, opened with the lid leant or dropped, smashed into planks) with a few bits out in the tunnel.

They're added at runtime rather than baked into the level, but lit by it: every vertex carries the lightmap
coordinates of the bit of floor next to it (felt for against the built level), so the crates take each
room's light, its flickering lamps and flashlight beams the way the level does, plus a little contact
shading and a soft shadow underneath.

    python3 tools/crates.py            # writes assets/env/world-crates.glb and src/crates-placed.js
    python3 tools/crates.py --sheet    # also a contact sheet of the pieces and the atlas (tools/previews/)

Run it again after the level is rebuilt (the lightmap coordinates change).
"""
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scatter as SC                  # noqa: E402  (the built level's mesh, rooms and doorways)
from glbwrite import write_glb        # noqa: E402
from textures import periodic_noise   # noqa: E402

ROOT = os.path.join(HERE, '..')
A = 512          # atlas size as shipped (lofi: about 256 px a metre, like the rest of the level)
K = 4            # drawn this many times bigger, then shrunk
PXM = 256        # atlas pixels per metre for tiled wood

# ------------------------------------------------------------------ the atlas (in shipped pixels)
R = {
    'front': (0, 0, 256, 144),       # the printed long side
    'side': (256, 0, 426, 144),      # the short side with the ?
    'top': (0, 144, 256, 313),       # the lid
    'back': (256, 144, 512, 288),    # the other long side (hardly printed)
    'inside': (0, 313, 256, 457),    # bare boards, inside
    'grain': (426, 0, 512, 86),      # end grain
    'raw': (426, 86, 512, 144),      # freshly split wood
    'shadow': (0, 457, 55, 512),     # (not on this atlas: its own small texture; placeholder)
}
STRIPS = [(256, 288 + 32 * i, 512, 288 + 32 * (i + 1)) for i in range(7)]   # plank faces, 1 m long each

PINE = np.array([0.88, 0.71, 0.48])
INK = np.array([0.10, 0.09, 0.08])
STRAP = np.array([0.80, 0.30, 0.13])
F_SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'
F_LOGO = '/usr/share/fonts/truetype/dejavu/DejaVuSerifCondensed-Bold.ttf'
F_BIG = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def font(path, size):
    return ImageFont.truetype(path, int(size * K))


def boards(w, h, n, seed, along=True, tone=1.0, seams=True):
    """w x h (big pixels) of pine boards running along the width, n of them, grain and knots."""
    r = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w].astype(float)
    # grain runs along the boards: noise drawn small and stretched out lengthwise
    def stretched_noise(freq, sd, sx, sy, oct_=3):
        n = periodic_noise(256, freq, sd, oct_)[:max(2, h // sy), :max(2, w // sx)]
        return np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)) / 255
    warp = stretched_noise(4, seed, 24 * K, 3 * K)
    fine = stretched_noise(30, seed + 1, 6 * K, K // 2 or 1, 2)
    bh = h / n
    k = np.floor(y / bh)
    shade = np.array([r.uniform(0.84, 1.06) for _ in range(n + 1)])[k.astype(int)]
    rings = 0.5 + 0.5 * np.sin((y + warp * 14 * K + k * 13) / (1.6 * K))
    base = (0.86 + 0.07 * rings + 0.12 * (fine - 0.5)) * shade * tone
    img = base[..., None] * PINE
    if seams:
        sy = np.abs(((y + bh / 2) % bh) - bh / 2)
        img *= (1 - 0.55 * np.exp(-(sy / (0.9 * K)) ** 2))[..., None]
    for _ in range(int(w * h / (K * K * 9000)) + 1):   # knots
        cx, cy = r.uniform(0, w), r.uniform(0, h)
        rr = r.uniform(2, 4.5) * K
        d = np.hypot((x - cx) / 1.6, y - cy)
        img *= (1 - 0.45 * np.exp(-(d / rr) ** 2))[..., None]
    return img


def ink_layer(w, h, draw_fn, seed, wear=0.35):
    """Black stencil ink with some of it worn off."""
    m = Image.new('L', (w, h), 0)
    draw_fn(ImageDraw.Draw(m))
    a = np.asarray(m.filter(ImageFilter.GaussianBlur(0.6 * K)), float) / 255
    n = np.asarray(Image.fromarray((periodic_noise(256, 18, seed, 3) * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)) / 255
    a *= np.clip(1.25 - wear * 2.2 * n, 0, 1)
    return a


def apply(img, a, color, strength=0.92):
    return img * (1 - a[..., None] * strength) + color * a[..., None] * strength


def text(d, xy, s, f, fill=255, anchor='la'):
    d.text((xy[0] * K, xy[1] * K), s, font=f, fill=fill, anchor=anchor)


def arrows(d, x, y, s):
    """THIS SIDE UP: two arrows over a bar."""
    for dx in (0, s * 0.5):
        cx = x + dx + s * 0.22
        d.polygon([((cx - s * 0.2) * K, (y + s * 0.35) * K), (cx * K, y * K), ((cx + s * 0.2) * K, (y + s * 0.35) * K)], fill=255)
        d.rectangle(((cx - s * 0.06) * K, (y + s * 0.3) * K, (cx + s * 0.06) * K, (y + s * 0.85) * K), fill=255)
    d.rectangle((x * K, (y + s * 0.95) * K, (x + s * 0.95) * K, (y + s * 1.05) * K), fill=255)


def glass(d, x, y, s):
    """FRAGILE: a wine glass, cracked."""
    d.polygon([(x * K, y * K), ((x + s * 0.7) * K, y * K), ((x + s * 0.6) * K, (y + s * 0.45) * K), ((x + s * 0.38) * K, (y + s * 0.55) * K),
               ((x + s * 0.32) * K, (y + s * 0.55) * K), ((x + s * 0.1) * K, (y + s * 0.45) * K)], fill=255)
    d.rectangle(((x + s * 0.31) * K, (y + s * 0.55) * K, (x + s * 0.39) * K, (y + s * 0.9) * K), fill=255)
    d.rectangle(((x + s * 0.12) * K, (y + s * 0.9) * K, (x + s * 0.58) * K, (y + s * 0.98) * K), fill=255)
    d.line([((x + s * 0.3) * K, y * K), ((x + s * 0.4) * K, (y + s * 0.18) * K), ((x + s * 0.3) * K, (y + s * 0.3) * K)], fill=0, width=int(1.2 * K))


def umbrella(d, x, y, s):
    """KEEP DRY: an umbrella in the rain."""
    d.pieslice(((x) * K, (y + s * 0.25) * K, (x + s) * K, (y + s * 0.95) * K), 180, 360, fill=255)
    d.line([((x + s * 0.5) * K, (y + s * 0.6) * K), ((x + s * 0.5) * K, (y + s * 1.0) * K)], fill=255, width=int(1.6 * K))
    d.arc(((x + s * 0.5) * K, (y + s * 0.9) * K, (x + s * 0.72) * K, (y + s * 1.1) * K), 0, 180, fill=255, width=int(1.6 * K))
    for k in range(4):
        dx = x + s * (0.1 + 0.25 * k)
        d.line([(dx * K, (y + s * 0.02) * K), ((dx - s * 0.05) * K, (y + s * 0.18) * K)], fill=255, width=int(1.2 * K))


def egg_sticker(w, h, x, y, s, seed):
    """A small painted egg sticker (patches of colour on white), peeling a bit."""
    r = np.random.default_rng(seed)
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    box = (x * K, y * K, (x + s * 0.72) * K, (y + s) * K)
    d.ellipse(box, fill=(235, 232, 222, 255))
    cols = [(220, 60, 70), (60, 120, 210), (70, 170, 90), (240, 200, 60), (160, 90, 200), (240, 140, 60)]
    for k in range(14):
        cx, cy = r.uniform(box[0], box[2]), r.uniform(box[1], box[3])
        rr = r.uniform(0.07, 0.14) * s * K
        c = cols[k % len(cols)]
        d.ellipse((cx - rr, cy - rr * 0.8, cx + rr, cy + rr * 0.8), fill=c + (255,))
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).ellipse(box, fill=255)
    img.putalpha(Image.fromarray(np.minimum(np.asarray(img.getchannel('A')), np.asarray(mask))))
    arr = np.asarray(img).astype(float) / 255
    return arr


def paint_front(seed=3):
    w, h = 256 * K, 144 * K
    img = boards(w, h, 5, seed)
    def strap(d):
        d.rectangle((118 * K, 0, 130 * K, h), fill=255)
    a = ink_layer(w, h, strap, seed + 9, wear=0.25)
    img = apply(img, a, STRAP, 0.85)

    def print_(d):
        text(d, (16, 18), '111k', font(F_LOGO, 40))
        d.rectangle((16 * K, 62 * K, 82 * K, 64 * K), fill=255)
        text(d, (16, 70), '20x PAINTINGS', font(F_SANS, 13.5))
        for i, t in enumerate(['QTY: 20', 'PROTECT FROM IMPACT', 'KEEP DRY']):
            text(d, (16, 96 + i * 9), t, font(F_SANS, 6.2))
        arrows(d, 142, 16, 18)
        text(d, (151, 37), 'THIS SIDE UP', font(F_SANS, 5.2), anchor='ma')
        glass(d, 144, 50, 18)
        text(d, (151, 71), 'FRAGILE', font(F_SANS, 5.2), anchor='ma')
        umbrella(d, 142, 82, 18)
        text(d, (151, 103), 'KEEP DRY', font(F_SANS, 5.2), anchor='ma')
        d.line([(166 * K, 14 * K), (166 * K, 130 * K)], fill=255, width=int(0.8 * K))
        d.rectangle((174 * K, 14 * K, 240 * K, 40 * K), outline=255, width=int(1.1 * K))
        text(d, (178, 17), 'CARGO ID:', font(F_SANS, 6.5))
        text(d, (178, 27), 'AR-2047-0193', font(F_SANS, 8.5))
        d.rectangle((176 * K, 46 * K, 186 * K, 48 * K), fill=255)
        for i, t in enumerate(['FINE ART CARGO', '20 PAINTINGS', '12 x 12 IN', '30 x 30 CM', 'TOTAL WT: 28 KG']):
            text(d, (176, 56 + i * 8), t, font(F_SANS, 5.6))
        for (cx, cy, sx, sy) in ((214, 104, 1, 1), (238, 104, -1, 1), (214, 128, 1, -1), (238, 128, -1, -1)):
            d.line([(cx * K, (cy + 5 * sy) * K), (cx * K, cy * K), ((cx + 5 * sx) * K, cy * K)], fill=255, width=int(1.3 * K))
    a = ink_layer(w, h, print_, seed + 1)
    img = apply(img, a, INK)
    eg = egg_sticker(w, h, 92, 104, 24, seed + 2)
    img = img * (1 - eg[..., 3:]) + eg[..., :3] * eg[..., 3:] * 0.92
    return img


def stamp_q(d, cx, cy, s, box=True):
    if box:
        pass
    text(d, (cx, cy), '?', font(F_BIG, s), anchor='mm')


def paint_side(seed=5):
    w, h = 170 * K, 144 * K
    img = boards(w, h, 5, seed)
    a = ink_layer(w, h, lambda d: d.rectangle((150 * K, 0, 160 * K, h), fill=255), seed + 9, wear=0.25)
    img = apply(img, a, STRAP, 0.85)
    a = ink_layer(w, h, lambda d: stamp_q(d, 72, 74, 100), seed + 1, wear=0.3)
    return apply(img, a, INK)


def paint_top(seed=7):
    w, h = 256 * K, 169 * K
    img = boards(w, h, 6, seed)
    # a square of dark speckled stencil overspray under the ?
    r = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w]
    sq = (np.abs(x - 112 * K) < 34 * K) & (np.abs(y - 60 * K) < 28 * K)
    sp = (r.random((h, w)) < 0.35) & sq
    img = apply(img, ndimage_blur(sp.astype(float), 0.6 * K) * 0.8, np.array([0.25, 0.2, 0.15]), 0.8)
    a = ink_layer(w, h, lambda d: stamp_q(d, 112, 62, 52), seed + 1, wear=0.25)
    img = apply(img, a, INK)
    def band(d):
        d.polygon([(182 * K, h), (196 * K, h), (250 * K, 0), (236 * K, 0)], fill=255)
    a = ink_layer(w, h, band, seed + 9, wear=0.25)
    return apply(img, a, STRAP, 0.85)


def ndimage_blur(a, s):
    from scipy import ndimage
    return ndimage.gaussian_filter(a, s)


def paint_back(seed=11):
    w, h = 256 * K, 144 * K
    img = boards(w, h, 5, seed)
    a = ink_layer(w, h, lambda d: (arrows(d, 210, 20, 22), text(d, (16, 112), 'AR-2047-0193', font(F_SANS, 9))), seed + 1, wear=0.55)
    return apply(img, a, INK, 0.75)


def paint_atlas():
    big = np.zeros((A * K, A * K, 3)) + PINE * 0.6
    def put(reg, arr):
        x0, y0, x1, y1 = reg
        big[y0 * K:y1 * K, x0 * K:x1 * K] = arr[:(y1 - y0) * K, :(x1 - x0) * K]
    put(R['front'], paint_front())
    put(R['side'], paint_side())
    put(R['top'], paint_top())
    put(R['back'], paint_back())
    put(R['inside'], boards(256 * K, 144 * K, 5, 13, tone=0.78))
    for i, reg in enumerate(STRIPS):
        put(reg, boards(256 * K, 32 * K, 1, 20 + i, seams=False, tone=0.97 + 0.03 * (i % 3)))
    # end grain: rings round a heart off to one side
    y, x = np.mgrid[0:86 * K, 0:86 * K].astype(float)
    d = np.hypot(x + 120 * K, y - 43 * K) / K
    put(R['grain'], ((0.72 + 0.12 * np.sin(d * 1.6)) * (0.9 + 0.1 * periodic_noise(86 * K, 6, 31, 2)))[..., None] * PINE * 0.9)
    # freshly split wood: pale, long fibres
    fib = np.asarray(Image.fromarray((periodic_noise(256, 40, 33, 2) * 255).astype(np.uint8)).resize((86 * K, 58 * K), Image.BILINEAR)) / 255
    fib = np.asarray(Image.fromarray((fib * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(0)).resize((86 * K, 58 * K)), float) / 255
    stretch = np.asarray(Image.fromarray((periodic_noise(256, 6, 34, 3) * 255).astype(np.uint8)).resize((86 * K, 58 * K), Image.BILINEAR)) / 255
    put(R['raw'], (0.95 + 0.1 * (fib - 0.5) + 0.06 * (stretch - 0.5))[..., None] * np.array([0.92, 0.80, 0.62]))
    # grime over everything, darker low down on each region doesn't apply (shared); just general dirt
    dirt = np.asarray(Image.fromarray((periodic_noise(256, 8, 41, 4) * 255).astype(np.uint8)).resize((A * K, A * K), Image.BILINEAR)) / 255
    big *= (0.88 + 0.16 * dirt)[..., None]
    img = Image.fromarray((np.clip(big, 0, 1) * 255).astype(np.uint8)).resize((A, A), Image.LANCZOS)
    return img


def shadow_texture(n=64):
    y, x = np.mgrid[0:n, 0:n].astype(float)
    # a rounded-box falloff: dark through the middle, soft at the edges
    u, v = np.abs((x + 0.5) / n * 2 - 1), np.abs((y + 0.5) / n * 2 - 1)
    d = np.maximum(u, v) ** 3 * 0.5 + np.hypot(u, v) ** 2 * 0.5
    a = np.clip(1 - d, 0, 1) ** 1.5 * 0.62
    rgba = np.zeros((n, n, 4)); rgba[..., 3] = a
    return Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA')


# ------------------------------------------------------------------ geometry
def reg_uv(reg, s, t):
    """Point (s, t) in 0..1 of a region (t = 0 at its top) to atlas uv."""
    x0, y0, x1, y1 = reg
    return ((x0 + (x1 - x0) * s) / A, (y0 + (y1 - y0) * t) / A)


class Mesh:
    def __init__(self):
        self.P, self.N, self.UV, self.AO = [], [], [], []

    def tri(self, p, uv, ao=(1, 1, 1)):
        p = [np.asarray(q, float) for q in p]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        ln = np.linalg.norm(n)
        if ln < 1e-12:
            return
        n /= ln
        for q, u, a in zip(p, uv, ao):
            self.P.append(q); self.N.append(n); self.UV.append(u); self.AO.append(a)

    def quad(self, p, uv):
        self.tri([p[0], p[1], p[2]], [uv[0], uv[1], uv[2]])
        self.tri([p[0], p[2], p[3]], [uv[0], uv[2], uv[3]])

    def extend(self, other, M=np.eye(4)):
        R3 = M[:3, :3]
        for p, n, u, a in zip(other.P, other.N, other.UV, other.AO):
            self.P.append(R3 @ p + M[:3, 3]); self.N.append(R3 @ n); self.UV.append(u); self.AO.append(a)

    def arrays(self):
        return np.array(self.P), np.array(self.N), np.array(self.UV), np.array(self.AO)


# box faces: corners counter-clockwise seen from outside, and the face's (u, v) axes as box axes
FACES = {
    '+z': ([(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], (0, 1)),
    '-z': ([(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)], (0, 1)),
    '+x': ([(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)], (2, 1)),
    '-x': ([(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)], (2, 1)),
    '+y': ([(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)], (0, 2)),
    '-y': ([(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)], (0, 2)),
}


def tiled(reg, w, h, r, rot=False):
    """uvs for a w x h (metres) face cut from a tiling region at the atlas density, at a random spot."""
    x0, y0, x1, y1 = reg
    rw, rh = (x1 - x0) / PXM, (y1 - y0) / PXM
    if rot:
        w, h = h, w
    w, h = min(w, rw), min(h, rh)
    ox, oy = r.uniform(0, rw - w), r.uniform(0, rh - h)
    s0, s1, t0, t1 = ox / rw, (ox + w) / rw, oy / rh, (oy + h) / rh
    c = [(s0, t1), (s1, t1), (s1, t0), (s0, t0)]
    if rot:
        c = [c[1], c[2], c[3], c[0]]
    return [reg_uv(reg, s, t) for s, t in c]


def stretched(reg, crop=(0, 0, 1, 1)):
    s0, t0, s1, t1 = crop
    return [reg_uv(reg, s0, t1), reg_uv(reg, s1, t1), reg_uv(reg, s1, t0), reg_uv(reg, s0, t0)]


def box(m, lo, hi, r, faces=None, plank=None):
    """An axis-aligned box from lo to hi; faces: {face: uv list or 'grain' or None}; default plank wood."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    c, h = (lo + hi) / 2, (hi - lo) / 2
    faces = faces or {}
    strip = STRIPS[plank if plank is not None else r.integers(len(STRIPS))]
    for f, (corners, (ua, va)) in FACES.items():
        uv = faces.get(f, 'wood')
        if uv is False:
            continue
        w, ht = 2 * h[ua], 2 * h[va]
        if uv == 'wood':
            # wood grain runs along the box's longest side
            longest = int(np.argmax(h))
            uv = tiled(strip, w, ht, r, rot=(longest == va))
        elif uv == 'grain':
            uv = tiled(R['grain'], w, ht, r)
        elif uv == 'raw':
            uv = tiled(R['raw'], w, ht, r)
        m.quad([c + h * np.array(q) for q in corners], uv)


W, D, H = 1.0, 0.66, 0.66          # crate body: width, depth, height to the top of the walls
BASE = 0.11                        # skids + deck
T = 0.02                           # board thickness
LID = 0.045


def crate_body(r, open_=False):
    m = Mesh()
    hw, hd = W / 2, D / 2
    # pallet base: feet and deck
    for x in (-0.42, 0, 0.42):
        for z in (-0.27, 0.27):
            box(m, (x - 0.07, 0, z - 0.05), (x + 0.07, 0.08, z + 0.05), r, {'+z': 'grain', '-z': 'grain'})
    box(m, (-hw, 0.08, -hd), (hw, BASE, hd), r, {'+y': tiled(R['inside'], W, D, r)})
    # walls (outside printed, inside bare)
    wl, wr = -hw + 0.03, hw - 0.03
    box(m, (wl, BASE, hd - T), (wr, H, hd), r, {'+z': stretched(R['front']), '-z': tiled(R['inside'], wr - wl, H - BASE, r)})
    box(m, (wl, BASE, -hd), (wr, H, -hd + T), r, {'-z': stretched(R['back']), '+z': tiled(R['inside'], wr - wl, H - BASE, r)})
    box(m, (hw - 0.03 - T, BASE, -hd + T), (hw - 0.03, H, hd - T), r, {'+x': stretched(R['side']), '-x': tiled(R['inside'], D, H - BASE, r)})
    box(m, (-hw + 0.03, BASE, -hd + T), (-hw + 0.03 + T, H, hd - T), r,
        {'-x': stretched(R['side'], (1, 0, 0, 1)) if False else stretched(R['side']), '+x': tiled(R['inside'], D, H - BASE, r)})
    # frame: corner posts and top and bottom battens round the outside
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * (hw - 0.03), sz * (hd - 0.015)
            # (a few mm proud of the walls' tops, which they overlap: level with them, the two tops fight and flicker)
            box(m, (x - 0.035, BASE, z - 0.035), (x + 0.035, H + 0.004, z + 0.035), r, {'+y': 'grain', '-y': False})
    for y0, y1 in ((BASE, BASE + 0.055), (H - 0.055, H)):
        box(m, (-hw + 0.065, y0, hd), (hw - 0.065, y1, hd + 0.016), r, {'-z': False})
        box(m, (-hw + 0.065, y0, -hd - 0.016), (hw - 0.065, y1, -hd), r, {'+z': False})
        box(m, (hw - 0.03, y0, -hd + 0.05), (hw - 0.03 + 0.016 + 0.035, y1, hd - 0.05), r, {'-x': False})
        box(m, (-hw + 0.03 - 0.016 - 0.035, y0, -hd + 0.05), (-hw + 0.03, y1, hd - 0.05), r, {'+x': False})
    if not open_:
        m.extend(lid(r), translate(0, H, 0))
    return m


def lid(r):
    """The lid, sitting on y = 0: a slab with a rim of battens on top."""
    m = Mesh()
    hw, hd = W / 2 + 0.02, D / 2 + 0.02
    box(m, (-hw, 0, -hd), (hw, LID, hd), r, {'+y': stretched(R['top']), '-y': tiled(R['inside'], 2 * hw, 2 * hd, r)})
    for z0, z1 in ((hd - 0.06, hd), (-hd, -hd + 0.06)):
        box(m, (-hw, LID, z0), (hw, LID + 0.016, z1), r)
    for x0, x1 in ((hw - 0.06, hw), (-hw, -hw + 0.06)):
        box(m, (x0, LID, -hd + 0.06), (x1, LID + 0.016, hd - 0.06), r)
    return m


# ---- broken bits
def ear_clip(poly):
    """Triangles of a simple polygon (counter-clockwise), as index triples."""
    idx = list(range(len(poly)))
    out = []
    def area2(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    guard = 0
    while len(idx) > 3 and guard < 2000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if area2(a, b, c) <= 1e-12:
                continue
            if any(area2(a, b, poly[j]) >= 0 and area2(b, c, poly[j]) >= 0 and area2(c, a, poly[j]) >= 0
                   for j in idx if j not in (i0, i1, i2)):
                continue
            out.append((i0, i1, i2)); idx.pop(k); break
        else:
            break
    if len(idx) == 3:
        out.append(tuple(idx))
    return out


def slab(poly, thick, uv_top, uv_bottom, raw_edges, r, plank=None):
    """A flat piece (polygon in x, z, counter-clockwise from above) thick in y from 0.
    uv_top/uv_bottom: functions (x, z) -> uv. raw_edges: set of edge indices that are broken (split wood)."""
    m = Mesh()
    poly = [np.asarray(p, float) for p in poly]
    tris = ear_clip([(p[0], -p[1]) for p in poly])        # (x, -z): counter-clockwise seen from above is +y
    for a, b, c in tris:
        P3 = [np.array([poly[i][0], thick, poly[i][1]]) for i in (a, b, c)]
        m.tri(P3, [uv_top(*poly[i]) for i in (a, b, c)])
        P3 = [np.array([poly[i][0], 0, poly[i][1]]) for i in (c, b, a)]
        m.tri(P3, [uv_bottom(*poly[i]) for i in (c, b, a)])
    strip = STRIPS[plank if plank is not None else r.integers(len(STRIPS))]
    for i in range(len(poly)):
        p, q = poly[i], poly[(i + 1) % len(poly)]
        L = float(np.linalg.norm(q - p))
        reg = R['raw'] if i in raw_edges else strip
        uv = tiled(reg, max(L, 0.005), thick, r)
        # outward edge: from p to q (polygon is CCW from above, so outward is to the right of p->q)
        m.quad([np.array([p[0], 0, p[1]]), np.array([q[0], 0, q[1]]), np.array([q[0], thick, q[1]]), np.array([p[0], thick, p[1]])], uv)
    return m


def jag(p, q, r, n=4, depth=0.03):
    """Points along a broken edge from p to q (exclusive of both), splintered."""
    p, q = np.asarray(p, float), np.asarray(q, float)
    d = q - p
    nrm = np.array([d[1], -d[0]]) / (np.linalg.norm(d) + 1e-9)
    out = []
    for k in range(1, n):
        t = k / n + r.uniform(-0.3, 0.3) / n
        out.append(p + d * t + nrm * r.uniform(-depth, depth) * (1 if k % 2 else -0.6))
    return out


def plank(r, L=0.9, w=0.095, ends=(False, True)):
    """A board off a crate, snapped at one or both ends."""
    hl, hw = L / 2, w / 2
    poly = [(-hl, hw)]
    raw = set()
    poly += [(-hl, -hw)] if not ends[0] else [(-hl + r.uniform(0, .04), -hw)]
    # long edge
    pts = [poly[-1]]
    if ends[1]:
        tip = (hl + r.uniform(0.02, 0.08), r.uniform(-hw, hw) * 0.6)
        pts = [(hl - r.uniform(0.02, 0.1), -hw), tip, (hl - r.uniform(0.05, 0.16), hw)]
        poly += pts
        raw |= {len(poly) - 3, len(poly) - 2}
    else:
        poly += [(hl, -hw), (hl, hw)]
    if ends[0]:
        tip = (-hl - r.uniform(0.02, 0.07), r.uniform(-hw, hw) * 0.6)
        poly += [(-hl + r.uniform(0.02, 0.12), hw)]
        poly = [tip] + poly[1:] if False else poly
        raw |= {len(poly) - 1, 0}
    # make it counter-clockwise from above: ear_clip works on (x, -z)
    poly = [(x, z) for x, z in poly]
    a = sum(poly[i][0] * (-poly[(i + 1) % len(poly)][1]) - poly[(i + 1) % len(poly)][0] * (-poly[i][1]) for i in range(len(poly)))
    if a < 0:
        poly = poly[::-1]
        raw = {len(poly) - 2 - i for i in raw}
    strip = STRIPS[r.integers(len(STRIPS))]
    ox = r.uniform(0, 1 - L) if L < 1 else 0
    def uv(x, z):
        return reg_uv(strip, np.clip(ox + (x + hl) * 1.0, 0, 1), np.clip(0.5 + z / 0.125, 0, 1))
    return slab(poly, T, uv, uv, raw, r)


def panel_chunk(r, which='front'):
    """A broken-off piece of a printed side: part of the art on top, bare boards underneath."""
    reg = R[which]
    pw, ph = (W - 0.06, H - BASE) if which == 'front' else (D - 0.04, H - BASE)
    # a piece with two original edges (a corner of the panel) and a jagged break across
    cw, ch = r.uniform(0.38, 0.52) * (1 if which == 'front' else 0.85), r.uniform(0.3, 0.42)
    corner = r.integers(4)
    pts = [(0, 0), (cw, 0)] + jag((cw, 0), (cw * 0.55, ch), r, 3, 0.04) + [(cw * 0.55, ch)] + jag((cw * 0.55, ch), (0, ch), r, 3, 0.04) + [(0, ch)]
    raw = set(range(1, len(pts) - 1))
    # where on the panel it came from (s, t in 0..1 of the region), the corner chosen
    sx, sy = (corner & 1), (corner >> 1)
    def st(x, z):
        s = x / pw if not sx else 1 - x / pw
        t = 1 - z / ph if not sy else z / ph
        return np.clip(s, 0, 1), np.clip(t, 0, 1)
    poly = [(x - cw / 2, z - ch / 2) for x, z in pts]
    a = sum(poly[i][0] * (-poly[(i + 1) % len(poly)][1]) - poly[(i + 1) % len(poly)][0] * (-poly[i][1]) for i in range(len(poly)))
    if a < 0:
        poly = poly[::-1]
        raw = {len(poly) - 2 - i for i in raw}
    top = lambda x, z: reg_uv(reg, *st(x + cw / 2, z + ch / 2))
    under = lambda x, z: reg_uv(R['inside'], np.clip((x + cw / 2) / 1.0, 0, 1), np.clip((z + ch / 2) / 0.56, 0, 1))
    return slab(poly, T, top, under, raw, r)


def splinter(r):
    L = r.uniform(0.08, 0.2)
    poly = [(-L / 2, 0.006), (-L / 2, -0.006), (L / 2 - 0.02, -0.01), (L / 2, 0.0), (L / 2 - 0.03, 0.012)]
    poly = poly[::-1]
    uv = lambda x, z: reg_uv(R['raw'], np.clip(0.5 + x, 0, 1), np.clip(0.5 + z * 4, 0, 1))
    return slab(poly, 0.008, uv, uv, set(range(len(poly))), r)


def base_remains(r):
    """The pallet base of a smashed crate, a couple of stubs of wall left on it."""
    m = Mesh()
    hw, hd = W / 2, D / 2
    for x in (-0.42, 0, 0.42):
        for z in (-0.27, 0.27):
            box(m, (x - 0.07, 0, z - 0.05), (x + 0.07, 0.08, z + 0.05), r, {'+z': 'grain', '-z': 'grain'})
    box(m, (-hw, 0.08, -hd), (hw, BASE, hd), r, {'+y': tiled(R['inside'], W, D, r)})
    for sx, sz in ((-1, -1), (1, 1)):
        x, z = sx * (hw - 0.03), sz * (hd - 0.015)
        h = r.uniform(0.12, 0.3)
        box(m, (x - 0.035, BASE, z - 0.035), (x + 0.035, BASE + h, z + 0.035), r, {'+y': 'raw', '-y': False})
    return m


PW, PD, PH = 1.1, 0.8, 0.135      # an empty pallet: length, width, height


def pallet(r, worn=True):
    """An empty shipping pallet, lying flat on y = 0: three bottom boards, nine blocks, three stringer boards and
    the top deck across them, a slat or two missing or snapped off on an old one."""
    m = Mesh()
    hw, hd = PW / 2, PD / 2
    rows = (-hd + 0.05, 0.0, hd - 0.05)
    cols = (-hw + 0.05, 0.0, hw - 0.05)
    for z in rows:                                            # bottom boards, along the length
        box(m, (-hw, 0, z - 0.05), (hw, 0.02, z + 0.05), r, {'-y': False})
    for x in cols:
        for z in rows:                                        # blocks (end grain showing)
            box(m, (x - 0.05, 0.02, z - 0.045), (x + 0.05, 0.095, z + 0.045), r, {'+x': 'grain', '-x': 'grain', '+y': False, '-y': False})
    for x in cols:                                            # stringer boards, across
        box(m, (x - 0.05, 0.095, -hd), (x + 0.05, 0.115, hd), r)
    n = 7
    gap = (PD - n * 0.095) / (n - 1)
    for k in range(n):                                        # the top deck, along the length
        z0 = -hd + k * (0.095 + gap)
        if worn and 0 < k < n - 1 and r.random() < 0.14:
            continue                                          # gone
        if worn and 0 < k < n - 1 and r.random() < 0.12:     # snapped short
            cut = r.uniform(0.25, 0.6) * PW
            x0, x1 = (-hw, -hw + cut) if r.random() < 0.5 else (hw - cut, hw)
            box(m, (x0, 0.115, z0), (x1, PH, z0 + 0.095), r, {'+x' if x0 == -hw else '-x': 'raw'})
            continue
        box(m, (-hw, 0.115, z0), (hw, PH, z0 + 0.095), r)
    return m


def post(r):
    """A corner post snapped off, lying down."""
    m = Mesh()
    L = r.uniform(0.3, 0.5)
    box(m, (-L / 2, 0, -0.035), (L / 2, 0.07, 0.035), r, {'+x': 'raw', '-x': 'grain'})
    return m


# ------------------------------------------------------------------ transforms
def translate(x, y, z):
    M = np.eye(4); M[:3, 3] = (x, y, z); return M


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    M = np.eye(4); M[0, 0], M[0, 2], M[2, 0], M[2, 2] = c, s, -s, c; return M


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    M = np.eye(4); M[1, 1], M[1, 2], M[2, 1], M[2, 2] = c, -s, s, c; return M


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    M = np.eye(4); M[0, 0], M[0, 1], M[1, 0], M[1, 1] = c, -s, s, c; return M


def place_M(x, y, z, yaw, extra=None):
    M = translate(x, y, z) @ rot_y(yaw)
    return M @ extra if extra is not None else M


# ------------------------------------------------------------------ contact sheet (for looking at the pieces)
def sheet(atlas, pieces, out):
    """A quick software render of each piece (flat-shaded, textured) and the atlas, side by side."""
    tiles = [atlas.resize((512, 512))]
    for name, m in pieces:
        tiles.append(render(m, atlas, name))
    W_ = 520 * 4
    rows = (len(tiles) + 3) // 4
    im = Image.new('RGB', (W_, rows * 520), (30, 30, 34))
    for i, t in enumerate(tiles):
        im.paste(t, ((i % 4) * 520, (i // 4) * 520))
    im.save(out)


def render(m, atlas, name, size=512, yaw=-0.6, pitch=0.45):
    P, N, UV, _ = m.arrays()
    tex = np.asarray(atlas.convert('RGB'), float) / 255
    Ry = rot_y(yaw)[:3, :3]; Rx = rot_x(pitch)[:3, :3]
    Rv = Rx @ Ry
    Q = P @ Rv.T
    Nn = N @ Rv.T
    c = (Q.max(0) + Q.min(0)) / 2
    s = 0.85 * size / max(np.ptp(Q[:, 0]), np.ptp(Q[:, 1]), 1e-6)
    img = np.zeros((size, size, 3)) + 0.12
    zb = np.full((size, size), -1e9)
    L = np.array([0.4, 0.7, 0.6]); L /= np.linalg.norm(L)
    for t in range(0, len(P), 3):
        q = Q[t:t + 3]
        n = Nn[t]
        if n[2] <= 0:
            continue
        xy = np.stack([(q[:, 0] - c[0]) * s + size / 2, size / 2 - (q[:, 1] - c[1]) * s], 1)
        x0, y0 = np.floor(xy.min(0)).astype(int); x1, y1 = np.ceil(xy.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1] + 0.5
        a, b, cc = xy
        den = (b[1] - cc[1]) * (a[0] - cc[0]) + (cc[0] - b[0]) * (a[1] - cc[1])
        if abs(den) < 1e-9:
            continue
        w0 = ((b[1] - cc[1]) * (xx - cc[0]) + (cc[0] - b[0]) * (yy - cc[1])) / den
        w1 = ((cc[1] - a[1]) * (xx - cc[0]) + (a[0] - cc[0]) * (yy - cc[1])) / den
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        z = w0 * q[0, 2] + w1 * q[1, 2] + w2 * q[2, 2]
        sub = zb[y0:y1 + 1, x0:x1 + 1]
        ok = inside & (z > sub)
        if not ok.any():
            continue
        uv = UV[t:t + 3]
        u = w0 * uv[0, 0] + w1 * uv[1, 0] + w2 * uv[2, 0]
        v = w0 * uv[0, 1] + w1 * uv[1, 1] + w2 * uv[2, 1]
        col = tex[np.clip((v * A).astype(int), 0, A - 1), np.clip((u * A).astype(int), 0, A - 1)]
        shade = 0.45 + 0.55 * max(0.0, float(N[t] @ L))
        sub[ok] = z[ok]
        img[y0:y1 + 1, x0:x1 + 1][ok] = col[ok] * shade
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    ImageDraw.Draw(out).text((8, 8), name, fill=(220, 220, 220))
    return out


# ------------------------------------------------------------------ the level: where to put them, and its light
class LitLevel(SC.LevelMesh):
    """The built level's mesh (as scatter.py reads it) plus each triangle's lightmap uvs, so a point on the
    floor can be turned into lightmap coordinates."""

    def __init__(self, path):
        super().__init__(path)
        import struct
        b = open(path, 'rb').read()
        o, chunks = 12, []
        while o < len(b):
            n, _ = struct.unpack_from('<II', b, o); chunks.append(b[o + 8:o + 8 + n]); o += 8 + n
        g, binc = json.loads(chunks[0]), chunks[1]
        acc, views = g['accessors'], g['bufferViews']

        def read(i):
            a = acc[i]; v = views[a['bufferView']]
            comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
            dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
            arr = np.frombuffer(binc, dt, a['count'] * comps, v.get('byteOffset', 0) + a.get('byteOffset', 0)).astype(np.float64)
            if a.get('normalized'):
                arr /= np.iinfo(dt).max
            return arr.reshape(-1, comps) if comps > 1 else arr
        uvs = []
        for node in g['nodes']:          # the same walk as LevelMesh, so triangles line up
            if 'mesh' not in node or re.search(r'#10\d\d$', node.get('name', '')):
                continue
            for p in g['meshes'][node['mesh']]['primitives']:
                if 'indices' not in p:
                    continue
                idx = read(p['indices']).astype(int).reshape(-1, 3)
                if 'TEXCOORD_1' in p['attributes']:
                    uvs.append(read(p['attributes']['TEXCOORD_1'])[idx])
                else:
                    uvs.append(np.zeros((len(idx), 3, 2)))
        self.UV1 = np.concatenate(uvs)
        assert len(self.UV1) == len(self.V0)

    def light_uv(self, o, d, far):
        """Lightmap uv where a ray first meets a lit level surface, or None."""
        idx = self._near(o, o + d * far)
        idx = idx[self.hit[idx]]
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
        uv = self.UV1[idx[k]]
        return uv[0] * (1 - u[k] - v[k]) + uv[1] * u[k] + uv[2] * v[k]


def read_placed():
    src = open(os.path.join(ROOT, 'src', 'world-items.js')).read()
    return json.loads(re.search(r'const PLACED = (\[.*?\]);', src, re.S).group(1))


SKIP_ROOMS = {0, SC.SUPPLY_ROOM} | SC.FEATURE_ROOMS     # (the feature rooms get theirs from fixed_crates)
FLOORS = {'tunnel_floor', 'floor_vct', 'mosaic', 'office_floor', 'safety_paint'}     # the party room (everyone starts there) and the supply room (shelving)


class Scene:
    """Everything placed: (piece mesh, world matrix, shade kind), colliders, shadows."""

    def __init__(self, mesh, meta, rng):
        self.m, self.meta, self.r = mesh, meta, rng
        self.parts, self.colliders, self.shadows, self.spots = [], [], [], []
        self.items = read_placed()
        self.doorways = SC.find_doorways(mesh, meta['loop']['doors'])
        a, off = SC.MACHINE
        self.machine = SC._P(a, off, 0)

    # -- tests
    def floor_clear(self, c, yaw, hx, hz, height, pad=0.04, step=0.09):
        """Nothing of the level within the footprint (padded) up to height, and floor under all of it."""
        co, si = math.cos(yaw), math.sin(yaw)
        for lx in np.arange(-hx - pad, hx + pad + 1e-6, step).tolist() + [hx + pad]:
            for lz in np.arange(-hz - pad, hz + pad + 1e-6, step).tolist() + [hz + pad]:
                x, z = c[0] + co * lx + si * lz, c[2] - si * lx + co * lz
                h = self.m.raycast(np.array([x, height + 0.15, z]), np.array([0.0, -1.0, 0.0]), height + 0.4, solid=True)
                if h is None or h.point[1] > 0.035 or h.mat not in FLOORS:   # (litter lying flat isn't floor)
                    return False
        return True

    def free(self, c, radius, tall=False):
        """Clear of items (paintings above all), doors, doorways, spawns, the lap timer, and what's placed."""
        x, z = c[0], c[2]
        for it in self.items:
            if it.get('hung') and not tall:
                continue
            if math.hypot(it['x'] - x, it['z'] - z) < radius + (0.75 if it['type'] == 'painting' else 0.45):
                return False
        for d in self.meta['doors']:
            if math.hypot(d['hinge'][0] - x, d['hinge'][1] - z) < d['width'] + 0.3 + radius:
                return False
        for a, s in self.doorways:
            for depth in (SC.VD - 0.5, SC.VD + 0.6):
                q = SC._P(a, depth, 0) + SC._T(a) * s
                if math.hypot(q[0] - x, q[2] - z) < 1.5 + radius:
                    return False
        for sp in self.meta['spawns']:
            if math.hypot(sp['x'] - x, sp['z'] - z) < 1.5 + radius:
                return False
        if math.hypot(self.machine[0] - x, self.machine[2] - z) < 3.0 + radius:
            return False
        for (sx, sz, sr) in self.spots:
            if math.hypot(sx - x, sz - z) < sr + radius:
                return False
        return True

    def wall_from(self, c, d, y=0.35, far=5.0):
        h = self.m.raycast(np.array([c[0], y, c[2]]), np.asarray(d, float), far, solid=True)
        return h

    # -- adding things
    def add(self, piece, M, kind='crate', spot=None):
        self.parts.append((piece, M, kind))
        if spot:
            self.spots.append(spot)

    def collider(self, c, yaw, hx, hz, y0, y1):
        self.colliders.append({'x': round(float(c[0]), 3), 'z': round(float(c[2]), 3), 'hx': round(hx, 3), 'hz': round(hz, 3),
                               'yaw': round(float(yaw), 4), 'y0': round(y0, 3), 'y1': round(y1, 3)})

    def shadow(self, c, yaw, hx, hz, strength=1.0, y=0.004):
        self.shadows.append((np.array([c[0], y, c[2]]), yaw, hx, hz, strength))


def settle(piece, Rm, toward=None):
    """The piece turned by Rm (4x4, no translation), shifted to stand on y = 0 and (if toward is 'x' or 'z')
    with its furthest point that way at 0, so it touches a wall there."""
    P = np.array(piece.P)
    Q = P @ Rm[:3, :3].T
    sh = np.eye(4)
    sh[1, 3] = -Q[:, 1].min()
    if toward == 'x':
        sh[0, 3] = -Q[:, 0].max()
    if toward == 'z':
        sh[2, 3] = -Q[:, 2].max()
    return sh @ Rm


def yaw_facing(d):
    """The yaw that turns a piece's local +z to point along world direction d (x, z)."""
    return math.atan2(d[0], d[1])


def yaw_x_to(d):
    """The yaw that turns a piece's local +x to point along world direction d (x, z)."""
    return math.atan2(-d[1], d[0])


def build_scene(meta, mesh, seed=2026, scenes=20, pallets=10, tunnel_pallets=3):
    """Crate scenes through the rooms (most rooms get one, a few two), stacks and leaning empty pallets in
    others, and bits of broken crate (and the odd pallet) along the tunnel."""
    r = np.random.default_rng(seed)
    S = Scene(mesh, meta, r)
    rooms = [i for i in range(len(meta['loop']['doors'])) if i not in SKIP_ROOMS]
    r.shuffle(rooms)
    kinds = ['stack', 'opened', 'smashed', 'stack', 'opened', 'smashed', 'single', 'stack', 'opened', 'smashed']
    done = []
    for _ in range(3):                          # round the rooms, and round again for a second scene in some
        for i in rooms:
            if len(done) >= scenes:
                break
            if sum(1 for j, _ in done if j == i) >= 2:
                continue
            kind = kinds[len(done) % len(kinds)]
            if room_scene(S, i, kind, r):
                done.append((i, kind))
    order = rooms[:]
    r.shuffle(order)
    stacked = 0
    for _ in range(2):
        for i in order:
            if stacked >= pallets:
                break
            if pallet_scene(S, i, 'stack' if r.random() < 0.6 else 'lean', r):
                done.append((i, 'pallets'))
                stacked += 1
    tunnel_bits(S, r, clusters=26)
    tunnel_pallets_(S, r, tunnel_pallets)
    fixed_crates(S, r)
    return S, done


# ------------------------------------------------------------------ crates that go in particular places
def frame_point(i, door_x, x, z):
    """A point in room i's own frame (x across, z toward its back wall) in the world, as the level builder lays
    rooms out (and src/room-frame.js), and the yaw that lines a piece's x up with the room's."""
    a = 2 * math.pi * i / 20
    yaw = math.atan2(math.cos(a), -math.sin(a))
    o = SC._P(a, SC.ROOM_C, 0) - door_x * SC._T(a)
    cy, sy = math.cos(yaw), math.sin(yaw)
    return np.array([o[0] + cy * x + sy * z, 0.0, o[2] - sy * x + cy * z]), yaw


# B-20: open crates round the converter room, an egg in most of them (the eggs are src/eggs.js: keep these in step)
EGG_CRATES = [(2.6, 2.25, 0.25), (2.85, 0.6, math.pi / 2 + 0.1), (-2.85, 0.55, math.pi / 2 - 0.08), (-2.65, -1.05, 1.9),
              (1.75, 0.95, -0.35), (-1.0, -1.75, 0.5)]
EGG_ROOM, EGG_DOOR = 19, 1.64
# B-04: the crate the projector stands on (src/cinema.js CRATE)
CINEMA_ROOM, CINEMA_DOOR, CINEMA_CRATE = 3, -0.67, (0.55, -2.3)


def fixed_crates(S, r):
    # outside the start room's door, where the generator stood
    a = 0.045
    crate_at(S, SC._P(a, 1.95, 0), a + math.pi / 2)
    # the projector's crate
    c, yaw = frame_point(CINEMA_ROOM, CINEMA_DOOR, *CINEMA_CRATE)
    crate_at(S, c, yaw)
    # the egg crates, lids off (a couple dropped beside them), and some splinters
    for k, (x, z, turn) in enumerate(EGG_CRATES):
        c, yaw = frame_point(EGG_ROOM, EGG_DOOR, x, z)
        crate_at(S, c, yaw + turn, open_=True)
        if k in (0, 3):
            q, _ = frame_point(EGG_ROOM, EGG_DOOR, x + (-0.95 if x > 0 else 0.95), z + 0.2)
            ly = yaw + turn + r.normal(0, 0.4)
            lay_flat(S, lid(r), q, ly, 'crate')
            S.shadow(q, ly, 0.68, 0.5, 0.8)
        q, _ = frame_point(EGG_ROOM, EGG_DOOR, x * 0.8, z * 0.8)
        scatter_bits(S, q, r, 2, 0.5, ('splinter', 'plank2', 'splinter'))


def pallet_stack(S, c, yaw, n, r):
    """n empty pallets stacked flat at c, each knocked a little out of line."""
    for k in range(n):
        yk = yaw + r.normal(0, 0.06)
        off = np.array([r.uniform(-0.04, 0.04), 0, r.uniform(-0.04, 0.04)]) if k else np.zeros(3)
        q = c + off
        S.add(pallet(r), place_M(q[0], k * PH, q[2], yk), 'crate')
    S.collider(c, yaw, PW / 2 + 0.03, PD / 2 + 0.03, 0.0, n * PH)
    S.shadow(c, yaw, PW / 2 + 0.14, PD / 2 + 0.14, 0.9)
    S.spots.append((c[0], c[2], 0.75))


def pallet_scene(S, i, kind, r):
    if kind == 'stack':
        n = int(r.choice([1, 2, 2, 3, 3, 4, 5]))
        if r.random() < 0.55:
            got = against_wall(S, i, r, PW / 2, PD / 2, n * PH + 0.1)
            if not got:
                return False
            c, yaw = got[0], got[1]
        else:
            c = open_floor(S, i, r, 0.7, height=n * PH + 0.1)
            if c is None:
                return False
            yaw = r.uniform(0, 2 * math.pi)
            if not S.floor_clear(c, yaw, PW / 2, PD / 2, n * PH + 0.1):
                return False
        pallet_stack(S, c, yaw, n, r)
        return True
    # one or two stood on end against the wall, leant back
    got = against_wall(S, i, r, PW / 2, 0.2, 0.9)
    if not got:
        return False
    c, yaw, d, wp = got
    dd = np.array([d[0], 0, d[1]])
    n = 2 if r.random() < 0.45 else 1
    for k in range(n):
        lean = r.uniform(0.16, 0.26) + 0.05 * k
        p = lean_on_wall(S, pallet(r), np.array(wp) - dd * (0.15 * k), d, lean)
    depth = PH + math.sin(0.31) * PD + 0.15 * (n - 1)
    mid = np.array([wp[0], 0, wp[2]]) - dd * (depth / 2 + 0.01)
    S.collider(mid, yaw_facing(d), PW / 2 + 0.02, depth / 2, 0.0, PD * math.cos(0.16) + 0.02)
    S.shadow(np.array([wp[0], 0, wp[2]]) - dd * (depth * 0.6), yaw_facing(d), PW / 2 + 0.1, depth / 2 + 0.1, 0.8)
    S.spots.append((mid[0], mid[2], 0.75))
    return True


def tunnel_pallets_(S, r, n):
    """The odd empty pallet (or two stacked) down the tunnel's edge, along the wall."""
    placed = 0
    for _ in range(n * 40):
        if placed >= n:
            break
        a = r.uniform(0, 2 * math.pi)
        x = r.choice([-1, 1]) * r.uniform(1.6, 2.2)
        c = SC._P(a, x, 0)
        yaw = math.atan2(-SC._T(a)[2], SC._T(a)[0]) + r.normal(0, 0.15)    # lengthways along the tunnel
        if not S.free(c, 0.8) or not S.floor_clear(c, yaw, PW / 2, PD / 2, 0.4):
            continue
        pallet_stack(S, c, yaw, int(r.choice([1, 1, 2])), r)
        placed += 1


def room_point(S, i, r):
    a = S.meta['loop']['doors'][i]['angle']
    return SC._P(a, SC.ROOM_C + r.uniform(-2.6, 2.6), 0) + SC._T(a) * r.uniform(-4.6, 4.6), a


def in_room(S, i, c):
    a = S.meta['loop']['doors'][i]['angle']
    rad = math.hypot(c[0], c[2]) - SC.RL
    ang = math.atan2(-c[2], c[0])
    return SC.VD + 0.3 < rad < SC.VD + 6.4 and abs(((ang - a + math.pi) % (2 * math.pi)) - math.pi) * (SC.RL + rad) < 6.0


def against_wall(S, i, r, hx, hz, height, side_on=False, tries=60):
    """A spot with a piece's back (local -z) flat to a room wall: (centre, yaw, wall direction, wall point)."""
    for _ in range(tries):
        c, a = room_point(S, i, r)
        if not in_room(S, i, c):
            continue
        dirs = [SC._U(a), -SC._U(a), SC._T(a), -SC._T(a)]
        d = dirs[r.integers(4)][[0, 2]]
        d = d / np.linalg.norm(d)
        h = S.wall_from(c, (d[0], 0, d[1]))
        if h is None or h.distance > 4.5 or abs(h.normal[1]) > 0.3 or h.mat not in SC.WALLS:
            continue
        hi = S.wall_from(c, (d[0], 0, d[1]), y=1.0)      # a real wall: still there, just as far, higher up
        if hi is None or abs(hi.distance - h.distance) > 0.06 or hi.mat not in SC.WALLS:
            continue
        back = hz if not side_on else hx
        along = r.uniform(-0.3, 0.3)
        cc = np.array([h.point[0], 0, h.point[2]]) - np.array([d[0], 0, d[1]]) * (back + r.uniform(0.04, 0.09))
        cc += np.array([-d[1], 0, d[0]]) * along
        yaw = yaw_facing(-d) + (math.pi / 2 if side_on else 0) + r.normal(0, 0.05)
        if not in_room(S, i, cc) or not S.free(cc, max(hx, hz), tall=height > 1.0):
            continue
        if not S.floor_clear(cc, yaw, hx, hz, height):
            continue
        return cc, yaw, d, h.point
    return None


def open_floor(S, i, r, radius, height=0.15, tries=60):
    for _ in range(tries):
        c, a = room_point(S, i, r)
        if in_room(S, i, c) and S.free(c, radius) and S.floor_clear(c, 0, radius, radius, height, pad=0.0, step=0.12):
            return c
    return None


def crate_at(S, c, yaw, open_=False, on_top=False):
    piece = crate_body(S.r, open_=open_)
    y = 0.0
    S.add(piece, place_M(c[0], y, c[2], yaw), 'crate')
    top = H + (0 if open_ else LID + 0.016)
    S.collider(c, yaw, W / 2 + 0.02, D / 2 + 0.03, 0.0, top)
    S.shadow(c, yaw, W / 2 + 0.16, D / 2 + 0.16)
    S.spots.append((c[0], c[2], 0.75))
    if on_top:
        dy = top
        yaw2 = yaw + S.r.normal(0, 0.12)
        off = np.array([S.r.uniform(-0.05, 0.05), 0, S.r.uniform(-0.04, 0.04)])
        c2 = c + off
        S.add(crate_body(S.r), place_M(c2[0], dy, c2[2], yaw2), 'crate')
        S.collider(c2, yaw2, W / 2 + 0.02, D / 2 + 0.03, dy, dy + H + LID + 0.016)
    return top


def lay_flat(S, piece, c, yaw, kind='bit', lift=0.0):
    S.add(piece, place_M(c[0], lift, c[2], yaw), kind)


def lean_on_wall(S, piece, wall_pt, d, lean, axis='z', along=0.0):
    """Stand a flat piece up against the wall at wall_pt (wall direction d, x z), its top leant in by `lean` (rad)."""
    if axis == 'z':      # the piece's depth (z) goes up the wall (turned round first, so its print stands upright)
        Rm = rot_x(-(math.pi / 2 - lean)) @ rot_y(math.pi)
        M0 = settle(piece, Rm, 'z')
        yaw = yaw_facing(d)
    else:                # a board: its length (x) goes up the wall
        Rm = rot_z(math.pi / 2 - lean)
        M0 = settle(piece, Rm, 'x')
        yaw = yaw_x_to(d)
    side = np.array([-d[1], 0, d[0]]) * along
    p = np.array([wall_pt[0], 0, wall_pt[2]]) - np.array([d[0], 0, d[1]]) * 0.012 + side
    S.add(piece, translate(p[0], 0, p[2]) @ rot_y(yaw) @ M0, 'lean')
    return p


def scatter_bits(S, c, r, n, radius, kinds=('plank', 'plank2', 'splinter', 'splinter', 'post', 'chunk')):
    placed = 0
    for _ in range(n * 6):
        if placed >= n:
            break
        k = kinds[r.integers(len(kinds))]
        q = c + np.array([r.uniform(-radius, radius), 0, r.uniform(-radius, radius)])
        piece = {'plank': lambda: plank(r, r.uniform(0.55, 0.9)), 'plank2': lambda: plank(r, r.uniform(0.3, 0.5), ends=(True, True)),
                 'splinter': lambda: splinter(r), 'post': lambda: post(r),
                 'chunk': lambda: panel_chunk(r, 'front' if r.random() < 0.6 else 'side')}[k]()
        P = np.array(piece.P)
        ext = float(np.max(np.hypot(P[:, 0], P[:, 2])))
        yaw = r.uniform(0, 2 * math.pi)
        if not S.free(q, ext * 0.6) or not S.floor_clear(q, yaw, ext * 0.7, 0.06, 0.12, pad=0.0, step=0.1):
            continue
        lay_flat(S, piece, q, yaw)
        if k in ('plank', 'chunk', 'post'):
            S.shadow(q, yaw, ext * 0.7, 0.09 if k != 'chunk' else ext * 0.5, 0.5)
        S.spots.append((q[0], q[2], ext * 0.55))
        placed += 1
    return placed


def room_scene(S, i, kind, r):
    if kind == 'stack':
        got = against_wall(S, i, r, W / 2, D / 2, 1.6)
        if not got:
            return False
        c, yaw, d, wp = got
        crate_at(S, c, yaw, on_top=r.random() < 0.7)
        side = np.array([-d[1], 0, d[0]]) * (W + r.uniform(0.08, 0.3)) * (1 if r.random() < 0.5 else -1)
        c2 = c + side
        yaw2 = yaw + r.normal(0, 0.08)
        if in_room(S, i, c2) and S.free(c2, 0.5) and S.floor_clear(c2, yaw2, W / 2, D / 2, 0.8):
            crate_at(S, c2, yaw2, open_=r.random() < 0.35)
        scatter_bits(S, c - np.array([d[0], 0, d[1]]) * 0.9, r, r.integers(1, 3), 0.5, ('splinter', 'plank2'))
        return True
    if kind == 'opened':
        got = against_wall(S, i, r, W / 2, D / 2, 0.8)
        if not got:
            return False
        c, yaw, d, wp = got
        crate_at(S, c, yaw, open_=True)
        # the lid: leant on the wall beside it, or dropped on the floor
        lid_piece = lid(r)
        sidev = np.array([-d[1], 0, d[0]]) * (W / 2 + 0.6) * (1 if r.random() < 0.5 else -1)
        if r.random() < 0.6:
            q = np.array(wp) + sidev
            if S.free(q, 0.5) and S.floor_clear(np.array([q[0], 0, q[2]]) - np.array([d[0], 0, d[1]]) * 0.2, yaw, 0.55, 0.12, 0.9):
                p = lean_on_wall(S, lid_piece, q, d, r.uniform(0.18, 0.3))
                S.shadow(p - np.array([d[0], 0, d[1]]) * 0.12, yaw, 0.6, 0.14, 0.7)
                S.spots.append((p[0], p[2], 0.6))
                lid_piece = None
        if lid_piece is not None:
            q = c - np.array([d[0], 0, d[1]]) * r.uniform(0.95, 1.2) + sidev * 0.4
            ly = yaw + r.normal(0, 0.5)
            if S.free(q, 0.6) and S.floor_clear(q, ly, 0.55, 0.38, 0.15):
                lay_flat(S, lid_piece, q, ly, 'crate')
                S.shadow(q, ly, 0.68, 0.5, 0.8)
                S.spots.append((q[0], q[2], 0.65))
        scatter_bits(S, c - np.array([d[0], 0, d[1]]) * 1.0, r, r.integers(2, 4), 0.7)
        return True
    if kind == 'smashed':
        c = open_floor(S, i, r, 0.75)
        if c is None:
            return False
        yaw = r.uniform(0, 2 * math.pi)
        if S.floor_clear(c, yaw, W / 2, D / 2, 0.45):
            S.add(base_remains(r), place_M(c[0], 0, c[2], yaw), 'crate')
            S.shadow(c, yaw, W / 2 + 0.12, D / 2 + 0.12, 0.9)
            S.collider(c, yaw, W / 2, D / 2, 0.0, BASE)
            S.spots.append((c[0], c[2], 0.7))
        scatter_bits(S, c, r, r.integers(5, 9), 1.3)
        # and often a whole one waiting its turn against the wall
        if r.random() < 0.6:
            got = against_wall(S, i, r, W / 2, D / 2, 0.8)
            if got:
                crate_at(S, got[0], got[1])
        # a plank or two leant on a wall
        for _ in range(r.integers(1, 3)):
            got = against_wall(S, i, r, 0.1, 0.05, 1.0, tries=20)
            if got:
                cc, yw, d, wp = got
                lean_on_wall(S, plank(r, r.uniform(0.6, 0.9)), wp, d, r.uniform(0.25, 0.45), axis='x')
                S.spots.append((wp[0], wp[2], 0.4))
        return True
    if kind == 'single':
        c = open_floor(S, i, r, 0.7, height=0.8)
        if c is None:
            return False
        yaw = r.uniform(0, 2 * math.pi)
        if not S.floor_clear(c, yaw, W / 2, D / 2, 0.8):
            return False
        crate_at(S, c, yaw)
        scatter_bits(S, c, r, 2, 0.9, ('splinter', 'plank2'))
        return True
    return False


def tunnel_bits(S, r, clusters=9):
    n = len(S.meta['loop']['doors'])
    for k in range(clusters):
        for _ in range(40):
            a = 2 * math.pi * (k + r.uniform(0.1, 0.9)) / clusters
            x = r.choice([-1, 1]) * r.uniform(1.4, 2.35)
            c = SC._P(a, x, 0)
            if not S.free(c, 0.6):
                continue
            if scatter_bits(S, c, r, r.integers(1, 4), 0.45, ('plank', 'plank2', 'splinter', 'chunk', 'post')):
                break


# ------------------------------------------------------------------ baking the light in
def shade_and_light(S, mesh):
    """World positions, normals, atlas uvs, lightmap uvs and contact shading for everything placed,
    grouped (one chunk per neighbourhood so the game can cull them)."""
    out = {}
    cache = {}
    for piece, M, kind in S.parts:
        P, N, UV, _ = piece.arrays()
        Pw = P @ M[:3, :3].T + M[:3, 3]
        Nw = N @ M[:3, :3].T
        Nw /= np.linalg.norm(Nw, axis=1, keepdims=True)
        centre = Pw.mean(0)
        L = np.zeros((len(Pw), 2))
        C = np.ones((len(Pw), 3))
        for k in range(len(Pw)):
            p, n = Pw[k], Nw[k]
            nh = np.array([n[0], 0, n[2]])
            lh = np.linalg.norm(nh)
            key = (round(p[0], 2), round(p[1], 2), round(p[2], 2), round(n[0], 1), round(n[1], 1), round(n[2], 1))
            if key in cache:
                L[k], C[k] = cache[key]
                continue
            dark = 1.0
            q = p.copy()
            if lh > 0.3:
                nh /= lh
                h = mesh.raycast(p + nh * 0.01, nh, 0.3, solid=True)
                reach = 0.3 if h is None else max(0.0, h.distance - 0.03)
                dark = 0.5 + 0.5 * min(1.0, reach / 0.3)
                q = p + nh * reach
            uv = mesh.light_uv(np.array([q[0], p[1] + 0.03, q[2]]), np.array([0.0, -1.0, 0.0]), p[1] + 0.6)
            if uv is None:
                uv = mesh.light_uv(np.array([centre[0], 0.05, centre[2]]), np.array([0.0, -1.0, 0.0]), 0.6)
            if uv is None:
                uv = np.zeros(2)
            # contact shading: low on the sides darker, undersides dark, tops as lit
            y = p[1]
            if n[1] < -0.5:
                ao = 0.35
            elif n[1] > 0.5:
                ao = 1.0 if kind != 'bit' else 0.95
            else:
                ao = 0.62 + 0.38 * min(1.0, y / 0.35)
            v = ao * dark
            L[k], C[k] = uv, (v, v, v)
            cache[key] = (L[k].copy(), C[k].copy())
        # every corner should borrow light from about the same bit of floor: one that found some other surface
        # (a doorway's step, a wall: another island of the lightmap) would smear that island across its faces,
        # so those take the light of the floor under the middle of the piece instead
        mid = mesh.light_uv(np.array([centre[0], 0.05, centre[2]]), np.array([0.0, -1.0, 0.0]), 0.6)
        if mid is None:
            mid = np.median(L, axis=0)
        L[np.linalg.norm(L - mid, axis=1) > 0.04] = mid
        g = (int(centre[0] // 6), int(centre[2] // 6))
        o = out.setdefault(g, {'pos': [], 'nor': [], 'uv0': [], 'uv1': [], 'col': []})
        o['pos'].append(Pw); o['nor'].append(Nw); o['uv0'].append(UV); o['uv1'].append(L); o['col'].append(C)
    chunks = []
    for g, o in sorted(out.items()):
        pos, uv0, uv1, col = (np.concatenate(o[k]) for k in ('pos', 'uv0', 'uv1', 'col'))
        # corners shared by a face's triangles become one vertex (no normals: like the level, faces are flat
        # and the shader works them out)
        key = np.round(np.hstack([pos * 1e4, uv0 * 65535, uv1 * 65535, col * 255])).astype(np.int64)
        _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        chunks.append({'pos': pos[first], 'uv0': uv0[first], 'uv1': uv1[first], 'col': col[first], 'idx': inv.ravel(),
                       'chunk': f'{g[0]}_{g[1]}'})
    return chunks


def shadow_chunks(S):
    pos, uv, idx = [], [], []
    for c, yaw, hx, hz, strength in S.shadows:
        co, si = math.cos(yaw), math.sin(yaw)
        corners = [(-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)]
        base = len(pos)
        for lx, lz in corners:
            pos.append((c[0] + co * lx + si * lz, c[1], c[2] - si * lx + co * lz))
        # the texture's strength is baked in by picking how much of the falloff to use (0.5 = faint)
        k = 0.5 * (1 - strength)
        uv += [(k, 1 - k), (1 - k, 1 - k), (1 - k, k), (k, k)]
        idx += [base, base + 2, base + 1, base, base + 3, base + 2]
    pos, uv = np.array(pos), np.array(uv)
    return {'pos': pos, 'uv0': uv, 'idx': np.array(idx)}


def write_placed(S, path):
    with open(path, 'w') as f:
        f.write('// Written by tools/crates.py: where the painting crates stand (the models and their light are in\n')
        f.write('// assets/env/world-crates.glb). Players bump into these like the level\'s own furniture.\n')
        f.write('export const CRATE_COLLIDERS = ' + json.dumps(S.colliders) + ';\n')


def main():
    meta = json.load(open(os.path.join(ROOT, 'assets', 'env', 'world.json')))
    mesh = LitLevel(os.path.join(ROOT, 'assets', 'env', 'world.glb'))
    S, rooms = build_scene(meta, mesh)
    atlas = paint_atlas()
    chunks = shade_and_light(S, mesh)
    sh = shadow_chunks(S)
    n = write_glb(os.path.join(ROOT, 'assets', 'env', 'world-crates.glb'), [
        {'name': 'crates', 'image': atlas, 'lightmap': True, 'emissive': False, 'chunks': chunks, 'quality': 88},
        {'name': 'crate_shadows', 'image': shadow_texture(), 'color': (0, 0, 0), 'alpha': 'BLEND', 'lightmap': False,
         'emissive': False, **sh},
    ])
    write_placed(S, os.path.join(ROOT, 'src', 'crates-placed.js'))
    counts = {}
    for _, _, k in S.parts:
        counts[k] = counts.get(k, 0) + 1
    print('rooms', rooms)
    print('pieces', counts, 'colliders', len(S.colliders), 'shadows', len(S.shadows), f'{n / 1e3:.0f} KB',
          'tris', sum(len(c['idx']) for c in chunks) // 3, 'verts', sum(len(c['pos']) for c in chunks))
    return S, atlas


if __name__ == '__main__' and '--pieces' not in sys.argv:
    main()


if __name__ == '__main__' and '--pieces' in sys.argv:
    r = np.random.default_rng(1)
    atlas = paint_atlas()
    pieces = [('closed', crate_body(r)), ('open', crate_body(r, open_=True)), ('lid', lid(r)), ('plank', plank(r)),
              ('plank both', plank(r, 0.5, ends=(True, True))), ('front chunk', panel_chunk(r)), ('side chunk', panel_chunk(r, 'side')),
              ('base', base_remains(r)), ('post', post(r)), ('splinter', splinter(r)), ('pallet', pallet(r)), ('pallet new', pallet(r, worn=False))]
    os.makedirs(os.path.join(HERE, 'previews'), exist_ok=True)
    out = os.path.join(HERE, 'previews', 'crates_pieces.png')
    sheet(atlas, pieces, out)
    atlas.save(os.path.join(HERE, 'previews', 'crates_atlas.png'))
    print(out)
