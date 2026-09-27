import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BlendFunction, Effect } from 'postprocessing';
import { Color, Uniform } from 'three';
import { waterSignal } from '../../animations/waterSignal';

/**
 * The grade of a real over/under photograph, laid over the near-surface part
 * of the dive.
 *
 * The owner's reference is graded hard: the light is all in a band just under
 * the surface and on the animal, and the water falls away to near-black navy
 * (#011427) toward the bottom of the frame and into the corners. Two layers
 * do that here, both premultiplied, because the canvas is transparent over
 * the page's painted water:
 *
 *   THE DEEP, composited UNDER the canvas content: toward the bottom of the
 *   frame the painted water behind everything is taken down to navy, but the
 *   whale, the surface and the light in front of it keep their contrast —
 *   which is exactly what looking down into deep water does.
 *
 *   THE LENS, over everything: a vignette into the same navy.
 *
 * Both fade out with the sea itself (`presence`), so from the projects on the
 * page's own palette rules alone.
 */

const DEEP = 0.8;
const VIGNETTE = 0.55;
const GRAIN = 0.06;

const fragmentShader = /* glsl */ `
uniform float uDeep;
uniform float uVignette;
uniform vec3 uNavy;
uniform float uGrain;

float grainHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec4 c = inputColor;

    float down = 1.0 - smoothstep(0.0, 0.66, uv.y);
    float under = down * down * uDeep;
    c.rgb += (1.0 - c.a) * under * uNavy;
    c.a += (1.0 - c.a) * under;

    vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(d) / length(vec2(aspect, 1.0) * 0.5);
    float v = smoothstep(0.45, 1.05, r) * uVignette;
    c = vec4(c.rgb * (1.0 - v) + uNavy * v, c.a * (1.0 - v) + v);

    // Film grain, a new pattern every frame: a photograph has it, and it
    // hides the fine regular dither the light shafts' sampling leaves.
    float g = grainHash(gl_FragCoord.xy + fract(time * 7.13) * 431.0) - 0.5;
    c.rgb = max(c.rgb + g * uGrain * (0.25 + c.rgb), 0.0);

    outputColor = c;
}
`;

class OceanGradeEffect extends Effect {
    constructor() {
        super('OceanGrade', fragmentShader, {
            blendFunction: BlendFunction.SRC,
            uniforms: new Map<string, Uniform>([
                ['uDeep', new Uniform(0)],
                ['uVignette', new Uniform(0)],
                ['uNavy', new Uniform(new Color('#011427'))],
                ['uGrain', new Uniform(0)],
            ]),
        });
    }
}

/** Mounted last in the EffectComposer. */
export function OceanGrade() {
    const effect = useMemo(() => new OceanGradeEffect(), []);
    useEffect(() => () => effect.dispose(), [effect]);

    useFrame(() => {
        const p = waterSignal.active ? waterSignal.presence : 0;
        (effect.uniforms.get('uDeep') as Uniform).value = DEEP * p;
        (effect.uniforms.get('uVignette') as Uniform).value = VIGNETTE * p;
        (effect.uniforms.get('uGrain') as Uniform).value = GRAIN * p;
    });

    return <primitive object={effect} />;
}
