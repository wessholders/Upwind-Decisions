import { gateEnd, windAtMark } from '../engine/finish.js';
import { direction, layline } from '../engine/geometry.js';
import { sailingHeading, gateAimGeometry } from '../engine/physics.js';
import { windAtPosition } from '../engine/wind.js';
import { courseGeometry } from '../engine/course.js';
import { isUpwindFinish, COURSE_LABEL } from '../engine/course-config.js';
import { finishGuidesView, COURSE_THEME } from './finish-guides.js';
import { courseProjection } from './wind-canvas.js';

const path = points => points.map((p, i) => `${i ? 'L' : 'M'}${p.position.x.toFixed(2)},${(-p.position.y).toFixed(2)}`).join(' ');

export function courseView({ scenario, boat, track, benchmark, follow, computer = null, inspection = null, displayTime = boat.time, viewport = null }) {
  const { config } = scenario;
  const geometry = courseGeometry(scenario, displayTime), upwind = isUpwindFinish(config);
  const mark = geometry.mark ?? geometry.center;
  const wind = windAtPosition(scenario, boat.position.x, boat.position.y, displayTime);
  const markWind = upwind ? 0 : windAtMark(scenario, displayTime);
  const gate = gateEnd(scenario, displayTime);
  const starboard = upwind ? null : layline(mark, markWind, 'starboard', config.minAngle, config.boatLength * 100);
  const port = upwind ? null : layline(mark, markWind, 'port', config.minAngle, config.boatLength * 100);
  const margin = config.courseLength * 0.08;
  let xmin = -config.courseLength * 0.58, xmax = -xmin;
  let ymin = -margin, ymax = config.courseLength + config.boatLength * config.gateBoatLengths + margin;
  if (upwind) for (const pin of [geometry.start, geometry.end]) {
    xmin = Math.min(xmin, pin.x - margin); xmax = Math.max(xmax, pin.x + margin);
    ymin = Math.min(ymin, pin.y - margin); ymax = Math.max(ymax, pin.y + margin);
  }
  for (const points of [track, computer?.track ?? [], benchmark?.route?.points ?? []]) {
    for (const { position } of points) {
      xmin = Math.min(xmin, position.x - margin); xmax = Math.max(xmax, position.x + margin);
      ymin = Math.min(ymin, position.y - margin); ymax = Math.max(ymax, position.y + margin);
    }
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
  const guides = upwind ? finishGuidesView(scenario, displayTime, visibleBounds) : { definitions: '', markup: '' };
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
    ? `<path d="${path(benchmark.route.points)}" fill="none" stroke="#b58a25" stroke-width="2.6" stroke-dasharray="7 6" vector-effect="non-scaling-stroke"/>` : '';
  const approach = boat.mode === 'gate' ? gateAimGeometry(boat, scenario, displayTime) : null;
  const approachGuide = approach?.legal ? `<path class="mark-approach-guide" d="M${boat.position.x},${-boat.position.y} L${approach.target.x},${-approach.target.y}" fill="none" stroke="#3e7a9f" opacity="0.5" stroke-width="1" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>` : '';
  const tacks = tackPoints.map((p, i) => p ? `<g class="reference-tack" data-inspect-tack="${i + 1}" role="button" tabindex="0" aria-label="View wind at reference tack ${i + 1}">
    <circle cx="${p.position.x}" cy="${-p.position.y}" r="${symbol * 1.3}" fill="transparent"/>
    <circle cx="${p.position.x}" cy="${-p.position.y}" r="${symbol * 0.5}" fill="${inspection?.number === i + 1 ? '#946900' : '#d3a63f'}" stroke="#fff" stroke-width="1.3" vector-effect="non-scaling-stroke"/>
    <text x="${p.position.x + symbol * 0.7}" y="${-p.position.y - symbol * 0.65}" fill="#8a650f" font-size="${symbol * 0.9}" font-weight="700">${i + 1}</text></g>` : '').join('');
  const cb = computer?.boat;
  const computerMarkup = cb && !inspection ? `<path d="${path(computer.track)}" fill="none" stroke="#855ab1" stroke-width="2.2" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
    <g transform="translate(${cb.position.x},${-cb.position.y}) rotate(${sailingHeading(cb, scenario)})"><circle r="${symbol * 1.05}" fill="#faf5ff" stroke="#855ab1" stroke-width="1.1" vector-effect="non-scaling-stroke"/><path d="M0,${-symbol * 0.7} L${symbol * 0.45},${symbol * 0.45} L${-symbol * 0.45},${symbol * 0.45}Z" fill="#855ab1"/></g>` : '';
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
        <path d="M0,${-hull} Q${hull * 0.5},0 ${hull * 0.35},${hull} L${-hull * 0.35},${hull} Q${-hull * 0.5},0 0,${-hull}" fill="${inspection ? '#b58a25' : '#246caa'}" stroke="${inspection ? '#b58a25' : '#246caa'}" stroke-width="0.5" vector-effect="non-scaling-stroke"/>
        <path d="M${-symbol * 0.4},${-symbol * 0.65} L0,${-symbol * 1.1} L${symbol * 0.4},${-symbol * 0.65}" fill="none" stroke="${inspection ? '#b58a25' : '#246caa'}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
      </g>
      ${follow ? '' : `<g transform="translate(${xmin + margin * 1.1},${-ymax + margin * 1.25})">
        <path d="M0,0 l${-windVector.x * symbol * 4},${windVector.y * symbol * 4}" stroke="#527780" stroke-width="2" vector-effect="non-scaling-stroke"/>
        <text x="${symbol * 1.1}" y="${symbol}" font-size="${symbol * 0.9}" class="map-small">WIND AT BOAT</text>
        <text x="${symbol * 1.1}" y="${symbol * 2.25}" font-size="${symbol * 0.85}" class="map-small">${wind >= 0 ? '+' : ''}${wind.toFixed(1)}°</text>
      </g>`}`,
  };
}
