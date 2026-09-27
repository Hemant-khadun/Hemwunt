import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { isSnapping } from '../utils/SmoothScroll';

gsap.registerPlugin(ScrollTrigger);

/**
 * Page scroll, as the whale needs to see it.
 *
 * Why ScrollTrigger rather than reading `window.scrollY` in the frame loop:
 * the only thing the raw value cannot tell us is whether the user is still
 * scrolling. Deriving that from a velocity threshold flickers on and off
 * through the decaying tail of a flick, and on trackpads and smooth-scrolling
 * browsers that tail is long. ScrollTrigger already tracks the scroller
 * properly, so `active` comes from "did an update arrive recently", which is
 * stable through momentum and goes false exactly once the page is at rest.
 *
 * Deliberately NOT used: MotionPathPlugin. Putting the whale on a path would
 * replace the locomotion model with a fixed route, and the property that makes
 * it read as a real animal — that it travels where its body points, so pitch is
 * what carries it down — only exists because position is integrated from the
 * physics rather than keyframed.
 *
 * Exposed as a ref, not state: the frame loop reads this sixty times a second
 * and must not re-render the React tree to do it.
 */
export interface ScrollSignal {
    /** Current scroll offset in pixels. */
    y: number;
    /** Total scrollable distance, i.e. scrollHeight - innerHeight. */
    max: number;
    /** True while the page is actually moving, momentum included. */
    active: boolean;
}

/** How long after the last scroll update the page counts as at rest. */
const IDLE_MS = 120;

export function useScrollSignal(): MutableRefObject<ScrollSignal> {
    const ref = useRef<ScrollSignal>({ y: 0, max: 0, active: false });

    useEffect(() => {
        const signal = ref.current;
        let idle: ReturnType<typeof setTimeout> | undefined;

        const read = () => {
            signal.y = window.scrollY;
            signal.max = Math.max(0, ScrollTrigger.maxScroll(window));
        };

        const trigger = ScrollTrigger.create({
            start: 0,
            end: 'max',
            onUpdate: () => {
                read();
                // Position always updates — the director needs to know where
                // the page is — but a settle-snap does not count as the
                // visitor scrolling, so it cannot re-commit the dive attitude.
                if (isSnapping()) return;
                signal.active = true;
                if (idle) clearTimeout(idle);
                idle = setTimeout(() => {
                    signal.active = false;
                }, IDLE_MS);
            },
            onRefresh: read,
        });

        read();

        return () => {
            if (idle) clearTimeout(idle);
            trigger.kill();
        };
    }, []);

    return ref;
}
