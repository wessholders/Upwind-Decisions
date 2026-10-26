import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../src/engine/wind.js';
import { initialBoat } from '../src/engine/physics.js';
import { observeCurrentWind, decideLiveComputer, createLiveComputer, advanceLiveComputer } from '../src/engine/live-computer.js';
import { createTrainer } from '../src/race-controller.js';
import { replay } from '../src/engine/race.js';
import { DEFAULT_CONFIG } from '../src/engine/config.js';

describe('live computer without hindsight', () => {
  it('bases identical decisions on identical current observations despite different future wind', () => {
    const a = createScenario({ windMode: 'steady' }), b = createScenario({ windMode: 'steady', seed: 1 });
    b.wind.push({ time: 20, direction: 0 }, { time: 30, direction: -25 });
    const oa = observeCurrentWind(a, initialBoat()), ob = observeCurrentWind(b, initialBoat());
    assert.deepEqual(oa, ob);
    assert.deepEqual(decideLiveComputer(oa), decideLiveComputer(ob));
    const serialized = JSON.stringify(oa);
    assert.doesNotMatch(serialized, /seed|scenario|lifetime|nextSpawn|knots|schedule|endTick/);
    assert.deepEqual(decideLiveComputer(structuredClone(oa)), decideLiveComputer(oa));
  });
  it('finishes steady, shifting and organic courses using only its live decision loop', { timeout: 20000 }, () => {
    for (const config of [
      { windMode: 'steady' }, { windMode: 'oscillating', seed: 42 },
      { windField: 'organic', windMode: 'steady' }, { windField: 'organic', seed: 314159 },
      { courseLength: 1000, windField: 'organic', seed: 314159 },
    ]) {
      const scenario = createScenario({ courseLength: 300, ...config }), computer = createLiveComputer();
      for (let i = 0; i < 4000 && !computer.boat.finished; i++) advanceLiveComputer(computer, scenario, 0.25);
      assert.ok(computer.boat.finished, JSON.stringify({ config, boat: computer.boat, log: computer.decisions }));
      assert.equal(computer.boat.tack, 'starboard');
      assert.ok(computer.decisions.length >= 2);
      assert.deepEqual(replay(scenario, computer.commands, computer.boat.time + 1).finish, computer.boat);
    }
  });
  it('shares the player clock and freezes/resets both boats deterministically', () => {
    const a = createTrainer(), b = createTrainer(); a.togglePause(); b.togglePause();
    for (let i = 0; i < 100; i++) a.tick(0.05);
    for (let i = 0; i < 50; i++) b.tick(0.1);
    assert.deepEqual(a.state.computer, b.state.computer); assert.equal(a.state.raceTime, b.state.raceTime);
    a.togglePause(); const frozen = structuredClone(a.state.computer);
    a.tick(0.2); assert.deepEqual(a.state.computer, frozen);
    a.togglePause(); a.tick(0.2, true); assert.deepEqual(a.state.computer, frozen);
    a.reset(a.state.scenario.config); assert.equal(a.state.computer.boat.time, 0); assert.equal(a.state.raceTime, 0);
    assert.equal(a.state.computer.decisions.length, 0);
  });
  it('sails two strategic legs in steady aligned wind instead of reversing on every forecast update', () => {
    const scenario = createScenario({ courseLength: 100, windMode: 'steady' }), computer = createLiveComputer();
    for (let i = 0; i < 2000 && !computer.boat.finished; i++) advanceLiveComputer(computer, scenario, 0.25);
    assert.ok(computer.boat.finished); assert.equal(computer.boat.tacks, 2);
    assert.equal(computer.commands[0].time, 0);
    assert.ok(computer.commands.filter(c => c.action === 'tack')[1].time > 30);
  });
  it('lets the computer keep racing after the player finishes without changing the player result', () => {
    const trainer = createTrainer({ ...DEFAULT_CONFIG, windField: 'organic', windMode: 'steady', courseLength: 100, maxShift: 0 });
    trainer.togglePause(); trainer.act('tack');
    for (let i = 0; i < 3000 && !trainer.state.boat.finished; i++) {
      if (trainer.state.boat.tack === 'port' && trainer.state.boat.position.y >= 55) trainer.act('tack');
      trainer.tick(0.0625);
    }
    assert.ok(trainer.state.boat.finished);
    const finish = trainer.state.boat, before = trainer.state.computer.boat.time;
    for (let i = 0; i < 2000 && !trainer.state.computer.boat.finished; i++) trainer.tick(0.0625);
    assert.equal(trainer.state.boat, finish); assert.ok(trainer.state.computer.boat.finished);
    assert.ok(trainer.state.computer.boat.time >= before);
  });
});
