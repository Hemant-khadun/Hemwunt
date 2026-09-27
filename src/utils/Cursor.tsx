import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '../animations/motionPreference';

/**
 * The cursor: a point, and a ring that follows it.
 *
 * The point is exactly where the mouse is. The ring trails it with weight
 * (eased per frame, the same whatever the frame rate) and settles around it
 * when it stops. Over anything that can be clicked the ring opens up and the
 * point dissolves into it; pressed, the ring tightens; over a text field both
 * step aside for the field's own caret; off the window, both fade.
 *
 * Mounted only for a pointer that can hover (see Layout and utils/device.ts).
 * Hidden until the mouse first moves, rather than waiting in a corner. Runs
 * on the gsap ticker the rest of the page shares, and writes nothing once
 * the ring has caught up.
 */

/** How quickly the ring closes on the point: the share of the gap it keeps
 *  per second is e^-FOLLOW. */
const FOLLOW = 14;

/** What the ring opens up for. */
const CLICKABLE = 'a, button, [role="button"], label, summary, .project__visual';
const TEXT = 'input, textarea, select, [contenteditable="true"]';

const Cursor = () => {
    const root = useRef<HTMLDivElement>(null);
    const dot = useRef<HTMLSpanElement>(null);
    const ring = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const el = root.current;
        const d = dot.current;
        const r = ring.current;
        if (!el || !d || !r) return;
        const previousCursor = document.body.style.cursor;
        document.body.style.cursor = 'none';

        const mouse = { x: 0, y: 0 };
        const trail = { x: 0, y: 0 };
        let seen = false;
        let settled = true;

        const onMove = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse') return;
            mouse.x = e.clientX;
            mouse.y = e.clientY;
            if (!seen) {
                // First sight: the ring starts where the point is, not in
                // the corner.
                seen = true;
                trail.x = mouse.x;
                trail.y = mouse.y;
                el.classList.add('is-on');
            }
            d.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0)`;
            settled = false;
        };

        const onOver = (e: PointerEvent) => {
            const target = e.target instanceof Element ? e.target : null;
            el.classList.toggle('is-text', !!target?.closest(TEXT));
            el.classList.toggle('is-link', !!target?.closest(CLICKABLE) && !target?.closest(TEXT));
        };
        const onDown = () => el.classList.add('is-down');
        const onUp = () => el.classList.remove('is-down');
        const onLeave = () => el.classList.remove('is-on');
        const onEnter = () => seen && el.classList.add('is-on');

        const tick = (_time: number, deltaMs: number) => {
            if (settled) return;
            const k = prefersReducedMotion() ? 1 : 1 - Math.exp((-FOLLOW * Math.min(deltaMs, 100)) / 1000);
            trail.x += (mouse.x - trail.x) * k;
            trail.y += (mouse.y - trail.y) * k;
            if (Math.abs(mouse.x - trail.x) < 0.05 && Math.abs(mouse.y - trail.y) < 0.05) {
                trail.x = mouse.x;
                trail.y = mouse.y;
                settled = true;
            }
            r.style.transform = `translate3d(${trail.x.toFixed(2)}px, ${trail.y.toFixed(2)}px, 0)`;
        };

        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerover', onOver, { passive: true });
        window.addEventListener('pointerdown', onDown, { passive: true });
        window.addEventListener('pointerup', onUp, { passive: true });
        document.documentElement.addEventListener('pointerleave', onLeave);
        document.documentElement.addEventListener('pointerenter', onEnter);
        gsap.ticker.add(tick);

        return () => {
            gsap.ticker.remove(tick);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerover', onOver);
            window.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointerup', onUp);
            document.documentElement.removeEventListener('pointerleave', onLeave);
            document.documentElement.removeEventListener('pointerenter', onEnter);
            document.body.style.cursor = previousCursor;
        };
    }, []);

    return (
        <div ref={root} className="cursor" aria-hidden="true">
            <span ref={ring} className="cursor__ring">
                <i />
            </span>
            <span ref={dot} className="cursor__dot">
                <i />
            </span>
        </div>
    );
};

export default Cursor;
