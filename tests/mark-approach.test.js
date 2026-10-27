import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../src/engine/wind.js';
import { initialBoat, applyAction, advance, gateAimGeometry, sailingHeading, canBearAway } from '../src/engine/physics.js';
import { direction, cross, subtract, closestMarkApproach, validHeading, markApproachClearance, markContactClearance } from '../src/engine/geometry.js';
import { gateEnd, finishFraction } from '../src/engine/finish.js';
import { observeCurrentWind, decideLiveComputer } from '../src/engine/live-computer.js';

const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
function tangentStart(scenario, wind, offWind, distance = 100) {
  const v = direction(wind - offWind), radius = markApproachClearance(scenario.config.boatLength);
  return { x: v.y * radius - v.x * distance,
    y: scenario.config.courseLength - v.x * radius - v.y * distance };
}
function segmentDistance(a, b, point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const u = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + u * dx - point.x, a.y + u * dy - point.y);
}

describe('close, clearance-safe windward mark rounding', () => {
  for (const windField of ['uniform', 'traveling', 'organic']) it(`accepts a 2° bear-away and clears the mark to port in ${windField} wind`, () => {
    const scenario = createScenario({ windField, windMode: 'steady', maxShift: 0, windContrast: 0, pressureExponent: 0 });
    let boat = applyAction({ ...initialBoat(), position: tangentStart(scenario, 0, 47) }, 'bear', scenario);
    const aim = gateAimGeometry(boat, scenario), mark = { x: 0, y: scenario.config.courseLength };
    assert.ok(aim.legal); assert.ok(canBearAway(boat, scenario)); near(aim.turnDegrees, -2);
    assert.ok(aim.distanceFromMark < 5, 'Approach should cross beside the mark, not 50 m up the gate.');
    let last = boat, minimum = Infinity;
    for (let i = 0; i < 500 && !boat.finished; i++) {
      last = boat; boat = advance(boat, scenario, 0.25);
      minimum = Math.min(minimum, segmentDistance(last.position, boat.position, mark));
    }
    assert.ok(boat.finished); assert.equal(boat.tack, 'starboard'); assert.equal(boat.tacks, 0);
    assert.ok(minimum >= markContactClearance(scenario.config.boatLength), 'The swept hull/buoy envelope must stay clear; navigation margin covers integration error.');
    assert.ok(boat.position.y > mark.y && boat.position.y < mark.y + 5);
    assert.ok(cross(subtract(boat.position, last.position), subtract(mark, boat.position)) > 0, 'Mark must be left to port.');
  });
  it('recovers after overstanding without diverting to the middle of the gate', () => {
    const scenario = createScenario({ windMode: 'steady' });
    const start = { ...initialBoat(), position: { x: 100, y: 1150 }, mode: 'gate' };
    const aim = gateAimGeometry(start, scenario);
    assert.ok(aim.legal); assert.ok(aim.distanceFromMark < 10);
    assert.ok(direction(sailingHeading(start, scenario)).y < 0);
    const finish = advance(start, scenario, 100);
    assert.ok(finish.finished); assert.ok(finish.position.y < 1010); assert.equal(finish.tacks, 0);
  });
  it('uses the same small-angle near-mark target for the live computer', () => {
    const scenario = createScenario({ windMode: 'steady' });
    const boat = { ...initialBoat(), position: tangentStart(scenario, 0, 47) };
    const observation = observeCurrentWind(scenario, boat), choice = decideLiveComputer(observation);
    assert.equal(choice.action, 'bear'); assert.match(choice.reason, /mark/);
  });
  it('holds its acquired safe tangent through the finish at different speeds and approach angles', () => {
    let approaches = 0;
    for (const windField of ['uniform', 'traveling', 'organic']) for (const speedKnots of [1, 5, 20]) {
      const scenario = createScenario({ windField, speedKnots, windMode: 'steady', maxShift: 0, windContrast: 0, pressureExponent: 0 });
      const mark = { x: 0, y: scenario.config.courseLength };
      for (const x of [0.2, 1, 2, 3, 4, 5, 10, 25, 100]) for (const y of [-100, -10, -3, 0, 3, 5, 10, 50, 150]) {
        const start = { ...initialBoat(), position: { x, y: mark.y + y } };
        if (!gateAimGeometry(start, scenario).legal) continue;
        let boat = applyAction(start, 'bear', scenario);
        const target = boat.markAimDistance, label = `${windField}, ${speedKnots} kn, (${x}, ${y})`;
        for (let i = 0; i < 2400 && !boat.finished; i++) {
          const previous = boat;
          boat = advance(boat, scenario);
          assert.ok(segmentDistance(previous.position, boat.position, mark) >= markContactClearance(scenario.config.boatLength) - 1e-7, label);
          near(boat.markAimDistance, target, 1e-6);
        }
        assert.ok(boat.finished, label);
        near(boat.position.y - mark.y, target, 1e-6);
        approaches++;
      }
    }
    assert.equal(approaches, 450);
  });
  it('counts an actual clear crossing even if the extended heading would pass through the mark', () => {
    const scenario = createScenario({ windMode: 'steady' }), y = scenario.config.courseLength;
    // A boat already beside the buoy can turn upwind and cross safely. Its
    // extrapolated past is not its sailed track and cannot invent a collision.
    near(finishFraction(scenario, { x: 0.1, y: y + 3.3 }, { x: -0.1, y: y + 3.5 }, 0, 1, 'starboard'), 0.5);
    assert.equal(finishFraction(scenario, { x: 0.1, y: y + 2.9 }, { x: -0.1, y: y + 3.1 }, 0, 1, 'starboard'), null);
  });
  it('revalidates an acquired approach as the gate rotates, still clearing the buoy and finishing', () => {
    for (const shift of [-25, 25]) {
      const scenario = createScenario({ windMode: 'steady' });
      scenario.wind = [{ time: 0, direction: 0 }, { time: 2, direction: 0 }, { time: 6, direction: shift }];
      const mark = { x: 0, y: scenario.config.courseLength };
      let boat = applyAction({ ...initialBoat(), position: { x: 100, y: mark.y + 50 } }, 'bear', scenario);
      for (let i = 0; i < 400 && !boat.finished; i++) {
        const previous = boat;
        boat = advance(boat, scenario);
        assert.ok(segmentDistance(previous.position, boat.position, mark) >= markContactClearance(scenario.config.boatLength));
      }
      assert.ok(boat.finished);
      assert.equal(boat.tacks, 0);
    }
  });
  it('stays legal and clear with rotated wind/gates and different close-hauled angles', () => {
    for (const wind of [-25, 15, 25]) for (const minAngle of [30, 45, 60]) {
      const scenario = createScenario({ windMode: 'steady', minAngle }); scenario.wind = [{ time: 0, direction: wind }];
      const boat = { ...initialBoat(), position: tangentStart(scenario, wind, minAngle + 2), mode: 'gate' };
      const aim = gateAimGeometry(boat, scenario);
      assert.ok(aim.legal); near(aim.turnDegrees, -2);
      const end = gateEnd(scenario, 0), mark = { x: 0, y: scenario.config.courseLength };
      near(cross(subtract(end, mark), subtract(aim.target, mark)), 0, 1e-6);
      assert.ok(validHeading(aim.heading, wind, 'starboard', minAngle));
      const finish = advance(boat, scenario, 80);
      assert.ok(finish.finished); assert.equal(finish.tack, 'starboard');
    }
  });
  it('selects the nearest safe legal crossing, checked against smaller targets independently', () => {
    const mark = { x: 0, y: 0 }, end = { x: 0, y: 100 }, radius = 3.25;
    for (const x of [-100, -10, 2, 10, 100]) for (const y of [-200, -50, 0, 50, 150]) for (const tack of ['starboard', 'port']) {
      const position = { x, y }, aim = closestMarkApproach(position, 0, tack, 45, mark, end, radius);
      if (!aim) continue;
      const length = Math.hypot(aim.target.x - x, aim.target.y - y);
      near(Math.abs(cross(subtract(aim.target, position), subtract(mark, position))) / length, radius, 1e-5);
      for (let s = 0; s < aim.distanceFromMark - 0.01; s += 0.1) {
        const vector = { x: -x, y: s - y }, h = Math.atan2(vector.x, vector.y) * 180 / Math.PI;
        const distance = Math.abs(cross(vector, subtract(mark, position))) / Math.hypot(vector.x, vector.y);
        assert.ok(distance < radius || !validHeading(h, 0, tack, 45));
      }
    }
  });
  it('does not award a clean finish to a crossing course through the buoy envelope', () => {
    const scenario = createScenario({ windMode: 'steady' }), y = scenario.config.courseLength;
    assert.equal(finishFraction(scenario, { x: 1, y }, { x: -1, y }, 0, 1, 'starboard'), null);
    assert.equal(finishFraction(scenario, { x: 1, y: y + 2 }, { x: -1, y: y + 4 }, 0, 1, 'starboard'), null);
    const safeY = y + markContactClearance(scenario.config.boatLength) * Math.SQRT2 + 0.5;
    near(finishFraction(scenario, { x: 1, y: safeY - 1 }, { x: -1, y: safeY + 1 }, 0, 1, 'starboard'), 0.5);
  });
});
