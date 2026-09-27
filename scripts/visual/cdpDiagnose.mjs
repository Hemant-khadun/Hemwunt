// Drives headless Chrome over CDP (no deps; Node 22 global WebSocket).
// Captures console, exceptions, failed requests, canvas state, and screenshots.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const URL = process.argv[3] ?? 'http://localhost:5175/';
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
    '--window-size=1600,900',
    `--user-data-dir=${join(OUT, 'profile')}`,
    'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
    for (let i = 0; i < 50; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
            const page = list.find((t) => t.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch {}
        await sleep(200);
    }
    throw new Error('no CDP target');
}

const log = [];
const ws = new WebSocket(await targetWs());
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
        return;
    }
    const p = msg.params;
    switch (msg.method) {
        case 'Runtime.consoleAPICalled':
            log.push(`[console.${p.type}] ` + p.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 400));
            break;
        case 'Runtime.exceptionThrown':
            log.push(`[EXCEPTION] ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 800)}`);
            break;
        case 'Log.entryAdded':
            if (p.entry.level !== 'verbose') log.push(`[log.${p.entry.level}] ${p.entry.text.slice(0, 300)} ${p.entry.url ?? ''}`);
            break;
        case 'Network.loadingFailed':
            log.push(`[NET FAIL] ${p.errorText} ${requests.get(p.requestId) ?? ''}`);
            break;
        case 'Network.requestWillBeSent':
            requests.set(p.requestId, p.request.url);
            break;
        case 'Network.responseReceived':
            if (p.response.status >= 400) log.push(`[HTTP ${p.response.status}] ${p.response.url}`);
            break;
    }
});
const requests = new Map();
const send = (method, params = {}) =>
    new Promise((resolve) => {
        const mid = ++id;
        pending.set(mid, resolve);
        ws.send(JSON.stringify({ id: mid, method, params }));
    });

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });

const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value ?? r.result?.exceptionDetails?.text;
};
const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
};

const canvasState = `(() => {
  const cs = [...document.querySelectorAll('canvas')].map(c => {
    const r = c.getBoundingClientRect();
    let ctx = 'none';
    try { ctx = c.getContext('webgl2') ? 'webgl2' : (c.getContext('webgl') ? 'webgl' : (c.getContext('2d') ? '2d' : 'none')); } catch (e) { ctx = 'err:' + e.message; }
    const cst = getComputedStyle(c.parentElement);
    return { cls: c.className, parent: c.parentElement?.className, w: c.width, h: c.height, css: [Math.round(r.width), Math.round(r.height)], ctx, parentZ: cst.zIndex, parentDisplay: cst.display };
  });
  return JSON.stringify({ scrollMax: document.documentElement.scrollHeight - innerHeight, canvases: cs });
})()`;

await sleep(5000);
log.push('--- t=5s ' + (await evalJs(canvasState)));
await shot('01-t5s');
await sleep(8000);
log.push('--- t=13s ' + (await evalJs(canvasState)));
await shot('02-t13s');

for (const [name, frac] of [['03-scroll10', 0.1], ['04-scroll30', 0.3], ['05-scroll55', 0.55], ['06-scroll90', 0.9]]) {
    await evalJs(`window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * ${frac}); true`);
    await sleep(3500);
    await shot(name);
}

writeFileSync(join(OUT, 'log.txt'), log.join('\n'));
console.log(log.join('\n'));
ws.close();
chrome.kill();
process.exit(0);
