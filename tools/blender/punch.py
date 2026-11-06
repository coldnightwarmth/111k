"""Author the 111k punch on the cards.art avatar rig and export it as moves.glb.

Drifellas and Driladies share one 19-bone rig, so a single clip serves both.
Poses are written as aims ("this bone points that way") and solved into bone
rotations, then keyed. The rig faces -Y in Blender with its right side at -X.

Usage: python3 tools/blender/punch.py /path/to/drifella-customizable.blend assets/avatars/moves.glb
"""
import math, sys
import bpy
from mathutils import Matrix, Quaternion, Vector

SRC, OUT = sys.argv[1], sys.argv[2]
FPS = 30
bpy.ops.wm.open_mainfile(filepath=SRC)
rig = bpy.data.objects['DrifellaRig']
for o in list(bpy.data.objects):
    if o is not rig: bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.render.fps = FPS
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='POSE')

ORDER = ['Root', 'Pelvis', 'Chest', 'Head', 'UpperArm.R', 'Forearm.R', 'Hand.R', 'CardSocket.R', 'UpperArm.L', 'Forearm.L',
         'Hand.L', 'Thigh.R', 'Shin.R', 'Foot.R', 'Thigh.L', 'Shin.L', 'Foot.L', 'Tail', 'TailTip']
V = lambda *a: Vector(a).normalized()


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Z')


def aim(rest3, d, twist=0.0):
    """Rotation (armature space) taking a bone's rest orientation so its Y axis points along d."""
    q = rest3.col[1].normalized().rotation_difference(d)
    r = q.to_matrix() @ rest3
    if twist: r = Matrix.Rotation(math.radians(twist), 3, d) @ r
    return r


def pose(spec):
    """spec: bone -> ('aim', dir[, twist]) | ('turn', degrees about Z, relative to rest) | ('keep',)"""
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    for name in ORDER:
        pb = rig.pose.bones[name]
        s = spec.get(name)
        if not s: continue
        rest3 = pb.bone.matrix_local.to_3x3()
        if s[0] == 'aim': r = aim(rest3, s[1], s[2] if len(s) > 2 else 0)
        elif s[0] == 'turn': r = rot_z(s[1]) @ rest3
        elif s[0] == 'lean': r = Matrix.Rotation(math.radians(s[2]), 3, 'X') @ rot_z(s[1]) @ rest3
        m = r.to_4x4(); m.translation = pb.matrix.translation
        pb.matrix = m
        bpy.context.view_layer.update()
    if 'drop' in spec:
        rig.pose.bones['Root'].location = (0, 0, 0)
        rig.pose.bones['Pelvis'].location = Vector((0, -spec['drop'], 0))  # bone space: y runs up the spine


def key(frame):
    for pb in rig.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)
        pb.keyframe_insert('scale', frame=frame)


# --- the punch: guard, wind-up, snap out, hold, recover -----------------------------
legs = {  # left foot forward, right back, knees soft
    'Thigh.L': ('aim', V(.05, -.32, -1)), 'Shin.L': ('aim', V(0, -.05, -1)), 'Foot.L': ('aim', V(0, -1, -.2)),
    'Thigh.R': ('aim', V(-.06, .3, -1)), 'Shin.R': ('aim', V(0, .38, -1)), 'Foot.R': ('aim', V(0, -1, -.35)),
}
guard_l = {'UpperArm.L': ('aim', V(.42, -.5, -.76)), 'Forearm.L': ('aim', V(-.42, -.45, .78)), 'Hand.L': ('aim', V(-.3, -.5, .8))}
guard_r = {'UpperArm.R': ('aim', V(-.42, -.45, -.78)), 'Forearm.R': ('aim', V(.42, -.45, .78)), 'Hand.R': ('aim', V(.3, -.5, .8))}
keys = [
    (0, {**legs, **guard_l, **guard_r, 'Pelvis': ('turn', 0), 'Chest': ('turn', 4), 'Head': ('turn', 0), 'drop': .03}),
    (3, {**legs, **guard_l, 'Pelvis': ('turn', -12), 'Chest': ('lean', -26, -5), 'Head': ('turn', 8),
         'UpperArm.R': ('aim', V(-.5, .25, -.82)), 'Forearm.R': ('aim', V(.25, -.7, .66)), 'Hand.R': ('aim', V(.1, -.9, .4)),
         'drop': .05}),
    (6, {**legs, **guard_l, 'Pelvis': ('turn', 20), 'Chest': ('lean', 42, 16), 'Head': ('lean', 0, 6),
         'UpperArm.R': ('aim', V(.32, -1, .3)), 'Forearm.R': ('aim', V(.22, -1, .3)), 'Hand.R': ('aim', V(.18, -1, .28)),
         'drop': .07}),
    (8, {**legs, **guard_l, 'Pelvis': ('turn', 21), 'Chest': ('lean', 43, 16), 'Head': ('lean', 0, 6),
         'UpperArm.R': ('aim', V(.32, -1, .32)), 'Forearm.R': ('aim', V(.22, -1, .32)), 'Hand.R': ('aim', V(.18, -1, .3)),
         'drop': .07}),
    (15, {**legs, **guard_l, **guard_r, 'Pelvis': ('turn', 2), 'Chest': ('turn', 6), 'Head': ('turn', 0), 'drop': .03}),
]

rig.animation_data_create()
act = bpy.data.actions.new('Punch')
rig.animation_data.action = act
for frame, spec in keys:
    pose(spec)
    key(frame)
# snappy timing: ease into the strike, then hold and settle
for fc in getattr(act, 'fcurves', []):
    for kp in fc.keyframe_points: kp.interpolation = 'BEZIER'

# Export only the rig and this clip.
for a in list(bpy.data.actions):
    if a is not act: a.use_fake_user = False
bpy.ops.object.mode_set(mode='OBJECT')
scene.frame_start, scene.frame_end = 0, 15
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIVE_ACTIONS', export_force_sampling=True, export_frame_range=False,
                          export_skins=False, export_morph=False, export_materials='NONE')
print('wrote', OUT)

# name the clip (the exporter calls an active action "Animation")
import json, struct
data = open(OUT, 'rb').read()
n = struct.unpack('<I', data[12:16])[0]
g = json.loads(data[20:20 + n])
g['animations'][0]['name'] = 'Punch'
js = json.dumps(g, separators=(',', ':')).encode()
js += b' ' * ((-len(js)) % 4)
rest = data[20 + n:]
open(OUT, 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest)
