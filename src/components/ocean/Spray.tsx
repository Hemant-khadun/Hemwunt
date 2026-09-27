import { IS_MOBILE } from '../../utils/device';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    CustomBlending,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    MathUtils,
    OneFactor,
    OneMinusSrcAlphaFactor,
    ShaderMaterial,
    Vector2,
} from 'three';
import type { Mesh, Points } from 'three';
import { whaleBody } from './Ocean';
import { oceanUniforms } from './oceanUniforms';
import { sprayBursts } from './spraySignal';
import { GRAVITY, ambientHeight, crashHeightAt, waterSignal } from '../../animations/waterSignal';
import { prefersReducedMotion } from '../../animations/motionPreference';
import { frameBudget } from '../../animations/frameBudget';

/**
 * Water in the air, and air in the water: the small things that make a whale
 * at the surface read as a photograph rather than a render.
 *
 * DROPLETS. Wherever the body cuts the surface and moves, it throws spray;
 * wherever part of it stands clear of the water, the water it carried up runs
 * off it in streams, heaviest the moment it leaves and draining over a few
 * seconds; and a press on the water throws a crown. Each droplet is drawn as
 * a short streak along its velocity (the blur of a 1/30 s exposure), and each
 * is a tiny lens: backlit by the sun, as this sea is, it blazes far past
 * white, and the bloom turns that into the glitter of a real splash.
 *
 * BUBBLES. The fine bubbles that hang in the water round broken water: shed
 * along the collar where the body meets the surface, under a splash, and
 * wherever spray rains back in. They rise, wobble and are gone at the surface.
 *
 * CPU particles, one draw call each, allocation-free per frame. The foam and
 * the bubble cloud are the other half of this and live on the GPU (the foam
 * field in WaterSimulation, the cloud in underwaterVolume.ts).
 */

const DROPS = IS_MOBILE ? 400 : 1000;
const BUBBLES = IS_MOBILE ? 200 : 600;

/** Spray thrown per second per unit of cut radius, at full effort. */
const SPRAY_RATE = 110;
/** Water running off a part of the body that has just left the sea. */
const DRAIN_RATE = 110;
/** Seconds for a raised fluke to drain. */
const DRAIN_TIME = 3.2;
/** Fine bubbles per second per unit of cut radius. */
const BUBBLE_RATE = 60;
/** Fine bubbles hanging in the sunlit water under the surface, per second:
 *  the specks round the animal in every photograph of one at the surface. */
const DRIFT_RATE = IS_MOBILE ? 30 : 90;
/** Exposure of the streaks, seconds. */
const SHUTTER = 1 / 30;

// --- Shaders ------------------------------------------------------------------

const dropVertex = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData;      // size, fade, seed, kind (0 droplet, 1 sheet)
uniform vec2 uViewport;    // device pixels
uniform float uShutter;
uniform float uTime;
uniform vec3 uSunDir;
varying vec2 vPx;          // along the streak, across it (pixels)
varying float vLen;
varying float vR;
varying float vBright;
varying float vFade;
varying float vKind;

void main() {
    vFade = iData.y;
    vKind = iData.w;
    vec4 c0 = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
    vec4 c1 = projectionMatrix * viewMatrix * vec4(iPos - iVel * uShutter, 1.0);
    if (iData.y <= 0.0 || c0.w < 0.1 || c1.w < 0.1) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    vec2 half_ = uViewport * 0.5;
    vec2 s0 = c0.xy / c0.w * half_;
    vec2 s1 = c1.xy / c1.w * half_;
    vec2 axis = s0 - s1;
    float len = length(axis);
    vec2 dir = len > 1.0e-3 ? axis / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    // World size to pixels. Never thinner than a pixel: a droplet smaller
    // than that still catches the light, it just spreads it (see vR below).
    float rTrue = iData.x * projectionMatrix[1][1] * half_.y / c0.w;
    float r = max(rTrue, 1.1);
    vR = r;
    vLen = len;

    float head = position.x * 0.5 + 0.5;
    vec2 sp = (head > 0.5 ? s0 : s1) + dir * position.x * r + nrm * position.y * r;
    vPx = vec2(mix(-r, len + r, head), position.y * r);
    // Screen-linear: w = 1, so the pixel coordinates above interpolate
    // straight across the quad.
    float z = mix(c1.z / c1.w, c0.z / c0.w, head);
    gl_Position = vec4(sp / half_, z, 1.0);

    // A droplet is a ball lens. Looking toward the sun through one, it
    // blazes; with the sun behind the eye it only shows a small reflection.
    vec3 V = normalize(iPos - cameraPosition);
    float toward = max(dot(V, uSunDir), 0.0);
    float lens = pow(toward, 3.0) * 5.0 + 0.3;
    // It oscillates as it flies, so its highlight flashes on and off.
    float flash = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(uTime * (18.0 + iData.z * 22.0) + iData.z * 61.0), 6.0) * 2.2;
    // A drop smaller than a pixel still glints, but carries less light.
    float sub = sqrt(clamp(rTrue / r, 0.15, 1.0));
    vBright = mix(lens * flash * sub, 0.9, iData.w);
}
`;

const dropFragment = /* glsl */ `
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform float uPresence;
varying vec2 vPx;
varying float vLen;
varying float vR;
varying float vBright;
varying float vFade;
varying float vKind;

void main() {
    float x = clamp(vPx.x, 0.0, vLen);
    float d = length(vec2(vPx.x - x, vPx.y)) / vR;
    // A droplet has a hard, bright core; a sheet of water is soft.
    float shape = vKind < 0.5
        ? 1.0 - smoothstep(0.35, 1.0, d)
        : (1.0 - smoothstep(0.0, 1.0, d)) * 0.5;
    if (shape <= 0.0) discard;
    // The same light spread along the streak: a fast drop is a fainter line.
    float energy = pow(vR / (vLen + vR), 0.6);
    vec3 light = mix(uSky, uSunColor, 0.65) * vBright;
    float a = shape * energy * vFade * uPresence;
    gl_FragColor = vec4(light * a, a * (vKind < 0.5 ? 0.35 : 0.55));
}
`;

const bubbleVertex = /* glsl */ `
attribute float aLife;
attribute float aSize;
uniform float uScale;
uniform float uLevel;
varying float vLife;
varying float vLit;
varying float vCover;

void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = aSize * uScale / max(0.001, -mv.z);
    // Below a couple of pixels a bubble is a speck of light: keep it that
    // size and dim it by what it lost, rather than letting it vanish.
    vCover = clamp(px / 3.0, 0.15, 1.0);
    gl_PointSize = max(px, 3.0) * step(0.0001, aLife);
    // Brighter near the surface, where the light is.
    vLit = exp(-max(uLevel - position.y, 0.0) * 0.45);
    gl_Position = projectionMatrix * mv;
}
`;

const bubbleFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vLife;
varying float vLit;
varying float vCover;

void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    // Read by the rim and a glint, as in BubbleWake.
    float rim = smoothstep(0.6, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
    float body = (1.0 - r) * 0.25;
    float glint = 1.0 - smoothstep(0.0, 0.3, length(p - vec2(-0.3, 0.35)));
    // Life runs 1 -> 0: in over the first moment, out over the last fifth.
    float fade = (1.0 - smoothstep(0.93, 1.0, vLife)) * smoothstep(0.0, 0.2, vLife);
    float a = (rim + body + glint * 0.9) * fade * uOpacity * vCover * (0.35 + 0.9 * vLit);
    // Sunlit, a bubble is a tiny mirror: far brighter than white, so the
    // bloom gives each its halo.
    gl_FragColor = vec4(uColor * a * (1.2 + 3.5 * vLit), a);
}
`;

// --- The component --------------------------------------------------------------

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const Spray = () => {
    const enabled = useMemo(() => !prefersReducedMotion(), []);
    const dropMesh = useRef<Mesh>(null);
    const bubblePoints = useRef<Points>(null);

    const drops = useMemo(() => {
        const geometry = new InstancedBufferGeometry();
        // One quad, x along the streak, y across it.
        geometry.setAttribute(
            'position',
            new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
        );
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        const pos = new Float32Array(DROPS * 3);
        const vel = new Float32Array(DROPS * 3);
        const data = new Float32Array(DROPS * 4);
        geometry.setAttribute('iPos', new InstancedBufferAttribute(pos, 3));
        geometry.setAttribute('iVel', new InstancedBufferAttribute(vel, 3));
        geometry.setAttribute('iData', new InstancedBufferAttribute(data, 4));
        geometry.instanceCount = DROPS;
        return {
            geometry,
            pos,
            vel,
            data,
            age: new Float32Array(DROPS),
            maxAge: new Float32Array(DROPS),
            alive: new Uint8Array(DROPS),
            cursor: 0,
            uploaded: true,
        };
    }, []);

    const bubbles = useMemo(() => {
        const geometry = new BufferGeometry();
        const pos = new Float32Array(BUBBLES * 3);
        const life = new Float32Array(BUBBLES);
        const size = new Float32Array(BUBBLES);
        geometry.setAttribute('position', new BufferAttribute(pos, 3));
        geometry.setAttribute('aLife', new BufferAttribute(life, 1));
        geometry.setAttribute('aSize', new BufferAttribute(size, 1));
        return {
            geometry,
            pos,
            life,
            size,
            vel: new Float32Array(BUBBLES * 3),
            rate: new Float32Array(BUBBLES),
            phase: new Float32Array(BUBBLES),
            cursor: 0,
            uploaded: true,
        };
    }, []);

    useEffect(
        () => () => {
            drops.geometry.dispose();
            bubbles.geometry.dispose();
        },
        [drops, bubbles],
    );

    const dropMaterial = useMemo(
        () =>
            new ShaderMaterial({
                vertexShader: dropVertex,
                fragmentShader: dropFragment,
                uniforms: {
                    uViewport: { value: new Vector2(1, 1) },
                    uShutter: { value: SHUTTER },
                    uTime: { value: 0 },
                    uSunDir: oceanUniforms.uSunDir,
                    uSunColor: oceanUniforms.uSunColor,
                    uSky: { value: new Color(0.62, 0.8, 0.95) },
                    uPresence: oceanUniforms.uPresence,
                },
                transparent: true,
                depthWrite: false,
                // Premultiplied: each droplet adds its light and covers a
                // little of what is behind it.
                blending: CustomBlending,
                blendSrc: OneFactor,
                blendDst: OneMinusSrcAlphaFactor,
            }),
        [],
    );
    const bubbleMaterial = useMemo(
        () =>
            new ShaderMaterial({
                vertexShader: bubbleVertex,
                fragmentShader: bubbleFragment,
                uniforms: {
                    uScale: { value: 300 },
                    uLevel: oceanUniforms.uWaterLevel,
                    uColor: { value: new Color('#dff6ff') },
                    uOpacity: { value: 0.9 },
                },
                transparent: true,
                depthWrite: false,
                blending: AdditiveBlending,
            }),
        [],
    );
    useEffect(
        () => () => {
            dropMaterial.dispose();
            bubbleMaterial.dispose();
        },
        [dropMaterial, bubbleMaterial],
    );

    // Per-sphere state: how wet it still is, emission carry-over, and the
    // few points water is streaming off it (held a moment, so the drips form
    // streams rather than a random drizzle).
    const body = useMemo(
        () => ({
            wet: new Float32Array(8),
            sprayCarry: new Float32Array(8),
            drainCarry: new Float32Array(8),
            bubbleCarry: new Float32Array(8),
            streams: new Float32Array(8 * 3 * 3),
            streamAge: new Float32Array(8).fill(99),
            drift: 0,
        }),
        [],
    );

    const surfaceAt = (x: number, z: number) =>
        waterSignal.level + ambientHeight(x, z, waterSignal.time) + crashHeightAt(x, z);
    /** Good enough to tell whether a particle is in or out of the water:
     *  the four longest waves, run for every particle every frame. */
    const roughSurfaceAt = (x: number, z: number) =>
        waterSignal.level + ambientHeight(x, z, waterSignal.time, 4) + crashHeightAt(x, z);

    const spawnDrop = (
        x: number,
        y: number,
        z: number,
        vx: number,
        vy: number,
        vz: number,
        size: number,
        kind: number,
        maxAge: number,
    ) => {
        const i = drops.cursor;
        drops.cursor = (drops.cursor + 1) % DROPS;
        drops.pos.set([x, y, z], i * 3);
        drops.vel.set([vx, vy, vz], i * 3);
        drops.data.set([size, 1, Math.random(), kind], i * 4);
        drops.age[i] = 0;
        drops.maxAge[i] = maxAge;
        drops.alive[i] = 1;
    };

    const spawnBubble = (x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number) => {
        const i = bubbles.cursor;
        bubbles.cursor = (bubbles.cursor + 1) % BUBBLES;
        bubbles.pos.set([x, y, z], i * 3);
        bubbles.vel.set([vx, vy, vz], i * 3);
        bubbles.life[i] = 1;
        bubbles.rate[i] = 1 / rand(1.4, 4);
        bubbles.size[i] = size;
        bubbles.phase[i] = Math.random() * Math.PI * 2;
    };

    /** Mostly droplets, some sheets of water that break up within a blink. */
    const throwWater = (x: number, y: number, z: number, vx: number, vy: number, vz: number) => {
        if (Math.random() < 0.12) {
            spawnDrop(x, y, z, vx * 0.6, vy * 0.5, vz * 0.6, rand(0.12, 0.32), 1, rand(0.25, 0.6));
        } else {
            spawnDrop(x, y, z, vx, vy, vz, 0.006 + Math.pow(Math.random(), 3) * 0.04, 0, 3);
        }
    };

    useFrame((state, delta) => {
        const on = enabled && waterSignal.active && waterSignal.presence > 0.01;
        if (dropMesh.current) dropMesh.current.visible = on;
        if (bubblePoints.current) bubblePoints.current.visible = on;
        if (!on) {
            sprayBursts.length = 0;
            return;
        }
        const dt = Math.min(delta, 0.05);
        const dpr = state.viewport.dpr;
        dropMaterial.uniforms.uViewport.value.set(state.size.width * dpr, state.size.height * dpr);
        dropMaterial.uniforms.uTime.value = state.clock.elapsedTime;
        const cam = state.camera as { fov?: number };
        bubbleMaterial.uniforms.uScale.value =
            (state.size.height * dpr * 0.5) / Math.tan(MathUtils.degToRad(cam.fov ?? 80) / 2);
        // Over budget: nothing new is thrown; what is in the air still lands.
        const emit = frameBudget.degraded ? 0 : 1;

        // --- Splashes from the visitor ---------------------------------
        while (sprayBursts.length > 0) {
            const b = sprayBursts.shift()!;
            if (!emit) continue;
            const surf = surfaceAt(b.x, b.z);
            const n = Math.round(160 * b.strength);
            for (let k = 0; k < n; k++) {
                const a = Math.random() * Math.PI * 2;
                const out = rand(0.3, 2.0);
                const up = rand(1.5, 5.5) * b.strength;
                const r0 = rand(0.1, 0.5);
                throwWater(
                    b.x + Math.cos(a) * r0,
                    surf + 0.02,
                    b.z + Math.sin(a) * r0,
                    Math.cos(a) * out,
                    up,
                    Math.sin(a) * out,
                );
            }
            for (let k = 0; k < 90 * b.strength; k++) {
                const a = Math.random() * Math.PI * 2;
                const r0 = Math.sqrt(Math.random()) * 0.7;
                spawnBubble(
                    b.x + Math.cos(a) * r0,
                    surf - Math.pow(Math.random(), 1.6) * 1.3,
                    b.z + Math.sin(a) * r0,
                    rand(-0.2, 0.2),
                    rand(0.1, 0.5),
                    rand(-0.2, 0.2),
                    0.008 + Math.pow(Math.random(), 3) * 0.05,
                );
            }
        }

        // --- The whale -------------------------------------------------
        const w = whaleBody.world;
        const v = whaleBody.velocity;
        for (let i = 0; i < whaleBody.count; i++) {
            const x = w[i * 4];
            const y = w[i * 4 + 1];
            const z = w[i * 4 + 2];
            const r = w[i * 4 + 3];
            const vx = v[i * 4];
            const vy = v[i * 4 + 1];
            const vz = v[i * 4 + 2];
            const speed = v[i * 4 + 3];
            const surf = surfaceAt(x, z);
            const rel = y - surf;

            // Wet while mostly under; drains once out. A part standing in the
            // surface, or just clear of it, never quite dries: the waves keep
            // washing over it.
            if (rel < -r * 0.3) body.wet[i] = 1;
            else body.wet[i] = Math.max(rel - r < 0.6 ? 0.6 : 0, body.wet[i] - dt / DRAIN_TIME);

            if (Math.abs(rel) < r) {
                const rho = Math.sqrt(r * r - rel * rel);
                const effort = MathUtils.smoothstep(speed, 0.5, 3.5);

                // Spray: the body driving through the surface throws water
                // up and out, carrying some of the body's own motion.
                body.sprayCarry[i] += SPRAY_RATE * rho * effort * emit * dt;
                while (body.sprayCarry[i] >= 1) {
                    body.sprayCarry[i] -= 1;
                    const a = Math.random() * Math.PI * 2;
                    const ring = rho * rand(0.85, 1.12);
                    const out = rand(0.3, 1.8);
                    const carry = rand(0.25, 0.75);
                    const up = rand(1.0, 3.6) * (0.45 + effort);
                    throwWater(
                        x + Math.cos(a) * ring,
                        surf + 0.03,
                        z + Math.sin(a) * ring,
                        vx * carry + Math.cos(a) * out,
                        Math.max(vy, 0) * carry + up,
                        vz * carry + Math.sin(a) * out,
                    );
                }

                // Fine bubbles churned in along the collar, more when moving.
                body.bubbleCarry[i] += BUBBLE_RATE * rho * (0.15 + effort) * emit * dt;
                while (body.bubbleCarry[i] >= 1) {
                    body.bubbleCarry[i] -= 1;
                    const a = Math.random() * Math.PI * 2;
                    const ring = rho * rand(0.8, 1.35);
                    spawnBubble(
                        x + Math.cos(a) * ring,
                        surf - Math.pow(Math.random(), 1.8) * (0.4 + 1.6 * effort),
                        z + Math.sin(a) * ring,
                        vx * 0.15 + rand(-0.1, 0.1),
                        rand(0.1, 0.45),
                        vz * 0.15 + rand(-0.1, 0.1),
                        0.006 + Math.pow(Math.random(), 3) * 0.04,
                    );
                }
            }

            // Fine bubbles off a body moving just under the surface, too.
            if (rel < -r && rel > -r * 2.5) {
                const effort = MathUtils.smoothstep(speed, 0.6, 3.5);
                body.bubbleCarry[i] += BUBBLE_RATE * 0.5 * r * effort * emit * dt;
                while (body.bubbleCarry[i] >= 1) {
                    body.bubbleCarry[i] -= 1;
                    const a = Math.random() * Math.PI * 2;
                    const phi = Math.acos(rand(-1, 1));
                    spawnBubble(
                        x + Math.cos(a) * Math.sin(phi) * r * 1.05,
                        y + Math.cos(phi) * r * 1.05,
                        z + Math.sin(a) * Math.sin(phi) * r * 1.05,
                        vx * 0.2 + rand(-0.1, 0.1),
                        rand(0.1, 0.4),
                        vz * 0.2 + rand(-0.1, 0.1),
                        0.006 + Math.pow(Math.random(), 3) * 0.03,
                    );
                }
            }

            // Draining: water pouring off whatever part stands clear.
            const exposed = MathUtils.clamp((rel + r) / (2 * r), 0, 1);
            if (exposed > 0.05 && body.wet[i] > 0.01) {
                // Re-pick the stream points now and then.
                body.streamAge[i] += dt;
                if (body.streamAge[i] > 0.7) {
                    body.streamAge[i] = 0;
                    for (let s = 0; s < 3; s++) {
                        const a = Math.random() * Math.PI * 2;
                        const rr = Math.sqrt(Math.random()) * r * 0.85;
                        body.streams.set([Math.cos(a) * rr, Math.sin(a) * rr, rand(0.4, 1)], (i * 3 + s) * 3);
                    }
                }
                body.drainCarry[i] += DRAIN_RATE * body.wet[i] * body.wet[i] * r * exposed * emit * dt;
                while (body.drainCarry[i] >= 1) {
                    body.drainCarry[i] -= 1;
                    const s = (i * 3 + Math.floor(Math.random() * 3)) * 3;
                    const ox = body.streams[s] + rand(-0.04, 0.04);
                    const oz = body.streams[s + 1] + rand(-0.04, 0.04);
                    // Anywhere down the exposed part, the way water runs off
                    // a raised fluke along its whole edge, but never from
                    // under the water.
                    const half = Math.sqrt(Math.max(r * r - ox * ox - oz * oz, 0)) * 0.85;
                    const sy = y + rand(-half, half);
                    if (sy < surf + 0.15) continue;
                    spawnDrop(
                        x + ox,
                        sy,
                        z + oz,
                        vx * 0.9 + rand(-0.08, 0.08),
                        vy * 0.9 - rand(0, 0.3),
                        vz * 0.9 + rand(-0.08, 0.08),
                        0.012 + Math.pow(Math.random(), 2) * 0.04 * body.streams[s + 2],
                        0,
                        3,
                    );
                }
            }
        }

        // --- Bubbles hanging in the light --------------------------------
        // Mostly round the animal where it is near the surface, some anywhere
        // in the frame's top few metres of water.
        body.drift += DRIFT_RATE * emit * dt;
        while (body.drift >= 1) {
            body.drift -= 1;
            let bx: number;
            let bz: number;
            const k = whaleBody.count > 0 ? Math.floor(Math.random() * whaleBody.count) : -1;
            const near = k >= 0 && w[k * 4 + 1] > waterSignal.level - 6 && Math.random() < 0.6;
            if (near) {
                const a = Math.random() * Math.PI * 2;
                const rr = w[k * 4 + 3] * rand(0.8, 3.5);
                bx = w[k * 4] + Math.cos(a) * rr;
                bz = w[k * 4 + 2] + Math.sin(a) * rr;
            } else {
                bx = rand(-14, 14);
                bz = rand(-16, 7);
            }
            spawnBubble(
                bx,
                surfaceAt(bx, bz) - 0.1 - Math.pow(Math.random(), 1.8) * 4,
                bz,
                rand(-0.05, 0.05),
                rand(0.02, 0.15),
                rand(-0.05, 0.05),
                0.005 + Math.pow(Math.random(), 4) * 0.025,
            );
        }

        // --- Integrate the droplets -------------------------------------
        const dragDrop = Math.exp(-0.35 * dt);
        const dragSheet = Math.exp(-3 * dt);
        let dropsLive = 0;
        for (let i = 0; i < DROPS; i++) {
            if (!drops.alive[i]) continue;
            dropsLive++;
            const i3 = i * 3;
            const sheet = drops.data[i * 4 + 3] > 0.5;
            const drag = sheet ? dragSheet : dragDrop;
            drops.vel[i3 + 1] -= GRAVITY * (sheet ? 0.5 : 1) * dt;
            drops.vel[i3] *= drag;
            drops.vel[i3 + 1] *= drag;
            drops.vel[i3 + 2] *= drag;
            drops.pos[i3] += drops.vel[i3] * dt;
            drops.pos[i3 + 1] += drops.vel[i3 + 1] * dt;
            drops.pos[i3 + 2] += drops.vel[i3 + 2] * dt;
            drops.age[i] += dt;
            const age = drops.age[i];
            const max = drops.maxAge[i];
            if (sheet) {
                // A sheet spreads and thins out.
                drops.data[i * 4] *= 1 + dt * 1.2;
                drops.data[i * 4 + 1] = 1 - age / max;
            } else {
                drops.data[i * 4 + 1] = Math.min(1, age / 0.04) * Math.min(1, (max - age) / 0.2);
            }
            const x = drops.pos[i3];
            const z = drops.pos[i3 + 2];
            const back = drops.vel[i3 + 1] < 0 && drops.pos[i3 + 1] < roughSurfaceAt(x, z);
            if (back || age >= max) {
                drops.alive[i] = 0;
                drops.data[i * 4 + 1] = 0;
                // A drop falling back in takes a little air with it.
                if (back && !sheet && emit && Math.random() < 0.3) {
                    spawnBubble(x, drops.pos[i3 + 1] - 0.05, z, 0, rand(0.05, 0.3), 0, rand(0.006, 0.018));
                }
            }
        }
        // Nothing in the air: no upload, no draw.
        if (dropsLive > 0 || drops.uploaded) {
            (drops.geometry.attributes.iPos as InstancedBufferAttribute).needsUpdate = true;
            (drops.geometry.attributes.iVel as InstancedBufferAttribute).needsUpdate = true;
            (drops.geometry.attributes.iData as InstancedBufferAttribute).needsUpdate = true;
        }
        drops.uploaded = dropsLive > 0;
        if (dropMesh.current) dropMesh.current.visible = dropsLive > 0;

        // --- Integrate the bubbles --------------------------------------
        const t = state.clock.elapsedTime;
        const dragBubble = Math.exp(-2 * dt);
        let bubblesLive = 0;
        for (let i = 0; i < BUBBLES; i++) {
            if (bubbles.life[i] <= 0) continue;
            bubblesLive++;
            const i3 = i * 3;
            bubbles.vel[i3 + 1] += (0.5 + bubbles.size[i] * 14) * dt;
            bubbles.vel[i3] *= dragBubble;
            bubbles.vel[i3 + 1] *= dragBubble;
            bubbles.vel[i3 + 2] *= dragBubble;
            const wobble = Math.sin(t * 8 + bubbles.phase[i]) * 0.08;
            bubbles.pos[i3] += (bubbles.vel[i3] + wobble) * dt;
            bubbles.pos[i3 + 1] += bubbles.vel[i3 + 1] * dt;
            bubbles.pos[i3 + 2] += bubbles.vel[i3 + 2] * dt;
            bubbles.life[i] -= bubbles.rate[i] * dt;
            if (bubbles.pos[i3 + 1] > roughSurfaceAt(bubbles.pos[i3], bubbles.pos[i3 + 2]) || bubbles.life[i] < 0) {
                bubbles.life[i] = 0;
            }
        }
        if (bubblesLive > 0 || bubbles.uploaded) {
            (bubbles.geometry.attributes.position as BufferAttribute).needsUpdate = true;
            (bubbles.geometry.attributes.aLife as BufferAttribute).needsUpdate = true;
            (bubbles.geometry.attributes.aSize as BufferAttribute).needsUpdate = true;
        }
        bubbles.uploaded = bubblesLive > 0;
        if (bubblePoints.current) bubblePoints.current.visible = bubblesLive > 0;

        if (import.meta.env.DEV) {
            let d = 0;
            for (let i = 0; i < DROPS; i++) d += drops.alive[i];
            let b = 0;
            for (let i = 0; i < BUBBLES; i++) if (bubbles.life[i] > 0) b++;
            (window as unknown as Record<string, unknown>).__sprayDebug = { drops: d, bubbles: b, visible: dropMesh.current?.visible };
        }
    });

    if (!enabled) return null;

    return (
        <>
            <mesh
                ref={dropMesh}
                geometry={drops.geometry}
                material={dropMaterial}
                frustumCulled={false}
                renderOrder={3}
            />
            <points
                ref={bubblePoints}
                geometry={bubbles.geometry}
                material={bubbleMaterial}
                frustumCulled={false}
                renderOrder={2}
            />
        </>
    );
};

export default Spray;
