import { DEFAULT_TRAINER_CONFIG, STEP, validateConfig } from './engine/config.js';
import { advance, applyAction, initialBoat, sailingHeading } from './engine/physics.js';
import { windAtPosition } from './engine/wind.js';
import { signedAngle } from './engine/geometry.js';
import { createScenario } from './engine/wind.js';
import { createLiveComputer, advanceLiveComputer } from './engine/live-computer.js';
import { courseSettings } from './engine/course-config.js';

// Rendering-free player lifecycle; the browser only supplies elapsed wall time.
export function createTrainer(config = DEFAULT_TRAINER_CONFIG) {
  config = courseSettings({ ...DEFAULT_TRAINER_CONFIG, ...config });
  const state = {
    scenario: createScenario(config), draft: { ...config }, phase: 'ready',
    boat: initialBoat(), track: [initialBoat()], commands: [],
    follow: false, showWind: true, windDisplay: 'streaks', speed: 4, benchmark: null, error: null,
    accumulator: 0, revision: 0, showReference: false, laylineMode: 'wind-only',
    computer: createLiveComputer(), raceTime: 0, computerPaused: false, inspection: null,
  };

  function reset(nextConfig) {
    nextConfig = courseSettings({ ...DEFAULT_TRAINER_CONFIG, ...nextConfig });
    validateConfig(nextConfig);
    Object.assign(state, {
      scenario: createScenario(nextConfig), draft: { ...nextConfig }, phase: 'ready',
      boat: initialBoat(), track: [initialBoat()], commands: [],
      benchmark: null, error: null, accumulator: 0, revision: state.revision + 1, showReference: false,
      computer: createLiveComputer(), raceTime: 0, computerPaused: false, inspection: null,
    });
  }

  function togglePause() {
    if (state.inspection) return;
    if (state.phase === 'finished') {
      if (state.scenario.config.opponentMode !== 'solo' && !state.computer.boat.finished && state.computer.status !== 'timed-out') state.computerPaused = !state.computerPaused;
      return;
    }
    if (state.phase !== 'finished') state.phase = state.phase === 'sailing' ? 'paused' : 'sailing';
  }

  function act(action) {
    if (state.phase !== 'sailing' && state.phase !== 'paused') return;
    const next = applyAction(state.boat, action, state.scenario);
    if (next === state.boat) return;
    state.commands.push({ time: state.boat.time, action });
    state.boat = next;
  }

  function tick(elapsed, hidden = false) {
    const computerActive = () => state.scenario.config.opponentMode !== 'solo' && !state.computer.boat.finished && state.computer.status !== 'timed-out';
    const running = () => state.phase === 'sailing' || (state.phase === 'finished' && !state.computerPaused && computerActive());
    if (!running() || hidden) return;
    state.accumulator += Math.max(0, Math.min(elapsed, 0.2)) * state.speed;
    while (state.accumulator >= STEP && running()) {
      if (!state.boat.finished) state.boat = advance(state.boat, state.scenario);
      if (state.scenario.config.opponentMode !== 'solo') advanceLiveComputer(state.computer, state.scenario, STEP);
      state.raceTime += STEP;
      state.accumulator -= STEP;
      const last = state.track[state.track.length - 1];
      if (last !== state.boat && (state.boat.time - last.time >= 1 || state.boat.finished)) state.track.push(state.boat);
      if (state.boat.finished) state.phase = 'finished';
    }
    if (state.boat.finished) state.phase = 'finished';
  }

  function steer(degrees) {
    if (state.phase !== 'sailing') return;
    const boat = state.boat, scenario = state.scenario;
    const wind = windAtPosition(scenario, boat.position.x, boat.position.y, boat.time);
    const angle = boat.mode === 'manual' ? boat.targetAngle : Math.abs(signedAngle(sailingHeading(boat, scenario) - wind));
    act({ type: 'steer', angle: angle + degrees * (boat.tack === 'starboard' ? -1 : 1) });
  }
  return { state, reset, togglePause, act, tick, steer };
}
