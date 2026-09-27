import type { Material } from 'three';
import { oceanUniforms } from './oceanUniforms';

/**
 * Sunlight focused by the surface, dancing over the whale's skin.
 *
 * In every good underwater frame of a whale near the surface, the brightest
 * thing on the animal is not a highlight but a moving web of caustics across
 * its back. They come from the same water the visitor is rippling: the
 * simulation traces the sun through the live surface onto a plane below it
 * (see `WaterSimulation`), and this looks that texture up for each fragment of
 * the skin by walking back up the refracted sun direction to the surface.
 *
 * The light is ADDED on top of the lit skin, scaled by the skin's own albedo
 * and by how squarely the fragment faces the light, so the pattern wraps over
 * the body instead of being projected flat onto it. It fades with depth below
 * the surface, and switches off above the water (the tail when it breaks it).
 */
const PATCHED = '__whaleCausticsPatched';

const VERTEX_DECL = 'varying vec3 vOceanWorld;\n';
const VERTEX_HOOK = '#include <project_vertex>';
const VERTEX_INJECT = /* glsl */ `
vOceanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#include <project_vertex>
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vOceanWorld;
uniform sampler2D uCausticTex;
uniform float uCausticStrength;
uniform float uWaterLevel;
uniform vec2 uSimCenter;
uniform float uSimSize;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uWhaleHaze;
uniform vec3 uWaterNear;
uniform vec3 uWaterFar;
uniform float uAirLight;
`;

const FRAGMENT_HOOKS = ['#include <opaque_fragment>', '#include <output_fragment>'];

const fragmentInject = (hook: string) => /* glsl */ `
if (uCausticStrength > 0.0) {
    float below = uWaterLevel - vOceanWorld.y;
    float under = smoothstep(0.0, 0.2, below);
    vec3 l0 = refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
    vec2 q = vOceanWorld.xz - l0.xz * (-below / l0.y);
    vec2 cuv = (q - uSimCenter) / uSimSize + 0.5;
    vec2 e = min(cuv, 1.0 - cuv);
    float inside = smoothstep(0.0, 0.05, min(e.x, e.y));
    // The web is traced for one plane under the surface. Away from that plane
    // real caustics defocus, so the lookup softens with the distance from it.
    float r = 0.0022 * clamp(abs(below - 2.6) * 0.3, 0.0, 2.5);
    float c = texture2D(uCausticTex, cuv).r * 0.4
        + (texture2D(uCausticTex, cuv + vec2(r, 0.0)).r
        + texture2D(uCausticTex, cuv - vec2(r, 0.0)).r
        + texture2D(uCausticTex, cuv + vec2(0.0, r)).r
        + texture2D(uCausticTex, cuv - vec2(0.0, r)).r) * 0.15;
    vec3 nWorld = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float facing = max(dot(nWorld, -l0), 0.0);
    // Light lost on the way down; red goes first. Gentler than the real
    // coefficients: the web should read as sunlight, not as a cyan glow.
    vec3 through = exp(-vec3(0.07, 0.028, 0.02) * max(below, 0.0));
    // Flat water traces to exactly 1; only light focused past that is added,
    // so the web reads as bright lines rather than a uniform lift. Fainter the
    // deeper it is, as the light spreads.
    float focus = max(c - 0.8, 0.0);
    float fade = 1.0 / (1.0 + max(below, 0.0) * 0.12);
    // Rolled off rather than squared: where the web is sharpest it focuses to
    // over ten times the flat light, and unbounded that burned to white
    // streaks that read as gloss on the skin, not as light on it.
    float web = focus * 1.3 / (1.0 + focus * 0.55);
    outgoingLight += diffuseColor.rgb * uSunColor * through * fade
        * web * facing * under * inside * uCausticStrength;
}
if (uAirLight > 0.0) {
    // Out of the water, the skin is in daylight, not in the underwater rig:
    // lit by the sun and the open sky, and WET — a hard sun highlight and a
    // sheen of sky along every edge seen at a grazing angle. Without this a
    // raised fluke is a black cut-out against the sky.
    float airBlend = smoothstep(0.02, 0.3, vOceanWorld.y - uWaterLevel) * uAirLight;
    if (airBlend > 0.0) {
        vec3 nAir = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        vec3 V = normalize(cameraPosition - vOceanWorld);
        vec3 skyLight = vec3(0.42, 0.6, 0.82);
        float ndl = max(dot(nAir, uSunDir), 0.0);
        vec3 lit = diffuseColor.rgb * (uSunColor * ndl * 1.5 + skyLight * (0.55 + 0.45 * nAir.y) * 0.7);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(nAir, H), 0.0), 220.0) * 9.0 + pow(max(dot(nAir, H), 0.0), 24.0) * 0.35;
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(nAir, V), 0.0), 5.0);
        vec3 wet = uSunColor * spec + skyLight * fres * 0.9;
        outgoingLight = mix(outgoingLight, lit + wet, airBlend);
    }
}
if (uWhaleHaze > 0.0) {
    // Water between the whale and the lens. Past a few body-widths the animal
    // loses contrast into the blue, which is what makes a far whale read as
    // far rather than small. Nothing above the surface is hazed.
    vec3 toFrag = vOceanWorld - cameraPosition;
    float dist = length(toFrag);
    float submerged = smoothstep(0.0, 0.2, uWaterLevel - vOceanWorld.y);
    float haze = (1.0 - exp(-max(dist - 10.0, 0.0) * 0.034)) * submerged * uWhaleHaze;
    vec3 water = mix(uWaterFar, uWaterNear, smoothstep(-0.5, 0.3, toFrag.y / dist)) * 0.9;
    outgoingLight = mix(outgoingLight, water, haze);
}
${hook}
`;

export function applyWhaleCaustics(material: Material): void {
    const mat = material as Material & Record<string, unknown>;
    if (mat[PATCHED]) return;
    mat[PATCHED] = true;

    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        previous?.call(material, shader, renderer);
        shader.uniforms.uCausticTex = oceanUniforms.uCausticTex;
        shader.uniforms.uCausticStrength = oceanUniforms.uCausticStrength;
        shader.uniforms.uWaterLevel = oceanUniforms.uWaterLevel;
        shader.uniforms.uSimCenter = oceanUniforms.uSimCenter;
        shader.uniforms.uSimSize = oceanUniforms.uSimSize;
        shader.uniforms.uSunDir = oceanUniforms.uSunDir;
        shader.uniforms.uSunColor = oceanUniforms.uSunColor;
        shader.uniforms.uWhaleHaze = oceanUniforms.uWhaleHaze;
        shader.uniforms.uWaterNear = oceanUniforms.uWaterNear;
        shader.uniforms.uWaterFar = oceanUniforms.uWaterFar;
        shader.uniforms.uAirLight = oceanUniforms.uAirLight;

        shader.vertexShader = VERTEX_DECL + shader.vertexShader.replace(VERTEX_HOOK, VERTEX_INJECT);

        let frag = FRAGMENT_DECL + shader.fragmentShader;
        const hook = FRAGMENT_HOOKS.find((h) => frag.includes(h));
        if (hook) frag = frag.replace(hook, fragmentInject(hook));
        else console.warn('[whaleCaustics] no output chunk found; caustics inactive');
        shader.fragmentShader = frag;
    };
    material.needsUpdate = true;
}
