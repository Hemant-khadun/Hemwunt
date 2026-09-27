import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { smooth, span } from '../../../animations/words';
import Frame, { hash01, reducedIn, riseIn } from './Frame';
import type { RevealHandle, RevealProps } from './types';

/**
 * FutureSpace, electronics store: STOCKING THE SHELVES.
 *
 * The frame arrives as an empty shop: a grid of dashed slots. The storefront
 * is cut into the same grid, and each piece drops into its slot like a
 * product being put out, with a little settle on landing. Once every shelf is
 * full the cards lock together, the gaps close, and the pieces become the
 * page, finished with a gloss pass.
 *
 * The full image fades in over the tiles at the very end, so no hairline
 * seams between tiles survive into the resting state.
 */

const COLS = 4;
const ROWS = 5;
const COUNT = COLS * ROWS;

/** Card scale while on the shelf, before the lock closes the gaps. */
const CARD = 0.88;

/** back.out: overshoots a little, then settles, like something set down. */
const backOut = (t: number, k = 1.7) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);

const ShelvesReveal = forwardRef<RevealHandle, RevealProps>(({ image, ratio, address }, ref) => {
    const frame = useRef<HTMLDivElement>(null);
    const tilesRef = useRef<Array<HTMLDivElement | null>>([]);
    const slots = useRef<HTMLDivElement>(null);
    const full = useRef<HTMLImageElement>(null);
    const gloss = useRef<HTMLDivElement>(null);

    // Landing order: roughly top-left to bottom-right, jittered so it reads
    // as hands stocking shelves rather than a scanline.
    const delays = useMemo(
        () =>
            Array.from({ length: COUNT }, (_, i) => {
                const c = i % COLS;
                const r = Math.floor(i / COLS);
                return ((c + r) / (COLS + ROWS - 2)) * 0.42 + hash01(i) * 0.08;
            }),
        [],
    );

    useImperativeHandle(
        ref,
        () => ({
            render(p, reduced) {
                const f = frame.current;
                const sl = slots.current;
                const fu = full.current;
                const gl = gloss.current;
                if (!f || !sl || !fu || !gl) return;
                const tiles = tilesRef.current;

                if (reduced) {
                    reducedIn(f, p, () => {
                        sl.style.opacity = '0';
                        fu.style.opacity = '1';
                        gl.style.opacity = '0';
                        tiles.forEach((t) => t && (t.style.opacity = '0'));
                    });
                    return;
                }

                riseIn(f, p, 0.12);

                // Empty shelves show while the first pieces land, then give way.
                sl.style.opacity = (smooth(span(p, 0.02, 0.12)) * (1 - smooth(span(p, 0.6, 0.8)))).toFixed(3);

                // Every card locks to full size together.
                const lock = smooth(span(p, 0.8, 0.9));
                const scale = CARD + (1 - CARD) * lock;

                tiles.forEach((tile, i) => {
                    if (!tile) return;
                    const q = span(p, 0.08 + delays[i], 0.08 + delays[i] + 0.2);
                    const land = q > 0 ? backOut(q) : 0;
                    const y = (1 - land) * -55;
                    tile.style.opacity = smooth(span(q, 0, 0.3)).toFixed(3);
                    tile.style.transform = `translate3d(0, ${y.toFixed(2)}%, 0) scale(${scale.toFixed(4)})`;
                    tile.style.borderRadius = `${((1 - lock) * 6).toFixed(2)}px`;
                });

                fu.style.opacity = smooth(span(p, 0.9, 0.97)).toFixed(3);

                const g = smooth(span(p, 0.86, 1));
                gl.style.opacity = g > 0 && g < 1 ? '1' : '0';
                gl.style.transform = `translate3d(${(-70 + g * 240).toFixed(2)}%, 0, 0) skewX(-20deg)`;
            },
        }),
        [delays],
    );

    return (
        <Frame ref={frame} address={address} ratio={ratio} className="rv-shelves">
            <div className="rv-shelves__slots" ref={slots} aria-hidden="true">
                {Array.from({ length: COUNT }, (_, i) => (
                    <i key={i} />
                ))}
            </div>
            {Array.from({ length: COUNT }, (_, i) => {
                const c = i % COLS;
                const r = Math.floor(i / COLS);
                return (
                    <div
                        key={i}
                        className="rv-shelves__tile"
                        ref={(el) => {
                            tilesRef.current[i] = el;
                        }}
                        style={{
                            left: `${(c / COLS) * 100}%`,
                            top: `${(r / ROWS) * 100}%`,
                            width: `${100 / COLS}%`,
                            height: `${100 / ROWS}%`,
                            backgroundImage: `url(${image})`,
                            backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
                            backgroundPosition: `${(c / (COLS - 1)) * 100}% ${(r / (ROWS - 1)) * 100}%`,
                        }}
                    />
                );
            })}
            <img className="rv-shelves__full" ref={full} src={image} alt="" draggable={false} />
            <div className="rv-shelves__gloss" ref={gloss} aria-hidden="true" />
        </Frame>
    );
});
ShelvesReveal.displayName = 'ShelvesReveal';

export default ShelvesReveal;
