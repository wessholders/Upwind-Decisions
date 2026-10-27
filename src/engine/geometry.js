export const radians = (degrees) => degrees * Math.PI / 180;
export const normalize = (degrees) => ((degrees % 360) + 360) % 360;
export const signedAngle = (degrees) => normalize(degrees + 180) - 180;
export const direction = (degrees) => ({ x: Math.sin(radians(degrees)), y: Math.cos(radians(degrees)) });
export const headingTo = (a, b) => Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const interpolate = (a, b, fraction) => ({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
export function distanceToSegment(point, from, to) {
    const movement = subtract(to, from), length2 = dot(movement, movement);
    const fraction = length2 > 0 ? Math.max(0, Math.min(1, dot(subtract(point, from), movement) / length2)) : 0;
    const nearest = interpolate(from, to, fraction);
    return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}
export function validHeading(heading, wind, tack, minimum) {
    const angle = signedAngle(heading - wind);
    return Math.abs(angle) >= minimum - 1e-8 && (tack === 'starboard' ? angle < 0 : angle > 0);
}
export function layline(mark, wind, tack, angle, length) {
    const v = direction(wind + (tack === 'starboard' ? -angle : angle));
    return { x: mark.x - v.x * length, y: mark.y - v.y * length };
}

// A circular training envelope includes the hull and a buoy allowance. Aim
// just outside it, leaving a small numerical margin rather than hitting the
// mark or taking the arbitrary midpoint of a long finish gate.
export const markContactClearance = boatLength => boatLength * 0.6;
export const markApproachClearance = boatLength => boatLength * 0.65;

/** Close mark-end crossing; retain a previously acquired safe approach. */
export function closestMarkApproach(position, wind, tack, minimum, mark, end, clearance, preferredDistance = null) {
    const gate = subtract(end, mark), length = Math.hypot(gate.x, gate.y);
    if (length < 1e-9) return null;
    const axis = { x: gate.x / length, y: gate.y / length }, relative = subtract(position, mark);
    if (preferredDistance !== null && preferredDistance >= clearance && preferredDistance <= length) {
        const target = { x: mark.x + axis.x * preferredDistance, y: mark.y + axis.y * preferredDistance };
        const heading = headingTo(position, target);
        if (Math.hypot(target.x - position.x, target.y - position.y) > 1e-8 &&
            validHeading(heading, wind, tack, minimum) && distanceToSegment(mark, position, target) >= clearance - 1e-7)
            return { target, heading, distanceFromMark: preferredDistance };
    }
    const along = dot(relative, axis), across = cross(axis, relative);
    const distance2 = dot(relative, relative), radius2 = clearance * clearance;
    if (distance2 <= radius2 + 1e-10) return null;
    // Clear approach lines satisfy A*s²+B*s+C >= 0, where s is distance
    // up the gate from the mark. Solve its safe interval analytically.
    const a = across * across - radius2, b = 2 * radius2 * along, c = -radius2 * distance2;
    let low = 0, high = length;
    if (Math.abs(a) < 1e-10) {
        if (b <= 0) return null;
        low = Math.max(low, -c / b);
    } else {
        const discriminant = Math.max(0, b * b - 4 * a * c);
        const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(discriminant));
        const roots = [q / a, c / q].sort((x, y) => x - y);
        if (a > 0) low = Math.max(low, roots[1]);
        else { low = Math.max(low, roots[0]); high = Math.min(high, roots[1]); }
    }
    // Intersect with the current tack and no-go half-planes. Both constraints
    // are linear in s, so this also finds the nearest LEGAL clear crossing.
    const up = direction(wind), right = { x: up.y, y: -up.x }, sign = tack === 'starboard' ? -1 : 1;
    const side0 = -dot(relative, right) * sign, sideRate = dot(axis, right) * sign;
    const up0 = -dot(relative, up), upRate = dot(axis, up), angle = radians(minimum);
    for (const [offset, rate] of [[side0, sideRate],
        [side0 * Math.cos(angle) - up0 * Math.sin(angle), sideRate * Math.cos(angle) - upRate * Math.sin(angle)]]) {
        if (Math.abs(rate) < 1e-12) { if (offset < -1e-9) return null; }
        else if (rate > 0) low = Math.max(low, -offset / rate);
        else high = Math.min(high, -offset / rate);
    }
    if (!Number.isFinite(low) || low > high + 1e-9 || high < 0) return null;
    for (const s of [Math.max(0, low), Math.min(high, Math.max(0, low) + 1e-7)]) {
        const target = { x: mark.x + axis.x * s, y: mark.y + axis.y * s };
        if (Math.hypot(target.x - position.x, target.y - position.y) < 1e-8) continue;
        const heading = headingTo(position, target);
        if (validHeading(heading, wind, tack, minimum)) return { target, heading, distanceFromMark: s };
    }
    return null;
}
