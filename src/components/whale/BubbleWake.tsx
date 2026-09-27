import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    MathUtils,
    Vector3,
} from 'three';
import type { Object3D, Points, ShaderMaterial } from 'three';
import { depthSignal } from '../../animations/depthSignal';
import { prefersReducedMotion } from '../../animations/motionPreference';
import { frameBudget } from '../../animations/frameBudget';
import { waterSignal } from '../../animations/waterSignal';
import whaleModelUrl from '../../assets/models/humpback_whale.glb?url';

/**
 * Bubbles shed off the fluke.
 *
 * In a finished underwater frame of a humpback near the surface, the tail
 * trails a ragged stream of bubbles — air entrained by the stroke. It is the
 * one visible trace of the WATER responding to the animal, and it is what this
 * page's earlier wake idea (rippling the portfolio screenshots) was reaching
 * for without being able to afford it.
 *
 * EMISSION IS DRIVEN BY THE FLUKE ITSELF, not by the animator's numbers. The
 * tip bone's world velocity is measured frame to frame, so bubbles come off
 * exactly when and where the tail is actually moving fast: on the power
 * stroke, harder during a burst, not at all on a glide. That also means this
 * needs nothing threaded through from the animator.
 *
 * The bone is `Bone.004_end_018` (three sanitises the name to
 * `Bone004_end_018`): the tip of the longest chain in the skeleton, and the
 * chain with by far the largest swing in the baked swim clip — 44 degrees at
 * its base, against ~30 for the pectoral chains and under 3 for the head.
 *
 * DEPTH. Bubbles belong near the surface, where the air is; four kilometres
 * down a fluke does not trail them. Emission falls to a faint floor with depth
 * rather than to zero, so the close pass still leaves a whisper of wake.
 *
 * Budget: 150 points, one draw call, allocation-free per frame.
 */

const COUNT = 150;
/** Particles per second at a hard stroke, near the surface. */
const MAX_RATE = 70;
/** Tip speed (world units/s) at which shedding starts, and where it maxes. */
const SHED_START = 0.8;
const SHED_FULL = 3.2;
/** Emission left over in the deep, as a fraction of the surface rate. */
const DEEP_FLOOR = 0.18;

const TIP_BONE = 'Bone004_end_018';

const vertexShader = /* glsl */ `
attribute float aLife;
attribute float aSize;
uniform float uScale;
varying float vLife;

void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // World-sized, so near bubbles are larger than far ones. A dead particle
    // has life 0 and collapses to nothing rather than needing a draw range.
    gl_PointSize = aSize * uScale / max(0.001, -mv.z) * step(0.0001, aLife);
    gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vLife;

void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    // A bubble is read by its rim, not its body: a thin bright edge where
    // light refracts round it, a faint interior, and a small highlight up and
    // to the side. A filled soft dot reads as snow, not air.
    float rim = smoothstep(0.62, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
    float body = (1.0 - r) * 0.18;
    float glint = 1.0 - smoothstep(0.0, 0.28, length(p - vec2(-0.32, 0.36)));

    // Fade in quickly, out slowly, so bubbles do not pop into existence.
    float fade = smoothstep(0.0, 0.12, vLife) * smoothstep(1.0, 0.55, 1.0 - vLife);
    float a = (rim + body + glint * 0.6) * fade * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
}
`;

const BUBBLE_WHITE = new Color('#e6f6fb');

const BubbleWake = () => {
    const { nodes } = useGLTF(whaleModelUrl);
    const tip = nodes[TIP_BONE] as Object3D | undefined;

    const points = useRef<Points>(null);
    const material = useRef<ShaderMaterial>(null);

    // Decided once at mount. A reduced-motion visitor never pays for this at
    // all — nothing is emitted, and the object is hidden. Phones have it too
    // now: 150 points in one draw call was never what a phone struggled with,
    // and the frame budget stops the emission if the frame does run long.
    const enabled = useMemo(() => !prefersReducedMotion(), []);

    // --- Simulation state, allocated once ------------------------------
    const sim = useMemo(() => {
        const positions = new Float32Array(COUNT * 3);
        const velocities = new Float32Array(COUNT * 3);
        const life = new Float32Array(COUNT); // 1 at birth -> 0 dead
        const lifeRate = new Float32Array(COUNT); // 1 / lifetime
        const size = new Float32Array(COUNT);
        const phase = new Float32Array(COUNT);

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(positions, 3));
        geometry.setAttribute('aLife', new BufferAttribute(life, 1));
        geometry.setAttribute('aSize', new BufferAttribute(size, 1));

        return { positions, velocities, life, lifeRate, size, phase, geometry, cursor: 0, carry: 0 };
    }, []);

    useEffect(() => () => sim.geometry.dispose(), [sim]);

    const uniforms = useMemo(
        () => ({
            uScale: { value: 300 },
            uColor: { value: BUBBLE_WHITE.clone() },
            uOpacity: { value: 0.85 },
        }),
        [],
    );

    const tipPos = useRef(new Vector3());
    const tipPrev = useRef(new Vector3(Number.NaN, 0, 0));
    const tipVel = useRef(new Vector3());

    useFrame((state, delta) => {
        const mat = material.current;
        if (!enabled || !tip || !mat) return;
        const dt = Math.min(delta, 0.05);

        // Screen-space size factor: half the drawing-buffer height over
        // tan(fov/2), so aSize is in world units at any resolution or DPR.
        const cam = state.camera as { fov?: number };
        const fov = MathUtils.degToRad(cam.fov ?? 80);
        uniforms.uScale.value = (state.size.height * state.viewport.dpr * 0.5) / Math.tan(fov / 2);
        uniforms.uColor.value.copy(BUBBLE_WHITE).lerp(depthSignal.ocean.waterNear, 0.25);

        // --- Measure the fluke -------------------------------------------
        tip.getWorldPosition(tipPos.current);
        if (Number.isNaN(tipPrev.current.x)) tipPrev.current.copy(tipPos.current);
        tipVel.current.subVectors(tipPos.current, tipPrev.current).divideScalar(Math.max(dt, 1e-4));
        tipPrev.current.copy(tipPos.current);
        const tipSpeed = tipVel.current.length();

        // A multi-unit jump in one frame is the reveal's swim-in from far
        // behind, or a tab refocus — not a stroke. Never emit on it.
        const plausible = tipSpeed < 12;

        const stroke = MathUtils.smoothstep(tipSpeed, SHED_START, SHED_FULL);
        const shallow = MathUtils.lerp(
            1,
            DEEP_FLOOR,
            MathUtils.smoothstep(depthSignal.depth, 0.1, 0.6),
        );
        // No bubbles above the waterline, and none before the whale has
        // arrived out of the dark.
        const submerged = tipPos.current.y < waterSignal.level - 0.1 ? 1 : 0;
        // Over frame budget: stop shedding. Bubbles already in the water
        // still rise and finish, so the wake thins out rather than vanishing.
        const rate =
            plausible && !frameBudget.degraded
                ? MAX_RATE * stroke * shallow * submerged * depthSignal.reveal
                : 0;

        // --- Emit ---------------------------------------------------------
        sim.carry += rate * dt;
        while (sim.carry >= 1) {
            sim.carry -= 1;
            const i = sim.cursor;
            sim.cursor = (sim.cursor + 1) % COUNT;
            const i3 = i * 3;

            sim.positions[i3] = tipPos.current.x + (Math.random() - 0.5) * 0.12;
            sim.positions[i3 + 1] = tipPos.current.y + (Math.random() - 0.5) * 0.12;
            sim.positions[i3 + 2] = tipPos.current.z + (Math.random() - 0.5) * 0.12;

            // Entrained: bubbles leave carrying a little of the stroke's
            // motion, then buoyancy takes over.
            sim.velocities[i3] = tipVel.current.x * 0.12 + (Math.random() - 0.5) * 0.2;
            sim.velocities[i3 + 1] = tipVel.current.y * 0.12 + 0.2 + Math.random() * 0.2;
            sim.velocities[i3 + 2] = tipVel.current.z * 0.12 + (Math.random() - 0.5) * 0.2;

            sim.life[i] = 1;
            sim.lifeRate[i] = 1 / (1.2 + Math.random() * 1.4);
            // Mostly small, occasionally a larger bubble, the way a real
            // stream breaks up.
            sim.size[i] = 0.018 + Math.pow(Math.random(), 3) * 0.05;
            sim.phase[i] = Math.random() * Math.PI * 2;
        }

        // --- Integrate ----------------------------------------------------
        const t = state.clock.elapsedTime;
        const drag = Math.exp(-1.8 * dt);
        let alive = false;

        for (let i = 0; i < COUNT; i++) {
            if (sim.life[i] <= 0) continue;
            alive = true;
            const i3 = i * 3;

            // Buoyancy, water drag, and the side-to-side wobble every rising
            // bubble has. Bigger bubbles rise faster.
            sim.velocities[i3 + 1] += (0.55 + sim.size[i] * 12) * dt;
            sim.velocities[i3] *= drag;
            sim.velocities[i3 + 1] *= drag;
            sim.velocities[i3 + 2] *= drag;

            const wobble = Math.sin(t * 7 + sim.phase[i]) * 0.12;
            sim.positions[i3] += (sim.velocities[i3] + wobble) * dt;
            sim.positions[i3 + 1] += sim.velocities[i3 + 1] * dt;
            sim.positions[i3 + 2] += sim.velocities[i3 + 2] * dt;

            sim.life[i] -= sim.lifeRate[i] * dt;
            // A bubble reaching the surface is gone.
            if (sim.positions[i3 + 1] > waterSignal.level || sim.life[i] < 0) sim.life[i] = 0;
        }

        const geo = sim.geometry;
        (geo.attributes.position as BufferAttribute).needsUpdate = true;
        (geo.attributes.aLife as BufferAttribute).needsUpdate = true;
        (geo.attributes.aSize as BufferAttribute).needsUpdate = true;

        if (points.current) points.current.visible = alive;
    });

    if (!enabled) return null;

    return (
        // World space, at the scene root — NOT inside the whale's group, or
        // every bubble already shed would be dragged along with the animal.
        <points ref={points} geometry={sim.geometry} frustumCulled={false} visible={false}>
            <shaderMaterial
                ref={material}
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={uniforms}
                transparent
                depthWrite={false}
                blending={AdditiveBlending}
            />
        </points>
    );
};

export default BubbleWake;
