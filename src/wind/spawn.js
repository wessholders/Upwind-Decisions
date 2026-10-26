import { FeatureShape, overlaps } from './shape.js';
import { WindFeature } from './feature.js';
import { seededRandom, between, exponential } from './random.js';
import { clamp } from './config.js';
import { motionClearance } from './interactions.js';

export class SpawnManager {
  constructor(config) {
    this.config = config;
    this.random = seededRandom(config.seed ^ 0x87e10a43);
    this.scheduleRandom = seededRandom(config.seed ^ 0x123fe7a1);
    this.nextTime = this.wait(); this.nextId = 1;
    this.stats = { puffLeft: 0, puffRight: 0, pocketLeft: 0, pocketRight: 0, favorable: 0, favoredTotal: 0, skipped: 0 };
  }
  wait() { return this.config.frequency ? exponential(this.scheduleRandom, 60 / this.config.frequency) : Infinity; }
  // Select type/side once per event, THEN retry positions. Redrawing type/side
  // on every failed placement would distort the requested 65/35 distribution.
  candidate() {
    const c = this.config, r = this.random, kind = r() < c.puffProbability ? 'puff' : 'pocket';
    const favored = c.favoredSide !== 'balanced', favoredRight = c.favoredSide === 'right';
    const pressureRight = favored ? (favoredRight ? c.probability : 1 - c.probability) : 0.5;
    const right = r() < (kind === 'puff' ? pressureRight : 1 - pressureRight);
    const onFavored = favored && right === favoredRight;
    const preferredSign = favoredRight ? 1 : -1;
    const sign = onFavored ? (r() < c.probability ? preferredSign : -preferredSign) : (r() < 0.5 ? -1 : 1);
    const width = clamp(c.sizeBL * between(r, 0.65, 1.35), 15, 75) * c.boatLength;
    return { id: this.nextId++, kind, right, onFavored,
      shift: sign * c.maxShift * between(r, 0.24, 1),
      speedKnots: c.windKnots * (1 + (kind === 'puff' ? 1 : -1) * c.contrast * between(r, 0.65, 1.25)),
      lifetime: between(r, 300, 850),
      shape: new FeatureShape(r, width / 2, width * 1.25 / 2, between(r, -0.3, 0.3)) };
  }
  spawn(active, tick, initial = false) {
    const spec = this.candidate(), c = this.config;
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = (spec.right ? 1 : -1) * between(this.random, c.width * 0.06, c.width * 0.43);
      const y = initial ? between(this.random, 90, c.height - 30) : c.height + spec.shape.bound + 10;
      const candidate = { ...spec, x, y };
      if (active.some(other => overlaps(candidate, other, Math.max(c.boatLength * 2, motionClearance(c))))) continue;
      this.stats[spec.kind + (spec.right ? 'Right' : 'Left')]++;
      if (spec.onFavored) {
        this.stats.favoredTotal++;
        if (Math.sign(spec.shift) === (c.favoredSide === 'right' ? 1 : -1)) this.stats.favorable++;
      }
      return new WindFeature(candidate, tick);
    }
    this.stats.skipped++;
    return null;
  }
}
