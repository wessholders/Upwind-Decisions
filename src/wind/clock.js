import { WIND_STEP } from './config.js';

export class SimulationClock {
  constructor() { this.ticks = 0; this.accumulator = 0; }
  advance(elapsed, speed = 1) {
    if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(speed) || speed < 0) throw new Error('Invalid elapsed time or speed.');
    this.accumulator += elapsed * speed;
    const steps = Math.floor((this.accumulator + 1e-10) / WIND_STEP);
    this.accumulator -= steps * WIND_STEP;
    this.ticks += steps;
    return this.time;
  }
  get time() { return this.ticks * WIND_STEP; }
}
