import gsap from 'gsap';

/**
 * Is the machine keeping up — and if not, what is the cheapest thing to give?
 *
 * The page runs a lot at once: a WebGL canvas with a live water simulation,
 * a raymarched light volume, AO and Bloom; a 2D canvas of marine snow; SVG
 * filters on the reveals. A mid-range laptop gets through all of it, and a
 * recent phone does too, until something else on the device wants the GPU.
 *
 * THE LADDER. When the frame time has been over budget for a while, the page
 * steps down ONE rung and watches what that did:
 *
 *   1. Resolution. The WebGL canvas renders at a little fewer pixels
 *      (`resolution`, a multiplier on the device's pixel ratio, applied by
 *      utils/Canvas.tsx). Every effect stays: the water, the shafts, the
 *      bubble cloud, the spray and the grain all survive a 15% softer buffer
 *      invisibly, and the text is DOM, so it stays sharp. Up to three rungs.
 *   2. Shedding. Only once the resolution rungs are spent (or proved useless)
 *      does `degraded` trip, and the expendable dressing backs off (half the
 *      marine snow, no bubble cloud or wake, caustics every other frame, the
 *      camera holds still).
 *
 * A STEP HAS TO EARN ITS KEEP. After each step down the frame time is
 * measured again; if it did not come down, the step is undone and that rung
 * is left alone for a while (longer each time). A phone in low-power mode,
 * which caps every page at 30 fps, or a machine held up by something other
 * than pixels, would otherwise lose its quality for nothing. Recovery climbs
 * the same ladder back up, slowly, and a climb that tips it back over budget
 * is undone and not tried again for a minute: a guard that flickers between
 * states is worse than no guard, because the change is visible.
 *
 * Measured on the existing gsap.ticker (already driven every frame by Lenis)
 * rather than a new requestAnimationFrame loop — watching the budget should
 * not itself cost a slice of it.
 */
export const frameBudget = {
    /** Median frame time over the last second, milliseconds. */
    meanMs: 16.7,
    /** True while the page should shed expendable effects. */
    degraded: false,
    /** Multiplier on the WebGL canvas's pixel ratio: 1 is full resolution. */
    resolution: 1,
};

/** The resolution rungs, as multipliers on the device's pixel ratio. */
const RESOLUTION_STEPS = [1, 0.85, 0.72, 0.6];

/** Over this for OVER_HOLD_MS and the page steps down. ~45 fps. */
const OVER_MS = 22;
/** Under this for UNDER_HOLD_MS and it steps back up. ~57 fps. */
const UNDER_MS = 17.5;
const OVER_HOLD_MS = 1500;
const UNDER_HOLD_MS = 5000;
/** After any change the ladder waits for the frame time to SETTLE before it
 *  judges the change or makes another. A new resolution reallocates every
 *  render target, and on a GPU short of memory that is not one long frame
 *  but seconds of them (measured: 150-200 ms frames for ~7 s on a GTX 970
 *  at 4K). Settled means two consecutive half-second medians agree within
 *  SETTLE_TOLERANCE, no sooner than SETTLE_MIN_MS and no later than
 *  SETTLE_MAX_MS. Judging inside the stall blamed the step for the stall. */
const SETTLE_MIN_MS = 1500;
const SETTLE_MAX_MS = 8000;
const SETTLE_TOLERANCE = 0.15;
/** A step down is kept only if it brought the frame time under this share of
 *  what it was before. */
const HELPED = 0.9;
/** An unhelpful rung is left alone this long, doubling with each failure. */
const RETRY_MS = 30000;
const RETRY_MAX_MS = 300000;
/** A climb that tipped the page back over budget: no climbing for this long,
 *  doubling with each failed climb. Under vsync a page with headroom and a
 *  page with none both read 16.7 ms, so climbing is the only way to find
 *  out, and each try costs a resize: tried ever more rarely. */
const CLIMB_BLOCK_MS = 60000;
const CLIMB_BLOCK_MAX_MS = 600000;
let climbFailures = 0;

type Knob = 'resolution' | 'shed';

let level = 0;
let scaling = false;
let holdUntil = 0;
let overSince = 0;
let underSince = 0;
let climbBlockedUntil = 0;
/** When the last change was made, while waiting for it to settle; 0 when
 *  the ladder is watching. */
let settlingSince = 0;
let trial: { knob: Knob; down: boolean; before: number } | null = null;
const blockedUntil: Record<Knob, number> = { resolution: 0, shed: 0 };
const failures: Record<Knob, number> = { resolution: 0, shed: 0 };

// --- Frame times ---------------------------------------------------------------
// The last few seconds of frames, in a ring, judged by their MEDIAN over a
// window of wall-clock time. A per-frame moving average (what this used to
// be) catches up in frames, not seconds: at 10 fps it lags by seconds, so a
// step was judged on frames from before it was taken, and one shader-compile
// stall dragged it for a second after. A median over the last second is
// current at any frame rate and shrugs off the odd hitch.
const RING = 512;
const ringT = new Float64Array(RING);
const ringDt = new Float64Array(RING);
const scratch = new Float64Array(RING);
let ringHead = 0;
let ringCount = 0;

function record(t: number, dt: number) {
    ringT[ringHead] = t;
    ringDt[ringHead] = dt;
    ringHead = (ringHead + 1) % RING;
    ringCount = Math.min(ringCount + 1, RING);
}

/** Median frame time of the frames at times in [from, to], or NaN if none. */
function median(from: number, to: number): number {
    let n = 0;
    for (let k = 0; k < ringCount; k++) {
        const i = (ringHead - 1 - k + RING) % RING;
        const t = ringT[i];
        if (t < from) break;
        if (t <= to) scratch[n++] = ringDt[i];
    }
    if (n === 0) return NaN;
    const sorted = scratch.subarray(0, n).sort();
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** The ladder's decisions, for `window.__budget.log` in development. */
const debugLog: string[] = [];
function note(message: string) {
    if (!import.meta.env.DEV) return;
    debugLog.push(`${(performance.now() / 1000).toFixed(1)}s ${message}`);
    if (debugLog.length > 60) debugLog.shift();
}

/**
 * Ignore the frame time for a while: shader compiles, a texture upload or the
 * canvas being created are one-off stalls, not the steady state the ladder is
 * for. Called on install, when the tab comes back, and by the scene on mount.
 */
export function holdBudget(ms: number) {
    holdUntil = Math.max(holdUntil, performance.now() + ms);
    overSince = 0;
    underSince = 0;
}

/** The WebGL canvas is up and applies `resolution`, so the resolution rungs
 *  exist. Without it (no WebGL) the ladder is shedding only. */
export function enableResolutionScaling(on: boolean) {
    scaling = on;
    note(`resolution scaling ${on ? 'on' : 'off'}`);
    if (!on) setLevel(0);
}

function setLevel(next: number) {
    level = next;
    frameBudget.resolution = RESOLUTION_STEPS[level];
}

function setKnob(knob: Knob, down: boolean) {
    if (knob === 'resolution') setLevel(level + (down ? 1 : -1));
    else frameBudget.degraded = down;
}

function settle(now: number) {
    settlingSince = now;
    overSince = 0;
    underSince = 0;
}

/** Has the frame time stopped moving since the last change? */
function settled(now: number): boolean {
    const age = now - settlingSince;
    if (age >= SETTLE_MAX_MS) return true;
    if (age < SETTLE_MIN_MS) return false;
    const a = median(now - 1000, now - 500);
    const b = median(now - 500, now);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    // Taking work away cannot make the steady state slower. A step down that
    // is followed by SLOWER frames is still in its stall, however steady the
    // stall looks (it can hold at ~80 ms for seconds): keep waiting.
    if (trial?.down && frameBudget.meanMs > trial.before * (1 + SETTLE_TOLERANCE)) return false;
    return Math.abs(a - b) <= SETTLE_TOLERANCE * Math.max(a, b);
}

function begin(knob: Knob, down: boolean, now: number) {
    trial = { knob, down, before: frameBudget.meanMs };
    setKnob(knob, down);
    note(`try ${knob} ${down ? 'down' : 'up'} at ${frameBudget.meanMs.toFixed(1)} ms: resolution ${frameBudget.resolution}, degraded ${frameBudget.degraded}`);
    settle(now);
}

function stepDown(now: number) {
    const rungsLeft = scaling && level < RESOLUTION_STEPS.length - 1;
    if (rungsLeft && now >= blockedUntil.resolution) begin('resolution', true, now);
    else if (!frameBudget.degraded && now >= blockedUntil.shed) begin('shed', true, now);
}

function stepUp(now: number) {
    if (now < climbBlockedUntil) return;
    if (frameBudget.degraded) begin('shed', false, now);
    else if (level > 0) begin('resolution', false, now);
}

function judge(now: number) {
    if (!trial) return;
    const { knob, down, before } = trial;
    const after = frameBudget.meanMs;
    trial = null;
    if (down) {
        if (after <= before * HELPED || after < UNDER_MS) {
            failures[knob] = 0;
            note(`kept ${knob} down: ${before.toFixed(1)} -> ${after.toFixed(1)} ms`);
            return;
        }
        // It didn't help: pixels (or dressing) were not what the frame was
        // waiting on. Put it back and leave this rung alone for a while.
        setKnob(knob, false);
        blockedUntil[knob] = now + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** failures[knob]);
        failures[knob]++;
        note(`undid ${knob}: ${before.toFixed(1)} -> ${after.toFixed(1)} ms did not help`);
        settle(now);
    } else if (after > OVER_MS) {
        setKnob(knob, true);
        climbBlockedUntil = now + Math.min(CLIMB_BLOCK_MAX_MS, CLIMB_BLOCK_MS * 2 ** climbFailures);
        climbFailures++;
        note(`undid ${knob} climb: ${after.toFixed(1)} ms is over budget`);
        settle(now);
    } else {
        climbFailures = 0;
        note(`kept ${knob} up: ${after.toFixed(1)} ms`);
    }
}

let installed = false;

function install() {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    holdBudget(3000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) holdBudget(1500);
    });

    gsap.ticker.add((_time, deltaTime) => {
        const now = performance.now();
        // A backgrounded tab returns with one enormous delta: clamped, and a
        // median does not care about one frame anyway.
        record(now, Math.min(deltaTime, 250));
        const recent = median(now - 1000, now);
        if (!Number.isNaN(recent)) frameBudget.meanMs = recent;

        if (import.meta.env.DEV) {
            (window as unknown as Record<string, unknown>).__budget = {
                mean: +frameBudget.meanMs.toFixed(1),
                resolution: frameBudget.resolution,
                degraded: frameBudget.degraded,
                log: debugLog,
            };
        }

        if (now < holdUntil) return;

        if (settlingSince) {
            if (!settled(now)) return;
            settlingSince = 0;
            judge(now);
            return;
        }

        if (frameBudget.meanMs > OVER_MS) {
            underSince = 0;
            overSince ||= now;
            if (now - overSince > OVER_HOLD_MS) stepDown(now);
        } else if (frameBudget.meanMs < UNDER_MS) {
            overSince = 0;
            underSince ||= now;
            if (now - underSince > UNDER_HOLD_MS) stepUp(now);
        } else {
            // In the band between: hold whatever state we are in.
            overSince = 0;
            underSince = 0;
        }
    });
}

// Installed on first import, so any consumer that reads the flag gets a live
// one without something else having to remember to start it.
install();
