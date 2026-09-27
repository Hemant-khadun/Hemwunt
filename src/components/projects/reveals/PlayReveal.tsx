import { forwardRef, useId, useImperativeHandle, useMemo, useRef } from 'react';
import { smooth, span } from '../../../animations/words';
import Frame, { hash01, reducedIn, riseIn } from './Frame';
import type { RevealHandle, RevealProps } from './types';

/**
 * KinderGarden, learning for kids: PLAY.
 *
 * The site's own paint blobs (the teal, lime, orange and coral it frames its
 * hero with) bounce onto a cream page one after another with an elastic pop,
 * turn slowly like toys, then swell and run into each other. Each blob is a
 * window: as it grows its colour thins and the site shows through it, until
 * they have merged into the whole page.
 *
 * One set of shapes does both jobs: drawn in colour above the image, and in
 * white inside the image's mask.
 */

/** [x, y] as fractions of the view, base radius in view units (width 100), colour. */
const BLOBS: Array<[number, number, number, string]> = [
    [0.17, 0.34, 8.5, '#57aea9'],
    [0.56, 0.28, 9.5, '#cfd65d'],
    [0.38, 0.74, 6.8, '#f3aa4b'],
    [0.8, 0.64, 7.8, '#e87c5a'],
    [0.9, 0.2, 5, '#57aea9'],
    [0.08, 0.82, 5, '#cfd65d'],
];

/** Far enough that any one blob covers the whole view on its own. */
const COVER = 150;

/** A closed, lumpy, unit-radius blob, as smooth cubic segments (Catmull-Rom). */
function blobPath(seed: number): string {
    const n = 8;
    const pts = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        const r = 0.84 + hash01(seed * 17 + i) * 0.3;
        return [Math.cos(a) * r, Math.sin(a) * r];
    });
    const at = (i: number) => pts[(i + n) % n];
    let d = `M ${at(0)[0].toFixed(3)} ${at(0)[1].toFixed(3)} `;
    for (let i = 0; i < n; i++) {
        const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += `C ${c1[0].toFixed(3)} ${c1[1].toFixed(3)} ${c2[0].toFixed(3)} ${c2[1].toFixed(3)} ${p2[0].toFixed(3)} ${p2[1].toFixed(3)} `;
    }
    return d + 'Z';
}

/** elastic.out: shoots past, wobbles, lands. */
const elasticOut = (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

const PlayReveal = forwardRef<RevealHandle, RevealProps>(({ image, ratio, address }, ref) => {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const maskId = `rv-play-mask-${uid}`;
    const h = 100 / ratio;
    const paths = useMemo(() => BLOBS.map((_, i) => blobPath(i + 3)), []);

    const frame = useRef<HTMLDivElement>(null);
    const img = useRef<SVGImageElement>(null);
    const svg = useRef<SVGSVGElement>(null);
    // The finished picture. Chrome rasterises an SVG <image> at low resolution
    // on high-density screens, so the SVG only carries the reveal; once it is
    // done, a plain <img> takes over and the SVG is hidden.
    const sharp = useRef<HTMLImageElement>(null);
    const colour = useRef<Array<SVGPathElement | null>>([]);
    const hole = useRef<Array<SVGPathElement | null>>([]);

    useImperativeHandle(
        ref,
        () => ({
            render(p, reduced) {
                const f = frame.current;
                const im = img.current;
                if (!f || !im) return;
                const showSharp = (on: boolean) => {
                    if (sharp.current) sharp.current.style.visibility = on ? 'visible' : 'hidden';
                    if (svg.current) svg.current.style.visibility = on ? 'hidden' : 'visible';
                };

                if (reduced) {
                    reducedIn(f, p, () => {
                        im.removeAttribute('mask');
                        showSharp(true);
                        colour.current.forEach((c) => c && (c.style.opacity = '0'));
                    });
                    return;
                }

                riseIn(f, p, 0.1);

                const done = p >= 0.97;
                if (done) im.removeAttribute('mask');
                else im.setAttribute('mask', `url(#${maskId})`);
                showSharp(done);

                BLOBS.forEach(([x, y, r0], i) => {
                    // Pop in, one after another.
                    const pop = elasticOut(span(p, 0.08 + i * 0.045, 0.3 + i * 0.045));
                    // Then swell, slow and then all at once. The first blob
                    // finishes first, and covers the page by itself.
                    const g = span(p, 0.44 + i * 0.03, 0.9 + i * 0.012);
                    const grow = g * g * g;
                    const s = r0 * pop + (COVER - r0) * grow;
                    const turn = (i % 2 ? -1 : 1) * (20 + p * 70) + i * 40;
                    const transform = `translate(${(x * 100).toFixed(2)} ${(y * h).toFixed(2)}) rotate(${turn.toFixed(1)}) scale(${Math.max(0.001, s).toFixed(3)})`;

                    const c = colour.current[i];
                    const m = hole.current[i];
                    if (c) {
                        c.setAttribute('transform', transform);
                        // The colour thins as the blob opens into a window.
                        c.style.opacity = done ? '0' : (1 - smooth(span(g, 0.04, 0.4))).toFixed(3);
                    }
                    if (m) m.setAttribute('transform', transform);
                });
            },
        }),
        [h, maskId],
    );

    return (
        <Frame ref={frame} address={address} ratio={ratio} className="rv-play">
            <svg ref={svg} className="rv-play__svg" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                    <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height={h}>
                        {paths.map((d, i) => (
                            <path
                                key={i}
                                d={d}
                                fill="#fff"
                                transform="scale(0.001)"
                                ref={(el) => {
                                    hole.current[i] = el;
                                }}
                            />
                        ))}
                    </mask>
                </defs>
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
                {paths.map((d, i) => (
                    <path
                        key={i}
                        d={d}
                        fill={BLOBS[i][3]}
                        transform="scale(0.001)"
                        ref={(el) => {
                            colour.current[i] = el;
                        }}
                    />
                ))}
            </svg>
            <img className="rv-sharp" ref={sharp} src={image} alt="" draggable={false} />
        </Frame>
    );
});
PlayReveal.displayName = 'PlayReveal';

export default PlayReveal;
