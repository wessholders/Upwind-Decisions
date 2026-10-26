import { overlaps } from './shape.js';
import { WIND_STEP, KNOT } from './config.js';

export const compatible = (a, b) => a.kind === b.kind && Math.sign(a.shift) === Math.sign(b.shift);
// Maximum relative displacement of any two generated features in one tick.
export const motionClearance = config => 2 * config.windKnots * (1 + 1.25 * config.contrast) * KNOT * config.translation * WIND_STEP;
export class InteractionManager {
  resolve(features, tick, config) {
    const survivors = [];
    // Puffs always win over pockets. Older IDs win contradictory same-kind
    // collisions. Removal is permanent in the scenario's history.
    const ordered = features.slice().sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'puff' ? -1 : 1) || a.id - b.id);
    for (const f of ordered) {
      // Include enough clearance for motion during the next fixed step.
      const clearance = motionClearance(config);
      if (survivors.some(g => !compatible(f, g) && overlaps(f, g, clearance))) f.endTick = tick;
      else survivors.push(f);
    }
    return survivors;
  }
}
