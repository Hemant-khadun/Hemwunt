import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import { cubicOut, expoOut, smooth, span } from '../../../animations/words';

/**
 * The window a project is shown in: dark glass browser chrome with the real
 * address, around a view the size of the screenshot.
 *
 * It is what stops a bright screenshot reading as a slab pasted onto the
 * water. The chrome is the same navy as the deep, so the frame belongs to
 * the scene, and the address says what the picture is: a real site.
 *
 * `outside` renders behind the frame and is not clipped by it (the light
 * trails of the drive, for one). `children` fill the view, which clips.
 */
interface FrameProps {
    address: string;
    ratio: number;
    outside?: ReactNode;
    className?: string;
    children: ReactNode;
}

const Frame = forwardRef<HTMLDivElement, FrameProps>(({ address, ratio, outside, className, children }, ref) => (
    <div ref={ref} className={`pframe${className ? ` ${className}` : ''}`}>
        {outside}
        <div className="pframe__bar" aria-hidden="true">
            <span className="pframe__dots">
                <i />
                <i />
                <i />
            </span>
            <span className="pframe__address">{address}</span>
        </div>
        <div className="pframe__view" style={{ aspectRatio: String(ratio) }}>
            {children}
        </div>
    </div>
));
Frame.displayName = 'Frame';

export default Frame;

/**
 * The plain arrival most reveals share: the empty frame rises and settles in
 * the first stretch of the window, so the move itself plays on a frame that
 * is already there. On the page's arrival curve (see words.ts): it comes up
 * decisively and spends most of its time settling, the way the words beside
 * it are set; the fade is done well before the move is.
 */
export function riseIn(frame: HTMLElement, p: number, until = 0.14, tilt = 0): void {
    const t = span(p, 0, until * 1.6);
    const a = t >= 1 ? 1 : expoOut(t);
    frame.style.opacity = cubicOut(t * 1.8).toFixed(3);
    const lift = (1 - a) * 6;
    const scale = 0.96 + 0.04 * a;
    const rot = tilt ? ` rotateX(${((1 - a) * tilt).toFixed(2)}deg)` : '';
    // At rest, no transform at all: a leftover 3D transform keeps the frame on
    // a composited layer rastered at whatever scale it started at, which
    // softens the screenshot.
    frame.style.transform =
        a >= 1 ? '' : `perspective(1400px) translate3d(0, ${lift.toFixed(2)}vh, 0)${rot} scale(${scale.toFixed(4)})`;
}

/**
 * Reduced motion: no move at all. The finished frame fades in over the same
 * window, and `settle` puts the contents in their final state.
 */
export function reducedIn(frame: HTMLElement, p: number, settle: () => void): void {
    frame.style.transform = '';
    frame.style.opacity = smooth(span(p, 0, 0.3)).toFixed(3);
    settle();
}

/** A stable pseudo-random 0..1 per integer, so layouts never reshuffle. */
export function hash01(i: number): number {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}
