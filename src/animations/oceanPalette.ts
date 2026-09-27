import { Color, MathUtils } from 'three';

/**
 * The water column, as a set of stops sampled by depth.
 *
 * This is the single source of truth for what the ocean looks like at any
 * point in the page. Lights, god rays, post-processing, marine snow, the
 * whale's own body shader and the CSS custom properties all read from here,
 * so the scene cannot drift out of agreement with itself.
 *
 * The values are pulled from an underwater photograph of a humpback near the
 * surface, and the thing that photograph teaches is that there is ONE light
 * and it lives at the surface. Everything below is that light running out.
 * So almost every number in this table decreases with depth; the two that do
 * not — `biolum` and `bloom` — are the compensations that keep the deep from
 * being simply empty.
 *
 * Depth is expressed twice. `at` is normalised page progress, which is what
 * everything actually samples by. `metres` is the fiction laid over it, and
 * exists only to be printed on the depth plates. The two are deliberately
 * NOT proportional: the interesting light changes all happen in the first few
 * hundred metres, so the shallow stops are spread out and the deep ones are
 * compressed.
 */
export interface OceanStop {
    /** Normalised page depth, 0 at the surface, 1 at the deepest point. */
    at: number;
    /** Depth in metres, for the plates. Not linear against `at`. */
    metres: number;
    /** Zone name, for the plates. */
    label: string;

    // --- Water -------------------------------------------------------------
    /** Water nearest the camera. Also the CSS backdrop's upper colour. */
    waterNear: string;
    /** Water in the distance and below. The CSS backdrop's lower colour. */
    waterFar: string;

    // --- The light rig -----------------------------------------------------
    /** The sun, spotlighting down from the surface. Reaches zero in the deep. */
    sun: number;
    /** Rim on the whale's back. FLOORED, never zero — see `RIM_FLOOR`. */
    rim: number;
    /** Side fill that reveals the flank's contours. First to go. */
    fill: number;
    /** Ambient. Low everywhere; the scene is lit by direction, not by fill. */
    ambient: number;
    /** Cold cyan bioluminescence. Absent up top, the only warm thing down low. */
    biolum: number;

    // --- Dressing ----------------------------------------------------------
    /** Bloom intensity. Rises with depth so the bioluminescence carries. */
    bloom: number;
    /** God-ray opacity multiplier. Gone once the sun is. */
    rays: number;
    /** Visibility of the surface plane overhead. */
    surface: number;
    /** How far the whale's body blends into the water colour. This is what
     *  sells distance in the deep, since apparent size barely moves. */
    waterBlend: number;
    /** Marine snow density, 0..1. Peaks in the midnight zone: the abyss
     *  genuinely has less falling through it than the water above it. */
    snow: number;
}

/**
 * Below this the whale stops being findable, and a visitor who scrolls fast
 * concludes it broke rather than that it swam into the dark. The rim is the
 * last thing standing between "atmospheric" and "looks like a bug", so it is
 * floored here rather than in each stop, where it could be edited away.
 */
export const RIM_FLOOR = 0.5;

export const OCEAN: OceanStop[] = [
    {
        at: 0,
        metres: 0,
        label: 'surface',
        // Sampled from the owner's reference photograph for the live ocean
        // hero (2026-09-25): the saturated blue just under its sunlit band,
        // and the deep blue at the bottom of the frame. A purer, darker blue
        // than the teal this used to be; the brightness near the surface now
        // comes from the sea's own glow (see the waterline pass), not from a
        // pale backdrop.
        waterNear: '#0a5d8f',
        waterFar: '#03325a',
        sun: 5.0,
        // Contrast over readability. Composited over a real photograph the
        // whale read as a flat, milky cut-out: too much fill and ambient
        // levelled its form. The reference animal is dark slate with a bright
        // lit edge, which is what a strong rim over weak fill produces.
        rim: 2.6,
        fill: 0.25,
        ambient: 0.08,
        biolum: 0,
        bloom: 0.8,
        rays: 1.0,
        // The procedural underside-of-the-surface is retired: the hero
        // photograph carries the real surface, and at a grazing angle the
        // shader rendered as neon ellipses. Kept in the table (at zero) so it
        // can be brought back per stop if wanted.
        surface: 0,
        waterBlend: 0.05,
        snow: 0.05,
    },
    {
        at: 0.18,
        metres: 200,
        label: 'twilight zone',
        // The handoff stop. The photograph finishes fading at about this depth,
        // darkened by its own shade layer, so these are the photo's lower band
        // (#054b78 .. #022a48) taken down by that shade — continuous by design.
        // Taken down to meet the photo's deepest band (#06283f): its trailing
        // gradient dissolves into this backdrop, and water must never get
        // LIGHTER as you descend, or the seamless handoff reads as surfacing.
        // Sampled from the hero dive footage at ~2 s (mid #006ba9, bottom
        // #001e3f), taken down slightly: at this depth the footage is still
        // on screen, and the backdrop behind it must never be lighter.
        waterNear: '#025a8e',
        waterFar: '#001e3f',
        sun: 3.4,
        rim: 1.8,
        fill: 0.45,
        ambient: 0.18,
        biolum: 0.05,
        bloom: 0.95,
        // Restrained at the handoff: the photograph has just shown the real
        // shafts of light, and full-strength procedural rays arriving the
        // moment it fades read as a flare rather than a continuation.
        rays: 0.45,
        surface: 0,
        waterBlend: 0.18,
        snow: 0.45,
    },
    {
        at: 0.36,
        metres: 600,
        label: 'twilight floor',
        // The handoff stop: the hero video's LAST frame (sampled at 7.96 s —
        // mid #003669, bottom #000f28) fades into this backdrop at about this
        // depth, so these are that frame's own blues. Re-sample if the video
        // in public/hero/ is replaced.
        waterNear: '#01416f',
        waterFar: '#000f28',
        sun: 1.9,
        rim: 1.5,
        fill: 0.28,
        ambient: 0.14,
        biolum: 0.2,
        bloom: 1.2,
        rays: 0.35,
        surface: 0,
        waterBlend: 0.34,
        snow: 0.8,
    },
    {
        at: 0.54,
        metres: 1200,
        label: 'midnight zone',
        waterNear: '#04203a',
        waterFar: '#01111f',
        sun: 0.8,
        rim: 1.2,
        fill: 0.15,
        ambient: 0.1,
        biolum: 0.5,
        bloom: 1.6,
        rays: 0.06,
        surface: 0,
        waterBlend: 0.5,
        snow: 1.0,
    },
    {
        at: 0.72,
        metres: 2200,
        label: 'midnight floor',
        waterNear: '#03192a',
        waterFar: '#010a12',
        sun: 0.25,
        rim: 0.85,
        fill: 0.06,
        ambient: 0.07,
        biolum: 0.42,
        bloom: 1.5,
        rays: 0,
        surface: 0,
        waterBlend: 0.62,
        snow: 0.7,
    },
    {
        at: 1,
        metres: 4000,
        label: 'abyssal zone',
        waterNear: '#01131f',
        // Navy, not black. A finished underwater frame never contains a true
        // neutral black — even its deepest shadow carries the water's colour.
        // Pure #000 here reads as the render having gone missing.
        waterFar: '#01070d',
        sun: 0,
        rim: RIM_FLOOR,
        fill: 0,
        ambient: 0.04,
        biolum: 0.3,
        bloom: 1.4,
        rays: 0,
        surface: 0,
        waterBlend: 0.72,
        snow: 0.35,
    },
];

/** A sampled slice of the water column. Mutated in place, never reallocated. */
export interface OceanSample {
    metres: number;
    label: string;
    waterNear: Color;
    waterFar: Color;
    sun: number;
    rim: number;
    fill: number;
    ambient: number;
    biolum: number;
    bloom: number;
    rays: number;
    surface: number;
    waterBlend: number;
    snow: number;
}

export function createOceanSample(): OceanSample {
    return {
        metres: 0,
        label: OCEAN[0].label,
        waterNear: new Color(OCEAN[0].waterNear),
        waterFar: new Color(OCEAN[0].waterFar),
        sun: OCEAN[0].sun,
        rim: OCEAN[0].rim,
        fill: OCEAN[0].fill,
        ambient: OCEAN[0].ambient,
        biolum: OCEAN[0].biolum,
        bloom: OCEAN[0].bloom,
        rays: OCEAN[0].rays,
        surface: OCEAN[0].surface,
        waterBlend: OCEAN[0].waterBlend,
        snow: OCEAN[0].snow,
    };
}

// Scratch colours, so sampling allocates nothing on a 60 Hz path.
const nearA = new Color();
const nearB = new Color();
const farA = new Color();
const farB = new Color();

/**
 * Sample the water column at `depth` (0..1) into `out`.
 *
 * Linear between stops on purpose. The stops are already placed where the
 * light actually changes, so easing between them would double up the shaping
 * and make the shallow transitions mushy.
 */
export function sampleOcean(depth: number, out: OceanSample): OceanSample {
    const d = MathUtils.clamp(depth, 0, 1);

    // Small table, scanned linearly. A binary search here would be slower in
    // practice and harder to read.
    let i = 0;
    while (i < OCEAN.length - 2 && d > OCEAN[i + 1].at) i++;

    const a = OCEAN[i];
    const b = OCEAN[i + 1];
    const span = b.at - a.at;
    const t = span > 0 ? MathUtils.clamp((d - a.at) / span, 0, 1) : 0;

    out.metres = Math.round(MathUtils.lerp(a.metres, b.metres, t));
    // The label is the zone you are IN, so it holds until the next stop is
    // actually reached rather than crossfading at the midpoint.
    out.label = t < 1 ? a.label : b.label;

    nearA.set(a.waterNear);
    nearB.set(b.waterNear);
    out.waterNear.copy(nearA).lerp(nearB, t);

    farA.set(a.waterFar);
    farB.set(b.waterFar);
    out.waterFar.copy(farA).lerp(farB, t);

    out.sun = MathUtils.lerp(a.sun, b.sun, t);
    out.rim = Math.max(RIM_FLOOR, MathUtils.lerp(a.rim, b.rim, t));
    out.fill = MathUtils.lerp(a.fill, b.fill, t);
    out.ambient = MathUtils.lerp(a.ambient, b.ambient, t);
    out.biolum = MathUtils.lerp(a.biolum, b.biolum, t);
    out.bloom = MathUtils.lerp(a.bloom, b.bloom, t);
    out.rays = MathUtils.lerp(a.rays, b.rays, t);
    out.surface = MathUtils.lerp(a.surface, b.surface, t);
    out.waterBlend = MathUtils.lerp(a.waterBlend, b.waterBlend, t);
    out.snow = MathUtils.lerp(a.snow, b.snow, t);

    return out;
}

/** Zone index at a given depth, for consumers that want a discrete cut. */
export function oceanZone(depth: number): number {
    const d = MathUtils.clamp(depth, 0, 1);
    let i = 0;
    while (i < OCEAN.length - 2 && d > OCEAN[i + 1].at) i++;
    return i;
}
