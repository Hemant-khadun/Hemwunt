import { IS_MOBILE } from '../utils/device';
import { whaleScreen } from './screenProjector';
import { getStation } from './stationRegistry';
import { prefersReducedMotion } from './motionPreference';

/**
 * The one moment the whale crosses IN FRONT of the work.
 *
 * Everywhere else on the page the whale swims behind the portfolio — the
 * WebGL canvas sits under the DOM. For the close pass the canvas layer is
 * raised above the content for a couple of seconds, so the animal eclipses
 * the screenshot as it surges past, and then handed back. Scarcity is the
 * whole effect; it happens once per descent.
 *
 * ── OFF BY DEFAULT. READ THIS BEFORE TURNING IT ON. ──────────────────────
 * Raising the canvas only works if the post-processing chain outputs a
 * TRANSPARENT background. N8AO passes scene alpha through, but Bloom's
 * additive blend may push alpha toward 1. If it does, a raised canvas paints
 * an opaque rectangle over the entire page for the duration of the pass.
 * That can only be settled by looking: set FRONT_PASS_MODE to 'raise', load
 * the page, and scroll to the third project (Konze). If the page blacks out
 * during the burst, set it back to 'off'. There is deliberately no "dim the
 * project instead" fallback — the art direction is that the dark never
 * touches the work.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * CLICKS. The layer never becomes hit-testable: it is `pointer-events: none`
 * in both states (enforced with !important in styles.css), and R3F takes its
 * pointer events from `document.body`, not the canvas. Raising it cannot
 * steal a click from a project link underneath.
 *
 * THE CUT. z-index is not animatable, so raising and lowering are cuts. A cut
 * while the whale overlaps the project image would visibly pop the animal
 * through the screenshot, so both cuts wait for a frame where it does not.
 * If no such frame arrives in time, the raise is abandoned rather than
 * forced, and the lower is forced only after a long ceiling.
 *
 * Measuring the image's rect per frame is normally off-limits here; it is
 * accepted for the few seconds a pass lasts, once per descent.
 */

export type FrontPassMode = 'off' | 'raise';

export const FRONT_PASS_MODE: FrontPassMode = 'off';

/** Give up on raising if no clean frame arrives within this. */
const MAX_WAIT_MS = 1500;
/** Stay in front at least this long, so the eclipse registers. */
const MIN_HOLD_MS = 1200;
/** Lower regardless after this, even mid-overlap. */
const MAX_HOLD_MS = 3500;
/** Margin around the image counted as overlapping, in CSS pixels — the
 *  whale's body extends well beyond its projected origin. */
const OVERLAP_PAD = 120;

const FRONT_CLASS = 'whale-layer--front';

type State = 'idle' | 'pending' | 'front';

let state: State = 'idle';
let stationIndex = -1;
let since = 0;
let layer: HTMLElement | null = null;

function overlapping(): boolean {
    const media = getStation(stationIndex)?.element.querySelector('.project__visual');
    if (!media || !whaleScreen.valid || !whaleScreen.onScreen) return false;
    const r = media.getBoundingClientRect();
    return (
        whaleScreen.x > r.left - OVERLAP_PAD &&
        whaleScreen.x < r.right + OVERLAP_PAD &&
        whaleScreen.y > r.top - OVERLAP_PAD &&
        whaleScreen.y < r.bottom + OVERLAP_PAD
    );
}

/** Ask for the pass, against the station whose shot it belongs to. */
export function requestFrontPass(index: number): void {
    if (FRONT_PASS_MODE === 'off') return;
    if (prefersReducedMotion()) return;
    // The mobile path never raises the canvas: the layout is a single column
    // and the image fills the width, so there is no clean frame to cut on.
    if (IS_MOBILE) return;
    if (state !== 'idle') return;

    state = 'pending';
    stationIndex = index;
    since = performance.now();
}

/** Advance the pass. Call once per frame; cheap when idle. */
export function updateFrontPass(): void {
    if (state === 'idle') return;

    layer ??= document.querySelector<HTMLElement>('.whale-layer');
    if (!layer) {
        state = 'idle';
        return;
    }

    const elapsed = performance.now() - since;

    if (state === 'pending') {
        if (elapsed > MAX_WAIT_MS) {
            state = 'idle';
        } else if (!overlapping()) {
            layer.classList.add(FRONT_CLASS);
            state = 'front';
            since = performance.now();
        }
        return;
    }

    if ((elapsed > MIN_HOLD_MS && !overlapping()) || elapsed > MAX_HOLD_MS) {
        layer.classList.remove(FRONT_CLASS);
        state = 'idle';
    }
}
