import { createWhaleAnimator } from 'C:/Users/heman/Desktop/Work/Portfolio/Portfolio project/porfolio-hemwunt/src/animations/whaleAnimator';
import { createDiveDirector } from 'C:/Users/heman/Desktop/Work/Portfolio/Portfolio project/porfolio-hemwunt/src/animations/diveDirector';
import { setStation, getStation } from './stubs/stationRegistry';

const DT = 1 / 60;
const VH = 900;
const ITEM_H = 1000;
const MAX = 9000;
const CENTRES = [1600, 3000, 4400, 5800, 7200];
const HALF = (VH + ITEM_H) / 2;

CENTRES.forEach((c, index) =>
    setStation({ index, progress: 0, centred: -1, inView: false, centreScroll: c, measured: true }),
);

function syncStations(scrollY: number) {
    CENTRES.forEach((c, i) => {
        const s = getStation(i)!;
        const centred = (scrollY - c) / HALF;
        s.centred = Math.max(-1, Math.min(1, centred));
        s.progress = (s.centred + 1) / 2;
        s.inView = centred > -1 && centred < 1;
    });
}

const animator = createWhaleAnimator();
animator.beginReveal();
const counts = { arch: 0, burst: 0, turn: 0 };
const log: string[] = [];
let t = 0;
let scrollY = 0;
const wrapped = {
    ...animator,
    update: animator.update,
    requestArch() { counts.arch++; log.push(`t=${t.toFixed(1)} scroll=${scrollY.toFixed(0)} ARCH`); animator.requestArch(); },
    triggerBurst() { counts.burst++; log.push(`t=${t.toFixed(1)} scroll=${scrollY.toFixed(0)} BURST`); animator.triggerBurst(); },
    requestTurn(d: -1 | 1) { counts.turn++; log.push(`t=${t.toFixed(1)} scroll=${scrollY.toFixed(0)} TURN(${d})`); animator.requestTurn(d); },
    beginReveal() {},
};

const director = createDiveDirector();
let heading = 1;
let lastDepth: number | null = null;
let maxJump = 0;
let nan = false;
const depthAt: string[] = [];
let undefinedFrames = 0;

function pass(label: string, from: number, to: number, seconds: number) {
    const before = { ...counts };
    const frames = Math.round(seconds * 60);
    for (let i = 0; i <= frames; i++) {
        scrollY = from + (to - from) * (i / frames);
        syncStations(scrollY);
        const intent = director.update(scrollY, MAX, wrapped, heading);
        if (!intent) { undefinedFrames++; }
        else {
            if (lastDepth !== null) maxJump = Math.max(maxJump, Math.abs(intent.targetDepth - lastDepth));
            lastDepth = intent.targetDepth;
        }
        const f = animator.update({ dt: DT, elapsed: t, scrollY, maxScroll: MAX, viewportHeight: VH, scrollActive: true, intent });
        heading = f.heading;
        if (![f.position.x, f.position.y, f.position.z].every(Number.isFinite)) nan = true;
        if (label === 'down #1' && i % Math.round(frames / 12) === 0 && intent) {
            depthAt.push(`scroll=${scrollY.toFixed(0).padStart(4)} wantY=${intent.targetDepth.toFixed(2)} stageZ=${intent.stageZ.toFixed(2)} effort=${intent.effort.toFixed(2)} coreY=${f.core.y.toFixed(2)}`);
        }
        t += DT;
    }
    console.log(`${label}: arch +${counts.arch - before.arch}, burst +${counts.burst - before.burst}, turn +${counts.turn - before.turn}`);
}

pass('down #1', 0, MAX, 40);
pass('up', MAX, 0, 20);
pass('down #2', 0, MAX, 40);

console.log('\nbeat log:'); log.forEach((l) => console.log('  ' + l));
console.log('\nintent along down #1:'); depthAt.forEach((l) => console.log('  ' + l));
console.log(`\nmax per-frame targetDepth jump: ${maxJump.toFixed(4)}  NaN: ${nan}  undefined-intent frames: ${undefinedFrames}`);
