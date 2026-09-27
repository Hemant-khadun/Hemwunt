/**
 * The shot list. One composed shot per stop on the dive.
 *
 * Every number here is INTENT handed to the whale animator — a depth it
 * should want, a staging offset for framing, how hard it should work — plus
 * an optional beat, which is a request the body may decline. Nothing is a
 * position. See `WhaleIntent` in whaleAnimator.ts for the contract.
 *
 * World reference (see stage.ts): the surface is at y = +1.1 and the visible
 * band at z = 0 runs from about y = -5.4 to +1.4. Apparent size is
 * 4 / (4 + stageZ), so +1.0 is ~133% and -3.2 is ~56%.
 *
 * Distance in the deep is sold by LIGHT, not size — the ocean table blends
 * the body into the water. That is why stageZ stays moderate even for the
 * "distant silhouette": at the 36% a truly far whale would need, it reads as
 * a bug rather than as distance.
 *
 * What a shot deliberately does NOT specify is which side of the frame the
 * whale is on. Its X is integrated from time while scroll is set by the
 * visitor; the two clocks never phase-lock, and forcing them would produce a
 * whale that visibly hurries to hit marks. Every shot has to read with the
 * whale heading either way.
 */

export type Beat =
    /** Nothing. The whale just settles into the shot. */
    | 'none'
    /** Ask for a sounding arch as the station arrives. */
    | 'arch'
    /** Fire a burst — the close pass, a surge past the viewer. */
    | 'burst'
    /** Ask the whale to come back the other way — a banked, slow circle. */
    | 'turn';

export interface Shot {
    name: string;
    /** World Y to want. */
    depth: number;
    /** Staging offset along Z. Positive is closer. */
    stageZ: number;
    /** Cruise tail-beat multiplier. */
    effort: number;
    beat: Beat;
    /** Station `centred` value (-1 below .. 0 centre) at which the beat is
     *  requested on the way down. Earlier than centre on purpose: the body
     *  takes a second or more to answer, and the beat should land as the shot
     *  does, not after it. */
    beatAt: number;
}

/**
 * The top of the page. The hero is now a photograph whose waterline sits
 * across the upper-middle of the frame, and the whale is composited over it —
 * so the whale must be fully BELOW that photographed waterline, in the sunlit
 * blue beneath it, never poking up through the wave.
 *
 * World depth is not screen height. The camera sits at y = -2, and the visible
 * band at z = 0 runs from +1.4 at the top of the frame to -5.4 at the bottom,
 * so screen position from the top is (1.4 - y) / 6.8. The photo's waterline
 * crosses about 45% down; the sunlit blue beneath it starts about 52%. Verified
 * in headless renders: -0.2 and -1.6 both put the whale on the waterline.
 * -2.2 landed at ~53%, just under the sparkle — but that is the ORIGIN, not
 * the nose: with the body pitched and its length carried forward of that
 * point, the head still poked up into the waterline blur. -2.6 (~59%) pushes
 * the whole animal, nose included, further into the clear water below it.
 *
 * Every station below is deeper still, so the dive only ever goes down. "The
 * approach" moved by the same amount to keep that true (was -2.2 -> -2.4,
 * now -2.6 -> -2.8) rather than only deepening the hero, which would have the
 * whale rise for the whole first scroll segment before diving again.
 *
 * `stageZ`: this is now also the whale's fixed REST pose (see `heroFrozen` in
 * whaleAnimator.ts) — the frame the visitor actually lands on and lingers on
 * before ever scrolling, not just a station passed through. Brought down from
 * +1.5 (~160% apparent size) to +0.6 (~133%, per the `4/(4-stageZ)` rule
 * below) so the whole animal — now diving nose-down instead of surfacing —
 * fits under the photo's wave crest with the tail landing in its whitewater
 * splash instead of overflowing past it. Paired with `heroRestX` below,
 * which does the same job sideways.
 */
export const HERO: Shot = {
    name: 'surface',
    depth: -2.6,
    stageZ: 0.6,
    effort: 1,
    beat: 'none',
    beatAt: 0,
};

/**
 * One per portfolio item, in page order. The index here must match the
 * item's index in `PROJECTS` (Portfolio.tsx), which is what registers it.
 */
export const STATION_SHOTS: Shot[] = [
    {
        // Deliberately uneventful. Establish the animal before doing anything
        // clever with it, or the close pass has nothing to be bigger than.
        name: 'the approach',
        depth: -2.8,
        stageZ: -0.8,
        effort: 0.9,
        beat: 'none',
        beatAt: 0,
    },
    {
        name: 'the sounding',
        depth: -2.9,
        stageZ: -1.5,
        effort: 1.15,
        beat: 'arch',
        beatAt: -0.6,
    },
    {
        name: 'the close pass',
        depth: -3.2,
        stageZ: 1.0,
        effort: 1.25,
        beat: 'burst',
        beatAt: -0.3,
    },
    {
        name: 'the spiral',
        depth: -3.8,
        stageZ: -2.2,
        effort: 0.8,
        beat: 'turn',
        beatAt: -0.35,
    },
    {
        // Barely working. Vast and quiet; the body is mostly water by now.
        name: 'the depths',
        depth: -4.6,
        stageZ: -3.2,
        effort: 0.72,
        beat: 'none',
        beatAt: 0,
    },
];

/**
 * The statement. Its depth is ABOVE the last station's on purpose: a positive
 * depth error is what pitches the nose up, so this is the first upward pitch
 * of the whole page, arriving at the deepest point of the dive.
 */
export const STATEMENT: Shot = {
    name: 'the turn',
    depth: -4.0,
    stageZ: -2.0,
    effort: 0.9,
    beat: 'none',
    beatAt: 0,
};

/** The contact section: surfacing. The whale works hard toward the light. */
export const ASCENT: Shot = {
    name: 'the ascent',
    depth: 0.5,
    stageZ: -0.4,
    effort: 1.4,
    beat: 'none',
    beatAt: 0,
};

/**
 * Where the statement's key sits, as a fraction of total scroll. Kept just
 * under `ASCENT_START` in depthSignal.ts so the whale's turn upward and the
 * light's return begin together rather than one leading the other.
 */
export const STATEMENT_AT = 0.86;
