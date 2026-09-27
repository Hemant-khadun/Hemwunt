// Regenerates src/assets/hero/sky-mask.png and sky-strip.jpg from the hero
// photo, using headless Chrome's canvas (no image dependencies, Node 22+).
//
//   npm run dev   (in another terminal — the photo is read from the dev server)
//   node scripts/visual/generateSkyAssets.mjs [http://localhost:5175]
//
// sky-mask.png  — white above the photo's real waterline, black below, feathered.
//                 The waterline is found per column (first run of dark pixels
//                 scanning down), then cleaned with a 1D morphological CLOSING
//                 so dark patches of sky between clouds cannot notch the mask.
// sky-strip.jpg — the photo's top SKY_BAND followed by its mirror image, so it
//                 tiles end to end without a join. DivePlate drifts it inside
//                 the mask. SKY_BAND must match DivePlate.tsx.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const BASE = process.argv[2] ?? 'http://localhost:5175';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTDIR = join(ROOT, 'src', 'assets', 'hero');
const SKY_BAND = 0.36;
const PORT = 9340;

const profile = join(tmpdir(), 'sky-assets-profile');
mkdirSync(profile, { recursive: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });

await send('Page.enable');
await send('Page.navigate', { url: `${BASE}/src/assets/hero/dive-plate.jpg` });
await sleep(2500);

const expression = `(async () => {
  const SKY_BAND = ${SKY_BAND};
  const img = document.querySelector('img'); await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const w = Math.round(W / 2), h = Math.round(H / 2);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const isSky = (x, y) => { const i = (y * w + x) * 4; return 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2] > 120; };
  const maxY = Math.round(h * 0.45);
  const raw = new Array(w);
  for (let x = 0; x < w; x++) {
    let run = 0, found = Math.round(h * 0.2);
    for (let y = 0; y < maxY; y++) { if (isSky(x, y)) run = 0; else { run++; if (run >= 6) { found = y - 5; break; } } }
    raw[x] = found;
  }
  const R = 140;
  const slide = (arr, fn) => arr.map((_, x) => { let v = arr[x]; for (let k = -R; k <= R; k++) { const j = Math.min(arr.length - 1, Math.max(0, x + k)); v = fn(v, arr[j]); } return v; });
  const closed = slide(slide(raw, Math.max), Math.min);
  const M = 12;
  const wl = closed.map((_, x) => { const win = []; for (let k = -M; k <= M; k++) win.push(closed[Math.min(w - 1, Math.max(0, x + k))]); win.sort((a, b) => a - b); return win[M]; });
  const m = document.createElement('canvas'); m.width = w; m.height = h;
  const mg = m.getContext('2d'); mg.fillStyle = '#000'; mg.fillRect(0, 0, w, h); mg.fillStyle = '#fff';
  for (let x = 0; x < w; x++) mg.fillRect(x, 0, 1, Math.max(0, wl[x] - 3));
  const mf = document.createElement('canvas'); mf.width = w; mf.height = h;
  const mfg = mf.getContext('2d'); mfg.fillStyle = '#000'; mfg.fillRect(0, 0, w, h); mfg.filter = 'blur(3px)'; mfg.drawImage(m, 0, 0);
  const sh = Math.round(H * SKY_BAND), scale = 0.75;
  const sw = Math.round(W * scale), shs = Math.round(sh * scale);
  const s = document.createElement('canvas'); s.width = sw * 2; s.height = shs;
  const sg = s.getContext('2d');
  sg.drawImage(img, 0, 0, W, sh, 0, 0, sw, shs);
  sg.save(); sg.translate(sw * 2, 0); sg.scale(-1, 1); sg.drawImage(img, 0, 0, W, sh, 0, 0, sw, shs); sg.restore();
  const sorted = [...wl].sort((a, b) => a - b);
  return JSON.stringify({ min: sorted[0] / h, median: sorted[Math.floor(w / 2)] / h, max: sorted[w - 1] / h,
    mask: mf.toDataURL('image/png'), strip: s.toDataURL('image/jpeg', 0.88) });
})()`;

const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression });
const value = r.result?.result?.value;
if (!value) { console.error(JSON.stringify(r.result).slice(0, 800)); ws.close(); chrome.kill(); process.exit(1); }
const out = JSON.parse(value);
if (out.max >= SKY_BAND) console.warn(`WARNING: waterline reaches ${out.max.toFixed(3)}, below SKY_BAND ${SKY_BAND} — raise SKY_BAND here and in DivePlate.tsx.`);
writeFileSync(join(OUTDIR, 'sky-mask.png'), Buffer.from(out.mask.split(',')[1], 'base64'));
writeFileSync(join(OUTDIR, 'sky-strip.jpg'), Buffer.from(out.strip.split(',')[1], 'base64'));
console.log(`waterline min ${out.min.toFixed(3)} median ${out.median.toFixed(3)} max ${out.max.toFixed(3)} — wrote sky-mask.png, sky-strip.jpg`);
ws.close(); chrome.kill(); process.exit(0);
