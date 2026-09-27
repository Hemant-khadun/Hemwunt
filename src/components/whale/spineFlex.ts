import { MathUtils, Object3D, Quaternion, Vector3 } from 'three';

/**
 * The body bends into its turns.
 *
 * The baked clip only flexes the spine up and down (the stroke). Turned as a
 * rigid rod, a 21-unit animal on a curve swings its flukes wide of the line
 * its head took, which reads as a skid. A real whale curves along the arc:
 * head into the turn, flukes trailing inside it. The same goes for pitch: a
 * whale pulling out of a dive curves belly-in, and one tipping over into a
 * dive arches its back.
 *
 * So the curvature of the path the body is actually following — its turn
 * rate over its speed, measured from whatever pose it was given this frame,
 * scripted or physics — is laid onto the spine on top of the clip. It runs
 * after the mixer has posed the bones (drei's useAnimations subscribes its
 * frame callback first), and every bone it touches is keyed by the clip, so
 * each frame starts from the clip's pose and nothing accumulates.
 *
 * Signs are in the body's own frame (nose +X, back +Y, right +Z, as in
 * `whaleAnimator`): a positive turn rate about an axis curls the head further
 * round that way and the tail the opposite way, so the body lies on the arc.
 */

/** Spine from the thorax to the flukes, with each joint's share of the bend.
 *  Weighted to the lumbar region and peduncle, as the stroke is. */
const TAIL: Array<[string, number]> = [
    ['Bone003_01', 0.1],
    ['Bone002_02', 0.2],
    ['Bone001_03', 0.26],
    ['Bone005_04', 0.26],
    ['Bone004_05', 0.18],
];
/** Neck and head, as shares of the tail's bend (the head is stiffer). */
const HEAD: Array<[string, number]> = [
    ['Bone006_06', 0.2],
    ['Bone007_07', 0.12],
];

/** Distance from the body's pivot to the flukes, units: path curvature times
 *  this is the angle the tail subtends lying along the arc. */
const REACH = 8;
/** Below this speed (units/s) curvature is read against this speed instead,
 *  so turning on the spot still bends the body rather than dividing by ~0. */
const SPEED_FLOOR = 2.5;
/** Turn rates under this (rad/s) are ignored: the stroke's own counter-pitch
 *  and the idle sway are not turns, and the clip already bends for them. */
const RATE_DEADZONE: [number, number] = [0.05, 0.16];
/** Most the tail may curl, rad, sideways and up/down. */
const MAX_LATERAL = MathUtils.degToRad(24);
const MAX_VERTICAL = MathUtils.degToRad(28);
/** Natural frequency of the bend's follow, rad/s (critically damped): the
 *  body takes a moment to curve into a turn and to straighten out of it. */
const FLEX_OMEGA = 4.5;

/** Development switch: ?flex=0 leaves the body rigid, for comparison. */
const DEV_PARAMS = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
const FLEX_SCALE = Number(DEV_PARAMS?.get('flex') ?? 1);

interface Joint {
    bone: Object3D;
    share: number;
    /** Body up and body right, in the bone's own frame. */
    up: Vector3;
    right: Vector3;
}

export interface SpineFlex {
    /** Call once per frame, after the body's pose is set for the frame. */
    update(body: Object3D, dt: number): void;
}

export function createSpineFlex(): SpineFlex {
    let joints: { tail: Joint[]; head: Joint[] } | null = null;
    let missing = false;

    const prevQ = new Quaternion();
    const prevPos = new Vector3();
    const dq = new Quaternion();
    const bodyQ = new Quaternion();
    const boneQ = new Quaternion();
    const bend = new Quaternion();
    const tmp = new Quaternion();
    let speed = 0;
    let lateral = 0;
    let lateralVel = 0;
    let vertical = 0;
    let verticalVel = 0;

    const bind = (body: Object3D) => {
        body.updateWorldMatrix(true, true);
        body.getWorldQuaternion(bodyQ);
        const resolve = ([name, share]: [string, number]): Joint | null => {
            const bone = body.getObjectByName(name);
            if (!bone) return null;
            // The bone's orientation relative to the body, from the pose the
            // clip has it in right now — off the bind pose by a few degrees at
            // most, which is well inside what the bend can show.
            bone.getWorldQuaternion(boneQ);
            const inv = boneQ.premultiply(tmp.copy(bodyQ).invert()).invert();
            return {
                bone,
                share,
                up: new Vector3(0, 1, 0).applyQuaternion(inv),
                right: new Vector3(0, 0, 1).applyQuaternion(inv),
            };
        };
        const tail = TAIL.map(resolve);
        const head = HEAD.map(resolve);
        if (tail.some((j) => !j) || head.some((j) => !j)) {
            missing = true;
            if (import.meta.env.DEV) console.warn('spineFlex: whale bones not found; body will not bend');
            return;
        }
        joints = { tail: tail as Joint[], head: head as Joint[] };
        prevQ.copy(body.quaternion);
        prevPos.copy(body.position);
    };

    const soften = (rate: number) =>
        rate * MathUtils.smoothstep(Math.abs(rate), RATE_DEADZONE[0], RATE_DEADZONE[1]);

    return {
        update(body, rawDt) {
            if (missing) return;
            if (!joints) {
                bind(body);
                return;
            }
            const dt = MathUtils.clamp(rawDt, 1e-4, 0.05);

            // Turn rate in the body's frame: the rotation from last frame's
            // pose to this one, as seen from the body.
            dq.copy(prevQ).invert().multiply(body.quaternion);
            if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
            const half = Math.acos(MathUtils.clamp(dq.w, -1, 1));
            const k = half > 1e-6 ? (2 * half) / Math.sin(half) / dt : 2 / dt;
            const yawRate = MathUtils.clamp(dq.y * k, -3, 3);
            const pitchRate = MathUtils.clamp(dq.z * k, -3, 3);
            prevQ.copy(body.quaternion);

            const v = body.position.distanceTo(prevPos) / dt;
            prevPos.copy(body.position);
            speed += (Math.min(v, 40) - speed) * (1 - Math.exp(-6 * dt));
            const reach = REACH / Math.max(speed, SPEED_FLOOR);

            const wantLateral = MAX_LATERAL * Math.tanh((soften(yawRate) * reach) / MAX_LATERAL);
            const wantVertical = MAX_VERTICAL * Math.tanh((soften(pitchRate) * reach) / MAX_VERTICAL);
            const w = FLEX_OMEGA;
            lateralVel += (w * w * (wantLateral - lateral) - 2 * w * lateralVel) * dt;
            lateral += lateralVel * dt;
            verticalVel += (w * w * (wantVertical - vertical) - 2 * w * verticalVel) * dt;
            vertical += verticalVel * dt;

            const apply = (j: Joint, sign: number) => {
                bend.setFromAxisAngle(j.up, sign * lateral * j.share * FLEX_SCALE);
                tmp.setFromAxisAngle(j.right, sign * vertical * j.share * FLEX_SCALE);
                j.bone.quaternion.multiply(bend.multiply(tmp));
            };
            // Head further round the turn, flukes trailing inside it.
            for (const j of joints.head) apply(j, 1);
            for (const j of joints.tail) apply(j, -1);
        },
    };
}
