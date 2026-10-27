import { windVector } from './config.js';

export class WindFeature {
  constructor(spec, tick = 0) {
    Object.assign(this, spec);
    this.bornTick = tick; this.endTick = Infinity;
    this.positions = [spec.x, spec.y];
  }
  move(trend, config, dt) {
    const vector = windVector(trend + this.shift, this.speedKnots);
    this.x += vector.vx * dt * config.translation;
    this.y += vector.vy * dt * config.translation;
    this.positions.push(this.x, this.y);
  }
  at(tickTime) {
    const u = Math.max(0, tickTime - this.bornTick), k = Math.min(Math.floor(u), this.positions.length / 2 - 1);
    const next = Math.min(k + 1, this.positions.length / 2 - 1), f = u - Math.floor(u);
    return { feature: this, x: this.positions[2 * k] * (1 - f) + this.positions[2 * next] * f,
      y: this.positions[2 * k + 1] * (1 - f) + this.positions[2 * next + 1] * f, shape: this.shape };
  }
}
