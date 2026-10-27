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
  assert.equal(await evaluate(`document.getElementById('bear').disabled`), true);
  assert.match(await evaluate(`document.getElementById('bear-status').textContent`), /Start sailing/);
  assert.equal(await evaluate(`document.getElementById('computer-state').textContent`), 'Ready to race');
  const readyWind = await evaluate(`document.getElementById('wind-canvas').toDataURL()`);
  await evaluate(`new Promise(resolve => setTimeout(resolve, 180))`);
  assert.notEqual(await evaluate(`document.getElementById('wind-canvas').toDataURL()`), readyWind, 'The ready racecourse should show flowing particles.');
  await screenshot('trainer-desktop');
  const waterViewport = await evaluate(`(async () => {
    const { createScenario } = await import('./src/engine/wind.js');
    const { RaceWindLayer } = await import('./src/views/organic-wind.js');
    const { courseProjection } = await import('./src/views/wind-canvas.js');
    const scenario = createScenario({ windField: 'organic', windMode: 'steady' });
    scenario.organicWind = { ...scenario.organicWind, initialFeatures: 0, frequency: 0 };
    const scenes = [];
    for (const [width, height, view] of [[1440, 580, '25 -1100 550 550'], [390, 700, '25 -1100 550 550'],
      [1440, 580, '-580 -1180 1160 1260'], [390, 700, '-580 -1180 1160 1260']]) {
      const canvas = document.createElement('canvas'), layer = new RaceWindLayer();
      const metrics = { width, height, padding: { left: 15, right: 15, top: 65, bottom: 25 } };
      layer.draw(canvas, scenario, 0, view, 'streaks', metrics);
      const ctx = canvas.getContext('2d'), points = [[5, 5], [25, 150], [width - 25, 150], [width / 2, height / 2], [width / 2, height - 10]];
      const opaque = points.every(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] === 255);
      const colors = points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
      scenes.push({ width, height, view, opaque, corners: [colors[0], colors.at(-1)] });
      if (width === 1440 && view.startsWith('25 ')) {
        // Put two known trails in visible water outside the nominal viewBox.
        // These were wrongly cut off even though SVG course geometry is visible.
        layer.particles.active = [-100, 600].map(x => ({ x, y: 800, age: 1, life: 2.1, retireAt: Infinity }));
        layer.draw(canvas, scenario, 0, view, 'streaks', metrics);
        const projection = courseProjection(view, width, height, metrics.padding);
        scenes.at(-1).outerTrailsVisible = [-100, 600].map(x => {
          const p = projection.point({ x, y: 800 });
          const data = ctx.getImageData(Math.floor(p.x) - 2, Math.floor(p.y) - 12, 5, 14).data;
          let darker = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i] < 190 && data[i + 3] === 255) darker++;
          return darker > 0;
        });
      }
    }
    return scenes;
  })()`);
  for (const scene of waterViewport) {
    assert.ok(scene.opaque, 'Water must cover the entire map, including camera margins.');
    assert.deepEqual(scene.corners[0], [194, 220, 224, 255]);
    assert.deepEqual(scene.corners[1], scene.corners[0]);
    if (scene.outerTrailsVisible) assert.ok(scene.outerTrailsVisible.every(Boolean), 'Visible water beside the viewBox must retain its wind trails.');
  }
  // Verify the actual canvas output for both wind types on one controlled
  // scene. Median core tones avoid confusing a particle pixel with water.
  const contrast = await evaluate(`(async () => {
    const { createScenario } = await import('./src/engine/wind.js');
    const { fieldForScenario } = await import('./src/wind/field.js');
    const { WindFeature } = await import('./src/wind/feature.js');
    const { FeatureShape } = await import('./src/wind/shape.js');
    const { seededRandom } = await import('./src/wind/random.js');
    const { RaceWindLayer } = await import('./src/views/organic-wind.js');
    const { courseProjection } = await import('./src/views/wind-canvas.js');
    const scenario = createScenario({ windField: 'organic', windMode: 'steady' });
    const field = fieldForScenario(scenario);
    field.active = [
      new WindFeature({ id: 1, kind: 'puff', x: -240, y: 520, shift: 10, speedKnots: 14, lifetime: 500, shape: new FeatureShape(seededRandom(5), 140, 175) }),
      new WindFeature({ id: 2, kind: 'pocket', x: 240, y: 520, shift: -10, speedKnots: 6, lifetime: 500, shape: new FeatureShape(seededRandom(8), 140, 175) }),
    ];
    field.history = field.active.slice(); field.buckets.clear(); field.indexTick(); field.cachedTime = NaN; field.spawns.nextTime = Infinity;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    const layer = new RaceWindLayer(), view = '-500 -1100 1000 1166.6666666667';
    const metrics = { width: 600, height: 700 }, projection = courseProjection(view, 600, 700);
    const labels = [], fillText = ctx.fillText.bind(ctx);
    ctx.fillText = (text, ...args) => { labels.push(text); return fillText(text, ...args); };
    layer.draw(canvas, scenario, 0, view, 'streaks', metrics);
    const medianTone = x => {
      const p = projection.point({ x, y: 520 }), pixels = ctx.getImageData(Math.round(p.x) - 5, Math.round(p.y) - 5, 11, 11).data, values = [];
      for (let i = 0; i < pixels.length; i += 4) values.push(pixels[i] * 0.2126 + pixels[i+1] * 0.7152 + pixels[i+2] * 0.0722);
      values.sort((a,b) => a-b); return values[Math.floor(values.length/2)];
    };
    const tones = { puff: medianTone(-240), ambient: medianTone(0), pocket: medianTone(240) };
    const normalLabels = labels.slice(), plainImage = canvas.toDataURL().split(',')[1];
    const before = JSON.stringify(field.sample(0, 520, 0));
    layer.draw(canvas, scenario, 0, view, 'boundaries', metrics);
    return { tones, normalLabels, labels, samePhysics: before === JSON.stringify(field.sample(0, 520, 0)),
      plainImage, identifiedImage: canvas.toDataURL().split(',')[1] };
  })()`);
  assert.ok(contrast.tones.puff < contrast.tones.ambient - 15, 'Puff water must visibly darken.');
  assert.ok(contrast.tones.pocket > contrast.tones.ambient + 6, 'Pocket water must visibly lighten.');
  assert.equal(contrast.normalLabels.length, 0);
  assert.ok(contrast.labels.some(label => label.startsWith('PUFF')) && contrast.labels.some(label => label.startsWith('POCKET')));
  assert.ok(contrast.samePhysics);
  await writeFile(new URL('../artifacts.local/wind-contrast-unlabeled.png', import.meta.url), Buffer.from(contrast.plainImage, 'base64'));
  await writeFile(new URL('../artifacts.local/wind-contrast-identified.png', import.meta.url), Buffer.from(contrast.identifiedImage, 'base64'));
  delete contrast.plainImage; delete contrast.identifiedImage;
  await click('start');
  await waitFor(`document.getElementById('elapsed').textContent !== '0:00'`);
  assert.equal(await evaluate(`document.getElementById('bear').disabled`), false);
  await click('bear');
  assert.equal(await evaluate(`document.getElementById('bear').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`document.getElementById('bear').dataset.state`), 'armed');
  assert.match(await evaluate(`document.getElementById('bear-status').textContent`), /Mark approach armed/);
  await click('bear');
  assert.equal(await evaluate(`document.getElementById('bear').getAttribute('aria-pressed')`), 'false');
  assert.ok(await evaluate(`document.getElementById('computer-log').textContent.includes('Tack')`));
  assert.ok(await evaluate(`document.querySelector('#course path[stroke="#855ab1"]') !== null`));
  await click('tack');
  assert.equal(await evaluate(`document.getElementById('bear').disabled`), true);
  assert.match(await evaluate(`document.getElementById('bear-status').textContent`), /tack is complete/);
  assert.ok(Number(await evaluate(`document.getElementById('speed-value').textContent`)) > 0);
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
    for (const [name, value] of Object.entries({ courseLength: 100, maxShift: 0, windContrast: 0, backgroundWindKnots: 10 })) {
      const input = document.querySelector('[name="' + name + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('settings-form').requestSubmit();
    document.getElementById('start').click();
    const entryHeading = Number(document.getElementById('heading-value').textContent);
    document.getElementById('tack').click();
    const tackTrace = { entryHeading, startHeading: Number(document.getElementById('heading-value').textContent), samples: [] };
    for (let i = 0; i < 32; i++) {
      window.__stepQA(62.5);
      const p = document.querySelector('#course .player-boat').transform.baseVal.getItem(0).matrix;
      tackTrace.samples.push({ time: (i + 1) / 4, x: p.e, y: -p.f,
        heading: Number(document.getElementById('heading-value').textContent), speed: Number(document.getElementById('speed-value').textContent),
        tackDisabled: document.getElementById('tack').disabled, bearDisabled: document.getElementById('bear').disabled });
    }
    let frames = 0;
    for (; frames < 1600 && document.getElementById('status').textContent !== 'LEG COMPLETE'; frames++) {
      const y = Number(document.getElementById('course').getAttribute('aria-label').match(/and (-?[0-9]+) meters up/)[1]);
      if (document.getElementById('tack-label').textContent === 'PORT TACK' && y >= 55 && !document.getElementById('tack').disabled) document.getElementById('tack').click();
      window.__stepQA(62.5);
    }
    return { frames, status: document.getElementById('status').textContent, elapsed: document.getElementById('elapsed').textContent,
      field: document.getElementById('wind-field').value, tacks: document.getElementById('tack-count').textContent, tackTrace };
  })()`);
  assert.equal(raceResult.status, 'LEG COMPLETE'); assert.equal(raceResult.field, 'organic'); assert.equal(raceResult.tacks, '2');
  assert.equal(raceResult.tackTrace.startHeading, raceResult.tackTrace.entryHeading);
  const tackSamples = raceResult.tackTrace.samples;
  assert.equal(tackSamples[17].heading, 45); assert.ok(tackSamples[17].tackDisabled); assert.equal(tackSamples[17].bearDisabled, false);
  assert.equal(tackSamples[31].tackDisabled, false); assert.equal(tackSamples[31].speed, 4.6);
  assert.ok(Math.abs(Math.min(...tackSamples.map(p => p.speed)) - 3.68) < 0.1);
  for (let i = 1; i < tackSamples.length; i++) assert.ok(Math.hypot(tackSamples[i].x - tackSamples[i - 1].x, tackSamples[i].y - tackSamples[i - 1].y) > 0.4);
  raceResult.tackTrace = { entryHeading: raceResult.tackTrace.entryHeading, turnEndHeading: tackSamples[17].heading,
    minimumSpeed: Math.min(...tackSamples.map(p => p.speed)), recoveredSpeed: tackSamples[31].speed, movingSamples: tackSamples.length };
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
  // Sail slightly beyond the clearance-safe mark layline, then use the real
  // button for a small bear-away and finish beside the mark, not gate center.
  const bearingResult = await evaluate(`(() => {
    document.getElementById('retry').click();
    const contrast = document.querySelector('[name="windContrast"]'); contrast.value = 0;
    contrast.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('settings-form').requestSubmit();
    document.getElementById('start').click(); document.getElementById('tack').click();
    let frames = 0;
    for (; frames < 1600; frames++) {
      const position = document.querySelector('#course .player-boat').transform.baseVal.getItem(0).matrix;
      const y = -position.f;
      if (y >= 54 && !document.getElementById('tack').disabled) break;
      window.__stepQA(62.5);
    }
    document.getElementById('tack').click();
    for (let i = 0; i < 30 && document.getElementById('tack').disabled; i++) window.__stepQA(62.5);
    const enabled = !document.getElementById('bear').disabled, headingBefore = Number(document.getElementById('heading-value').textContent);
    document.getElementById('bear').click();
    const headingAfter = Number(document.getElementById('heading-value').textContent), state = document.getElementById('bear').dataset.state;
    for (let i = 0; i < 800 && document.getElementById('status').textContent !== 'LEG COMPLETE'; i++) window.__stepQA(62.5);
    const finishPosition = document.querySelector('#course .player-boat').transform.baseVal.getItem(0).matrix;
    return { enabled, headingBefore, headingAfter, state, finishOffsetMeters: -finishPosition.f - 100,
      finished: document.getElementById('status').textContent === 'LEG COMPLETE',
      tacks: document.getElementById('tack-count').textContent };
  })()`);
  assert.ok(bearingResult.enabled); assert.equal(bearingResult.state, 'active');
  assert.equal(bearingResult.headingBefore, 315);
  assert.ok(bearingResult.headingBefore - bearingResult.headingAfter > 0 && bearingResult.headingBefore - bearingResult.headingAfter <= 4);
  assert.ok(bearingResult.finishOffsetMeters > 3 && bearingResult.finishOffsetMeters < 6);
  assert.ok(bearingResult.finished); assert.equal(bearingResult.tacks, '2');
  // A fast, nearly reaching approach previously tightened toward the buoy
  // after its closest point. Retain the displayed target until the finish.
  const reachingResult = await evaluate(`(() => {
    document.getElementById('retry').click();
    for (const [name, value] of Object.entries({ speedScale: 4, courseLength: 300 })) {
      const input = document.querySelector('[name="' + name + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    document.getElementById('settings-form').requestSubmit();
    document.getElementById('start').click(); document.getElementById('tack').click();
    const position = () => document.querySelector('#course .player-boat').transform.baseVal.getItem(0).matrix;
    for (let i = 0; i < 500 && -position().f < 160; i++) window.__stepQA(62.5);
    document.getElementById('tack').click();
    for (let i = 0; i < 500 && (document.getElementById('tack').disabled || position().e > 25); i++) window.__stepQA(62.5);
    const before = { x: position().e, y: -position().f };
    const entrySpeed = Number(document.getElementById('speed-value').textContent);
    document.getElementById('bear').click();
    const initialSpeed = Number(document.getElementById('speed-value').textContent);
    const targets = [], speeds = [];
    for (let i = 0; i < 500 && document.getElementById('status').textContent !== 'LEG COMPLETE'; i++) {
      const guide = document.querySelector('.mark-approach-guide');
      if (guide) targets.push(Number(guide.getAttribute('d').split(' L')[1].split(',')[1]));
      speeds.push(Number(document.getElementById('speed-value').textContent));
      window.__stepQA(62.5);
    }
    return { before, entrySpeed, initialSpeed, peakSpeed: Math.max(...speeds), finished: document.getElementById('status').textContent === 'LEG COMPLETE',
      targets: targets.length, targetDriftMeters: Math.max(...targets) - Math.min(...targets),
      finishOffsetMeters: -position().f - 300, tacks: document.getElementById('tack-count').textContent };
  })()`);
  assert.ok(reachingResult.finished); assert.equal(reachingResult.tacks, '2');
  assert.equal(reachingResult.initialSpeed, reachingResult.entrySpeed);
  assert.ok(reachingResult.peakSpeed > reachingResult.entrySpeed + 0.2, 'Bearing away must gradually accelerate toward the reaching polar.');
  assert.ok(reachingResult.targets > 2); assert.ok(reachingResult.targetDriftMeters < 1e-6);
  assert.ok(reachingResult.finishOffsetMeters > 3 && reachingResult.finishOffsetMeters < 6);
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(JSON.stringify({ desktop: '1440×1100', mobile: '390×844', runtimeErrors: errors.length,
    controls: 'sailing and live opponent, pause, retry, settings, complete leg, hindsight explanations, tack-time inspection, computer finish comparison, armed and active gate aiming', rendererCheck, contrast, workerResult, raceResult, bearingResult,
    reachingResult, waterViewport, screenshots: 'artifacts.local/wind-*.png and trainer-*.png' }, null, 2));
} finally { socket.close(); }
