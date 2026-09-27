import { MathUtils } from 'three';

/**
 * How much of the surface-to-dive prelude is left, published once per frame.
 *
 * A module singleton for the same reason `depthSignal` is one: the consumers
 * (`Surface`, `LightRays`, `SurfacePrelude` itself) have no common React
 * ancestor worth hanging a provider on, and there is exactly one prelude.
 *
 * Deliberately NOT derived from `depthSignal.depth`: that curve is shaped for
 * the whole page's descent-then-ascent narrative and only reaches interesting
 * values after most of the scroll. The prelude is a few percent of scroll at
 * the very top, so it needs its own short window — tuning one must never move
 * the other.
 *
 * 1 = fully on the surface (sky and water visible, the underwater dressing
 * suppressed). 0 = fully submerged (sky/water hidden, dressing at full
 * strength). Consumers multiply their own opacity by `(1 - progress)`.
 *
 * WRITER: `components/ocean/Ocean.tsx`, which publishes how much of the frame
 * is still air (`waterSignal.air`): 1 in the over/under hero, 0 once the
 * waterline has left the top of the frame. The CameraDirector reads it as its
 * authority. `updatePrelude` below belongs to the retired SurfacePrelude.
 */
export const preludeSignal = { progress: 1 };

/** Fraction of total page scroll over which the dive takes over. Short on
 *  purpose — this is a handoff, not a scene in its own right. */
const PRELUDE_END = 0.06;

/**
 * Publish this frame's prelude progress from raw scroll. Allocation-free.
 *
 * Returns the value as well as writing it, so the one component driving the
 * camera during the prelude does not have to read its own write back out of
 * the singleton.
 */
export function updatePrelude(scrollY: number, scrollMax: number): number {
    const raw = scrollMax > 0 ? scrollY / scrollMax : 0;
    const t = 1 - MathUtils.clamp(raw / PRELUDE_END, 0, 1);
    // Smoothstep: the handoff eases at both ends rather than starting or
    // stopping on a hard corner.
    const eased = t * t * (3 - 2 * t);
    preludeSignal.progress = eased;
    return eased;
}
