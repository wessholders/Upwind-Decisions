import { BOAT_PROFILES, MAIN_JIB_DINGHY } from './boat-profile.js';
import { signedAngle } from './geometry.js';
import { maneuverSpeed, recoveryRemaining } from './tack.js';

export const trueWindAngle = (heading, fromDirection) => Math.abs(signedAngle(heading - fromDirection));
export const usesPolar = config => config.performanceModel !== 'legacy-pressure';
export const boatProfile = config => BOAT_PROFILES[config.boatProfile ?? MAIN_JIB_DINGHY.id];
const smooth = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };

function rowSpeed(profile, row, tws) {
    const speeds = profile.windSpeeds, n = speeds.length;
    if (tws <= 0) return 0;
    if (tws < speeds[0]) {
        // Monotone Hermite extension to zero, matching the 6 kt value and
        // the first in-table wind slope. No clamp or absolute speed floor.
        const u = tws / speeds[0], slope = Math.min(3 * row[1] / speeds[0], Math.max(0, (row[2] - row[1]) / (speeds[1] - speeds[0])));
        return u * u * (3 - 2 * u) * row[1] + u * u * (u - 1) * speeds[0] * slope;
    }
    if (tws > speeds[n - 1]) {
        const slope = Math.max(0, (row[n] - row[n - 1]) / (speeds[n - 1] - speeds[n - 2]));
        return row[n] + slope * profile.highWindTailKnots * -Math.expm1(-(tws - speeds[n - 1]) / profile.highWindTailKnots);
    }
    let i = 0;
    while (i < n - 2 && tws > speeds[i + 1]) i++;
    const u = (tws - speeds[i]) / (speeds[i + 1] - speeds[i]);
    return row[i + 1] + (row[i + 2] - row[i + 1]) * u;
}
export function polarSpeedKnots(twa, tws, profile = MAIN_JIB_DINGHY) {
    if (!Number.isFinite(twa) || !Number.isFinite(tws)) throw new Error('Polar angle and wind speed must be finite.');
    const angle = trueWindAngle(twa, 0), rows = profile.polar;
    let i = 0;
    while (i < rows.length - 2 && angle > rows[i + 1][0]) i++;
    const a = rows[i], b = rows[i + 1], u = (angle - a[0]) / (b[0] - a[0]);
    const low = rowSpeed(profile, a, Math.max(0, tws));
    return low + (rowSpeed(profile, b, Math.max(0, tws)) - low) * u;
}
function angleTarget(config, angle, tws) {
    return angle < config.minAngle - 1e-8 ? 0 : polarSpeedKnots(angle, tws, boatProfile(config)) * (config.speedScale ?? 1);
}
export function performanceTarget(config, heading, wind, maneuver = null, time = 0) {
    if (!usesPolar(config)) {
        const ratio = config.windField === 'organic' ? Math.max(0.1, wind.speedKnots / config.backgroundWindKnots) : 1;
        return config.speedKnots * ratio ** (config.windField === 'organic' ? config.pressureExponent : 0);
    }
    const actual = angleTarget(config, trueWindAngle(heading, wind.direction), wind.speedKnots);
    if (recoveryRemaining(maneuver, time) <= 1e-9) return actual;
    // The instantaneous tack heading crosses 0 TWA. Preserve the successful
    // maneuver envelope instead of multiplying it by a second luffing loss.
    // After the turn, blend its pressure-aware entry reference to the CURRENT
    // heading's polar target, reaching that target at the existing 8 s endpoint.
    const reference = angleTarget(config, Math.abs(maneuver.entryOffset), wind.speedKnots);
    const blend = smooth((time - maneuver.start - maneuver.duration) / (maneuver.recovery - maneuver.duration || 1e-9));
    return reference + (actual - reference) * blend;
}
export function performanceSpeed(config, currentSpeed, target, maneuver, time) {
    return recoveryRemaining(maneuver, time) > 1e-9 || !usesPolar(config)
        ? maneuverSpeed(maneuver, time, target) : currentSpeed ?? target;
}
export function speedResponse(config, speed, target, seconds) {
    if (!usesPolar(config)) return { end: target, mean: target };
    if (seconds <= 0) return { end: speed, mean: speed };
    const profile = boatProfile(config), tau = target >= speed ? profile.accelerationSeconds : profile.decelerationSeconds;
    const change = -Math.expm1(-seconds / tau);
    return { end: speed + (target - speed) * change,
        mean: target + (speed - target) * tau * change / seconds };
}
export const referenceSpeedKnots = config => usesPolar(config)
    ? polarSpeedKnots(config.minAngle, config.backgroundWindKnots, boatProfile(config)) * (config.speedScale ?? 1) : config.speedKnots;
