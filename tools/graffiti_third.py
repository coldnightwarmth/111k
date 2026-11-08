"""A third batch of graffiti for the spray cans, in families the first two batches don't have: the things
that end up on a city wall besides spray tags (stickers, wheatpaste posters, ransom-note cut-ups, tile
mosaics, chalk, doctored signs) and the painted styles that imitate other media (blockbusters, neon,
glitch, pop-art halftone, LED tickers, comic balloons, candlestick charts, folded ribbon letters).

  blockbuster  bb  huge square block letters, rollered fill split in two colours, hard outline, drips
  slap         sl  stickers: a "hello my name is" badge, a plain shipping label, a die-cut vinyl word
  poster       ps  a wheatpasted print: torn paper, wrinkles, glue sheen, heavy type
  ransom       rn  every letter cut from a different magazine and stuck down crooked
  mosaic       mo  square glazed tiles cemented to the wall, letters a few tiles high
  ticker       tk  an LED dot-matrix panel, lit dots glowing
  neon         ne  painted neon tubing: a hot core and a soft glow
  glitch       gl  type sliced into shifted bands with a cyan/magenta split and blocky artefacts
  halftone     ht  pop-art letters: fat outline, drop shadow, Ben-Day dots, sometimes a burst
  chalk        ch  chalk handwriting: grainy, dusty, uneven pressure, pastel
  speech       sb  a sprayed comic balloon (round, or a jagged shout) with hand-lettered caps
  sign         sg  doctored signs: a speed sign, a round seal, a company plaque
  chart        cx  a candlestick chart with a sprayed arrow, mostly going up
  ribbon       rb  flat ribbon letters that show their dark side wherever they fold over

Run directly for a contact sheet: python3 tools/graffiti_third.py [out_prefix] [name-filter]
"""
import math
import os
import zlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

import graffiti as G
import graffiti_more as M
from graffiti_more import (BLACK, WHITE, SILVER, CHARCOAL, BLOOD, OXBLOOD, BONE, HOTPINK, BUBBLEGUM, LILAC, GRAPE, SKY,
                           COBALT, NAVY, TEAL, LIME, TOXIC, FOREST, MINT, YELLOW, GOLD, ORANGE, TANGERINE, RED, CREAM,
                           BROWN, MAUVE, paint_mask, spray_paths, stack, trim, paste, add_drips)

PX = G.PX_PER_M
AMBER, CYAN, MAGENTA, PAPER, NEWSPRINT = (1.0, 0.62, 0.12), (0.1, 0.9, 0.95), (0.95, 0.15, 0.75), (0.95, 0.93, 0.86), (0.86, 0.84, 0.76)

FONTS = {
    'black': ['/usr/share/fonts/opentype/inter/InterDisplay-Black.otf', '/usr/share/fonts/opentype/inter/Inter-Black.otf'],
    'bold': ['/usr/share/fonts/opentype/inter/Inter-Bold.otf'],
    'medium': ['/usr/share/fonts/opentype/inter/Inter-Medium.otf'],
    'cond': ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'],
    'mono': ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'],
    'serif': ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'],
    'libserif': ['/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf'],
    'italic': ['/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf'],
    'caladea': ['/usr/share/fonts/truetype/crosextra/Caladea-BoldItalic.ttf'],
    'carlito': ['/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf'],
    'sans': ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
    'lmdemi': ['/usr/share/texmf/fonts/opentype/public/lm/lmromandemi10-regular.otf'],
}
FALLBACK = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
_fonts = {}


def font(kind, size):
    size = max(6, int(size))
    key = (kind, size)
    if key not in _fonts:
        path = next((p for p in FONTS.get(kind, []) if os.path.exists(p)), FALLBACK)
        _fonts[key] = ImageFont.truetype(path, size)
    return _fonts[key]


def cap_size(kind, cap_px):
    """the font size whose capitals are cap_px tall"""
    f = font(kind, 200)
    b = f.getbbox('H', anchor='ls')
    return cap_px * 200 / max(1, -b[1])


def mix(a, b, t):
    return tuple(float(x) * (1 - t) + float(y) * t for x, y in zip(a, b))


def dilate(mask, px):
    if px <= 0:
        return mask.copy()
    k = int(math.ceil(px))
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    return ndimage.binary_dilation(mask, structure=(xx * xx + yy * yy) <= px * px)


def erode(mask, px):
    return ~dilate(~mask, px)


def shift(mask, dx, dy):
    out = np.zeros_like(mask)
    h, w = mask.shape
    dx, dy = int(round(dx)), int(round(dy))
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = mask[ys, xs]
    return out


def noise(h, w, r, sigma):
    n = ndimage.gaussian_filter(r.normal(0, 1, (h, w)), sigma)
    return (n - n.mean()) / (n.std() + 1e-9)


def rough(mask, r, amount=1.2, sigma=1.5):
    """hand-cut / hand-painted edges: the outline wanders a pixel or so"""
    d = ndimage.distance_transform_edt(mask) - ndimage.distance_transform_edt(~mask)
    return (d + noise(*mask.shape, r, sigma) * amount) > 0


# Spray mode (after review: "make them feel more like spray paint"): every fill goes on the way a can puts it on,
# soft-edged with overspray and uneven coverage, and the things that gave the print/glass/paper look (paper
# texture, glaze, gloss, shadows) give way to sprayed versions. Set per piece by build_third.
SPRAY = False
_R = np.random.default_rng(0)


def coverage(shape, r, amount=0.12):
    """uneven coverage: where the can went over once rather than twice"""
    return np.clip(1 - amount * np.clip(noise(*shape, r, 9), 0, 3), 0, 1)


def flat(cv, mask, color, alpha=1.0):
    if SPRAY and np.any(mask):
        m = mask.astype(bool)
        small = m.sum() < 400              # (fine detail: not blurred away)
        paint_mask(cv, m, color, _R, soft=0.7 if small else 1.0, mist=0.6 if small else 1.3, streak=0.0 if small else 0.25,
                   opacity=alpha)
        return
    cv.over(color, mask.astype(float) * alpha)


def light_drips(cv, color, r, mask=None, rate=0.18, length=0.1):
    """a few short runs, no more"""
    if SPRAY and not G.NODRIPS:
        return add_drips(cv, color, r, rate=rate, max_len_m=length, width_px=2.4, from_mask=mask)
    return cv


def pad_canvas(mask, pad):
    return np.pad(mask, pad)


# ------------------------------------------------------------------ type -> masks

def char_mask(ch, kind, cap_px, rot=0.0, shear=0.0, sx=1.0):
    """one character as a mask, its baseline at y = base (returned), advance in px"""
    f = font(kind, cap_size(kind, cap_px))
    asc = int(cap_px * 1.6) + 4
    w = int(f.getlength(ch) + cap_px * 1.2) + 8
    im = Image.new('L', (w, int(cap_px * 2.4) + 8), 0)
    ImageDraw.Draw(im).text((4 + cap_px * 0.4, asc), ch, font=f, fill=255, anchor='ls')
    if shear or sx != 1.0:                 # lean (tops to the right) and squeeze: out_x = sx*x + shear*(H - y)
        H = im.height
        im = im.transform((int(w * sx + abs(shear) * H) + 2, H), Image.AFFINE,
                          (1 / sx, shear / sx, -shear * H / sx, 0, 1, 0), resample=Image.BILINEAR)
    if rot:
        im = im.rotate(math.degrees(rot), resample=Image.BILINEAR, center=(4 + cap_px * 0.4, asc))
    return np.asarray(im) > 110, asc, f.getlength(ch) * sx


def type_masks(lines, kind, cap_px, r, tracking=0.0, line_gap=1.3, align='center', jitter_rot=0.0, jitter_y=0.0,
               shear=0.0, sx=1.0, per_letter=True):
    """Lines of text set in a font -> (list of letter masks on one canvas, canvas (w, h)).
    tracking/line_gap in cap heights; jitter gives a hand-set wobble."""
    placed = []           # (mask, x, y) with y the top-left of the char image
    rows = []
    for li, line in enumerate(lines):
        x, row = 0.0, []
        for ch in line:
            if ch == ' ':
                x += font(kind, cap_size(kind, cap_px)).getlength(' ') * sx + tracking * cap_px
                continue
            m, asc, adv = char_mask(ch, kind, cap_px, r.normal(0, jitter_rot) if jitter_rot else 0.0, shear, sx)
            dy = r.normal(0, jitter_y) * cap_px if jitter_y else 0.0
            row.append([m, x - cap_px * 0.4 - 4, li * cap_px * line_gap - asc + dy])
            x += adv + tracking * cap_px
        rows.append((row, x))
    width = max(w for _, w in rows) if rows else 0
    for row, w in rows:
        off = {'center': (width - w) / 2, 'left': 0.0, 'right': width - w}[align]
        for p in row:
            p[1] += off
            placed.append(p)
    if not placed:
        return [], (1, 1)
    x0 = min(p[1] for p in placed); y0 = min(p[2] for p in placed)
    x1 = max(p[1] + p[0].shape[1] for p in placed); y1 = max(p[2] + p[0].shape[0] for p in placed)
    W, H = int(x1 - x0) + 2, int(y1 - y0) + 2
    out = []
    for m, x, y in placed:
        full = np.zeros((H, W), bool)
        xi, yi = int(round(x - x0)), int(round(y - y0))
        full[yi:yi + m.shape[0], xi:xi + m.shape[1]] |= m[:H - yi, :W - xi]
        out.append(full)
    if not per_letter:
        return [np.any(out, 0)], (W, H)
    return out, (W, H)


def crop_masks(masks, pad):
    """crop a set of same-size masks to their joint bounds, plus pad all round"""
    u = np.any(masks, 0)
    ys, xs = np.nonzero(u)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return [np.pad(m[y0:y1, x0:x1], pad) for m in masks]


def grid_text(lines, rows, r, kind='black', line_gap=1, tracking=0.12, thresh=0.42):
    """Text rasterised to a coarse grid (for tiles and LEDs): bool[rows_total, cols], `rows` cells per line."""
    cell = 12
    grids = []
    for line in lines:
        f = font(kind, cap_size(kind, rows * cell * 0.98))
        x, chars = 0.0, []
        for ch in line:
            chars.append((ch, x))
            x += f.getlength(ch) + tracking * rows * cell
        W = int(x) + cell * 2
        im = Image.new('L', (W, rows * cell + cell * 2), 0)
        d = ImageDraw.Draw(im)
        for ch, cx in chars:
            d.text((cell + cx, cell + rows * cell), ch, font=f, fill=255, anchor='ls')
        a = np.asarray(im, float) / 255
        cols = W // cell
        g = a[:(rows + 2) * cell, :cols * cell].reshape(rows + 2, cell, cols, cell).mean((1, 3)) > thresh
        ys, xs = np.nonzero(g)
        g = g[:, xs.min():xs.max() + 1] if len(xs) else g
        grids.append(g[1:rows + 1 + (1 if g[rows + 1].any() else 0)])
    width = max(g.shape[1] for g in grids)
    out = []
    for i, g in enumerate(grids):
        left = (width - g.shape[1]) // 2
        out.append(np.pad(g, ((0, 0), (left, width - g.shape[1] - left))))
        if i < len(grids) - 1:
            out.append(np.zeros((line_gap, width), bool))
    return np.vstack(out)


# a 5x7 pixel font for the tiles and the LED panel (fonts squeezed down to 7 cells come out ragged)
PIX5 = {
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
    ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
    ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
    '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
    '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
    '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    ' ': ['000', '000', '000', '000', '000', '000', '000'],
}


def pixel_text(lines, line_gap=2):
    """lines in the 5x7 font -> bool grid (one blank column between letters)"""
    rows = []
    for line in lines:
        cols = []
        for ch in line.upper():
            g = PIX5.get(ch)
            if g is None:
                continue
            cols.append(np.array([[c == '1' for c in row] for row in g]))
            cols.append(np.zeros((7, 1), bool))
        rows.append(np.hstack(cols[:-1]) if cols else np.zeros((7, 1), bool))
    width = max(r_.shape[1] for r_ in rows)
    out = []
    for i, g in enumerate(rows):
        left = (width - g.shape[1]) // 2
        out.append(np.pad(g, ((0, 0), (left, width - g.shape[1] - left))))
        if i < len(rows) - 1:
            out.append(np.zeros((line_gap, width), bool))
    return np.vstack(out)


def stroke_mask(paths, shape, width_px):
    """pixel paths drawn as round-capped lines"""
    im = Image.new('L', (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(im)
    for p in paths:
        pts = [tuple(map(float, q)) for q in p]
        if len(pts) > 1:
            d.line(pts, fill=255, width=max(1, int(round(width_px))), joint='curve')
        rad = width_px / 2
        for x, y in (pts[0], pts[-1]):
            d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=255)
    return np.asarray(im) > 127


def hand_strokes(lines, r, height_px, pad, slant=0.15, spacing=0.14, bounce=0.06, smooth=2, line_gap=1.7, upper=False,
                 indent=0.0):
    """Handwritten lines (the skeleton glyphs) -> pixel paths and a canvas size"""
    allst = []
    for i, line in enumerate(lines):
        st = G.layout(line.upper() if upper else line, r, slant=slant, bounce=bounce, spacing=spacing, jitter=0.03,
                      scale_var=0.07, smooth=smooth)
        for s in st:
            s[:, 1] -= i * line_gap
            s[:, 0] += indent * i
        allst += st
    lo, hi = G.bounds(allst)
    W = int((hi[0] - lo[0]) * height_px + 2 * pad)
    H = int((hi[1] - lo[1]) * height_px + 2 * pad)
    origin = (pad - lo[0] * height_px, pad + hi[1] * height_px)
    return G.to_px(allst, height_px, origin), (W, H)


# ------------------------------------------------------------------ the styles

def blockbuster(text, fill, outline, r, height_m=0.5, fill2=None, shadow=None, cut=None, kind='black', drips=0.6, streak=0.85):
    """Huge square letters jammed together, rollered fill (split into two colours along a ruled line),
    a hard outline round each letter and a block shadow."""
    cap = height_m * PX
    lines = text.split('\n')
    masks, _ = type_masks(lines, kind, cap, r, tracking=-0.05, line_gap=1.12, jitter_rot=0.025, jitter_y=0.02, sx=0.86)
    ow = max(3, cap * 0.07)
    masks = crop_masks(masks, int(ow * 2 + cap * 0.18 + 6))
    masks = [rough(m, r, 0.8) for m in masks]
    H, W = masks[0].shape
    cv = G.Canvas(W, H + PX * 0.3)
    full = lambda m: np.pad(m, ((0, cv.h - H), (0, 0)))
    union = np.any(masks, 0)
    outer = dilate(union, ow)
    if shadow is not None:
        sh = shift(outer, cap * 0.09, cap * 0.07) & ~outer
        paint_mask(cv, full(sh | shift(outer, cap * 0.05, cap * 0.04)), shadow, r, soft=0.9, mist=0.6, streak=0.3)
    paint_mask(cv, full(outer), outline, r, soft=0.9, mist=0.9, streak=0.2)
    if drips and not G.NODRIPS:
        add_drips(cv, outline, r, rate=drips, max_len_m=0.25, width_px=3, from_mask=full(outer))
    ys = np.arange(H)[:, None]
    split = H * 0.5 + (np.arange(W)[None, :] - W / 2) * r.uniform(-0.06, 0.06)
    for i, m in enumerate(masks):          # each letter's fill inside its own outline, in reading order
        inner = m & ~dilate(np.any(masks[i + 1:], 0), ow) if i < len(masks) - 1 else m
        top = inner & (ys < split)
        paint_mask(cv, full(top if fill2 is not None else inner), fill, r, soft=0.95, mist=0.5, streak=streak)
        if fill2 is not None:
            paint_mask(cv, full(inner & ~top), fill2, r, soft=0.95, mist=0.5, streak=streak)
    if cut is not None:                    # the ruled line between the colours
        line = (np.abs(ys - split) < max(1.2, cap * 0.018)) & union
        paint_mask(cv, full(line), cut, r, soft=0.8, mist=0.3)
    return cv


def slap(kind, r, text='', lines=None, color=BLOOD, ink=BLACK, size_m=0.34, word_kind='black'):
    """A sticker slapped on the wall."""
    if kind == 'vinyl':                    # a die-cut word with a white border
        cap = size_m * PX * 0.42
        masks, _ = type_masks(lines or [text], word_kind, cap, r, tracking=-0.02, line_gap=1.15, per_letter=False)
        border = cap * 0.16
        m = crop_masks(masks, int(border + 6))[0]
        body = dilate(m, border)
        body = ndimage.binary_closing(body, iterations=int(cap * 0.15) + 1)
        sticker = np.zeros(body.shape + (4,))
        cv = G.Canvas(body.shape[1] + 6, body.shape[0] + 6)
        sh = np.pad(body, ((0, 6), (0, 6)))
        if not SPRAY:
            cv.over(BLACK, ndimage.gaussian_filter(shift(sh, 2, 3).astype(float), 1.2) * 0.35)
        flat(cv, sh, WHITE)
        flat(cv, np.pad(m, ((0, 6), (0, 6))), color)
        if ink is not None:                # a second print colour: an inner line
            inner = np.pad(m & ~erode(m, max(1.5, cap * 0.06)), ((0, 6), (0, 6)))
            flat(cv, inner, ink, 0.9)
        gloss(cv, sh, r)
        return rotate_canvas(cv, r.normal(0, 0.06))
    w, h = int(size_m * PX), int(size_m * PX * (0.68 if kind == 'hello' else 0.72))
    cv = G.Canvas(w + 8, h + 8)
    card = np.zeros((h + 8, w + 8), bool)
    rr = int(min(w, h) * 0.08)
    im = Image.new('L', (w + 8, h + 8), 0)
    ImageDraw.Draw(im).rounded_rectangle((2, 2, w + 1, h + 1), rr, fill=255)
    card = np.asarray(im) > 127
    if not SPRAY:
        cv.over(BLACK, ndimage.gaussian_filter(shift(card, 2, 3).astype(float), 1.2) * 0.35)
    if kind == 'hello':
        flat(cv, card, color)
        panel = Image.new('L', card.shape[::-1], 0)
        ImageDraw.Draw(panel).rectangle((2 + w * 0.06, 2 + h * 0.4, w + 1 - w * 0.06, h + 1 - h * 0.12), fill=255)
        flat(cv, np.asarray(panel) > 127, WHITE)
        hello = type_masks(['HELLO'], 'black', h * 0.15, r, tracking=0.04, per_letter=False)[0][0]
        name_is = type_masks(['my name is'], 'medium', h * 0.065, r, per_letter=False)[0][0]
        place(cv, hello, WHITE, w / 2 + 4, h * 0.05 + 2)
        place(cv, name_is, WHITE, w / 2 + 4, h * 0.25 + 2)
        write_in(cv, lines or [text], ink, r, (2 + w * 0.1, 2 + h * 0.44, w + 1 - w * 0.1, h + 1 - h * 0.16))
    else:                                  # a plain white shipping label, ruled, written on in marker
        flat(cv, card, (0.97, 0.97, 0.95))
        if SPRAY:                          # a sprayed white panel and big sprayed writing, nothing printed
            write_in(cv, lines or [text], ink, r, (2 + w * 0.06, 2 + h * 0.1, w + 1 - w * 0.06, h + 1 - h * 0.12), width_frac=0.1)
            return rotate_canvas(light_drips(cv, (0.97, 0.97, 0.95), r, None, rate=0.1), r.normal(0, 0.04))
        rule = np.zeros_like(card)
        for k in range(5):
            y = int(2 + h * (0.3 + k * 0.14))
            rule[y:y + 1, int(w * 0.05):int(w * 0.95)] = True
        box = np.zeros_like(card)
        box[int(h * 0.06):int(h * 0.2), int(w * 0.05):int(w * 0.95)] = True
        box &= ~erode(box, 1.2)
        flat(cv, rule | box, (0.62, 0.66, 0.72), 0.8)
        write_in(cv, lines or [text], ink, r, (2 + w * 0.06, 2 + h * 0.26, w + 1 - w * 0.06, h + 1 - h * 0.06))
    gloss(cv, card, r)
    return rotate_canvas(cv, r.normal(0, 0.07))


def gloss(cv, mask, r):
    """a faint sheen across a sticker"""
    if SPRAY:
        return
    h, w = mask.shape
    yy, xx = np.mgrid[:h, :w]
    band = np.clip(1 - np.abs((xx * 0.7 + yy) / max(1, w * 0.7 + h) - r.uniform(0.25, 0.45)) * 8, 0, 1)
    cv.over(WHITE, band * mask * 0.12)


def place(cv, m, color, cx, top, alpha=1.0):
    """paste a mask onto the canvas, centred on cx with its top at `top`"""
    ys, xs = np.nonzero(m)
    if not len(xs):
        return
    m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    full = np.zeros((cv.h, cv.w), bool)
    x0, y0 = int(round(cx - m.shape[1] / 2)), int(round(top))
    hh, ww = min(m.shape[0], cv.h - y0), min(m.shape[1], cv.w - x0)
    full[y0:y0 + hh, x0:x0 + ww] = m[:hh, :ww]
    flat(cv, full, color, alpha)


def write_in(cv, lines, ink, r, box, width_frac=0.085):
    """handwriting in marker, fitted to a box (x0, y0, x1, y1)"""
    x0, y0, x1, y1 = box
    hp = 100
    paths, (W, H) = hand_strokes(lines, r, hp, 20, slant=r.uniform(0.05, 0.2), spacing=0.16, line_gap=1.55)
    k = min((x1 - x0) / W, (y1 - y0) / H)
    ox, oy = x0 + ((x1 - x0) - W * k) / 2, y0 + ((y1 - y0) - H * k) / 2
    paths = [p * k + (ox, oy) for p in paths]
    can = G.Can(cv, ink, max(2.0, hp * k * width_frac) * (1.25 if SPRAY else 1), r, marker=not SPRAY, drips=0.06 if SPRAY else 1.0)
    for p in paths:
        can.stroke(p)
    can.spray()


def rotate_canvas(cv, angle):
    """turn a finished canvas a little (stickers and posters never go up straight)"""
    img = cv.image()
    out = img.rotate(math.degrees(angle), resample=Image.BICUBIC, expand=True)
    arr = np.asarray(out, float) / 255
    c = G.Canvas(out.width, out.height)
    c.rgb, c.a = arr[..., :3], arr[..., 3]
    return c


def paper(cv, mask, color, r, wrinkle=0.5, torn=True):
    """a sheet of paper on the wall: off-white with fibre noise and wrinkles, edges a little torn
    (spray mode: a panel sprayed on instead, rough-edged and a bit streaky)"""
    if SPRAY:
        mask = rough(mask, r, 2.0, 2.5)
        paint_mask(cv, mask, color, r, soft=1.3, mist=1.6, streak=0.55)
        cv.over(mix(color, BLACK, 0.15), (mask * (1 - coverage(mask.shape, r, 0.6))) * 0.4)
        return mask
    if torn:
        mask = rough(mask, r, 1.6, 1.0) & rough(mask, r, 0.8, 4.0)
    h, w = mask.shape
    shade = noise(h, w, r, 1.0) * 0.015 + noise(h, w, r, 12) * 0.02
    rgb = np.clip(np.asarray(color)[None, None, :] + shade[..., None], 0, 1)
    if wrinkle:                            # creases: long thin light/dark pairs
        cre = np.zeros((h, w))
        for _ in range(int(3 + wrinkle * 6)):
            a = r.uniform(0, math.pi)
            x0, y0 = r.uniform(0, w), r.uniform(0, h)
            yy, xx = np.mgrid[:h, :w]
            d = (xx - x0) * math.sin(a) - (yy - y0) * math.cos(a)
            along = np.abs((xx - x0) * math.cos(a) + (yy - y0) * math.sin(a))
            fade = np.clip(1 - along / r.uniform(w * 0.15, w * 0.5), 0, 1)
            cre += (np.exp(-(d / 1.2) ** 2) - np.exp(-((d - 2) / 1.2) ** 2) * 0.8) * fade
        rgb = np.clip(rgb + cre[..., None] * 0.06 * wrinkle, 0, 1)
    cv.over(rgb, mask.astype(float))
    return mask


def poster(lines, r, kind='type', width_m=0.7, font_kind='black', ink=BLACK, sheet=PAPER, small=None, line_gap=1.12,
           margin=0.1):
    """A wheatpasted print. kind: 'type' (ink on paper), anything else is just the colours given.
    (Spray mode: a sprayed panel with big sprayed block letters on it.)"""
    if SPRAY:
        font_kind, margin = 'black', min(margin, 0.06)
    width = width_m * PX
    # size the type so the longest line fills the sheet
    probe = type_masks(lines, font_kind, 100, r, tracking=-0.01, line_gap=line_gap, per_letter=False)[1]
    cap = 100 * width * (1 - 2 * margin) / probe[0]
    m = type_masks(lines, font_kind, cap, r, tracking=-0.01, line_gap=line_gap, per_letter=False)[0][0]
    m = crop_masks([m], 0)[0]
    sm = None
    if small:
        sm = type_masks(small, 'medium', max(6, cap * 0.18), r, line_gap=1.5, per_letter=False)[0][0]
        sm = crop_masks([sm], 0)[0]
    mh = int(width * margin)
    body_h = m.shape[0] + (sm.shape[0] + mh * 0.6 if sm is not None else 0)
    W, H = int(width), int(body_h + 2 * mh)
    cv = G.Canvas(W + 10, H + 10)
    sheet_mask = np.zeros((cv.h, cv.w), bool)
    sheet_mask[5:5 + H, 5:5 + W] = True
    if not SPRAY:
        cv.over(BLACK, ndimage.gaussian_filter(shift(sheet_mask, 1, 2).astype(float), 1.5) * 0.25)
    sheet_mask = paper(cv, sheet_mask, sheet, r)
    place(cv, m, ink, cv.w / 2, 5 + mh, 0.93)
    if sm is not None:
        place(cv, sm, ink, cv.w / 2, 5 + mh + m.shape[0] + mh * 0.6, 0.9)
    if SPRAY:                              # a few short runs off the panel's bottom edge
        cv = light_drips(cv, sheet, r, sheet_mask, rate=0.12)
        return rotate_canvas(cv, r.normal(0, 0.015))
    # print wear: ink missing in specks where the paper didn't take it
    specks = (noise(cv.h, cv.w, r, 0.7) > 2.2) & sheet_mask
    cv.over(sheet, specks * 0.8)
    # paste sheen and a dark damp edge
    edge = sheet_mask & ~erode(sheet_mask, 3)
    cv.over(mix(sheet, BLACK, 0.35), edge * 0.35)
    return rotate_canvas(cv, r.normal(0, 0.03))


RANSOM_FONTS = ['black', 'serif', 'italic', 'mono', 'cond', 'caladea', 'libserif', 'carlito', 'lmdemi', 'bold']
RANSOM_PAPERS = [(PAPER, BLACK), (NEWSPRINT, BLACK), (YELLOW, BLACK), (BLACK, WHITE), (BLOOD, WHITE), (BUBBLEGUM, BLACK),
                 (SKY, NAVY), (WHITE, RED), (CREAM, OXBLOOD), (MINT, FOREST), (WHITE, COBALT), (LILAC, BLACK)]


def ransom(lines, r, height_m=0.12, words_per_line=None):
    """Every letter cut from something different and glued down crooked.
    (Spray mode: every letter sprayed in its own font and colour, each with its own outline.)"""
    cap = height_m * PX
    if SPRAY:
        return ransom_sprayed(lines, r, cap)
    cuts = []
    y = 0.0
    width = 0.0
    for line in lines:
        x = 0.0
        for ch in line:
            if ch == ' ':
                x += cap * 0.55
                continue
            kind = RANSOM_FONTS[r.integers(len(RANSOM_FONTS))]
            bg, ink = RANSOM_PAPERS[r.integers(len(RANSOM_PAPERS))]
            if ch.isalpha() and r.random() < 0.35:
                ch = ch.swapcase()
            s = cap * r.uniform(0.8, 1.25)
            m, asc, adv = char_mask(ch, kind, s)
            m = crop_masks([m], 0)[0] if m.any() else m
            pw, ph = int(m.shape[1] + s * r.uniform(0.18, 0.4)), int(max(m.shape[0], s) + s * r.uniform(0.2, 0.45))
            tile = G.Canvas(pw + 4, ph + 4)
            pm = np.zeros((tile.h, tile.w), bool)
            pm[2:2 + ph, 2:2 + pw] = True
            pm = rough(pm, r, 0.7, 0.8)    # scissor cuts
            flat(tile, pm, bg)
            place(tile, m, ink, tile.w / 2 + r.normal(0, 1), 2 + (ph - m.shape[0]) / 2)
            tile = rotate_canvas(tile, r.normal(0, 0.12))
            cuts.append((tile, x, y + r.normal(0, cap * 0.06)))
            x += tile.w * 0.92 + cap * 0.03
        width = max(width, x)
        y += cap * 1.65
    W, H = int(width + cap), int(y + cap * 0.6)
    cv = G.Canvas(W, H)
    for tile, x, yy in cuts:
        if not SPRAY:
            sh = G.Canvas(tile.w, tile.h)
            sh.over(BLACK, ndimage.gaussian_filter(tile.a, 1.0) * 0.3)
            paste(cv, sh, x + cap * 0.3 + 2, yy + cap * 0.15 + 2)
        paste(cv, tile, x + cap * 0.3, yy + cap * 0.15)
    return cv


def ransom_sprayed(lines, r, cap):
    pieces, y, width = [], 0.0, 0.0
    for line in lines:
        x = 0.0
        for ch in line:
            if ch == ' ':
                x += cap * 0.5
                continue
            kind = RANSOM_FONTS[r.integers(len(RANSOM_FONTS))]
            bg, ink = RANSOM_PAPERS[r.integers(len(RANSOM_PAPERS))]
            fill, line_c = (ink, bg) if r.random() < 0.5 else (bg, ink)
            if fill in (BLACK, NAVY, FOREST, OXBLOOD):
                fill, line_c = line_c, fill
            if ch.isalpha() and r.random() < 0.35:
                ch = ch.swapcase()
            m, asc, adv = char_mask(ch, kind, cap * r.uniform(0.85, 1.25), r.normal(0, 0.12))
            if not m.any():
                continue
            m = crop_masks([m], int(cap * 0.2))[0]
            pieces.append((m, fill, line_c, x, y + r.normal(0, cap * 0.08)))
            x += m.shape[1] - cap * 0.3
        width = max(width, x)
        y += cap * 1.55
    W, H = int(width + cap), int(y + cap * 0.8)
    cv = G.Canvas(W, H)
    for m, fill, line_c, x, yy in pieces:
        full = np.zeros((H, W), bool)
        xi, yi = int(x), int(yy + cap * 0.1)
        hh, ww = min(m.shape[0], H - yi), min(m.shape[1], W - xi)
        full[yi:yi + hh, xi:xi + ww] = m[:hh, :ww]
        flat(cv, dilate(full, max(2, cap * 0.07)), line_c)
        flat(cv, full, fill)
    return light_drips(M.grow(cv, bottom=int(PX * 0.1)), BLACK, r, rate=0.06)


def mosaic(lines, r, cell_m=0.045, rows=7, colors=(SKY,), shade=None, frame=None, back=None, kind='mono'):
    """Glazed square tiles cemented on, a few tiles high per line of letters."""
    g = pixel_text(lines)
    if SPRAY:
        frame = back = None
    if shade is not None:                  # a one-tile drop shadow in another colour
        sh = np.pad(g, ((0, 1), (0, 1)))
        sh = (np.roll(np.roll(sh, 1, 0), 1, 1)) & ~np.pad(g, ((0, 1), (0, 1)))
        g = np.pad(g, ((0, 1), (0, 1)))
    else:
        sh = np.zeros_like(g)
    pad = 2 if (frame is not None or back is not None) else 0
    g, sh = np.pad(g, pad), np.pad(sh, pad)
    rows_n, cols_n = g.shape
    cell = cell_m * PX
    cv = G.Canvas(cols_n * cell + 6, rows_n * cell + 6)
    grout = max(1.0, cell * (0.22 if SPRAY else 0.14))
    tile_cols = {}
    if back is not None:                   # a panel of background tiles (and the grout between them)
        panel = np.zeros((cv.h, cv.w), bool)
        panel[3:3 + int(rows_n * cell), 3:3 + int(cols_n * cell)] = True
        flat(cv, panel, (0.72, 0.71, 0.67))
    for y in range(rows_n):
        for x in range(cols_n):
            if g[y, x]:
                c = colors[(x * 7 + y * 3 + r.integers(3)) % len(colors)] if len(colors) > 1 else colors[0]
            elif sh[y, x]:
                c = shade
            elif frame is not None and (y in (0, rows_n - 1) or x in (0, cols_n - 1)):
                c = frame
            elif back is not None:
                c = back
            else:
                continue
            c = tuple(np.clip(np.asarray(c) * r.uniform(0.9, 1.08) + r.normal(0, 0.015, 3), 0, 1))
            x0, y0 = 3 + x * cell + grout / 2, 3 + y * cell + grout / 2
            s = cell - grout
            im = Image.new('L', (cv.w, cv.h), 0)
            ImageDraw.Draw(im).rectangle((x0 + r.normal(0, 0.3), y0 + r.normal(0, 0.3), x0 + s, y0 + s), fill=255)
            m = np.asarray(im) > 127
            flat(cv, m, c)
            if not SPRAY:
                hl = m & ~shift(m, 1, 1)   # the glaze catching the light on two edges
                cv.over(WHITE, hl * 0.35)
    if SPRAY:
        return light_drips(M.grow(cv, bottom=int(PX * 0.1)), colors[0], r, rate=0.1)
    return cv


def ticker(lines, r, color=AMBER, rows=7, dot_m=0.028, kind='mono', arrow=None):
    """An LED dot-matrix sign: a dark panel, unlit dots faintly there, lit ones glowing."""
    g = pixel_text(lines)
    if arrow:                              # a little up (or down) triangle in dots after the text
        tri = np.zeros((rows, rows), bool)
        for i in range(rows):
            half = (i if arrow == 'up' else rows - 1 - i) // 2 + 1
            tri[i, rows // 2 - half + 1:rows // 2 + half] = True
        top = g[:rows]
        g = np.hstack([g, np.zeros((g.shape[0], 2), bool), np.vstack([tri, np.zeros((g.shape[0] - rows, rows), bool)])])
    g = np.pad(g, 1)
    rows_n, cols_n = g.shape
    cell = dot_m * PX
    frame = cell * 0.9
    W, H = int(cols_n * cell + 2 * frame), int(rows_n * cell + 2 * frame)
    cv = G.Canvas(W + 4, H + 4)
    panel = Image.new('L', (cv.w, cv.h), 0)
    ImageDraw.Draw(panel).rounded_rectangle((2, 2, W + 1, H + 1), int(frame * 0.6), fill=255)
    pm = np.asarray(panel) > 127
    if SPRAY:
        pm = rough(pm, r, 2.0, 2.5)
    flat(cv, pm, (0.08, 0.08, 0.09))
    flat(cv, pm & ~erode(pm, max(1.5, frame * 0.25)), (0.25, 0.25, 0.27))
    on = np.zeros((cv.h, cv.w), bool)
    off = np.zeros((cv.h, cv.w), bool)
    rad = cell * 0.36
    yy, xx = np.mgrid[:cv.h, :cv.w]
    for y in range(rows_n):
        for x in range(cols_n):
            cx, cy = 2 + frame + (x + 0.5) * cell, 2 + frame + (y + 0.5) * cell
            x0, x1, y0, y1 = int(cx - rad - 1), int(cx + rad + 2), int(cy - rad - 1), int(cy + rad + 2)
            d = (xx[y0:y1, x0:x1] - cx) ** 2 + (yy[y0:y1, x0:x1] - cy) ** 2 <= rad * rad
            (on if g[y, x] else off)[y0:y1, x0:x1] |= d
    flat(cv, off, mix(color, (0.08, 0.08, 0.09), 0.82))
    glow = ndimage.gaussian_filter(on.astype(float), cell * 0.45) * 1.6
    if SPRAY:                              # the glow as overspray: speckled, not smooth
        glow = glow * (_R.random(glow.shape) < np.clip(glow * 1.2, 0, 0.9))
    cv.over(color, np.clip(glow, 0, 0.75) * pm)
    flat(cv, on, color)
    cv.over(WHITE, (on & erode(on, max(1, rad * 0.45))) * 0.45)
    if SPRAY:
        return light_drips(M.grow(cv, bottom=int(PX * 0.1)), (0.08, 0.08, 0.09), r, np.pad(pm, ((0, int(PX * 0.1)), (0, 0))), rate=0.12)
    return cv


def neon(text, color, r, height_m=0.3, script=True, tube_m=0.016, lines=None, backing=None):
    """Painted neon: a soft glow round a hot tube with a pale core."""
    hp = height_m * PX
    pad = int(PX * 0.14 + hp * 0.3)
    lines = lines or text.split('\n')
    paths, (W, H) = hand_strokes(lines, r, hp, pad, slant=0.22 if script else 0.02, spacing=0.1 if script else 0.22,
                                 bounce=0.05 if script else 0.01, smooth=3 if script else 1, line_gap=1.6, upper=not script)
    cv = G.Canvas(W, H)
    tube = stroke_mask(paths, (H, W), tube_m * PX)
    if backing is not None:                # the painted dark board the tube is "mounted" on
        board = ndimage.binary_closing(dilate(tube, PX * 0.06), iterations=6)
        paint_mask(cv, board, backing, r, soft=0.9, mist=0.5)
    wide = ndimage.gaussian_filter(tube.astype(float), PX * 0.045) * 2.2
    near = ndimage.gaussian_filter(tube.astype(float), PX * 0.012) * 1.4
    if SPRAY:                              # the glow sprayed on: a haze of fine dots, the tube a can line
        haze = np.clip(wide, 0, 0.6)
        cv.over(color, haze * 0.5 + haze * (_R.random(haze.shape) < haze) * 0.5)
        paths_px = [np.asarray(p) for p in paths]
        spray_paths(cv, paths_px, color, r, tube_m * PX * 2.0, drips=0.12, mist=1.5)
        spray_paths(cv, paths_px, mix(color, WHITE, 0.75), r, tube_m * PX * 0.5, drips=0, mist=0.3)
        return light_drips(cv, color, r, rate=0.08)
    cv.over(color, np.clip(wide, 0, 0.6))
    cv.over(color, np.clip(near, 0, 0.85))
    flat(cv, tube, mix(color, WHITE, 0.25))
    core = erode(tube, tube_m * PX * 0.3)
    cv.over(mix(color, WHITE, 0.8), core * 0.9)
    return cv


def glitch(text, r, base=WHITE, height_m=0.3, kind='black', bands=7, outline=BLACK, lines=None):
    """Type sliced into bands that slip sideways, with a cyan/magenta split and a few dead blocks."""
    cap = height_m * PX
    if SPRAY:
        kind = 'black'
    m = type_masks(lines or text.split('\n'), kind, cap, r, tracking=0.02, line_gap=1.2, per_letter=False)[0][0]
    pad = int(cap * 0.5)
    m = crop_masks([m], pad)[0]
    H, W = m.shape
    cuts = np.sort(r.uniform(0, H, bands))
    off = np.zeros(H)
    for a, b in zip(np.r_[0, cuts], np.r_[cuts, H]):
        if r.random() < 0.6:
            off[int(a):int(b)] = r.normal(0, cap * 0.12)
    def slip(mask):
        out = np.zeros_like(mask)
        for y in range(H):
            out[y] = np.roll(mask[y], int(off[y]))
        return out
    main = slip(m)
    cv = G.Canvas(W, H)
    split = cap * 0.06
    if outline is not None:
        paint_mask(cv, dilate(main, max(2, cap * 0.05)), outline, r, soft=0.8, mist=0.3)
    flat(cv, shift(main, -split, 0), CYAN, 0.9)
    flat(cv, shift(main, split, 0), MAGENTA, 0.9)
    flat(cv, main, base)
    scan = (np.arange(H) % 4 == 0)[:, None] & main
    cv.over(BLACK, scan * 0.25)
    for _ in range(r.integers(3, 7)):      # dead blocks
        bw, bh = r.uniform(cap * 0.2, cap * 0.9), r.uniform(cap * 0.05, cap * 0.18)
        x0, y0 = r.uniform(0, W - bw), r.uniform(pad * 0.5, H - pad * 0.5 - bh)
        blk = np.zeros((H, W), bool)
        blk[int(y0):int(y0 + bh), int(x0):int(x0 + bw)] = True
        flat(cv, blk, [CYAN, MAGENTA, base, BLACK][r.integers(4)], 0.9)
    if SPRAY:
        grown = M.grow(cv, bottom=int(PX * 0.1))
        return light_drips(grown, base, r, np.pad(main, ((0, grown.h - H), (0, 0))), rate=0.12)
    return cv


def burst_poly(cx, cy, rx, ry, n, r, jag=0.55):
    pts = []
    for k in range(n * 2):
        a = k * math.pi / n + r.normal(0, 0.05)
        rad = 1.0 if k % 2 == 0 else jag + r.uniform(-0.08, 0.08)
        pts.append((cx + rx * rad * math.cos(a), cy + ry * rad * math.sin(a)))
    return pts


def halftone(text, fill, r, height_m=0.4, dot=None, outline=BLACK, shadow=BLACK, burst=None, kind='black', lines=None):
    """Pop-art letters: leaning, fat black outline, drop shadow, Ben-Day dots darkening toward the bottom,
    sometimes on a jagged burst."""
    cap = height_m * PX
    masks, _ = type_masks(lines or text.split('\n'), kind, cap, r, tracking=0.0, line_gap=1.1, jitter_rot=0.02, shear=0.18)
    ow = max(3, cap * 0.08)
    pad = int(cap * (0.55 if burst else 0.25) + ow * 2)
    masks = crop_masks(masks, pad)
    H, W = masks[0].shape
    union = np.any(masks, 0)
    cv = G.Canvas(W, H)
    if burst is not None:
        im = Image.new('L', (W, H), 0)
        ys, xs = np.nonzero(union)
        cx, cy = xs.mean(), ys.mean()
        ImageDraw.Draw(im).polygon(burst_poly(cx, cy, (xs.max() - xs.min()) * 0.62 + pad * 0.5,
                                              (ys.max() - ys.min()) * 0.75 + pad * 0.55, 13, r), fill=255)
        b = np.asarray(im) > 127
        paint_mask(cv, dilate(b, ow * 0.8), BLACK, r, soft=0.85, mist=0.4)
        paint_mask(cv, b, burst, r, soft=0.9, mist=0.3)
    outer = dilate(union, ow)
    if shadow is not None:
        flat(cv, shift(outer, cap * 0.08, cap * 0.08), shadow)
    flat(cv, outer, outline)
    dot = dot if dot is not None else mix(fill, BLACK, 0.35)
    yy, xx = np.mgrid[:H, :W]
    a = 0.26
    u, v = xx * math.cos(a) + yy * math.sin(a), -xx * math.sin(a) + yy * math.cos(a)
    period = max(4.0, cap * 0.11)
    du, dv = (u % period) - period / 2, (v % period) - period / 2
    ys, xs = np.nonzero(union)
    t = np.clip((yy - ys.min()) / max(1, ys.max() - ys.min()), 0, 1)
    rad = period * (0.12 + 0.36 * t)
    dots = (du * du + dv * dv) < rad * rad
    for i, m in enumerate(masks):
        inner = m & ~dilate(np.any(masks[i + 1:], 0), ow) if i < len(masks) - 1 else m
        flat(cv, inner, fill)
        flat(cv, inner & dots, dot)
        hi = inner & ~shift(inner, -max(1, cap * 0.035), -max(1, cap * 0.035)) & (t < 0.55)
        cv.over(WHITE, hi * 0.8)
    if SPRAY:
        grown = M.grow(cv, bottom=int(PX * 0.12))
        return light_drips(grown, outline, r, np.pad(outer, ((0, grown.h - H), (0, 0))), rate=0.15)
    return cv


CHALK = [(0.96, 0.95, 0.9), (0.98, 0.78, 0.86), (0.72, 0.88, 0.98), (0.98, 0.93, 0.62), (0.75, 0.95, 0.78), (0.86, 0.78, 0.98)]


def chalk(lines, r, height_m=0.13, colors=None, width_m=0.017, upper=False, underline=False, hearts=0):
    """Chalk handwriting: grainy, dusty strokes, pressure coming and going, a pastel per line."""
    hp = height_m * PX
    pad = int(hp * 0.5 + PX * 0.04)
    colors = colors or [CHALK[i] for i in r.permutation(len(CHALK))]
    cv = None
    paths_all, size = hand_strokes(lines, r, hp, pad, slant=r.uniform(0.05, 0.2), spacing=0.15, bounce=0.07, smooth=2,
                                   line_gap=1.65, upper=upper)
    W, H = size
    cv = G.Canvas(W, H + (int(hp * 0.5) if underline else 0))
    H = cv.h
    # which line each path belongs to, by its height
    ys = [p[:, 1].mean() for p in paths_all]
    line_of = np.clip(((np.array(ys) - pad) / (hp * 1.65)).astype(int), 0, len(lines) - 1) if ys else []
    extra = []
    if underline:
        x0, x1 = pad * 0.6, W - pad * 0.6
        yb = H - hp * 0.45
        extra.append((np.array([(x0, yb + 2), ((x0 + x1) / 2, yb - 3), (x1, yb + 1)]), len(lines) - 1))
    for k in range(hearts):
        cx, cy = r.uniform(W * 0.75, W - pad * 0.5), r.uniform(pad, H - pad)
        hpts = np.array(M.heart_path(cx, cy, hp * 0.18))
        extra.append((hpts, r.integers(len(lines))))
    grain = noise(H, W, r, 0.6)
    for ci in range(len(lines)):
        ps = [p for p, l in zip(paths_all, line_of) if l == ci] + [p for p, l in extra if l == ci]
        if not ps:
            continue
        m = stroke_mask(ps, (H, W), width_m * PX)
        press = 0.75 + 0.25 * noise(H, W, r, PX * 0.06)
        alpha = m * np.clip(press, 0.45, 1.0) * (grain > -0.9) * np.clip(0.85 + grain * 0.2, 0, 1)
        dust = ndimage.gaussian_filter(m.astype(float), width_m * PX * 1.2) * 0.18
        col = colors[ci % len(colors)]
        cv.over(col, np.clip(dust, 0, 0.18))
        cv.over(col, np.clip(alpha, 0, 0.95))
    return cv


def speech(lines, r, kind='round', fill=WHITE, line=BLACK, ink=BLACK, height_m=0.12, tail='left', width_m=0.012):
    """A sprayed comic balloon, round (with a tail) or a jagged shout, hand-lettered in caps."""
    hp = height_m * PX
    paths, (W, H) = hand_strokes(lines, r, hp, 4, slant=0.04, spacing=0.22, bounce=0.03, smooth=1, line_gap=1.45,
                                 upper=True)
    # the balloon round the words
    k = 1.55 if kind == 'round' else 2.0
    bw, bh = W * (k * 0.78) + hp, H * k + hp
    cw, ch = int(bw + hp * 2.2), int(bh + hp * 2.6)
    cv = G.Canvas(cw, ch)
    cx, cy = cw / 2, (ch - hp * 0.9) / 2
    im = Image.new('L', (cw, ch), 0)
    d = ImageDraw.Draw(im)
    if kind == 'round':
        d.ellipse((cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2), fill=255)
        sx = -1 if tail == 'left' else 1
        d.polygon([(cx + sx * bw * 0.12, cy + bh * 0.38), (cx + sx * bw * 0.32, cy + bh * 0.3),
                   (cx + sx * bw * 0.42, cy + bh / 2 + hp * 1.0)], fill=255)
    else:
        d.polygon(burst_poly(cx, cy, bw / 2 + hp * 0.3, bh / 2 + hp * 0.2, 11, r, jag=0.72), fill=255)
    b = np.asarray(im) > 127
    paint_mask(cv, dilate(b, width_m * PX * 0.9), line, r, soft=0.85, mist=0.6)
    paint_mask(cv, b, fill, r, soft=0.95, mist=0.4)
    ox, oy = cx - W / 2, cy - H / 2
    can = G.Can(cv, ink, max(2.2, hp * (0.15 if SPRAY else 0.13)), r, marker=not SPRAY, drips=0.06 if SPRAY else 1.0)
    for p in paths:
        can.stroke(p + (ox, oy))
    can.spray()
    return cv


def arc_text(cv, text, kind, cap, cx, cy, radius, centre_angle, color, inside=False):
    """letters set round a circle (centre_angle in radians, 0 = right, -pi/2 = top)"""
    f = font(kind, cap_size(kind, cap))
    widths = [f.getlength(c) + cap * 0.12 for c in text]
    total = sum(widths) / radius
    a = centre_angle - total / 2 * (-1 if inside else 1)
    for c, w in zip(text, widths):
        step = w / radius * (-1 if inside else 1)
        mid = a + step / 2
        im = Image.new('L', (int(cap * 3), int(cap * 3)), 0)
        ImageDraw.Draw(im).text((cap * 1.5, cap * 1.5), c, font=f, fill=255, anchor='mm')
        rot = -math.degrees(mid) - 90 if not inside else -math.degrees(mid) + 90
        im = im.rotate(rot, resample=Image.BILINEAR)
        m = np.asarray(im) > 110
        full = np.zeros((cv.h, cv.w), bool)
        x0 = int(cx + radius * math.cos(mid) - im.width / 2)
        y0 = int(cy + radius * math.sin(mid) - im.height / 2)
        sy, sx = max(0, -y0), max(0, -x0)
        hh, ww = min(im.height, cv.h - y0) - sy, min(im.width, cv.w - x0) - sx
        if hh > 0 and ww > 0:
            full[y0 + sy:y0 + sy + hh, x0 + sx:x0 + sx + ww] = m[sy:sy + hh, sx:sx + ww]
        flat(cv, full, color)
        a += step


def sign(kind, r, **kw):
    """Signs, doctored or made up: 'speed' (a speed sign with a number and a scrawl), 'seal' (a round stamp
    with words round it and an icon), 'plaque' (a company's plaque with a chip for a logo)."""
    if kind == 'speed':
        w, h = int(0.78 * PX), int(1.0 * PX)
        scrawl = kw.get('scrawl')
        cv = G.Canvas(w + 10, h + 10 + (int(PX * 0.5) if scrawl else 0))
        im = Image.new('L', (cv.w, cv.h), 0)
        ImageDraw.Draw(im).rounded_rectangle((5, 5, 5 + w, 5 + h), int(w * 0.05), fill=255)
        plate = np.asarray(im) > 127
        flat(cv, plate, (0.96, 0.96, 0.94))
        inner = erode(plate, w * 0.035) & ~erode(plate, w * 0.06)
        flat(cv, inner, BLACK)
        top = type_masks(kw.get('top', ['SPEED', 'LIMIT']), 'cond', h * 0.085, r, tracking=0.05, line_gap=1.25,
                         per_letter=False)[0][0]
        place(cv, top, BLACK, 5 + w / 2, 5 + h * 0.1)
        num = type_masks([kw.get('number', '55')], 'cond', h * 0.36, r, tracking=-0.02, per_letter=False)[0][0]
        place(cv, num, BLACK, 5 + w / 2, 5 + h * 0.42)
        if kw.get('unit'):
            unit = type_masks([kw['unit']], 'cond', h * 0.06, r, tracking=0.08, per_letter=False)[0][0]
            place(cv, unit, BLACK, 5 + w / 2, 5 + h * 0.86)
        grime = noise(cv.h, cv.w, r, 6) > 1.4
        cv.over(BROWN, (grime & plate) * 0.12)
        if scrawl:
            write_in(cv, scrawl, kw.get('ink', BLOOD), r, (0, h + 10, cv.w, cv.h), width_frac=0.11)
        return rotate_canvas(cv, r.normal(0, 0.03))
    if kind == 'seal':
        d = int(kw.get('size_m', 1.0) * PX)
        cv = G.Canvas(d + 12, d + 12)
        c = (cv.w / 2, cv.h / 2)
        yy, xx = np.mgrid[:cv.h, :cv.w]
        rr = np.hypot(xx - c[0], yy - c[1])
        R = d / 2
        color, ink = kw.get('color', FOREST), kw.get('ink', CREAM)
        disc = rough(rr < R, r, 0.6)
        paint_mask(cv, disc, color, r, soft=0.95, mist=0.3)
        flat(cv, (np.abs(rr - R * 0.93) < R * 0.022) | (np.abs(rr - R * 0.66) < R * 0.02), ink)
        cap = R * 0.17
        arc_text(cv, kw.get('top', 'SEED-OIL'), 'black', cap, c[0], c[1], R * 0.79, -math.pi / 2, ink)
        arc_text(cv, kw.get('bottom', 'FREE'), 'black', cap, c[0], c[1], R * 0.79 + cap * 0.02, math.pi / 2, ink, inside=True)
        for a in (math.pi, 0):             # dots between the words
            flat(cv, np.hypot(xx - c[0] - R * 0.79 * math.cos(a), yy - c[1] - R * 0.79 * math.sin(a)) < R * 0.035, ink)
        # a drop of oil, struck through
        drop = Image.new('L', (cv.w, cv.h), 0)
        dd = ImageDraw.Draw(drop)
        s = R * 0.36
        dd.ellipse((c[0] - s * 0.62, c[1] - s * 0.15, c[0] + s * 0.62, c[1] + s * 1.0), fill=255)
        dd.polygon([(c[0], c[1] - s * 0.95), (c[0] - s * 0.55, c[1] + s * 0.25), (c[0] + s * 0.55, c[1] + s * 0.25)], fill=255)
        dm = np.asarray(drop) > 127
        flat(cv, dm, kw.get('drop', GOLD))
        slash = Image.new('L', (cv.w, cv.h), 0)
        ImageDraw.Draw(slash).line((c[0] - s * 0.95, c[1] + s * 0.95, c[0] + s * 0.95, c[1] - s * 0.95), fill=255, width=int(R * 0.09))
        sl = np.asarray(slash) > 127
        flat(cv, dilate(sl, R * 0.03) & (rr < R * 0.64), color)
        flat(cv, sl & (rr < R * 0.6), kw.get('slash', RED))
        return rotate_canvas(cv, r.normal(0, 0.05))
    # plaque
    words = kw.get('words', ['TOJI', 'CPU CORP'])
    color, ink = kw.get('color', NAVY), kw.get('ink', WHITE)
    cap = kw.get('cap_m', 0.17) * PX
    m = type_masks(words, 'black', cap, r, tracking=0.02, line_gap=1.2, per_letter=False, align='left')[0][0]
    m = crop_masks([m], 0)[0]
    chip = int(m.shape[0] * 0.95)
    w, h = int(m.shape[1] + chip + cap * 2.2), int(m.shape[0] + cap * 1.4)
    cv = G.Canvas(w + 10, h + 10)
    im = Image.new('L', (cv.w, cv.h), 0)
    ImageDraw.Draw(im).rounded_rectangle((5, 5, 5 + w, 5 + h), int(cap * 0.35), fill=255)
    plate = np.asarray(im) > 127
    yy = np.arange(cv.h)[:, None] / cv.h
    grad = np.asarray(color)[None, None, :] * (1.15 - 0.35 * yy)[..., None]
    cv.over(np.clip(np.broadcast_to(grad, (cv.h, cv.w, 3)), 0, 1), plate.astype(float))
    flat(cv, plate & ~erode(plate, 2), mix(color, WHITE, 0.4))
    # the chip: a square with pins on every side and a smaller square inside
    x0, y0 = 5 + cap * 0.7, 5 + (h - chip) / 2
    ci = Image.new('L', (cv.w, cv.h), 0)
    cd = ImageDraw.Draw(ci)
    body = chip * 0.62
    bx, by = x0 + (chip - body) / 2, y0 + (chip - body) / 2
    cd.rectangle((bx, by, bx + body, by + body), fill=255)
    pins = 4
    for k in range(pins):
        t = bx + body * (k + 0.5) / pins
        pw = body * 0.07
        cd.rectangle((t - pw, y0, t + pw, by), fill=255); cd.rectangle((t - pw, by + body, t + pw, y0 + chip), fill=255)
        t = by + body * (k + 0.5) / pins
        cd.rectangle((x0, t - pw, bx, t + pw), fill=255); cd.rectangle((bx + body, t - pw, x0 + chip, t + pw), fill=255)
    cm = np.asarray(ci) > 127
    flat(cv, cm, ink)
    core = Image.new('L', (cv.w, cv.h), 0)
    ImageDraw.Draw(core).rectangle((bx + body * 0.28, by + body * 0.28, bx + body * 0.72, by + body * 0.72), fill=255)
    flat(cv, np.asarray(core) > 127, color)
    place(cv, m, ink, x0 + chip + cap * 0.5 + m.shape[1] / 2, 5 + (h - m.shape[0]) / 2)
    return rotate_canvas(cv, r.normal(0, 0.02))


def chart(r, words=None, big=None, up=True, n=14, width_m=1.5, height_m=0.85, word_color=WHITE, arrow=LIME):
    """A candlestick chart sprayed on the wall, a fat arrow over it, and the words."""
    W, H = int(width_m * PX), int(height_m * PX)
    head = int(PX * 0.42)
    cv = G.Canvas(W + 20, H + head + 20)
    x0, y0 = 10, 10 + head
    grid = np.zeros((cv.h, cv.w), bool)
    for k in range(5):
        y = int(y0 + H * k / 4)
        grid[y:y + 1, x0:x0 + W] = True
    flat(cv, grid, WHITE, 0.25)
    price, cs = 0.0, []
    for k in range(n):
        o = price
        price += r.normal(0.55 if up else -0.4, 0.9)
        hi_, lo_ = max(o, price) + abs(r.normal(0, 0.4)), min(o, price) - abs(r.normal(0, 0.4))
        cs.append((o, price, hi_, lo_))
    vals = np.array([v for c in cs for v in c])
    lo, hi = vals.min(), vals.max()
    Y = lambda v: y0 + H - (v - lo) / (hi - lo) * H * 0.92
    cw = W / n
    for k, (o, c, h_, l_) in enumerate(cs):
        cx = x0 + (k + 0.5) * cw
        col = LIME if c >= o else RED
        im = Image.new('L', (cv.w, cv.h), 0)
        d = ImageDraw.Draw(im)
        d.line((cx, Y(h_), cx, Y(l_)), fill=255, width=max(1, int(cw * 0.08)))
        top, bot = Y(max(o, c)), Y(min(o, c))
        d.rectangle((cx - cw * 0.3, top, cx + cw * 0.3, max(bot, top + 2)), fill=255)
        paint_mask(cv, np.asarray(im) > 127, col, r, soft=0.9, mist=0.4, streak=0.3)
    # the arrow
    a0 = np.array([x0 + W * 0.05, Y(cs[1][1]) + H * 0.05])
    a1 = np.array([x0 + W * 0.97, Y(hi) - H * 0.05 if up else Y(lo) + H * 0.05])
    path = [a0 + (a1 - a0) * t + np.array([0, math.sin(t * 9) * H * 0.04]) for t in np.linspace(0, 1, 30)]
    spray_paths(cv, [np.array(path)], arrow, r, PX * 0.035, drips=0.3, mist=0.6)
    dvec = (a1 - a0) / np.linalg.norm(a1 - a0)
    nvec = np.array([-dvec[1], dvec[0]])
    hl = PX * 0.13
    spray_paths(cv, [np.array([a1 - dvec * hl + nvec * hl * 0.7, a1, a1 - dvec * hl - nvec * hl * 0.7])], arrow, r,
                PX * 0.035, drips=0.3, mist=0.6)
    if big:
        bm = type_masks([big], 'black', head * 0.8, r, tracking=-0.02, per_letter=False)[0][0]
        bm = crop_masks([bm], 0)[0]
        outer = np.zeros((cv.h, cv.w), bool)
        tmp = G.Canvas(cv.w, cv.h)
        place(tmp, bm, WHITE, 10 + bm.shape[1] / 2 + PX * 0.03, 6)
        mm = tmp.a > 0.5
        paint_mask(cv, dilate(mm, 3), BLACK, r, soft=0.85, mist=0.4)
        paint_mask(cv, mm, word_color, r, soft=0.95, mist=0.4, streak=0.4)
    if words:
        tmp = G.Canvas(cv.w, cv.h)
        write_in(tmp, words, word_color, r, (12 + (W * 0.42 if big else 0), 4, cv.w - 10, head + 6), width_frac=0.12)
        out = G.Canvas(cv.w, cv.h)
        out.over(BLACK, dilate(tmp.a > 0.4, 2).astype(float) * 0.9)
        paste(cv, out, 0, 0)
        paste(cv, tmp, 0, 0)
    return cv


def ribbon(text, light, dark, r, height_m=0.35, nib_m=0.055, angle=0.7, outline=BLACK, script=True, lines=None):
    """Letters drawn as a flat ribbon: its light face wherever the stroke runs one way, the dark back where it
    folds over, with an outline round the lot."""
    hp = height_m * PX
    pad = int(hp * 0.35 + nib_m * PX)
    paths, (W, H) = hand_strokes(lines or text.split('\n'), r, hp, pad, slant=0.25 if script else 0.05,
                                 spacing=0.14 if script else 0.24, bounce=0.05, smooth=3 if script else 2, line_gap=1.5,
                                 upper=not script)
    nib = np.array([math.cos(angle), -math.sin(angle)]) * nib_m * PX / 2
    face = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(face)
    for p in paths:
        pts, _, _ = G.resample(p, 1.5)
        for a, b in zip(pts[:-1], pts[1:]):
            v = b - a
            side = v[0] * nib[1] - v[1] * nib[0]
            d.polygon([tuple(a + nib), tuple(b + nib), tuple(b - nib), tuple(a - nib)], fill=1 if side >= 0 else 2)
    lab = np.asarray(face)
    any_ = lab > 0
    cv = G.Canvas(W, H + int(PX * 0.15))
    full = lambda m: np.pad(m, ((0, cv.h - H), (0, 0)))
    o = dilate(any_, max(2, nib_m * PX * 0.12))
    paint_mask(cv, full(o), outline, r, soft=0.85, mist=0.6)
    if not G.NODRIPS:
        add_drips(cv, outline, r, rate=0.3, max_len_m=0.15, width_px=2, from_mask=full(o))
    paint_mask(cv, full(lab == 1), light, r, soft=0.95, mist=0.4)
    paint_mask(cv, full(lab == 2), dark, r, soft=0.95, mist=0.4)
    edge = any_ & ~erode(any_, 1)
    flat(cv, full(edge), outline, 0.5)
    return cv


# ------------------------------------------------------------------ the phrases

def rng(name, seed):
    return np.random.default_rng(zlib.crc32(name.encode()) + seed * 7919)


# after review (/graffiti, 8 Nov): redone in spray mode, "more like spray paint (not too many drips)"
SPRAYED = {'ps_appraisal', 'rn_appraisal', 'ht_bonk', 'sb_bonk', 'ps_borntomon', 'tk_buyswagcoinnow', 'ne_collectooooor',
           'ps_crucifyhim', 'gl_gan_long', 'tk_gan_long', 'gl_generativeart', 'mo_generativeart', 'ht_gottamint',
           'mo_gottamint', 'ps_gucci', 'rn_gucci', 'sl_imcollecting', 'gl_j48baforms', 'sb_keepspittin', 'ht_lowbie',
           'ht_nfts', 'rn_noididnot', 'mo_oldmodels', 'sb_oldmodels', 'ht_organicevolution', 'ps_organicevolution',
           'ne_roundnround', 'sl_seedoilfree', 'sl_shoutout', 'sc_shoutout', 'bb_counterterroristswin'}


def sprayed_lines(lines, colors, r, height_m=0.13, width_m=0.014, hearts=0):
    """sprayed handwriting, a colour per line, a heart or two"""
    parts = [trim(G.scrawl([t], c, r, height_m, width_m, drips=0.04)) for t, c in zip(lines, colors)]
    out = stack(parts, int(height_m * PX * 0.25), 'left')
    for k in range(hearts):
        size = height_m * PX * 2.2
        h = G.Canvas(size * 1.4, size * 1.4)
        spray_paths(h, [np.array(M.heart_path(h.w / 2, h.h / 2, size * 0.42))], colors[k % len(colors)], r, width_m * PX,
                    drips=0.2)
        h = trim(h)
        out = M.side_by_side(out, h, int(PX * 0.04), 'center') if k == 0 else stack([out, h], 0, 'right')
    return out


def build_third(seed=11, only=None):
    """name -> Canvas, two takes on each phrase in two of the new families"""
    P = {}

    global SPRAY, _R

    def add(name, fn):
        global SPRAY, _R
        if only and not any(o in name for o in only):
            return
        r = rng(name, seed)
        SPRAY, _R = name in SPRAYED, np.random.default_rng(zlib.crc32(name.encode()) + 17)
        G.KERN = 0.0
        try:
            P[name] = trim(fn(r), 6)
        finally:
            SPRAY = False

    # Seed-Oil Free
    add('sg_seedoilfree', lambda r: sign('seal', r, top='SEED-OIL', bottom='FREE', color=FOREST, ink=CREAM))
    add('sl_seedoilfree', lambda r: slap('vinyl', r, lines=['Seed-Oil', 'Free'], color=FOREST, ink=LIME, size_m=0.71))
    # NFTs
    add('gl_nfts', lambda r: glitch('NFTs', r, WHITE, 0.4))
    add('ht_nfts', lambda r: halftone('NFTs', MAGENTA, r, 0.42, dot=GRAPE, shadow=GRAPE))
    # we could go pixel for pixel
    add('mo_pixelforpixel', lambda r: mosaic(['WE COULD GO', 'PIXEL FOR PIXEL'], r, 0.04, 7, colors=(HOTPINK, SKY, YELLOW),
                                             shade=NAVY))
    add('ch_pixelforpixel', lambda r: chalk(['we could go', 'pixel for pixel'], r, 0.21))
    # GG
    add('bb_gg', lambda r: blockbuster('GG', SKY, BLACK, r, 0.55, fill2=COBALT, shadow=WHITE, cut=BLACK))
    add('ne_gg', lambda r: neon('GG', LIME, r, 0.42, script=False, backing=CHARCOAL))
    # YO
    add('bb_yo', lambda r: blockbuster('YO', YELLOW, BLACK, r, 0.6, fill2=ORANGE, shadow=BLOOD, cut=BLACK))
    add('sb_yo', lambda r: speech(['YO'], r, 'shout', fill=YELLOW, height_m=0.2))
    # ethereum
    add('tk_ethereum', lambda r: ticker(['ETHEREUM'], r, color=(0.45, 0.8, 1.0), arrow='up'))
    add('rb_ethereum', lambda r: ribbon('ethereum', LILAC, GRAPE, r, 0.3))
    # crucify him
    add('ps_crucifyhim', lambda r: poster(['CRUCIFY', 'HIM'], r, width_m=1.24, sheet=BLACK, ink=PAPER))
    add('ch_crucifyhim', lambda r: chalk(['crucify him'], r, 0.255, colors=[(0.96, 0.95, 0.9)]))
    # round n round n round
    add('rb_roundnround', lambda r: ribbon('round n round\nn round', TANGERINE, BROWN, r, 0.24))
    add('ne_roundnround', lambda r: neon('round n round n round', HOTPINK, r, 0.2))
    # ah shit here we go again
    add('sb_ahshit', lambda r: speech(['AH SHIT,', 'HERE WE GO', 'AGAIN'], r, 'round', height_m=0.09))
    add('ch_ahshit', lambda r: chalk(['ah shit', 'here we go again'], r, 0.195))
    # GENERATIVE ART
    add('gl_generativeart', lambda r: glitch('GENERATIVE\nART', r, YELLOW, 0.22, kind='mono'))
    add('mo_generativeart', lambda r: mosaic(['GENERATIVE', 'ART'], r, 0.04, 7, colors=(WHITE,), frame=COBALT, back=NAVY))
    # ART
    add('bb_art', lambda r: blockbuster('ART', WHITE, BLACK, r, 0.55, fill2=SILVER, shadow=HOTPINK, cut=BLACK))
    add('ne_art', lambda r: neon('art', CYAN, r, 0.36))
    # shoutout all my furries shoutout all my gays
    add('sc_shoutout', lambda r: sprayed_lines(['shoutout all my furries', 'shoutout all my gays'], [HOTPINK, SKY], r, 0.17,
                                               width_m=0.02,
                                               hearts=1))
    add('sl_shoutout', lambda r: slap('label', r, lines=['shoutout all my furries', 'shoutout all my gays'], size_m=1.15))
    # drilady2
    add('ht_drilady2', lambda r: halftone('drilady2', HOTPINK, r, 0.3, dot=BLOOD, kind='black'))
    add('rb_drilady2', lambda r: ribbon('drilady2', BUBBLEGUM, MAUVE, r, 0.3))
    # ORGANIC EVOLUTION
    add('ps_organicevolution', lambda r: poster(['ORGANIC', 'EVOLUTION'], r, width_m=1.5, font_kind='serif', ink=FOREST,
                                                sheet=CREAM))
    add('ht_organicevolution', lambda r: halftone('ORGANIC\nEVOLUTION', LIME, r, 0.2, dot=FOREST))
    # buy swag coin now
    add('cx_buyswagcoinnow', lambda r: chart(r, words=['buy swag coin now'], up=True))
    add('tk_buyswagcoinnow', lambda r: ticker(['BUY SWAG COIN NOW'], r, color=(0.35, 1.0, 0.45), arrow='up'))
    # i miss hikki
    add('ch_imisshikki', lambda r: chalk(['i miss hikki'], r, 0.24, colors=[CHALK[2]], hearts=1))
    add('sl_imisshikki', lambda r: slap('hello', r, lines=['i miss hikki'], color=COBALT, size_m=0.66))
    # i miss bug
    add('ne_imissbug', lambda r: neon('i miss bug', (1.0, 0.85, 0.3), r, 0.26))
    add('sl_imissbug', lambda r: slap('hello', r, lines=['i miss bug'], color=BLOOD, size_m=0.66))
    # GP85
    add('bb_gp85', lambda r: blockbuster('GP85', SILVER, BLACK, r, 0.5, fill2=WHITE, shadow=BLOOD, cut=None, streak=0.35, drips=0.25))
    add('mo_gp85', lambda r: mosaic(['GP85'], r, 0.064, 7, colors=(ORANGE, YELLOW), shade=BROWN))
    # lamb
    add('ne_lamb', lambda r: neon('lamb', WHITE, r, 0.4, backing=None))
    add('rb_lamb', lambda r: ribbon('lamb', CREAM, BONE, r, 0.42))
    # GUCCI GUCCI LOUISE LOUISE FENDI FENDI PRADA
    add('rn_gucci', lambda r: ransom(['GUCCI GUCCI', 'LOUISE LOUISE', 'FENDI FENDI', 'PRADA'], r, 0.11))
    add('ps_gucci', lambda r: poster(['GUCCI GUCCI', 'LOUISE LOUISE', 'FENDI FENDI', 'PRADA'], r, width_m=1.24, sheet=PAPER,
                                     ink=BLACK, font_kind='serif', line_gap=1.2))
    # lowbie
    add('ht_lowbie', lambda r: halftone('lowbie', SKY, r, 0.34, dot=COBALT, shadow=NAVY))
    add('sl_lowbie', lambda r: slap('vinyl', r, text='lowbie', color=HOTPINK, ink=WHITE, size_m=0.65))
    # FAIRYBABY
    add('ne_fairybaby', lambda r: neon('FAIRYBABY', (1.0, 0.55, 0.9), r, 0.26, script=False))
    add('rb_fairybaby', lambda r: ribbon('FAIRYBABY', MINT, TEAL, r, 0.26, script=False))
    # jared
    add('sl_jared', lambda r: slap('hello', r, lines=['jared'], color=FOREST, size_m=0.62))
    add('ch_jared', lambda r: chalk(['jared'], r, 0.3, colors=[CHALK[3]], underline=True))
    # miles
    add('sl_miles', lambda r: slap('label', r, lines=['MILES'], size_m=0.62))
    add('bb_miles', lambda r: blockbuster('MILES', SKY, NAVY, r, 0.36, fill2=WHITE, shadow=BLACK, cut=NAVY))
    # worm
    add('rb_worm', lambda r: ribbon('worm', (0.95, 0.55, 0.6), OXBLOOD, r, 0.42))
    add('mo_worm', lambda r: mosaic(['WORM'], r, 0.058, 7, colors=(BUBBLEGUM, (0.95, 0.5, 0.6)), shade=OXBLOOD))
    # DIDO
    add('bb_dido', lambda r: blockbuster('DIDO', WHITE, BLACK, r, 0.5, fill2=SKY, shadow=COBALT, cut=BLACK))
    add('ht_dido', lambda r: halftone('DIDO', YELLOW, r, 0.42, dot=ORANGE))
    # TOJI CPU CORP
    add('sg_tojicpucorp', lambda r: sign('plaque', r, words=['TOJIBA', 'CPU CORP'], color=NAVY, cap_m=0.17))
    add('tk_tojicpucorp', lambda r: ticker(['TOJI CPU CORP'], r, color=RED))
    # TEENAGE MUTANT NINJA ARTISTS
    add('ht_tmna', lambda r: halftone('TEENAGE MUTANT\nNINJA ARTISTS', LIME, r, 0.15, dot=FOREST, burst=ORANGE))
    add('sb_tmna', lambda r: speech(['TEENAGE MUTANT', 'NINJA ARTISTS'], r, 'shout', fill=LIME, height_m=0.08))
    # keep spittin' bro
    add('sb_keepspittin', lambda r: speech(["KEEP SPITTIN'", 'BRO'], r, 'round', height_m=0.1, tail='right'))
    add('ch_keepspittin', lambda r: chalk(["keep spittin' bro"], r, 0.225))
    # garlic champions
    add('rb_garlicchampions', lambda r: ribbon('garlic\nchampions', CREAM, GOLD, r, 0.24))
    add('ps_garlicchampions', lambda r: poster(['GARLIC', 'CHAMPIONS'], r, width_m=1.4, sheet=YELLOW, ink=OXBLOOD))
    # GOTTA MINT 'EM ALL
    add('ht_gottamint', lambda r: halftone("GOTTA MINT\n'EM ALL", YELLOW, r, 0.2, dot=GOLD, outline=NAVY, shadow=NAVY))
    add('mo_gottamint', lambda r: mosaic(['GOTTA MINT', "'EM ALL"], r, 0.04, 7, colors=(RED, WHITE), shade=BLACK))
    # BORN TO MON WORLD IS A MANA
    add('ch_borntomon', lambda r: chalk(['BORN TO MON', 'WORLD IS A MANA'], r, 0.18, upper=True))
    add('ps_borntomon', lambda r: poster(['BORN TO MON', 'WORLD IS A MANA'], r, width_m=1.24, sheet=OXBLOOD, ink=PAPER))
    # GAN
    add('gl_gan', lambda r: glitch('GAN', r, LIME, 0.45))
    add('bb_gan', lambda r: blockbuster('GAN', MINT, BLACK, r, 0.55, fill2=TEAL, shadow=WHITE, cut=BLACK))
    # generative adversarial network
    add('gl_gan_long', lambda r: glitch('generative\nadversarial\nnetwork', r, WHITE, 0.15, kind='mono'))
    add('tk_gan_long', lambda r: ticker(['GENERATIVE', 'ADVERSARIAL', 'NETWORK'], r, color=MAGENTA, dot_m=0.022))
    # OLD MODELS :)
    add('mo_oldmodels', lambda r: mosaic(['OLD MODELS :)'], r, 0.048, 7, colors=(SKY, WHITE), shade=NAVY))
    add('sb_oldmodels', lambda r: speech(['OLD MODELS :)'], r, 'round', height_m=0.12))
    # no i did not anticipate this
    add('sb_noididnot', lambda r: speech(['NO I DID NOT', 'ANTICIPATE THIS'], r, 'round', height_m=0.09, tail='right'))
    add('rn_noididnot', lambda r: ransom(['no i did not', 'anticipate this'], r, 0.11))
    # SWAGGOT
    add('bb_swaggot', lambda r: blockbuster('SWAGGOT', GOLD, BLACK, r, 0.38, fill2=YELLOW, shadow=GRAPE, cut=BLACK))
    add('ne_swaggot', lambda r: neon('SWAGGOT', GOLD, r, 0.28, script=False, backing=CHARCOAL))
    # SWAGBOUND
    add('rb_swagbound', lambda r: ribbon('SWAGBOUND', GOLD, BROWN, r, 0.26, script=False))
    add('gl_swagbound', lambda r: glitch('SWAGBOUND', r, GOLD, 0.26))
    # J48BAFORMS
    add('gl_j48baforms', lambda r: glitch('J48BAFORMS', r, MINT, 0.22, kind='mono'))
    add('mo_j48baforms', lambda r: mosaic(['J48BAFORMS'], r, 0.042, 7, colors=(LIME, MINT), frame=CHARCOAL, back=BLACK))
    # BONK
    add('sb_bonk', lambda r: speech(['BONK!'], r, 'shout', fill=ORANGE, height_m=0.2))
    add('ht_bonk', lambda r: halftone('BONK!', RED, r, 0.45, dot=OXBLOOD, shadow=YELLOW))      # (no starburst)
    # the appraisal of this piece...
    add('rn_appraisal', lambda r: ransom(['the appraisal of this piece', 'is approximately',
                                         '100 thousand and ten hundred', 'ethereum coins'], r, 0.075))
    add('ps_appraisal', lambda r: poster(['THE APPRAISAL OF THIS PIECE IS', 'APPROXIMATELY 100 THOUSAND AND',
                                         'TEN HUNDRED ETHEREUM COINS'], r, width_m=1.9, font_kind='libserif', ink=BLACK,
                                        sheet=PAPER, margin=0.06, line_gap=1.35))
    # top speed record 202mph surely i can go faster
    add('sg_topspeed', lambda r: sign('speed', r, top=['TOP SPEED', 'RECORD'], number='202', unit='MPH',
                                      scrawl=['surely i can', 'go faster']))
    add('ch_topspeed', lambda r: chalk(['top speed record 202mph', 'surely i can go faster'], r, 0.165, underline=True))
    # counter-terrorists win! (redone from the earlier batch's throw-up, in a new style)
    add('bb_counterterroristswin', lambda r: blockbuster('COUNTER-\nTERRORISTS WIN!', SKY, NAVY, r, 0.3, fill2=WHITE,
                                                         shadow=BLACK, streak=0.35, drips=0.2))
    # PUMP
    add('cx_pump', lambda r: chart(r, big='PUMP', up=True, n=12))
    add('bb_pump', lambda r: blockbuster('PUMP', LIME, BLACK, r, 0.5, fill2=TOXIC, shadow=FOREST, cut=BLACK))
    # collectooooor
    add('ne_collectooooor', lambda r: neon('collectooooor', SKY, r, 0.24))
    add('rb_collectooooor', lambda r: ribbon('collectooooor', SKY, COBALT, r, 0.24))
    # i'm collecting
    add('sl_imcollecting', lambda r: slap('vinyl', r, text="i'm collecting", color=COBALT, ink=SKY, size_m=0.68, word_kind='bold'))
    add('ch_imcollecting', lambda r: chalk(["i'm collecting"], r, 0.24))
    return P


if __name__ == '__main__':
    import sys, time
    t = time.time()
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    P = build_third(only=only)
    n = M.sheet(P, sys.argv[1] if len(sys.argv) > 1 else 'third_sheet')
    print(len(P), 'pieces', n, 'pages', f'{time.time() - t:.1f}s')
