import { clamp } from './config.js';
import { particleOpacity, trailGeometry } from './particles.js';

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
    const c = field.config, width = 144, height = Math.round(width * c.height / c.width);
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
        const alpha = Math.round(influence * (this.theme === 'light' ? (puff ? 48 : 38) : (puff ? 90 : 13)));
        if (alpha <= data[index + 3]) continue;
        data[index] = puff ? 3 : 235; data[index + 1] = puff ? 25 : 247; data[index + 2] = puff ? 32 : 246; data[index + 3] = alpha;
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

export function drawFeatureOutlines(ctx, field, time, camera, theme = 'dark') {
  for (const p of field.featuresAt(time)) {
    ctx.beginPath();
    for (let k = 0; k <= 128; k++) {
      const local = p.shape.point(k / 128 * Math.PI * 2);
      const x = camera.ox + (p.x + local.x) * camera.scale, y = camera.oy - (p.y + local.y) * camera.scale;
      if (!k) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.setLineDash([4, 6]); ctx.lineWidth = 1;
    ctx.strokeStyle = theme === 'light' ? '#315c697d' : '#c1dfd875'; ctx.stroke(); ctx.setLineDash([]);
  }
}
export function drawParticleTrails(ctx, field, particles, time, camera, theme = 'dark') {
  for (const p of particles.active) {
    const sample = field.sample(p.x, p.y, time), trail = trailGeometry(p, sample, camera), fade = particleOpacity(p);
    if (!fade) continue;
    const i = sample.influence;
    const puff = sample.kind === 'puff' ? i : 0, pocket = sample.kind === 'pocket' ? i : 0;
    const light = theme === 'light';
    const red = Math.round((light ? 100 : 151) - puff * 54 + pocket * 39);
    const green = Math.round((light ? 145 : 189) - puff * 46 + pocket * 24);
    const blue = Math.round((light ? 150 : 189) - puff * 46 + pocket * 26);
    const opacity = (0.52 + puff * 0.38 + pocket * 0.1) * fade;
    for (let segment = 0; segment < 4; segment++) {
      const a = segment / 4, b = (segment + 1) / 4;
      ctx.beginPath(); ctx.moveTo(trail.tx + (trail.x - trail.tx) * a, trail.ty + (trail.y - trail.ty) * a);
      ctx.lineTo(trail.tx + (trail.x - trail.tx) * b, trail.ty + (trail.y - trail.ty) * b);
      ctx.lineWidth = (1.25 + puff * 0.8 - pocket * 0.4) * (0.25 + b * 0.75);
      ctx.strokeStyle = `rgba(${red},${green},${blue},${opacity * b * b})`; ctx.lineCap = 'round'; ctx.stroke();
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
    ctx.fillStyle = '#205662'; ctx.fillRect(0, 0, this.width, this.height);
    this.water.draw(ctx, field, time, camera);
    ctx.font = '10px system-ui'; ctx.lineWidth = 1;
    for (let y = 0; y <= c.height; y += 100) {
      const [x, sy] = point(-c.width / 2, y);
      ctx.strokeStyle = '#b4d7d315'; ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x + c.width * scale, sy); ctx.stroke();
      ctx.fillStyle = '#b8d3d477'; ctx.fillText(`${y} m`, x + 8, sy - 5);
    }
    if (options.boundaries) drawFeatureOutlines(ctx, field, time, camera);
    drawParticleTrails(ctx, field, particles, time, camera);
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
