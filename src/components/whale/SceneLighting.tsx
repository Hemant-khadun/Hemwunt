import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MathUtils } from 'three';
import type {
    AmbientLight,
    DirectionalLight,
    HemisphereLight,
    Object3D,
    PointLight,
    SpotLight,
    Vector3,
} from 'three';
import type { MutableRefObject } from 'react';
import { depthSignal } from '../../animations/depthSignal';
import { SUN_DISTANCE, SUN_Y } from '../../animations/stage';

interface SceneLightingProps {
    /** The whale's world position, written every frame by `WhaleModel`. Read
     *  here so the sun's aim can follow it — see the spotlight target note
     *  below for why this is necessary at all. */
    worldPosRef: MutableRefObject<Vector3>;
}

/**
 * The light rig, orchestrated by depth.
 *
 * The rig used to be five fixed lights burning at the same intensity whether
 * the page was at the surface or four kilometres down, which meant the whale
 * was lit identically everywhere and the descent had no visual consequence at
 * all. Even readability is precisely what kills the feeling of depth.
 *
 * So the rig now says one thing: THERE IS ONE LIGHT AND IT LIVES AT THE
 * SURFACE. The sun is anchored in world space above the water, and the whale
 * swims away from it; everything else here is either that light bouncing
 * around or the compensation for its absence.
 *
 * The order the lights die in is doing the storytelling:
 *
 *   fill     first  — the flank stops being described, the animal flattens
 *   sun      next   — direction goes, the water becomes uniform
 *   ambient  slowly — never quite zero, or the deep is pure black
 *   rim      last   — FLOORED. this is the silhouette, and it never leaves
 *   biolum   rises  — cold cyan, the only thing left that is not the dark
 *
 * Every intensity is lerped toward its target rather than set, so a fast
 * scroll cannot strobe the scene. The rate is deliberately slower than the
 * page can move: light should feel like it has mass.
 */

/** How quickly the rig chases the depth signal. ~0.6s to settle. */
const RESPONSE = 2.6;

// Colours are held as module constants and lerped into the live light, so the
// per-frame path allocates nothing.
const SUN_COLOR = new Color('#aae5ff');
const RIM_SHALLOW = new Color('#719bad');
const RIM_DEEP = new Color('#4d7f9c');
const FILL_COLOR = new Color('#89b9d1');
const AMBIENT_SHALLOW = new Color('#0d2b52');
const AMBIENT_DEEP = new Color('#01131f');
const BIOLUM_COLOR = new Color('#00c3ff');
const WATER_LIGHT_WHITE = new Color('#ffffff');

const SceneLighting = ({ worldPosRef }: SceneLightingProps) => {
    const sun = useRef<SpotLight>(null);
    const sunTarget = useRef<Object3D>(null);
    const rim = useRef<DirectionalLight>(null);
    const fill = useRef<DirectionalLight>(null);
    const ambient = useRef<AmbientLight>(null);
    const biolum = useRef<PointLight>(null);
    const water = useRef<HemisphereLight>(null);

    // A spotlight's cone is aimed at its `target`, which three.js otherwise
    // leaves at the world origin. The whale routinely swims metres off to
    // either side of x = 0 (turns, lane-keeping, the close pass), and with a
    // FIXED target the cone simply does not reach it out there — the animal
    // would be dark on top on one side of its swim and lit on the other, for
    // no reason a visitor could read as anything but a bug. Following the
    // whale's x/z keeps the beam centred on the animal wherever it goes,
    // while the light itself stays put: the falloff by real distance (the
    // whole reason it is anchored in world space, see the header comment)
    // is unaffected, since that comes from `distance`/`decay`, not the target.
    useEffect(() => {
        if (sun.current && sunTarget.current) sun.current.target = sunTarget.current;
    }, []);

    useFrame((_, delta) => {
        if (sunTarget.current) sunTarget.current.position.copy(worldPosRef.current);
        // Frame-rate independent approach, matching the idiom the whale
        // animator uses, so the rig and the animal settle on the same curve.
        const k = 1 - Math.exp(-RESPONSE * Math.min(delta, 0.05));
        const { ocean, depth } = depthSignal;

        if (sun.current) {
            sun.current.intensity = MathUtils.lerp(sun.current.intensity, ocean.sun, k);
            // The beam widens as it deepens. Light that has been scattered
            // through several hundred metres of water arrives diffuse, not
            // collimated — a tight shaft at 2000m would read as a searchlight.
            sun.current.angle = MathUtils.lerp(sun.current.angle, 0.45 + depth * 0.5, k);
        }

        if (rim.current) {
            rim.current.intensity = MathUtils.lerp(rim.current.intensity, ocean.rim, k);
            rim.current.color.lerpColors(RIM_SHALLOW, RIM_DEEP, depth);
        }

        if (fill.current) {
            fill.current.intensity = MathUtils.lerp(fill.current.intensity, ocean.fill, k);
        }

        if (ambient.current) {
            ambient.current.intensity = MathUtils.lerp(
                ambient.current.intensity,
                ocean.ambient,
                k,
            );
            ambient.current.color.lerpColors(AMBIENT_SHALLOW, AMBIENT_DEEP, depth);
        }

        if (biolum.current) {
            biolum.current.intensity = MathUtils.lerp(
                biolum.current.intensity,
                ocean.biolum,
                k,
            );
        }

        if (water.current) {
            // The water itself as a light source. Sky colour is the sunlit
            // water above, lifted a little toward white; ground colour is the
            // deep below. Strength follows the SUN, so it is the same light as
            // the key, just scattered — and it goes when the sun goes.
            water.current.intensity = MathUtils.lerp(
                water.current.intensity,
                ocean.sun * 0.22,
                k,
            );
            water.current.color.copy(ocean.waterNear).lerp(WATER_LIGHT_WHITE, 0.3);
            water.current.groundColor.copy(ocean.waterFar);
        }
    });

    return (
        <>
            {/* THE SUN. Anchored above the surface in world space, so the
                whale's distance from it is a real distance and the falloff
                over the descent is geometry rather than a tuned curve.
                `decay={1}` rather than the physical 2: true inverse-square
                puts the whale in darkness within a couple of body lengths,
                which is accurate for a point source in air and wrong for a
                broad sheet of light coming through a water surface. */}
            <spotLight
                ref={sun}
                position={[0, SUN_Y, 0]}
                angle={0.45}
                penumbra={1}
                intensity={5.0}
                color={SUN_COLOR}
                distance={SUN_DISTANCE}
                decay={1}
            />
            {/* The sun's aim point, kept on the whale every frame above. Has to
                be a real scene-graph node (not a bare `new Object3D()` handed
                to `sun.target`) so three's renderer updates its world matrix
                each frame; an object outside the graph never gets that and the
                cone would silently stop following. */}
            <object3D ref={sunTarget} />

            {/* THE RIM. Last light standing. Floored in the ocean table so the
                whale always has an edge, however deep it goes — the difference
                between an animal in the dark and an animal that has gone. */}
            <directionalLight ref={rim} position={[0, 10, 2]} intensity={2.0} color={RIM_SHALLOW} />

            {/* SIDE FILL. Describes the flank's contours; the first thing to
                go, because losing it is what makes the animal read as a
                silhouette rather than a model. */}
            <directionalLight ref={fill} position={[-5, 2, 5]} intensity={0.6} color={FILL_COLOR} />

            {/* THE WATER. In open water a whale is lit from every direction by
                light the water has already scattered — bright from above, dark
                from below — not just by a key and a rim. Without this the
                whale read as a dark cut-out pasted over the hero photograph.
                A hemisphere light is exactly that gradient, coloured by the
                ocean table so it always agrees with the water around it. */}
            <hemisphereLight ref={water} intensity={1.1} />

            <ambientLight ref={ambient} intensity={0.22} color={AMBIENT_SHALLOW} />

            {/* BIOLUMINESCENCE. Absent at the surface, and in the deep the only
                thing on screen that is not the dark. Placed below and slightly
                behind so it grazes the underside — light from the wrong
                direction, which is exactly why it reads as not-the-sun.
                Shares the page's existing cyan accent, so it lands as brand
                rather than as novelty. */}
            <pointLight
                ref={biolum}
                position={[-2, -5, 1.5]}
                intensity={0}
                color={BIOLUM_COLOR}
                distance={14}
                decay={1.6}
            />
        </>
    );
};

export default SceneLighting;
