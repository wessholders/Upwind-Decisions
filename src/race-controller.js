import { DEFAULT_TRAINER_CONFIG, STEP, validateConfig } from './engine/config.js';
import { advance, applyAction, initialBoat, sailingHeading } from './engine/physics.js';
import { windAtPosition } from './engine/wind.js';
import { signedAngle } from './engine/geometry.js';
import { createScenario } from './engine/wind.js';
import { createLiveComputer } from './engine/live-computer.js';
import { courseSettings } from './engine/course-config.js';
import { createFleetDescriptor, instantiateFleet, requestedNpcCount, fleetIsActive, advanceFleet, raceEntrants, raceStandings } from './engine/race-fleet.js';

// Rendering-free player lifecycle; the browser only supplies elapsed wall time.
export function createTrainer(config = DEFAULT_TRAINER_CONFIG, npcConfiguration = {}) {
  config = courseSettings({ ...DEFAULT_TRAINER_CONFIG, ...config });
  function opponents(next, previous = npcConfiguration) {
    const count = requestedNpcCount(next);
    if (next.npcCount !== undefined) {
      const fleet = instantiateFleet(createFleetDescriptor(next));
      return { fleet, npcs: fleet.npcs, computer: fleet.npcs[0] ?? createLiveComputer(previous) };
    }
    const computer = createLiveComputer(previous);
    return { fleet: null, npcs: count ? [computer] : [], computer };
  }
  const state = {
    scenario: createScenario(config), draft: { ...config }, phase: 'ready',
    boat: initialBoat(), track: [initialBoat()], commands: [],
    follow: false, showWind: true, windDisplay: 'streaks', speed: 4, benchmark: null, error: null,
    accumulator: 0, revision: 0, showReference: false, laylineMode: 'wind-only',
    ...opponents(config), raceTime: 0, computerPaused: false, inspection: null, standings: [],
  };
  const updateStandings = () => { state.standings = raceStandings(state.scenario, raceEntrants(state), state.raceTime); };
  updateStandings();

  function reset(nextConfig) {
    nextConfig = courseSettings({ ...DEFAULT_TRAINER_CONFIG, ...nextConfig });
    validateConfig(nextConfig);
    const nextOpponents = opponents(nextConfig, state.computer.configuration);
    Object.assign(state, {
      scenario: createScenario(nextConfig), draft: { ...nextConfig }, phase: 'ready',
      boat: initialBoat(), track: [initialBoat()], commands: [],
      benchmark: null, error: null, accumulator: 0, revision: state.revision + 1, showReference: false,
      ...nextOpponents, raceTime: 0, computerPaused: false, inspection: null,
    });
    updateStandings();
  }

  function togglePause() {
    if (state.inspection) return;
    if (state.phase === 'finished') {
      if (fleetIsActive(state)) state.computerPaused = !state.computerPaused;
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
    const computerActive = () => fleetIsActive(state);
    const running = () => state.phase === 'sailing' || (state.phase === 'finished' && !state.computerPaused && computerActive());
    if (!running() || hidden) return;
    state.accumulator += Math.max(0, Math.min(elapsed, 0.2)) * state.speed;
    while (state.accumulator >= STEP && running()) {
      if (!state.boat.finished) state.boat = advance(state.boat, state.scenario);
      advanceFleet(state.npcs, state.scenario, STEP);
      state.raceTime += STEP;
      state.accumulator -= STEP;
      const last = state.track[state.track.length - 1];
      if (last !== state.boat && (state.boat.time - last.time >= 1 || state.boat.finished)) state.track.push(state.boat);
      if (state.boat.finished) state.phase = 'finished';
      updateStandings();
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
