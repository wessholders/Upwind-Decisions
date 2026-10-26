import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTrainer } from '../src/race-controller.js';
import { createScenario, windAtPosition, windSampleAtPosition, windIntegrationStep } from '../src/engine/wind.js';
import { initialBoat, advance, sailingHeading, sailingSpeedKnots, applyAction } from '../src/engine/physics.js';
import { fieldForScenario } from '../src/wind/field.js';
import { search } from '../src/engine/optimizer.js';
import { replay } from '../src/engine/race.js';
import { windHistoryView } from '../src/views/wind-history.js';
import { RaceWindLayer } from '../src/views/organic-wind.js';
import { courseProjection } from '../src/views/wind-canvas.js';
import { DEFAULT_CONFIG } from '../src/engine/config.js';

const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

describe('organic wind in the decision trainer', () => {
  it('opens the actual trainer with organic wind and carries race settings into its field', () => {
    const trainer = createTrainer();
    assert.equal(trainer.state.scenario.config.windField, 'organic');
    assert.ok(trainer.state.scenario.organicWind);
    trainer.reset({ windField: 'organic', favoredSide: 'right', windBias: 75, windFrequency: 3, windSizeBL: 50,
      backgroundWindKnots: 14, windContrast: 45, maxShift: 20, courseLength: 2000, difficulty: 'hard' });
    const c = trainer.state.scenario.organicWind;
    assert.equal(c.favoredSide, 'right'); assert.equal(c.probability, 0.75); assert.equal(c.frequency, 3);
    assert.equal(c.sizeBL, 50); assert.equal(c.windKnots, 14); assert.equal(c.contrast, 0.45); assert.equal(c.maxShift, 20);
    assert.ok(c.width >= 2000); assert.ok(c.height > 2000); assert.equal(c.tempo, 0.45);
  });
  it('makes pressure affect the sailing boat using the authoritative local wind', () => {
    const scenario = createScenario({ windField: 'organic', seed: 2941, windMode: 'steady' });
    const field = fieldForScenario(scenario), features = field.featuresAt(0);
    for (const kind of ['puff', 'pocket']) {
      const p = features.find(p => p.feature.kind === kind); assert.ok(p, kind);
      const boat = { ...initialBoat(), position: { x: p.x, y: p.y } };
      const wind = windSampleAtPosition(scenario, p.x, p.y, 0), speed = sailingSpeedKnots(boat, scenario);
      near(speed, 5 * Math.sqrt(wind.speedKnots / 10));
      assert.ok(kind === 'puff' ? speed > 5 : speed < 5);
      near(sailingHeading(boat, scenario), windAtPosition(scenario, p.x, p.y, 0) - 45);
    }
  });
  it('preserves optional fixed speed and stationary tack penalties under organic wind', () => {
    const scenario = createScenario({ windField: 'organic', pressureExponent: 0, tackPenalty: 5 });
    const p = fieldForScenario(scenario).featuresAt(0)[0];
    const boat = { ...initialBoat(), position: { x: p.x, y: p.y } };
    assert.equal(sailingSpeedKnots(boat, scenario), 5);
    const tacking = advance(applyAction(boat, 'tack', scenario), scenario, 4.75);
    assert.deepEqual(tacking.position, boat.position); near(tacking.penaltyRemaining, 0.25);
    const moving = advance(tacking, scenario, 0.5);
    assert.ok(moving.distance > 0); near(moving.penaltyTime, 5);
  });
  it('replays the integrated race after pause, retry and alternate frame grouping', () => {
    const a = createTrainer(), b = createTrainer();
    a.togglePause(); b.togglePause();
    for (let i = 0; i < 200; i++) a.tick(0.05);
    for (let i = 0; i < 100; i++) b.tick(0.1);
    assert.deepEqual(a.state.boat, b.state.boat);
    a.act('tack'); for (let i = 0; i < 50; i++) a.tick(0.1);
    assert.deepEqual(replay(a.state.scenario, a.state.commands, a.state.boat.time).finish, a.state.boat);
    const point = a.state.boat.position, time = a.state.boat.time;
    const wind = windSampleAtPosition(a.state.scenario, point.x, point.y, time);
    a.reset(a.state.scenario.config);
    assert.deepEqual(windSampleAtPosition(a.state.scenario, point.x, point.y, time), wind);
  });
  it('resolves small fast pressure patches and agrees with a much finer integration', () => {
    const scenario = createScenario({ windField: 'organic', windMode: 'steady', maxShift: 0,
      boatLength: 1, windSizeBL: 15, backgroundWindKnots: 30, windContrast: 70, seed: 2941 });
    const p = fieldForScenario(scenario).featuresAt(0).find(p => p.feature.kind === 'puff' && p.y < 850);
    assert.ok(p);
    assert.ok(windIntegrationStep(scenario, p.y, 0, 0.25, 3, p.x) < 0.1);
    const initial = { ...initialBoat(), position: { x: p.x, y: p.y - p.shape.bound * 1.3 } };
    const ordinary = advance(initial, scenario, 6);
    let fine = initial;
    for (let i = 0; i < 2400; i++) fine = advance(fine, scenario, 0.0025);
    assert.ok(Math.hypot(ordinary.position.x - fine.position.x, ordinary.position.y - fine.position.y) < 0.03);
  });
  it('plots wind encountered by the sailing boat instead of the background sequence', () => {
    const scenario = createScenario({ windField: 'organic', seed: 2941, windMode: 'steady' });
    const p = fieldForScenario(scenario).featuresAt(0).find(p => p.feature.kind === 'puff');
    const boat = { ...initialBoat(), position: { x: p.x, y: p.y } };
    const local = windAtPosition(scenario, p.x, p.y, 0);
    assert.notEqual(local, 0);
    const chart = windHistoryView(scenario, 0, [boat]);
    assert.ok(chart.includes(`40,${65 - local / 30 * 43}`));
  });
  it('finds and exactly replays a reference route on the full 1 km organic course', { timeout: 20000 }, () => {
    const scenario = createScenario({ windField: 'organic', seed: 314159 });
    const result = search(scenario, { interval: 4, width: 100, cell: 3 });
    assert.ok(result.route?.finish.finished);
    assert.deepEqual(replay(structuredClone(scenario), result.route.commands, result.route.finish.time + 1).finish, result.route.finish);
  });
  it('aligns wind layers with the same SVG projection and never changes boat physics when toggled', () => {
    // Use a real drawing API stub so boundaries and vector paths execute under
    // Node, without coupling the test to their individual canvas operations.
    const originalDocument = globalThis.document;
    const context = new Proxy({}, { get: (target, key) => target[key] || (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
    const offscreen = { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) };
    globalThis.document = { createElement: () => offscreen };
    try {
      const scenario = createScenario({ windField: 'organic' }), canvas = { width: 0, height: 0, getContext: () => context };
      const layer = new RaceWindLayer(), metrics = { width: 800, height: 580, padding: { left: 15, right: 15, top: 65, bottom: 25 } };
      const view = '-580 -1180 1160 1260', expected = advance(initialBoat(), scenario, 20);
      layer.draw(canvas, scenario, 20, view, 'streaks', metrics, 0.1);
      const particles = layer.particles;
      layer.draw(canvas, scenario, 20, view, 'boundaries', metrics, 0.1, true);
      layer.draw(canvas, scenario, 20, '-20 -100 550 550', 'streaks', metrics, 0.1);
      layer.draw(canvas, scenario, 20, view, 'hidden', metrics, 0.1);
      assert.equal(layer.particles, particles, 'Camera/display changes must not reset particles.');
      assert.deepEqual(advance(initialBoat(), scenario, 20), expected);
      const projection = courseProjection(view, 800, 580, metrics.padding);
      near(projection.point({ x: 100, y: 0 }).x - projection.point({ x: 0, y: 0 }).x,
        projection.point({ x: 0, y: 0 }).y - projection.point({ x: 0, y: 100 }).y);
    } finally { globalThis.document = originalDocument; }
  });
  it('retains the previous uniform and traveling modes for existing scenarios', () => {
    for (const windField of ['uniform', 'traveling']) {
      const scenario = createScenario({ ...DEFAULT_CONFIG, windField });
      assert.equal(scenario.organicWind, undefined);
      near(sailingSpeedKnots(initialBoat(), scenario), 5);
    }
  });
});
