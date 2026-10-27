import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../src/engine/wind.js';
import { initialBoat, applyAction, advance, sailingHeading, sailingSpeedKnots, targetSpeedKnots } from '../src/engine/physics.js';
import { createTack, maneuverSpeed } from '../src/engine/tack.js';
import { fieldForScenario } from '../src/wind/field.js';
import { observeCurrentWind, forecastObservedOption } from '../src/engine/live-computer.js';
import { createTrainer } from '../src/race-controller.js';
import { replay } from '../src/engine/race.js';

const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const steady = extra => createScenario({ windMode: 'steady', maxShift: 0, windContrast: 0, pressureExponent: 0, ...extra });

describe('moving expert roll tack', () => {
  for (const windField of ['uniform', 'traveling', 'organic']) it(`turns smoothly for 4.5 s, bottoms near 4 kn and recovers by 8 s in ${windField} wind`, () => {
    const scenario = steady({ windField });
    let boat = applyAction(initialBoat(), 'tack', scenario), minimum = Infinity, minimumTime = 0;
    near(sailingHeading(boat, scenario), -45); near(sailingSpeedKnots(boat, scenario), 5);
    for (let i = 1; i <= 160; i++) {
      const previous = boat, oldHeading = sailingHeading(boat, scenario);
      boat = advance(boat, scenario, 0.05);
      const speed = sailingSpeedKnots(boat, scenario), heading = sailingHeading(boat, scenario);
      assert.ok(Math.hypot(boat.position.x - previous.position.x, boat.position.y - previous.position.y) > 0.1);
      assert.ok(heading >= oldHeading - 1e-8 && heading <= 45 + 1e-8);
      assert.ok(Math.abs(heading - oldHeading) < 2);
      assert.ok(Math.abs(speed - sailingSpeedKnots(previous, scenario)) < 0.03);
      if (speed < minimum) { minimum = speed; minimumTime = boat.time; }
      if (i < 90) assert.ok(heading < 45);
      if (i === 90) { near(heading, 45); near(boat.penaltyRemaining, 0); }
    }
    near(minimum, 4, 0.002); assert.ok(minimumTime > 3 && minimumTime < 4);
    near(sailingSpeedKnots(boat, scenario), 5); near(boat.penaltyTime, 4.5);
    assert.equal(boat.tackManeuver, null);
    // A complete roll tack still loses some VMG relative to straight sailing.
    assert.ok(boat.position.y < advance(initialBoat(), scenario, 8).position.y);
  });
  it('mirrors the same trajectory and speed profile in either tack direction', () => {
    const scenario = steady();
    let left = applyAction(initialBoat(), 'tack', scenario);
    let right = applyAction({ ...initialBoat(), tack: 'port' }, 'tack', scenario);
    for (let i = 0; i < 160; i++) {
      left = advance(left, scenario, 0.05); right = advance(right, scenario, 0.05);
      near(left.position.x, -right.position.x); near(left.position.y, right.position.y);
      near(sailingHeading(left, scenario), -sailingHeading(right, scenario));
      near(sailingSpeedKnots(left, scenario), sailingSpeedKnots(right, scenario));
    }
  });
  it('converges across 30/60/144 Hz and larger batches', () => {
    const scenario = steady(), start = applyAction(initialBoat(), 'tack', scenario);
    const reference = advance(start, scenario, 8);
    for (const dt of [1 / 30, 1 / 60, 1 / 144, 0.25]) {
      let boat = start;
      while (boat.time < 8 - 1e-9) boat = advance(boat, scenario, Math.min(dt, 8 - boat.time));
      assert.ok(Math.hypot(boat.position.x - reference.position.x, boat.position.y - reference.position.y) < 0.002);
      near(boat.distance, reference.distance, 0.0002); near(boat.penaltyTime, 4.5);
      near(sailingSpeedKnots(boat, scenario), 5);
    }
  });
  it('does not let repeated commands reset a turn or its speed recovery', () => {
    const scenario = steady(), start = applyAction(initialBoat(), 'tack', scenario);
    for (const time of [0.1, 2, 4.5, 6, 7.99]) {
      const boat = advance(start, scenario, time);
      assert.equal(applyAction(boat, 'tack', scenario), boat);
      if (time < 4.5) assert.equal(applyAction(boat, 'bear', scenario), boat);
      else assert.equal(applyAction(boat, 'close', scenario).tackManeuver, boat.tackManeuver);
    }
    const recovered = advance(start, scenario, 8), next = applyAction(recovered, 'tack', scenario);
    assert.equal(next.tacks, 2); near(next.tackManeuver.entrySpeed, 5);
  });
  it('accepts tuning without changing straight sailing or adding a low-speed floor', () => {
    const scenario = steady({ tackPenalty: 3, tackMinSpeedFraction: 0.9, tackRecoverySeconds: 6 });
    const start = applyAction(initialBoat(), 'tack', scenario);
    near(sailingSpeedKnots(advance(start, scenario, 2.4), scenario), 4.5);
    near(sailingHeading(advance(start, scenario, 3), scenario), 45);
    near(sailingSpeedKnots(advance(start, scenario, 6), scenario), 5);
    const low = createTack(0, -45, 0, 0.001, 0.001, steady().config);
    near(maneuverSpeed(low, 3.6, 0.001), 0.0008);
    const stopped = createTack(0, -45, 0, 0, 0, steady().config);
    assert.equal(maneuverSpeed(stopped, 3.6, 0), 0);
    assert.ok(Number.isFinite(maneuverSpeed(stopped, 4, 0.001)));
    near(advance(initialBoat(), scenario, 10).distance, 10 * 5 * 1852 / 3600);
  });
  for (const kind of ['puff', 'pocket']) it(`keeps ${kind} pressure active while turning and recovers to the new wind target`, () => {
    const scenario = createScenario({ windField: 'organic', windMode: 'steady', seed: 2941,
      boatLength: 1, windSizeBL: 15, backgroundWindKnots: 30, windContrast: 70 });
    const patch = fieldForScenario(scenario).featuresAt(0).find(p => p.feature.kind === kind && p.y < 900);
    assert.ok(patch);
    const start = applyAction({ ...initialBoat(), position: { x: patch.x, y: patch.y } }, 'tack', scenario);
    let boat = start;
    for (let i = 0; i < 160; i++) {
      boat = advance(boat, scenario, 0.05);
      const target = targetSpeedKnots(boat, scenario), speed = sailingSpeedKnots(boat, scenario);
      assert.ok(speed > 0 && speed <= target + 1e-8);
      assert.ok(speed >= target * 0.8 - 1e-8);
    }
    near(sailingSpeedKnots(boat, scenario), targetSpeedKnots(boat, scenario));
    assert.ok(Math.abs(sailingSpeedKnots(boat, scenario) - start.tackManeuver.entrySpeed) > 0.05);
  });
  it('follows local wind shifts through the turn and joins the new close-hauled heading continuously', () => {
    const scenario = steady();
    scenario.wind = [{ time: 0, direction: 0 }, { time: 1, direction: 0 }, { time: 4, direction: 20 }];
    const start = applyAction(initialBoat(), 'tack', scenario);
    const before = advance(start, scenario, 4.499), after = advance(start, scenario, 4.501);
    near(sailingHeading(after, scenario), 65);
    assert.ok(Math.abs(sailingHeading(after, scenario) - sailingHeading(before, scenario)) < 0.001);
    assert.ok(Math.abs(sailingSpeedKnots(after, scenario) - sailingSpeedKnots(before, scenario)) < 0.001);
  });
  it('uses the same moving maneuver in the no-hindsight computer forecast', () => {
    const scenario = steady(), boat = initialBoat(), observation = observeCurrentWind(scenario, boat);
    const forecast = forecastObservedOption(observation, 'tack');
    const actual = advance(applyAction(boat, 'tack', scenario), scenario, 60);
    near(forecast.position.x, actual.position.x, 0.001); near(forecast.position.y, actual.position.y, 0.001);
    assert.equal(observation.tackManeuver, null);
  });
  it('replays in-progress turns and recovery exactly across pause and playback batches', () => {
    const trainer = createTrainer({ windMode: 'steady' });
    trainer.togglePause(); trainer.act('tack');
    for (let i = 0; i < 5; i++) trainer.tick(0.125);
    const paused = trainer.state.boat; trainer.togglePause(); trainer.tick(0.2);
    assert.equal(trainer.state.boat, paused);
    assert.deepEqual(replay(trainer.state.scenario, trainer.state.commands, paused.time).finish, paused);
    trainer.togglePause(); for (let i = 0; i < 10; i++) trainer.tick(0.125);
    assert.deepEqual(replay(trainer.state.scenario, trainer.state.commands, trainer.state.boat.time).finish, trainer.state.boat);
  });
});
