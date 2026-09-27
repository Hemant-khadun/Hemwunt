import { forwardRef, useId, useImperativeHandle, useRef } from 'react';
import { smooth, span } from '../../../animations/words';
import Frame, { reducedIn } from './Frame';
import type { RevealHandle, RevealProps } from './types';

/**
 * Marvella, car rental: THE DRIVE.
 *
 * The site arrives the way a car does at night. It comes in fast from
 * off-screen with its headlights thrown ahead of it into the dark water and a
 * motion-blurred ghost of itself, brakes (the body leans into the stop and
 * settles, the beams dip and die), and a last sweep of light crosses the page
 * as it comes to rest.
 *
 * The blurred ghost is a second copy under a static SVG blur, so the filter is
 * rasterised once; only its opacity follows the speed.
 */

/** Heights of the two headlights, as fractions of the frame. */
const BEAMS = [0.34, 0.7];

/** How far off-screen the drive starts, in vw. */
const FROM_VW = 110;

const DriveReveal = forwardRef<RevealHandle, RevealProps>(({ image, ratio, address }, ref) => {
    const blurId = `rv-drive-blur-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
    const frame = useRef<HTMLDivElement>(null);
    const ghost = useRef<HTMLImageElement>(null);
    const sharp = useRef<HTMLImageElement>(null);
    const beams = useRef<HTMLDivElement>(null);
    const sweep = useRef<HTMLDivElement>(null);

    useImperativeHandle(
        ref,
        () => ({
            render(p, reduced) {
                const f = frame.current;
                const g = ghost.current;
                const s = sharp.current;
                const t = beams.current;
                const w = sweep.current;
                if (!f || !g || !s || !t || !w) return;

                if (reduced) {
                    reducedIn(f, p, () => {
                        g.style.opacity = '0';
                        s.style.opacity = '1';
                        t.style.opacity = '0';
                        w.style.opacity = '0';
                    });
                    return;
                }

                // Position: a quartic ease-out, i.e. hard braking into place.
                const q = span(p, 0, 0.6);
                const e = 1 - Math.pow(1 - q, 4);
                // Its derivative, normalised: 1 flat out, 0 at rest.
                const speed = q > 0 ? Math.pow(1 - q, 3) : 0;
                // The lean into the stop, and the settle after it.
                const brake = Math.sin(Math.PI * span(p, 0.42, 0.74));

                f.style.opacity = q > 0 ? '1' : '0';
                const x = -(1 - e) * FROM_VW;
                const skew = -9 * speed - 2.4 * brake;
                // At rest, no transform (see riseIn in Frame.tsx).
                f.style.transform =
                    q >= 1 && Math.abs(skew) < 1e-3 ? '' : `translate3d(${x.toFixed(2)}vw, 0, 0) skewX(${skew.toFixed(2)}deg)`;

                // Blur follows speed, but a touch behind it, as a shutter would.
                const blur = Math.min(1, speed * 1.8);
                g.style.opacity = blur.toFixed(3);
                s.style.opacity = (1 - blur * 0.85).toFixed(3);

                // The beams reach furthest at speed, dip as the nose goes down
                // under braking, and die as the car stops.
                t.style.opacity = Math.min(1, speed * 2.4 + brake * 0.35 * (1 - q)).toFixed(3);
                t.style.transform = `translate3d(0, ${(brake * 1.2).toFixed(2)}vh, 0) scaleX(${(0.55 + speed * 0.45).toFixed(3)})`;

                // Headlights across the page once it has stopped.
                const h = smooth(span(p, 0.56, 0.95));
                w.style.opacity = h > 0 && h < 1 ? '1' : '0';
                w.style.transform = `translate3d(${(-60 + h * 220).toFixed(2)}%, 0, 0) skewX(-18deg)`;
            },
        }),
        [],
    );

    return (
        <Frame
            ref={frame}
            address={address}
            ratio={ratio}
            className="rv-drive"
            outside={
                <div className="rv-drive__beams" ref={beams} aria-hidden="true">
                    {BEAMS.map((y, i) => (
                        <i key={i} style={{ top: `${y * 100}%` }} />
                    ))}
                </div>
            }>
            {/* Horizontal only: a shutter smear along the direction of travel. */}
            <svg className="rv-defs" aria-hidden="true">
                <filter id={blurId} x="-20%" y="0" width="140%" height="100%">
                    <feGaussianBlur stdDeviation="26 0" />
                </filter>
            </svg>
            <img className="rv-drive__img" ref={sharp} src={image} alt="" draggable={false} />
            <img
                className="rv-drive__ghost"
                ref={ghost}
                src={image}
                alt=""
                draggable={false}
                aria-hidden="true"
                style={{ filter: `url(#${blurId})` }}
            />
            <div className="rv-drive__sweep" ref={sweep} aria-hidden="true" />
        </Frame>
    );
});
DriveReveal.displayName = 'DriveReveal';

export default DriveReveal;
