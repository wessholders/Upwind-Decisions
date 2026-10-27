import { direction } from '../engine/geometry.js';
import { windAtPosition, windEntryHeight } from '../engine/wind.js';

// These pure geometry functions are also used by tests; rendering has no RNG
// and never writes to the scenario or boat.
export function windStreak(scenario, x, y, time, length) {
  const angle = windAtPosition(scenario, x, y, time);
  const v = direction(angle);
  if (scenario.config.windField === 'traveling') {
    const a = windAtPosition(scenario, x - v.x * length / 2, y - v.y * length / 2, time);
    const b = windAtPosition(scenario, x + v.x * length / 2, y + v.y * length / 2, time);
    // Avoid long strokes spanning two directions across a steep front.
    if (Math.abs(a - b) > 1) length = Math.min(length, scenario.config.transitionWidth / 4);
  }
  return {
    x, y, angle,
    from: { x: x - v.x * length / 2, y: y - v.y * length / 2 },
    to: { x: x + v.x * length / 2, y: y + v.y * length / 2 },
  };
}

export function windBoundaries(scenario, time) {
  if (scenario.config.windField !== 'traveling') return [];
  const fronts = [];
  const speed = scenario.config.propagationSpeed;
  const entry = windEntryHeight(scenario);
  for (let i = 0; i < scenario.wind.length - 1; i++) {
    const a = scenario.wind[i], b = scenario.wind[i + 1];
    if (a.direction === b.direction || a.time > time) continue;
    fronts.push({
      y: entry - speed * (time - (a.time + b.time) / 2),
      width: speed * (b.time - a.time), from: a.direction, to: b.direction,
    });
  }
  return fronts;
}

export function courseProjection(viewBox, width, height, padding = {}) {
  const [minX, minSvgY, spanX, spanY] = viewBox.split(' ').map(Number);
  const { left = 0, right = 0, top = 0, bottom = 0 } = padding;
  const innerWidth = width - left - right, innerHeight = height - top - bottom;
  const scale = Math.min(innerWidth / spanX, innerHeight / spanY);
  const startX = left + (innerWidth - spanX * scale) / 2;
  const startY = top + (innerHeight - spanY * scale) / 2;
  return {
    scale, startX, startY, spanX, spanY,
    bounds: { minX, maxX: minX + spanX, minY: -minSvgY - spanY, maxY: -minSvgY },
    // SVG's meet transform adds space beside/above the requested viewBox.
    // Course geometry remains visible there, so wind must cover it too.
    viewport: { left, top, width: innerWidth, height: innerHeight },
    visibleBounds: { minX: minX + (left - startX) / scale, maxX: minX + (width - right - startX) / scale,
      minY: -minSvgY - (height - bottom - startY) / scale, maxY: -minSvgY - (top - startY) / scale },
    point: p => ({ x: startX + (p.x - minX) * scale, y: startY + (-p.y - minSvgY) * scale }),
  };
}

export function streakGeometry(scenario, time, bounds, spacing, length) {
  const streaks = [];
  const offset = scenario.config.windField === 'traveling' ? -scenario.config.propagationSpeed * time : 0;
  const yMax = Math.min(bounds.maxY, windEntryHeight(scenario));
  const rowMin = Math.ceil((bounds.minY - offset) / spacing);
  const rowMax = Math.floor((yMax - offset) / spacing);
  for (let row = rowMin; row <= rowMax; row++) {
    const stagger = (Math.abs(row) % 2) * spacing / 2;
    for (let col = Math.ceil((bounds.minX - stagger) / spacing); col * spacing + stagger <= bounds.maxX; col++) {
      streaks.push(windStreak(scenario, col * spacing + stagger, row * spacing + offset, time, length));
    }
  }
  return streaks;
}

export function drawWindCanvas(canvas, scenario, time, viewBox, display, metrics) {
  const { width, height, padding, pixelRatio = 1 } = metrics;
  if (width <= 0 || height <= 0) return;
  const resolutionX = Math.round(width * pixelRatio), resolutionY = Math.round(height * pixelRatio);
  if (canvas.width !== resolutionX) canvas.width = resolutionX;
  if (canvas.height !== resolutionY) canvas.height = resolutionY;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (display === 'hidden') return;
  const projection = courseProjection(viewBox, width, height, padding);
  if (projection.scale <= 0) return;
  const project = projection.point;
  context.save();
  context.beginPath();
  const viewport = projection.viewport, visible = projection.visibleBounds;
  context.rect(viewport.left, viewport.top, viewport.width, viewport.height);
  context.clip();
  context.beginPath();
  context.lineWidth = 0.85;
  context.strokeStyle = 'rgba(55, 103, 120, 0.26)';
  for (const streak of streakGeometry(scenario, time, visible, 30 / projection.scale, 17 / projection.scale)) {
    const a = project(streak.from), b = project(streak.to);
    context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
  }
  context.stroke();
  if (display === 'boundaries') {
    context.beginPath();
    context.setLineDash([4, 7]);
    context.strokeStyle = 'rgba(55, 103, 120, 0.45)';
    for (const front of windBoundaries(scenario, time)) {
      if (front.y < visible.minY || front.y > Math.min(visible.maxY, windEntryHeight(scenario))) continue;
      const a = project({ x: visible.minX, y: front.y }), b = project({ x: visible.maxX, y: front.y });
      context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
    }
    context.stroke();
  }
  context.restore();
}
