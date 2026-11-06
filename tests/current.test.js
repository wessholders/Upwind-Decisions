import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, KNOT_TO_MPS } from '../src/engine/config.js';
import { createScenario } from '../src/engine/wind.js';
import { advance, initialBoat, applyAction, sailingHeading, targetSpeedKnots, boatGroundTelemetry, gateAimGeometry } from '../src/engine/physics.js';
import { currentVelocity, predictedLayline, groundVelocity } from '../src/engine/current.js';
import { createSetup, sessionConfig, scenarioCurrent } from '../src/scenario-config.js';
import { createTrainer } from '../src/race-controller.js';
import { createLiveComputer, advanceLiveComputer, observeCurrentWind, forecastObservedOption } from '../src/engine/live-computer.js';
import { replay } from '../src/engine/race.js';
import { optimize } from '../src/engine/optimizer.js';
import { courseGeometry, finishLaylines } from '../src/engine/course.js';
import { courseView } from '../src/views/course.js';
import { loadPreferences, savePreferences } from '../src/preferences.js';
import { cross, subtract, direction } from '../src/engine/geometry.js';
import { windAtPosition } from '../src/engine/wind.js';

const config = { ...DEFAULT_CONFIG, courseLength: 5000, windMode: 'steady' };
const flow = (speedKnots = 1, directionDegrees = 0, enabled = true) => ({ enabled, speedKnots, directionDegrees });
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

describe('uniform current ground integration', () => {
  it('retains exactly the existing zero-current trajectory in every movement path', () => {
    for (const windField of ['uniform', 'traveling', 'organic']) for (const performanceModel of ['polar', 'legacy-pressure']) {
      const base = createScenario({ ...config, windField, performanceModel });
      for (const current of [flow(2, 90, false), flow(0, 275)]) {
        const changed = createScenario({ ...config, windField, performanceModel, current });
        assert.deepEqual(advance(initialBoat(), changed, 12), advance(initialBoat(), base, 12));
      }
    }
  });
  it('adds each cardinal vector exactly once and keeps heading, polar and tack costs', () => {
    for (const performanceModel of ['polar', 'legacy-pressure']) for (const directionDegrees of [0, 90, 180, 270]) {
      const base = createScenario({ ...config, performanceModel });
      const changed = createScenario({ ...config, performanceModel, current: flow(1, directionDegrees) });
      const a = advance(initialBoat(), base, 16), b = advance(initialBoat(), changed, 16), v = currentVelocity(changed.config);
      near(b.position.x - a.position.x, v.x * 16); near(b.position.y - a.position.y, v.y * 16);
      assert.equal(sailingHeading(b, changed), sailingHeading(a, base));
      assert.equal(targetSpeedKnots(b, changed), targetSpeedKnots(a, base));
      assert.equal(b.tacks, 0); assert.equal(b.penaltyTime, 0); assert.equal(b.speedKnots, a.speedKnots);
      const ta = advance(applyAction(initialBoat(), 'tack', base), base, 8);
      const tb = advance(applyAction(initialBoat(), 'tack', changed), changed, 8);
      near(tb.position.x - ta.position.x, v.x * 8); near(tb.position.y - ta.position.y, v.y * 8);
      assert.equal(tb.penaltyTime, ta.penaltyTime); assert.equal(tb.tack, ta.tack);
    }
  });
  it('uses compass directions with the baseline offset and distinguishes SOG/COG from heading/STW', () => {
    const s = createScenario({ ...config, baseline: 90, current: flow(1, 0) });
    near(currentVelocity(s.config).x, -KNOT_TO_MPS); near(currentVelocity(s.config).y, 0);
    const base = createScenario(config), following = createScenario({ ...config, current: flow(1, 315) });
    const opposing = createScenario({ ...config, current: flow(1, 135) });
    const cross = createScenario({ ...config, current: flow(1, 45) });
    const speed = boatGroundTelemetry(initialBoat(), base).speedKnots;
    near(boatGroundTelemetry(initialBoat(), following).speedKnots, speed + 1);
    near(boatGroundTelemetry(initialBoat(), opposing).speedKnots, speed - 1);
    assert.notEqual(boatGroundTelemetry(initialBoat(), cross).courseDegrees, 315);
    assert.equal(sailingHeading(initialBoat(), cross), -45);
    const state = createTrainer(cross.config).state;
    assert.match(courseView(state).markup, /rotate\(-45\).*class="player-boat"/);
  });
  it('retains a manual wind-relative target through an actual traveling shift with current', () => {
    const s = createScenario({ ...DEFAULT_CONFIG, courseLength: 100, windField: 'traveling', windMode: 'persistent',
      propagationSpeed: 20, transitionWidth: 30, shiftStartTime: 0, current: flow(1, 90) });
    const b = advance(applyAction(initialBoat(), { type: 'steer', angle: 47 }, s), s, 30);
    assert.ok(windAtPosition(s, b.position.x, b.position.y, b.time) > 0);
    near(sailingHeading(b, s) - windAtPosition(s, b.position.x, b.position.y, b.time), -47);
    assert.equal(b.targetAngle, 47); assert.equal(b.tacks, 0); assert.equal(b.penaltyTime, 0);
  });
});

describe('seeded scenario current', () => {
  it('keeps manual values separate from generated metadata and preserves restart/shuffle behavior', () => {
    const draft = { ...createSetup(), current: flow(.84, 237), randomize: false };
    const saved = structuredClone(draft);
    assert.deepEqual(sessionConfig(draft).current, draft.current);
    assert.deepEqual(sessionConfig({ ...draft, seed: 77 }).current, draft.current);
    const random = { ...draft, randomize: true }, a = sessionConfig(random), b = sessionConfig(random);
    assert.deepEqual(a, b); assert.notDeepEqual(a.current, draft.current);
    assert.deepEqual(draft, saved);
    assert.deepEqual(sessionConfig({ ...random, windFrequency: 10, maxShift: 30 }).current, a.current);
    assert.notDeepEqual(sessionConfig({ ...random, seed: 77 }).current, a.current);
    const t = createTrainer(a); t.togglePause(); t.tick(.2); t.reset(t.state.scenario.config);
    assert.deepEqual(t.state.scenario.config.current, a.current);
    assert.deepEqual(t.state.scenario.wind, createScenario(a).wind);
    assert.deepEqual(sessionConfig({ ...draft, current: { ...draft.current, enabled: false } }).current, flow(0, 0, false));
    assert.deepEqual(sessionConfig({ ...draft, randomize: true, maxCurrentKnots: 0 }).current.speedKnots, 0);
  });
  it('samples continuous bounded speed and full-circle direction without consuming wind randomness', () => {
    const speeds = new Set(), directions = new Set(), buckets = Array(12).fill(0); let sum = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const draft = { ...createSetup(), current: flow(), maxCurrentKnots: 1.5, seed };
      const c = scenarioCurrent(draft); assert.ok(c.speedKnots >= 0 && c.speedKnots < 1.5);
      assert.ok(c.directionDegrees >= 0 && c.directionDegrees < 360);
      speeds.add(c.speedKnots); directions.add(c.directionDegrees); sum += c.speedKnots;
      buckets[Math.floor(c.directionDegrees / 30)]++;
    }
    assert.equal(speeds.size, 1000); assert.equal(directions.size, 1000);
    near(sum / 1000, .75, .05); assert.ok(buckets.every(n => n > 50 && n < 120));
    const a = createScenario({ ...config, windField: 'organic' });
    const b = createScenario({ ...config, windField: 'organic', current: flow() });
    assert.deepEqual(a.wind, b.wind); assert.deepEqual(a.organicWind, b.organicWind);
    for (const maxCurrentKnots of [-1, 3.1, NaN]) assert.throws(() => sessionConfig({ ...createSetup(), current: flow(), maxCurrentKnots }), /Maximum Current/);
  });
});

describe('current across clocks, boats and courses', () => {
  it('is independent of frame grouping and all playback multipliers for equal simulated time', () => {
    let expected;
    for (const speed of [1, 4, 8, 16]) {
      const t = createTrainer({ ...config, current: flow(1, 90), opponentMode: 'solo' });
      t.state.speed = speed; t.togglePause();
      t.act({ type: 'steer', angle: 47 });
      for (let i = 0; i < 128 / speed; i++) t.tick(.125);
      assert.equal(t.state.boat.time, 16); assert.equal(t.state.boat.targetAngle, 47);
      if (expected) assert.deepEqual(t.state.boat, expected); else expected = t.state.boat;
      assert.deepEqual(replay(t.state.scenario, t.state.commands, 16).finish, t.state.boat);
      const off = createScenario(config), b = advance(applyAction(initialBoat(), { type: 'steer', angle: 47 }, off), off, 16);
      near(t.state.boat.position.x - b.position.x, 16 * KNOT_TO_MPS);
    }
    const s = createScenario({ ...config, current: flow(1.2, 117), windField: 'organic' });
    const grouped = advance(initialBoat(), s, 8);
    let frames = initialBoat(); for (let i = 0; i < 64; i++) frames = advance(frames, s, .125);
    near(frames.position.x, grouped.position.x, .005); near(frames.position.y, grouped.position.y, .005);
  });
  it('uses identical current for actual NPC movement and its frozen-map prediction', () => {
    const s = createScenario({ ...config, current: flow(1, 90) });
    const npc = createLiveComputer(); npc.nextDecision = 1000; advanceLiveComputer(npc, s, 8);
    assert.deepEqual(npc.boat, advance(initialBoat(), s, 8));
    const on = forecastObservedOption(observeCurrentWind(s, initialBoat()), 'hold');
    const off = forecastObservedOption(observeCurrentWind(createScenario(config), initialBoat()), 'hold');
    near(on.position.x - off.position.x, 60 * KNOT_TO_MPS); near(on.position.y, off.position.y);
  });
  it('keeps course geometry fixed, compensates mark aiming, and crosses finite finishes on ground positions', () => {
    for (const courseMode of ['round-port', 'round-starboard', 'finish-upwind']) {
      const s = createScenario({ ...DEFAULT_CONFIG, windMode: 'steady', courseLength: 100, courseMode, current: flow(.6, 90) });
      const off = createScenario({ ...s.config, current: flow(0) });
      assert.deepEqual(courseGeometry(s, 100), courseGeometry(off, 100));
      const reverse = courseMode === 'round-starboard';
      const start = { ...initialBoat(), tack: reverse ? 'port' : 'starboard', position: { x: reverse ? -90 : 90, y: s.config.courseLength - 65 } };
      const b = applyAction(start, 'bear', s), aim = gateAimGeometry(b, s);
      assert.ok(aim.legal, courseMode);
      const velocity = boatGroundTelemetry(b, s), toward = subtract(aim.target, b.position);
      near(cross(toward, velocity), 0, .0001);
      const end = advance(b, s, 100); assert.ok(end.finished, `${courseMode}: ${JSON.stringify(end)}`);
      assert.equal(end.tacks, 0); assert.ok(end.distance > 0);
      assert.deepEqual(courseGeometry(s, end.time), courseGeometry(off, end.time));
    }
  });
  it('finishes and replays the unchanged NPC policy on each course with moderate current', { timeout: 30000 }, () => {
    for (const courseMode of ['round-port', 'round-starboard', 'finish-upwind']) {
      const s = createScenario({ ...DEFAULT_CONFIG, courseMode, courseLength: 100, windMode: 'steady', current: flow(.35, 115) });
      const npc = createLiveComputer();
      for (let i = 0; i < 6000 && !npc.boat.finished; i++) advanceLiveComputer(npc, s, .25);
      assert.ok(npc.boat.finished, `${courseMode}: ${JSON.stringify(npc.boat)}`);
      assert.deepEqual(replay(s, npc.commands, npc.boat.time + 1).finish, npc.boat);
    }
  });
  it('includes recorded current in hindsight alternatives and ground-distance metrics', { timeout: 30000 }, () => {
    const s = createScenario({ ...DEFAULT_CONFIG, courseLength: 100, windMode: 'steady', current: flow(.7, 180) });
    const result = optimize(s, null, undefined);
    assert.ok(result.route?.finish.finished);
    assert.deepEqual(replay(s, result.route.commands, result.route.finish.time + 1).finish, result.route.finish);
    const without = replay(createScenario({ ...s.config, current: flow(0) }), result.route.commands, result.route.finish.time + 1).finish;
    assert.notEqual(without.time, result.route.finish.time);
    const actualDistance = result.route.points.slice(1).reduce((total, point, i) => total + Math.hypot(point.position.x - result.route.points[i].position.x, point.position.y - result.route.points[i].position.y), 0);
    near(result.route.finish.distance, actualDistance, .02);
    assert.ok(result.comparisons.every(c => Number.isFinite(c.oldGroundUpCourseKnots)));
  });
});

describe('optional current-aware laylines', () => {
  it('keeps Wind Only geometry/styles and zero-current equivalence for all courses', () => {
    for (const courseMode of ['round-port', 'round-starboard', 'finish-upwind']) {
      const t = createTrainer({ ...DEFAULT_CONFIG, courseMode, windMode: 'steady', current: flow(1, 90) });
      const off = { ...t.state, scenario: createScenario({ ...t.state.scenario.config, current: flow(0) }) };
      const before = structuredClone(t.state);
      const base = courseView({ ...t.state, laylineMode: 'wind-only' });
      assert.deepEqual(base, courseView({ ...off, laylineMode: 'wind-only' }));
      assert.deepEqual(courseView({ ...off, laylineMode: 'wind-current' }), courseView({ ...off, laylineMode: 'wind-only' }));
      const corrected = courseView({ ...t.state, laylineMode: 'wind-current' });
      assert.notEqual(corrected.markup, base.markup); assert.equal(corrected.viewBox, base.viewBox);
      assert.deepEqual(t.state, before);
      if (courseMode === 'finish-upwind') for (const line of finishLaylines(t.state.scenario, 0, 'wind-current').lines) near(Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y), 200);
      else assert.equal((corrected.markup.match(/class="layline"/g) || []).length, 2);
    }
  });
  it('derives the line from the polar and persists a separate display preference', () => {
    const c = { ...config, current: flow(1, 90) }, wind = { direction: 0, speedKnots: 10 };
    const endpoint = predictedLayline({ x: 0, y: 0 }, wind, 'starboard', c, 500, 'wind-current');
    const v = groundVelocity(-45, 4.6, currentVelocity(c)); near(cross(endpoint, v), 0);
    assert.notDeepEqual(endpoint, predictedLayline({ x: 0, y: 0 }, wind, 'starboard', { ...c, speedScale: 2 }, 500, 'wind-current'));
    const storage = { data: '{}', getItem() { return this.data; }, setItem(k, value) { this.data = value; } };
    assert.equal(loadPreferences(storage).laylineMode, 'wind-only');
    const prefs = { ...loadPreferences(storage), laylineMode: 'wind-current' }; savePreferences(storage, prefs);
    assert.equal(loadPreferences(storage).laylineMode, 'wind-current');
  });
});
