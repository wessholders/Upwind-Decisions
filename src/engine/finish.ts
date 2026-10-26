import { cross, direction, dot, interpolate, subtract } from './geometry';
import type { Scenario, Tack, Vec } from './types';
import { windAt } from './wind';

export function gateEnd(scenario: Scenario, time: number): Vec {
  const v = direction(windAt(scenario, time));
  const length = scenario.config.boatLength * scenario.config.gateBoatLengths;
  return { x: v.x * length, y: scenario.config.courseLength + v.y * length };
}

// Find a crossing of the rotating finite gate during a linear integration substep.
// A sweeping gate alone cannot finish a stationary or rightward-moving boat.
export function finishFraction(scenario: Scenario, from: Vec, to: Vec, startTime: number, dt: number, tack: Tack): number | null {
  if (tack !== 'starboard' || to.x >= from.x - 1e-12) return null;
  const mark = { x: 0, y: scenario.config.courseLength };
  const side = (u: number) => cross(direction(windAt(scenario, startTime + dt * u)), subtract(interpolate(from, to, u), mark));
  let previous = side(0);
  for (let i = 1; i <= 4; i++) {
    const end = i / 4, next = side(end);
    if (previous < -1e-10 && next >= -1e-10) {
      let low = (i - 1) / 4, high = end;
      for (let j = 0; j < 35; j++) {
        const mid = (low + high) / 2;
        if (side(mid) < 0) low = mid;
        else high = mid;
      }
      const u = (low + high) / 2;
      const along = dot(subtract(interpolate(from, to, u), mark), direction(windAt(scenario, startTime + dt * u)));
      const length = scenario.config.boatLength * scenario.config.gateBoatLengths;
      if (along >= -1e-7 && along <= length + 1e-7) return u;
    }
    previous = next;
  }
  return null;
}
