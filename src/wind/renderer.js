import { clamp } from './config.js';
import { particleOpacity, trailGeometry } from './particles.js';

// Related teal-gray tones, with enough ambient water contrast for BOTH patch
// types. A nearly white ambient surface made lighter pockets disappear.
export const WIND_PALETTES = {
  light: { water: '#c2dce0', ambientTrail: [70, 115, 124], puffTrail: [24, 65, 73], pocketTrail: [108, 148, 155],
    puffWater: [8, 35, 43], puffAlpha: 0.22, pocketWater: [235, 248, 247], pocketAlpha: 0.45,
    puffOutline: '#244f5dcc', pocketOutline: '#648b97dd', label: '#21454e', halo: '#d9e9e9' },
  dark: { water: '#205662', ambientTrail: [151, 189, 189], puffTrail: [96, 150, 143], pocketTrail: [190, 214, 217],
    puffWater: [3, 25, 32], puffAlpha: 0.35, pocketWater: [142, 190, 195], pocketAlpha: 0.18,
    puffOutline: '#9cc8becc', pocketOutline: '#c6dce2dd', label: '#e0eceb', halo: '#123b49' },
};

export function cameraFor(width, height, config) {
  const scale = Math.min((width - 56) / config.width, (height - 70) / (config.height + 60));
  return { scale, ox: width / 2, oy: height - 30 - 20 * scale };
}
export class WaterRenderer {
  constructor(theme = 'dark') {
    this.theme = theme;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d'); this.lastTime = NaN;
  }
  update(field, time) {
    if (this.lastTime === time) return;
    this.lastTime = time;
    const c = field.config, palette = WIND_PALETTES[this.theme], width = 144, height = Math.round(width * c.height / c.width);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
      this.image = this.ctx.createImageData(width, height);
    }
    const data = this.image.data;
    // Sample only bounding boxes; background pixels stay transparent.
    data.fill(0);
    for (const p of field.featuresAt(time)) {
      const bound = p.shape.bound;
      const x0 = clamp(Math.floor((p.x - bound + c.width / 2) / c.width * width), 0, width);
      const x1 = clamp(Math.ceil((p.x + bound + c.width / 2) / c.width * width), 0, width);
      const y0 = clamp(Math.floor((c.height - p.y - bound) / c.height * height), 0, height);
      const y1 = clamp(Math.ceil((c.height - p.y + bound) / c.height * height), 0, height);
      for (let iy = y0; iy < y1; iy++) for (let ix = x0; ix < x1; ix++) {
        const influence = p.shape.influence((ix + 0.5) / width * c.width - c.width / 2 - p.x,
          c.height - (iy + 0.5) / height * c.height - p.y);
        const index = (iy * width + ix) * 4, puff = p.feature.kind === 'puff';
        const alpha = Math.round(influence * (puff ? palette.puffAlpha : palette.pocketAlpha) * 255);
        if (alpha <= data[index + 3]) continue;
        const color = puff ? palette.puffWater : palette.pocketWater;
        data[index] = color[0]; data[index + 1] = color[1]; data[index + 2] = color[2]; data[index + 3] = alpha;
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
  }
  draw(ctx, field, time, camera) {
    this.update(field, time);
    const c = field.config;
    ctx.drawImage(this.canvas, camera.ox - c.width / 2 * camera.scale, camera.oy - c.height * camera.scale,
      c.width * camera.scale, c.height * camera.scale);
  }
}

export function drawFeatureOutlines(ctx, field, time, camera, theme = 'dark', labelBounds = null) {
  const palette = WIND_PALETTES[theme];
  for (const p of field.featuresAt(time)) {
    ctx.beginPath();
    for (let k = 0; k <= 128; k++) {
      const local = p.shape.point(k / 128 * Math.PI * 2);
      const x = camera.ox + (p.x + local.x) * camera.scale, y = camera.oy - (p.y + local.y) * camera.scale;
      if (!k) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const puff = p.feature.kind === 'puff';
    ctx.closePath(); ctx.setLineDash(puff ? [] : [4, 5]); ctx.lineWidth = puff ? 1.3 : 1;
    ctx.strokeStyle = puff ? palette.puffOutline : palette.pocketOutline; ctx.stroke(); ctx.setLineDash([]);
    // Identification is opt-in, using the actual patch type and sampled core
    // wind. Outlines/labels never change field physics or particle density.
    const wind = field.sample(p.x, p.y, time);
    const label = `${puff ? 'PUFF' : 'POCKET'} · ${wind.speedKnots.toFixed(1)} kn`;
    const centerX = camera.ox + p.x * camera.scale, centerY = camera.oy - p.y * camera.scale;
    if (labelBounds && (centerX < labelBounds.left || centerX > labelBounds.right || centerY < labelBounds.top || centerY > labelBounds.bottom)) continue;
    ctx.save(); ctx.font = '600 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const halfWidth = ctx.measureText(label).width / 2 + 5;
    const x = labelBounds ? clamp(centerX, labelBounds.left + halfWidth, labelBounds.right - halfWidth) : centerX;
    const y = labelBounds ? clamp(centerY, labelBounds.top + 9, labelBounds.bottom - 9) : centerY;
    if (Math.hypot(x - centerX, y - centerY) > 8) {
      ctx.beginPath(); ctx.moveTo(centerX, centerY); ctx.lineTo(x, y); ctx.lineWidth = 0.7;
      ctx.strokeStyle = puff ? palette.puffOutline : palette.pocketOutline; ctx.stroke();
    }
    ctx.lineWidth = 3; ctx.strokeStyle = palette.halo; ctx.strokeText(label, x, y);
    ctx.fillStyle = palette.label; ctx.fillText(label, x, y); ctx.restore();
  }
}
export function drawParticleTrails(ctx, field, particles, time, camera, theme = 'dark') {
  const palette = WIND_PALETTES[theme];
  for (const p of particles.active) {
    const sample = field.sample(p.x, p.y, time), trail = trailGeometry(p, sample, camera), fade = particleOpacity(p);
    if (!fade) continue;
    const i = sample.influence;
    const puff = sample.kind === 'puff' ? i : 0, pocket = sample.kind === 'pocket' ? i : 0;
    const color = palette.ambientTrail.map((base, index) => Math.round(base + puff * (palette.puffTrail[index] - base) + pocket * (palette.pocketTrail[index] - base)));
    const opacity = (0.58 + puff * 0.37 + pocket * 0.22) * fade;
    for (let segment = 0; segment < 4; segment++) {
      const a = segment / 4, b = (segment + 1) / 4;
      ctx.beginPath(); ctx.moveTo(trail.tx + (trail.x - trail.tx) * a, trail.ty + (trail.y - trail.ty) * a);
      ctx.lineTo(trail.tx + (trail.x - trail.tx) * b, trail.ty + (trail.y - trail.ty) * b);
      ctx.lineWidth = (1.3 + puff * 0.9 - pocket * 0.3) * (0.25 + b * 0.75);
      ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${opacity * b * b})`; ctx.lineCap = 'round'; ctx.stroke();
    }
  }
}
export function drawDebugVectors(ctx, field, time, camera, bounds, theme = 'dark') {
  ctx.strokeStyle = theme === 'light' ? '#2546529a' : '#edf0c78a'; ctx.lineWidth = 1;
  const spacing = Math.max(100, 35 / camera.scale);
  for (let y = Math.ceil(bounds.minY / spacing) * spacing; y < bounds.maxY; y += spacing)
    for (let x = Math.ceil(bounds.minX / spacing) * spacing; x < bounds.maxX; x += spacing) {
      const w = field.sample(x, y, time), magnitude = Math.hypot(w.vx, w.vy);
      const sx = camera.ox + x * camera.scale, sy = camera.oy - y * camera.scale;
      const dx = w.vx / magnitude * 13, dy = -w.vy / magnitude * 13;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + dx, sy + dy);
      ctx.moveTo(sx + dx * 0.6 - dy * 0.22, sy + dy * 0.6 + dx * 0.22); ctx.lineTo(sx + dx, sy + dy);
      ctx.lineTo(sx + dx * 0.6 + dy * 0.22, sy + dy * 0.6 - dx * 0.22); ctx.stroke();
    }
}

export class WindRenderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.water = new WaterRenderer();
    this.width = 0; this.height = 0;
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = rect.width; this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr); this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect(), camera = this.camera;
    return { x: (clientX - rect.left - camera.ox) / camera.scale, y: (camera.oy - clientY + rect.top) / camera.scale };
  }
  draw(field, particles, boat, time, options) {
    const ctx = this.ctx, c = field.config, camera = cameraFor(this.width, this.height, c);
    this.camera = camera;
    const { scale, ox, oy } = camera;
    const point = (x, y) => [ox + x * scale, oy - y * scale];
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#0b2530'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.save(); ctx.beginPath(); ctx.rect(ox - c.width / 2 * scale, oy - c.height * scale, c.width * scale, c.height * scale); ctx.clip();
    ctx.fillStyle = WIND_PALETTES.dark.water; ctx.fillRect(0, 0, this.width, this.height);
    this.water.draw(ctx, field, time, camera);
    ctx.font = '10px system-ui'; ctx.lineWidth = 1;
    for (let y = 0; y <= c.height; y += 100) {
      const [x, sy] = point(-c.width / 2, y);
      ctx.strokeStyle = '#b4d7d315'; ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x + c.width * scale, sy); ctx.stroke();
      ctx.fillStyle = '#b8d3d477'; ctx.fillText(`${y} m`, x + 8, sy - 5);
    }
    drawParticleTrails(ctx, field, particles, time, camera);
    if (options.boundaries) drawFeatureOutlines(ctx, field, time, camera, 'dark', {
      left: ox - c.width / 2 * scale, right: ox + c.width / 2 * scale, top: oy - c.height * scale, bottom: oy });
    if (options.vectors) drawDebugVectors(ctx, field, time, camera, { minX: -c.width / 2, maxX: c.width / 2, minY: 60, maxY: c.height });
    ctx.restore();
    const [mx, my] = point(0, c.height);
    ctx.fillStyle = '#efd19b'; ctx.beginPath(); ctx.arc(mx, my, 5, 0, 2 * Math.PI); ctx.fill();
    ctx.font = '10px system-ui'; ctx.fillText('WINDWARD MARK', mx + 12, my + 3);
    const [bx, by] = point(boat.x, boat.y), wind = boat.sample(time);
    ctx.save(); ctx.translate(bx, by); ctx.rotate(wind.heading * Math.PI / 180);
    const length = c.boatLength * scale;
    ctx.beginPath(); ctx.moveTo(0, -length / 2); ctx.lineTo(length * 0.28, length / 2); ctx.lineTo(-length * 0.28, length / 2); ctx.closePath();
    ctx.fillStyle = '#ffd68a'; ctx.fill(); ctx.restore();
    ctx.strokeStyle = '#ffd68aaa'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx, by, 11, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = '#f1d7aa'; ctx.fillText('5 m BOAT', bx + 17, by - 7);
    ctx.fillStyle = '#bad2d2'; ctx.fillText('DRAG TO PROBE', bx + 17, by + 8);
    const [sx, sy] = point(-c.width / 2 + 25, 28);
    ctx.strokeStyle = '#d3e2d9'; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + scale * 100, sy); ctx.stroke();
    ctx.fillStyle = '#d3e2d9'; ctx.fillText('100 m', sx, sy - 6);
  }
}
