// With the static server running, launch an isolated headless Chromium/Edge
// with --remote-debugging-port=9226. Uses native Node WebSocket, no packages.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const debugging = process.env.CDP_URL || 'http://127.0.0.1:9226';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5173';
const target = (await (await fetch(debugging + '/json/list')).json()).find(t => t.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let next = 0; const pending = new Map(), errors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  const request = pending.get(message.id);
  if (request) { pending.delete(message.id); message.error ? request.reject(Error(JSON.stringify(message.error))) : request.resolve(message.result); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await delay(50); }
  throw Error(`Timed out: ${expression}`);
}
const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
const set = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
const fleetPicture = () => evaluate(`Array.from(document.querySelectorAll('.npc-boat')).map(el => [el.dataset.racerId,el.getAttribute('transform')])`);
async function setup(mode, count, organic = false) {
  await click('training'); await evaluate(`document.querySelector('[data-course="${mode}"]').click()`);
  if (mode !== 'finish-upwind') await set('[name="courseLength"]', 300);
  await click('setup-next');
  if (await evaluate(`document.getElementById('randomize').checked`)) await click('randomize');
  await set('#wind-field', organic ? 'organic' : 'uniform'); await set('#wind-mode', organic ? 'oscillating' : 'steady');
  await set('[name="seed"]', 42);
  if (!await evaluate(`document.getElementById('current-enabled').checked`)) await click('current-enabled');
  await set('#current-speed', organic ? '1.2' : '0.3'); await set('#current-direction', organic ? '90' : '0');
  await click('setup-next'); await evaluate(`document.querySelector('[data-opponent="npc"]').click()`);
  await set('#npc-count', String(count)); await click('setup-next'); await click('setup-next');
  await waitFor(`document.body.dataset.screen === 'session'`);
  assert.equal(await evaluate(`document.querySelectorAll('.npc-boat').length`), count);
}
const courses = [], measurements = [];
try {
  await mkdir(new URL('../artifacts.local/', import.meta.url), { recursive: true });
  await call('Runtime.enable'); await call('Page.enable');
  const injected = await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    let time = performance.now(), next = 0; const frames = new Map();
    window.requestAnimationFrame = cb => { frames.set(++next, cb); return next; };
    window.cancelAnimationFrame = id => frames.delete(id);
    window.__stepFleet = ms => { time += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(time)); };
  })();` });
  await call('Page.navigate', { url: base });
  await waitFor(`document.getElementById('startup-error')?.hidden`);
  for (const mode of ['round-port', 'round-starboard', 'finish-upwind']) {
    await setup(mode, 8);
    const start = await fleetPicture(); assert.equal(new Set(start.map(p => p[1])).size, 8);
    await evaluate(`window.__stepFleet(1000)`); assert.deepEqual(await fleetPicture(), start);
    await set('#playback', '16'); await click('start'); await evaluate(`window.__stepFleet(0)`);
    await evaluate(`window.__stepFleet(125)`);
    await click('start'); // Pause / Menu
    const paused = await fleetPicture(); await evaluate(`window.__stepFleet(1000)`);
    assert.deepEqual(await fleetPicture(), paused);
    await evaluate(`document.querySelector('[data-pause="resume"]').click()`);
    // Restart returns all boats to precisely the same seeded slots.
    await click('race-again'); assert.deepEqual(await fleetPicture(), start); await click('start');
    if (mode === 'round-port') await click('tack');
    let complete = false;
    for (let chunk = 0; chunk < 100 && !complete; chunk++) {
      complete = await evaluate(`(() => {
        for (let i = 0; i < 60; i++) {
          if (document.getElementById('status').textContent !== 'LEG COMPLETE') {
            const p = document.querySelector('.player-boat').transform.baseVal.getItem(0).matrix;
            if (document.getElementById('tack-label').textContent === '${mode === 'round-port' ? 'PORT TACK' : 'STARBOARD TACK'}' && -p.f >= ${mode === 'finish-upwind' ? 500 : 155} && !document.getElementById('tack').disabled) document.getElementById('tack').click();
          }
          window.__stepFleet(62.5);
        }
        return document.getElementById('status').textContent === 'LEG COMPLETE' && document.getElementById('computer-state').textContent.includes('8 finished');
      })()`);
    }
    assert.ok(complete, `${mode}: human and all eight NPCs must finish`);
    const rows = await evaluate(`Array.from(document.querySelectorAll('#standings-table tbody tr')).map(r => r.textContent)`);
    assert.equal(rows.length, 9); assert.ok(rows.every(row => !row.includes('*') && !row.includes('Time limit')));
    await set('#npc-log-select', 'npc-8'); assert.ok(await evaluate(`document.querySelectorAll('#computer-log li').length > 0`));
    const final = await fleetPicture(); await evaluate(`window.__stepFleet(1000)`); assert.deepEqual(await fleetPicture(), final);
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(new URL(`../artifacts.local/fleet-${mode}.png`, import.meta.url), Buffer.from(shot.data, 'base64'));
    courses.push({ mode, finishers: 9, standings: rows });
    console.log(JSON.stringify({ mode, finishers: 9 }));
    await click('main-menu');
  }
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
  // Reload restores the actual RAF clock for performance, including rendering,
  // wind particles, history, standings and the unchanged route planner.
  for (const viewport of [{ width: 1440, height: 1000, mobile: false }, { width: 390, height: 844, mobile: true }]) {
    await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1 });
    await call('Page.navigate', { url: base }); await waitFor(`document.getElementById('startup-error')?.hidden`);
    await setup('finish-upwind', 8, true);
    await set('#wind-display', 'streaks'); await set('#playback', '1'); await click('start'); await delay(1000);
    for (const speed of [1, 4, 8, 16]) {
      await set('#playback', String(speed));
      const result = await evaluate(`new Promise(resolve => {
        const intervals = [], tasks = [], started = performance.now(); let last = started;
        const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
        observer.observe({ type: 'longtask', buffered: false });
        function sample(now) {
          intervals.push(now - last); last = now;
          if (now - started < 5000) { requestAnimationFrame(sample); return; }
          observer.disconnect(); intervals.sort((a,b) => a-b);
          resolve({ frames: intervals.length, wallMilliseconds: now - started, fps: intervals.length * 1000 / (now - started),
            p50FrameMilliseconds: intervals[Math.floor(intervals.length*.5)], p95FrameMilliseconds: intervals[Math.floor(intervals.length*.95)],
            maxFrameMilliseconds: intervals.at(-1), longTasks: tasks.length, maxLongTaskMilliseconds: Math.max(0,...tasks),
            npcBoats: document.querySelectorAll('.npc-boat').length, fitsViewport: document.documentElement.scrollWidth <= innerWidth });
        } requestAnimationFrame(sample);
      })`);
      assert.equal(result.npcBoats, 8); assert.ok(result.fitsViewport);
      assert.ok(result.fps >= 30, `Eight boats should sustain at least 30 FPS: ${JSON.stringify(result)}`);
      measurements.push({ viewport, speed, ...result }); console.log(JSON.stringify(measurements.at(-1)));
      if (speed === 4) {
        const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        await writeFile(new URL(`../artifacts.local/fleet-active-${viewport.mobile ? 'mobile' : 'desktop'}.png`, import.meta.url), Buffer.from(shot.data, 'base64'));
      }
    }
    await click('main-menu');
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const version = await call('Browser.getVersion');
  await writeFile(new URL('../docs/NPC_PHASE_4_BROWSER.json', import.meta.url), JSON.stringify({ browser: version.product,
    notes: 'Headless Edge real RAF; desktop and mobile viewport emulation on the same desktop CPU. Organic pressure/wind + 1.2 kn cross-current; eight active NPCs; 5 s per playback speed. Gameplay finishes tested separately with controlled RAF.',
    errors, courses, measurements }, null, 2) + '\n');
} finally { socket.close(); }
