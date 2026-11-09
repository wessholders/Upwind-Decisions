import { sampleObservedMap } from './npc-observation.js';
import { performanceTarget } from './performance.js';
import { currentVelocity, groundVelocity } from './current.js';
import { direction, signedAngle, dot, subtract } from './geometry.js';
import { nearestFinishPoint } from './course.js';
import { STRATEGIC_ATTRIBUTES } from './npc-personalities.js';

const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const unit = vector => {
  const length = Math.hypot(vector.x, vector.y);
  return length > 1e-10 ? { x: vector.x / length, y: vector.y / length } : { x: 0, y: 0 };
};

// Uses ONLY a permitted present map. A tie favors the ordinary setup side for
// the course, not a prediction of the eventual winning side.
export function observedFavoredSide(o) {
  const { bounds, cols, rows } = o.map;
  let left = 0, right = 0, nl = 0, nr = 0;
  for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < cols; ix++) {
    const x = bounds.minX + ix / (cols - 1) * (bounds.maxX - bounds.minX);
    const y = bounds.minY + iy / (rows - 1) * (bounds.maxY - bounds.minY);
    if (y < o.position.y || Math.abs(x) < 1e-8) continue;
    const wind = sampleObservedMap(o, { x, y });
    const value = wind.speedKnots / o.performance.backgroundWindKnots;
    if (x < 0) { left += value; nl++; } else { right += value; nr++; }
  }
  const difference = (nr ? right / nr : 0) - (nl ? left / nl : 0);
  return Math.abs(difference) > 1e-6 ? difference > 0 ? 'right' : 'left'
    : o.gate.requiredTack === 'starboard' ? 'right' : 'left';
}

export function strategicCommitment(o, strategy, commitment) {
  if (commitment.courseSide) return commitment;
  if (strategy.commitSide) throw new Error('Side Specialist needs its race-initialization side indicator.');
  return { ...commitment, courseSide: { side: observedFavoredSide(o), source: 'initial-observation',
    initializedAt: o.time, locked: false } };
}

// One inexpensive common opportunity scan for EVERY weighted personality.
// New ray candidates can tack then steer, so pressure corridors on either tack
// are actionable, rather than only compared at the old close-hauled headings.
export function strategicOpportunities(o, settings) {
  const c = o.publicConfig, flow = currentVelocity(c), rays = [];
  const goal = o.gate.mark ?? nearestFinishPoint(o.position, o.gate);
  const toward = unit(subtract(goal, o.position));
  for (const tack of ['starboard', 'port']) for (const offset of [0, 8, 16, 24]) {
    const angle = Math.min(75, o.minAngle + offset), heading = o.wind.direction + (tack === 'starboard' ? -angle : angle);
    const velocity = groundVelocity(heading, performanceTarget(c, heading, o.wind), flow);
    let pressure = 0, shifts = 0;
    for (const fraction of [1 / 3, 2 / 3, 1]) {
      const wind = sampleObservedMap(o, { x: o.position.x + velocity.x * settings.horizonSeconds * fraction,
        y: o.position.y + velocity.y * settings.horizonSeconds * fraction });
      pressure += wind.speedKnots / c.backgroundWindKnots;
      shifts += (tack === 'starboard' ? 1 : -1) * signedAngle(wind.direction);
    }
    rays.push({ tack, angle, pressure, shifts, current: dot(unit(velocity), toward) });
  }
  const selected = [];
  for (const attribute of ['pressure', 'shifts', 'current']) {
    for (const ray of [...rays].sort((a, b) => b[attribute] - a[attribute])) {
      if (!selected.some(r => r.tack === ray.tack && r.angle === ray.angle)) { selected.push(ray); break; }
    }
  }
  // Include a pressure alternative on the other tack as well.
  const other = [...rays].filter(r => r.tack !== selected[0]?.tack).sort((a, b) => b.pressure - a.pressure)[0];
  if (other && !selected.some(r => r.tack === other.tack && r.angle === other.angle)) selected.push(other);
  return selected;
}

export function createStrategyAccumulator(o) {
  return { seconds: 0, pressure: 0, shifts: 0, current: 0, side: 0, earlyLeft: 0, earlyRight: 0,
    flow: currentVelocity(o.publicConfig) };
}

export function accumulateStrategy(acc, o, before, after, navigating) {
  const dt = after.time - before.time;
  if (dt <= 0) return;
  const point = { x: (before.position.x + after.position.x) / 2, y: (before.position.y + after.position.y) / 2 };
  const wind = sampleObservedMap(o, point), ratio = wind.speedKnots / o.performance.backgroundWindKnots;
  const ground = { x: (after.position.x - before.position.x) / dt, y: (after.position.y - before.position.y) / dt };
  const water = { x: ground.x - acc.flow.x, y: ground.y - acc.flow.y };
  const target = o.gate.mark ?? nearestFinishPoint(point, o.gate), toward = unit(subtract(target, point));
  const gu = unit(ground), wu = unit(water);
  const drift = Math.acos(clamp(dot(gu, wu), -1, 1)) / Math.PI;
  const current = Math.hypot(acc.flow.x, acc.flow.y) < 1e-10 ? 0.5
    : clamp(0.5 + 0.5 * (dot(gu, toward) - dot(wu, toward)) - 0.25 * drift);
  acc.seconds += dt;
  acc.pressure += clamp(0.5 + (ratio - 1) / 0.8 - Math.max(0, 1 - ratio)) * dt;
  acc.shifts += clamp(0.5 + (after.tack === 'starboard' ? 1 : -1) * signedAngle(wind.direction) / 30) * dt;
  acc.current += current * dt;
  acc.side += clamp(point.x / (o.boatLength * 10), -1, 1) * dt;
  if (!navigating && point.y < o.publicConfig.courseLength * 0.75) {
    if (point.x < -o.boatLength * 0.5) acc.earlyLeft += dt;
    if (point.x > o.boatLength * 0.5) acc.earlyRight += dt;
  }
}

export function finishStrategy(acc, actualTacks, terminalTacks) {
  const seconds = acc.seconds || 1;
  return { pressure: acc.pressure / seconds, shifts: acc.shifts / seconds,
    current: acc.current / seconds, meanSide: acc.side / seconds,
    predictedTacks: actualTacks + (terminalTacks ?? 0),
    earlyLeftSeconds: acc.earlyLeft, earlyRightSeconds: acc.earlyRight };
}

// All dimensions are 0..1. ETA already includes normal wind/current/tack physics.
// Credit only ADDITIONAL strategic quality over the fastest legal ETA route;
// do not award its existing physical advantages a second time. A quarter of a
// full normalized environmental scale, or two avoided tacks, is a full style
// gain. Side is an explicit positional preference, not a physical speed bonus.
export function rankStrategicForecasts(forecasts, o, strategy, commitment, memory = {}, settings = {}) {
  const hold = forecasts.find(f => f.plan.kind === 'hold' && !f.exhausted);
  const supported = f => {
    if (!Number.isFinite(memory.lastTackTime) || !Number.isFinite(f.plan.tackAt) || !hold) return true;
    // A moving roll tack can improve VMG while its bow passes through the wind.
    // Do not repeatedly harvest that numerical/model advantage. After the first
    // leg, optional reversals need sustained observed support or a large route
    // improvement; mandatory navigation is handled before strategic scoring.
    const pressure = f.features.pressure - hold.features.pressure > 0.05;
    const shift = f.features.shifts - hold.features.shifts > 0.12;
    const progress = hold.progressMeters <= 0 && f.progressMeters > 0;
    const route = f.estimatedSeconds !== null && (hold.estimatedSeconds === null ||
      hold.estimatedSeconds - f.estimatedSeconds > Math.max(12, (settings.horizonSeconds ?? 60) / 2));
    const sign = commitment.courseSide.side === 'right' ? 1 : -1;
    const returnToSide = strategy.commitSide && o.position.x * sign < -o.boatLength * 10 &&
      (f.features.meanSide - hold.features.meanSide) * sign > 0.5;
    return pressure || shift || progress || route || returnToSide;
  };
  const finite = forecasts.filter(f => !f.exhausted && f.estimatedSeconds !== null && supported(f));
  if (!finite.length) return { ranked: [], etaBudgetSeconds: 0 };
  const bestEta = Math.min(...finite.map(f => f.estimatedSeconds));
  const fastest = finite.find(f => f.estimatedSeconds === bestEta);
  const budget = Math.min(strategy.maxEtaRegretSeconds, Math.max(4, bestEta * strategy.maxEtaRegretFraction));
  let eligible = finite.filter(f => f.estimatedSeconds <= bestEta + budget + 1e-8 && (f.boat.finished || f.progressMeters > 0));
  if (!eligible.length) eligible = finite.filter(f => f.estimatedSeconds <= bestEta + budget + 1e-8);
  const side = commitment.courseSide.side, sign = side === 'right' ? 1 : -1;
  // Locked side is a navigation constraint, never a reassessed side choice.
  // Finishing setup in the final quarter and mandatory navigation are exempt.
  if (strategy.commitSide) {
    const committed = eligible.filter(f => (side === 'right' ? f.features.earlyLeftSeconds : f.features.earlyRightSeconds) < 1e-8);
    if (committed.length) eligible = committed;
  }
  const ranked = eligible.map(f => ({ forecast: f, scores: {
    pressure: clamp((f.features.pressure - fastest.features.pressure) / 0.25),
    shifts: clamp((f.features.shifts - fastest.features.shifts) / 0.25),
    current: clamp((f.features.current - fastest.features.current) / 0.25),
    tacks: clamp((fastest.features.predictedTacks - f.features.predictedTacks) / 2),
    side: clamp(0.5 + sign * f.features.meanSide / 2),
    route: clamp(1 - (f.estimatedSeconds - bestEta) / budget),
  } }));
  for (const r of ranked) r.utility = STRATEGIC_ATTRIBUTES.reduce((sum, key) => sum + strategy.weights[key] / 100 * r.scores[key], 0);
  ranked.sort((a, b) => b.utility - a.utility || a.forecast.estimatedSeconds - b.forecast.estimatedSeconds);
  return { ranked, etaBudgetSeconds: budget, bestEtaSeconds: bestEta };
}
