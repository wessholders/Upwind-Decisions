import type { Vec, Tack } from './types';

export const radians = (degrees: number) => degrees * Math.PI / 180;
export const normalize = (degrees: number) => ((degrees % 360) + 360) % 360;
export const signedAngle = (degrees: number) => normalize(degrees + 180) - 180;
export const direction = (degrees: number): Vec => ({ x: Math.sin(radians(degrees)), y: Math.cos(radians(degrees)) });
export const headingTo = (a: Vec, b: Vec) => Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI;
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
export const subtract = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const interpolate = (a: Vec, b: Vec, fraction: number): Vec => ({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });

export function validHeading(heading: number, wind: number, tack: Tack, minimum: number): boolean {
  const angle = signedAngle(heading - wind);
  return Math.abs(angle) >= minimum - 1e-8 && (tack === 'starboard' ? angle < 0 : angle > 0);
}

export function layline(mark: Vec, wind: number, tack: Tack, angle: number, length: number): Vec {
  const v = direction(wind + (tack === 'starboard' ? -angle : angle));
  return { x: mark.x - v.x * length, y: mark.y - v.y * length };
}
