// Run the static server and isolated Edge/Chromium with CDP on port 9225.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const debugging = process.env.CDP_URL || 'http://127.0.0.1:9225';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5173';
const targets = await (await fetch(debugging + '/json/list')).json();
const target = targets.find(t => t.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let nextId = 0; const pending = new Map(), errors = [];
socket.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  if (pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); }
});
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
}
async function waitFor(expression, timeout = 15000) {
  for (let i = 0; i < timeout / 50; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw Error(`Timed out: ${expression}`);
}
const click = id => evaluate(`document.getElementById('${id}').click()`);
const pauseAction = action => evaluate(`document.querySelector('[data-pause="${action}"]').click()`);
const set = (selector, value) => evaluate(`(() => { const el = document.querySelector('${selector}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); })()`);
async function screenshot(name) { const r = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(new URL(`../artifacts.local/game-${name}.png`, import.meta.url), Buffer.from(r.data, 'base64')); }
const step = ms => evaluate(`window.__stepQA(${ms})`);
async function assertReady() {
  assert.equal(await evaluate(`document.getElementById('status').textContent`), 'READY TO SAIL');
  assert.match(await evaluate(`document.getElementById('start').textContent`), /Start Race/);
  const before = await evaluate(`[document.getElementById('elapsed').textContent, document.getElementById('computer-state').textContent, document.querySelector('.player-boat').getAttribute('transform')]`);
  await step(1000);
  assert.deepEqual(await evaluate(`[document.getElementById('elapsed').textContent, document.getElementById('computer-state').textContent, document.querySelector('.player-boat').getAttribute('transform')]`), before, 'Both boats and the race clock must wait for Start Race.');
  assert.equal(await evaluate(`window.__framesQA()`), 0);
}
async function assertKeysDoNotScroll() {
  await evaluate(`document.getElementById('session-screen').focus({preventScroll:true}); window.scrollTo(0,70)`);
  const scroll = await evaluate(`[scrollX,scrollY]`);
  for (const [code, key, virtual] of [['Space', ' ', 32], ['ArrowLeft', 'ArrowLeft', 37], ['ArrowUp', 'ArrowUp', 38], ['ArrowRight', 'ArrowRight', 39], ['ArrowDown', 'ArrowDown', 40]]) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: virtual });
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: virtual, autoRepeat: true });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: virtual });
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.deepEqual(await evaluate(`[scrollX,scrollY]`), scroll, 'Native game keys, including held Space, must not scroll.');
  await evaluate(`document.getElementById('full-course').focus({preventScroll:true})`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await evaluate(`document.querySelector('.brand').focus({preventScroll:true})`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.deepEqual(await evaluate(`[scrollX,scrollY]`), scroll, 'Focusing course buttons or links must not restore page scrolling.');
  await evaluate(`document.getElementById('session-screen').focus({preventScroll:true})`);
  await evaluate(`window.scrollTo(0,0)`);
}
try {
  await call('Runtime.enable'); await call('Page.enable');
  // Own the RAF clock to test gameplay and hidden-state cleanup without waiting real race time.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    let time = performance.now(), next = 0; const frames = new Map();
    window.requestAnimationFrame = callback => { frames.set(++next, callback); return next; };
    window.cancelAnimationFrame = id => frames.delete(id);
    window.__stepQA = ms => { time += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); };
    window.__framesQA = () => frames.size;
  })();` });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: base + '/' });
  await waitFor(`document.getElementById('startup-error')?.hidden`);
  assert.equal(await evaluate(`document.body.dataset.screen`), 'lobby');
  const water = await evaluate(`document.getElementById('lobby-water').toDataURL()`); await step(1000); await step(1000);
  assert.ok(await evaluate(`document.getElementById('lobby-water').toDataURL()`) !== water, 'Lobby water must animate.');
  await screenshot('lobby');
  await click('my-boat'); await evaluate(`document.querySelector('[data-color="#26766e"]').click()`); await evaluate(`document.querySelector('[data-close]').click()`);
  await click('training'); assert.equal(await evaluate(`document.getElementById('setup-title').textContent`), 'Choose your course.');
  await click('setup-next'); await set('[name="backgroundWindKnots"]', 12); await set('#wind-preset', 'left');
  await click('setup-back'); await click('setup-next'); assert.equal(await evaluate(`document.querySelector('[name="backgroundWindKnots"]').value`), '12');
  await screenshot('wind-setup');
  await click('setup-next'); await click('setup-next');
  assert.match(await evaluate(`document.getElementById('review').textContent`), /Solo Training/);
  await click('setup-next'); assert.equal(await evaluate(`document.body.dataset.screen`), 'session');
  await assertReady(); await assertKeysDoNotScroll(); await assertReady();
  await click('start');
  assert.equal(await evaluate(`document.getElementById('status').textContent`), 'SAILING');
  assert.equal(await evaluate(`document.querySelector('.computer-strip').hidden`), true);
  assert.equal(await evaluate(`document.querySelector('.player-boat path').getAttribute('fill')`), '#26766e');
  assert.equal(await evaluate(`document.getElementById('lobby-water').width > 0`), true);
  const key = (type, code, extra = '') => evaluate(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', key: '${code === 'Space' ? ' ' : code}', bubbles:true, ${extra} }))`);
  const angles = [];
  for (const speed of [1, 4, 8, 16]) {
    await click('race-again'); await assertReady(); await click('start'); await set('#playback', String(speed)); await evaluate(`document.getElementById('session-screen').focus()`);
    await step(0); await key('keydown', 'ArrowLeft'); for (let i = 0; i < 10; i++) await step(50); await key('keyup', 'ArrowLeft');
    const angle = Number((await evaluate(`document.getElementById('sailing-angle').textContent`)).replace('°', '')); angles.push({ speed, angle });
    assert.ok(Math.abs(angle - 52.5) < .15, JSON.stringify(angles));
  }
  await assertKeysDoNotScroll(); await step(100);
  assert.equal(await evaluate(`document.getElementById('tack-count').textContent`), '1'); await key('keyup', 'Space');
  await key('keydown', 'KeyP'); assert.equal(await evaluate(`document.getElementById('game-dialog').open`), true);
  const paused = await evaluate(`document.getElementById('elapsed').textContent`); await step(1000);
  assert.equal(await evaluate(`document.getElementById('elapsed').textContent`), paused);
  await pauseAction('resume'); await step(100); assert.equal(await evaluate(`document.getElementById('status').textContent`), 'SAILING');
  await key('keydown', 'Escape'); await pauseAction('restart');
  assert.equal(await evaluate(`document.getElementById('tack-count').textContent`), '0');
  await assertReady(); await click('start');
  assert.equal(await evaluate(`window.__framesQA()`), 1, 'Start Race after restart must keep exactly one gameplay RAF.');
  await screenshot('desktop');
  await click('change-course');
  assert.equal(await evaluate(`document.getElementById('setup-title').textContent`), 'Choose your course.');
  assert.equal(await evaluate(`document.getElementById('game-dialog').open`), false);
  assert.equal(await evaluate(`document.querySelector('[name="backgroundWindKnots"]').value`), '12');
  await evaluate(`document.querySelector('[data-step="0"]').click()`);
  await screenshot('course-setup');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (let i = 0; i < 4; i++) {
    await evaluate(`document.querySelector('[data-step="${i}"]').click()`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'Setup must fit mobile width.');
  }
  await screenshot('mobile-review');
  await click('setup-next'); await assertReady(); await click('start'); await step(100);
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  assert.ok(await evaluate(`document.getElementById('change-course').getBoundingClientRect().top >= 0 && document.getElementById('main-menu').getBoundingClientRect().bottom <= 70`), 'Navigation must stay visible while scrolling on mobile.');
  await evaluate(`window.scrollTo(0,0)`);
  await screenshot('mobile');
  // Pointer steering uses the same real-time command path as the keyboard.
  await click('race-again'); await assertReady(); await click('start'); await step(0);
  const point = await evaluate(`(() => { const r = document.getElementById('steer-left').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  for (let i = 0; i < 10; i++) await step(50);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  assert.equal(await evaluate(`document.getElementById('sailing-angle').textContent`), '52.5°');
  await evaluate(`document.getElementById('session-screen').focus()`);
  await key('keydown', 'ArrowLeft'); await evaluate(`window.dispatchEvent(new Event('blur'))`); await step(100);
  assert.equal(await evaluate(`document.getElementById('sailing-angle').textContent`), '52.5°');
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'))`);
  assert.equal(await evaluate(`window.__framesQA()`), 0);
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'))`);
  await step(0); await step(100);
  assert.equal(await evaluate(`document.getElementById('sailing-angle').textContent`), '52.5°');
  await click('main-menu'); const ended = await evaluate(`document.getElementById('elapsed').textContent`); await step(1000);
  assert.equal(await evaluate(`document.body.dataset.screen`), 'lobby');
  assert.equal(await evaluate(`document.getElementById('elapsed').textContent`), ended);
  await click('my-boat'); assert.equal(await evaluate(`document.querySelector('[data-color="#26766e"]').getAttribute('aria-pressed')`), 'true'); await evaluate(`document.querySelector('[data-close]').click()`);
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await waitFor(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  await step(100); assert.equal(await evaluate(`window.__framesQA()`), 0, 'Reduced-motion lobby must remain static.');
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  // Current uses the global randomization toggle and retains separate manual values.
  await click('training'); await click('setup-next'); await click('current-enabled');
  assert.equal(await evaluate(`document.getElementById('current-max').value`), '1.5');
  await click('randomize');
  await set('#current-speed', '.84'); await set('#current-direction', '237');
  await click('setup-next'); await click('setup-back');
  assert.equal(await evaluate(`document.getElementById('current-speed').value`), '0.84');
  assert.equal(await evaluate(`document.getElementById('current-direction').value`), '237');
  await click('randomize'); await set('[name="seed"]', '777');
  const generatedCurrent = await evaluate(`document.getElementById('current-preview').textContent`);
  await click('generate-seed');
  assert.notEqual(await evaluate(`document.querySelector('[name="seed"]').value`), '777');
  await set('[name="seed"]', '777');
  assert.equal(await evaluate(`document.getElementById('current-preview').textContent`), generatedCurrent);
  await click('randomize');
  assert.equal(await evaluate(`document.getElementById('current-speed').value`), '0.84');
  assert.equal(await evaluate(`document.getElementById('current-direction').value`), '237');
  await set('#current-speed', '.4'); await set('#current-direction', '90');
  await set('#wind-field', 'uniform'); await set('#wind-mode', 'steady');
  await screenshot('current-setup');
  await click('setup-next'); await evaluate(`document.querySelector('[data-opponent="npc"]').click()`); await click('setup-next');
  assert.match(await evaluate(`document.getElementById('review').textContent`), /0.40 kn toward 090/);
  await click('setup-next'); await assertReady();
  assert.equal(await evaluate(`document.getElementById('current-indicator').hidden`), false);
  assert.match(await evaluate(`document.getElementById('current-value').textContent`), /0.4 kn.*090/);
  assert.match(await evaluate(`document.getElementById('ground-motion').textContent`), /SOG.*COG/);
  await set('#layline-mode', 'wind-only');
  const guidePaths = () => evaluate(`Array.from(document.querySelectorAll('#course .layline, #course .finish-layline')).map(p=>p.getAttribute('d'))`);
  const traditional = await guidePaths();
  const motionBeforeMode = await evaluate(`[document.getElementById('elapsed').textContent,document.querySelector('.player-boat').getAttribute('transform'),document.getElementById('computer-state').textContent,document.getElementById('current-value').textContent]`);
  await set('#layline-mode', 'wind-current');
  assert.notDeepEqual(await guidePaths(), traditional);
  assert.deepEqual(await evaluate(`[document.getElementById('elapsed').textContent,document.querySelector('.player-boat').getAttribute('transform'),document.getElementById('computer-state').textContent,document.getElementById('current-value').textContent]`), motionBeforeMode);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('upwind.preferences')).laylineMode`), 'wind-current');
  await click('start'); await step(0); await step(100);
  const sailingBeforeMode = await evaluate(`[document.getElementById('status').textContent,document.getElementById('elapsed').textContent,document.querySelector('.player-boat').getAttribute('transform'),document.getElementById('computer-state').textContent]`);
  await set('#layline-mode', 'wind-only');
  assert.deepEqual(await evaluate(`[document.getElementById('status').textContent,document.getElementById('elapsed').textContent,document.querySelector('.player-boat').getAttribute('transform'),document.getElementById('computer-state').textContent]`), sailingBeforeMode);
  const activeCurrent = await evaluate(`document.getElementById('current-value').textContent`);
  await click('start'); await pauseAction('restart'); await assertReady();
  assert.equal(await evaluate(`document.getElementById('current-value').textContent`), activeCurrent);
  await screenshot('current-desktop');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  await screenshot('current-mobile');
  await click('change-course'); await click('setup-next'); await click('current-enabled');
  assert.equal(await evaluate(`document.getElementById('current-speed').value`), '0.4');
  assert.equal(await evaluate(`document.getElementById('current-direction').value`), '90');
  await click('setup-home');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const courses = [];
  for (const mode of ['round-port', 'round-starboard', 'finish-upwind']) {
    await click('training'); await evaluate(`document.querySelector('[data-course="${mode}"]').click()`);
    if (mode !== 'finish-upwind') await set('[name="courseLength"]', 100);
    await click('setup-next'); await set('#wind-field', 'uniform'); await set('#wind-mode', 'steady');
    if (await evaluate(`document.getElementById('randomize').checked`)) await click('randomize');
    if (!await evaluate(`document.getElementById('current-enabled').checked`)) await click('current-enabled');
    await set('#current-speed', '.3'); await set('#current-direction', '0');
    await click('setup-next'); await evaluate(`document.querySelector('[data-opponent="npc"]').click()`); await click('setup-next'); await click('setup-next');
    assert.equal(await evaluate(`document.querySelector('.computer-strip').hidden`), false);
    assert.equal(await evaluate(`document.querySelectorAll('.finish-pin').length`), mode === 'finish-upwind' ? 2 : 0);
    assert.equal(await evaluate(`document.querySelectorAll('.finish-layline').length`), mode === 'finish-upwind' ? 4 : 0);
    await assertReady(); await click('start');
    await set('#playback', '16');
    if (mode === 'round-port') await click('tack');
    await evaluate(`document.getElementById('session-screen').focus()`);
    let finished = false;
    for (let chunk = 0; chunk < 60 && !finished; chunk++) {
      finished = await evaluate(`(() => {
        for (let i = 0; i < 100 && document.getElementById('status').textContent !== 'LEG COMPLETE'; i++) {
          const p = document.querySelector('#course .player-boat').transform.baseVal.getItem(0).matrix;
          const side = document.getElementById('tack-label').textContent;
          if (side === '${mode === 'round-port' ? 'PORT TACK' : 'STARBOARD TACK'}' && -p.f >= ${mode === 'finish-upwind' ? 500 : 55} && !document.getElementById('tack').disabled) document.getElementById('tack').click();
          window.__stepQA(62.5);
        }
        return document.getElementById('status').textContent === 'LEG COMPLETE';
      })()`);
    }
    assert.ok(finished, mode);
    await waitFor(`document.querySelector('#results table')`, 30000);
    assert.equal(await evaluate(`document.querySelectorAll('#results .tack-card').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('#results .gold').length`), 0);
    assert.equal(await evaluate(`document.querySelector('#course .hindsight-reference')`), null, 'The finished reference must stay hidden by default.');
    assert.equal(await evaluate(`document.querySelectorAll('#course .reference-tack').length`), 0);
    assert.equal(await evaluate(`document.getElementById('reference-legend').hidden`), true);
    const withoutReference = await evaluate(`document.getElementById('course').getAttribute('viewBox')`);
    await click('toggle-reference');
    assert.equal(await evaluate(`document.querySelectorAll('#course .hindsight-reference').length`), 1);
    assert.equal(await evaluate(`document.getElementById('toggle-reference').getAttribute('aria-pressed')`), 'true');
    assert.ok(await evaluate(`document.querySelectorAll('#results .tack-card').length > 0`));
    await click('toggle-reference');
    assert.equal(await evaluate(`document.querySelector('#course .hindsight-reference')`), null);
    assert.equal(await evaluate(`document.getElementById('course').getAttribute('viewBox')`), withoutReference);
    await click('toggle-reference');
    await evaluate(`document.querySelector('#results [data-inspect-tack]').click()`);
    assert.equal(await evaluate(`document.getElementById('inspection-banner').hidden`), false);
    assert.equal(await evaluate(`document.querySelectorAll('#course .hindsight-reference').length`), 1, 'Explicit tack inspection may reveal the reference.');
    await click('inspection-return');
    assert.equal(await evaluate(`document.querySelectorAll('#course .hindsight-reference').length`), 1);
    await click('toggle-reference');
    assert.equal(await evaluate(`document.querySelector('#course .hindsight-reference')`), null);
    await screenshot(`results-${mode}`);
    courses.push({ mode, currentKnots: .3, hindsight: true, replayInspection: true });
    await click('return-lobby');
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(JSON.stringify({ runtimeErrors: errors.length, angles, courses, navigation: 'lobby/setup/launch/pause/restart/setup/lobby', desktop: '1440x1000', mobile: '390x844', screenshots: 'artifacts.local/game-*.png' }, null, 2));
} finally { socket.close(); }
