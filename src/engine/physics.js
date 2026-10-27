import { KNOT_TO_MPS, STEP } from './config.js';
import { direction, headingTo, interpolate, normalize, signedAngle, closestMarkApproach, markApproachClearance, cross, subtract } from './geometry.js';
import { finishFraction, gateEnd } from './finish.js';
import { windAtPosition, windIntegrationStep, windSampleAtPosition } from './wind.js';
export const initialBoat = () => ({
    position: { x: 0, y: 0 }, time: 0, tack: 'starboard', mode: 'close',
    penaltyRemaining: 0, penaltyTime: 0, distance: 0, tacks: 0, finished: false,
});
export function gateAimGeometry(boat, scenario, time = boat.time) {
    const wind = windAtPosition(scenario, boat.position.x, boat.position.y, time);
    const close = wind + (boat.tack === 'starboard' ? -scenario.config.minAngle : scenario.config.minAngle);
    const end = gateEnd(scenario, time);
    const mark = { x: 0, y: scenario.config.courseLength };
    const approach = closestMarkApproach(boat.position, wind, boat.tack, scenario.config.minAngle,
        mark, end, markApproachClearance(scenario.config.boatLength), boat.markAimDistance ?? null);
    const target = approach?.target ?? mark;
    const direct = headingTo(boat.position, target);
    const angle = signedAngle(direct - wind);
    const legal = Boolean(approach);
    return { target, heading: direct, closeHeading: close, legal,
        distanceFromMark: approach?.distanceFromMark ?? null,
        turnDegrees: signedAngle(direct - close),
        reason: legal ? 'legal' : Math.abs(angle) < scenario.config.minAngle - 1e-8 ? 'no-go'
            : (boat.tack === 'starboard' ? angle >= 0 : angle <= 0) ? 'opposite-tack' : 'mark-clearance' };
}
export function sailingHeading(boat, scenario, time = boat.time) {
    if (boat.mode === 'gate') {
        const aim = gateAimGeometry(boat, scenario, time);
        return aim.legal ? aim.heading : aim.closeHeading;
    }
    const wind = windAtPosition(scenario, boat.position.x, boat.position.y, time);
    return wind + (boat.tack === 'starboard' ? -scenario.config.minAngle : scenario.config.minAngle);
}
export function canBearAway(boat, scenario) {
    const aim = gateAimGeometry(boat, scenario);
    return aim.legal && Math.abs(aim.turnDegrees) > 0.1;
}
export const compassHeading = (boat, scenario) => normalize(sailingHeading(boat, scenario) + scenario.config.baseline);
export function sailingSpeedKnots(boat, scenario, time = boat.time) {
    if (!scenario.organicWind) return scenario.config.speedKnots;
    const local = windSampleAtPosition(scenario, boat.position.x, boat.position.y, time);
    // Explicit simplified training response, not a calibrated boat polar.
    // Exponent zero retains fixed speed; the default square-root response
    // makes pressure tactically meaningful for BOTH player and reference.
    const ratio = Math.max(0.1, local.speedKnots / scenario.organicWind.windKnots);
    return scenario.config.speedKnots * ratio ** (scenario.config.pressureExponent ?? 0.5);
}
export function applyAction(boat, action, scenario) {
    if (boat.finished || boat.penaltyRemaining > 1e-9)
        return boat;
    if (action === 'tack')
        return { ...boat, tack: boat.tack === 'starboard' ? 'port' : 'starboard', mode: 'close', markAimDistance: null, tacks: boat.tacks + 1, penaltyRemaining: scenario.config.tackPenalty };
    if (action === 'bear') {
        const aiming = { ...boat, mode: 'gate', markAimDistance: null };
        return refreshMarkApproach(aiming, scenario);
    }
    if (action === 'close')
        return { ...boat, mode: 'close', markAimDistance: null };
    return boat;
}
function refreshMarkApproach(boat, scenario) {
    if (boat.mode !== 'gate') return boat;
    const aim = gateAimGeometry(boat, scenario);
    return { ...boat, markAimDistance: aim.distanceFromMark };
}
export function advance(boat, scenario, duration = STEP) {
    if (duration < 0 || !Number.isFinite(duration))
        throw new Error('Duration must be finite and nonnegative.');
    if (boat.finished)
        return boat;
    let state = refreshMarkApproach(boat, scenario);
    const endTime = boat.time + duration;
    while (state.time < endTime - 1e-9 && !state.finished) {
        state = refreshMarkApproach(state, scenario);
        const dt = Math.min(STEP, endTime - state.time);
        const stopped = Math.min(dt, state.penaltyRemaining);
        const moving = dt - stopped;
        const moveTime = state.time + stopped;
        let next = { ...state, time: state.time + dt, penaltyRemaining: Math.max(0, state.penaltyRemaining - dt), penaltyTime: state.penaltyTime + stopped };
        if (moving > 1e-10) {
            if (scenario.config.windField === 'traveling' || scenario.organicWind) {
                state = advanceThroughField({ ...next, position: state.position, time: moveTime }, scenario, moving);
                continue;
            }
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

function advanceThroughField(boat, scenario, duration) {
    const endTime = boat.time + duration;
    let current = boat;
    while (current.time < endTime - 1e-10 && !current.finished) {
        current = refreshMarkApproach(current, scenario);
        const initialSpeed = sailingSpeedKnots(current, scenario) * KNOT_TO_MPS;
        const maximum = endTime - current.time;
        let dt = windIntegrationStep(scenario, current.position.y, current.time, maximum, initialSpeed, current.position.x);
        const gateLength = scenario.config.boatLength * scenario.config.gateBoatLengths;
        if (Math.hypot(current.position.x, current.position.y - scenario.config.courseLength) < gateLength + initialSpeed * maximum) {
            dt = Math.min(dt, windIntegrationStep(scenario, scenario.config.courseLength, current.time, maximum, 0));
        }
        // RK2: sample the field at a predicted midpoint POSITION and time.
        const initial = direction(sailingHeading(current, scenario));
        if (current.mode === 'gate') {
            const mark = { x: 0, y: scenario.config.courseLength }, line = subtract(gateEnd(scenario, current.time), mark);
            const side = cross(line, subtract(current.position, mark)), rate = cross(line, initial) * initialSpeed;
            if (side < -1e-10 && rate > 1e-10) {
                // Keep the RK2 midpoint on the approach side. Otherwise a
                // midpoint already beyond the finish sees the mark behind it
                // and can turn back to close-hauled before recording a finish.
                dt = Math.min(dt, -side / rate * 1.5);
            }
        }
        const midpoint = { ...current, position: {
            x: current.position.x + initial.x * initialSpeed * dt / 2,
            y: current.position.y + initial.y * initialSpeed * dt / 2,
        } };
        const speed = sailingSpeedKnots(midpoint, scenario, current.time + dt / 2) * KNOT_TO_MPS;
        const v = direction(sailingHeading(midpoint, scenario, current.time + dt / 2));
        const position = { x: current.position.x + v.x * speed * dt, y: current.position.y + v.y * speed * dt };
        const fraction = finishFraction(scenario, current.position, position, current.time, dt, current.tack);
        current = {
            ...current, position: fraction === null ? position : interpolate(current.position, position, fraction),
            time: current.time + dt * (fraction ?? 1), distance: current.distance + speed * dt * (fraction ?? 1),
            finished: fraction !== null,
        };
    }
    return current.finished ? current : { ...current, time: endTime };
}
