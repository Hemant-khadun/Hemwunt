import { Color, Material } from 'three';
import type { IUniform } from 'three';

/**
 * Depth grading applied INSIDE the whale's body.
 *
 * Put a raw render of a whale beside the same model finished for an underwater
 * shot and three things separate them, all of which this file is responsible
 * for:
 *
 *   1. A VERTICAL gradient through the animal. The back catches what is left
 *      of the surface light; the belly and fluke are swallowed by the water
 *      below. No arrangement of lights reproduces this, because it is not a
 *      lighting effect — it is metres of water between the eye and the lower
 *      half of the subject.
 *
 *   2. Contrast that falls away with DISTANCE FROM THE CAMERA. A near head is
 *      crisp, every tubercle readable; a whale a few body-lengths behind it is
 *      a soft, low-contrast blue shape. This is scattering, and it is the
 *      part a plain gradient misses — it is what sells a whale as far away
 *      rather than merely small.
 *
 *   3. Nothing left neutral. Every value, including the blacks, is pulled
 *      into the colour of the water.
 *
 * So three terms, injected into the standard material:
 *
 *   bodyT       — where this fragment sits on the animal, top to bottom.
 *   uSceneDepth — how deep the page has gone; moves the whole animal down.
 *   scatterT    — how far this fragment is from the camera.
 *
 * SKINNING. World and view positions are taken AFTER the skin deforms, which
 * is why the injection hooks `<skinning_vertex>` rather than reading
 * `position`. Read the raw attribute and you grade the whale in bind pose, so
 * the gradient stays welded to the rest shape and the animal visibly swims
 * through its own shading.
 */
export interface WhaleDepthUniforms {
    /** The whale's own world Y, so the body gradient travels with it. */
    uWhaleY: IUniform<number>;
    /** World units from back to belly over which the body gradient runs. */
    uBodyFalloff: IUniform<number>;
    /** Page depth, 0 surface .. 1 abyss. */
    uSceneDepth: IUniform<number>;
    /** Water above / nearer the light. */
    uWaterNear: IUniform<Color>;
    /** Water below / further from it. */
    uWaterFar: IUniform<Color>;
    /** How far the body blends into the water. Driven by the ocean table. */
    uWaterBlend: IUniform<number>;
    /** View distance at which scattering begins. Inside this the whale is
     *  crisp — the close pass has to keep every detail. */
    uScatterStart: IUniform<number>;
    /** View distance at which scattering reaches its maximum. */
    uScatterEnd: IUniform<number>;
    /** Ceiling on the scatter blend, so even the farthest whale keeps a shape. */
    uScatterMax: IUniform<number>;
    /** Strength of the sunlit-top highlight, 0..1. Tracks the sun's own
     *  falloff (see WhaleModel), so the glow and the light rig always agree
     *  about how much surface light is left to catch. */
    uTopGlow: IUniform<number>;
}

/** Per-channel survival through water. Red goes first, then green: this
 *  ordering is the entire reason deep water is blue. */
const ABSORPTION = 'vec3(0.12, 0.42, 0.78)';

const VERTEX_HOOK = '#include <skinning_vertex>';
const VERTEX_INJECT = /* glsl */ `
#include <skinning_vertex>
// AFTER skinning: "transformed" is the deformed vertex, so the gradient is
// fixed in the world and the whale swims through it rather than carrying it.
vWhaleWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
vWhaleViewDist = length((modelViewMatrix * vec4(transformed, 1.0)).xyz);
`;

/** r152 renamed this chunk; support both so a three bump does not go dark. */
const FRAGMENT_HOOKS = ['#include <opaque_fragment>', '#include <output_fragment>'];

const fragmentInject = (hook: string) => /* glsl */ `
${hook}

// --- Depth grading ------------------------------------------------------
// Runs in linear space, before tonemapping, because absorption and
// scattering are physical processes, not a look laid over a finished image.
{
    // 1. Where this fragment sits on the animal. 0 at the back, 1 at the belly.
    float local = vWhaleWorldY - uWhaleY;
    float bodyT = clamp(0.5 - local / uBodyFalloff, 0.0, 1.0);

    // Absorption deepens both with the page and with how low on the body we
    // are. The body term is the smaller of the two: even at the surface the
    // underside should read as cooler than the back.
    float absorbT = clamp(uSceneDepth * 0.75 + bodyT * 0.45, 0.0, 1.0);
    gl_FragColor.rgb *= mix(vec3(1.0), ${ABSORPTION}, absorbT);

    // Then blend toward the water itself. This is what makes the fluke
    // disappear into the dark.
    vec3 water = mix(uWaterNear, uWaterFar, bodyT);
    float blend = clamp(uWaterBlend * (0.45 + bodyT * 0.9), 0.0, 0.92);

    // Bright fragments resist the blend, so the rim light punches through
    // even when the body has gone. The difference between a whale that is
    // deep and a whale that is missing — and why the rim has a floor.
    float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    blend *= 1.0 - smoothstep(0.2, 0.9, lum) * 0.8;

    gl_FragColor.rgb = mix(gl_FragColor.rgb, water, blend);

    // 2. The sunlit top. Near the surface, direct light through the
    // waterline lifts the back and head slightly brighter than the rest of
    // the body. Scaling the already-shaded colour up (rather than
    // overwriting it) keeps the normal-mapped tubercles and scars visible
    // INSIDE the highlight, and lifting it toward the sun's own colour is
    // what pushes it from "slightly less dark" to "sunlit": the material's
    // base colour is deliberately darkened (see WhaleModel's colour FACTOR),
    // which caps how bright a plain diffuse response can ever get on its own.
    // Capped well short of a full mix — pushed to 1.8x/near-white here, the
    // back and head blew out to a flat white patch that read as a separate
    // lit object sitting on the whale rather than as sunlight on skin. A flat
    // colour lift, however small, still reads as an artificial coat painted
    // over the normal-mapped detail rather than as light on skin — so this is
    // now 0.1% of the already-reduced effect, near enough to off that the
    // texture itself (tubercles, scars, the roughness map) does the work of
    // reading as "sunlit" instead of a highlight laid on top of it.
    float topGlow = pow(clamp(1.0 - bodyT, 0.0, 1.0), 3.0) * uTopGlow * 0.00008;
    gl_FragColor.rgb = mix(
        gl_FragColor.rgb,
        gl_FragColor.rgb * 1.08 + vec3(0.55, 0.78, 0.92) * 0.06,
        topGlow
    );

    // 3. Scattering with distance from the camera. Applied AFTER the
    // highlight-preserving blend and not subject to it: a far whale's
    // highlights are hazed too, which is precisely what separates "far"
    // from "small" to the eye.
    float scatterT = smoothstep(uScatterStart, uScatterEnd, vWhaleViewDist) * uScatterMax;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, water, scatterT);
}
`;

/** Marks a material as already patched. Re-running `onBeforeCompile` on the
 *  same material would inject the block twice and fail to compile — and drei
 *  caches GLTF materials globally, so a StrictMode double-mount hands us the
 *  very same instance a second time. */
const PATCHED = '__whaleDepthPatched';

export function createWhaleDepthUniforms(): WhaleDepthUniforms {
    return {
        uWhaleY: { value: 0 },
        // A touch over the body's vertical extent, so the gradient runs out
        // just past the belly instead of clipping to flat black mid-flank.
        uBodyFalloff: { value: 1.6 },
        uSceneDepth: { value: 0 },
        uWaterNear: { value: new Color('#17333d') },
        uWaterFar: { value: new Color('#0d4f70') },
        uWaterBlend: { value: 0.05 },
        // The camera sits ~4 units from the z = 0 lane. The close pass brings
        // the whale to ~3, the deepest shot pushes it to ~7. Scattering starts
        // just behind the lane so the close pass stays crisp, and is fully in
        // by the far shot.
        uScatterStart: { value: 4.5 },
        uScatterEnd: { value: 11 },
        uScatterMax: { value: 0.6 },
        uTopGlow: { value: 10 },
    };
}

/**
 * Patch a material in place. Safe to call repeatedly; only the first call
 * does anything.
 */
export function applyWhaleDepthGrading(
    material: Material,
    uniforms: WhaleDepthUniforms,
): void {
    const mat = material as Material & Record<string, unknown>;
    if (mat[PATCHED]) return;
    mat[PATCHED] = true;

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);

        shader.vertexShader =
            `varying float vWhaleWorldY;\nvarying float vWhaleViewDist;\n${shader.vertexShader}`.replace(
                VERTEX_HOOK,
                VERTEX_INJECT,
            );

        const declarations = /* glsl */ `
varying float vWhaleWorldY;
varying float vWhaleViewDist;
uniform float uWhaleY;
uniform float uBodyFalloff;
uniform float uSceneDepth;
uniform vec3  uWaterNear;
uniform vec3  uWaterFar;
uniform float uWaterBlend;
uniform float uScatterStart;
uniform float uScatterEnd;
uniform float uScatterMax;
uniform float uTopGlow;
`;
        let frag = `${declarations}\n${shader.fragmentShader}`;

        const hook = FRAGMENT_HOOKS.find((h) => frag.includes(h));
        if (!hook) {
            // Loud rather than silent: without the injection the whale simply
            // stops responding to depth, which looks like a tuning problem
            // and would be hunted for in entirely the wrong file.
            console.warn(
                '[whaleDepthMaterial] No output chunk found in the fragment shader; ' +
                    'depth grading is inactive. three.js may have renamed it again.',
            );
        } else {
            frag = frag.replace(hook, fragmentInject(hook));
        }
        shader.fragmentShader = frag;
    };

    // Forces a recompile if the material has already been used this session.
    material.needsUpdate = true;
}
