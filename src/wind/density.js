import { clamp } from './config.js';
import { exponential, between } from './random.js';

export const BASE_DENSITY = 0.0007;
export const PUFF_DENSITY = 4;
export const POCKET_DENSITY = 0.4;
export const MEAN_LIFE = 2.1;
export function densityFactor(sample) {
  const factor = sample.kind === 'puff' ? PUFF_DENSITY : sample.kind === 'pocket' ? POCKET_DENSITY : 1;
  return 1 + (factor - 1) * sample.influence;
}

export class DensityManager {
  constructor(field, random, quality = 1) {
    this.field = field; this.random = random; this.quality = quality;
    this.cells = []; this.lastSample = -Infinity;
    const c = field.config;
    this.cellSize = c.boatLength * 5;
    this.cols = Math.ceil(c.width / this.cellSize);
    this.rows = Math.ceil(c.height / this.cellSize);
    for (let iy = 0; iy < this.rows; iy++) for (let ix = 0; ix < this.cols; ix++) {
      const x = -c.width / 2 + ix * this.cellSize, y = iy * this.cellSize;
      this.cells.push({ x, y, width: Math.min(this.cellSize, c.width / 2 - x), height: Math.min(this.cellSize, c.height - y),
        target: 0, count: 0, head: -1, nextBirth: exponential(random, MEAN_LIFE) });
    }
  }
  updateTargets(time, visualTime, force = false) {
    if (!force && visualTime - this.lastSample < 0.3) return;
    this.lastSample = visualTime;
    for (const cell of this.cells) {
      const oldTarget = cell.target;
      let factor = 0;
      for (const [u, v] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]])
        factor += densityFactor(this.field.sample(cell.x + u * cell.width, cell.y + v * cell.height, time));
      cell.target = BASE_DENSITY * this.quality * cell.width * cell.height * factor / 4;
      // Preserve each clock's independent remaining exponential hazard when
      // pressure changes. Keeping the old wall-clock deadline can leave a
      // newly arrived puff sparse for an entire previous pocket birth interval.
      if (oldTarget > 0 && cell.target > 0)
        cell.nextBirth = visualTime + Math.max(0, cell.nextBirth - visualTime) * oldTarget / cell.target;
    }
  }
  index(x, y) {
    const ix = Math.floor((x + this.field.config.width / 2) / this.cellSize), iy = Math.floor(y / this.cellSize);
    return ix < 0 || ix >= this.cols || iy < 0 || iy >= this.rows ? -1 : iy * this.cols + ix;
  }
  initialize(particles) {
    for (const cell of this.cells) {
      const n = Math.floor(cell.target) + (this.random() < cell.target % 1 ? 1 : 0);
      for (let i = 0; i < n; i++) particles.birth(cell, true);
      cell.nextBirth = exponential(this.random, MEAN_LIFE / Math.max(0.0001, cell.target));
    }
  }
  maintain(particles, dt) {
    // Reusable per-cell linked occupancy lists avoid scans or Maps per cell.
    for (const cell of this.cells) { cell.count = 0; cell.head = -1; }
    for (let i = 0; i < particles.active.length; i++) {
      const p = particles.active[i], index = this.index(p.x, p.y);
      if (index < 0) continue;
      const cell = this.cells[index]; p.next = cell.head; cell.head = i; cell.count++;
    }
    for (const cell of this.cells) {
      // Birth rate corrects advective population drift without replacing all
      // particles at a density tick. Clocks are independent for every cell.
      if (particles.time >= cell.nextBirth) {
        particles.birth(cell);
        const correction = clamp(1 + (cell.target - cell.count) * 0.3, 0.35, 2);
        const rate = cell.target / MEAN_LIFE * correction;
        cell.nextBirth = particles.time + exponential(this.random, 1 / Math.max(1e-6, rate));
      }
      if (cell.count > Math.ceil(cell.target) + 2 && this.random() < dt * (cell.count - cell.target) * 0.3) {
        const p = particles.active[cell.head];
        if (p && p.retireAt === Infinity) { p.retireAt = p.age; p.retireDuration = between(this.random, 0.35, 0.7); }
      }
    }
  }
}
