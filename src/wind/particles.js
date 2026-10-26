import { seededRandom, between } from './random.js';
import { DensityManager } from './density.js';
import { clamp } from './config.js';

export function particleOpacity(p) {
  const life = Math.min(p.age / 0.35, (p.life - p.age) / 0.55, 1);
  const retirement = p.retireAt === Infinity ? 1 : 1 - (p.age - p.retireAt) / p.retireDuration;
  return clamp(Math.min(life, retirement), 0, 1);
}
export function trailGeometry(p, sample, camera) {
  const magnitude = Math.hypot(sample.vx, sample.vy);
  const length = clamp(9 * sample.speedKnots / 10, 5, 18);
  const x = camera.ox + p.x * camera.scale, y = camera.oy - p.y * camera.scale;
  return { x, y, tx: x - sample.vx / (magnitude || 1) * length, ty: y + sample.vy / (magnitude || 1) * length, length };
}

export class ParticleSystem {
  constructor(field, quality = 1, initialFieldTime = 0) {
    this.field = field;
    this.random = seededRandom(field.config.seed ^ 0x17ca90b3);
    this.active = []; this.pool = []; this.time = 0;
    this.density = new DensityManager(field, this.random, quality);
    this.density.updateTargets(initialFieldTime, 0, true);
    this.density.initialize(this);
  }
  birth(cell, stagger = false) {
    if (this.active.length >= 7000) return;
    const p = this.pool.pop() || {};
    p.x = between(this.random, cell.x, cell.x + cell.width);
    p.y = between(this.random, cell.y, cell.y + cell.height);
    p.life = between(this.random, 1.8, 2.4);
    // Equilibrium initialization: length-biased lifetimes and uniform ages.
    // For these narrow lifetime bounds, use rejection to sample exactly.
    if (stagger) {
      while (this.random() > p.life / 2.4) p.life = between(this.random, 1.8, 2.4);
    }
    p.age = stagger ? between(this.random, 0, p.life) : 0;
    p.bornAt = this.time - p.age; p.retireAt = Infinity; p.retireDuration = 0; p.next = -1;
    this.active.push(p);
  }
  update(dt, fieldTime) {
    this.time += dt;
    let count = 0;
    const c = this.field.config;
    for (const p of this.active) {
      const wind = this.field.sample(p.x, p.y, fieldTime);
      // Visual advection multiplier only; lifetime uses display seconds.
      p.x += wind.vx * dt * 3.2; p.y += wind.vy * dt * 3.2; p.age += dt;
      if (p.age >= p.life || p.age >= p.retireAt + p.retireDuration || p.x < -c.width / 2 || p.x >= c.width / 2 || p.y < 0 || p.y >= c.height)
        this.pool.push(p);
      else this.active[count++] = p;
    }
    this.active.length = count;
    this.density.updateTargets(fieldTime, this.time);
    this.density.maintain(this, dt);
  }
}
