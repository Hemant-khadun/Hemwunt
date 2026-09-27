import gsap from 'gsap';
import { MathUtils } from 'three';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import type { WhaleAnimator, WhaleIntent } from './whaleAnimator';
import { ASCENT, HERO, STATEMENT, STATEMENT_AT, STATION_SHOTS } from './diveScore';
import type { Shot } from './diveScore';
import { getStation } from './stationRegistry';
import { prefersReducedMotion } from './motionPreference';
import { requestFrontPass, updateFrontPass } from './frontPass';
import { whaleScreen } from './screenProjector';

gsap.registerPlugin(MotionPathPlugin);

/**
 * Composes the dive. Pure logic — no React, no scene graph — mirroring the
 * animator it drives, so both stay testable with nothing but numbers.
 *
 * Each frame it answers two questions:
 *
 *   1. What shot are we in?  The shots are keyed to SCROLL POSITIONS: the
 *      top of the page, the centre of each portfolio item, the statement and
 *      the bottom. Between keys the intent is interpolated with a smoothstep,
 *      whose zero slope at each end is what makes a shot HOLD while its item
 *      is centred and only move in the gaps.
 *
 *   2. Is a beat due?  Each station's beat is requested once, on the way
 *      down, as the item crosses its `beatAt`. It re-arms only once the item
 *      is back below the fold, so scrolling back up through the portfolio does
 *      not fire five arches, a burst and a turn in reverse — and a visitor who
 *      scrolls down again gets every beat again.
 *
 * Keyed by scroll position rather than by "active station" because the
 * active-station approach steps: when the nearest item changes, the blend
 * jumps. Scroll positions are continuous by construction, and ScrollTrigger
 * already measures each item's centre on refresh, so this is also cheaper.
 */
export interface DiveDirector {
    /**
     * The intent for this frame, or undefined before the page has been
     * measured — the animator then falls back to its linear map, so the first
     * frames still behave. The returned object is reused; read it, do not
     * retain it.
     *
     * `heading` is the whale's heading from the PREVIOUS frame's output. A
     * turn beat needs to know which way "the other way" is.
     */
    update(
        scrollY: number,
        maxScroll: number,
        animator: WhaleAnimator,
        heading: number,
    ): WhaleIntent | undefined;
}

interface Key {
    scroll: number;
    shot: Shot;
}

/** A beat re-arms once its item is this far below centre (-1 is fully below
 *  the fold). Well clear of every `beatAt`, so the arm and fire thresholds
 *  cannot chatter against each other on a slow scroll. */
const REARM_BELOW = -0.9;

/**
 * How far from the middle of the frame, in normalised screen units (1 is the
 * edge), the whale may get while still heading outward before it is asked to
 * come about.
 *
 * Without this the whale was on screen only about a third of the time. Its
 * automatic turn sits at x = 15, but at 16:9 with the camera 4 units away the
 * frame only spans about x = +-6, so it swam out of view for ~16 s on each side
 * before returning — which on a hero whose whole subject is the whale reads as
 * the whale being missing.
 *
 * Measured on the SCREEN rather than in the animator's own X, so it accounts
 * for staging, the camera's lean and the <Center> offset without knowing any of
 * them. At 0.45 the banked turn's arc (a turn diameter of ~5 units) peaks near
 * the frame edge: the whale swings wide, visibly, and comes back.
 */
const KEEP_IN_FRAME_NDC = 0.45;

/**
 * The depth TARGET the physics chases between two consecutive shots is no
 * longer a straight ramp. Each leg of the dive gets its own short bezier —
 * built once from the shot list itself, nothing new to author — so the whale
 * noses toward a naturally curved depth rather than a straight line, while
 * still reaching the physics animator by the same `intent.targetDepth`
 * channel it always has. The animator is what decides how the whale actually
 * gets there (pitch, thrust, drag); this only reshapes the number it is
 * chasing. `stageZ`/`effort` stay a plain lerp — they are camera framing and
 * tail effort, not the dive path.
 *
 * Deliberately NOT applied to the whale's lateral (X) position: that axis is
 * intentionally unscheduled against scroll (see `WhaleIntent`/diveScore's
 * header note), and curving it here would reintroduce exactly the "hurries
 * to hit a mark" problem that invariant exists to avoid.
 */
const SHOT_SEQUENCE: Shot[] = [HERO, ...STATION_SHOTS, STATEMENT, ASCENT];

/** How far the curve bows past a straight ramp between two depths, as a
 *  fraction of the depth change. Small and restrained: this is meant to read
 *  as a natural swoop into each shot, not a new dramatic beat. */
const DEPTH_PATH_BOW = 0.3;

const depthPaths: gsap.plugins.RawPath[] = SHOT_SEQUENCE.slice(0, -1).map((shot, i) => {
    const dA = shot.depth;
    const dB = SHOT_SEQUENCE[i + 1].depth;
    const bow = (dB - dA) * DEPTH_PATH_BOW;
    // A gentle S: the curve dips a little past the ramp on the way out of
    // the first shot, then eases back to land exactly on the second.
    const path = `M0,${dA} C0.33,${dA + (dB - dA) * 0.25 + bow} 0.66,${dA + (dB - dA) * 0.75} 1,${dB}`;
    const rawPath = MotionPathPlugin.getRawPath(path);
    MotionPathPlugin.cacheRawPathMeasurements(rawPath);
    return rawPath;
});

/** Depth at eased progress `t` (0..1) along leg `segment` of the dive. */
function pathDepth(segment: number, t: number): number {
    return MotionPathPlugin.getPositionOnPath(depthPaths[segment], t).y;
}

/**
 * The shot currently being composed, for consumers that frame it rather than
 * perform it — the camera most of all, which widens slightly for the close
 * pass and eases in for the distant ones. Written by `update`; a module
 * singleton like the depth signal, and for the same reasons.
 */
export const diveShot = {
    /** False before the page is measured; consumers hold their rest pose. */
    active: false,
    /** The interpolated staging offset. Positive is a close shot. */
    stageZ: 0,
    effort: 1,
};

export function createDiveDirector(): DiveDirector {
    const intent: WhaleIntent = { targetDepth: HERO.depth, stageZ: HERO.stageZ, effort: 1 };

    // Allocated once: hero + stations + statement + ascent.
    const keys: Key[] = Array.from({ length: STATION_SHOTS.length + 3 }, () => ({
        scroll: 0,
        shot: HERO,
    }));

    const armed: boolean[] = STATION_SHOTS.map(() => false);

    const fireBeat = (shot: Shot, index: number, animator: WhaleAnimator, heading: number) => {
        switch (shot.beat) {
            case 'arch':
                animator.requestArch();
                break;
            case 'burst':
                animator.triggerBurst();
                // The close pass is also the page's one front-of-content
                // moment. Off unless enabled — see frontPass.ts.
                requestFrontPass(index);
                break;
            case 'turn':
                // Whichever way it is going, ask it to come about. The
                // animator refuses if the whale is too near centre or already
                // mid-turn, and the request simply lapses.
                animator.requestTurn(heading === 1 ? -1 : 1);
                break;
            case 'none':
                break;
        }
    };

    return {
        update(scrollY, maxScroll, animator, heading) {
            // Cleared first, so every early return below leaves consumers
            // correctly told that no shot is being composed.
            diveShot.active = false;
            // Every frame, before any early return, so a pass already under
            // way always gets handed back even if the page is re-measuring.
            updateFrontPass();

            // Keep the animal in the picture. A request, like every other: the
            // animator refuses it mid-turn or inside its turn cooldown, and it
            // simply lapses. Heading +1 swims toward +X, which is screen right.
            if (
                whaleScreen.valid &&
                Math.abs(whaleScreen.ndcX) > KEEP_IN_FRAME_NDC &&
                Math.sign(whaleScreen.ndcX) === heading
            ) {
                animator.requestTurn(heading === 1 ? -1 : 1);
            }
            if (maxScroll <= 0) return undefined;

            // --- 1. Build the keys ----------------------------------------
            let n = 0;
            keys[n].scroll = 0;
            keys[n].shot = HERO;
            n++;

            for (let i = 0; i < STATION_SHOTS.length; i++) {
                const station = getStation(i);
                // Not yet registered or not yet measured: hand control back to
                // the animator's own fallback rather than composing around a
                // hole in the page.
                if (!station || !station.measured) return undefined;
                keys[n].scroll = Math.max(keys[n - 1].scroll + 1, station.centreScroll);
                keys[n].shot = STATION_SHOTS[i];
                n++;
            }

            keys[n].scroll = Math.max(keys[n - 1].scroll + 1, maxScroll * STATEMENT_AT);
            keys[n].shot = STATEMENT;
            n++;
            keys[n].scroll = Math.max(keys[n - 1].scroll + 1, maxScroll);
            keys[n].shot = ASCENT;
            n++;

            // --- 2. Interpolate ---------------------------------------------
            let k = 0;
            while (k < n - 2 && scrollY > keys[k + 1].scroll) k++;
            const a = keys[k];
            const b = keys[k + 1];
            const t = MathUtils.clamp((scrollY - a.scroll) / (b.scroll - a.scroll), 0, 1);
            // Smoothstep: zero slope at both keys, so each shot holds while
            // its item is centred and all the travel happens in between.
            const e = t * t * (3 - 2 * t);

            intent.targetDepth = pathDepth(k, e);
            intent.stageZ = MathUtils.lerp(a.shot.stageZ, b.shot.stageZ, e);
            intent.effort = MathUtils.lerp(a.shot.effort, b.shot.effort, e);

            diveShot.active = true;
            diveShot.stageZ = intent.stageZ;
            diveShot.effort = intent.effort;

            // --- 3. Beats ---------------------------------------------------
            // Reduced motion keeps the composition — depth, framing, the light
            // — and drops only the sudden events.
            if (!prefersReducedMotion()) {
                for (let i = 0; i < STATION_SHOTS.length; i++) {
                    const shot = STATION_SHOTS[i];
                    if (shot.beat === 'none') continue;
                    const station = getStation(i);
                    if (!station) continue;

                    if (station.centred < REARM_BELOW) {
                        armed[i] = true;
                    } else if (armed[i] && station.centred >= shot.beatAt) {
                        armed[i] = false;
                        fireBeat(shot, i, animator, heading);
                    }
                }
            }

            return intent;
        },
    };
}
