"""The paintings' pictures, made light enough to have on hand: each one as WebP at 1024 px on its long side
(desktop) and 512 px (phones), plus every picture at once in a small preview atlas (one file the game loads
up front, so a painting is never a blank canvas while its full picture is on its way).

    python3 tools/paintings_webp.py /path/to/originals    # <id>.png from https://cdn.lil.org/nft/111k/paintings/

writes assets/paintings/{1024,512}/<id>.webp and assets/paintings/previews.webp, for every art id in ART
(src/paintings.js). The atlas is laid out in ART's order (ascending id), PREVIEW_COLS across, each picture
squeezed into a PREVIEW_TILE square with its edge pixels repeated PREVIEW_PAD round it (so mipmaps don't
bleed one picture into the next); src/paintings.js reads it the same way.
"""
import os
import re
import sys

import numpy as np
from PIL import Image

SIZES = {1024: 82, 512: 80}            # long side -> WebP quality
PREVIEW_TILE, PREVIEW_PAD, PREVIEW_COLS, PREVIEW_QUALITY = 128, 8, 10, 70


def art_ids(here):
    src = open(os.path.join(here, '..', 'src', 'paintings.js')).read()
    return sorted(int(m) for m in re.findall(r'^  (\d+): \{url', src, re.M))


def main(originals):
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', 'assets', 'paintings')
    ids = art_ids(here)
    cell = PREVIEW_TILE + 2 * PREVIEW_PAD
    rows = -(-len(ids) // PREVIEW_COLS)
    atlas = np.zeros((rows * cell, PREVIEW_COLS * cell, 3), np.uint8)
    total = {k: 0 for k in SIZES}
    for k, art in enumerate(ids):
        im = Image.open(os.path.join(originals, f'{art}.png')).convert('RGB')
        for px, q in SIZES.items():
            s = min(1, px / max(im.size))
            small = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS) if s < 1 else im
            os.makedirs(os.path.join(out, str(px)), exist_ok=True)
            path = os.path.join(out, str(px), f'{art}.webp')
            small.save(path, 'WEBP', quality=q, method=6)
            total[px] += os.path.getsize(path)
        tile = np.asarray(im.resize((PREVIEW_TILE, PREVIEW_TILE), Image.LANCZOS))
        tile = np.pad(tile, ((PREVIEW_PAD, PREVIEW_PAD), (PREVIEW_PAD, PREVIEW_PAD), (0, 0)), mode='edge')
        r, c = divmod(k, PREVIEW_COLS)
        atlas[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = tile
    path = os.path.join(out, 'previews.webp')
    Image.fromarray(atlas).save(path, 'WEBP', quality=PREVIEW_QUALITY, method=6)
    for px in SIZES:
        print(f'{len(ids)} pictures at {px} px: {total[px] / 1e6:.1f} MB ({total[px] / len(ids) / 1e3:.0f} KB each)')
    print(f'previews: {os.path.getsize(path) / 1e3:.0f} KB ({atlas.shape[1]}x{atlas.shape[0]})')


if __name__ == '__main__':
    main(sys.argv[1])
