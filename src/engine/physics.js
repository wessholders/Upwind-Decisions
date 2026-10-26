import { KNOT_TO_MPS, STEP } from './config.js';
import { direction, headingTo, interpolate, normalize, signedAngle, validHeading } from './geometry.js';
import { finishFraction, gateEnd } from './finish.js';
import { windAt } from './wind.js';
export const initialBoat = () => ({
    position: { x: 0, y: 0 }, time: 0, tack: 'starboard', mode: 'close',
    penaltyRemaining: 0, penaltyTime: 0, distance: 0, tacks: 0, finished: false,
});
export function sailingHeading(boat, scenario, time = boat.time) {
    const wind = windAt(scenario, time);
    const close = wind + (boat.tack === 'starboard' ? -scenario.config.minAngle : scenario.config.minAngle);
    if (boat.mode === 'gate') {
        const end = gateEnd(scenario, time);
        const aim = { x: end.x * 0.5, y: (scenario.config.courseLength + end.y) * 0.5 };
        const direct = headingTo(boat.position, aim);
        if (validHeading(direct, wind, boat.tack, scenario.config.minAngle))
            return direct;
    }
    return close;
}
export function canBearAway(boat, scenario) {
    const close = sailingHeading({ ...boat, mode: 'close' }, scenario);
    const direct = sailingHeading({ ...boat, mode: 'gate' }, scenario);
    return Math.abs(signedAngle(direct - close)) > 0.1;
}
export const compassHeading = (boat, scenario) => normalize(sailingHeading(boat, scenario) + scenario.config.baseline);
export function applyAction(boat, action, scenario) {
    if (boat.finished || boat.penaltyRemaining > 1e-9)
        return boat;
    if (action === 'tack')
        return { ...boat, tack: boat.tack === 'starboard' ? 'port' : 'starboard', mode: 'close', tacks: boat.tacks + 1, penaltyRemaining: scenario.config.tackPenalty };
    if (action === 'bear')
        return { ...boat, mode: 'gate' };
    if (action === 'close')
        return { ...boat, mode: 'close' };
    return boat;
}
export function advance(boat, scenario, duration = STEP) {
    if (duration < 0 || !Number.isFinite(duration))
        throw new Error('Duration must be finite and nonnegative.');
    if (boat.finished)
        return boat;
    let state = boat;
    const endTime = boat.time + duration;
    while (state.time < endTime - 1e-9 && !state.finished) {
        const dt = Math.min(STEP, endTime - state.time);
        const stopped = Math.min(dt, state.penaltyRemaining);
        const moving = dt - stopped;
        const moveTime = state.time + stopped;
        let next = { ...state, time: state.time + dt, penaltyRemaining: Math.max(0, state.penaltyRemaining - dt), penaltyTime: state.penaltyTime + stopped };
        if (moving > 1e-10) {
            const v = direction(sailingHeading(state, scenario, moveTime + moving / 2));
            const distance = scenario.config.speedKnots * KNOT_TO_MPS * moving;
            const position = { x: state.position.x + v.x * distance, y: state.position.y + v.y * distance };
            const fraction = finishFraction(scenario, state.position, position, moveTime, moving, state.tack);
            next = { ...next, position: fraction === null ? position : interpolate(state.position, position, fraction), distance: state.distance + distance * (fraction ?? 1) };
            if (fraction !== null)
                next = { ...next, time: moveTime + moving * fraction, finished: true };
        }
        state = next;
    }
    return state;
}
