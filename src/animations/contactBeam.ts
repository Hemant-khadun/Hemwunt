/**
 * When the contact beam comes up. One curve for both halves of the shaft — the
 * light in the water (`.footer-beam`, Footer.tsx) and the spotlight on the
 * whale (WhaleScene) — so the two can never arrive out of step.
 */

/** Stretch of the footer's rise (0 = its top at the bottom of the viewport,
 *  1 = the page scrolled all the way down) across which the beam comes up.
 *  Late on purpose: it is the reward for reaching the bottom, not something
 *  already on while the footer is still sliding in. */
const ARRIVE_FROM = 0.5;
const ARRIVE_TO = 1;

/** How fast the shown level chases the scroll, per second. Slow, so even a
 *  fling to the bottom has the light seep in over a couple of seconds
 *  rather than switching on. */
export const CONTACT_BEAM_EASE = 1.1;

/** Target brightness (0–1) for a footer whose top edge is at `top` px.
 *  Plain arithmetic rather than three's MathUtils: the footer is on the
 *  page's first download, and three is not. */
export function contactBeamTarget(top: number): number {
    const risen = 1 - top / window.innerHeight;
    const x = Math.min(Math.max((risen - ARRIVE_FROM) / (ARRIVE_TO - ARRIVE_FROM), 0), 1);
    return x * x * (3 - 2 * x);
}
