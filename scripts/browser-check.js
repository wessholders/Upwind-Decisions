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
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
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
  // Exercise the combined decision tool, not just the wind inspection page.
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: base + '/' });
  await waitFor(`document.getElementById('startup-error')?.hidden === true`);
  assert.equal(await evaluate(`document.getElementById('tack').disabled`), true);
  assert.equal(await evaluate(`document.getElementById('wind-field').value`), 'organic');
  assert.equal(await evaluate(`document.getElementById('computer-state').textContent`), 'Ready to race');
  const readyWind = await evaluate(`document.getElementById('wind-canvas').toDataURL()`);
  await evaluate(`new Promise(resolve => setTimeout(resolve, 180))`);
  assert.notEqual(await evaluate(`document.getElementById('wind-canvas').toDataURL()`), readyWind, 'The ready racecourse should show flowing particles.');
  await screenshot('trainer-desktop');
  await click('start');
  await waitFor(`document.getElementById('elapsed').textContent !== '0:00'`);
  assert.ok(await evaluate(`document.getElementById('computer-log').textContent.includes('Tack')`));
  assert.ok(await evaluate(`document.querySelector('#course path[stroke="#855ab1"]') !== null`));
  await click('tack');
  assert.equal(await evaluate(`document.getElementById('speed-value').textContent`), '0.0');
  assert.equal(await evaluate(`document.getElementById('tack-count').textContent`), '1');
  await click('start');
  const frozenRace = await evaluate(`({ time: document.getElementById('elapsed').textContent, canvas: document.getElementById('wind-canvas').toDataURL() })`);
  await evaluate(`new Promise(resolve => setTimeout(resolve, 150))`);
  assert.deepEqual(await evaluate(`({ time: document.getElementById('elapsed').textContent, canvas: document.getElementById('wind-canvas').toDataURL() })`), frozenRace);
  await evaluate(`(() => { const s = document.getElementById('wind-display'); s.value = 'boundaries'; s.dispatchEvent(new Event('change')); })()`);
  await click('wind-vectors'); await click('follow-boat'); await screenshot('trainer-follow'); await click('full-course');
  await click('retry');
  assert.equal(await evaluate(`document.getElementById('elapsed').textContent`), '0:00');
  assert.equal(await evaluate(`document.getElementById('tack-count').textContent`), '0');
  await evaluate(`(() => {
    const side = document.getElementById('favored-side'); side.value = 'right'; side.dispatchEvent(new Event('change'));
    for (const [name, value] of Object.entries({ windBias: 75, windFrequency: 2.5, windSizeBL: 50, backgroundWindKnots: 14, windContrast: 45 })) {
      const input = document.querySelector('[name="' + name + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('settings-form').requestSubmit();
  })()`);
  assert.equal(await evaluate(`document.getElementById('favored-side').value`), 'right');
  assert.ok(parseFloat(await evaluate(`document.getElementById('local-wind-speed').textContent`)) > 0);
  await evaluate(`(() => { const s = document.getElementById('wind-display'); s.value = 'hidden'; s.dispatchEvent(new Event('change')); })()`);
  assert.equal(await evaluate(`document.getElementById('wind-canvas').hidden`), true);
  await evaluate(`(() => { const s = document.getElementById('wind-display'); s.value = 'streaks'; s.dispatchEvent(new Event('change')); })()`);
  await click('wind-vectors');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Combined trainer must fit mobile width.');
  await screenshot('trainer-mobile');
  const workerResult = await evaluate(`(async () => {
    const { createScenario } = await import('./src/engine/wind.js');
    const { attachWindField } = await import('./src/wind/field.js');
    const { replay } = await import('./src/engine/race.js');
    const scenario = attachWindField(createScenario({ courseLength: 100, windMode: 'steady', seed: 8 }));
    const worker = new Worker('./src/optimizer.worker.js', { type: 'module' });
    try {
      const response = await new Promise((resolve, reject) => {
        worker.onmessage = e => resolve(e.data); worker.onerror = e => reject(new Error(e.message));
        worker.postMessage({ scenario, commands: [], time: 0 });
      });
      if (response.error) throw new Error(response.error);
      const route = response.result.route;
      return { finished: route.finish.finished, sameReplay: JSON.stringify(replay(scenario, route.commands, route.finish.time + 1).finish) === JSON.stringify(route.finish) };
    } finally { worker.terminate(); }
  })()`);
  assert.ok(workerResult.finished && workerResult.sameReplay);
  // Run an entire short organic leg through actual UI controls and rendering.
  // Only the browser's animation clock is replaced, avoiding a real-time wait.
  const injection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    let time = 0, next = 0; const callbacks = new Map();
    Object.defineProperty(performance, 'now', { value: () => time });
    window.requestAnimationFrame = cb => { const id = ++next; callbacks.set(id, cb); return id; };
    window.cancelAnimationFrame = id => callbacks.delete(id);
    window.__stepQA = delta => { time += delta; const list = Array.from(callbacks.values()); callbacks.clear(); for (const cb of list) cb(time); };
  })();` });
  await call('Page.navigate', { url: base + '/' });
  await waitFor(`document.getElementById('startup-error')?.hidden === true`);
  const raceResult = await evaluate(`(() => {
    const mode = document.getElementById('wind-mode'); mode.value = 'steady'; mode.dispatchEvent(new Event('change'));
    for (const [name, value] of Object.entries({ courseLength: 100, maxShift: 0 })) {
      const input = document.querySelector('[name="' + name + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('settings-form').requestSubmit();
    document.getElementById('start').click(); document.getElementById('tack').click();
    let frames = 0;
    for (; frames < 1600 && document.getElementById('status').textContent !== 'LEG COMPLETE'; frames++) {
      const y = Number(document.getElementById('course').getAttribute('aria-label').match(/and (-?[0-9]+) meters up/)[1]);
      if (document.getElementById('tack-label').textContent === 'PORT TACK' && y >= 55 && !document.getElementById('tack').disabled) document.getElementById('tack').click();
      window.__stepQA(62.5);
    }
    return { frames, status: document.getElementById('status').textContent, elapsed: document.getElementById('elapsed').textContent,
      field: document.getElementById('wind-field').value, tacks: document.getElementById('tack-count').textContent };
  })()`);
  assert.equal(raceResult.status, 'LEG COMPLETE'); assert.equal(raceResult.field, 'organic'); assert.equal(raceResult.tacks, '2');
  await waitFor(`document.querySelector('#results table') !== null`);
  assert.equal(await evaluate(`document.getElementById('reference-legend').hidden`), false);
  assert.ok(await evaluate(`document.querySelectorAll('#results .tack-card').length >= 2`));
  const inspectedClock = await evaluate(`document.querySelector('#results .tack-card-top strong').textContent.match(/[0-9]+:[0-9]+/)[0]`);
  await evaluate(`document.querySelector('#results [data-inspect-tack="1"]').click()`);
  assert.equal(await evaluate(`document.getElementById('inspection-banner').hidden`), false);
  assert.equal(await evaluate(`document.getElementById('status').textContent`), 'REFERENCE TACK 1');
  assert.equal(await evaluate(`document.getElementById('elapsed').textContent`), inspectedClock);
  assert.ok(await evaluate(`document.querySelector('#course .reference-probe') !== null`));
  const pausedComputer = await evaluate(`document.getElementById('computer-state').textContent`);
  await evaluate(`window.__stepQA(1000)`);
  assert.equal(await evaluate(`document.getElementById('computer-state').textContent`), pausedComputer);
  await screenshot('tack-inspection');
  await click('inspection-return');
  await evaluate(`document.querySelector('#course [data-inspect-tack="2"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  assert.equal(await evaluate(`document.getElementById('status').textContent`), 'REFERENCE TACK 2');
  await click('inspection-return');
  const playerFinish = await evaluate(`document.getElementById('elapsed').textContent`);
  await evaluate(`(() => { for (let i = 0; i < 1600 && !document.getElementById('computer-state').textContent.startsWith('Finished'); i++) window.__stepQA(62.5); })()`);
  assert.ok(await evaluate(`document.getElementById('computer-state').textContent.startsWith('Finished')`));
  assert.equal(await evaluate(`document.getElementById('elapsed').textContent`), playerFinish);
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('#results tbody th')).some(th => th.textContent === 'Live computer')`));
  assert.equal(await evaluate(`document.getElementById('inspection-banner').hidden`), true);
  await screenshot('trainer-finished');
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(JSON.stringify({ desktop: '1440×1100', mobile: '390×844', runtimeErrors: errors.length,
    controls: 'sailing and live opponent, pause, retry, settings, complete leg, hindsight explanations, tack-time inspection, computer finish comparison', rendererCheck, workerResult, raceResult,
    screenshots: 'artifacts.local/wind-*.png and trainer-*.png' }, null, 2));
} finally { socket.close(); }
