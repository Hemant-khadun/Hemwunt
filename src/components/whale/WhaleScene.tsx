import { SCENE_HDRI_URL } from '../../utils/sceneAssets';
import { Environment, Center, PerspectiveCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState } from 'react';
import { MathUtils } from 'three';
import type { AmbientLight, DirectionalLight, Object3D, PointLight, SpotLight } from 'three';
import WhaleModel from './WhaleModel';
import LightRays from './LightRays';
import SurfacePrelude from './SurfacePrelude';
import { depthSignal } from '../../animations/depthSignal';
import { OCEAN } from '../../animations/oceanPalette';
import { CONTACT_BEAM_EASE, contactBeamTarget } from '../../animations/contactBeam';

/**
 * The procedural sky-and-sea opening (SOUNDING_PLAN.md §4.10) is superseded,
 * like the photo and video heroes after it, by the live sea in
 * `components/ocean/` (§4.14), mounted below. It stays in the codebase,
 * intact, behind this flag.
 *
 * Do not enable both. They would each write `preludeSignal.progress`, draw two
 * skies and two seas, and the prelude's scripted camera pitch would tilt the
 * port the live sea's waterline is computed through.
 */
const SURFACE_PRELUDE_ENABLED = false;
import CameraDirector from './CameraDirector';
import BubbleWake from './BubbleWake';
import Ocean, { WhaleWaterCoupling } from '../ocean/Ocean';
import Spray from '../ocean/Spray';
import type { MutableRefObject } from 'react';
import type { PerspectiveCamera as PerspectiveCameraImpl, Vector3 } from 'three';
import type { WhaleAnimator } from '../../animations/whaleAnimator';
import type { ScrollSignal } from '../../animations/scrollSignal';

interface WhaleSceneProps {
    animator: WhaleAnimator;
    /** Written by the model each frame, read by the rays. */
    revealRef: MutableRefObject<number>;
    scrollRef: MutableRefObject<ScrollSignal>;
    worldPosRef: MutableRefObject<Vector3>;
}

/**
 * Camera, water and interaction for the whale.
 *
 * The animator and the shared refs are owned by Hero, because the shockwave
 * lives in Hero's EffectComposer and has to reach the same animator this
 * component's click handler drives. The model suspends on its GLB; this
 * component does not, so the water and the light are in place before the
 * animal arrives — which is the right order: you see the sea first.
 *
 * The light rig is five fixed intensities, not driven by depth — a version
 * that varied them with scroll (see git history, `SceneLighting`) read as
 * artificial and washed out the whale's own texture, so this went back to
 * plain, static lights plus the god-ray beam in `LightRays`. The one thing
 * still driven by depth is how much of each light survives at all: faded to
 * near-zero at the bottom of the page, or the "descent" never actually gets
 * dark. See `FADE_FLOOR` below.
 */

/** Base intensity of each fixed light, at the surface. */
const AMBIENT_BASE = 0.2;
const SUN_BASE = 5.0;
const RIM_BASE = 2.0;
const FILL_BASE = 0.6;
const BOUNCE_BASE = 0.4;

/** Intensity multiplier at the deepest point. Not zero: a sliver of the rig
 *  survives so the whale keeps a silhouette rather than vanishing outright. */
const FADE_FLOOR = 0.05;

/** A tight, bright glint that tracks the whale's own world position rather
 *  than sitting fixed in the scene — the reference photo's blown-out sunbeam
 *  patch on the flank, and the fixed god-ray spotlight above can't chase it:
 *  the hero rest pose sits far off to one side (see `heroRestX`), well
 *  outside that light's cone. Offset up and toward the camera so it grazes
 *  the back/flank rather than hitting the belly face-on.
 *
 *  Kept soft (it was 36): the live sea's caustics and light shafts now carry
 *  the sunlight on the animal, and at full strength this burned a round
 *  white hotspot that read as gloss. It is SUNLIGHT, so it also goes with the
 *  sun as the dive deepens (the ocean table's `sun`), not with the slower
 *  general fade: a sunbeam patch at 200 m is what made the deep whale shiny. */
const HIGHLIGHT_BASE = 14;
const HIGHLIGHT_OFFSET: [number, number, number] = [1.4, 2.2, 2.4];

/** The contact beam: one shaft of surface light that finds the whale at the
 *  bottom of the page, the 3D half of the shaft the footer draws falling
 *  across "Let's chat." (`.footer-beam`). Dark until the page nears the
 *  bottom (contactBeam.ts), and exempt from `FADE_FLOOR` — it is the point of the
 *  frame. The offset puts the source above, a little left of and in front of
 *  the animal, matching the on-screen slant of the CSS shaft. */
const CONTACT_BEAM_PEAK = 70;
/** Above the whale and well toward the camera: light from in front is what
 *  the wet skin mirrors back at the viewer. From straight above, the whale
 *  only reflects it up and away, and reads as dull. */
const CONTACT_BEAM_OFFSET: [number, number, number] = [-3, 8, 7];
/** How slowly the source follows the whale, per second. The lag is the
 *  point: the lit patch slides along the body as the animal swims through
 *  it, instead of being welded to one spot. */
const CONTACT_BEAM_FOLLOW = 0.8;

const WhaleScene = ({ animator, revealRef, scrollRef, worldPosRef }: WhaleSceneProps) => {
    const [hovered, setHovered] = useState(false);
    // Shared with SurfacePrelude, which drives this camera's position and
    // orientation for the opening surface-to-dive beat (SOUNDING_PLAN.md
    // §4.10) and then leaves it at its resting pose. The future
    // CameraDirector (§4.3) takes over from there — it does not own the
    // camera element itself, so it can coexist with the prelude the same way.
    const cameraRef = useRef<PerspectiveCameraImpl>(null);

    const ambientRef = useRef<AmbientLight>(null);
    const sunRef = useRef<SpotLight>(null);
    const rimRef = useRef<DirectionalLight>(null);
    const fillRef = useRef<DirectionalLight>(null);
    const bounceRef = useRef<DirectionalLight>(null);
    const highlightRef = useRef<PointLight>(null);
    const contactRef = useRef<SpotLight>(null);
    const contactTargetRef = useRef<Object3D>(null);
    const footerRef = useRef<HTMLElement | null>(null);
    const contactShownRef = useRef(0);
    const contactAimRef = useRef<Vector3 | null>(null);
    // Smoothed separately from depth itself, so a fast scroll eases the
    // lights down rather than snapping them with every frame's depth value.
    const fadeRef = useRef(1);

    useEffect(() => {
        const cursorSpans = document.querySelectorAll('.Cursor span') as NodeListOf<HTMLElement>;
        cursorSpans.forEach((span) => {
            span.style.backgroundColor = hovered ? '#192655' : 'rgb(0, 195, 255)';
        });
    }, [hovered]);

    // A spotlight aims at its `target`, which must be a node in the scene
    // graph for its matrix to update — see the <object3D> below.
    useEffect(() => {
        if (contactRef.current && contactTargetRef.current) {
            contactRef.current.target = contactTargetRef.current;
        }
    }, []);

    useFrame((state, delta) => {
        const target = MathUtils.lerp(1, FADE_FLOOR, depthSignal.depth);
        const k = 1 - Math.exp(-2.6 * Math.min(delta, 0.05));
        fadeRef.current = MathUtils.lerp(fadeRef.current, target, k);
        const f = fadeRef.current;

        if (ambientRef.current) ambientRef.current.intensity = AMBIENT_BASE * f;
        if (sunRef.current) sunRef.current.intensity = SUN_BASE * f;
        if (rimRef.current) rimRef.current.intensity = RIM_BASE * f;
        if (fillRef.current) fillRef.current.intensity = FILL_BASE * f;
        if (bounceRef.current) bounceRef.current.intensity = BOUNCE_BASE * f;

        if (highlightRef.current) {
            const p = worldPosRef.current;
            highlightRef.current.position.set(
                p.x + HIGHLIGHT_OFFSET[0],
                p.y + HIGHLIGHT_OFFSET[1],
                p.z + HIGHLIGHT_OFFSET[2],
            );
            const sun = depthSignal.ocean.sun / OCEAN[0].sun;
            highlightRef.current.intensity = HIGHLIGHT_BASE * f * sun * sun;
        }

        if (contactRef.current && contactTargetRef.current) {
            // How far the footer has risen into the viewport. The footer
            // mounts outside this tree, hence the lazy lookup.
            footerRef.current ??= document.getElementById('chat');
            const top = footerRef.current?.getBoundingClientRect().top ?? Infinity;
            // Same curve and pace as the CSS half of the shaft (contactBeam.ts).
            const arrive = contactBeamTarget(top);
            const ease = 1 - Math.exp(-CONTACT_BEAM_EASE * Math.min(delta, 0.05));
            contactShownRef.current = MathUtils.lerp(contactShownRef.current, arrive, ease);

            // Light through a moving surface is never steady: two slow,
            // unrelated swells, so the glint on the skin breathes.
            const t = state.clock.elapsedTime;
            const shimmer = 1 + 0.18 * Math.sin(t * 1.1) * Math.sin(t * 0.63 + 1.7);
            contactRef.current.intensity = CONTACT_BEAM_PEAK * contactShownRef.current * shimmer;

            const whale = worldPosRef.current;
            const aim = (contactAimRef.current ??= whale.clone());
            aim.lerp(whale, 1 - Math.exp(-CONTACT_BEAM_FOLLOW * Math.min(delta, 0.05)));
            contactTargetRef.current.position.copy(aim);
            contactRef.current.position.set(
                aim.x + CONTACT_BEAM_OFFSET[0],
                aim.y + CONTACT_BEAM_OFFSET[1],
                aim.z + CONTACT_BEAM_OFFSET[2],
            );
        }
    });

    return (
        <>
            <PerspectiveCamera ref={cameraRef} makeDefault position={[0, 2, 10]} fov={100} />

            {SURFACE_PRELUDE_ENABLED && (
                <SurfacePrelude scrollRef={scrollRef} cameraRef={cameraRef} />
            )}

            {/* Takes the camera over once the prelude hands off: a slow lean
                toward the whale, an ease-in for the distant shots, a touch
                wider for the close pass. Never rotates. Mounted AFTER the
                prelude so its frame callback runs second. */}
            <CameraDirector cameraRef={cameraRef} />

            {/* Bubbles shed off the fluke near the surface. Its own boundary:
                it reads the model's bones, so it waits on the GLB like the
                whale does, and must not hold anything else back while it does. */}
            <Suspense fallback={null}>
                <BubbleWake />
            </Suspense>

            {/* Deep ocean ambient light for rich, dark shadows */}
            {/* <ambientLight ref={ambientRef} intensity={AMBIENT_BASE} color="#0d2b52" /> */}

            {/* Primary "God Ray" spotlight piercing through from the top surface */}
            <spotLight
                ref={sunRef}
                position={[0, 12, 0]}
                angle={0.6}
                penumbra={1}
                intensity={SUN_BASE}
                color="#aae5ff"
                distance={25}
            />

            {/* Top directional light for a wide, consistent rim light on the whale's back */}
            <directionalLight ref={rimRef} position={[0, 10, 2]} intensity={RIM_BASE} color="#719bad" />

            {/* Subtle side fill light to reveal the model's textures, curves, and contours */}
            <directionalLight ref={fillRef} position={[-5, 2, 5]} intensity={FILL_BASE} color="#89b9d1" />

            {/* Deep abyss bounce light coming from the dark depths below */}
            <directionalLight ref={bounceRef} position={[0, -10, -2]} intensity={BOUNCE_BASE} color="#040d1a" />

            {/* Tracks the whale (see HIGHLIGHT_OFFSET above) rather than
                sitting fixed in world space, so the reference photo's bright
                sunbeam patch on the flank follows wherever the animal is. */}
            <pointLight ref={highlightRef} intensity={HIGHLIGHT_BASE} color="#eaf6ff" distance={9} decay={1.4} />

            {/* The contact beam (see CONTACT_BEAM_OFFSET). Always mounted at
                zero rather than toggled: changing the light count recompiles
                every material, a visible hitch mid-scroll. */}
            <spotLight
                ref={contactRef}
                angle={0.75}
                penumbra={0.9}
                intensity={0}
                color="#bfeaff"
                distance={34}
                decay={1}
            />
            <object3D ref={contactTargetRef} />

            {/* The live sea: sky, surface, ripples, caustics, waterline. Its own
                boundary so the sky texture never holds the whale back. */}
            <Suspense fallback={null}>
                <Ocean />
            </Suspense>
            <Suspense fallback={null}>
                <WhaleWaterCoupling />
            </Suspense>
            {/* Spray off the body and the fine bubbles round broken water. */}
            <Spray />

            <Center
                onPointerOver={() => setHovered(true)}
                onPointerOut={() => setHovered(false)}
                onPointerDown={() => animator.triggerBurst()}>
                <WhaleModel
                    animator={animator}
                    revealRef={revealRef}
                    scrollRef={scrollRef}
                    worldPosRef={worldPosRef}
                />
            </Center>

            {/* From the top right, the side the sun is on (SUN_DIR), so that
                where these take over from the live shafts in the deep, the
                light still falls from one side at one angle. */}
            <LightRays revealRef={revealRef} raysOrigin="top-right" />

            {/* 512 wide: the whale only sees it through a rough, dim reflection
                (see scripts/visual/downsampleHdr.py); the 1k original is in
                media-src/retired-hdri/. */}
            <Environment files={SCENE_HDRI_URL} background={false} />
        </>
    );
};

export default WhaleScene;
