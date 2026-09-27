import { viewportHeight } from '../utils/viewport';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import {
    CHAPTERS,
    HERO_TITLE_FADE,
    STORY_SPACER_VH,
    SWIM_BY,
    chapterPhase,
    storyText,
    storyWhale,
} from '../animations/story';
import { prefersReducedMotion } from '../animations/motionPreference';
import { whaleOutline } from '../animations/whaleOutline';
import { pageShown } from '../utils/loader';
import WrittenLine from './WrittenLine';
import {
    DISSOLVE_SECONDS,
    WRITE_SECONDS,
    clamp01,
    pace,
    parseLine,
    smooth,
    span,
    wordPhase,
    writeWord,
    writeWords,
} from '../animations/words';

/**
 * The opening story's words.
 *
 * Two parts. A spacer in the page flow that reserves the scroll the story
 * plays across, and a fixed layer over the scene that holds the hero title
 * and one phrase per chapter. Nothing here animates on its own: every frame,
 * each word's opacity, blur and lift are set from the scroll position, so the
 * text is scrubbed exactly like the whale and the water are (see
 * `animations/story.ts`), and scrolling back un-writes it.
 *
 * A phrase is set word by word, each rising into its line, holds, then
 * carries on up out of it as the next one begins. Words set between
 * *asterisks* in the chapter copy are accents, penned in the italic serif.
 * The writing itself is shared with the project chapters (see
 * `animations/words.ts`).
 *
 * The hero title is the one thing written on a clock rather than the scroll:
 * it writes itself in as the loader opens on the page (`pageShown`), and from
 * then on leaves and returns with the scroll like everything else.
 *
 * THE SWIM-BY hands the last phrase to the whale. While it crosses the lens
 * (story.ts SWIM_BY) the words answer to its outline on the screen
 * (`whaleOutline`) as well as the page: a word its body comes over is hidden
 * where it stands, as a body passing in front of the lens would, and the
 * `wake` chapter's words each assemble once the whole animal
 * is past them, drawn in along the line behind it. Both follow the whale's
 * own progress, so a fast scroll that runs ahead of the animal still waits
 * for it, and the phrase it wipes stays until it comes (`Chapter.wiped`).
 * Without a whale (no WebGL) the page's clock writes them as usual.
 *
 * The story is played a scene per scroll (utils/ScrollBeats.tsx): each
 * gesture takes the page to the next chapter's `rest`, so a phrase is never
 * left half written.
 */

const PARSED = CHAPTERS.map((c) => c.lines.map(parseLine));
const LAST = CHAPTERS[CHAPTERS.length - 1];

/** A word in the whale's path starts to dissolve when its body is this near
 *  (viewport widths), and is gone as the body reaches it. */
const WIPE_FEATHER = 0.05;
/** A wake word starts once the whale's trailing edge is this far past it, and
 *  has fully arrived this much further on (viewport widths). */
const WAKE_GAP = 0.01;
const WAKE_FEATHER = 0.17;
/** Where a wake word comes in from along its line (em): drawn after the whale. */
const WAKE_DRIFT = -0.9;
/** Progress (vh) over which the outline takes the words at the start of the
 *  crossing and hands them back at its end, so neither steps. */
const SWIM_BY_RAMP = 0.08;
/** A whale not heard from for this long (ms) is not on the page. */
const STALE = 500;

/** The hero title's entrance, once the loader has begun to open on it: a
 *  beat for the halves to part, then the kicker is uncovered, "Fullstack" is
 *  set, and "developer" penned, each over its own share of the time. */
const HERO_DELAY = 0.4;
const HERO_SECONDS = 2.6;
const HERO_PARTS: Array<[number, number]> = [
    [0, 0.5],
    [0.1, 0.56],
    [0.22, 1],
];
/** The scroll cue, once the title is nearly written. */
const CUE_IN: [number, number] = [0.72, 1];
/** Longest the title waits for its serif after the page is shown (ms). */
const FONT_WAIT = 800;

interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

const Story = () => {
    const layer = useRef<HTMLDivElement>(null);
    const hero = useRef<HTMLDivElement>(null);
    const cue = useRef<HTMLDivElement>(null);
    const chapterEls = useRef<Array<HTMLDivElement | null>>([]);

    useEffect(() => {
        const root = layer.current;
        if (!root) return;

        // Words per chapter, in reading order. Collected once; the copy is
        // static.
        const words = chapterEls.current.map((el) =>
            el ? Array.from(el.querySelectorAll<HTMLElement>('.story-word')) : [],
        );
        const heroParts = Array.from(hero.current?.querySelectorAll<HTMLElement>('[data-hero-part]') ?? []);
        const reduced = prefersReducedMotion();
        let last = -1;
        let lastU = -1;
        let lastIntro = -1;

        // What is drawn, paced (see `pace` in words.ts): each chapter's
        // entrance and exit, and the hero title's fade. They chase the
        // scroll's own values, and start on them.
        const shownEnter = CHAPTERS.map(() => 0);
        const shownExit = CHAPTERS.map(() => 0);
        let shownHero = 0;
        let primed = false;
        /** Something drawn is still catching up with the page. */
        let busy = false;

        // Each word's box on the screen, without the transforms written here
        // (a word's offsets are layout, not paint). Measured when first
        // needed, and again after a resize or once the webfonts have loaded.
        let boxes: Box[][] | null = null;
        const measure = () =>
            chapterEls.current.map((el, ci) => {
                if (!el) return [];
                const r = el.getBoundingClientRect();
                return words[ci].map((w) => ({
                    left: r.left + w.offsetLeft,
                    right: r.left + w.offsetLeft + w.offsetWidth,
                    top: r.top + w.offsetTop,
                    bottom: r.top + w.offsetTop + w.offsetHeight,
                }));
            });
        let alive = true;
        document.fonts?.ready.then(() => {
            if (!alive) return;
            boxes = null;
            last = -1;
        });

        // When the hero starts writing (performance.now()): as the loader
        // opens, and not before its serif is in (it arrives on a stylesheet of
        // its own; see index.html), however briefly that holds it.
        let heroAt = Number.POSITIVE_INFINITY;
        pageShown.then(() => {
            const shownAt = performance.now();
            const serif = document.fonts?.load('italic 400 1em "Instrument Serif"') ?? Promise.resolve();
            Promise.race([serif, new Promise((r) => setTimeout(r, FONT_WAIT))])
                .catch(() => undefined)
                .then(() => {
                    if (!alive) return;
                    heroAt = Math.max(performance.now(), shownAt + HERO_DELAY * 1000);
                    last = -1;
                });
        });

        /** 1 where the whale's body is on `b`, falling to 0 WIPE_FEATHER away. */
        const reach = (b: Box) => {
            const d = whaleOutline.discs;
            let gap = Infinity;
            for (let k = 0; k < whaleOutline.count; k++) {
                const x = d[k * 3];
                const y = d[k * 3 + 1];
                const dx = Math.max(b.left - x, 0, x - b.right);
                const dy = Math.max(b.top - y, 0, y - b.bottom);
                gap = Math.min(gap, Math.hypot(dx, dy) - d[k * 3 + 2]);
            }
            return smooth(clamp01(1 - gap / (WIPE_FEATHER * window.innerWidth)));
        };

        const tick = (_time?: number, deltaMs = 0) => {
            const dt = Math.min(0.1, deltaMs / 1000);
            const s = window.scrollY / viewportHeight();
            // THE SWIM-BY: where the whale is on its route, if it is here.
            const now = performance.now();
            const u = storyWhale.progress;
            const whale = u >= 0 && now - storyWhale.at < STALE && now - whaleOutline.at < STALE;
            const passing = whale && u > SWIM_BY[0] - 0.02 && u < SWIM_BY[1] + 0.02;
            // The words follow the page and, while it crosses, the whale
            // (which swims on after the page stops), and catch up with both.
            const intro = clamp01((now - heroAt) / 1000 / HERO_SECONDS);
            const writing = intro !== lastIntro;
            if (!busy && !writing && Math.abs(s - last) < 1e-4 && !passing && (!whale || Math.abs(u - lastU) < 1e-4)) return;
            last = s;
            lastU = u;
            lastIntro = intro;
            busy = false;
            /** Pace `shown` toward `target`; `rise`/`fall` as in `pace`. */
            const follow = (shown: number, target: number, rise: number, fall: number) => {
                const next = primed ? pace(shown, target, dt, rise, fall) : target;
                if (Math.abs(next - target) > 1e-4) busy = true;
                return next;
            };
            // 0..1: how far the outline has taken the words over, and how far
            // the crossing is past its end.
            const over = whale ? smooth(span(u, SWIM_BY[0], SWIM_BY[0] + SWIM_BY_RAMP)) : 0;
            const done = whale ? smooth(span(u, SWIM_BY[1] - SWIM_BY_RAMP, SWIM_BY[1])) : 0;
            if (over > 0 && !boxes) boxes = measure();
            // The whale's trailing edge on the screen (it crosses left to
            // right): the least x any part of its outline reaches.
            let trail = Infinity;
            if (whale) {
                const d = whaleOutline.discs;
                for (let k = 0; k < whaleOutline.count; k++) trail = Math.min(trail, d[k * 3] - d[k * 3 + 2]);
            }
            const vw = window.innerWidth;
            // Every phrase is gone by the time the last one is, on the page's
            // clock, whatever the whale is doing: the projects follow.
            const end = span(s, LAST.leave, LAST.gone);
            let showing = false;

            // --- Hero title ---------------------------------------------
            // Written in on its own clock (`intro`), and taken up out of its
            // lines by the scroll like every phrase after it. The intro does
            // not count as the words being busy: a visitor who scrolls the
            // moment the page opens goes, rather than waiting on the title.
            const h = hero.current;
            if (h) {
                shownHero = follow(shownHero, span(s, HERO_TITLE_FADE[0], HERO_TITLE_FADE[1]), DISSOLVE_SECONDS, WRITE_SECONDS);
                heroParts.forEach((part, i) => {
                    const [a0, a1] = HERO_PARTS[i] ?? [0, 1];
                    writeWord(part, span(intro, a0, a1), wordPhase(i, heroParts.length, 1, shownHero)[1], reduced);
                });
                h.style.visibility = shownHero >= 0.999 ? 'hidden' : 'visible';
            }
            const c = cue.current;
            if (c) c.style.opacity = ((1 - clamp01(s / 0.12)) * smooth(span(intro, CUE_IN[0], CUE_IN[1]))).toFixed(3);

            // --- Chapters -----------------------------------------------
            CHAPTERS.forEach((chapter, ci) => {
                const el = chapterEls.current[ci];
                if (!el) return;
                // A wiped chapter leaves where the page is, but no further on
                // than the whale: the page running ahead does not take it
                // before the whale's body can (see Chapter.wiped).
                const leaving = chapter.wiped && whale ? Math.min(s, u) : s;
                const wantEnter = chapterPhase(chapter, s).enter;
                const wantExit = Math.max(chapterPhase(chapter, leaving).exit, end);
                // A phrase the page has jumped clean over (a menu link, the
                // scrollbar, a reload part way down) was never on screen: it
                // is not written in and taken out again on the way past, it
                // is simply where the page says. One that was being read
                // still goes at its own pace.
                const off = wantEnter <= 0 || wantExit >= 1;
                if (off && (shownEnter[ci] < 0.02 || shownExit[ci] > 0.98)) {
                    shownEnter[ci] = wantEnter;
                    shownExit[ci] = wantExit;
                }
                // Written in no faster than a reader can follow, and
                // dissolved a little quicker, however fast the page moved.
                const enter = (shownEnter[ci] = follow(shownEnter[ci], wantEnter, WRITE_SECONDS, DISSOLVE_SECONDS));
                const exit = (shownExit[ci] = follow(shownExit[ci], wantExit, DISSOLVE_SECONDS, WRITE_SECONDS));
                const live = enter > 1e-3 && exit < 1 - 1e-3;
                el.style.visibility = live ? 'visible' : 'hidden';
                if (!live) return;
                showing = true;

                const list = words[ci];
                if (chapter.wake && whale) {
                    // Let in by the page; each word written once the whale
                    // is past it.
                    if (!boxes) boxes = measure();
                    // Linear here: the writer gives each word its own curve.
                    const own = boxes[ci];
                    list.forEach((word, i) => {
                        const past = (trail - own[i].right - WAKE_GAP * vw) / (WAKE_FEATHER * vw);
                        const behind = u < SWIM_BY[0] ? 0 : Math.max(done, clamp01(past));
                        const [, b] = wordPhase(i, list.length, 1, exit);
                        writeWord(word, Math.min(enter, behind), b, reduced, WAKE_DRIFT);
                    });
                } else if (over > 0 && boxes) {
                    // Hidden where it stands as the whale's body comes over
                    // it (the body is between it and the lens; a soft edge,
                    // as anything that near the lens is out of focus), and
                    // kept hidden once the whole animal is past (or the
                    // crossing is).
                    const own = boxes[ci];
                    list.forEach((word, i) => {
                        const [a, b] = wordPhase(i, list.length, enter, exit);
                        const past = smooth(clamp01((trail - own[i].left) / (WIPE_FEATHER * vw)));
                        writeWord(word, a, b, reduced, 0, over * Math.max(done, past, reach(own[i])));
                    });
                } else {
                    writeWords(list, enter, exit, reduced);
                }
            });

            // Past the story, and every phrase gone: take the whole layer
            // out of rendering.
            root.style.visibility = s > LAST.gone + 0.05 && !showing ? 'hidden' : 'visible';
            primed = true;
            storyText.settled = !busy;
        };

        tick();
        gsap.ticker.add(tick);
        const onResize = () => {
            last = -1;
            boxes = null;
        };
        window.addEventListener('resize', onResize);
        return () => {
            alive = false;
            gsap.ticker.remove(tick);
            window.removeEventListener('resize', onResize);
        };
    }, []);

    return (
        <>
            {/* Scroll room for the story. Empty on purpose: the words live in
                the fixed layer below, over the scene. */}
            <div className="story-spacer" style={{ height: `${STORY_SPACER_VH * 100}vh` }} aria-hidden="true" />

            <div className="story-layer" ref={layer}>
                <div className="story-hero" ref={hero}>
                    <p className="story-hero__kicker" data-hero-part data-write="wipe">
                        Interfaces, APIs &amp; everything below the surface
                    </p>
                    <h1 className="story-hero__title">
                        <span className="story-line story-hero__sans">
                            <span className="story-slot">
                                <span className="story-word" data-hero-part>
                                    Fullstack
                                </span>
                            </span>
                        </span>
                        <span className="story-line story-hero__serif">
                            <span className="story-slot">
                                <span className="story-word" data-hero-part data-write="pen">
                                    developer
                                </span>
                            </span>
                        </span>
                    </h1>
                </div>

                <div className="story-cue" ref={cue} aria-hidden="true">
                    <span>Scroll to dive</span>
                    <i />
                </div>

                {PARSED.map((lines, ci) => (
                    <div
                        key={ci}
                        className={`story-chapter story-chapter--${CHAPTERS[ci].align}${CHAPTERS[ci].low ? ' story-chapter--low' : ''}`}
                        ref={(el) => {
                            chapterEls.current[ci] = el;
                        }}>
                        <p>
                            {lines.map((line, li) => (
                                <WrittenLine key={li} words={line} />
                            ))}
                        </p>
                    </div>
                ))}
            </div>
        </>
    );
};

export default Story;
