"""Writes the spray-can-only graffiti (tools/graffiti_more.py, graffiti_third.py, graffiti_fourth.py) to its own atlas next to the level:
assets/env/world-tags.json (where each piece sits) and assets/env/world-tags-N.webp (the pages).
The game loads these alongside the world and adds them to the spray cans' list; nothing here is painted
onto the walls, so the world doesn't need rebuilding or re-lighting.

    python3 tools/graffiti_tags.py
"""
import io, json, os, sys, time
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import graffiti as G          # noqa: E402
import graffiti_more as M     # noqa: E402
import graffiti_third as T    # noqa: E402
import graffiti_fourth as F   # noqa: E402

OUT = os.path.join(HERE, '..', 'assets', 'env')

if __name__ == '__main__':
    t = time.time()
    pieces = M.build_extra()
    batch = {n: 2 for n in pieces}            # which batch each came in (the review page's "latest batch")
    for k, more in ((3, T.build_third()), (4, F.build_fourth())):
        assert not set(more) & set(pieces), set(more) & set(pieces)
        pieces.update(more)
        batch.update({n: k for n in more})
    pages = G.pack_pages(pieces, width=2048, max_h=2048)
    meta = {'pages': len(pages), 'graffiti': []}
    total = 0
    for old in os.listdir(OUT):
        if old.startswith('world-tags-') and old.endswith('.webp'):
            os.remove(os.path.join(OUT, old))
    for i, (img, rects) in enumerate(pages):
        buf = io.BytesIO()
        img.save(buf, 'WEBP', quality=88, alpha_quality=70, method=6)   # alpha off by at most ~10/255: lost in the spray noise
        with open(os.path.join(OUT, f'world-tags-{i}.webp'), 'wb') as f:
            f.write(buf.getvalue())
        total += buf.tell()
        for name, rr in sorted(rects.items()):
            meta['graffiti'].append({'name': name, 'page': f't{i}', 'uv': [round(float(x), 5) for x in rr['uv']],
                                     'w': round(float(rr['size'][0]), 3), 'h': round(float(rr['size'][1]), 3),
                                     'batch': batch[name]})
    meta['graffiti'].sort(key=lambda p: p['name'])
    with open(os.path.join(OUT, 'world-tags.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print(f'{len(pieces)} pieces on {len(pages)} pages {[p[0].size for p in pages]}, {total / 1e6:.2f} MB ({time.time() - t:.1f}s)')
