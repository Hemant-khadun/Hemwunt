/**
 * `prefers-reduced-motion`, read once and kept live.
 *
 * Deliberately not a hook. Most of the consumers here are not components —
 * the whale animator, the marine snow's rAF loop, the camera director's frame
 * callback — and a hook would force each of them to be one. The subscription
 * exists so a viewer who flips the OS setting mid-session gets the change
 * without a reload, which is exactly when they most want it.
 *
 * The query is guarded because it is touched from module scope: an older
 * browser without `matchMedia` should degrade to full motion rather than
 * throwing during import and taking the whole page down with it.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

const mql = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(QUERY)
    : null;

let reduced = mql ? mql.matches : false;

type Listener = (reduced: boolean) => void;
const listeners = new Set<Listener>();

if (mql) {
    const onChange = (e: MediaQueryListEvent) => {
        reduced = e.matches;
        listeners.forEach((fn) => fn(reduced));
    };
    // Safari only grew `addEventListener` on MediaQueryList in 14. The
    // deprecated `addListener` is the fallback, and is still the only thing
    // that works on the iOS versions this page will actually meet.
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
}

/** True when the viewer has asked for reduced motion. */
export function prefersReducedMotion(): boolean {
    return reduced;
}

/** Subscribe to changes. Returns an unsubscribe. */
export function onMotionPreferenceChange(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
