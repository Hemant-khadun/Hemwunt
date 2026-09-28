/**
 * A diagnostic for phones, off unless the page is opened with `?perf`.
 *
 * What is slow on a phone (Safari, an Apple GPU) can be fast in every desktop
 * browser, and a phone cannot be profiled from a desktop: the hero's whole
 * frame costs ~5 ms in desktop Chrome and took ~117 ms on an iPhone 14 Pro.
 * So the page measures itself. `?perf` shows the frame rate and where the
 * time goes (components/PerfProbe.tsx); its Run button reloads the page once
 * per part of the scene with that part switched off (`off=`), measures each,
 * and lists the results. The part whose absence brings the frame rate back
 * is the one to fix.
 *
 * Every switch is read once, at load. Without the parameter nothing here does
 * anything.
 */

export type PerfPart =
    | 'post'
    | 'msaa'
    | 'ao'
    | 'volume'
    | 'bloom'
    | 'fx'
    | 'sea'
    | 'sim'
    | 'whale'
    | 'snow'
    | 'dom'
    | 'webgl'
    | 'dpr';

const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);

export const PERF_ON = params?.has('perf') ?? false;

/** Time the GPU as well, by waiting for it at the end of every frame. */
export const PERF_SYNC = PERF_ON && (params?.has('sync') ?? false);

const OFF = new Set(PERF_ON ? (params?.get('off') ?? '').split(',').filter(Boolean) : []);

/** Is this part of the page switched off for a perf run? */
export const perfOff = (part: PerfPart): boolean => OFF.has(part);

/** What a run measures, in order. */
export const PERF_PLAN: Array<{ label: string; off: PerfPart[]; sync?: boolean }> = [
    { label: 'everything on', off: [] },
    { label: 'GPU time (synced)', off: [], sync: true },
    { label: 'a ninth of the pixels', off: ['dpr'] },
    { label: 'no post chain', off: ['post'] },
    { label: 'no MSAA', off: ['msaa'] },
    { label: 'no ambient occlusion', off: ['ao'] },
    { label: 'no light shafts', off: ['volume'] },
    { label: 'no bloom', off: ['bloom'] },
    { label: 'no lens/grade/shock', off: ['fx'] },
    { label: 'no sea', off: ['sea'] },
    { label: 'no ripple sim', off: ['sim'] },
    { label: 'whale hidden', off: ['whale'] },
    { label: 'no marine snow', off: ['snow'] },
    { label: 'no page layers', off: ['dom'] },
    { label: 'no WebGL at all', off: ['webgl'] },
];
