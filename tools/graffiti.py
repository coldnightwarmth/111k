"""Spray-paint graffiti for 111k, simulated rather than typeset.

Letters come from a hand-drawn single-stroke alphabet, pushed through a
"handstyle" (slant, bounce, overlap, jitter, flourishes). Strokes are painted
like a can: paint is deposited along the path at a rate that rises wherever the
hand slows down (starts, stops, corners), spread by the nozzle cone, saturates
in the core and fades to an overspray mist of single dots. Paint that pools
runs down as drips. Throw-ups and pieces are built the way writers do them:
fast zig-zag fill passes, a fade, a 3D block, a sprayed outline, shines.

Run directly to write a contact sheet: python3 tools/graffiti.py
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

PX_PER_M = 220  # atlas resolution

# ------------------------------------------------------------------ alphabet
# Single strokes in a box: x 0..w, y 0 (baseline) .. 1 (cap height), y up.
GLYPHS = {
    'A': [[(0, 0), (0.3, 1), (0.6, 0)], [(0.12, 0.4), (0.5, 0.42)]],
    'B': [[(0, 0), (0, 1), (0.35, 1), (0.5, 0.85), (0.45, 0.62), (0.05, 0.52), (0.45, 0.46), (0.57, 0.25), (0.42, 0.03), (0, 0)]],
    'C': [[(0.55, 0.85), (0.35, 1), (0.1, 0.9), (0, 0.5), (0.1, 0.1), (0.35, 0), (0.58, 0.15)]],
    'D': [[(0, 0), (0, 1), (0.3, 0.95), (0.55, 0.62), (0.52, 0.25), (0.3, 0.03), (0, 0)]],
    'E': [[(0.55, 1), (0, 1), (0, 0), (0.55, 0)], [(0, 0.5), (0.42, 0.52)]],
    'F': [[(0.55, 1), (0, 1), (0, 0)], [(0, 0.5), (0.42, 0.52)]],
    'G': [[(0.55, 0.85), (0.35, 1), (0.1, 0.9), (0, 0.5), (0.1, 0.1), (0.35, 0), (0.55, 0.15), (0.58, 0.45), (0.3, 0.45)]],
    'H': [[(0, 1), (0, 0)], [(0.55, 1), (0.55, 0)], [(0, 0.5), (0.55, 0.52)]],
    'I': [[(0.1, 1), (0.1, 0)]],
    'J': [[(0.5, 1), (0.5, 0.25), (0.35, 0), (0.12, 0.02), (0, 0.2)]],
    'K': [[(0, 1), (0, 0)], [(0.55, 1), (0.05, 0.45), (0.58, 0)]],
    'L': [[(0, 1), (0, 0), (0.5, 0)]],
    'M': [[(0, 0), (0.05, 1), (0.36, 0.35), (0.66, 1), (0.72, 0)]],
    'N': [[(0, 0), (0, 1), (0.62, 0), (0.62, 1)]],
    'O': [[(0.3, 1), (0.05, 0.85), (0, 0.5), (0.08, 0.12), (0.3, 0), (0.52, 0.12), (0.6, 0.5), (0.52, 0.88), (0.3, 1)]],
    'P': [[(0, 0), (0, 1), (0.35, 1), (0.52, 0.85), (0.5, 0.6), (0.3, 0.48), (0, 0.48)]],
    'Q': [[(0.3, 1), (0.05, 0.85), (0, 0.5), (0.08, 0.12), (0.3, 0), (0.52, 0.12), (0.6, 0.5), (0.52, 0.88), (0.3, 1)],
          [(0.35, 0.25), (0.66, -0.1)]],
    'R': [[(0, 0), (0, 1), (0.35, 1), (0.52, 0.85), (0.5, 0.6), (0.3, 0.48), (0, 0.48)], [(0.2, 0.48), (0.56, 0)]],
    'S': [[(0.55, 0.88), (0.35, 1), (0.1, 0.95), (0.03, 0.75), (0.15, 0.57), (0.42, 0.45), (0.56, 0.25), (0.45, 0.05),
           (0.2, 0), (0, 0.12)]],
    'T': [[(0, 1), (0.6, 1)], [(0.3, 1), (0.3, 0)]],
    'U': [[(0, 1), (0, 0.3), (0.12, 0.05), (0.3, 0), (0.48, 0.05), (0.58, 0.3), (0.58, 1)]],
    'V': [[(0, 1), (0.3, 0), (0.6, 1)]],
    'W': [[(0, 1), (0.18, 0), (0.38, 0.65), (0.58, 0), (0.76, 1)]],
    'X': [[(0, 1), (0.55, 0)], [(0.55, 1), (0, 0)]],
    'Y': [[(0, 1), (0.3, 0.5), (0.6, 1)], [(0.3, 0.5), (0.3, 0)]],
    'Z': [[(0, 1), (0.55, 1), (0, 0), (0.58, 0)]],
    '0': [[(0.27, 1), (0.04, 0.8), (0, 0.5), (0.06, 0.12), (0.27, 0), (0.46, 0.12), (0.52, 0.5), (0.46, 0.85), (0.27, 1)]],
    '1': [[(0, 0.8), (0.2, 1), (0.2, 0)]],
    '2': [[(0.02, 0.8), (0.2, 1), (0.45, 0.95), (0.52, 0.7), (0.35, 0.4), (0, 0), (0.55, 0)]],
    '3': [[(0.03, 0.9), (0.3, 1), (0.5, 0.85), (0.45, 0.6), (0.2, 0.52), (0.48, 0.42), (0.55, 0.2), (0.35, 0), (0, 0.1)]],
    '4': [[(0.4, 0), (0.4, 1), (0, 0.3), (0.58, 0.3)]],
    '5': [[(0.52, 1), (0.08, 1), (0.03, 0.55), (0.3, 0.6), (0.52, 0.45), (0.52, 0.15), (0.3, 0), (0, 0.08)]],
    '6': [[(0.5, 0.95), (0.25, 0.95), (0.05, 0.6), (0.05, 0.2), (0.25, 0), (0.48, 0.1), (0.52, 0.35), (0.3, 0.5), (0.05, 0.35)]],
    '7': [[(0, 1), (0.55, 1), (0.2, 0)]],
    '8': [[(0.28, 0.52), (0.05, 0.7), (0.1, 0.95), (0.3, 1), (0.48, 0.92), (0.5, 0.7), (0.28, 0.52), (0.02, 0.3),
           (0.08, 0.05), (0.3, 0), (0.52, 0.08), (0.55, 0.3), (0.28, 0.52)]],
    '9': [[(0.52, 0.62), (0.3, 0.5), (0.05, 0.62), (0.05, 0.9), (0.28, 1), (0.5, 0.9), (0.52, 0.6), (0.45, 0.2), (0.2, 0)]],
    '+': [[(0.05, 0.5), (0.5, 0.5)], [(0.28, 0.75), (0.28, 0.25)]],
    '!': [[(0.1, 1), (0.08, 0.3)], [(0.08, 0.06), (0.08, 0.0)]],
    "'": [[(0.1, 1), (0.05, 0.72)]],
    '.': [[(0.06, 0.04), (0.08, 0.0)]],
    '/': [[(0, 0), (0.4, 1)]],
    '-': [[(0.02, 0.5), (0.4, 0.5)]],
    ':': [[(0.08, 0.7), (0.09, 0.66)], [(0.08, 0.2), (0.09, 0.16)]],
    ')': [[(0.02, 1), (0.22, 0.6), (0.22, 0.35), (0.02, -0.05)]],
    '<': [[(0.45, 0.85), (0, 0.5), (0.45, 0.15)]],
    '?': [[(0.02, 0.82), (0.22, 1), (0.48, 0.92), (0.48, 0.7), (0.25, 0.5), (0.24, 0.3)], [(0.24, 0.06), (0.25, 0.0)]],
    '&': [[(0.6, 0), (0.1, 0.62), (0.15, 0.95), (0.35, 0.95), (0.38, 0.75), (0.05, 0.38), (0.08, 0.06), (0.3, 0),
           (0.5, 0.15), (0.6, 0.35)]],
    '*': [[(0.25, 0.9), (0.25, 0.3)], [(0, 0.75), (0.5, 0.45)], [(0.5, 0.75), (0, 0.45)]],
}


def glyph_width(ch):
    if ch == ' ':
        return 0.4
    pts = [p for s in GLYPHS[ch] for p in s]
    return max(p[0] for p in pts)


def chaikin(pts, n=2, closed=False):
    pts = np.asarray(pts, float)
    for _ in range(n):
        if len(pts) < 3:
            break
        a, b = pts[:-1], pts[1:]
        q, r = a * 0.75 + b * 0.25, a * 0.25 + b * 0.75
        mid = np.stack([q, r], 1).reshape(-1, 2)
        pts = mid if closed else np.vstack([pts[:1], mid, pts[-1:]])
    return pts


def layout(text, r, slant=0.25, bounce=0.08, spacing=0.12, jitter=0.03, scale_var=0.12, smooth=2, condense=1.0,
           per_letter=False, min_width=0.0):
    """Text -> list of strokes (arrays of x,y in letter-height units, y up).
    per_letter=True returns a list of stroke lists, one per letter."""
    letters, x = [], 0.0
    phase = r.random() * 6.28
    for i, ch in enumerate(text.upper()):
        if ch == ' ':
            x += 0.45; continue
        if ch not in GLYPHS:
            continue
        s = 1 + r.uniform(-scale_var, scale_var)
        if i == 0:
            s *= 1 + scale_var * 1.5  # first letter a bit bigger, as writers do
        dy = bounce * math.sin(phase + i * 1.7) + r.uniform(-bounce, bounce) * 0.5
        rot = r.uniform(-0.08, 0.08)
        cr, sr = math.cos(rot), math.sin(rot)
        cur = []
        gw = glyph_width(ch)
        shift = max(0.0, min_width - gw) / 2  # centre narrow glyphs (1, I) in a wider slot
        for st in GLYPHS[ch]:
            p = np.array(st, float)
            p[:, 0] += shift
            p = p + r.uniform(-jitter, jitter, p.shape)
            p[:, 0] *= condense
            p = np.stack([p[:, 0] * cr - p[:, 1] * sr, p[:, 0] * sr + p[:, 1] * cr], 1) * s
            p[:, 0] += x + p[:, 1] * slant
            p[:, 1] += dy
            cur.append(chaikin(p, smooth))
        letters.append(cur)
        x += max(gw, min_width) * condense * s + spacing
    return letters if per_letter else [s for l in letters for s in l]


def handstyle(text, r, style='flow'):
    """Tag lettering: condensed, uneven, letters run into each other, with a
    lead-in on the first letter and a tail off the last."""
    sharp = style == 'sharp'
    letters = layout(text, r, slant=r.uniform(0.3, 0.55) if sharp else r.uniform(0.15, 0.4), bounce=0.14,
                     spacing=r.uniform(-0.06, 0.04), jitter=0.06, scale_var=0.22, smooth=0 if sharp else 2,
                     condense=r.uniform(0.55, 0.75), per_letter=True)
    # stretch some letters tall, squash others: handstyles are rarely even
    for i, l in enumerate(letters):
        k = 1.35 if i == 0 else r.choice([0.8, 0.95, 1.0, 1.15])
        for s in l:
            s[:, 1] *= k
    strokes = []
    for i, l in enumerate(letters):
        l = [s.copy() for s in l]
        if i > 0 and strokes and np.linalg.norm(strokes[-1][-1] - l[0][0]) < 0.55:
            # run the pen straight on into the next letter
            strokes[-1] = np.vstack([strokes[-1], l[0]])
            l = l[1:]
        strokes += l
    first, last = strokes[0], strokes[-1]
    lead = first[0] + np.array([-0.25, -0.35])
    strokes[0] = np.vstack([chaikin(np.array([lead, first[0]]), 0), first])
    end = last[-1]
    if sharp:  # tail ending in an arrow
        tail = np.array([end, end + (0.3, -0.25), end + (0.75, -0.2)])
        strokes[-1] = np.vstack([last, tail])
        tip = tail[-1]
        strokes.append(np.array([tip + (-0.18, 0.14), tip, tip + (-0.16, -0.16)]))
    else:
        strokes[-1] = np.vstack([last, chaikin(np.array([end, end + (0.2, -0.3), end + (0.55, -0.15)]), 2)])
    return strokes


# ------------------------------------------------------------------- canvas
class Canvas:
    """Straight-alpha RGBA float canvas; layers composite with 'over'."""
    def __init__(self, w, h):
        self.w, self.h = int(w), int(h)
        self.rgb = np.zeros((self.h, self.w, 3))
        self.a = np.zeros((self.h, self.w))

    def over(self, color, alpha):
        alpha = np.clip(alpha, 0, 1)
        col = np.broadcast_to(np.asarray(color, float), self.rgb.shape) if np.ndim(color) == 1 else color
        out_a = alpha + self.a * (1 - alpha)
        num = col * alpha[..., None] + self.rgb * (self.a * (1 - alpha))[..., None]
        self.rgb = np.where(out_a[..., None] > 1e-6, num / np.maximum(out_a, 1e-6)[..., None], self.rgb)
        self.a = out_a

    def image(self):
        # bleed colour into transparent texels so filtering never pulls in black fringes
        rgb, a = self.rgb.copy(), self.a
        w = ndimage.gaussian_filter(a, 6) + 1e-6
        fill = np.stack([ndimage.gaussian_filter(rgb[..., c] * a, 6) / w for c in range(3)], -1)
        rgb = np.where(a[..., None] > 0.02, rgb, fill)
        arr = np.concatenate([rgb, a[..., None]], -1)
        return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')


def resample(path, step):
    path = np.asarray(path, float)
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    L = np.concatenate([[0], np.cumsum(seg)])
    if L[-1] < 1e-6:
        return path[:1], np.zeros(1), 0.0
    s = np.arange(0, L[-1], step)
    return np.stack([np.interp(s, L, path[:, 0]), np.interp(s, L, path[:, 1])], 1), s, L[-1]


def splat(dep, pts, w):
    """Bilinear add of weights at sub-pixel points."""
    h, wd = dep.shape
    x, y = pts[:, 0], pts[:, 1]
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    for dx, dy, k in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        xi, yi = x0 + dx, y0 + dy
        ok = (xi >= 0) & (xi < wd) & (yi >= 0) & (yi < h)
        np.add.at(dep, (yi[ok], xi[ok]), (w * k)[ok])


class Can:
    """One colour + nozzle. Strokes accumulate, then `spray` paints them."""
    def __init__(self, canvas, color, width_px, r, flow=1.0, mist=1.0, drips=1.0, marker=False):
        self.c, self.color, self.r = canvas, np.asarray(color, float), r
        self.sigma = max(0.6, width_px / 3.2)
        self.flow, self.mist, self.drip, self.marker = flow, mist, drips, marker
        self.dep = np.zeros((canvas.h, canvas.w))
        self.drip_seeds = []

    def stroke(self, path, flow=1.0, hesitate=1.0, closed=False):
        path = np.asarray(path, float)
        if closed:
            path = np.vstack([path, path[:1]])
        step = max(0.5, self.sigma * 0.35)
        pts, s, L = resample(path, step)
        if len(pts) < 2:
            splat(self.dep, pts, np.array([3.0 * self.flow * flow]))
            return
        # hand speed: ramps up from a standstill, slows on bends and at the end
        t = s / L
        ramp = np.minimum(1, np.minimum(t, 1 - t) * L / (self.sigma * 8 * hesitate) + 0.25)
        d = np.gradient(pts, axis=0)
        ang = np.arctan2(d[:, 1], d[:, 0])
        bend = np.abs(np.angle(np.exp(1j * np.gradient(np.unwrap(ang)))))
        bend = ndimage.gaussian_filter1d(bend, 3) / step * self.sigma
        speed = ramp / (1 + 2.5 * bend)
        speed *= 1 + 0.18 * ndimage.gaussian_filter1d(self.r.standard_normal(len(pts)), 6)  # unsteady hand
        w = step * self.flow * flow / np.clip(speed, 0.2, 2)
        splat(self.dep, pts, w)
        # remember slow, heavy spots as places paint may run from
        heavy = np.nonzero(w > step * self.flow * 2.2)[0]
        for k in heavy[:: max(1, int(self.sigma))]:
            self.drip_seeds.append((pts[k], w[k] / (step * self.flow)))

    def spray(self, clip=None, opacity=1.0):
        h, wd = self.dep.shape
        dens = ndimage.gaussian_filter(self.dep, self.sigma) * (2.5066 * self.sigma)  # ~1 at the core of one pass
        alpha = 1 - np.exp(-2.6 * dens)
        if not self.marker:
            wide = ndimage.gaussian_filter(self.dep, self.sigma * 3.2) * (2.5066 * self.sigma)
            dots = self.r.random((h, wd)) < np.clip(wide * 0.07 * self.mist, 0, 0.25)
            alpha = np.maximum(alpha, dots * self.r.uniform(0.2, 0.7, (h, wd)))
            alpha = np.maximum(alpha, np.clip(wide * 0.035 * self.mist, 0, 0.08))
        else:
            # marker ink: crisp, a bit streaky, darker where the nib rested
            alpha = np.clip(dens * 1.6, 0, 1) * (0.86 + 0.14 * ndimage.gaussian_filter(self.r.random((h, wd)), 1.2) * 2)
        drips = self._drips(dens)
        alpha = np.maximum(alpha, drips)
        if clip is not None:
            alpha = alpha * clip
        self.c.over(self.color * (0.97 + 0.06 * self.r.random((h, wd, 1))), alpha * opacity)
        self.dep[:] = 0
        self.drip_seeds = []

    def _drips(self, dens):
        h, wd = dens.shape
        out = Image.new('L', (wd, h), 0)
        d = ImageDraw.Draw(out)
        r = self.r
        for (p, weight) in self.drip_seeds:
            if r.random() > 0.11 * self.drip * min(3, weight - 1.6):
                continue
            x, y = p[0] + r.uniform(-self.sigma, self.sigma) * 0.6, p[1] + self.sigma * 1.1
            length = r.uniform(0.1, 1) ** 2 * PX_PER_M * 0.28 * min(2.5, weight / 2.5) + self.sigma
            wdt = max(1.0, self.sigma * r.uniform(0.25, 0.45))
            yy, pts = y, [(x, y)]
            while yy < y + length:
                yy += 3; x += r.uniform(-0.25, 0.25); pts.append((x, yy))
            for i in range(len(pts) - 1):
                taper = 1 - 0.5 * i / max(1, len(pts))
                d.line([pts[i], pts[i + 1]], fill=int(235), width=max(1, int(round(wdt * taper))))
            bx, by = pts[-1]
            rb = wdt * 0.8
            d.ellipse((bx - rb, by - rb * 0.6, bx + rb, by + rb * 1.2), fill=245)
        if self.marker:
            return np.zeros((h, wd))
        return ndimage.gaussian_filter(np.asarray(out, float) / 255, 0.6)


# ------------------------------------------------------------------- pieces
def to_px(strokes, height_px, origin):
    """letter-unit strokes (y up) -> pixel paths (y down)"""
    ox, oy = origin
    return [np.stack([ox + s[:, 0] * height_px, oy - s[:, 1] * height_px], 1) for s in strokes]


def bounds(strokes):
    allp = np.vstack(strokes)
    return allp.min(0), allp.max(0)


def fit_canvas(strokes, height_px, pad):
    lo, hi = bounds(strokes)
    w = (hi[0] - lo[0]) * height_px + 2 * pad
    h = (hi[1] - lo[1]) * height_px + 2 * pad
    origin = (pad - lo[0] * height_px, pad + hi[1] * height_px)
    return Canvas(w, h), origin


def porous(canvas, r, amount=0.3):
    """Paint sitting on rough concrete: tiny gaps where the surface didn't take it."""
    n = ndimage.gaussian_filter(r.random((canvas.h, canvas.w)), 0.8)
    n = (n - n.mean()) / (n.std() + 1e-9)
    canvas.a *= np.clip(1 - amount * np.clip(-n - 0.6, 0, 3), 0, 1)


def age(canvas, r, fade=0.0, wash=0.0):
    if fade:
        canvas.a *= 1 - fade
        g = canvas.rgb.mean(-1, keepdims=True)
        canvas.rgb = canvas.rgb * (1 - fade * 0.5) + g * fade * 0.5
    if wash:  # water streaks washing paint away from the top down
        x = np.arange(canvas.w)
        streak = ndimage.gaussian_filter1d(r.random(canvas.w), 3)
        streak = np.clip((streak - streak.mean()) / (streak.std() + 1e-9) * wash, 0, 1)
        canvas.a *= 1 - 0.6 * streak[None, :] * np.linspace(1, 0.3, canvas.h)[:, None]


def tag(text, color, r, height_m=0.32, width_m=0.025, flourish=None, style='flow', outline=None):
    """Handstyle tag in one colour (optionally with a quick outline in another)."""
    hp = height_m * PX_PER_M
    strokes = handstyle(text, r, style)
    lo, hi = bounds(strokes)
    if flourish == 'underline':  # swoosh from under the last letter back to the start
        y = lo[1] - 0.15
        strokes.append(chaikin(np.array([(hi[0] + 0.1, y + 0.25), (hi[0] * 0.7, y - 0.05), (0.2, y), (-0.25, y + 0.15)]), 3))
    elif flourish == 'crown':
        x0 = r.uniform(0, 0.3); cx = [x0, x0 + 0.15, x0 + 0.3, x0 + 0.45, x0 + 0.6]
        yb = hi[1] + 0.12
        strokes.append(chaikin(np.array([(cx[0], yb), (cx[0], yb + 0.35), (cx[1], yb + 0.15), (cx[2], yb + 0.42),
                                         (cx[3], yb + 0.15), (cx[4], yb + 0.35), (cx[4], yb), (cx[0], yb)]), 1))
    elif flourish == 'halo':
        t = np.linspace(0, 2 * math.pi, 40)
        cx = r.uniform(0.1, 0.5)
        strokes.append(np.stack([cx + 0.35 * np.cos(t), hi[1] + 0.25 + 0.09 * np.sin(t)], 1))
    elif flourish == 'star':
        cx, cy = hi[0] + 0.3, hi[1] - 0.1
        pts = [(cx + 0.22 * math.cos(math.pi / 2 + k * 4 * math.pi / 5), cy + 0.22 * math.sin(math.pi / 2 + k * 4 * math.pi / 5))
               for k in range(6)]
        strokes.append(np.array(pts))
    elif flourish == 'dots':
        for k in range(2):
            strokes.append(np.array([(hi[0] + 0.15 + k * 0.18, lo[1] + 0.05), (hi[0] + 0.16 + k * 0.18, lo[1] + 0.04)]))
    pad = int(hp * 0.25 + PX_PER_M * 0.05)
    cv, origin = fit_canvas(strokes, hp, pad)
    cv = Canvas(cv.w, cv.h + PX_PER_M * 0.25)  # room for drips
    paths = to_px(strokes, hp, origin)
    if outline is not None:
        o = Can(cv, outline, width_m * PX_PER_M * 2.4, r, flow=0.9, drips=0.6)
        for p in paths:
            o.stroke(p)
        o.spray()
    can = Can(cv, color, width_m * PX_PER_M, r, flow=1.0, drips=1.0)
    for p in paths:
        can.stroke(p, flow=r.uniform(0.85, 1.15))
    can.spray()
    porous(cv, r, 0.25)
    return cv


def marker(text, color, r, height_m=0.07, lines=None):
    """Marker / paint-pen scrawl, possibly several lines."""
    hp = height_m * PX_PER_M
    lines = lines or [text]
    all_strokes = []
    for i, line in enumerate(lines):
        st = layout(line, r, slant=r.uniform(0.0, 0.2), bounce=0.06, spacing=0.14, jitter=0.05, scale_var=0.08, smooth=1)
        for s in st:
            s[:, 1] -= i * 1.8
            s[:, 0] += r.uniform(-0.1, 0.3) * i
        all_strokes += st
    pad = int(hp * 0.6)
    cv, origin = fit_canvas(all_strokes, hp, pad)
    can = Can(cv, color, max(2.2, hp * 0.11), r, marker=True)
    for p in to_px(all_strokes, hp, origin):
        can.stroke(p)
    can.spray()
    return cv


def bubble_masks(text, r, hp, pad, fat=0.17, slant=0.1, spacing=0.1):
    """One rounded mask per letter, laid out so neighbours overlap a little."""
    letters = layout(text, r, slant=slant, bounce=0.07, spacing=spacing, jitter=0.03, scale_var=0.08, smooth=3,
                     condense=1.15, per_letter=True, min_width=0.42)
    allp = np.vstack([s for l in letters for s in l])
    lo, hi = allp.min(0), allp.max(0)
    margin = fat * 1.3
    w = int((hi[0] - lo[0] + 2 * margin) * hp + 2 * pad)
    h = int((hi[1] - lo[1] + 2 * margin) * hp + 2 * pad)
    origin = (pad + (margin - lo[0]) * hp, pad + (margin + hi[1]) * hp)
    masks = []
    for l in letters:
        m = Image.new('L', (w, h), 0)
        d = ImageDraw.Draw(m)
        rad = fat * hp * r.uniform(0.92, 1.08)
        for p in to_px(l, hp, origin):
            for x, y in resample(p, 2)[0]:
                d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=255)
        masks.append(ndimage.gaussian_filter(np.asarray(m, float) / 255, hp * 0.025) > 0.5)  # soften joints
    return masks, (w, h)


def contours(mask, min_len=20):
    from skimage import measure
    cs = measure.find_contours(np.pad(mask.astype(float), 2), 0.5)
    return [np.stack([c[:, 1] - 2, c[:, 0] - 2], 1) for c in cs if len(c) > min_len]


def zigzag_fill(can, mask, step, r, angle=None):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    ang = angle if angle is not None else r.uniform(-0.5, 0.5)
    # quick diagonal back-and-forth passes across the letters' bounding box
    pts, y, flip = [], y0 - step, False
    while y < y1 + step:
        a, b = (x0 - step, y), (x1 + step, y + step * 0.6 * math.tan(ang) * 4)
        pts += [b, a] if flip else [a, b]
        y += step * r.uniform(0.7, 1.0); flip = not flip
    can.stroke(np.array(pts), hesitate=0.5)


def throwup(text, fill, outline, r, height_m=0.75, fade=None, shadow=None, shine=(1, 1, 1), fat=0.17, block=None):
    """Bubble letters: fill passes, optional fade, 3D block, sprayed outline
    (letter by letter, each overlapping the one before), shines."""
    hp = height_m * PX_PER_M
    pad = int(PX_PER_M * 0.12)
    masks, (w, h) = bubble_masks(text, r, hp, pad, fat=fat)
    h_total = h + int(PX_PER_M * 0.3)
    masks = [np.pad(m, ((0, h_total - h), (0, 0))) for m in masks]
    mask = np.logical_or.reduce(masks)
    cv = Canvas(w, h_total)
    ow = hp * 0.06
    # 3D block / drop shadow first so the outline sits over its seam
    if block is not None:
        dx, dy = int(hp * 0.09), int(hp * 0.11)
        sh = np.zeros_like(mask)
        for k in range(1, max(dx, dy) + 1):
            sh |= np.roll(np.roll(mask, int(dy * k / max(dx, dy)), 0), int(dx * k / max(dx, dy)), 1)
        sh &= ~mask
        bc = Can(cv, block, hp * 0.12, r, flow=1.3, drips=0.3)
        zigzag_fill(bc, ndimage.binary_dilation(sh, iterations=2), hp * 0.07, r, angle=0.3)
        bc.spray(clip=ndimage.binary_dilation(sh, iterations=int(ow * 0.3) + 1).astype(float))
        oc = Can(cv, outline, ow * 0.8, r, flow=1.0, drips=0.5)
        for c in contours(sh | mask):
            oc.stroke(c, closed=True)
        oc.spray()
    elif shadow is not None:
        sh = np.roll(np.roll(mask, int(hp * 0.05), 0), int(hp * 0.05), 1) & ~mask
        sc = Can(cv, shadow, hp * 0.06, r, flow=1.4, drips=0.2)
        zigzag_fill(sc, sh, hp * 0.04, r)
        sc.spray(clip=ndimage.binary_dilation(sh, iterations=2).astype(float))
    clip = ndimage.binary_dilation(mask, iterations=max(1, int(ow * 0.35))).astype(float)
    fc = Can(cv, fill, hp * 0.16, r, flow=1.0, drips=1.2)
    zigzag_fill(fc, mask, hp * 0.11, r)
    fc.spray(clip=clip)
    if fade is not None:
        ys = np.nonzero(mask)[0]
        lower = mask & (np.arange(mask.shape[0])[:, None] > ys.min() + (ys.max() - ys.min()) * r.uniform(0.45, 0.6))
        fd = Can(cv, fade, hp * 0.12, r, flow=0.8, mist=1.6, drips=0.8)
        zigzag_fill(fd, lower, hp * 0.08, r, angle=0)
        fd.spray(clip=clip)
    # outlines left to right: each letter's line is hidden where a later letter sits on top
    for i, m in enumerate(masks):
        later = np.logical_or.reduce(masks[i + 1:]) if i + 1 < len(masks) else np.zeros_like(m)
        oc = Can(cv, outline, ow, r, flow=1.0, drips=0.8, mist=0.45)
        for c in contours(m):
            oc.stroke(c, closed=True, hesitate=0.6)
        oc.spray(clip=1 - ndimage.binary_erosion(later, iterations=max(1, int(ow * 0.4))).astype(float))
    if shine is not None:
        # little gloss marks on the upper left of the letters
        sc = Can(cv, shine, hp * 0.035, r, flow=1.2, drips=0)
        ys, xs = np.nonzero(mask)
        for _ in range(max(2, len(text) + 1)):
            k = r.integers(len(xs)); x, y = xs[k], ys[k]
            if not mask[min(h - 1, y + int(hp * 0.1)), x]:
                continue
            sc.stroke(np.array([(x, y), (x + hp * 0.06, y - hp * 0.03)]))
        sc.spray()
    porous(cv, r, 0.3)
    return cv


def doodle(kind, color, r, size_m=0.5, width_m=0.025):
    s = size_m * PX_PER_M
    pad = int(PX_PER_M * 0.08)
    cv = Canvas(s + 2 * pad, s + 2 * pad + PX_PER_M * 0.15)
    c = Can(cv, color, width_m * PX_PER_M, r)
    cx, cy = pad + s / 2, pad + s / 2
    t = np.linspace(0, 2 * math.pi, 50)
    j = lambda a: a + r.normal(0, s * 0.01, a.shape)
    if kind == 'smiley':
        c.stroke(j(np.stack([cx + s * 0.45 * np.cos(t), cy + s * 0.44 * np.sin(t)], 1)))
        for ex in (-0.17, 0.17):
            c.stroke(np.array([(cx + s * (ex - 0.07), cy - s * 0.2), (cx + s * (ex + 0.07), cy - s * 0.05)]))
            c.stroke(np.array([(cx + s * (ex + 0.07), cy - s * 0.2), (cx + s * (ex - 0.07), cy - s * 0.05)]))
        a = np.linspace(0.3, math.pi - 0.3, 20)
        c.stroke(j(np.stack([cx + s * 0.27 * np.cos(a), cy + s * 0.08 + s * 0.2 * np.sin(a)], 1)))
    elif kind == 'heart':
        x = 16 * np.sin(t) ** 3; y = -(13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t))
        c.stroke(j(np.stack([cx + x / 34 * s, cy + y / 34 * s], 1)))
    elif kind == 'arrow':
        c.stroke(j(np.array([(pad, cy + s * 0.05), (cx, cy - s * 0.05), (pad + s * 0.92, cy)])))
        c.stroke(np.array([(pad + s * 0.7, cy - s * 0.18), (pad + s * 0.95, cy), (pad + s * 0.68, cy + s * 0.2)]))
    elif kind == 'crown':
        p = np.array([(0.1, 0.8), (0.1, 0.3), (0.3, 0.6), (0.5, 0.2), (0.7, 0.6), (0.9, 0.3), (0.9, 0.8), (0.1, 0.8)])
        c.stroke(j(pad + p * s))
    elif kind == 'eye':
        a = np.linspace(0, math.pi, 25)
        c.stroke(j(np.stack([cx - s * 0.45 * np.cos(a), cy - s * 0.22 * np.sin(a)], 1)))
        c.stroke(j(np.stack([cx - s * 0.45 * np.cos(a), cy + s * 0.22 * np.sin(a)], 1)))
        c.stroke(j(np.stack([cx + s * 0.07 * np.cos(t), cy + s * 0.07 * np.sin(t)], 1)), flow=1.6)
    elif kind == 'tally':
        for k in range(4):
            c.stroke(j(np.array([(pad + s * (0.15 + k * 0.17), cy - s * 0.3), (pad + s * (0.13 + k * 0.17), cy + s * 0.3)])))
        c.stroke(j(np.array([(pad + s * 0.02, cy + s * 0.2), (pad + s * 0.82, cy - s * 0.22)])))
    elif kind == 'star':
        pts = [(cx + s * 0.45 * math.cos(-math.pi / 2 + k * 4 * math.pi / 5), cy + s * 0.45 * math.sin(-math.pi / 2 + k * 4 * math.pi / 5))
               for k in range(6)]
        c.stroke(j(np.array(pts)))
    c.spray()
    porous(cv, r, 0.25)
    return cv


def buff(w_m, h_m, color, r):
    """A rolled-on patch of mismatched paint covering old tags."""
    w, h = int(w_m * PX_PER_M), int(h_m * PX_PER_M)
    cv = Canvas(w, h)
    y, x = np.mgrid[0:h, 0:w]
    edge = ndimage.gaussian_filter(r.random((h, w)), 6)
    edge = (edge - edge.mean()) / (edge.std() + 1e-9)
    d = np.minimum.reduce([x, w - x, y, h - y]).astype(float)
    a = np.clip((d + edge * 6 - 6) / 3, 0, 1)
    streak = (ndimage.gaussian_filter(r.random((h, w)), (2, 30)) - 0.5) * 0.6 + (ndimage.gaussian_filter(r.random((h, w)), 4) - 0.5) * 0.8
    col = np.asarray(color)[None, None] * (1 + streak[..., None])
    cv.over(col, a * 0.97)
    return cv


def stencil(text, color, r, height_m=0.12):
    """Official spray-through-stencil markings (room numbers, stationing)."""
    hp = int(height_m * PX_PER_M)
    font = None
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try:
            font = ImageFont.truetype(p, int(hp * 1.3)); break
        except OSError:
            pass
    font = font or ImageFont.load_default()
    tmp = ImageDraw.Draw(Image.new('L', (1, 1)))
    bb = tmp.textbbox((0, 0), text, font=font)
    pad = int(hp * 0.4)
    w, h = bb[2] - bb[0] + 2 * pad, bb[3] - bb[1] + 2 * pad
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).text((pad - bb[0], pad - bb[1]), text, font=font, fill=255)
    mask = np.asarray(m, float) / 255
    # stencil bridges: thin vertical gaps through each letter
    for k in range(pad, w - pad, max(4, int(hp * 0.62))):
        mask[int(h * 0.45):int(h * 0.55), k:k + max(1, hp // 14)] = 0
    cv = Canvas(w, h)
    mist = ndimage.gaussian_filter(mask, hp * 0.12)
    dots = (r.random((h, w)) < mist * 0.25) * 0.6
    a = np.maximum(ndimage.gaussian_filter(mask, 0.7) * 0.92, dots)
    cv.over(color, a)
    porous(cv, r, 0.4)
    age(cv, r, fade=0.25)
    return cv


# -------------------------------------------------------------------- atlas
CHROME, BLACK, WHITE = (0.78, 0.79, 0.8), (0.04, 0.04, 0.05), (0.94, 0.94, 0.9)
RED, PINK, SKY, LIME = (0.82, 0.1, 0.09), (0.95, 0.35, 0.62), (0.25, 0.65, 0.95), (0.55, 0.88, 0.2)
YELLOW, ORANGE, PURPLE, MINT = (0.98, 0.82, 0.12), (0.97, 0.45, 0.08), (0.5, 0.22, 0.75), (0.45, 0.9, 0.75)
NAVY, MAROON = (0.1, 0.12, 0.35), (0.38, 0.05, 0.08)


def build_pieces(seed=7, stencils=()):
    """All decals used in the world: name -> Canvas. Size in metres = px / PX_PER_M."""
    r = np.random.default_rng(seed)
    P = {}
    # throw-ups and pieces
    P['tu_111k'] = throwup('111K', CHROME, BLACK, r, 0.8, shadow=None, block=(0.12, 0.12, 0.14))
    P['tu_loop'] = throwup('LOOP', PINK, BLACK, r, 0.7, fade=PURPLE, shine=WHITE)
    P['tu_void'] = throwup('VOID', WHITE, RED, r, 0.6, shadow=(0.05, 0.05, 0.05), fat=0.19)
    P['tu_nova'] = throwup('NOVA', YELLOW, BLACK, r, 0.65, fade=ORANGE, block=MAROON)
    P['tu_echo'] = throwup('ECHO', SKY, NAVY, r, 0.55, shadow=BLACK, fat=0.16)
    P['tu_waxy'] = throwup('WAXY', LIME, BLACK, r, 0.85, fade=(0.1, 0.6, 0.45), block=(0.08, 0.2, 0.15))
    P['tu_ssc'] = throwup('SSC', CHROME, (0.06, 0.12, 0.3), r, 0.7, block=(0.25, 0.3, 0.55))
    P['tu_drift'] = throwup('DRIFT', MINT, BLACK, r, 0.55, shadow=PURPLE, fat=0.15)
    P['tu_kilo_old'] = throwup('KILO', ORANGE, BLACK, r, 0.6, shadow=None)
    age(P['tu_kilo_old'], r, fade=0.45, wash=1.2)
    # tags
    tags = [('NOVA', BLACK, 'underline'), ('REMO', RED, 'crown'), ('JINX', BLACK, 'halo'), ('VEKS', SKY, 'underline'),
            ('OZIE', WHITE, 'star'), ('MUTE', BLACK, None), ('ZEAL', PINK, 'dots'), ('RUSE', BLACK, 'underline'),
            ('KILO', LIME, None), ('TRIO', BLACK, 'crown'), ('DRIF', PURPLE, 'halo'), ('SEKT', RED, 'underline')]
    for i, (word, col, fl) in enumerate(tags):
        P[f'tag_{word.lower()}'] = tag(word, col, r, height_m=r.uniform(0.25, 0.42), width_m=r.uniform(0.018, 0.03), flourish=fl,
                                       outline=WHITE if i % 5 == 3 else None, style='sharp' if i % 3 == 1 else 'flow')
        if i % 4 == 2:
            age(P[f'tag_{word.lower()}'], r, fade=0.35)
    P['tag_111k_big'] = tag('111K', BLACK, r, height_m=0.55, width_m=0.035, flourish='underline', style='sharp')
    # marker scrawls
    P['mk_who'] = marker('', BLACK, r, 0.07, lines=['WHO WAS HERE', '  ME!!'])
    P['mk_lisa'] = marker('', (0.1, 0.15, 0.6), r, 0.08, lines=['LISA + DEV', "11/04"])
    P['mk_93'] = marker('', BLACK, r, 0.09, lines=["'93 NEVER ENDED"])
    P['mk_17'] = marker('', MAROON, r, 0.06, lines=["DONT GO PAST 17", "SERIOUSLY"])
    P['mk_hum'] = marker('', BLACK, r, 0.075, lines=['FOLLOW THE HUM'])
    P['mk_loop'] = marker('', (0.05, 0.3, 0.1), r, 0.065, lines=['THE LOOP GOES', 'ON FOREVER', '  :)'])
    P['mk_ok'] = marker('', BLACK, r, 0.1, lines=['OK :)'])
    P['mk_names'] = marker('', BLACK, r, 0.055, lines=['JAY  MO  KAT', 'BEN  RIO', 'WAS HERE 2026'])
    P['mk_bring'] = marker('', RED, r, 0.07, lines=['BRING ICE', 'NEXT TIME'])
    # spray doodles
    P['dd_smiley'] = doodle('smiley', YELLOW, r, 0.6, 0.03)
    P['dd_heart'] = doodle('heart', PINK, r, 0.4, 0.028)
    P['dd_arrow'] = doodle('arrow', SKY, r, 0.7, 0.035)
    P['dd_arrow_w'] = doodle('arrow', WHITE, r, 0.55, 0.03)
    P['dd_crown'] = doodle('crown', PURPLE, r, 0.45, 0.025)
    P['dd_eye'] = doodle('eye', BLACK, r, 0.5, 0.022)
    P['dd_tally'] = doodle('tally', WHITE, r, 0.35, 0.02)
    P['dd_star'] = doodle('star', ORANGE, r, 0.4, 0.025)
    # buffs (mismatched paint rolled over old writing)
    P['buff_grey'] = buff(1.6, 1.0, (0.5, 0.5, 0.48), r)
    P['buff_beige'] = buff(1.2, 0.8, (0.62, 0.58, 0.48), r)
    for name, (text, col) in stencils:
        P[name] = stencil(text, col, r)
    return P


def pack(pieces, width=2048):
    """Shelf-pack canvases into one atlas. Returns (image, rects) with rects
    name -> (u0, v_bottom, u1, v_top) in glTF uv space and size in metres."""
    items = sorted(pieces.items(), key=lambda kv: -kv[1].h)
    pad, x, y, shelf, place = 4, 0, 0, 0, {}
    for name, c in items:
        if x + c.w + pad > width:
            x, y, shelf = 0, y + shelf, 0
        place[name] = (x, y); x += c.w + pad; shelf = max(shelf, c.h + pad)
    H = (y + shelf + 3) // 4 * 4
    atlas = Image.new('RGBA', (width, H), (0, 0, 0, 0))
    rects = {}
    for name, c in items:
        px, py = place[name]
        atlas.paste(c.image(), (px, py))
        rects[name] = {'uv': (px / width, (py + c.h) / H, (px + c.w) / width, py / H),
                       'size': (c.w / PX_PER_M, c.h / PX_PER_M)}
    return atlas, rects


if __name__ == '__main__':
    import os, sys, time
    t = time.time()
    P = build_pieces(stencils=[('st_b07', ('B-07', (0.85, 0.85, 0.8))), ('st_sta', ('N15+240', (0.9, 0.82, 0.2)))])
    img, rects = pack(P)
    print(len(P), 'pieces', img.size, f'{time.time() - t:.1f}s')
    out = sys.argv[1] if len(sys.argv) > 1 else 'graffiti_sheet.png'
    # preview on a concrete-coloured wall
    bg = Image.new('RGBA', img.size, (128, 126, 118, 255))
    Image.alpha_composite(bg, img).convert('RGB').save(out)
