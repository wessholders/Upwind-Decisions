import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_RACES } from './fixtures/npc-legacy-v1.js';
import { createScenario, windSampleAtPosition, windEntryHeight, windSourceTime } from '../src/engine/wind.js';
import { initialBoat, applyAction, advance } from '../src/engine/physics.js';
import { createLiveComputer, advanceLiveComputer, decideLiveComputer } from '../src/engine/live-computer.js';
import { decideLegacyComputer } from '../src/engine/npc-legacy-policy.js';
import { observeCurrentWind, observationBounds, sampleObservedMap } from '../src/engine/npc-observation.js';
import { createNpcConfiguration, SKILL_PROFILES, OBSERVATION_PROFILES, PERSONALITIES,
  PLANNED_NPC_ROSTER, observationProfile } from '../src/engine/npc-config.js';
import { evaluateNpcPolicy, LEGACY_REFERENCE_POLICY } from '../src/engine/npc-policy.js';
import { isImmutableNpcData } from '../src/engine/npc-data.js';
import { fieldForScenario } from '../src/wind/field.js';
import { windVector } from '../src/wind/config.js';
import { courseGeometry } from '../src/engine/course.js';
import { createTrainer } from '../src/race-controller.js';
import { replay } from '../src/engine/race.js';

function closeData(actual, expected, path = '') {
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) <= 1e-8, `${path}: ${actual} != ${expected}`);
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual), Object.keys(expected), path);
    for (const key of Object.keys(expected)) closeData(actual[key], expected[key], `${path}.${key}`);
  } else assert.equal(actual, expected, path);
}

const inside = (p, b) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const sample = (angle = 0, speedKnots = 10) => ({ direction: angle, speedKnots,
  ...windVector(angle, speedKnots), kind: 'background', influence: 0 });

describe('legacy NPC regression reference', () => {
  for (const fixture of LEGACY_RACES) it(`preserves the pre-refactor ${fixture.name} race`, () => {
    const scenario = createScenario(fixture.config), npc = createLiveComputer();
    for (let i = 0; i < 20000 && !npc.boat.finished && npc.status !== 'timed-out'; i++)
      advanceLiveComputer(npc, scenario, 0.25);
    assert.equal(npc.status, 'finished');
    assert.deepEqual(npc.commands, fixture.commands);
    closeData(npc.boat, fixture.finish, fixture.name);
    closeData(npc.decisions, fixture.decisions, `${fixture.name}.decisions`);
    assert.deepEqual(replay(scenario, npc.commands, npc.boat.time + 1).finish, npc.boat);
  });

  it('preserves the public decision API and does not retune the reference by personality or skill', () => {
    assert.equal(decideLiveComputer, decideLegacyComputer);
    const observation = observeCurrentWind(createScenario({ windMode: 'steady' }), initialBoat());
    const expected = decideLegacyComputer(observation, { lastTackTime: null });
    for (const skillId of [null, ...Object.keys(SKILL_PROFILES)]) for (const personalityId of Object.keys(PERSONALITIES)) {
      const configuration = createNpcConfiguration({ skillId, personalityId });
      const choice = evaluateNpcPolicy({ configuration, observation, memory: { lastTackTime: null } });
      assert.deepEqual({ action: choice.action, reason: choice.reason, options: choice.options }, expected);
    }
    assert.equal(LEGACY_REFERENCE_POLICY.id, 'legacy-reference');
    assert.equal(LEGACY_REFERENCE_POLICY.version, 1);
  });

  it('keeps the original full-course grid, exact samples and current course snapshot by default', () => {
    const scenario = createScenario({ windField: 'traveling' });
    const boat = { ...initialBoat(), time: 87, position: { x: 650, y: 45 } };
    const o = observeCurrentWind(scenario, boat);
    assert.deepEqual(o.map.bounds, { minX: -730, maxX: 730, minY: -80, maxY: 1180 });
    assert.equal(o.map.cols, 17); assert.equal(o.map.rows, 21);
    for (let iy = 0; iy < 21; iy++) for (let ix = 0; ix < 17; ix++) {
      const wind = windSampleAtPosition(scenario, -730 + ix / 16 * 1460, -80 + iy / 20 * 1260, boat.time);
      assert.deepEqual(o.map.cells[iy * 17 + ix], { vx: wind.vx, vy: wind.vy });
    }
    assert.deepEqual(o.gate, courseGeometry(scenario, boat.time));
    assert.deepEqual(o, observeCurrentWind(scenario, boat, 'legacy-v1'));
  });
});

describe('skill-dependent observation boundaries', () => {
  it('applies the documented coverage and grid density independently of personality', () => {
    const scenario = createScenario({ windMode: 'steady' });
    const boat = { ...initialBoat(), position: { x: 10, y: 100 } };
    const expected = {
      beginner: { minX: -90, maxX: 110, minY: 50, maxY: 300 },
      intermediate: { minX: -240, maxX: 260, minY: 25, maxY: 550 },
      advanced: { minX: -570, maxX: 590, minY: 20, maxY: 1100 },
    };
    for (const [id, skill] of Object.entries(SKILL_PROFILES)) {
      const o = observeCurrentWind(scenario, boat, skill.observationProfileId);
      const profile = OBSERVATION_PROFILES[skill.observationProfileId];
      assert.deepEqual(o.map.bounds, expected[id]);
      assert.equal(o.map.cells.length, profile.cols * profile.rows);
      const config = createNpcConfiguration({ skillId: id, personalityId: 'puff_hunter' });
      assert.equal(config.observationProfileId, profile.id);
    }
  });

  it('supports an explicit observation profile and rejects invalid or uncapped restricted coverage', () => {
    const scenario = createScenario({ boatLength: 10 });
    const profile = { ...OBSERVATION_PROFILES['beginner-v1'], id: 'test-profile', cols: 3, rows: 5,
      forwardBoatLengths: 6, aftBoatLengths: 2, lateralBoatLengths: 4 };
    const o = observeCurrentWind(scenario, initialBoat(), profile);
    assert.deepEqual(o.map.bounds, { minX: -40, maxX: 40, minY: -20, maxY: 60 });
    assert.equal(o.map.cells.length, 15);
    for (const change of [{ cols: 1 }, { rows: 66 }, { forwardBoatLengths: -1 },
      { upstreamLimit: 'legacy-unbounded' }, { precision: 'pretend-noisy' }])
      assert.throws(() => observationProfile({ ...profile, ...change }));
    assert.throws(() => createNpcConfiguration({ observationProfileId: profile }));
  });

  it('never samples outside permitted coverage, even indirectly through mark geometry or heading', () => {
    for (const profileId of ['beginner-v1', 'intermediate-v1', 'advanced-v1']) {
      const scenario = createScenario({ windField: 'organic' });
      const boat = { ...initialBoat(), mode: 'gate', time: 17, position: { x: 100, y: 20 } };
      const bounds = observationBounds(scenario.config, boat, profileId), calls = [];
      fieldForScenario(scenario).sample = (x, y, time) => {
        assert.ok(inside({ x, y }, bounds), `Unpermitted sample: ${x}, ${y}`);
        assert.equal(time, boat.time); calls.push({ x, y, time });
        return sample();
      };
      const o = observeCurrentWind(scenario, boat, profileId);
      assert.equal(calls.length, o.map.cells.length + 1);
      const callsBeforePolicy = calls.length;
      evaluateNpcPolicy({ configuration: createNpcConfiguration(), observation: o });
      sampleObservedMap(o, { x: 1e6, y: 1e6 });
      assert.equal(calls.length, callsBeforePolicy, 'Policy/map access cannot resample the scenario.');
    }
  });

  it('does not expose unseen mark wind through gate orientation or gate-mode boat telemetry', () => {
    const a = createScenario({ windField: 'organic' }), b = createScenario({ windField: 'organic' });
    const boat = { ...initialBoat(), mode: 'gate', time: 21, position: { x: 40, y: 20 } };
    const bounds = observationBounds(a.config, boat, 'beginner-v1');
    fieldForScenario(a).sample = () => sample();
    fieldForScenario(b).sample = (x, y) => inside({ x, y }, bounds) ? sample() : sample(25, 17);
    const oa = observeCurrentWind(a, boat, 'beginner-v1'), ob = observeCurrentWind(b, boat, 'beginner-v1');
    assert.deepEqual(oa, ob);
    assert.deepEqual(decideLegacyComputer(oa), decideLegacyComputer(ob));
    assert.notDeepEqual(observeCurrentWind(a, boat), observeCurrentWind(b, boat));
    const edge = sampleObservedMap(ob, { x: bounds.maxX, y: bounds.maxY });
    assert.deepEqual(sampleObservedMap(ob, { x: 1e6, y: 1e6 }), edge);
  });

  it('caps traveling observations at wind entry without changing the legacy upstream preview', () => {
    const a = createScenario({ windField: 'traveling', windMode: 'steady' });
    const b = createScenario({ windField: 'traveling', windMode: 'steady' });
    b.wind.push({ time: 20, direction: 0 }, { time: 30, direction: -25 });
    const entry = windEntryHeight(a);
    for (const y of [entry - 10, entry + 100]) for (const profileId of ['beginner-v1', 'intermediate-v1', 'advanced-v1']) {
      const boat = { ...initialBoat(), position: { x: 0, y } };
      const oa = observeCurrentWind(a, boat, profileId), ob = observeCurrentWind(b, boat, profileId);
      assert.deepEqual(oa, ob);
      assert.ok(oa.map.bounds.maxY <= entry);
      assert.equal(oa.perception.windSamplePosition.y, Math.min(y, entry));
      assert.equal(oa.perception.localWindAtBoat, y <= entry);
      for (let iy = 0; iy < oa.map.rows; iy++) {
        const yy = oa.map.bounds.minY + iy / (oa.map.rows - 1) * (oa.map.bounds.maxY - oa.map.bounds.minY);
        assert.ok(windSourceTime(a, yy, boat.time) <= boat.time);
      }
      assert.notDeepEqual(observeCurrentWind(a, boat), observeCurrentWind(b, boat));
    }
  });

  it('returns immutable detached data without scenarios, callbacks, schedules or hidden descriptor properties', () => {
    const scenario = createScenario({ courseMode: 'finish-upwind', windField: 'organic' });
    scenario.config.current = { ...scenario.config.current, hiddenSchedule: [123] };
    scenario.course.hiddenSchedule = [456]; scenario.course.start.hiddenSchedule = [789];
    const before = structuredClone(scenario);
    for (const profileId of Object.keys(OBSERVATION_PROFILES)) {
      const o = observeCurrentWind(scenario, initialBoat(), profileId);
      assert.ok(isImmutableNpcData(o));
      assert.deepEqual(structuredClone(o), o);
      // JSON normalizes the existing wind vectors' signed zero; do not change
      // legacy numeric observations merely to make deepStrictEqual accept it.
      closeData(JSON.parse(JSON.stringify(o)), o);
      assert.doesNotMatch(JSON.stringify(o), /seed|scenario|hiddenSchedule|lifetime|nextSpawn|endTick|hindsight/);
      assert.throws(() => { o.map.cells[0].vx = 99; }, TypeError);
      assert.throws(() => { o.gate.start.x = 99; }, TypeError);
      assert.equal(Object.isFrozen(scenario.course.start), false);
    }
    assert.deepEqual(scenario, before);
  });
});

describe('independent NPC configuration and policy state', () => {
  it('serializes versioned configuration and seeded variation without choosing random assignments', () => {
    const parameters = { reserved: 0.2, tags: ['reserved'] };
    const config = createNpcConfiguration({ id: 'npc-a', skillId: 'beginner', personalityId: 'current_strategist',
      variation: { seed: 42, parameters } });
    const restored = createNpcConfiguration(JSON.parse(JSON.stringify(config)));
    assert.deepEqual(restored, config); assert.ok(isImmutableNpcData(config));
    parameters.tags.push('caller-change');
    assert.deepEqual(config.variation.parameters.tags, ['reserved']);
    assert.equal(createNpcConfiguration().skillId, null, 'The legacy benchmark is unrated.');
    assert.equal(createNpcConfiguration().observationProfileId, 'legacy-v1');
    assert.equal(new Set(PLANNED_NPC_ROSTER.map(slot => slot.id)).size, 8);
    assert.equal(PLANNED_NPC_ROSTER.filter(slot => slot.personalityId === 'all_rounder').length, 3);
    assert.equal(PLANNED_NPC_ROSTER.at(-1).personalityId, 'current_strategist');
    assert.ok(Object.values(PERSONALITIES).every(p => p.status === 'identifier-only'));
  });

  it('rejects unknown versions, non-serializable data and invalid variation seeds', () => {
    for (const options of [{ skillId: 'expert' }, { personalityId: 'secret' }, { policyId: 'hindsight' },
      { policyVersion: 2 }, { skillProfileVersion: 2 }, { personalityVersion: 2 }, { schemaVersion: 2 },
      { observationProfileId: 'missing' }, { variation: { seed: -1, parameters: {} } },
      { variation: { seed: 1, parameters: { callback() {} } } },
      { variation: { seed: 1, parameters: { number: Infinity } } }])
      assert.throws(() => createNpcConfiguration(options));
    assert.throws(() => evaluateNpcPolicy({ configuration: { policyId: 'unknown', policyVersion: 1 } }));
  });

  it('keeps mutable planning memory and commitment separate from immutable configuration and other boats', () => {
    const config = createNpcConfiguration({ variation: { seed: 7, parameters: { reserved: [1] } } });
    const a = createLiveComputer(config), b = createLiveComputer(config);
    a.planningMemory.history = [{ action: 'hold' }]; a.commitment.notes = ['reserved'];
    assert.deepEqual(b.planningMemory, {}); assert.deepEqual(b.commitment, {});
    assert.notEqual(a.configuration.variation.parameters, b.configuration.variation.parameters);
    assert.notEqual(a.boat.position, b.boat.position);
    const scenario = createScenario({ windMode: 'steady' });
    advanceLiveComputer(a, scenario, 0.25); advanceLiveComputer(b, scenario, 0.25);
    assert.deepEqual(b.planningMemory.history, undefined);
    assert.deepEqual(a.commitment.notes, ['reserved']);
    assert.ok(!Object.hasOwn(a.configuration, 'planningMemory'));
    const memory = { nested: { values: [1] } }, commitment = { notes: ['reserved'] };
    const observation = observeCurrentWind(scenario, initialBoat());
    const first = evaluateNpcPolicy({ configuration: config, observation, memory, commitment });
    const second = evaluateNpcPolicy({ configuration: config, observation, memory, commitment });
    first.memory.nested.values.push(2); first.commitment.notes.push('a');
    assert.deepEqual(second.memory, memory); assert.deepEqual(second.commitment, commitment);
    assert.deepEqual(memory.nested.values, [1]);
  });

  it('restores an initial configuration to the same independent deterministic race', () => {
    const config = createNpcConfiguration({ id: 'replay-a', skillId: 'intermediate', personalityId: 'shift_hunter',
      variation: { seed: 314159, parameters: {} } });
    const a = createLiveComputer(config), b = createLiveComputer(JSON.parse(JSON.stringify(config)));
    const sa = createScenario({ windField: 'organic' }), sb = createScenario({ windField: 'organic' });
    for (let i = 0; i < 160; i++) { advanceLiveComputer(a, sa, 0.25); advanceLiveComputer(b, sb, 0.25); }
    assert.deepEqual(a, b);
  });
});

describe('unchanged authoritative physics and controller integration', () => {
  it('produces identical player/NPC trajectories for identical steering and maneuver inputs', () => {
    for (const windField of ['uniform', 'traveling', 'organic']) {
      const scenario = createScenario({ windField, current: { enabled: true, speedKnots: 0.7, directionDegrees: 115 } });
      for (const skillId of [null, 'beginner', 'advanced']) {
        const npc = createLiveComputer({ skillId, personalityId: 'current_strategist' });
        npc.nextDecision = Infinity; // Controlled inputs, not strategic choices.
        let player = initialBoat();
        const actions = new Map([[0, 'tack'], [8, { type: 'steer', angle: 75 }], [12, 'close'],
          [20, 'bear'], [24, 'tack'], [32, { type: 'steer', angle: 90 }]]);
        for (let time = 0; time < 40; time += 0.25) {
          if (actions.has(time)) {
            player = applyAction(player, actions.get(time), scenario);
            npc.boat = applyAction(npc.boat, actions.get(time), scenario);
          }
          player = advance(player, scenario, 0.25); advanceLiveComputer(npc, scenario, 0.25);
          assert.deepEqual(npc.boat, player);
        }
      }
    }
  });

  it('keeps the existing single-opponent controller deterministic at 1x, 4x, 8x and 16x', () => {
    let expected;
    for (const speed of [1, 4, 8, 16]) {
      const trainer = createTrainer({ courseLength: 300, windField: 'organic', opponentMode: 'npc',
        current: { enabled: true, speedKnots: 0.35, directionDegrees: 115 } });
      trainer.state.speed = speed; trainer.togglePause();
      for (let i = 0; i < 512 / speed; i++) trainer.tick(0.125);
      assert.equal(trainer.state.raceTime, 64);
      if (expected) assert.deepEqual(trainer.state.computer, expected); else expected = trainer.state.computer;
      const paused = structuredClone(trainer.state.computer);
      trainer.togglePause(); trainer.tick(0.2); assert.deepEqual(trainer.state.computer, paused);
      trainer.togglePause(); trainer.tick(0.2, true); assert.deepEqual(trainer.state.computer, paused);
      trainer.reset(trainer.state.scenario.config);
      assert.equal(trainer.state.computer.configuration.observationProfileId, 'legacy-v1');
      assert.deepEqual(trainer.state.computer.planningMemory, {});
    }
  });
});
