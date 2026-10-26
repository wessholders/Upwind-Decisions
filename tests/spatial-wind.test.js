import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, KNOT_TO_MPS, STEP } from '../src/engine/config.js';
import { direction, validHeading } from '../src/engine/geometry.js';
import { createScenario, windAt, windAtPosition, windEntryHeight } from '../src/engine/wind.js';
import { advance, compassHeading, initialBoat, sailingHeading } from '../src/engine/physics.js';
import { finishFraction, gateEnd, windAtMark } from '../src/engine/finish.js';
import { replay } from '../src/engine/race.js';
import { search } from '../src/engine/optimizer.js';
import { createTrainer } from '../src/race-controller.js';
import { courseProjection, drawWindCanvas, streakGeometry, windBoundaries, windStreak } from '../src/views/wind-canvas.js';
import { windHistoryView } from '../src/views/wind-history.js';
import { closeTo } from './helpers.js';

const traveling = (extra = {}) => createScenario({ ...DEFAULT_CONFIG, courseLength: 100,
  windField: 'traveling', windMode: 'persistent', propagationSpeed: 3,
  persistentShiftAngle: 12, transitionWidth: 30, shiftStartTime: 10, ...extra });

describe('spatial wind field and traveling fronts', () => {
  it('loads an older uniform config without changing its seeded wind', () => {
    const old = { ...DEFAULT_CONFIG };
    for (const field of ['windField', 'propagationSpeed', 'transitionWidth', 'persistentShiftAngle', 'shiftStartTime']) delete old[field];
    assert.deepEqual(createScenario(old).wind, createScenario(DEFAULT_CONFIG).wind);
    assert.equal(createScenario(old).config.windField, 'uniform');
  });
  it('preserves the uniform generator and physics when traveling parameters change', () => {
    const a = createScenario({ ...DEFAULT_CONFIG, windMode: 'persistent' });
    const b = createScenario({ ...a.config, propagationSpeed: 10, transitionWidth: 1, persistentShiftAngle: -30, shiftStartTime: 0 });
    assert.deepEqual(a.wind, b.wind);
    assert.deepEqual(advance(initialBoat(), a, 200), advance(initialBoat(), b, 200));
    for (const y of [0, 500, 1000]) closeTo(windAtPosition(a, 100, y, 100), windAt(a, 100), 12);
  });

  it('starts with vertical streaks and uniform wind throughout the course', () => {
    const s = traveling();
    for (let y = 0; y <= windEntryHeight(s); y += 10) {
      assert.equal(windAtPosition(s, -100, y, 0), 0);
      const streak = windStreak(s, 30, y, 0, 15);
      assert.equal(streak.from.x, streak.to.x);
      assert.ok(streak.to.y > streak.from.y);
    }
  });

  it('keeps steady aligned wind streaks vertical at every time and position', () => {
    const s = traveling({ windMode: 'steady' });
    for (const time of [0, 200, 2000]) for (const y of [0, 100, 200]) {
      const line = windStreak(s, 12, y, time, 20);
      assert.equal(line.from.x, line.to.x);
      assert.equal(line.angle, 0);
    }
  });

  for (const angle of [12, -12]) it(`orients streaks from the actual local ${angle} degree shift`, () => {
    const s = traveling({ persistentShiftAngle: angle });
    const streak = windStreak(s, 0, 50, 100, 10);
    assert.equal(streak.angle, angle);
    assert.equal(Math.sign(streak.to.x - streak.from.x), Math.sign(angle));
    closeTo(Math.atan2(streak.to.x - streak.from.x, streak.to.y - streak.from.y) * 180 / Math.PI, angle, 10);
  });

  it('moves a horizontal transition center downwind by speed times elapsed time', () => {
    const s = traveling();
    const first = windBoundaries(s, 50)[0], next = windBoundaries(s, 60)[0];
    closeTo(next.y - first.y, -30, 10);
    assert.equal(first.width, 30);
    closeTo(windAtPosition(s, -400, first.y, 50), 6, 10);
    closeTo(windAtPosition(s, 400, first.y, 50), 6, 10);
    assert.equal(windAtPosition(s, 0, first.y - 16, 50), 0);
    assert.equal(windAtPosition(s, 0, first.y + 16, 50), 12);
  });

  it('keeps configurable pattern speed independent of boat speed and compass baseline', () => {
    for (const propagationSpeed of [0.5, 3, 12]) {
      const a = traveling({ propagationSpeed }), b = traveling({ propagationSpeed, speedKnots: 20, baseline: 225 });
      const first = windBoundaries(a, 80)[0], next = windBoundaries(a, 90)[0];
      closeTo(next.y - first.y, -10 * propagationSpeed, 9);
      assert.deepEqual(windBoundaries(a, 80), windBoundaries(b, 80));
    }
  });

  it('changes a stationary boat wind only when the region arrives at that position', () => {
    const s = traveling();
    const y = 50;
    const leading = 10 + (windEntryHeight(s) - y) / 3;
    assert.equal(windAtPosition(s, 0, y, leading), 0);
    closeTo(windAtPosition(s, 0, y, leading + 5), 6, 10);
    assert.equal(windAtPosition(s, 0, y, leading + 10), 12);
    const stopped = { ...initialBoat(), position: { x: 0, y }, time: leading, penaltyRemaining: 20 };
    const later = advance(stopped, s, 10);
    assert.deepEqual(later.position, stopped.position);
    assert.equal(compassHeading(later, s), 327);
    assert.equal(later.tack, 'starboard');
    assert.equal(later.penaltyTime, 10);
  });

  it('encounters the front earlier while sailing toward it and updates the compass locally', () => {
    const s = traveling({ baseline: 120 });
    let boat = initialBoat();
    let halfShiftTime = null;
    for (let i = 0; i < 400; i++) {
      boat = advance(boat, s);
      const local = windAtPosition(s, boat.position.x, boat.position.y, boat.time);
      closeTo(sailingHeading(boat, s), local - 45, 10);
      closeTo(compassHeading(boat, s), local + 75, 10);
      assert.equal(boat.tack, 'starboard');
      if (halfShiftTime === null && local >= 6) halfShiftTime = boat.time;
    }
    assert.ok(halfShiftTime < 10 + windEntryHeight(s) / 3 + 5);
    assert.ok(halfShiftTime > 10);
  });

  it('uses wind at the mark for the gate, independently of local wind at the boat', () => {
    const s = traveling();
    const time = 60;
    assert.equal(windAtMark(s, time), 12);
    assert.equal(windAtPosition(s, 0, 0, time), 0);
    const gate = gateEnd(s, time);
    closeTo(Math.atan2(gate.x, gate.y - s.config.courseLength) * 180 / Math.PI, 12, 10);
  });

  it('finishes through the local finite gate and rejects port and infinite-line crossings', () => {
    const s = traveling();
    // The source has shifted, but the mark is still in the old wind at t=20.
    closeTo(finishFraction(s, { x: 1, y: 150 }, { x: -1, y: 152 }, 20, 1, 'starboard'), 0.5, 9);
    assert.equal(finishFraction(s, { x: 1, y: 150 }, { x: -1, y: 152 }, 20, 1, 'port'), null);
    assert.equal(finishFraction(s, { x: 1, y: 201 }, { x: -1, y: 203 }, 20, 1, 'starboard'), null);
    // Once the region reaches the mark the gate rotates, retaining interpolation.
    const time = 60, wind = windAtMark(s, time), along = direction(wind), velocity = direction(wind - 45);
    const center = { x: along.x * 50, y: 100 + along.y * 50 };
    const from = { x: center.x - velocity.x, y: center.y - velocity.y };
    const to = { x: center.x + velocity.x, y: center.y + velocity.y };
    closeTo(finishFraction(s, from, to, time, 1, 'starboard'), 0.5, 9);
  });

  it('creates reproducible bounded oscillations with multiple same-side target regions', () => {
    const s = traveling({ windMode: 'oscillating', courseLength: 1000 });
    assert.deepEqual(s, createScenario(s.config));
    assert.ok(s.wind.some((k, i) => i > 1 && k.direction !== 0 && k.direction * s.wind[i - 2].direction > 0));
    for (let time = 0; time < 1000; time += 13) for (const y of [0, 200, 1000]) assert.ok(Math.abs(windAtPosition(s, 0, y, time)) <= 15);
    assert.ok(windBoundaries(s, 500).length > 2);
    for (const front of windBoundaries(s, 500)) closeTo(front.width, 30, 8);
  });

  it('keeps frame grouping and rendering choices independent of spatial physics', () => {
    const config = traveling({ transitionWidth: 1 }).config;
    const a = createTrainer(config), b = createTrainer(config);
    a.state.speed = 1; b.state.speed = 4;
    a.togglePause(); b.togglePause();
    const before = structuredClone(a.state.scenario);
    for (let i = 0; i < 800; i++) {
      a.tick(0.125);
      if (i % 20 === 0) streakGeometry(a.state.scenario, a.state.boat.time, { minX: -100, maxX: 100, minY: 0, maxY: 200 }, 20, 10);
    }
    b.state.windDisplay = 'hidden';
    for (let i = 0; i < 200; i++) b.tick(0.125);
    assert.deepEqual(a.state.boat, b.state.boat);
    assert.deepEqual(a.state.scenario, before);
    assert.deepEqual(advance(initialBoat(), a.state.scenario, 100), a.state.boat);
  });

  it('rejects invalid propagation speed and transition width', () => {
    for (const extra of [{ propagationSpeed: 0 }, { transitionWidth: 0 }, { transitionWidth: NaN }, { windField: 'unknown' }]) assert.throws(() => traveling(extra));
  });
});

describe('narrow-front integration and rendering', () => {
  it('agrees with an independent fine RK4 integration while crossing a 1 m front', () => {
    const s = traveling({ shiftStartTime: 0, transitionWidth: 1, persistentShiftAngle: 30 });
    const boat = { ...initialBoat(), position: { x: 50, y: 50 }, time: 49.8 };
    const speed = 5 * KNOT_TO_MPS;
    const velocity = (position, time) => {
      const v = direction(windAtPosition(s, position.x, position.y, time) - 45);
      return { x: v.x * speed, y: v.y * speed };
    };
    let p = { ...boat.position };
    const step = 0.0005;
    for (let i = 0; i < 4000; i++) {
      const t = boat.time + i * step;
      const add = (v, factor) => ({ x: p.x + v.x * step * factor, y: p.y + v.y * step * factor });
      const a = velocity(p, t), b = velocity(add(a, 0.5), t + step / 2);
      const c = velocity(add(b, 0.5), t + step / 2), d = velocity(add(c, 1), t + step);
      p = { x: p.x + step * (a.x + 2 * b.x + 2 * c.x + d.x) / 6, y: p.y + step * (a.y + 2 * b.y + 2 * c.y + d.y) / 6 };
    }
    const integrated = advance(boat, s, 2);
    assert.ok(Math.hypot(integrated.position.x - p.x, integrated.position.y - p.y) < 0.002);
    closeTo(integrated.distance, speed * 2, 9);
  });

  it('shortens steep-front streaks so they do not span conflicting directions', () => {
    const s = traveling({ transitionWidth: 1 });
    const time = 60, y = windBoundaries(s, time)[0].y;
    const streak = windStreak(s, 0, y, time, 20);
    assert.ok(Math.hypot(streak.to.x - streak.from.x, streak.to.y - streak.from.y) <= 0.25000001);
    closeTo(streak.angle, windAtPosition(s, 0, y, time), 10);
  });

  it('projects canvas strokes with the same uniform scale and padding as the course SVG', () => {
    const projection = courseProjection('-100 -200 200 300', 500, 580, { left: 15, right: 15, top: 65, bottom: 25 });
    const origin = projection.point({ x: 0, y: 0 });
    const east = projection.point({ x: 10, y: 0 }), north = projection.point({ x: 0, y: 10 });
    closeTo(east.x - origin.x, origin.y - north.y, 10);
    const calls = [];
    const context = Object.fromEntries(['setTransform', 'clearRect', 'save', 'beginPath', 'rect', 'clip', 'moveTo', 'lineTo', 'stroke', 'setLineDash', 'restore'].map(method => [method, (...args) => calls.push([method, ...args])]));
    const canvas = { width: 0, height: 0, getContext: () => context };
    const s = traveling();
    const snapshot = structuredClone(s);
    drawWindCanvas(canvas, s, 60, '-100 -200 200 300', 'boundaries', { width: 500, height: 580, pixelRatio: 2 });
    assert.equal(canvas.width, 1000);
    assert.equal(canvas.height, 1160);
    assert.ok(calls.some(c => c[0] === 'stroke'));
    assert.ok(calls.some(c => c[0] === 'setLineDash'));
    assert.deepEqual(s, snapshot);
    calls.length = 0;
    drawWindCanvas(canvas, s, 60, '-100 -200 200 300', 'hidden', { width: 500, height: 580 });
    assert.ok(calls.some(c => c[0] === 'clearRect'));
    assert.ok(!calls.some(c => c[0] === 'stroke'));
  });

  it('plots wind actually observed at the boat rather than the upwind source sequence', () => {
    const s = traveling();
    const points = [{ ...initialBoat(), time: 20 }];
    const plot = windHistoryView(s, 20, points);
    assert.equal(windAt(s, 20), 12);
    assert.equal(windAtPosition(s, 0, 0, 20), 0);
    assert.match(plot, /polyline points="155,65"/);
  });
});

describe('spatial hindsight benchmark', () => {
  it('finds a finish and replays through the same local field for every candidate boat', { timeout: 20000 }, () => {
    const s = traveling({ shiftStartTime: 0, transitionWidth: 20 });
    const result = search(s, { interval: 2, width: 120, cell: 1 });
    assert.ok(result.route?.finish.finished);
    const { commands, finish, points } = result.route;
    assert.deepEqual(replay(s, commands, finish.time + 1).finish, finish);
    assert.equal(finish.tack, 'starboard');
    closeTo(finish.penaltyTime, finish.tacks * 5, 8);
    assert.ok(points.some(p => Math.abs(windAt(s, p.time) - windAtPosition(s, p.position.x, p.position.y, p.time)) > 5));
    for (const p of points) assert.ok(validHeading(sailingHeading(p, s), windAtPosition(s, p.position.x, p.position.y, p.time), p.tack, 45));
    const uniform = { ...s, config: { ...s.config, windField: 'uniform' } };
    assert.notDeepEqual(replay(uniform, commands, finish.time + 1).finish.position, finish.position);
  });

  for (const config of [
    { windMode: 'persistent', persistentShiftAngle: -12 },
    { windMode: 'oscillating', seed: 42, difficulty: 'hard' },
  ]) it(`replays a legal 300 m route through ${JSON.stringify(config)}`, { timeout: 20000 }, () => {
    const s = traveling({ courseLength: 300, ...config });
    const route = search(s, { interval: 2, width: 140, cell: 2 }).route;
    assert.ok(route?.finish.finished);
    assert.deepEqual(replay(s, route.commands, route.finish.time + 1).finish, route.finish);
    closeTo(route.finish.penaltyTime, route.finish.tacks * 5, 7);
    assert.ok(route.points.some(p => Math.abs(windAtPosition(s, p.position.x, p.position.y, p.time)) > 1));
  });

  it('preserves exact fixed-step command replay across a traveling front', () => {
    const s = traveling({ transitionWidth: 1 });
    let boat = initialBoat();
    for (let i = 0; i < 400; i++) boat = advance(boat, s, STEP);
    assert.deepEqual(replay(s, [], 100).finish, boat);
  });
});
