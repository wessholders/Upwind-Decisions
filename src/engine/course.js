import { courseRules, isUpwindFinish } from './course-config.js';
export { fixedUpwindFinish } from './course-config.js';
import { KNOT_TO_MPS } from './config.js';
import { direction, dot, cross, subtract, interpolate, headingTo, validHeading, markContactClearance, distanceToSegment, layline } from './geometry.js';
import { windAtPosition, windSampleAtPosition } from './wind.js';

export const FINISH_GUIDES = { length: 200, opacity: 0.28, strokeWidth: 1.5, fadeStart: 0.7,
  smoothingSeconds: 6, temporalSamples: 7, sampleOffset: 25 };

export function courseGeometry(scenario, time = 0) {
  const rules = { ...courseRules(scenario.config), boatLength: scenario.config.boatLength };
  if (isUpwindFinish(scenario.config)) return { ...scenario.course, ...rules, mark: null };
  const mark = { x: 0, y: scenario.config.courseLength };
  const up = direction(windAtPosition(scenario, mark.x, mark.y, time));
  const length = scenario.config.boatLength * scenario.config.gateBoatLengths;
  return { ...rules, mark, start: mark, up,
    end: { x: up.x * length, y: mark.y + up.y * length } };
}
export function nearestFinishPoint(position, course) {
  const line = subtract(course.end, course.start), length2 = dot(line, line);
  const u = Math.max(0, Math.min(1, dot(subtract(position, course.start), line) / length2));
  return interpolate(course.start, course.end, u);
}
// Linear finite-segment finish, also used by the current-map computer forecast.
export function courseCrossingFraction(course, from, to, tack) {
  const movement = subtract(to, from), line = subtract(course.end, course.start);
  if (course.requiredTack && (tack !== course.requiredTack || course.sign * movement.x >= -1e-12)) return null;
  const before = course.sign * cross(line, subtract(from, course.start));
  const after = course.sign * cross(line, subtract(to, course.start));
  if (before >= -1e-10 || after < -1e-10 || after - before <= 1e-12) return null;
  const fraction = Math.max(0, Math.min(1, -before / (after - before))), point = interpolate(from, to, fraction);
  const along = dot(subtract(point, course.start), line) / dot(line, line);
  if (along < -1e-9 || along > 1 + 1e-9) return null;
  if (course.mark && distanceToSegment(course.mark, from, point) < markContactClearance(course.boatLength) - 1e-7) return null;
  return fraction;
}
// Closest legal crossing of the horizontal finish. Pins have no rounding or
// clearance requirement. Intersect tack/no-go half-planes with the segment.
export function finishApproach(position, wind, tack, minimum, course, preferredDistance = null) {
  const line = subtract(course.end, course.start), length = Math.hypot(line.x, line.y);
  const axis = { x: line.x / length, y: line.y / length }, relative = subtract(position, course.start);
  const up = direction(wind), right = { x: up.y, y: -up.x }, sign = tack === 'starboard' ? -1 : 1;
  const side0 = -dot(relative, right) * sign, sideRate = dot(axis, right) * sign;
  const up0 = -dot(relative, up), upRate = dot(axis, up), angle = minimum * Math.PI / 180;
  let low = 0, high = length;
  for (const [offset, rate] of [[side0, sideRate],
    [side0 * Math.cos(angle) - up0 * Math.sin(angle), sideRate * Math.cos(angle) - upRate * Math.sin(angle)]]) {
    if (Math.abs(rate) < 1e-12) { if (offset < -1e-9) return null; }
    else if (rate > 0) low = Math.max(low, -offset / rate);
    else high = Math.min(high, -offset / rate);
  }
  if (low > high + 1e-9 || high < 0 || low > length) return null;
  const s = preferredDistance !== null && preferredDistance >= low && preferredDistance <= high
    ? preferredDistance : Math.max(low, Math.min(high, dot(relative, axis)));
  const target = { x: course.start.x + axis.x * s, y: course.start.y + axis.y * s }, heading = headingTo(position, target);
  if (Math.hypot(target.x - position.x, target.y - position.y) < 1e-8 || !validHeading(heading, wind, tack, minimum)) return null;
  return { target, heading, distanceFromMark: s };
}
export function finishLineBias(course, prevailingDirection) {
  const up = direction(prevailingDirection), differenceMeters = dot(subtract(course.end, course.start), up);
  // At an upwind FINISH the endpoint requiring less upwind progress is
  // favored. Keep the signed end-minus-start projection for later analysis.
  return { differenceMeters, favoredPin: Math.abs(differenceMeters) < 1e-8 ? null : differenceMeters > 0 ? 'start' : 'end' };
}
export function prevailingFinishWind(scenario, time) {
  const course = courseGeometry(scenario, time), center = course.center ?? course.mark, offset = FINISH_GUIDES.sampleOffset;
  const points = [course.start, course.end, center,
    { x: center.x + course.up.x * offset, y: center.y + course.up.y * offset },
    { x: center.x - course.up.x * offset, y: center.y - course.up.y * offset }];
  let vx = 0, vy = 0, weight = 0;
  // Read-only finite exponential window: the same historical display time
  // gives the same guides, independently of frames, pause or inspection order.
  for (let i = 0; i < FINISH_GUIDES.temporalSamples; i++) {
    const age = i * FINISH_GUIDES.smoothingSeconds / (FINISH_GUIDES.temporalSamples - 1), w = Math.exp(-age / (FINISH_GUIDES.smoothingSeconds / 2));
    for (const point of points) {
      const sample = windSampleAtPosition(scenario, point.x, point.y, Math.max(0, time - age));
      vx += sample.vx * w; vy += sample.vy * w; weight += w;
    }
  }
  return { direction: Math.atan2(-vx, -vy) * 180 / Math.PI, speedKnots: Math.hypot(vx, vy) / weight / KNOT_TO_MPS };
}
export function finishLaylines(scenario, time) {
  const course = courseGeometry(scenario, time), wind = prevailingFinishWind(scenario, time);
  return { wind, lines: [course.start, course.end].flatMap((pin, index) => ['starboard', 'port'].map(tack => ({
    pin: index, tack, start: pin, end: layline(pin, wind.direction, tack, scenario.config.minAngle, FINISH_GUIDES.length),
  }))) };
}
