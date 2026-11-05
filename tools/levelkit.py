"""levelkit: a tiny code-driven modeler + lightmap baker for 111k.

Geometry is authored in Python as boxes, cylinders and quads (metres, y up).
Lighting from point/line lights, ambient occlusion and grime are baked into a
single lightmap atlas, so the browser renders the room with cheap unlit
materials (MeshBasicMaterial + lightMap), which is what keeps it fast on phones.

Outputs per level:
  <name>.glb          geometry, base textures (WebP), KHR_materials_unlit, uv1 = lightmap UVs
  <name>-lightmap.png baked lighting (sRGB, value = irradiance / LM_SCALE)
  <name>.json         colliders, runtime lights for avatars, spawn points, flicker info
"""
import io, json, math, struct
import numpy as np
from PIL import Image

LM_SCALE = 2.0  # lightmap stores light / LM_SCALE so it can exceed 1.0


# ----------------------------------------------------------------- math utils
def rot(yaw=0.0, pitch=0.0, roll=0.0):
    """Rotation matrix: roll about z, then pitch about x, then yaw about y."""
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    Rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return Ry @ Rx @ Rz


def srgb_encode(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


# ------------------------------------------------------------------ materials
class Material:
    def __init__(self, name, image=None, color=(1, 1, 1), tile=1.0, alpha=False, emissive=False,
                 double=False, lightmap=True):
        self.name, self.image, self.color, self.tile = name, image, color, tile
        self.alpha, self.emissive, self.double = alpha, emissive, double
        self.lightmap = lightmap and not emissive


# --------------------------------------------------------------------- level
class Level:
    def __init__(self, density=24, lm_width=1024):
        self.faces = []        # dicts: mat, pts (3|4 x3), uv (3|4 x2), lm (bool), grime(fn|None)
        self.occluders = []    # (center, half, R)
        self.lights = []       # bake lights
        self.runtime_lights = []
        self.colliders = []    # {x,z,hx,hz,yaw,y0,y1}
        self.spawns = []
        self.meta = {}
        self.density, self.lm_width = density, lm_width

    # -- primitives ----------------------------------------------------------
    def face(self, pts, mat, uv=None, lm=True, grime=None, uv_offset=(0, 0)):
        pts = np.asarray(pts, float)
        if uv is None:
            # project onto the face's own axes, in metres / tile
            e1 = pts[1] - pts[0]
            n = np.cross(pts[1] - pts[0], pts[-1] - pts[0])
            n /= np.linalg.norm(n) + 1e-12
            e1 /= np.linalg.norm(e1) + 1e-12
            e2 = np.cross(n, e1)
            rel = pts - pts[0]
            uv = np.stack([rel @ e1, rel @ e2], 1) / mat.tile + np.asarray(uv_offset)
        self.faces.append({'mat': mat, 'pts': pts, 'uv': np.asarray(uv, float), 'lm': lm and mat.lightmap,
                           'grime': grime})

    def box(self, center, size, mat, yaw=0.0, pitch=0.0, roll=0.0, faces='+x-x+y-y+z-z', occlude=True,
            collide=False, world_uv=True, grime=None, mats=None, uv_offset=None):
        """Axis-aligned (then rotated) box. `faces` lists the sides to emit.
        world_uv=True maps textures by world position so neighbouring boxes line up."""
        c = np.asarray(center, float)
        h = np.asarray(size, float) / 2
        R = rot(yaw, pitch, roll)
        if occlude:
            self.occluders.append((c, h, R))
        if collide:
            self.colliders.append({'x': float(c[0]), 'z': float(c[2]), 'hx': float(h[0]), 'hz': float(h[2]),
                                   'yaw': float(yaw), 'y0': float(c[1] - h[1]), 'y1': float(c[1] + h[1])})
        # local corner sets per face, counter-clockwise seen from outside
        defs = {
            '+x': [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)],
            '-x': [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)],
            '+y': [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)],
            '-y': [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)],
            '+z': [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)],
            '-z': [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)],
        }
        for key, corners in defs.items():
            if key not in faces:
                continue
            m = (mats or {}).get(key, mat)
            pts = np.array([c + R @ (np.array(k) * h) for k in corners])
            uv = None
            if world_uv:
                axis = {'x': 0, 'y': 1, 'z': 2}[key[1]]
                # planar projection in world space, axes chosen per face orientation
                n = R @ np.eye(3)[axis] * (1 if key[0] == '+' else -1)
                a = int(np.argmax(np.abs(n)))
                if a == 1:
                    uv = np.stack([pts[:, 0], -pts[:, 2] * np.sign(n[1])], 1)
                elif a == 0:
                    uv = np.stack([-pts[:, 2] * np.sign(n[0]), pts[:, 1]], 1)
                else:
                    uv = np.stack([pts[:, 0] * np.sign(n[2]), pts[:, 1]], 1)
                uv = uv / m.tile + (np.asarray(uv_offset) if uv_offset is not None else 0)
            self.face(pts, m, uv=uv, grime=grime)

    def cylinder(self, base, radius, height, mat, sides=8, caps=True, occlude=True, collide=False, yaw=0.0,
                 axis='y', cap_mat=None, grime=None):
        b = np.asarray(base, float)
        if axis == 'y':
            R = rot(yaw)
        elif axis == 'x':
            R = rot(yaw, 0, -math.pi / 2)
        else:
            R = rot(yaw, math.pi / 2, 0)
        ring = [np.array([math.cos(2 * math.pi * i / sides + math.pi / sides) * radius, 0,
                          -math.sin(2 * math.pi * i / sides + math.pi / sides) * radius]) for i in range(sides)]
        up = np.array([0, height, 0])
        circ = 2 * math.pi * radius
        for i in range(sides):
            a, bb = ring[i], ring[(i + 1) % sides]
            pts = [b + R @ a, b + R @ bb, b + R @ (bb + up), b + R @ (a + up)]
            u0, u1 = i / sides * circ / mat.tile, (i + 1) / sides * circ / mat.tile
            self.face(pts, mat, uv=[(u0, 0), (u1, 0), (u1, height / mat.tile), (u0, height / mat.tile)], grime=grime)
        if caps:
            cm = cap_mat or mat
            top = [b + R @ (r + up) for r in ring]
            bot = [b + R @ r for r in reversed(ring)]
            for poly in (top, bot):
                cen = sum(poly) / len(poly)
                for i in range(len(poly)):
                    tri = [cen, poly[i], poly[(i + 1) % len(poly)]]
                    uv = np.array([[p[0], p[2]] for p in tri]) / cm.tile
                    self.face(tri, cm, uv=uv, grime=grime)
        if occlude:
            # approximate the cylinder by an inscribed-ish box for shadows
            hh = np.array([radius * 0.85, height / 2, radius * 0.85])
            self.occluders.append((b + R @ (up / 2), hh, R))
        if collide:
            c = b + R @ (up / 2)
            self.colliders.append({'x': float(c[0]), 'z': float(c[2]), 'r': float(radius),
                                   'y0': float(b[1]), 'y1': float(b[1] + height)})

    def light(self, pos, color, intensity, range_, samples=None, runtime=True, flicker=None, name=None):
        """Point light (or a set of sample offsets for area/line lights)."""
        pos = np.asarray(pos, float)
        pts = [pos + np.asarray(o) for o in (samples or [(0, 0, 0)])]
        self.lights.append({'pts': pts, 'color': np.asarray(color, float), 'intensity': intensity, 'range': range_,
                            'flicker': flicker})
        if runtime:
            self.runtime_lights.append({'name': name, 'pos': [float(x) for x in pos], 'color': list(map(float, color)),
                                        'intensity': float(intensity), 'range': float(range_), 'flicker': flicker})

    # -- lightmap -------------------------------------------------------------
    def _pack(self):
        pad = 2
        rects = []
        for i, f in enumerate(self.faces):
            if not f['lm']:
                continue
            p = f['pts']
            if len(p) == 4:
                w = np.linalg.norm(p[1] - p[0]); h = np.linalg.norm(p[3] - p[0])
            else:
                w = np.linalg.norm(p[1] - p[0]); h = np.linalg.norm(p[2] - p[0])
            tw = max(2, int(math.ceil(w * self.density)))
            th = max(2, int(math.ceil(h * self.density)))
            rects.append([i, tw, th])
        rects.sort(key=lambda r: -r[2])
        W = self.lm_width
        x = y = shelf = 0
        for r in rects:
            tw, th = r[1] + 2 * pad, r[2] + 2 * pad
            if tw > W:
                raise ValueError('face too large for lightmap width')
            if x + tw > W:
                x, y, shelf = 0, y + shelf, 0
            r.append((x, y)); x += tw; shelf = max(shelf, th)
        H = y + shelf
        H = (H + 3) // 4 * 4
        return rects, W, H, pad

    def bake(self, ambient=(0.012, 0.014, 0.02), ao_rays=24, ao_dist=0.9, ao_strength=0.85, bounce=0.3, seed=1):
        rng = np.random.default_rng(seed)
        rects, W, H, pad = self._pack()
        # gather texel samples
        P, N, idx, face_of = [], [], [], []
        for (i, tw, th, (ox, oy)) in rects:
            f = self.faces[i]; p = f['pts']
            gx, gy = np.meshgrid(np.arange(tw + 2 * pad), np.arange(th + 2 * pad))
            s = np.clip((gx - pad + 0.5) / tw, 0.0, 1.0)
            t = np.clip((gy - pad + 0.5) / th, 0.0, 1.0)
            if len(p) == 4:
                pos = (p[0][None, None] * ((1 - s) * (1 - t))[..., None] + p[1][None, None] * (s * (1 - t))[..., None]
                       + p[2][None, None] * (s * t)[..., None] + p[3][None, None] * ((1 - s) * t)[..., None])
                n = np.cross(p[1] - p[0], p[3] - p[0])
            else:
                # triangle mapped onto the lower-left half; clamp to stay inside
                ss, tt = s.copy(), t.copy()
                over = ss + tt > 1
                k = (ss + tt)[over]; ss[over] /= k; tt[over] /= k
                pos = (p[0][None, None] * (1 - ss - tt)[..., None] + p[1][None, None] * ss[..., None]
                       + p[2][None, None] * tt[..., None])
                n = np.cross(p[1] - p[0], p[2] - p[0])
            n = n / (np.linalg.norm(n) + 1e-12)
            P.append(pos.reshape(-1, 3)); N.append(np.broadcast_to(n, (pos.shape[0] * pos.shape[1], 3)))
            yy, xx = np.meshgrid(np.arange(th + 2 * pad) + oy, np.arange(tw + 2 * pad) + ox, indexing='ij')
            idx.append(np.stack([yy.ravel(), xx.ravel()], 1)); face_of.append(np.full(yy.size, i))
            f['lmrect'] = (ox + pad, oy + pad, tw, th)
        P = np.concatenate(P); N = np.ascontiguousarray(np.concatenate(N)); idx = np.concatenate(idx)
        face_of = np.concatenate(face_of)
        origin = P + N * 0.015
        occ = self.occluders
        C = np.array([o[0] for o in occ]); Hh = np.array([o[1] for o in occ]); Rs = np.array([o[2] for o in occ])

        RAD = np.linalg.norm(Hh, axis=1)

        def blocked(o, d, maxd):
            """o,d: (n,3) rays (d unit), maxd: (n,) -> bool hit before maxd.
            Each box is only slab-tested against rays whose segment passes
            within its bounding sphere."""
            hit = np.zeros(len(o), bool)
            for k in range(len(C)):
                rel = C[k] - o
                t = np.clip(np.einsum('ij,ij->i', rel, d), 0, maxd)
                near = np.einsum('ij,ij->i', rel - d * t[:, None], rel - d * t[:, None]) < RAD[k] ** 2
                near &= ~hit
                if not near.any():
                    continue
                sel = np.nonzero(near)[0]
                Rt = Rs[k].T
                lo = (o[sel] - C[k]) @ Rt.T
                ld = d[sel] @ Rt.T
                ld = np.where(np.abs(ld) < 1e-9, 1e-9, ld)
                inv = 1.0 / ld
                t1 = (-Hh[k] - lo) * inv; t2 = (Hh[k] - lo) * inv
                tmin = np.max(np.minimum(t1, t2), 1); tmax = np.min(np.maximum(t1, t2), 1)
                hit[sel] = (tmax >= np.maximum(tmin, 0)) & (tmin < maxd[sel])
            return hit

        direct = np.zeros_like(P)
        for L in self.lights:
            acc = np.zeros(len(P))
            for lp in L['pts']:
                v = lp - origin; d = np.linalg.norm(v, axis=1); dirs = v / d[:, None]
                ndl = np.clip(np.einsum('ij,ij->i', N, dirs), 0, None)
                win = np.clip(1 - (d / L['range']) ** 4, 0, 1) ** 2
                att = win / (d * d + 0.25)
                live = (ndl > 0) & (win > 0)
                vis = np.ones(len(P))
                if live.any():
                    vis[live] = ~blocked(origin[live], dirs[live], d[live] - 0.03)
                acc += ndl * att * vis
            direct += (acc / len(L['pts']))[:, None] * L['color'][None] * L['intensity']
        # ambient occlusion + a crude one-bounce term from the average direct light
        occl = np.zeros(len(P))
        for r in range(ao_rays):
            u1, u2 = rng.random(len(P)), rng.random(len(P))
            rr, ph = np.sqrt(u1), 2 * np.pi * u2
            local = np.stack([rr * np.cos(ph), rr * np.sin(ph), np.sqrt(1 - u1)], 1)
            a = np.where(np.abs(N[:, 1:2]) < 0.9, np.array([[0, 1, 0]]), np.array([[1, 0, 0]]))
            tng = np.cross(a, N); tng /= np.linalg.norm(tng, axis=1, keepdims=True)
            btg = np.cross(N, tng)
            d = local[:, :1] * tng + local[:, 1:2] * btg + local[:, 2:] * N
            occl += blocked(origin, d, np.full(len(P), ao_dist))
        ao = 1 - ao_strength * occl / ao_rays
        avg = direct.mean(0)
        light = (direct + (np.asarray(ambient) + avg * bounce)[None] * ao[:, None]) * (0.55 + 0.45 * ao[:, None])
        # grime: per-face multiplicative darkening
        for i in np.unique(face_of):
            g = self.faces[i]['grime']
            if g is None:
                continue
            m = face_of == i
            light[m] *= np.clip(g(P[m], N[m]), 0, 2)[:, None]
        img = np.zeros((H, W, 3))
        img[idx[:, 0], idx[:, 1]] = light
        self.lightmap = img
        self.lm_size = (W, H)
        enc = (srgb_encode(img / LM_SCALE) * 255 + 0.5).astype(np.uint8)
        return Image.fromarray(enc, 'RGB')

    # -- export ---------------------------------------------------------------
    def export(self, path_base, webp_quality=86):
        lm_img = self.bake() if not hasattr(self, 'lightmap') else None
        W, H = self.lm_size
        mats = []
        for f in self.faces:
            if f['mat'] not in mats:
                mats.append(f['mat'])
        bin_chunks, size = [], 0
        views, accessors = [], []

        def add_view(data, target=None):
            nonlocal size
            pad = (-size) % 4
            if pad:
                bin_chunks.append(b'\0' * pad); size += pad
            v = {'buffer': 0, 'byteOffset': size, 'byteLength': len(data)}
            if target: v['target'] = target
            bin_chunks.append(data); size += len(data); views.append(v)
            return len(views) - 1

        def add_acc(arr, ctype, typ, normalized=False, target=34962, minmax=False):
            acc = {'bufferView': add_view(np.ascontiguousarray(arr).tobytes(), target), 'componentType': ctype,
                   'count': int(arr.shape[0]), 'type': typ}
            if normalized: acc['normalized'] = True
            if minmax:
                acc['min'] = [float(x) for x in arr.min(0)]; acc['max'] = [float(x) for x in arr.max(0)]
            accessors.append(acc)
            return len(accessors) - 1

        images, textures, materials, meshes, nodes = [], [], [], [], []
        img_index = {}
        for m in mats:
            mat = {'name': m.name, 'pbrMetallicRoughness': {'baseColorFactor': list(m.color) + [1.0],
                                                             'metallicFactor': 0.0, 'roughnessFactor': 1.0},
                   'extensions': {'KHR_materials_unlit': {}}, 'extras': {'lightmap': m.lightmap, 'emissive': m.emissive}}
            if m.double: mat['doubleSided'] = True
            if m.alpha == 'BLEND': mat['alphaMode'] = 'BLEND'
            elif m.alpha: mat['alphaMode'] = 'MASK'; mat['alphaCutoff'] = 0.5
            if m.image is not None:
                key = id(m.image)
                if key not in img_index:
                    buf = io.BytesIO()
                    im = m.image.convert('RGBA' if m.alpha else 'RGB')
                    im.save(buf, 'WEBP', quality=webp_quality, method=6, lossless=False)
                    images.append({'mimeType': 'image/webp', 'bufferView': add_view(buf.getvalue()), 'name': m.name})
                    textures.append({'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(images) - 1}}})
                    img_index[key] = len(textures) - 1
                mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': img_index[key]}
            materials.append(mat)
            # geometry for this material
            pos, nor, uv0, uv1, ind = [], [], [], [], []
            base = 0
            for f in self.faces:
                if f['mat'] is not m:
                    continue
                p = f['pts']
                n = np.cross(p[1] - p[0], p[-1] - p[0]); n /= np.linalg.norm(n) + 1e-12
                pos.append(p); nor.append(np.tile(n, (len(p), 1))); uv0.append(f['uv'])
                if f['lm']:
                    ox, oy, tw, th = f['lmrect']
                    if len(p) == 4:
                        st = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float)
                    else:
                        st = np.array([[0, 0], [1, 0], [0, 1]], float)
                    lu = (ox + st[:, 0] * tw) / W; lv = (oy + st[:, 1] * th) / H
                    uv1.append(np.stack([lu, lv], 1))
                else:
                    uv1.append(np.zeros((len(p), 2)))
                ind.extend([base, base + 1, base + 2] + ([base, base + 2, base + 3] if len(p) == 4 else []))
                base += len(p)
            P = np.concatenate(pos).astype(np.float32)
            attrs = {'POSITION': add_acc(P, 5126, 'VEC3', minmax=True),
                     'NORMAL': add_acc(np.concatenate(nor).astype(np.float32), 5126, 'VEC3'),
                     'TEXCOORD_0': add_acc(np.concatenate(uv0).astype(np.float32), 5126, 'VEC2')}
            if m.lightmap:
                attrs['TEXCOORD_1'] = add_acc(np.round(np.clip(np.concatenate(uv1), 0, 1) * 65535).astype(np.uint16),
                                              5123, 'VEC2', normalized=True)
            I = np.array(ind)
            iacc = add_acc(I.astype(np.uint16 if I.max() < 65536 else np.uint32), 5123 if I.max() < 65536 else 5125,
                           'SCALAR', target=34963)
            meshes.append({'name': m.name, 'primitives': [{'attributes': attrs, 'indices': iacc, 'material': len(materials) - 1}]})
            nodes.append({'name': m.name, 'mesh': len(meshes) - 1})
        gl = {'asset': {'version': '2.0', 'generator': 'levelkit (111k)'}, 'scene': 0,
              'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes, 'materials': materials,
              'accessors': accessors, 'bufferViews': views,
              'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
              'extensionsUsed': ['KHR_materials_unlit', 'KHR_mesh_quantization', 'EXT_texture_webp'],
              'extensionsRequired': ['KHR_mesh_quantization', 'EXT_texture_webp']}
        if images: gl['images'] = images; gl['textures'] = textures
        binbytes = b''.join(bin_chunks); binbytes += b'\0' * ((-len(binbytes)) % 4)
        gl['buffers'] = [{'byteLength': len(binbytes)}]
        js = json.dumps(gl, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
        with open(path_base + '.glb', 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binbytes)))
            f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack('<II', len(binbytes), 0x004E4942)); f.write(binbytes)
        if lm_img is not None:
            lm_img.save(path_base + '-lightmap.png', optimize=True)
        data = {'lightmapScale': LM_SCALE, 'colliders': self.colliders, 'lights': self.runtime_lights,
                'spawns': self.spawns, **self.meta}
        with open(path_base + '.json', 'w') as f:
            json.dump(data, f, indent=1)
        tris = sum(1 if len(f['pts']) == 3 else 2 for f in self.faces)
        return {'triangles': tris, 'materials': len(mats), 'lightmap': (W, H), 'glb_bytes': 28 + len(js) + len(binbytes)}
