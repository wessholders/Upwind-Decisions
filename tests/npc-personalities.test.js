import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../src/engine/wind.js';
import { initialBoat, applyAction, advance } from '../src/engine/physics.js';
import { createLiveComputer, advanceLiveComputer } from '../src/engine/live-computer.js';
import { createNpcConfiguration, createPersonalityConfiguration } from '../src/engine/npc-config.js';
import { NPC_PERSONALITY_PRESETS, STRATEGIC_ATTRIBUTES, VALIDATED_ELITE_SKILL } from '../src/engine/npc-personalities.js';
import { observeRoutePlanner, observationBounds } from '../src/engine/npc-observation.js';
import { evaluateNpcPolicy } from '../src/engine/npc-policy.js';
import { rankStrategicForecasts, strategicCommitment, createStrategyAccumulator, accumulateStrategy, finishStrategy } from '../src/engine/npc-strategy.js';
import { generateStrategicRouteCandidates } from '../src/engine/npc-route-policy.js';
import { initialSideIndicator } from '../src/engine/npc-side-indicator.js';
import { fieldForScenario } from '../src/wind/field.js';
import { windVector } from '../src/wind/config.js';
import { forecastPlan, createForecastBudget, planAction } from '../src/engine/npc-forecast.js';
import { isImmutableNpcData } from '../src/engine/npc-data.js';
import { createTrainer } from '../src/race-controller.js';

const config = (id, extra = {}) => createNpcConfiguration({ personalityProfileId: id, skillId: 'advanced', ...extra });
function choice(id, o, extra = {}) {
  const configuration = config(id, extra);
  const commitment = configuration.strategy.commitSide ? { courseSide: { side: 'right', source: 'test-initial-indicator', initializedAt: 0, locked: true } } : {};
  return evaluateNpcPolicy({ configuration, observation: o, commitment });
}
const selected = result => result.options.find(option => option.candidateId === result.memory.plan?.id);

function pressureMap({ cx = -100, cy = 80, header = 0 } = {}) {
  const scenario = createScenario({ windField: 'organic', maxShift: 30 });
  fieldForScenario(scenario).sample = (x, y) => {
    const puff = Math.exp(-(((x - cx) / 60) ** 2 + ((y - cy) / 150) ** 2));
    const lift = Math.exp(-(((x - 110) / 100) ** 2 + ((y - 160) / 180) ** 2));
    const direction = -header * Math.max(puff, lift), speedKnots = 10 + 6 * puff;
    return { direction: (direction + 360) % 360, speedKnots, ...windVector(direction, speedKnots),
      kind: puff > 0.25 ? 'puff' : 'background', influence: puff };
  };
  return scenario;
}

describe('versioned eight-personality configuration', () => {
  it('preserves the exact requested weights and three independent skill choices', () => {
    const expected = [[17,17,12,6,18,30], [20,17,12,6,15,30], [17,20,12,6,15,30], [50,10,8,4,8,20],
      [10,50,8,4,8,20], [10,10,45,5,10,20], [10,10,8,45,7,20], [10,10,8,4,48,20]];
    Object.entries(NPC_PERSONALITY_PRESETS).forEach(([id, preset], index) => {
      assert.deepEqual(STRATEGIC_ATTRIBUTES.map(key => preset.weights[key]), expected[index]);
      for (const skillId of ['beginner', 'intermediate', 'advanced']) {
        const c = config(id, { skillId });
        assert.equal(c.skillId, skillId); assert.equal(c.personalityId, preset.personalityId);
        assert.equal(c.personalityVersion, 2); assert.equal(c.observationProfileId, `${skillId}-v1`);
        assert.deepEqual(createNpcConfiguration(JSON.parse(JSON.stringify(c))), c);
        assert.ok(isImmutableNpcData(c));
      }
    });
    assert.equal(createPersonalityConfiguration('elite-all-rounder').skillId, VALIDATED_ELITE_SKILL);
    assert.equal(createLiveComputer().configuration.policyId, 'legacy-reference');
  });

  it('supports serialized weight tuning, rejects invalid definitions, and preserves v1 identifiers', () => {
    const tuned = config('all-rounder-2', { attributeWeights: { pressure: 40, route: 10 } });
    assert.ok(Math.abs(Object.values(tuned.strategy.weights).reduce((a, b) => a + b, 0) - 100) < 1e-9);
    assert.deepEqual(createNpcConfiguration(JSON.parse(JSON.stringify(tuned))), tuned);
    for (const extra of [{ attributeWeights: { pressure: -1 } }, { attributeWeights: { hidden: 5 } },
      { attributeWeights: Object.fromEntries(STRATEGIC_ATTRIBUTES.map(key => [key, 0])) },
      { policyId: 'legacy-reference', skillProfileVersion: 1 }, { personalityId: 'shift_hunter' },
      { strategy: { version: 99, profileId: 'puff-hunter' } }]) assert.throws(() => config('puff-hunter', extra));
    assert.equal(createNpcConfiguration({ policyId: 'route-planner-v2', personalityId: 'puff_hunter' }).personalityVersion, 1);
  });
});

describe('normalized strategic gains and competence guard', () => {
  const o = observeRoutePlanner(createScenario({ windMode: 'steady' }), initialBoat());
  const make = (id, eta, extras = {}) => ({ plan: { id }, exhausted: false, estimatedSeconds: eta,
    progressMeters: 50, boat: { finished: false }, features: { pressure: 0.5, shifts: 0.5, current: 0.5,
      predictedTacks: 2, meanSide: -1, earlyLeftSeconds: 10, earlyRightSeconds: 0, ...extras } });
  const commitment = { courseSide: { side: 'right', initializedAt: 0, locked: true } };

  for (const [id, features] of [['puff-hunter', { pressure: 0.8 }], ['shift-hunter', { shifts: 0.8 }],
    ['tack-minimalist', { predictedTacks: 1 }], ['current-strategist', { current: 0.8 }],
    ['side-specialist', { meanSide: 1, earlyLeftSeconds: 0, earlyRightSeconds: 10 }]])
    it(`${id} can favor its attribute over a modest ETA loss`, () => {
      const forecasts = [make('fast', 100), make('preferred', 105, features), make('irrational', 180, features)];
      const result = rankStrategicForecasts(forecasts, o, config(id).strategy, commitment);
      assert.equal(result.ranked[0].forecast.plan.id, 'preferred');
      assert.ok(!result.ranked.some(r => r.forecast.plan.id === 'irrational'));
      assert.ok(result.ranked.every(r => Object.values(r.scores).every(v => Number.isFinite(v) && v >= 0 && v <= 1)));
      assert.ok(result.ranked.every(r => r.utility >= 0 && r.utility <= 1));
    });

  it('does not reward the fastest route a second time for its existing pressure/current advantage', () => {
    const f = [make('fast', 100, { pressure: 0.9, shifts: 0.9, current: 0.9 }), make('slow', 105)];
    const ranked = rankStrategicForecasts(f, o, config('elite-all-rounder').strategy, commitment).ranked;
    const fast = ranked.find(r => r.forecast.plan.id === 'fast');
    assert.equal(fast.scores.pressure, 0); assert.equal(fast.scores.shifts, 0); assert.equal(fast.scores.current, 0);
    assert.equal(fast.scores.route, 1);
  });

  it('does not let unreachable, budget-exhausted or retreating candidates win on environmental appeal', () => {
    const valid = make('valid', 100), bad = make('unreachable', null, { pressure: 1 });
    const exhausted = { ...make('partial', 80, { pressure: 1 }), exhausted: true };
    const retreat = { ...make('retreat', 101, { pressure: 1 }), progressMeters: -50 };
    assert.deepEqual(rankStrategicForecasts([valid, bad, exhausted, retreat], o, config('puff-hunter').strategy, commitment)
      .ranked.map(r => r.forecast.plan.id), ['valid']);
  });

  it('rejects repeated roll-tack VMG harvesting without sustained strategic support', () => {
    const hold = { ...make('hold', 100), plan: { id: 'hold', kind: 'hold', tackAt: null } };
    const repeated = { ...make('tack', 98), plan: { id: 'tack', kind: 'tack-now', tackAt: 40 } };
    const ranked = rankStrategicForecasts([hold, repeated], o, config('current-strategist').strategy, commitment,
      { lastTackTime: 30 }, { horizonSeconds: 60 }).ranked;
    assert.deepEqual(ranked.map(r => r.forecast.plan.id), ['hold']);
    repeated.features.pressure = 0.8;
    assert.ok(rankStrategicForecasts([hold, repeated], o, config('puff-hunter').strategy, commitment,
      { lastTackTime: 30 }, { horizonSeconds: 60 }).ranked.some(r => r.forecast.plan.id === 'tack'));
  });
});

describe('meaningful pressure/shift opportunities and feasible execution', () => {
  it('Puff Hunter accepts less direct steering and a bounded ETA loss to remain in stronger pressure', () => {
    const o = observeRoutePlanner(pressureMap(), initialBoat());
    const puff = choice('puff-hunter', o), balanced = choice('elite-all-rounder', o);
    assert.notDeepEqual(puff.action, balanced.action);
    assert.ok(selected(puff).features.pressure > selected(balanced).features.pressure);
    assert.ok(puff.memory.expectedSeconds > balanced.memory.expectedSeconds);
    assert.ok(puff.memory.expectedSeconds - balanced.memory.expectedSeconds <= puff.memory.strategy.etaBudgetSeconds);
    assert.equal(puff.action.type, 'steer'); assert.ok(puff.action.angle > o.minAngle);
  });

  it('Shift Hunter accepts a bounded route tradeoff for a better observed directional opportunity', () => {
    const o = observeRoutePlanner(pressureMap({ cx: -120, cy: 150, header: 20 }), initialBoat());
    const shift = choice('shift-hunter', o), puff = choice('puff-hunter', o);
    assert.ok(selected(shift).features.shifts > selected(puff).features.shifts);
    assert.notEqual(shift.memory.plan.id, puff.memory.plan.id);
  });

  it('generates actionable shared corridor candidates and honors turn/recovery limits', () => {
    const scenario = pressureMap({ cx: 130, cy: 60 });
    const o = observeRoutePlanner(scenario, initialBoat()), c = config('puff-hunter');
    const candidates = generateStrategicRouteCandidates(o, c.planning);
    assert.ok(candidates.some(p => p.kind === 'corridor'));
    assert.ok(candidates.length <= c.planning.maxCandidates);
    const opposite = candidates.find(p => p.postTackAngle !== null && p.postTackAngle !== undefined);
    assert.ok(opposite);
    const budget = createForecastBudget(c.planning.maxIntegrationSteps);
    const forecast = forecastPlan(o, opposite, c.planning, budget, true);
    assert.ok(forecast.boat.tacks >= 1); assert.ok(forecast.features);
    const maneuver = advance(applyAction(initialBoat(), 'tack', scenario), scenario, 2);
    assert.equal(planAction(opposite, maneuver), 'hold');
    const doneTurning = advance(maneuver, scenario, 2.5);
    assert.deepEqual(planAction(opposite, doneTurning), { type: 'steer', angle: opposite.postTackAngle });
    assert.ok(doneTurning.penaltyRemaining < 1e-8 && doneTurning.tackManeuver !== null);
  });

  it('represents a post-tack corridor with the same physical response as real steering during recovery', () => {
    const scenario = createScenario({ windMode: 'steady' }), o = observeRoutePlanner(scenario, initialBoat());
    const plan = { id: 'test-corridor', kind: 'corridor', startTack: 'starboard', angle: null, postTackAngle: 53, tackAt: 0, createdAt: 0 };
    const c = config('puff-hunter'), forecast = forecastPlan(o, plan, c.planning, createForecastBudget(4000), true);
    let actual = advance(applyAction(initialBoat(), 'tack', scenario), scenario, 4.5);
    actual = advance(applyAction(actual, { type: 'steer', angle: 53 }, scenario), scenario, 55.5);
    assert.ok(Math.hypot(forecast.boat.position.x - actual.position.x, forecast.boat.position.y - actual.position.y) < 1e-7);
    assert.ok(Math.abs(forecast.boat.speedKnots - actual.speedKnots) < 1e-7);
    assert.equal(forecast.boat.tacks, actual.tacks);
  });

  it('penalizes pocket exposure and keeps the current attribute neutral without current', () => {
    const scenario = createScenario({ windMode: 'steady' }), baseline = observeRoutePlanner(scenario, initialBoat());
    const exposures = [6, 10, 14].map(speed => {
      const map = { ...baseline.map, cells: baseline.map.cells.map(() => windVector(0, speed)) };
      const o = { ...baseline, map }, acc = createStrategyAccumulator(o);
      accumulateStrategy(acc, o, initialBoat(), { ...initialBoat(), time: 1, position: { x: -1, y: 1 } }, false);
      return finishStrategy(acc, 0, 1);
    });
    assert.ok(exposures[0].pressure < exposures[1].pressure && exposures[1].pressure < exposures[2].pressure);
    assert.ok(exposures.every(value => value.current === 0.5));
  });

  it('avoids the repeated-tack regression in persistent wind and oblique current', () => {
    const scenario = createScenario({ courseMode: 'finish-upwind', windField: 'organic', windMode: 'persistent',
      backgroundWindKnots: 14, favoredSide: 'left', shiftDirection: -1, maxShift: 20, seed: 314159,
      current: { enabled: true, speedKnots: 1, directionDegrees: 225 } });
    for (const id of ['current-strategist', 'tack-minimalist']) {
      const npc = createLiveComputer(config(id, { skillId: 'intermediate' }));
      for (let i = 0; i < 4800 && !npc.boat.finished; i++) advanceLiveComputer(npc, scenario, 0.25);
      assert.ok(npc.boat.finished, id); assert.ok(npc.boat.tacks <= 8, `${id}: ${npc.boat.tacks} tacks`);
    }
  });
});

describe('one-time limited side indication and immutable commitment', () => {
  it('receives only a side and provenance at time zero, without seed, future sampler or hindsight', () => {
    const scenario = createScenario({ favoredSide: 'left' }), o = observeRoutePlanner(scenario, initialBoat());
    assert.deepEqual(initialSideIndicator(scenario, o), { side: 'left', source: 'configured-side-bias' });
    assert.throws(() => initialSideIndicator(scenario, { ...o, time: 1 }));
    assert.throws(() => strategicCommitment(o, config('side-specialist').strategy, {}));
  });

  it('acquires its backend indication once and does not reassess when scenario bias changes', () => {
    const scenario = createScenario({ favoredSide: 'left', windMode: 'steady' });
    let reads = 0;
    Object.defineProperty(scenario.config, 'favoredSide', { configurable: true, get() { reads++; return reads === 1 ? 'left' : 'right'; } });
    const npc = createLiveComputer(createPersonalityConfiguration('side-specialist'));
    for (let i = 0; i < 120; i++) advanceLiveComputer(npc, scenario, 0.25);
    assert.equal(reads, 1); assert.equal(npc.commitment.courseSide.side, 'left');
    assert.equal(npc.commitment.courseSide.initializedAt, 0); assert.ok(npc.commitment.courseSide.locked);
  });

  it('honors the selected half while permitting legal final-quarter/mandatory navigation', () => {
    const o = observeRoutePlanner(createScenario({ windMode: 'steady', favoredSide: 'left' }), initialBoat());
    const c = config('side-specialist'), commitment = { courseSide: { side: 'left', source: 'test', initializedAt: 0, locked: true } };
    const result = evaluateNpcPolicy({ configuration: c, observation: o, commitment });
    assert.equal(selected(result).features.earlyRightSeconds, 0);
    const near = { ...initialBoat(), position: { x: 90, y: 935 } };
    const finishing = evaluateNpcPolicy({ configuration: c,
      observation: observeRoutePlanner(createScenario({ windMode: 'steady' }), near), commitment });
    assert.equal(finishing.action, 'bear'); assert.equal(finishing.commitment.courseSide.side, 'left');
  });
});

describe('personality information isolation, skill independence and deterministic clocks', () => {
  it('uses identical actual physics for all weighted configurations under identical inputs', () => {
    const scenario = createScenario({ windField: 'organic', current: { enabled: true, speedKnots: 1, directionDegrees: 90 } });
    let expected;
    for (const id of Object.keys(NPC_PERSONALITY_PRESETS)) {
      const npc = createLiveComputer(config(id)); npc.nextDecision = Infinity;
      npc.boat = applyAction(npc.boat, { type: 'steer', angle: 70 }, scenario);
      advanceLiveComputer(npc, scenario, 8);
      npc.boat = applyAction(npc.boat, 'tack', scenario); advanceLiveComputer(npc, scenario, 12);
      if (expected) assert.deepEqual(npc.boat, expected); else expected = npc.boat;
    }
  });

  it('all personalities use only permitted observations after the initial side bit', () => {
    const scenario = createScenario({ windField: 'organic', favoredSide: 'right' });
    const bounds = observationBounds(scenario.config, initialBoat(), 'beginner-v1');
    const field = fieldForScenario(scenario), original = field.sample.bind(field);
    field.sample = (x, y, time) => {
      assert.ok(x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY);
      assert.equal(time, 0); return original(x, y, time);
    };
    const o = observeRoutePlanner(scenario, initialBoat(), 'beginner-v1');
    field.sample = () => { throw new Error('Privileged query after observation'); };
    for (const id of Object.keys(NPC_PERSONALITY_PRESETS)) {
      const d = choice(id, o, { skillId: 'beginner' });
      assert.ok(isImmutableNpcData(o)); assert.ok(d.diagnostics.forecastSteps <= config(id, { skillId: 'beginner' }).planning.maxIntegrationSteps);
      assert.doesNotMatch(JSON.stringify(d), /hindsight|nextSpawn|lifetime|endTick/);
    }
  });

  it('identical observations with different hidden futures produce identical weighted decisions', () => {
    const a = createScenario({ windMode: 'steady', windField: 'traveling' }), b = createScenario({ windMode: 'steady', windField: 'traveling' });
    b.wind.push({ time: 20, direction: 0 }, { time: 30, direction: 25 });
    const boat = { ...initialBoat(), position: { x: 50, y: 1090 } };
    const oa = observeRoutePlanner(a, boat), ob = observeRoutePlanner(b, boat);
    assert.deepEqual(oa, ob);
    for (const id of Object.keys(NPC_PERSONALITY_PRESETS)) assert.deepEqual(choice(id, oa), choice(id, ob));
  });

  it('matches all four playback multipliers for a weighted corridor planner and a locked side', () => {
    for (const id of ['puff-hunter', 'side-specialist']) {
      let expected;
      for (const speed of [1, 4, 8, 16]) {
        const trainer = createTrainer({ courseLength: 300, windField: 'organic', favoredSide: 'left', opponentMode: 'npc' }, config(id));
        trainer.state.speed = speed; trainer.togglePause();
        for (let i = 0; i < 256 / speed; i++) trainer.tick(0.125);
        if (expected) assert.deepEqual(trainer.state.computer, expected); else expected = trainer.state.computer;
        trainer.reset(trainer.state.scenario.config); assert.deepEqual(trainer.state.computer.commitment, {});
      }
    }
  });
});
