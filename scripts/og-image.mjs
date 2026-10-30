#!/usr/bin/env node
// Link-preview helpers for share.sh and refresh-previews.sh (see src/lib/share/social.ts).
//
//   node scripts/og-image.mjs slot index.html                 strip here.now's tags, reserve the slot
//   node scripts/og-image.mjs fill index.html URL TITLE DESC  write this link's tags into the slot
//   node scripts/og-image.mjs render DIR                      DIR/og.jpg from DIR/{index.html,share.json,print.gcode.gz}
//
// `render` serves DIR on localhost, opens it with ?og in headless Chrome (the viewer itself
// draws the picture, exactly as the page looks) and saves what the page hands back.
// Chrome: $CHROME, else the usual install locations.
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { fillSocialSlot, OG_IMAGE, socialTags, withSocialSlot } from '../src/lib/share/social.ts';

const [cmd, ...args] = process.argv.slice(2);
const die = (msg) => {
  console.error(`og-image: ${msg}`);
  process.exit(1);
};

if (cmd === 'slot') {
  writeFileSync(args[0], withSocialSlot(readFileSync(args[0], 'utf8')));
} else if (cmd === 'fill') {
  const [file, url, title, desc] = args;
  const before = readFileSync(file);
  const after = Buffer.from(fillSocialSlot(before.toString('utf8'), socialTags(url, title, desc)));
  if (after.length !== before.length) die('slot changed the page size');
  writeFileSync(file, after);
} else if (cmd === 'render') {
  await render(args[0]);
} else {
  die('usage: og-image.mjs slot FILE | fill FILE URL TITLE DESC | render DIR');
}

function findChrome() {
  const list = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return list.find((p) => p && existsSync(p));
}

async function render(dir) {
  const chrome = findChrome();
  if (!chrome) die('no Chrome found (set CHROME=/path/to/chrome)');
  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.gz': 'application/octet-stream' };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = normalize(join(dir, path === '/' ? 'index.html' : path));
    if (!file.startsWith(normalize(dir)) || !existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const profile = mkdtempSync(join(tmpdir(), 'og-chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,800', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const timer = setTimeout(() => finish('timed out waiting for the viewer'), 120_000);
  let finished = false;
  function finish(err) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    proc.kill();
    server.close();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 300);
    if (err) die(err);
  }
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      proc.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) resolve(m[1]);
      });
      proc.on('exit', () => reject(new Error('Chrome exited early')));
    });
    const cdp = await connect(wsUrl);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    await page('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?og` });
    const { result } = await page('Runtime.evaluate', {
      expression: 'new Promise((r) => { const t = setInterval(() => { if (window.__og) { clearInterval(t); r(window.__og); } }, 200); })',
      awaitPromise: true,
      returnByValue: true,
    });
    const og = result.value ?? {};
    if (!og.image) throw new Error(og.error ?? 'the viewer returned no picture (is it an older viewer without ?og?)');
    writeFileSync(join(dir, OG_IMAGE), Buffer.from(og.image.split(',')[1], 'base64'));
    cdp.close();
    finish();
  } catch (e) {
    finish(e instanceof Error ? e.message : String(e));
  }
}

/** Minimal Chrome DevTools Protocol client over Node's built-in WebSocket. */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };
    ws.onerror = () => reject(new Error('could not connect to Chrome'));
    ws.onopen = () =>
      resolve({
        send(method, params = {}, sessionId) {
          return new Promise((res, rej) => {
            pending.set(++id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
          });
        },
        close: () => ws.close(),
      });
  });
}
