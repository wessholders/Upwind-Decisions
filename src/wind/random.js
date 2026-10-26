// Separate streams for scenario scheduling, feature generation, and presentation.
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const between = (random, a, b) => a + (b - a) * random();
export const exponential = (random, mean) => -Math.log(Math.max(1e-12, 1 - random())) * mean;
