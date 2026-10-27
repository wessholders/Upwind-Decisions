import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../src/engine/wind.js';
import { initialBoat, applyAction, advance, canBearAway, sailingHeading, gateAimGeometry } from '../src/engine/physics.js';
import { validHeading, markApproachClearance } from '../src/engine/geometry.js';
import { createTrainer } from '../src/race-controller.js';
import { replay } from '../src/engine/race.js';
import { bearControlView } from '../src/views/bear-control.js';

const steady = () => createScenario({ windMode: 'steady' });
describe('selecting and explaining gate aiming', () => {
  it('explains the disabled control before starting and after finishing', () => {
    const scenario = steady(), boat = initialBoat();
    const ready = bearControlView({ scenario, boat, phase: 'ready' });
    assert.equal(ready.disabled, true); assert.match(ready.description, /Start sailing/);
    const finished = bearControlView({ scenario, boat: { ...boat, finished: true }, phase: 'finished' });
    assert.equal(finished.disabled, true); assert.match(finished.description, /leg is complete/);
  });
  it('lets the user arm gate aiming even when the gate is inside the no-go angle', () => {
    const trainer = createTrainer({ windMode: 'steady' });
    trainer.togglePause();
    assert.equal(canBearAway(trainer.state.boat, trainer.state.scenario), false);
    assert.equal(bearControlView(trainer.state).disabled, false);
    trainer.act('bear');
    assert.equal(trainer.state.boat.mode, 'gate');
    const control = bearControlView(trainer.state);
    assert.equal(control.disabled, false); assert.equal(control.pressed, true); assert.equal(control.state, 'armed');
    assert.match(control.description, /no-go/);
    assert.equal(sailingHeading(trainer.state.boat, trainer.state.scenario), -45);
    trainer.tick(0.1);
    assert.equal(trainer.state.boat.tack, 'starboard');
    assert.deepEqual(replay(trainer.state.scenario, trainer.state.commands, trainer.state.boat.time).finish, trainer.state.boat);
    trainer.act('close');
    assert.equal(trainer.state.boat.mode, 'close'); assert.equal(bearControlView(trainer.state).pressed, false);
  });
  it('explains the tack lockout and enables steering again once it is complete', () => {
    const scenario = steady(), boat = applyAction(initialBoat(), 'tack', scenario);
    const locked = bearControlView({ scenario, boat, phase: 'sailing' });
    assert.equal(locked.disabled, true); assert.match(locked.description, /tack is complete/);
    assert.equal(applyAction(boat, 'bear', scenario), boat);
    const settled = advance(boat, scenario, scenario.config.tackPenalty);
    assert.equal(bearControlView({ scenario, boat: settled, phase: 'sailing' }).disabled, false);
  });
  it('actually turns toward a legally reachable gate and finishes on the same tack', () => {
    const scenario = steady(), before = { ...initialBoat(), position: { x: 200, y: 1000 } };
    const boat = applyAction(before, 'bear', scenario), geometry = gateAimGeometry(boat, scenario);
    assert.equal(canBearAway(before, scenario), true);
    assert.equal(bearControlView({ scenario, boat, phase: 'sailing' }).state, 'active');
    assert.equal(sailingHeading(boat, scenario), geometry.heading);
    assert.ok(Math.abs(geometry.turnDegrees) > 20);
    const finish = advance(boat, scenario, 100);
    assert.equal(finish.finished, true); assert.equal(finish.tack, 'starboard'); assert.equal(finish.tacks, 0);
  });
  it('switches an armed course to active steering after a wind change makes it legal', () => {
    const scenario = steady();
    scenario.wind = [{ time: 0, direction: 0 }, { time: 5, direction: 0 }, { time: 10, direction: 25 }];
    let boat = applyAction({ ...initialBoat(), position: { x: 100, y: 900 } }, 'bear', scenario);
    assert.equal(bearControlView({ scenario, boat, phase: 'sailing' }).state, 'armed');
    for (let i = 0; i < 48; i++) {
      boat = advance(boat, scenario, 0.25);
      const wind = i >= 39 ? 25 : null;
      if (wind !== null) assert.ok(validHeading(sailingHeading(boat, scenario), wind, boat.tack, scenario.config.minAngle));
    }
    assert.equal(boat.mode, 'gate'); assert.equal(boat.tack, 'starboard');
    assert.equal(bearControlView({ scenario, boat, phase: 'sailing' }).state, 'active');
  });
  it('keeps an already aligned gate selectable and explains that no turn is needed', () => {
    const scenario = steady(), y = scenario.config.courseLength + markApproachClearance(scenario.config.boatLength) * Math.SQRT2 - 100;
    const boat = applyAction({ ...initialBoat(), position: { x: 100, y } }, 'bear', scenario);
    assert.equal(canBearAway(boat, scenario), false);
    const control = bearControlView({ scenario, boat, phase: 'paused' });
    assert.equal(control.disabled, false); assert.equal(control.state, 'active'); assert.match(control.description, /already/);
  });
  it('warns about a port finish, never tacks automatically, and cancels gate mode on a chosen tack', () => {
    const scenario = steady();
    const port = applyAction({ ...initialBoat(), position: { x: -200, y: 1000 }, tack: 'port' }, 'bear', scenario);
    const control = bearControlView({ scenario, boat: port, phase: 'sailing' });
    assert.equal(control.state, 'active'); assert.match(control.description, /only on starboard/);
    assert.equal(advance(port, scenario, 10).tack, 'port');
    const tacked = applyAction(port, 'tack', scenario); assert.equal(tacked.mode, 'close');
    const opposite = applyAction({ ...initialBoat(), position: { x: -200, y: 900 } }, 'bear', scenario);
    assert.match(bearControlView({ scenario, boat: opposite, phase: 'sailing' }).description, /opposite tack/);
  });
});
