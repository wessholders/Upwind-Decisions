export const WIND_STEP = 0.25;
export const KNOT = 1852 / 3600;
export const DEFAULT_WIND = Object.freeze({
  seed: 2941, regime: 'oscillating', favoredSide: 'balanced', probability: 0.65,
  frequency: 1.5, sizeBL: 35, maxShift: 15, windKnots: 10, contrast: 0.3,
  width: 720, height: 1000, boatLength: 5, translation: 1,
  puffProbability: 0.72, initialFeatures: 7,
  tempo: 1, transitionSeconds: 40,
});
export const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
export const smooth = x => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };
export const bearing = a => (a % 360 + 360) % 360;
export function windVector(from, knots) {
  const a = from * Math.PI / 180, speed = knots * KNOT;
  return { vx: -Math.sin(a) * speed, vy: -Math.cos(a) * speed };
}
export function windConfig(input = {}) {
  const config = { ...DEFAULT_WIND, ...input };
  const ranges = { seed: [0, 4294967295], probability: [0.5, 1], frequency: [0, 12],
    sizeBL: [15, 75], maxShift: [0, 30], windKnots: [1, 30], contrast: [0, 0.7],
    width: [400, 20000], height: [100, 10000], boatLength: [1, 30], translation: [0.1, 3],
    puffProbability: [0, 1], initialFeatures: [0, 30], tempo: [0.3, 2], transitionSeconds: [2, 300] };
  for (const [key, [low, high]] of Object.entries(ranges)) {
    if (!Number.isFinite(config[key]) || config[key] < low || config[key] > high)
      throw new Error(`Invalid wind setting: ${key}`);
  }
  if (!Number.isInteger(config.seed) || !Number.isInteger(config.initialFeatures)) throw new Error('Seed and initial count must be integers.');
  if (!['steady', 'oscillating', 'persistent'].includes(config.regime)) throw new Error('Invalid regime.');
  if (!['balanced', 'left', 'right'].includes(config.favoredSide)) throw new Error('Invalid favored side.');
  return Object.freeze(config);
}
