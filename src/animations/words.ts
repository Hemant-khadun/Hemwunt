/**
 * The page's one way of writing words.
 *
 * Set, not faded. Each word rises into its line from below, through the
 * slot's floor (a `.story-slot` clips like the slot of a type case), fast off
 * the mark and then a long settle, swinging level as it lands. The accents in
 * the italic serif are penned instead: written in left to right under a soft
 * leading edge, the hand beside the type, and whole words rather than split
 * letters, so the serif keeps its kerning. On the way out the words carry on
 * up through the top of their line, the way everything passes you on a
 * descent. The type is never blurred: it is sharp in every frame.
 *
 * Four hands, chosen per element (see `styleOf`):
 *   set   a word in a `.story-slot`: the masked rise.
 *   pen   `.story-accent`, or `data-write="pen"`: the left-to-right ink.
 *   wipe  `data-write="wipe"`: small tracked capitals, uncovered left to
 *         right like an engraved plate catching the light.
 *   rise  anything else (a paragraph, a row of links): a plain lift into
 *         place, on the same curve.
 *
 * Shared by the opening story (Story.tsx), the projects and the statement, so
 * the whole descent speaks with one voice. Nothing here animates on its own;
 * callers pass progress each frame, so scrolling back un-writes the words
 * exactly.
 */

export const smooth = (t: number) => t * t * (3 - 2 * t);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** 0..1 of `t` across [a, b]. */
export const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** Fast off the mark, then a long settle: every arrival on the page. */
export const expoOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : (1 - Math.pow(2, -10 * t)) / (1 - 1 / 1024));
export const cubicOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const cubicInOut = (t: number) => {
    const x = clamp01(t);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** The pen's leading edge: a touch of ease into the first stroke, then the
 *  same long settle as the type beside it, so an accent is written at the
 *  pace its neighbours are set. */
const penHead = (t: number) => cubicOut(t) * (0.75 + 0.25 * smooth(clamp01(t * 3)));

/** Least time (s) a run of words takes to write itself in, and to dissolve.
 *  The story plays a scene per scroll, and the page glides a whole chapter
 *  in about a second, across a phrase's entrance in a fraction of it. */
export const WRITE_SECONDS = 1.6;
export const DISSOLVE_SECONDS = 0.7;

/**
 * Move `shown` toward `target` (a run's scroll-derived entrance or exit), no
 * faster than a whole run in `rise` seconds going up or `fall` going down.
 * Moved slower than that, the words follow the scroll exactly, as before;
 * when the page glides a scene at once they still write themselves in word
 * by word at a reading pace.
 */
export function pace(shown: number, target: number, dt: number, rise: number, fall: number): number {
    const d = target - shown;
    return shown + (d > 0 ? Math.min(d, dt / rise) : Math.max(d, -dt / fall));
}

export interface Word {
    text: string;
    /** Set between *asterisks* in the copy: the italic serif accent. */
    accent: boolean;
}

/** Split "the *surface.*" into [{text, accent}]. */
export function parseLine(line: string): Word[] {
    const out: Word[] = [];
    let accent = false;
    for (const part of line.split(/(\*)/)) {
        if (part === '*') {
            accent = !accent;
            continue;
        }
        for (const word of part.split(/\s+/).filter(Boolean)) out.push({ text: word, accent });
    }
    return out;
}

// --- The hands ----------------------------------------------------------------

type Hand = 'set' | 'pen' | 'wipe' | 'rise';

const hands = new WeakMap<HTMLElement, Hand>();

function styleOf(el: HTMLElement): Hand {
    let hand = hands.get(el);
    if (!hand) {
        const asked = el.dataset.write;
        if (asked === 'pen' || asked === 'wipe' || asked === 'set' || asked === 'rise') hand = asked;
        else if (el.classList.contains('story-accent')) hand = 'pen';
        else if (el.parentElement?.classList.contains('story-slot')) hand = 'set';
        else hand = 'rise';
        hands.set(el, hand);
    }
    return hand;
}

/** How far below its slot a set word starts: its own height, and a margin
 *  past the floor the slot's clip leaves under the descenders. */
const SET_DROP = 1.08;
const SET_MARGIN = 0.3;
/** It swings level as it lands (deg), turning about its lower left corner. */
const SET_TILT = 3;
/** Soft leading edge of the pen (em). */
const PEN_EDGE = 0.9;
/** The pen finishes this much sooner than its window, landing with the set
 *  words beside it (theirs are all but still by half way). */
const PEN_PACE = 1.3;
/** The pen's own slight rise (em). */
const PEN_LIFT = 0.18;
/** Plain lift, for blocks (em). */
const RISE = 0.7;
/** Engraved lines slide this far under their wipe (em). */
const WIPE_SLIDE = 0.5;
/** Slant a word drawn along its line carries, straightening as it lands (deg). */
const DRIFT_LEAN = -9;

/** Write a run of word (or letter) elements. `enter` 0..1 writes them in
 *  reading order, each with its own overlapping share of the entrance; `exit`
 *  0..1 takes them out nearly together, with a slight ripple. Under reduced
 *  motion only opacity moves. */
export function writeWords(list: HTMLElement[], enter: number, exit: number, reduced: boolean): void {
    list.forEach((word, i) => writeWord(word, ...wordPhase(i, list.length, enter, exit), reduced));
}

/** Share of the entrance over which the words' starts are spread; each word
 *  takes the rest. Wide shares, so a phrase arrives as one wave, not a
 *  queue. */
const SPREAD_IN = 0.5;
const SPREAD_OUT = 0.25;

/** Word `i` of `n`'s own share (0..1, linear) of a run's entrance and exit.
 *  The last word finishes as the run does; a lone one takes all of it. */
export function wordPhase(i: number, n: number, enter: number, exit: number): [number, number] {
    const k = n > 1 ? i / (n - 1) : 0;
    const spreadIn = n > 1 ? SPREAD_IN : 0;
    const spreadOut = n > 1 ? SPREAD_OUT : 0;
    return [
        clamp01((enter - k * spreadIn) / (1 - spreadIn)),
        clamp01((exit - k * spreadOut) / (1 - spreadOut)),
    ];
}

const setMask = (s: CSSStyleDeclaration, value: string) => {
    s.maskImage = value;
    s.webkitMaskImage = value;
};

/**
 * Write one element, `a` 0..1 of the way in and `b` 0..1 of the way out.
 * `drift` (em) draws a word in along its line from that far back instead of
 * up from below: the story's wake writes its words behind the whale. `hide`
 * 0..1 takes it away where it stands, with no move of its own: something
 * has come between it and the lens (the whale, in THE SWIM-BY).
 */
export function writeWord(el: HTMLElement, a: number, b: number, reduced: boolean, drift = 0, hide = 0): void {
    const s = el.style;
    const hand = styleOf(el);
    const shown = 1 - clamp01(hide);

    // At rest: nothing written but the opacity, so the type is a plain,
    // uncomposited run of text again (and an italic's overhang, which a mask
    // would trim, is whole).
    if (reduced || (a >= 1 && b <= 0)) {
        s.opacity = ((reduced ? a * (1 - b) : 1) * shown).toFixed(3);
        s.transform = '';
        if (hand === 'pen') setMask(s, '');
        if (hand === 'wipe') s.clipPath = '';
        return;
    }

    // The way out, shared: on up and away, a little quicker than it came.
    const out = cubicInOut(b);
    const fade = 1 - smooth(b);

    if (hand === 'set') {
        const e = expoOut(a);
        const opacity = cubicOut(a / 0.55) * fade * shown;
        if (drift) {
            // Drawn along the line: slanted forward with the move, and level
            // once it lands.
            const x = (1 - e) * drift;
            s.opacity = opacity.toFixed(3);
            s.transform = `translate3d(${x.toFixed(3)}em, ${(-out * SET_DROP * 100).toFixed(2)}%, 0) skewX(${((1 - e) * DRIFT_LEAN).toFixed(2)}deg)`;
            return;
        }
        const k = 1 - e - out;
        s.opacity = opacity.toFixed(3);
        s.transform = `translate3d(0, calc(${(k * SET_DROP * 100).toFixed(2)}% + ${(k * SET_MARGIN).toFixed(3)}em), 0) rotate(${((1 - e) * SET_TILT).toFixed(2)}deg)`;
        return;
    }

    if (hand === 'pen') {
        // The ink's leading edge crosses the word like a confident stroke:
        // quick through the body of it, unhurried into the last letter.
        const head = a >= 1 ? 1 : penHead(Math.min(1, a * PEN_PACE));
        const lift = (1 - expoOut(a)) * PEN_LIFT;
        const x = drift ? (1 - expoOut(a)) * drift : 0;
        setMask(
            s,
            a >= 1
                ? ''
                : `linear-gradient(90deg, #000 calc(${(head * 100).toFixed(2)}% + ${(head * PEN_EDGE - PEN_EDGE).toFixed(3)}em), transparent calc(${(head * 100).toFixed(2)}% + ${(head * PEN_EDGE).toFixed(3)}em))`,
        );
        s.opacity = (Math.min(1, a * 12) * fade * shown).toFixed(3);
        s.transform = `translate3d(${x.toFixed(3)}em, calc(${(lift - out * (SET_DROP + SET_MARGIN)).toFixed(3)}em), 0)`;
        return;
    }

    if (hand === 'wipe') {
        const e = cubicOut(a);
        // Uncovered from the left, with room around the box for the glyphs'
        // shadow; the words slide the last short way under the edge.
        s.clipPath =
            a >= 1 ? '' : `inset(-3em calc(${((1 - e) * 100).toFixed(2)}% + ${((1 - e) * 6 - 3).toFixed(3)}em) -3em -3em)`;
        s.opacity = (Math.min(1, a * 4) * fade * shown).toFixed(3);
        s.transform = `translate3d(${(-(1 - expoOut(a)) * WIPE_SLIDE).toFixed(3)}em, ${(-out * RISE * 0.6).toFixed(3)}em, 0)`;
        return;
    }

    // rise
    const e = expoOut(a);
    s.opacity = (cubicOut(a / 0.7) * fade * shown).toFixed(3);
    s.transform = `translate3d(0, ${((1 - e) * RISE - out * RISE * 0.6).toFixed(3)}em, 0)`;
}
