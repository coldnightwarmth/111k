"""Procedural, tileable grunge textures for 111k (numpy + PIL only).

Every generator returns a PIL image that tiles seamlessly. Detail is kept
low-frequency and slightly chunky, in the spirit of early-2000s game textures.
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 512


def rng(seed):
    return np.random.default_rng(seed)


def periodic_noise(size, freq, seed, octaves=4, gain=0.5):
    """Tileable fbm in [0,1] built from FFT-filtered white noise."""
    r = rng(seed)
    out = np.zeros((size, size))
    amp, total = 1.0, 0.0
    fy = np.fft.fftfreq(size)[:, None] * size
    fx = np.fft.fftfreq(size)[None, :] * size
    rad = np.sqrt(fx * fx + fy * fy)
    for o in range(octaves):
        f = freq * (2 ** o)
        band = np.exp(-((rad - f) ** 2) / (2 * (f * 0.5 + 0.5) ** 2)) + np.exp(-(rad ** 2) / (2 * (f * 0.6 + 0.5) ** 2))
        spec = np.fft.fft2(r.standard_normal((size, size))) * band
        layer = np.real(np.fft.ifft2(spec))
        layer = (layer - layer.mean()) / (layer.std() + 1e-9)
        out += layer * amp
        total += amp
        amp *= gain
    out /= total
    return np.clip(out * 0.5 * 0.6 + 0.5, 0, 1)


def to_img(arr):
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))


def colorize(base, rgb):
    return base[..., None] * np.asarray(rgb)[None, None]


def speckle(size, density, seed):
    r = rng(seed)
    return (r.random((size, size)) < density).astype(float)


def blur_wrap(arr, radius):
    """Gaussian blur that wraps around edges (keeps tiling)."""
    if radius <= 0:
        return arr
    k = np.fft.fftfreq(arr.shape[0])[:, None] ** 2 + np.fft.fftfreq(arr.shape[1])[None, :] ** 2
    g = np.exp(-2 * (math.pi ** 2) * (radius ** 2) * k)
    if arr.ndim == 3:
        return np.stack([np.real(np.fft.ifft2(np.fft.fft2(arr[..., c]) * g)) for c in range(arr.shape[2])], -1)
    return np.real(np.fft.ifft2(np.fft.fft2(arr) * g))


# ------------------------------------------------------------------ surfaces
def cinderblock(paint=(0.72, 0.74, 0.62), seed=10):
    """Painted concrete block wall. Texture spans 0.8 m x 0.8 m (2 x 4 blocks)."""
    n = periodic_noise(S, 6, seed) * 0.6 + periodic_noise(S, 40, seed + 1, 2) * 0.4
    y, x = np.mgrid[0:S, 0:S]
    course = S // 4
    row = y // course
    off = (row % 2) * (S // 4)
    bx = (x + off) % (S // 2)
    by = y % course
    mortar = ((bx < 5) | (by < 5)).astype(float)
    mortar = blur_wrap(mortar, 1.2)
    pits = blur_wrap(speckle(S, 0.0015, seed + 2), 0.7) * 2
    shade = 0.88 + 0.12 * n - 0.16 * mortar - np.clip(pits, 0, 0.12)
    col = colorize(shade, paint)
    # chipped paint revealing grey block
    chip = periodic_noise(S, 10, seed + 3, 3) > 0.86
    col[chip] = col[chip] * 0.7 + np.array([0.46, 0.46, 0.44]) * 0.3
    return to_img(col)


def vct_floor(seed=20):
    """Vinyl composition tile, 4 x 4 tiles of 0.3 m (texture spans 1.2 m)."""
    r = rng(seed)
    tiles = 4
    t = S // tiles
    y, x = np.mgrid[0:S, 0:S]
    tid = (y // t) * tiles + (x // t)
    palette = np.array([[0.62, 0.58, 0.50], [0.55, 0.53, 0.47], [0.66, 0.63, 0.55], [0.48, 0.46, 0.42],
                        [0.58, 0.55, 0.46]])
    choice = palette[r.integers(0, len(palette), tiles * tiles)]
    base = choice[tid]
    chips = periodic_noise(S, 60, seed + 1, 2)
    base = base * (0.9 + 0.2 * chips[..., None])
    flecks = blur_wrap(speckle(S, 0.02, seed + 2), 0.6) * 1.5
    base -= np.clip(flecks, 0, 0.2)[..., None] * 0.6
    seam = ((x % t < 2) | (y % t < 2)).astype(float)
    base *= (1 - 0.35 * blur_wrap(seam, 0.7))[..., None]
    scuff = periodic_noise(S, 5, seed + 3)
    base *= (0.8 + 0.25 * scuff)[..., None]
    # dark heel scuffs
    sc = np.zeros((S, S))
    for _ in range(40):
        cx, cy, ln, ang = r.integers(0, S), r.integers(0, S), r.integers(8, 40), r.random() * math.pi
        for k in range(ln):
            px = int(cx + math.cos(ang) * k) % S; py = int(cy + math.sin(ang) * k) % S
            sc[py, px] = 1
    base *= (1 - 0.5 * np.clip(blur_wrap(sc, 1.0) * 3, 0, 1))[..., None]
    return to_img(base)


def ceiling_tile(seed=30):
    """Suspended ceiling: 2 x 2 tiles of 0.6 m with T-bar grid (texture spans 1.2 m)."""
    y, x = np.mgrid[0:S, 0:S]
    t = S // 2
    n = periodic_noise(S, 80, seed, 2)
    fiss = blur_wrap(speckle(S, 0.02, seed + 1), 0.7) * 1.6
    base = 0.86 + 0.08 * n - np.clip(fiss, 0, 0.16)
    stain = periodic_noise(S, 3, seed + 2, 3)
    base -= np.clip(stain - 0.68, 0, 1) * 0.8
    col = colorize(base, (0.93, 0.92, 0.86))
    stain_col = np.clip(stain - 0.68, 0, 1)[..., None] * np.array([[[0.0, 0.08, 0.2]]])
    col -= stain_col
    bar = ((x % t < 9) | (y % t < 9))
    col[bar] = np.array([0.80, 0.80, 0.78]) * (0.9 + 0.1 * n[bar])[:, None]
    edge = ((x % t == 9) | (y % t == 9) | (x % t == 10) | (y % t == 10))
    col[edge] *= 0.6
    return to_img(col)


def painted_metal(paint=(0.42, 0.47, 0.44), seed=40):
    n = periodic_noise(S, 4, seed)
    fine = periodic_noise(S, 90, seed + 1, 2)
    base = 0.85 + 0.12 * n + 0.05 * fine
    col = colorize(base, paint)
    r = rng(seed + 2)
    scr = np.zeros((S, S))
    for _ in range(70):
        cx, cy, ln, ang = r.integers(0, S), r.integers(0, S), r.integers(10, 70), r.random() * math.pi
        for k in range(ln):
            scr[int(cy + math.sin(ang) * k) % S, int(cx + math.cos(ang) * k) % S] = 1
    scr = np.clip(blur_wrap(scr, 0.5) * 2, 0, 1)
    col = col * (1 - scr[..., None] * 0.5) + scr[..., None] * np.array([0.55, 0.55, 0.53]) * 0.5
    rust = np.clip(periodic_noise(S, 10, seed + 3, 3) - 0.72, 0, 1) * 3
    col = col * (1 - rust[..., None]) + rust[..., None] * np.array([0.36, 0.2, 0.1])
    return to_img(col)


def fabric(color=(0.40, 0.27, 0.18), seed=50):
    """Worn corduroy-ish upholstery, texture spans 0.5 m."""
    y, x = np.mgrid[0:S, 0:S]
    wale = 0.5 + 0.5 * np.cos(2 * math.pi * x / 16)
    n = periodic_noise(S, 8, seed)
    wear = np.clip(periodic_noise(S, 4, seed + 1) - 0.55, 0, 1) * 2
    base = 0.72 + 0.18 * wale + 0.15 * n
    col = colorize(base, color)
    col = col * (1 - wear[..., None] * 0.35) + wear[..., None] * np.array(color) * 1.25 * 0.35
    stain = np.clip(periodic_noise(S, 3, seed + 2) - 0.66, 0, 1) * 2
    col *= (1 - stain[..., None] * 0.5)
    return to_img(col)


def wood(color=(0.55, 0.40, 0.26), seed=60):
    y, x = np.mgrid[0:S, 0:S]
    warp = periodic_noise(S, 3, seed) * 30
    grain = 0.5 + 0.5 * np.sin(2 * math.pi * (y + warp) / 22 + periodic_noise(S, 12, seed + 1) * 3)
    n = periodic_noise(S, 30, seed + 2, 2)
    base = 0.7 + 0.18 * grain + 0.12 * n
    return to_img(colorize(base, color))


def cardboard(seed=70):
    n = periodic_noise(S, 5, seed)
    fine = periodic_noise(S, 100, seed + 1, 1)
    y, x = np.mgrid[0:S, 0:S]
    flute = 0.5 + 0.5 * np.cos(2 * math.pi * y / 12)
    base = 0.8 + 0.1 * n + 0.05 * fine + 0.03 * flute
    col = colorize(base, (0.62, 0.47, 0.30))
    tape = (np.abs(x - S // 2) < 36)
    col[tape] = col[tape] * 0.75 + np.array([0.75, 0.62, 0.42]) * 0.25
    return to_img(col)


def concrete(color=(0.50, 0.50, 0.48), seed=80):
    n = periodic_noise(S, 4, seed) * 0.5 + periodic_noise(S, 30, seed + 1, 3) * 0.5
    pits = blur_wrap(speckle(S, 0.01, seed + 2), 0.7) * 2
    base = 0.8 + 0.25 * (n - 0.5) * 2 - np.clip(pits, 0, 0.3)
    return to_img(colorize(base, color))


# ------------------------------------------------------------------- palette
PALETTE = {}


def palette(seed=90):
    """8 x 8 swatches of flat colours for small props (one draw call for all)."""
    cols = [
        (0.08, 0.08, 0.09), (0.18, 0.18, 0.2), (0.35, 0.35, 0.36), (0.6, 0.6, 0.58), (0.85, 0.84, 0.8),
        (0.95, 0.95, 0.93), (0.72, 0.68, 0.58), (0.5, 0.42, 0.3),  # 0-7 neutrals, beige, brown
        (0.62, 0.1, 0.08), (0.75, 0.2, 0.12), (0.12, 0.25, 0.55), (0.15, 0.4, 0.65), (0.15, 0.4, 0.2),
        (0.85, 0.7, 0.15), (0.9, 0.45, 0.1), (0.45, 0.15, 0.45),  # 8-15 colours
        (0.75, 0.76, 0.78), (0.82, 0.12, 0.12), (0.9, 0.9, 0.95), (0.1, 0.55, 0.25), (0.98, 0.85, 0.55),
        (0.3, 0.32, 0.3), (0.2, 0.13, 0.08), (0.05, 0.06, 0.07),  # 16-23 metal, red can, white, green can, warm, ...
    ]
    names = ['black', 'charcoal', 'grey', 'lightgrey', 'offwhite', 'white', 'beige', 'brown',
             'darkred', 'red', 'navy', 'blue', 'green', 'yellow', 'orange', 'purple',
             'steel', 'canred', 'paper', 'cangreen', 'warm', 'rubber', 'darkwood', 'glass']
    n = 8
    t = S // n
    img = np.zeros((S, S, 3))
    noise = periodic_noise(S, 40, seed, 2)
    for i, c in enumerate(cols):
        gx, gy = i % n, i // n
        img[gy * t:(gy + 1) * t, gx * t:(gx + 1) * t] = np.array(c)
        PALETTE[names[i]] = ((gx + 0.5) / n, (gy + 0.5) / n)  # glTF uv: v=0 is the top row
    img *= (0.92 + 0.12 * noise)[..., None]
    return to_img(img)


# ------------------------------------------------------------------ graffiti
def _font(size, bold=True):
    for p in ['/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def spray_layer(w, h, draw_fn, color, seed, blur=2.0, drips=True):
    """Render strokes to a mask, then make them look sprayed: soft edges,
    overspray speckle and a few drips."""
    r = rng(seed)
    mask = Image.new('L', (w, h), 0)
    draw_fn(ImageDraw.Draw(mask))
    m = np.asarray(mask, float) / 255
    soft = np.asarray(mask.filter(ImageFilter.GaussianBlur(blur)), float) / 255
    halo = np.asarray(mask.filter(ImageFilter.GaussianBlur(blur * 4)), float) / 255
    spray = (r.random((h, w)) < halo * 0.35).astype(float) * 0.8
    a = np.clip(np.maximum(soft * 1.3, spray), 0, 1)
    if drips:
        ys, xs = np.nonzero(m[:-1] > 0.5)
        if len(xs):
            for _ in range(max(2, len(xs) // 4000)):
                k = r.integers(0, len(xs)); x0, y0 = xs[k], ys[k]
                ln = int(r.integers(12, 60)); wd = int(r.integers(1, 3))
                a[y0:min(h, y0 + ln), max(0, x0 - wd):x0 + wd] = np.maximum(
                    a[y0:min(h, y0 + ln), max(0, x0 - wd):x0 + wd], 0.85)
    rgba = np.zeros((h, w, 4))
    rgba[..., :3] = np.asarray(color)
    rgba[..., 3] = a
    return rgba


def composite(layers):
    out = np.zeros_like(layers[0])
    for l in layers:
        a = l[..., 3:4]
        out[..., :3] = out[..., :3] * (1 - a) + l[..., :3] * a
        out[..., 3:4] = out[..., 3:4] + a * (1 - out[..., 3:4])
    return out


def graffiti_atlas(seed=100):
    """1024 x 1024 RGBA atlas of original tags. Returns (image, rects) where
    rects maps a tag name to its (u0, v0, u1, v1) in glTF uv space."""
    W = H = 1024
    atlas = np.zeros((H, W, 4))
    rects = {}

    def place(name, x, y, w, h, layers):
        atlas[y:y + h, x:x + w] = composite(layers)
        rects[name] = (x / W, (y + h) / H, (x + w) / W, y / H)  # (u0, v_bottom, u1, v_top) in glTF uv

    # 1. "111k" bubble-ish tag, outline + fill
    w, h = 512, 256
    def t111(d, grow=0):
        f = _font(170)
        d.text((40, 20), '111k', font=f, fill=255, stroke_width=grow, stroke_fill=255)
    outline = spray_layer(w, h, lambda d: t111(d, 12), (0.08, 0.08, 0.1), seed, blur=2.5)
    fill = spray_layer(w, h, lambda d: t111(d, 0), (0.95, 0.35, 0.65), seed + 1, blur=1.5, drips=False)
    place('111k', 0, 0, w, h, [outline, fill])

    # 2. smiley with x eyes
    w, h = 256, 256
    def smile(d):
        d.ellipse((28, 28, 228, 228), outline=255, width=14)
        for cx in (95, 160):
            d.line((cx - 18, 85, cx + 18, 121), fill=255, width=12); d.line((cx + 18, 85, cx - 18, 121), fill=255, width=12)
        d.arc((70, 110, 186, 196), 15, 165, fill=255, width=14)
    place('smiley', 512, 0, w, h, [spray_layer(w, h, smile, (0.95, 0.85, 0.15), seed + 2)])

    # 3. "SSC 93" stencil-ish
    w, h = 512, 192
    def ssc(d):
        d.text((20, 10), 'SSC 93', font=_font(130), fill=255)
    place('ssc', 0, 256, w, h, [spray_layer(w, h, ssc, (0.85, 0.12, 0.1), seed + 3, blur=1.2)])

    # 4. arrow
    w, h = 256, 128
    def arrow(d):
        d.line((20, 64, 190, 64), fill=255, width=18)
        d.polygon([(180, 20), (240, 64), (180, 108)], fill=255)
    place('arrow', 768, 0, w, h, [spray_layer(w, h, arrow, (0.2, 0.85, 0.9), seed + 4)])

    # 5. scrawled words in marker
    w, h = 512, 192
    def words(d):
        d.text((10, 10), 'who was here', font=_font(56), fill=255)
        d.text((60, 90), 'ok :)', font=_font(70), fill=255)
    place('scrawl', 512, 256, w, h, [spray_layer(w, h, words, (0.05, 0.05, 0.06), seed + 5, blur=0.8, drips=False)])

    # 6. crown doodle
    w, h = 256, 256
    def crown(d):
        d.line([(40, 190), (40, 80), (88, 140), (128, 60), (168, 140), (216, 80), (216, 190), (40, 190)], fill=255, width=12, joint='curve')
        for cx, cy in ((40, 80), (128, 60), (216, 80)):
            d.ellipse((cx - 12, cy - 12, cx + 12, cy + 12), fill=255)
    place('star', 768, 448, w, h, [spray_layer(w, h, crown, (0.6, 0.35, 0.95), seed + 6)])

    # 7. big throwie letters
    w, h = 768, 320
    def throw(d, grow=0):
        d.text((20, 0), 'LOOP', font=_font(250), fill=255, stroke_width=grow, stroke_fill=255)
    place('loop', 0, 448, w, h, [spray_layer(w, h, lambda d: throw(d, 14), (0.95, 0.95, 0.92), seed + 7, blur=2.5),
                                 spray_layer(w, h, lambda d: throw(d, 0), (0.15, 0.55, 0.95), seed + 8, blur=1.5, drips=False)])

    img = Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    return img, rects
