import { advance, applyAction, initialBoat } from './physics.js';
import { windSampleAtPosition } from './wind.js';
import { gateEnd } from './finish.js';
import { direction, dot, headingTo, radians, signedAngle, validHeading } from './geometry.js';
import { KNOT_TO_MPS } from './config.js';

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
    penaltyRemaining: boat.penaltyRemaining, wind: { direction: wind.direction, speedKnots: wind.speedKnots, kind: wind.kind },
    gate: { start: { x: 0, y: c.courseLength }, end: gateEnd(scenario, boat.time) },
    minAngle: c.minAngle, tackPenalty: c.tackPenalty, baseSpeedKnots: c.speedKnots,
    backgroundWindKnots: scenario.organicWind?.windKnots ?? c.backgroundWindKnots ?? 10,
    pressureExponent: scenario.organicWind ? c.pressureExponent ?? 0.5 : 0,
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
const gateCenter = o => ({ x: (o.gate.start.x + o.gate.end.x) / 2, y: (o.gate.start.y + o.gate.end.y) / 2 });
const observedSpeed = (o, wind) => o.baseSpeedKnots * Math.max(0.1, wind.speedKnots / o.backgroundWindKnots) ** o.pressureExponent;
function predictedHeading(o, position, tack, mode, wind) {
  const direct = headingTo(position, gateCenter(o));
  return mode === 'gate' && validHeading(direct, wind.direction, tack, o.minAngle)
    ? direct : wind.direction + (tack === 'starboard' ? -o.minAngle : o.minAngle);
}

// A short forecast through a FROZEN current map. This policy has no way to ask
// what wind will actually occur at a future time. Those predictions can be wrong.
export function forecastObservedOption(o, action) {
  const tack = action === 'tack' ? otherTack(o.tack) : o.tack;
  const mode = action === 'tack' || action === 'close' ? 'close' : action === 'bear' ? 'gate' : o.mode;
  const position = { ...o.position };
  const gateVector = { x: o.gate.end.x - o.gate.start.x, y: o.gate.end.y - o.gate.start.y };
  let penalty = action === 'tack' ? o.tackPenalty : o.penaltyRemaining, pressure = 0;
  for (let elapsed = 0; elapsed < FORECAST_SECONDS; elapsed += 2) {
    const wind = sampleObservedMap(o, position); pressure += wind.speedKnots * 2;
    const stopped = Math.min(2, penalty); penalty -= stopped;
    const vector = direction(predictedHeading(o, position, tack, mode, wind));
    const distance = observedSpeed(o, wind) * KNOT_TO_MPS * (2 - stopped);
    const previous = { ...position };
    position.x += vector.x * distance; position.y += vector.y * distance;
    const sideBefore = gateVector.x * (previous.y - o.gate.start.y) - gateVector.y * (previous.x - o.gate.start.x);
    const sideAfter = gateVector.x * (position.y - o.gate.start.y) - gateVector.y * (position.x - o.gate.start.x);
    if (tack === 'starboard' && position.x < previous.x && sideBefore < -1e-8 && sideAfter >= -1e-8) {
      const fraction = -sideBefore / (sideAfter - sideBefore);
      const finish = { x: previous.x + (position.x - previous.x) * fraction, y: previous.y + (position.y - previous.y) * fraction };
      const along = ((finish.x - o.gate.start.x) * gateVector.x + (finish.y - o.gate.start.y) * gateVector.y) / (gateVector.x ** 2 + gateVector.y ** 2);
      if (along >= 0 && along <= 1) {
        const actualStep = stopped + (2 - stopped) * fraction, total = elapsed + actualStep;
        return { action, estimatedSeconds: total, averageWindKnots: (pressure - wind.speedKnots * (2 - actualStep)) / total,
          position: finish, tack, predictedFinish: true };
      }
    }
  }
  const wind = sampleObservedMap(o, position), up = direction(wind.direction), right = { x: up.y, y: -up.x };
  const remaining = { x: gateCenter(o).x - position.x, y: gateCenter(o).y - position.y };
  const along = dot(remaining, up), across = dot(remaining, right), speed = Math.max(0.1, observedSpeed(o, wind) * KNOT_TO_MPS);
  const time = Math.max(Math.hypot(remaining.x, remaining.y) / speed,
    along / (speed * Math.cos(radians(o.minAngle))), Math.abs(across) / (speed * Math.sin(radians(o.minAngle))));
  // Finishing requires starboard. From the left on starboard, at least a port
  // leg and another tack are still needed; on port one tack remains.
  const futureTacks = tack === 'port' ? 1 : across > 1 ? 2 : 0;
  return { action, estimatedSeconds: FORECAST_SECONDS + time + futureTacks * o.tackPenalty,
    averageWindKnots: pressure / FORECAST_SECONDS, position, tack };
}

// Pure decision boundary. Tests can remove the entire scenario and give two
// different worlds the same observation: this function must choose identically.
export function decideLiveComputer(observation, memory = {}) {
  const o = observation;
  if (o.penaltyRemaining > 1e-8) return { action: 'hold', reason: 'Completing the tack penalty.', options: [] };
  const center = gateCenter(o), toward = { x: center.x - o.position.x, y: center.y - o.position.y };
  const windUp = direction(o.wind.direction), right = { x: windUp.y, y: -windUp.x };
  const up = dot(toward, windUp), across = dot(toward, right);
  const direct = headingTo(o.position, center);
  if (o.tack === 'starboard' && validHeading(direct, o.wind.direction, o.tack, o.minAngle) && toward.x < 0 &&
      Math.abs(signedAngle(direct - predictedHeading(o, o.position, o.tack, o.mode, o.wind))) > 0.1)
    return { action: 'bear', reason: 'The gate center is reachable legally on starboard; aiming at the finish.', options: [] };
  if (o.tack === 'port' && across <= -Math.max(0, up) * Math.tan(radians(o.minAngle)) + 3)
    return { action: 'tack', reason: 'Reached the starboard layline in the current wind; tacking for the required finish approach.', options: [] };
  const options = [forecastObservedOption(o, 'hold')];
  const settled = o.time - (memory.lastTackTime ?? -Infinity) >= Math.max(12, o.tackPenalty + 4);
  if (settled) options.push(forecastObservedOption(o, 'tack'));
  const hold = options[0], tack = options[1];
  const improvement = tack ? hold.estimatedSeconds - tack.estimatedSeconds : -Infinity;
  const startTie = o.time < 1 && o.tack === 'starboard' && tack && improvement > -1.5;
  const pressure = tack ? tack.averageWindKnots - hold.averageWindKnots : 0;
  const oldCourseComponent = direction(predictedHeading(o, o.position, o.tack, o.mode, o.wind)).y;
  const newCourseComponent = direction(o.wind.direction + (o.tack === 'starboard' ? o.minAngle : -o.minAngle)).y;
  const angleBenefit = (newCourseComponent - oldCourseComponent) * observedSpeed(o, o.wind);
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
  else if (computer.boat.time > scenario.config.courseLength / (scenario.config.speedKnots * KNOT_TO_MPS * 0.5) * 4 + 300)
    computer.status = 'timed-out';
}
