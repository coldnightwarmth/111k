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
import zlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

PX_PER_M = 165  # atlas resolution
# Switches for remaking a piece just as it was, but without drips or with its letters spaced out more.
# Neither changes which random numbers get drawn, so everything else about the piece comes out the same.
NODRIPS = False
KERN = 0.0      # extra space between letters, in letter heights

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
    '$': [[(0.55, 0.88), (0.35, 1), (0.1, 0.95), (0.03, 0.75), (0.15, 0.57), (0.42, 0.45), (0.56, 0.25), (0.45, 0.05),
           (0.2, 0), (0, 0.12)], [(0.3, 1.15), (0.28, -0.15)]],
    '#': [[(0.18, 0.95), (0.1, 0.05)], [(0.42, 0.95), (0.34, 0.05)], [(0.0, 0.65), (0.55, 0.65)], [(-0.03, 0.35), (0.52, 0.35)]],
    ',': [[(0.1, 0.08), (0.02, -0.18)]],
    # lowercase: x-height 0.55, ascenders to 1.0, descenders to -0.35
    'a': [[(0.45, 0.45), (0.3, 0.55), (0.08, 0.45), (0.02, 0.2), (0.15, 0.0), (0.35, 0.05), (0.45, 0.3)], [(0.45, 0.55), (0.45, 0.05), (0.52, 0.0)]],
    'b': [[(0.02, 1.0), (0.02, 0.0)], [(0.02, 0.3), (0.15, 0.5), (0.35, 0.55), (0.5, 0.35), (0.45, 0.08), (0.25, 0.0), (0.02, 0.08)]],
    'c': [[(0.42, 0.48), (0.25, 0.55), (0.06, 0.45), (0.0, 0.25), (0.1, 0.05), (0.3, 0.0), (0.45, 0.1)]],
    'd': [[(0.45, 0.4), (0.28, 0.55), (0.06, 0.45), (0.0, 0.2), (0.12, 0.02), (0.32, 0.02), (0.45, 0.2)], [(0.47, 1.0), (0.45, 0.0), (0.55, 0.02)]],
    'e': [[(0.03, 0.27), (0.42, 0.3), (0.38, 0.5), (0.2, 0.55), (0.04, 0.42), (0.0, 0.18), (0.15, 0.0), (0.38, 0.03), (0.46, 0.12)]],
    'f': [[(0.45, 0.92), (0.32, 1.0), (0.18, 0.9), (0.15, 0.5), (0.12, -0.35)], [(0.0, 0.52), (0.38, 0.55)]],
    'g': [[(0.45, 0.42), (0.27, 0.55), (0.05, 0.45), (0.02, 0.22), (0.2, 0.12), (0.42, 0.25)], [(0.45, 0.55), (0.43, -0.2), (0.28, -0.35), (0.06, -0.28)]],
    'h': [[(0.02, 1.0), (0.02, 0.0)], [(0.02, 0.3), (0.18, 0.52), (0.38, 0.52), (0.45, 0.35), (0.45, 0.0)]],
    'i': [[(0.1, 0.55), (0.08, 0.0)], [(0.1, 0.78), (0.11, 0.74)]],
    'j': [[(0.3, 0.55), (0.28, -0.2), (0.15, -0.35), (0.0, -0.28)], [(0.31, 0.78), (0.32, 0.74)]],
    'k': [[(0.02, 1.0), (0.02, 0.0)], [(0.42, 0.55), (0.04, 0.22), (0.45, 0.0)]],
    'l': [[(0.1, 1.0), (0.08, 0.08), (0.18, 0.0)]],
    'm': [[(0.02, 0.55), (0.02, 0.0)], [(0.02, 0.35), (0.15, 0.55), (0.3, 0.5), (0.32, 0.0)], [(0.32, 0.35), (0.45, 0.55), (0.6, 0.5), (0.62, 0.0)]],
    'n': [[(0.02, 0.55), (0.02, 0.0)], [(0.02, 0.35), (0.18, 0.55), (0.38, 0.5), (0.42, 0.0)]],
    'o': [[(0.25, 0.55), (0.05, 0.45), (0.0, 0.22), (0.12, 0.02), (0.3, 0.0), (0.45, 0.15), (0.47, 0.38), (0.25, 0.55)]],
    'p': [[(0.02, 0.55), (0.02, -0.35)], [(0.02, 0.4), (0.2, 0.55), (0.42, 0.45), (0.45, 0.15), (0.25, 0.0), (0.02, 0.08)]],
    'q': [[(0.45, 0.42), (0.27, 0.55), (0.05, 0.45), (0.02, 0.18), (0.2, 0.0), (0.43, 0.12)], [(0.45, 0.55), (0.43, -0.35), (0.55, -0.25)]],
    'r': [[(0.02, 0.55), (0.02, 0.0)], [(0.02, 0.3), (0.15, 0.5), (0.38, 0.55)]],
    's': [[(0.4, 0.5), (0.2, 0.55), (0.04, 0.45), (0.12, 0.3), (0.35, 0.22), (0.42, 0.08), (0.22, 0.0), (0.0, 0.06)]],
    't': [[(0.15, 0.85), (0.13, 0.08), (0.25, 0.0), (0.35, 0.05)], [(0.0, 0.55), (0.32, 0.56)]],
    'u': [[(0.02, 0.55), (0.04, 0.15), (0.18, 0.0), (0.38, 0.08), (0.44, 0.3)], [(0.44, 0.55), (0.44, 0.0)]],
    'v': [[(0.0, 0.55), (0.22, 0.0), (0.45, 0.55)]],
    'w': [[(0.0, 0.55), (0.15, 0.0), (0.3, 0.4), (0.45, 0.0), (0.6, 0.55)]],
    'x': [[(0.0, 0.55), (0.42, 0.0)], [(0.42, 0.55), (0.0, 0.0)]],
    'y': [[(0.0, 0.55), (0.06, 0.18), (0.2, 0.05), (0.42, 0.2)], [(0.44, 0.55), (0.42, -0.2), (0.28, -0.35), (0.05, -0.28)]],
    'z': [[(0.0, 0.55), (0.42, 0.55), (0.0, 0.0), (0.45, 0.0)]],
}
# blocky roller / blockbuster versions of a few glyphs
BLOCK = {'1': [[(0.0, 0.72), (0.32, 1.0), (0.32, 0.0)], [(0.08, 0.0), (0.56, 0.0)]]}


def glyph(ch, glyphs=None):
    for table in (glyphs or {}, GLYPHS):
        if ch in table:
            return table[ch]
        if ch.upper() in table and ch.upper() != ch and ch not in GLYPHS:
            return table[ch.upper()]
    return GLYPHS.get(ch.upper())


def glyph_width(ch, glyphs=None):
    if ch == ' ':
        return 0.4
    pts = [p for s in glyph(ch, glyphs) for p in s]
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
           per_letter=False, min_width=0.0, glyphs=None):
    """Text -> list of strokes (arrays of x,y in letter-height units, y up).
    per_letter=True returns a list of stroke lists, one per letter."""
    letters, x = [], 0.0
    phase = r.random() * 6.28
    for i, ch in enumerate(text):
        if ch == ' ':
            x += 0.45; continue
        if glyph(ch, glyphs) is None:
            continue
        s = 1 + r.uniform(-scale_var, scale_var)
        if i == 0:
            s *= 1 + scale_var * 1.5  # first letter a bit bigger, as writers do
        dy = bounce * math.sin(phase + i * 1.7) + r.uniform(-bounce, bounce) * 0.5
        rot = r.uniform(-0.08, 0.08)
        cr, sr = math.cos(rot), math.sin(rot)
        cur = []
        gw = glyph_width(ch, glyphs)
        shift = max(0.0, min_width - gw) / 2  # centre narrow glyphs (1, I) in a wider slot
        for st in glyph(ch, glyphs):
            p = np.array(st, float)
            p[:, 0] += shift
            p = p + r.uniform(-jitter, jitter, p.shape)
            p[:, 0] *= condense
            p = np.stack([p[:, 0] * cr - p[:, 1] * sr, p[:, 0] * sr + p[:, 1] * cr], 1) * s
            p[:, 0] += x + p[:, 1] * slant
            p[:, 1] += dy
            cur.append(chaikin(p, smooth))
        letters.append(cur)
        x += max(gw, min_width) * condense * s + spacing + KERN
    return letters if per_letter else [s for l in letters for s in l]


def rdp(pts, eps):
    """Ramer-Douglas-Peucker: turn a smooth stroke into a few straight cuts."""
    pts = np.asarray(pts, float)
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    n = np.linalg.norm(ab)
    rel = pts - a
    d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / n if n > 1e-9 else np.linalg.norm(rel, axis=1)
    k = int(np.argmax(d))
    if d[k] > eps:
        return np.vstack([rdp(pts[:k + 1], eps)[:-1], rdp(pts[k:], eps)])
    return np.array([a, b])


def shape_letters(letters, r, angular=0.0, stretch=(1.0, 1.0), kink=0.0, rot_var=0.0, top_bars=0.0):
    """Letter-form transforms that give each style family its own alphabet:
    angular cuts curves into straight segments, stretch condenses / elongates,
    kink adds sharp breaks, rot_var tilts letters individually, top_bars adds the
    long horizontal bars of runic, vertical handstyles."""
    out = []
    x_shift = 0.0
    for l in letters:
        allp = np.vstack(l)
        cx = allp[:, 0].mean()
        rot = r.uniform(-rot_var, rot_var)
        c, s_ = math.cos(rot), math.sin(rot)
        new = []
        for st in l:
            p = st.copy()
            if angular:
                p = rdp(p, angular)
            if kink and len(p) >= 2:
                q = [p[0]]
                for a_, b_ in zip(p[:-1], p[1:]):
                    if r.random() < kink and np.linalg.norm(b_ - a_) > 0.25:
                        m = (a_ + b_) / 2 + r.normal(0, 0.06, 2)
                        q.append(m)
                    q.append(b_)
                p = np.array(q)
            # narrow / stretch each letter about its own centre so the rhythm of the word stays
            p = np.stack([cx + (p[:, 0] - cx) * stretch[0], p[:, 1] * stretch[1]], 1)
            p = np.stack([cx + (p[:, 0] - cx) * c - p[:, 1] * s_, (p[:, 0] - cx) * s_ + p[:, 1] * c], 1)
            new.append(p)
        if top_bars and r.random() < top_bars:
            ys = np.vstack(new)[:, 1]; xs = np.vstack(new)[:, 0]
            new.append(np.array([(xs.min() - 0.05, ys.max()), (xs.max() + 0.12, ys.max())]))
        out.append(new)
    return out


def handstyle(text, r, style='flow'):
    """Tag lettering: condensed, uneven, letters run into each other, with a
    lead-in on the first letter and a tail off the last."""
    sharp = style in ('sharp', 'rune')
    rune = style == 'rune'
    letters = layout(text, r, slant=0.0 if rune else r.uniform(0.3, 0.55) if sharp else r.uniform(0.15, 0.4),
                     bounce=0.03 if rune else 0.14,
                     spacing={'tall': -0.06, 'rune': 0.1}.get(style, r.uniform(-0.06, 0.04)), jitter=0.03 if rune else 0.06,
                     scale_var=0.05 if rune else 0.22,
                     smooth=0 if sharp else 2 if style != 'tall' else 1, condense=r.uniform(0.55, 0.75), per_letter=True)
    if style == 'tall':      # stretched, overlapping, one line: hard to read if you don't know it
        letters = shape_letters(letters, r, stretch=(0.85, 1.7), rot_var=0.06, kink=0.1)
    elif style == 'rune':    # tall, narrow, straight-cut letters with long top bars
        letters = shape_letters(letters, r, angular=0.1, stretch=(0.8, 1.9), kink=0.15, top_bars=0.45)
    elif style == 'ignorant':  # wonky on purpose
        letters = shape_letters(letters, r, rot_var=0.3, kink=0.3, stretch=(1.1, 1.0))
    # stretch some letters tall, squash others: handstyles are rarely even
    for i, l in enumerate(letters):
        k = 1.35 if i == 0 else r.choice([0.8, 0.95, 1.0, 1.15]) if style != 'rune' else 1.0
        for s in l:
            s[:, 1] *= k
    strokes = []
    for i, l in enumerate(letters):
        l = [s.copy() for s in l]
        if i > 0 and strokes and not rune and np.linalg.norm(strokes[-1][-1] - l[0][0]) < 0.55:
            # run the pen straight on into the next letter
            strokes[-1] = np.vstack([strokes[-1], l[0]])
            l = l[1:]
        strokes += l
    if rune:   # no flourishes: just the letters, maybe an underline bar
        if r.random() < 0.5:
            allp = np.vstack(strokes)
            strokes.append(np.array([(allp[:, 0].min(), allp[:, 1].min() - 0.12), (allp[:, 0].max() + 0.1, allp[:, 1].min() - 0.12)]))
        return strokes
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
            dots = self.r.random((h, wd)) < np.clip(wide * 0.035 * self.mist, 0, 0.15)
            alpha = np.maximum(alpha, dots * self.r.uniform(0.2, 0.7, (h, wd)))
            alpha = np.maximum(alpha, np.clip(wide * 0.035 * self.mist, 0, 0.08))
        else:
            # marker ink: crisp, a bit streaky, darker where the nib rested
            alpha = np.clip(dens * 1.6, 0, 1) * (0.86 + 0.14 * ndimage.gaussian_filter(self.r.random((h, wd)), 1.2) * 2)
        drips = self._drips(dens)
        if NODRIPS:
            drips = drips * 0
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


def tag(text, color, r, height_m=0.32, width_m=0.025, flourish=None, style='flow', outline=None, drips=1.0, mist=1.0, flow=1.0):
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
    can = Can(cv, color, width_m * PX_PER_M, r, flow=flow, drips=drips, mist=mist)
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


def letter_masks(text, r, hp, pad, fat=0.17, slant=0.1, spacing=0.1, brush='round', smooth=3, jitter=0.03,
                 condense=1.15, line_gap=None, arrows=0, glyphs=None, shape=None, spikes=0, cuts=0, connect=False):
    """One mask per letter (lines split on '\\n', stacked), laid out so neighbours overlap a little.
    brush='round' gives bubble letters, 'square' gives angular block / wild letters."""
    lines = text.split('\n')
    line_gap = line_gap or 1.05 + fat * 2.4
    letters = []
    for li, line in enumerate(lines):
        ll = layout(line, r, slant=slant, bounce=0.07, spacing=spacing, jitter=jitter, scale_var=0.08, smooth=smooth,
                    condense=condense, per_letter=True, min_width=0.42, glyphs=glyphs)
        for l in ll:
            for st in l:
                st[:, 1] -= li * line_gap
                st[:, 0] += li * 0.25
        letters += ll
    if shape:
        letters = shape_letters(letters, r, **shape)
    allp = np.vstack([s for l in letters for s in l])
    lo, hi = allp.min(0), allp.max(0)
    margin = fat * 1.4 + 0.25 * arrows
    w = int((hi[0] - lo[0] + 2 * margin) * hp + 2 * pad)
    h = int((hi[1] - lo[1] + 2 * margin) * hp + 2 * pad)
    origin = (pad + (margin - lo[0]) * hp, pad + (margin + hi[1]) * hp)
    masks = []
    for l in letters:
        m = Image.new('L', (w, h), 0)
        d = ImageDraw.Draw(m)
        rad = fat * hp * r.uniform(0.92, 1.08)
        paths = to_px(l, hp, origin)
        for p in paths:
            if brush == 'round':
                for x, y in resample(p, 2)[0]:
                    d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=255)
            else:
                d.line([tuple(q) for q in p], fill=255, width=int(rad * 2), joint='curve')
                for end, prev in ((p[0], p[min(1, len(p) - 1)]), (p[-1], p[max(0, len(p) - 2)])):
                    dv = end - prev
                    dv = dv / (np.linalg.norm(dv) + 1e-6)
                    nv = np.array([-dv[1], dv[0]])
                    if brush == 'flare':   # stroke ends sharpen into points
                        tip = end + dv * rad * r.uniform(1.6, 2.8) + nv * rad * r.uniform(-0.6, 0.6)
                        d.polygon([tuple(end + nv * rad), tuple(tip), tuple(end - nv * rad)], fill=255)
                    else:                  # squared-off ends
                        d.polygon([tuple(end + nv * rad), tuple(end + nv * rad + dv * rad), tuple(end - nv * rad + dv * rad),
                                   tuple(end - nv * rad)], fill=255)
        if arrows and r.random() < 0.6:   # wildstyle: an arrow off the end of a stroke
            p = paths[int(r.integers(len(paths)))]
            if len(p) >= 2:
                end, prev = p[-1], p[max(0, len(p) - 4)]
                dvec = (end - prev) / (np.linalg.norm(end - prev) + 1e-6)
                nvec = np.array([-dvec[1], dvec[0]])
                tip = end + dvec * hp * 0.38 * arrows
                d.line([tuple(end), tuple(tip - dvec * rad)], fill=255, width=int(rad * 1.2))
                d.polygon([tuple(tip + dvec * rad * 0.6), tuple(tip - dvec * rad * 1.4 + nvec * rad * 1.8),
                           tuple(tip - dvec * rad * 1.4 - nvec * rad * 1.8)], fill=255)
        mk = ndimage.gaussian_filter(np.asarray(m, float) / 255, hp * 0.02) > 0.5
        if spikes:   # sharp spikes off the outside of the letter
            dist = ndimage.distance_transform_edt(~mk)
            gy, gx = np.gradient(ndimage.gaussian_filter(dist, 3))
            cs = contours(mk)
            img = Image.fromarray((mk * 255).astype(np.uint8)); dd = ImageDraw.Draw(img)
            for c in cs:
                for _ in range(int(spikes * len(c) / (hp * 2) + (r.random() < spikes))):
                    k = r.integers(len(c)); x, y = c[k]
                    xi, yi = int(np.clip(x, 0, w - 1)), int(np.clip(y, 0, h - 1))
                    nrm = np.array([gx[yi, xi], gy[yi, xi]]); nrm /= np.linalg.norm(nrm) + 1e-9
                    tg = np.array([-nrm[1], nrm[0]])
                    L = hp * r.uniform(0.12, 0.3); b_ = hp * 0.05
                    base_ = np.array([x, y]) - nrm * b_
                    dd.polygon([tuple(base_ + tg * b_), tuple(base_ + nrm * L + tg * L * 0.25), tuple(base_ - tg * b_)], fill=255)
            mk = np.asarray(img) > 127
        if cuts:      # thin breaks through the letter: wildstyle splits into fragments
            img = Image.fromarray((mk * 255).astype(np.uint8)); dd = ImageDraw.Draw(img)
            ys_, xs_ = np.nonzero(mk)
            for _ in range(int(cuts + r.random())):
                if not len(xs_):
                    break
                k = r.integers(len(xs_)); cxx, cyy = xs_[k], ys_[k]
                ang = r.uniform(0, math.pi)
                dv = np.array([math.cos(ang), math.sin(ang)]) * hp * 0.5
                dd.line([(cxx - dv[0], cyy - dv[1]), (cxx + dv[0], cyy + dv[1])], fill=0, width=max(2, int(hp * 0.035)))
            mk = np.asarray(img) > 127
        masks.append(mk)
    if connect and len(masks) > 1:   # bars linking neighbouring letters
        for i in range(len(masks) - 1):
            a_, b_ = np.argwhere(masks[i]), np.argwhere(masks[i + 1])
            if not len(a_) or not len(b_):
                continue
            ya = a_[:, 0].mean()
            pa = a_[np.argmax(a_[:, 1] - np.abs(a_[:, 0] - ya) * 0.5)]
            pb = b_[np.argmin(b_[:, 1] + np.abs(b_[:, 0] - ya) * 0.5)]
            img = Image.fromarray((masks[i] * 255).astype(np.uint8))
            ImageDraw.Draw(img).line([(pa[1], pa[0]), (pb[1], pb[0])], fill=255, width=int(fat * hp * 0.9))
            masks[i] = np.asarray(img) > 127
    return masks, (w, h)


def contours(mask, min_len=20):
    from skimage import measure
    cs = measure.find_contours(np.pad(mask.astype(float), 2), 0.5)
    return [np.stack([c[:, 1] - 2, c[:, 0] - 2], 1) for c in cs if len(c) > min_len]


def zigzag_fill(can, mask, step, r, angle=None, region=None):
    ys, xs = np.nonzero(mask if region is None else region)
    if not len(xs):
        return
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    ang = angle if angle is not None else r.uniform(-0.5, 0.5)
    pts, y, flip = [], y0 - step, False
    while y < y1 + step:
        a, b = (x0 - step, y), (x1 + step, y + step * 0.6 * math.tan(ang) * 4)
        pts += [b, a] if flip else [a, b]
        y += step * r.uniform(0.7, 1.0); flip = not flip
    can.stroke(np.array(pts), hesitate=0.5)


def cloud(mask, hp, r):
    """Bumpy cloud backdrop around the letters."""
    base = ndimage.binary_dilation(mask, iterations=int(hp * 0.18))
    edge = contours(base)
    m = Image.fromarray((base * 255).astype(np.uint8))
    d = ImageDraw.Draw(m)
    for c in edge:
        for k in range(0, len(c), max(1, int(hp * 0.18))):
            x, y = c[k]
            rad = hp * r.uniform(0.1, 0.22)
            d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=255)
    return np.asarray(m) > 127


def piece(text, fill, outline, r, height_m=0.75, fill_style='solid', fill2=None, shadow=None, block=None,
          shine=(1, 1, 1), fat=0.17, brush='round', backdrop=None, arrows=0, sig=None, sig_color=None, slant=0.1,
          spacing=0.1, smooth=3, condense=1.15, outline_w=0.06, glyphs=None, shape=None, spikes=0, cuts=0,
          connect=False, keyline=None, dusty=False, stars=0):
    """Throw-ups, bubble letters and pieces, built the way writers paint them: backdrop, 3D block or shadow,
    fill passes (solid, fade, chrome, scribble, stripes, split, galaxy), outline letter by letter, shines,
    and a small signature."""
    hp = height_m * PX_PER_M
    pad = int(PX_PER_M * 0.12)
    masks, (w, h) = letter_masks(text, r, hp, pad + int(hp * 0.12 * (keyline is not None)), fat=fat, brush=brush,
                                 arrows=arrows, slant=slant, spacing=spacing, smooth=smooth, condense=condense,
                                 glyphs=glyphs, shape=shape, spikes=spikes, cuts=cuts, connect=connect)
    extra = int(hp * 0.2) + int(PX_PER_M * 0.3)
    masks = [np.pad(m, ((0, extra), (0, extra // 2))) for m in masks]
    mask = np.logical_or.reduce(masks)
    H, Wd = mask.shape
    cv = Canvas(Wd, H)
    ow = hp * outline_w
    if keyline is not None:   # second outline around the whole piece, behind everything
        kl = ndimage.binary_dilation(mask, iterations=int(hp * (0.17 if block is not None else 0.08)))
        kc = Can(cv, keyline, hp * 0.1, r, flow=1.3, drips=0.5)
        zigzag_fill(kc, kl, hp * 0.07, r)
        kc.spray(clip=ndimage.binary_dilation(kl, iterations=2).astype(float))
        oc = Can(cv, outline, ow * 0.6, r, drips=0.3, mist=0.2)
        for c in contours(kl):
            oc.stroke(c, closed=True)
        oc.spray()
    if backdrop is not None:
        cl = cloud(mask, hp, r)
        bc = Can(cv, backdrop[0], hp * 0.15, r, flow=1.1, drips=0.6)
        zigzag_fill(bc, cl, hp * 0.1, r)
        bc.spray(clip=ndimage.binary_dilation(cl, iterations=2).astype(float))
        oc = Can(cv, backdrop[1], ow * 0.7, r, drips=0.4)
        for c in contours(cl):
            oc.stroke(c, closed=True)
        oc.spray()
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
    elif shadow is not None:   # flat drop shadow down and to the right
        o = int(hp * 0.07)
        sh = np.roll(np.roll(ndimage.binary_dilation(mask, iterations=int(ow * 0.5)), o, 0), int(o * 0.8), 1) & ~mask
        sc = Can(cv, shadow, hp * 0.08, r, flow=1.5, drips=0.4)
        zigzag_fill(sc, sh, hp * 0.05, r)
        sc.spray(clip=ndimage.binary_dilation(sh, iterations=2).astype(float))
    clip = ndimage.binary_dilation(mask, iterations=max(1, int(ow * 0.35))).astype(float)
    ys, xs = np.nonzero(mask)
    ytop, ybot = ys.min(), ys.max()
    rows = np.arange(H)[:, None]
    if fill_style == 'hollow':
        pass                       # outline only, the wall shows through
    elif fill_style == 'scribble':   # quick, uneven fill: the hatching shows
        fc = Can(cv, fill, hp * 0.07, r, flow=0.55, drips=0.5, mist=0.6)
        zigzag_fill(fc, mask, hp * 0.05, r, angle=r.uniform(-0.6, 0.6))
        zigzag_fill(fc, mask, hp * 0.09, r, angle=r.uniform(-0.6, 0.6))
        fc.spray(clip=clip)
    else:
        fc = Can(cv, fill, hp * 0.16, r, flow=0.45 if dusty else 1.0, drips=0.3 if dusty else 1.2, mist=2.5 if dusty else 1.0)
        zigzag_fill(fc, mask, hp * (0.16 if dusty else 0.11), r)
        fc.spray(clip=clip)
    if fill_style == 'fade' and fill2 is not None:
        lower = mask & (rows > ytop + (ybot - ytop) * r.uniform(0.45, 0.6))
        fd = Can(cv, fill2, hp * 0.12, r, flow=0.8, mist=1.6, drips=0.8)
        zigzag_fill(fd, mask, hp * 0.08, r, angle=0, region=lower)
        fd.spray(clip=clip)
    elif fill_style == 'split' and fill2 is not None:
        cols = np.arange(Wd)[None, :]
        half_ = mask & (cols + (rows - ytop) * 0.6 > xs.min() + (xs.max() - xs.min()) * 0.5)
        fd = Can(cv, fill2, hp * 0.12, r, flow=1.0, drips=0.6)
        zigzag_fill(fd, mask, hp * 0.08, r, region=half_)
        fd.spray(clip=clip * ndimage.binary_dilation(half_, iterations=2))
    elif fill_style == 'stripes' and fill2 is not None:
        for k in range(3):
            yc = ytop + (ybot - ytop) * (0.3 + 0.22 * k)
            band = mask & (np.abs(rows - yc) < hp * 0.04)
            fd = Can(cv, fill2, hp * 0.06, r, flow=1.0, drips=0.4)
            fd.stroke(np.array([(xs.min() - 10, yc), (xs.max() + 10, yc + r.uniform(-4, 4))]))
            fd.spray(clip=clip)
    elif fill_style == 'chrome':  # silver, lighter up top, mottled where the paint went on thin
        n = ndimage.gaussian_filter(r.random((H, Wd)), hp * 0.04)
        n = (n - n.min()) / (n.max() - n.min() + 1e-9)
        shade = np.clip(1.15 - 0.6 * (rows - ytop) / max(1, ybot - ytop), 0.5, 1.15) * (0.75 + 0.4 * n)
        inside = mask[..., None]
        cv.rgb = np.where(inside, np.clip(cv.rgb * shade[..., None], 0, 1), cv.rgb)
        cv.a = np.where(mask, cv.a * np.clip(0.75 + 0.35 * n, 0, 1), cv.a)
    elif fill_style == 'galaxy':  # dark fill with stars
        gx = Can(cv, fill2 or (0.3, 0.1, 0.5), hp * 0.18, r, flow=0.6, mist=2, drips=0)
        for _ in range(4):
            k = r.integers(len(xs))
            gx.stroke(np.array([(xs[k], ys[k]), (xs[k] + hp * 0.3, ys[k] + r.uniform(-20, 20))]))
        gx.spray(clip=clip)
        dots = (r.random((H, Wd)) < 0.004) & mask
        cv.over((1, 1, 1), ndimage.binary_dilation(dots).astype(float) * 0.9)
    # outlines left to right: each letter's line is hidden where a later letter sits on top
    for i, m in enumerate(masks):
        later = np.logical_or.reduce(masks[i + 1:]) if i + 1 < len(masks) else np.zeros_like(m)
        oc = Can(cv, outline, ow, r, flow=1.0, drips=0.8, mist=0.2)
        for c in contours(m):
            oc.stroke(c, closed=True, hesitate=0.6)
        oc.spray(clip=1 - ndimage.binary_erosion(later, iterations=max(1, int(ow * 0.4))).astype(float))
    for _ in range(stars):   # highlight stars, the classic way of showing a shine
        k = r.integers(len(xs)); x, y = xs[k], ys[k]
        L = hp * r.uniform(0.08, 0.16)
        pts = []
        for j in range(8):
            ang = j * math.pi / 4
            rr_ = L if j % 2 == 0 else L * 0.18
            pts.append((x + rr_ * math.cos(ang), y + rr_ * math.sin(ang)))
        img = Image.new('L', (Wd, H), 0); ImageDraw.Draw(img).polygon(pts, fill=255)
        cv.over((1, 1, 1), ndimage.gaussian_filter(np.asarray(img, float) / 255, 0.7))
    if shine is not None:
        sc = Can(cv, shine, hp * (0.045 if fill_style == 'chrome' else 0.035), r, flow=1.4, drips=0)
        for m in masks:
            yy, xx = np.nonzero(m)
            if not len(xx):
                continue
            for _ in range(2 if fill_style == 'chrome' else 1):
                k = r.integers(len(xx))
                x, y = xx[k], yy[k]
                # walk to the upper-left inside of the letter
                for _ in range(40):
                    if 0 < y - 3 and 0 < x - 3 and m[y - 3, x - 3] and m[max(0, y - int(ow * 2)), max(0, x - int(ow * 2))]:
                        y -= 3; x -= 3
                    else:
                        break
                sc.stroke(np.array([(x + ow, y + ow * 1.2), (x + ow + hp * 0.07, y + ow * 1.2 - hp * 0.025)]))
                if fill_style == 'chrome':
                    sc.stroke(np.array([(x + ow + hp * 0.12, y + ow), (x + ow + hp * 0.121, y + ow)]))
        sc.spray()
    if sig:
        st = layout(sig, r, slant=0.3, bounce=0.05, spacing=0.06, jitter=0.03, smooth=1, condense=0.8)
        shp = hp * 0.24   # small signature tucked into the bottom-right letter
        sx0, sy0 = xs.max() - shp * 2.2, ybot - shp * 0.35
        sc = Can(cv, sig_color or outline, max(2.2, shp * 0.11), r, flow=1.1, drips=0.2, mist=0.2)
        for p in to_px(st, shp, (sx0, sy0)):
            sc.stroke(p)
        sc.spray()
    porous(cv, r, 0.3)
    return cv


def chisel(text, color, r, height_m=0.5, nib=0.1, angle=0.65, tail=1.0, dry=0.35, blackletter=False):
    """Calligraphic handstyle with a chisel nib: thick-thin strokes, tall ascenders, a long tail."""
    hp = height_m * PX_PER_M
    letters = layout(text, r, slant=r.uniform(0.15, 0.35), bounce=0.1, spacing=-0.03, jitter=0.035, scale_var=0.12,
                     smooth=0 if blackletter else 2, condense=0.85, per_letter=True)
    if blackletter:   # broken, angular old-English strokes
        letters = shape_letters(letters, r, angular=0.07, kink=0.25, stretch=(0.85, 1.25))
    strokes = []
    for i, l in enumerate(letters):
        l = [s.copy() for s in l]
        for s in l:   # exaggerate ascenders and descenders
            s[:, 1] = np.where(s[:, 1] > 0.6, 0.6 + (s[:, 1] - 0.6) * 1.6, np.where(s[:, 1] < 0, s[:, 1] * 1.5, s[:, 1]))
        if strokes and np.linalg.norm(strokes[-1][-1] - l[0][0]) < 0.5:
            strokes[-1] = np.vstack([strokes[-1], l[0]]); l = l[1:]
        strokes += l
    if tail:
        end = strokes[-1][-1]
        strokes[-1] = np.vstack([strokes[-1], chaikin(np.array([end, end + (0.4, -0.2), end + (1.0 * tail, -0.12),
                                                                  end + (1.6 * tail, 0.12)]), 2)])
    pad = int(hp * 0.6)
    cv, origin = fit_canvas(strokes, hp, pad)
    ss = 2
    m = Image.new('L', (cv.w * ss, cv.h * ss), 0)
    d = ImageDraw.Draw(m)
    nv = np.array([math.cos(angle), -math.sin(angle)]) * nib * hp * ss / 2
    for p in to_px(strokes, hp, origin):
        pts, s_, L = resample(p * ss, 1.5)
        for k in range(len(pts) - 1):
            t = s_[k] / max(L, 1)
            press = min(1, t * 8, (1 - t) * 4) * 0.7 + 0.3   # lift-off at the ends
            n = nv * press
            a, b = pts[k], pts[k + 1]
            d.polygon([tuple(a - n), tuple(a + n), tuple(b + n), tuple(b - n)], fill=255)
    mask = np.asarray(m.resize((cv.w, cv.h), Image.LANCZOS), float) / 255
    streak = ndimage.gaussian_filter(r.random((cv.h, cv.w)), (0.6, 4))
    streak = (streak - streak.mean()) / (streak.std() + 1e-9)
    alpha = np.clip(mask * (1 - dry * np.clip(streak, 0, 3) * 0.6), 0, 1)
    cv.over(color, alpha)
    porous(cv, r, 0.2)
    return cv


def roller(text, color, r, height_m=1.2):
    """Big flat letters put up with a paint roller: square strokes, streaky coverage, rough edges."""
    hp = height_m * PX_PER_M
    pad = int(PX_PER_M * 0.1)
    masks, (w, h) = letter_masks(text, r, hp, pad, fat=0.13, brush='square', slant=0.12, spacing=0.12, smooth=0,
                                 jitter=0.015, condense=1.0, glyphs=BLOCK)
    mask = np.logical_or.reduce(masks)
    edge = ndimage.gaussian_filter(r.random(mask.shape), 1.5)
    soft = ndimage.gaussian_filter(mask.astype(float), 1.2) + (edge - 0.5) * 0.5
    cv = Canvas(w, h)
    rows = ndimage.gaussian_filter1d(r.random(h), 2)[:, None]
    bands = 0.9 + 0.1 * (rows - rows.mean()) / (rows.std() + 1e-9) * 0.5
    a = np.clip((soft - 0.45) * 6, 0, 1) * np.clip(bands + 0.1 * ndimage.gaussian_filter(r.random((h, w)), (1, 12)), 0, 1)
    # paint runs from the bottom edge of heavy roller passes
    drip = np.zeros_like(a)
    cols = np.nonzero(mask.any(0))[0]
    for x in r.choice(cols, size=max(1, len(cols) // 60), replace=False):
        ys = np.nonzero(mask[:, x])[0]
        y0 = ys.max()
        L = int(r.uniform(0.02, 0.15) * PX_PER_M)
        drip[y0:min(h, y0 + L), max(0, x - 1):x + 1] = 0 if NODRIPS else 0.9
    cv.over(color, np.maximum(a, ndimage.gaussian_filter(drip, 0.5)))
    porous(cv, r, 0.35)
    return cv


def scratch(text, r, height_m=0.12, color=(0.92, 0.92, 0.88)):
    """Scratchiti: keyed into paint or a mirror, thin jagged light lines."""
    hp = height_m * PX_PER_M
    strokes = layout(text, r, slant=0.2, bounce=0.1, spacing=0.12, jitter=0.07, smooth=0, condense=0.8)
    pad = int(hp * 0.4)
    cv, origin = fit_canvas(strokes, hp, pad)
    can = Can(cv, color, 1.6, r, marker=True)
    for p in to_px(strokes, hp, origin):
        for k in range(2):   # gone over twice, never quite on the same line
            can.stroke(p + r.normal(0, 0.6, p.shape))
    can.spray(opacity=0.75)
    return cv


def scrawl(lines, color, r, height_m=0.16, width_m=0.016, drips=1.0, mist=1.0):
    """Sentences sprayed fast in lowercase handwriting."""
    hp = height_m * PX_PER_M
    strokes = []
    for i, line in enumerate(lines):
        st = layout(line, r, slant=r.uniform(0.05, 0.3), bounce=0.08, spacing=0.1, jitter=0.04, scale_var=0.1, smooth=1,
                    condense=0.9)
        shift = None
        for s in st:
            s[:, 1] -= i * 1.55
            # the whole line set in a little (the first stroke's draw: every stroke used to get its own, which
            # scrambled every line after the first; one is still drawn per stroke, so nothing else changes)
            u = r.uniform(-0.1, 0.3) * i
            shift = u if shift is None else shift
            s[:, 0] += shift
        strokes += st
    pad = int(hp * 0.5 + PX_PER_M * 0.04)
    cv, origin = fit_canvas(strokes, hp, pad)
    cv = Canvas(cv.w, cv.h + PX_PER_M * 0.2)
    can = Can(cv, color, width_m * PX_PER_M, r, flow=1.0, drips=drips, mist=mist)
    for p in to_px(strokes, hp, origin):
        can.stroke(p, flow=r.uniform(0.85, 1.1))
    can.spray()
    porous(cv, r, 0.25)
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
    cv.over(np.asarray(color)[None, None] * (1 + streak[..., None]), a * 0.97)
    return cv


def stencil(text, color, r, height_m=0.12, fade=0.25):
    """Spray-through-stencil lettering (official markings, or someone's cut-out stencil)."""
    hp = int(height_m * PX_PER_M)
    font = None
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try:
            font = ImageFont.truetype(p, int(hp * 1.3)); break
        except OSError:
            pass
    font = font or ImageFont.load_default()
    lines = text.split('\n')
    tmp = ImageDraw.Draw(Image.new('L', (1, 1)))
    boxes = [tmp.textbbox((0, 0), ln, font=font) for ln in lines]
    pad = int(hp * 0.4)
    lh = int(hp * 1.5)
    w = max(b[2] - b[0] for b in boxes) + 2 * pad
    h = lh * len(lines) + 2 * pad
    m = Image.new('L', (w, h), 0)
    for k, (ln, bb) in enumerate(zip(lines, boxes)):
        ImageDraw.Draw(m).text((pad - bb[0], pad - bb[1] + k * lh), ln, font=font, fill=255)
    mask = np.asarray(m, float) / 255
    for k in range(pad, w - pad, max(4, int(hp * 0.62))):   # stencil bridges
        for j in range(len(lines)):
            y0 = pad + j * lh
            mask[int(y0 + hp * 0.45):int(y0 + hp * 0.58), k:k + max(1, hp // 14)] = 0
    cv = Canvas(w, h)
    mist = ndimage.gaussian_filter(mask, hp * 0.12)
    dots = (r.random((h, w)) < mist * 0.25) * 0.6
    cv.over(color, np.maximum(ndimage.gaussian_filter(mask, 0.7) * 0.92, dots))
    porous(cv, r, 0.4)
    age(cv, r, fade=fade)
    return cv


# -------------------------------------------------------------------- atlas
CHROME, BLACK, WHITE = (0.78, 0.79, 0.8), (0.04, 0.04, 0.05), (0.94, 0.94, 0.9)
RED, PINK, SKY, LIME = (0.82, 0.1, 0.09), (0.95, 0.35, 0.62), (0.25, 0.65, 0.95), (0.55, 0.88, 0.2)
YELLOW, ORANGE, PURPLE, MINT = (0.98, 0.82, 0.12), (0.97, 0.45, 0.08), (0.5, 0.22, 0.75), (0.45, 0.9, 0.75)
NAVY, MAROON = (0.1, 0.12, 0.35), (0.38, 0.05, 0.08)
LILAC, CREAM, BROWN = (0.78, 0.6, 0.85), (0.98, 0.88, 0.5), (0.35, 0.16, 0.05)
TEAL, GOLD, BABY = (0.1, 0.55, 0.55), (0.9, 0.7, 0.2), (0.6, 0.8, 0.98)


SILVER, BLOOD, OXBLOOD, RUST = (0.8, 0.81, 0.82), (0.7, 0.05, 0.04), (0.33, 0.04, 0.06), (0.62, 0.26, 0.08)
TOXIC, ELECTRIC, DIRTYYEL, FOREST = (0.62, 0.92, 0.08), (0.12, 0.38, 1.0), (0.86, 0.68, 0.08), (0.1, 0.3, 0.15)
CHARCOAL, BONE, HOTRED, DEEPPURP = (0.13, 0.13, 0.15), (0.86, 0.83, 0.74), (0.92, 0.12, 0.08), (0.28, 0.08, 0.38)
WILD = dict(brush='flare', fat=0.1, smooth=0, shape=dict(angular=0.08, kink=0.35, rot_var=0.12), spikes=0.6, cuts=1,
            connect=True, arrows=1.0, spacing=-0.02, slant=0.18)
SEMI = dict(brush='flare', fat=0.11, smooth=1, shape=dict(angular=0.06, rot_var=0.08), spikes=0.25, arrows=0.6, spacing=0.03)
STRAIGHT = dict(brush='square', fat=0.13, smooth=0, shape=dict(angular=0.1), spacing=0.06, slant=0.08)
ANGTHROW = dict(brush='square', fat=0.15, smooth=0, shape=dict(angular=0.09, rot_var=0.1), spacing=-0.03, slant=0.15)


def world_stencils(doors):
    """The level's official markings: a number by every room door, and the chainage marks round the loop."""
    room_numbers = [f'B-{i + 1:02d}' for i in range(doors)]
    out = [(f'st_{n.lower()}', (n, (0.86, 0.86, 0.8))) for n in room_numbers]
    out += [(f'st_ch{k}', (f'N15+{240 + 45 * k:03d}', (0.9, 0.78, 0.18))) for k in range(5)]
    return out


# ---------------------------------------------------------------- revisions after review (/graffiti)
# Pieces on the walls that were looked over and changed. Each is remade to fit the exact patch of atlas
# the old one had, so the level's layout (and where every piece sits on the walls) doesn't move.
WALL_NODRIPS = {'sc_9000', 'tu_111111', 'tu_111111_classic', 'sc_ai', 'sc_alotofimages', 'dd_arrow_w', 'tag_bladee', 'sc_burger',
                'tu_cherub_classic', 'tu_dratini_classic', 'pc_drifella', 'tu_drilady', 'tu_echo', 'tu_eth_classic',
                'tu_fool_classic', 'sc_fucknfts', 'pc_gremlins', 'dd_heart', 'dd_heart_pink', 'tu_images', 'pc_images_wild',
                'rl_images', 'tu_jpegs', 'tu_mein_dusty', 'tu_mrworld_classic', 'tag_solfys_rune', 'tu_solfys', 'dd_star',
                'tu_swag', 'dd_tally', 'tu_tojiba', 'sc_trust', 'tu_turtle_classic', 'sc_wwjd'}
WALL_KERN = {'tag_111k_big', 'ex_111k', 'tu_fool', 'hs_drifella', 'sc_greed', 'hs_gremlins', 'hs_ivan', 'tu_mein', 'mk_mifella',
             'mk_mmm', 'sc_newgen', 'sc_twosides'}
KERN_SPACE = 0.13
# redone in a new style: new name (its style prefix) or None to keep the name
WALL_REDO = {'tu_loop_classic': 'bf_loop', 'hs_luhfella': 'sn_luhfella', 'tag_mein': 'wk_mein', 'hs_parker': 'ol_parker',
             'tu_turtle': 'ol_turtle', 'tu_nap': None, 'ex_nap': None, 'ex_galaxy': None}
DISPLAY_NAMES = {k: v for k, v in WALL_REDO.items() if v}


def _redo(name, r):
    import graffiti_more as M          # (the newer styles live there)
    if name == 'tu_loop_classic':
        return M.busflow('LOOP', (0.95, 0.35, 0.62), r, 0.6, 0.032, lift=True, outline=BLACK)
    if name == 'hs_luhfella':
        return M.cutstencil('LUH\nFELLA', (0.7, 0.05, 0.04), r, 0.3)
    if name == 'tag_mein':
        return M.wicket('MEIN', BLACK, r, 0.8, 0.02, bars=0, curls=False)
    if name == 'hs_parker':
        return M.outline3d('PARKER', BLACK, r, 0.6, fill=(0.99, 0.85, 0.12), hatch=True)
    if name == 'tu_turtle':
        return M.outline3d('TURTLE', BLACK, r, 0.6, block_fill=(0.1, 0.3, 0.15), hatch=False, fill=(0.45, 0.8, 0.4))
    if name == 'tu_nap':       # the same, with a fatter bowl on the a so it reads as one
        return piece('nap', (0.8, 0.81, 0.82), BLACK, r, 0.7, fat=0.15, sig='111K', shine=None, shadow=BLACK, glyphs=OPEN_A)
    if name == 'ex_nap':
        return M.scratch2('nap', r, 0.12, glyphs=OPEN_A)
    if name == 'ex_galaxy':
        return M.scratch2('galaxy-\nbuilding', r, 0.1)
    raise KeyError(name)


# a single-storey a with a clear round bowl and a stem, for pieces where the plain one closed up
OPEN_A = {'a': [[(0.46, 0.4), (0.38, 0.52), (0.2, 0.55), (0.05, 0.45), (0.0, 0.25), (0.08, 0.06), (0.25, 0.0), (0.42, 0.08),
                 (0.47, 0.25)], [(0.47, 0.55), (0.47, 0.12), (0.55, 0.0)]]}


def fit(canvas, w, h, inset=0.0):
    """A canvas exactly w x h with the given one scaled (never stretched) to fit inside, centred."""
    out = Canvas(w, h)
    iw, ih = w * (1 - 2 * inset), h * (1 - 2 * inset)
    s = min(iw / canvas.w, ih / canvas.h)
    nw, nh = max(1, int(round(canvas.w * s))), max(1, int(round(canvas.h * s)))
    a = Image.fromarray((np.clip(canvas.a, 0, 1) * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS)
    rgb = np.stack([np.asarray(Image.fromarray((np.clip(canvas.rgb[..., c], 0, 1) * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS))
                    for c in range(3)], -1) / 255
    x0, y0 = (w - nw) // 2, (h - nh) // 2
    out.rgb[y0:y0 + nh, x0:x0 + nw] = rgb
    out.a[y0:y0 + nh, x0:x0 + nw] = np.asarray(a) / 255
    return out


def revise(P, seed, stencils):
    """Swap in the reviewed versions (same size as the old ones, so nothing else moves)."""
    global NODRIPS, KERN
    if WALL_NODRIPS & P.keys():
        NODRIPS = True
        try:
            Q = build_pieces(seed, stencils, revised=False)
        finally:
            NODRIPS = False
        for n in WALL_NODRIPS & P.keys():
            P[n] = Q[n]
    if WALL_KERN & P.keys():
        KERN = KERN_SPACE
        try:
            Q = build_pieces(seed, stencils, revised=False)
        finally:
            KERN = 0.0
        for n in WALL_KERN & P.keys():
            P[n] = fit(Q[n], P[n].w, P[n].h)
    for n in WALL_REDO.keys() & P.keys():
        r = np.random.default_rng(zlib.crc32(n.encode()) + seed)
        P[n] = fit(_redo(n, r), P[n].w, P[n].h, inset=0.05)
    return P


def build_pieces(seed=7, stencils=(), revised=True):
    """All decals used in the world: name -> Canvas. Size in metres = px / PX_PER_M.
    Prefixes say what kind of work it is, which decides where it gets painted:
    tu_ throw-up, pc_ piece, rl_ roller, fx_ extinguisher, tag_ tag, hs_ chisel handstyle, sc_ sprayed writing,
    mk_ marker, ex_ scratched, dd_ doodle, sn_ stencil, buff_ buffed patch, st_ official marking."""
    r = np.random.default_rng(seed)
    P = {}
    # ---- bubble work, kept close to the references
    P['pc_gremlins'] = piece('GREMLiNS2MOViE', SILVER, BLACK, r, 0.55, fill_style='chrome', shadow=BLACK, fat=0.15,
                             spacing=0.12, slant=0.04, shine=None, stars=3)
    P['tu_creamy'] = piece('CREAMY\nDREAMY', (0.98, 0.86, 0.45), (0.3, 0.13, 0.04), r, 0.6, fat=0.2, spacing=0.02, sig='111K',
                           sig_color=(0.3, 0.13, 0.04), outline_w=0.07, shine=None)
    P['tu_drilady'] = piece('drilady', (0.72, 0.55, 0.8), OXBLOOD, r, 0.85, fill_style='scribble', fat=0.15, slant=0.05,
                            spacing=0.0, shine=None)
    # ---- silver / black dubs and blockbusters
    P['tu_111k'] = piece('111K', SILVER, BLACK, r, 0.85, shadow=BLACK, shine=None, **STRAIGHT)
    P['tu_ssc'] = piece('SSC', SILVER, BLACK, r, 0.75, fill_style='chrome', block=CHARCOAL, shine=None, **STRAIGHT)
    P['tu_111111'] = piece('111111', SILVER, BLACK, r, 0.6, shadow=BLACK, shine=None, **ANGTHROW)
    P['tu_images'] = piece('IMAGES', SILVER, BLACK, r, 0.6, shadow=BLOOD, shine=None, **STRAIGHT)
    P['tu_swag'] = piece('$WAG', SILVER, BLACK, r, 0.6, shadow=BLACK, shine=None, **ANGTHROW)
    P['tu_jpegs'] = piece('JPEGS', SILVER, BLACK, r, 0.55, dusty=True, shine=None, **ANGTHROW)
    # ---- hollows: outline only
    P['tu_void'] = piece('VOID', None, HOTRED, r, 0.7, fill_style='hollow', shine=None, outline_w=0.08, **ANGTHROW)
    P['tu_nft'] = piece('NFT', None, BLACK, r, 0.7, fill_style='hollow', shine=None, outline_w=0.09, fat=0.17)
    P['tu_vvv'] = piece('VVV', None, TOXIC, r, 0.6, fill_style='hollow', shine=None, outline_w=0.07, **STRAIGHT)
    P['tu_mein'] = piece('MEIN', None, BLACK, r, 0.6, fill_style='hollow', shine=None, outline_w=0.08, **ANGTHROW)
    # ---- throw-ups: flat two colours, fast
    P['tu_loop'] = piece('LOOP', BLACK, SILVER, r, 0.7, shine=None, **ANGTHROW)
    P['tu_nova'] = piece('NOVA', DIRTYYEL, BLACK, r, 0.65, shadow=BLACK, shine=None, **ANGTHROW)
    P['tu_echo'] = piece('ECHO', ELECTRIC, BLACK, r, 0.55, dusty=True, shine=None, fat=0.15)
    P['tu_drift'] = piece('DRIFT', BONE, OXBLOOD, r, 0.55, shadow=BLACK, shine=None, **ANGTHROW)
    P['tu_kilo_old'] = piece('KILO', RUST, BLACK, r, 0.6, shine=None, **ANGTHROW)
    age(P['tu_kilo_old'], r, fade=0.45, wash=1.2)
    P['tu_eth'] = piece('ETH', BLACK, WHITE, r, 0.6, shadow=None, shine=None, **STRAIGHT)
    P['tu_sol'] = piece('SOL', DEEPPURP, BLACK, r, 0.6, fill_style='fade', fill2=BLACK, shine=None, **ANGTHROW)
    P['tu_btc'] = piece('BTC', RUST, BLACK, r, 0.55, block=BLACK, shine=None, **STRAIGHT)
    P['tu_nap'] = piece('nap', SILVER, BLACK, r, 0.7, fat=0.2, sig='111K', shine=None, shadow=BLACK)
    P['tu_fool'] = piece('FOOL', HOTRED, BLACK, r, 0.55, shine=None, dusty=True, **ANGTHROW)
    P['tu_turtle'] = piece('TURTLE', FOREST, BLACK, r, 0.5, shadow=BLACK, shine=None, **ANGTHROW)
    P['tu_cherub'] = piece('CHERUB', BONE, BLACK, r, 0.45, fill_style='scribble', shine=None, **ANGTHROW)
    P['tu_dratini'] = piece('DRATINI', ELECTRIC, WHITE, r, 0.45, block=BLACK, shine=None, **SEMI)
    P['tu_solfys'] = piece('SOLFYS', TOXIC, BLACK, r, 0.45, shadow=BLACK, shine=None, **ANGTHROW)
    P['tu_mrworld'] = piece('MR WORLD', BLACK, DIRTYYEL, r, 0.45, block=OXBLOOD, shine=None, **STRAIGHT)
    # ---- pieces: semi-wild and wildstyle, keylines, cuts, 3D, arrows
    P['pc_waxy'] = piece('WAXY', TOXIC, BLACK, r, 0.85, fill_style='fade', fill2=FOREST, block=BLACK, keyline=SILVER,
                         shine=None, stars=2, **SEMI)
    P['pc_avantgay'] = piece('AVANT\nGAY', HOTRED, BLACK, r, 0.6, fill_style='split', fill2=DEEPPURP, block=BLACK,
                             keyline=DIRTYYEL, shine=None, stars=2, sig='111K', **WILD)
    P['pc_evilbiscuit'] = piece('EVIL\nBISCUIT', RUST, BLACK, r, 0.5, fill_style='stripes', fill2=OXBLOOD, block=BLACK,
                                keyline=BONE, shine=None, **SEMI)
    P['pc_hyperwar'] = piece('HYPERWAR', HOTRED, BLACK, r, 0.6, fill_style='fade', fill2=OXBLOOD, block=CHARCOAL,
                             keyline=SILVER, shine=None, stars=3, **WILD)
    P['pc_drifella'] = piece('DRIFELLA', ELECTRIC, BLACK, r, 0.55, fill_style='fade', fill2=DEEPPURP, block=BLACK,
                             keyline=SILVER, shine=None, stars=2, **SEMI)
    P['pc_drilady'] = piece('DRILADY', SILVER, BLACK, r, 0.55, fill_style='chrome', block=BLOOD, keyline=BLACK, shine=None,
                            **WILD)
    P['pc_galaxy'] = piece('GALAXY', (0.08, 0.06, 0.18), SILVER, r, 0.55, fill_style='galaxy', fill2=DEEPPURP, block=BLACK,
                           shine=None, **SEMI)
    P['pc_bladee'] = piece('BLADEE', SILVER, BLACK, r, 0.5, fill_style='chrome', block=CHARCOAL, keyline=ELECTRIC, shine=None,
                           **WILD)
    P['pc_supermetal'] = piece('SUPERMETAL\nBOSCH', SILVER, BLACK, r, 0.42, fill_style='chrome', block=BLOOD, shine=None,
                               **STRAIGHT)
    # ---- rollers and extinguisher work
    P['rl_111111'] = roller('111,111', BLACK, r, 1.0)
    P['rl_images'] = roller('IMAGES', WHITE, r, 0.8)
    P['rl_ilovegod'] = roller('I LOVE GOD', BONE, r, 0.5)
    P['rl_fucknfts'] = roller('FUCK NFTS', BLOOD, r, 0.55)
    P['fx_kaliacc'] = tag('#KALIACC', BLACK, r, height_m=0.75, width_m=0.05, style='tall', drips=4.0, mist=2.5, flow=0.8)
    P['fx_nap'] = tag('NAP', ELECTRIC, r, height_m=0.9, width_m=0.06, style='ignorant', drips=4.0, mist=2.5, flow=0.8)
    # ---- tags: several handstyle families
    tags = [('NOVA', BLACK, 'underline', 'flow'), ('REMO', BLOOD, None, 'tall'), ('JINX', BLACK, None, 'rune'),
            ('VEKS', SILVER, 'underline', 'sharp'), ('OZIE', WHITE, None, 'tall'), ('MUTE', BLACK, None, 'rune'),
            ('ZEAL', HOTRED, 'dots', 'ignorant'), ('RUSE', BLACK, 'underline', 'tall'), ('KILO', TOXIC, None, 'sharp'),
            ('TRIO', BLACK, 'crown', 'flow'), ('DRIF', SILVER, None, 'rune'), ('SEKT', BLOOD, 'underline', 'sharp'),
            ('TOJIBA', BLACK, None, 'tall'), ('CHERUB', WHITE, 'halo', 'flow'), ('TURTLE', BLACK, None, 'rune'),
            ('DRATINI', ELECTRIC, None, 'sharp'), ('SOLFYS', BLACK, None, 'tall'), ('BLADEE', WHITE, 'underline', 'sharp'),
            ('LUHFELLA', BLOOD, None, 'tall'), ('MEIN', BLACK, None, 'rune'), ('NAP', DEEPPURP, None, 'ignorant')]
    for i, (word, col, fl, style) in enumerate(tags):
        P[f'tag_{word.lower()}'] = tag(word, col, r, height_m=r.uniform(0.28, 0.5) * (1.4 if style in ('tall', 'rune') else 1),
                                       width_m=r.uniform(0.016, 0.03), flourish=fl, style=style,
                                       outline=BLACK if col in (WHITE, SILVER) and i % 2 else None)
        if i % 4 == 2:
            age(P[f'tag_{word.lower()}'], r, fade=0.35)
    P['tag_111k_big'] = tag('111K', BLACK, r, height_m=0.6, width_m=0.035, flourish='underline', style='sharp')
    P['tag_111k_rune'] = tag('111K', BLACK, r, height_m=0.9, width_m=0.03, style='rune')
    # ---- chisel handstyles, some in blackletter
    for name, text, col, hm, bl in [('hs_drifella', 'drifella111k', (0.08, 0.08, 0.09), 0.42, False),
                                    ('hs_luhfella', 'LUHFELLA', BLACK, 0.4, True), ('hs_fellakunst', 'fellakunst', OXBLOOD, 0.33, False),
                                    ('hs_tojiba', 'TOJIBA', BLACK, 0.45, True), ('hs_albemarle', 'albemarle', BLACK, 0.32, False),
                                    ('hs_parker', 'parker ito', CHARCOAL, 0.3, False), ('hs_ivan', 'IVAN GRACHYOV', BLACK, 0.3, True),
                                    ('hs_gremlins', 'gremlins2movie', BLOOD, 0.3, False), ('hs_mein', 'MEIN', BLACK, 0.55, True),
                                    ('hs_galaxy', 'galaxy', DEEPPURP, 0.36, False)]:
        P[name] = chisel(text, col, r, hm, nib=r.uniform(0.17, 0.24), angle=0.78 if bl else r.uniform(0.55, 0.85),
                         tail=0 if bl else r.uniform(0.6, 1.3), blackletter=bl)
    # ---- sprayed writing
    for name, lines, col in [('sc_alotofimages', ["that's a lot of images"], BLACK),
                             ('sc_greed', ["i'm letting greed", 'corrupt me'], BLOOD),
                             ('sc_newgen', ['i like this new generation', 'of images'], BLACK),
                             ('sc_wecould', ['we could'], WHITE),
                             ('sc_wwjd', ['#WWJD'], BLACK),
                             ('sc_ketamine', ['ketamine powered', 'horsecock'], BLACK),
                             ('sc_burger', ['BURGER LIVES', 'MATTER'], RUST),
                             ('sc_trust', ['trust the plan'], BLACK),
                             ('sc_slayflop', ['SLAY/FLOP'], HOTRED),
                             ('sc_9000', ['over 9000!'], BLACK),
                             ('sc_ai', ['ai? unfollowed'], BLACK),
                             ('sc_master', ["master got me workin'"], CHARCOAL),
                             ('sc_twosides', ['i have two sides'], DEEPPURP),
                             ('sc_drifhere', ['drifella was here'], BLACK),
                             ('sc_fucknfts', ['fuck nfts'], BLOOD),
                             ('sc_cardnft', ['CARD NFT'], WHITE),
                             ('sc_swag', ['$SWAG'], SILVER),
                             ('sc_jpegs', ['jpegs'], TOXIC),
                             ('sc_ilovegod', ['I LOVE GOD'], WHITE)]:
        P[name] = scrawl(lines, col, r, height_m=r.uniform(0.12, 0.2), width_m=r.uniform(0.012, 0.02), drips=r.uniform(0.8, 2.0))
    # ---- marker
    P['mk_who'] = marker('', BLACK, r, 0.07, lines=['WHO WAS HERE', '  ME!!'])
    P['mk_lisa'] = marker('', (0.1, 0.15, 0.6), r, 0.08, lines=['LISA + DEV', "11/04"])
    P['mk_93'] = marker('', BLACK, r, 0.09, lines=["'93 NEVER ENDED"])
    P['mk_17'] = marker('', OXBLOOD, r, 0.06, lines=["DONT GO PAST 17", "SERIOUSLY"])
    P['mk_hum'] = marker('', BLACK, r, 0.075, lines=['FOLLOW THE HUM'])
    P['mk_loop'] = marker('', BLACK, r, 0.065, lines=['the loop goes', 'on forever'])
    P['mk_ok'] = marker('', BLACK, r, 0.1, lines=['OK'])
    P['mk_names'] = marker('', BLACK, r, 0.055, lines=['JAY  MO  KAT', 'BEN  RIO', 'WAS HERE 2026'])
    P['mk_bring'] = marker('', BLOOD, r, 0.07, lines=['BRING ICE', 'NEXT TIME'])
    P['mk_mons'] = marker('', BLACK, r, 0.07, lines=['play mons.link'])
    P['mk_mifella'] = marker('', BLACK, r, 0.065, lines=['check out', 'mifella'])
    P['mk_swagworld'] = marker('', DEEPPURP, r, 0.075, lines=['little swag world'])
    P['mk_500'] = marker('', BLACK, r, 0.06, lines=['500 followers', 'on twitter'])
    P['mk_mmm'] = marker('', BLACK, r, 0.06, lines=['mmmmmmmmmmmmmmmmmmmmm'])
    P['mk_images'] = marker('', BLOOD, r, 0.06, lines=["that's a lot", 'of images'])
    P['mk_wecould'] = marker('', BLACK, r, 0.08, lines=['we could'])
    P['mk_twosides'] = marker('', BLACK, r, 0.065, lines=['i have two sides'])
    P['mk_111111'] = marker('', BLACK, r, 0.08, lines=['111111'])
    # ---- scratched in
    for name, text in [('ex_tojiba', 'tojiba'), ('ex_mein', 'MEIN'), ('ex_nap', 'nap'), ('ex_111k', '111k'), ('ex_galaxy', 'galaxy')]:
        P[name] = scratch(text, r, height_m=r.uniform(0.08, 0.14))
    # ---- crude spray marks
    P['dd_smiley'] = doodle('smiley', BLACK, r, 0.55, 0.03)
    P['dd_heart'] = doodle('heart', BLOOD, r, 0.35, 0.028)
    P['dd_arrow'] = doodle('arrow', SILVER, r, 0.7, 0.035)
    P['dd_arrow_w'] = doodle('arrow', WHITE, r, 0.55, 0.03)
    P['dd_eye'] = doodle('eye', BLACK, r, 0.5, 0.022)
    P['dd_tally'] = doodle('tally', WHITE, r, 0.35, 0.02)
    P['dd_x'] = doodle('tally', BLOOD, r, 0.45, 0.04)
    # ---- stencils somebody cut
    P['sn_imagefactory'] = stencil('IMAGE FACTORY', BLACK, r, 0.13, fade=0.05)
    P['sn_brandmanager'] = stencil('BRAND MANAGER', BLOOD, r, 0.11, fade=0.05)
    P['sn_supermetal'] = stencil('SUPERMETAL\nBOSCH', BLACK, r, 0.1, fade=0.1)
    P['sn_trust'] = stencil('TRUST THE PLAN', WHITE, r, 0.1, fade=0.1)
    P['sn_cardnft'] = stencil('CARD NFT', BLACK, r, 0.12, fade=0.05)
    # ---- the earlier, brighter set: same words again in other styles, for variety
    PINK_, PURPLE_, SKY_, MINT_ = (0.95, 0.35, 0.62), (0.5, 0.22, 0.75), (0.25, 0.65, 0.95), (0.45, 0.9, 0.75)
    YELLOW_, ORANGE_, LIME_, NAVY_ = (0.98, 0.82, 0.12), (0.97, 0.45, 0.08), (0.55, 0.88, 0.2), (0.1, 0.12, 0.35)
    P['tu_loop_classic'] = piece('LOOP', PINK_, BLACK, r, 0.7, fill_style='fade', fill2=PURPLE_, shine=WHITE)
    P['tu_nova_classic'] = piece('NOVA', YELLOW_, BLACK, r, 0.65, fill_style='fade', fill2=ORANGE_, block=OXBLOOD)
    P['tu_echo_classic'] = piece('ECHO', SKY_, NAVY_, r, 0.55, shadow=BLACK, fat=0.16)
    P['tu_drift_classic'] = piece('DRIFT', MINT_, BLACK, r, 0.55, shadow=PURPLE_, fat=0.15)
    P['tu_111k_classic'] = piece('111K', CHROME, BLACK, r, 0.8, fill_style='chrome', block=(0.12, 0.12, 0.14))
    P['tu_void_classic'] = piece('VOID', WHITE, RED, r, 0.6, shadow=(0.05, 0.05, 0.05), fat=0.19)
    P['tu_dratini_classic'] = piece('DRATINI', (0.45, 0.6, 0.95), WHITE, r, 0.45, block=NAVY_)
    P['tu_mrworld_classic'] = piece('MR WORLD', (0.2, 0.45, 0.9), YELLOW_, r, 0.45, block=BLACK)
    P['tu_solfys_classic'] = piece('SOLFYS', TEAL, BLACK, r, 0.45, shadow=WHITE)
    P['tu_turtle_classic'] = piece('turtle', (0.3, 0.7, 0.3), (0.05, 0.2, 0.05), r, 0.55, fat=0.16, fill_style='fade', fill2=YELLOW_)
    P['tu_cherub_classic'] = piece('CHERUB', (0.98, 0.75, 0.78), MAROON, r, 0.45, fill_style='scribble')
    P['tu_fool_classic'] = piece('FOOL', YELLOW_, RED, r, 0.55, fill_style='split', fill2=ORANGE_)
    P['tu_eth_classic'] = piece('ETH', (0.6, 0.8, 0.98), NAVY_, r, 0.55, fill_style='stripes', fill2=WHITE)
    P['tu_images_classic'] = piece('IMAGES', PINK_, BLACK, r, 0.5, fill_style='split', fill2=YELLOW_)
    P['tu_jpegs_classic'] = piece('jpegs', WHITE, BLACK, r, 0.55, fill_style='chrome', shadow=BLACK, fat=0.16)
    P['tu_111111_classic'] = piece('111111', WHITE, BLACK, r, 0.55, shadow=BLACK, fat=0.17)
    P['pc_drifella_classic'] = piece('DRIFELLA', (0.3, 0.85, 0.95), NAVY_, r, 0.55, fill_style='fade', fill2=PURPLE_, block=NAVY_,
                                     backdrop=((0.95, 0.4, 0.6), BLACK), fat=0.15)
    P['pc_avantgay_classic'] = piece('AVANT\nGAY', PINK_, BLACK, r, 0.6, fill_style='fade', fill2=(0.4, 0.8, 1.0), block=PURPLE_,
                                     backdrop=((0.98, 0.9, 0.3), BLACK), brush='square', fat=0.12, smooth=1, arrows=1, sig='111K')
    P['pc_galaxy_classic'] = piece('GALAXY', (0.12, 0.08, 0.3), (0.85, 0.85, 1.0), r, 0.55, fill_style='galaxy',
                                   fill2=(0.5, 0.2, 0.8), shadow=BLACK)
    P['pc_waxy_classic'] = piece('WAXY', LIME_, BLACK, r, 0.85, fill_style='fade', fill2=(0.1, 0.6, 0.45), block=(0.08, 0.2, 0.15))
    # and some words crossed over into other families
    P['pc_images_wild'] = piece('IMAGES', TOXIC, BLACK, r, 0.55, fill_style='split', fill2=FOREST, block=BLACK, keyline=WHITE,
                                shine=None, stars=2, **WILD)
    P['pc_111k_wild'] = piece('111K', SILVER, BLACK, r, 0.75, fill_style='chrome', block=BLOOD, keyline=BLACK, shine=None, **WILD)
    P['tu_tojiba'] = piece('TOJIBA', BLACK, SILVER, r, 0.5, shine=None, **ANGTHROW)
    P['tu_mein_dusty'] = piece('MEIN', BLOOD, BLACK, r, 0.6, dusty=True, shine=None, fat=0.17)
    P['tag_nft_rune'] = tag('NFT', BLACK, r, height_m=0.7, width_m=0.028, style='rune')
    P['tag_galaxy_tall'] = tag('GALAXY', WHITE, r, height_m=0.6, width_m=0.02, style='tall')
    P['tag_solfys_rune'] = tag('SOLFYS', BLOOD, r, height_m=0.6, width_m=0.025, style='rune')
    P['tag_drilady_tall'] = tag('DRILADY', BLACK, r, height_m=0.6, width_m=0.02, style='tall')
    P['dd_heart_pink'] = doodle('heart', PINK_, r, 0.4, 0.028)
    P['dd_smiley_yellow'] = doodle('smiley', YELLOW_, r, 0.6, 0.03)
    P['dd_crown'] = doodle('crown', PURPLE_, r, 0.45, 0.025)
    P['dd_star'] = doodle('star', ORANGE_, r, 0.4, 0.025)
    # ---- buffs
    P['buff_grey'] = buff(1.6, 1.0, (0.5, 0.5, 0.48), r)
    P['buff_beige'] = buff(1.2, 0.8, (0.62, 0.58, 0.48), r)
    for name, (text, col) in stencils:
        P[name] = stencil(text, col, r)
    return revise(P, seed, stencils) if revised else P


def pack_pages(pieces, width=2048, max_h=2048):
    """Shelf-pack canvases onto as many atlas pages as needed.
    Returns [(image, rects)] with rects name -> {'uv': (u0, v_bottom, u1, v_top), 'size': (w_m, h_m)}."""
    items = sorted(pieces.items(), key=lambda kv: -kv[1].h)
    pages, cur = [], {}
    pad, x, y, shelf = 4, 0, 0, 0
    for name, c in items:
        if x + c.w + pad > width:
            x, y, shelf = 0, y + shelf, 0
        if y + c.h + pad > max_h:
            pages.append(cur); cur = {}; x, y, shelf = 0, 0, 0
        cur[name] = (x, y); x += c.w + pad; shelf = max(shelf, c.h + pad)
    pages.append(cur)
    out = []
    for place in pages:
        H = (max(py + pieces[n].h for n, (px, py) in place.items()) + 7) // 4 * 4
        atlas = Image.new('RGBA', (width, H), (0, 0, 0, 0))
        rects = {}
        for name, (px, py) in place.items():
            c = pieces[name]
            atlas.paste(c.image(), (px, py))
            rects[name] = {'uv': (px / width, (py + c.h) / H, (px + c.w) / width, py / H), 'size': (c.w / PX_PER_M, c.h / PX_PER_M)}
        out.append((atlas, rects))
    return out


if __name__ == '__main__':
    import sys, time
    t = time.time()
    P = build_pieces(stencils=[('st_b07', ('B-07', (0.85, 0.85, 0.8)))])
    pages = pack_pages(P)
    print(len(P), 'pieces,', len(pages), 'pages', [p[0].size for p in pages], f'{time.time() - t:.1f}s')
    out = sys.argv[1] if len(sys.argv) > 1 else 'graffiti_sheet'
    for i, (img, _) in enumerate(pages):
        bg = Image.new('RGBA', img.size, (128, 126, 118, 255))
        Image.alpha_composite(bg, img).convert('RGB').save(f'{out}_{i}.png')
