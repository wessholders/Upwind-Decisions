import { createTrainer } from './race-controller.js';
import { normalize } from './engine/geometry.js';
import { canBearAway, compassHeading } from './engine/physics.js';
import { formatTime } from './engine/scoring.js';
import { windAt } from './engine/wind.js';
import { courseView } from './views/course.js';
import { windHistoryView } from './views/wind-history.js';
import { resultsView } from './views/results.js';

const trainer = createTrainer();
const { state } = trainer;
const ids = ['startup-error', 'wind-mode', 'difficulty', 'status-dot', 'status', 'full-course', 'follow-boat', 'course', 'reference-legend', 'heading-value', 'tack-label', 'true-wind', 'wind-shift', 'elapsed', 'distance-value', 'tack-count', 'speed-value', 'tack', 'tack-button-text', 'bear', 'start', 'playback', 'instrument-hint', 'new-wind', 'retry', 'toggle-wind', 'results', 'error', 'wind-history', 'wind-chart', 'settings-form', 'scenario-label'];
const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let frame = 0;
let previousTime = 0;
let worker = null;
let benchmarkRevision = -1;
let lastResults = null;

const compass = degrees => `${(Math.round(degrees) % 360).toString().padStart(3, '0')}°`;

function render() {
  const { boat, scenario } = state;
  const active = state.phase === 'sailing' || state.phase === 'paused';
  const stopped = boat.penaltyRemaining > 1e-8;
  const wind = windAt(scenario, boat.time);
  ui.status.textContent = state.phase === 'ready' ? 'READY TO SAIL' : state.phase === 'finished' ? 'LEG COMPLETE' : state.phase.toUpperCase();
  ui['status-dot'].classList.toggle('live', state.phase === 'sailing');
  for (const [id, selected] of [['full-course', !state.follow], ['follow-boat', state.follow]]) ui[id].setAttribute('aria-pressed', String(selected));
  ui['wind-mode'].value = state.draft.windMode;
  ui.difficulty.value = state.draft.difficulty;
  ui['wind-mode'].disabled = active;
  ui.difficulty.disabled = active;
  ui['heading-value'].textContent = compass(compassHeading(boat, scenario)).slice(0, -1);
  ui['tack-label'].textContent = `${boat.tack.toUpperCase()} TACK`;
  ui['tack-label'].className = `tack-label ${boat.tack}`;
  ui['true-wind'].textContent = compass(normalize(scenario.config.baseline + wind));
  ui['wind-shift'].textContent = `${wind >= 0 ? '+' : ''}${wind.toFixed(1)}°`;
  ui.elapsed.textContent = formatTime(boat.time);
  ui['distance-value'].textContent = boat.distance.toFixed(0);
  ui['tack-count'].textContent = boat.tacks;
  ui['speed-value'].textContent = stopped ? '0.0' : scenario.config.speedKnots.toFixed(1);
  ui.tack.disabled = !active || stopped;
  ui['tack-button-text'].textContent = stopped ? `Tacking · ${boat.penaltyRemaining.toFixed(1)} s` : 'Tack';
  ui.bear.disabled = !active || stopped || (boat.mode === 'close' && !canBearAway(boat, scenario));
  ui.bear.textContent = boat.mode === 'gate' ? 'Return close-hauled' : 'Bear away to gate';
  ui.start.disabled = state.phase === 'finished';
  ui.start.textContent = state.phase === 'sailing' ? 'Ⅱ Pause' : state.phase === 'paused' ? '▶ Resume' : '▶ Start sailing';
  ui['instrument-hint'].textContent = state.phase === 'ready'
    ? 'Start on starboard. Tack when you choose. Cross the dark gate right to left on starboard to finish.'
    : boat.mode === 'gate' ? 'Aiming at gate center whenever legal. If the wind closes the angle, the boat returns to close-hauled.'
      : 'The boat follows the wind automatically. You choose when to tack.';
  ui['reference-legend'].hidden = !state.benchmark?.route;
  ui['wind-history'].hidden = !state.showWind;
  ui['toggle-wind'].textContent = `${state.showWind ? 'Hide' : 'Show'} wind history`;
  ui['toggle-wind'].setAttribute('aria-expanded', String(state.showWind));
  ui['scenario-label'].textContent = `Scenario ${scenario.config.seed} · Fixed-step sailing model`;
  const course = courseView(state);
  ui.course.setAttribute('viewBox', course.viewBox);
  ui.course.setAttribute('aria-label', course.label);
  ui.course.innerHTML = course.markup;
  if (state.showWind) ui['wind-chart'].innerHTML = windHistoryView(scenario, boat.time);
  ui.results.hidden = state.phase !== 'finished';
  if (!ui.results.hidden) {
    const markup = resultsView(boat, state.benchmark, state.error);
    if (markup !== lastResults) { ui.results.innerHTML = markup; lastResults = markup; }
  }
  ui.error.hidden = !state.error || state.phase === 'finished';
  ui.error.textContent = state.error ?? '';
}

function startBenchmark() {
  if (benchmarkRevision === state.revision) return;
  benchmarkRevision = state.revision;
  const revision = state.revision;
  try {
    const current = new Worker(new URL('./optimizer.worker.js', import.meta.url), { type: 'module' });
    worker = current;
    const finish = (result, error) => {
      if (revision !== state.revision) return;
      state.benchmark = result ?? null;
      state.error = error ?? null;
      current.terminate();
      if (worker === current) worker = null;
      render();
    };
    current.onmessage = event => finish(event.data.result, event.data.error);
    current.onerror = event => finish(null, event.message || 'Background optimizer failed.');
    current.postMessage({ scenario: state.scenario, commands: state.commands, time: state.boat.time });
  } catch (error) {
    worker?.terminate(); worker = null;
    state.error = error.message;
    render();
  }
}

function animate(now) {
  frame = 0;
  const before = state.boat;
  trainer.tick((now - previousTime) / 1000, document.hidden);
  previousTime = now;
  if (state.boat !== before) render();
  if (state.phase === 'finished') startBenchmark();
  else if (state.phase === 'sailing') frame = requestAnimationFrame(animate);
}

function update() {
  render();
  if (state.phase === 'sailing' && !frame) {
    previousTime = performance.now();
    frame = requestAnimationFrame(animate);
  } else if (state.phase !== 'sailing' && frame) {
    cancelAnimationFrame(frame); frame = 0;
  }
}

function reset(config) {
  try {
    trainer.reset(config);
    worker?.terminate(); worker = null;
    lastResults = null;
    for (const input of ui['settings-form'].querySelectorAll('input[name]')) input.value = state.draft[input.name];
  } catch (error) { state.error = error.message; }
  update();
}

ui.start.addEventListener('click', () => { trainer.togglePause(); update(); });
ui.tack.addEventListener('click', () => { trainer.act('tack'); update(); });
ui.bear.addEventListener('click', () => { trainer.act(state.boat.mode === 'gate' ? 'close' : 'bear'); update(); });
ui['full-course'].addEventListener('click', () => { state.follow = false; update(); });
ui['follow-boat'].addEventListener('click', () => { state.follow = true; update(); });
ui['toggle-wind'].addEventListener('click', () => { state.showWind = !state.showWind; update(); });
ui.playback.addEventListener('change', () => { state.speed = Number(ui.playback.value); });
ui.retry.addEventListener('click', () => reset(state.scenario.config));
ui['new-wind'].addEventListener('click', () => reset({ ...state.draft, seed: crypto.getRandomValues(new Uint32Array(1))[0] }));
for (const [id, key] of [['wind-mode', 'windMode'], ['difficulty', 'difficulty']]) {
  ui[id].addEventListener('change', () => {
    state.draft = { ...state.draft, [key]: ui[id].value };
    if (state.phase === 'ready') reset(state.draft);
    else update();
  });
}
ui['settings-form'].addEventListener('input', event => {
  if (event.target.matches('input[name]')) state.draft = { ...state.draft, [event.target.name]: event.target.valueAsNumber };
});
ui['settings-form'].addEventListener('submit', event => { event.preventDefault(); reset(state.draft); });
window.addEventListener('keydown', event => {
  if (event.target.closest('input, select, button, summary, textarea, [contenteditable]') || event.repeat) return;
  if (event.code === 'Space') { event.preventDefault(); trainer.togglePause(); update(); }
  if (event.key.toLowerCase() === 't') { trainer.act('tack'); update(); }
});
window.addEventListener('pagehide', () => { worker?.terminate(); cancelAnimationFrame(frame); });
ui['startup-error'].hidden = true;
update();
