import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScenario } from '../src/engine/wind.js';
import { initialBoat, advance, applyAction } from '../src/engine/physics.js';
import { observeRoutePlanner, observationBounds } from '../src/engine/npc-observation.js';
import { forecastActions, createObservedEnvironment, createForecastBudget, ForecastBudgetExceeded,
  forecastPlan, planAction, routeNavigationAction } from '../src/engine/npc-forecast.js';
import { estimateRemainingTime } from '../src/engine/npc-route-eta.js';
import { generateRouteCandidates } from '../src/engine/npc-route-policy.js';
import { ROUTE_PLANNING_PROFILES, routePlanningProfile } from '../src/engine/npc-route-config.js';
import { createNpcConfiguration, PERSONALITIES } from '../src/engine/npc-config.js';
import { evaluateNpcPolicy } from '../src/engine/npc-policy.js';
import { createLiveComputer, advanceLiveComputer } from '../src/engine/live-computer.js';
import { fieldForScenario } from '../src/wind/field.js';
import { createTrainer } from '../src/race-controller.js';
import { replay } from '../src/engine/race.js';
import { isImmutableNpcData } from '../src/engine/npc-data.js';

const flow = (speedKnots, directionDegrees) => ({ enabled: true, speedKnots, directionDegrees });
const config = extra => createNpcConfiguration({ policyId: 'route-planner-v2', ...extra });
const observation = (scenario, boat = initialBoat(), profile = 'advanced-v1') => observeRoutePlanner(scenario, boat, profile);
function nearData(a, b, path = '') {
  if (typeof b === 'number') assert.ok(Math.abs(a - b) < 1e-7, `${path}: ${a} != ${b}`);
  else if (b && typeof b === 'object') {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
    for (const key of Object.keys(b)) nearData(a[key], b[key], `${path}.${key}`);
  } else assert.equal(a, b, path);
}
function actualCommands(scenario, start, commands, duration) {
  let boat = start, index = 0;
  const end = boat.time + duration;
  while (!boat.finished && boat.time < end - 1e-9) {
    while (index < commands.length && commands[index].time <= boat.time + 1e-8)
      boat = applyAction(boat, commands[index++].action, scenario);
    boat = advance(boat, scenario, Math.min(0.25, end - boat.time, (commands[index]?.time ?? Infinity) - boat.time));
  }
  return boat;
}

describe('observation-limited shared physics forecasts', () => {
  for (const windField of ['uniform', 'traveling', 'organic']) it(`matches equivalent actual ${windField} physics with wind/current, maneuvers and steering`, () => {
    for (const current of [flow(0, 0), flow(0.8, 0), flow(0.8, 180), flow(1.2, 90), flow(1.4, 235)]) {
      const scenario = createScenario({ courseLength: 5000, windMode: 'steady', windField, maxShift: 0, windContrast: 0, current });
      const commands = [{ time: 0, action: 'tack' }, { time: 8, action: { type: 'steer', angle: 75 } },
        { time: 16, action: 'close' }, { time: 20, action: 'tack' }, { time: 28, action: { type: 'steer', angle: 53 } }];
      const forecast = forecastActions(observation(scenario), commands, 40);
      nearData(forecast.boat, actualCommands(scenario, initialBoat(), commands, 40));
      assert.ok(forecast.steps > 160, 'Tack recovery uses the authoritative smaller integration steps.');
    }
  });

  it('retains in-progress turn state, prior penalties, speed and fractional timing', () => {
    const scenario = createScenario({ windMode: 'steady', current: flow(0.7, 90) });
    let boat = advance(applyAction(initialBoat(), 'tack', scenario), scenario, 2.37);
    const commands = [{ time: 3, action: 'tack' }, { time: 8.25, action: { type: 'steer', angle: 70 } }];
    const predicted = forecastActions(observation(scenario, boat), commands, 12).boat;
    nearData(predicted, actualCommands(scenario, boat, commands, 12));
    assert.equal(predicted.tacks, 1, 'Recovery rejects the attempted second tack.');
  });

  for (const courseMode of ['round-port', 'round-starboard', 'finish-upwind']) it(`matches legal finite ${courseMode} approaches under current`, () => {
    const scenario = createScenario({ courseMode, courseLength: 100, windMode: 'steady', current: flow(0.6, 90) });
    const reverse = courseMode === 'round-starboard';
    const boat = { ...initialBoat(), tack: reverse ? 'port' : 'starboard',
      position: { x: reverse ? -90 : 90, y: scenario.config.courseLength - 65 } };
    const commands = [{ time: 0, action: 'bear' }];
    const forecast = forecastActions(observation(scenario, boat), commands, 90).boat;
    assert.ok(forecast.finished); nearData(forecast, actualCommands(scenario, boat, commands, 90));
  });

  it('enforces a hard integration-step budget and validates controlled forecast timing', () => {
    const o = observation(createScenario({ windMode: 'steady' }));
    assert.throws(() => forecastActions(o, [], 60, 1), ForecastBudgetExceeded);
    assert.throws(() => forecastActions(o, [{ time: -1, action: 'tack' }], 10));
    assert.throws(() => forecastActions(o, [], 91));
    const settings = routePlanningProfile('advanced', { maxIntegrationSteps: 100 });
    const result = evaluateNpcPolicy({ configuration: config({ planning: settings }), observation: o });
    assert.equal(result.diagnostics.forecastSteps, 100);
    assert.ok(result.diagnostics.budgetExhausted);
    assert.ok(result.options.every(option => option.estimatedSeconds === null));
    assert.equal(result.action, 'hold');
  });
});

describe('current-aware legal terminal estimates', () => {
  it('orders favorable, zero and adverse current by vector ground progress', () => {
    const times = [flow(0.8, 0), flow(0, 0), flow(0.8, 180)].map(current => {
      const o = observation(createScenario({ windMode: 'steady', current }));
      const result = estimateRemainingTime(o, o.boat);
      assert.ok(result.reachable && result.seconds > 0); return result.seconds;
    });
    assert.ok(times[0] < times[1] && times[1] < times[2]);
  });

  it('accounts for lateral drift and required final tacks instead of adding scalar current speed', () => {
    const estimates = [0, 90, 180, 270, 225].map(directionDegrees => {
      const o = observation(createScenario({ windMode: 'steady', current: flow(1.2, directionDegrees) }));
      return estimateRemainingTime(o, o.boat);
    });
    assert.ok(estimates.every(e => e.reachable));
    assert.ok(new Set(estimates.map(e => e.seconds.toFixed(3))).size >= 4);
    assert.ok(estimates.every(e => e.futureTacks >= 1));
  });

  it('returns no finite ETA for adverse or near-zero progress that cannot reach the upwind destination', () => {
    for (const speed of [3, 3.4 * Math.SQRT1_2]) {
      const o = observation(createScenario({ windMode: 'steady', backgroundWindKnots: 6, current: flow(speed, 180) }));
      const eta = estimateRemainingTime(o, o.boat);
      assert.equal(eta.reachable, false); assert.equal(eta.seconds, null);
      const choice = evaluateNpcPolicy({ configuration: config(), observation: o });
      assert.equal(choice.memory.expectedSeconds, null);
      assert.ok(choice.options.every(option => option.estimatedSeconds === null));
      assert.match(choice.reason, /No finite legal ETA/);
    }
  });

  it('changes comparative tack/heading values when the current direction changes', () => {
    const results = [90, 270].map(directionDegrees => {
      const o = observation(createScenario({ windMode: 'steady', current: flow(2, directionDegrees) }));
      return evaluateNpcPolicy({ configuration: config(), observation: o });
    });
    assert.notDeepEqual(results[0].options.map(o => o.estimatedSeconds), results[1].options.map(o => o.estimatedSeconds));
  });
});

describe('bounded candidate planning and strategic memory', () => {
  it('offers hold, immediate/deferred tacks and legal upwind steering with skill-dependent budgets', () => {
    const o = observation(createScenario({ windMode: 'steady' }));
    for (const [id, settings] of Object.entries(ROUTE_PLANNING_PROFILES)) {
      const plans = generateRouteCandidates(o, settings);
      for (const kind of ['hold', 'tack-now', 'deferred-tack', 'steer']) assert.ok(plans.some(p => p.kind === kind), id);
      assert.ok(plans.length <= settings.maxCandidates);
      assert.ok(plans.filter(p => p.angle !== null).every(p => p.angle >= o.minAngle && p.angle <= 75));
      const result = evaluateNpcPolicy({ configuration: config({ skillId: id }), observation: o });
      assert.ok(result.diagnostics.forecastSteps <= settings.maxIntegrationSteps);
      assert.ok(result.options.every(p => p.forecastSeconds <= settings.horizonSeconds + 1e-8));
    }
  });

  it('does not offer an immediate tack during recovery or execute impossible maneuvers', () => {
    const scenario = createScenario({ windMode: 'steady' });
    const boat = advance(applyAction(initialBoat(), 'tack', scenario), scenario, 6);
    const o = observation(scenario, boat), settings = ROUTE_PLANNING_PROFILES.advanced;
    assert.ok(!generateRouteCandidates(o, settings).some(p => p.kind === 'tack-now'));
    const due = { id: 'due', kind: 'deferred-tack', startTack: boat.tack, tackAt: 5, angle: null, createdAt: 0 };
    assert.equal(planAction(due, boat), 'hold');
    assert.equal(evaluateNpcPolicy({ configuration: config(), observation: o, memory: { plan: due } }).action, 'hold');
  });

  it('retains a competitive deferred plan and executes its tack at the scheduled simulation timestamp', () => {
    const scenario = createScenario({ windMode: 'steady' });
    const npc = createLiveComputer({ policyId: 'route-planner-v2', planning: { switchingThresholdSeconds: 15, minimumPlanSeconds: 0 } });
    const o = observation(scenario);
    const plan = generateRouteCandidates(o, npc.configuration.planning).find(p => p.kind === 'deferred-tack');
    npc.planningMemory = { plan, lastStrategicChange: 0 };
    for (let i = 0; i < 40; i++) advanceLiveComputer(npc, scenario, 0.25);
    const tacks = npc.commands.filter(c => c.action === 'tack');
    assert.equal(tacks.length, 1); assert.equal(tacks[0].time, 8);
  });

  it('invalidates changed-tack plans and lets mandatory navigation override commitment', () => {
    const scenario = createScenario({ courseLength: 100, windMode: 'steady' });
    const obsolete = { id: 'old', kind: 'deferred-tack', startTack: 'port', tackAt: 8, angle: null, createdAt: 0 };
    const first = evaluateNpcPolicy({ configuration: config(), observation: observation(scenario), memory: { plan: obsolete } });
    assert.equal(first.memory.invalidation, 'maneuver-completed-or-tack-changed');
    const boat = { ...initialBoat(), position: { x: 90, y: 35 } };
    const next = evaluateNpcPolicy({ configuration: config(), observation: observation(scenario, boat), memory: { plan: obsolete } });
    assert.equal(next.action, 'bear'); assert.equal(next.memory.plan, null);
    assert.equal(next.memory.invalidation, 'mandatory-navigation');
  });

  it('does not retain a deteriorated plan solely because its commitment age is short', () => {
    const scenario = createScenario({ windMode: 'steady', current: flow(2, 90) });
    const o = observation(scenario);
    const bad = { id: 'bad', kind: 'steer', startTack: 'starboard', tackAt: null, angle: 75, createdAt: 0 };
    const result = evaluateNpcPolicy({ configuration: config(), observation: o, memory: { plan: bad, lastStrategicChange: 0 } });
    assert.notEqual(result.memory.plan.id, 'bad');
  });

  for (const courseMode of ['round-port', 'round-starboard', 'finish-upwind']) it(`finishes and replays ${courseMode} with current without repeated strategic reversals`, () => {
    const scenario = createScenario({ courseMode, courseLength: 100, windMode: 'steady', current: flow(0.35, 115) });
    for (const skillId of ['beginner', 'intermediate', 'advanced']) {
      const npc = createLiveComputer({ policyId: 'route-planner-v2', skillId });
      for (let i = 0; i < 6000 && !npc.boat.finished; i++) advanceLiveComputer(npc, scenario, 0.25);
      assert.ok(npc.boat.finished, skillId); assert.ok(npc.boat.tacks <= 3, skillId);
      assert.deepEqual(replay(scenario, npc.commands, npc.boat.time + 1).finish, npc.boat);
      assert.equal(npc.statistics.budgetExhaustions, 0);
    }
  });
});

describe('route policy information isolation and deterministic integration', () => {
  it('uses immutable own-state/public data and cannot resample hidden or future wind', () => {
    const scenario = createScenario({ windField: 'organic' });
    const boat = { ...initialBoat(), mode: 'gate' }, bounds = observationBounds(scenario.config, boat, 'beginner-v1');
    const field = fieldForScenario(scenario), sample = field.sample.bind(field);
    let queries = 0;
    field.sample = (x, y, time) => {
      assert.ok(x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY);
      assert.equal(time, boat.time); queries++; return sample(x, y, time);
    };
    const o = observation(scenario, boat, 'beginner-v1');
    assert.ok(isImmutableNpcData(o));
    assert.doesNotMatch(JSON.stringify(o), /seed|scenario|nextSpawn|lifetime|hindsight|endTick/);
    assert.equal(queries, o.map.cells.length + 1);
    field.sample = () => { throw new Error('Policy must not access authoritative wind.'); };
    forecastActions(o, [], 20);
    evaluateNpcPolicy({ configuration: config({ skillId: 'beginner' }), observation: o });
    assert.ok(queries > 0);
  });

  it('chooses identically in worlds with identical observations but different future schedules', () => {
    const a = createScenario({ windMode: 'steady', windField: 'traveling' });
    const b = createScenario({ windMode: 'steady', windField: 'traveling' });
    b.wind.push({ time: 20, direction: 0 }, { time: 30, direction: 25 });
    const boat = { ...initialBoat(), position: { x: 100, y: 1090 } };
    const oa = observation(a, boat), ob = observation(b, boat);
    assert.deepEqual(oa, ob);
    assert.deepEqual(evaluateNpcPolicy({ configuration: config(), observation: oa }),
      evaluateNpcPolicy({ configuration: config(), observation: ob }));
  });

  it('requires capped visibility and keeps personality identifiers behaviorally inert', () => {
    assert.throws(() => config({ observationProfileId: 'legacy-v1' }));
    assert.throws(() => observeRoutePlanner(createScenario({}), initialBoat(), 'legacy-v1'));
    assert.throws(() => config({ planning: { forecastModel: 'actual-future' } }));
    assert.throws(() => config({ planning: { maxCandidates: 13 } }));
    const o = observation(createScenario({ windMode: 'steady' }));
    const expected = evaluateNpcPolicy({ configuration: config(), observation: o });
    for (const personalityId of Object.keys(PERSONALITIES))
      assert.deepEqual(evaluateNpcPolicy({ configuration: config({ personalityId }), observation: o }), expected);
    assert.deepEqual(createNpcConfiguration(JSON.parse(JSON.stringify(config()))), config());
  });

  it('keeps independent planner memory and identical behavior across playback multipliers and resets', () => {
    let expected;
    for (const speed of [1, 4, 8, 16]) {
      const trainer = createTrainer({ courseLength: 300, windField: 'organic', opponentMode: 'npc', current: flow(0.35, 115) },
        { policyId: 'route-planner-v2', skillId: 'intermediate' });
      trainer.state.speed = speed; trainer.togglePause();
      for (let i = 0; i < 256 / speed; i++) trainer.tick(0.125);
      if (expected) assert.deepEqual(trainer.state.computer, expected); else expected = trainer.state.computer;
      const saved = structuredClone(trainer.state.computer);
      trainer.togglePause(); trainer.tick(0.2); assert.deepEqual(trainer.state.computer, saved);
      trainer.togglePause(); trainer.tick(0.2, true); assert.deepEqual(trainer.state.computer, saved);
      trainer.reset(trainer.state.scenario.config);
      assert.equal(trainer.state.computer.configuration.policyId, 'route-planner-v2');
      assert.deepEqual(trainer.state.computer.planningMemory, {});
    }
    const other = createLiveComputer({ policyId: 'route-planner-v2' });
    other.planningMemory.plan = { reserved: [] };
    assert.notEqual(other.planningMemory, expected.planningMemory);
    assert.equal(createTrainer().state.computer.configuration.policyId, 'legacy-reference');
  });
});
