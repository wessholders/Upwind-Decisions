import { fieldForScenario } from '../wind/field.js';
import { ParticleSystem } from '../wind/particles.js';
import { WaterRenderer, drawFeatureOutlines, drawParticleTrails, drawDebugVectors } from '../wind/renderer.js';
import { clamp } from '../wind/config.js';
import { courseProjection } from './wind-canvas.js';

// The race owns the camera, boat, route and clock. This layer draws only wind,
// using the same field instance as the player's physics and instruments.
export class RaceWindLayer {
  constructor() { this.scenario = null; }
  draw(canvas, scenario, time, viewBox, display, metrics, elapsed = 0, vectors = false, snapshotKey = null) {
    const { width, height, padding, pixelRatio = 1 } = metrics;
    if (width <= 0 || height <= 0) return;
    if (this.scenario !== scenario || this.snapshotKey !== snapshotKey || time < this.lastTime - 1e-8) {
      this.scenario = scenario; this.field = fieldForScenario(scenario);
      this.snapshotKey = snapshotKey;
      const quality = clamp(width * height / 650000, 0.35, 0.8);
      this.particles = new ParticleSystem(this.field, quality, time);
      this.water = new WaterRenderer('light');
    }
    this.lastTime = time;
    if (canvas.width !== Math.round(width * pixelRatio)) canvas.width = Math.round(width * pixelRatio);
    if (canvas.height !== Math.round(height * pixelRatio)) canvas.height = Math.round(height * pixelRatio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); ctx.clearRect(0, 0, width, height);
    if (display === 'hidden') return;
    const projection = courseProjection(viewBox, width, height, padding), origin = projection.point({ x: 0, y: 0 });
    const camera = { scale: projection.scale, ox: origin.x, oy: origin.y };
    if (camera.scale <= 0) return;
    let remaining = Math.min(0.1, Math.max(0, elapsed));
    while (remaining > 1e-8) { const dt = Math.min(0.025, remaining); this.particles.update(dt, time); remaining -= dt; }
    ctx.save(); ctx.beginPath();
    ctx.rect(projection.startX, projection.startY, projection.spanX * projection.scale, projection.spanY * projection.scale); ctx.clip();
    this.water.draw(ctx, this.field, time, camera);
    if (display === 'boundaries') drawFeatureOutlines(ctx, this.field, time, camera, 'light');
    drawParticleTrails(ctx, this.field, this.particles, time, camera, 'light');
    if (vectors) drawDebugVectors(ctx, this.field, time, camera, projection.bounds, 'light');
    ctx.restore();
  }
}
