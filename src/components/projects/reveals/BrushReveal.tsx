import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { smooth, span } from '../../../animations/words';
import Frame, { reducedIn, riseIn } from './Frame';
import type { RevealHandle, RevealProps } from './types';

/**
 * Artisanal, local makers: BY HAND.
 *
 * The frame arrives as a sheet of warm paper, and the site is painted onto it
 * with a wide brush, pass after pass, the way a sign-writer fills a board.
 * A band of wet terracotta leads the stroke and the page dries in behind it.
 * The brush's edge is torn by a streaky displacement, so it reads as bristles
 * rather than a vector line.
 *
 * Both the paint and the reveal are the same path, drawn by dash offset. The
 * mask is dropped entirely once the painting is done, so the resting state
 * costs nothing.
 */

const PASSES = 5;

/** A boustrophedon: left to right, turn, right to left, a little wavy. */
function brushPath(h: number): { d: string; width: number } {
    const top = h * 0.1;
    const step = (h * 0.8) / (PASSES - 1);
    let d = '';
    for (let k = 0; k < PASSES; k++) {
        const y = top + k * step;
        const wob = step * 0.18 * (k % 2 ? -1 : 1);
        const [x0, x1] = k % 2 ? [108, -8] : [-8, 108];
        if (k === 0) d += `M ${x0} ${y.toFixed(2)} `;
        else {
            // The turn happens outside the page, so it never shows as a hook.
            const prevY = y - step;
            const out = k % 2 ? 122 : -22;
            d += `C ${out} ${prevY.toFixed(2)} ${out} ${y.toFixed(2)} ${x0} ${y.toFixed(2)} `;
        }
        d += `C ${(x0 + (x1 - x0) * 0.33).toFixed(2)} ${(y - wob).toFixed(2)} ${(x0 + (x1 - x0) * 0.66).toFixed(2)} ${(y + wob).toFixed(2)} ${x1} ${y.toFixed(2)} `;
    }
    return { d, width: step * 1.55 };
}

/** How far the paint runs ahead of the drying page, as a fraction of the path. */
const WET_LEAD = 0.018;

const BrushReveal = forwardRef<RevealHandle, RevealProps>(({ image, ratio, address }, ref) => {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const maskId = `rv-brush-mask-${uid}`;
    const roughId = `rv-brush-rough-${uid}`;
    const h = 100 / ratio;
    const { d, width } = useMemo(() => brushPath(h), [h]);

    const frame = useRef<HTMLDivElement>(null);
    const img = useRef<SVGImageElement>(null);
    const svg = useRef<SVGSVGElement>(null);
    // The finished picture. Chrome rasterises an SVG <image> at low resolution
    // on high-density screens, so the SVG only carries the reveal; once it is
    // done, a plain <img> takes over and the SVG is hidden.
    const sharp = useRef<HTMLImageElement>(null);
    const reveal = useRef<SVGPathElement>(null);
    const paint = useRef<SVGPathElement>(null);
    const length = useRef(1);

    useLayoutEffect(() => {
        const r = reveal.current;
        const pt = paint.current;
        if (!r || !pt) return;
        length.current = r.getTotalLength();
        for (const el of [r, pt]) {
            el.style.strokeDasharray = `${length.current} ${length.current}`;
            el.style.strokeDashoffset = `${length.current}`;
        }
    }, [d]);

    useImperativeHandle(
        ref,
        () => ({
            render(p, reduced) {
                const f = frame.current;
                const im = img.current;
                const r = reveal.current;
                const pt = paint.current;
                if (!f || !im || !r || !pt) return;
                const showSharp = (on: boolean) => {
                    if (sharp.current) sharp.current.style.visibility = on ? 'visible' : 'hidden';
                    if (svg.current) svg.current.style.visibility = on ? 'hidden' : 'visible';
                };
                const L = length.current;

                if (reduced) {
                    reducedIn(f, p, () => {
                        im.removeAttribute('mask');
                        showSharp(true);
                        im.style.visibility = 'visible';
                        pt.style.visibility = 'hidden';
                    });
                    return;
                }

                riseIn(f, p, 0.12);

                // Slow on the first touch of the brush and the last, even through
                // the middle passes.
                const q = smooth(span(p, 0.1, 0.94));
                const done = q >= 1;

                // Finished: no mask, no filter, just the picture.
                if (done) im.removeAttribute('mask');
                else im.setAttribute('mask', `url(#${maskId})`);
                showSharp(done);
                im.style.visibility = q > 0 ? 'visible' : 'hidden';
                r.style.strokeDashoffset = `${(L * (1 - q)).toFixed(2)}`;

                const wet = Math.min(1, q + WET_LEAD * Math.min(1, q * 8));
                pt.style.strokeDashoffset = `${(L * (1 - wet)).toFixed(2)}`;
                pt.style.visibility = q > 0 && !done ? 'visible' : 'hidden';
            },
        }),
        [maskId],
    );

    return (
        <Frame ref={frame} address={address} ratio={ratio} className="rv-brush">
            <svg ref={svg} className="rv-brush__svg" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                    {/* Streaks along the stroke (low x frequency, high y), so the
                        torn edge reads as bristles dragged sideways. */}
                    <filter id={roughId} x="-10%" y="-10%" width="120%" height="120%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.05 0.7" numOctaves="2" seed="7" />
                        <feDisplacementMap in="SourceGraphic" scale="6" xChannelSelector="R" yChannelSelector="G" />
                    </filter>
                    <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height={h}>
                        <path
                            ref={reveal}
                            d={d}
                            fill="none"
                            stroke="#fff"
                            strokeWidth={width}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            filter={`url(#${roughId})`}
                        />
                    </mask>
                </defs>
                <path
                    ref={paint}
                    className="rv-brush__paint"
                    d={d}
                    fill="none"
                    strokeWidth={width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter={`url(#${roughId})`}
                />
                <image
                    ref={img}
                    href={image}
                    x="0"
                    y="0"
                    width="100"
                    height={h}
                    preserveAspectRatio="xMidYMid slice"
                    mask={`url(#${maskId})`}
                />
            </svg>
            <img className="rv-sharp" ref={sharp} src={image} alt="" draggable={false} />
        </Frame>
    );
});
BrushReveal.displayName = 'BrushReveal';

export default BrushReveal;
