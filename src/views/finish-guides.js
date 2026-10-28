import { finishLaylines, FINISH_GUIDES } from '../engine/course.js';

// Existing trainer colors: wind-vector teal, mark-ring bronze, gate ink, buoy gold.
export const COURSE_THEME = { starboard: '#527780', port: '#bc8b3f', finish: '#223e48', pin: '#e8ac4e' };

export function finishGuidesView(scenario, time, bounds) {
  const { lines } = finishLaylines(scenario, time);
  const definitions = lines.map((line, i) => `<linearGradient id="finish-guide-${i}" gradientUnits="userSpaceOnUse" x1="${line.start.x}" y1="${-line.start.y}" x2="${line.end.x}" y2="${-line.end.y}">
    <stop offset="0" stop-color="${COURSE_THEME[line.tack]}"/><stop offset="${FINISH_GUIDES.fadeStart}" stop-color="${COURSE_THEME[line.tack]}"/>
    <stop offset="1" stop-color="${COURSE_THEME[line.tack]}" stop-opacity="0"/></linearGradient>`).join('');
  const clip = `<clipPath id="finish-guides-clip"><rect x="${bounds.minX}" y="${-bounds.maxY}" width="${bounds.maxX - bounds.minX}" height="${bounds.maxY - bounds.minY}"/></clipPath>`;
  return { definitions: definitions + clip, markup: `<g clip-path="url(#finish-guides-clip)">${lines.map((line, i) =>
    `<path class="finish-layline" data-pin="${line.pin}" data-tack="${line.tack}" d="M${line.start.x},${-line.start.y} L${line.end.x},${-line.end.y}" fill="none" stroke="url(#finish-guide-${i})" stroke-width="${FINISH_GUIDES.strokeWidth}" opacity="${FINISH_GUIDES.opacity}" vector-effect="non-scaling-stroke"/>`).join('')}</g>` };
}
