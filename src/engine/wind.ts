import { validateConfig } from './config';
import type { Config, Scenario, WindKnot } from './types';

// Mulberry32: all randomness is consumed when creating the scenario, never by a frame.
export function randomFromSeed(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createScenario(config: Config): Scenario {
  validateConfig(config);
  const random = randomFromSeed(config.seed);
  const wind: WindKnot[] = [{ time: 0, direction: 0 }];
  if (config.windMode === 'persistent') {
    const start = 15 + random() * 90;
    const magnitude = config.maxShift * (0.6 + random() * 0.4) * (random() < 0.5 ? -1 : 1);
    wind.push({ time: start, direction: 0 }, { time: start + config.shiftDuration * (0.7 + random() * 0.6), direction: magnitude });
  } else if (config.windMode === 'oscillating') {
    const factor = { easy: 1.6, medium: 1, hard: 0.45 }[config.difficulty];
    // Cover even long, slow races. Outside this horizon the last direction is held.
    let time = 0;
    let last = 0;
    while (time < 18000) {
      time += (15 + random() * 50) * factor;
      wind.push({ time, direction: last });
      time += config.shiftDuration * factor * (0.65 + random() * 0.7);
      last = (random() * 2 - 1) * config.maxShift;
      wind.push({ time, direction: last });
    }
  }
  return { config: { ...config }, wind };
}

export function windAt(scenario: Scenario, time: number): number {
  const knots = scenario.wind;
  let low = 0, high = knots.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (knots[mid].time <= time) low = mid;
    else high = mid - 1;
  }
  const a = knots[low], b = knots[low + 1];
  if (!b || time <= a.time) return a.direction;
  const u = (time - a.time) / (b.time - a.time);
  const smooth = u * u * (3 - 2 * u);
  return a.direction + (b.direction - a.direction) * smooth;
}
