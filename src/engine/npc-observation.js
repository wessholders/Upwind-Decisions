import { sailingHeading, sailingSpeedKnots } from './physics.js';
import { windSampleAtPosition } from './wind.js';
import { courseGeometry } from './course.js';
import { KNOT_TO_MPS } from './config.js';
import { currentVelocity } from './current.js';
import { courseRules, isUpwindFinish } from './course-config.js';
import { direction } from './geometry.js';
import { navigationApproach } from './navigation.js';
import { turning, turnHeading } from './tack.js';
import { performanceTarget } from './performance.js';
import { observationProfile } from './npc-config.js';
import { copyNpcData, freezeNpcData } from './npc-data.js';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function observationBounds(config, boat, profile = 'legacy-v1') {
  const p = observationProfile(profile), c = config;
  if (p.coverage === 'legacy-course') {
    const margin = c.courseLength * 0.08;
    const extent = Math.max(c.courseLength * 0.58, Math.abs(boat.position.x) + margin);
    return { minX: -extent, maxX: extent, minY: Math.min(-margin, boat.position.y - margin),
      maxY: Math.max(c.courseLength + c.boatLength * c.gateBoatLengths + margin, boat.position.y + margin) };
  }
  // Never sample above entry: traveling wind maps those positions to future
  // source-sequence times. Even an overstood boat cannot move this cap.
  const entry = c.courseLength + c.boatLength * c.gateBoatLengths;
  const anchorY = Math.min(boat.position.y, entry), length = c.boatLength;
  return { minX: boat.position.x - p.lateralBoatLengths * length,
    maxX: boat.position.x + p.lateralBoatLengths * length,
    minY: anchorY - p.aftBoatLengths * length,
    maxY: Math.min(entry, anchorY + p.forwardBoatLengths * length) };
}

// Course locations/rules are public. Do not leak extra descriptor properties or
// retain references into the authoritative scenario when freezing observations.
function publicCourse(course) {
  const keys = ['mode', 'requiredTack', 'sign', 'roundingSide', 'boatLength',
    'mark', 'start', 'up', 'end', 'center', 'initialDirection'];
  return Object.fromEntries(keys.filter(key => Object.hasOwn(course, key))
    .map(key => [key, course[key] && typeof course[key] === 'object'
      ? { x: course[key].x, y: course[key].y } : copyNpcData(course[key])]));
}

function observedCourse(scenario, map) {
  const c = scenario.config;
  if (isUpwindFinish(c)) return publicCourse({ ...scenario.course,
    ...courseRules(c), boatLength: c.boatLength, mark: null });
  const mark = { x: 0, y: c.courseLength };
  // A rotating gate is environmental information too. Estimate its orientation
  // from the permitted map instead of querying wind at an unseen mark.
  const up = direction(sampleObservedMap({ map }, mark).direction);
  const length = c.boatLength * c.gateBoatLengths;
  return { ...courseRules(c), boatLength: c.boatLength, mark, start: { ...mark }, up,
    end: { x: mark.x + up.x * length, y: mark.y + up.y * length } };
}

function observedHeading(boat, config, wind, gate) {
  const offset = boat.tack === 'starboard' ? -config.minAngle : config.minAngle;
  if (turning(boat.tackManeuver, boat.time))
    return turnHeading(boat.tackManeuver, boat.time, wind.direction, offset);
  if (boat.mode === 'gate') return navigationApproach(boat.position, wind, boat.tack, config,
    gate, boat.markAimDistance ?? null, boat.speedKnots ?? null)?.heading ?? wind.direction + offset;
  const angle = boat.mode === 'manual' ? boat.targetAngle : config.minAngle;
  return wind.direction + (boat.tack === 'starboard' ? -angle : angle);
}

// This adapter alone can access the simulation. Every wind query is explicitly
// at NOW. It returns plain observations: no seed, scenario, generator, future
// sample callback, feature lifetime, spawn schedule, or target wind sequence.
export function observeCurrentWind(scenario, boat, profile = 'legacy-v1') {
  const c = scenario.config, p = observationProfile(profile), legacy = p.coverage === 'legacy-course';
  const bounds = observationBounds(c, boat, p);
  const { cols, rows } = p, cells = [];
  for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < cols; ix++) {
    const x = bounds.minX + ix / (cols - 1) * (bounds.maxX - bounds.minX);
    const y = bounds.minY + iy / (rows - 1) * (bounds.maxY - bounds.minY);
    const wind = windSampleAtPosition(scenario, legacy ? x : clamp(x, bounds.minX, bounds.maxX),
      legacy ? y : clamp(y, bounds.minY, bounds.maxY), boat.time);
    cells.push({ vx: wind.vx, vy: wind.vy });
  }
  const map = { bounds, cols, rows, cells };
  const localPosition = legacy ? boat.position : {
    x: clamp(boat.position.x, bounds.minX, bounds.maxX),
    y: clamp(boat.position.y, bounds.minY, bounds.maxY),
  };
  const wind = windSampleAtPosition(scenario, localPosition.x, localPosition.y, boat.time);
  const gate = legacy ? publicCourse(courseGeometry(scenario, boat.time)) : observedCourse(scenario, map);
  const heading = legacy ? sailingHeading(boat, scenario) : observedHeading(boat, c, wind, gate);
  const speedKnots = legacy ? sailingSpeedKnots(boat, scenario) : boat.speedKnots ??
    performanceTarget(c, heading, wind, boat.tackManeuver, boat.time);
  return freezeNpcData({ time: boat.time, position: { ...boat.position }, tack: boat.tack, mode: boat.mode,
    markAimDistance: boat.markAimDistance ?? null,
    tackManeuver: boat.tackManeuver ? Object.fromEntries([
      'start', 'duration', 'minSpeedFraction', 'recovery', 'minimumAt', 'priorTurnTime', 'entryOffset', 'entrySpeed', 'entryTarget',
    ].filter(key => Object.hasOwn(boat.tackManeuver, key)).map(key => [key, boat.tackManeuver[key]])) : null,
    heading, speedKnots,
    penaltyRemaining: boat.penaltyRemaining, wind: { direction: wind.direction, speedKnots: wind.speedKnots, kind: wind.kind },
    gate,
    currentVelocity: currentVelocity(c),
    minAngle: c.minAngle, tackPenalty: c.tackPenalty,
    tackMinSpeedFraction: c.tackMinSpeedFraction, tackRecoverySeconds: c.tackRecoverySeconds,
    performance: { performanceModel: c.performanceModel, boatProfile: c.boatProfile, speedScale: c.speedScale,
      minAngle: c.minAngle, windField: c.windField, speedKnots: c.speedKnots,
      backgroundWindKnots: c.backgroundWindKnots, pressureExponent: c.pressureExponent,
      current: c.current ? { enabled: c.current.enabled, speedKnots: c.current.speedKnots,
        directionDegrees: c.current.directionDegrees } : undefined, baseline: c.baseline, boatLength: c.boatLength },
    boatLength: c.boatLength,
    map,
    ...(legacy ? {} : { perception: { profileId: p.id, windSamplePosition: { ...localPosition },
      localWindAtBoat: localPosition.x === boat.position.x && localPosition.y === boat.position.y,
      courseGeometry: isUpwindFinish(c) ? 'public-fixed' : 'observed-map-estimate',
      heading: 'observed-estimate' } }),
  });
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

// New-policy observations add complete OWN-boat state and only the public
// configuration required by shared physics. Legacy observations stay intact.
export function observeRoutePlanner(scenario, boat, profile = 'advanced-v1') {
  if (observationProfile(profile).coverage === 'legacy-course')
    throw new Error('The route planner requires upstream-capped observations.');
  const o = observeCurrentWind(scenario, boat, profile), c = scenario.config;
  const ownBoat = Object.fromEntries([
    'time', 'tack', 'mode', 'penaltyRemaining', 'penaltyTime', 'speedKnots', 'distance', 'tacks', 'finished',
    'targetAngle', 'markAimDistance',
  ].filter(key => Object.hasOwn(boat, key)).map(key => [key, boat[key]]));
  return freezeNpcData({ ...o,
    boat: { ...ownBoat, position: { ...boat.position }, tackManeuver: o.tackManeuver },
    publicConfig: { ...o.performance, courseMode: c.courseMode, courseLength: c.courseLength,
      gateBoatLengths: c.gateBoatLengths, tackPenalty: c.tackPenalty,
      tackMinSpeedFraction: c.tackMinSpeedFraction, tackRecoverySeconds: c.tackRecoverySeconds },
  });
}

