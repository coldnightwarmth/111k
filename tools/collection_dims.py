"""The paintings' pixel sizes, felt for on the CDN (the first bytes of each PNG), written run-length coded to
src/collection-dims.js so any piece's proportions are known without fetching it.

    python3 tools/collection_dims.py scan.json     # scan.json: {"1": [w, h], ...} (null where it couldn't be read)
"""
import json, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
B36 = '0123456789abcdefghijklmnopqrstuvwxyz'


def b36(n):
    s = ''
    while True:
        s = B36[n % 36] + s
        n //= 36
        if not n:
            return s


def main(path, count=56329):
    scan = json.load(open(path))
    dims = [tuple(scan.get(str(i)) or ()) or None for i in range(1, count + 1)]
    common = collections.Counter(d for d in dims if d).most_common()
    # every size seen, the commonest first (index 0 stands in for any that couldn't be read)
    sizes = [d for d, _ in common][:36]
    idx = [sizes.index(d) if d in sizes else 0 for d in dims]
    runs, i = [], 0
    while i < len(idx):
        j = i
        while j < len(idx) and idx[j] == idx[i]:
            j += 1
        runs.append(B36[idx[i]] + b36(j - i))
        i = j
    out = os.path.join(HERE, '..', 'src', 'collection-dims.js')
    with open(out, 'w') as f:
        f.write('// Written by tools/collection_dims.py: the paintings\' pixel sizes (felt for on the CDN), run-length coded.\n')
        f.write(f'export const PAINT_SIZES = {json.dumps([list(d) for d in sizes])};\n')
        f.write(f"export const PAINT_RUNS = '{','.join(runs)}';\n")
    print(len(sizes), 'sizes', len(runs), 'runs', os.path.getsize(out), 'bytes', sum(d is None for d in dims), 'unread')


if __name__ == '__main__':
    main(sys.argv[1])
