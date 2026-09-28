import { useEffect } from 'react';
import gsap from 'gsap';
import { depthSignal } from './depthSignal';
import { createOceanSample, sampleOcean } from './oceanPalette';

/**
 * Bridges the depth signal into CSS custom properties on :root.
 *
 * Everything outside the WebGL canvas reads depth through here — the section
 * backdrops, the depth plates, the footer's ascent grade. One writer, so the
 * DOM can never disagree with the scene about how deep the page is.
 *
 * Runs on the EXISTING `gsap.ticker`, which `SmoothScroll` already drives from
 * Lenis. A fourth requestAnimationFrame loop alongside the R3F loop, the
 * marine snow and Lenis itself would be a real cost for no benefit, and it
 * would also read depth at a different moment in the frame than everything
 * else does.
 *
 * QUANTIZATION is the important part. Setting a custom property on :root
 * invalidates style for every element that inherits it, which is a
 * whole-document style recalculation. Doing that sixty times a second buys a
 * full recalc per frame for a change nobody can perceive. Writing in steps
 * instead comes to a few dozen writes across an entire read of the page, and
 * a CSS transition on the consuming rules smooths the steps back out — so the
 * result is both cheaper AND smoother than writing continuously.
 */

/** Steps across the full depth range. 48 is past the point where a further
 *  step is visible once the consuming rules carry a transition. */
const DEPTH_STEPS = 48;

export function useDepthCss(): void {
    useEffect(() => {
        const root = document.documentElement;

        let lastDepth = -1;
        let lastZone = -1;
        let lastNear = '';
        let lastFar = '';
        // The colours are sampled at the QUANTIZED depth. Read off the live
        // signal they changed on nearly every frame of a scroll, and each
        // write restyled the whole document all the same.
        const ocean = createOceanSample();

        const write = () => {
            const { depth, zone } = depthSignal;

            const q = Math.round(depth * DEPTH_STEPS) / DEPTH_STEPS;
            if (q !== lastDepth) {
                lastDepth = q;
                root.style.setProperty('--depth', String(q));
                sampleOcean(q, ocean);
            }

            if (zone !== lastZone) {
                lastZone = zone;
                root.style.setProperty('--zone', String(zone));
            }

            // The water colours come back as three.js Colors that are mutated
            // in place, so they are never !== each other. Compare the packed
            // hex instead, which is also exactly what we are about to write.
            const near = ocean.waterNear.getHexString();
            if (near !== lastNear) {
                lastNear = near;
                root.style.setProperty('--water-near', `#${near}`);
            }

            const far = ocean.waterFar.getHexString();
            if (far !== lastFar) {
                lastFar = far;
                root.style.setProperty('--water-far', `#${far}`);
            }
        };

        write();
        gsap.ticker.add(write);
        return () => {
            gsap.ticker.remove(write);
        };
    }, []);
}

export default useDepthCss;
