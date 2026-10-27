import { createTrainer } from './race-controller.js';
import { DEFAULT_CONFIG } from './engine/config.js';
import { normalize } from './engine/geometry.js';
import { compassHeading, sailingSpeedKnots } from './engine/physics.js';
import { recoveryRemaining } from './engine/tack.js';
import { formatTime } from './engine/scoring.js';
import { windAtPosition, windSampleAtPosition } from './engine/wind.js';
import { courseView } from './views/course.js';
import { windHistoryView } from './views/wind-history.js';
import { resultsView } from './views/results.js';
import { drawWindCanvas } from './views/wind-canvas.js';
import { RaceWindLayer } from './views/organic-wind.js';
import { computerLogView } from './views/computer.js';
import { bearControlView } from './views/bear-control.js';

const trainer = createTrainer();
const { state } = trainer;
const ids = ['startup-error', 'wind-mode', 'difficulty', 'wind-field', 'favored-side', 'wind-display', 'wind-vectors', 'wind-canvas', 'local-wind-speed', 'wind-pressure', 'organic-settings', 'wind-legend', 'traveling-demo', 'status-dot', 'status', 'full-course', 'follow-boat', 'course', 'reference-legend', 'heading-value', 'tack-label', 'true-wind', 'wind-shift', 'elapsed', 'distance-value', 'tack-count', 'speed-value', 'tack', 'tack-button-text', 'bear', 'bear-status', 'start', 'playback', 'instrument-hint', 'new-wind', 'retry', 'toggle-wind', 'results', 'error', 'wind-history', 'wind-chart', 'settings-form', 'scenario-label', 'computer-state', 'computer-reason', 'computer-log', 'inspection-banner', 'inspection-label', 'inspection-return', 'wind-time'];
const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let frame = 0;
let previousTime = 0;
let worker = null;
let benchmarkRevision = -1;
let lastResults = null;
let lastComputerLogLength = -1;
const organicWind = new RaceWindLayer();

const compass = degrees => `${(Math.round(degrees) % 360).toString().padStart(3, '0')}°`;
const computerActive = () => state.computer.status !== 'timed-out' && !state.computer.boat.finished;
const displayedTime = () => state.inspection?.time ?? state.raceTime;
const needsAnimation = () => !state.inspection && (state.phase === 'sailing' || (state.phase === 'ready' && state.scenario.organicWind) ||
  (state.phase === 'finished' && !state.computerPaused && computerActive()));

function drawWaterWind(elapsed = 0) {
  if (state.windDisplay === 'hidden') return;
  const style = getComputedStyle(ui.course);
  const metrics = {
    width: ui.course.clientWidth, height: ui.course.clientHeight,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    padding: { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) },
  };
  if (state.scenario.organicWind) organicWind.draw(ui['wind-canvas'], state.scenario, displayedTime(),
    ui.course.getAttribute('viewBox'), state.windDisplay, metrics, elapsed, ui['wind-vectors'].checked, state.inspection?.number ?? null);
  else drawWindCanvas(ui['wind-canvas'], state.scenario, displayedTime(), ui.course.getAttribute('viewBox'), state.windDisplay, metrics);
}

function render(includeWind = true) {
  const { boat, scenario } = state;
  const viewedBoat = state.inspection?.boat ?? boat, time = displayedTime();
  const active = state.phase === 'sailing' || state.phase === 'paused';
  const turning = boat.penaltyRemaining > 1e-8;
  const recovering = recoveryRemaining(boat.tackManeuver, boat.time) > 1e-8;
  const wind = windAtPosition(scenario, viewedBoat.position.x, viewedBoat.position.y, time);
  const local = windSampleAtPosition(scenario, viewedBoat.position.x, viewedBoat.position.y, time);
  ui.status.textContent = state.inspection ? `REFERENCE TACK ${state.inspection.number}` : state.phase === 'ready' ? 'READY TO SAIL' : state.phase === 'finished' ? 'LEG COMPLETE' : state.phase.toUpperCase();
  ui['status-dot'].classList.toggle('live', state.phase === 'sailing');
  for (const [id, selected] of [['full-course', !state.follow], ['follow-boat', state.follow]]) ui[id].setAttribute('aria-pressed', String(selected));
  ui['wind-mode'].value = state.draft.windMode;
  ui.difficulty.value = state.draft.difficulty;
  ui['wind-field'].value = state.draft.windField;
  ui['favored-side'].value = state.draft.favoredSide;
  ui['wind-mode'].disabled = active;
  ui.difficulty.disabled = active;
  ui['wind-field'].disabled = active;
  ui['favored-side'].disabled = active || !scenario.organicWind;
  ui['organic-settings'].hidden = !scenario.organicWind;
  ui['wind-legend'].hidden = !scenario.organicWind || state.windDisplay === 'hidden';
  ui['wind-vectors'].disabled = !scenario.organicWind;
  ui['wind-display'].value = state.windDisplay;
  ui['wind-canvas'].hidden = state.windDisplay === 'hidden';
  ui['heading-value'].textContent = compass(compassHeading({ ...viewedBoat, time }, scenario)).slice(0, -1);
  ui['tack-label'].textContent = `${viewedBoat.tack.toUpperCase()} TACK`;
  ui['tack-label'].className = `tack-label ${viewedBoat.tack}`;
  ui['true-wind'].textContent = compass(normalize(scenario.config.baseline + wind));
  ui['wind-shift'].textContent = `${wind >= 0 ? '+' : ''}${wind.toFixed(1)}°`;
  ui['local-wind-speed'].textContent = `${local.speedKnots.toFixed(1)} kn`;
  ui['wind-pressure'].textContent = local.kind === 'puff' ? 'STRONG PUFF' : local.kind === 'pocket' ? 'LIGHT-AIR POCKET' : 'BACKGROUND';
  ui.elapsed.textContent = formatTime(viewedBoat.time);
  ui['distance-value'].textContent = viewedBoat.distance.toFixed(0);
  ui['tack-count'].textContent = viewedBoat.tacks;
  ui['speed-value'].textContent = viewedBoat.finished ? '0.0' : sailingSpeedKnots({ ...viewedBoat, time }, scenario).toFixed(1);
  ui.tack.disabled = !active || recovering;
  ui['tack-button-text'].textContent = turning ? `Tacking · ${boat.penaltyRemaining.toFixed(1)} s`
    : recovering ? `Recovering · ${recoveryRemaining(boat.tackManeuver, boat.time).toFixed(1)} s` : 'Tack';
  const bear = bearControlView(state);
  ui.bear.disabled = bear.disabled; ui.bear.textContent = bear.label;
  ui.bear.setAttribute('aria-pressed', String(bear.pressed)); ui.bear.dataset.state = bear.state;
  ui['bear-status'].textContent = bear.description; ui['bear-status'].dataset.state = bear.state;
  ui.start.disabled = Boolean(state.inspection) || (state.phase === 'finished' && !computerActive());
  ui.start.textContent = state.phase === 'finished' ? (state.computerPaused ? '▶ Resume computer' : computerActive() ? 'Ⅱ Pause computer' : 'Leg complete') : state.phase === 'sailing' ? 'Ⅱ Pause' : state.phase === 'paused' ? '▶ Resume' : '▶ Start sailing';
  ui['instrument-hint'].textContent = state.inspection ? `Viewing the reference just before tack ${state.inspection.number}. The field and instruments show that decision's time and location.` : state.phase === 'ready'
    ? 'Start on starboard. Tack when you choose. Cross the dark gate right to left on starboard to finish.'
    : boat.mode === 'gate' ? 'Aim close to the windward mark, leaving it to port on the finish approach. Steering respects hull clearance and the no-go angle; a tack cancels mark aiming.'
      : 'The boat follows the wind automatically. You choose when to tack.';
  ui['reference-legend'].hidden = !state.benchmark?.route;
  ui['wind-history'].hidden = !state.showWind;
  ui['toggle-wind'].textContent = `${state.showWind ? 'Hide' : 'Show'} wind history`;
  ui['toggle-wind'].setAttribute('aria-expanded', String(state.showWind));
  ui['scenario-label'].textContent = `Scenario ${scenario.config.seed} · Fixed-step sailing model`;
  ui['wind-time'].textContent = `Wind at ${formatTime(time)}${state.inspection ? ` (${time.toFixed(1)} s)` : ''}`;
  ui['inspection-banner'].hidden = !state.inspection;
  if (state.inspection) ui['inspection-label'].textContent = `Reference tack ${state.inspection.number} · ${formatTime(time)} · ${state.inspection.fromTack} → ${state.inspection.toTack}`;
  const computer = state.computer;
  ui['computer-state'].textContent = computer.boat.finished ? `Finished ${formatTime(computer.boat.time)}` : computer.status === 'timed-out' ? 'Race limit reached' : state.phase === 'ready' ? 'Ready to race' : `${formatTime(computer.boat.time)} · ${computer.boat.tack} · ${computer.boat.penaltyRemaining > 0 ? 'tacking' : sailingSpeedKnots(computer.boat, scenario).toFixed(1) + ' kn'}`;
  ui['computer-reason'].textContent = computer.latestReason;
  if (computer.decisions.length !== lastComputerLogLength) {
    ui['computer-log'].innerHTML = computerLogView(computer); lastComputerLogLength = computer.decisions.length;
  }
  const course = courseView({ ...state, boat: viewedBoat, displayTime: time });
  ui.course.setAttribute('viewBox', course.viewBox);
  ui.course.setAttribute('aria-label', course.label);
  ui.course.innerHTML = course.markup;
  if (includeWind) drawWaterWind();
  if (state.showWind) ui['wind-chart'].innerHTML = windHistoryView(scenario, viewedBoat.time, [...(state.inspection ? state.benchmark.route.points : state.track), viewedBoat]);
  ui.results.hidden = state.phase !== 'finished';
  if (!ui.results.hidden) {
    const markup = resultsView(boat, state.benchmark, state.error, state.computer);
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
    current.postMessage({ scenario: state.scenario, commands: state.commands, time: state.boat.time,
      computer: state.computer.boat.finished ? { commands: state.computer.commands, time: state.computer.boat.time } : null });
  } catch (error) {
    worker?.terminate(); worker = null;
    state.error = error.message;
    render();
  }
}

function animate(now) {
  frame = 0;
  const before = state.boat;
  const beforeComputer = state.computer.boat;
  const elapsed = Math.min(0.2, Math.max(0, (now - previousTime) / 1000));
  trainer.tick(elapsed, document.hidden);
  previousTime = now;
  if (state.boat !== before || state.computer.boat !== beforeComputer) render(false);
  if (state.scenario.organicWind || state.boat !== before || state.computer.boat !== beforeComputer)
    drawWaterWind(!document.hidden && needsAnimation() ? elapsed : 0);
  if (state.phase === 'finished') startBenchmark();
  if (needsAnimation()) frame = requestAnimationFrame(animate);
}

function update() {
  render();
  const animating = needsAnimation();
  if (animating && !frame) {
    previousTime = performance.now();
    frame = requestAnimationFrame(animate);
  } else if (!animating && frame) {
    cancelAnimationFrame(frame); frame = 0;
  }
}

function reset(config) {
  try {
    trainer.reset(config);
    worker?.terminate(); worker = null;
    lastResults = null;
    lastComputerLogLength = -1;
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
ui['wind-display'].addEventListener('change', () => { state.windDisplay = ui['wind-display'].value; update(); });
ui['wind-vectors'].addEventListener('change', update);
function inspectTack(number) {
  const comparison = state.benchmark?.comparisons.find(c => c.number === number);
  if (state.phase !== 'finished' || !comparison) return;
  const wasComputerPaused = state.inspection?.wasComputerPaused ?? state.computerPaused;
  state.inspection = { ...comparison, wasComputerPaused }; state.computerPaused = true;
  update(); ui['inspection-banner'].scrollIntoView({ block: 'nearest' });
}
ui.results.addEventListener('click', event => { const button = event.target.closest('[data-inspect-tack]'); if (button) inspectTack(Number(button.dataset.inspectTack)); });
ui.course.addEventListener('click', event => { const marker = event.target.closest('[data-inspect-tack]'); if (marker) inspectTack(Number(marker.dataset.inspectTack)); });
ui.course.addEventListener('keydown', event => {
  const marker = event.target.closest('[data-inspect-tack]');
  if (marker && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); inspectTack(Number(marker.dataset.inspectTack)); }
});
ui['inspection-return'].addEventListener('click', () => {
  state.computerPaused = state.inspection?.wasComputerPaused ?? state.computerPaused;
  state.inspection = null; update();
});
ui.playback.addEventListener('change', () => { state.speed = Number(ui.playback.value); });
ui.retry.addEventListener('click', () => reset(state.scenario.config));
ui['new-wind'].addEventListener('click', () => reset({ ...state.draft, seed: crypto.getRandomValues(new Uint32Array(1))[0] }));
for (const [id, key] of [['wind-mode', 'windMode'], ['difficulty', 'difficulty'], ['wind-field', 'windField'], ['favored-side', 'favoredSide']]) {
  ui[id].addEventListener('change', () => {
    state.draft = { ...state.draft, [key]: ui[id].value };
    if (state.phase === 'ready') reset(state.draft);
    else update();
  });
}
ui['traveling-demo'].addEventListener('click', () => {
  state.speed = 8; ui.playback.value = '8';
  state.follow = false; state.windDisplay = 'boundaries';
  reset({ ...DEFAULT_CONFIG, courseLength: 300, windField: 'traveling', windMode: 'persistent', transitionWidth: 30, shiftStartTime: 10 });
});
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
new ResizeObserver(() => drawWaterWind()).observe(ui.course);
