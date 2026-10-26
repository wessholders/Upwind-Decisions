import { windAt, windAtPosition } from '../engine/wind.js';
import { formatTime } from '../engine/scoring.js';

export function windHistoryView(scenario, time, observations = []) {
  const duration = Math.max(120, time);
  const range = Math.max(5, scenario.config.maxShift * (scenario.organicWind ? 2 : 1), scenario.config.windField === 'traveling' && scenario.config.windMode === 'persistent' ? Math.abs(scenario.config.persistentShiftAngle) : 0);
  const x = t => 40 + t / duration * 690;
  const y = shift => 65 - shift / range * 43;
  const samples = Math.max(1, Math.ceil(time / 2));
  const points = scenario.config.windField === 'traveling' || scenario.organicWind ? observations.filter(p => p.time <= time).map(p =>
    `${x(p.time)},${y(windAtPosition(scenario, p.position.x, p.position.y, p.time))}`).join(' ') : Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples * time;
    return `${x(t)},${y(windAt(scenario, t))}`;
  }).join(' ');
  return `${[-range, 0, range].map(shift => `<g><line x1="40" y1="${y(shift)}" x2="730" y2="${y(shift)}" stroke="#d8e1e4" ${shift === 0 ? 'stroke-dasharray="4 4"' : ''}/><text x="30" y="${y(shift) + 4}" text-anchor="end">${shift > 0 ? '+' : ''}${shift}°</text></g>`).join('')}
    <polyline points="${points}" fill="none" stroke="#3b7b8b" stroke-width="2.5"/>
    <text x="40" y="128">0:00</text><text x="730" y="128" text-anchor="end">${formatTime(duration)}</text>`;
}
