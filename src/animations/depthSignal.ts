import { MathUtils } from 'three';
import { createOceanSample, oceanZone, sampleOcean } from './oceanPalette';
import type { OceanSample } from './oceanPalette';

/**
 * How deep the page currently is, published once per frame.
 *
 * A module singleton rather than React context, and deliberately so: the
 * consumers are `LightRays` and the light rig (inside the R3F tree), the
 * marine snow (a plain 2D canvas), the CSS bridge (the document element) and
 * the depth plates (DOM, inside the portfolio list). There is no common React
 * ancestor to hang a provider on, and there is exactly one whale and one page,
 * so a singleton is both the only thing that reaches every consumer and an
 * honest description of the situation.
 *
 * Written by `WhaleModel`'s `useFrame`, which is already the one place that
 * has the frame, the scroll and the whale's world position at the same time.
 *
 * ORDERING: consumers inside the R3F tree read this in their own `useFrame`,
 * and some of them will run BEFORE the writer on any given frame — R3F's
 * `EffectComposer` already claims a render priority, so the loop is not in
 * source order. That is fine and is not worth fixing. A light colour that is
 * one frame stale is 16 ms behind, which is invisible, and chasing exact
 * ordering with priorities makes the whole thing fragile to reordering later.
 */
export interface DepthSignal {
    /** 0 at the surface, 1 at the deepest point. Already smoothed. */
    depth: number;
    /** Depth expressed in metres of fiction, for the plates. */
    metres: number;
    /** Name of the zone currently occupied. */
    label: string;
    /** Discrete zone index, for consumers that want a cut rather than a fade. */
    zone: number;
    /** Signed page progress rate, viewport-heights per second. Positive is
     *  descending. Used for the ascent, which has to read as a direction. */
    rate: number;
    /** True while the page is rising rather than sinking. */
    ascending: boolean;
    /** The whale's reveal envelope, mirrored so consumers need one import. */
    reveal: number;
    /** The sampled water column at `depth`. Mutated in place — read it, do
     *  not retain it. */
    ocean: OceanSample;
}

export const depthSignal: DepthSignal = {
    depth: 0,
    metres: 0,
    label: 'surface',
    zone: 0,
    rate: 0,
    ascending: false,
    reveal: 0,
    ocean: createOceanSample(),
};

/**
 * The page's depth curve.
 *
 * Scroll progress is NOT depth. The page ends with an ascent — the contact
 * section is where you surface — so the curve rises to 1 across the portfolio
 * and then comes back down. `ASCENT_START` is where the turn happens, as a
 * fraction of total page scroll, and it sits just after the statement so the
 * statement plays at the deepest point.
 */
const ASCENT_START = 0.88;
/** How far back up the ascent gets. Floored high, not toward the surface —
 *  a light, vivid backdrop behind the contact form read as the scene
 *  breaking character rather than as "surfacing". The page now stays in
 *  deep water (dark backdrop, faded lights) all the way to the bottom. */
const ASCENT_FLOOR = 0.92;

export function depthFromScroll(progress: number): number {
    const p = MathUtils.clamp(progress, 0, 1);
    if (p <= ASCENT_START) return p / ASCENT_START;
    const t = (p - ASCENT_START) / (1 - ASCENT_START);
    // Eased, because surfacing should feel like relief arriving quickly and
    // then easing off, not like a linear winch.
    const eased = 1 - Math.pow(1 - t, 2);
    return MathUtils.lerp(1, ASCENT_FLOOR, eased);
}

let lastDepth = 0;

/**
 * Publish this frame's depth. Allocation-free.
 *
 * `dt` is used only for the rate estimate, which is why it is clamped rather
 * than trusted: a tab refocus hands over a multi-second delta, and an
 * unclamped divide would report a rate large enough to flip `ascending` for
 * one frame and pop every consumer keyed off it.
 */
export function publishDepth(depth: number, reveal: number, dt: number): void {
    const d = MathUtils.clamp(depth, 0, 1);
    const safeDt = Math.max(1e-4, Math.min(dt, 0.05));

    // Smoothed, so a consumer reading `rate` gets the page's intent rather
    // than the jitter of a trackpad.
    const raw = (d - lastDepth) / safeDt;
    depthSignal.rate = MathUtils.lerp(depthSignal.rate, raw, 1 - Math.exp(-6 * safeDt));
    lastDepth = d;

    // Deadbanded. Without it `ascending` chatters every time the page settles,
    // and anything keyed off it — the surface plane, the ray direction —
    // flickers while the user is doing nothing at all.
    if (depthSignal.rate < -0.02) depthSignal.ascending = true;
    else if (depthSignal.rate > 0.02) depthSignal.ascending = false;

    depthSignal.depth = d;
    depthSignal.reveal = reveal;
    depthSignal.zone = oceanZone(d);

    sampleOcean(d, depthSignal.ocean);
    depthSignal.metres = depthSignal.ocean.metres;
    depthSignal.label = depthSignal.ocean.label;
}
