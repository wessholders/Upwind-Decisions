import { seededRandom, between } from './random.js';
import { smooth } from './config.js';

export class ScenarioGenerator {
  constructor(config) {
    this.config = config;
    this.random = seededRandom(config.seed ^ 0x5c3fba91);
    this.knots = [{ time: 0, direction: 0 }];
    if (config.regime === 'persistent') {
      const start = between(this.random, 25, 80) * config.tempo;
      const angle = config.maxShift * between(this.random, 0.65, 1) * (this.random() < 0.5 ? -1 : 1);
      this.knots.push({ time: start, direction: 0 }, { time: start + between(this.random, 120, 240) * config.tempo, direction: angle });
    }
  }
  // Historical API name: the organic field applies this directional trend
  // inside features only. Open-water ambient wind remains course-relative 0°.
  background(time) {
    const knots = this.knots;
    if (this.config.regime === 'oscillating') {
      while (knots.at(-1).time < time) {
        const last = knots.at(-1);
        const hold = last.time + between(this.random, 25, 85) * this.config.tempo;
        knots.push({ time: hold, direction: last.direction }, {
          time: hold + this.config.transitionSeconds * between(this.random, 0.65, 1.35) * this.config.tempo,
          direction: between(this.random, -this.config.maxShift, this.config.maxShift),
        });
      }
    }
    let low = 0, high = knots.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (knots[mid].time <= time) low = mid; else high = mid - 1;
    }
    const a = knots[low], b = knots[low + 1];
    return b ? a.direction + (b.direction - a.direction) * smooth((time - a.time) / (b.time - a.time)) : a.direction;
  }
}
