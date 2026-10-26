import { between } from './random.js';
import { smooth } from './config.js';

// A positive, low-frequency radial function is smooth and star-shaped. Its
// rotated/scaled boundary cannot cross itself. The analytic radius is shared
// by physics, density, water shading and boundary drawing.
export class FeatureShape {
  constructor(random, rx, ry, rotation = 0) {
    this.rx = rx; this.ry = ry; this.rotation = rotation;
    this.phases = Array.from({ length: 3 }, () => between(random, 0, 2 * Math.PI));
    this.amplitudes = [between(random, 0.06, 0.1), between(random, 0.04, 0.07), between(random, 0.02, 0.04)];
    this.maxRadius = 1 + this.amplitudes.reduce((a, b) => a + b, 0);
    this.cos = Math.cos(rotation); this.sin = Math.sin(rotation);
  }
  radius(theta) {
    let r = 1;
    for (let i = 0; i < 3; i++) r += this.amplitudes[i] * Math.sin((i + 1) * theta + this.phases[i]);
    return r;
  }
  normalizedRadius(dx, dy) {
    const x = (dx * this.cos + dy * this.sin) / this.rx;
    const y = (-dx * this.sin + dy * this.cos) / this.ry;
    return Math.hypot(x, y) / this.radius(Math.atan2(y, x));
  }
  influence(dx, dy) {
    const r = this.normalizedRadius(dx, dy);
    // A readable, near-uniform core with a smooth outer shoulder.
    return 1 - smooth((r - 0.38) / 0.62);
  }
  point(theta) {
    const r = this.radius(theta), x = Math.cos(theta) * this.rx * r, y = Math.sin(theta) * this.ry * r;
    return { x: x * this.cos - y * this.sin, y: x * this.sin + y * this.cos };
  }
  support(ux, uy) {
    const x = ux * this.cos + uy * this.sin, y = -ux * this.sin + uy * this.cos;
    return this.maxRadius * Math.hypot(this.rx * x, this.ry * y);
  }
  get bound() { return Math.max(this.rx, this.ry) * this.maxRadius; }
  get area() {
    // Orthogonality gives the exact radial integral for this Fourier shape.
    return Math.PI * this.rx * this.ry * (1 + this.amplitudes.reduce((s, a) => s + a * a / 2, 0));
  }
}

// Conservative enclosing-ellipse projection. A separating projection proves
// no overlap; otherwise reject. This can reject near misses but never permits
// irregular lobes to overlap because the underlying ellipses appear separate.
export function overlaps(a, b, clearance = 0) {
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
  if (distance < 1e-9) return true;
  return distance <= a.shape.support(dx / distance, dy / distance) + b.shape.support(dx / distance, dy / distance) + clearance;
}
