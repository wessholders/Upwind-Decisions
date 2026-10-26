export const radians = (degrees) => degrees * Math.PI / 180;
export const normalize = (degrees) => ((degrees % 360) + 360) % 360;
export const signedAngle = (degrees) => normalize(degrees + 180) - 180;
export const direction = (degrees) => ({ x: Math.sin(radians(degrees)), y: Math.cos(radians(degrees)) });
export const headingTo = (a, b) => Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const interpolate = (a, b, fraction) => ({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
export function validHeading(heading, wind, tack, minimum) {
    const angle = signedAngle(heading - wind);
    return Math.abs(angle) >= minimum - 1e-8 && (tack === 'starboard' ? angle < 0 : angle > 0);
}
export function layline(mark, wind, tack, angle, length) {
    const v = direction(wind + (tack === 'starboard' ? -angle : angle));
    return { x: mark.x - v.x * length, y: mark.y - v.y * length };
}
