import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_JIB_DINGHY } from '../src/engine/boat-profile.js';
import { polarSpeedKnots, trueWindAngle, performanceTarget, speedResponse } from '../src/engine/performance.js';
import { createScenario, windSampleAtPosition } from '../src/engine/wind.js';
import { initialBoat, applyAction, advance, sailingHeading, sailingSpeedKnots, targetSpeedKnots } from '../src/engine/physics.js';
import { direction, markApproachClearance } from '../src/engine/geometry.js';
import { observeCurrentWind, forecastObservedOption } from '../src/engine/live-computer.js';
import { fieldForScenario } from '../src/wind/field.js';
import { search } from '../src/engine/optimizer.js';
import { replay } from '../src/engine/race.js';

const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const steady = extra => createScenario({ windMode: 'steady', maxShift: 0, windContrast: 0, ...extra });
function approach(scenario, angle, speedKnots = null, distance = 200) {
  const v = direction(-angle), r = markApproachClearance(scenario.config.boatLength);
  return applyAction({ ...initialBoat(), speedKnots,
    position: { x: v.y * r - v.x * distance, y: scenario.config.courseLength - v.x * r - v.y * distance } }, 'bear', scenario);
}

describe('provisional main + jib polar', () => {
  const supplied = [
    [0,0,0,0,0], [30,.8,1.2,1.5,1.7], [35,1.8,2.5,2.9,3], [40,3,4.1,4.5,4.6],
    [45,3.4,4.6,5.1,5.3], [50,3.6,4.9,5.5,5.8], [60,3.8,5.2,6,6.7], [75,4,5.6,7,8.5],
    [90,4.1,5.9,7.8,9.5], [105,4,6,8.2,10], [120,3.7,5.7,7.8,9.7],
    [135,3.3,5.2,7.1,8.8], [150,3,4.7,6.4,7.8], [165,2.7,4.2,5.6,6.9], [180,2.5,3.8,5,6.1],
  ];
  it('preserves all 60 supplied nodes in knots as editable profile data', () => {
    assert.deepEqual(MAIN_JIB_DINGHY.polar, supplied);
    for (const row of supplied) for (const [i, wind] of [6,10,14,18].entries()) near(polarSpeedKnots(row[0], wind), row[i + 1]);
    assert.equal(MAIN_JIB_DINGHY.sailPlan, 'Main + jib');
  });
  it('interpolates both axes continuously without overshooting adjacent nodes', () => {
    near(polarSpeedKnots(47.5, 12), 5.025);
    for (const row of supplied) for (const wind of [6,10,14,18]) {
      for (const delta of [-1e-6, 1e-6]) {
        near(polarSpeedKnots(row[0] + delta, wind), polarSpeedKnots(row[0], wind), 1e-5);
        near(polarSpeedKnots(row[0], wind + delta), polarSpeedKnots(row[0], wind), 1e-5);
      }
    }
  });
  it('uses the local FROM direction and gives equal port/starboard targets across wraparound', () => {
    near(trueWindAngle(350, 35), 45); near(trueWindAngle(80, 35), 45);
    near(trueWindAngle(180, 0), 180); near(trueWindAngle(-540, 0), 180);
    const scenario = steady();
    for (const from of [0, 35, 350]) for (const angle of [45, 60, 90, 180]) {
      near(performanceTarget(scenario.config, from + angle, { direction: from, speedKnots: 10 }),
        performanceTarget(scenario.config, from - angle, { direction: from, speedKnots: 10 }));
    }
  });
  it('matches the requested 10 kt targets and luffs below the allowed sailing angle outside tacks', () => {
    const config = steady().config, wind = { direction: 0, speedKnots: 10 };
    for (const [angle, speed] of [[45,4.6], [60,5.2], [90,5.9], [180,3.8]]) near(performanceTarget(config, angle, wind), speed);
    for (const angle of [0,10,30,35,40]) assert.equal(performanceTarget(config, angle, wind), 0);
    assert.ok(speedResponse(config, 4.6, 0, 20).end < 0.001);
  });
  it('extends below 6 kt to zero and above 18 kt smoothly, including boundary slopes', () => {
    for (const angle of [30,45,90,180]) {
      assert.equal(polarSpeedKnots(angle, 0), 0);
      assert.ok(polarSpeedKnots(angle, 1) > 0 && polarSpeedKnots(angle, 1) < polarSpeedKnots(angle, 6));
      assert.ok(polarSpeedKnots(angle, 30) > polarSpeedKnots(angle, 18));
      for (const edge of [6,18]) {
        const e = 1e-4, left = (polarSpeedKnots(angle, edge) - polarSpeedKnots(angle, edge-e)) / e;
        const right = (polarSpeedKnots(angle, edge+e) - polarSpeedKnots(angle, edge)) / e;
        near(left, right, 0.0001);
      }
      assert.ok(Number.isFinite(polarSpeedKnots(angle, 1000)));
    }
  });
});

describe('polar targets integrated with momentum and existing tacks', () => {
  it('accelerates gradually from 45 to 90 degrees and slows gradually toward 180', () => {
    const scenario = steady();
    const reach = approach(scenario, 90);
    near(sailingHeading(reach, scenario), -90); near(targetSpeedKnots(reach, scenario), 5.9);
    near(sailingSpeedKnots(reach, scenario), 4.6);
    const later = advance(reach, scenario, 3);
    assert.ok(sailingSpeedKnots(later, scenario) > 4.6 && sailingSpeedKnots(later, scenario) < 5.9);
    near(sailingSpeedKnots(later, scenario), 5.9 - 1.3 / Math.E, 0.00001);
    const run = approach(scenario, 177, 5.9);
    near(targetSpeedKnots(run, scenario), 3.88, 1e-6); near(sailingSpeedKnots(run, scenario), 5.9);
    const slowing = advance(run, scenario, 2);
    assert.ok(sailingSpeedKnots(slowing, scenario) < 5.9 && sailingSpeedKnots(slowing, scenario) > 3.88);
  });
  it('samples actual puff/pocket TWS without stacking the obsolete pressure multiplier', () => {
    const scenario = createScenario({ windField: 'organic', windMode: 'steady', seed: 2941 });
    for (const kind of ['puff','pocket']) {
      const patch = fieldForScenario(scenario).featuresAt(0).find(p => p.feature.kind === kind);
      const boat = { ...initialBoat(), position: { x: patch.x, y: patch.y } };
      const wind = windSampleAtPosition(scenario, patch.x, patch.y, 0);
      near(targetSpeedKnots(boat, scenario), polarSpeedKnots(45, wind.speedKnots));
      assert.ok(kind === 'puff' ? targetSpeedKnots(boat, scenario) > 4.6 : targetSpeedKnots(boat, scenario) < 4.6);
      const changedExponent = { ...scenario, config: { ...scenario.config, pressureExponent: 0 } };
      near(targetSpeedKnots(boat, changedExponent), targetSpeedKnots(boat, scenario));
    }
  });
  for (const kind of ['puff', 'pocket']) it(`updates targets and actual speed continuously while crossing a ${kind}`, () => {
    const scenario = createScenario({ windField: 'organic', windMode: 'steady', seed: 2941,
      boatLength: 1, windSizeBL: 15, backgroundWindKnots: 10, windContrast: 70 });
    const field = fieldForScenario(scenario), patch = field.featuresAt(0).find(p => p.feature.kind === kind && p.y < 900);
    // Freeze one real organic shape to isolate a spatial crossing from its
    // transport and other patches. Boat physics still samples local wind.
    field.featuresAt = () => [patch];
    const v = direction(-45), distance = patch.shape.bound + 5;
    let boat = { ...initialBoat(), position: { x: patch.x - v.x * distance, y: patch.y - v.y * distance } };
    let oldTarget = targetSpeedKnots(boat, scenario), oldSpeed = sailingSpeedKnots(boat, scenario);
    let minimum = oldTarget, maximum = oldTarget, lags = false;
    for (let i = 0; i < 1500; i++) {
      boat = advance(boat, scenario, .02);
      const target = targetSpeedKnots(boat, scenario), speed = sailingSpeedKnots(boat, scenario);
      assert.ok(Math.abs(target - oldTarget) < .15);
      assert.ok(Math.abs(speed - oldSpeed) < .04);
      minimum = Math.min(minimum, target); maximum = Math.max(maximum, target);
      lags ||= Math.abs(speed - target) > .02;
      oldTarget = target; oldSpeed = speed;
    }
    assert.ok(maximum - minimum > .1); assert.ok(lags);
  });
  for (const windField of ['uniform','traveling','organic']) it(`preserves every sample of the calibrated 5 kn tack in ${windField} wind`, () => {
    const polar = steady({ windField, speedScale: 5 / 4.6 });
    const legacy = steady({ windField, performanceModel: 'legacy-pressure' });
    let a = applyAction(initialBoat(), 'tack', polar), b = applyAction(initialBoat(), 'tack', legacy);
    for (let i = 0; i < 160; i++) {
      a = advance(a, polar, .05); b = advance(b, legacy, .05);
      near(sailingHeading(a, polar), sailingHeading(b, legacy));
      near(sailingSpeedKnots(a, polar), sailingSpeedKnots(b, legacy));
      near(a.position.x, b.position.x); near(a.position.y, b.position.y);
      assert.ok(sailingSpeedKnots(a, polar) >= 4 - 1e-8);
    }
    assert.equal(a.tackManeuver, null); near(a.penaltyTime, 4.5);
  });
  it('keeps entry momentum when tacking from a reach and joins the current polar smoothly at recovery', () => {
    const scenario = steady(), reaching = advance(approach(scenario, 90), scenario, 1);
    const start = applyAction(reaching, 'tack', scenario);
    near(sailingSpeedKnots(start, scenario), sailingSpeedKnots(reaching, scenario));
    const before = advance(start, scenario, 7.999), after = advance(start, scenario, 8.001);
    assert.ok(Math.abs(sailingSpeedKnots(before, scenario) - sailingSpeedKnots(after, scenario)) < .001);
    near(sailingSpeedKnots(after, scenario), 4.6, .001);
  });
  it('has negligible frame-rate variation during polar acceleration', () => {
    const scenario = steady(), start = approach(scenario, 90), reference = advance(start, scenario, 8);
    for (const dt of [1/30, 1/60, 1/144]) {
      let boat = start;
      while (boat.time < 8 - 1e-9) boat = advance(boat, scenario, Math.min(dt, 8 - boat.time));
      near(sailingSpeedKnots(boat, scenario), sailingSpeedKnots(reference, scenario));
      assert.ok(Math.hypot(boat.position.x - reference.position.x, boat.position.y - reference.position.y) < .002);
    }
  });
  it('shares the exact performance function with the current-observation computer forecast', () => {
    const scenario = steady(), start = approach(scenario, 90);
    const forecast = forecastObservedOption(observeCurrentWind(scenario, start), 'hold');
    const actual = advance(start, scenario, 60);
    near(forecast.position.x, actual.position.x, .001); near(forecast.position.y, actual.position.y, .001);
  });
  it('finds and exactly replays a default-polar hindsight route', { timeout: 20000 }, () => {
    const scenario = steady({ courseLength: 100 });
    const route = search(scenario, { interval: 2, width: 100, cell: 2 }).route;
    assert.ok(route?.finish.finished);
    assert.deepEqual(replay(scenario, route.commands, route.finish.time + 1).finish, route.finish);
    assert.ok(route.points.some(p => p.speedKnots > 4.6));
  });
});
