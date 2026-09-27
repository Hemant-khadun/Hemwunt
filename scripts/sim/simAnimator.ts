// Headless check of the animator's no-director path and the intent path.
// Run: esbuild bundle -> node.
import { createWhaleAnimator } from 'C:/Users/heman/Desktop/Work/Portfolio/Portfolio project/porfolio-hemwunt/src/animations/whaleAnimator';

const DT = 1 / 60;
const VH = 900;
const MAX = 8000;

function run(label: string, useIntent: boolean) {
    const a = createWhaleAnimator();
    a.beginReveal();
    let nan = false;
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    const samples: string[] = [];
    // 0-20s: scroll down steadily to max; 20-40s: hold; 40-50s: scroll back to 0
    for (let i = 0; i < 60 * 50; i++) {
        const t = i * DT;
        let y: number;
        if (t < 20) y = (t / 20) * MAX;
        else if (t < 40) y = MAX;
        else y = MAX * (1 - (t - 40) / 10);
        const active = !(t >= 20 && t < 40);
        const intent = useIntent
            ? { targetDepth: -(y / MAX) * 6, stageZ: -(y / MAX) * 0.3, effort: 1 }
            : undefined;
        if (useIntent && Math.abs(t - 5) < DT / 2) a.requestArch();
        const f = a.update({ dt: DT, elapsed: t, scrollY: y, maxScroll: MAX, viewportHeight: VH, scrollActive: active, intent });
        const p = f.position;
        if (![p.x, p.y, p.z, f.tailSpeed].every(Number.isFinite)) nan = true;
        minY = Math.min(minY, f.core.y); maxY = Math.max(maxY, f.core.y);
        minX = Math.min(minX, f.core.x); maxX = Math.max(maxX, f.core.x);
        if (i % 600 === 0) samples.push(`t=${t.toFixed(0)} core=(${f.core.x.toFixed(2)},${f.core.y.toFixed(2)},${f.core.z.toFixed(2)}) render.z=${p.z.toFixed(2)} tail=${f.tailSpeed.toFixed(2)} heading=${f.heading}`);
    }
    console.log(`\n== ${label} ==  NaN:${nan}  coreY:[${minY.toFixed(2)}, ${maxY.toFixed(2)}]  coreX:[${minX.toFixed(2)}, ${maxX.toFixed(2)}]`);
    samples.forEach((s) => console.log('  ' + s));
    return { minY, maxY };
}

// An intent that exactly reproduces the linear map must give identical output
// to no intent at all — that is the no-op claim, checked numerically.
const a = run('no intent (fallback)', false);
const b = run('intent == linear map', true);

// Frame-by-frame equivalence without the arch request.
const x = createWhaleAnimator(); x.beginReveal();
const z = createWhaleAnimator(); z.beginReveal();
let maxDiff = 0;
for (let i = 0; i < 60 * 30; i++) {
    const t = i * DT;
    const y = Math.min(1, t / 20) * MAX;
    const fx = x.update({ dt: DT, elapsed: t, scrollY: y, maxScroll: MAX, viewportHeight: VH, scrollActive: t < 20 });
    const px = fx.position.clone();
    const fz = z.update({ dt: DT, elapsed: t, scrollY: y, maxScroll: MAX, viewportHeight: VH, scrollActive: t < 20,
        intent: { targetDepth: -(y / MAX) * 6, stageZ: -(y / MAX) * 0.3, effort: 1 } });
    maxDiff = Math.max(maxDiff, px.distanceTo(fz.position));
}
console.log(`\nmax position divergence, fallback vs equivalent intent over 30s: ${maxDiff.toExponential(2)}`);
void a; void b;
