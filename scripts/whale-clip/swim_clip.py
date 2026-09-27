"""
Generates the humpback's swim clip ("Armature|ArmatureAction") procedurally
and bakes it into the site's GLB. The Sketchfab clip it replaces bent the four
spine bones in unison at 0.1 Hz and flapped the flippers through ~60 degrees.

    python scripts/whale-clip/swim_clip.py                 # bake the site GLB
    python scripts/whale-clip/swim_clip.py --json out.json # also export JSON

Needs numpy and scipy. It reads the untouched Sketchfab model in
media-src/humpback_whale.original.glb (the rig: bind pose, rest pose,
hierarchy) and writes src/assets/models/humpback_whale.glb with only the
animation replaced.

HOW IT IS AUTHORED
Everything is posed in the bind pose's own frame (mesh space: +z snout,
+y dorsal, +x the animal's right), as rotations of each bone away from the
shape the modeller skinned, then converted to the local rotations the
hierarchy wants. The root bone (Bone_00) is never animated, so the site's
own heave, pitch and roll of the whole animal stay in charge of the body's
attitude, and the clip only adds what the body does to itself.

WHAT IT DOES, AND WHY (cetacean kinematics)
  * A dorso-ventral travelling wave, one body wavelength (~1.05 L). Whales
    swim with vertical strokes; there is no side-to-side undulation.
  * Amplitude grows as r^2.6 behind 0.38 L: the thorax is stiff, the lumbar
    region flexes a little and the peduncle does most of the work.
  * Fluke-tip heave ~0.2 L peak to peak (the original was 0.33 L).
  * Fluke pitch leads heave by ~90 degrees and tracks heave VELOCITY: the
    trailing edge lags on the upstroke and the downstroke, sits level at the
    top and bottom, and flips quickly there (the pitch wave is squared off).
  * The upstroke — the humpback's power stroke — is ~8% quicker.
  * The head nods slightly against the tail (recoil).
  * The flippers are hydroplanes: held out, a touch flatter and more swept
    than modelled, with passive flex that lags down the fin and slow trim.
  * Stroke vigour, a tiny course correction and fluke roll drift slowly.
Every term repeats a whole number of times in CLIP_SECONDS, so it loops
seamlessly.

TAIL BEAT
STROKES per CLIP_SECONDS sets the beat at timeScale 1. It must agree with
`clipBaseHz` in src/animations/whaleConfig.ts (STROKES / CLIP_SECONDS).
"""
import argparse
import datetime
import json
import os

import numpy as np
from scipy.spatial.transform import Rotation

from gltf_io import accessor, read_glb, replace_animations, write_glb

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SOURCE = os.path.join(ROOT, 'media-src', 'humpback_whale.original.glb')
TARGET = os.path.join(ROOT, 'src', 'assets', 'models', 'humpback_whale.glb')

CLIP_NAME = 'Armature|ArmatureAction'
CLIP_SECONDS = 40.0      # the loop; the site plays this clip forever
STROKES = 7              # 0.175 Hz at timeScale 1 — see TAIL BEAT above
KEY_FPS = 30

# --- body wave ---------------------------------------------------------------
BODY_LENGTH = 9.94       # mesh units, snout (z +4.99) to fluke tips (z -4.95)
FLEX_START = 0.38        # fraction of L from the snout where bending begins
ENVELOPE_POWER = 2.6
WAVELENGTH = 1.05        # body lengths
ROOT_HEAVE = 0.75        # heave half-amplitude at the fluke insertion
FLUKE_PITCH = np.radians(27)
FLUKE_FLIP = 1.5         # squares off the pitch wave: quick flip, flat middle
FLUKE_LAG = np.radians(8)
UPSTROKE_BIAS = 0.13     # phase warp; upstroke ~46% of the cycle
VIGOUR = 0.07            # slow stroke-to-stroke amplitude variation
COURSE_YAW = np.radians(0.9)
FLUKE_ROLL = np.radians(1.4)

# --- head --------------------------------------------------------------------
HEAD_HEAVE = 0.07        # nose heave half-amplitude, mesh units
HEAD_LEAD = np.radians(25)
HEAD_LENGTH = 3.3        # neck joint to snout

# --- flippers ----------------------------------------------------------------
FIN_ELEVATION = np.radians(4)    # held flatter than the modelled droop
FIN_SWEEP = np.radians(5)        # and swept back a little more
FIN_TRIM = (np.radians(5), np.radians(3.5), np.radians(6))  # elev, sweep, feather
FIN_STROKE_ELEVATION = np.radians(2.2)
FIN_STROKE_FEATHER = np.radians(1.8)
FIN_TIP_FLEX = np.radians(3.2)
FIN_TIP_TWIST = np.radians(2.0)

SEED = 7

SPINE = ['Bone.003_01', 'Bone.002_02', 'Bone.001_03', 'Bone.005_04', 'Bone.004_05']
FACE = ['Bone.012_08', 'Bone.013_09', 'Bone.014_010', 'Bone.015_011']
FINS = ((1, 'Bone.010_013', 'Bone.016_014'), (-1, 'Bone.011_016', 'Bone.017_017'))
# The exported JSON keeps the bone order and the three.js-sanitised names of
# the clip exporter the original JSON came from.
JSON_ORDER = ['Bone.004_05', 'Bone.005_04', 'Bone.001_03', 'Bone.002_02', 'Bone.003_01',
              'Bone.007_07', 'Bone.012_08', 'Bone.013_09', 'Bone.014_010', 'Bone.015_011',
              'Bone.006_06', 'Bone.016_014', 'Bone.010_013', 'Bone.017_017', 'Bone.011_016']


# ----------------------------------------------------------------------------
# Rig
# ----------------------------------------------------------------------------
def quat_matrix(q):
    return Rotation.from_quat(q).as_matrix()


def trs(t, r, s):
    m = np.eye(4)
    m[:3, :3] = quat_matrix(r) @ np.diag(s)
    m[:3, 3] = t
    return m


class Rig:
    def __init__(self, gltf, binary):
        self.nodes = gltf['nodes']
        self.index = {n.get('name'): i for i, n in enumerate(self.nodes)}
        self.parent = {c: i for i, n in enumerate(self.nodes) for c in n.get('children', [])}
        skin = gltf['skins'][0]
        self.skeleton_root = skin['skeleton']
        ibm = accessor(gltf, binary, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        # Bind pose, in mesh space
        self.bind = {j: np.linalg.inv(m) for j, m in zip(skin['joints'], ibm)}
        # Mesh space -> skeleton-root space. Bone_00 is never animated and its
        # rest pose is its bind pose, so this is a constant.
        b0 = self.index['Bone_00']
        self.mesh_to_root = self.world_rest(b0) @ ibm[skin['joints'].index(b0)]

    def rest(self, i):
        n = self.nodes[i]
        return (np.array(n.get('translation', [0, 0, 0]), float),
                np.array(n.get('rotation', [0, 0, 0, 1]), float),
                np.array(n.get('scale', [1, 1, 1]), float))

    def world_rest(self, i):
        m = trs(*self.rest(i))
        p = self.parent.get(i)
        while i != self.skeleton_root and p is not None:
            m = trs(*self.rest(p)) @ m
            i, p = p, self.parent.get(p)
        return m

    def i(self, name):
        return self.index[name]


# ----------------------------------------------------------------------------
# Motion
# ----------------------------------------------------------------------------
def about(axis, angle):
    axis = np.asarray(axis, float)
    return Rotation.from_rotvec(axis / np.linalg.norm(axis) * angle).as_matrix()


X, Y, Z = np.eye(3)


class SwimCycle:
    def __init__(self, rig, strokes=STROKES, seed=SEED):
        self.rig = rig
        self.omega = 2 * np.pi * strokes / CLIP_SECONDS
        rng = np.random.default_rng(seed)

        def slow_noise():
            """Loopable, smooth noise in [-1, 1]: three harmonics of the loop."""
            amps = 0.55 ** np.arange(3)
            phases = rng.uniform(0, 2 * np.pi, 3)
            return lambda t: float(np.sum(amps * np.sin(2 * np.pi * np.arange(1, 4) * t / CLIP_SECONDS + phases)) / amps.sum())

        self.vigour = slow_noise()
        self.course = slow_noise()
        self.roll = slow_noise()
        fin_common = [slow_noise() for _ in range(3)]
        fin_own = {side: [slow_noise() for _ in range(3)] for side, _, _ in FINS}
        # Mostly shared, so the flippers trim together like one animal's.
        self.fin_trim = {side: [lambda t, c=c, o=o: 0.7 * c(t) + 0.3 * o(t)
                                for c, o in zip(fin_common, fin_own[side])]
                         for side, _, _ in FINS}

        b = rig.bind
        self.x = {n: (4.99 - b[rig.i(n)][2, 3]) / BODY_LENGTH for n in SPINE}
        self.x_root = self.x['Bone.004_05']
        # A spine bone runs from its own head to the next bone's head.
        self.length = {n: np.linalg.norm(rig.rest(rig.i(nxt))[0]) for n, nxt in zip(SPINE, SPINE[1:])}

    @staticmethod
    def heave(psi):
        return np.sin(psi + UPSTROKE_BIAS * np.sin(psi))

    @staticmethod
    def heave_velocity(psi):
        """d(heave)/dpsi normalised to +-1, then squared off a little."""
        v = np.cos(psi + UPSTROKE_BIAS * np.sin(psi)) * (1 + UPSTROKE_BIAS * np.cos(psi)) / (1 + UPSTROKE_BIAS)
        return np.tanh(FLUKE_FLIP * v) / np.tanh(FLUKE_FLIP)

    def world(self, t):
        """Absolute mesh-space rotation of every animated bone at time t."""
        rig, bind = self.rig, self.rig.bind
        psi = self.omega * t
        vigour = 1 + VIGOUR * self.vigour(t)
        rot = {}

        # Spine: heave targets at each bone head, then segment angles between.
        heave = {}
        for n in SPINE[1:]:
            r = max(0.0, (self.x[n] - FLEX_START) / (self.x_root - FLEX_START))
            phase = psi - 2 * np.pi * (self.x[n] - self.x_root) / WAVELENGTH
            heave[n] = ROOT_HEAVE * vigour * r ** ENVELOPE_POWER * self.heave(phase)
        pitch, previous = {}, 0.0  # Bone.003's head ends the rigid thorax
        for n, nxt in zip(SPINE, SPINE[1:]):
            pitch[n] = np.arcsin(np.clip((heave[nxt] - previous) / self.length[n], -1, 1))
            previous = heave[nxt]
        # Flukes: +x rotation lifts the distal end, so the trailing edge goes
        # DOWN (negative) while the tail rises.
        pitch['Bone.004_05'] = -FLUKE_PITCH * (0.93 + 0.07 * self.vigour(t)) * self.heave_velocity(psi - FLUKE_LAG)

        course = COURSE_YAW * self.course(t)
        yaw_share = {'Bone.003_01': 0, 'Bone.002_02': 0.15, 'Bone.001_03': 0.3, 'Bone.005_04': 0.55, 'Bone.004_05': 0}
        yaw = 0.0
        for n in SPINE:
            yaw += course * yaw_share[n]
            m = about(Y, yaw) @ about(X, pitch[n])
            if n == 'Bone.004_05':
                m = m @ about(Z, FLUKE_ROLL * self.roll(t))
            rot[rig.i(n)] = m @ bind[rig.i(n)][:3, :3]

        # Head: the nose moves against the peduncle. +x rotation dips the nose.
        nose = -HEAD_HEAVE * vigour * self.heave(psi + HEAD_LEAD)
        nod = -np.arcsin(nose / HEAD_LENGTH)
        for n, share in (('Bone.006_06', 0.45), ('Bone.007_07', 1.0)):
            rot[rig.i(n)] = about(X, share * nod) @ bind[rig.i(n)][:3, :3]

        # Flippers. Local axes on the root bone: X ~ chord (so +X raises the
        # tip), Y along the fin, Z ~ up (so +Z sweeps the tip back). A mirrored
        # motion keeps the X sign and flips Y and Z.
        for side, root_name, tip_name in FINS:
            i0, i1 = rig.i(root_name), rig.i(tip_name)
            b0, b1 = bind[i0][:3, :3], bind[i1][:3, :3]
            trim = [f(t) for f in self.fin_trim[side]]
            elevation = (FIN_ELEVATION + FIN_TRIM[0] * trim[0]
                         + FIN_STROKE_ELEVATION * vigour * np.sin(psi - HEAD_LEAD - np.radians(70)))
            sweep = FIN_SWEEP + FIN_TRIM[1] * trim[1]
            feather = FIN_TRIM[2] * trim[2] + FIN_STROKE_FEATHER * np.sin(psi - np.radians(40))
            d0 = about(b0[:, 0], elevation) @ about(b0[:, 2], side * sweep) @ about(b0[:, 1], side * feather)
            rot[i0] = d0 @ b0
            # The tip follows late: mass, and a soft trailing lobe.
            tip = d0 @ b1
            flex = FIN_TIP_FLEX * vigour * np.sin(psi - HEAD_LEAD - np.radians(125)) + 0.3 * FIN_TRIM[0] * trim[0]
            twist = FIN_TIP_TWIST * np.sin(psi - np.radians(95))
            rot[i1] = about(tip[:, 0], flex) @ about(tip[:, 1], side * twist) @ tip
        return rot

    def local(self, t):
        """Local rotation matrix per bone, as the glTF hierarchy wants it."""
        rig = self.rig
        world = self.world(t)
        to_root = rig.mesh_to_root[:3, :3]
        out = {}
        for i, m in world.items():
            p = rig.parent[i]
            if p == rig.skeleton_root:
                out[i] = to_root @ m
            else:
                parent = world[p] if p in world else rig.bind[p][:3, :3]
                out[i] = parent.T @ m
        # Face bones sit in the modelled pose.
        for n in FACE:
            i = rig.i(n)
            out[i] = (np.linalg.inv(rig.bind[rig.parent[i]]) @ rig.bind[i])[:3, :3]
        return out

    def bake(self):
        count = int(round(CLIP_SECONDS * KEY_FPS))
        times = np.arange(count + 1) / KEY_FPS
        tracks = {self.rig.i(n): np.zeros((count + 1, 4)) for n in JSON_ORDER}
        for k, t in enumerate(times):
            local = self.local(t % CLIP_SECONDS)
            for i, track in tracks.items():
                q = Rotation.from_matrix(local[i]).as_quat()
                if k and np.dot(q, track[k - 1]) < 0:
                    q = -q   # keep each track on one hemisphere
                track[k] = q
        return times, tracks


def export_json(path, rig, times, tracks, fps=60):
    """Same shape as the exporter the original armature_armatureaction.json
    came from: frames at `fps`, keyed every other frame, sanitised names."""
    step = int(round(fps / KEY_FPS))
    keyframes = {}
    for k in range(len(times)):
        frame = {}
        for n in JSON_ORDER:
            i = rig.i(n)
            frame[n.replace('.', '')] = {
                'position': [float(v) for v in rig.rest(i)[0]],
                'rotation': [float(v) for v in tracks[i][k]],
                'scale': [1, 1, 1],
            }
        keyframes[str(k * step)] = frame
    clip = {'name': CLIP_NAME, 'fps': fps, 'totalFrames': int(CLIP_SECONDS * fps), 'speed': 1, 'loop': True,
            'exportedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            'keyframes': keyframes}
    with open(path, 'w') as f:
        json.dump(clip, f, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=SOURCE)
    ap.add_argument('--out', default=TARGET)
    ap.add_argument('--json', help='also write the clip as keyframe JSON here')
    ap.add_argument('--strokes', type=int, default=STROKES)
    args = ap.parse_args()

    gltf, binary = read_glb(args.source)
    rig = Rig(gltf, binary)
    times, tracks = SwimCycle(rig, args.strokes).bake()
    gltf, binary = replace_animations(gltf, binary, [(CLIP_NAME, times, tracks)])
    write_glb(args.out, gltf, binary)
    print(f'{args.out}: {args.strokes} strokes / {CLIP_SECONDS:g} s = {args.strokes / CLIP_SECONDS:.4g} Hz, '
          f'{len(times)} keys, {os.path.getsize(args.out)} bytes')
    if args.json:
        export_json(args.json, rig, times, tracks)
        print(f'{args.json}: written')


if __name__ == '__main__':
    main()
