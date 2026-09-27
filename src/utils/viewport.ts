/**
 * The page's viewport height: CSS `100vh`, in pixels.
 *
 * The story, the whale's route, the dive and the settle beats are all keyed
 * to scroll in viewport heights, and the CSS reserves their room in `vh`
 * (the hero, the story spacer, the chapters). They have to divide by the same
 * number. `window.innerHeight` is not it on a phone: it is the VISIBLE
 * height, which grows and shrinks as the browser's address bar slides away
 * and back, while `vh` stays fixed at the tall size. Dividing by innerHeight
 * made the story's timeline stretch by ~10% in the middle of a scroll on iOS
 * and Android, and the whale and the words jumped with it.
 *
 * Measured from a hidden fixed element that is `100vh` tall, so it is exactly
 * what the CSS means by it on every browser, and re-measured only after a
 * resize (which also covers rotation). On desktop it equals innerHeight.
 *
 * The WebGL canvas is `100vh` tall as well, so this is also the height to
 * project into when mapping between the scene and screen pixels.
 */

let height = 0;
let probe: HTMLDivElement | null = null;

function measure(): number {
    if (!probe) {
        probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText =
            'position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none;';
        document.body.appendChild(probe);
    }
    return probe.offsetHeight || window.innerHeight;
}

/** CSS `100vh` in pixels. Stable while the mobile address bar moves. */
export function viewportHeight(): number {
    if (!height) height = Math.max(1, measure());
    return height;
}

if (typeof window !== 'undefined') {
    // Lazily: the next reader measures, so a burst of resize events costs one
    // layout read, not one each.
    window.addEventListener('resize', () => {
        height = 0;
    }, { passive: true });
}
