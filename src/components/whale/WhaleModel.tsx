import { holdBudget } from '../../animations/frameBudget';
import { sceneMounted } from '../../utils/loader';
import { viewportHeight } from '../../utils/viewport';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, useEffect, useMemo } from 'react';
import { Group, MathUtils, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { MutableRefObject } from 'react';
import type { WhaleAnimator } from '../../animations/whaleAnimator';
import type { ScrollSignal } from '../../animations/scrollSignal';
import { depthFromScroll, depthSignal, publishDepth } from '../../animations/depthSignal';
import { OCEAN } from '../../animations/oceanPalette';
import { createDiveDirector } from '../../animations/diveDirector';
import { projectWhale } from '../../animations/screenProjector';
import { createWhaleOutline } from '../../animations/whaleOutline';
import {
    createWhaleDepthUniforms,
} from '../../animations/whaleDepthMaterial';
import { applyWhaleCaustics } from '../ocean/whaleCaustics';
import { createStorySwimmer } from '../../animations/whaleChoreography';
import { depthProgress, storyWhale } from '../../animations/story';
import { WHALE_CONFIG } from '../../animations/whaleConfig';
import { EYE_REST_Y, breachWave, eyeOffsetAt, holdCrash } from '../../animations/waterSignal';
import { createSpineFlex } from './spineFlex';

// Imported as a Vite asset rather than hard-coded as "/src/assets/...", which
// only ever resolved through the dev server.
import whaleModelUrl from '../../assets/models/humpback_whale.glb?url';

/** Rate (1/s) at which the difference between the story's pose and the
 *  physics' pose, left over at the handoff, is let go. */
const CARRY_RATE = 3;
const NO_TURN = new Quaternion();

interface WhaleModelProps {
    animator: WhaleAnimator;
    /** Written every frame so the light rays can fade in with the whale. */
    revealRef: MutableRefObject<number>;
    /** Page scroll, including whether the user is actively scrolling. */
    scrollRef: MutableRefObject<ScrollSignal>;
    /** Written every frame so the shockwave knows where the stroke landed.
     *  World space, so it already accounts for the <Center> offset. */
    worldPosRef: MutableRefObject<Vector3>;
}

/**
 * The whale mesh, plus the thin bridge between the animator and the scene graph.
 *
 * All movement decisions live in `whaleAnimator`. This component only samples
 * the page, hands those numbers over, and copies the result onto the group.
 */
export function WhaleModel({ animator, revealRef, scrollRef, worldPosRef }: WhaleModelProps) {
    const group = useRef<Group>(null);
    const { nodes, materials, animations } = useGLTF(whaleModelUrl);
    const { actions } = useAnimations(animations, group);

    // The body's depth gradient. Owned here rather than inside the material
    // module because this is the component that has the whale's world position
    // every frame, and the gradient has to travel with the animal.
    const depthUniforms = useMemo(() => createWhaleDepthUniforms(), []);

    // Composes a shot per portfolio item and hands the animator intent.
    const director = useMemo(() => createDiveDirector(), []);
    // The previous frame's heading, so a turn beat knows which way is back.
    const headingRef = useRef(1);
    // The story whale (swims a scripted route, keyed to scroll), and the
    // spine bend that lays the curve it is following onto its body.
    const swimmer = useMemo(() => createStorySwimmer(), []);
    const flex = useMemo(() => createSpineFlex(), []);
    // Its outline on the screen, for the words written in its wake.
    const outline = useMemo(() => createWhaleOutline(nodes), [nodes]);
    const rigPos = useMemo(() => new Vector3(), []);
    // THE HANDOFF: which of the two poses the whale is drawn from (the
    // story's or the physics'), and the difference carried across the last
    // switch between them.
    const scriptedRef = useRef<boolean | null>(null);
    const carryPos = useMemo(() => new Vector3(), []);
    const carryQ = useMemo(() => new Quaternion(), []);

    // MeshPhysicalMaterial rather than the GLB's own MeshStandardMaterial, so
    // the skin can carry a CLEARCOAT — a thin, separate specular layer on top
    // of the base shading that is what reads as wet rather than painted.
    // Cloned once per instance (not the drei-cached `materials.HumpbackWhale`
    // object directly): drei caches GLTF materials globally, so mutating that
    // one in place would leak into any other mount of this model.
    const whaleMaterial = useMemo(() => {
        const source = materials.HumpbackWhale as MeshStandardMaterial;
        // NOT `physical.copy(source)`: MeshPhysicalMaterial.copy() assumes its
        // argument is another MeshPhysicalMaterial and unconditionally copies
        // physical-only fields (e.g. `clearcoatNormalScale`, a Vector2) straight
        // off it — which do not exist on a plain MeshStandardMaterial and throw
        // on `undefined.copy()`. Carrying over exactly the properties the GLB's
        // material actually has sidesteps that entirely.
        const physical = new MeshPhysicalMaterial({
            map: source.map,
            normalMap: source.normalMap,
            normalScale: source.normalScale.clone(),
            roughnessMap: source.roughnessMap,
            metalnessMap: source.metalnessMap,
            aoMap: source.aoMap,
            aoMapIntensity: source.aoMapIntensity,
            emissiveMap: source.emissiveMap,
            emissive: source.emissive.clone(),
            emissiveIntensity: source.emissiveIntensity,
            color: source.color.clone(),
            roughness: source.roughness,
            metalness: source.metalness,
            envMap: source.envMap,
            envMapIntensity: source.envMapIntensity,
            side: source.side,
            transparent: source.transparent,
            opacity: source.opacity,
            alphaTest: source.alphaTest,
            vertexColors: source.vertexColors,
        });
        return physical;
    }, [materials]);

    useEffect(() => {
        // applyWhaleDepthGrading(whaleMaterial, depthUniforms);
        // Sunlight focused by the live surface, playing over the skin.
        applyWhaleCaustics(whaleMaterial);
        // The mesh is 1,562 vertices: every tubercle, barnacle and throat
        // groove lives in the normal map, not the geometry. Pushed past 1 so
        // that detail survives the grading up close, where a finished
        // underwater frame keeps it crisp. Much further and the lighting on
        // the low-poly silhouette starts to disagree with the bumps inside it.
        whaleMaterial.normalScale.set(1.35, 1.35);
        // The GLB's albedo is a light grey. Over a real underwater photograph
        // that read as a pale, milky cut-out; a humpback seen in water is dark
        // slate, with its form carried by highlights rather than by its base
        // tone. The colour FACTOR multiplies the texture, so the markings and
        // scars in the map are kept — only the overall value comes down.
        // A faint cool tint (rather than a neutral grey scalar) pulls the
        // skin a touch toward the hero photo's teal water, so the tail
        // reads as lit BY that water instead of pasted over it. Raised from
        // an earlier 0.55 flat scalar so the texture's own pale patches
        // (the pectoral fin, belly) read closer to the reference photo's
        // white wash rather than mid-grey — the dark slate areas stay dark
        // since they were already near-black in the source texture and this
        // is a multiply, not an exposure lift.
        whaleMaterial.color.setRGB(0.66, 0.71, 0.74);
        // Wet specular starting point; both are re-driven by depth every frame
        // below, this just avoids one frame of the material's copied defaults
        // (clearcoat 0) before the first useFrame runs.
        whaleMaterial.clearcoat = 0.12;
        whaleMaterial.clearcoatRoughness = 0.6;
        whaleMaterial.specularIntensity = 0.4;
    }, [whaleMaterial, depthUniforms]);

    // Suspense guarantees this component mounts only once the GLB has resolved,
    // so this is the exact moment the model became ready. No progress polling.
    useEffect(() => {
        animator.beginReveal();
        // The skinned, physically shaded whale compiles its shaders and
        // uploads its textures now: a stall, not a slow machine.
        holdBudget(3000);
        // Behind the page's loader, which opens once the sea is in too and
        // the stall is past; the whale's fade-in plays out as it opens.
        sceneMounted('whale');
    }, [animator]);

    useEffect(() => {
        Object.values(actions || {}).forEach((action) => action?.play());
    }, [actions]);

    useFrame((state, delta) => {
        const whale = group.current;
        if (!whale) return;

        // 1. SAMPLE THE PAGE
        // Scroll comes from the ScrollTrigger-backed signal rather than a raw
        // window read, because it also carries whether the page is moving.
        const scroll = scrollRef.current;

        // The director composes the shot for this scroll position and hands
        // the animator an intent. It never touches the whale directly; before
        // the page is measured it returns undefined and the animator falls
        // back to its own linear map.
        const intent = director.update(scroll.y, scroll.max, animator, headingRef.current);

        const frame = animator.update({
            dt: delta,
            elapsed: state.clock.getElapsedTime(),
            scrollY: scroll.y,
            maxScroll: scroll.max,
            viewportHeight: viewportHeight(),
            scrollActive: scroll.active,
            intent,
            // The deeper the page, the heavier the animal: a click at 200 m
            // is a hard lunge, at 4000 m a tired half-stroke. Last frame's
            // depth (published below), which is 16 ms stale and invisible.
            burstScale: 1 - depthSignal.depth * 0.65,
        });

        // 2. APPLY THE RESULT
        // Through the opening story the whale swims a route keyed to scroll —
        // one move per chapter (see whaleChoreography.ts) — and physics is
        // re-seeded onto it every frame, so that when the story hands the
        // animal back it swims on from exactly where it is.
        const vh = viewportHeight();
        // The clip's stroke phase, so the body's heave rides the stroke that
        // is actually showing (the clip beats clipBaseHz at timeScale 1).
        const clip = actions ? Object.values(actions)[0] : undefined;
        // <Center> offsets the rig, so the sea's level is moved into it.
        whale.parent?.getWorldPosition(rigPos);
        const chor = swimmer.update({
            scroll: scroll.y / vh,
            dt: delta,
            time: state.clock.getElapsedTime(),
            aspect: state.size.width / Math.max(1, state.size.height),
            strokePhase: clip ? clip.time * WHALE_CONFIG.clipBaseHz * Math.PI * 2 : null,
            // Where it was drawn last frame, so the breach home starts from
            // wherever it really is (see THE LEAP in whaleChoreography.ts).
            drawn: whale,
            surfaceY: EYE_REST_Y - eyeOffsetAt(0) - rigPos.y,
        });
        // No wave swamps the lens mid-breach.
        if (chor.breaching) holdCrash();

        // THE HANDOFF. The story and the physics each pose the whale, and it
        // is drawn from one or the other, never an average of the two: they
        // swim different courses, and a blend of two courses is a body
        // sliding along neither, the way it faces or not. While the story
        // has it, the physics is re-seeded onto it every frame (pose, speed
        // and beat), so at the switch the two agree. What little they don't
        // (each has its own heave and sway) is carried over from the pose it
        // was last drawn in, and let go, so it never jumps.
        const scripted = chor.weight > 0.5;
        const pose = scripted ? chor : frame;
        if (scriptedRef.current !== null && scripted !== scriptedRef.current) {
            carryPos.copy(whale.position).sub(pose.position);
            carryQ.copy(pose.quaternion).invert().premultiply(whale.quaternion);
        }
        scriptedRef.current = scripted;
        const keep = Math.exp(-CARRY_RATE * delta);
        carryPos.multiplyScalar(keep);
        carryQ.slerp(NO_TURN, 1 - keep);
        whale.position.copy(pose.position).add(carryPos);
        whale.quaternion.copy(carryQ).multiply(pose.quaternion);
        if (scripted) {
            animator.follow(chor.position, chor.yaw, chor.pitch, chor.roll, {
                speed: chor.speed,
                tailHz: chor.tailSpeed * WHALE_CONFIG.clipBaseHz,
            });
        }
        whale.visible = frame.visible;
        headingRef.current = frame.heading;
        // After the mixer has posed the spine for this frame.
        flex.update(whale, delta);

        // 3. DRIVE THE BAKED SWIM CLIP AT THE COMPUTED TAIL BEAT
        const tailSpeed = pose.tailSpeed;
        Object.values(actions || {}).forEach((action) => {
            if (action) action.timeScale = tailSpeed;
        });

        revealRef.current = frame.revealFactor;

        // 4. PUBLISH WORLD POSITION for the shockwave epicentre, and its
        // projection onto the screen for the DOM — the portfolio reveals open
        // where the whale swept past (see useWhaleWake).
        whale.getWorldPosition(worldPosRef.current);
        // Landing from the breach, it sends a wave out across the sea.
        if (chor.splashdown) breachWave(worldPosRef.current.x, worldPosRef.current.z);
        projectWhale(worldPosRef.current, state.camera);
        // ...and its whole outline, and where it is on the story's route, so
        // the story can write its last phrase in the whale's wake.
        if (whale.visible) outline.update(whale, state.camera);
        storyWhale.progress = chor.progress;
        storyWhale.at = performance.now();
        if (import.meta.env.DEV) {
            const p = worldPosRef.current;
            const f = rigPos.set(1, 0, 0).applyQuaternion(whale.quaternion);
            (window as unknown as Record<string, unknown>).__whale = {
                world: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
                chor: [+chor.position.x.toFixed(2), +chor.position.y.toFixed(2), +chor.position.z.toFixed(2)],
                phys: [+frame.position.x.toFixed(2), +frame.position.y.toFixed(2), +frame.position.z.toFixed(2)],
                // Which way the drawn body faces (its nose), unit vector.
                fwd: [+f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2)],
                ypr: [+chor.yaw.toFixed(2), +chor.pitch.toFixed(2), +chor.roll.toFixed(2)],
                weight: chor.weight,
                carry: +carryPos.length().toFixed(3),
                progress: +chor.progress.toFixed(3),
            };
        }

        // 5. PUBLISH DEPTH
        // This is the one place in the app that has the frame, the page and
        // the whale's world position at the same time, so it is where the
        // depth signal is written. Everything else — the light rig, the rays,
        // the marine snow, the CSS backdrop — reads it.
        //
        // Page progress is not depth: the page ends with an ascent, so the
        // curve rises and comes back down. See `depthFromScroll`.
        // The story between the hero and the projects counts for only part of
        // its length, so the projects keep the depths they were tuned at.
        const progress = depthProgress(scroll.y, scroll.max);
        publishDepth(depthFromScroll(progress), frame.revealFactor, delta);

        // 6. GRADE THE BODY
        // World Y, not the animator's local value: <Center> in WhaleScene
        // shifts the whole rig, and the gradient has to agree with where the
        // animal actually is, not where the physics thinks it is.
        const { ocean, depth } = depthSignal;
        depthUniforms.uWhaleY.value = worldPosRef.current.y;
        depthUniforms.uSceneDepth.value = depth;
        depthUniforms.uWaterNear.value.copy(ocean.waterNear);
        depthUniforms.uWaterFar.value.copy(ocean.waterFar);
        depthUniforms.uWaterBlend.value = ocean.waterBlend;
        // Normalised against the surface's own sun value rather than a magic
        // constant, so the sunlit-top highlight always tracks the ocean
        // table's own tuning of how much direct light is left at this depth.
        depthUniforms.uTopGlow.value = ocean.sun / OCEAN[0].sun;

        // The night-sky HDRI keeps the wet-skin specular alive near the
        // surface, but at 4000m any environment contribution is light arriving
        // from nowhere. Three 0.160 has no scene-level environment intensity,
        // so the material is the only place to turn it down.
        const settle = 1 - Math.exp(-2.6 * Math.min(delta, 0.05));
        whaleMaterial.envMapIntensity = MathUtils.lerp(
            whaleMaterial.envMapIntensity,
            // Low even at the surface: any higher and the HDRI's moon — a
            // small, very bright disc baked into the sky — mirrors off the
            // skin as a distinct white blob. And underwater there is barely
            // any reflection to give (see SUBMERGED SKIN below).
            0.1 - depth * 0.09,
            settle,
        );

        // SUBMERGED SKIN IS NEARLY MATTE. A wet sheen is the water film
        // against AIR; under water, skin (n ~1.4) against water (1.33)
        // reflects well under a tenth of a percent, against ~3% in air. So
        // the whale's form underwater comes from its diffuse light, the
        // caustics and the water's haze, and a glossy whale at depth reads as
        // plastic. The part that breaks the surface gets its wet sheen from
        // the daylight pass in components/ocean/whaleCaustics.ts instead.
        // This is the roughness FACTOR, multiplied into the texture's own
        // roughness channel, so the map's variation is kept.
        whaleMaterial.roughness = MathUtils.lerp(
            whaleMaterial.roughness,
            0.84 + depth * 0.16,
            settle,
        );
        whaleMaterial.specularIntensity = MathUtils.lerp(
            whaleMaterial.specularIntensity,
            0.4 - depth * 0.25,
            settle,
        );

        // Clearcoat: the tighter specular layer that read as a water film on
        // the skin. Kept only as a trace near the surface, where the light
        // is strong enough to find the tubercles; gone with depth.
        whaleMaterial.clearcoat = MathUtils.lerp(
            whaleMaterial.clearcoat,
            0.12 * (1 - depth),
            settle,
        );
        whaleMaterial.clearcoatRoughness = MathUtils.lerp(
            whaleMaterial.clearcoatRoughness,
            // Floored well above a mirror finish: at 0.15 the clearcoat was
            // sharp enough to reflect the HDRI's moon as a crisp, distinct
            // disc — a wet sheen should blur it into a soft highlight, not
            // hold a recognisable copy of the sky.
            0.6 + depth * 0.4,
            settle,
        );
    });

    return (
        <group ref={group} dispose={null} visible={false}>
            <group name="Sketchfab_Scene">
                {/* Body size. Scaling this REQUIRES scaling the length-based
                    constants in whaleConfig.ts by the same factor, or the tail
                    beat stops matching the distance covered and the whale
                    slips. See the SIZING note at the top of that file. */}
                <group name="Sketchfab_model" rotation={[-Math.PI / 2, 0, 0]} scale={0.0045}>
                    <group name="HumpbackWhaleAnimfbx" rotation={[Math.PI / 2, 0, 0]}>
                        <group name="Object_2">
                            <group name="RootNode">
                                <group
                                    name="Armature"
                                    position={[0, 0, -150]}
                                    rotation={[-Math.PI / 2, -Math.PI / 8, Math.PI / 2]}
                                    scale={500}>
                                    <group name="Object_5">
                                        <primitive object={nodes._rootJoint} />
                                        <skinnedMesh
                                            name="Object_34"
                                            geometry={(nodes.Object_34 as SkinnedMesh).geometry}
                                            material={whaleMaterial}
                                            skeleton={(nodes.Object_34 as SkinnedMesh).skeleton}
                                        />
                                        <group
                                            name="Object_33"
                                            rotation={[-Math.PI / 2, 0, 0]}
                                            scale={100}
                                        />
                                    </group>
                                </group>
                                <group name="Vert" rotation={[-Math.PI / 2, 0, 0]} scale={100} />
                            </group>
                        </group>
                    </group>
                </group>
            </group>
        </group>
    );
}

useGLTF.preload(whaleModelUrl);

export default WhaleModel;
