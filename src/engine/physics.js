import { KNOT_TO_MPS, STEP, EXPERT_TACK } from './config.js';
import { createTack, turnRemaining, recoveryRemaining, turning, turnHeading, maneuverSpeed } from './tack.js';
import { direction, headingTo, interpolate, normalize, signedAngle, closestMarkApproach, markApproachClearance, cross, subtract } from './geometry.js';
import { finishFraction, gateEnd } from './finish.js';
import { windAtPosition, windIntegrationStep, windSampleAtPosition } from './wind.js';
export const initialBoat = () => ({
    position: { x: 0, y: 0 }, time: 0, tack: 'starboard', mode: 'close',
    penaltyRemaining: 0, penaltyTime: 0, tackManeuver: null, distance: 0, tacks: 0, finished: false,
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
    if (turning(boat.tackManeuver, time)) {
        const wind = windAtPosition(scenario, boat.position.x, boat.position.y, time);
        return turnHeading(boat.tackManeuver, time, wind, boat.tack === 'starboard' ? -scenario.config.minAngle : scenario.config.minAngle);
    }
    return settledHeading(boat, scenario, time);
}
export function settledHeading(boat, scenario, time = boat.time) {
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
export function targetSpeedKnots(boat, scenario, time = boat.time) {
    if (!scenario.organicWind) return scenario.config.speedKnots;
    const local = windSampleAtPosition(scenario, boat.position.x, boat.position.y, time);
    // Explicit simplified training response, not a calibrated boat polar.
    // Exponent zero retains fixed speed; the default square-root response
    // makes pressure tactically meaningful for BOTH player and reference.
    const ratio = Math.max(0.1, local.speedKnots / scenario.organicWind.windKnots);
    return scenario.config.speedKnots * ratio ** (scenario.config.pressureExponent ?? 0.5);
}
export function sailingSpeedKnots(boat, scenario, time = boat.time) {
    return maneuverSpeed(boat.tackManeuver, time, targetSpeedKnots(boat, scenario, time));
}
export function applyAction(boat, action, scenario) {
    if (boat.finished || turning(boat.tackManeuver, boat.time) ||
        (action === 'tack' && recoveryRemaining(boat.tackManeuver, boat.time) > 1e-9))
        return boat;
    if (action === 'tack') {
        const wind = windAtPosition(scenario, boat.position.x, boat.position.y, boat.time);
        const maneuver = createTack(boat.time, wind + signedAngle(sailingHeading(boat, scenario) - wind), wind,
            sailingSpeedKnots(boat, scenario), targetSpeedKnots(boat, scenario), scenario.config, boat.penaltyTime);
        return { ...boat, tack: boat.tack === 'starboard' ? 'port' : 'starboard', mode: 'close', markAimDistance: null,
            tacks: boat.tacks + 1, tackManeuver: maneuver, penaltyRemaining: maneuver?.duration ?? 0 };
    }
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
        if (scenario.config.windField === 'traveling' || scenario.organicWind || recoveryRemaining(state.tackManeuver, state.time) > 1e-9) {
            state = advanceThroughField(state, scenario, dt);
            continue;
        }
        const v = direction(sailingHeading(state, scenario, state.time + dt / 2));
        const distance = sailingSpeedKnots(state, scenario, state.time + dt / 2) * KNOT_TO_MPS * dt;
        const position = { x: state.position.x + v.x * distance, y: state.position.y + v.y * distance };
        const fraction = finishFraction(scenario, state.position, position, state.time, dt, state.tack);
        state = movedBoat(state, position, distance, dt, fraction);
    }
    return state;
}

function movedBoat(boat, position, distance, dt, fraction) {
    const elapsed = dt * (fraction ?? 1), time = boat.time + elapsed;
    return { ...boat, position: fraction === null ? position : interpolate(boat.position, position, fraction),
        time, distance: boat.distance + distance * (fraction ?? 1), finished: fraction !== null,
        penaltyTime: boat.tackManeuver ? boat.tackManeuver.priorTurnTime + Math.min(boat.tackManeuver.duration, time - boat.tackManeuver.start) : boat.penaltyTime,
        penaltyRemaining: turnRemaining(boat.tackManeuver, time),
        tackManeuver: recoveryRemaining(boat.tackManeuver, time) > 1e-9 ? boat.tackManeuver : null };
}

function advanceThroughField(boat, scenario, duration) {
    const endTime = boat.time + duration;
    let current = boat;
    while (current.time < endTime - 1e-10 && !current.finished) {
        current = refreshMarkApproach(current, scenario);
        const initialSpeed = sailingSpeedKnots(current, scenario) * KNOT_TO_MPS;
        const maximum = endTime - current.time;
        let dt = windIntegrationStep(scenario, current.position.y, current.time, maximum, initialSpeed, current.position.x);
        if (recoveryRemaining(current.tackManeuver, current.time) > 1e-9) {
            dt = Math.min(dt, EXPERT_TACK.integrationStepSeconds);
            for (const offset of [current.tackManeuver.minimumAt, current.tackManeuver.duration, current.tackManeuver.recovery]) {
                const remaining = current.tackManeuver.start + offset - current.time;
                if (remaining > 1e-9) dt = Math.min(dt, remaining);
            }
        }
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
        const fraction = turning(current.tackManeuver, current.time) ? null
            : finishFraction(scenario, current.position, position, current.time, dt, current.tack);
        current = movedBoat(current, position, speed * dt, dt, fraction);
    }
    return current.finished ? current : { ...current, time: endTime };
}
