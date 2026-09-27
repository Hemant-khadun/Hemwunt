import { useEffect } from 'react';
import Lenis from 'lenis';
import type { VirtualScrollData } from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Shared instance so other scroll-aware pieces (e.g. the custom Scrollbar's
// drag handler) can nudge Lenis directly instead of fighting it with raw
// window.scrollTo calls.
let lenisInstance: Lenis | null = null;

export const getLenis = () => lenisInstance;

// Sees every wheel and touch input before Lenis scrolls with it, and swallows
// it by returning false: the story plays one scene per gesture (ScrollBeats).
let scrollInput: ((data: VirtualScrollData) => boolean) | null = null;

export const setScrollInput = (hook: ((data: VirtualScrollData) => boolean) | null) => {
    scrollInput = hook;
};

// True while the page is moving itself — a settle-snap (ScrollBeats) — rather
// than being moved by the visitor. The whale reads scroll activity as intent:
// while the page scrolls it commits to a dive attitude, and when it stops it
// relaxes to level. A snap is movement nobody asked for, so without this flag
// every settle re-raised that commitment for its 0.6 s and the whale gave a
// small pitch twitch each time the page came to rest.
let snapping = false;

export const isSnapping = () => snapping;
export const setSnapping = (value: boolean) => {
    snapping = value;
};

// Drives the whole site's scroll through Lenis for the eased, weighted feel
// the on-scroll filter effect is built around (the original codrops demo
// itself runs on Lenis with these same settings), synced to GSAP's ticker so
// ScrollTrigger stays perfectly in step with the smoothed position.
const SmoothScroll = () => {
    useEffect(() => {
        const lenis = new Lenis({
            // Lower lerp = more smoothing but more lag between input and actual
            // scroll position - since our scroll-triggered animations fire at a
            // fixed scroll position, too much lag makes them feel like they start
            // late. 0.1 (the demo's own value) was noticeably laggy here; this is
            // tuned snappier while keeping the eased, weighted feel.
            lerp: 0.22,
            smoothWheel: true,
            virtualScroll: (data) => scrollInput?.(data) ?? true,
        });
        lenisInstance = lenis;

        lenis.on('scroll', ScrollTrigger.update);

        const tick = (time: number) => {
            lenis.raf(time * 1000);
        };
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);

        return () => {
            gsap.ticker.remove(tick);
            lenis.destroy();
            lenisInstance = null;
        };
    }, []);

    return null;
};

export default SmoothScroll;
