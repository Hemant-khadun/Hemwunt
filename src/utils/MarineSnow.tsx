import { useEffect, useRef } from 'react';
import { depthSignal } from '../animations/depthSignal';
import { prefersReducedMotion } from '../animations/motionPreference';
import { frameBudget } from '../animations/frameBudget';
import { IS_MOBILE } from './device';
import { viewportHeight } from './viewport';

/**
 * The water column and the marine snow falling through it.
 *
 * This was a starfield — points rushing outward from the centre of the screen
 * on a black ground. Underwater, that read as warp speed rather than as water,
 * so the same 2D canvas now paints two things: the graded water behind
 * everything, and the detritus drifting down through it.
 *
 * Marine snow is real: a continuous fall of organic debris from the productive
 * water above. It is densest in the mid-water and thins out in the abyss,
 * which is why `snow` in the ocean table peaks at midnight rather than at the
 * bottom — the deep is emptier, not busier.
 *
 * Sits at z-index 0, BEHIND the WebGL canvas, so it is the backdrop the whale
 * is seen against rather than a veil over it.
 *
 * PERFORMANCE. The old implementation allocated a fresh radial gradient every
 * frame and built an `rgba(...)` string, then assigned `fillStyle`, once per
 * particle. At 100 stars that survived; at the ~600 this wants it would have
 * dominated the main thread on its own. Two changes fix it: the gradient is
 * rebuilt only when the water colour or the canvas size actually changes, and
 * particles are bucketed into a few brightness levels so `fillStyle` is
 * assigned a fixed handful of times per frame instead of once per particle.
 */

/** Brightness buckets. Eight is past the point where more is visible. */
const BUCKETS = 8;

/** Particle budget. The live count is this scaled by the depth signal. */
const DESKTOP_PARTICLES = 620;
const MOBILE_PARTICLES = 180;

interface Flake {
    x: number;
    y: number;
    /** 0 far, 1 near. Drives size, speed and brightness together, so a single
     *  value produces parallax rather than three uncorrelated ones. */
    z: number;
    /** Lateral drift, so the fall is a drift and not a rain. */
    drift: number;
    /** Phase offset for the sway, so they do not move as one sheet. */
    phase: number;
}

const MarineSnow = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        const budget = IS_MOBILE ? MOBILE_PARTICLES : DESKTOP_PARTICLES;

        let w = 0;
        let h = 0;
        let frame = 0;

        // --- Water gradient, cached --------------------------------------
        // Rebuilt only when the size or the sampled colours change. The
        // comparison is on the packed hex rather than on the Color objects,
        // which are mutated in place upstream and so are never !== each other.
        let gradient: CanvasGradient | null = null;
        let gradientKey = '';

        const ensureGradient = () => {
            const near = depthSignal.ocean.waterNear.getHexString();
            const far = depthSignal.ocean.waterFar.getHexString();
            const key = `${w}x${h}:${near}:${far}`;
            if (key === gradientKey && gradient) return gradient;

            const g = ctx.createLinearGradient(0, 0, 0, h);
            // Light comes from above, so the near colour belongs at the top and
            // the page darkens downward. The midpoint is pulled up to 0.45 to
            // keep the brighter band shallow, the way it sits in open water.
            g.addColorStop(0, `#${near}`);
            g.addColorStop(0.45, `#${near}`);
            g.addColorStop(1, `#${far}`);

            gradient = g;
            gradientKey = key;
            return g;
        };

        // --- Particles ----------------------------------------------------
        const flakes: Flake[] = [];

        const seed = (flake: Flake, atTop: boolean) => {
            flake.x = Math.random() * w;
            flake.y = atTop ? -10 : Math.random() * h;
            flake.z = Math.random();
            flake.drift = (Math.random() - 0.5) * 6;
            flake.phase = Math.random() * Math.PI * 2;
        };

        const build = () => {
            flakes.length = 0;
            for (let i = 0; i < budget; i++) {
                const f: Flake = { x: 0, y: 0, z: 0, drift: 0, phase: 0 };
                seed(f, false);
                flakes.push(f);
            }
        };

        // Bucketed draw lists. Reused every frame; only the length is reset,
        // so this allocates once for the life of the component.
        const buckets: Flake[][] = Array.from({ length: BUCKETS }, () => []);

        const resize = () => {
            // CSS 100vh, not innerHeight: on a phone the address bar sliding
            // in and out fires a resize every few scrolls, and each one used
            // to reallocate (and blank) this full-screen canvas for nothing.
            const nw = window.innerWidth;
            const nh = viewportHeight();
            if (nw === w && nh === h) return;
            w = nw;
            h = nh;
            // Deliberately 1 device pixel per CSS pixel. This canvas paints a
            // smooth gradient and sub-pixel specks; at DPR 2 it would cost
            // four times the fill for no visible gain, and it is running
            // alongside three WebGL contexts.
            canvas.width = w;
            canvas.height = h;
            gradientKey = '';
            if (flakes.length === 0) build();
        };

        resize();
        window.addEventListener('resize', resize);

        // --- Loop ----------------------------------------------------------
        let prev = performance.now();
        const reduced = prefersReducedMotion();

        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);

            // Clamped: a backgrounded tab hands over a multi-second delta,
            // which would teleport every flake past the bottom of the screen
            // and produce one frame of visibly empty water on return.
            const dt = Math.min((now - prev) / 1000, 0.05);
            prev = now;

            ctx.fillStyle = ensureGradient();
            ctx.fillRect(0, 0, w, h);

            const density = depthSignal.ocean.snow;
            // Halved when the frame budget is blown: the snow is dressing, and
            // the first thing to give up time to the whale and the light.
            const live = Math.floor(flakes.length * density * (frameBudget.degraded ? 0.5 : 1));
            if (live === 0) return;

            for (let b = 0; b < BUCKETS; b++) buckets[b].length = 0;

            const t = now * 0.001;

            for (let i = 0; i < live; i++) {
                const f = flakes[i];

                if (!reduced) {
                    // Near flakes fall faster and drift wider — the parallax
                    // is what gives the water volume. Slow in absolute terms:
                    // marine snow sinks, it does not rain.
                    const fall = 6 + f.z * 22;
                    f.y += fall * dt;
                    f.x += (f.drift + Math.sin(t * 0.4 + f.phase) * 3) * dt;

                    if (f.y > h + 10) seed(f, true);
                    if (f.x < -10) f.x = w + 10;
                    else if (f.x > w + 10) f.x = -10;
                }

                const bucket = Math.min(BUCKETS - 1, (f.z * BUCKETS) | 0);
                buckets[bucket].push(f);
            }

            // One fillStyle assignment per bucket, not per particle.
            for (let b = 0; b < BUCKETS; b++) {
                const list = buckets[b];
                if (list.length === 0) continue;

                const z = (b + 0.5) / BUCKETS;
                // Fades out as the flake recedes, and again as the water
                // itself darkens, so snow never floats brighter than the
                // medium it is suspended in.
                const alpha = (0.12 + z * 0.5) * (0.35 + 0.65 * density);
                const size = z > 0.7 ? 2 : 1;

                ctx.fillStyle = `rgba(214,238,247,${alpha.toFixed(3)})`;
                for (let i = 0; i < list.length; i++) {
                    ctx.fillRect(list[i].x, list[i].y, size, size);
                }
            }
        };

        frame = requestAnimationFrame(tick);

        return () => {
            // The old version cancelled nothing and also clobbered
            // `window.onresize`, so a remount left a second loop running
            // against a detached canvas.
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', resize);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                // As tall as the WebGL canvas in front of it (also 100vh), so
                // the two never disagree while the mobile address bar moves.
                height: '100vh',
                // Behind the WebGL canvas (z-index 1). This is the water the
                // whale is seen against, not a veil drawn over it.
                zIndex: 0,
                pointerEvents: 'none',
            }}
        />
    );
};

export default MarineSnow;
