import { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { registerStation } from '../animations/stationRegistry';
import { useWhaleWake } from '../animations/useWhaleWake';

/**
 * How far past the latched radius the reveal grows, to pay for the feather.
 * The mask circle's fill fades to transparent over its outer band (see the
 * radial gradient below), so a circle that merely reached the old radius
 * would leave the screenshot's edges permanently half-dissolved.
 */
const FEATHER_COVER = 1.08;

gsap.registerPlugin(ScrollTrigger);

// The four distinct grid layouts from codrops/OnScrollFilter (content--layout-1/4/6/7).
// "NightFall" reuses layout 1's structure (same as the original demo), just with its
// own image/filter/radius, exactly like the source demo does.
export type LayoutVariant = 1 | 4 | 6 | 7;

export interface FilterRecipe {
    baseFrequency: number;
    numOctaves: number;
    scale: number;
    // Only "FireStorm" (layout 6) adds a feGaussianBlur after the displacement, per the original.
    blur?: number;
}

// Per-layout image treatment, layered on top of the mask reveal - gives each
// item's photo its own personality instead of one identical zoom. Motion only
// (scale/pan/rotate) - no brightness/contrast/saturate, so real screenshots
// keep their true colors instead of getting washed out or tinted.
const IMAGE_EFFECTS: Record<LayoutVariant, { from: gsap.TweenVars; to: gsap.TweenVars }> = {
    // FootPrint / NightFall: a clean, slow push-in.
    1: {
        from: { scale: 1, y: 0 },
        to: { scale: 1.15, y: -10 },
    },
    // HeartAche: a soft rise into place.
    4: {
        from: { scale: 1, y: 24 },
        to: { scale: 1.08, y: 0 },
    },
    // FireStorm: a bigger, slightly rotated punch-in for a more energetic feel.
    6: {
        from: { scale: 1, rotate: 0 },
        to: { scale: 1.22, rotate: -3 },
    },
    // StarLight: a wide, gentle push-in.
    7: {
        from: { scale: 1, y: 0 },
        to: { scale: 1.1, y: -6 },
    },
};

interface ScrollFilterItemProps {
    id: string;
    index: number;
    layout: LayoutVariant;
    titleUp: string;
    titleDown: string;
    description: string;
    imageUrl: string;
    liveUrl?: string;
    codeUrl?: string;
    aspectRatio: string;
    filter: FilterRecipe;
    /** Depth in metres at which this project sits, for the plate. Fiction, but
     *  consistent fiction: it matches the station's place in the ocean table
     *  so the number agrees with the light around it. */
    depthMetres: number;
    /** Zone name for the plate, e.g. 'midnight zone'. */
    depthLabel: string;
    // Final mask circle radius, normalized to a 0-100 viewBox (see below).
    radius: number;
    // When the scrub starts, as a ScrollTrigger position (see gsap docs) - later
    // (closer to 'top top') means more of the item is on screen before the
    // reveal begins. Defaults to starting as the item's top clears 80% of the
    // viewport height.
    triggerStart?: string;
    // How much scroll the whole reveal takes, as a ScrollTrigger relative
    // end (e.g. '+=90%' of the viewport height). Bigger = slower/later finish.
    triggerEnd?: string;
}

const ScrollFilterItem = ({
    id,
    index,
    layout,
    titleUp,
    titleDown,
    description,
    imageUrl,
    liveUrl,
    codeUrl,
    aspectRatio,
    filter,
    depthMetres,
    depthLabel,
    radius,
    // 'top bottom-=20%' fires once the item's top has scrolled up to 80% of
    // the viewport height; '+=80%' then matches that same 80% distance so
    // the reveal finishes exactly as the item's top reaches the viewport's
    // top edge - i.e. right as a ~100vh item settles into a centered scroll
    // snap (see Portfolio.tsx), instead of finishing early or late.
    triggerStart = 'top bottom-=20%',
    triggerEnd = '+=80%',
}: ScrollFilterItemProps) => {
    const itemRef = useRef<HTMLDivElement>(null);
    const titleUpRef = useRef<HTMLSpanElement>(null);
    const titleDownRef = useRef<HTMLSpanElement>(null);
    const maskRef = useRef<SVGCircleElement>(null);
    const imageRef = useRef<SVGImageElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const filterId = `portfolio-displacement-${id}`;
    const maskId = `portfolio-mask-${id}`;
    const featherId = `portfolio-feather-${id}`;

    // The viewBox is built to the image's own aspect ratio (100 wide by
    // 100/ratio tall) instead of a fixed 100x100 square, so the photo maps
    // onto it 1:1 with no crop at all - routing every image through an
    // intermediate square first (the old approach) forced two independent
    // crops that compounded into losing over a quarter of the photo even
    // when the final box already matched its real aspect ratio. The mask
    // circle centers on this box's actual middle.
    const [ratioW, ratioH] = aspectRatio.split('/').map((n) => parseFloat(n));
    const ratio = Number.isFinite(ratioW / ratioH) && ratioW / ratioH > 0 ? ratioW / ratioH : 1;
    const viewBoxHeight = 100 / ratio;
    const maskCy = viewBoxHeight / 2;

    // The reveal opens where the whale swept past, not always from centre.
    const wake = useWhaleWake(svgRef, viewBoxHeight);

    // This item is a station on the dive. The director composes the whale's
    // shot around where it sits; see animations/diveDirector.ts.
    useEffect(() => {
        const el = itemRef.current;
        if (!el) return;
        return registerStation(index, el);
    }, [index]);

    useLayoutEffect(() => {
        const titleUpEl = titleUpRef.current;
        const titleDownEl = titleDownRef.current;
        const mask = maskRef.current;
        const image = imageRef.current;
        const trigger = itemRef.current;
        if (!titleUpEl || !titleDownEl || !mask || !image || !trigger) return;

        const ctx = gsap.context(() => {
            // Each title flies in independently from a giant, centered-but-hidden
            // state down into its own final grid position - the two can land in
            // very different spots (e.g. opposite corners), matching the original's
            // Flip.getState -> reparent -> Flip.from technique, done here without
            // reparenting: capture the natural (final) rect, set a "big" transform
            // relative to it, then scrub that transform back to identity. The "big"
            // state sits well above the viewport (behind/above the whale) so it's
            // fully hidden until the user actually scrolls it into place.
            const bigScale = window.innerWidth > 768 ? 3 : 1.6;
            const hiddenCenterY = -window.innerHeight * 0.6;

            [titleUpEl, titleDownEl].forEach((el) => {
                const rect = el.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const dx = window.innerWidth / 2 - centerX;
                const dy = hiddenCenterY - centerY;
                gsap.set(el, { x: dx, y: dy, scale: bigScale, transformOrigin: '50% 50%' });
            });

            const imageEffect = IMAGE_EFFECTS[layout];
            gsap.set(mask, { attr: { r: 0 } });
            gsap.set(image, { ...imageEffect.from, transformOrigin: '50% 50%' });

            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger,
                    start: triggerStart,
                    end: triggerEnd,
                    scrub: true,
                },
            });

            // The radius is driven through a proxy rather than tweened as an
            // attribute directly, because its target is not known when the
            // timeline is built: the wake latches the circle's origin on the
            // first scrub update, and an off-centre origin needs a larger
            // radius to cover the far side. Scaling by the latched offset
            // here keeps the reveal's pacing identical for a centred origin
            // and exactly as long as it needs to be for an offset one —
            // rather than growing every reveal by the worst case.
            const reveal = { t: 0 };

            tl.to(titleUpEl, { x: 0, y: 0, scale: 1, ease: 'none' }, 0)
                .to(titleDownEl, { x: 0, y: 0, scale: 1, ease: 'none' }, 0)
                .to(
                    reveal,
                    {
                        t: 1,
                        ease: 'none',
                        onUpdate: () => {
                            wake.update(reveal.t, mask);
                            const r = reveal.t * (radius + wake.extra) * FEATHER_COVER;
                            mask.setAttribute('r', r.toFixed(3));
                        },
                    },
                    0,
                )
                .to(image, { ...imageEffect.to, ease: 'none' }, 0);
        }, trigger);

        return () => ctx.revert();
    }, [id, index, layout, radius, triggerStart, triggerEnd, wake]);

    return (
        <div ref={itemRef} className={`scroll-item scroll-item--layout-${layout}`}>
            {/* Thin space before the unit, the way a depth readout sets it.
                A non-breaking thin space so the number and its unit can never
                be split across a line. */}
            <p className="scroll-item__plate">
                {depthMetres.toLocaleString('en-US')}&#8239;m · {depthLabel}
            </p>

            <span className="scroll-item__title scroll-item__title--up" ref={titleUpRef}>
                {titleUp}
            </span>
            <span className="scroll-item__title scroll-item__title--down" ref={titleDownRef}>
                {titleDown}
            </span>

            <div className="scroll-item__media">
                <svg
                    ref={svgRef}
                    className="scroll-item__svg"
                    style={{ aspectRatio }}
                    viewBox={`0 0 100 ${viewBoxHeight}`}
                    preserveAspectRatio="xMidYMin meet"
                    aria-hidden="true"
                >
                    <defs>
                        <filter id={filterId}>
                            <feTurbulence
                                type="fractalNoise"
                                baseFrequency={filter.baseFrequency}
                                numOctaves={filter.numOctaves}
                                result="noise"
                            />
                            <feDisplacementMap
                                in="SourceGraphic"
                                in2="noise"
                                result="displacement"
                                scale={filter.scale}
                                xChannelSelector="R"
                                yChannelSelector="G"
                            />
                            {filter.blur !== undefined && (
                                <feGaussianBlur in="displacement" stdDeviation={filter.blur} />
                            )}
                        </filter>
                        {/* A soft outer band on the dissolve, so the screenshot
                            fades into the water at its growing edge instead of
                            being punched out with a hard rim. Bounding-box
                            units, so the band scales with the circle. A mask
                            is luminance, not a colour treatment: the pixels
                            inside the image are untouched. */}
                        <radialGradient id={featherId}>
                            <stop offset="0" stopColor="#fff" />
                            <stop offset="0.86" stopColor="#fff" />
                            <stop offset="1" stopColor="#000" />
                        </radialGradient>
                        <mask id={maskId}>
                            <circle
                                ref={maskRef}
                                cx="50"
                                cy={maskCy}
                                r="0"
                                fill={`url(#${featherId})`}
                                style={{ filter: `url(#${filterId})` }}
                            />
                        </mask>
                    </defs>
                    <image
                        ref={imageRef}
                        href={imageUrl}
                        width="100"
                        height={viewBoxHeight}
                        mask={`url(#${maskId})`}
                        preserveAspectRatio="xMidYMid meet"
                    />
                </svg>
            </div>

            <div className="scroll-item__footer">
                <p className="scroll-item__description">{description}</p>
                {(liveUrl || codeUrl) && (
                    <div className="scroll-item__links">
                        {liveUrl && (
                            <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="scroll-item__link">
                                Visit Site →
                            </a>
                        )}
                        {codeUrl && (
                            <a href={codeUrl} target="_blank" rel="noopener noreferrer" className="scroll-item__link">
                                Source Code
                            </a>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ScrollFilterItem;
