import { WATER_NORMALS_URL } from '../../utils/sceneAssets';
import { Sky } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
    Color,
    Object3D,
    PlaneGeometry,
    Quaternion,
    RepeatWrapping,
    TextureLoader,
    Vector3,
} from 'three';
import type { Group, PerspectiveCamera as PerspectiveCameraImpl, ShaderMaterial } from 'three';
import type { MutableRefObject } from 'react';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { useLoader } from '@react-three/fiber';
import { frameBudget } from '../../animations/frameBudget';
import { preludeSignal, updatePrelude } from '../../animations/preludeSignal';
import { SUN_DISTANCE, SURFACE_Y } from '../../animations/stage';
import { OCEAN } from '../../animations/oceanPalette';
import type { ScrollSignal } from '../../animations/scrollSignal';

/**
 * The opening beat: the page loads on the sea surface — real sky, a
 * hyperreal (near-static) ocean, sun glare — and the first scroll input
 * submerges the camera into the existing underwater dive.
 *
 * This is the START of the one dive, not a second scene bolted on: it drives
 * the SAME shared camera `WhaleScene` already owns (handed in as a ref)
 * rather than mounting a second one, and hands off to whatever comes next —
 * today that is simply the camera's resting pose, later it will be handing
 * off to the CameraDirector described in SOUNDING_PLAN.md §4.3.
 *
 * SUN DIRECTION. The rest of the rig treats the sun as directly overhead
 * (`stage.ts`'s `SUN_Y` sits on the y-axis at x=0, z=0). A perfectly vertical
 * sun is also a degenerate case for the sky shader's azimuth math and gives
 * the water's specular sun-glint nowhere interesting to sit in frame, so this
 * tilts it a few degrees toward the horizon — still "one light from above" to
 * the eye, but with somewhere for the glare to land. `Water`'s `sunDirection`
 * and `Sky`'s `sunPosition` are built from the exact same vector so the two
 * never disagree about where the light is coming from.
 */
const SUN_DIR = new Vector3(0.05, 1, 0.22).normalize();

/** How far below `SURFACE_Y` the resting (post-dive) camera pose sits, and
 *  how far above it the prelude starts. Matches `WhaleScene`'s current
 *  `PerspectiveCamera` default of `[0, -2, 4]` — if that default ever moves,
 *  this must move with it. */
const REST_POSITION = new Vector3(0, -2, 4);
const START_POSITION = new Vector3(0, SURFACE_Y + 2, 6);
/** Where the surface camera looks: down and out toward the horizon, not
 *  straight along -Z, so the sea reads as a plane receding into the sky
 *  rather than a wall. */
const START_LOOK_AT = new Vector3(0, SURFACE_Y - 1, -30);

/** Advances the water's own time uniform. Well under the shader's usual
 *  demo speed — "hyperreal" here comes from the normal map's own detail,
 *  not from visible animation; a slow crawl avoids the flat, plasticky look
 *  a fully frozen frame of this shader can have where the map tiles. */
const WATER_TIME_SPEED = 0.12;

interface SurfacePreludeProps {
    scrollRef: MutableRefObject<ScrollSignal>;
    cameraRef: MutableRefObject<PerspectiveCameraImpl | null>;
}

const SurfacePrelude = ({ scrollRef, cameraRef }: SurfacePreludeProps) => {
    const group = useRef<Group>(null);
    // Latches true on the frame degradation first hides the prelude; only
    // releases once the visitor has scrolled back to the very top. See the
    // useFrame body for why this can't just track `frameBudget.degraded`
    // directly.
    const handedOff = useRef(false);

    const normalMap = useLoader(TextureLoader, WATER_NORMALS_URL);

    const water = useMemo(() => {
        normalMap.wrapS = RepeatWrapping;
        normalMap.wrapT = RepeatWrapping;

        const w = new Water(new PlaneGeometry(500, 500), {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: normalMap,
            sunDirection: SUN_DIR.clone(),
            sunColor: 0xffffff,
            // The surface stop's near-colour, not a colour of its own — one
            // more place that would silently drift from the ocean table.
            waterColor: new Color(OCEAN[0].waterNear).getHex(),
            distortionScale: 3.7,
            fog: false,
        });
        w.rotation.x = -Math.PI / 2;
        w.position.y = SURFACE_Y;
        return w;
    }, [normalMap]);

    useEffect(
        () => () => {
            water.geometry.dispose();
            water.material.dispose();
        },
        [water],
    );

    // Built once: the two end poses the camera slerps/lerps between. A scratch
    // Object3D computes the "look toward the horizon" quaternion via lookAt
    // rather than hand-rolled Euler angles, which are easy to get backwards.
    const { startQuat, endQuat } = useMemo(() => {
        const scratch = new Object3D();
        scratch.position.copy(START_POSITION);
        scratch.lookAt(START_LOOK_AT);
        return { startQuat: scratch.quaternion.clone(), endQuat: new Quaternion() };
    }, []);

    useFrame((_, delta) => {
        updatePrelude(scrollRef.current.y, scrollRef.current.max);

        const scrollFrac =
            scrollRef.current.max > 0 ? scrollRef.current.y / scrollRef.current.max : 0;

        // Latched, not a live read of `frameBudget.degraded`: recovery fires
        // ~5s after frame time drops (frameBudget's own hysteresis), which
        // is easily still inside this prelude's ~6% scroll window. Releasing
        // the instant it recovers would pop Sky/Water and the camera pitch
        // back in right after they stopped costing frames — exactly the
        // oscillation that hysteresis exists to prevent, just moved one
        // layer up. So once handed off during the prelude, STAY handed off
        // until the visitor scrolls back to the top AND the budget has
        // actually recovered.
        //
        // Both conditions are required, not just position: scroll ≈ 0 is
        // where every visitor starts, so releasing on position alone would
        // re-latch on the very next frame while still degraded (justHandedOff
        // fires again) and release again the frame after — a strobe between
        // surface and underwater at the top of the page on any slow machine,
        // which is the single worst place for it to happen.
        const justHandedOff = frameBudget.degraded && !handedOff.current;
        if (justHandedOff) handedOff.current = true;
        else if (handedOff.current && scrollFrac < 0.002 && !frameBudget.degraded) {
            handedOff.current = false;
        }

        // `updatePrelude` just published the scroll-only value. Overridden
        // to 0 here — not just this group's mesh hidden — because
        // `Surface`/`LightRays` read the same singleton and suppress
        // THEMSELVES by `(1 - progress)`; leaving it un-degraded while this
        // group goes invisible would black out the frame, dressing hidden on
        // both sides with neither handing off to the other.
        if (handedOff.current) preludeSignal.progress = 0;
        const eased = preludeSignal.progress;

        const cam = cameraRef.current;
        if (cam) {
            if (justHandedOff) {
                // Snap straight to the resting pose on the frame the hand-off
                // trips, rather than leaving the camera wherever the last
                // live frame put it. Without this a degrade at, say, 3%
                // scroll strands the camera mid-transition — above the
                // waterline, still pitched at the horizon — while the
                // underwater dressing is already what's on screen.
                cam.position.copy(REST_POSITION);
                cam.quaternion.copy(endQuat);
            } else if (eased > 0.001) {
                // Only touches the camera while the prelude is actually
                // live and not handed off. Once this stops writing,
                // whatever comes next (today: nothing, the camera holds its
                // resting pose; later: CameraDirector, SOUNDING_PLAN.md
                // §4.3) has sole ownership rather than fighting this for it.
                cam.position.lerpVectors(REST_POSITION, START_POSITION, eased);
                cam.quaternion.slerpQuaternions(endQuat, startQuat, eased);
            }
        }

        const mat = water.material as ShaderMaterial;
        mat.uniforms.time.value += delta * WATER_TIME_SPEED;

        // Skipping the render entirely (not just fading) once the handoff is
        // done, OR once `handedOff` forces `eased` to 0 above: `Water`'s
        // reflection pass is a full extra render-to-texture every frame, and
        // it is the single most expensive thing on screen during this beat —
        // better a fast cut to the plain underwater view than a slideshow.
        if (group.current) group.current.visible = eased > 0.001;
    });

    return (
        <group ref={group}>
            <Sky sunPosition={SUN_DIR.clone().multiplyScalar(SUN_DISTANCE)} turbidity={2} rayleigh={1} />
            <primitive object={water} />
        </group>
    );
};

export default SurfacePrelude;
