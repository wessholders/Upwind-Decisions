import { headingTo, closestMarkApproach, markApproachClearance, distanceToSegment } from './geometry.js';
import { finishApproach } from './course.js';
import { performanceTarget } from './performance.js';
import { currentVelocity, groundVelocity, headingForGroundTrack } from './current.js';

// Reuse the original geometric candidates. With current, the approach ray is
// a ground track and the returned heading is the legal through-water heading.
export function navigationApproach(position, wind, tack, config, course, preferredDistance = null, throughSpeedKnots = null) {
  const clearance = markApproachClearance(config.boatLength);
  const geometric = (windDirection, preferred = preferredDistance) => course.mark
    ? closestMarkApproach(position, windDirection, tack, config.minAngle, course.start, course.end, clearance, preferred)
    : finishApproach(position, windDirection, tack, config.minAngle, course, preferred);
  const current = currentVelocity(config);
  if (current.x === 0 && current.y === 0) return geometric(wind.direction);
  const close = wind.direction + (tack === 'starboard' ? -config.minAngle : config.minAngle);
  const v = groundVelocity(close, throughSpeedKnots ?? performanceTarget(config, close, wind), current);
  const closeTrack = Math.atan2(v.x, v.y) * 180 / Math.PI;
  const effectiveWind = closeTrack - (tack === 'starboard' ? -config.minAngle : config.minAngle);
  const convert = candidate => {
    if (!candidate) return null;
    const heading = headingForGroundTrack(headingTo(position, candidate.target), wind, tack, config, throughSpeedKnots);
    return heading === null ? null : { ...candidate, heading };
  };
  const primary = convert(geometric(effectiveWind)) ?? convert(geometric(wind.direction));
  if (primary) return primary;
  // If drift makes the nearest ray unattainable, try finite gate targets;
  // never command an illegal heading or claim an unreachable approach is safe.
  const line = { x: course.end.x - course.start.x, y: course.end.y - course.start.y };
  const length = Math.hypot(line.x, line.y);
  for (let i = 0; i <= 12; i++) {
    const s = course.mark ? clearance + (length - clearance) * i / 12 : length * i / 12;
    const target = { x: course.start.x + line.x * s / length, y: course.start.y + line.y * s / length };
    if (Math.hypot(target.x - position.x, target.y - position.y) < 1e-8) continue;
    if (course.mark && distanceToSegment(course.mark, position, target) < clearance - 1e-7) continue;
    const candidate = convert({ target, distanceFromMark: s });
    if (candidate) return candidate;
  }
  return null;
}
