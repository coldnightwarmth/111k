"""A fourth batch of graffiti for the spray cans: the old families the review liked, plus six new ones, all
painted the way a can does it (soft edges, overspray, a few short runs).

New families:
  airbrush  ab  Coney Island airbrush lettering: soft gradient fill, a halo, a keyline and sparkles
  circle    ci  words sprayed round a ring with something in the middle (a moon, a globe, particle tracks)
  hazard    hz  a sprayed caution panel: black and yellow stripes round stencilled words
  shadow    sh  shadow letters: only the 3D block is painted, the faces left as bare wall with a hairline
  dots      dt  letters filled with big sprayed polka dots inside a thin outline
  vertical  vt  heaven-spot letters stacked one above the other, rollered, with a hard outline
and a crossed-out treatment (struck through or X'd in another colour) for things meant to be gone over.

Run directly for a contact sheet: python3 tools/graffiti_fourth.py [out_prefix] [name-filter]
"""
import math
import zlib
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

import graffiti as G
import graffiti_more as M
import graffiti_third as T
from graffiti_more import (BLACK, WHITE, SILVER, CHARCOAL, BLOOD, OXBLOOD, BONE, HOTPINK, BUBBLEGUM, LILAC, GRAPE, SKY,
                           COBALT, NAVY, TEAL, LIME, TOXIC, FOREST, MINT, YELLOW, GOLD, ORANGE, TANGERINE, RED, CREAM,
                           BROWN, MAUVE, STRAIGHT, WILD, SEMI, ANGTHROW, paint_mask, spray_paths, stack, trim, paste, add_drips)
from graffiti_third import type_masks, crop_masks, dilate, erode, shift, noise, rough, mix, hand_strokes, stroke_mask

PX = G.PX_PER_M
CAUTION = (0.98, 0.8, 0.08)
G.GLYPHS.setdefault('>', [[(0.0, 0.85), (0.45, 0.5), (0.0, 0.15)]])      # (for ASUKA > REI)


def spray(cv, mask, color, r, soft=1.0, mist=1.2, streak=0.2, opacity=1.0):
    if np.any(mask):
        paint_mask(cv, mask.astype(bool), color, r, soft=soft, mist=mist, streak=streak, opacity=opacity)


def runs(cv, color, r, mask=None, rate=0.15, length=0.1):
    """a few short drips, unless this piece has none"""
    if G.NODRIPS:
        return cv
    return add_drips(cv, color, r, rate=rate, max_len_m=length, width_px=2.4, from_mask=mask)


def gradient(h, w, top, bottom, mid=None):
    t = np.linspace(0, 1, h)[:, None, None]
    top, bottom = np.asarray(top, float), np.asarray(bottom, float)
    if mid is not None:
        mid = np.asarray(mid, float)
        g = np.where(t < 0.5, top + (mid - top) * (t * 2), mid + (bottom - mid) * ((t - 0.5) * 2))
    else:
        g = top + (bottom - top) * t
    return np.broadcast_to(g, (h, w, 3)).copy()


def sparkle(cv, cx, cy, size, color, r):
    """a four-point star"""
    im = Image.new('L', (cv.w, cv.h), 0)
    d = ImageDraw.Draw(im)
    s, t = size, size * 0.18
    d.polygon([(cx, cy - s), (cx + t, cy - t), (cx + s, cy), (cx + t, cy + t), (cx, cy + s), (cx - t, cy + t),
               (cx - s, cy), (cx - t, cy - t)], fill=255)
    spray(cv, np.asarray(im) > 127, color, r, soft=0.6, mist=0.4, streak=0)


# ------------------------------------------------------------------ the new families

def airbrush(text, top, bottom, r, height_m=0.3, halo=None, keyline=WHITE, script=True, mid=None, sparkles=3, lines=None,
             kind='black'):
    """Airbrushed T-shirt lettering: a soft halo, letters faded top to bottom, a light keyline, sparkles."""
    hp = height_m * PX
    lines = lines or text.split('\n')
    if script:                             # brush script: the handwriting skeleton, fattened
        pad = int(hp * 0.6)
        paths, (W, H) = hand_strokes(lines, r, hp, pad, slant=0.28, spacing=0.12, bounce=0.05, smooth=3, line_gap=1.5)
        m = stroke_mask(paths, (H, W), hp * 0.17)
    else:
        m = type_masks(lines, kind, hp, r, tracking=0.0, line_gap=1.15, per_letter=False, shear=0.12)[0][0]
        m = crop_masks([m], int(hp * 0.6))[0]
        H, W = m.shape
    cv = G.Canvas(W, H)
    halo = halo if halo is not None else mix(top, WHITE, 0.3)
    glow = ndimage.gaussian_filter(m.astype(float), hp * 0.18) * 2.0
    cv.over(halo, np.clip(glow, 0, 0.7) * (0.75 + 0.25 * (r.random(glow.shape) < np.clip(glow, 0, 1))))
    ys, xs = np.nonzero(m)
    g = gradient(H, W, top, bottom, mid)
    if len(ys):                            # the fade runs over the letters' own height
        t = np.clip((np.arange(H) - ys.min()) / max(1, ys.max() - ys.min()), 0, 1)
        g = gradient(H, W, top, bottom, mid)[np.clip((t * (H - 1)).astype(int), 0, H - 1)]
    if keyline is not None:
        spray(cv, dilate(m, max(1.5, hp * 0.035)), keyline, r, soft=0.8, mist=0.5, streak=0)
    paint_mask(cv, m, g, r, soft=1.1, mist=0.8, streak=0.1)
    for _ in range(sparkles):
        k = r.integers(len(xs)) if len(xs) else 0
        sparkle(cv, xs[k] + r.normal(0, hp * 0.2), ys[k] - hp * r.uniform(0.1, 0.4), hp * r.uniform(0.18, 0.3), WHITE, r)
    return runs(M.grow(cv, bottom=int(PX * 0.1)), bottom, r, rate=0.06)


def circle(words, color, r, radius_m=0.42, middle='moon', ring=True, inner=None, word_cap=0.11, accent=YELLOW):
    """Words sprayed round a ring, something in the middle: 'moon' (a crescent), 'globe' (a globe), 'tracks'
    (particle tracks bursting from a point), or text."""
    R = radius_m * PX
    size = int(R * 2 + PX * 0.3)
    cv = G.Canvas(size, size)
    c = (size / 2, size / 2)
    yy, xx = np.mgrid[:size, :size]
    rr = np.hypot(xx - c[0], yy - c[1])
    if ring:
        spray(cv, np.abs(rr - R * 0.98) < max(2, R * 0.025), color, r, soft=0.9, mist=1.0)
        spray(cv, np.abs(rr - R * 0.62) < max(1.5, R * 0.016), color, r, soft=0.9, mist=1.0)
    T.SPRAY, T._R = True, r
    try:
        top, bottom = words if isinstance(words, (list, tuple)) else (words, None)
        T.arc_text(cv, top, 'black', word_cap * PX, c[0], c[1], R * 0.8, -math.pi / 2, color)
        if bottom:
            T.arc_text(cv, bottom, 'black', word_cap * PX, c[0], c[1], R * 0.8, math.pi / 2, color,
                       inside=True)
    finally:
        T.SPRAY = False
    ri = R * 0.5
    if middle == 'moon':
        disc = rr < ri
        bite = np.hypot(xx - c[0] - ri * 0.45, yy - c[1] + ri * 0.2) < ri * 0.9
        spray(cv, disc & ~bite, accent, r, soft=1.2, mist=1.5)
        for _ in range(4):
            a, d = r.uniform(0, 2 * math.pi), r.uniform(ri * 0.4, ri * 0.9)
            sparkle(cv, c[0] + d * math.cos(a) + ri * 0.4, c[1] + d * math.sin(a), ri * 0.12, WHITE, r)
    elif middle == 'globe':
        spray(cv, rr < ri, inner or COBALT, r, soft=1.2, mist=1.2)
        lines = np.zeros_like(rr, bool)
        for k in (-0.5, 0, 0.5):           # meridians and parallels
            ex = np.hypot((xx - c[0]) / max(1, ri * abs(math.cos(k * math.pi / 2)) + 1e-3), (yy - c[1]) / ri)
            lines |= (np.abs(ex - 1) < 0.04) & (rr < ri)
            lines |= (np.abs(yy - c[1] - k * ri * 0.9) < 1.2) & (rr < ri)
        lines |= np.abs(rr - ri) < 1.5
        spray(cv, lines, accent, r, soft=0.7, mist=0.4)
    elif middle == 'tracks':                # particles curling out from a collision
        paths = []
        for k in range(9):
            a = k * 2 * math.pi / 9 + r.normal(0, 0.2)
            curl = r.choice([-1, 1]) * r.uniform(0.8, 2.2)
            t = np.linspace(0, 1, 30)
            ang = a + curl * t ** 1.5
            rad = ri * 0.95 * t
            paths.append(np.stack([c[0] + rad * np.cos(ang), c[1] + rad * np.sin(ang)], 1))
        spray_paths(cv, paths, accent, r, max(2, PX * 0.012), drips=0, mist=0.8)
        spray(cv, rr < ri * 0.12, WHITE, r, soft=1.0, mist=1.0)
    else:
        m = type_masks([middle], 'black', ri * 0.45, r, per_letter=False)[0][0]
        m = crop_masks([m], 0)[0]
        tmp = np.zeros_like(rr, bool)
        y0, x0 = int(c[1] - m.shape[0] / 2), int(c[0] - m.shape[1] / 2)
        tmp[y0:y0 + m.shape[0], x0:x0 + m.shape[1]] = m[:size - y0, :size - x0]
        spray(cv, tmp, accent, r)
    return runs(M.grow(cv, bottom=int(PX * 0.1)), color, r, rate=0.05)


def hazard(lines, r, width_m=1.2, ink=BLACK, field=CAUTION, stripe=BLACK):
    """A sprayed caution panel: diagonal black/yellow stripes round a yellow field, the words stencilled on."""
    W = int(width_m * PX)
    probe = type_masks(lines, 'black', 100, r, tracking=0.03, line_gap=1.2, per_letter=False)[1]
    border = int(W * 0.07)
    cap = 100 * (W - border * 2 - W * 0.08) / probe[0]
    m = type_masks(lines, 'black', cap, r, tracking=0.03, line_gap=1.2, per_letter=False)[0][0]
    m = crop_masks([m], 0)[0]
    H = int(m.shape[0] + border * 2 + W * 0.08)
    cv = G.Canvas(W + 10, H + 10)
    panel = np.zeros((cv.h, cv.w), bool)
    panel[5:5 + H, 5:5 + W] = True
    panel = rough(panel, r, 1.5, 2.0)
    inner = np.zeros_like(panel)
    inner[5 + border:5 + H - border, 5 + border:5 + W - border] = True
    spray(cv, panel, field, r, soft=1.1, mist=1.4, streak=0.4)
    yy, xx = np.mgrid[:cv.h, :cv.w]
    stripes = (((xx + yy) // max(4, border)) % 2 == 0) & panel & ~inner
    spray(cv, stripes, stripe, r, soft=0.9, mist=0.8, streak=0.2)
    full = np.zeros_like(panel)
    y0, x0 = int(5 + (H - m.shape[0]) / 2), int(5 + (W - m.shape[1]) / 2)
    full[y0:y0 + m.shape[0], x0:x0 + m.shape[1]] = m
    spray(cv, full, ink, r, soft=0.8, mist=0.9, streak=0.1)
    return runs(M.grow(cv, bottom=int(PX * 0.1)), field, r, panel, rate=0.08)


def shadow_letters(text, color, r, height_m=0.45, depth=(0.11, 0.09), hairline=WHITE, kind='black', lines=None,
                   brush=None):
    """Only the 3D block behind each letter is painted; the faces stay bare wall, with a hairline round them."""
    cap = height_m * PX
    if brush:                              # bubble letters off the skeleton
        masks, _ = G.letter_masks(text, r, cap, int(cap * 0.3), fat=0.17, brush=brush, slant=0.12, spacing=0.06)
        masks = [m > 0 if m.dtype != bool else m for m in masks]
    else:
        masks, _ = type_masks(lines or text.split('\n'), kind, cap, r, tracking=0.06, line_gap=1.25, jitter_rot=0.02)
    dx, dy = depth[0] * PX, depth[1] * PX
    masks = crop_masks(masks, int(max(dx, dy) + cap * 0.15 + 6))
    face = np.any(masks, 0)
    block = np.zeros_like(face)
    n = int(max(abs(dx), abs(dy)))
    for k in range(1, n + 1):
        block |= shift(face, dx * k / n, dy * k / n)
    block &= ~face
    cv = G.Canvas(face.shape[1], face.shape[0] + int(PX * 0.12))
    full = lambda m: np.pad(m, ((0, cv.h - face.shape[0]), (0, 0)))
    spray(cv, full(block), color, r, soft=1.0, mist=1.3, streak=0.3)
    # the block's far edge a shade darker, as if it turned away from the light
    far = block & ~shift(face, dx * 0.55, dy * 0.55)
    spray(cv, full(far), mix(color, BLACK, 0.35), r, soft=1.0, mist=0.6, streak=0.2, opacity=0.8)
    if hairline is not None:
        edge = face & ~erode(face, 1.2)
        spray(cv, full(edge), hairline, r, soft=0.6, mist=0.3, streak=0)
    return runs(cv, color, r, full(block), rate=0.1)


def dot_letters(text, colors, r, height_m=0.45, outline=BLACK, brush='round', dot_m=0.05, base=None, lines=None):
    """Bubble letters with a thin sprayed outline, filled with big polka dots in a few colours."""
    hp = height_m * PX
    masks, (w, h) = G.letter_masks(text, r, hp, int(hp * 0.25), fat=0.19, brush=brush, slant=0.08, spacing=0.04)
    masks = [np.asarray(m) > 0 for m in masks]
    u = np.any(masks, 0)
    cv = G.Canvas(u.shape[1], u.shape[0] + int(PX * 0.12))
    full = lambda m: np.pad(m, ((0, cv.h - u.shape[0]), (0, 0)))
    ow = max(2.0, hp * 0.04)
    spray(cv, full(dilate(u, ow)), outline, r, soft=0.9, mist=1.0, streak=0.1)
    yy, xx = np.mgrid[:u.shape[0], :u.shape[1]]
    for i, m in enumerate(masks):
        inner = m & ~dilate(np.any(masks[i + 1:], 0), ow) if i < len(masks) - 1 else m
        spray(cv, full(inner), base or WHITE, r, soft=1.0, mist=0.5, streak=0.2)
    period = dot_m * PX * 1.7
    rad = dot_m * PX / 2
    k = 0
    for gy in np.arange(-period, u.shape[0] + period, period):
        for gx in np.arange(-period, u.shape[1] + period, period):
            cx = gx + (period / 2 if int(gy / period) % 2 else 0) + r.normal(0, 1)
            cy = gy + r.normal(0, 1)
            x0, x1, y0, y1 = int(cx - rad - 2), int(cx + rad + 3), int(cy - rad - 2), int(cy + rad + 3)
            if x1 < 0 or y1 < 0 or x0 >= u.shape[1] or y0 >= u.shape[0]:
                continue
            disc = np.zeros_like(u)
            sl = (slice(max(0, y0), y1), slice(max(0, x0), x1))
            disc[sl] = np.hypot(xx[sl] - cx, yy[sl] - cy) < rad
            disc &= erode(u, ow * 0.5)
            if disc.any():
                spray(cv, full(disc), colors[k % len(colors)], r, soft=0.8, mist=0.3, streak=0)
                k += 1
    return runs(cv, outline, r, full(dilate(u, ow)), rate=0.08)


def vertical(text, fill, outline, r, height_m=0.32, shadow=None, kind='black'):
    """Heaven-spot letters: stacked one under another, square, rollered, a hard outline, a block shadow; each word
    its own column, side by side."""
    cols = [trim(T.blockbuster('\n'.join(w), fill, outline, r, height_m, shadow=shadow, kind=kind, drips=0.12, streak=0.4))
            for w in text.split()]
    out = cols[0]
    for c in cols[1:]:
        out = M.side_by_side(out, c, int(PX * 0.06), 'top')
    return out


def cross_out(cv, r, color=RED, kind='strike', width_m=0.035):
    """Gone over: struck through with two quick lines, or an X across the lot."""
    ys, xs = np.nonzero(cv.a > 0.5)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    if kind == 'x':
        paths = [np.array([(x0, y0), (x1, y1)]), np.array([(x1, y0 + (y1 - y0) * 0.05), (x0, y1)])]
    else:
        my = (y0 + y1) / 2
        paths = [np.array([(x0 - 8, my - (y1 - y0) * 0.08 + r.normal(0, 2)), (x1 + 8, my - (y1 - y0) * 0.12)]),
                 np.array([(x1 + 4, my + (y1 - y0) * 0.1), (x0 - 4, my + (y1 - y0) * 0.06 + r.normal(0, 2))])]
    paths = [np.array([p[0] + (p[1] - p[0]) * t + np.array([0, math.sin(t * 6 + r.random() * 6) * 2]) for t in np.linspace(0, 1, 24)])
             for p in paths]
    spray_paths(cv, paths, color, r, width_m * PX, drips=0.12, mist=1.2)
    return cv


# ------------------------------------------------------------------ the phrases

def rng(name, seed):
    return np.random.default_rng(zlib.crc32(name.encode()) + seed * 104729)


THIRD_FAMILIES = {'bb', 'sl', 'ps', 'rn', 'mo', 'tk', 'ne', 'gl', 'ht', 'ch', 'sb', 'sg', 'cx', 'rb'}


def build_fourth(seed=13, only=None):
    """name -> Canvas, two takes on each phrase: old families and new ones"""
    P = {}

    def add(name, fn):
        if only and not any(o in name for o in only):
            return
        r = rng(name, seed)
        T.SPRAY, T._R = name.split('_')[0] in THIRD_FAMILIES, np.random.default_rng(zlib.crc32(name.encode()) + 23)
        try:
            P[name] = trim(fn(r), 6)
        finally:
            T.SPRAY = False

    # paint me like one of your old models
    add('sc_paintmelike', lambda r: G.scrawl(['paint me like one', 'of your old models'], HOTPINK, r, 0.16, 0.016, drips=0.2))
    add('ab_paintmelike', lambda r: airbrush('paint me like one\nof your old models', BUBBLEGUM, GRAPE, r, 0.18, halo=LILAC))
    # GLUE FACTORY
    add('tu_gluefactory', lambda r: G.piece('GLUE\nFACTORY', WHITE, BLACK, r, 0.42, shadow=SKY, shine=None, **ANGTHROW))
    add('vt_gluefactory', lambda r: vertical('GLUE FACTORY', CREAM, BROWN, r, 0.24, shadow=BLACK))
    # IMAGE COLLIDER
    add('pc_imagecollider', lambda r: G.piece('IMAGE\nCOLLIDER', SKY, BLACK, r, 0.45, fill_style='fade', fill2=GRAPE, shadow=BLACK,
                                             block=NAVY, **SEMI))
    add('ci_imagecollider', lambda r: circle(('IMAGE COLLIDER', None), SKY, r, 0.5, middle='tracks', accent=TANGERINE))
    # BACON
    add('bb_bacon', lambda r: T.blockbuster('BACON', (0.85, 0.35, 0.3), OXBLOOD, r, 0.45, fill2=(0.98, 0.8, 0.7), shadow=BLACK,
                                            streak=0.35, drips=0.2))
    add('dt_bacon', lambda r: dot_letters('BACON', [(0.98, 0.78, 0.68), (0.8, 0.3, 0.25)], r, 0.45, outline=OXBLOOD,
                                          base=(0.9, 0.5, 0.42)))
    # EGGS
    add('tu_eggs', lambda r: G.piece('EGGS', WHITE, BLACK, r, 0.55, shadow=YELLOW, fat=0.2, shine=None))
    add('ab_eggs', lambda r: airbrush('EGGS', WHITE, YELLOW, r, 0.4, halo=GOLD, keyline=ORANGE, script=False))
    # retarded psuedointellectual bullshit (spelled as given)
    add('sc_psuedointellectual', lambda r: G.scrawl(['retarded', 'psuedointellectual', 'bullshit'], BLACK, r, 0.15, 0.015, drips=0.25))
    add('pl_psuedointellectual', lambda r: M.placa('RETARDED\nPSUEDOINTELLECTUAL\nBULLSHIT', BLACK, r, 0.16, shadow=BLOOD))
    # nice jpg bro
    add('sb_nicejpgbro', lambda r: T.speech(['NICE JPG BRO'], r, 'round', height_m=0.11))
    add('mk_nicejpgbro', lambda r: G.marker('', BLACK, r, 0.16, lines=['nice jpg bro']))
    # CAP
    add('bb_cap', lambda r: T.blockbuster('CAP', BLOOD, BLACK, r, 0.6, fill2=RED, shadow=WHITE, streak=0.35, drips=0.2))
    add('sh_cap', lambda r: shadow_letters('CAP', COBALT, r, 0.55))
    # schizocollage (crossed out)
    add('tag_schizocollage_x', lambda r: cross_out(G.tag('schizocollage', BLACK, r, height_m=0.32, width_m=0.02), r, RED, 'strike'))
    add('tu_schizocollage_x', lambda r: cross_out(G.piece('SCHIZO\nCOLLAGE', LILAC, BLACK, r, 0.38, shadow=BLACK, shine=None,
                                                         **ANGTHROW), r, BLACK, 'x', 0.045))
    # ARTIFICIAL SWAG INTELLIGENCE
    add('ol_artificialswag', lambda r: M.outline3d('ARTIFICIAL\nSWAG\nINTELLIGENCE', BLACK, r, 0.26, fill=GOLD, block_fill=None))
    add('gl_artificialswag', lambda r: T.glitch('ARTIFICIAL SWAG\nINTELLIGENCE', r, GOLD, 0.2))
    # someone who admires god
    add('ab_admiresgod', lambda r: airbrush('someone who\nadmires god', WHITE, GOLD, r, 0.2, halo=SKY, keyline=None, sparkles=5))
    add('sn_admiresgod', lambda r: M.cutstencil('SOMEONE WHO\nADMIRES GOD', BLACK, r, 0.15, fade=0.05))
    # sometimes we're all gay
    add('ch_sometimesgay', lambda r: T.chalk(["sometimes we're", 'all gay'], r, 0.2))
    add('bf_sometimesgay', lambda r: M.busflow("SOMETIMES WE'RE ALL GAY", HOTPINK, r, 0.24, 0.015, outline=BLACK))
    # GAYMER
    add('pc_gaymer', lambda r: G.piece('GAYMER', HOTPINK, BLACK, r, 0.5, fill_style='stripes', fill2=SKY, shadow=BLACK, block=GRAPE,
                                       **SEMI))
    add('dt_gaymer', lambda r: dot_letters('GAYMER', [RED, ORANGE, YELLOW, LIME, SKY, GRAPE], r, 0.42))
    # moooon
    add('ci_moooon', lambda r: circle(('moooon', None), (0.9, 0.9, 1.0), r, 0.42, middle='moon', accent=CREAM))
    add('tu_moooon', lambda r: G.piece('MOOOON', CREAM, NAVY, r, 0.45, fill_style='galaxy', shadow=BLACK, fat=0.18))
    # hehe
    add('tag_hehe', lambda r: G.tag('hehe', BLACK, r, height_m=0.35, width_m=0.022, flourish='dots'))
    add('sh_hehe', lambda r: shadow_letters('HEHE', HOTPINK, r, 0.45, brush='round'))
    # damn bro
    add('sb_damnbro', lambda r: T.speech(['DAMN BRO'], r, 'shout', fill=WHITE, height_m=0.14))
    add('bf_damnbro', lambda r: M.busflow('DAMN BRO', COBALT, r, 0.32, 0.018))
    # flipper
    add('bf_flipper', lambda r: M.busflow('FLIPPER', TEAL, r, 0.34, 0.018, outline=BLACK))
    add('vt_flipper', lambda r: vertical('FLIPPER', SKY, NAVY, r, 0.24, shadow=WHITE))
    # certified bullshit
    add('sn_certifiedbullshit', lambda r: M.cutstencil('CERTIFIED\nBULLSHIT', BLOOD, r, 0.18, fade=0.05))
    add('hz_certifiedbullshit', lambda r: hazard(['CERTIFIED', 'BULLSHIT'], r, 1.0))
    # oh! a twitter notification lfg
    add('sb_twitternotif', lambda r: T.speech(['OH! A TWITTER', 'NOTIFICATION', 'LFG'], r, 'shout', fill=SKY, height_m=0.1))
    add('mk_twitternotif', lambda r: G.marker('', BLACK, r, 0.12, lines=['oh! a twitter notification', 'lfg']))
    # we're never minting out
    add('rl_nevermintingout', lambda r: G.roller("WE'RE NEVER\nMINTING OUT", BLACK, r, 0.35))
    add('sc_nevermintingout', lambda r: G.scrawl(["we're never minting out"], MINT, r, 0.17, 0.017, drips=0.2))
    # SPIKY
    add('pc_spiky', lambda r: G.piece('SPIKY', TOXIC, BLACK, r, 0.55, fill_style='fade', fill2=LIME, shadow=BLACK, **WILD))
    add('sh_spiky', lambda r: shadow_letters('SPIKY', LIME, r, 0.5))
    # SQUISHY
    add('tu_squishy', lambda r: G.piece('SQUISHY', BUBBLEGUM, BLACK, r, 0.5, shadow=HOTPINK, fat=0.22, smooth=4, shine=WHITE))
    add('dt_squishy', lambda r: dot_letters('SQUISHY', [HOTPINK, LILAC, MINT], r, 0.42, base=BUBBLEGUM))
    # i'm secretly a famous artist
    add('sc_secretlyfamous', lambda r: G.scrawl(["i'm secretly a", 'famous artist'], BLACK, r, 0.16, 0.016, drips=0.2))
    add('ch_secretlyfamous', lambda r: T.chalk(["i'm secretly a", 'famous artist'], r, 0.2))
    # ASUKA > REI
    add('bb_asukarei', lambda r: T.blockbuster('ASUKA > REI', RED, BLACK, r, 0.4, fill2=BLOOD, shadow=ORANGE, streak=0.35, drips=0.2))
    add('mk_asukarei', lambda r: G.marker('', BLOOD, r, 0.17, lines=['ASUKA > REI']))
    # LSW
    add('tu_lsw', lambda r: G.piece('LSW', SILVER, BLACK, r, 0.6, fill_style='chrome', shadow=BLACK, block=COBALT, shine=None,
                                    **STRAIGHT))
    add('sh_lsw', lambda r: shadow_letters('LSW', GOLD, r, 0.6))
    # it's a swag world after all
    add('ab_swagworld', lambda r: airbrush("it's a swag world\nafter all", GOLD, ORANGE, r, 0.2, halo=YELLOW))
    add('ci_swagworld', lambda r: circle(("IT'S A SWAG WORLD", 'AFTER ALL'), GOLD, r, 0.48, middle='globe', accent=YELLOW,
                                         inner=COBALT))
    # TRADING ROOM FLOOR
    add('cx_tradingroomfloor', lambda r: T.chart(r, big='TRADING ROOM FLOOR', up=False, n=16))
    add('pl_tradingroomfloor', lambda r: M.placa('TRADING\nROOM FLOOR', BLACK, r, 0.22, shadow=BLOOD))
    # SPX111111
    add('tk_spx111111', lambda r: T.ticker(['SPX111111'], r, color=(0.35, 1.0, 0.45), arrow='up'))
    add('bb_spx111111', lambda r: T.blockbuster('SPX111111', LIME, BLACK, r, 0.36, fill2=TOXIC, shadow=FOREST, streak=0.35, drips=0.2))
    # NEVER RIP
    add('rl_neverrip', lambda r: G.roller('NEVER RIP', BLOOD, r, 0.45))
    add('vt_neverrip', lambda r: vertical('NEVER RIP', WHITE, BLACK, r, 0.26, shadow=BLOOD))
    # #tbh
    add('tag_tbh', lambda r: G.tag('#tbh', BLACK, r, height_m=0.35, width_m=0.022, flourish='underline'))
    add('mk_tbh', lambda r: G.marker('', COBALT, r, 0.2, lines=['#tbh']))
    # we would like to take a moment to acknowledge that we are standing on stolen images
    add('ps_stolenimages', lambda r: T.poster(['WE WOULD LIKE TO TAKE A MOMENT', 'TO ACKNOWLEDGE THAT WE ARE',
                                               'STANDING ON STOLEN IMAGES'], r, width_m=1.7, sheet=CREAM, ink=BLACK, line_gap=1.25))
    add('sc_stolenimages', lambda r: G.scrawl(['we would like to take a moment', 'to acknowledge that we are standing',
                                              'on stolen images'], BLACK, r, 0.12, 0.013, drips=0.15))
    # DO NOT ENTER THE PORTAL
    add('hz_donotenter', lambda r: hazard(['DO NOT ENTER', 'THE PORTAL'], r, 1.2))
    add('sn_donotenter', lambda r: M.cutstencil('DO NOT ENTER\nTHE PORTAL', BLACK, r, 0.16, fade=0.05))
    # the other side has some dope art bro you should visit sometime
    add('ch_otherside', lambda r: T.chalk(['the other side has some dope art bro', 'you should visit sometime'], r, 0.15))
    add('sb_otherside', lambda r: T.speech(['THE OTHER SIDE HAS SOME', 'DOPE ART BRO YOU SHOULD', 'VISIT SOMETIME'], r, 'round',
                                           height_m=0.085, tail='right'))
    # DRI YOUR TEARS YOUNG FELLA
    add('pc_driyourtears', lambda r: G.piece('DRI YOUR TEARS\nYOUNG FELLA', SKY, NAVY, r, 0.3, fill_style='fade', fill2=WHITE,
                                             shadow=BLACK, shine=WHITE, fat=0.15))
    add('ab_driyourtears', lambda r: airbrush('dri your tears\nyoung fella', SKY, COBALT, r, 0.2, halo=(0.7, 0.85, 1.0)))
    # look up
    add('ab_lookup', lambda r: airbrush('look up', WHITE, SKY, r, 0.28, halo=(0.8, 0.9, 1.0), sparkles=4))
    add('tag_lookup', lambda r: G.tag('look up', BLACK, r, height_m=0.32, width_m=0.02, flourish='star'))
    # SOURCE
    add('ol_source', lambda r: M.outline3d('SOURCE', BLACK, r, 0.4, fill=TEAL, block_fill=None))
    add('dt_source', lambda r: dot_letters('SOURCE', [WHITE, SKY], r, 0.4, base=TEAL))
    # read rudolf steiner
    add('sn_rudolfsteiner', lambda r: M.cutstencil('READ\nRUDOLF STEINER', BLACK, r, 0.16, fade=0.05))
    add('ch_rudolfsteiner', lambda r: T.chalk(['read rudolf steiner'], r, 0.2))
    # FRAZETTA
    add('pl_frazetta', lambda r: M.placa('FRAZETTA', BLACK, r, 0.3, shadow=GOLD))
    add('sh_frazetta', lambda r: shadow_letters('FRAZETTA', BLOOD, r, 0.4))
    return P


if __name__ == '__main__':
    import sys, time
    t = time.time()
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    P = build_fourth(only=only)
    n = M.sheet(P, sys.argv[1] if len(sys.argv) > 1 else 'fourth_sheet')
    print(len(P), 'pieces', n, 'pages', f'{time.time() - t:.1f}s')
