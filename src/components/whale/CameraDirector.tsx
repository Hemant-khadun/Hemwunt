import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, Vector3 } from 'three';
import type { MutableRefObject } from 'react';
import type { PerspectiveCamera as PerspectiveCameraImpl } from 'three';
import { whaleScreen } from '../../animations/screenProjector';
import { diveShot } from '../../animations/diveDirector';
import { preludeSignal } from '../../animations/preludeSignal';
import { prefersReducedMotion } from '../../animations/motionPreference';
import { frameBudget } from '../../animations/frameBudget';

/**
 * The camera as a character — but a quiet one.
 *
 * The whale's side of the frame cannot be scheduled against scroll (its X is
 * integrated from time; the visitor sets the scroll), so the framing a shot
 * wants has to come from the camera instead. This gives it just enough life
 * to do that: a slow lean toward the whale, a slight ease-in for the distant
 * shots, and a touch wider for the close pass.
 *
 * HARD RULES. Each exists to keep people from feeling ill, or to keep the rest
 * of the scene's tuning true:
 *
 *   1. It never rotates. Rotational optic flow with no matching vestibular
 *      signal is the primary trigger for simulator sickness; slow translation
 *      is not. (The surface prelude pitches the camera once, as a scripted
 *      transition before the dive; this component only acts once that has
 *      handed off, and it never touches the quaternion.)
 *   2. It is never driven by a velocity — not scroll speed, not whale speed.
 *      Only by a damped follow of where the whale is and which shot is up.
 *   3. It stays inside a small budget: +-0.5 lateral, +-0.4 vertical, 0.6 of
 *      dolly, FOV 80 -> 76. The dolly cap is load-bearing: the shockwave's
 *      trigger distances in whaleConfig were derived for a camera at rest,
 *      and 0.6 keeps their error inside the pass detector's hysteresis band.
 *   4. Static under prefers-reduced-motion.
 *
 * COMPOSITION WITH THE PRELUDE. `SurfacePrelude` writes the camera's full
 * pose while the surface-to-dive beat is live, then stops writing and leaves
 * it at rest. This does not own the pose either way; it ADDS an offset on top
 * of whatever base pose is there, scaled by how far the prelude has handed
 * off. Mount it after `SurfacePrelude` so that on prelude frames its callback
 * runs second.
 *
 * The one hazard of adding to a value someone else only SOMETIMES writes is
 * accumulation: on every frame the prelude does not write — which, after the
 * handoff, is all of them — adding again would drift the camera further each
 * frame. So the offset is applied relative to a base recovered each frame: if
 * the camera is exactly where this component left it, nobody else wrote, and
 * the previous offset is stripped back off first. If the prelude did write,
 * its pose is the base.
 */

// --- Budget -----------------------------------------------------------------
const MAX_LATERAL = 0.5;
const MAX_VERTICAL = 0.4;
const MAX_DOLLY = 0.6;
const REST_FOV = 80;
const CLOSE_FOV = 76;

/** Natural frequency of the follow, rad/s. ~1.2 s to settle, critically damped. */
const OMEGA = 2.6;
/** Hard ceiling on offset speed, world units per second. */
const MAX_SPEED = 0.35;

/** The shot with the furthest staging, which earns the full dolly. Matches
 *  "the depths" in diveScore.ts. */
const FARTHEST_STAGE_Z = 3.2;

interface CameraDirectorProps {
    cameraRef: MutableRefObject<PerspectiveCameraImpl | null>;
}

interface Axis {
    value: number;
    velocity: number;
}

/** Critically damped spring toward `target`, speed-capped. Frame-rate
 *  independent enough at the clamped dt used here. */
function step(axis: Axis, target: number, dt: number) {
    const accel = OMEGA * OMEGA * (target - axis.value) - 2 * OMEGA * axis.velocity;
    axis.velocity = MathUtils.clamp(axis.velocity + accel * dt, -MAX_SPEED, MAX_SPEED);
    axis.value += axis.velocity * dt;
}

const CameraDirector = ({ cameraRef }: CameraDirectorProps) => {
    const lateral = useRef<Axis>({ value: 0, velocity: 0 });
    const vertical = useRef<Axis>({ value: 0, velocity: 0 });
    const dolly = useRef<Axis>({ value: 0, velocity: 0 });

    // What this component wrote last frame, and the offset inside it — so the
    // base pose can be recovered without accumulating (see the header).
    const lastWritten = useRef(new Vector3(Number.NaN, 0, 0));
    const lastOffset = useRef(new Vector3());
    const offset = useRef(new Vector3());
    const base = useRef(new Vector3());

    useFrame((_, delta) => {
        const cam = cameraRef.current;
        if (!cam) return;
        const dt = Math.min(delta, 0.05);

        // Fully in effect only once the prelude has handed off. During the
        // prelude the scripted surface-to-dive move is the only thing moving
        // the camera.
        const authority = 1 - preludeSignal.progress;
        // Held at rest under reduced motion, before a shot is composed, and
        // when the frame budget is blown — a camera drifting at a stuttering
        // frame rate is exactly the combination that makes people queasy.
        // The springs still settle back smoothly rather than snapping.
        const still = prefersReducedMotion() || !diveShot.active || frameBudget.degraded;

        // --- Targets ------------------------------------------------------
        // Lean toward the whale, and let go as it leaves frame. The camera
        // moving changes where the whale projects, which is a feedback loop
        // — but a stable one at this gain and damping: half a unit of travel
        // against a frame 15.6 units wide.
        const follow = whaleScreen.valid ? 1 - whaleScreen.edgeFalloff : 0;
        const tLateral = still ? 0 : MathUtils.clamp(whaleScreen.ndcX, -1, 1) * MAX_LATERAL * follow;
        const tVertical = still
            ? 0
            : MathUtils.clamp(whaleScreen.ndcY, -1, 1) * MAX_VERTICAL * follow;

        // Distant shots ease the camera in a little, so the far whale is not
        // simply small. Negative world Z is toward the scene.
        const farness = MathUtils.clamp(-diveShot.stageZ / FARTHEST_STAGE_Z, 0, 1);
        const tDolly = still ? 0 : -farness * MAX_DOLLY;

        step(lateral.current, tLateral, dt);
        step(vertical.current, tVertical, dt);
        step(dolly.current, tDolly, dt);

        offset.current
            .set(lateral.current.value, vertical.current.value, dolly.current.value)
            .multiplyScalar(authority);

        // --- Apply, without accumulating ---------------------------------
        const unchanged = cam.position.distanceToSquared(lastWritten.current) < 1e-12;
        base.current.copy(cam.position);
        if (unchanged) base.current.sub(lastOffset.current);

        cam.position.copy(base.current).add(offset.current);
        lastWritten.current.copy(cam.position);
        lastOffset.current.copy(offset.current);

        // --- Field of view -------------------------------------------------
        // A touch wider for the close pass, so a whale at ~133% fills the
        // frame without clipping. Only reprojected when it really moved: an
        // updateProjectionMatrix every frame for a sub-pixel change is waste.
        const closeness = still ? 0 : MathUtils.clamp(diveShot.stageZ, 0, 1);
        const targetFov = MathUtils.lerp(REST_FOV, CLOSE_FOV, closeness * authority);
        const nextFov = MathUtils.lerp(cam.fov, targetFov, 1 - Math.exp(-1.6 * dt));
        if (Math.abs(nextFov - cam.fov) > 0.01) {
            cam.fov = nextFov;
            cam.updateProjectionMatrix();
        }
    });

    return null;
};

export default CameraDirector;
