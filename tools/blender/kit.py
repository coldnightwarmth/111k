"""kit: build 111k levels with Blender (bpy as a Python module).

Geometry is authored in Python in game space (metres, y up), optionally inside
local frames (a room is built around its own origin, then placed). Blender
does the heavy lifting: lightmap UV unwrapping and packing, a Cycles bake of
direct + bounced light, OpenImageDenoise, and preview renders.

Outputs per level (same contract as before, read by src/level.js):
  <name>.glb          unlit materials, WebP textures, TEXCOORD_1 = lightmap UVs
  <name>-lightmap.png baked light (sRGB of irradiance / LM_SCALE)
  <name>.json         colliders, runtime lights for avatars, spawns, metadata
"""
import contextlib, json, math, os, subprocess, sys, time
import numpy as np
import bpy, bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from glbwrite import write_glb  # noqa: E402

LM_SCALE = 2.0
WATTS = 60.0  # Cycles watts per unit of game light intensity


def rot(yaw=0.0, pitch=0.0, roll=0.0):
    """roll about z, then pitch about x, then yaw about y (yaw turns +x toward -z)."""
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    Rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return Ry @ Rx @ Rz


def g2b(p):
    return (p[0], -p[2], p[1])


def srgb_encode(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def aces(x):
    """three.js ACESFilmicToneMapping, for previews that match the game."""
    x = x * (1 / 0.6)
    m1 = np.array([[0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]])
    m2 = np.array([[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]])
    v = x @ m1
    a = v * (v + 0.0245786) - 0.000090537
    b = v * (0.983729 * v + 0.4329510) + 0.238081
    return np.clip((a / b) @ m2, 0, 1)


class Mat:
    def __init__(self, name, image=None, tile=1.0, alpha=None, emit=0.0, lightmap=True, double=False,
                 color=(1, 1, 1), flicker=None):
        self.name, self.image, self.tile, self.alpha, self.emit = name, image, tile, alpha, emit
        self.lightmap = lightmap and not emit
        self.emissive = emit > 0
        self.double, self.color, self.flicker = double, color, flicker
        self.bmat = None


def orient(pts, toward):
    """Wind a planar polygon so its normal faces the point `toward`."""
    pts = np.asarray(pts, float)
    n = np.cross(pts[1] - pts[0], pts[-1] - pts[0])
    if len(pts) > 3:  # robust normal for slightly bent polygons
        n = np.zeros(3)
        for i in range(len(pts)):
            n += np.cross(pts[i], pts[(i + 1) % len(pts)])
    return pts if np.dot(n, np.asarray(toward) - pts.mean(0)) >= 0 else pts[::-1]


class World:
    def __init__(self, name):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.name = name
        self.geo = {}             # (part, mat) -> {'v': [], 'f': [], 'uv': []}
        self.mats = {}
        self.colliders, self.bake_lights, self.runtime_lights, self.spawns = [], [], [], []
        self.meta = {}
        self.frames = [(np.eye(3), np.zeros(3), 0.0)]
        self.part, self.density = 'main', 1.0
        self.part_density = {}

    # ---------------------------------------------------------------- frames
    @contextlib.contextmanager
    def frame(self, origin=(0, 0, 0), yaw=0.0):
        R0, o0, y0 = self.frames[-1]
        R = R0 @ rot(yaw)
        self.frames.append((R, o0 + R0 @ np.asarray(origin, float), y0 + yaw))
        try:
            yield
        finally:
            self.frames.pop()

    @contextlib.contextmanager
    def using(self, part=None, density=None):
        old = self.part, self.density
        self.part = part or self.part
        self.density = density if density is not None else self.density
        self.part_density.setdefault(self.part, self.density)
        try:
            yield
        finally:
            self.part, self.density = old

    def T(self, p):
        R, o, _ = self.frames[-1]
        return o + np.asarray(p, float) @ R.T

    @property
    def yaw(self):
        return self.frames[-1][2]

    # ------------------------------------------------------------ primitives
    def mat(self, m):
        self.mats.setdefault(m.name, m)
        return m

    def face(self, pts, mat, uv=None, uv_offset=(0, 0), world=False):
        """Polygon in the current frame (or world space). uv in glTF convention."""
        pts = np.asarray(pts, float)
        if uv is None:
            e1 = pts[1] - pts[0]
            n = np.cross(pts[1] - pts[0], pts[-1] - pts[0])
            n /= np.linalg.norm(n) + 1e-12
            e1 = e1 / (np.linalg.norm(e1) + 1e-12)
            e2 = np.cross(n, e1)
            rel = pts - pts[0]
            uv = np.stack([rel @ e1, -(rel @ e2)], 1) / mat.tile + np.asarray(uv_offset)
        wp = pts if world else self.T(pts)
        g = self.geo.setdefault((self.part, self.mat(mat).name), {'v': [], 'f': [], 'uv': []})
        base = len(g['v'])
        g['v'].extend(wp.tolist())
        g['f'].append(list(range(base, base + len(wp))))
        g['uv'].extend(np.asarray(uv, float).tolist())

    def box(self, center, size, mat, yaw=0.0, pitch=0.0, roll=0.0, faces='+x-x+y-y+z-z', collide=False,
            world_uv=True, uv_offset=None, mats=None, uv_const=None):
        c = np.asarray(center, float)
        h = np.asarray(size, float) / 2
        R = rot(yaw, pitch, roll)
        if collide:
            self.collider_box(c, h[0], h[2], yaw, c[1] - h[1], c[1] + h[1])
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
            if uv_const is not None:
                uv = np.tile(uv_const, (4, 1))
            elif world_uv:
                axis = {'x': 0, 'y': 1, 'z': 2}[key[1]]
                n = R @ np.eye(3)[axis] * (1 if key[0] == '+' else -1)
                a = int(np.argmax(np.abs(n)))
                if a == 1:
                    uv = np.stack([pts[:, 0], -pts[:, 2] * np.sign(n[1])], 1)
                elif a == 0:
                    uv = np.stack([-pts[:, 2] * np.sign(n[0]), -pts[:, 1]], 1)
                else:
                    uv = np.stack([pts[:, 0] * np.sign(n[2]), -pts[:, 1]], 1)
                uv = uv / m.tile + (np.asarray(uv_offset) if uv_offset is not None else 0)
            self.face(pts, m, uv=uv)

    def cylinder(self, base, radius, height, mat, sides=8, caps=True, collide=False, yaw=0.0, axis='y', cap_mat=None,
                 pitch=0.0, uv_const=None):
        b = np.asarray(base, float)
        R = rot(yaw, pitch) if axis == 'y' else rot(yaw, 0, -math.pi / 2) if axis == 'x' else rot(yaw, math.pi / 2, 0)
        ring = [np.array([math.cos(2 * math.pi * i / sides + math.pi / sides) * radius, 0,
                          -math.sin(2 * math.pi * i / sides + math.pi / sides) * radius]) for i in range(sides)]
        up = np.array([0, height, 0])
        circ = 2 * math.pi * radius
        for i in range(sides):
            a, bb = ring[i], ring[(i + 1) % sides]
            pts = [b + R @ a, b + R @ bb, b + R @ (bb + up), b + R @ (a + up)]
            u0, u1 = i / sides * circ / mat.tile, (i + 1) / sides * circ / mat.tile
            uv = [(u0, 0), (u1, 0), (u1, -height / mat.tile), (u0, -height / mat.tile)]
            self.face(pts, mat, uv=np.tile(uv_const, (4, 1)) if uv_const is not None else uv)
        if caps:
            cm = cap_mat or mat
            for poly in ([b + R @ (r + up) for r in ring], [b + R @ r for r in reversed(ring)]):
                uv = np.array([[p[0], p[2]] for p in poly]) / cm.tile
                if uv_const is not None:
                    uv = np.tile(uv_const, (len(poly), 1))
                self.face(poly, cm, uv=uv)
        if collide:
            c = b + R @ (up / 2)
            self.collider_circle(c, radius, b[1], b[1] + height)

    # ------------------------------------------------------------ colliders
    def collider_box(self, center, hx, hz, yaw, y0, y1):
        c = self.T(center)
        self.colliders.append({'x': round(float(c[0]), 3), 'z': round(float(c[2]), 3), 'hx': round(float(hx), 3),
                               'hz': round(float(hz), 3), 'yaw': round(float(yaw + self.yaw), 4),
                               'y0': round(float(y0), 3), 'y1': round(float(y1), 3)})

    def collider_circle(self, center, r, y0, y1):
        c = self.T(center)
        self.colliders.append({'x': round(float(c[0]), 3), 'z': round(float(c[2]), 3), 'r': round(float(r), 3),
                               'y0': round(float(y0), 3), 'y1': round(float(y1), 3)})

    # --------------------------------------------------------------- lights
    def light(self, pos, color, intensity, range_, radius=0.05, area=None, runtime=True, flicker=None, name=None,
              bake=True, runtime_intensity=None):
        """Point light (radius = soft shadow size) or rectangular area light
        area=(w, l, yaw) facing down. intensity is in game units."""
        p = self.T(pos)
        if bake:
            self.bake_lights.append({'pos': p, 'color': color, 'intensity': intensity, 'radius': radius,
                                     'area': None if area is None else (area[0], area[1], area[2] + self.yaw)})
        if runtime:
            self.runtime_lights.append({'name': name, 'pos': [round(float(x), 3) for x in p],
                                        'color': [float(c) for c in color],
                                        'intensity': float(runtime_intensity or intensity), 'range': float(range_),
                                        'flicker': flicker})

    # ---------------------------------------------------------------- build
    def _materials(self):
        for m in self.mats.values():
            bm_ = bpy.data.materials.new(m.name)
            nt = bm_.node_tree
            nodes = nt.nodes
            out = nodes['Material Output']
            for n in list(nodes):
                if n != out:
                    nodes.remove(n)
            bsdf = nodes.new('ShaderNodeBsdfDiffuse')
            col = nodes.new('ShaderNodeRGB')
            avg = np.asarray(m.color, float)
            if m.image is not None:
                a = np.asarray(m.image.convert('RGB'), float) / 255
                avg = avg * ((a ** 2.2).reshape(-1, 3).mean(0))  # mean albedo is plenty for bounce light
            col.outputs[0].default_value = (*np.clip(avg, 0, 0.9), 1)
            nt.links.new(col.outputs[0], bsdf.inputs['Color'])
            shader = bsdf
            if m.emit:
                em = nodes.new('ShaderNodeEmission')
                em.inputs['Color'].default_value = (*np.clip(avg / max(avg.max(), 1e-3), 0, 1), 1)
                em.inputs['Strength'].default_value = m.emit
                add = nodes.new('ShaderNodeAddShader')
                nt.links.new(bsdf.outputs[0], add.inputs[0]); nt.links.new(em.outputs[0], add.inputs[1])
                shader = add
            nt.links.new(shader.outputs[0], out.inputs['Surface'])
            m.bmat = bm_

    def _objects(self):
        objs = {}
        for (part, mname), g in self.geo.items():
            me = bpy.data.meshes.new(f'{part}:{mname}')
            me.from_pydata([g2b(v) for v in g['v']], [], g['f'])
            uv = me.uv_layers.new(name='uv')
            luv = np.asarray(g['uv'], float)
            luv[:, 1] = 1 - luv[:, 1]  # glTF v down -> Blender v up
            uv.data.foreach_set('uv', luv.ravel())
            me.materials.append(self.mats[mname].bmat)
            bm = bmesh.new(); bm.from_mesh(me)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
            bm.to_mesh(me); bm.free()
            ob = bpy.data.objects.new(me.name, me)
            bpy.context.scene.collection.objects.link(ob)
            objs.setdefault(part, []).append(ob)
        return objs

    @staticmethod
    def _min_island_size(objs, lm_size, min_texels=4, fill=0.7):
        """Stretch islands smaller than a few texels (cans, wires, shelf posts)
        so the bake has something to land on."""
        from bpy_extras import bmesh_utils
        data = []
        total = 0.0
        for o in objs:
            bm = bmesh.new(); bm.from_mesh(o.data)
            uvl = bm.loops.layers.uv['lm']
            islands = bmesh_utils.bmesh_linked_uv_islands(bm, uvl)
            boxes = []
            for isl in islands:
                uv = np.array([l[uvl].uv[:] for f in isl for l in f.loops])
                lo, hi = uv.min(0), uv.max(0)
                boxes.append((isl, lo, hi))
                total += (hi[0] - lo[0] + 1e-9) * (hi[1] - lo[1] + 1e-9)
            data.append((o, bm, uvl, boxes))
        scale = math.sqrt(fill / max(total, 1e-12))      # rough pack scale (uv units -> 0..1)
        min_dim = min_texels / lm_size / scale
        stretched = 0
        for o, bm, uvl, boxes in data:
            for isl, lo, hi in boxes:
                size = hi - lo
                k = np.maximum(1.0, min_dim / np.maximum(size, 1e-9))
                if (k > 1).any():
                    c = (lo + hi) / 2
                    for f in isl:
                        for l in f.loops:
                            l[uvl].uv = tuple(c + (np.array(l[uvl].uv[:]) - c) * k)
                    stretched += 1
            bm.to_mesh(o.data); bm.free()
        print(f'  stretched {stretched} tiny lightmap islands')

    @staticmethod
    def _project_decals(decals, surfaces):
        """Give each decal face the lightmap coordinates of the wall behind it, so
        paint is lit exactly like the surface it is painted on."""
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
        from mathutils.geometry import barycentric_transform
        trees = []
        for o in surfaces:
            me = o.data
            trees.append((BVHTree.FromPolygons([v.co[:] for v in me.vertices], [p.vertices[:] for p in me.polygons]), me))
        missed = 0
        for d in decals:
            me = d.data
            lm = me.uv_layers['lm']
            for poly in me.polygons:
                c, n = poly.center, poly.normal
                best = None
                for tree, sm in trees:
                    hit = tree.ray_cast(c + n * 0.05, -n, 0.2)
                    if hit[0] is not None and (best is None or hit[3] < best[3]):
                        best = (*hit, sm)
                if best is None:
                    missed += 1
                    continue
                sm = best[4]
                sp = sm.polygons[best[2]]
                slm = sm.uv_layers['lm']
                # three corners of the wall polygon that are not collinear
                idx = list(sp.loop_indices)
                A = sm.vertices[sm.loops[idx[0]].vertex_index].co
                for j in range(1, len(idx) - 1):
                    B = sm.vertices[sm.loops[idx[j]].vertex_index].co
                    C = sm.vertices[sm.loops[idx[j + 1]].vertex_index].co
                    if (B - A).cross(C - A).length > 1e-8:
                        break
                ua = Vector((*slm.data[idx[0]].uv, 0)); ub = Vector((*slm.data[idx[j]].uv, 0)); uc = Vector((*slm.data[idx[j + 1]].uv, 0))
                for li in poly.loop_indices:
                    p = me.vertices[me.loops[li].vertex_index].co
                    uv = barycentric_transform(p, A, B, C, ua, ub, uc)
                    lm.data[li].uv = (uv[0], uv[1])
        print(f'  decals mapped onto their walls ({missed} unplaced)')

    def _lights(self):
        sc = bpy.context.scene
        for i, L in enumerate(self.bake_lights):
            if L['area']:
                ld = bpy.data.lights.new(f'L{i}', 'AREA')
                ld.shape = 'RECTANGLE'; ld.size, ld.size_y = L['area'][0], L['area'][1]
                ld.energy = L['intensity'] * WATTS * 2.2
            else:
                ld = bpy.data.lights.new(f'L{i}', 'POINT')
                ld.shadow_soft_size = L['radius']
                ld.energy = L['intensity'] * WATTS
            ld.color = L['color']
            ob = bpy.data.objects.new(f'L{i}', ld)
            ob.location = g2b(L['pos'])
            if L['area']:
                ob.rotation_euler = (0, 0, L['area'][2])  # area lights face -z (down) by default
            sc.collection.objects.link(ob)

    def build(self, out_base, lm_size=2048, samples=128, ambient=(0.0, 0.0, 0.0), grime=None, previews=(),
              preview_dir=None, denoise=True, fill=(0.0, 0.0, 0.0), chunk=None):
        t0 = time.time()
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = samples
        sc.cycles.max_bounces = 4
        sc.cycles.diffuse_bounces = 3
        sc.world = bpy.data.worlds.new('world')
        sc.world.color = ambient
        self._materials()
        objs = self._objects()
        self._lights()
        all_lm = [o for part, os_ in objs.items() for o in os_ if self.mats[o.data.materials[0].name].lightmap]
        decals = [o for o in all_lm if self.mats[o.data.materials[0].name].alpha]
        lm_objs = [o for o in all_lm if o not in decals]
        for o in decals:  # decals never block light, and borrow the lightmap of the wall they sit on
            o.visible_diffuse = o.visible_shadow = o.visible_glossy = o.visible_transmission = False
            o.visible_camera = False
            o.data.uv_layers.new(name='lm')
        print(f'  {len(lm_objs)} lightmapped objects, {sum(len(o.data.polygons) for o in lm_objs)} faces '
              f'({time.time() - t0:.1f}s)')

        # --- lightmap uvs: unwrap everything together, scale islands by part density, pack
        for o in lm_objs:
            o.data.uv_layers.new(name='lm')
            o.data.uv_layers.active = o.data.uv_layers['lm']
        bpy.ops.object.select_all(action='DESELECT')
        for o in lm_objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = lm_objs[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(40), island_margin=0.0, area_weight=0.0,
                                 scale_to_bounds=False)
        bpy.ops.uv.average_islands_scale()
        bpy.ops.object.mode_set(mode='OBJECT')
        for o in lm_objs:
            part = o.name.split(':')[0]
            k = self.part_density.get(part, 1.0)
            if k != 1.0:
                lm = o.data.uv_layers['lm']
                a = np.zeros(len(lm.data) * 2); lm.data.foreach_get('uv', a)
                lm.data.foreach_set('uv', a * k)
        self._min_island_size(lm_objs, lm_size)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.select_all(action='SELECT')
        margin = 5 / lm_size
        bpy.ops.uv.pack_islands(margin=margin, rotate=True, shape_method='AABB', margin_method='FRACTION')
        bpy.ops.object.mode_set(mode='OBJECT')
        print(f'  uv packed ({time.time() - t0:.1f}s)')

        # --- bake
        img = bpy.data.images.new('lightmap', lm_size, lm_size, float_buffer=True)
        pos_img = bpy.data.images.new('position', lm_size, lm_size, float_buffer=True)
        nor_img = bpy.data.images.new('normal', lm_size, lm_size, float_buffer=True)

        def set_target(image):
            for m in self.mats.values():
                nt = m.bmat.node_tree
                tex = nt.nodes.get('bake') or nt.nodes.new('ShaderNodeTexImage')
                tex.name = 'bake'; tex.image = image; nt.nodes.active = tex

        self._project_decals(decals, lm_objs)
        bpy.ops.object.select_all(action='DESELECT')
        for o in lm_objs:
            o.select_set(True)
        bk = sc.render.bake
        bk.target = 'IMAGE_TEXTURES'; bk.margin = 4; bk.margin_type = 'EXTEND'
        bk.use_pass_direct = bk.use_pass_indirect = True; bk.use_pass_color = False
        set_target(img)
        bpy.ops.object.bake(type='DIFFUSE', uv_layer='lm')
        print(f'  baked light ({time.time() - t0:.1f}s)')
        sc.cycles.samples = 1
        set_target(pos_img); bpy.ops.object.bake(type='POSITION', uv_layer='lm')
        set_target(nor_img); bk.normal_space = 'OBJECT'; bpy.ops.object.bake(type='NORMAL', uv_layer='lm')

        def pixels(image):
            a = np.empty(lm_size * lm_size * 4, np.float32); image.pixels.foreach_get(a)
            return a.reshape(lm_size, lm_size, 4)

        raw_path = out_base + '-raw.exr'
        img.filepath_raw = raw_path; img.file_format = 'OPEN_EXR'; img.save()
        if denoise:
            subprocess.run([sys.executable, os.path.join(HERE, 'denoise.py'), raw_path, out_base + '-dn.exr'],
                           check=True, capture_output=True)
            dimg = bpy.data.images.load(out_base + '-dn.exr')
            light = pixels(dimg)[..., :3].astype(float)
            os.remove(out_base + '-dn.exr')
        else:
            light = pixels(img)[..., :3].astype(float)
        os.remove(raw_path)
        P = pixels(pos_img)[..., :3].astype(float)
        P = np.stack([P[..., 0], P[..., 2], -P[..., 1]], -1)  # blender -> game
        Nn = pixels(nor_img)[..., :3].astype(float) * 2 - 1
        Nn = np.stack([Nn[..., 0], Nn[..., 2], -Nn[..., 1]], -1)
        # a little flat fill so unlit corners are dark rather than void
        light += np.asarray(fill, float)[None, None]
        if grime is not None:
            light *= np.clip(grime(P.reshape(-1, 3), Nn.reshape(-1, 3)), 0, 2).reshape(lm_size, lm_size, 1)
        light = np.maximum(light, 0)
        enc = (srgb_encode(light / LM_SCALE) * 255 + 0.5).astype(np.uint8)[::-1]  # top row first
        from PIL import Image
        lm_png = Image.fromarray(enc, 'RGB')
        lm_png.save(out_base + '-lightmap.webp', quality=92, method=6)
        print(f'  lightmap written ({time.time() - t0:.1f}s)')

        # --- export
        mats_out, tris = [], 0
        for m in self.mats.values():
            obs = [o for os_ in objs.values() for o in os_ if o.data.materials[0].name == m.name]
            pos, nor, uv0, uv1 = [], [], [], []
            for o in obs:
                me = o.data
                me.calc_loop_triangles()
                nt = len(me.loop_triangles)
                if not nt:
                    continue
                li = np.zeros(nt * 3, np.int32); me.loop_triangles.foreach_get('loops', li)
                pi = np.zeros(nt, np.int32); me.loop_triangles.foreach_get('polygon_index', pi)
                vi = np.zeros(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', vi)
                co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
                pn = np.zeros(len(me.polygons) * 3); me.polygons.foreach_get('normal', pn); pn = pn.reshape(-1, 3)
                u = np.zeros(len(me.loops) * 2); me.uv_layers['uv'].data.foreach_get('uv', u); u = u.reshape(-1, 2)
                p = co[vi[li]]
                pos.append(np.stack([p[:, 0], p[:, 2], -p[:, 1]], 1))
                n = np.repeat(pn[pi], 3, 0)
                nor.append(np.stack([n[:, 0], n[:, 2], -n[:, 1]], 1))
                uu = u[li].copy(); uu[:, 1] = 1 - uu[:, 1]; uv0.append(uu)
                if m.lightmap:
                    l = np.zeros(len(me.loops) * 2); me.uv_layers['lm'].data.foreach_get('uv', l); l = l.reshape(-1, 2)
                    ll = l[li].copy(); ll[:, 1] = 1 - ll[:, 1]; uv1.append(ll)
                tris += nt
            if not pos:
                continue
            cols = [np.concatenate(pos), np.concatenate(uv0)] + ([np.concatenate(uv1)] if uv1 else [])
            tri_chunk = np.zeros(len(cols[0]) // 3, int) if chunk is None else chunk(cols[0].reshape(-1, 3, 3).mean(1))
            chunks = []
            for ck in np.unique(tri_chunk):
                sel = np.repeat(tri_chunk == ck, 3)
                cc = [c[sel] for c in cols]
                # weld identical corners (unlit, so no normals to keep apart)
                key = np.concatenate([np.round(c * 2 ** 14) for c in cc], 1).astype(np.int64)
                _, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
                cc = [c[first] for c in cc]
                chunks.append({'chunk': int(ck), 'pos': cc[0], 'uv0': cc[1], 'uv1': cc[2] if uv1 else None,
                               'idx': inverse.ravel()})
            mats_out.append({'name': m.name, 'image': m.image, 'color': m.color, 'alpha': m.alpha, 'double': m.double,
                             'lightmap': m.lightmap, 'emissive': m.emissive, 'chunks': chunks,
                             'extras': {'flicker': m.flicker} if m.flicker else {}})
        glb_bytes = write_glb(out_base + '.glb', mats_out)
        data = {'lightmapScale': LM_SCALE, 'colliders': self.colliders, 'lights': self.runtime_lights,
                'spawns': self.spawns, **self.meta}
        with open(out_base + '.json', 'w') as f:
            json.dump(data, f, separators=(',', ':'))
        print(f'  exported: {tris} triangles, {len(mats_out)} materials, {glb_bytes / 1e6:.2f} MB glb, '
              f'{len(self.colliders)} colliders, {len(self.runtime_lights)} lights ({time.time() - t0:.1f}s)')
        if previews:
            self.render_previews(objs, lm_png, previews, preview_dir or os.path.dirname(out_base))

    # -------------------------------------------------------------- preview
    def render_previews(self, objs, lm_png, cams, out_dir, exposure=1.0, size=(960, 540)):
        """Render what the game shows: texture x lightmap, unlit, ACES tonemapped."""
        sc = bpy.context.scene
        for o in list(sc.objects):
            if o.type == 'LIGHT':
                bpy.data.objects.remove(o)
        lm_path = os.path.join(out_dir, '_lm_preview.png')
        lm_png.save(lm_path)
        lm_img = bpy.data.images.load(lm_path); lm_img.colorspace_settings.name = 'Non-Color'
        tex_imgs = {}
        for m in self.mats.values():
            nt = m.bmat.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            out = nt.nodes.new('ShaderNodeOutputMaterial')
            em = nt.nodes.new('ShaderNodeEmission')
            col = nt.nodes.new('ShaderNodeMix'); col.data_type = 'RGBA'; col.blend_type = 'MULTIPLY'
            col.inputs['Factor'].default_value = 1
            if m.image is not None:
                if id(m.image) not in tex_imgs:
                    p = os.path.join(out_dir, f'_tex_{m.name}.png'); m.image.save(p)
                    tex_imgs[id(m.image)] = bpy.data.images.load(p)
                t = nt.nodes.new('ShaderNodeTexImage'); t.image = tex_imgs[id(m.image)]
                uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'uv'
                nt.links.new(uvn.outputs[0], t.inputs[0])
                albedo = t.outputs['Color']
            else:
                rgb = nt.nodes.new('ShaderNodeRGB'); rgb.outputs[0].default_value = (*m.color, 1); albedo = rgb.outputs[0]
            if m.lightmap:
                lt = nt.nodes.new('ShaderNodeTexImage'); lt.image = lm_img; lt.interpolation = 'Linear'
                luv = nt.nodes.new('ShaderNodeUVMap'); luv.uv_map = 'lm'
                nt.links.new(luv.outputs[0], lt.inputs[0])
                # sRGB-decode the lightmap and scale, as three.js does
                gam = nt.nodes.new('ShaderNodeGamma'); gam.inputs[1].default_value = 2.2
                nt.links.new(lt.outputs['Color'], gam.inputs[0])
                sc_ = nt.nodes.new('ShaderNodeMix'); sc_.data_type = 'RGBA'; sc_.blend_type = 'MULTIPLY'
                sc_.inputs['Factor'].default_value = 1
                nt.links.new(gam.outputs[0], sc_.inputs['A']); sc_.inputs['B'].default_value = (LM_SCALE,) * 3 + (1,)
                nt.links.new(albedo, col.inputs['A']); nt.links.new(sc_.outputs['Result'], col.inputs['B'])
            else:
                nt.links.new(albedo, col.inputs['A']); col.inputs['B'].default_value = (1.6, 1.6, 1.6, 1) if m.emit else (1, 1, 1, 1)
            nt.links.new(col.outputs['Result'], em.inputs['Color'])
            shader = em
            if m.alpha:
                tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mix = nt.nodes.new('ShaderNodeMixShader')
                nt.links.new(t.outputs['Alpha'], mix.inputs[0])
                nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
                shader = mix
            nt.links.new(shader.outputs[0], out.inputs['Surface'])
        for o in sc.objects:
            o.visible_diffuse = o.visible_shadow = o.visible_glossy = o.visible_transmission = False
            o.visible_camera = True
        sc.world.color = (0, 0, 0)
        sc.cycles.samples = 12
        sc.cycles.use_denoising = False
        sc.render.resolution_x, sc.render.resolution_y = size
        sc.render.image_settings.file_format = 'OPEN_EXR'
        cam_data = bpy.data.cameras.new('cam')
        cam = bpy.data.objects.new('cam', cam_data); sc.collection.objects.link(cam); sc.camera = cam
        cam_data.clip_start = 0.05
        from PIL import Image
        for name, (pos, yaw, pitch, fov) in cams:
            cam.location = g2b(pos)
            # game camera looks down -z rotated by yaw (YXZ order); blender camera looks down its -z
            cam.rotation_euler = (math.pi / 2 + pitch, 0, yaw)
            cam_data.angle_y = math.radians(fov); cam_data.sensor_fit = 'VERTICAL'
            path = os.path.join(out_dir, f'{name}.exr')
            sc.render.filepath = path
            bpy.ops.render.render(write_still=True)
            im = bpy.data.images.load(path)
            w, h = im.size
            a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
            rgb = aces(a.reshape(h, w, 4)[::-1, :, :3].astype(float) * exposure)
            Image.fromarray((srgb_encode(rgb) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out_dir, f'{name}.png'))
            os.remove(path)
        for f in os.listdir(out_dir):
            if f.startswith('_tex_') or f == '_lm_preview.png':
                os.remove(os.path.join(out_dir, f))
