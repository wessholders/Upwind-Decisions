import { advance, applyAction, initialBoat, sailingHeading, sailingSpeedKnots } from './physics.js';
import { createTack, turning, recoveryRemaining, turnHeading, maneuverSpeed, tackSpeedCost } from './tack.js';
import { windSampleAtPosition } from './wind.js';
import { gateEnd } from './finish.js';
import { direction, dot, radians, signedAngle, closestMarkApproach, markApproachClearance, markContactClearance, distanceToSegment } from './geometry.js';
import { KNOT_TO_MPS, EXPERT_TACK, STEP } from './config.js';
import { performanceTarget, performanceSpeed, speedResponse, usesPolar, referenceSpeedKnots } from './performance.js';

const DECISION_INTERVAL = 2;
const FORECAST_SECONDS = 60;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// This adapter alone can access the simulation. Every wind query is explicitly
// at NOW. It returns plain observations: no seed, scenario, generator, future
// sample callback, feature lifetime, spawn schedule, or target wind sequence.
export function observeCurrentWind(scenario, boat) {
  const c = scenario.config, margin = c.courseLength * 0.08;
  const extent = Math.max(c.courseLength * 0.58, Math.abs(boat.position.x) + margin);
  const bounds = { minX: -extent, maxX: extent, minY: Math.min(-margin, boat.position.y - margin),
    maxY: Math.max(c.courseLength + c.boatLength * c.gateBoatLengths + margin, boat.position.y + margin) };
  const cols = 17, rows = 21, cells = [];
  for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < cols; ix++) {
    const wind = windSampleAtPosition(scenario, bounds.minX + ix / (cols - 1) * (bounds.maxX - bounds.minX),
      bounds.minY + iy / (rows - 1) * (bounds.maxY - bounds.minY), boat.time);
    cells.push({ vx: wind.vx, vy: wind.vy });
  }
  const wind = windSampleAtPosition(scenario, boat.position.x, boat.position.y, boat.time);
  return { time: boat.time, position: { ...boat.position }, tack: boat.tack, mode: boat.mode,
    markAimDistance: boat.markAimDistance ?? null,
    tackManeuver: boat.tackManeuver ? { ...boat.tackManeuver } : null,
    heading: sailingHeading(boat, scenario), speedKnots: sailingSpeedKnots(boat, scenario),
    penaltyRemaining: boat.penaltyRemaining, wind: { direction: wind.direction, speedKnots: wind.speedKnots, kind: wind.kind },
    gate: { start: { x: 0, y: c.courseLength }, end: gateEnd(scenario, boat.time) },
    minAngle: c.minAngle, tackPenalty: c.tackPenalty,
    tackMinSpeedFraction: c.tackMinSpeedFraction, tackRecoverySeconds: c.tackRecoverySeconds,
    performance: { performanceModel: c.performanceModel, boatProfile: c.boatProfile, speedScale: c.speedScale,
      minAngle: c.minAngle, windField: c.windField, speedKnots: c.speedKnots,
      backgroundWindKnots: c.backgroundWindKnots, pressureExponent: c.pressureExponent },
    boatLength: c.boatLength,
    map: { bounds, cols, rows, cells } };
}

export function sampleObservedMap(observation, position) {
  const { bounds: b, cols, rows, cells } = observation.map;
  const x = clamp((position.x - b.minX) / (b.maxX - b.minX) * (cols - 1), 0, cols - 1);
  const y = clamp((position.y - b.minY) / (b.maxY - b.minY) * (rows - 1), 0, rows - 1);
  const ix = Math.min(cols - 2, Math.floor(x)), iy = Math.min(rows - 2, Math.floor(y)), u = x - ix, v = y - iy;
  const a = cells[iy * cols + ix], c = cells[(iy + 1) * cols + ix], d = cells[(iy + 1) * cols + ix + 1], e = cells[iy * cols + ix + 1];
  const vx = a.vx * (1 - u) * (1 - v) + e.vx * u * (1 - v) + c.vx * (1 - u) * v + d.vx * u * v;
  const vy = a.vy * (1 - u) * (1 - v) + e.vy * u * (1 - v) + c.vy * (1 - u) * v + d.vy * u * v;
  return { direction: Math.atan2(-vx, -vy) * 180 / Math.PI, speedKnots: Math.hypot(vx, vy) / KNOT_TO_MPS };
}

const otherTack = tack => tack === 'starboard' ? 'port' : 'starboard';
const markEndGoal = o => {
  const dx = o.gate.end.x - o.gate.start.x, dy = o.gate.end.y - o.gate.start.y, length = Math.hypot(dx, dy);
  const clearance = markApproachClearance(o.boatLength);
  return { x: o.gate.start.x + dx / length * clearance, y: o.gate.start.y + dy / length * clearance };
};
const approachFor = (o, position, tack, wind, preferredDistance = null) => closestMarkApproach(position, wind.direction, tack,
  o.minAngle, o.gate.start, o.gate.end, markApproachClearance(o.boatLength), preferredDistance);
const observedSpeed = (o, wind, heading = wind.direction + (o.tack === 'starboard' ? -o.minAngle : o.minAngle), maneuver = null, time = o.time) =>
  performanceTarget(o.performance, heading, wind, maneuver, time);
function predictedHeading(o, position, tack, mode, wind) {
  const approach = mode === 'gate' ? approachFor(o, position, tack, wind, o.markAimDistance) : null;
  return approach ? approach.heading : wind.direction + (tack === 'starboard' ? -o.minAngle : o.minAngle);
}

// A short forecast through a FROZEN current map. This policy has no way to ask
// what wind will actually occur at a future time. Those predictions can be wrong.
export function forecastObservedOption(o, action) {
  const tack = action === 'tack' ? otherTack(o.tack) : o.tack;
  const mode = action === 'tack' || action === 'close' ? 'close' : action === 'bear' ? 'gate' : o.mode;
  const position = { ...o.position };
  const gateVector = { x: o.gate.end.x - o.gate.start.x, y: o.gate.end.y - o.gate.start.y };
  const maneuver = action === 'tack' ? createTack(o.time, o.wind.direction + signedAngle(o.heading - o.wind.direction),
    o.wind.direction, o.speedKnots, observedSpeed(o, o.wind, o.heading), o) : o.tackManeuver;
  let pressure = 0, elapsed = 0;
  let currentSpeed = o.speedKnots;
  let markAimDistance = mode === 'gate' && action !== 'bear' ? o.markAimDistance : null;
  while (elapsed < FORECAST_SECONDS - 1e-9) {
    const now = o.time + elapsed;
    let dt = Math.min(FORECAST_SECONDS - elapsed, recoveryRemaining(maneuver, now) > 1e-9 ? EXPERT_TACK.integrationStepSeconds : usesPolar(o.performance) ? STEP : 2);
    if (maneuver) for (const offset of [maneuver.duration, maneuver.recovery]) {
      const remaining = maneuver.start + offset - now;
      if (remaining > 1e-9) dt = Math.min(dt, remaining);
    }
    const wind = sampleObservedMap(o, position);
    const approach = mode === 'gate' ? approachFor(o, position, tack, wind, markAimDistance) : null;
    markAimDistance = approach?.distanceFromMark ?? null;
    const headingAt = (point, local, time) => turning(maneuver, time)
      ? turnHeading(maneuver, time, local.direction, tack === 'starboard' ? -o.minAngle : o.minAngle)
      : (mode === 'gate' ? approachFor(o, point, tack, local, markAimDistance)?.heading : null)
        ?? local.direction + (tack === 'starboard' ? -o.minAngle : o.minAngle);
    const heading = headingAt(position, wind, now), initial = direction(heading);
    const initialSpeed = performanceSpeed(o.performance, currentSpeed, observedSpeed(o, wind, heading, maneuver, now), maneuver, now) * KNOT_TO_MPS;
    if (mode === 'gate') {
      const side = gateVector.x * (position.y - o.gate.start.y) - gateVector.y * (position.x - o.gate.start.x);
      const rate = (gateVector.x * initial.y - gateVector.y * initial.x) * initialSpeed;
      if (side < -1e-10 && rate > 1e-10) dt = Math.min(dt, -side / rate * 1.5);
    }
    const midpoint = { x: position.x + initial.x * initialSpeed * dt / 2, y: position.y + initial.y * initialSpeed * dt / 2 };
    const local = sampleObservedMap(o, midpoint);
    const middleHeading = headingAt(midpoint, local, now + dt / 2), vector = direction(middleHeading);
    const target = observedSpeed(o, local, middleHeading, maneuver, now + dt / 2);
    const maneuvering = recoveryRemaining(maneuver, now) > 1e-9;
    const response = speedResponse(o.performance, initialSpeed / KNOT_TO_MPS, target, dt);
    const distance = (maneuvering ? maneuverSpeed(maneuver, now + dt / 2, target) : response.mean) * KNOT_TO_MPS * dt;
    const previous = { ...position };
    position.x += vector.x * distance; position.y += vector.y * distance;
    const endWind = sampleObservedMap(o, position);
    currentSpeed = maneuvering ? maneuverSpeed(maneuver, now + dt,
      observedSpeed(o, endWind, headingAt(position, endWind, now + dt), maneuver, now + dt)) : response.end;
    const sideBefore = gateVector.x * (previous.y - o.gate.start.y) - gateVector.y * (previous.x - o.gate.start.x);
    const sideAfter = gateVector.x * (position.y - o.gate.start.y) - gateVector.y * (position.x - o.gate.start.x);
    if (!turning(maneuver, now) && tack === 'starboard' && position.x < previous.x && sideBefore < -1e-8 && sideAfter >= -1e-8) {
      const fraction = -sideBefore / (sideAfter - sideBefore);
      const finish = { x: previous.x + (position.x - previous.x) * fraction, y: previous.y + (position.y - previous.y) * fraction };
      const along = ((finish.x - o.gate.start.x) * gateVector.x + (finish.y - o.gate.start.y) * gateVector.y) / (gateVector.x ** 2 + gateVector.y ** 2);
      const passDistance = distanceToSegment(o.gate.start, previous, finish);
      if (along >= 0 && along <= 1 && passDistance >= markContactClearance(o.boatLength)) {
        const actualStep = dt * fraction, total = elapsed + actualStep;
        return { action, estimatedSeconds: total, averageWindKnots: (pressure + local.speedKnots * actualStep) / total,
          position: finish, tack, predictedFinish: true };
      }
    }
    pressure += local.speedKnots * dt;
    elapsed += dt;
  }
  const wind = sampleObservedMap(o, position), up = direction(wind.direction), right = { x: up.y, y: -up.x };
  const goal = approachFor(o, position, 'starboard', wind)?.target ?? markEndGoal(o);
  const remaining = { x: goal.x - position.x, y: goal.y - position.y };
  const along = dot(remaining, up), across = dot(remaining, right), speed = Math.max(0.1, observedSpeed(o, wind) * KNOT_TO_MPS);
  const time = Math.max(Math.hypot(remaining.x, remaining.y) / speed,
    along / (speed * Math.cos(radians(o.minAngle))), Math.abs(across) / (speed * Math.sin(radians(o.minAngle))));
  // Finishing requires starboard. From the left on starboard, at least a port
  // leg and another tack are still needed; on port one tack remains.
  const futureTacks = tack === 'port' ? 1 : across > 1 ? 2 : 0;
  return { action, estimatedSeconds: FORECAST_SECONDS + time + futureTacks * tackSpeedCost(o),
    averageWindKnots: pressure / FORECAST_SECONDS, position, tack };
}

// Pure decision boundary. Tests can remove the entire scenario and give two
// different worlds the same observation: this function must choose identically.
export function decideLiveComputer(observation, memory = {}) {
  const o = observation;
  if (o.penaltyRemaining > 1e-8) return { action: 'hold', reason: 'Completing the moving roll tack.', options: [] };
  const mark = markEndGoal(o), toward = { x: mark.x - o.position.x, y: mark.y - o.position.y };
  const windUp = direction(o.wind.direction), right = { x: windUp.y, y: -windUp.x };
  const up = dot(toward, windUp), across = dot(toward, right);
  const approach = approachFor(o, o.position, o.tack, o.wind, o.mode === 'gate' ? o.markAimDistance : null);
  if (o.tack === 'starboard' && approach && approach.target.x < o.position.x &&
      Math.abs(signedAngle(approach.heading - predictedHeading(o, o.position, o.tack, o.mode, o.wind))) > 0.1)
    return { action: 'bear', reason: 'A legal close rounding is available; bearing toward the mark with hull clearance and leaving it to port.', options: [] };
  const starboardApproach = o.tack === 'port' ? approachFor(o, o.position, 'starboard', o.wind) : null;
  if (starboardApproach && starboardApproach.target.x < o.position.x && recoveryRemaining(o.tackManeuver, o.time) <= 1e-9)
    return { action: 'tack', reason: 'Reached a clearance-safe starboard approach to the mark; tacking to leave it to port and cross the windward line.', options: [] };
  const options = [forecastObservedOption(o, 'hold')];
  const settled = o.time - (memory.lastTackTime ?? -Infinity) >= Math.max(12, o.tackPenalty + 4);
  if (settled) options.push(forecastObservedOption(o, 'tack'));
  const hold = options[0], tack = options[1];
  const improvement = tack ? hold.estimatedSeconds - tack.estimatedSeconds : -Infinity;
  const startTie = o.time < 1 && o.tack === 'starboard' && tack && improvement > -1.5;
  const pressure = tack ? tack.averageWindKnots - hold.averageWindKnots : 0;
  const oldHeading = predictedHeading(o, o.position, o.tack, o.mode, o.wind);
  const newHeading = o.wind.direction + (o.tack === 'starboard' ? o.minAngle : -o.minAngle);
  const angleBenefit = direction(newHeading).y * observedSpeed(o, o.wind, newHeading)
    - direction(oldHeading).y * observedSpeed(o, o.wind, oldHeading);
  // A single-command forecast cannot plan a mid-window tack. Without this
  // guard it can prefer repeated reversals simply to avoid overshooting the
  // gate in its own forecast. Hold the strategic leg until its layline unless
  // actual observed angle/pressure or left-of-gate geometry supports a change.
  const supportedChange = pressure > 0.4 || angleBenefit > 0.15 || (o.tack === 'starboard' && across > 3);
  if (tack && ((improvement > 1.5 && supportedChange) || startTie)) {
    return { action: 'tack', options,
      reason: startTie ? 'Similar current-wind estimates; taking the right-hand leg to set up a starboard finish.'
        : pressure > 0.4 ? `The current wind map predicts ${pressure.toFixed(1)} kn more pressure on the other tack over the next minute.`
          : 'The other tack has the better estimated route to the gate in the current wind, including tack costs.' };
  }
  return { action: 'hold', options,
    reason: settled ? 'Continuing: the current wind picture does not justify another tack and its penalty.' : 'Letting the new tack settle before considering another change.' };
}

export function createLiveComputer() {
  const boat = initialBoat();
  return { boat, track: [boat], commands: [], decisions: [], nextDecision: 0, lastTackTime: -Infinity,
    status: 'ready', latestReason: 'Uses current wind observations, with no future wind schedule.' };
}

export function advanceLiveComputer(computer, scenario, duration) {
  if (computer.boat.finished || computer.status === 'timed-out') return;
  computer.status = 'racing';
  const boat = computer.boat;
  if (boat.time + 1e-8 >= computer.nextDecision) {
    const observation = observeCurrentWind(scenario, boat);
    const choice = decideLiveComputer(observation, { lastTackTime: computer.lastTackTime });
    computer.latestReason = choice.reason; computer.nextDecision = boat.time + DECISION_INTERVAL;
    if (choice.action !== 'hold') {
      const next = applyAction(boat, choice.action, scenario);
      if (next !== boat && (choice.action !== 'bear' || boat.mode !== 'gate')) {
        computer.commands.push({ time: boat.time, action: choice.action });
        computer.decisions.push({ time: boat.time, action: choice.action, reason: choice.reason,
          fromTack: boat.tack, toTack: next.tack, position: { ...boat.position }, wind: observation.wind, options: choice.options });
        computer.boat = next;
        if (choice.action === 'tack') computer.lastTackTime = boat.time;
      }
    }
  }
  computer.boat = advance(computer.boat, scenario, duration);
  const last = computer.track.at(-1);
  if (computer.boat.time - last.time >= 1 || computer.boat.finished) computer.track.push(computer.boat);
  if (computer.boat.finished) { computer.status = 'finished'; computer.latestReason = 'Finished on starboard using live wind observations only.'; }
  else if (computer.boat.time > scenario.config.courseLength / (referenceSpeedKnots(scenario.config) * KNOT_TO_MPS * 0.5) * 4 + 300)
    computer.status = 'timed-out';
}
