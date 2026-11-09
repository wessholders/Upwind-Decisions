import { createTrainer } from './race-controller.js';
import { normalize } from './engine/geometry.js';
import { compassHeading, sailingSpeedKnots, boatGroundTelemetry } from './engine/physics.js';
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
import { courseRules, isUpwindFinish } from './engine/course-config.js';
import { createGameShell } from './game-shell.js';
import { bindSailingKeyboard } from './keyboard.js';
import { sailingHeading } from './engine/physics.js';
import { signedAngle } from './engine/geometry.js';
import { fleetIsActive } from './engine/race-fleet.js';
import { standingsView } from './views/standings.js';
import { escapeHtml } from './views/html.js';

const trainer = createTrainer();
const { state } = trainer;
const ids = ['startup-error', 'course-mode', 'wind-mode', 'difficulty', 'wind-field', 'favored-side', 'wind-display', 'wind-vectors', 'wind-canvas', 'local-wind-speed', 'wind-pressure', 'organic-settings', 'wind-legend', 'traveling-demo', 'status-dot', 'status', 'full-course', 'follow-boat', 'course', 'reference-legend', 'heading-value', 'tack-label', 'true-wind', 'wind-shift', 'elapsed', 'distance-value', 'tack-count', 'speed-value', 'tack', 'tack-button-text', 'bear', 'bear-status', 'start', 'playback', 'instrument-hint', 'new-wind', 'retry', 'toggle-wind', 'results', 'error', 'wind-history', 'wind-chart', 'settings-form', 'scenario-label', 'computer-state', 'computer-reason', 'computer-log', 'inspection-banner', 'inspection-label', 'inspection-return', 'wind-time'];
const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let frame = 0;
let previousTime = 0;
let worker = null;
let benchmarkRevision = -1;
let lastResults = null;
let lastComputerLogLength = -1;
let lastComputerId = null, lastStandings = '', lastRoster = '';
const organicWind = new RaceWindLayer();
let shell = null, keyboard = null;

const compass = degrees => `${(Math.round(degrees) % 360).toString().padStart(3, '0')}°`;
const computerActive = () => fleetIsActive(state);
const displayedTime = () => state.inspection?.time ?? state.raceTime;
const needsAnimation = () => shell?.screen === 'session' && !document.hidden && !state.inspection && (state.phase === 'sailing' ||
  (state.phase === 'finished' && !state.computerPaused && computerActive()));

function courseMetrics() {
  const style = getComputedStyle(ui.course);
  return {
    width: ui.course.clientWidth, height: ui.course.clientHeight,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    padding: { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) },
  };
}
function drawWaterWind(elapsed = 0) {
  if (state.windDisplay === 'hidden') return;
  const metrics = courseMetrics();
  if (state.scenario.organicWind) organicWind.draw(ui['wind-canvas'], state.scenario, displayedTime(),
    ui.course.getAttribute('viewBox'), state.windDisplay, metrics, elapsed, ui['wind-vectors'].checked, state.inspection?.number ?? null);
  else drawWindCanvas(ui['wind-canvas'], state.scenario, displayedTime(), ui.course.getAttribute('viewBox'), state.windDisplay, metrics);
}

function render(includeWind = true) {
  if (shell && shell.screen !== 'session') return;
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
  const current = scenario.config.current;
  document.getElementById('current-indicator').hidden = !current?.enabled;
  if (current?.enabled) {
    document.getElementById('current-value').textContent = `${current.speedKnots.toFixed(1)} kn · ${compass(current.directionDegrees)}`;
    document.getElementById('current-arrow').setAttribute('transform', `rotate(${current.directionDegrees - scenario.config.baseline} 12 12)`);
    const ground = boatGroundTelemetry(viewedBoat, scenario, viewedBoat.finished ? viewedBoat.time : time);
    document.getElementById('ground-motion').textContent = `${viewedBoat.finished ? 'At finish · ' : ''}SOG ${ground.speedKnots.toFixed(1)} kn · COG ${ground.courseDegrees === null ? '—' : compass(ground.courseDegrees)}`;
  }
  document.getElementById('layline-mode').value = state.laylineMode;
  document.getElementById('sailing-angle').textContent = `${Math.abs(signedAngle(sailingHeading(viewedBoat, scenario, time) - wind)).toFixed(1)}°`;
  for (const id of ['steer-left', 'steer-right', 'close-haul']) document.getElementById(id).disabled = state.phase !== 'sailing' || turning;
  ui.tack.disabled = !active || recovering;
  ui['tack-button-text'].textContent = turning ? `Tacking · ${boat.penaltyRemaining.toFixed(1)} s`
    : recovering ? `Recovering · ${recoveryRemaining(boat.tackManeuver, boat.time).toFixed(1)} s` : 'Tack';
  const bear = bearControlView(state);
  ui.bear.disabled = bear.disabled; ui.bear.textContent = bear.label;
  ui.bear.setAttribute('aria-pressed', String(bear.pressed)); ui.bear.dataset.state = bear.state;
  ui['bear-status'].textContent = bear.description; ui['bear-status'].dataset.state = bear.state;
  ui.start.disabled = Boolean(state.inspection) || (state.phase === 'finished' && !computerActive());
  ui.start.textContent = state.phase === 'finished' ? (computerActive() ? state.computerPaused ? '▶ Resume NPCs' : 'Ⅱ Pause NPCs' : 'Leg complete') : state.phase === 'sailing' ? 'Ⅱ Pause / Menu' : state.phase === 'paused' ? '▶ Resume' : '▶ Start Race';
  const rules = courseRules(scenario.config), upwind = isUpwindFinish(scenario.config);
  ui['instrument-hint'].textContent = state.inspection ? `Viewing the reference just before tack ${state.inspection.number}. The field and instruments show that decision's time and location.` : state.phase === 'ready'
    ? upwind ? 'Cross the fixed finish line between the pins from downwind to upwind. Either tack may finish.'
      : `Start on starboard. Tack when you choose. Cross the dark gate ${rules.sign > 0 ? 'right to left' : 'left to right'} on ${rules.requiredTack} to finish.`
    : boat.mode === 'gate' ? upwind ? 'Aim for a legal crossing between the fixed finish pins. A tack cancels finish aiming.'
      : `Aim close to the windward mark, leaving it to ${rules.roundingSide} on the finish approach. Steering respects hull clearance and the no-go angle; a tack cancels mark aiming.`
      : 'Steer with ← / → or the buttons. The boat follows local wind. Manual steering cancels mark aiming.';
  const referenceVisible = state.showReference || Boolean(state.inspection);
  ui['reference-legend'].hidden = !state.benchmark?.route || !referenceVisible;
  const referenceToggle = document.getElementById('toggle-reference');
  referenceToggle.hidden = !state.benchmark?.route;
  referenceToggle.textContent = `${referenceVisible ? 'Hide' : 'Show'} Hindsight Reference`;
  referenceToggle.setAttribute('aria-pressed', String(referenceVisible));
  ui['wind-history'].hidden = !state.showWind;
  ui['toggle-wind'].textContent = `${state.showWind ? 'Hide' : 'Show'} wind history`;
  ui['toggle-wind'].setAttribute('aria-expanded', String(state.showWind));
  ui['scenario-label'].textContent = `Scenario ${scenario.config.seed} · Fixed-step sailing model`;
  ui['wind-time'].textContent = `Wind at ${formatTime(time)}${state.inspection ? ` (${time.toFixed(1)} s)` : ''}`;
  ui['inspection-banner'].hidden = !state.inspection;
  if (state.inspection) ui['inspection-label'].textContent = `Reference tack ${state.inspection.number} · ${formatTime(time)} · ${state.inspection.fromTack} → ${state.inspection.toTack}`;
  const selector = document.getElementById('npc-log-select');
  const roster = state.npcs.map(npc => `<option value="${escapeHtml(npc.configuration.id)}">${escapeHtml(npc.identity ? `${npc.identity.shortLabel} · ${npc.identity.tier}` : 'Live computer')}</option>`).join('');
  if (roster !== lastRoster) { selector.innerHTML = roster; lastRoster = roster; }
  const computer = state.npcs.find(npc => npc.configuration.id === selector.value) ?? state.computer;
  ui['computer-state'].textContent = state.npcs.length > 1 ? `${state.npcs.length} All-Rounders · ${state.npcs.filter(npc => npc.boat.finished).length} finished` : computer.boat.finished ? `Finished ${formatTime(computer.boat.time)}` : computer.status === 'timed-out' ? 'Race limit reached' : state.phase === 'ready' ? 'Ready to race' : `${formatTime(computer.boat.time)} · ${computer.boat.tack} · ${computer.boat.penaltyRemaining > 0 ? 'tacking' : sailingSpeedKnots(computer.boat, scenario).toFixed(1) + ' kn'}`;
  ui['computer-reason'].textContent = computer.latestReason;
  if (computer.decisions.length !== lastComputerLogLength || computer.configuration.id !== lastComputerId) {
    ui['computer-log'].innerHTML = computerLogView(computer); lastComputerLogLength = computer.decisions.length; lastComputerId = computer.configuration.id;
  }
  const solo = state.npcs.length === 0;
  document.getElementById('opponent-label').textContent = state.npcs.length > 1 ? 'NPC FLEET' : 'LIVE COMPUTER';
  document.getElementById('opponent-legend').textContent = state.npcs.length > 1 ? 'NPC fleet · AR labels' : 'Live computer';
  const standings = standingsView(state.standings);
  document.getElementById('fleet-standings').hidden = solo;
  if (standings !== lastStandings) { document.getElementById('standings-table').innerHTML = standings; lastStandings = standings; }
  document.querySelector('.computer-strip').hidden = solo;
  document.querySelector('.computer-decisions').hidden = solo;
  document.querySelector('.course-footer .purple').parentElement.hidden = solo;
  const course = courseView({ ...state, computer: solo ? null : state.computer, boat: viewedBoat, displayTime: time, viewport: courseMetrics() });
  ui.course.setAttribute('viewBox', course.viewBox);
  ui.course.setAttribute('aria-label', course.label);
  ui.course.innerHTML = course.markup;
  if (includeWind) drawWaterWind();
  if (state.showWind) ui['wind-chart'].innerHTML = windHistoryView(scenario, viewedBoat.time, [...(state.inspection ? state.benchmark.route.points : state.track), viewedBoat]);
  ui.results.hidden = state.phase !== 'finished';
  if (!ui.results.hidden) {
    const markup = resultsView(boat, state.benchmark, state.error, solo || state.fleet ? null : state.computer, referenceVisible);
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
      computer: !state.fleet && state.npcs.length && state.computer.boat.finished ? { commands: state.computer.commands, time: state.computer.boat.time } : null });
  } catch (error) {
    worker?.terminate(); worker = null;
    state.error = error.message;
    render();
  }
}

function animate(now) {
  frame = 0;
  const before = state.boat;
  const beforeRaceTime = state.raceTime;
  const elapsed = Math.min(0.2, Math.max(0, (now - previousTime) / 1000));
  keyboard?.tick(elapsed);
  shell?.tick(elapsed);
  trainer.tick(elapsed, document.hidden);
  previousTime = now;
  if (state.boat !== before || state.raceTime !== beforeRaceTime) render(false);
  if (state.scenario.organicWind || state.boat !== before || state.raceTime !== beforeRaceTime)
    drawWaterWind(!document.hidden && needsAnimation() ? elapsed : 0);
  if (state.phase === 'finished' && shell.screen === 'session') startBenchmark();
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

ui.start.addEventListener('click', () => {
  if (state.phase === 'ready' || state.phase === 'finished') {
    keyboard.clear(); trainer.togglePause(); update();
    document.getElementById('session-screen').focus({ preventScroll: true });
  } else shell.pauseMenu();
});
ui.tack.addEventListener('click', () => { trainer.act('tack'); update(); document.getElementById('session-screen').focus({ preventScroll: true }); });
ui.bear.addEventListener('click', () => { trainer.act(state.boat.mode === 'gate' ? 'close' : 'bear'); update(); document.getElementById('session-screen').focus({ preventScroll: true }); });
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
function returnFromInspection() {
  state.computerPaused = state.inspection?.wasComputerPaused ?? state.computerPaused;
  state.inspection = null;
}
ui['inspection-return'].addEventListener('click', () => { returnFromInspection(); update(); });
ui.playback.addEventListener('change', () => { state.speed = Number(ui.playback.value); });
document.getElementById('npc-log-select').addEventListener('change', update);
shell = createGameShell({ trainer, update, clearInput: () => keyboard?.clear(),
  launch(config) {
    trainer.reset(config);
    worker?.terminate(); worker = null; lastResults = null; lastComputerLogLength = -1; lastComputerId = null;
  },
  exit() {
    keyboard?.clear(); state.phase = 'paused'; state.computerPaused = true; state.inspection = null;
    worker?.terminate(); worker = null;
    cancelAnimationFrame(frame); frame = 0;
    // Invalidate late worker responses before any next launch.
    state.revision++;
  },
});
document.getElementById('toggle-reference').addEventListener('click', () => {
  const wasVisible = state.showReference || Boolean(state.inspection);
  if (state.inspection) returnFromInspection();
  state.showReference = !wasVisible;
  update();
});
keyboard = bindSailingKeyboard({ enabled: () => shell.screen === 'session' && !shell.modalOpen,
  steer: delta => trainer.steer(delta), tack: () => { trainer.act('tack'); update(); },
  pause: () => shell.pauseMenu(), menu: () => shell.pauseMenu() });
document.addEventListener('visibilitychange', () => { keyboard.clear(); update(); });
window.addEventListener('pagehide', () => { worker?.terminate(); cancelAnimationFrame(frame); keyboard.clear(); });
window.addEventListener('pageshow', update);
ui['startup-error'].hidden = true;
update();
new ResizeObserver(() => {
  if (shell.screen !== 'session') return;
  // The SVG transform resizes itself; the new guides' world-space clip must
  // also follow the visible viewport, including when the race is paused.
  if (isUpwindFinish(state.scenario.config)) render();
  else drawWaterWind();
}).observe(ui.course);
