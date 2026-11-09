import { createPhysicsEnvironment } from './environment-provider.js';
import { advance, applyAction, initialBoat, gateAimGeometry } from './physics.js';
import { recoveryRemaining, turning } from './tack.js';
import { sampleObservedMap } from './npc-observation.js';
import { copyNpcData } from './npc-data.js';
import { dot, subtract } from './geometry.js';
import { STEP } from './config.js';
import { estimateRemainingTime } from './npc-route-eta.js';
import { courseGeometry } from './course.js';
import { createStrategyAccumulator, accumulateStrategy, finishStrategy } from './npc-strategy.js';

export class ForecastBudgetExceeded extends Error {}
export function createForecastBudget(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 6000) throw new Error('Forecast step limit must be 1–6000.');
  return { limit, used: 0 };
}

// The only provider used by this planner is constructed HERE from plain
// permitted observations. It has no live scenario, generator, or future API.
// Temporal-model extension point: frozen-present-v1 is the sole implementation.
export function createObservedEnvironment(observation, budget = createForecastBudget(6000)) {
  if (!observation.boat || !observation.publicConfig || !observation.perception ||
      observation.perception.profileId === 'legacy-v1') throw new Error('Restricted route observation required.');
  const environment = createPhysicsEnvironment(observation.publicConfig, {
    course: observation.gate,
    sample: (x, y) => sampleObservedMap(observation, { x, y }),
    beforeStep() {
      if (budget.used >= budget.limit) throw new ForecastBudgetExceeded('Deterministic forecast budget exhausted.');
      budget.used++;
    },
  });
  return environment;
}

export function routeNavigationAction(boat, environment) {
  if (turning(boat.tackManeuver, boat.time)) return null;
  const rounding = environment.config.courseMode !== 'finish-upwind';
  const aim = gateAimGeometry(boat, environment);
  if (rounding) {
    const required = environment.config.courseMode === 'round-starboard' ? 'port' : 'starboard';
    const sign = required === 'starboard' ? 1 : -1;
    if (boat.tack === required && aim.legal && sign * (aim.target.x - boat.position.x) < 0)
      return boat.mode === 'gate' ? null : 'bear';
    if (boat.tack !== required && recoveryRemaining(boat.tackManeuver, boat.time) <= 1e-9) {
      const other = gateAimGeometry({ ...boat, tack: required, mode: 'close', markAimDistance: null }, environment);
      if (other.legal && sign * (other.target.x - boat.position.x) < 0) return 'tack';
    }
  } else {
    const course = courseGeometry(environment);
    if (aim.legal && dot(subtract(aim.target, boat.position), course.up) > 1e-8)
      return boat.mode === 'gate' ? null : 'bear';
    if (!aim.legal && recoveryRemaining(boat.tackManeuver, boat.time) <= 1e-9) {
      const other = { ...boat, tack: boat.tack === 'starboard' ? 'port' : 'starboard' };
      const otherAim = gateAimGeometry(other, environment);
      if (otherAim.legal && dot(subtract(otherAim.target, boat.position), course.up) > 1e-8) return 'tack';
    }
  }
  return boat.mode === 'gate' && !aim.legal ? 'close' : null;
}

export function planAction(plan, boat) {
  if (turning(boat.tackManeuver, boat.time)) return 'hold';
  if (plan.tackAt !== null && boat.tack === plan.startTack && boat.time + 1e-8 >= plan.tackAt)
    return recoveryRemaining(boat.tackManeuver, boat.time) <= 1e-9 ? 'tack' : 'hold';
  if (plan.angle !== null && boat.tack === plan.startTack &&
      (boat.mode !== 'manual' || Math.abs(boat.targetAngle - plan.angle) > 1e-8))
    return { type: 'steer', angle: plan.angle };
  if (plan.postTackAngle !== undefined && plan.postTackAngle !== null && boat.tack !== plan.startTack &&
      (boat.mode !== 'manual' || Math.abs(boat.targetAngle - plan.postTackAngle) > 1e-8))
    return { type: 'steer', angle: plan.postTackAngle };
  return 'hold';
}

export function forecastPlan(observation, plan, settings, budget, collectStrategy = false) {
  if (!Number.isFinite(settings.horizonSeconds) || settings.horizonSeconds < 0 || settings.horizonSeconds > 90)
    throw new Error('Forecast horizon must be bounded to 90 seconds.');
  const environment = createObservedEnvironment(observation, budget);
  let boat = { ...initialBoat(), ...copyNpcData(observation.boat) };
  const start = boat, endTime = boat.time + settings.horizonSeconds, before = budget.used;
  const accumulator = collectStrategy ? createStrategyAccumulator(observation) : null;
  let navigationTaken = false, exhausted = false, nextNavigation = boat.time;
  try {
    while (!boat.finished && boat.time < endTime - 1e-9) {
      // Navigation decisions have the sailor's cadence, not the physics rate.
      // The integrator still refreshes an armed approach at every physical step.
      const navigation = boat.time + 1e-8 >= nextNavigation ? routeNavigationAction(boat, environment) : null;
      if (boat.time + 1e-8 >= nextNavigation) nextNavigation = boat.time + settings.decisionIntervalSeconds;
      if (navigation) { boat = applyAction(boat, navigation, environment); navigationTaken = true; }
      else if (!navigationTaken) boat = applyAction(boat, planAction(plan, boat), environment);
      const nextTack = !navigationTaken && plan.tackAt !== null && plan.tackAt > boat.time + 1e-8 ? plan.tackAt : Infinity;
      const previous = boat;
      boat = advance(boat, environment, Math.min(STEP, endTime - boat.time, nextTack - boat.time, nextNavigation - boat.time));
      if (accumulator) accumulateStrategy(accumulator, observation, previous, boat, navigationTaken);
    }
  } catch (error) {
    if (!(error instanceof ForecastBudgetExceeded)) throw error;
    exhausted = true;
  }
  const terminal = exhausted ? { seconds: null, reachable: false, futureTacks: null } : estimateRemainingTime(observation, boat);
  return { plan, boat, elapsed: boat.time - start.time, steps: budget.used - before, exhausted,
    estimatedSeconds: terminal.seconds === null ? null : boat.time - start.time + terminal.seconds,
    terminal, progressMeters: dot(subtract(boat.position, start.position), observation.gate.up),
    ...(accumulator ? { features: finishStrategy(accumulator, boat.tacks - start.tacks, terminal.futureTacks) } : {}) };
}

// Controlled forecast API for parity tests and offline analysis. Command timing
// is identical to replay(): split integration at exact command timestamps.
export function forecastActions(observation, commands, duration, limit = 6000) {
  if (!Number.isFinite(duration) || duration < 0 || duration > 90) throw new Error('Invalid forecast duration.');
  const budget = createForecastBudget(limit), environment = createObservedEnvironment(observation, budget);
  let boat = { ...initialBoat(), ...copyNpcData(observation.boat) }, index = 0;
  const end = boat.time + duration;
  if (commands.some((c, i) => !Number.isFinite(c.time) || c.time < boat.time || (i > 0 && c.time < commands[i - 1].time)))
    throw new Error('Forecast commands must have ordered simulation timestamps.');
  while (!boat.finished && boat.time < end - 1e-9) {
    while (index < commands.length && commands[index].time <= boat.time + 1e-8)
      boat = applyAction(boat, commands[index++].action, environment);
    boat = advance(boat, environment, Math.min(STEP, end - boat.time, (commands[index]?.time ?? Infinity) - boat.time));
  }
  return { boat, steps: budget.used, model: 'frozen-present-v1' };
}
