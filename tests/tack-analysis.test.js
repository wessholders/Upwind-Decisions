import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario, windSampleAtPosition } from '../src/engine/wind.js';
import { optimize, search } from '../src/engine/optimizer.js';
import { initialBoat, sailingHeading } from '../src/engine/physics.js';
import { replay } from '../src/engine/race.js';
import { stateBeforeCommand, traceTackOption, describeTack } from '../src/engine/tack-analysis.js';
import { tackExplanationsView } from '../src/views/tack-explanations.js';

const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
describe('measured hindsight tack explanations', () => {
  it('reports exact local conditions and the actual pre-command state for every tack', () => {
    const scenario = createScenario({ courseLength: 100, windField: 'organic', seed: 8 });
    const result = optimize(scenario);
    assert.ok(result.route?.finish.finished);
    assert.equal(result.comparisons.length, result.route.commands.filter(c => c.action === 'tack').length);
    for (const c of result.comparisons) {
      const index = result.route.commands.findIndex(command => command.time === c.time && command.action === 'tack');
      assert.deepEqual(c.boat, stateBeforeCommand(scenario, result.route, index).boat);
      const wind = windSampleAtPosition(scenario, c.boat.position.x, c.boat.position.y, c.time);
      near(c.wind.speedKnots, wind.speedKnots); near(c.wind.direction, wind.direction);
      near(c.oldHeading, (sailingHeading(c.boat, scenario) % 360 + 360) % 360);
      assert.equal(c.fromTack, c.boat.tack); assert.notEqual(c.toTack, c.fromTack);
      assert.equal(c.delay, 10); assert.equal(c.chosenTime, result.route.finish.time);
      if (c.continuedTime !== null) near(c.finishDifference, c.continuedTime - c.chosenTime);
    }
    assert.equal(result.comparisons.at(-1).finalTack, true);
    assert.equal(result.comparisons.at(-1).toTack, 'starboard');
    assert.doesNotThrow(() => structuredClone(result));
  });
  it('counts continuous movement and turn time without inventing a pressure gain', () => {
    const scenario = createScenario({ windMode: 'steady' }), boat = initialBoat();
    const now = traceTackOption(scenario, boat, true), hold = traceTackOption(scenario, boat, false);
    near(now.averageWindKnots, 10); near(hold.averageWindKnots, 10);
    near(now.penaltySeconds, 4.5); near(hold.penaltySeconds, 0);
    near(now.movingSeconds, 30); near(hold.movingSeconds, 30);
    assert.ok(now.upCourseMeters < hold.upCourseMeters);
  });
  it('identifies a header versus a lift on the previous starboard tack', () => {
    for (const [angle, expected] of [[-10, 'header'], [10, 'lift']]) {
      const scenario = createScenario({ windMode: 'steady' });
      scenario.wind = [{ time: 0, direction: 0 }, { time: 5, direction: 0 }, { time: 10, direction: angle }];
      const route = replay(scenario, [{ time: 20, action: 'tack' }, { time: 60, action: 'tack' }], 80);
      const decision = stateBeforeCommand(scenario, route, 0);
      const c = describeTack(scenario, route, 0, 1, decision, { checked: true, continuedTime: 82, delay: 10 });
      assert.equal(c.trend, expected); near(c.observedWindChange, angle);
    }
  });
  it('makes ties, better alternatives, and failed searches explicit instead of fabricating a reason', () => {
    const scenario = createScenario({ courseLength: 100, windMode: 'steady' });
    const route = search(scenario, { interval: 2, width: 70, cell: 2 }).route;
    const index = route.commands.findIndex(c => c.action === 'tack'), decision = stateBeforeCommand(scenario, route, index);
    for (const [continuedTime, outcome, text] of [
      [route.finish.time + 0.1, 'near-tie', 'No clear timing advantage'],
      [route.finish.time - 2, 'alternative-faster', 'does not support this tack'],
      [null, 'unresolved', 'does not prove the tack was necessary'],
    ]) {
      const c = describeTack(scenario, route, index, 1, decision, { checked: true, continuedTime, delay: 10 });
      assert.equal(c.outcome, outcome);
      assert.ok(tackExplanationsView([c], { interval: 2, width: 140, cell: 2 }).includes(text));
    }
  });
  it('preserves earlier same-time commands when reconstructing a reference decision', () => {
    const scenario = createScenario({ windMode: 'steady', tackPenalty: 0 });
    const route = replay(scenario, [{ time: 0, action: 'bear' }, { time: 0, action: 'tack' }], 1);
    const decision = stateBeforeCommand(scenario, route, 1);
    assert.equal(decision.boat.time, 0); assert.equal(decision.boat.mode, 'gate'); assert.equal(decision.boat.tack, 'starboard');
  });
});
