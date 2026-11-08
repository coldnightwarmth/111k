"""Posing and clip-building helpers for the 111k emotes (run inside Blender's Python, bpy).

The rig is the cards.art one every Drifella and Drilady shares (19 bones), imported from an avatar's
base.glb (decompressed first: tools/unmeshopt.mjs). In Blender it stands about 2 units tall, faces -Y,
its left side at +X, up is +Z. The game scales it to .66.

A clip is built frame by frame: a base pose (blended between key poses) and then procedural motion on
top (in armature space: turn a bone about its head, aim it, plant a foot with two-bone IK, reach a hand
to a point). Every bone is keyed every frame; the glTF exporter then writes it, and the clips are merged
into one file. Round-tripping a clip through this import/export reproduces it exactly (checked).
"""
import math, json, struct, os
import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
rad = math.radians
V = lambda *a: Vector(a)
U = lambda *a: Vector(a).normalized()
LEFT, RIGHT = '.L', '.R'


# ------------------------------------------------------------------------------------------- the rig
class Rig:
    def __init__(self, glb):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.scene = bpy.context.scene
        self.scene.render.fps = FPS
        bpy.ops.import_scene.gltf(filepath=glb)
        self.obj = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
        self.originals = {}
        # every original clip's last pose, and the idle's first, before the actions go
        for act in list(bpy.data.actions):
            name = act.name.split('|')[0]
            if name.startswith('Pose_') or name == 'Neutral':
                self.obj.animation_data.action = act
                end = act.frame_range[0] if name == 'Neutral' else act.frame_range[1]
                self.scene.frame_set(int(round(end)))
                self.originals[name] = self.capture()
        self.obj.animation_data.action = None
        for act in list(bpy.data.actions): bpy.data.actions.remove(act)
        for o in list(bpy.data.objects):
            if o is not self.obj: bpy.data.objects.remove(o, do_unlink=True)
        bpy.context.view_layer.objects.active = self.obj
        self.obj.select_set(True)
        bpy.ops.object.mode_set(mode='POSE')
        self.pb = self.obj.pose.bones
        for pb in self.pb: pb.rotation_mode = 'QUATERNION'
        order, seen = [], set()
        def visit(b):
            if b.name in seen: return
            if b.parent: visit(b.parent)
            seen.add(b.name); order.append(b.name)
        for b in self.obj.data.bones: visit(b)
        self.order = order
        self.neutral = self.originals['Neutral']

    def update(self): bpy.context.view_layer.update()

    # a pose: each bone's local rotation and offset (its matrix_basis)
    def capture(self):
        return {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in self.obj.pose.bones}

    def apply(self, pose):
        for name, (q, l) in pose.items():
            pb = self.pb[name]; pb.rotation_quaternion = q; pb.location = l
        self.update()

    # ------------------------------------------------------------------ armature-space operations
    def head(self, name): return self.pb[name].head.copy()
    def tail(self, name): return self.pb[name].tail.copy()
    def axis(self, name): return (self.pb[name].tail - self.pb[name].head).normalized()

    def _set(self, name, R, about=None):
        pb = self.pb[name]; M = pb.matrix.copy(); h = pb.head.copy() if about is None else about
        pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ M
        self.update()

    def turn(self, name, axis, deg):
        """Rotate a bone (and everything below it) about its head, axis in armature space."""
        if abs(deg) > 1e-6: self._set(name, Matrix.Rotation(rad(deg), 4, Vector(axis).normalized()))

    def turn_about(self, name, axis, deg, pivot):
        """Rotate a bone (and everything below it) about any point (a fall pivots on the feet)."""
        if abs(deg) > 1e-6: self._set(name, Matrix.Rotation(rad(deg), 4, Vector(axis).normalized()), about=Vector(pivot))

    def aim(self, name, direction, twist=0.0):
        """Point a bone along a direction (the smallest turn from where it points now), optional twist."""
        d = Vector(direction).normalized()
        q = self.axis(name).rotation_difference(d)
        R = q.to_matrix().to_4x4()
        if twist: R = Matrix.Rotation(rad(twist), 4, d) @ R
        self._set(name, R)

    def move(self, name, offset):
        """Slide a bone (and everything below it) through armature space."""
        pb = self.pb[name]; M = pb.matrix.copy(); M.translation += Vector(offset); pb.matrix = M; self.update()

    def orient(self, name, M3):
        """Give a bone an armature-space orientation (keeping where its head is)."""
        pb = self.pb[name]; M = M3.to_4x4(); M.translation = pb.head.copy(); pb.matrix = M; self.update()

    def limb(self, upper, lower, end, target, pole, keep_end=True):
        """Two-bone IK: bend upper/lower so lower's tail lands on target, the joint bending toward pole.
        keep_end: the end bone (foot, hand) keeps its armature-space orientation."""
        endM = self.pb[end].matrix.to_3x3().copy()
        a, b = self.pb[upper].length, self.pb[lower].length
        root = self.head(upper); target = Vector(target)
        d = target - root; dist = max(1e-4, min(d.length, a + b - 1e-4)); dn = d.normalized()
        p = Vector(pole) - dn * Vector(pole).dot(dn)
        if p.length < 1e-6: p = Vector((0, -1, 0)) - dn * dn.y
        pn = p.normalized()
        x = (a * a + dist * dist - b * b) / (2 * dist); h = math.sqrt(max(0.0, a * a - x * x))
        joint = root + dn * x + pn * h
        self.aim(upper, joint - root)
        self.aim(lower, root + dn * dist - self.head(lower))
        if keep_end: self.orient(end, endM)

    def plant(self, side, ankle, pole=None):
        """Put a foot's ankle (the Foot bone's head) at a point, knee forward, foot keeping its angle."""
        self.limb('Thigh' + side, 'Shin' + side, 'Foot' + side, ankle, pole or (self.head('Shin' + side) - self.head('Thigh' + side) + V(0, -.3, 0)))

    def reach(self, side, wrist, pole=None, keep_hand=False):
        """Put a wrist (the Hand bone's head) at a point, the elbow bending toward pole (default: out, down, back)."""
        out = 1 if side == LEFT else -1
        self.limb('UpperArm' + side, 'Forearm' + side, 'Hand' + side, wrist, pole or V(out * .6, .5, -.8), keep_end=keep_hand)
        if not keep_hand: self.aim('Hand' + side, self.axis('Forearm' + side))   # the hand carries on along the forearm


# --------------------------------------------------------------------------------- blending poses
def ease(k, kind='smooth'):
    k = min(1.0, max(0.0, k))
    if kind == 'linear': return k
    if kind == 'in': return k * k * k
    if kind == 'out': return 1 - (1 - k) ** 3
    if kind == 'back':     # past the pose and settle back
        c = 1.6; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2
    if kind == 'snap': return 1 - (1 - k) ** 5
    return k * k * (3 - 2 * k)


def blend(a, b, k):
    out = {}
    for name, (qa, la) in a.items():
        qb, lb = b[name]
        qb = qb.copy(); qb.make_compatible(qa)
        out[name] = (qa.slerp(qb, k) if 0 <= k <= 1 else _extra(qa, qb, k), la.lerp(lb, k))
    return out


def _extra(qa, qb, k):   # slerp past the end (an overshoot)
    d = qa.inverted() @ qb          # qa @ d == qb; walk k of the way along it
    ax, ang = d.to_axis_angle()
    return qa @ Quaternion(ax, ang * k)


DEPTH = {'Root': 0, 'Pelvis': 1, 'Chest': 2, 'Head': 3, 'Tail': 2, 'TailTip': 3, 'UpperArm.L': 3, 'UpperArm.R': 3, 'Forearm.L': 4, 'Forearm.R': 4,
         'Hand.L': 5, 'Hand.R': 5, 'CardSocket.R': 6, 'Thigh.L': 2, 'Thigh.R': 2, 'Shin.L': 3, 'Shin.R': 3, 'Foot.L': 4, 'Foot.R': 4}


def sequence(keys, t, lag=0.0):
    """keys: [(time, pose, ease_kind)], the pose at t (eased between neighbours). lag: seconds each level
    down the hierarchy trails the one above (arms follow the chest, hands follow the arms)."""
    out = {}
    for name in keys[0][1].keys():
        tt = t - lag * DEPTH.get(name, 0)
        if tt <= keys[0][0]: out[name] = keys[0][1][name]; continue
        if tt >= keys[-1][0]: out[name] = keys[-1][1][name]; continue
        i = max(j for j in range(len(keys)) if keys[j][0] <= tt)
        t0, p0, _ = keys[i]; t1, p1, kind = keys[i + 1]
        k = ease((tt - t0) / max(1e-6, t1 - t0), kind)
        qa, la = p0[name]; qb, lb = p1[name]
        qb = qb.copy(); qb.make_compatible(qa)
        out[name] = (qa.slerp(qb, k) if 0 <= k <= 1 else _extra(qa, qb, k), la.lerp(lb, min(max(k, -.5), 1.5)))
    return out


def pose_from(rig, start, ops):
    """A static pose: start from a pose and run ops (a function taking the rig)."""
    rig.apply(start); ops(rig); return rig.capture()


def window(t, a, b):
    """0 before a, eases to 1 at b."""
    return ease((t - a) / max(1e-6, b - a))


# ------------------------------------------------------------------------------------------- clips
class Clip:
    """id, keys [(t, pose, ease)], loop (start, end) seconds, layer(rig, t, env) for procedural motion
    (env: 0 before the loop's run-up, 1 from the loop on), lag: hierarchy follow-through."""
    def __init__(self, cid, keys, loop, layer=None, lag=.035, envelope=None):
        self.id, self.keys, self.loop, self.layer, self.lag = cid, keys, loop, layer, lag
        self.envelope = envelope or (max(0.0, loop[0] - .45), loop[0])

    def pose_at(self, rig, t):
        a, b = self.loop
        # keys can run on through the loop (its first and last key the same pose); otherwise the base pose
        # holds through the loop and the layer moves it, periodically
        base = sequence(self.keys, t if self.keys[-1][0] > a + 1e-6 else min(t, a), self.lag)
        rig.apply(base)
        if self.layer:
            env = window(t, *self.envelope) if self.envelope[1] > self.envelope[0] else 1.0
            self.layer(rig, t, env)


def build(rig, clip):
    act = bpy.data.actions.new('Emote_' + clip.id)
    act.use_fake_user = True
    rig.obj.animation_data_create()
    rig.obj.animation_data.action = act
    end = clip.loop[1]
    frames = int(round(end * FPS))
    for f in range(frames + 1):
        t = f / FPS
        if f == frames: t = clip.loop[0] + 1e-9 if False else t
        clip.pose_at(rig, t)
        for pb in rig.pb:
            pb.keyframe_insert('rotation_quaternion', frame=f)
            pb.keyframe_insert('location', frame=f)
    act.frame_range = (0, frames)
    return act


# --------------------------------------------------------------------------- export, merge, compact
def _read_glb(path):
    data = open(path, 'rb').read()
    n = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + n]), data[20 + n + 8:]


def export(rig, actions, out_glb):
    """Each action through Blender's glTF exporter (it writes the active one), merged into one file; then
    every channel that never changes is cut to a single key."""
    import numpy as np
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = []
    for act in actions:
        rig.obj.animation_data.action = act
        try: rig.obj.animation_data.action_slot = act.slots[0]
        except Exception: pass
        path = out_glb + f'.{act.name}.glb'
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
                                  export_animation_mode='ACTIVE_ACTIONS', export_force_sampling=True, export_frame_range=False,
                                  export_skins=False, export_morph=False, export_materials='NONE', export_optimize_animation_size=False)
        parts.append((act.name, *_read_glb(path)))
        os.remove(path)
    g0 = parts[0][1]
    nodes = g0['nodes']
    # rebuild one file: the rig's nodes from the first export, and every clip's samplers, compacted
    out = {'asset': g0['asset'], 'scene': 0, 'scenes': g0['scenes'], 'nodes': nodes, 'animations': [], 'accessors': [], 'bufferViews': [], 'buffers': []}
    blob = bytearray()

    def add(arr, typ, short=False):
        # rotations go in as normalized 16-bit (glTF allows it for rotations; the error is ~0.005 degrees)
        if short: arr = np.ascontiguousarray(np.round(np.clip(arr, -1, 1) * 32767), dtype=np.int16)
        else: arr = np.ascontiguousarray(arr, dtype=np.float32)
        while len(blob) % 4: blob.append(0)
        off = len(blob); blob.extend(arr.tobytes())
        out['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes})
        acc = {'bufferView': len(out['bufferViews']) - 1, 'componentType': 5122 if short else 5126, 'count': int(arr.shape[0]), 'type': typ}
        if short: acc['normalized'] = True
        if typ == 'SCALAR': acc['min'], acc['max'] = [float(arr.min())], [float(arr.max())]
        out['accessors'].append(acc)
        return len(out['accessors']) - 1

    def simplify(t, v, rot):
        """Drop keys that straight interpolation between the kept neighbours reproduces (to ~0.15 degrees /
        under a millimetre): holds and smooth stretches collapse to a few keys."""
        tol = .0013 if rot else .0008
        if rot:   # one hemisphere, so neighbouring keys interpolate the short way
            for i in range(1, len(v)):
                if np.dot(v[i], v[i - 1]) < 0: v[i] = -v[i]
        keep = [0]; i = 0
        while i < len(t) - 1:
            j = i + 2
            while j < len(t):
                k = (t[i + 1:j] - t[i]) / (t[j] - t[i])
                guess = v[i] + (v[j] - v[i]) * k[:, None]
                if rot: guess /= np.linalg.norm(guess, axis=1, keepdims=True)
                if np.abs(guess - v[i + 1:j]).max() > tol: break
                j += 1
            i = j - 1; keep.append(i)
        return t[keep], v[keep]

    def read(g, b, i):
        a = g['accessors'][i]; v = g['bufferViews'][a['bufferView']]
        n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
        return np.frombuffer(b, np.float32, a['count'] * n, v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n)

    for name, g, b in parts:
        names = [nd.get('name') for nd in g['nodes']]
        assert names == [nd.get('name') for nd in nodes], 'exports list the rig differently'
        anim = g['animations'][0]
        new = {'name': name, 'channels': [], 'samplers': []}
        times_cache = {}
        for ch in anim['channels']:
            s = anim['samplers'][ch['sampler']]
            t = read(g, b, s['input'])[:, 0]; v = read(g, b, s['output'])
            if ch['target']['path'] == 'scale': continue      # nothing here scales a bone (and these read back wrong)
            rot = ch['target']['path'] == 'rotation'
            v = v.copy()
            if np.allclose(v, v[0], atol=2e-5): t, v = t[:1], v[:1]          # it never moves: one key
            else: t, v = simplify(t, v, rot)
            key = tuple(np.round(t, 4))
            if key not in times_cache: times_cache[key] = add(t, 'SCALAR')
            new['samplers'].append({'input': times_cache[key], 'output': add(v, 'VEC4' if rot else 'VEC3', short=rot), 'interpolation': 'LINEAR'})
            new['channels'].append({'sampler': len(new['samplers']) - 1, 'target': ch['target']})
        out['animations'].append(new)
    while len(blob) % 4: blob.append(0)
    out['buffers'] = [{'byteLength': len(blob)}]
    js = json.dumps(out, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    rest = struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    open(out_glb, 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest)
    return len(blob)
