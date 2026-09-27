/**
 * The app's side of the loader.
 *
 * The loader itself is inline in index.html, so it is on screen before any of
 * this script has arrived. From here the page tells it what the FIRST SCREEN
 * is waiting for, and nothing more: the hero's scene and its type. What lies
 * further down (the projects' images, the footer's sphere) loads on behind
 * the open page as it always has. Each piece is a task weighted by its share
 * of the wait (roughly its megabytes, or what a compile costs), which is what
 * the loader's percentage counts, and tagged with the word it lights on the
 * loader ("sky", "sea", "light", "whale"; several tasks can share one, or
 * have none). Once the list is sealed and every task is in, the loader opens.
 *
 * Every call is a no-op when the loader is not there (it has already opened,
 * or it never ran): nothing on the page may hang on it.
 */

interface LoaderApi {
    task(tag: string, weight: number): () => void;
    seal(): void;
    /** Open now, whatever is still out. */
    release(): void;
    /** The app's script has arrived and is running. */
    booted(): void;
    /** Set as the loader starts to open. */
    opened?: boolean;
}

declare global {
    interface Window {
        __loader?: LoaderApi;
    }
}

const api = typeof window !== 'undefined' ? window.__loader : undefined;
const noop = () => {};

api?.booted();

/** Registers something the first screen waits for; returns what to call once it is in. */
export const loaderTask = (tag: string, weight: number): (() => void) => api?.task(tag, weight) ?? noop;

/**
 * Waits for `promise` however it settles. A failure is the page's to handle
 * (see SceneBoundary), and must not hold the loader.
 */
export function loaderWaitsFor(tag: string, weight: number, promise: Promise<unknown>) {
    const done = loaderTask(tag, weight);
    promise.then(done, done);
}

/** Everything the first screen needs has been registered. */
export const sealLoader = () => api?.seal();

/**
 * Resolves as the loader starts to open on the page, or at once if there is no
 * loader to wait for. For whatever should play as the page is uncovered rather
 * than at mount, behind the loader, where nobody sees it.
 */
export const pageShown: Promise<void> = new Promise((resolve) => {
    if (!api || api.opened) return resolve();
    window.addEventListener('loader:open', () => resolve(), { once: true });
});

// --- The scene ------------------------------------------------------------------

/**
 * The scene is in once the whale and the sea have both mounted, which means
 * every file they need has arrived and been parsed (they sit behind Suspense),
 * and a few frames have been drawn with them. The first of those frames
 * compiles their shaders: a stall that belongs behind the loader, not in the
 * visitor's first second of the page.
 */
type ScenePart = 'whale' | 'sea';

const DRAWN_FRAMES = 3;

let mounting: Map<ScenePart, () => void> | null = null;
let drawn: () => void = noop;

/** The page is going to run the WebGL scene: the loader waits for it. */
export function expectScene() {
    mounting = new Map([
        ['whale', loaderTask('whale', 0.3)],
        ['sea', loaderTask('sea', 0.3)],
    ]);
    drawn = loaderTask('', 0.4);
}

/** Called by each part of the scene as it mounts. Safe to call again. */
export function sceneMounted(part: ScenePart) {
    const done = mounting?.get(part);
    if (!mounting || !done) return;
    mounting.delete(part);
    done();
    if (mounting.size > 0) return;
    let frames = DRAWN_FRAMES;
    const count = () => (--frames > 0 ? requestAnimationFrame(count) : drawn());
    requestAnimationFrame(count);
}

/** The scene failed and was left out: stop waiting for it. */
export function sceneAbandoned() {
    mounting?.forEach((done) => done());
    mounting?.clear();
    drawn();
}
