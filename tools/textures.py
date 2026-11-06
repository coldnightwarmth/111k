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


def painted_metal(paint=(0.42, 0.47, 0.44), seed=40, size=1024):
    """Old enamel on steel, one tile covering 2 m: broad uneven fading, wear clustered in a few
    places rather than sprinkled evenly, chips down to grey primer, rust that blooms out of the
    chips and runs downward, a handful of scuffs. Built to not read as a repeating pattern."""
    Sz = size
    r = rng(seed + 2)
    broad = periodic_noise(Sz, 2, seed, 3)                 # fading across the whole tile
    mid = periodic_noise(Sz, 9, seed + 1, 3)
    fine = periodic_noise(Sz, 120, seed + 5, 2)
    base = 0.78 + 0.2 * broad + 0.06 * mid + 0.035 * fine
    col = colorize(base, paint)
    # where wear happens at all: a few large regions, so most of the paint stays clean
    zone = np.clip((periodic_noise(Sz, 3, seed + 7, 2) - 0.6) * 5, 0, 1)
    detail = periodic_noise(Sz, 22, seed + 3, 3)
    chips = np.clip((detail + zone * 0.42 - 0.99) * 9, 0, 1)
    # water stains and handling marks: soft darker blotches, no hard spots
    stain = np.clip((periodic_noise(Sz, 5, seed + 9, 3) - 0.55) * 3, 0, 1)
    col *= 1 - 0.09 * stain[..., None]
    primer = np.array([0.52, 0.52, 0.5])
    col = col * (1 - chips[..., None]) + chips[..., None] * primer * (0.9 + 0.2 * fine[..., None])
    # rust grows inside the larger chips and bleeds downward in streaks
    core = np.clip((detail + zone * 0.42 - 1.05) * 12, 0, 1)
    rust = np.clip(blur_wrap(core, 2.5) * 2.2, 0, 1)
    streak = np.zeros((Sz, Sz))
    ys, xs = np.nonzero(core > 0.6)
    pick = r.choice(len(ys), size=min(len(ys), 90), replace=False) if len(ys) else []
    for i in pick:
        x, y0 = xs[i], ys[i]
        length = int(r.integers(Sz // 30, Sz // 6))
        wid = int(r.integers(1, 4))
        for k_ in range(length):
            yy = (y0 + k_) % Sz        # downward in the image = down the surface
            fade = (1 - k_ / length) ** 1.5
            for dx in range(-wid, wid + 1):
                streak[yy, (x + dx + int(math.sin(k_ * 0.05) * 2)) % Sz] = max(streak[yy, (x + dx) % Sz], fade * (1 - abs(dx) / (wid + 1)))
    streak = blur_wrap(streak, 1.2)
    rust = np.clip(rust + streak * 0.55, 0, 1)
    rust_col = np.array([0.3, 0.18, 0.1]) * (0.75 + 0.4 * mid[..., None])
    col = col * (1 - rust[..., None] * 0.75) + rust[..., None] * 0.75 * rust_col
    # a few long scuffs and a lot of fine ones, mostly in the worn zones
    scr = np.zeros((Sz, Sz))
    for _ in range(26):
        cx, cy, ln, ang = r.integers(0, Sz), r.integers(0, Sz), r.integers(20, 160), r.normal(0, .5)
        for k_ in range(ln):
            scr[int(cy + math.sin(ang) * k_) % Sz, int(cx + math.cos(ang) * k_) % Sz] = 1
    scr = np.clip(blur_wrap(scr, 0.6) * 2, 0, 1) * (0.35 + 0.65 * zone)
    col = col * (1 - scr[..., None] * 0.35) + scr[..., None] * np.array([0.6, 0.6, 0.58]) * 0.35
    # grime collects low down
    yv = np.linspace(0, 1, Sz)[:, None, None]
    col *= 1 - 0.1 * np.clip(yv - 0.6, 0, 1) * 2.5 * (0.6 + 0.4 * broad[..., None])
    return to_img(col)


def mirror(seed=45):
    """Old silvered washroom mirror, 1 m tile repeating across: a cool grey wash with
    soft blurry reflections, smears, and black desilvering creeping in from the edges."""
    y, x = np.mgrid[0:S, 0:S] / S
    n = periodic_noise(S, 3, seed)
    base = 0.5 + 0.18 * (1 - y) + 0.12 * (n - 0.5)
    # soft vertical reflections of the tiled wall opposite
    refl = 0.5 + 0.5 * np.cos(2 * math.pi * x * 4 + 3 * (n - 0.5))
    base += 0.06 * blur_wrap(refl, 6)
    smear = np.clip(periodic_noise(S, 6, seed + 1, 3) - 0.55, 0, 1) * 1.6
    base = base * (1 - 0.25 * smear) + 0.25 * smear * 0.75
    col = colorize(base, (0.78, 0.85, 0.88))
    edge = np.minimum(y, 1 - y)
    rot = periodic_noise(S, 12, seed + 2, 4)
    desilver = np.clip((0.1 - edge) * 14 + (rot - 0.55) * 2.5, 0, 1)
    spots = np.clip(blur_wrap(speckle(S, 0.00006, seed + 3), 5) * 90 - 0.5, 0, 1)
    dark = np.clip(desilver + spots, 0, 1)
    col = col * (1 - dark[..., None] * 0.85) + dark[..., None] * np.array([0.08, 0.07, 0.06])
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


def tunnel_lining(seed=110):
    """Cast concrete tunnel lining. Texture spans 1.5 m around x 1.5 m along:
    a pour joint every 1.5 m along the tunnel, form-tie holes, lime streaks."""
    y, x = np.mgrid[0:S, 0:S]
    n = periodic_noise(S, 3, seed) * 0.5 + periodic_noise(S, 24, seed + 1, 3) * 0.5
    fine = periodic_noise(S, 120, seed + 2, 1)
    base = 0.78 + 0.22 * (n - 0.5) * 2 + 0.05 * (fine - 0.5)
    joint = blur_wrap(((x < 3) | (x > S - 3)).astype(float), 1.0)          # cold joint between pours
    base -= 0.28 * joint
    form = blur_wrap((np.abs(y % (S // 3) - 2) < 1).astype(float), 1.5)   # faint formwork board lines
    base -= 0.05 * form
    for cx, cy in [(S // 4, S // 6), (3 * S // 4, S // 6 + S // 3), (S // 4, S // 6 + 2 * S // 3)]:
        tie = ((x - cx) ** 2 + (y - cy) ** 2) < 36
        base[tie] -= 0.25
    pits = blur_wrap(speckle(S, 0.006, seed + 3), 0.6) * 2
    base -= np.clip(pits, 0, 0.25)
    col = colorize(base, (0.56, 0.55, 0.52))
    # efflorescence: chalky streaks running down from the joint
    lime = blur_wrap((x < 10).astype(float) * (periodic_noise(S, 6, seed + 4) > 0.55), 3.0)
    col = col * (1 - 0.35 * lime[..., None]) + 0.35 * lime[..., None] * np.array([0.82, 0.82, 0.78])
    return to_img(col)


def tunnel_floor(seed=120):
    """Concrete invert slab, texture spans 2 m: saw-cut joints, tyre wear, oil."""
    y, x = np.mgrid[0:S, 0:S]
    n = periodic_noise(S, 4, seed) * 0.6 + periodic_noise(S, 40, seed + 1, 2) * 0.4
    base = 0.74 + 0.25 * (n - 0.5) * 2
    cut = blur_wrap(((y % (S // 2)) < 2).astype(float), 0.8)
    base -= 0.3 * cut
    pits = blur_wrap(speckle(S, 0.012, seed + 2), 0.7) * 2
    base -= np.clip(pits, 0, 0.2)
    oil = np.clip(periodic_noise(S, 3, seed + 3) - 0.62, 0, 1) * 2.5
    base *= 1 - 0.45 * oil
    col = colorize(base, (0.5, 0.49, 0.46))
    return to_img(col)


def safety_paint(seed=130):
    """Worn yellow floor-edge paint (texture spans 1 m)."""
    n = periodic_noise(S, 8, seed)
    wear = periodic_noise(S, 30, seed + 1, 2)
    col = colorize(0.8 + 0.2 * n, (0.85, 0.68, 0.12))
    gone = wear < 0.42
    col[gone] = colorize(0.75 + 0.2 * n, (0.5, 0.49, 0.46))[gone]
    return to_img(col)


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
        (0.9, 0.9, 0.87), (0.55, 0.54, 0.5), (0.9, 0.45, 0.6), (0.2, 0.5, 0.5), (0.5, 0.8, 0.2),
        (0.04, 0.09, 0.05), (0.2, 1.0, 0.35), (1.0, 0.15, 0.1),     # 24-31 porcelain, concrete, pink, teal, lime, screen, leds
        (1.0, 0.65, 0.1), (0.3, 0.55, 1.0), (0.55, 0.5, 0.35), (0.25, 0.32, 0.5), (0.45, 0.22, 0.1),
        (0.6, 0.8, 0.7), (0.75, 0.6, 0.42), (0.35, 0.18, 0.06),    # 32-39
        (0.1, 0.3, 0.12), (0.35, 0.38, 0.2), (0.62, 0.55, 0.45), (0.4, 0.4, 0.43),                     # 40-43
    ]
    names = ['black', 'charcoal', 'grey', 'lightgrey', 'offwhite', 'white', 'beige', 'brown',
             'darkred', 'red', 'navy', 'blue', 'green', 'yellow', 'orange', 'purple',
             'steel', 'canred', 'paper', 'cangreen', 'warm', 'rubber', 'darkwood', 'glass',
             'porcelain', 'concrete', 'pink', 'teal', 'lime', 'screen', 'ledgreen', 'ledred',
             'ledamber', 'ledblue', 'khaki', 'denim', 'rust', 'mint', 'tan', 'bottlebrown',
             'bottlegreen', 'olive', 'dirty', 'slate']
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


def bathroom_tile(color=(0.86, 0.9, 0.86), seed=140):
    """15 cm glazed wall tile with grime in the grout (texture spans 0.6 m)."""
    y, x = np.mgrid[0:S, 0:S]
    t = S // 4
    grout = ((x % t) < 4) | ((y % t) < 4)
    n = periodic_noise(S, 6, seed) * 0.5 + periodic_noise(S, 30, seed + 1, 2) * 0.5
    base = 0.9 + 0.08 * (n - 0.5)
    # each tile slightly different, a few cracked or stained
    r = rng(seed)
    tint = r.uniform(0.94, 1.04, (4, 4))
    base = base * tint[(y // t) % 4, (x // t) % 4]
    stain = blur_wrap((periodic_noise(S, 3, seed + 2) > 0.7).astype(float), 10) * 0.09
    col = colorize(base - stain, color)
    col[grout] = colorize(0.55 + 0.1 * n, (0.55, 0.53, 0.48))[grout]
    crack = np.zeros((S, S), bool)
    cx, cy = int(r.integers(0, S)), int(r.integers(0, S))
    for i in range(160):
        cx = (cx + int(r.integers(-1, 3))) % S; cy = (cy + int(r.integers(-2, 3))) % S
        crack[cy, cx] = True
    col[blur_wrap(crack.astype(float), 0.7) > 0.12] *= 0.45
    return to_img(col)


def mosaic_floor(seed=150):
    """Small square mosaic, mostly white with a pattern border, dirty (spans 0.6 m)."""
    y, x = np.mgrid[0:S, 0:S]
    t = S // 24
    grout = ((x % t) < 2) | ((y % t) < 2)
    r = rng(seed)
    cell = r.uniform(0.86, 1.0, (24, 24))
    dark = r.random((24, 24)) < 0.06
    base = cell[(y // t) % 24, (x // t) % 24]
    col = colorize(base, (0.88, 0.88, 0.84))
    col[dark[(y // t) % 24, (x // t) % 24]] = np.array([0.18, 0.3, 0.32])
    dirt = periodic_noise(S, 4, seed + 1)
    col *= (0.8 + 0.25 * dirt)[..., None]
    col[grout] = colorize(0.45 + 0.1 * dirt, (0.5, 0.48, 0.42))[grout]
    return to_img(col)


def console_panel(seed=160):
    """Grey control-console panel: rows of switches, knobs, meters, labels (not tileable)."""
    from PIL import Image, ImageDraw
    r = rng(seed)
    im = Image.new('RGB', (S, S), (70, 74, 76))
    d = ImageDraw.Draw(im)
    for k in range(6):  # panel sections
        y0 = k * S // 6
        d.rectangle((6, y0 + 4, S - 6, y0 + S // 6 - 4), outline=(40, 42, 44), width=2)
        style = r.integers(3)
        for i in range(10):
            x = 22 + i * (S - 44) // 10
            if style == 0:   # toggle switches with labels
                d.rectangle((x, y0 + 26, x + 12, y0 + 46), fill=(30, 30, 32))
                up = r.random() < .5
                d.rectangle((x + 3, y0 + (18 if up else 40), x + 9, y0 + (30 if up else 52)), fill=(190, 190, 185))
                d.rectangle((x - 2, y0 + 58, x + 16, y0 + 64), fill=(220, 220, 210))
            elif style == 1:  # knobs
                d.ellipse((x - 2, y0 + 20, x + 22, y0 + 44), fill=(28, 28, 30), outline=(120, 120, 120))
                a = r.uniform(0, 6.28)
                d.line((x + 10, y0 + 32, x + 10 + 10 * np.cos(a), y0 + 32 + 10 * np.sin(a)), fill=(230, 230, 230), width=2)
                d.rectangle((x, y0 + 52, x + 20, y0 + 58), fill=(210, 210, 200))
            else:             # analog meters
                if i % 2:
                    continue
                d.rectangle((x, y0 + 14, x + 40, y0 + 64), fill=(225, 220, 200), outline=(20, 20, 20))
                a = r.uniform(-1.0, 1.0)
                d.line((x + 20, y0 + 60, x + 20 + 22 * np.sin(a), y0 + 60 - 22 * np.cos(a)), fill=(150, 20, 20), width=2)
    arr = np.asarray(im, float) / 255
    arr *= (0.85 + 0.25 * periodic_noise(S, 8, seed + 1))[..., None]
    return to_img(arr)


def screen(kind, seed=170):
    """Glowing CRT screen content: 'term' (green text), 'amber' (graphs), 'blue' (ring status)."""
    from PIL import Image, ImageDraw
    r = rng(seed)
    W_, H_ = 256, 192
    bg = {'term': (4, 18, 8), 'amber': (24, 12, 2), 'blue': (4, 10, 30)}[kind]
    fg = {'term': (90, 255, 120), 'amber': (255, 170, 40), 'blue': (110, 190, 255)}[kind]
    im = Image.new('RGB', (W_, H_), bg)
    d = ImageDraw.Draw(im)
    f = _font(13, bold=False)
    if kind == 'term':
        lines = ['SSC RING CTRL  V2.3', '> STATUS SECTOR N15', 'MAG STRING ....... OFF', 'CRYO LOOP ........ OFF',
                 'VAC PUMP 7 ....... ERR', 'LAST SYNC 10/21/93', '> HELLO?', '> WHO IS IN THE LOOP', '_']
        for i, t in enumerate(lines):
            d.text((10, 8 + i * 19), t, font=f, fill=fg)
    elif kind == 'amber':
        for k in range(3):
            pts = [(10 + i * 4, 40 + k * 55 + 18 * np.sin(i * 0.2 + k) * r.uniform(0.5, 1)) for i in range(60)]
            d.line(pts, fill=fg, width=2)
            d.text((12, 8 + k * 55), f'CH{k + 1}  {r.integers(100, 999)} mV', font=f, fill=fg)
    else:
        cx, cy, rad = W_ // 2, H_ // 2 + 6, 70
        d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), outline=fg, width=3)
        for i in range(20):
            a = 2 * np.pi * i / 20
            px, py = cx + rad * np.cos(a), cy - rad * np.sin(a)
            c = (255, 80, 60) if i in (10, 11) else fg
            d.rectangle((px - 3, py - 3, px + 3, py + 3), fill=c)
        d.text((8, 6), 'RING  N15  20 BAYS', font=f, fill=fg)
    arr = np.asarray(im, float) / 255
    y = np.arange(H_)[:, None, None]
    arr *= 0.75 + 0.25 * (y % 3 != 0)   # scanlines
    return to_img(arr)


def rack_front(seed=180):
    """Equipment rack: units with vents, handles and screws (spans the rack face)."""
    from PIL import Image, ImageDraw
    r = rng(seed)
    im = Image.new('RGB', (S, S), (38, 40, 44))
    d = ImageDraw.Draw(im)
    y = 8
    while y < S - 30:
        h = int(r.choice([24, 48, 72]))
        d.rectangle((10, y, S - 10, y + h - 3), fill=(58, 60, 64), outline=(20, 20, 22))
        for vx in range(60, S - 60, 10):
            d.line((vx, y + 6, vx, y + h - 9), fill=(28, 28, 30), width=3)
        d.rectangle((16, y + 6, 26, y + h - 9), fill=(150, 150, 150))
        d.rectangle((S - 26, y + 6, S - 16, y + h - 9), fill=(150, 150, 150))
        y += h
    arr = np.asarray(im, float) / 255
    arr *= (0.85 + 0.25 * periodic_noise(S, 10, seed + 1))[..., None]
    return to_img(arr)


def mimic_board(seed=190):
    """Wall-sized ring schematic: the loop, its 20 bays, service lines (not tileable)."""
    from PIL import Image, ImageDraw
    W_, H_ = 1024, 512
    im = Image.new('RGB', (W_, H_), (34, 46, 44))
    d = ImageDraw.Draw(im)
    f, fb = _font(18), _font(28)
    d.text((24, 16), 'SUPERCONDUCTING SUPER COLLIDER  -  N15 SERVICE RING', font=fb, fill=(220, 225, 210))
    cx, cy, rad = W_ // 2, H_ // 2 + 22, 150
    d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), outline=(230, 230, 220), width=10)
    d.ellipse((cx - rad + 26, cy - rad + 26, cx + rad - 26, cy + rad - 26), outline=(120, 140, 130), width=3)
    for i in range(20):
        a = 2 * np.pi * i / 20
        px, py = cx + (rad + 30) * np.cos(a), cy - (rad + 30) * np.sin(a)
        d.rectangle((px - 14, py - 9, px + 14, py + 9), outline=(230, 230, 220), width=2)
        tx, ty = cx + (rad + 64) * np.cos(a), cy - (rad + 64) * np.sin(a)
        d.text((tx - 20, ty - 9), f'B-{i + 1:02d}', font=f, fill=(200, 205, 190))
    for k, (label, col) in enumerate([('POWER', (220, 60, 50)), ('CRYO', (80, 170, 220)), ('VACUUM', (220, 190, 70))]):
        d.rectangle((40, 420 + k * 28, 70, 438 + k * 28), fill=col)
        d.text((80, 418 + k * 28), label, font=f, fill=(210, 210, 200))
    arr = np.asarray(im, float) / 255
    arr *= (0.85 + 0.2 * np.asarray(Image.fromarray((periodic_noise(S, 6, seed) * 255).astype(np.uint8)).resize((W_, H_)), float)[..., None] / 255)
    return to_img(arr)


