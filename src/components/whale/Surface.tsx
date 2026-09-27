import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, MathUtils, Vector2 } from 'three';
import type { Mesh, ShaderMaterial } from 'three';
import { depthSignal } from '../../animations/depthSignal';
import { preludeSignal } from '../../animations/preludeSignal';
import { SURFACE_Y } from '../../animations/stage';

/**
 * The underside of the water, seen from below.
 *
 * The hero had god rays but nothing for them to come from — light arriving
 * out of an empty black sky, which reads as space rather than as sea. This is
 * the missing half: a real surface a body-length above the whale, rippling,
 * catching the sun, and receding as the page descends.
 *
 * It is a flat plane, not displaced geometry. Seen from underneath and almost
 * edge-on, a water surface is read almost entirely through its specular
 * pattern and hardly at all through its silhouette, so the shader does the
 * work and the mesh stays one draw call with four vertices.
 *
 * Additive, because this is light rather than a material: the bright bands are
 * the sun refracting through a moving lens, and they should build on whatever
 * is behind them instead of occluding it.
 */

const vertexShader = /* glsl */ `
varying vec2 vWorldXZ;

void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec2  uCameraXZ;
uniform vec3  uSurfaceColor;
uniform vec3  uWaterColor;

varying vec2 vWorldXZ;

void main() {
    float t = uTime * 0.35;
    vec2 p = vWorldXZ * 0.18;

    // Two crossing swells warp the domain before the caustics are sampled.
    // Warping first is what stops the pattern reading as a fixed grid with
    // brightness animating on top of it: the whole field slides and breathes.
    float swell = sin(p.x + t) * 0.5 + sin(p.y * 1.3 - t * 0.8) * 0.5;
    p += swell * 0.25;

    // Three wave trains at incommensurate angles. Their sum passes through
    // zero along moving curves; |sum| turns those zero crossings into the
    // bright filaments a water surface throws, and the power sharpens them
    // from soft bands into the thin caustic web.
    float c1 = sin(p.x * 2.0 + t * 1.3);
    float c2 = sin(p.y * 2.2 - t * 1.1);
    float c3 = sin((p.x + p.y) * 1.7 + t * 0.7);
    float ridges = abs(c1 + c2 + c3) / 3.0;
    float caustic = pow(1.0 - ridges, 3.0);

    // The plane is enormous so its far edge never shows, but that also means
    // the horizon would otherwise be a hard line of full-strength caustics.
    // Fade with distance from the camera: near overhead is bright and legible,
    // far converges into the water colour.
    float d = length(vWorldXZ - uCameraXZ);
    float near = 1.0 - smoothstep(6.0, 46.0, d);

    vec3 col = mix(uWaterColor, uSurfaceColor, caustic);
    // Restrained. Seen from a few units below at a grazing angle, the ridge
    // filaments stretch into huge glowing ellipses, and at full strength they
    // read as neon or aurora rather than water. The hero photograph now carries
    // the real surface; this only needs to be a faint shimmer overhead once
    // the photo has faded.
    float alpha = uOpacity * near * (0.05 + caustic * 0.28);

    gl_FragColor = vec4(col * alpha, alpha);
}
`;

const SURFACE_COLOR = new Color('#dff3fb');

const Surface = () => {
    const mesh = useRef<Mesh>(null);
    const material = useRef<ShaderMaterial>(null);

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uOpacity: { value: 0 },
            uCameraXZ: { value: new Vector2(0, 0) },
            uSurfaceColor: { value: SURFACE_COLOR.clone() },
            uWaterColor: { value: new Color('#2a93b8') },
        }),
        [],
    );

    useFrame((state, delta) => {
        const mat = material.current;
        if (!mat) return;
        const dt = Math.min(delta, 0.05);

        mat.uniforms.uTime.value = state.clock.elapsedTime;

        // Track the camera on the horizontal plane so the bright patch stays
        // overhead rather than sliding off as the camera drifts.
        mat.uniforms.uCameraXZ.value.set(state.camera.position.x, state.camera.position.z);

        // Suppressed during the surface-to-dive prelude: the underside-of-
        // the-water view and the real `SurfacePrelude` sky/water would
        // otherwise render on top of each other at scroll 0.
        const target = depthSignal.ocean.surface * (1 - preludeSignal.progress);
        mat.uniforms.uOpacity.value = MathUtils.lerp(
            mat.uniforms.uOpacity.value,
            target,
            1 - Math.exp(-2.6 * dt),
        );

        mat.uniforms.uWaterColor.value.copy(depthSignal.ocean.waterNear);

        // Once the surface is out of sight there is no reason to keep shading
        // a full-screen plane every frame. The threshold sits just below the
        // point where the caustics stop being resolvable.
        if (mesh.current) mesh.current.visible = mat.uniforms.uOpacity.value > 0.01;
    });

    return (
        <mesh
            ref={mesh}
            position={[0, SURFACE_Y, 0]}
            // Plane geometry faces +Z; this turns it to face -Y, so we are
            // looking at its underside from below the waterline.
            rotation={[Math.PI / 2, 0, 0]}
            visible={false}
            // The plane is far wider than the frame and is meant to run past
            // the edges of the view at every camera position the director can
            // reach, so three's bounding-sphere cull is only ever a false
            // negative waiting to happen.
            frustumCulled={false}
        >
            <planeGeometry args={[160, 160]} />
            <shaderMaterial
                ref={material}
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={uniforms}
                transparent
                blending={AdditiveBlending}
                depthWrite={false}
            />
        </mesh>
    );
};

export default Surface;
