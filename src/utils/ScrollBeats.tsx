import { viewportHeight } from './viewport';
import { useEffect } from 'react';
import gsap from 'gsap';
import type Lenis from 'lenis';
import type { VirtualScrollData } from 'lenis';
import { CHAPTERS, STORY_BEATS, SWIM_BY, storyText, storyWhale } from '../animations/story';
import { getLenis, setScrollInput, setSnapping } from './SmoothScroll';

/**
 * Where the page comes to rest, and how it gets there.
 *
 * THE STORY PLAYS IN SCENES. From the hero to the projects' intro, one scroll
 * (a flick, a few wheel notches, a swipe, an arrow key) is one scene: the page
 * glides to the next beat (`STORY_BEATS` in animations/story.ts, then the
 * intro), where the chapter's phrase is whole and the whale is on its mark.
 * The rest of that gesture is spent on it, so a trackpad's momentum does not
 * carry on into the scene after. Back up is the same, a scene at a time, and
 * scrolling up out of the projects stops on the intro first.
 *
 * A scene is not left before it has been shown:
 *   - its phrase writes itself in at a reading pace (Story.tsx paces the
 *     words), so it is left only once that is done.
 *   - the whale swims each scene in two to four seconds, and paged faster it
 *     would fall further behind every time. So a chapter is left only once
 *     the whale is at least as far as the chapter before: never more than a
 *     scene behind.
 *   - the swim-by's chapter is written by the whale (story.ts SWIM_BY), so
 *     it is left only once the whale has crossed.
 * All give up SCENE_WAIT after the page came to rest. A scroll held by one
 * is not lost: the scene it asked for plays the moment the one on screen
 * lets go, if that is within QUEUE_MS.
 *
 * EVERYWHERE ELSE THE PAGE SETTLES: when the visitor stops scrolling, it
 * glides to a beat if one is near. From the hero to the first project the
 * beats are a CHAIN, and a stop anywhere between two of them goes to one or
 * the other. That catches whatever moved the page without a scene (the
 * scrollbar's thumb, Home/End, a menu link). Leaving the beat it rested on,
 * it goes on to the next once it has come COMMIT of the way; a beat it flew
 * past in the same move catches it unless it ended nearer the next. Past the
 * first project only a stop within PROXIMITY of a project's centre is pulled
 * in. A chapter's stage is pinned for exactly half a viewport either side of
 * its centre (CHAPTER_VH in ProjectChapter), so that settles a stop anywhere
 * on a pinned chapter and leaves the gaps, the statement and the footer free.
 * The centre is also where the dive director keys that project's shot.
 *
 * Glides are Lenis animations tagged with `userData.beat`. Lenis never
 * completes an animation it abandons (the visitor scrolling, the scrollbar
 * taking over), so a glide also ends on the first scroll frame that is not
 * its own. Otherwise the shared snapping flag (which stops the whale reading
 * a settle as the visitor scrolling) would stay on for the rest of the
 * session.
 *
 * Mount after <SmoothScroll/>: it needs the Lenis instance when it mounts.
 */

// --- Scenes ------------------------------------------------------------------
/** Quiet between two inputs (ms) that ends a gesture. */
const GESTURE_GAP = 180;
/** A wheel delta this many times the last, and over PUSH_MIN px, is a new
 *  push through the tail of the last gesture's momentum. */
const NEW_PUSH = 1.6;
const PUSH_MIN = 24;
/** Touch drag (px) before a swipe counts. */
const SWIPE = 24;
/** Longest a scene holds the page for the whale (ms after it came to rest). */
const SCENE_WAIT = 4000;
/** How long (ms) a scroll held by a scene still counts: it plays when the
 *  scene lets go within this, and is dropped after. */
const QUEUE_MS = 1500;
/** A whale not heard from for this long (ms) is not on the page. */
const STALE = 500;

// --- Settling ----------------------------------------------------------------
/** Share of the way from the beat it rested on to the next (0..1) past which
 *  a stop goes on to it. */
const COMMIT = 0.15;
/** Viewport heights around an unchained beat within which it pulls. */
const PROXIMITY = 0.5;
/** How long scrolling must be idle (ms) before the page counts as stopped. */
const SETTLE_DELAY = 150;

// --- Glides ------------------------------------------------------------------
/** Glide time, s: a base plus this much per viewport travelled, bounded. */
const GLIDE_BASE = 0.35;
const GLIDE_PER_VH = 0.55;
const GLIDE_MIN = 0.6;
const GLIDE_MAX = 1.4;

/** Pixels within which the page is on a beat. */
const ON = 2;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Scroll offset (px) that centres `el` in the viewport. */
const centreOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return window.scrollY + r.top + r.height / 2 - viewportHeight() / 2;
};

/** The scenes' beats (px): the hero, each chapter, then the intro. */
function sceneBeats(): number[] {
    const beats = STORY_BEATS.map((b) => b * viewportHeight());
    const intro = document.querySelector('#portfolio .projects-intro');
    if (intro) beats.push(centreOf(intro));
    return beats;
}

/** The scene a scroll of `delta` from `y` plays, or null if it plays none. */
function sceneTarget(beats: number[], y: number, delta: number): number | null {
    const last = beats[beats.length - 1];
    if (delta > 0) return y < last - ON ? (beats.find((b) => b > y + ON) ?? null) : null;
    // Up out of the projects: the intro, as the scroll reaches it.
    if (y > last + ON) return y + delta < last ? last : null;
    for (let i = beats.length - 1; i >= 0; i--) if (beats[i] < y - ON) return beats[i];
    return null;
}

interface Beat {
    /** Scroll offset, px. */
    y: number;
    /** Chained to the next beat: a stop between the two goes to one of them. */
    chain: boolean;
}

/** Every beat the page settles on, measured now (layout moves with a resize). */
function settleBeats(): Beat[] {
    const beats: Beat[] = sceneBeats().map((y) => ({ y, chain: true }));
    document.querySelectorAll('#portfolio .project').forEach((el) => beats.push({ y: centreOf(el), chain: false }));
    return beats.sort((a, b) => a.y - b.y);
}

/** Where a page stopped at `y`, having set off from `origin` and last moving
 *  in `heading` (-1 up, 1 down, 0 unknown), should settle; null to leave it
 *  where it is. */
function settleTarget(beats: Beat[], y: number, origin: number, heading: number): number | null {
    let i = 0;
    while (i < beats.length && beats[i].y <= y) i++;
    const above = beats[i - 1];
    const below = beats[i];
    if (above && below && above.chain) {
        const t = (y - above.y) / Math.max(1, below.y - above.y);
        // The beat it has come from, and whether it passed it on the way
        // (rather than setting off from it).
        const left = heading > 0 ? above : heading < 0 ? below : undefined;
        const flewPast = !!left && (heading > 0 ? left.y > origin + 1 : left.y < origin - 1);
        const turn = !left || flewPast ? 0.5 : heading > 0 ? COMMIT : 1 - COMMIT;
        return t < turn ? above.y : below.y;
    }
    let nearest: Beat | undefined;
    for (const b of [above, below]) if (b && (!nearest || Math.abs(b.y - y) < Math.abs(nearest.y - y))) nearest = b;
    return nearest && Math.abs(nearest.y - y) <= PROXIMITY * viewportHeight() ? nearest.y : null;
}

const menuOpen = () => !!document.getElementById('menu-popup')?.classList.contains('active');

const swallow = (event: Event) => {
    if (event.cancelable) event.preventDefault();
    return false;
};

const ScrollBeats = () => {
    useEffect(() => {
        // Dev switch: ?nosnap scrolls freely and holds any position, to
        // inspect a chapter mid-reveal.
        if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('nosnap')) return;
        const lenis = getLenis();
        if (!lenis) return;

        /** The glide under way, if any. */
        let gliding: 'scene' | 'settle' | null = null;
        /** When the page last came to rest at the end of a glide. */
        let restedAt = performance.now();

        // The visitor's current gesture: whether it has played its scene,
        // when it last moved, how hard, and how far a touch has dragged.
        let spent = false;
        let lastAt = Number.NEGATIVE_INFINITY;
        let lastAbs = 0;
        let travel = 0;

        let settleTimer: number | undefined;
        let heading = 0;
        let lastY = window.scrollY;
        /** Where the page was at rest when the visitor set it moving. */
        let origin = lastY;
        // A mouse button held (dragging the scrollbar's thumb, selecting
        // text): holding still is not stopping.
        let pressed = false;

        const release = () => {
            if (gliding === 'settle') setSnapping(false);
            gliding = null;
        };

        const glide = (to: number, kind: 'scene' | 'settle') => {
            release();
            gliding = kind;
            if (kind === 'settle') setSnapping(true);
            origin = to;
            const vh = Math.abs(to - window.scrollY) / viewportHeight();
            lenis.scrollTo(to, {
                duration: Math.min(GLIDE_MAX, Math.max(GLIDE_MIN, GLIDE_BASE + GLIDE_PER_VH * vh)),
                easing: easeInOutCubic,
                userData: { beat: kind },
                onComplete: () => {
                    release();
                    restedAt = performance.now();
                },
            });
        };

        /** May the page leave the scene it is on, in `dir`? */
        const mayLeave = (beats: number[], y: number, dir: number) => {
            const now = performance.now();
            if (dir < 0 || now - restedAt > SCENE_WAIT) return true;
            // Its phrase still writing itself in.
            if (!storyText.settled) return false;
            const u = storyWhale.progress;
            if (u < 0 || now - storyWhale.at > STALE) return true;
            const i = beats.findIndex((b) => Math.abs(b - y) <= ON);
            const chapter = CHAPTERS[i - 1];
            if (!chapter) return true;
            if (chapter.wake && u < SWIM_BY[1]) return false;
            return u >= STORY_BEATS[i - 1];
        };

        /** A scroll held because its scene was still playing: which way, and
         *  until when it still counts. */
        let queued: { delta: number; until: number } | null = null;

        /** Play the scene a scroll of `delta` asks for, now or as soon as
         *  the one on screen lets it. Null if it asks for none. */
        const play = (delta: number, fire: boolean): number | null => {
            const beats = sceneBeats();
            const y = lenis.targetScroll;
            const to = sceneTarget(beats, y, delta);
            if (to === null || !fire) return to;
            if (mayLeave(beats, y, Math.sign(delta))) {
                queued = null;
                spent = true;
                glide(to, 'scene');
            } else {
                queued = { delta, until: performance.now() + QUEUE_MS };
            }
            return to;
        };

        /** As `play`, for an input event it then swallows. False if there
         *  is no scene. */
        const scene = (delta: number, event: Event, fire: boolean) => {
            if (play(delta, fire) === null) return false;
            if (event.cancelable) event.preventDefault();
            return true;
        };

        // A held scroll plays the moment its scene lets go.
        const playQueued = () => {
            if (!queued || gliding === 'scene') return;
            if (performance.now() > queued.until || play(queued.delta, true) === null) queued = null;
        };
        gsap.ticker.add(playQueued);

        // Every wheel and touch input, before Lenis scrolls with it.
        setScrollInput(({ deltaY, event }: VirtualScrollData) => {
            if (event.ctrlKey || menuOpen()) return true;
            const touch = event.type.startsWith('touch');
            if (event.type === 'touchstart') {
                spent = false;
                travel = 0;
                return true;
            }
            if (event.type === 'touchend') {
                arm();
                return true;
            }
            if (!touch) {
                const now = performance.now();
                const abs = Math.abs(deltaY);
                if (now - lastAt > GESTURE_GAP || (gliding !== 'scene' && abs > PUSH_MIN && abs > lastAbs * NEW_PUSH)) {
                    spent = false;
                }
                lastAt = now;
                lastAbs = abs;
            }
            if (!deltaY) return true;
            // The rest of a gesture that has played its scene, and anything
            // while one plays.
            if (spent || gliding === 'scene') {
                spent = true;
                return swallow(event);
            }
            if (touch) travel += deltaY;
            if (scene(deltaY, event, !touch || Math.abs(travel) >= SWIPE)) return false;
            // Not a scene: the visitor scrolls, and takes over from a settle.
            release();
            return true;
        });

        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || menuOpen()) return;
            const t = e.target as HTMLElement | null;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
            const down = e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey);
            const up = e.key === 'ArrowUp' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey);
            if (!down && !up) return;
            scene(down ? 40 : -40, e, gliding !== 'scene' && !e.repeat);
        };

        // --- Settling ---------------------------------------------------------
        const settle = () => {
            if (gliding || pressed || lenis.isTouching) return;
            const y = window.scrollY;
            const to = settleTarget(settleBeats(), y, origin, heading);
            origin = to ?? y;
            if (to === null || Math.abs(to - y) < 1) return;
            glide(to, 'settle');
        };

        function arm() {
            window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(settle, SETTLE_DELAY);
        }

        const onScroll = () => {
            const y = window.scrollY;
            if (!gliding && y !== lastY) heading = Math.sign(y - lastY);
            lastY = y;
            if (!gliding) arm();
        };

        // Anything else moving the page instead (the scrollbar, a menu link,
        // a reset). Runs after ScrollTrigger's own listener, so a settle's
        // last frame still reads as the page moving itself.
        const offScroll = lenis.on('scroll', (l: Lenis) => {
            if (gliding && (l.isScrolling !== 'smooth' || l.userData?.beat !== gliding)) release();
        });

        const onPointerDown = (e: PointerEvent) => {
            if (e.pointerType === 'mouse') pressed = true;
        };
        const onPointerUp = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse' || !pressed) return;
            pressed = false;
            arm();
        };

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('keydown', onKey);
        window.addEventListener('pointerdown', onPointerDown, { passive: true });
        window.addEventListener('pointerup', onPointerUp, { passive: true });
        return () => {
            setScrollInput(null);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('keydown', onKey);
            gsap.ticker.remove(playQueued);
            window.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointerup', onPointerUp);
            offScroll();
            window.clearTimeout(settleTimer);
            // An unmount mid-settle never reaches onComplete; without this the
            // whale would ignore real scrolling for the rest of the session.
            release();
        };
    }, []);

    return null;
};

export default ScrollBeats;
