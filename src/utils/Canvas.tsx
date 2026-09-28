import { Canvas as R3fCanvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState } from 'react';
import { ThreeTunnel } from '../components/tunel';
import { enableResolutionScaling, frameBudget, holdBudget } from '../animations/frameBudget';
import { MAX_DPR } from './device';
import { perfOff } from './perf';

/** `?perf` switch (utils/perf.ts): a ninth of the pixels. */
const PERF_DPR = perfOff('dpr') ? MAX_DPR / 3 : 0;

/** Never below this pixel ratio, however far the ladder steps down. */
const MIN_DPR = 0.5;

/**
 * Applies the frame budget's resolution rung to the canvas (see
 * animations/frameBudget.ts): the whole scene, every effect included, renders
 * at `MAX_DPR * resolution`. Compared against the live pixel ratio every
 * frame rather than on change, so nothing else resetting it (R3F reapplies
 * the Canvas's own `dpr` prop when it re-renders) can leave it stale.
 */
function AdaptiveResolution() {
    useEffect(() => {
        enableResolutionScaling(true);
        // Creating the context and compiling the first shaders are one-off
        // stalls, not a slow machine.
        holdBudget(4000);
        return () => enableResolutionScaling(false);
    }, []);

    useFrame((state) => {
        const want = PERF_DPR || Math.max(MIN_DPR, Math.round(MAX_DPR * frameBudget.resolution * 100) / 100);
        if (Math.abs(state.viewport.dpr - want) > 0.005) state.setDpr(want);
    });

    return null;
}

const Canvas = () => {
    // A lost WebGL context (a phone reclaiming GPU memory from a backgrounded
    // tab, a driver reset) comes back empty: three restores its own state, but
    // not the environment map, the water simulation or anything else rendered
    // into a target. Remounting the canvas on restore rebuilds all of it; the
    // scene's own state (the animator, the story) lives outside and carries on.
    const [generation, setGeneration] = useState(0);
    const lost = useRef(false);

    return (
        // Stacking and hit-testing live in the `.whale-layer` rule in
        // styles.css, not inline: the front pass raises this layer above the
        // page by toggling a class, and an inline z-index would always win.
        <div
            className="whale-layer"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
            }}>
            {/* Device pixel ratio capped at MAX_DPR (1.5) and scaled down from
                there by the frame budget. No antialias on the canvas itself:
                the EffectComposer renders the scene into its own multisampled
                buffer, and all that ever reaches this one is a full-screen
                quad, so canvas MSAA was memory and bandwidth for nothing. */}
            <R3fCanvas
                key={generation}
                eventSource={document.body}
                eventPrefix="client"
                dpr={MAX_DPR}
                gl={{ antialias: false, powerPreference: 'high-performance' }}
                onCreated={({ gl }) => {
                    const canvas = gl.domElement;
                    canvas.addEventListener('webglcontextlost', () => {
                        lost.current = true;
                        console.warn('[scene] WebGL context lost; rebuilding the scene when it is restored.');
                    });
                    canvas.addEventListener('webglcontextrestored', () => {
                        if (!lost.current) return;
                        lost.current = false;
                        setGeneration((g) => g + 1);
                    });
                }}>
                <AdaptiveResolution />
                <Suspense fallback={null}>
                    <ThreeTunnel.Out />
                </Suspense>
            </R3fCanvas>
        </div>
    );
};

export default Canvas;
