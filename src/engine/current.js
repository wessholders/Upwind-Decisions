import { KNOT_TO_MPS } from './config.js';
import { direction, normalize, layline, cross, dot, signedAngle } from './geometry.js';
import { performanceTarget, boatProfile } from './performance.js';

// Compass TOWARD bearing -> course coordinates. Never advect the wind or marks.
export function currentVelocity(config) {
  const current = config.current;
  if (!current?.enabled || current.speedKnots === 0) return { x: 0, y: 0 };
  const v = direction(current.directionDegrees - (config.baseline ?? 0));
  const speed = current.speedKnots * KNOT_TO_MPS;
  return { x: v.x * speed, y: v.y * speed };
}
export function groundVelocity(heading, speedKnots, current = { x: 0, y: 0 }) {
  const v = direction(heading), speed = speedKnots * KNOT_TO_MPS;
  return { x: v.x * speed + current.x, y: v.y * speed + current.y };
}
export function groundTelemetry(heading, speedKnots, config) {
  const v = groundVelocity(heading, speedKnots, currentVelocity(config)), speed = Math.hypot(v.x, v.y);
  return { ...v, speedKnots: speed / KNOT_TO_MPS,
    courseDegrees: speed > 1e-10 ? normalize(Math.atan2(v.x, v.y) * 180 / Math.PI + (config.baseline ?? 0)) : null };
}
export function predictedLayline(mark, wind, tack, config, length, mode = 'wind-only') {
  const current = currentVelocity(config);
  if (mode !== 'wind-current' || (current.x === 0 && current.y === 0))
    return layline(mark, wind.direction, tack, config.minAngle, length);
  const heading = wind.direction + (tack === 'starboard' ? -config.minAngle : config.minAngle);
  const ground = groundVelocity(heading, performanceTarget(config, heading, wind), current);
  const speed = Math.hypot(ground.x, ground.y);
  if (speed < 1e-10) return { ...mark }; // No predicted ground movement, hence no approach ray.
  return { x: mark.x - ground.x / speed * length, y: mark.y - ground.y / speed * length };
}

// Solve a heading for a requested ground track with the existing polar. This
// does not change steering limits, tack, polar data or through-water speeds.
export function headingForGroundTrack(trackHeading, wind, tack, config, throughSpeedKnots = null) {
  const current = currentVelocity(config), track = direction(trackHeading);
  const sign = tack === 'starboard' ? -1 : 1;
  const min = config.minAngle, max = boatProfile(config).maxSailingAngle;
  const speedAt = h => throughSpeedKnots ?? performanceTarget(config, h, wind);
  const legal = h => {
    const angle = signedAngle(h - wind.direction);
    return angle * sign >= min - 1e-7 && angle * sign <= max + 1e-7;
  };
  const error = h => cross(track, groundVelocity(h, speedAt(h), current));
  const forward = h => dot(track, groundVelocity(h, speedAt(h), current)) > 1e-9;
  if (throughSpeedKnots !== null) {
    const speed = throughSpeedKnots * KNOT_TO_MPS, ratio = cross(track, current) / speed;
    if (speed < 1e-10 || Math.abs(ratio) > 1) return null;
    const offset = Math.asin(ratio) * 180 / Math.PI;
    return [trackHeading + offset, trackHeading + 180 - offset].find(h => legal(h) && forward(h)) ?? null;
  }
  const offset = Math.abs(signedAngle(trackHeading - wind.direction));
  let heading = wind.direction + sign * Math.max(min, Math.min(max, offset));
  for (let i = 0; i < 18; i++) {
    const speed = speedAt(heading) * KNOT_TO_MPS;
    if (speed < 1e-10) break;
    const ratio = cross(track, current) / speed;
    if (Math.abs(ratio) > 1) break;
    const next = trackHeading + Math.asin(ratio) * 180 / Math.PI;
    if (Math.abs(signedAngle(next - heading)) < 1e-8) { heading = next; break; }
    heading = next;
  }
  if (legal(heading) && Math.abs(error(heading)) < 1e-7 && forward(heading)) return heading;
  // Strong/reversing current can defeat fixed-point convergence. Bracket
  // roots on this tack, never accepting an irons/opposite-tack solution.
  let previous = wind.direction + sign * min, before = error(previous);
  for (let a = min + 2; a <= max + 2; a += 2) {
    const next = wind.direction + sign * Math.min(a, max), after = error(next);
    if (before * after <= 0) {
      let low = previous, high = next, lowError = before;
      for (let i = 0; i < 28; i++) {
        const middle = (low + high) / 2, value = error(middle);
        if (lowError * value <= 0) high = middle; else { low = middle; lowError = value; }
      }
      const result = (low + high) / 2;
      if (forward(result)) return result;
    }
    previous = next; before = after;
  }
  return null;
}
