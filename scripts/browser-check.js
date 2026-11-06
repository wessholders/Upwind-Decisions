// Optional real-browser QA. Start the static server and an isolated Chromium/
// Edge instance with --remote-debugging-port=9225 before running this script.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5173';
const debugging = process.env.CDP_URL || 'http://127.0.0.1:9225';
const targets = await (await fetch(debugging + '/json/list')).json();
const target = targets.find(t => t.type === 'page');
assert.ok(target, 'Start Edge with a debugging port first.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map(), errors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, timeout } = pending.get(message.id); clearTimeout(timeout); pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
  }
});
function call(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression, timeoutMs = 5000) {
  for (let i = 0; i < Math.ceil(timeoutMs / 50); i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}
async function click(id) { await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); }
async function screenshot(name) {
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(new URL(`../artifacts.local/${name}.png`, import.meta.url), Buffer.from(data, 'base64'));
}
try {
  await mkdir(new URL('../artifacts.local/', import.meta.url), { recursive: true });
  await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: base + '/wind-sandbox.html' });
  await waitFor(`document.getElementById('startup-error')?.hidden === true`);
  await waitFor(`document.getElementById('clock').textContent !== '00:00'`);
  await click('play');
  const paused = await evaluate(`document.getElementById('clock').textContent`);
  const frozenCanvas = await evaluate(`document.getElementById('water').toDataURL()`);
  await evaluate(`new Promise(resolve => setTimeout(resolve, 180))`);
  assert.equal(await evaluate(`document.getElementById('clock').textContent`), paused);
  assert.equal(await evaluate(`document.getElementById('water').toDataURL()`), frozenCanvas, 'Pause must freeze particles and features.');
  await screenshot('wind-desktop');
  await click('boundaries'); await click('vectors'); await screenshot('wind-overlays');
  await click('tack'); assert.equal(await evaluate(`document.getElementById('tack-label').textContent`), 'PORT');
  await click('replay'); await click('play');
  assert.equal(await evaluate(`document.getElementById('clock').textContent`), '00:00');
  assert.equal(await evaluate(`document.getElementById('tack-label').textContent`), 'STBD');
  const originalSeed = await evaluate(`document.getElementById('seed').textContent`);
  await click('shuffle'); await click('play');
  assert.notEqual(await evaluate(`document.getElementById('seed').textContent`), originalSeed);
  for (const regime of ['steady', 'persistent', 'oscillating']) {
    await evaluate(`(() => { const s = document.getElementById('regime'); s.value = '${regime}'; s.dispatchEvent(new Event('change')); })()`);
    await click('play');
    assert.equal(await evaluate(`document.getElementById('clock').textContent`), '00:00');
  }
  // Actually drag the marker using browser pointer dispatch, then check the
  // keyboard-accessible probe as well.
  const position = await evaluate(`(() => { const r = document.getElementById('water').getBoundingClientRect();
    const scale = Math.min((r.width - 56) / 720, (r.height - 70) / 1060);
    return { x: r.left + r.width / 2, y: r.bottom - 30 - 200 * scale }; })()`);
  const beforeDrag = await evaluate(`document.getElementById('water').getAttribute('aria-label')`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position.x + 80, y: position.y - 180, button: 'left', buttons: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x + 80, y: position.y - 180, button: 'left', clickCount: 1 });
  const afterDrag = await evaluate(`document.getElementById('water').getAttribute('aria-label')`);
  assert.notEqual(afterDrag, beforeDrag, 'Dragging must move the probe.');
  await evaluate(`document.getElementById('water').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))`);
  assert.notEqual(await evaluate(`document.getElementById('water').getAttribute('aria-label')`), afterDrag);
  const rendererCheck = await evaluate(`(async () => {
    const { WindField } = await import('./src/wind/field.js');
    const { WindRenderer } = await import('./src/wind/renderer.js');
    const { ParticleSystem } = await import('./src/wind/particles.js');
    const { BoatProbe } = await import('./src/wind/probe.js');
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 850;
    const f = new WindField(), p = new ParticleSystem(f), b = new BoatProbe(f), r = new WindRenderer(canvas);
    r.width = 800; r.height = 850;
    const before = JSON.stringify(f.sample(0, 500, 10));
    r.draw(f, p, b, 10, { boundaries: false, vectors: false });
    r.draw(f, p, b, 10, { boundaries: true, vectors: true });
    const start = performance.now();
    for (let i = 0; i < 60; i++) { p.update(1/60, 10+i/4); r.draw(f, p, b, 10+i/4, { boundaries: false, vectors: false }); }
    return { sameWind: before === JSON.stringify(f.sample(0, 500, 10)), meanFrameMs: (performance.now()-start)/60, particles: p.active.length };
  })()`);
  assert.ok(rendererCheck.sameWind); assert.ok(rendererCheck.particles > 100);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('boundaries'); await click('vectors');
  await evaluate(`window.scrollTo(0, 0)`);
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Mobile must not overflow horizontally.');
  await screenshot('wind-mobile');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(JSON.stringify({ sandbox: 'passed', rendererCheck, runtimeErrors: errors.length }, null, 2));
} finally { socket.close(); }
// The trainer now starts in the lobby; exercise its new navigation and real engine.
await import('./game-browser-check.js');