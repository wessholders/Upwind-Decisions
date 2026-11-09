import { currentVelocity, groundVelocity } from './current.js';
import { performanceTarget, boatProfile } from './performance.js';
import { navigationApproach } from './navigation.js';
import { courseCrossingFraction } from './course.js';
import { cross, dot, subtract, distanceToSegment, markApproachClearance, markContactClearance } from './geometry.js';
import { recoveryRemaining, tackSettings } from './tack.js';
import { sampleObservedMap } from './npc-observation.js';

const opposite = tack => tack === 'starboard' ? 'port' : 'starboard';

// Terminal approximation, not a proof about changing wind: solve positive
// travel times using vector ground velocities in the terminal observed wind.
// Add full recovery time for every future tack and an acceleration allowance.
// No scalar current bonus, progress floor, or finite ETA for unsolved routes.
export function estimateRemainingTime(observation, boat) {
  if (boat.finished) return { seconds: 0, futureTacks: 0, reachable: true };
  const c = observation.publicConfig, gate = observation.gate;
  const wind = sampleObservedMap(observation, boat.position), flow = currentVelocity(c);
  const lastTacks = gate.requiredTack ? [gate.requiredTack] : ['starboard', 'port'];
  const recovery = tackSettings(c).recovery;
  const allowance = recoveryRemaining(boat.tackManeuver, boat.time) +
    (c.performanceModel === 'legacy-pressure' ? 0 : boatProfile(c).accelerationSeconds);
  let best = null;
  const consider = (seconds, futureTacks, target) => {
    const total = seconds + futureTacks * recovery + allowance;
    if (Number.isFinite(total) && total >= 0 && total <= 21600 && (!best || total < best.seconds))
      best = { seconds: total, futureTacks, target, reachable: true };
  };
  const legalArrival = (from, target, velocity, tack) => {
    const to = { x: target.x + velocity.x * 0.01, y: target.y + velocity.y * 0.01 };
    return courseCrossingFraction(gate, from, to, tack) !== null;
  };
  for (const tack of lastTacks) {
    const approach = navigationApproach(boat.position, wind, tack, c, gate);
    if (!approach) continue;
    const velocity = groundVelocity(approach.heading, performanceTarget(c, approach.heading, wind), flow);
    const remaining = subtract(approach.target, boat.position), speed2 = dot(velocity, velocity);
    const time = speed2 > 1e-12 ? dot(remaining, velocity) / speed2 : -1;
    if (time > 0 && Math.abs(cross(remaining, velocity)) <= 1e-5 * Math.max(1, Math.hypot(remaining.x, remaining.y)) &&
        legalArrival(boat.position, approach.target, velocity, tack))
      consider(time, tack === boat.tack ? 0 : 1, approach.target);
  }
  const line = subtract(gate.end, gate.start), length = Math.hypot(line.x, line.y);
  const clearance = gate.mark ? markApproachClearance(c.boatLength) : 0;
  const targets = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const distance = clearance + (length - clearance) * f;
    return { x: gate.start.x + line.x * distance / length, y: gate.start.y + line.y * distance / length };
  });
  const angles = [c.minAngle, Math.min(75, c.minAngle + 8)];
  for (const last of lastTacks) for (const firstAngle of angles) for (const lastAngle of angles) {
    const first = opposite(last);
    const velocity = (tack, angle) => {
      const heading = wind.direction + (tack === 'starboard' ? -angle : angle);
      return groundVelocity(heading, performanceTarget(c, heading, wind), flow);
    };
    const a = velocity(first, firstAngle), b = velocity(last, lastAngle), determinant = cross(a, b);
    if (Math.abs(determinant) < 1e-10) continue;
    for (const target of targets) {
      const d = subtract(target, boat.position);
      const ta = cross(d, b) / determinant, tb = cross(a, d) / determinant;
      if (ta < -1e-8 || tb <= 1e-6) continue;
      const corner = { x: boat.position.x + a.x * Math.max(0, ta), y: boat.position.y + a.y * Math.max(0, ta) };
      if (gate.mark && (distanceToSegment(gate.mark, boat.position, corner) < markContactClearance(c.boatLength) ||
          distanceToSegment(gate.mark, corner, target) < markContactClearance(c.boatLength))) continue;
      if (!legalArrival(corner, target, b, last)) continue;
      consider(Math.max(0, ta) + tb, (first === boat.tack ? 0 : 1) + 1, target);
    }
  }
  return best ?? { seconds: null, futureTacks: null, reachable: false };
}
