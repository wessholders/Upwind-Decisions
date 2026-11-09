import { gateEnd, windAtMark } from '../engine/finish.js';
import { direction } from '../engine/geometry.js';
import { sailingHeading, gateAimGeometry } from '../engine/physics.js';
import { windAtPosition, windSampleAtPosition } from '../engine/wind.js';
import { predictedLayline } from '../engine/current.js';
import { courseGeometry } from '../engine/course.js';
import { isUpwindFinish, COURSE_LABEL } from '../engine/course-config.js';
import { finishGuidesView, COURSE_THEME } from './finish-guides.js';
import { courseProjection } from './wind-canvas.js';
import { escapeHtml } from './html.js';

// Tracks append immutable boat snapshots. Extend the cached geometry once per
// new point rather than scanning nine complete histories on every frame.
const trackGeometry = new WeakMap();
function geometryFor(points) {
  let cached = trackGeometry.get(points);
  if (!cached || cached.length > points.length || (cached.length && points[cached.length - 1] !== cached.tail))
    cached = { length: 0, path: '', xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity };
  for (let i = cached.length; i < points.length; i++) {
    const { position } = points[i];
    cached.path += `${i ? ' L' : 'M'}${position.x.toFixed(2)},${(-position.y).toFixed(2)}`;
    cached.xmin = Math.min(cached.xmin, position.x); cached.xmax = Math.max(cached.xmax, position.x);
    cached.ymin = Math.min(cached.ymin, position.y); cached.ymax = Math.max(cached.ymax, position.y);
  }
  cached.length = points.length; cached.tail = points.at(-1);
  trackGeometry.set(points, cached); return cached;
}
const path = points => geometryFor(points).path;

export function courseView({ scenario, boat, track, benchmark, follow, computer = null, npcs = computer ? [computer] : [], inspection = null, displayTime = boat.time, viewport = null, boatColor = '#246caa', showReference = false, laylineMode = 'wind-only' }) {
  // Hidden references must not affect camera bounds or expose tack markers.
  if (!showReference && !inspection) benchmark = null;
  if (!/^#[0-9a-f]{6}$/i.test(boatColor)) boatColor = '#246caa';
  const { config } = scenario;
  const geometry = courseGeometry(scenario, displayTime), upwind = isUpwindFinish(config);
  const mark = geometry.mark ?? geometry.center;
  const wind = windAtPosition(scenario, boat.position.x, boat.position.y, displayTime);
  const markWind = upwind ? 0 : windAtMark(scenario, displayTime);
  const gate = gateEnd(scenario, displayTime);
  const markSample = upwind ? null : { ...windSampleAtPosition(scenario, mark.x, mark.y, displayTime), direction: markWind };
  const starboard = upwind ? null : predictedLayline(mark, markSample, 'starboard', config, config.boatLength * 100, laylineMode);
  const port = upwind ? null : predictedLayline(mark, markSample, 'port', config, config.boatLength * 100, laylineMode);
  const margin = config.courseLength * 0.08;
  let xmin = -config.courseLength * 0.58, xmax = -xmin;
  let ymin = -margin, ymax = config.courseLength + config.boatLength * config.gateBoatLengths + margin;
  if (upwind) for (const pin of [geometry.start, geometry.end]) {
    xmin = Math.min(xmin, pin.x - margin); xmax = Math.max(xmax, pin.x + margin);
    ymin = Math.min(ymin, pin.y - margin); ymax = Math.max(ymax, pin.y + margin);
  }
  for (const points of [track, ...npcs.map(npc => npc.track), benchmark?.route?.points ?? []]) {
    const bounds = geometryFor(points);
    xmin = Math.min(xmin, bounds.xmin - margin); xmax = Math.max(xmax, bounds.xmax + margin);
    ymin = Math.min(ymin, bounds.ymin - margin); ymax = Math.max(ymax, bounds.ymax + margin);
  }
  const span = Math.min(550, config.courseLength * 0.7);
  const viewBox = follow
    ? `${boat.position.x - span / 2} ${-boat.position.y - span * 0.7} ${span} ${span}`
    : `${xmin} ${-ymax} ${xmax - xmin} ${ymax - ymin}`;
  const symbol = (follow ? span : Math.max(xmax - xmin, ymax - ymin)) * 0.014;
  const hull = config.boatLength / 2;
  const grid = config.courseLength / 10;
  const [vx, vy, vw, vh] = viewBox.split(' ').map(Number);
  const visibleBounds = viewport?.width > 0 && viewport?.height > 0
    ? courseProjection(viewBox, viewport.width, viewport.height, viewport.padding).visibleBounds
    : { minX: vx, maxX: vx + vw, minY: -vy - vh, maxY: -vy };
  const guides = upwind ? finishGuidesView(scenario, displayTime, visibleBounds, laylineMode) : { definitions: '', markup: '' };
  const finishMarkup = upwind ? `${guides.markup}
    <path class="finish-line" d="M${geometry.start.x},${-geometry.start.y} L${geometry.end.x},${-geometry.end.y}" stroke="${COURSE_THEME.finish}" stroke-width="3" vector-effect="non-scaling-stroke"/>
    ${[geometry.start, geometry.end].map((pin, i) => `<circle class="finish-pin" data-pin="${i}" cx="${pin.x}" cy="${-pin.y}" r="${config.boatLength * 0.5}" fill="${COURSE_THEME.pin}" stroke="${COURSE_THEME.finish}" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}
    <text x="${mark.x}" y="${-mark.y - symbol * 0.6}" text-anchor="middle" class="map-label" font-size="${symbol * 0.9}">FINISH</text>
    <text x="${mark.x}" y="${-mark.y + symbol * 1.1}" text-anchor="middle" class="map-small" font-size="${symbol * 0.8}">1,000 m</text>` : `
    <path d="M0,${-mark.y} L${starboard.x},${-starboard.y}" stroke="#33956b" class="layline"/>
    <path d="M0,${-mark.y} L${port.x},${-port.y}" stroke="#d66b67" class="layline"/>
    <path d="M0,${-mark.y} L${gate.x},${-gate.y}" stroke="#223e48" stroke-width="3" vector-effect="non-scaling-stroke"/>
    <circle cx="${gate.x}" cy="${-gate.y}" r="${symbol * 0.22}" fill="#223e48"/>
    <circle cx="0" cy="${-mark.y}" r="${symbol * 0.55}" fill="none" stroke="#bc8b3f" opacity="0.5" stroke-width="0.8" vector-effect="non-scaling-stroke"/>
    <circle cx="0" cy="${-mark.y}" r="${config.boatLength * 0.1}" fill="#e8ac4e" stroke="#8b6429" stroke-width="0.5" vector-effect="non-scaling-stroke"/>
    <text x="${symbol * 1.4}" y="${-mark.y + symbol * 0.3}" class="map-label" font-size="${symbol * 0.9}">WINDWARD MARK</text>
    <text x="${symbol * 1.4}" y="${-mark.y + symbol * 1.5}" class="map-small" font-size="${symbol * 0.8}">${config.courseLength.toLocaleString()} m${geometry.roundingSide === 'starboard' ? ' · round to starboard' : ''}</text>`;
  const windVector = direction(wind);
  const tackPoints = benchmark?.route?.commands.filter(c => c.action === 'tack').map(c => benchmark.route.points.find(p => p.time >= c.time)) ?? [];
  const reference = benchmark?.route
    ? `<path class="hindsight-reference" d="${path(benchmark.route.points)}" fill="none" stroke="#b58a25" stroke-width="2.6" stroke-dasharray="7 6" vector-effect="non-scaling-stroke"/>` : '';
  const approach = boat.mode === 'gate' ? gateAimGeometry(boat, scenario, displayTime) : null;
  const approachGuide = approach?.legal ? `<path class="mark-approach-guide" d="M${boat.position.x},${-boat.position.y} L${approach.target.x},${-approach.target.y}" fill="none" stroke="#3e7a9f" opacity="0.5" stroke-width="1" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>` : '';
  const tacks = tackPoints.map((p, i) => p ? `<g class="reference-tack" data-inspect-tack="${i + 1}" role="button" tabindex="0" aria-label="View wind at reference tack ${i + 1}">
    <circle cx="${p.position.x}" cy="${-p.position.y}" r="${symbol * 1.3}" fill="transparent"/>
    <circle cx="${p.position.x}" cy="${-p.position.y}" r="${symbol * 0.5}" fill="${inspection?.number === i + 1 ? '#946900' : '#d3a63f'}" stroke="#fff" stroke-width="1.3" vector-effect="non-scaling-stroke"/>
    <text x="${p.position.x + symbol * 0.7}" y="${-p.position.y - symbol * 0.65}" fill="#8a650f" font-size="${symbol * 0.9}" font-weight="700">${i + 1}</text></g>` : '').join('');
  const npcSymbol = Math.min(symbol, config.boatLength * 1.2);
  const computerMarkup = inspection ? '' : npcs.map((npc, index) => {
    const cb = npc.boat, identity = npc.identity, color = identity?.color ?? '#855ab1';
    return `<path class="npc-track" d="${path(npc.track)}" fill="none" stroke="${color}" stroke-width="1.7" stroke-dasharray="3 4" opacity="0.7" vector-effect="non-scaling-stroke"/>
      <g class="npc-boat" data-racer-id="${escapeHtml(identity?.id ?? npc.configuration?.id ?? 'computer')}" transform="translate(${cb.position.x},${-cb.position.y})"><title>${escapeHtml(identity ? `${identity.shortLabel} · ${identity.tier}` : 'Live computer')}</title>
      <g transform="rotate(${sailingHeading(cb, scenario)})"><circle r="${npcSymbol * 1.05}" fill="#fff" fill-opacity="0.8" stroke="${color}" stroke-width="1.1" vector-effect="non-scaling-stroke"/><path d="M0,${-npcSymbol * 0.7} L${npcSymbol * 0.45},${npcSymbol * 0.45} L${-npcSymbol * 0.45},${npcSymbol * 0.45}Z" fill="${color}"/></g>
      <text x="0" y="${-npcSymbol * (2 + index % 3 * 2)}" text-anchor="middle" fill="${color}" font-size="${symbol * 0.75}" font-weight="700">${escapeHtml(identity?.shortLabel ?? 'NPC')}</text></g>`;
  }).join('');
  return {
    viewBox,
    label: `Sailing course. Boat ${Math.round(boat.position.x)} meters east and ${Math.round(boat.position.y)} meters up course. Wind shift ${wind.toFixed(1)} degrees. ${COURSE_LABEL[geometry.mode]}.`,
    markup: `
      <defs><pattern id="grid" width="${grid}" height="${grid}" patternUnits="userSpaceOnUse"><path d="M ${grid} 0 L 0 0 0 ${grid}" fill="none" stroke="#c9dde0" stroke-width="0.65" vector-effect="non-scaling-stroke"/></pattern>${guides.definitions}</defs>
      <rect x="${follow ? boat.position.x - span : xmin}" y="${follow ? -boat.position.y - span : -ymax}" width="${follow ? span * 2 : xmax - xmin}" height="${follow ? span * 2 : ymax - ymin}" fill="url(#grid)"/>
      <path d="M0,0 L${mark.x},${-mark.y}" stroke="#a7c2c9" stroke-dasharray="3 7" stroke-width="1" vector-effect="non-scaling-stroke"/>
      ${finishMarkup}
      <path d="M${-symbol * 3},0 H${symbol * 3}" stroke="#748f96" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <text x="0" y="${symbol * 2.4}" text-anchor="middle" class="map-small" font-size="${symbol}">START</text>
      <path d="${path(track)}" fill="none" stroke="#2678c6" stroke-width="2.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      ${computerMarkup}${reference}${approachGuide}${tacks}
      <g transform="translate(${boat.position.x},${-boat.position.y}) rotate(${sailingHeading(boat, scenario, displayTime)})" class="${inspection ? 'reference-probe' : 'player-boat'}">
        <circle r="${symbol * 1.4}" fill="#fff" opacity="0.75"/>
        <path d="M0,${-hull} Q${hull * 0.5},0 ${hull * 0.35},${hull} L${-hull * 0.35},${hull} Q${-hull * 0.5},0 0,${-hull}" fill="${inspection ? '#b58a25' : boatColor}" stroke="${inspection ? '#b58a25' : boatColor}" stroke-width="0.5" vector-effect="non-scaling-stroke"/>
        <path d="M${-symbol * 0.4},${-symbol * 0.65} L0,${-symbol * 1.1} L${symbol * 0.4},${-symbol * 0.65}" fill="none" stroke="${inspection ? '#b58a25' : boatColor}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      </g>
      ${follow ? '' : `<g transform="translate(${xmin + margin * 1.1},${-ymax + margin * 1.25})">
        <path d="M0,0 l${-windVector.x * symbol * 4},${windVector.y * symbol * 4}" stroke="#527780" stroke-width="2" vector-effect="non-scaling-stroke"/>
        <text x="${symbol * 1.1}" y="${symbol}" font-size="${symbol * 0.9}" class="map-small">WIND AT BOAT</text>
        <text x="${symbol * 1.1}" y="${symbol * 2.25}" font-size="${symbol * 0.85}" class="map-small">${wind >= 0 ? '+' : ''}${wind.toFixed(1)}°</text>
      </g>`}`,
  };
}
