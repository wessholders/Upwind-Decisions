import { createSetup, selectPreset, sessionConfig, scenarioCurrent, WIND_PRESETS } from './scenario-config.js';
import { BOAT_COLORS, loadPreferences, savePreferences } from './preferences.js';
import { COURSE_LABEL, courseSettings, isUpwindFinish } from './engine/course-config.js';
import { createLobbyWater } from './views/lobby-water.js';

const coursePreview = mode => `<svg viewBox="0 0 160 100" aria-hidden="true"><path d="M80 88V15" stroke="currentColor" stroke-dasharray="3 5" opacity=".35"/>${mode === 'finish-upwind' ? '<path d="M35 20H125" stroke="currentColor" stroke-width="3"/><circle cx="35" cy="20" r="5"/><circle cx="125" cy="20" r="5"/>' : `<circle cx="80" cy="22" r="6"/><path d="${mode === 'round-port' ? 'M45 80L95 30Q100 8 75 10L60 23M60 23h13m-13 0v-12' : 'M115 80L65 30Q60 8 85 10L100 23M100 23H87m13 0V12'}" fill="none" stroke="currentColor" stroke-width="2"/>`}<path d="M75 87l5-10 5 10z"/></svg>`;

export function createGameShell({ trainer, launch, exit, update, clearInput }) {
  const $ = id => document.getElementById(id);
  let storage;
  try { storage = window.localStorage; } catch { /* Private browsing may deny even the getter. */ }
  const preferences = loadPreferences(storage);
  let draft = { ...createSetup(), npcCount: 1 }, screen = 'lobby', step = 0, launchedConfig = null;
  const session = $('session-screen'), home = $('home-screen');
  home.innerHTML = `<canvas id="lobby-water" aria-hidden="true"></canvas>
    <section id="lobby" class="lobby-content" aria-labelledby="lobby-title">
      <div class="eyebrow">SAILING STRATEGY TRAINER</div><h1 id="lobby-title">UPWIND<br><span>DECISIONS</span></h1>
      <p>Read the pressure. Sail the shift.<br>Make your next tack count.</p>
      <button id="training" class="primary-action">START TRAINING <span aria-hidden="true">↗</span></button>
      <nav class="lobby-actions" aria-label="Player options"><button id="my-boat">My Boat</button><button id="preferences">Preferences</button><button disabled>Multiplayer <small>COMING LATER</small></button><button disabled>My Progress <small>COMING LATER</small></button></nav>
      <div class="lobby-footnote">OPEN WATER / 5 M DINGHY / YOUR DECISIONS</div>
    </section>
    <section id="setup" class="setup-panel" aria-labelledby="setup-title" hidden>
      <div class="setup-heading"><span class="eyebrow">TRAINING / SCENARIO SETUP</span><button id="setup-home" class="text-button">Return to Lobby</button></div>
      <ol id="setup-progress" class="setup-progress" aria-label="Setup progress">${['Course', 'Wind & Current', 'Opponent', 'Review'].map((name, i) => `<li><button data-step="${i}"><span>0${i + 1}</span>${name}</button></li>`).join('')}</ol>
      <h1 id="setup-title" tabindex="-1">Choose your course.</h1>
      <div data-card="0"><div class="environment-line"><span>ENVIRONMENT</span><strong>Open Water</strong><small>Lake & coastal environments coming later</small></div>
        <div class="course-options">${Object.entries(COURSE_LABEL).map(([id, label]) => `<button class="selection-option" data-course="${id}" aria-pressed="false">${coursePreview(id)}<strong>${label}</strong><span>${id === 'finish-upwind' ? '1,000 m upwind · 100 m finish line' : `Windward mark · round to ${id === 'round-port' ? 'port' : 'starboard'}`}</span></button>`).join('')}</div>
        <details id="course-tuning" class="setup-details"><summary>Course geometry & boat tuning</summary><div class="settings-grid" id="course-settings-slot"></div><p>Finish Upwind fixes the course at 1,000 m, the boat at 5 m, and the line at 20 boatlengths.</p></details>
      </div>
      <div data-card="1" hidden><div class="basic-wind"><label>Wind behavior<select id="wind-preset">${Object.entries(WIND_PRESETS).map(([id, p]) => `<option value="${id}">${p.label}</option>`).join('')}<option value="custom">Custom settings</option></select></label><p id="preset-description"></p><div id="base-wind-slot"></div>
        <label class="toggle-row"><input type="checkbox" id="randomize" checked><span><strong>Randomize Scenario</strong><small>Seeded variation keeps your selected wind behavior.</small></span></label>
        <div class="seed-row"><div id="seed-slot"></div><button id="generate-seed" class="secondary-action">New seed</button></div></div>
        <details id="wind-advanced" class="setup-details"><summary>Advanced Wind Settings</summary><div id="wind-settings-slot"></div></details>
        <fieldset class="current-settings"><legend>Water current</legend><label class="toggle-row"><input id="current-enabled" type="checkbox"><span>Enable uniform current</span></label><div id="current-options" hidden><div id="current-random-settings"><label>Maximum Current Speed (kn)<input id="current-max" type="number" value="1.5" min="0" max="3" step="any" required></label><p>Randomize Scenario is on: speed is sampled from zero to this maximum, with a direction anywhere on the compass.</p></div><div id="current-manual-settings" class="current-manual-fields" hidden><label>Manual current speed (kn)<input id="current-speed" type="number" value="0" min="0" max="3" step="any" required></label><label>Flows toward (°)<input id="current-direction" type="number" value="0" min="0" max="359" step="any" required></label></div><p id="current-preview" role="status"></p><p>Direction is where the water flows toward. Current stays uniform and constant throughout the race.</p></div></fieldset>
      </div>
      <div data-card="2" hidden><p class="step-intro">Make space to practice, or put your decisions to the test.</p><div class="opponent-options"><button data-opponent="solo" class="selection-option"><span class="option-number">01</span><strong>Solo Training</strong><span>Read the water and sail at your own pace.</span></button><button data-opponent="npc" class="selection-option"><span class="option-number">02</span><strong>Race NPCs</strong><span>All-Rounder sailors share your wind and boat model.</span></button></div><label class="fleet-count" id="npc-count-control">NPC boats<select id="npc-count">${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select><span>Skills spread automatically from Beginner through Elite.</span></label></div>
      <div data-card="3" hidden><p class="step-intro">Your water. Your route. Ready when you are.</p><dl id="review" class="review-list"></dl></div>
      <p id="setup-error" role="alert" class="error" hidden></p>
      <div class="setup-navigation"><button id="setup-back" class="secondary-action">Back</button><span id="step-label"></span><button id="setup-next" class="primary-action">Continue →</button></div>
    </section>`;
  const dialog = document.createElement('dialog'); dialog.id = 'game-dialog'; dialog.className = 'game-dialog';
  document.body.append(dialog);
  const lobbyWater = createLobbyWater($('lobby-water'));
  // Move the real controls rather than duplicating their settings paths.
  const advanced = document.querySelector('.advanced');
  $('wind-settings-slot').append(advanced);
  advanced.open = true; advanced.querySelector('summary').hidden = true;
  advanced.querySelector('p').textContent = 'Advanced values are used when Go to Course is selected. Use Start Race on the course when you are ready. Editing setup never advances or resets a session. Positive shifts are clockwise.';
  advanced.querySelector('button[type="submit"]').hidden = true;
  const scenarioSelects = document.querySelector('.scenario-selects');
  $('wind-settings-slot').prepend(scenarioSelects);
  $('course-settings-slot').append($('course-mode').closest('label'));
  for (const name of ['courseLength', 'boatLength', 'gateBoatLengths', 'speedScale', 'minAngle', 'tackPenalty']) {
    const input = document.querySelector(`[name="${name}"]`); input.setAttribute('form', 'settings-form');
    $('course-settings-slot').append(input.closest('label'));
  }
  for (const [name, slot] of [['backgroundWindKnots', 'base-wind-slot'], ['seed', 'seed-slot']]) {
    const input = document.querySelector(`[name="${name}"]`); input.setAttribute('form', 'settings-form'); $(slot).append(input.closest('label'));
  }
  document.querySelector('.intro-row').hidden = true;
  document.querySelector('.keyboard-hint').textContent = '← → STEER  ·  SPACE TACK  ·  P PAUSE  ·  ESC MENU';
  const utilities = document.querySelector('.utility-row');
  const historyToggle = $('toggle-wind');
  utilities.innerHTML = '<div><button id="race-again" title="Repeat the same seed and conditions">Race Again</button><button id="new-scenario" title="Generate a new seed using your current setup choices">New Scenario</button><button id="modify-scenario">Modify Scenario</button><button id="return-lobby">Lobby</button></div><div><button id="toggle-reference" aria-pressed="false" aria-controls="course" hidden>Show Hindsight Reference</button><button id="display-options">Display & navigation aids</button></div>';
  const display = document.createElement('details'); display.className = 'display-options'; display.id = 'display-panel';
  display.innerHTML = '<summary>Display & navigation aids</summary>'; utilities.after(display);
  display.append(historyToggle);
  const laylineControl = document.createElement('label'); laylineControl.className = 'layline-control';
  laylineControl.innerHTML = 'Layline calculation<select id="layline-mode"><option value="wind-only">Wind Only</option><option value="wind-current">Wind + Current</option></select>';
  display.append(laylineControl);
  for (const selector of ['.wind-view-controls', '#wind-legend', '#wind-time', '#wind-history', '.computer-decisions']) display.append(document.querySelector(selector));
  const closeButton = document.createElement('button'); closeButton.id = 'close-haul'; closeButton.className = 'bear-button'; closeButton.textContent = 'Return to Close Haul';
  $('bear').after(closeButton); closeButton.addEventListener('click', () => { trainer.act('close'); update(); session.focus({ preventScroll: true }); });
  const angle = document.createElement('div'); angle.className = 'angle-instrument'; angle.innerHTML = '<span>TRUE WIND ANGLE</span><strong id="sailing-angle">45.0°</strong>';
  document.querySelector('.pressure-instrument').after(angle);
  const currentInstrument = document.createElement('div'); currentInstrument.id = 'current-indicator'; currentInstrument.className = 'current-indicator'; currentInstrument.hidden = true;
  currentInstrument.innerHTML = '<span>CURRENT · FLOWS TOWARD</span><strong><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path id="current-arrow" d="M12 21V3M6 9l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg><span id="current-value"></span></strong><small id="ground-motion"></small>';
  angle.after(currentInstrument);
  document.querySelector('#speed-value').closest('div').querySelector('span:first-child').textContent = 'Boat speed · STW';
  const touch = document.createElement('div'); touch.className = 'touch-steering'; touch.innerHTML = '<button id="steer-left" aria-label="Steer left">← Steer</button><button id="steer-right" aria-label="Steer right">Steer →</button>';
  document.querySelector('.sailing-controls').prepend(touch);
  let touchDirection = 0;
  for (const [id, direction] of [['steer-left', -1], ['steer-right', 1]]) {
    const button = $(id);
    button.addEventListener('pointerdown', e => { if (trainer.state.phase !== 'sailing') return; e.preventDefault(); button.setPointerCapture(e.pointerId); touchDirection = direction; });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => { touchDirection = 0; });
    button.addEventListener('click', e => { if (e.detail === 0) { trainer.steer(direction * 2); update(); } });
  }
  function clear() { touchDirection = 0; clearInput(); }
  function save() { return savePreferences(storage, preferences); }
  function applyPreferences() { Object.assign(trainer.state, preferences); }
  applyPreferences();
  $('layline-mode').value = preferences.laylineMode;
  $('layline-mode').addEventListener('change', event => {
    preferences.laylineMode = event.target.value; trainer.state.laylineMode = preferences.laylineMode; save(); update();
  });
  function show(next) {
    clear(); screen = next; document.body.dataset.screen = next;
    home.hidden = next === 'session'; session.hidden = next !== 'session';
    $('lobby').hidden = next !== 'lobby'; $('setup').hidden = next !== 'setup';
    lobbyWater.setActive(next !== 'session');
    if (dialog.open) dialog.close();
    update(); window.scrollTo(0, 0);
    const focus = next === 'setup' ? $('setup-title') : next === 'lobby' ? $('training') : session;
    focus.focus({ preventScroll: true });
  }
  function syncDraft() {
    for (const input of home.querySelectorAll('[name]')) {
      if (Object.hasOwn(draft, input.name)) input.value = draft[input.name];
      if (['courseLength', 'boatLength', 'gateBoatLengths'].includes(input.name)) input.disabled = isUpwindFinish(draft);
    }
    for (const [id, key] of [['wind-mode', 'windMode'], ['difficulty', 'difficulty'], ['wind-field', 'windField'], ['favored-side', 'favoredSide']]) $(id).value = draft[key];
    $('organic-settings').hidden = false;
    $('wind-preset').value = draft.windPreset; $('randomize').checked = draft.randomize;
    $('preset-description').textContent = WIND_PRESETS[draft.windPreset]?.description || 'Your advanced settings define this scenario.';
    for (const b of home.querySelectorAll('[data-course]')) b.setAttribute('aria-pressed', String(b.dataset.course === draft.courseMode));
    for (const b of home.querySelectorAll('[data-opponent]')) b.setAttribute('aria-pressed', String(b.dataset.opponent === draft.opponentMode));
    $('npc-count').value = draft.npcCount;
    $('npc-count-control').hidden = draft.opponentMode !== 'npc';
    syncCurrent();
  }
  function currentDescription() {
    let current;
    try { current = scenarioCurrent(draft); } catch { return 'Check current settings'; }
    return current.enabled ? `${current.speedKnots.toFixed(2)} kn toward ${String(Math.round(current.directionDegrees) % 360).padStart(3, '0')}°${draft.randomize ? ' · seeded' : ' · manual'}` : 'Off';
  }
  function updateCurrentPreview() {
    try { $('current-preview').textContent = `This scenario: ${currentDescription()}`; }
    catch { $('current-preview').textContent = 'Enter valid current settings to preview this scenario.'; }
  }
  function syncCurrent() {
    $('current-enabled').checked = draft.current.enabled;
    $('current-options').hidden = !draft.current.enabled;
    $('current-random-settings').hidden = !draft.randomize;
    $('current-manual-settings').hidden = draft.randomize;
    $('current-max').value = draft.maxCurrentKnots;
    $('current-speed').value = draft.current.speedKnots;
    $('current-direction').value = draft.current.directionDegrees;
    $('current-max').disabled = !draft.current.enabled || !draft.randomize;
    $('current-speed').disabled = $('current-direction').disabled = !draft.current.enabled || draft.randomize;
    updateCurrentPreview();
  }
  function showStep(next) {
    step = next; syncDraft();
    for (const card of home.querySelectorAll('[data-card]')) card.hidden = Number(card.dataset.card) !== step;
    for (const button of home.querySelectorAll('[data-step]')) {
      if (Number(button.dataset.step) === step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    }
    $('setup-title').textContent = ['Choose your course.', 'Read your conditions.', 'Choose your opponent.', 'Ready to sail.'][step];
    $('step-label').textContent = `STEP ${step + 1} OF 4`;
    $('setup-next').textContent = step === 3 ? 'GO TO COURSE ↗' : 'Continue →';
    $('setup-back').textContent = step === 0 ? 'Lobby' : 'Back';
    const values = [['Environment', 'Open Water'], ['Course', COURSE_LABEL[draft.courseMode]], ['Boat', `${draft.boatLength} m dinghy · Main + jib`], ['Wind', WIND_PRESETS[draft.windPreset]?.label || 'Custom'], ['Base wind', `${draft.backgroundWindKnots} kn`], ['Randomization', draft.randomize ? 'On · seeded variation' : 'Off · fixed parameters'], ['Seed', draft.seed], ['Current', currentDescription()], ['Opponent', draft.opponentMode === 'npc' ? `${draft.npcCount} All-Rounder NPC${draft.npcCount === 1 ? '' : 's'}` : 'Solo Training']];
    $('review').replaceChildren(...values.flatMap(([key, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; return [dt, dd]; }));
    $('setup-title').focus({ preventScroll: true });
  }
  function valid() {
    for (const input of home.querySelectorAll('input[type="number"]')) {
      if (!input.checkValidity()) {
        const card = input.closest('[data-card]'); showStep(Number(card.dataset.card));
        for (let parent = input.parentElement; parent && parent !== card; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
        input.reportValidity(); return false;
      }
    }
    return true;
  }
  function start(config = null) {
    try {
      const next = config || sessionConfig({ ...draft, boatColor: preferences.boatColor });
      launch(next); launchedConfig = next; applyPreferences(); show('session');
    } catch (error) { $('setup-error').hidden = false; $('setup-error').textContent = error.message; }
  }
  function leave(next) { exit(); show(next); if (next === 'setup') showStep(step); }
  $('main-menu').onclick = () => leave('lobby');
  $('change-course').onclick = () => { step = 0; leave('setup'); };
  document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); leave('lobby'); });
  $('training').onclick = () => { show('setup'); showStep(0); };
  $('setup-home').onclick = () => show('lobby');
  $('setup-back').onclick = () => step ? showStep(step - 1) : show('lobby');
  $('setup-next').onclick = () => { $('setup-error').hidden = true; if (!valid()) return; if (step < 3) showStep(step + 1); else start(); };
  home.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.step !== undefined && valid()) showStep(Number(b.dataset.step));
    if (b.dataset.course) { draft = courseSettings({ ...draft, courseMode: b.dataset.course }); syncDraft(); }
    if (b.dataset.opponent) { draft = { ...draft, opponentMode: b.dataset.opponent }; syncDraft(); }
  });
  home.addEventListener('input', e => {
    if (e.target.matches('input[name]')) {
      draft = { ...draft, [e.target.name]: e.target.valueAsNumber };
      if (e.target.name === 'persistentShiftAngle' && ['left', 'right'].includes(draft.windPreset) && Math.sign(e.target.valueAsNumber) !== draft.shiftDirection) {
        draft = { ...draft, windPreset: 'custom', shiftDirection: 0 };
        $('wind-preset').value = 'custom'; $('preset-description').textContent = 'Your advanced settings define this scenario.';
      }
    }
    const keys = { 'current-speed': 'speedKnots', 'current-direction': 'directionDegrees' };
    if (keys[e.target.id]) draft = { ...draft, current: { ...draft.current, [keys[e.target.id]]: e.target.valueAsNumber } };
    if (e.target.id === 'current-max') draft = { ...draft, maxCurrentKnots: e.target.valueAsNumber };
    updateCurrentPreview();
  });
  home.addEventListener('change', e => {
    if (e.target.id === 'npc-count') { draft = { ...draft, npcCount: Number(e.target.value) }; syncDraft(); }
    const bindings = { 'wind-mode': 'windMode', difficulty: 'difficulty', 'wind-field': 'windField', 'favored-side': 'favoredSide', 'course-mode': 'courseMode' };
    if (bindings[e.target.id]) {
      draft = courseSettings({ ...draft, [bindings[e.target.id]]: e.target.value });
      if (e.target.id === 'wind-mode') draft = { ...draft, windPreset: 'custom', shiftDirection: 0 };
      syncDraft();
    }
  });
  $('wind-preset').onchange = e => { draft = e.target.value === 'custom' ? { ...draft, windPreset: 'custom' } : selectPreset(draft, e.target.value); syncDraft(); };
  $('randomize').onchange = e => { draft = { ...draft, randomize: e.target.checked }; syncCurrent(); };
  $('current-enabled').onchange = e => { draft = { ...draft, current: { ...draft.current, enabled: e.target.checked } }; syncCurrent(); };
  function nextSeed() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    return seed === draft.seed ? (seed + 1) >>> 0 : seed;
  }
  $('generate-seed').onclick = () => { draft = { ...draft, seed: nextSeed() }; syncDraft(); };
  $('settings-form').onsubmit = e => e.preventDefault();
  $('traveling-demo').onclick = () => { draft = { ...draft, windPreset: 'custom', courseMode: 'round-port', courseLength: 300, windField: 'traveling', windMode: 'persistent', transitionWidth: 30, shiftStartTime: 10, shiftDirection: 0 }; syncDraft(); };
  $('race-again').onclick = () => start(launchedConfig);
  function newScenario() {
    // Derive conditions once from the editable settings, not from already
    // randomized session parameters. Manual current values stay in this draft.
    draft = { ...draft, seed: nextSeed() };
    syncDraft(); start();
  }
  $('new-scenario').onclick = newScenario;
  $('modify-scenario').onclick = () => leave('setup'); $('return-lobby').onclick = () => leave('lobby');
  $('display-options').onclick = () => { display.open = !display.open; if (display.open) display.scrollIntoView({ block: 'nearest' }); };
  function openDialog(title, content) {
    clear(); dialog.innerHTML = `<h2 id="dialog-title">${title}</h2>${content}`; dialog.setAttribute('aria-labelledby', 'dialog-title'); dialog.showModal();
  }
  $('my-boat').onclick = () => {
    openDialog('My Boat', `<p>5 m dinghy · 470-inspired · Main + jib</p><div class="boat-preview"><svg viewBox="0 0 140 100" aria-label="Your dinghy"><path d="M30 72Q65 92 110 72Z" fill="${preferences.boatColor}"/><path d="M68 12V70H34ZM75 30V70H105Z" fill="#f6f8ef" stroke="#657f85"/></svg></div><p>Hull color · Performance stays the same</p><div class="color-options">${Object.entries(BOAT_COLORS).map(([name, color]) => `<button data-color="${color}" aria-pressed="${preferences.boatColor === color}" style="--swatch:${color}">${name}</button>`).join('')}</div><p id="preference-status" role="status"></p><button data-close class="primary-action">Done</button>`);
  };
  $('preferences').onclick = () => {
    openDialog('Preferences', `<p>← / → Steer physically left / right<br>Space · Tack<br>P · Pause / resume<br>Escape · Pause menu</p><p>Steering follows local true wind. Manual steering cancels mark aiming; tack and Return to Close Haul return to the minimum sailing angle.</p><label>Wind on water<select id="preferred-wind"><option value="streaks">Particles & water</option><option value="boundaries">Identify puffs / pockets</option><option value="hidden">Hidden</option></select></label><label class="toggle-row"><input id="preferred-history" type="checkbox"> Show wind history</label><label class="toggle-row"><input id="preferred-camera" type="checkbox"> Follow boat camera</label><p id="preference-status" role="status"></p><button data-close class="primary-action">Done</button>`);
    $('preferred-wind').value = preferences.windDisplay; $('preferred-history').checked = preferences.showWind; $('preferred-camera').checked = preferences.follow;
  };
  dialog.addEventListener('change', e => {
    if (e.target.id === 'preferred-wind') preferences.windDisplay = e.target.value;
    if (e.target.id === 'preferred-history') preferences.showWind = e.target.checked;
    if (e.target.id === 'preferred-camera') preferences.follow = e.target.checked;
    applyPreferences(); const ok = save(); $('preference-status').textContent = ok ? 'Preferences saved on this device.' : 'Preferences apply for this visit; local storage is unavailable.';
  });
  dialog.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.color) {
      preferences.boatColor = b.dataset.color; applyPreferences();
      dialog.querySelector('.boat-preview path').setAttribute('fill', preferences.boatColor);
      for (const color of dialog.querySelectorAll('[data-color]')) color.setAttribute('aria-pressed', String(color === b));
      $('preference-status').textContent = save() ? 'Boat color saved on this device.' : 'Color applies for this visit; local storage is unavailable.';
    }
    if (b.hasAttribute('data-close')) dialog.close();
    if (b.dataset.pause === 'resume') resume();
    if (b.dataset.pause === 'restart') { dialog.close(); start(launchedConfig); }
    if (b.dataset.pause === 'new') newScenario();
    if (b.dataset.pause === 'setup') leave('setup');
    if (b.dataset.pause === 'lobby') leave('lobby');
  });
  function resume() { dialog.close(); clear(); if (trainer.state.phase === 'paused') trainer.togglePause(); update(); session.focus(); }
  function pauseMenu() {
    if (screen !== 'session' || trainer.state.phase === 'finished') return;
    if (dialog.open) { resume(); return; }
    if (trainer.state.phase === 'sailing') trainer.togglePause();
    const ready = trainer.state.phase === 'ready';
    openDialog(ready ? 'Race ready' : 'Session paused', `<p>${ready ? 'Use Start Race on the course when you are ready.' : 'The water can wait.'}</p><div class="pause-actions"><button data-pause="resume" class="primary-action">${ready ? 'Return to course' : 'Resume'}</button><button data-pause="restart">Restart Scenario</button><button data-pause="new">New Scenario · New Seed</button><button data-pause="setup">Return to Scenario Setup</button><button data-pause="lobby">Return to Lobby</button></div>`);
    update();
  }
  dialog.addEventListener('cancel', e => { if (screen === 'session') { e.preventDefault(); resume(); } });
  dialog.addEventListener('keydown', e => { if (screen === 'session' && e.code === 'KeyP' && !e.repeat) { e.preventDefault(); resume(); } });
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  syncDraft(); show('lobby');
  return { preferences, get screen() { return screen; }, get modalOpen() { return dialog.open; }, pauseMenu,
    tick(elapsed) { if (screen === 'session' && !dialog.open && touchDirection) trainer.steer(touchDirection * 15 * Math.min(0.1, elapsed)); },
    destroy() { lobbyWater.destroy(); dialog.remove(); } };
}
