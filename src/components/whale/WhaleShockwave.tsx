import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { ShockWaveEffect } from 'postprocessing';
import { Vector3 } from 'three';
import type { MutableRefObject } from 'react';
import { createPassDetector } from '../../animations/passDetector';
import { WHALE_CONFIG as C } from '../../animations/whaleConfig';

interface WhaleShockwaveProps {
    /** Whale world position, written by the model every frame. */
    positionRef: MutableRefObject<Vector3>;
    /** Reveal progress, so no wave fires while the whale is still arriving. */
    revealRef: MutableRefObject<number>;
}

/**
 * The pressure wave the whale throws off as it sweeps past the viewer.
 *
 * Fires on PROXIMITY: the detector watches the whale's distance to the camera
 * and triggers at the nearest point of a crossing, so the wave belongs to the
 * animal passing in front of you rather than to a click.
 *
 * Built on `ShockWaveEffect` from `postprocessing` rather than a hand-written
 * ripple shader: it already does the expanding radial UV displacement.
 *
 * It is instantiated directly and mounted through `<primitive>` instead of via
 * the `ShockWave` wrapper from @react-three/postprocessing. The wrapper builds
 * its constructor arguments as a single options object, but the real signature
 * is `(camera, position, options)`, and it memoises those arguments on
 * `JSON.stringify(props)`, which throws on a camera that is in the scene graph.
 *
 * The epicentre is set once, at the moment of closest approach, then left
 * alone: the wave spreads from the water that was displaced, it does not follow
 * the whale out of the area.
 */
const WhaleShockwave = ({ positionRef, revealRef }: WhaleShockwaveProps) => {
    const camera = useThree((s) => s.camera);

    const effect = useMemo(
        () =>
            new ShockWaveEffect(camera, new Vector3(), {
                speed: C.shockSpeed,
                maxRadius: C.shockMaxRadius,
                waveSize: C.shockWaveSize,
                amplitude: C.shockAmplitude,
            }),
        [camera],
    );

    const detector = useRef(
        createPassDetector({
            triggerDistance: C.shockTriggerDistance,
            armDistance: C.shockArmDistance,
        }),
    );

    useFrame(() => {
        // Hold off until the whale has finished swimming in from the depths.
        // During the reveal it covers 45 units straight toward the camera,
        // which would otherwise read as one enormous approaching pass.
        if (revealRef.current < 1) return;

        const distance = camera.position.distanceTo(positionRef.current);
        if (detector.current.update(distance)) {
            effect.position.copy(positionRef.current);
            effect.explode();
        }
    });

    useEffect(() => () => effect.dispose(), [effect]);

    return <primitive object={effect} />;
};

export default WhaleShockwave;
