/**
 * Frame deltas at the display's own cadence, for motion that must be even.
 *
 * R3F's `delta` is `performance.now()` read when its frame callback runs,
 * which is after every animation-frame callback queued before it (Lenis,
 * ScrollTrigger, the story's DOM writes). That work varies frame to frame, and
 * Safari rounds the clock to the millisecond, so on an iPhone at 60 Hz the
 * delta reads anywhere from ~13 to ~20 ms while the screen shows every frame
 * exactly 16.7 ms apart. Anything advanced by it moves unevenly on screen: a
 * 3 ms error is a fifth of a frame's motion. Most of the scene hides that in
 * springs and easing; the sea cannot. Its waves are a pure function of time,
 * and its ripples step at a fixed 60 Hz, so a short delta followed by a long
 * one showed as a frame with no ripple step and then a frame with two.
 *
 * So: time is read from the document timeline, which is the frame's own
 * timestamp and the same for every callback in it; and a delta close to a
 * whole number of display frames counts as exactly that many. The display
 * rate is found from the recent deltas, and only 60 Hz (and its 30 Hz
 * half) and 120 Hz are snapped to: at any other rate the delta passes
 * through untouched. On average the time is unchanged; only its unevenness
 * goes.
 */

/** Display rates that are snapped to, fastest last. 30 Hz (a phone in
 *  low-power mode) is 60 Hz with every frame counted as two. */
const RATES = [60, 120];

/** How close the typical delta must be to a whole number of frames at a
 *  rate for the display to be taken as running at it. Tight: snapping a
 *  display that is really a little slower (headless Chrome runs at ~57 Hz)
 *  would slow the sea by the difference. */
const RATE_TOLERANCE = 0.02;

/** How far from a whole number of frames a single delta may be and still
 *  count as that many, as a share of one frame. */
const SNAP_TOLERANCE = 0.3;

/** Deltas the display rate is judged from (about a second at 60 Hz): enough
 *  that the average of millisecond-rounded deltas lands within a fraction of
 *  a percent of the real frame length. */
const HISTORY = 61;

function timelineMs(): number | null {
    if (typeof document === 'undefined') return null;
    const t = document.timeline?.currentTime;
    return typeof t === 'number' ? t : null;
}

export type FrameClock = (fallbackDelta: number) => number;

/** A clock for one per-frame consumer; call it once per frame with R3F's
 *  delta (used whenever the timeline is unavailable), in seconds. */
export function createFrameClock(now: () => number | null = timelineMs): FrameClock {
    let last = Number.NaN;
    const ring = new Float64Array(HISTORY);
    const scratch = new Float64Array(HISTORY);
    let head = 0;
    let count = 0;

    const frameLength = (): number => {
        if (count < 30) return 0;
        // The average of the deltas near the median: dropped frames and
        // hitches left out, millisecond rounding averaged away.
        const sorted = scratch.subarray(0, count);
        sorted.set(ring.subarray(0, count));
        sorted.sort();
        const median = sorted[count >> 1];
        let sum = 0;
        let n = 0;
        for (let i = 0; i < count; i++) {
            if (Math.abs(sorted[i] - median) < median * 0.25) {
                sum += sorted[i];
                n++;
            }
        }
        const typical = sum / n;
        for (const rate of RATES) {
            const frames = typical * rate;
            const k = Math.round(frames);
            if (k >= 1 && k <= 2 && Math.abs(frames - k) < RATE_TOLERANCE * k) return 1 / rate;
        }
        return 0;
    };

    return (fallbackDelta) => {
        const t = now();
        let dt = fallbackDelta;
        if (t !== null) {
            if (t > last) dt = (t - last) / 1000;
            last = t;
        }
        if (!(dt > 0)) return 0;

        ring[head] = Math.min(dt, 0.25);
        head = (head + 1) % HISTORY;
        count = Math.min(count + 1, HISTORY);

        const frame = frameLength();
        if (frame === 0) return dt;
        const frames = dt / frame;
        const k = Math.round(frames);
        return k >= 1 && Math.abs(frames - k) < SNAP_TOLERANCE ? k * frame : dt;
    };
}
