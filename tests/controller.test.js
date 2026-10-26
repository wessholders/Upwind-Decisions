import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTrainer } from '../src/race-controller.js';
import { DEFAULT_CONFIG } from '../src/engine/config.js';
import { replay } from '../src/engine/race.js';

describe('vanilla race lifecycle', () => {
  it('waits for start and freezes the race while paused or hidden', () => {
    const trainer = createTrainer();
    trainer.tick(0.2);
    assert.equal(trainer.state.boat.time, 0);
    trainer.togglePause();
    trainer.tick(0.2, true);
    assert.equal(trainer.state.boat.time, 0);
    trainer.tick(0.2);
    const moving = trainer.state.boat;
    assert.equal(moving.time, 0.75);
    trainer.togglePause();
    trainer.tick(0.2);
    assert.equal(trainer.state.boat, moving);
  });

  it('keeps playback speed and frame rate independent of the sailing model', () => {
    const one = createTrainer(), four = createTrainer();
    one.state.speed = 1;
    one.togglePause(); four.togglePause();
    for (let i = 0; i < 160; i++) one.tick(0.125);
    for (let i = 0; i < 40; i++) four.tick(0.125);
    assert.deepEqual(one.state.boat, four.state.boat);
    assert.deepEqual(one.state.track, four.state.track);
  });

  it('records controls that replay exactly through the shared engine', () => {
    const trainer = createTrainer();
    trainer.togglePause();
    trainer.act('tack');
    for (let i = 0; i < 40; i++) trainer.tick(0.125);
    trainer.act('tack');
    for (let i = 0; i < 40; i++) trainer.tick(0.125);
    const { scenario, commands, boat } = trainer.state;
    assert.deepEqual(replay(scenario, commands, boat.time).finish, boat);
    assert.equal(commands.length, 2);
    assert.equal(boat.penaltyTime, 10);
  });

  it('finishes an entire leg and cannot restart the finished clock', () => {
    const trainer = createTrainer({ ...DEFAULT_CONFIG, windMode: 'steady', courseLength: 100 });
    trainer.state.speed = 1;
    trainer.togglePause(); trainer.act('tack');
    for (let i = 0; i < 2000 && trainer.state.phase !== 'finished'; i++) {
      if (trainer.state.boat.tack === 'port' && trainer.state.boat.position.y >= 55) trainer.act('tack');
      trainer.tick(0.125);
    }
    assert.equal(trainer.state.phase, 'finished');
    assert.equal(trainer.state.boat.tack, 'starboard');
    const finish = trainer.state.boat;
    trainer.togglePause(); trainer.tick(0.2); trainer.act('tack');
    assert.equal(trainer.state.boat, finish);
    assert.deepEqual(replay(trainer.state.scenario, trainer.state.commands, finish.time + 1).finish, finish);
  });

  it('retries the same wind and clears race-specific state', () => {
    const trainer = createTrainer();
    const originalWind = trainer.state.scenario.wind;
    trainer.state.follow = true;
    trainer.togglePause(); trainer.act('tack'); trainer.tick(0.2);
    trainer.state.error = 'old result'; trainer.state.benchmark = {};
    trainer.reset(trainer.state.scenario.config);
    assert.deepEqual(trainer.state.scenario.wind, originalWind);
    assert.equal(trainer.state.revision, 1);
    assert.equal(trainer.state.phase, 'ready');
    assert.equal(trainer.state.boat.time, 0);
    assert.deepEqual(trainer.state.commands, []);
    assert.equal(trainer.state.error, null);
    assert.equal(trainer.state.benchmark, null);
    assert.equal(trainer.state.follow, true);
  });

  it('leaves the current race intact if new settings are invalid', () => {
    const trainer = createTrainer();
    trainer.togglePause(); trainer.tick(0.2);
    const boat = trainer.state.boat;
    assert.throws(() => trainer.reset({ ...DEFAULT_CONFIG, seed: NaN }));
    assert.equal(trainer.state.boat, boat);
    assert.equal(trainer.state.phase, 'sailing');
  });
});
