import { WIND_STEP, windConfig, windVector, bearing, KNOT } from './config.js';
import { ScenarioGenerator } from './scenario.js';
import { SpawnManager } from './spawn.js';
import { InteractionManager } from './interactions.js';

// Physics-only, append-only history. Query order does not change answers:
// the optimizer can sample arbitrary past/future times independently of UI.
export class WindField {
  constructor(input = {}) {
    this.config = windConfig(input);
    this.scenario = new ScenarioGenerator(this.config);
    this.spawns = new SpawnManager(this.config);
    this.interactions = new InteractionManager();
    this.tick = 0; this.history = []; this.active = []; this.buckets = new Map();
    this.cachedTime = NaN; this.cachedFeatures = [];
    for (let i = 0; i < this.config.initialFeatures; i++) {
      const feature = this.spawns.spawn(this.active, 0, true);
      if (feature) { this.active.push(feature); this.history.push(feature); }
    }
    this.active = this.interactions.resolve(this.active, 0, this.config);
    this.indexTick();
  }
  indexTick() {
    const bucket = Math.floor(this.tick * WIND_STEP / 10);
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Set());
    for (const f of this.active) this.buckets.get(bucket).add(f);
  }
  ensure(time) {
    if (!Number.isFinite(time) || time < 0 || time > 86400) throw new Error('Wind time must be in [0, 86400] seconds.');
    const goal = Math.ceil(time / WIND_STEP) + 1;
    while (this.tick < goal) {
      this.tick++;
      const t = this.tick * WIND_STEP, trend = this.scenario.background(t - WIND_STEP / 2);
      for (const f of this.active) f.move(trend, this.config, WIND_STEP);
      this.active = this.active.filter(f => {
        const expired = t >= f.bornTick * WIND_STEP + f.lifetime || f.y + f.shape.bound < -60 || Math.abs(f.x) - f.shape.bound > this.config.width;
        if (expired) f.endTick = this.tick;
        return !expired;
      });
      this.active = this.interactions.resolve(this.active, this.tick, this.config);
      while (t >= this.spawns.nextTime) {
        const f = this.spawns.spawn(this.active, this.tick);
        if (f) { this.active.push(f); this.history.push(f); }
        this.spawns.nextTime += this.spawns.wait();
      }
      this.indexTick();
    }
  }
  featuresAt(time) {
    if (this.cachedTime === time) return this.cachedFeatures;
    this.ensure(time);
    const tickTime = time / WIND_STEP;
    const list = this.buckets.get(Math.floor(time / 10)) || [];
    this.cachedFeatures = Array.from(list).filter(f => f.bornTick <= tickTime && tickTime < f.endTick).map(f => f.at(tickTime));
    this.cachedTime = time;
    return this.cachedFeatures;
  }
  sample(x, y, time) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Wind position must be finite.');
    const features = this.featuresAt(time), trend = this.scenario.background(time);
    // The course's ambient wind always comes directly from upwind. Regime
    // shifts affect feature interiors and their movement, never open water.
    const background = windVector(0, this.config.windKnots);
    let weight = 0, fx = 0, fy = 0, strongest = 0, kind = 'background';
    for (const p of features) {
      if (Math.abs(x - p.x) > p.shape.bound || Math.abs(y - p.y) > p.shape.bound) continue;
      const influence = p.shape.influence(x - p.x, y - p.y);
      if (influence <= 0) continue;
      const f = p.feature;
      // Defensive precedence also supports externally supplied overlapping data.
      if (kind === 'puff' && f.kind === 'pocket') continue;
      if (kind === 'pocket' && f.kind === 'puff') { weight = 0; fx = 0; fy = 0; strongest = 0; }
      kind = f.kind;
      const vector = windVector(trend + f.shift, f.speedKnots);
      weight += influence; fx += vector.vx * influence; fy += vector.vy * influence;
      strongest = Math.max(strongest, influence);
    }
    // Max influence prevents adding a second compatible fringe from creating
    // an abrupt pressure jump. Internal vectors are weighted, never summed.
    const vx = weight ? background.vx * (1 - strongest) + fx / weight * strongest : background.vx;
    const vy = weight ? background.vy * (1 - strongest) + fy / weight * strongest : background.vy;
    return { direction: bearing(Math.atan2(-vx, -vy) * 180 / Math.PI), speedKnots: Math.hypot(vx, vy) / KNOT,
      vx, vy, influence: strongest, kind, backgroundDirection: 0 };
  }
}

// Worker-safe descriptor: attach only plain configuration to the race scenario.
// Each realm reconstructs the same field, using a cache outside scenario data.
const fields = new WeakMap();
export function fieldForScenario(scenario) {
  if (!fields.has(scenario)) fields.set(scenario, new WindField(scenario.organicWind));
  return fields.get(scenario);
}
export function attachWindField(scenario, config = {}) {
  return { ...scenario, organicWind: { ...windConfig({ seed: scenario.config.seed, regime: scenario.config.windMode, ...config }) } };
}
