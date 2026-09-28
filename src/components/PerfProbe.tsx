import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import gsap from 'gsap';
import { PERF_PLAN, PERF_SYNC, perfOff } from '../utils/perf';
import { pageShown } from '../utils/loader';

/**
 * The `?perf` panel (see utils/perf.ts): the frame rate, and where the frame
 * goes, live; and a Run button that measures the page once per entry of
 * PERF_PLAN, one reload each, and lists the results for a screenshot.
 *
 * Where the time goes:
 *   scene  the WebGL frame on the main thread: every useFrame, and issuing
 *          the render and the post chain (R3F's before and after effects).
 *   gpu    with `sync`, how long the GPU then takes to finish that frame.
 *   page   the DOM side on the shared ticker: Lenis, the story, the words.
 * A frame much longer than all of them is being held up somewhere else.
 */

/** Wait after the page opens before measuring (shader compiles, first
 *  uploads), and how long each measurement lasts. */
const SETTLE_MS = 5000;
const MEASURE_MS = 5000;
const RUN_KEY = 'perf-run';

interface Result {
    label: string;
    fps: number;
    p50: number;
    p90: number;
    scene: number;
    gpu: number;
    page: number;
}

interface Run {
    step: number;
    results: Result[];
    device?: string;
}

const readRun = (): Run | null => {
    try {
        const raw = localStorage.getItem(RUN_KEY);
        return raw ? (JSON.parse(raw) as Run) : null;
    } catch {
        return null;
    }
};

const writeRun = (run: Run) => {
    try {
        localStorage.setItem(RUN_KEY, JSON.stringify(run));
    } catch {
        // Private mode: the run cannot survive a reload, and stops.
    }
};

const urlFor = (step: number) => {
    const plan = PERF_PLAN[step];
    const q = new URLSearchParams();
    q.set('perf', 'run');
    q.set('step', String(step));
    if (plan.off.length) q.set('off', plan.off.join(','));
    if (plan.sync) q.set('sync', '');
    return `${window.location.pathname}?${q.toString()}`;
};

const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (a: number[], p: number) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

function describeDevice(): string {
    const canvas = document.querySelector<HTMLCanvasElement>('.whale-layer canvas');
    const gl = canvas?.getContext('webgl2') ?? null;
    const parts = [`dpr ${window.devicePixelRatio}`, `${window.innerWidth}x${window.innerHeight}`];
    if (canvas && gl) {
        parts.push(`canvas ${canvas.width}x${canvas.height}`);
        parts.push(`samples ${gl.getParameter(gl.MAX_SAMPLES)}`);
        parts.push(`floatLinear ${gl.getExtension('OES_texture_float_linear') ? 'y' : 'n'}`);
        parts.push(String(gl.getParameter(gl.RENDERER)));
    } else {
        parts.push('no WebGL');
    }
    return parts.join(' · ');
}

const PerfProbe = () => {
    const [text, setText] = useState('measuring…');
    const [table, setTable] = useState<Run | null>(null);
    const samples = useRef({ frames: [] as number[], scene: [] as number[], gpu: [] as number[], page: [] as number[] });

    useEffect(() => {
        if (perfOff('dom')) document.documentElement.classList.add('perf-nodom');
        const s = samples.current;
        let alive = true;

        // Frame intervals, from the page's own animation frames.
        let last = 0;
        let raf = 0;
        const tick = (t: number) => {
            if (last) s.frames.push(t - last);
            last = t;
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        // The DOM side on the shared ticker: first and last callback.
        let p0 = 0;
        const pageStart = () => {
            p0 = performance.now();
        };
        const pageEnd = () => {
            s.page.push(performance.now() - p0);
        };
        gsap.ticker.add(pageStart, false, true);
        gsap.ticker.add(pageEnd);

        // The WebGL frame, around R3F's whole loop. Loaded lazily so the
        // probe does not pull the scene's library into the page's first chunk.
        let stopScene = () => {};
        if (!perfOff('webgl')) {
            void import('@react-three/fiber').then(({ addEffect, addAfterEffect }) => {
                if (!alive) return;
                let t0 = 0;
                // Reading a pixel back waits for the GPU to finish the frame
                // in every browser (`finish` does not, in all of them).
                const pixel = new Uint8Array(4);
                const a = addEffect(() => {
                    t0 = performance.now();
                });
                const b = addAfterEffect(() => {
                    const t1 = performance.now();
                    s.scene.push(t1 - t0);
                    if (PERF_SYNC) {
                        const gl = document.querySelector<HTMLCanvasElement>('.whale-layer canvas')?.getContext('webgl2');
                        if (gl) {
                            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                            s.gpu.push(performance.now() - t1);
                        }
                    }
                });
                stopScene = () => {
                    a();
                    b();
                };
            });
        }

        const reset = () => {
            s.frames.length = 0;
            s.scene.length = 0;
            s.gpu.length = 0;
            s.page.length = 0;
        };
        const summary = (seconds: number): Omit<Result, 'label'> => ({
            fps: s.frames.length / seconds,
            p50: pct(s.frames, 0.5),
            p90: pct(s.frames, 0.9),
            scene: avg(s.scene),
            gpu: avg(s.gpu),
            page: avg(s.page),
        });

        // Live readout, over the last second.
        const live = window.setInterval(() => {
            const r = summary(1);
            setText(
                `${r.fps.toFixed(1)} fps · frame ${r.p50.toFixed(0)}/${r.p90.toFixed(0)} ms (p50/p90)\n` +
                    `scene ${r.scene.toFixed(1)} ms${PERF_SYNC ? ` · gpu ${r.gpu.toFixed(1)} ms` : ''} · page ${r.page.toFixed(1)} ms`,
            );
            reset();
        }, 1000);

        // A run in progress: settle, measure, move on.
        const params = new URLSearchParams(window.location.search);
        const run = readRun();
        const step = Number(params.get('step'));
        let timer = 0;
        if (params.get('perf') === 'run' && run && run.step === step) {
            void pageShown.then(() => {
                timer = window.setTimeout(() => {
                    window.clearInterval(live);
                    reset();
                    setText(`step ${step + 1}/${PERF_PLAN.length}: ${PERF_PLAN[step].label} — measuring…`);
                    timer = window.setTimeout(() => {
                        run.results.push({ label: PERF_PLAN[step].label, ...summary(MEASURE_MS / 1000) });
                        if (step === 0) run.device = describeDevice();
                        run.step = step + 1;
                        writeRun(run);
                        if (run.step < PERF_PLAN.length) window.location.replace(urlFor(run.step));
                        else window.location.replace(`${window.location.pathname}?perf=done`);
                    }, MEASURE_MS);
                }, SETTLE_MS);
            });
        } else if (params.get('perf') === 'done') {
            setTable(readRun());
        }

        return () => {
            alive = false;
            cancelAnimationFrame(raf);
            gsap.ticker.remove(pageStart);
            gsap.ticker.remove(pageEnd);
            stopScene();
            window.clearInterval(live);
            window.clearTimeout(timer);
        };
    }, []);

    const start = () => {
        writeRun({ step: 0, results: [] });
        window.location.replace(urlFor(0));
    };

    const panel: CSSProperties = {
        position: 'fixed',
        top: 'max(8px, env(safe-area-inset-top))',
        left: 8,
        right: 8,
        zIndex: 100001,
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(0, 8, 16, 0.86)',
        color: '#e8f6ff',
        font: '11px/1.35 ui-monospace, Menlo, monospace',
        whiteSpace: 'pre-wrap',
        pointerEvents: 'auto',
    };
    const button: CSSProperties = {
        marginTop: 6,
        marginRight: 6,
        padding: '6px 10px',
        borderRadius: 6,
        border: '1px solid #7fd8ff',
        background: 'transparent',
        color: '#e8f6ff',
        font: 'inherit',
    };

    if (table) {
        return (
            <div style={panel}>
                <b>perf results</b>
                {'\n'}
                {table.device}
                {'\n\n'}
                {'fps   p50  p90  scene  gpu  page  config\n'}
                {table.results
                    .map(
                        (r) =>
                            `${r.fps.toFixed(1).padStart(4)} ${r.p50.toFixed(0).padStart(4)} ${r.p90.toFixed(0).padStart(4)} ${r.scene
                                .toFixed(1)
                                .padStart(6)} ${r.gpu ? r.gpu.toFixed(1).padStart(4) : '   -'} ${r.page.toFixed(1).padStart(5)}  ${r.label}`,
                    )
                    .join('\n')}
                {'\n'}
                <button type="button" style={button} onClick={start}>
                    Run again
                </button>
            </div>
        );
    }

    return (
        <div style={panel}>
            {text}
            {'\n'}
            <button type="button" style={button} onClick={start}>
                Run full test (~3 min)
            </button>
        </div>
    );
};

export default PerfProbe;
