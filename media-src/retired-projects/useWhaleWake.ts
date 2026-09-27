import { useEffect, useMemo } from 'react';
import type { RefObject } from 'react';
import { MathUtils } from 'three';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { whaleScreen } from './screenProjector';

/**
 * Opens a portfolio item's reveal where the whale swept past it.
 *
 * Each item dissolves in through a growing circular mask. On its own that
 * circle always opens from the centre, and the whale is just scenery going on
 * behind it. Moving the ORIGIN of the dissolve to wherever the whale is on
 * screen at that moment makes the animal read as the cause of the reveal
 * rather than as a background animation — the image opens in its wake.
 *
 * Three rules keep this cheap and keep it looking right:
 *
 *   LATCH, DON'T TRACK. The origin is sampled once, on the first scrub update
 *   of the reveal, and then held. Tracking it while the radius grows would
 *   rubber-band the revealed region across the image and read as broken —
 *   and every write to the masked circle re-runs the SVG turbulence filter on
 *   it, which is software-rastered. One `setAttribute` per reveal.
 *
 *   LATCH AT RADIUS ~0. Sampled on the first update after the scrub leaves
 *   zero, while the circle is still essentially a point, so the move from the
 *   default centre is invisible. Sampling any later is a visible hop.
 *
 *   NEVER MEASURE PER FRAME. The SVG's geometry is cached on ScrollTrigger's
 *   refresh (which covers resizes and layout changes) and nowhere else.
 *   Reading layout inside a scroll callback, on a subtree GSAP is actively
 *   transforming, forces a synchronous reflow.
 *
 * Re-arms once the scrub returns to zero, so scrolling back above an item and
 * down again latches afresh. An item arrived at mid-reveal — a deep link, a
 * jump from the nav — keeps the centred origin rather than latching late.
 */

/** Furthest the origin may move from centre, in the mask's 0..100 units.
 *  Further than this and the far side of the image is left waiting too long
 *  for the circle to reach it. */
export const MAX_CX_OFFSET = 18;

/** Scrub progress at or below which the reveal counts as closed (re-arms). */
const ARM_BELOW = 0.001;

/** A first update landing past this means the reveal was entered mid-way,
 *  not grown from nothing, and latching now would visibly jump. */
const LATCH_WINDOW = 0.1;

export interface WhaleWake {
    /** Call from the reveal tween's onUpdate with its 0..1 progress. */
    update(progress: number, mask: SVGCircleElement): void;
    /** Distance the latched origin sits from centre, in mask units. The reveal
     *  adds this to its radius so the far side is still fully covered. */
    readonly extra: number;
}

export function useWhaleWake(svgRef: RefObject<SVGSVGElement>, viewBoxHeight: number): WhaleWake {
    const wake = useMemo(() => {
        // Cached geometry. `docLeft` is document-space, so it stays valid as
        // the page scrolls vertically and only goes stale on refresh.
        let docLeft = 0;
        let width = 0;
        let height = 0;
        let vbHeight = 100;
        let measured = false;

        let armed = true;
        let extra = 0;

        return {
            measure(el: SVGSVGElement, vh: number) {
                vbHeight = vh;
                const rect = el.getBoundingClientRect();
                docLeft = rect.left + window.scrollX;
                width = rect.width;
                height = rect.height;
                measured = width > 0 && height > 0;
            },

            get extra() {
                return extra;
            },

            update(progress: number, mask: SVGCircleElement) {
                if (progress <= ARM_BELOW) {
                    if (!armed) {
                        armed = true;
                        extra = 0;
                        mask.setAttribute('cx', '50');
                    }
                    return;
                }
                if (!armed) return;
                armed = false;

                if (progress > LATCH_WINDOW || !measured) return;

                // The media box's viewBox is 100 x vbHeight, matching the
                // image's own aspect ratio, under preserveAspectRatio=
                // "xMidYMin meet": scaled by the SMALLER ratio (the two only
                // ever differ if CSS sizing can't hit the exact ratio),
                // centred horizontally, pinned to the top. Invert that to
                // take a viewport X into mask units.
                const s = Math.min(width / 100, height / vbHeight);
                const originX = docLeft - window.scrollX + (width - 100 * s) / 2;
                const localX = (whaleScreen.x - originX) / s;

                // Blend back toward centre as the whale leaves the frame, so a
                // whale that has swum off screen does not throw the origin into
                // a corner it is nowhere near.
                const influence = whaleScreen.valid ? 1 - whaleScreen.edgeFalloff : 0;
                const cx = MathUtils.clamp(
                    MathUtils.lerp(50, localX, influence),
                    50 - MAX_CX_OFFSET,
                    50 + MAX_CX_OFFSET,
                );

                extra = Math.abs(cx - 50);
                mask.setAttribute('cx', cx.toFixed(2));
            },
        };
    }, []);

    useEffect(() => {
        const el = svgRef.current;
        if (!el) return;

        const measure = () => wake.measure(el, viewBoxHeight);
        measure();
        ScrollTrigger.addEventListener('refresh', measure);
        return () => ScrollTrigger.removeEventListener('refresh', measure);
    }, [svgRef, wake, viewBoxHeight]);

    return wake;
}

export default useWhaleWake;
