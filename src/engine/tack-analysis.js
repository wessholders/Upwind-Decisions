import { STEP } from './config.js';
import { applyAction, advance, sailingHeading, settledHeading, sailingSpeedKnots } from './physics.js';
import { replay } from './race.js';
import { direction, signedAngle, normalize } from './geometry.js';
import { windSampleAtPosition } from './wind.js';
import { gateEnd } from './finish.js';
import { performanceTarget } from './performance.js';

export const TACK_COMPARISON_DELAY = 10;
export const MAX_FINISH_COMPARISONS = 8;

export function stateBeforeCommand(scenario, route, commandIndex) {
  const command = route.commands[commandIndex], prefix = route.commands.slice(0, commandIndex);
  let boat = replay(scenario, prefix, command.time).finish;
  // replay(until) stops before commands exactly at the endpoint. Preserve
  // earlier commands at this same timestamp, in their original order.
  for (const earlier of prefix) if (Math.abs(earlier.time - command.time) < 1e-8) boat = applyAction(boat, earlier.action, scenario);
  return { boat, prefix };
}

function distanceToGate(boat, scenario) {
  if (boat.finished) return 0;
  const a = { x: 0, y: scenario.config.courseLength }, b = gateEnd(scenario, boat.time);
  const dx = b.x - a.x, dy = b.y - a.y;
  const u = Math.max(0, Math.min(1, ((boat.position.x - a.x) * dx + (boat.position.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(boat.position.x - a.x - u * dx, boat.position.y - a.y - u * dy);
}

// Two controlled short projections from the identical decision state. Neither
// changes tack again or steers differently during this observation window.
// These describe local tradeoffs; they are not full optimized continuations.
export function traceTackOption(scenario, before, tackNow, duration = 30) {
  let boat = tackNow ? applyAction(before, 'tack', scenario) : before;
  const startDistance = boat.distance, startPenalty = boat.penaltyTime;
  const endTime = before.time + duration;
  let windIntegral = 0, puffSeconds = 0, pocketSeconds = 0;
  while (boat.time < endTime - 1e-9 && !boat.finished) {
    const dt = Math.min(STEP, endTime - boat.time), next = advance(boat, scenario, dt);
    const actual = next.time - boat.time;
    const middle = advance(boat, scenario, actual / 2);
    const wind = windSampleAtPosition(scenario, middle.position.x, middle.position.y, middle.time);
    windIntegral += wind.speedKnots * actual;
    if (wind.kind === 'puff') puffSeconds += actual * wind.influence;
    if (wind.kind === 'pocket') pocketSeconds += actual * wind.influence;
    boat = next;
  }
  const elapsed = boat.time - before.time, turning = boat.penaltyTime - startPenalty;
  return { elapsed, position: { ...boat.position }, finished: boat.finished,
    averageWindKnots: elapsed > 0 ? windIntegral / elapsed : null,
    movingSeconds: elapsed, penaltySeconds: turning,
    distance: boat.distance - startDistance, upCourseMeters: boat.position.y - before.position.y,
    gateDistance: distanceToGate(boat, scenario), puffSeconds, pocketSeconds };
}

export function describeTack(scenario, route, commandIndex, number, decision, comparison) {
  const before = decision.boat, tacked = applyAction(before, 'tack', scenario);
  const wind = windSampleAtPosition(scenario, before.position.x, before.position.y, before.time);
  const oldHeading = sailingHeading(before, scenario), newHeading = settledHeading(tacked, scenario);
  const speed = sailingSpeedKnots(before, scenario);
  const previous = route.points.findLast(p => p.time <= Math.max(0, before.time - 15) + 1e-8) || route.points[0];
  const interveningTack = route.commands.some(c => c.action === 'tack' && c.time > previous.time + 1e-8 && c.time < before.time - 1e-8);
  const change = signedAngle(wind.direction - windSampleAtPosition(scenario, previous.position.x, previous.position.y, previous.time).direction);
  const oldTackLift = change * (before.tack === 'starboard' ? 1 : -1);
  const trend = before.time - previous.time < 2 || previous.tack !== before.tack || interveningTack
    ? 'unavailable' : oldTackLift > 2 ? 'lift' : oldTackLift < -2 ? 'header' : 'steady';
  const duration = Math.min(30, Math.max(0, route.finish.time - before.time));
  const now = traceTackOption(scenario, before, true, duration);
  const hold = traceTackOption(scenario, before, false, duration);
  const difference = comparison.continuedTime === null ? null : comparison.continuedTime - route.finish.time;
  return { ...comparison, number, time: before.time, chosenTime: route.finish.time, boat: before,
    fromTack: before.tack, toTack: tacked.tack, wind: { ...wind, compassDirection: normalize(wind.direction + scenario.config.baseline) },
    oldHeading: normalize(oldHeading + scenario.config.baseline), newHeading: normalize(newHeading + scenario.config.baseline),
    oldUpCourseKnots: speed * direction(oldHeading).y,
    newUpCourseKnots: performanceTarget(scenario.config, newHeading, wind) * direction(newHeading).y,
    observedWindChange: change, observationSeconds: before.time - previous.time, trend,
    finalTack: !route.commands.slice(commandIndex + 1).some(c => c.action === 'tack'),
    projectionSeconds: duration, tackNow: now, keepGoing: hold, finishDifference: difference,
    outcome: !comparison.checked ? 'unchecked' : difference === null ? 'unresolved'
      : Math.abs(difference) <= 0.5 ? 'near-tie' : difference > 0 ? 'reference-faster' : 'alternative-faster' };
}
