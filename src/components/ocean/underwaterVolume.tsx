import { IS_MOBILE } from '../../utils/device';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BlendFunction, Effect, EffectAttribute, ShaderPass } from 'postprocessing';
import {
    BasicDepthPacking,
    Color,
    HalfFloatType,
    LinearFilter,
    ShaderMaterial,
    Uniform,
    WebGLRenderTarget,
} from 'three';
import type { DepthPackingStrategies, IUniform, Texture, WebGLRenderer } from 'three';
import { oceanUniforms } from './oceanUniforms';
import { oceanWater } from './oceanShaders';
import { NOISE3D_GLSL } from './oceanNoise';
import { waterSignal } from '../../animations/waterSignal';
import { prefersReducedMotion } from '../../animations/motionPreference';
import { frameBudget } from '../../animations/frameBudget';

/**
 * The water between the lens and everything in it: shafts of sunlight, and
 * the bubble cloud round broken water.
 *
 * A post-processing pass, because both are VOLUMES and need to know how much
 * water each pixel looks through before it meets something — the whale, the
 * underside of the surface, or nothing. For every pixel that looks out from
 * the water it marches along the view ray from the port to that depth:
 *
 *   SHAFTS. At each step it walks back up the refracted sun direction to the
 *   surface and reads the live caustics there. Light the surface focused into
 *   a bright line is a bright column all the way down, so summing it along
 *   the ray draws real god rays: they come from the actual waves overhead,
 *   move with them (and with the visitor's ripples), converge on the sun in
 *   perspective, are hidden behind the whale and cut off by the surface.
 *   Weighted by a forward-scattering phase, so looking toward the light they
 *   blaze and looking away they are faint, as in water.
 *
 *   BUBBLE CLOUD. Where the foam field's cloud channel says air has been
 *   driven under (round the whale's back as it breaks the surface, under a
 *   splash), the steps also pass through a billowing, sunlit, scattering
 *   volume: bright turquoise-white just under the surface, bluer and
 *   thinner below. It absorbs as well as glows, so the whale fades into it.
 *
 * The canvas is transparent over the page's own painted water, so the
 * result is composited premultiplied: the shafts ADD light (alpha
 * untouched), the cloud covers what is behind it (alpha raised).
 *
 * The march runs at HALF resolution into its own target (both halves are
 * soft, so nothing is lost but three quarters of the cost) and is composited
 * over the frame at full resolution. Only while the sea is in play.
 */

/** Steps per ray, and the fewer taken while the frame budget is blown. The
 *  jitter and the grade's grain hide the difference; the cost is linear. */
const STEPS = IS_MOBILE ? 9 : 16;
const STEPS_DEGRADED = IS_MOBILE ? 6 : 10;
/** The march's resolution, relative to the frame. */
const SCALE = 0.5;

/** Brightness of the shafts. */
const SHAFTS = 0.0027;
/** How thick the bubble cloud is, and how deep it hangs (world units). */
const CLOUD_DENSITY = 0.7;
const CLOUD_DEPTH = 2.1;

const marchVertex = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

/** Writes (light added, transmittance) per pixel. */
const marchFragment = /* glsl */ `
#include <packing>
` + oceanWater + /* glsl */ `
#define MAX_STEPS ${STEPS}
uniform int uSteps;
uniform sampler2D depthBuffer;
uniform sampler2D uNoise3D;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform sampler2D uCausticTex;
uniform float uShafts;
uniform vec3 uShaftColor;
uniform float uCloud;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uMaxDist;

${NOISE3D_GLSL}

// Interleaved gradient noise: offsets each pixel's first step, so the steps
// read as fine grain rather than as bands.
float stepJitter(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

varying vec2 vUv;

void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    vec2 uv = vUv;
#if DEPTH_PACKING == 3201
    float depth = unpackRGBAToDepth(texture2D(depthBuffer, uv));
#else
    float depth = texture2D(depthBuffer, uv).r;
#endif

    vec4 vp = uInvProjection * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 vdir = normalize(vp.xyz / vp.w);
    vec3 dir = normalize(mat3(uCameraWorld) * vdir);
    vec3 eye = uCameraWorld[3].xyz;
    vec3 forward = -normalize(uCameraWorld[2].xyz);

    // Only pixels that look out from the water (see domeClearance).
    float t0 = uDomeRadius / max(dot(dir, forward), 0.05);
    vec3 port = eye + dir * t0;
    if (portClearance(port, eye, normalize(uCameraWorld[0].xyz)) > 0.0) return;

    float sceneT = depth >= 0.99999 ? 1.0e5 : perspectiveDepthToViewZ(depth, cameraNear, cameraFar) / vdir.z;
    float surfT = dir.y > 1.0e-4 ? (uWaterLevel - eye.y) / dir.y : 1.0e5;
    float t1 = min(min(sceneT, surfT), uMaxDist);
    if (t1 <= t0) return;

    float dt = (t1 - t0) / float(uSteps);
    float j = stepJitter(gl_FragCoord.xy);
    vec3 l0 = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
    // Henyey-Greenstein, g 0.55, scaled to ~1 at right angles to the light.
    float g = 0.55;
    float mu = dot(dir, -l0);
    float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 2.1;

    float shafts = 0.0;
    vec3 cloud = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= uSteps) break;
        float t = t0 + (float(i) + j) * dt;
        vec3 p = eye + dir * t;
        float below = uWaterLevel - p.y;
        if (below < 0.0) continue;

        // Up the sun's path to the surface, and the light focused there.
        vec2 q = p.xz - l0.xz * (-below / l0.y);
        vec2 cuv = simUv(q);
        vec2 ce = min(cuv, 1.0 - cuv);
        float inside = smoothstep(0.0, 0.08, min(ce.x, ce.y));
        float c = 1.0;
        // Right under the surface the light has not focused into shafts yet:
        // there the water is the dark underside of the surface, and the
        // shafts only gather a metre or two down.
        float gather = smoothstep(0.3, 2.4, below) * inside;
        if (gather > 0.0) {
            // Blurred: light spreads on its way down, and a soft read keeps
            // the sparse steps from turning the sharp web into grain.
            c = textureLod(uCausticTex, cuv, 2.5 + min(below * 0.12, 2.0)).r;
            // Lost on the way down, and on the way back to the eye.
            shafts += max(c - 1.0, 0.0) * gather * exp(-below * 0.075 - t * 0.06) * T;
        }

        if (uCloud > 0.0 && below < ${(CLOUD_DEPTH * 3).toFixed(2)}) {
            float air = foamAt(p.xz).y;
            if (air > 0.015) {
                float prof = exp(-max(below, 0.0) / ${CLOUD_DEPTH.toFixed(2)});
                // Billows, and the clumps of bubbles within them, in true 3D
                // noise: no direction of its own (see createNoise3D), rising
                // slowly as the bubbles do.
                vec3 np = p + vec3(0.0, -uWaveTime * 0.12, 0.0);
                float n = noise3(uNoise3D, np * 0.55) * 0.65 + noise3(uNoise3D, np * 1.45 + 17.0) * 0.35;
                float billow = smoothstep(0.35, 0.72, n);
                float dens = min(air, 1.4) * prof * billow * uCloud;
                vec3 lit = mix(uCloudShade, uCloudLit, exp(-below * 0.55));
                // Sunlight caught in the bubbles is focused too.
                lit *= 0.75 + 0.5 * min(c, 2.0);
                float a = 1.0 - exp(-dens * dt);
                cloud += T * a * lit;
                T *= 1.0 - a;
                if (T < 0.02) break;
            }
        }
    }
    gl_FragColor = vec4(uShaftColor * shafts * dt * phase * uShafts + cloud, T);
}
`;

/** Lays the march over the frame: the cloud covers, the light adds. */
const compositeFragment = /* glsl */ `
uniform sampler2D uVolume;
uniform float uOn;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    if (uOn < 0.5) {
        outputColor = inputColor;
        return;
    }
    vec4 v = texture2D(uVolume, uv);
    outputColor = vec4(inputColor.rgb * v.a + v.rgb, inputColor.a * v.a + (1.0 - v.a));
}
`;

class UnderwaterVolumeEffect extends Effect {
    readonly march: ShaderMaterial;
    private readonly target: WebGLRenderTarget;
    private readonly pass: ShaderPass;

    constructor() {
        const u = oceanUniforms;
        const shared: Record<string, IUniform> = {
            uWaveA: u.uWaveA,
            uWaveB: u.uWaveB,
            uWaveTime: u.uWaveTime,
            uWaterLevel: u.uWaterLevel,
            uDomeRadius: u.uDomeRadius,
            uPresence: u.uPresence,
            uSimTex: u.uSimTex,
            uFoamTex: u.uFoamTex,
            uNoiseTex: u.uNoiseTex,
            uSimCenter: u.uSimCenter,
            uSimSize: u.uSimSize,
            uSunDir: u.uSunDir,
            uCrashA: u.uCrashA,
            uCrashB: u.uCrashB,
            uCrashK: u.uCrashK,
            uInvProjection: u.uInvProjection,
            uCameraWorld: u.uCameraWorld,
            uCausticTex: u.uCausticTex,
            uNoise3D: u.uNoise3D,
        };
        const target = new WebGLRenderTarget(1, 1, {
            type: HalfFloatType,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            depthBuffer: false,
            stencilBuffer: false,
        });
        target.texture.generateMipmaps = false;

        super('UnderwaterVolume', compositeFragment, {
            // Asked for so the pass hands this effect the depth texture;
            // it is read by the march, not by the composite.
            attributes: EffectAttribute.DEPTH,
            blendFunction: BlendFunction.SRC,
            uniforms: new Map<string, Uniform>([
                ['uVolume', new Uniform(target.texture)],
                ['uOn', new Uniform(0)],
            ]),
        });

        this.target = target;
        this.march = new ShaderMaterial({
            vertexShader: marchVertex,
            fragmentShader: marchFragment,
            defines: { DEPTH_PACKING: BasicDepthPacking },
            uniforms: {
                ...shared,
                depthBuffer: { value: null },
                cameraNear: { value: 0.1 },
                cameraFar: { value: 1000 },
                uShafts: { value: 0 },
                // Sunlight after a few metres of water: red gone first.
                uShaftColor: { value: new Color(0.55, 0.9, 1.0) },
                uCloud: { value: 0 },
                uCloudLit: { value: new Color(0.44, 0.72, 0.8) },
                uCloudShade: { value: new Color(0.05, 0.3, 0.42) },
                uMaxDist: { value: 28 },
                uSteps: { value: STEPS },
            },
            depthTest: false,
            depthWrite: false,
        });
        this.pass = new ShaderPass(this.march);
    }

    override setDepthTexture(depthTexture: Texture, depthPacking: DepthPackingStrategies = BasicDepthPacking) {
        this.march.uniforms.depthBuffer.value = depthTexture;
        if (this.march.defines.DEPTH_PACKING !== depthPacking) {
            this.march.defines.DEPTH_PACKING = depthPacking;
            this.march.needsUpdate = true;
        }
    }

    override setSize(width: number, height: number) {
        this.target.setSize(Math.max(1, Math.ceil(width * SCALE)), Math.max(1, Math.ceil(height * SCALE)));
    }

    /** The clip planes of the camera being rendered, for reading depth. */
    setCameraPlanes(near: number, far: number) {
        this.march.uniforms.cameraNear.value = near;
        this.march.uniforms.cameraFar.value = far;
    }

    override update(renderer: WebGLRenderer) {
        const on = this.march.uniforms.uShafts.value + this.march.uniforms.uCloud.value > 0;
        (this.uniforms.get('uOn') as Uniform).value = on ? 1 : 0;
        if (on) this.pass.render(renderer, null, this.target);
    }

    override dispose() {
        super.dispose();
        this.target.dispose();
        this.march.dispose();
        this.pass.dispose();
    }
}

/** Development switches: ?shafts=0 / ?cloud=0 scale either half. */
const DEV_PARAMS = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
const DEV_SHAFTS = Number(DEV_PARAMS?.get('shafts') ?? 1);
const DEV_CLOUD = Number(DEV_PARAMS?.get('cloud') ?? 1);

/** Mounted inside the EffectComposer, after ambient occlusion. */
export function UnderwaterVolume() {
    const effect = useMemo(() => new UnderwaterVolumeEffect(), []);
    useEffect(() => () => effect.dispose(), [effect]);
    const reduced = useMemo(() => prefersReducedMotion(), []);

    useFrame((state) => {
        const on = waterSignal.active ? oceanUniforms.uPresence.value : 0;
        const m = effect.march.uniforms;
        // Over budget: the shafts stay (they are the cheap half), the cloud
        // goes.
        m.uShafts.value = SHAFTS * on * (reduced ? 0.6 : 1) * DEV_SHAFTS;
        m.uCloud.value = frameBudget.degraded ? 0 : CLOUD_DENSITY * on * DEV_CLOUD;
        m.uSteps.value = frameBudget.degraded ? STEPS_DEGRADED : STEPS;
        effect.setCameraPlanes(state.camera.near, state.camera.far);
    });

    return <primitive object={effect} />;
}
