import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, KNOT_TO_MPS } from '../src/engine/config';
import { optimize, search } from '../src/engine/optimizer';
import { replay } from '../src/engine/race';
import { createScenario } from '../src/engine/wind';
import type { Config } from '../src/engine/types';

describe('changing-wind route search', () => {
  it.each([
    { windMode: 'persistent', seed: 1 },
    { windMode: 'persistent', seed: 6 },
    { windMode: 'oscillating', seed: 314159 },
    { windMode: 'oscillating', seed: 42, difficulty: 'hard' },
  ] as Partial<Config>[])('finds and replays a legal route for %j', config => {
    const scenario = createScenario({ ...DEFAULT_CONFIG, courseLength: 300, ...config });
    const result = search(scenario, { interval: 2, width: 120, cell: 2 });
    expect(result.route?.finish.finished).toBe(true);
    const route = result.route!;
    expect(route.finish.tack).toBe('starboard');
    expect(route.finish.tacks).toBeGreaterThanOrEqual(2);
    expect(route.finish.penaltyTime).toBeCloseTo(route.finish.tacks * scenario.config.tackPenalty, 8);
    expect(route.finish.distance).toBeCloseTo((route.finish.time - route.finish.penaltyTime) * scenario.config.speedKnots * KNOT_TO_MPS, 7);
    expect(replay(scenario, route.commands, route.finish.time + 1).finish).toEqual(route.finish);
  }, 20000);

  it('retains a faster known player route and derives reproducible tack comparisons', () => {
    const scenario = createScenario({ ...DEFAULT_CONFIG, courseLength: 100, windMode: 'steady' });
    const sailingTime = 100 / (5 * KNOT_TO_MPS / Math.sqrt(2));
    const commands = [{ time: 0, action: 'tack' as const }, { time: 5 + sailingTime / 2, action: 'tack' as const }];
    const player = replay(scenario, commands, sailingTime + 20);
    expect(player.finish.finished).toBe(true);
    const benchmark = optimize(scenario, commands, player.finish.time);
    expect(benchmark.route?.finish.time).toBeLessThanOrEqual(player.finish.time + 1e-7);
    expect(benchmark.comparisons.length).toBe(2);
    expect(benchmark.comparisons.every(c => c.delay === 2 && c.chosenTime === benchmark.route?.finish.time)).toBe(true);
    expect(optimize(scenario, commands, player.finish.time)).toEqual(benchmark);
  }, 20000);

  it('handles the full default 1000 m course', () => {
    const scenario = createScenario(DEFAULT_CONFIG);
    const result = search(scenario, { interval: 4, width: 100, cell: 4 });
    expect(result.route?.finish.finished).toBe(true);
    expect(result.route?.finish.time).toBeLessThan(900);
  }, 30000);

  it('stays close to the independent 1000 m steady-wind lower bound including both tack costs', () => {
    const scenario = createScenario({ ...DEFAULT_CONFIG, windMode: 'steady' });
    const result = search(scenario, { interval: 2, width: 140, cell: 2 });
    const lowerBound = 1000 / (5 * KNOT_TO_MPS / Math.sqrt(2)) + 2 * scenario.config.tackPenalty;
    expect(result.route?.finish.finished).toBe(true);
    expect(result.route!.finish.time).toBeGreaterThanOrEqual(lowerBound - 1e-7);
    expect(result.route!.finish.time).toBeLessThan(lowerBound + 4);
    expect(result.route!.finish.tacks).toBe(2);
  }, 30000);
});
