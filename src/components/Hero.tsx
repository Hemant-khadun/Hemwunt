import { EffectComposer, N8AO, Bloom } from '@react-three/postprocessing';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { Vector3 } from 'three';
import type { EffectComposer as EffectComposerImpl } from 'postprocessing';
import { ThreeTunnel } from './tunel';
import { IS_MOBILE } from '../utils/device';
import WhaleScene from './whale/WhaleScene';
import WhaleShockwave from './whale/WhaleShockwave';
import { UnderwaterVolume } from './ocean/underwaterVolume';
import { OceanGrade } from './ocean/oceanGrade';
import { LensDroplets } from './ocean/lensDroplets';
import { createWhaleAnimator } from '../animations/whaleAnimator';
import { useScrollSignal } from '../animations/scrollSignal';

/**
 * Resizes the post chain's buffers when the pixel ratio changes.
 *
 * The composer from @react-three/postprocessing resizes itself when the
 * canvas's CSS size changes, but not when only its pixel ratio does, and the
 * adaptive resolution (utils/Canvas.tsx) changes exactly that. Without this
 * the canvas would shrink while every pass went on rendering at the old size:
 * all of the softness, none of the saving.
 */
function ComposerFollowsDpr({ composer }: { composer: MutableRefObject<EffectComposerImpl | null> }) {
    const dpr = useThree((s) => s.viewport.dpr);
    const size = useThree((s) => s.size);
    const sizeRef = useRef(size);
    sizeRef.current = size;
    useEffect(() => {
        composer.current?.setSize(sizeRef.current.width, sizeRef.current.height);
    }, [composer, dpr]);
    return null;
}

/**
 * The homepage scene. Renders no DOM of its own — it pushes its 3D content
 * through the tunnel into the single global Canvas in `utils/Canvas.tsx`.
 *
 * This is the composition root for the whale. It owns the animator and the
 * shared refs because two separate branches of the tree need them: the scene
 * drives the whale, and the shockwave inside the EffectComposer watches the
 * whale's world position to know when it sweeps past the viewer.
 *
 * All of the movement maths lives in `animations/whaleAnimator`.
 */
const Hero = () => {
    const animator = useMemo(() => createWhaleAnimator(), []);
    const scrollRef = useScrollSignal();
    // Refs rather than state: these are written every frame and must not
    // re-render the tree sixty times a second.
    const revealRef = useRef(0);
    const worldPosRef = useRef(new Vector3());
    const composerRef = useRef<EffectComposerImpl | null>(null);

    return (
        <ThreeTunnel.In>
            <WhaleScene
                animator={animator}
                revealRef={revealRef}
                scrollRef={scrollRef}
                worldPosRef={worldPosRef}
            />
            {/* No normal pass: neither N8AO nor Bloom needs one, and it is
                off by default in this version of the library. */}
            <EffectComposer ref={composerRef}>
                {/* Ambient occlusion: the contact shadow in the whale's throat
                    grooves and under its flippers. The most expensive pass in
                    the chain, so a phone runs it at half resolution and with
                    fewer samples (depth-aware upsampling keeps the edges);
                    through water, grain and a small screen the two are hard to
                    tell apart, and a phone keeps the effect rather than losing
                    it. */}
                <N8AO
                    color="#0a1931"
                    aoRadius={3}
                    intensity={Math.PI * 1.5}
                    halfRes={IS_MOBILE}
                    depthAwareUpsampling
                    quality={IS_MOBILE ? 'performance' : undefined}
                />
                {/* Light shafts and the bubble cloud: the water between the lens
                    and the scene, so after AO and before the bloom that
                    softens them. */}
                <UnderwaterVolume />
                <Bloom
                    luminanceThreshold={0.4}
                    luminanceSmoothing={0.9}
                    height={300}
                    intensity={0.8}
                />
                <WhaleShockwave positionRef={worldPosRef} revealRef={revealRef} />
                {/* The water a wave leaves on the port: it bends everything
                    behind the glass, and lies under the grade's vignette. */}
                <LensDroplets />
                {/* The over/under photograph's grade: last, so nothing blurs it. */}
                <OceanGrade />
            </EffectComposer>
            <ComposerFollowsDpr composer={composerRef} />
        </ThreeTunnel.In>
    );
};

export default Hero;
