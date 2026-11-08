"""Author the 111k emotes in Blender and export them as assets/avatars/emotes.glb, plus their timings
(src/emote-clips.js: when each one's loop starts and how long it runs).

  node tools/unmeshopt.mjs assets/avatars/drifella/base.glb /tmp/drifella.glb
  python3 tools/blender/emotes.py /tmp/drifella.glb assets/avatars/emotes.glb src/emote-clips.js [only,these,ids]

Two kinds of clip, all named Emote_<id>:
  - redos of the original static poses (base.glb's Pose_<id>): a proper move into the same pose, then a loop
    that keeps it alive (the gesture repeating, or breathing / weight shifts while it's held);
  - new emotes.
Every clip plays its intro once and then loops [loop start, end] for as long as the emote lasts.
"""
import math, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emotelib import Rig, Clip, build, export, sequence, pose_from, ease, window, V, U, rad, LEFT, RIGHT
from mathutils import Vector

SRC, OUT_GLB, OUT_JS = sys.argv[1:4]
ONLY = set(sys.argv[4].split(',')) if len(sys.argv) > 4 else None
rig = Rig(SRC)
N = rig.neutral
O = {k[5:]: v for k, v in rig.originals.items() if k.startswith('Pose_')}
TAU = math.tau
X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)
FWD, BACK, UP = V(0, -1, 0), V(0, 1, 0), V(0, 0, 1)


def cyc(t, a, b, n=1, phase=0.0):
    """A periodic phase that wraps exactly n times over the loop [a, b]."""
    return TAU * n * (t - a) / (b - a) + phase


def feet_down(r):
    """Where each foot's ankle is, if it's on the ground (so the layer can keep it there)."""
    out = {}
    for s in (LEFT, RIGHT):
        h = r.head('Foot' + s)
        if h.z < .26: out[s] = h
    return out


def alive(r, t, a, b, env, amount=1.0, breathe=1.0, sway=1.0, look=1.0, tail=1.0):
    """What every held pose does: breathe (chest and shoulders), shift weight (hips, feet planted), let
    the head drift a little, and swing the tail. Periodic over the loop [a, b]."""
    if env <= 0 or amount <= 0: return
    k = env * amount
    planted = feet_down(r)
    L = b - a
    nb = max(1, round(L / 3.2)); ns = max(1, round(L / 6.4))
    br = math.sin(cyc(t, a, b, nb))
    r.turn('Chest', X, -1.6 * breathe * k * br)                     # a breath in leans the chest back a touch
    r.move('Chest', V(0, 0, .006 * breathe * k * (br + 1) / 2))
    for s, sgn in ((LEFT, 1), (RIGHT, -1)):
        r.turn('UpperArm' + s, FWD, sgn * 1.2 * breathe * k * br)
    sw = math.sin(cyc(t, a, b, ns, .3))
    if sway and planted:
        r.move('Pelvis', V(.016 * sway * k * sw, 0, -.004 * sway * k * abs(sw)))
        r.turn('Pelvis', FWD, -1.4 * sway * k * sw)
        r.turn('Chest', FWD, 1.9 * sway * k * sw)                       # the chest stays over the hips
        for s, h in planted.items(): r.plant(s, h)
    if look:
        r.turn('Head', Z, 3.2 * look * k * math.sin(cyc(t, a, b, ns, 1.1)))
        r.turn('Head', X, 1.6 * look * k * math.sin(cyc(t, a, b, nb, 2.0)))
    if tail:
        r.turn('Tail', Z, 9 * tail * k * math.sin(cyc(t, a, b, nb * 2, .5)))
        r.turn('TailTip', Z, 14 * tail * k * math.sin(cyc(t, a, b, nb * 2, -.4)))


CLIPS = []
def clip(fn):
    CLIPS.append(fn); return fn


def redo(cid, intro=.7, kind='back', loop=3.2, extra=None, anticipate=None, alive_kw=None, lag=.035):
    """A redo: neutral -> (optional anticipation) -> the original pose (eased with a little overshoot),
    then a loop: the original pose kept alive, plus whatever extra motion it has."""
    P = O[cid]
    keys = [(0, N, 'smooth')]
    if anticipate is not None:
        keys.append((intro * .35, pose_from(rig, N, anticipate), 'smooth'))
    keys.append((intro, P, kind))
    a, b = intro + .25, intro + .25 + loop
    def layer(r, t, env):
        if extra: extra(r, t, a, b, env)
        alive(r, t, a, b, env, **(alive_kw or {}))
    return Clip(cid, keys, (a, b), layer, lag=lag, envelope=(intro * .6, a))


# ------------------------------------------------------------------------------------- the redos
# (armature space: +X the character's left, -Y in front of it, +Z up. turn(.., Z, +) turns it to its left,
#  turn(.., X, +) pitches it forward, turn(.., FWD, +) tips its top toward its right)
def nod(r, t, a, b, env, n=2, deg=4.0, phase=0.0):
    r.turn('Head', X, deg * env * math.sin(cyc(t, a, b, n, phase)))


def bounce(r, t, a, b, env, n=2, depth=.03, phase=0.0):
    """Knees bob (hips dip, feet stay put): n dips a loop."""
    planted = feet_down(r)
    d = depth * env * (1 - math.cos(cyc(t, a, b, n, phase))) / 2
    r.move('Pelvis', V(0, 0, -d))
    for s, h in planted.items(): r.plant(s, h)


def pulse(t, a, b, n, sharp=3.0, phase=0.0):
    """0..1 beats, n a loop, quick up and slow down (a heartbeat, a pump)."""
    x = ((t - a) / (b - a) * n + phase) % 1.0
    return math.exp(-sharp * x) * (1 - math.exp(-40 * x))


@clip
def wave():
    def extra(r, t, a, b, env):
        w = math.sin(cyc(t, a, b, 4))                                   # four waves a loop
        r.turn('Forearm.R', FWD, 32 * env * w)
        r.turn('Hand.R', FWD, 20 * env * math.sin(cyc(t, a, b, 4, -.7)))   # the hand trails the forearm
        r.turn('Head', FWD, -3 * env * w)
        r.turn('Chest', Z, -3 * env * w)
    return redo('wave', intro=.6, loop=2.4, extra=extra)


@clip
def dab():
    def extra(r, t, a, b, env):
        p = pulse(t, a, b, 2, 5)                                      # re-dab: tuck the head in on the beat
        r.turn('Head', X, 7 * env * p)
        r.turn('Chest', X, 3 * env * p)
        r.turn('UpperArm.L', FWD, -5 * env * p); r.turn('UpperArm.R', FWD, 4 * env * p)
        bounce(r, t, a, b, env, 2, .02)
    return redo('dab', intro=.45, kind='snap', loop=2.4, extra=extra, anticipate=lambda r: (r.turn('Chest', Z, 12), r.turn('Head', X, -6)))


@clip
def heart():
    def extra(r, t, a, b, env):
        beat = pulse(t, a, b, 3, 6) + .6 * pulse(t, a, b, 3, 6, -.12)   # lub-dub, three times a loop
        for s in (LEFT, RIGHT): r.turn('UpperArm' + s, X, -5 * env * beat)    # the hands push forward on the beat
        r.turn('Head', FWD, 7 * env * math.sin(cyc(t, a, b, 1)))
        r.turn('Chest', FWD, -2.5 * env * math.sin(cyc(t, a, b, 1)))
    return redo('heart', loop=3.0, extra=extra)


@clip
def airguitar():
    def extra(r, t, a, b, env):
        strum = math.sin(cyc(t, a, b, 6))
        r.turn('Forearm.R', X, 20 * env * strum)                         # strumming
        r.turn('Hand.R', X, 12 * env * math.sin(cyc(t, a, b, 6, -.5)))
        r.turn('Forearm.L', Z, 6 * env * math.sin(cyc(t, a, b, 2)))       # sliding up the neck
        nod(r, t, a, b, env, 6, 6)
        bounce(r, t, a, b, env, 6, .035)
        r.turn('Chest', Z, 4 * env * math.sin(cyc(t, a, b, 1)))
    return redo('airguitar', loop=2.4, extra=extra, alive_kw={'sway': 0})


@clip
def victory():
    def extra(r, t, a, b, env):
        p = pulse(t, a, b, 2, 4)
        r.turn('UpperArm.L', FWD, 10 * env * p); r.turn('UpperArm.R', FWD, -10 * env * p)   # pump them higher
        r.turn('Chest', X, -4 * env * p); r.turn('Head', X, -6 * env * p)
        bounce(r, t, a, b, env, 2, .04, .5)
    return redo('victory', intro=.55, loop=2.0, extra=extra, alive_kw={'sway': 0})


@clip
def shrug():
    def extra(r, t, a, b, env):
        up = (1 - math.cos(cyc(t, a, b, 1))) / 2
        for s, sg in ((LEFT, 1), (RIGHT, -1)): r.turn('UpperArm' + s, FWD, sg * 8 * env * up)
        r.move('Chest', V(0, 0, .012 * env * up))
        r.turn('Head', FWD, 8 * env * math.sin(cyc(t, a, b, 1, .4)))
        r.turn('Chest', Z, -3 * env * math.sin(cyc(t, a, b, 1)))
    return redo('shrug', loop=2.6, extra=extra)


@clip
def think():
    def extra(r, t, a, b, env):
        tap = pulse(t, a, b, 3, 7) if ((t - a) / (b - a)) % 1 < .5 else 0   # tap the chin a few times, then ponder
        r.turn('Forearm.R', X, -6 * env * tap)
        r.turn('Head', FWD, -6 * env * math.sin(cyc(t, a, b, 1)))
        r.turn('Head', Z, 5 * env * math.sin(cyc(t, a, b, 1, 1.2)))
    return redo('think', loop=3.6, extra=extra)


@clip
def point():
    def extra(r, t, a, b, env):
        p = pulse(t, a, b, 2, 6)
        r.turn('UpperArm.L', X, -6 * env * p); r.turn('Forearm.L', Z, -4 * env * p)
        r.turn('Chest', X, 3 * env * p); nod(r, t, a, b, env, 2, 3)
    return redo('point', intro=.5, kind='snap', loop=2.4, extra=extra)


@clip
def flex():
    def extra(r, t, a, b, env):
        side = math.sin(cyc(t, a, b, 1))
        curl = pulse(t, a, b, 4, 4)
        for s in (LEFT, RIGHT): r.turn('Forearm' + s, X, -10 * env * curl)
        r.turn('Chest', Z, 10 * env * side); r.turn('Head', Z, -6 * env * side)
        r.move('Chest', V(0, 0, .008 * env * curl))
    return redo('flex', intro=.6, loop=3.2, extra=extra)


@clip
def bow():
    def extra(r, t, a, b, env):
        r.turn('Chest', X, 4 * env * math.sin(cyc(t, a, b, 1)))
    return redo('bow', intro=.8, kind='smooth', loop=3.2, extra=extra, alive_kw={'sway': .3, 'look': .3})


@clip
def salute():
    def extra(r, t, a, b, env):
        r.turn('Chest', X, -2 * env)                                     # stand tall
    return redo('salute', intro=.45, kind='snap', loop=3.2, extra=extra, alive_kw={'sway': .2, 'look': .2, 'tail': .3})


@clip
def crossarms():
    def extra(r, t, a, b, env):
        tap = pulse(t, a, b, 6, 8)
        r.turn('Foot.R', X, -14 * env * tap)                                # toe tapping, impatient
        r.turn('Head', Z, 6 * env * math.sin(cyc(t, a, b, 1)))
    return redo('crossarms', loop=2.4, extra=extra)


@clip
def highfive():
    def extra(r, t, a, b, env):
        w = math.sin(cyc(t, a, b, 3))
        r.turn('UpperArm.L', FWD, -4 * env * w); r.turn('Hand.L', X, 10 * env * w)   # come on, up top
        bounce(r, t, a, b, env, 3, .025)
    return redo('highfive', loop=2.4, extra=extra)


@clip
def fistbump():
    def extra(r, t, a, b, env):
        p = pulse(t, a, b, 2, 5)
        r.turn('UpperArm.R', X, -7 * env * p); r.turn('Chest', Z, 4 * env * p)
        nod(r, t, a, b, env, 2, 4)
    return redo('fistbump', loop=2.4, extra=extra)


@clip
def micdrop():
    def extra(r, t, a, b, env):
        r.turn('Head', X, -4 * env); r.turn('Head', Z, 5 * env * math.sin(cyc(t, a, b, 1)))
        r.turn('Hand.R', X, 8 * env * math.sin(cyc(t, a, b, 2)))
    return redo('micdrop', intro=.7, loop=3.2, extra=extra, anticipate=lambda r: (r.turn('UpperArm.R', FWD, -40), r.turn('Head', X, -8)))


@clip
def boxer():
    def extra(r, t, a, b, env):
        planted = feet_down(r)
        sw = math.sin(cyc(t, a, b, 2))
        r.move('Pelvis', V(.04 * env * sw, 0, -.03 * env * (1 + math.cos(cyc(t, a, b, 4))) / 2))
        r.turn('Chest', FWD, -8 * env * sw); r.turn('Chest', Z, 6 * env * sw)
        for s, h in planted.items(): r.plant(s, h)
        jab = pulse(t, a, b, 2, 9, .25)
        r.turn('UpperArm.L', X, -18 * env * jab); r.turn('Forearm.L', X, -22 * env * jab)
        nod(r, t, a, b, env, 4, 3)
    return redo('boxer', intro=.5, kind='snap', loop=2.0, extra=extra, alive_kw={'sway': 0})


@clip
def kneel():
    def extra(r, t, a, b, env):
        r.turn('Head', Z, 10 * env * math.sin(cyc(t, a, b, 1)))
    return redo('kneel', intro=.9, kind='smooth', loop=4.0, extra=extra, alive_kw={'sway': .4})


@clip
def leanback():
    def extra(r, t, a, b, env):
        nod(r, t, a, b, env, 4, 5); r.turn('Chest', Z, 3 * env * math.sin(cyc(t, a, b, 1)))
    return redo('leanback', intro=.7, loop=2.8, extra=extra)


@clip
def lookout():
    def extra(r, t, a, b, env):
        scan = math.sin(cyc(t, a, b, 1))
        r.turn('Chest', Z, 14 * env * scan); r.turn('Head', Z, 14 * env * math.sin(cyc(t, a, b, 1, -.4)))
    return redo('lookout', loop=4.0, extra=extra)


@clip
def conductor():
    def extra(r, t, a, b, env):
        ph = cyc(t, a, b, 2)                                          # a four-beat pattern, twice a loop
        r.turn('UpperArm.R', FWD, 14 * env * math.sin(ph)); r.turn('UpperArm.R', X, 10 * env * math.sin(2 * ph))
        r.turn('Forearm.R', FWD, 16 * env * math.sin(ph - .5))
        r.turn('UpperArm.L', FWD, 6 * env * math.sin(ph + 1.5)); nod(r, t, a, b, env, 4, 3)
        r.turn('Chest', Z, -4 * env * math.sin(ph))
    return redo('conductor', loop=3.2, extra=extra)


@clip
def curtsey():
    def extra(r, t, a, b, env):
        bounce(r, t, a, b, env, 1, .05, .5); r.turn('Head', FWD, 5 * env * math.sin(cyc(t, a, b, 1)))
    return redo('curtsey', intro=.8, kind='smooth', loop=3.2, extra=extra, alive_kw={'sway': 0})


@clip
def lunge():
    def extra(r, t, a, b, env):
        r.turn('Chest', X, -2 * env * math.sin(cyc(t, a, b, 1))); r.turn('Head', Z, 4 * env * math.sin(cyc(t, a, b, 1, 1)))
    return redo('lunge', intro=.6, loop=3.2, extra=extra, alive_kw={'sway': .4})


def wobble(r, t, a, b, env, deg=4.0):
    """Balancing on one foot: the body tips and corrects, the arms counter it, the standing foot stays put."""
    planted = feet_down(r)
    w = math.sin(cyc(t, a, b, 2)) + .4 * math.sin(cyc(t, a, b, 5, .7))
    r.turn('Pelvis', FWD, deg * env * w)
    r.turn('UpperArm.L', FWD, -2.5 * deg * env * w); r.turn('UpperArm.R', FWD, -2.5 * deg * env * w)
    r.turn('Head', FWD, -deg * .8 * env * w)
    for s, h in planted.items(): r.plant(s, h)


@clip
def crane():
    return redo('crane', intro=.8, loop=3.2, extra=lambda r, t, a, b, env: wobble(r, t, a, b, env, 3.5), alive_kw={'sway': 0})


@clip
def summon():
    def extra(r, t, a, b, env):
        ph = cyc(t, a, b, 2)
        for s, sg in ((LEFT, 1), (RIGHT, -1)):
            r.turn('Forearm' + s, X, 8 * env * math.sin(ph)); r.turn('Forearm' + s, Z, sg * 8 * env * math.cos(ph))   # little circles
        r.turn('Chest', X, 3 * env * math.sin(cyc(t, a, b, 1))); r.turn('Head', X, 3 * env * math.sin(cyc(t, a, b, 1)))
    return redo('summon', loop=3.2, extra=extra, anticipate=lambda r: (r.turn('Chest', X, -8), r.turn('UpperArm.L', FWD, 30), r.turn('UpperArm.R', FWD, -30)))


@clip
def welcome():
    def extra(r, t, a, b, env):
        w = math.sin(cyc(t, a, b, 1))
        r.turn('UpperArm.L', Z, 8 * env * w); r.turn('UpperArm.R', Z, -8 * env * w)
        nod(r, t, a, b, env, 1, 4)
    return redo('welcome', loop=3.0, extra=extra)


@clip
def tpose():
    def extra(r, t, a, b, env):                                       # assert dominance: a slow full turn
        r.turn('Root', Z, 360 * min(1.0, max(0.0, (t - a) / (b - a))) if t > a else 0)
        r.move('Root', V(0, 0, .02 * env * (1 - math.cos(cyc(t, a, b, 2))) / 2))
    return redo('tpose', intro=.5, kind='snap', loop=6.0, extra=extra, alive_kw={'sway': 0, 'look': 0, 'breathe': .3})


@clip
def mnshy():
    def extra(r, t, a, b, env):
        sw = math.sin(cyc(t, a, b, 1))
        r.turn('Chest', Z, 8 * env * sw); r.turn('Head', FWD, 8 * env * sw); r.turn('Head', X, 4 * env)
        r.turn('Foot.R', Z, 12 * env * (1 + math.sin(cyc(t, a, b, 2))) / 2)     # twisting a toe
    return redo('mnshy', loop=3.2, extra=extra)


@clip
def mnreverie():
    def extra(r, t, a, b, env):
        r.turn('Head', FWD, 6 * env * math.sin(cyc(t, a, b, 1))); r.turn('Chest', FWD, -2 * env * math.sin(cyc(t, a, b, 1, .5)))
    return redo('mnreverie', intro=.9, kind='smooth', loop=4.8, extra=extra, alive_kw={'sway': 1.4})


@clip
def mncheekrest():
    def extra(r, t, a, b, env):
        r.turn('Head', FWD, -5 * env * (1 + math.sin(cyc(t, a, b, 1))) / 2)
    return redo('mncheekrest', intro=.8, kind='smooth', loop=4.0, extra=extra)


@clip
def mnlistening():
    def extra(r, t, a, b, env):
        lean = (1 - math.cos(cyc(t, a, b, 1))) / 2
        r.turn('Chest', FWD, -5 * env * lean); r.turn('Head', FWD, -6 * env * lean); nod(r, t, a, b, env, 4, 2)
    return redo('mnlistening', loop=3.2, extra=extra)


@clip
def balancekick():
    def extra(r, t, a, b, env):
        wobble(r, t, a, b, env, 3)
        r.turn('Thigh.L', X, -8 * env * (1 - math.cos(cyc(t, a, b, 2))) / 2)
    return redo('balancekick', intro=.6, kind='snap', loop=3.2, extra=extra, alive_kw={'sway': 0})


@clip
def mnangelspread():
    def extra(r, t, a, b, env):
        f = math.sin(cyc(t, a, b, 1))
        r.turn('UpperArm.L', FWD, 8 * env * f); r.turn('UpperArm.R', FWD, -8 * env * f)
        r.turn('Forearm.L', FWD, 6 * env * math.sin(cyc(t, a, b, 1, -.6))); r.turn('Forearm.R', FWD, -6 * env * math.sin(cyc(t, a, b, 1, -.6)))
        r.turn('Head', X, -4 * env)
    return redo('mnangelspread', loop=3.6, extra=extra)


@clip
def mnartistlean():
    return redo('mnartistlean', loop=3.6, extra=lambda r, t, a, b, env: r.turn('Head', FWD, 5 * env * math.sin(cyc(t, a, b, 1))))


@clip
def mnbehindback():
    def extra(r, t, a, b, env):                                        # rocking heel to toe
        planted = feet_down(r)
        k = math.sin(cyc(t, a, b, 2))
        r.move('Pelvis', V(0, -.02 * env * k, .01 * env * max(0, k)))
        for s, h in planted.items(): r.plant(s, h + V(0, 0, .015 * env * max(0, k)))
        for s in (LEFT, RIGHT): r.turn('Foot' + s, X, 10 * env * max(0, k))
        r.turn('Head', Z, 8 * env * math.sin(cyc(t, a, b, 1)))
    return redo('mnbehindback', loop=3.2, extra=extra, alive_kw={'sway': 0})


@clip
def mnprayer():
    return redo('mnprayer', intro=.8, kind='smooth', loop=4.0, extra=lambda r, t, a, b, env: nod(r, t, a, b, env, 1, 4))


@clip
def mnstepturn():
    return redo('mnstepturn', loop=3.6, extra=lambda r, t, a, b, env: r.turn('Chest', Z, 4 * env * math.sin(cyc(t, a, b, 1))))


@clip
def oath():
    return redo('oath', intro=.7, kind='smooth', loop=3.6, extra=lambda r, t, a, b, env: (r.turn('Head', X, -3 * env), r.turn('Chest', X, -2 * env)), alive_kw={'sway': .4})


@clip
def powerpunch():
    def extra(r, t, a, b, env):                                       # pull back and throw it again
        x = ((t - a) / (b - a)) % 1.0
        back = ease(x / .55) if x < .55 else 1 - ease((x - .55) / .12, 'snap')
        r.turn('UpperArm.R', X, 30 * env * back); r.turn('Forearm.R', X, 45 * env * back); r.turn('Chest', Z, -14 * env * back)
    return redo('powerpunch', intro=.4, kind='snap', loop=1.6, extra=extra, alive_kw={'sway': 0},
                anticipate=lambda r: (r.turn('Chest', Z, -16), r.turn('UpperArm.R', X, 30)))


@clip
def present():
    def extra(r, t, a, b, env):
        w = (1 - math.cos(cyc(t, a, b, 1))) / 2
        r.turn('UpperArm.L', Z, -10 * env * w); r.turn('Head', Z, 8 * env * w); r.turn('Chest', Z, 4 * env * w)
    return redo('present', loop=3.2, extra=extra)


# --------------------------------------------------------------------------------------- new ones
SH = {LEFT: V(.35, 0, 1.465), RIGHT: V(-.35, 0, 1.465)}          # shoulders
HIP = {LEFT: V(.215, 0, .68), RIGHT: V(-.215, 0, .68)}
ANKLE = {LEFT: V(.215, 0, .17), RIGHT: V(-.215, 0, .17)}
side_x = lambda s: 1 if s == LEFT else -1


def P(ops, start=None):
    return pose_from(rig, start or N, ops)


def legs_bent(r, drop, spread=0.0, back=0.0):
    """Hips down by drop (and forward/back), feet where they were (or set apart by spread each)."""
    feet = {s: r.head('Foot' + s) + V(side_x(s) * spread, 0, 0) for s in (LEFT, RIGHT)}
    r.move('Pelvis', V(0, back, -drop))
    for s, h in feet.items(): r.plant(s, h)


def loop_keys(keys, a):
    """Shift loop keys (times from the loop's start) onto the clip's timeline."""
    return [(a + t, p, k) for t, p, k in keys]


@clip
def groove():
    """An easy step-touch: the hips swing side to side on the beat, the knees bounce, the fists pump
    in turn, the head nods. 100 bpm, four beats a loop."""
    def ready(r):
        legs_bent(r, .05, .05)
        for s in (LEFT, RIGHT): r.reach(s, SH[s] + V(side_x(s) * .12, -.24, -.38))
    base = P(ready)
    intro = .6
    a, b = intro, intro + 2.4
    def layer(r, t, env):
        planted = feet_down(r)
        beat = cyc(t, a, b, 4)                      # one cycle a beat
        sw = math.sin(cyc(t, a, b, 2))              # hips: right on beats 1 and 3's step, left on 2 and 4
        r.move('Pelvis', V(.06 * env * sw, 0, -.035 * env * (1 - math.cos(beat)) / 2))
        r.turn('Pelvis', FWD, -6 * env * sw); r.turn('Chest', FWD, 9 * env * sw); r.turn('Chest', Z, -7 * env * sw)
        for s, h in planted.items():
            # the foot the hips move away from lifts its heel on the off-beat
            lift = max(0.0, -side_x(s) * sw) * .05 * env
            r.plant(s, h + V(0, 0, lift))
            r.turn('Foot' + s, X, -20 * lift / .05 * env if lift else 0)
        pump = math.sin(cyc(t, a, b, 2, .4))
        r.turn('UpperArm.R', X, -26 * env * max(0, pump)); r.turn('Forearm.R', X, -30 * env * max(0, pump))
        r.turn('UpperArm.L', X, -26 * env * max(0, -pump)); r.turn('Forearm.L', X, -30 * env * max(0, -pump))
        r.turn('Head', X, 7 * env * math.sin(beat)); r.turn('Head', FWD, -6 * env * sw)
        r.turn('Tail', Z, 18 * env * sw)
    return Clip('groove', [(0, N, 'smooth'), (intro, base, 'smooth')], (a, b), layer, envelope=(.15, a))


@clip
def herolanding():
    """A big jump, a superhero landing (one knee and a fist down, the other arm out behind), a moment
    with the head down, then it looks up, breathing hard."""
    crouch = P(lambda r: (legs_bent(r, .2, .02, .04), r.turn('Chest', X, 25), r.aim('UpperArm.L', U(.4, .6, -.7)), r.aim('UpperArm.R', U(-.4, .6, -.7)), r.aim('Forearm.L', U(.3, .5, -.8)), r.aim('Forearm.R', U(-.3, .5, -.8))))
    def up(h, tuck):
        def ops(r):
            r.move('Root', V(0, 0, h))
            for s in (LEFT, RIGHT):
                r.aim('UpperArm' + s, U(side_x(s) * .5, -.1, .85)); r.aim('Forearm' + s, U(side_x(s) * .3, -.2, .95))
                if tuck: r.plant(s, r.head('Thigh' + s) + V(0, -.12, -.36))
            r.turn('Chest', X, -8)
        return ops
    launch, peak = P(up(.55, False)), P(up(1.05, True))
    def land(deep):
        def ops(r):
            r.move('Pelvis', V(0, .08, -.3 - deep))
            r.turn('Chest', X, 32 + deep * 40)
            r.plant(LEFT, V(.26, -.36, .17), V(.3, -1, .3))
            r.limb('Thigh.R', 'Shin.R', 'Foot.R', V(-.22, .4, .13), V(0, -1, -1.2))
            r.aim('Foot.R', U(0, .45, -.9))
            r.reach(RIGHT, V(-.5, -.3, .2 + .2 * 0), V(-1, .5, .5))
            r.aim('Hand.R', U(-.1, -.2, -1))
            r.aim('UpperArm.L', U(.75, .55, .25)); r.aim('Forearm.L', U(.65, .65, .3)); r.aim('Hand.L', U(.6, .7, .3))
            r.turn('Head', X, 30)
        return ops
    impact, landed = P(land(.05)), P(land(0))
    look = P(lambda r: (land(0)(r), r.turn('Head', X, -42)))
    keys = [(0, N, 'smooth'), (.32, crouch, 'smooth'), (.52, launch, 'out'), (.82, peak, 'out'), (1.12, landed, 'in'), (1.22, impact, 'snap'),
            (1.5, landed, 'smooth'), (2.2, landed, 'smooth'), (2.75, look, 'back')]
    a, b = 2.75, 2.75 + 2.4
    def layer(r, t, env):
        br = math.sin(cyc(t, a, b, 3))
        r.turn('Chest', X, -3 * env * br); r.move('Chest', V(0, 0, .008 * env * br))
        r.turn('UpperArm.L', X, 3 * env * br)
        r.turn('TailTip', Z, 12 * env * math.sin(cyc(t, a, b, 2)))
    return Clip('herolanding', keys, (a, b), layer, lag=.02, envelope=(2.4, a))


@clip
def despair():
    """Hands to the head, a step back, down onto both knees, slumped; rocking, the head shaking slowly."""
    def hands_on_head(r):
        for s in (LEFT, RIGHT):
            r.reach(s, V(side_x(s) * .46, -.08, 1.62), V(side_x(s) * 1, .3, -.2))
            r.aim('Hand' + s, U(-side_x(s) * .25, -.15, 1))
    grab = P(lambda r: (hands_on_head(r), r.turn('Head', X, -12), r.turn('Chest', X, -8)))
    step = P(lambda r: (hands_on_head(r), legs_bent(r, .05, 0, .1), r.turn('Chest', X, -12), r.turn('Head', X, -14)), grab)
    def knees(slump):
        def ops(r):
            r.move('Pelvis', V(0, .12, -.31))
            for s in (LEFT, RIGHT):
                r.limb('Thigh' + s, 'Shin' + s, 'Foot' + s, V(side_x(s) * .23, .44, .12), V(0, -1, -.8))
                r.aim('Foot' + s, U(0, .8, -.6))
            hands_on_head(r)
            r.turn('Chest', X, 6 + slump * 30); hands_on_head(r); r.turn('Head', X, 8 + slump * 18)
        return ops
    down, slump = P(knees(0)), P(knees(1))
    keys = [(0, N, 'smooth'), (.5, grab, 'out'), (.95, step, 'smooth'), (1.45, down, 'in'), (1.6, P(knees(.15)), 'snap'), (2.4, slump, 'smooth')]
    a, b = 2.4, 2.4 + 3.6
    def layer(r, t, env):
        rock = math.sin(cyc(t, a, b, 1))
        r.turn('Chest', X, 5 * env * rock)
        r.turn('Head', Z, 9 * env * math.sin(cyc(t, a, b, 2)))
        sob = pulse(t, a, b, 3, 7)
        r.move('Chest', V(0, 0, .012 * env * sob))
    return Clip('despair', keys, (a, b), layer, lag=.02, envelope=(2.0, a))


@clip
def cry():
    """Knuckles rubbing the eyes, head down, shoulders heaving with sobs."""
    def rub(r, dl=V(0, 0, 0), dr=V(0, 0, 0)):
        legs_bent(r, .03)
        r.turn('Chest', X, 10); r.turn('Head', X, 14)
        for s, d in ((LEFT, dl), (RIGHT, dr)):
            r.reach(s, V(side_x(s) * .2, -.42, 1.4) + d, V(side_x(s) * .8, .2, -1))
            r.aim('Hand' + s, U(-side_x(s) * .25, -.25, 1))
    base = P(rub)
    a, b = .7, .7 + 2.4
    def layer(r, t, env):
        for s, ph in ((LEFT, 0), (RIGHT, math.pi)):
            c = cyc(t, a, b, 4, ph)
            r.turn('Forearm' + s, X, 7 * env * math.sin(c)); r.turn('Forearm' + s, Z, side_x(s) * 7 * env * math.cos(c))
        sob = pulse(t, a, b, 4, 6)
        r.move('Chest', V(0, 0, .014 * env * sob)); r.turn('Head', X, -5 * env * sob)
        r.turn('Chest', FWD, 3 * env * math.sin(cyc(t, a, b, 1)))
    return Clip('cry', [(0, N, 'smooth'), (.7, base, 'out')], (a, b), layer, envelope=(.4, a))


@clip
def pirouette():
    """A ballet turn: plie with the arms rounded low, up onto the toes with the arms over the head and one
    foot at the other knee, a full spin, a held balance; again."""
    def first(r):
        legs_bent(r, .06, .02)
        for s in (LEFT, RIGHT): r.reach(s, V(side_x(s) * .16, -.36, 1.0), V(side_x(s), .2, -.6))
    def releve(r):
        r.move('Root', V(0, 0, .07))
        r.plant(LEFT, r.head('Foot.L') + V(-.1, 0, 0)); r.aim('Foot.L', U(0, -.25, -1))
        r.plant(RIGHT, V(.04, -.08, .58), V(-1, -.4, 0)); r.aim('Foot.R', U(.5, 0, -.9))
        for s in (LEFT, RIGHT):
            r.reach(s, V(side_x(s) * .18, -.06, 2.42), V(side_x(s) * 1, .2, 0))
            r.aim('Hand' + s, U(-side_x(s) * .7, 0, .7))
        r.turn('Head', X, -4)
    prep, up = P(first), P(releve)
    a, b = 1.0, 1.0 + 2.0
    def layer(r, t, env):
        x = ((t - a) / (b - a)) % 1.0 if t >= a else 0.0
        r.turn('Root', Z, -360 * ease(min(1.0, x / .55), 'smooth'))
        r.turn('Pelvis', FWD, 1.5 * env * math.sin(cyc(t, a, b, 2)))
    return Clip('pirouette', [(0, N, 'smooth'), (.45, prep, 'smooth'), (1.0, up, 'back')], (a, b), layer, envelope=(.9, a))


@clip
def collapse():
    """Out like a light: a jolt, the knees go, it falls back flat and flops, arms out, head lolled."""
    jolt = P(lambda r: (r.turn('Head', X, -14), r.turn('Chest', X, -6), r.turn('UpperArm.L', FWD, 8), r.turn('UpperArm.R', FWD, -8)))
    buckle = P(lambda r: (legs_bent(r, .2, 0, .06), r.turn('Chest', X, -10), r.turn('Head', X, 18), r.turn('Head', FWD, 10)))
    def lying(mid):
        def ops(r):
            r.aim('UpperArm.L', U(.95, .1, .3) if not mid else U(.7, .2, -.5)); r.aim('Forearm.L', U(.9, -.25, .3) if not mid else U(.6, .2, -.7))
            r.aim('UpperArm.R', U(-.95, .1, .35) if not mid else U(-.7, .2, -.5)); r.aim('Forearm.R', U(-.85, -.3, .45) if not mid else U(-.6, .2, -.7))
            r.aim('Thigh.L', U(.25, -.15, -1)); r.aim('Shin.L', U(.1, .2, -1))
            r.aim('Thigh.R', U(-.2, -.1, -1)); r.aim('Shin.R', U(-.15, .12, -1))
            r.turn('Head', FWD, -28); r.turn('Head', Z, -10)
            r.turn_about('Root', X, -55 if mid else -88, V(0, .05, 0))
            r.move('Root', V(0, 0, .12 if mid else .26))
        return ops
    falling, down = P(lying(True), buckle), P(lying(False), buckle)
    flop = P(lambda r: (lying(False)(r), r.move('Root', V(0, 0, .05))), buckle)
    keys = [(0, N, 'smooth'), (.18, jolt, 'snap'), (.6, buckle, 'in'), (.95, falling, 'in'), (1.2, down, 'in'), (1.34, flop, 'out'), (1.5, down, 'in')]
    a, b = 1.9, 1.9 + 4.0
    def layer(r, t, env):
        r.turn('Chest', X, -1.5 * env * math.sin(cyc(t, a, b, 2)))
        tw = pulse(t, a, b, 1, 12, .3)
        r.turn('Forearm.R', Y, 14 * env * tw)                           # a twitch
    return Clip('collapse', keys, (a, b), layer, lag=.03, envelope=(1.6, a))


@clip
def laugh():
    """Leaning back cracking up, hands on the belly; then doubled over slapping a knee; again."""
    def belly(r, back):
        legs_bent(r, .03 + (0 if back else .06))
        r.turn('Chest', X, -14 if back else 34); r.turn('Head', X, -20 if back else 10)
        r.reach(LEFT, V(.2, -.36, 1.02 if back else .95), V(1, .3, -.6))
        if back: r.reach(RIGHT, V(-.2, -.36, 1.02), V(-1, .3, -.6))
        else: r.reach(RIGHT, V(-.3, -.42, .62), V(-1, .5, .2))
    lean, double, slap = P(lambda r: belly(r, True)), P(lambda r: belly(r, False)), P(lambda r: (belly(r, False), r.turn('UpperArm.R', X, -16)))
    a = .5
    loop = [(0, lean, 'smooth'), (1.4, lean, 'smooth'), (1.75, double, 'smooth'), (1.95, slap, 'snap'), (2.15, double, 'smooth'),
            (2.35, slap, 'snap'), (2.55, double, 'smooth'), (2.75, slap, 'snap'), (3.0, double, 'smooth'), (3.6, lean, 'smooth')]
    keys = [(0, N, 'smooth')] + loop_keys(loop, a)
    b = a + 3.6
    def layer(r, t, env):
        shake = math.sin(cyc(t, a, b, 22))
        r.move('Chest', V(0, 0, .007 * env * shake)); r.turn('Head', X, 2.5 * env * shake)
    return Clip('laugh', keys, (a, b), layer, lag=0, envelope=(.2, a))


@clip
def clap():
    """Applause, a happy bounce."""
    def hands(r, closed):
        legs_bent(r, .02)
        for s in (LEFT, RIGHT):
            r.reach(s, V(side_x(s) * (.1 if closed else .32), -.48, 1.25), V(side_x(s), .4, -.7))
            r.aim('Hand' + s, U(-side_x(s) * (.06 if closed else -.1), -.5, .85))
    open_, shut = P(lambda r: hands(r, False)), P(lambda r: hands(r, True))
    a, n, gap = .5, 6, .4
    loop = []
    for i in range(n):
        loop += [(i * gap, open_, 'smooth'), (i * gap + .14, shut, 'in'), (i * gap + .22, shut, 'smooth')]
    loop.append((n * gap, open_, 'out'))
    keys = [(0, N, 'smooth')] + loop_keys(loop, a)
    b = a + n * gap
    def layer(r, t, env):
        bounce(r, t, a, b, env, n, .03, .5); nod(r, t, a, b, env, n // 2, 3)
    return Clip('clap', keys, (a, b), layer, lag=0, envelope=(.2, a))


@clip
def facepalm():
    """A hand to the forehead, the other on a hip; the head shakes, slowly."""
    def palm(r):
        r.turn('Head', X, 16); r.turn('Chest', X, 6)
        r.reach(RIGHT, V(-.12, -.46, 1.5), V(-1, .3, -.6)); r.aim('Hand.R', U(.15, -.2, 1))
        r.reach(LEFT, V(.42, .05, .95), V(1, .6, .2)); r.aim('Hand.L', U(-.3, .3, -.9))
    up = P(palm)
    a, b = .6, .6 + 3.2
    def layer(r, t, env):
        r.turn('Head', Z, 9 * env * math.sin(cyc(t, a, b, 2))); r.turn('Chest', X, 2 * env * math.sin(cyc(t, a, b, 1)))
    return Clip('facepalm', [(0, N, 'smooth'), (.25, P(lambda r: (r.turn('Head', X, -6), r.reach(RIGHT, V(-.4, -.5, 1.65), V(-1, .3, -.6)))), 'smooth'), (.6, up, 'snap')],
                (a, b), layer, envelope=(.4, a))


@clip
def yawn():
    """A big stretch up on the toes, then a hand patting a yawn, drowsy."""
    def stretch(r):
        r.move('Root', V(0, 0, .04)); r.turn('Chest', X, -12); r.turn('Head', X, -18)
        for s in (LEFT, RIGHT):
            r.plant(s, r.head('Foot' + s)); r.aim('Foot' + s, U(0, -.3, -1))
            r.reach(s, V(side_x(s) * .3, .05, 2.45), V(side_x(s), .3, 0)); r.aim('Hand' + s, U(-side_x(s) * .3, 0, 1))
    def pat(r):
        r.turn('Head', X, -10); r.turn('Chest', X, -3)
        r.reach(RIGHT, V(-.1, -.45, 1.42), V(-1, .4, -.5)); r.aim('Hand.R', U(.2, -.3, 1))
    up, mouth = P(stretch), P(pat)
    keys = [(0, N, 'smooth'), (1.0, up, 'smooth'), (1.5, up, 'smooth'), (2.2, mouth, 'smooth')]
    a, b = 2.2, 2.2 + 3.2
    def layer(r, t, env):
        p = pulse(t, a, b, 3, 7) if ((t - a) / (b - a)) % 1 < .45 else 0
        r.turn('Forearm.R', X, -10 * env * p)
        droop = (1 - math.cos(cyc(t, a, b, 1))) / 2
        r.turn('Head', X, 8 * env * droop); r.turn('Chest', X, 3 * env * droop)
    return Clip('yawn', keys, (a, b), layer, lag=.03, envelope=(2.0, a))


@clip
def sit():
    """Down onto the floor, legs out, leaning back on the hands; swaying, feet waggling."""
    squat = P(lambda r: (legs_bent(r, .3, .03, .05), r.turn('Chest', X, 25), r.aim('UpperArm.L', U(.3, -.8, -.3)), r.aim('UpperArm.R', U(-.3, -.8, -.3))))
    def seated(r):
        r.move('Root', V(0, .14, -.42))
        for s in (LEFT, RIGHT):
            r.limb('Thigh' + s, 'Shin' + s, 'Foot' + s, V(side_x(s) * .24, -.42, .13), V(0, -.6, 1))
            r.aim('Foot' + s, U(side_x(s) * .1, -.4, .9))
        r.turn('Chest', X, -16)
        for s in (LEFT, RIGHT):
            r.reach(s, V(side_x(s) * .42, .42, .2), V(side_x(s), -.3, .4)); r.aim('Hand' + s, U(side_x(s) * .2, .7, -.7))
    down = P(seated)
    a, b = 1.3, 1.3 + 3.2
    def layer(r, t, env):
        r.turn('Chest', FWD, 5 * env * math.sin(cyc(t, a, b, 1))); r.turn('Head', FWD, -7 * env * math.sin(cyc(t, a, b, 1, .5)))
        for s, ph in ((LEFT, 0), (RIGHT, math.pi)): r.turn('Foot' + s, Z, 14 * env * math.sin(cyc(t, a, b, 4, ph)))
        nod(r, t, a, b, env, 4, 3)
    return Clip('sit', [(0, N, 'smooth'), (.6, squat, 'smooth'), (1.3, down, 'out')], (a, b), layer, lag=.02, envelope=(1.1, a))


@clip
def headbang():
    """Rocking out: wide stance, knees going, a fist up, the head and chest banging on the beat."""
    def ready(r):
        legs_bent(r, .08, .1)
        r.turn('Chest', X, 12)
        r.reach(RIGHT, V(-.5, -.25, 1.95), V(-1, .4, -.4)); r.aim('Hand.R', U(-.1, -.1, 1))
        r.reach(LEFT, V(.4, -.25, 1.05), V(1, .4, -.4))
    base = P(ready)
    a, b = .5, .5 + 1.6
    def layer(r, t, env):
        ph = cyc(t, a, b, 4)
        r.turn('Chest', X, 12 * env * math.sin(ph)); r.turn('Head', X, 24 * env * math.sin(ph - .6))
        r.turn('UpperArm.R', FWD, -8 * env * math.sin(ph))
        bounce(r, t, a, b, env, 4, .05)
    return Clip('headbang', [(0, N, 'smooth'), (.5, base, 'back')], (a, b), layer, envelope=(.3, a))


@clip
def cheer():
    """Jumping for joy: little hops, fists punching the air on each."""
    def down(r):
        legs_bent(r, .1)
        for s in (LEFT, RIGHT): r.reach(s, SH[s] + V(side_x(s) * .1, -.2, -.35), V(side_x(s), .3, -.6))
    def up(r):
        r.move('Root', V(0, 0, .2))
        for s in (LEFT, RIGHT):
            r.plant(s, r.head('Foot' + s) + V(0, .05, .06)); r.aim('Foot' + s, U(0, -.3, -1))
            r.reach(s, SH[s] + V(side_x(s) * .2, -.1, .7), V(side_x(s), .3, -.3))
        r.turn('Head', X, -10)
    lo, hi = P(down), P(up)
    loop = [(0, lo, 'smooth'), (.38, hi, 'out'), (.72, lo, 'in'), (.8, lo, 'smooth'), (1.18, hi, 'out'), (1.52, lo, 'in'), (1.6, lo, 'smooth')]
    a = .35
    return Clip('cheer', [(0, N, 'smooth')] + loop_keys(loop, a), (a, a + 1.6), None, lag=0)


@clip
def doze():
    """Nodding off standing up: the head sinks, the knees sag, then it jerks awake; again."""
    sink = P(lambda r: (legs_bent(r, .04), r.turn('Chest', X, 12), r.turn('Head', X, 36), r.turn('Head', FWD, 8),
                        r.turn('UpperArm.L', FWD, -3), r.turn('UpperArm.R', FWD, 3)))
    awake = P(lambda r: (r.turn('Head', X, -12), r.turn('Chest', X, -5)))
    loop = [(0, N, 'smooth'), (3.2, sink, 'in'), (3.42, awake, 'snap'), (4.4, N, 'smooth')]
    a = .01
    def layer(r, t, env):
        alive(r, t, a, a + 4.4, 1.0, amount=.6, sway=.6)
    return Clip('doze', loop_keys(loop, a) if False else [(0, N, 'smooth')] + loop_keys(loop[1:], a), (a, a + 4.4), layer, lag=0, envelope=(0, 0))


@clip
def robot():
    """Stiff and snappy: elbows at right angles, every move a click into place, then held."""
    def pose(ra, la, head=0, chest=0, drop=.02):
        def ops(r):
            legs_bent(r, drop)
            r.turn('Chest', Z, chest); r.turn('Head', Z, head)
            for s, (up, fwd) in ((RIGHT, ra), (LEFT, la)):
                r.aim('UpperArm' + s, U(side_x(s) * .25, -.1 * fwd, -1))
                r.aim('Forearm' + s, U(side_x(s) * .05, -1 if up == 0 else -.2, 0 if up == 0 else (1 if up > 0 else -1)))
                r.aim('Hand' + s, r.axis('Forearm' + s))
        return P(ops)
    poses = [pose((0, 1), (0, 1)), pose((1, 1), (0, 1)), pose((1, 1), (-1, 1), 25, 10), pose((0, 1), (1, 1), -25, -10),
             pose((-1, 1), (1, 1), 0, 0, .06), pose((0, 1), (0, 1), 30, 0), pose((1, 1), (1, 1), 0, 0), pose((0, 1), (0, 1))]
    loop = []
    for i, p in enumerate(poses):
        loop += [(i * .3, p, 'snap'), (i * .3 + .2, p, 'linear')]
    loop.append((len(poses) * .3, poses[0], 'snap'))
    a = .4
    return Clip('robot', [(0, N, 'smooth')] + loop_keys(loop, a), (a, a + len(poses) * .3), None, lag=0)


@clip
def jumpingjacks():
    """Jumping jacks: feet out and hands overhead, feet in and hands down, a hop between."""
    def shut(r):
        r.aim('UpperArm.L', U(.25, 0, -1)); r.aim('UpperArm.R', U(-.25, 0, -1)); r.aim('Forearm.L', U(.18, 0, -1)); r.aim('Forearm.R', U(-.18, 0, -1))
    def wide(r):
        legs_bent(r, .07, .16)
        for s in (LEFT, RIGHT):
            r.aim('UpperArm' + s, U(side_x(s) * .55, 0, .85)); r.aim('Forearm' + s, U(side_x(s) * .2, 0, 1)); r.aim('Hand' + s, U(-side_x(s) * .2, 0, 1))
    closed, open_ = P(shut), P(wide)
    loop = [(0, closed, 'smooth'), (.3, open_, 'smooth'), (.6, closed, 'smooth'), (.9, open_, 'smooth'), (1.2, closed, 'smooth')]
    a, b = .3, 1.5
    def layer(r, t, env):
        x = ((t - a) / .3) % 1.0 if t >= a else 0
        r.move('Root', V(0, 0, .09 * math.sin(math.pi * x) * env))
    return Clip('jumpingjacks', [(0, N, 'smooth')] + loop_keys(loop, a), (a, b), layer, lag=0, envelope=(0, .3))


# ----------------------------------------------------------------------------------------- build
built = []
for make in CLIPS:
    c = make()
    if ONLY and c.id not in ONLY: continue
    built.append((c, build(rig, c)))
    print('built', c.id, c.loop)
size = export(rig, [act for _, act in built], OUT_GLB)
timings = {c.id: [round(c.loop[0], 4), round(c.loop[1], 4)] for c, _ in built}
with open(OUT_JS, 'w') as f:
    f.write('// Generated by tools/blender/emotes.py: each Emote_<id> clip plays [0, loop start] once, then\n'
            '// loops [loop start, end] for as long as the emote lasts. Seconds.\n')
    f.write('export const EMOTE_CLIPS = ' + json.dumps(timings, indent=None).replace('], ', '],\n  ').replace('{', '{\n  ').replace('}', ',\n}') + ';\n')
print('wrote', OUT_GLB, size, 'bytes of animation;', OUT_JS)
