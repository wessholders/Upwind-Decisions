import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, KNOT_TO_MPS, STEP } from '../src/engine/config';
import { direction, layline, signedAngle, validHeading } from '../src/engine/geometry';
import { gateEnd, finishFraction } from '../src/engine/finish';
import { advance, applyAction, canBearAway, compassHeading, initialBoat, sailingHeading } from '../src/engine/physics';
import { replay } from '../src/engine/race';
import { createScenario, windAt } from '../src/engine/wind';
import { search } from '../src/engine/optimizer';
import type { Boat, Config, Scenario } from '../src/engine/types';

const scenario = (extra: Partial<Config> = {}) => createScenario({ ...DEFAULT_CONFIG, windMode: 'steady', ...extra });
const at = (x: number, y: number, extra: Partial<Boat> = {}): Boat => ({ ...initialBoat(), position: { x, y }, ...extra });

describe('sailing geometry and shared movement', () => {
  it('starts on starboard, close-hauled up-left at 45 degrees', () => {
    const s = scenario();
    const boat = advance(initialBoat(), s, 10);
    expect(sailingHeading(initialBoat(), s)).toBe(-45);
    expect(boat.position.x).toBeCloseTo(-boat.position.y, 10);
    expect(boat.position.x).toBeLessThan(0);
    expect(boat.distance).toBeCloseTo(10 * 5 * KNOT_TO_MPS, 9);
  });
  it.each([0, 45, 120, 225])('rotates compass headings by baseline %s without rotating screen geometry', baseline => {
    const s = scenario({ baseline });
    expect(compassHeading(initialBoat(), s)).toBe((baseline + 315) % 360);
    expect(compassHeading({ ...initialBoat(), tack: 'port' }, s)).toBe((baseline + 45) % 360);
    expect(advance(initialBoat(), s, 10).position).toEqual(advance(initialBoat(), scenario(), 10).position);
  });
  it('positive shifts rotate wind and headings clockwise', () => {
    const s = scenario(); s.wind = [{ time: 0, direction: 15 }];
    expect(sailingHeading(initialBoat(), s)).toBe(-30);
    expect(gateEnd(s, 0).x).toBeGreaterThan(0);
  });
  it('charges stationary penalties exactly, including partial steps', () => {
    const s = scenario({ tackPenalty: 5.1 });
    const tacked = applyAction(initialBoat(), 'tack', s);
    expect(tacked.tack).toBe('port');
    expect(advance(tacked, s, 5).position).toEqual({ x: 0, y: 0 });
    const moving = advance(tacked, s, 6);
    expect(moving.penaltyTime).toBeCloseTo(5.1, 10);
    expect(moving.distance).toBeCloseTo(0.9 * 5 * KNOT_TO_MPS, 9);
    expect(applyAction(advance(tacked, s, 1), 'tack', s).tacks).toBe(1);
  });
  it('allows immediate tacks and zero penalties without artificial minimum time', () => {
    const s = scenario({ tackPenalty: 0 });
    expect(advance(applyAction(initialBoat(), 'tack', s), s, STEP).position.x).toBeGreaterThan(0);
  });
  it('integrates the same fixed steps independent of rendering batches', () => {
    const s = createScenario(DEFAULT_CONFIG);
    let single = initialBoat();
    for (let i = 0; i < 400; i++) single = advance(single, s);
    expect(advance(initialBoat(), s, 100)).toEqual(single);
  });
});

describe('bearing away and laylines', () => {
  it('bears toward the gate after overstanding, on the same legal tack', () => {
    const s = scenario();
    const boat = at(100, 1150, { mode: 'gate' });
    const heading = sailingHeading(boat, s);
    expect(validHeading(heading, 0, 'starboard', 45)).toBe(true);
    expect(Math.abs(heading)).toBeGreaterThan(45);
    expect(advance(boat, s, 10).position.y).toBeLessThan(1150);
    expect(canBearAway(boat, s)).toBe(true);
  });
  it('cannot aim through the no-go zone or change tack through bear away', () => {
    const s = scenario();
    for (const tack of ['starboard', 'port'] as const) for (const x of [-500, -100, 0, 100, 500]) for (const y of [0, 900, 1050, 1200]) {
      const boat = at(x, y, { mode: 'gate', tack });
      expect(validHeading(sailingHeading(boat, s), 0, tack, 45)).toBe(true);
    }
  });
  it('projects 100 boatlengths backward along each legal close-hauled heading', () => {
    const mark = { x: 0, y: 1000 };
    for (const tack of ['starboard', 'port'] as const) {
      const end = layline(mark, 15, tack, 45, 500);
      expect(Math.hypot(end.x, end.y - 1000)).toBeCloseTo(500, 9);
      const forward = direction(15 + (tack === 'starboard' ? -45 : 45));
      expect(end.x + forward.x * 500).toBeCloseTo(mark.x, 9);
      expect(end.y + forward.y * 500).toBeCloseTo(mark.y, 9);
    }
  });
});

describe('seeded wind', () => {
  it('is reproducible, bounded, smooth, and independent of query order', () => {
    const a = createScenario(DEFAULT_CONFIG), b = createScenario(DEFAULT_CONFIG);
    expect(a).toEqual(b);
    expect(createScenario({ ...DEFAULT_CONFIG, seed: 55 }).wind).not.toEqual(a.wind);
    for (let t = 0; t < 2000; t += 0.7) {
      expect(Math.abs(windAt(a, t))).toBeLessThanOrEqual(15);
      expect(windAt(a, t)).toBe(windAt(b, t));
    }
    const before = windAt(a, 250);
    windAt(a, 17000);
    expect(windAt(a, 250)).toBe(before);
    expect(a.wind.some((k, i) => i > 1 && k.direction !== 0 && k.direction * a.wind[i - 2].direction > 0)).toBe(true);
  });
  it('persistent wind starts, shifts in either direction, and then stabilizes', () => {
    const signs = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      const s = scenario({ windMode: 'persistent', seed });
      expect(windAt(s, 0)).toBe(0);
      expect(windAt(s, 10000)).toBe(windAt(s, 20000));
      signs.add(Math.sign(windAt(s, 10000)));
    }
    expect(signs.size).toBe(2);
  });
  it('rejects nonphysical and nonfinite configuration', () => {
    expect(() => scenario({ speedKnots: 0 })).toThrow();
    expect(() => scenario({ maxShift: NaN })).toThrow();
  });
});

describe('finite rotating finish gate', () => {
  it('interpolates a valid starboard crossing and stops the clock exactly', () => {
    const s = scenario();
    expect(finishFraction(s, { x: 1, y: 1050 }, { x: -1, y: 1052 }, 0, 1, 'starboard')).toBeCloseTo(0.5, 9);
    const boat = advance(at(0.1, 1050), s);
    expect(boat.finished).toBe(true);
    expect(boat.time).toBeCloseTo(0.1 / (5 * KNOT_TO_MPS / Math.sqrt(2)), 8);
    expect(boat.position.x).toBeCloseTo(0, 8);
    expect(boat.distance).toBeCloseTo(0.1 * Math.sqrt(2), 8);
  });
  it('rejects port tack, wrong direction, infinite extensions and stationary gate sweeps', () => {
    const s = scenario();
    expect(finishFraction(s, { x: 1, y: 1050 }, { x: -1, y: 1052 }, 0, 1, 'port')).toBeNull();
    expect(finishFraction(s, { x: -1, y: 1050 }, { x: 1, y: 1052 }, 0, 1, 'starboard')).toBeNull();
    for (const y of [999, 1101]) expect(finishFraction(s, { x: 1, y }, { x: -1, y }, 0, 1, 'starboard')).toBeNull();
    expect(finishFraction(s, { x: 1, y: 1050 }, { x: 1, y: 1050 }, 0, 1, 'starboard')).toBeNull();
  });
  it('intersects the actual rotating gate rather than a frozen end-of-step gate', () => {
    const s: Scenario = { ...scenario(), wind: [{ time: 0, direction: -10 }, { time: 1, direction: 10 }] };
    const from = { x: 1, y: 1050 }, to = { x: -1, y: 1050 };
    const u = finishFraction(s, from, to, 0, 1, 'starboard');
    expect(u).toBeCloseTo(0.5, 8);
  });
});

describe('analytical baselines and optimizer legality', () => {
  it('matches the independent steady-wind time and distance with two tacks', () => {
    const s = scenario();
    const sailingTime = 1000 / (5 * KNOT_TO_MPS * Math.cos(Math.PI / 4));
    const first = 10;
    const route = replay(s, [{ time: first, action: 'tack' }, { time: first + 5 + sailingTime / 2, action: 'tack' }], sailingTime + 20);
    expect(route.finish.finished).toBe(true);
    expect(route.finish.time).toBeCloseTo(sailingTime + 10, 7);
    expect(route.finish.distance).toBeCloseTo(1000 * Math.sqrt(2), 6);
    expect(route.finish.penaltyTime).toBeCloseTo(10, 8);
  });
  it('finds and reproduces a legal route near the analytical steady-wind optimum', () => {
    const s = scenario({ courseLength: 100 });
    const result = search(s, { interval: 2, width: 100, cell: 1 });
    expect(result.route).not.toBeNull();
    const route = result.route!;
    expect(route.points[0]).toEqual(initialBoat());
    expect(route.finish.finished).toBe(true);
    expect(route.finish.tack).toBe('starboard');
    const lowerBound = 100 / (5 * KNOT_TO_MPS * Math.cos(Math.PI / 4));
    expect(route.finish.time).toBeGreaterThanOrEqual(lowerBound);
    expect(route.finish.time).toBeLessThan(lowerBound + 18);
    expect(replay(s, route.commands, route.finish.time + 1).finish).toEqual(route.finish);
    for (const point of route.points) {
      expect(Math.abs(signedAngle(sailingHeading(point, s) - windAt(s, point.time)))).toBeGreaterThanOrEqual(45 - 1e-8);
      expect(point.distance).toBeLessThanOrEqual(point.time * s.config.speedKnots * KNOT_TO_MPS + 1e-7);
    }
    expect(search(s, { interval: 2, width: 100, cell: 1 }).route?.commands).toEqual(route.commands);
  }, 20000);
});
