import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTo, each } from './helpers.js';
import { DEFAULT_CONFIG, KNOT_TO_MPS } from '../src/engine/config.js';
import { optimize, search } from '../src/engine/optimizer.js';
import { replay } from '../src/engine/race.js';
import { createScenario } from '../src/engine/wind.js';
describe('changing-wind route search', () => {
    each([
        { windMode: 'persistent', seed: 1 },
        { windMode: 'persistent', seed: 6 },
        { windMode: 'oscillating', seed: 314159 },
        { windMode: 'oscillating', seed: 42, difficulty: 'hard' },
    ], 'finds and replays a legal route for %j', config => {
        const scenario = createScenario({ ...DEFAULT_CONFIG, courseLength: 300, ...config });
        const result = search(scenario, { interval: 2, width: 120, cell: 2 });
        assert.strictEqual(result.route?.finish.finished, true);
        const route = result.route;
        assert.strictEqual(route.finish.tack, 'starboard');
        assert.ok(route.finish.tacks >= 2);
        closeTo(route.finish.penaltyTime, route.finish.tacks * scenario.config.tackPenalty, 8);
        closeTo(route.finish.distance, (route.finish.time - route.finish.penaltyTime) * scenario.config.speedKnots * KNOT_TO_MPS, 7);
        assert.deepStrictEqual(replay(scenario, route.commands, route.finish.time + 1).finish, route.finish);
    }, 20000);
    it('retains a faster known player route and derives reproducible tack comparisons', { timeout: 20000 }, () => {
        const scenario = createScenario({ ...DEFAULT_CONFIG, courseLength: 100, windMode: 'steady' });
        const sailingTime = (100 + scenario.config.boatLength) / (5 * KNOT_TO_MPS / Math.sqrt(2));
        const commands = [{ time: 0, action: 'tack' }, { time: 5 + sailingTime / 2, action: 'tack' }];
        const player = replay(scenario, commands, sailingTime + 20);
        assert.strictEqual(player.finish.finished, true);
        const benchmark = optimize(scenario, commands, player.finish.time);
        assert.ok(benchmark.route?.finish.time <= player.finish.time + 1e-7);
        assert.strictEqual(benchmark.comparisons.length, 2);
        assert.strictEqual(benchmark.comparisons.every(c => c.delay === 10 && c.chosenTime === benchmark.route?.finish.time), true);
        assert.deepStrictEqual(optimize(scenario, commands, player.finish.time), benchmark);
    });
    it('handles the full default 1000 m course', { timeout: 30000 }, () => {
        const scenario = createScenario(DEFAULT_CONFIG);
        const result = search(scenario, { interval: 4, width: 100, cell: 4 });
        assert.strictEqual(result.route?.finish.finished, true);
        assert.ok(result.route?.finish.time < 900);
    });
    it('includes a known finished live-computer route as an incumbent', () => {
        const scenario = createScenario({ courseLength: 100, windMode: 'steady' });
        const sailingTime = (100 + scenario.config.boatLength) / (5 * KNOT_TO_MPS / Math.sqrt(2));
        const commands = [{ time: 0, action: 'tack' }, { time: 5 + sailingTime / 2, action: 'tack' }];
        const computer = replay(scenario, commands, sailingTime + 20);
        assert.ok(computer.finish.finished);
        const benchmark = optimize(scenario, undefined, undefined, [{ commands, time: computer.finish.time }]);
        assert.ok(benchmark.route.finish.time <= computer.finish.time + 1e-7);
        assert.deepEqual(replay(scenario, benchmark.route.commands, benchmark.route.finish.time + 1).finish, benchmark.route.finish);
    });
    it('stays close to the independent 1000 m steady-wind lower bound including both tack costs', { timeout: 30000 }, () => {
        const scenario = createScenario({ ...DEFAULT_CONFIG, windMode: 'steady' });
        const result = search(scenario, { interval: 2, width: 140, cell: 2 });
        const lowerBound = 1000 / (5 * KNOT_TO_MPS / Math.sqrt(2)) + 2 * scenario.config.tackPenalty;
        assert.strictEqual(result.route?.finish.finished, true);
        assert.ok(result.route.finish.time >= lowerBound - 1e-7);
        assert.ok(result.route.finish.time < lowerBound + 4);
        assert.strictEqual(result.route.finish.tacks, 2);
    });
});
