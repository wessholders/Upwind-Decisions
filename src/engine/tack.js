import { EXPERT_TACK } from './config.js';

const smooth = value => { const u = Math.max(0, Math.min(1, value)); return u * u * (3 - 2 * u); };

export function tackSettings(config) {
    const duration = config.tackPenalty;
    return { duration, minSpeedFraction: config.tackMinSpeedFraction ?? EXPERT_TACK.minSpeedFraction,
        recovery: duration > 0 ? Math.max(duration, config.tackRecoverySeconds ?? EXPERT_TACK.totalRecoverySeconds) : 0,
        minimumAt: duration * EXPERT_TACK.minimumAtTurnFraction };
}

// Plain maneuver data travels with the boat through replay and worker search.
// The entry reference is captured once, never reduced repeatedly per frame.
export function createTack(time, fromHeading, wind, entrySpeed, entryTarget, config, priorTurnTime = 0) {
    const settings = tackSettings(config);
    if (settings.duration === 0) return null;
    return { start: time, ...settings, priorTurnTime, entryOffset: fromHeading - wind,
        entrySpeed, entryTarget };
}
export const turnRemaining = (tack, time) => tack ? Math.max(0, tack.start + tack.duration - time) : 0;
export const recoveryRemaining = (tack, time) => tack ? Math.max(0, tack.start + tack.recovery - time) : 0;
export const turning = (tack, time) => turnRemaining(tack, time) > 1e-9;
export function turnHeading(tack, time, wind, targetOffset) {
    const u = Math.max(0, Math.min(1, (time - tack.start) / tack.duration));
    const progress = u * u * u * (10 + u * (-15 + 6 * u));
    // Unwrapped offsets deliberately turn THROUGH the wind, including a tack
    // begun while bearing away. Shortest-angle interpolation could gybe.
    return wind + tack.entryOffset + (targetOffset - tack.entryOffset) * progress;
}
export function speedLossFraction(tack, time) {
    if (!tack || time <= tack.start || recoveryRemaining(tack, time) <= 1e-9) return 0;
    const elapsed = time - tack.start;
    const envelope = elapsed <= tack.minimumAt ? smooth(elapsed / tack.minimumAt)
        : 1 - smooth((elapsed - tack.minimumAt) / (tack.recovery - tack.minimumAt));
    return (1 - tack.minSpeedFraction) * envelope;
}
export function maneuverSpeed(tack, time, targetSpeed) {
    if (!tack || recoveryRemaining(tack, time) <= 1e-9) return targetSpeed;
    // Scale the captured entry reference with CURRENT pressure. This preserves
    // the existing speed response and does not force recovery to stale wind.
    // No new absolute speed floor, acceleration model or stacked stop penalty.
    const reference = tack.entryTarget > 0 ? tack.entrySpeed * targetSpeed / tack.entryTarget : targetSpeed;
    const recovered = smooth((time - tack.start) / tack.recovery);
    return (reference + (targetSpeed - reference) * recovered) * (1 - speedLossFraction(tack, time));
}
// Heuristic speed-loss cost, not a stationary wait or a certified VMG bound.
export function tackSpeedCost(config) {
    const settings = tackSettings(config);
    return (1 - settings.minSpeedFraction) * settings.recovery / 2;
}
