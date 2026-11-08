"""More graffiti for the spray cans: new handstyle families on top of tools/graffiti.py, and the batch of
phrases that use them. These pieces aren't painted onto the walls; they go on their own atlas
(assets/env/world-tags*.webp, see tools/graffiti_tags.py) and only show up in the spray-can list.

Styles added here, after the regional handstyles writers actually use:
  placa    LA cholo block letters: tall, straight, flat-nib strokes with sharp serifs, crisp and even
  wicket   Philly handstyle: very tall, narrow one-line letters, hooked "wickets" off the tops, bars through it
  busflow  Bay Area busflow: round, equal-height letters run together in one line, loops on the corners
  mop      a drip mop: thick, wet ink that runs in long drips
  script   brush script: joined-up lowercase, thick downstrokes, thin upstrokes
  outline  a hollow throw: straight letters outlined only, with a hatched 3D block
plus hearts with initials, a black square and a ring of squares.

Run directly for a contact sheet: python3 tools/graffiti_more.py [out_prefix] [name-filter]
"""
import math
import zlib
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

import graffiti as G

PX = G.PX_PER_M


# ------------------------------------------------------------------ canvas helpers
def grow(cv, top=0, bottom=0, left=0, right=0):
    """A copy of the canvas with transparent margins added."""
    top, bottom, left, right = int(top), int(bottom), int(left), int(right)
    out = G.Canvas(cv.w + left + right, cv.h + top + bottom)
    out.rgb[top:top + cv.h, left:left + cv.w] = cv.rgb
    out.a[top:top + cv.h, left:left + cv.w] = cv.a
    return out


def paste(dst, src, x, y):
    """Composite src over dst with its top-left at (x, y)."""
    x, y = int(round(x)), int(round(y))
    x0, y0, x1, y1 = max(0, x), max(0, y), min(dst.w, x + src.w), min(dst.h, y + src.h)
    if x1 <= x0 or y1 <= y0:
        return
    sa = src.a[y0 - y:y1 - y, x0 - x:x1 - x]
    srgb = src.rgb[y0 - y:y1 - y, x0 - x:x1 - x]
    da, drgb = dst.a[y0:y1, x0:x1], dst.rgb[y0:y1, x0:x1]
    oa = sa + da * (1 - sa)
    num = srgb * sa[..., None] + drgb * (da * (1 - sa))[..., None]
    dst.rgb[y0:y1, x0:x1] = np.where(oa[..., None] > 1e-6, num / np.maximum(oa, 1e-6)[..., None], drgb)
    dst.a[y0:y1, x0:x1] = oa


def stack(parts, gap_px=0, align='center'):
    """Canvases one above the other."""
    W = max(c.w for c in parts)
    H = sum(c.h for c in parts) + gap_px * (len(parts) - 1)
    out = G.Canvas(W, H)
    y = 0
    for c in parts:
        x = (W - c.w) / 2 if align == 'center' else 0 if align == 'left' else W - c.w
        paste(out, c, x, y)
        y += c.h + gap_px
    return out


def trim(cv, pad=6):
    ys, xs = np.nonzero(cv.a > 0.01)
    if not len(xs):
        return cv
    y0, y1 = max(0, ys.min() - pad), min(cv.h, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(cv.w, xs.max() + pad + 1)
    out = G.Canvas(x1 - x0, y1 - y0)
    out.rgb, out.a = cv.rgb[y0:y1, x0:x1].copy(), cv.a[y0:y1, x0:x1].copy()
    return out


def add_drips(cv, color, r, rate=0.5, max_len_m=0.3, width_px=3.0, opacity=0.95, from_mask=None):
    """Paint running down from the bottom edges of what's on the canvas: thin runs ending in a bead.
    rate is roughly drips per 10 cm of bottom edge."""
    m = (cv.a > 0.55) if from_mask is None else from_mask
    edge = m & ~np.vstack([m[1:], np.zeros((1, m.shape[1]), bool)])
    ys, xs = np.nonzero(edge)
    if not len(xs):
        return cv
    n = int(rate * len(xs) / (PX * 0.1) * max(1.0, width_px) / 3 + r.random())
    lens = [(r.uniform(0.08, 1) ** 2) * max_len_m * PX + width_px * 2 for _ in range(n)]
    if G.NODRIPS:     # remade without drips: nothing runs (only the fine grain of the wall texture after this differs)
        return cv
    need = int(max(lens or [0]) + width_px * 3 + 4)
    lowest = ys.max() if len(ys) else 0
    if lowest + need > cv.h:
        cv = grow(cv, bottom=lowest + need - cv.h)
    img = Image.new('L', (cv.w, cv.h), 0)
    d = ImageDraw.Draw(img)
    for k, L in zip(r.integers(len(xs), size=n), lens):
        x, y = float(xs[k]), float(ys[k])
        wd = max(1.0, width_px * r.uniform(0.6, 1.1))
        pts, yy = [(x, y - wd)], y
        while yy < y + L:
            yy += 2.5; x += r.uniform(-0.18, 0.18); pts.append((x, yy))
        for i in range(len(pts) - 1):
            taper = 1 - 0.45 * i / max(1, len(pts))
            d.line([pts[i], pts[i + 1]], fill=235, width=max(1, int(round(wd * taper))))
        bx, by = pts[-1]
        rb = wd * 0.75
        d.ellipse((bx - rb, by - rb * 0.5, bx + rb, by + rb * 1.3), fill=250)
    a = ndimage.gaussian_filter(np.asarray(img, float) / 255, 0.6) * opacity
    cv.over(np.asarray(color, float), a)
    return cv


def paint_mask(cv, mask, color, r, soft=0.8, mist=1.0, streak=0.0, opacity=1.0):
    """Fill a shape the way a can does it slowly and carefully: a crisp-ish edge, faint overspray dots."""
    m = mask.astype(float)
    alpha = np.clip(ndimage.gaussian_filter(m, soft) * 1.15, 0, 1)
    if streak:
        s = ndimage.gaussian_filter(r.random(m.shape), (1.2, 7))
        s = (s - s.mean()) / (s.std() + 1e-9)
        alpha *= np.clip(1 - streak * np.clip(s, 0, 3) * 0.35, 0, 1)
    if mist:
        wide = ndimage.gaussian_filter(m, max(2.0, soft * 6))
        dots = r.random(m.shape) < np.clip(wide * 0.05 * mist, 0, 0.15)
        alpha = np.maximum(alpha, dots * r.uniform(0.2, 0.6, m.shape))
        alpha = np.maximum(alpha, np.clip(wide * 0.05 * mist, 0, 0.07))
    cv.over(np.asarray(color, float) * (0.97 + 0.06 * r.random(m.shape + (1,))), alpha * opacity)


def spray_paths(cv, paths, color, r, width_px, flow=1.0, drips=1.0, mist=1.0, marker=False, opacity=1.0):
    can = G.Can(cv, color, width_px, r, flow=flow, drips=drips, mist=mist, marker=marker)
    for p in paths:
        can.stroke(p, flow=r.uniform(0.88, 1.12))
    can.spray(opacity=opacity)


def lines_layout(text, r, line_gap, indent=0.0, **kw):
    """layout() for several lines (split on \\n), per letter, stacked."""
    letters = []
    for li, line in enumerate(text.split('\n')):
        ll = G.layout(line, r, per_letter=True, **kw)
        for l in ll:
            for st in l:
                st[:, 1] -= li * line_gap
                st[:, 0] += li * indent
        letters += ll
    return letters


# ------------------------------------------------------------------ placa (LA cholo block letters)
def placa(text, color, r, height_m=0.35, nib=0.2, angle=0.12, shadow=None, shadow_off=(0.08, 0.07), underline=False,
          condense=0.9, stretch=1.45, spacing=0.18, drips=0.15):
    """Straight, tall, evenly spaced capitals pulled with a flat nib held nearly level (fat verticals, thin
    horizontals), every stem finished with a pointed serif. Done slowly: crisp, almost no overspray."""
    hp = height_m * PX
    gap = 1.25 * stretch + 0.5
    letters = lines_layout(text.upper(), r, gap, slant=0.0, bounce=0.0, spacing=spacing, jitter=0.01, scale_var=0.0,
                           smooth=0, condense=condense, min_width=0.42)
    letters = G.shape_letters(letters, r, angular=0.07, stretch=(0.9, stretch))
    strokes = [s for l in letters for s in l]
    if underline:
        lo, hi = G.bounds(strokes)
        strokes.append(np.array([(lo[0] - 0.1, lo[1] - 0.28), (hi[0] + 0.1, lo[1] - 0.28)]))
    pad = int(hp * (0.5 + nib))
    cv, origin = G.fit_canvas(strokes, hp, pad)
    ss = 2
    img = Image.new('L', (cv.w * ss, cv.h * ss), 0)
    d = ImageDraw.Draw(img)
    nv = np.array([math.cos(angle), -math.sin(angle)]) * nib * hp * ss / 2
    for p in G.to_px(strokes, hp, origin):
        p = p * ss
        pts, s_, L = G.resample(p, 1.5)
        for k in range(len(pts) - 1):
            a, b = pts[k], pts[k + 1]
            d.polygon([tuple(a - nv), tuple(a + nv), tuple(b + nv), tuple(b - nv)], fill=255)
        d.line([tuple(q) for q in p], fill=255, width=max(2, int(nib * hp * ss * 0.42)), joint='curve')   # hairlines stay solid
        # pointed serifs: a flat wedge across each end of a mostly-vertical stroke
        for end, nxt in ((p[0], p[min(1, len(p) - 1)]), (p[-1], p[max(0, len(p) - 2)])):
            dv = nxt - end
            if np.linalg.norm(dv) < 1e-6 or abs(dv[1]) < abs(dv[0]) * 1.2:
                continue
            into = np.sign(dv[1])            # +1: the stroke goes down from this end (y down in pixels)
            Lh = nib * hp * ss * 0.62
            t = nib * hp * ss * 0.5
            d.polygon([(end[0] - Lh, end[1]), (end[0] + Lh, end[1]), (end[0] + nv[0] * 0.6, end[1] + into * t)], fill=255)
    mask = np.asarray(img.resize((cv.w, cv.h), Image.LANCZOS), float) / 255 > 0.5
    if shadow is not None:   # a thin offset line in another colour, behind
        o = (int(shadow_off[0] * hp), int(shadow_off[1] * hp))
        sh = np.roll(np.roll(ndimage.binary_dilation(mask, iterations=max(1, int(hp * 0.02))), o[1], 0), o[0], 1) & ~ndimage.binary_dilation(mask, iterations=1)
        paint_mask(cv, sh, shadow, r, soft=0.7, mist=0.3)
    paint_mask(cv, mask, color, r, soft=0.7, mist=0.35, streak=0.1)
    if drips:
        cv = add_drips(cv, color, r, rate=drips, max_len_m=0.12, width_px=max(1.5, hp * 0.025))
    G.porous(cv, r, 0.25)
    return cv


# ------------------------------------------------------------------ wickets (Philly handstyle)
def wicket(text, color, r, height_m=0.5, width_m=0.013, bars=1, outline=None, drips=0.3, curls=True):
    """Very tall, narrow capitals done in one go: sharp corners, hooked curls ('wickets') off the tops of
    the stems, and a long bar run straight through the whole word."""
    hp = height_m * PX
    letters = lines_layout(text.upper(), r, 2.5, slant=r.uniform(0.04, 0.14), bounce=0.04, spacing=r.uniform(-0.02, 0.04),
                           jitter=0.02, scale_var=0.05, smooth=0, condense=0.62, min_width=0.45)
    letters = G.shape_letters(letters, r, angular=0.04, stretch=(0.9, 2.0), rot_var=0.03)
    strokes = []
    side = 1 if r.random() < 0.5 else -1
    for l in letters:
        top = max(st[:, 1].max() for st in l)
        curled = False
        for st in l:
            st = st.copy()
            for end in (-1, 0):
                p = st[end]
                if not curled and p[1] > top - 0.12 and r.random() < 0.7:
                    a = np.linspace(0, 1.7 * math.pi, 14)
                    rad = r.uniform(0.06, 0.1)
                    curl = p + np.stack([side * rad * np.sin(a), rad * (1 - np.cos(a))], 1)
                    if curls:   # (without them, the same random numbers are still drawn: the letters come out the same)
                        st = np.vstack([st, curl[1:]]) if end == -1 else np.vstack([curl[::-1][:-1], st])
                    curled = True
            strokes.append(st)
    first = [st for st in strokes if st[:, 1].mean() > -0.5] or strokes    # the bar goes through the first line
    lo, hi = G.bounds(first)
    for k in range(bars):
        y = r.uniform(lo[1] + (hi[1] - lo[1]) * 0.3, lo[1] + (hi[1] - lo[1]) * 0.75)
        x0, x1 = lo[0] - r.uniform(0.05, 0.25), hi[0] + r.uniform(0.2, 0.5)
        bar = np.array([(x0, y), (x1, y + r.uniform(-0.04, 0.04))])
        strokes.append(np.vstack([bar, bar[-1] + (0.0, 0.18)]))      # a small tick down at the end
    pad = int(hp * 0.25 + PX * 0.06)
    cv, origin = G.fit_canvas(strokes, hp, pad)
    paths = G.to_px(strokes, hp, origin)
    if outline is not None:
        spray_paths(cv, paths, outline, r, width_m * PX * 2.6, flow=0.9, drips=0.4)
    spray_paths(cv, paths, color, r, width_m * PX, flow=1.05, drips=drips)
    G.porous(cv, r, 0.2)
    return trim(cv)


# ------------------------------------------------------------------ busflow (Bay Area)
def _loops(st, r, chance, rad):
    """Swap sharp corners for small loops."""
    if len(st) < 3:
        return st
    out = [st[0]]
    for k in range(1, len(st) - 1):
        v, a, b = st[k], st[k - 1], st[k + 1]
        din, dout = v - a, b - v
        n1, n2 = np.linalg.norm(din), np.linalg.norm(dout)
        if n1 < 1e-6 or n2 < 1e-6:
            continue
        din, dout = din / n1, dout / n2
        turn = math.acos(np.clip(np.dot(din, dout), -1, 1))
        if turn > 1.4 and r.random() < chance:
            u = din - dout
            u /= np.linalg.norm(u) + 1e-9
            c = v + u * rad
            a0 = math.atan2(v[1] - c[1], v[0] - c[0])
            sgn = 1 if din[0] * dout[1] - din[1] * dout[0] < 0 else -1
            t = a0 + sgn * np.linspace(0, 2 * math.pi, 12)
            out += list(np.stack([c[0] + rad * np.cos(t), c[1] + rad * np.sin(t)], 1))
        else:
            out.append(v)
    out.append(st[-1])
    return np.array(out)


def scratch2(text, r, height_m=0.12, color=(0.92, 0.92, 0.88), glyphs=None, line_gap=1.6):
    """Scratchiti as in graffiti.scratch, steadier (letters stay legible), over one or more lines."""
    hp = height_m * PX
    letters = lines_layout(text, r, line_gap, indent=0.15, slant=0.2, bounce=0.06, spacing=0.14, jitter=0.035, smooth=0,
                           condense=0.85, glyphs=glyphs)
    strokes = [s_ for l in letters for s_ in l]
    pad = int(hp * 0.4)
    cv, origin = G.fit_canvas(strokes, hp, pad)
    can = G.Can(cv, color, 1.6, r, marker=True)
    for p in G.to_px(strokes, hp, origin):
        for k in range(2):
            can.stroke(p + r.normal(0, 0.5, p.shape))
    can.spray(opacity=0.75)
    return cv


def busflow(text, color, r, height_m=0.3, width_m=0.017, loops=0.3, outline=None, drips=0.5, underline=True, lift=False):
    """Round, even-height capitals run together in one line, the pen hardly leaving the wall, with loops
    where the corners would be."""
    hp = height_m * PX
    letters = lines_layout(text.upper(), r, 1.7, slant=r.uniform(0.25, 0.4), bounce=0.02, spacing=-0.07, jitter=0.012,
                           scale_var=0.02, smooth=0, condense=0.8)
    lines, cur, prev_y = [], [], None
    for l in letters:
        y = np.vstack(l)[:, 1].mean()
        if prev_y is not None and abs(y - prev_y) > 0.9:
            lines.append(cur); cur = []
        prev_y = y
        cur.append(l)
    lines.append(cur)
    strokes = []
    for line in lines:
        path = []
        for l in line:
            l = [_loops(st, r, loops, r.uniform(0.04, 0.06)) for st in l]
            # the pen runs on from the last letter into this one; the letter's other strokes are quick lifts
            first = min(range(len(l)), key=lambda k: l[k][0][0])
            base = np.vstack(l)[:, 1].min()
            if lift and path and path[-1][1] - base > 0.35:
                # the last letter finished up high (P, R's bowl): lift off, or the run-in reads as a leg
                strokes.append(G.chaikin(np.array(path), 3)); path = []
            if path:
                a, b = np.array(path[-1]), l[first][0]
                path += [(a + b) / 2 + (0, r.uniform(-0.1, 0.05))]
            path += list(l[first])
            strokes += [G.chaikin(st, 3) for k, st in enumerate(l) if k != first]
        strokes.insert(len(strokes) - 0, G.chaikin(np.array(path), 3))
    lo, hi = G.bounds(strokes)
    if underline:   # the line carries on under the word and swings back
        end = strokes[-1][-1]
        swing = np.array([end, end + (0.25, -0.25), (hi[0] * 0.6, lo[1] - 0.22), (lo[0] + 0.1, lo[1] - 0.12)])
        strokes[-1] = np.vstack([strokes[-1], G.chaikin(swing, 3)])
    pad = int(hp * 0.3 + PX * 0.05)
    cv, origin = G.fit_canvas(strokes, hp, pad)
    paths = G.to_px(strokes, hp, origin)
    if outline is not None:
        spray_paths(cv, paths, outline, r, width_m * PX * 2.5, flow=0.9, drips=0.4)
    spray_paths(cv, paths, color, r, width_m * PX, flow=1.0, drips=drips)
    G.porous(cv, r, 0.2)
    return trim(cv)


# ------------------------------------------------------------------ mop
def mop(text, color, r, height_m=0.45, width_m=0.032, style='flow', drip_rate=1.6, drip_len=0.45, lines=None):
    """A drip mop: a fat felt tip of runny ink. The line is solid and glossy, a touch see-through where it
    went on thin, and every slow spot sends ink running a long way down."""
    hp = height_m * PX
    rows = (lines or [text])
    parts = []
    for row in rows:
        strokes = G.handstyle(row, r, style)
        pad = int(hp * 0.25 + width_m * PX * 2)
        cv, origin = G.fit_canvas(strokes, hp, pad)
        can = G.Can(cv, color, width_m * PX, r, marker=True)
        for p in G.to_px(strokes, hp, origin):
            can.stroke(p, flow=r.uniform(0.9, 1.1), hesitate=1.6)
        dens = ndimage.gaussian_filter(can.dep, can.sigma) * (2.5066 * can.sigma)
        can.spray()
        cv.a = np.clip(cv.a * 1.1, 0, 0.97)
        pool = np.clip((dens - 1.4) * 0.5, 0, 0.35)        # darker where it pooled
        cv.rgb = cv.rgb * (1 - pool[..., None])
        parts.append(cv)
    cv = stack(parts, int(hp * 0.15), 'left') if len(parts) > 1 else parts[0]
    cv = add_drips(cv, np.asarray(color) * 0.92, r, rate=drip_rate, max_len_m=drip_len, width_px=max(2.0, width_m * PX * 0.45))
    G.porous(cv, r, 0.15)
    return trim(cv)


# ------------------------------------------------------------------ brush script
def script(text, color, r, height_m=0.2, width_m=0.034, slant=0.3, swash=True, mist=0.8, drips=0.35, outline=None,
           line_gap=1.75):
    """Joined-up lowercase, the letters of each word linked in one movement; downstrokes come out fat and
    upstrokes thin, like a brush or a fat cap leaned on and lifted."""
    hp = height_m * PX
    strokes = []
    for li, line in enumerate(text.split('\n')):
        xoff = li * 0.4
        x = 0.0
        for word in line.split(' '):
            if not word:
                continue
            ll = G.layout(word, r, slant=slant, bounce=0.05, spacing=-0.02, jitter=0.02, scale_var=0.08, smooth=0,
                          condense=0.95, per_letter=True)
            if not ll:
                continue
            for l in ll:
                for st in l:
                    st[:, 0] += x + xoff
                    st[:, 1] -= li * line_gap
            main, extras = [], []
            for l in ll:
                lens = [np.linalg.norm(np.diff(s, axis=0), axis=1).sum() for s in l]
                k = int(np.argmax(lens))
                for j, s in enumerate(l):
                    (main if j == k or lens[j] > 0.5 else extras).append(s)
            path = list(main[0])
            for s in main[1:]:
                a, b = np.array(path[-1]), s[0]
                path += [a + (b - a) * 0.5 + (0, -0.06)]
                path += list(s)
            strokes.append(G.chaikin(np.array(path), 3))
            strokes += [G.chaikin(s, 2) for s in extras]
            w = np.vstack([s for l in ll for s in l])[:, 0].max()
            x = w - xoff + 0.38
    if swash:
        lo, hi = G.bounds(strokes)
        end = strokes[0][-1] if len(strokes) == 1 else strokes[-1][-1]
        strokes.append(G.chaikin(np.array([(hi[0] + 0.1, lo[1] + 0.05), (hi[0] * 0.7, lo[1] - 0.18), (lo[0] + 0.3, lo[1] - 0.12),
                                           (lo[0], lo[1] + 0.02)]), 3))
    pad = int(hp * 0.5 + PX * 0.05)
    cv, origin = G.fit_canvas(strokes, hp, pad)
    ss = 2
    img = Image.new('L', (cv.w * ss, cv.h * ss), 0)
    d = ImageDraw.Draw(img)
    wmax = width_m * PX * ss / 2
    for p in G.to_px(strokes, hp, origin):
        pts, s_, L = G.resample(p * ss, 1.2)
        if len(pts) < 2:
            continue
        dv = np.gradient(pts, axis=0)
        dv /= np.linalg.norm(dv, axis=1, keepdims=True) + 1e-9
        down = np.clip(dv[:, 1], 0, 1) ** 0.8          # y grows downwards here
        f = ndimage.gaussian_filter1d(0.22 + 0.78 * down ** 0.7, 4)
        t = s_ / max(L, 1)
        f *= np.clip(np.minimum(t * L / (wmax * 3), (1 - t) * L / (wmax * 5)) + 0.35, 0, 1)
        for (x, y), k in zip(pts, f):
            rr = max(0.8, wmax * k)
            d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=255)
    mask = np.asarray(img.resize((cv.w, cv.h), Image.LANCZOS), float) / 255 > 0.45
    if outline is not None:
        paint_mask(cv, ndimage.binary_dilation(mask, iterations=max(1, int(width_m * PX * 0.35))), outline, r, soft=1.0, mist=0.6)
    paint_mask(cv, mask, color, r, soft=0.9, mist=mist)
    if drips:
        cv = add_drips(cv, color, r, rate=drips, max_len_m=0.12, width_px=max(1.5, width_m * PX * 0.3))
    G.porous(cv, r, 0.2)
    return trim(cv)


# ------------------------------------------------------------------ hollow 3D outline
def outline3d(text, line, r, height_m=0.5, fill=None, block_fill=None, depth=(0.13, 0.11), hatch=True, fat=0.13,
              brush='square', slant=0.08, spacing=0.07, line_m=0.012, drips=0.6):
    """Straight letters outlined and left open, with a 3D block dropped behind them that's hatched in
    rather than filled: the quick sketch of a piece, put up as it is."""
    hp = height_m * PX
    pad = int(PX * 0.1)
    masks, (w, h) = G.letter_masks(text, r, hp, pad, fat=fat, brush=brush, slant=slant, spacing=spacing, smooth=0,
                                   condense=1.05, shape=dict(angular=0.1))
    dx, dy = int(depth[0] * hp), int(depth[1] * hp)
    masks = [np.pad(m, ((0, dy + 4), (0, dx + 4))) for m in masks]
    mask = np.logical_or.reduce(masks)
    block = np.zeros_like(mask)
    n = max(dx, dy)
    for k in range(1, n + 1):
        block |= np.roll(np.roll(mask, int(dy * k / n), 0), int(dx * k / n), 1)
    block &= ~mask
    cv = G.Canvas(mask.shape[1], mask.shape[0])
    lw = line_m * PX
    if block_fill is not None:
        paint_mask(cv, block, block_fill, r, soft=1.0, mist=0.6)
    if hatch:
        ys, xs = np.nonzero(block)
        if len(xs):
            step = hp * 0.055
            hc = G.Can(cv, line, lw * 0.75, r, flow=0.9, drips=0.2, mist=0.3)
            c0, c1 = xs.min() - (ys.max() - ys.min()), xs.max()
            for k, x in enumerate(np.arange(c0, c1, step)):
                hc.stroke(np.array([(x, ys.max() + 4), (x + (ys.max() - ys.min()) + 8, ys.min() - 4)]), hesitate=0.3)
            hc.spray(clip=ndimage.binary_dilation(block, iterations=1).astype(float))
    if fill is not None:
        fc = G.Can(cv, fill, hp * 0.07, r, flow=0.55, drips=0.4, mist=0.6)
        G.zigzag_fill(fc, mask, hp * 0.06, r, angle=r.uniform(-0.5, 0.5))
        fc.spray(clip=ndimage.binary_dilation(mask, iterations=2).astype(float))
    oc = G.Can(cv, line, lw, r, flow=1.0, drips=drips, mist=0.3)
    for c in G.contours(mask | block):
        oc.stroke(c, closed=True, hesitate=0.6)
    oc.spray()
    for i, m in enumerate(masks):   # each letter's own line, broken where the next letter overlaps it
        later = np.logical_or.reduce(masks[i + 1:]) if i + 1 < len(masks) else np.zeros_like(m)
        oc = G.Can(cv, line, lw, r, flow=1.0, drips=drips * 0.6, mist=0.3)
        for c in G.contours(m):
            oc.stroke(c, closed=True, hesitate=0.6)
        oc.spray(clip=1 - later.astype(float))
    G.porous(cv, r, 0.25)
    return trim(grow(cv, bottom=PX * 0.1))


# ------------------------------------------------------------------ hand-cut stencil
def cutstencil(text, color, r, height_m=0.12, fade=0.0, sheet=True):
    """Lettering somebody cut out of card with a knife and sprayed through: straight, even capitals with
    bridges holding the counters in, soft dusty edges, one side heavier than the other, and the faint
    rectangle of overspray where the card's edge sat."""
    hp = height_m * PX
    pad = int(hp * 0.9)
    masks, (w, h) = G.letter_masks(text, r, hp, pad, fat=0.13, brush='square', slant=0.0, spacing=0.16, smooth=0,
                                   jitter=0.008, condense=0.95, line_gap=1.55, shape=dict(angular=0.08))
    cut = []
    for m in masks:
        holes = ndimage.binary_fill_holes(m) & ~m
        img = Image.fromarray((m * 255).astype(np.uint8)); d = ImageDraw.Draw(img)
        lab, n = ndimage.label(holes)
        for k in range(1, n + 1):           # one bridge per counter, through the stroke on its left
            ys, xs = np.nonzero(lab == k)
            if len(xs) < 4:
                continue
            cy = int(ys.mean())
            bw = max(2, int(hp * 0.045))
            row = np.nonzero(m[cy, :xs.min()])[0]
            if len(row):
                d.rectangle((row.min() - 1, cy - bw // 2, xs.min(), cy + bw // 2), fill=0)
        cut.append(np.asarray(img) > 127)
    mask = np.logical_or.reduce(cut)
    cv = G.Canvas(w, h)
    xs_ = np.arange(w)[None, :]
    heavy = 0.75 + 0.25 * np.clip((xs_ / max(1, w)) * r.choice([-1, 1]) + (0.5 if r.random() < 0.5 else 0), 0, 1)
    if sheet:   # the card's edge
        ys, xs = np.nonzero(mask)
        x0, x1, y0, y1 = xs.min() - pad * 0.55, xs.max() + pad * 0.55, ys.min() - pad * 0.45, ys.max() + pad * 0.45
        rect = np.zeros((h, w)); rect[int(max(0, y0)):int(y1), int(max(0, x0)):int(x1)] = 1
        outside = (1 - rect) * ndimage.gaussian_filter(rect, hp * 0.18)
        dots = r.random((h, w)) < outside * 0.25
        cv.over(np.asarray(color, float), np.clip(outside * 0.12 + dots * 0.35, 0, 0.45))
    soft = ndimage.gaussian_filter(mask.astype(float), max(0.8, hp * 0.012))
    a = np.clip(soft * 1.1, 0, 1) * heavy
    mist = ndimage.gaussian_filter(mask.astype(float), hp * 0.08)
    a = np.maximum(a, (r.random((h, w)) < mist * 0.18) * 0.5)
    cv.over(np.asarray(color, float), a)
    cv = add_drips(cv, color, r, rate=0.25, max_len_m=0.08, width_px=max(1.5, hp * 0.03), from_mask=soft > 0.6)
    G.porous(cv, r, 0.35)
    if fade:
        G.age(cv, r, fade=fade)
    return trim(cv)


# ------------------------------------------------------------------ hearts, squares
def heart_path(cx, cy, s, n=60):
    t = np.linspace(0, 2 * math.pi, n)
    x = 16 * np.sin(t) ** 3
    y = -(13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t))
    return np.stack([cx + x / 34 * s, cy + y / 34 * s], 1)


def heart(text, color, r, size_m=0.5, width_m=0.022, mode='spray', fill=None, text_color=None, arrow=True):
    """Initials in a heart (with an arrow through it): sprayed, done in marker, or keyed in."""
    s = size_m * PX
    pad = int(s * 0.3)
    cv = G.Canvas(s + 2 * pad, s + 2 * pad)
    cx, cy = pad + s / 2, pad + s / 2
    hp = heart_path(cx, cy, s * 1.05) + r.normal(0, s * 0.006, (60, 2))
    hp[-1] = hp[0]
    marker = mode != 'spray'
    if fill is not None:
        m = Image.new('L', (cv.w, cv.h), 0)
        ImageDraw.Draw(m).polygon([tuple(p) for p in hp], fill=255)
        fc = G.Can(cv, fill, s * 0.12, r, flow=0.9, drips=0.6)
        G.zigzag_fill(fc, np.asarray(m) > 127, s * 0.08, r)
        fc.spray(clip=ndimage.binary_dilation(np.asarray(m) > 127, iterations=2).astype(float))
    w = width_m * PX if mode == 'spray' else max(2.0, width_m * PX * 0.5) if mode == 'marker' else 1.6
    jit = (lambda p: p + r.normal(0, 0.6, p.shape)) if mode == 'scratch' else (lambda p: p)
    can = G.Can(cv, color, w, r, marker=marker)
    for _ in range(2 if mode == 'scratch' else 1):
        can.stroke(jit(hp))
    if arrow:
        a, b = np.array([pad * 0.2, cy + s * 0.32]), np.array([cv.w - pad * 0.35, cy - s * 0.38])
        dv = (b - a) / np.linalg.norm(b - a); nv = np.array([-dv[1], dv[0]])
        L = s * 0.12
        can.stroke(jit(np.array([a, b])))
        can.stroke(jit(np.array([b - dv * L + nv * L * 0.6, b, b - dv * L - nv * L * 0.6])))
        for k in range(3):   # fletching
            q = a + dv * (k * L * 0.35 + 4)
            can.stroke(jit(np.array([q, q - dv * L * 0.5 + nv * L * 0.55])))
            can.stroke(jit(np.array([q, q - dv * L * 0.5 - nv * L * 0.55])))
    can.spray(opacity=0.8 if mode == 'scratch' else 1.0)
    th = s * 0.3
    st = G.layout(text, r, slant=0.15, bounce=0.06, spacing=0.18, jitter=0.03, scale_var=0.08, smooth=1, condense=0.9)
    lo, hi = G.bounds(st)
    origin = (cx - (lo[0] + hi[0]) / 2 * th, cy - s * 0.02 + (lo[1] + hi[1]) / 2 * th)
    tc = G.Can(cv, text_color or color, w if mode != 'spray' else w * 0.9, r, marker=marker)
    for p in G.to_px(st, th, origin):
        for _ in range(2 if mode == 'scratch' else 1):
            tc.stroke(jit(p))
    tc.spray(opacity=0.8 if mode == 'scratch' else 1.0)
    if mode == 'spray':
        cv = grow(cv, bottom=PX * 0.12)
        G.porous(cv, r, 0.25)
    return trim(cv)


def quad(cx, cy, size, rot, r, wob=0.02):
    pts = []
    for k in range(4):
        a = rot + math.pi / 4 + k * math.pi / 2
        pts.append((cx + size * 0.7071 * math.cos(a) + r.normal(0, size * wob), cy + size * 0.7071 * math.sin(a) + r.normal(0, size * wob)))
    return pts


def square_piece(color, r, size_m=0.7, rot=0.0, streak=0.6):
    """A square rolled and sprayed solid, slightly out of true, its edges soft where the roller ran out."""
    s = size_m * PX
    pad = int(s * 0.12)
    cv = G.Canvas(s * 1.5 + 2 * pad, s * 1.5 + 2 * pad)
    m = Image.new('L', (cv.w, cv.h), 0)
    ImageDraw.Draw(m).polygon(quad(cv.w / 2, cv.h / 2, s, rot, r, 0.012), fill=255)
    mask = np.asarray(m) > 127
    paint_mask(cv, mask, color, r, soft=1.0, mist=0.8, streak=streak)
    cv = add_drips(cv, color, r, rate=0.6, max_len_m=0.2, width_px=3)
    G.porous(cv, r, 0.3)
    return trim(cv)


def square_ring(color, r, radius_m=0.35, n=12, size_m=0.11, filled=True, width_m=0.012):
    """Squares going round in a circle."""
    R, s = radius_m * PX, size_m * PX
    pad = int(s + PX * 0.06)
    cv = G.Canvas(2 * (R + pad), 2 * (R + pad))
    cx = cy = R + pad
    mask = np.zeros((cv.h, cv.w), bool)
    paths = []
    for k in range(n):
        a = k * 2 * math.pi / n - math.pi / 2
        q = quad(cx + R * math.cos(a), cy + R * math.sin(a), s * r.uniform(0.9, 1.1), a + r.normal(0, 0.06), r, 0.03)
        if filled:
            m = Image.new('L', (cv.w, cv.h), 0); ImageDraw.Draw(m).polygon(q, fill=255)
            mask |= np.asarray(m) > 127
        else:
            paths.append(np.array(q + [q[0]]))
    if filled:
        paint_mask(cv, mask, color, r, soft=0.9, mist=0.8)
        cv = add_drips(cv, color, r, rate=0.5, max_len_m=0.1, width_px=2.5)
    else:
        spray_paths(cv, paths, color, r, width_m * PX, drips=0.6)
    G.porous(cv, r, 0.25)
    return trim(cv)


def side_by_side(a, b, gap_px, valign='bottom'):
    H = max(a.h, b.h)
    out = G.Canvas(a.w + gap_px + b.w, H)
    for c, x in ((a, 0), (b, a.w + gap_px)):
        y = (H - c.h) if valign == 'bottom' else (H - c.h) / 2 if valign == 'center' else 0
        paste(out, c, x, y)
    return out


# ------------------------------------------------------------------ the batch
BLACK, WHITE, SILVER, CHARCOAL = G.BLACK, G.WHITE, (0.8, 0.81, 0.82), (0.13, 0.13, 0.15)
BLOOD, OXBLOOD, RUST, BONE = (0.7, 0.05, 0.04), (0.33, 0.04, 0.06), (0.62, 0.26, 0.08), (0.86, 0.83, 0.74)
HOTPINK, BUBBLEGUM, LILAC, GRAPE = (0.98, 0.25, 0.6), (0.98, 0.62, 0.8), (0.75, 0.6, 0.92), (0.38, 0.12, 0.55)
SKY, COBALT, NAVY, TEAL = (0.35, 0.72, 0.98), (0.1, 0.3, 0.85), (0.08, 0.1, 0.3), (0.05, 0.55, 0.55)
LIME, TOXIC, FOREST, MINT = (0.55, 0.9, 0.2), (0.7, 0.95, 0.1), (0.1, 0.32, 0.16), (0.55, 0.95, 0.78)
YELLOW, GOLD, ORANGE, TANGERINE = (0.99, 0.85, 0.12), (0.88, 0.66, 0.16), (0.97, 0.45, 0.08), (1.0, 0.58, 0.25)
RED, CREAM, BROWN, MAUVE = (0.88, 0.1, 0.08), (0.98, 0.9, 0.62), (0.3, 0.14, 0.05), (0.62, 0.38, 0.5)
STRAIGHT, WILD, SEMI, ANGTHROW = G.STRAIGHT, G.WILD, G.SEMI, G.ANGTHROW


# after review (/graffiti): remade just as they were, but without drips, or with their letters spaced out
NODRIPS_NEW = {'tu_13less33', 'ol_digitalmonsters', 'tu_friendslop', 'tu_gummydeino', 'tu_hachieproud', 'bf_ihavenomoney',
               'pc_nevermintingout', 'tu_omom', 'pc_parkerito', 'pc_swords2', 'sc_whokilledtheblockchain', 'pc_yechelange',
               'tu_bunnyhop'}
KERN_NEW = {'tu_bunnyhop', 'mp_aislop', 'dd_allthesesquares', 'rl_fuckcern', 'ex_imdisassociating', 'tu_ijest', 'mk_minimalism',
            'mk_onehundredeleventhousand', 'mp_youvebeenliquidated'}


def rng(name, seed):
    return np.random.default_rng(zlib.crc32(name.encode()) + seed * 1000003)


def build_extra(seed=5, only=None):
    """name -> Canvas. Names are style_word_variant so the spray-can list keeps every take on a phrase together.
    New prefixes: pl placa, wk wickets, bf busflow, mp mop, sp script, ol hollow 3D outline."""
    P = {}

    def add(name, fn):
        if only and not any(o in name for o in only):
            return
        G.NODRIPS, G.KERN = name in NODRIPS_NEW, G.KERN_SPACE if name in KERN_NEW else 0.0
        try:
            cv = fn(rng(name, seed))
        finally:
            G.NODRIPS, G.KERN = False, 0.0
        P[name] = trim(cv) if name in NODRIPS_NEW else cv     # (no room left at the bottom for drips)

    # i can sleep anywhere
    add('sp_icansleepanywhere', lambda r: script('i can sleep\nanywhere', BUBBLEGUM, r, 0.2, 0.026, outline=BLACK))
    add('mp_icansleepanywhere', lambda r: mop('', BLACK, r, 0.3, 0.024, lines=['I CAN SLEEP', 'ANYWHERE'], drip_rate=1.2))
    # one hundred eleven thousand one hundred eleven
    add('mk_onehundredeleventhousand', lambda r: G.marker('', BLACK, r, 0.07, lines=['one hundred eleven', 'thousand', 'one hundred eleven']))
    add('pl_onehundredeleventhousand', lambda r: placa('ONE HUNDRED ELEVEN\nTHOUSAND\nONE HUNDRED ELEVEN', BLACK, r, 0.13, nib=0.2))
    # welcome home drifella
    add('pc_welcomehomedrifella', lambda r: G.piece('WELCOME HOME\nDRIFELLA', SKY, NAVY, r, 0.38, fill_style='fade', fill2=GRAPE,
                                                  backdrop=(BUBBLEGUM, BLACK), shadow=BLACK, fat=0.15))
    add('sp_welcomehomedrifella', lambda r: script('welcome home\ndrifella', WHITE, r, 0.2, 0.028, outline=COBALT))
    # solana blockchain simulator
    add('sn_solanablockchainsimulator', lambda r: cutstencil('SOLANA BLOCKCHAIN\nSIMULATOR', GRAPE, r, 0.15, fade=0.05))
    add('ol_solanablockchainsimulator', lambda r: outline3d('SOLANA\nBLOCKCHAIN\nSIMULATOR', BLACK, r, 0.3, fill=MINT, block_fill=None))
    # counterterrorists win!
    add('pl_counterterroristswin', lambda r: placa('COUNTER-TERRORISTS WIN!', BLACK, r, 0.16, shadow=BLOOD))
    # (the throw-up was redone after review: bb_counterterroristswin in tools/graffiti_third.py)
    # '21 never ended
    add('mk_21neverended', lambda r: G.marker('', BLACK, r, 0.09, lines=["'21 NEVER ENDED"]))
    add('wk_21neverended', lambda r: wicket("'21 NEVER ENDED", BLACK, r, 0.42, 0.011))
    add('tu_21neverended', lambda r: G.piece("'21 NEVER\nENDED", BONE, OXBLOOD, r, 0.32, shadow=BLACK, shine=None, **ANGTHROW))
    # t + m in a heart
    add('dd_tm_heart', lambda r: heart('T+M', BLOOD, r, 0.5, 0.022, fill=BUBBLEGUM, text_color=BLOOD))
    add('mk_tm_heart', lambda r: heart('T + M', BLACK, r, 0.3, 0.02, mode='marker'))
    add('ex_ma_heart', lambda r: heart('M+A', BONE, r, 0.22, mode='scratch', arrow=False))
    # you only know my swag, not my lore
    add('sc_youonlyknowmyswag', lambda r: G.scrawl(['you only know my swag,', 'not my lore'], BLACK, r, 0.15, 0.015))
    add('sp_youonlyknowmyswag', lambda r: script('you only know my swag,\nnot my lore', GOLD, r, 0.16, 0.022, outline=BLACK))
    # HACHIE PROUD
    add('tu_hachieproud', lambda r: G.piece('HACHIE\nPROUD', SILVER, BLACK, r, 0.45, fill_style='chrome', block=COBALT, shine=None, **STRAIGHT))
    add('bf_hachieproud', lambda r: busflow('HACHIE PROUD', COBALT, r, 0.32, 0.018, lift=True, outline=BLACK))
    # YOU ARE THE EXPERIMENT
    add('sn_youaretheexperiment', lambda r: cutstencil('YOU ARE THE\nEXPERIMENT', BLACK, r, 0.16, fade=0.05))
    add('wk_youaretheexperiment', lambda r: wicket('YOU ARE THE EXPERIMENT', TOXIC, r, 0.38, 0.011, outline=BLACK, bars=0, curls=False))
    # WHO KILLED THE BLOCKCHAIN??
    add('mp_whokilledtheblockchain', lambda r: mop('', BLOOD, r, 0.26, 0.022, lines=['WHO KILLED', 'THE BLOCKCHAIN??'], drip_rate=1.8))
    add('sc_whokilledtheblockchain', lambda r: G.scrawl(['WHO KILLED THE', 'BLOCKCHAIN??'], BLACK, r, 0.17, 0.017, drips=1.6))
    # i'm stuck in a loop
    add('mp_imstuckinaloop', lambda r: mop('', ORANGE, r, 0.26, 0.022, lines=["I'M STUCK", 'IN A LOOP'], drip_rate=1.2))
    add('sp_imstuckinaloop', lambda r: script("i'm stuck in a loop", WHITE, r, 0.2, 0.026))
    # YOU'VE BEEN LIQUIDATED
    add('mp_youvebeenliquidated', lambda r: mop('', BLOOD, r, 0.3, 0.026, lines=["YOU'VE BEEN", 'LIQUIDATED'], drip_rate=2.0, drip_len=0.6))
    add('sn_youvebeenliquidated', lambda r: cutstencil("YOU'VE BEEN\nLIQUIDATED", RED, r, 0.16, fade=0.05))
    # NON FUNCTIONING TESTICLES
    add('tu_nonfunctioningtesticles', lambda r: G.piece('NON FUNCTIONING\nTESTICLES', BONE, OXBLOOD, r, 0.34, shadow=BLACK, shine=None,
                                                       **ANGTHROW))
    add('sc_nonfunctioningtesticles', lambda r: G.scrawl(['NON FUNCTIONING', 'TESTICLES'], RED, r, 0.17, 0.017))
    # minimalism
    add('mk_minimalism', lambda r: minimalism(r, BLACK))
    add('ex_minimalism', lambda r: scratch2('minimalism', r, 0.09))
    # MALEVICH
    add('dd_malevich_square', lambda r: malevich(r))
    add('pl_malevich', lambda r: placa('MALEVICH', BLACK, r, 0.3, drips=0.1))
    # all these squares make a circle
    add('dd_allthesesquares', lambda r: ring_with_words(r, BLACK, filled=True, words=['all these', 'squares make', 'a circle'], word_color=BLACK))
    add('sp_allthesesquares', lambda r: ring_with_words(r, BLOOD, filled=False, words=None, script_words='all these\nsquares make\na circle',
                                                       word_color=WHITE))
    # NEVER MINTING OUT
    add('pc_nevermintingout', lambda r: G.piece('NEVER\nMINTING\nOUT', MINT, BLACK, r, 0.4, fill_style='fade', fill2=TEAL, block=BLACK,
                                               keyline=WHITE, shine=None, stars=2, **SEMI))
    add('ol_nevermintingout', lambda r: outline3d('NEVER MINTING OUT', BLACK, r, 0.36, block_fill=LIME, hatch=False))
    # I HAVE NO MONEY AND ALSO I'M GAY
    add('sc_ihavenomoney', lambda r: G.scrawl(['I HAVE NO MONEY', "AND ALSO I'M GAY"], HOTPINK, r, 0.17, 0.018))
    add('wk_ihavenomoney', lambda r: wicket("I HAVE NO MONEY\nAND ALSO I'M GAY", BLACK, r, 0.3, 0.01, bars=0, curls=False))
    add('bf_ihavenomoney', lambda r: busflow("I HAVE NO MONEY\nAND ALSO I'M GAY", LILAC, r, 0.2, 0.014, outline=BLACK, underline=False))
    # contract with the angel
    add('hs_contractwiththeangel', lambda r: blackletter_lines(['Contract', 'with the', 'Angel'], BLACK, r, 0.28))
    add('sp_contractwiththeangel', lambda r: script('contract with\nthe angel', CREAM, r, 0.2, 0.026, outline=OXBLOOD))
    # swords2
    add('pc_swords2', lambda r: G.piece('SWORDS2', SILVER, BLACK, r, 0.55, fill_style='chrome', block=BLOOD, keyline=BLACK, shine=None, **WILD))
    add('bf_swords2', lambda r: busflow('SWORDS2', BLACK, r, 0.32, 0.018))
    # I'M NOT BAD I'M JUST DRAWN THAT WAY
    add('sc_imnotbad', lambda r: G.scrawl(["I'M NOT BAD", "I'M JUST DRAWN", 'THAT WAY'], OXBLOOD, r, 0.15, 0.016))
    add('mk_imnotbad', lambda r: G.marker('', BLACK, r, 0.07, lines=["i'm not bad", "i'm just drawn that way"]))
    add('sp_imnotbad', lambda r: script("i'm not bad\ni'm just drawn that way", HOTPINK, r, 0.15, 0.02, outline=BLACK, swash=False))
    # friendslop
    add('tu_friendslop', lambda r: G.piece('FRIENDSLOP', BUBBLEGUM, BLACK, r, 0.45, fill_style='scribble', fat=0.19, shine=WHITE, spacing=0.0))
    add('bf_friendslop', lambda r: busflow('FRIENDSLOP', TEAL, r, 0.3, 0.017))
    # he's choosin texas
    add('sc_heschoosintexas', lambda r: G.scrawl(["he's choosin", 'texas'], BLACK, r, 0.17, 0.017))
    add('tu_heschoosintexas', lambda r: G.piece("HE'S CHOOSIN\nTEXAS", ORANGE, BLACK, r, 0.36, fill_style='fade', fill2=RED, shadow=BLACK,
                                               fat=0.16))
    # AI SLOP
    add('rl_aislop', lambda r: G.roller('AI SLOP', BLACK, r, 0.55))
    add('mp_aislop', lambda r: mop('AI SLOP', TOXIC, r, 0.45, 0.03, style='ignorant', drip_rate=2.0))
    # parker ito
    add('bf_parkerito', lambda r: busflow('PARKER ITO', BLACK, r, 0.3, 0.017, lift=True))
    add('pc_parkerito', lambda r: G.piece('PARKER\nITO', YELLOW, BLACK, r, 0.42, fill_style='fade', fill2=ORANGE, block=BLACK,
                                         keyline=SKY, shine=None, stars=1, **SEMI))
    # ENVIRONMENTAL STORYTELLING
    add('sn_environmentalstorytelling', lambda r: cutstencil('ENVIRONMENTAL\nSTORYTELLING', BLACK, r, 0.15, fade=0.1))
    add('ol_environmentalstorytelling', lambda r: outline3d('ENVIRONMENTAL\nSTORYTELLING', WHITE, r, 0.28, fill=None, block_fill=None))
    # FUCK CERN
    add('mp_fuckcern', lambda r: mop('FUCK CERN', BLACK, r, 0.4, 0.028, drip_rate=1.6))
    add('rl_fuckcern', lambda r: G.roller('FUCK CERN', RED, r, 0.5))
    # BUNNYHOP
    add('ol_bunnyhop', lambda r: outline3d('BUNNYHOP', BLACK, r, 0.45, fill=LIME, hatch=True))
    add('tu_bunnyhop', lambda r: G.piece('BUNNYHOP', WHITE, BLACK, r, 0.45, shadow=HOTPINK, fat=0.18, spacing=0.0))
    # Esoteric Meme Breakdown Pokemon The First Movie
    add('sc_esotericmemebreakdown', lambda r: G.scrawl(['Esoteric Meme Breakdown', 'Pokemon The First Movie'], BLACK, r, 0.14, 0.014))
    add('mk_esotericmemebreakdown', lambda r: G.marker('', COBALT, r, 0.07, lines=['ESOTERIC MEME BREAKDOWN', 'POKEMON THE FIRST MOVIE']))
    # I JEST
    add('tu_ijest', lambda r: G.piece('I JEST', YELLOW, BLACK, r, 0.55, shadow=BLACK, fat=0.18))
    add('rl_ijest', lambda r: G.roller('I JEST', BLACK, r, 0.55))
    # Wal-Mart
    add('pl_walmart', lambda r: placa('WAL-MART', BLACK, r, 0.32, shadow=COBALT))
    add('tu_walmart', lambda r: G.piece('WAL-MART', WHITE, RED, r, 0.45, shadow=BLACK, shine=None, **ANGTHROW))
    # LIVE, LAUGH, LOVE
    add('sn_livelaughlove', lambda r: cutstencil('LIVE, LAUGH, LOVE', BLACK, r, 0.16, fade=0.05))
    add('mp_livelaughlove', lambda r: mop('', BLOOD, r, 0.24, 0.022, lines=['LIVE,', 'LAUGH,', 'LOVE'], style='ignorant', drip_rate=2.2, drip_len=0.5))
    # YECHE LANGE
    add('pc_yechelange', lambda r: G.piece('YECHE\nLANGE', SILVER, BLACK, r, 0.45, fill_style='chrome', block=GRAPE, keyline=BLACK,
                                          shine=None, **SEMI))
    add('bf_yechelange', lambda r: busflow('YECHE LANGE', HOTPINK, r, 0.3, 0.017, outline=BLACK))
    # I'm disassociating
    add('sp_imdisassociating', lambda r: script("i'm disassociating", SKY, r, 0.18, 0.022, mist=1.2))
    add('ex_imdisassociating', lambda r: G.scratch("i'm disassociating", r, height_m=0.09))
    # LOOK HOW BEAUTIFUL THE WORLD
    add('tu_lookhowbeautiful', lambda r: G.piece('LOOK HOW BEAUTIFUL\nTHE WORLD', SKY, NAVY, r, 0.3, fill_style='fade', fill2=MINT,
                                                backdrop=(CREAM, BLACK), shadow=NAVY, fat=0.15))
    add('mk_lookhowbeautiful', lambda r: G.marker('', BLACK, r, 0.08, lines=['look how beautiful', 'the world']))
    # super metal mons
    add('rl_supermetalmons', lambda r: G.roller('SUPER METAL\nMONS', WHITE, r, 0.4))
    add('bf_supermetalmons', lambda r: busflow('SUPER METAL MONS', BLACK, r, 0.3, 0.017, lift=True))
    # drain dratini theology
    add('hs_draindratinitheology', lambda r: blackletter_lines(['Drain', 'Dratini', 'Theology'], OXBLOOD, r, 0.26))
    add('pc_draindratinitheology', lambda r: G.piece('DRAIN DRATINI\nTHEOLOGY', COBALT, BLACK, r, 0.34, fill_style='fade', fill2=SKY,
                                                    block=NAVY, keyline=WHITE, shine=None, stars=1, **SEMI))
    # REDEEMED
    add('pc_redeemed', lambda r: G.piece('REDEEMED', GOLD, BLACK, r, 0.5, fill_style='fade', fill2=ORANGE, block=OXBLOOD, keyline=WHITE,
                                        shine=None, stars=3, **WILD))
    add('pl_redeemed', lambda r: placa('REDEEMED', BLACK, r, 0.36, underline=True))
    # DIGITAL MONSTERS
    add('tu_digitalmonsters', lambda r: G.piece('DIGITAL\nMONSTERS', ORANGE, BLACK, r, 0.4, fill_style='stripes', fill2=YELLOW, block=NAVY,
                                               shine=None, **STRAIGHT))
    add('ol_digitalmonsters', lambda r: outline3d('DIGITAL MONSTERS', BLACK, r, 0.36, fill=SKY, block_fill=None))
    # OMOM
    add('tu_omom', lambda r: G.piece('OMOM', LILAC, BLACK, r, 0.6, fill_style='fade', fill2=HOTPINK, shadow=BLACK, fat=0.2, spacing=-0.02))
    add('mp_omom', lambda r: mop('OMOM', BLACK, r, 0.5, 0.034, drip_rate=1.4))
    # GUMMY DEINO
    add('tu_gummydeino', lambda r: G.piece('GUMMY\nDEINO', (0.5, 0.35, 0.95), BLACK, r, 0.45, fill_style='fade', fill2=(0.2, 0.75, 0.9),
                                          shadow=NAVY, fat=0.155, shine=WHITE))
    add('bf_gummydeino', lambda r: busflow('GUMMY DEINO', GRAPE, r, 0.3, 0.017))
    # meinong
    add('bf_meinong', lambda r: busflow('MEINONG', BLACK, r, 0.32, 0.018))
    add('wk_meinong', lambda r: wicket('MEINONG', BLOOD, r, 0.48, 0.012))
    # 11111111111111111111
    add('tag_11111111111111111111', lambda r: G.tag('11111111111111111111', BLACK, r, height_m=0.5, width_m=0.02, style='rune'))
    add('rl_11111111111111111111', lambda r: G.roller('11111111111111111111', BLACK, r, 0.3))
    # 13<33
    add('tu_13less33', lambda r: G.piece('13<33', HOTPINK, BLACK, r, 0.55, shadow=BLACK, fat=0.18, shine=WHITE))
    add('mk_13less33', lambda r: G.marker('', BLOOD, r, 0.1, lines=['13<33']))
    # BORED GAY LOSER CLUB
    add('pl_boredgayloserclub', lambda r: placa('BORED GAY\nLOSER CLUB', BLACK, r, 0.22, shadow=HOTPINK))
    add('tu_boredgayloserclub', lambda r: G.piece('BORED GAY\nLOSER CLUB', HOTPINK, BLACK, r, 0.38, fill_style='fade', fill2=LILAC,
                                                 shadow=BLACK, fat=0.16, shine=WHITE))
    return P


def minimalism(r, color):
    """A small word and one long, careful line."""
    word = G.marker('', color, r, 0.06, lines=['minimalism'])
    line = G.Canvas(PX * 1.2, PX * 0.12)
    spray_paths(line, [np.array([(PX * 0.05, PX * 0.06), (PX * 1.15, PX * 0.058)])], color, r, PX * 0.008, drips=0.3, mist=0.4)
    return stack([trim(line), word], int(PX * 0.04), 'right')


def malevich(r):
    """A black square, and who did it."""
    sq = square_piece(BLACK, r, 0.62, rot=r.normal(0, 0.02))
    sig = G.marker('', BLACK, r, 0.08, lines=['MALEVICH'])
    return stack([sq, sig], int(PX * 0.03), 'right')


def suprematist(r):
    """Suprematist bits sprayed on a wall: a tilted red square, a black bar, and the name in block letters."""
    red = square_piece(RED, r, 0.38, rot=0.35)
    bar = G.Canvas(PX * 0.9, PX * 0.4)
    m = Image.new('L', (bar.w, bar.h), 0)
    ImageDraw.Draw(m).polygon(quad(bar.w * 0.5, bar.h * 0.5, PX * 0.6, -0.25, r, 0.0), fill=0)
    pts = [(PX * 0.05, PX * 0.26), (PX * 0.85, PX * 0.08), (PX * 0.87, PX * 0.16), (PX * 0.07, PX * 0.34)]
    ImageDraw.Draw(m).polygon(pts, fill=255)
    paint_mask(bar, np.asarray(m) > 127, BLACK, r, soft=0.9, mist=0.7, streak=0.4)
    word = placa('MALEVICH', BLACK, r, 0.18, underline=False, drips=0.1)
    top = side_by_side(red, trim(bar), -int(PX * 0.12), 'center')
    return stack([top, word], int(PX * 0.04), 'left')


def ring_with_words(r, color, filled, words=None, script_words=None, word_color=BLACK):
    ring = square_ring(color, r, 0.5, 14, 0.12, filled=filled)
    if script_words:
        txt = script(script_words, word_color, r, 0.12, 0.018, swash=False, drips=0, outline=BLACK)
    else:
        txt = G.scrawl(words, word_color, r, 0.11, 0.012, drips=0.4)
    out = G.Canvas(ring.w, ring.h)
    paste(out, ring, 0, 0)
    paste(out, trim(txt), (ring.w - trim(txt).w) / 2, (ring.h - trim(txt).h) / 2)
    return out


def blackletter_lines(lines, color, r, height_m):
    parts = [trim(G.chisel(t, color, r, height_m, nib=0.22, angle=0.78, tail=0, blackletter=True)) for t in lines]
    return stack(parts, -int(height_m * PX * 0.25), 'left')


def sheet(P, out, width=2200):
    pages = G.pack_pages(P, width=width, max_h=2600)
    for i, (img, _) in enumerate(pages):
        bg = Image.new('RGBA', img.size, (128, 126, 118, 255))
        im = Image.alpha_composite(bg, img).convert('RGB')
        im.save(f'{out}_{i}.png')
    return len(pages)


if __name__ == '__main__':
    import sys, time
    t = time.time()
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
    P = build_extra(only=only)
    n = sheet(P, sys.argv[1] if len(sys.argv) > 1 else 'more_sheet')
    print(len(P), 'pieces', n, 'pages', f'{time.time() - t:.1f}s',
          f'{sum(c.w * c.h for c in P.values()) / 1e6:.1f} Mpx')
