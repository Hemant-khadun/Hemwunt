import { viewportHeight } from '../utils/viewport';
import { MathUtils } from 'three';

/**
 * The opening story: the hero and the chapters between it and the projects.
 *
 * Built after storytelling.noomoagency.com: scroll is a timeline, and
 * everything in this stretch of the page — the words, the whale, the water —
 * is a pure function of how far down it you are. Scroll back and it rewinds
 * exactly. Each chapter is one short phrase that assembles word by word out of
 * a blur, holds, and dissolves as the next begins, while the whale performs
 * one move per chapter.
 *
 * Positions are in viewport heights of scroll (`scrollY / viewportHeight()`,
 * CSS 100vh: see utils/viewport.ts). The
 * page reserves the room for them: the hero is 100vh and `Story` is a spacer
 * of `STORY_SPACER_VH` below it, so the projects start after the last chapter.
 */

export interface Chapter {
    /** Lines of words. Words wrapped in *asterisks* are set as accents
     *  (italic serif), the way the reference sets its key words. */
    lines: string[];
    /** Where on screen the phrase sits. */
    align: 'center' | 'left' | 'right';
    /** Sit in the lower part of the screen instead of mid-height, clear of
     *  the bright splash and light rays near the surface. */
    low?: boolean;
    /** Scroll (vh) at which the first word starts to appear. */
    start: number;
    /** Scroll (vh) at which the last word has fully arrived. */
    arrived: number;
    /** Scroll (vh) at which it starts to dissolve. */
    leave: number;
    /** Scroll (vh) at which it is gone. */
    gone: number;
    /** Scroll (vh) of this chapter's scene: where one scroll takes the page
     *  (see utils/ScrollBeats.tsx). Between `arrived` and `leave`, the phrase
     *  whole and the whale on its mark. */
    rest: number;
    /** Taken by THE SWIM-BY: it leaves on the whale's clock, not the page's,
     *  so it is still there when the whale comes over it however far the
     *  page has run ahead (a settle glides a chapter in about a second; the
     *  whale takes two or three to swim it). The page takes it only as the
     *  story ends. */
    wiped?: boolean;
    /** Written in the whale's wake (THE SWIM-BY): each word assembles once
     *  the whale has crossed it, rather than in reading order on the page's
     *  clock. `start`..`arrived` then only lets the words in (and, scrolling
     *  back, takes them away); the whale decides when each one comes. */
    wake?: boolean;
}

/**
 * THE SWIM-BY. Between the third chapter and the last, the whale crosses the
 * frame right in front of the lens, left to right, close enough to fill it,
 * and the last phrase is written in its wake.
 *
 * The whale's progress (vh) over which it is crossing: coming in from the
 * left at the start, out of frame to the right by the end. On the WHALE's
 * clock, not the page's: it swims its route with mass and lags the page by a
 * few tenths of a viewport on a normal scroll, so words keyed to the page
 * would appear before it had passed them.
 */
export const SWIM_BY: [number, number] = [3.8, 4.55];

/**
 * Where the story whale is on its route (vh, on its own clock), written by
 * WhaleModel every frame; -1 when it is not on the outward route (on the way
 * home, breaching). `at` is when it was last written (performance.now()), so
 * a page without the whale (no WebGL) falls back to the page's clock.
 */
export const storyWhale = { progress: -1, at: Number.NEGATIVE_INFINITY };

/** Whether the story's words have caught up with the page (Story.tsx paces
 *  them), so a scene is not left before its phrase has been written. */
export const storyText = { settled: true };

/** The hero title dissolves over this range as the dive begins. */
export const HERO_TITLE_FADE: [number, number] = [0.06, 0.42];

export const CHAPTERS: Chapter[] = [
    {
        lines: ['Most people', 'only ever see', 'the *surface.*'],
        align: 'center',
        low: true,
        start: 0.72,
        arrived: 1.12,
        leave: 1.55,
        gone: 1.85,
        rest: 1.35,
    },
    {
        lines: ['Beneath it lives', 'everything that', 'makes it *move.*'],
        align: 'right',
        start: 1.95,
        arrived: 2.35,
        leave: 2.75,
        gone: 3.05,
        rest: 2.55,
    },
    {
        lines: ['I read every click', 'as a *question* —', 'and build answers', 'all the way down.'],
        align: 'left',
        start: 3.15,
        arrived: 3.55,
        // Held until the whale comes in over it: its body wipes the words
        // away (see Story.tsx). Short of SWIM_BY[0], so the whale resting on
        // this chapter has not started to take it.
        leave: 4.1,
        gone: 4.35,
        rest: 3.65,
        wiped: true,
    },
    {
        lines: ['Come and see', "what's *down here.*"],
        align: 'center',
        start: 3.95,
        arrived: 4.2,
        // Past SWIM_BY[1]: a whale resting here has crossed, so every word
        // has been written. The projects' intro starts writing at 5.5.
        leave: 5.1,
        gone: 5.4,
        rest: 4.8,
        wake: true,
    },
];

/** Where the page settles through the story (vh), in order: the hero, then
 *  each chapter (see Chapter.rest). */
export const STORY_BEATS = [0, ...CHAPTERS.map((c) => c.rest)];

/** Height of the spacer between the hero and the projects, in vh. The first
 *  project section enters the viewport once the last chapter has gone. */
export const STORY_SPACER_VH = 5.2;

/** Scroll range (vh) the story occupies, hero included. */
export const STORY_END_VH = 1 + STORY_SPACER_VH;

/**
 * Page progress as the DEPTH curve should see it.
 *
 * The ocean table, the depth plates and the light rig were tuned against page
 * progress before the story existed. Counted at full length, the story would
 * spend a third of the descent before the first project and push every
 * project a zone deeper. So its scroll counts at a quarter: the story still
 * darkens the water as you go down, the projects keep their depths.
 */
const STORY_DEPTH_WEIGHT = 0.25;

export function depthProgress(scrollY: number, maxScroll: number): number {
    if (maxScroll <= 0) return 0;
    const vh = viewportHeight();
    const a = vh;
    const len = STORY_SPACER_VH * vh;
    const cut = len * (1 - STORY_DEPTH_WEIGHT);
    const through = MathUtils.clamp((scrollY - a) / len, 0, 1);
    return MathUtils.clamp((scrollY - cut * through) / Math.max(1, maxScroll - cut), 0, 1);
}

/** 0..1 of a chapter's entrance, by word, and of its exit. */
export function chapterPhase(c: Chapter, s: number): { enter: number; exit: number } {
    return {
        enter: MathUtils.clamp((s - c.start) / (c.arrived - c.start), 0, 1),
        exit: MathUtils.clamp((s - c.leave) / (c.gone - c.leave), 0, 1),
    };
}
