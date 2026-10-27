import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTo, each } from './helpers.js';
import { DEFAULT_CONFIG, KNOT_TO_MPS, STEP } from '../src/engine/config.js';
import { direction, layline, signedAngle, validHeading } from '../src/engine/geometry.js';
import { gateEnd, finishFraction } from '../src/engine/finish.js';
import { advance, applyAction, canBearAway, compassHeading, initialBoat, sailingHeading } from '../src/engine/physics.js';
import { replay } from '../src/engine/race.js';
import { createScenario, windAt } from '../src/engine/wind.js';
import { search } from '../src/engine/optimizer.js';
const scenario = (extra = {}) => createScenario({ ...DEFAULT_CONFIG, windMode: 'steady', ...extra });
const at = (x, y, extra = {}) => ({ ...initialBoat(), position: { x, y }, ...extra });
describe('sailing geometry and shared movement', () => {
    it('starts on starboard, close-hauled up-left at 45 degrees', () => {
        const s = scenario();
        const boat = advance(initialBoat(), s, 10);
        assert.strictEqual(sailingHeading(initialBoat(), s), -45);
        closeTo(boat.position.x, -boat.position.y, 10);
        assert.ok(boat.position.x < 0);
        closeTo(boat.distance, 10 * 5 * KNOT_TO_MPS, 9);
    });
    each([0, 45, 120, 225], 'rotates compass headings by baseline %s without rotating screen geometry', baseline => {
        const s = scenario({ baseline });
        assert.strictEqual(compassHeading(initialBoat(), s), (baseline + 315) % 360);
        assert.strictEqual(compassHeading({ ...initialBoat(), tack: 'port' }, s), (baseline + 45) % 360);
        assert.deepStrictEqual(advance(initialBoat(), s, 10).position, advance(initialBoat(), scenario(), 10).position);
    });
    it('positive shifts rotate wind and headings clockwise', () => {
        const s = scenario();
        s.wind = [{ time: 0, direction: 15 }];
        assert.strictEqual(sailingHeading(initialBoat(), s), -30);
        assert.ok(gateEnd(s, 0).x > 0);
    });
    it('charges stationary penalties exactly, including partial steps', () => {
        const s = scenario({ tackPenalty: 5.1 });
        const tacked = applyAction(initialBoat(), 'tack', s);
        assert.strictEqual(tacked.tack, 'port');
        assert.deepStrictEqual(advance(tacked, s, 5).position, { x: 0, y: 0 });
        const moving = advance(tacked, s, 6);
        closeTo(moving.penaltyTime, 5.1, 10);
        closeTo(moving.distance, 0.9 * 5 * KNOT_TO_MPS, 9);
        assert.strictEqual(applyAction(advance(tacked, s, 1), 'tack', s).tacks, 1);
    });
    it('allows immediate tacks and zero penalties without artificial minimum time', () => {
        const s = scenario({ tackPenalty: 0 });
        assert.ok(advance(applyAction(initialBoat(), 'tack', s), s, STEP).position.x > 0);
    });
    it('integrates the same fixed steps independent of rendering batches', () => {
        const s = createScenario(DEFAULT_CONFIG);
        let single = initialBoat();
        for (let i = 0; i < 400; i++)
            single = advance(single, s);
        assert.deepStrictEqual(advance(initialBoat(), s, 100), single);
    });
});
describe('bearing away and laylines', () => {
    it('bears toward the gate after overstanding, on the same legal tack', () => {
        const s = scenario();
        const boat = at(100, 1150, { mode: 'gate' });
        const heading = sailingHeading(boat, s);
        assert.strictEqual(validHeading(heading, 0, 'starboard', 45), true);
        assert.ok(Math.abs(heading) > 45);
        assert.ok(advance(boat, s, 10).position.y < 1150);
        assert.strictEqual(canBearAway(boat, s), true);
    });
    it('cannot aim through the no-go zone or change tack through bear away', () => {
        const s = scenario();
        for (const tack of ['starboard', 'port'])
            for (const x of [-500, -100, 0, 100, 500])
                for (const y of [0, 900, 1050, 1200]) {
                    const boat = at(x, y, { mode: 'gate', tack });
                    assert.strictEqual(validHeading(sailingHeading(boat, s), 0, tack, 45), true);
                }
    });
    it('projects 100 boatlengths backward along each legal close-hauled heading', () => {
        const mark = { x: 0, y: 1000 };
        for (const tack of ['starboard', 'port']) {
            const end = layline(mark, 15, tack, 45, 500);
            closeTo(Math.hypot(end.x, end.y - 1000), 500, 9);
            const forward = direction(15 + (tack === 'starboard' ? -45 : 45));
            closeTo(end.x + forward.x * 500, mark.x, 9);
            closeTo(end.y + forward.y * 500, mark.y, 9);
        }
    });
});
describe('seeded wind', () => {
    it('is reproducible, bounded, smooth, and independent of query order', () => {
        const a = createScenario(DEFAULT_CONFIG), b = createScenario(DEFAULT_CONFIG);
        assert.deepStrictEqual(a, b);
        assert.notDeepStrictEqual(createScenario({ ...DEFAULT_CONFIG, seed: 55 }).wind, a.wind);
        for (let t = 0; t < 2000; t += 0.7) {
            assert.ok(Math.abs(windAt(a, t)) <= 15);
            assert.strictEqual(windAt(a, t), windAt(b, t));
        }
        const before = windAt(a, 250);
        windAt(a, 17000);
        assert.strictEqual(windAt(a, 250), before);
        assert.strictEqual(a.wind.some((k, i) => i > 1 && k.direction !== 0 && k.direction * a.wind[i - 2].direction > 0), true);
    });
    it('persistent wind starts, shifts in either direction, and then stabilizes', () => {
        const signs = new Set();
        for (let seed = 0; seed < 20; seed++) {
            const s = scenario({ windMode: 'persistent', seed });
            assert.strictEqual(windAt(s, 0), 0);
            assert.strictEqual(windAt(s, 10000), windAt(s, 20000));
            signs.add(Math.sign(windAt(s, 10000)));
        }
        assert.strictEqual(signs.size, 2);
    });
    it('rejects nonphysical and nonfinite configuration', () => {
        assert.throws(() => scenario({ speedKnots: 0 }));
        assert.throws(() => scenario({ maxShift: NaN }));
    });
});
describe('finite rotating finish gate', () => {
    it('interpolates a valid starboard crossing and stops the clock exactly', () => {
        const s = scenario();
        closeTo(finishFraction(s, { x: 1, y: 1050 }, { x: -1, y: 1052 }, 0, 1, 'starboard'), 0.5, 9);
        const boat = advance(at(0.1, 1050), s);
        assert.strictEqual(boat.finished, true);
        closeTo(boat.time, 0.1 / (5 * KNOT_TO_MPS / Math.sqrt(2)), 8);
        closeTo(boat.position.x, 0, 8);
        closeTo(boat.distance, 0.1 * Math.sqrt(2), 8);
    });
    it('rejects port tack, wrong direction, infinite extensions and stationary gate sweeps', () => {
        const s = scenario();
        assert.strictEqual(finishFraction(s, { x: 1, y: 1050 }, { x: -1, y: 1052 }, 0, 1, 'port'), null);
        assert.strictEqual(finishFraction(s, { x: -1, y: 1050 }, { x: 1, y: 1052 }, 0, 1, 'starboard'), null);
        for (const y of [999, 1101])
            assert.strictEqual(finishFraction(s, { x: 1, y }, { x: -1, y }, 0, 1, 'starboard'), null);
        assert.strictEqual(finishFraction(s, { x: 1, y: 1050 }, { x: 1, y: 1050 }, 0, 1, 'starboard'), null);
    });
    it('intersects the actual rotating gate rather than a frozen end-of-step gate', () => {
        const s = { ...scenario(), wind: [{ time: 0, direction: -10 }, { time: 1, direction: 10 }] };
        const from = { x: 1, y: 1050 }, to = { x: -1, y: 1050 };
        const u = finishFraction(s, from, to, 0, 1, 'starboard');
        closeTo(u, 0.5, 8);
    });
});
describe('analytical baselines and optimizer legality', () => {
    it('matches the independent steady-wind time and distance with two tacks', () => {
        const s = scenario();
        const safeCrossingHeight = 1000 + s.config.boatLength;
        const sailingTime = safeCrossingHeight / (5 * KNOT_TO_MPS * Math.cos(Math.PI / 4));
        const first = 10;
        const route = replay(s, [{ time: first, action: 'tack' }, { time: first + 5 + sailingTime / 2, action: 'tack' }], sailingTime + 20);
        assert.strictEqual(route.finish.finished, true);
        closeTo(route.finish.time, sailingTime + 10, 7);
        closeTo(route.finish.distance, safeCrossingHeight * Math.sqrt(2), 6);
        closeTo(route.finish.penaltyTime, 10, 8);
    });
    it('finds and reproduces a legal route near the analytical steady-wind optimum', { timeout: 20000 }, () => {
        const s = scenario({ courseLength: 100 });
        const result = search(s, { interval: 2, width: 100, cell: 1 });
        assert.notStrictEqual(result.route, null);
        const route = result.route;
        assert.deepStrictEqual(route.points[0], initialBoat());
        assert.strictEqual(route.finish.finished, true);
        assert.strictEqual(route.finish.tack, 'starboard');
        const lowerBound = 100 / (5 * KNOT_TO_MPS * Math.cos(Math.PI / 4));
        assert.ok(route.finish.time >= lowerBound);
        assert.ok(route.finish.time < lowerBound + 18);
        assert.deepStrictEqual(replay(s, route.commands, route.finish.time + 1).finish, route.finish);
        for (const point of route.points) {
            assert.ok(Math.abs(signedAngle(sailingHeading(point, s) - windAt(s, point.time))) >= 45 - 1e-8);
            assert.ok(point.distance <= point.time * s.config.speedKnots * KNOT_TO_MPS + 1e-7);
        }
        assert.deepStrictEqual(search(s, { interval: 2, width: 100, cell: 1 }).route?.commands, route.commands);
    });
});
