import { direction } from './geometry.js';
export const COURSE_MODE = {
  ROUND_PORT: 'round-port', ROUND_STARBOARD: 'round-starboard', FINISH_UPWIND: 'finish-upwind',
};
export const COURSE_LABEL = {
  [COURSE_MODE.ROUND_PORT]: 'Round to Port',
  [COURSE_MODE.ROUND_STARBOARD]: 'Round to Starboard',
  [COURSE_MODE.FINISH_UPWIND]: 'Finish Upwind',
};
export const UPWIND_COURSE = { distance: 1000, boatLength: 5, widthBoatLengths: 20 };
export const isUpwindFinish = config => config.courseMode === COURSE_MODE.FINISH_UPWIND;
export function courseSettings(config) {
  return isUpwindFinish(config) ? { ...config, courseLength: UPWIND_COURSE.distance,
    boatLength: UPWIND_COURSE.boatLength, gateBoatLengths: UPWIND_COURSE.widthBoatLengths } : config;
}
export function courseRules(config) {
  if (isUpwindFinish(config)) return { mode: COURSE_MODE.FINISH_UPWIND, requiredTack: null, sign: 1, roundingSide: null };
  const reverse = config.courseMode === COURSE_MODE.ROUND_STARBOARD;
  return { mode: config.courseMode ?? COURSE_MODE.ROUND_PORT,
    requiredTack: reverse ? 'port' : 'starboard', sign: reverse ? -1 : 1, roundingSide: reverse ? 'starboard' : 'port' };
}
// Capture original background direction; baseline is a compass offset only.
export function fixedUpwindFinish(initialDirection = 0, start = { x: 0, y: 0 }) {
  const up = direction(initialDirection), right = { x: up.y, y: -up.x };
  const center = { x: start.x + up.x * UPWIND_COURSE.distance, y: start.y + up.y * UPWIND_COURSE.distance };
  const half = UPWIND_COURSE.boatLength * UPWIND_COURSE.widthBoatLengths / 2;
  return { center, up, start: { x: center.x - right.x * half, y: center.y - right.y * half },
    end: { x: center.x + right.x * half, y: center.y + right.y * half }, initialDirection };
}
