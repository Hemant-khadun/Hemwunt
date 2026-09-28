import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import gsap from 'gsap';
import { depthSignal } from '../animations/depthSignal';
import { OCEAN } from '../animations/oceanPalette';
import { prefersReducedMotion } from '../animations/motionPreference';
import { IS_MOBILE } from './device';
import { viewportHeight } from './viewport';

/**
 * The water column and the marine snow falling through it.
 *
 * This was a starfield — points rushing outward from the centre of the screen
 * on a black ground. Underwater, that read as warp speed rather than as water,
 * so the same layer now paints two things: the graded water behind
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
 * NOTHING HERE IS PAINTED PER FRAME. It was a 2D canvas that cleared and
 * redrew the whole screen every frame, and on an iPhone that canvas alone held
 * the page to 10-19 fps: Safari did work in proportion to the whole page each
 * time it changed (the `?perf` run on an iPhone 14 Pro: 11 fps with every bit
 * of WebGL switched off, 42 fps with only this switched off). So both halves
 * are now things the compositor moves by itself:
 *
 *   THE WATER. One full-screen gradient per stop of the ocean table, painted
 *   once and stacked. The depth shows the stop above it and fades in the one
 *   below by opacity, which is the table's own linear blend (in sRGB rather
 *   than linear light: a few levels apart at most, in these dark blues).
 *
 *   THE SNOW. Sheets of specks, far to near, each painted once as a pattern
 *   two screens tall that falls one screen and loops, by a CSS animation of
 *   its transform at its depth's speed, and sways on its own slow period. The
 *   parallax and drift the per-flake physics gave, for no work per frame. How
 *   much of it shows follows the table's `snow`, through the sheets' opacity.
 */

/** Specks across all the sheets. */
const DESKTOP_PARTICLES = 620;
const MOBILE_PARTICLES = 180;

/** Sheets, far to near. Each holds the specks of one slice of depth `z`. */
const SHEETS = 4;

/** Fall speed (px/s) of a speck at depth z (0 far, 1 near): marine snow
 *  sinks, it does not rain. */
const fallSpeed = (z: number) => 6 + z * 22;

/** The seconds of each sheet's sway (7.5 px either side, in styles.css):
 *  unrelated periods, so the sheets drift across each other. */
const SWAY_S = [15.7, 19.3, 13.1, 17.9];
/** The sheets are this much wider than the screen each side, so a sway never
 *  shows an edge (matches .water-column__sheet). */
const PAD = 16;

/** Opacity changes smaller than this are not written. */
const EPSILON = 1 / 512;

function paintSheet(canvas: HTMLCanvasElement, w: number, h: number, count: number, sheet: number) {
    canvas.width = w + PAD * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < count; i++) {
        const z = (sheet + Math.random()) / SHEETS;
        const x = Math.random() * canvas.width;
        const y = Math.random() * h;
        // Fades as the speck recedes; the nearest are a pixel bigger.
        const size = z > 0.7 ? 2 : 1;
        ctx.fillStyle = `rgba(214,238,247,${(0.12 + z * 0.5).toFixed(3)})`;
        // Twice, a screen apart: the loop's seam.
        ctx.fillRect(x, y, size, size);
        ctx.fillRect(x, y + h, size, size);
    }
}

/** The stop the depth is past, and how far toward the next (as sampleOcean). */
function stopAt(depth: number): [number, number] {
    const d = Math.min(1, Math.max(0, depth));
    let i = 0;
    while (i < OCEAN.length - 2 && d > OCEAN[i + 1].at) i++;
    const span = OCEAN[i + 1].at - OCEAN[i].at;
    return [i, span > 0 ? Math.min(1, Math.max(0, (d - OCEAN[i].at) / span)) : 0];
}

const fill: CSSProperties = { position: 'absolute', inset: 0 };

const MarineSnow = () => {
    const stops = useRef<Array<HTMLDivElement | null>>([]);
    const snow = useRef<HTMLDivElement>(null);
    const sheets = useRef<Array<HTMLCanvasElement | null>>([]);

    useEffect(() => {
        const budget = IS_MOBILE ? MOBILE_PARTICLES : DESKTOP_PARTICLES;
        const reduced = prefersReducedMotion();

        // --- The specks: painted once, and again only on a resize -------------
        let w = 0;
        let h = 0;
        const paint = () => {
            // CSS 100vh, not innerHeight: the address bar sliding in and out
            // must not repaint anything (see utils/viewport.ts).
            const nw = window.innerWidth;
            const nh = viewportHeight();
            if (nw === w && nh === h) return;
            w = nw;
            h = nh;
            sheets.current.forEach((canvas, s) => {
                if (!canvas) return;
                // One device pixel per CSS pixel, as the canvas always was:
                // sub-pixel specks and a soft upscale are the look.
                paintSheet(canvas, w, h, Math.round(budget / SHEETS), s);
                const speed = fallSpeed((s + 0.5) / SHEETS);
                canvas.style.animationDuration = `${(h / speed).toFixed(2)}s`;
            });
        };
        paint();
        window.addEventListener('resize', paint);

        // --- The water and the snow's density: opacities only ---------------
        const shown = new Float32Array(OCEAN.length + 1).fill(-1);
        const set = (k: number, el: HTMLElement | null, value: number) => {
            if (!el || Math.abs(value - shown[k]) < EPSILON) return;
            shown[k] = value;
            el.style.opacity = value.toFixed(3);
        };
        const write = () => {
            const [i, t] = stopAt(depthSignal.depth);
            // The stop the water is past, whole; the next fading in over it;
            // everything else out of the way.
            stops.current.forEach((el, k) => set(k, el, k === i ? 1 : k === i + 1 ? t : 0));
            const d = depthSignal.ocean.snow;
            // Fewer and fainter as it thins, as the old per-speck count and
            // alpha together were.
            set(OCEAN.length, snow.current, d * (0.35 + 0.65 * d));
        };
        write();
        gsap.ticker.add(write);

        if (reduced) {
            sheets.current.forEach((canvas) => canvas && (canvas.style.animation = 'none'));
        }

        return () => {
            gsap.ticker.remove(write);
            window.removeEventListener('resize', paint);
        };
    }, []);

    return (
        <div className="water-column" aria-hidden="true">
            {OCEAN.map((stop, k) => (
                <div
                    key={stop.label + k}
                    ref={(el) => {
                        stops.current[k] = el;
                    }}
                    className="water-column__stop"
                    style={{
                        ...fill,
                        // Light comes from above, so the near colour belongs at
                        // the top and the page darkens downward; the brighter
                        // band held shallow, to 45%, as it sits in open water.
                        background: `linear-gradient(to bottom, ${stop.waterNear} 0%, ${stop.waterNear} 45%, ${stop.waterFar} 100%)`,
                        opacity: k === 0 ? 1 : 0,
                    }}
                />
            ))}
            <div ref={snow} style={{ ...fill, opacity: 0 }}>
                {Array.from({ length: SHEETS }, (_, s) => (
                    <div
                        key={s}
                        className="water-column__sway"
                        style={{
                            ...fill,
                            animationDuration: `${SWAY_S[s % SWAY_S.length]}s`,
                            animationDelay: `${(-s * 3.7).toFixed(1)}s`,
                        }}>
                        <canvas
                            ref={(el) => {
                                sheets.current[s] = el;
                            }}
                            className="water-column__sheet"
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MarineSnow;
