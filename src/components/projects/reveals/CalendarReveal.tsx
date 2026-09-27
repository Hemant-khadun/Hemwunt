import { forwardRef, useImperativeHandle, useRef } from 'react';
import { smooth, span } from '../../../animations/words';
import Frame, { reducedIn, riseIn } from './Frame';
import type { RevealHandle, RevealProps } from './types';

/**
 * Konzé, leave planner: THE CALENDAR.
 *
 * The frame flips up as a month, in Konzé's own lavender. The idea of the app
 * then plays out on it: public holidays light up in navy, the bridge days
 * beside them turn leave-green, the weekends they connect join in, and a
 * capsule rings each stretch — two days of leave, nine days away. Then the
 * pages tear off in date order, and the site is underneath.
 *
 * The month is illustrative (Monday-first, starting on a Monday), not a real
 * calendar year; it only has to make the idea legible in a glance.
 */

type Kind = 'day' | 'holiday' | 'leave' | 'off' | 'next';

const HOLIDAYS = new Set([11, 24, 25]);
const LEAVE = new Set([12, 26]);
/** Weekend days the leave connects to a holiday. */
const OFF = new Set([13, 14, 27, 28]);
/** The stretches to ring, as [row, firstCol, lastCol]. */
const STRETCHES: Array<[number, number, number]> = [
    [1, 3, 6],
    [3, 2, 6],
];

const CELLS = Array.from({ length: 35 }, (_, i) => {
    const day = i + 1;
    let kind: Kind = 'day';
    if (day > 31) kind = 'next';
    else if (HOLIDAYS.has(day)) kind = 'holiday';
    else if (LEAVE.has(day)) kind = 'leave';
    else if (OFF.has(day)) kind = 'off';
    return { day: day > 31 ? day - 31 : day, kind, col: i % 7, row: Math.floor(i / 7), weekend: i % 7 >= 5 };
});

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Top band for the weekday initials, as a fraction of the view's height. */
const HEAD = 0.09;
const ROW_H = (1 - HEAD) / 5;

/** When each kind lights up. */
const LIGHT: Record<Kind, [number, number]> = {
    day: [2, 3],
    next: [2, 3],
    holiday: [0.3, 0.38],
    leave: [0.38, 0.46],
    off: [0.42, 0.5],
};

const CalendarReveal = forwardRef<RevealHandle, RevealProps>(({ image, ratio, address }, ref) => {
    const frame = useRef<HTMLDivElement>(null);
    const img = useRef<HTMLImageElement>(null);
    const head = useRef<HTMLDivElement>(null);
    const note = useRef<HTMLDivElement>(null);
    const cells = useRef<Array<HTMLDivElement | null>>([]);
    const marks = useRef<Array<HTMLElement | null>>([]);
    const rings = useRef<Array<HTMLElement | null>>([]);

    useImperativeHandle(
        ref,
        () => ({
            render(p, reduced) {
                const f = frame.current;
                const im = img.current;
                const hd = head.current;
                const nt = note.current;
                if (!f || !im || !hd || !nt) return;

                if (reduced) {
                    reducedIn(f, p, () => {
                        im.style.opacity = '1';
                        hd.style.opacity = '0';
                        nt.style.opacity = '0';
                        cells.current.forEach((c) => c && (c.style.opacity = '0'));
                        rings.current.forEach((r) => r && (r.style.opacity = '0'));
                    });
                    return;
                }

                // The month flips up into view like a page on a pad.
                riseIn(f, p, 0.12, 16);

                // The site waits under the month until every page is opaque.
                im.style.opacity = p > 0.3 ? '1' : '0';

                const tearing = smooth(span(p, 0.58, 0.64));
                hd.style.opacity = (smooth(span(p, 0.04, 0.12)) * (1 - tearing)).toFixed(3);

                CELLS.forEach((cell, i) => {
                    const el = cells.current[i];
                    const mark = marks.current[i];
                    if (!el) return;

                    // In, a row at a time.
                    const a = smooth(span(p, 0.05 + cell.row * 0.045, 0.15 + cell.row * 0.045));

                    // Off, in date order: each page lifts from its top edge,
                    // flips toward the viewer and falls away.
                    const start = 0.6 + (i / (CELLS.length - 1)) * 0.25;
                    const t = smooth(span(p, start, start + 0.12));

                    el.style.opacity = (a * (1 - t * t)).toFixed(3);
                    el.style.visibility = t >= 1 ? 'hidden' : 'visible';
                    el.style.transform =
                        t > 0
                            ? `translate3d(0, ${(-t * 28).toFixed(2)}%, 0) rotateX(${(t * 110).toFixed(2)}deg)`
                            : `translate3d(0, ${((1 - a) * 14).toFixed(2)}%, 0)`;

                    if (mark) {
                        const [l0, l1] = LIGHT[cell.kind];
                        const lit = smooth(span(p, l0, l1));
                        mark.style.opacity = lit.toFixed(3);
                        // The leave day is the discovery: it pops as it lands.
                        const pop = cell.kind === 'leave' ? Math.sin(Math.PI * lit) * 0.12 : 0;
                        mark.style.transform = `scale(${(0.82 + 0.18 * lit + pop).toFixed(4)})`;
                        el.classList.toggle('is-lit', lit > 0.5);
                    }
                });

                STRETCHES.forEach((_, s) => {
                    const r = rings.current[s];
                    if (!r) return;
                    const d = smooth(span(p, 0.46 + s * 0.04, 0.56 + s * 0.04));
                    r.style.opacity = (Math.min(1, d * 3) * (1 - tearing)).toFixed(3);
                    r.style.clipPath = `inset(-10% ${((1 - d) * 100).toFixed(2)}% -10% -10%)`;
                });

                const n = smooth(span(p, 0.5, 0.58));
                nt.style.opacity = (n * (1 - tearing)).toFixed(3);
                nt.style.transform = `translate3d(-50%, ${((1 - n) * 40).toFixed(2)}%, 0)`;
            },
        }),
        [],
    );

    return (
        <Frame ref={frame} address={address} ratio={ratio} className="rv-cal">
            <img className="rv-cal__img" ref={img} src={image} alt="" draggable={false} />

            <div className="rv-cal__head" ref={head} aria-hidden="true" style={{ height: `${HEAD * 100}%` }}>
                {WEEKDAYS.map((d, i) => (
                    <span key={i} className={i >= 5 ? 'is-weekend' : undefined}>
                        {d}
                    </span>
                ))}
            </div>

            <div className="rv-cal__grid" aria-hidden="true">
                {CELLS.map((cell, i) => (
                    <div
                        key={i}
                        ref={(el) => {
                            cells.current[i] = el;
                        }}
                        className={`rv-cal__cell rv-cal__cell--${cell.kind}${cell.weekend ? ' is-weekend' : ''}`}
                        style={{
                            left: `${(cell.col / 7) * 100}%`,
                            top: `${(HEAD + cell.row * ROW_H) * 100}%`,
                            // A pixel of overlap, or the site shows through the
                            // sub-pixel seams between pages.
                            width: `calc(${100 / 7}% + 1px)`,
                            height: `calc(${ROW_H * 100}% + 1px)`,
                        }}>
                        {cell.kind !== 'day' && cell.kind !== 'next' && (
                            <b
                                className="rv-cal__mark"
                                ref={(el) => {
                                    marks.current[i] = el;
                                }}
                            />
                        )}
                        <span>{cell.day}</span>
                    </div>
                ))}

                {STRETCHES.map(([row, c0, c1], s) => (
                    <i
                        key={s}
                        className="rv-cal__ring"
                        ref={(el) => {
                            rings.current[s] = el;
                        }}
                        style={{
                            left: `${(c0 / 7) * 100}%`,
                            top: `${(HEAD + row * ROW_H) * 100}%`,
                            width: `${((c1 - c0 + 1) / 7) * 100}%`,
                            height: `${ROW_H * 100}%`,
                        }}
                    />
                ))}
            </div>

            <div className="rv-cal__note" ref={note} aria-hidden="true">
                <b>2</b> days of leave <span>→</span> <b>9</b> days off
            </div>
        </Frame>
    );
});
CalendarReveal.displayName = 'CalendarReveal';

export default CalendarReveal;
