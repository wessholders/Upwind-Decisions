import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WindField, attachWindField, fieldForScenario } from '../src/wind/field.js';
import { FeatureShape, overlaps } from '../src/wind/shape.js';
import { WindFeature } from '../src/wind/feature.js';
import { SpawnManager } from '../src/wind/spawn.js';
import { InteractionManager, compatible } from '../src/wind/interactions.js';
import { ScenarioGenerator } from '../src/wind/scenario.js';
import { seededRandom } from '../src/wind/random.js';
import { windConfig, windVector, WIND_STEP } from '../src/wind/config.js';
import { ParticleSystem, particleOpacity, trailGeometry } from '../src/wind/particles.js';
import { DensityManager, densityFactor, BASE_DENSITY } from '../src/wind/density.js';
import { SimulationClock } from '../src/wind/clock.js';
import { BoatProbe } from '../src/wind/probe.js';
import { cameraFor } from '../src/wind/renderer.js';
import { createScenario, windAtPosition } from '../src/engine/wind.js';
import { advance, initialBoat } from '../src/engine/physics.js';
import { search } from '../src/engine/optimizer.js';
import { replay } from '../src/engine/race.js';

const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const feature = (overrides = {}) => new WindFeature({ id: 1, kind: 'puff', x: 0, y: 500, shift: 10, speedKnots: 14,
  lifetime: 800, shape: new FeatureShape(seededRandom(8), 80, 100), ...overrides });
const fixture = (features, config = {}) => {
  const field = new WindField({ initialFeatures: 0, frequency: 0, regime: 'steady', ...config });
  field.active = features; field.history = features; field.indexTick(); return field;
};

describe('authoritative organic wind field', () => {
  it('reproduces history and samples across seeds, arbitrary query order and structured cloning', () => {
    for (const seed of [1, 42, 2941]) {
      const a = new WindField({ seed }), b = new WindField(structuredClone({ seed }));
      const expected = [0, 9.3, 80, 400, 900].map(t => a.sample(90, 650, t));
      b.sample(0, 0, 1000);
      assert.deepEqual([0, 9.3, 80, 400, 900].map(t => b.sample(90, 650, t)), expected);
    }
  });
  it('keeps physics independent of particle workload, probe position and display switches', () => {
    const a = new WindField(), b = new WindField(), particles = new ParticleSystem(a, 0.6), probe = new BoatProbe(a);
    for (let i = 0; i < 100; i++) {
      particles.update(0.025, i * 0.25); probe.x = i * 3; probe.sample(i * 0.25);
    }
    assert.deepEqual(a.sample(0, 500, 150), b.sample(0, 500, 150));
    assert.deepEqual(a.history.map(f => [f.id, f.shift, f.endTick]), b.history.map(f => [f.id, f.shift, f.endTick]));
  });
  it('moves shifted features toward the correct downwind bearings at their internal speeds', () => {
    for (const shift of [0, 5, -5]) {
      const f = feature({ shift }); const x = f.x, y = f.y, vector = windVector(shift, f.speedKnots);
      f.move(0, windConfig(), 10);
      near(f.x - x, vector.vx * 10); near(f.y - y, vector.vy * 10);
      if (shift > 0) assert.ok(f.x < x); if (shift < 0) assert.ok(f.x > x);
    }
  });
  it('advects stronger puffs faster than weak pockets', () => {
    const puff = feature({ shift: 0, speedKnots: 14 }), pocket = feature({ kind: 'pocket', shift: 0, speedKnots: 6 });
    puff.move(0, windConfig(), 5); pocket.move(0, windConfig(), 5);
    assert.ok(500 - puff.y > 500 - pocket.y);
  });
  it('spawns initially separated organic features and skips crowded attempts', () => {
    const config = windConfig(), spawn = new SpawnManager(config), active = [];
    for (let i = 0; i < 70; i++) {
      const f = spawn.spawn(active, 0, true);
      if (!f) continue;
      assert.ok(active.every(g => !overlaps(f, g, 2 * config.boatLength))); active.push(f);
    }
    assert.ok(active.length > 4); assert.ok(spawn.stats.skipped > 0);
  });
  it('conservatively detects irregular lobes, including outside the original ellipse', () => {
    for (let seed = 0; seed < 40; seed++) {
      const a = feature({ shape: new FeatureShape(seededRandom(seed), 100, 125, seed / 7) });
      for (let k = 0; k < 40; k++) {
        const p = a.shape.point(k / 40 * 2 * Math.PI);
        const b = feature({ x: a.x + p.x * 0.99, y: a.y + p.y * 0.99, shape: new FeatureShape(seededRandom(99), 1, 1) });
        assert.ok(overlaps(a, b));
      }
    }
  });
  it('never allows incompatible features to coexist through generated trajectories', () => {
    const field = new WindField({ frequency: 4, maxShift: 30 });
    for (let t = 0; t < 800; t += 0.7) {
      const features = field.featuresAt(t);
      for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++)
        if (!compatible(features[i].feature, features[j].feature)) assert.ok(!overlaps(features[i], features[j]));
    }
  });
  it('permanently removes an overtaken pocket and contradictory same-kind features', () => {
    const puff = feature({ y: 650, shift: 0, speedKnots: 16, shape: new FeatureShape(seededRandom(8), 25, 30) });
    const pocket = feature({ id: 2, kind: 'pocket', y: 500, shift: 0, speedKnots: 5, shape: new FeatureShape(seededRandom(9), 25, 30) });
    const field = fixture([puff, pocket]);
    assert.equal(field.featuresAt(0).length, 2);
    field.ensure(100); assert.ok(Number.isFinite(pocket.endTick)); assert.ok(puff.endTick > pocket.endTick);
    assert.ok(!field.featuresAt(pocket.endTick * WIND_STEP + 0.1).some(p => p.feature.id === 2));
    assert.ok(!field.featuresAt(90).some(p => p.feature.id === 2));
    const positive = feature(), negative = feature({ id: 3, shift: -10 });
    const survivors = new InteractionManager().resolve([negative, positive], 4, windConfig());
    assert.deepEqual(survivors, [positive]); assert.equal(negative.endTick, 4);
  });
  it('keeps incompatible geometry separated between ticks at maximum transport settings', () => {
    const field = new WindField({ windKnots: 30, contrast: 0.7, translation: 3, frequency: 12, sizeBL: 15, boatLength: 1 });
    for (let t = 0; t < 180; t += 0.1) {
      const list = field.featuresAt(t);
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
        if (!compatible(list[i].feature, list[j].feature)) assert.ok(!overlaps(list[i], list[j]));
    }
  });
  it('blends compatible directional vectors instead of adding shift angles', () => {
    const field = fixture([feature(), feature({ id: 2, shift: 12 })]);
    const w = field.sample(0, 500, 0);
    near(w.direction, 11); assert.ok(w.direction < 13); assert.equal(w.kind, 'puff');
  });
  it('generates smooth positive, non-self-intersecting radial boundaries', () => {
    for (let seed = 0; seed < 120; seed++) {
      const shape = new FeatureShape(seededRandom(seed), 80, 100, seed);
      const points = [];
      for (let k = 0; k <= 720; k++) {
        const a = k / 720 * Math.PI * 2, r = shape.radius(a);
        assert.ok(r > 0.78 && r < 1.22);
        const p = shape.point(a); points.push(p);
        if (k) assert.ok(Math.hypot(p.x - points[k - 1].x, p.y - points[k - 1].y) < 2);
        // Positive radius and strictly ordered polar angles certify that no
        // two radial segments meet except at the closing boundary point.
        near(shape.normalizedRadius(p.x, p.y), 1, 1e-10);
      }
      near(points[0].x, points.at(-1).x); near(points[0].y, points.at(-1).y);
    }
  });
  it('uses precisely the same analytic geometry for outline points and influence', () => {
    const shape = new FeatureShape(seededRandom(14), 90, 112, 0.7);
    for (let k = 0; k < 128; k++) {
      const p = shape.point(k / 128 * 2 * Math.PI);
      near(shape.influence(p.x, p.y), 0);
      assert.ok(shape.influence(p.x * 0.9, p.y * 0.9) > 0);
      assert.equal(shape.influence(p.x * 1.01, p.y * 1.01), 0);
    }
  });
  it('supports bounded seeded oscillations with consecutive targets on one side, and persistent holds', () => {
    const oscillation = new ScenarioGenerator(windConfig()); oscillation.background(5000);
    assert.ok(oscillation.knots.every(k => Math.abs(k.direction) <= 15));
    const changes = oscillation.knots.filter((k, i, all) => i && k.direction !== all[i - 1].direction);
    assert.ok(changes.some((k, i) => i && k.direction * changes[i - 1].direction > 0));
    for (const seed of [1, 2, 3]) {
      const p = new ScenarioGenerator(windConfig({ regime: 'persistent', seed }));
      near(p.background(1000), p.background(5000)); assert.notEqual(p.background(1000), 0);
    }
  });
  it('maintains statistical pressure and directional bias across many scenario seeds', () => {
    for (const side of ['left', 'right']) {
      let puffs = 0, favoredPuffs = 0, pockets = 0, oppositePockets = 0, favorable = 0, favored = 0;
      for (let seed = 0; seed < 1000; seed++) {
        const field = new WindField({ seed, favoredSide: side });
        const s = field.spawns.stats, right = side === 'right';
        puffs += s.puffLeft + s.puffRight; favoredPuffs += right ? s.puffRight : s.puffLeft;
        pockets += s.pocketLeft + s.pocketRight; oppositePockets += right ? s.pocketLeft : s.pocketRight;
        favorable += s.favorable; favored += s.favoredTotal;
      }
      for (const ratio of [favoredPuffs / puffs, oppositePockets / pockets, favorable / favored])
        assert.ok(ratio > 0.59 && ratio < 0.71, `${side}: ${ratio}`);
    }
  });
  it('rejects invalid inputs and keeps physics clocks identical at different display frame rates', () => {
    assert.throws(() => new WindField({ seed: 0.5 })); assert.throws(() => new WindField({ contrast: NaN }));
    assert.throws(() => new WindField().sample(0, 0, Infinity));
    const a = new SimulationClock(), b = new SimulationClock();
    for (let i = 0; i < 600; i++) a.advance(1 / 60, 4);
    for (let i = 0; i < 240; i++) b.advance(1 / 24, 4);
    assert.equal(a.time, 40); assert.equal(b.time, a.time);
    assert.deepEqual(new WindField().sample(0, 500, a.time), new WindField().sample(0, 500, b.time));
  });
});

const constantField = (kind = 'background', influence = 0) => ({ config: windConfig({ width: 400, height: 250 }),
  sample: () => ({ vx: 0, vy: 0, direction: 0, speedKnots: 10, kind, influence }) });

describe('area-based particles', () => {
  it('gives 4x puff and 0.4x pocket core density with continuous fringes', () => {
    near(densityFactor({ kind: 'puff', influence: 1 }), 4);
    near(densityFactor({ kind: 'pocket', influence: 1 }), 0.4);
    near(densityFactor({ kind: 'background', influence: 0 }), 1);
    near(densityFactor({ kind: 'puff', influence: 0.5 }), 2.5);
    near(densityFactor({ kind: 'pocket', influence: 0.5 }), 0.7);
  });
  it('scales integrated particle targets with feature surface area, never fixed counts', () => {
    const totals = [];
    for (const size of [40, 80]) {
      const shape = new FeatureShape(seededRandom(8), size, size * 1.25);
      const f = { config: windConfig({ width: 400, height: 400, boatLength: 1 }), sample: (x, y) => ({ kind: 'puff', influence: shape.influence(x, y - 200) }) };
      const density = new DensityManager(f, seededRandom(8)); density.updateTargets(0, 0, true);
      totals.push(density.cells.reduce((sum, c) => sum + c.target, 0) - BASE_DENSITY * 400 * 400);
    }
    near(totals[1] / totals[0], 4, 0.025);
  });
  it('independently staggers birth clocks and fade phases', () => {
    const particles = new ParticleSystem(constantField());
    const clocks = particles.density.cells.map(c => c.nextBirth);
    assert.equal(new Set(clocks).size, clocks.length);
    const birthTimes = [];
    for (let i = 0; i < 150; i++) {
      particles.update(0.02, 0);
      for (const p of particles.active) if (p.age === 0) birthTimes.push(p.bornAt);
    }
    assert.ok(new Set(birthTimes).size > 40);
    assert.ok(particles.active.some(p => particleOpacity(p) < 0.5));
    assert.ok(particles.active.some(p => particleOpacity(p) > 0.9));
  });
  it('adjusts birth hazards when pressure changes without synchronized births', () => {
    const field = constantField('pocket', 1), density = new DensityManager(field, seededRandom(8));
    density.updateTargets(0, 0, true);
    const original = density.cells.map(c => c.nextBirth);
    field.sample = () => ({ kind: 'puff', influence: 1 });
    density.updateTargets(10, 0.01, true);
    for (let i = 0; i < density.cells.length; i++)
      near(density.cells[i].nextBirth, 0.01 + Math.max(0, original[i] - 0.01) / 10);
    assert.equal(new Set(density.cells.map(c => c.nextBirth)).size, density.cells.length);
  });
  it('keeps populations stable over time at all three target densities', () => {
    for (const [kind, influence, factor] of [['background', 0, 1], ['puff', 1, 4], ['pocket', 1, 0.4]]) {
      const particles = new ParticleSystem(constantField(kind, influence));
      let sum = 0, count = 0;
      for (let i = 0; i < 2500; i++) {
        particles.update(0.04, 0);
        if (i > 250) { sum += particles.active.length; count++; }
      }
      const expected = BASE_DENSITY * 400 * 250 * factor, ratio = sum / count / expected;
      assert.ok(ratio > 0.8 && ratio < 1.2, `${kind}: actual/target=${ratio}`);
    }
  });
  it('allows particles to cross cells and recycles without drawing unbounded trails at any zoom', () => {
    const f = constantField(); f.sample = () => ({ vx: 3, vy: -4, speedKnots: 10, kind: 'background', influence: 0 });
    const particles = new ParticleSystem(f), p = particles.active[0]; p.x = -1; p.y = 150; p.age = 0; p.life = 2;
    const previousCell = particles.density.index(p.x, p.y); particles.update(0.2, 0);
    assert.notEqual(particles.density.index(p.x, p.y), previousCell);
    for (const scale of [0.1, 1, 10]) for (const x of [-100000, 0, 100000]) {
      const trail = trailGeometry({ x, y: 100 }, f.sample(), { ox: 500, oy: 800, scale });
      assert.ok(Math.hypot(trail.x - trail.tx, trail.y - trail.ty) <= 18.000001);
    }
    for (let i = 0; i < 100; i++) particles.update(0.04, 0);
    assert.ok(particles.pool.length > 0);
  });
  it('uses equal coordinate scale at desktop and mobile sizes', () => {
    for (const [w, h] of [[1100, 850], [350, 460]]) {
      const c = cameraFor(w, h, windConfig());
      assert.ok(c.scale > 0); assert.ok(720 * c.scale <= w); assert.ok(1000 * c.scale <= h);
      near(100 * c.scale, Math.hypot(100 * c.scale, 0));
    }
  });
});

describe('shared boat and optimizer field adapter', () => {
  it('samples the same worker-safe field through the existing boat physics and optimizer', () => {
    const scenario = attachWindField(createScenario({ courseLength: 100, windMode: 'steady', seed: 8 }), { maxShift: 10 });
    const clone = structuredClone(scenario), field = fieldForScenario(scenario), probe = new BoatProbe(field);
    probe.x = 0; probe.y = 0;
    near(windAtPosition(scenario, 0, 0, 0), probe.sample(0).direction > 180 ? probe.sample(0).direction - 360 : probe.sample(0).direction);
    assert.deepEqual(advance(initialBoat(), scenario, 20), advance(initialBoat(), clone, 20));
    const result = search(scenario, { interval: 2, width: 60, cell: 1, horizon: 300 });
    assert.ok(result.route?.finish.finished || result.finish?.finished, 'Optimizer should find a legal finish');
    const route = result.route || result;
    const repeated = replay(clone, route.commands, route.finish.time + 1);
    near(repeated.finish.time, route.finish.time, 1e-5);
  });
});
