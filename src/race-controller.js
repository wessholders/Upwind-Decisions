import { DEFAULT_CONFIG, STEP, validateConfig } from './engine/config.js';
import { advance, applyAction, initialBoat } from './engine/physics.js';
import { createScenario } from './engine/wind.js';

// Rendering-free player lifecycle; the browser only supplies elapsed wall time.
export function createTrainer(config = DEFAULT_CONFIG) {
  config = { ...DEFAULT_CONFIG, ...config };
  const state = {
    scenario: createScenario(config), draft: { ...config }, phase: 'ready',
    boat: initialBoat(), track: [initialBoat()], commands: [],
    follow: false, showWind: true, windDisplay: 'streaks', speed: 4, benchmark: null, error: null,
    accumulator: 0, revision: 0,
  };

  function reset(nextConfig) {
    nextConfig = { ...DEFAULT_CONFIG, ...nextConfig };
    validateConfig(nextConfig);
    Object.assign(state, {
      scenario: createScenario(nextConfig), draft: { ...nextConfig }, phase: 'ready',
      boat: initialBoat(), track: [initialBoat()], commands: [],
      benchmark: null, error: null, accumulator: 0, revision: state.revision + 1,
    });
  }

  function togglePause() {
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
    if (state.phase !== 'sailing' || hidden) return;
    state.accumulator += Math.max(0, Math.min(elapsed, 0.2)) * state.speed;
    while (state.accumulator >= STEP && !state.boat.finished) {
      state.boat = advance(state.boat, state.scenario);
      state.accumulator -= STEP;
      const last = state.track[state.track.length - 1];
      if (state.boat.time - last.time >= 1 || state.boat.finished) state.track.push(state.boat);
    }
    if (state.boat.finished) state.phase = 'finished';
  }

  return { state, reset, togglePause, act, tick };
}
