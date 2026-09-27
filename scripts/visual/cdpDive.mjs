// Screenshots the hero dive at scroll depths measured in viewport heights.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const URL = process.argv[3] ?? 'http://localhost:5175/';
const STEPS = (process.argv[4] ?? '0,0.3,0.6,0.9,1.25,1.6').split(',').map(Number);
const PORT = 9335;
mkdirSync(OUT, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars',
    '--window-size=1600,900', `--user-data-dir=${join(OUT, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const log = [];
ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') log.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600));
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning'))
        log.push(`[console.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
});
const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result?.result?.value; };
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); writeFileSync(join(OUT, `${n}.jpg`), Buffer.from(r.result.data, 'base64')); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(14000);

for (const [i, k] of STEPS.entries()) {
    await evalJs(`window.scrollTo(0, innerHeight * ${k}); true`);
    await sleep(2500);
    const state = await evalJs(`JSON.stringify({ y: Math.round(scrollY), plate: document.querySelector('.dive-plate') ? getComputedStyle(document.querySelector('.dive-plate')).opacity : 'missing' })`);
    log.push(`step ${k}vh -> ${state}`);
    // Indexed, so repeated depths (e.g. several frames at 0 to watch motion
    // over time) each get their own file.
    await shot(`${String(i).padStart(2, '0')}-dive-${String(k).replace('.', '_')}vh`);
}

writeFileSync(join(OUT, 'log.txt'), log.join('\n'));
console.log(log.join('\n'));
ws.close(); chrome.kill(); process.exit(0);
