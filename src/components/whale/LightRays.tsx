import { viewportHeight } from '../../utils/viewport';
import { useFrame } from '@react-three/fiber';
import { useRef, useEffect, useMemo } from 'react';
import { ShaderMaterial, Vector2, Color, AdditiveBlending, MathUtils } from 'three';
import type { MutableRefObject } from 'react';
import { depthSignal } from '../../animations/depthSignal';
import { preludeSignal } from '../../animations/preludeSignal';
import { waterSignal } from '../../animations/waterSignal';
import { oceanUniforms } from '../ocean/oceanUniforms';
import { oceanCommon, screenRay } from '../ocean/oceanShaders';
import { IS_MOBILE } from '../../utils/device';

/** A phone's share of the rays: behind the projects' words on a small screen
 *  they read as smoke over the type, and the owner asked for them massively
 *  reduced there (as the live shafts are, see underwaterVolume). */
const PHONE_RAYS = 0.25;

/** Ray colour at the surface and in the deep. Red is absorbed first, so the
 *  shafts cool as they descend rather than simply dimming. Module scope: the
 *  per-frame path must not allocate. */
const RAYS_SHALLOW = new Color('#8fd8ff');
const RAYS_DEEP = new Color('#3f7f9c');
const depthColor = new Color();

/**
 * Shafts of light from the water surface.
 *
 * The React Bits LightRays shader, ported to react-three-fiber. The original
 * draws through OGL on its own canvas; this runs the same fragment shader on a
 * fullscreen clip-space quad inside the scene's existing canvas, so it shares
 * the bloom and ambient-occlusion passes and costs no second WebGL context.
 *
 * Prop defaults match the published component, except three tuned for this
 * scene: `raysSpeed` 0.7, a deep-water `raysColor` in place of white, and
 * `intensity`, which is ours rather than upstream's.
 *
 * Tuning note: `raysColor` multiplies into the fragment AND into the alpha
 * derived from it, so perceived brightness moves with roughly the SQUARE of the
 * colour's magnitude. Swapping white for a mid deep-sea blue costs about 60% of
 * the brightness on its own. Change the colour first, then trim `intensity`.
 *
 * Two details the original gets for free and a port has to be careful about:
 *
 *  - `gl_FragCoord` is in DEVICE pixels, so `iResolution` has to be device
 *    pixels too. Feeding it CSS pixels puts the ray origin in the wrong place
 *    on any display that is not exactly 1x, which includes Windows at 125%.
 *  - `followMouse` is what makes the rays visibly move. It is on by default
 *    upstream, and the cursor position is smoothed rather than applied raw.
 */

export type RaysOrigin =
    | 'top-center'
    | 'top-left'
    | 'top-right'
    | 'left'
    | 'right'
    | 'bottom-center'
    | 'bottom-left'
    | 'bottom-right';

interface LightRaysProps {
    /** Optional 0..1 signal from the whale's reveal, used to lift the rays a
     *  little as it emerges. The rays fade in on their own regardless, so they
     *  still appear if the model is slow or fails to load. */
    revealRef?: MutableRefObject<number>;
    raysOrigin?: RaysOrigin;
    raysColor?: string;
    raysSpeed?: number;
    lightSpread?: number;
    rayLength?: number;
    pulsating?: boolean;
    fadeDistance?: number;
    saturation?: number;
    followMouse?: boolean;
    mouseInfluence?: number;
    noiseAmount?: number;
    distortion?: number;
    /** Peak alpha of the additive pass. The one dial to turn if the rays read
     *  too strong or too faint. */
    intensity?: number;
    /** Seconds for the rays to fade up on first mount. */
    fadeInDuration?: number;
}

/** Where the rays come from, and which way they point, in device pixels. */
function applyOrigin(pos: Vector2, dir: Vector2, origin: RaysOrigin, w: number, h: number) {
    switch (origin) {
        case 'top-left':
            pos.set(0, -h * 0.2);
            dir.set(0.5, 1);
            break;
        case 'top-right':
            pos.set(w, -h * 0.2);
            dir.set(-0.5, 1);
            break;
        case 'left':
            pos.set(-w * 0.2, h * 0.5);
            dir.set(1, 0);
            break;
        case 'right':
            pos.set(w * 1.2, h * 0.5);
            dir.set(-1, 0);
            break;
        case 'bottom-left':
            pos.set(0, h * 1.2);
            dir.set(0.5, -1);
            break;
        case 'bottom-center':
            pos.set(w * 0.5, h * 1.2);
            dir.set(0, -1);
            break;
        case 'bottom-right':
            pos.set(w, h * 1.2);
            dir.set(-0.5, -1);
            break;
        case 'top-center':
        default:
            pos.set(w * 0.5, -h * 0.2);
            dir.set(0, 1);
            break;
    }
    dir.normalize();
}

const LightRays = ({
    revealRef,
    raysOrigin = 'top-center',
    // Deep water: red is absorbed first with depth, then green, leaving this
    // cyan-blue. The shader then deepens it further toward the bottom of the
    // screen via its own per-channel falloff.
    raysColor = '#5da9c6',
    raysSpeed = 0.7,
    lightSpread = 1.0,
    rayLength = 2.0,
    pulsating = false,
    fadeDistance = 1.0,
    saturation = 1.0,
    followMouse = true,
    mouseInfluence = 0.1,
    noiseAmount = 0.02,
    distortion = 0.02,
    // Lands at roughly half the brightness of the white-ray version. The deep
    // colour alone costs ~60%, so this claws a little back to keep the rays
    // present rather than dropping them to a third.
    intensity = 0.65,
    fadeInDuration = 1.5,
}: LightRaysProps) => {
    const materialRef = useRef<ShaderMaterial>(null);

    const mouseTarget = useRef(new Vector2(0.5, 0.5));
    const mouseSmooth = useRef(new Vector2(0.5, 0.5));
    const fadeIn = useRef(0);

    // Created once and mutated in place. Handing the material a brand new
    // uniforms object on every resize would need an explicit needsUpdate.
    const uniforms = useMemo(
        () => ({
            iTime: { value: 0 },
            iResolution: { value: new Vector2(1, 1) },
            rayPos: { value: new Vector2(0.5, -0.2) },
            rayDir: { value: new Vector2(0, 1) },
            raysColor: { value: new Color(raysColor) },
            raysSpeed: { value: raysSpeed },
            lightSpread: { value: lightSpread },
            rayLength: { value: rayLength },
            pulsating: { value: pulsating ? 1 : 0 },
            fadeDistance: { value: fadeDistance },
            saturation: { value: saturation },
            mousePos: { value: new Vector2(0.5, 0.5) },
            mouseInfluence: { value: followMouse ? mouseInfluence : 0 },
            noiseAmount: { value: noiseAmount },
            distortion: { value: distortion },
            uOpacity: { value: 0 },
            // Shared with the live sea, so the shafts can stay out of the
            // sky in the over/under opening shot.
            ...oceanUniforms,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    // Keep uniforms in step if props change at runtime.
    //
    // `raysColor`, `lightSpread` and `rayLength` are deliberately NOT synced
    // here any more: the depth signal drives them every frame in useFrame.
    // Writing them from both places means a React render can stamp the prop
    // value over the current depth for one frame, which shows up as a flash of
    // surface-blue light in the middle of the abyss. Their props remain as the
    // INITIAL values, set once when the uniforms object is built.
    useEffect(() => {
        const u = materialRef.current?.uniforms;
        if (!u) return;
        u.raysSpeed.value = raysSpeed;
        u.pulsating.value = pulsating ? 1 : 0;
        u.fadeDistance.value = fadeDistance;
        u.saturation.value = saturation;
        u.mouseInfluence.value = followMouse ? mouseInfluence : 0;
        u.noiseAmount.value = noiseAmount;
        u.distortion.value = distortion;
    }, [
        raysSpeed,
        pulsating,
        fadeDistance,
        saturation,
        followMouse,
        mouseInfluence,
        noiseAmount,
        distortion,
    ]);

    // This is the motion: the beams swing toward the cursor.
    useEffect(() => {
        if (!followMouse) return;
        const onMove = (e: MouseEvent) => {
            mouseTarget.current.set(
                e.clientX / window.innerWidth,
                e.clientY / viewportHeight(),
            );
        };
        window.addEventListener('mousemove', onMove);
        return () => window.removeEventListener('mousemove', onMove);
    }, [followMouse]);

    useFrame((state, delta) => {
        const mat = materialRef.current;
        if (!mat) return;
        const u = mat.uniforms;
        const dt = Math.min(delta, 0.05);

        u.iTime.value = state.clock.elapsedTime;

        // 1. RESOLUTION — device pixels, to match gl_FragCoord
        const dpr = state.viewport.dpr;
        const pw = state.size.width * dpr;
        const ph = state.size.height * dpr;
        if (u.iResolution.value.x !== pw || u.iResolution.value.y !== ph) {
            u.iResolution.value.set(pw, ph);
            applyOrigin(u.rayPos.value, u.rayDir.value, raysOrigin, pw, ph);
        }

        // 2. CURSOR — smoothed, so the beams drift rather than snap
        if (followMouse) {
            mouseSmooth.current.lerp(mouseTarget.current, 1 - Math.exp(-6 * dt));
            u.mousePos.value.copy(mouseSmooth.current);
        }

        // 3. DEPTH — the rays are the sun, so they answer to the water column
        // rather than to a fixed scroll distance. This used to fade out across
        // the first viewport height and stay gone, which meant the light died
        // before the descent had started and never came back for the ascent.
        const { ocean, depth } = depthSignal;

        // Colour and shape are driven here rather than through the prop-sync
        // effect below: that effect runs on a React render, and these change
        // every frame. Two writers on one uniform is a race.
        depthColor.lerpColors(RAYS_SHALLOW, RAYS_DEEP, depth);
        u.raysColor.value.copy(depthColor);

        // Deeper light has been scattered further, so the shafts spread and
        // soften. Shortening them at the same time keeps them from reading as
        // a searchlight once there is no visible surface to originate from.
        u.lightSpread.value = MathUtils.lerp(u.lightSpread.value, 1.0 + depth * 1.6, dt * 3);
        u.rayLength.value = MathUtils.lerp(u.rayLength.value, 2.0 - depth * 0.7, dt * 3);

        // 4. OPACITY — own fade-in, the water column, and a lift from the whale
        fadeIn.current = Math.min(1, fadeIn.current + dt / fadeInDuration);
        const f = fadeIn.current;
        const eased = f * f * (3 - 2 * f);

        const reveal = revealRef ? 0.55 + 0.45 * revealRef.current : 1;

        // No longer suppressed during the opening shot: the shader masks the
        // shafts to the pixels that look out from the water (see the waterline
        // in components/ocean), so they fall from the waterline down.
        // Half strength in the over/under opening: there the shafts are a
        // hint under the surface band, as in the reference photograph, not
        // a wash over the whole underwater half.
        // And near the surface they give way to the real shafts, which the
        // live caustics throw (components/ocean/underwaterVolume): these take
        // back over as the surface fades out of reach overhead.
        const live = waterSignal.active ? waterSignal.presence : 0;
        u.uOpacity.value =
            intensity * eased * ocean.rays * reveal * (1 - 0.55 * preludeSignal.progress) * (1 - live) *
            (IS_MOBILE ? PHONE_RAYS : 1);
    });

    // Culling off: the vertex shader ignores the camera and writes clip space
    // directly, so three's bounding-sphere test against the real camera could
    // cull a quad that in fact covers the whole screen.
    return (
        <mesh frustumCulled={false}>
            <planeGeometry args={[2, 2]} />
            <shaderMaterial
                ref={materialRef}
                transparent={true}
                depthWrite={false}
                depthTest={false}
                blending={AdditiveBlending}
                uniforms={uniforms}
                vertexShader={`
          varying vec2 vNdc;
          void main() {
            vNdc = position.xy;
            gl_Position = vec4(position.xy, 1.0, 1.0);
          }
        `}
                fragmentShader={oceanCommon + screenRay + `
          varying vec2 vNdc;
          uniform float iTime;
          uniform vec2  iResolution;
          uniform vec2  rayPos;
          uniform vec2  rayDir;
          uniform vec3  raysColor;
          uniform float raysSpeed;
          uniform float lightSpread;
          uniform float rayLength;
          uniform float pulsating;
          uniform float fadeDistance;
          uniform float saturation;
          uniform vec2  mousePos;
          uniform float mouseInfluence;
          uniform float noiseAmount;
          uniform float distortion;
          uniform float uOpacity;

          float noise(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
          }

          float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
            vec2 sourceToCoord = coord - raySource;
            vec2 dirNorm = normalize(sourceToCoord);
            float cosAngle = dot(dirNorm, rayRefDirection);

            float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
            float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));

            float distance = length(sourceToCoord);
            float maxDistance = iResolution.x * rayLength;
            float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);

            float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);
            float pulse = pulsating > 0.5 ? (0.8 + 0.2 * sin(iTime * speed * 3.0)) : 1.0;

            float baseStrength = clamp(
              (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
              (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
              0.0, 1.0
            );

            return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
          }

          void main() {
            vec2 coord = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y);

            vec2 finalRayDir = rayDir;
            if (mouseInfluence > 0.0) {
              vec2 mouseScreenPos = mousePos * iResolution.xy;
              vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
              finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
            }

            vec4 rays1 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349, 1.5 * raysSpeed);
            vec4 rays2 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234, 1.1 * raysSpeed);

            vec4 fragColor = rays1 * 0.5 + rays2 * 0.4;

            if (noiseAmount > 0.0) {
              float n = noise(coord * 0.01 + iTime * 0.1);
              fragColor.rgb *= (1.0 - noiseAmount + noiseAmount * n);
            }

            float brightness = 1.0 - (coord.y / iResolution.y);
            fragColor.x *= 0.1 + brightness * 0.8;
            fragColor.y *= 0.3 + brightness * 0.6;
            fragColor.z *= 0.5 + brightness * 0.5;

            if (saturation != 1.0) {
              float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
              fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
            }

            fragColor.rgb *= raysColor;

            float alpha = clamp(length(fragColor.rgb) * 0.8, 0.0, 1.0);
            // Light shafts exist only in the water.
            float inWater = 1.0 - smoothstep(-0.01, 0.02, domeClearance(screenRay(vNdc)));
            gl_FragColor = vec4(fragColor.rgb, alpha * uOpacity * inWater);
          }
        `}
            />
        </mesh>
    );
};

export default LightRays;
