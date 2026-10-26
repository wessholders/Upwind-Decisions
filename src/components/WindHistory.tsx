import { windAt } from '../engine/wind';
import { formatTime } from '../engine/scoring';
import type { Scenario } from '../engine/types';

export function WindHistory({ scenario, time }: { scenario: Scenario; time: number }) {
  const duration = Math.max(120, time);
  const range = Math.max(5, scenario.config.maxShift);
  const x = (t: number) => 40 + t / duration * 690;
  const y = (shift: number) => 65 - shift / range * 43;
  const samples = Math.max(1, Math.ceil(time / 2));
  const points = Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples * time;
    return `${x(t)},${y(windAt(scenario, t))}`;
  }).join(' ');
  return <section className="wind-history" aria-label="Wind direction history">
    <div className="section-label">WIND HISTORY <span>Relative to baseline · clockwise positive</span></div>
    <svg viewBox="0 0 750 135" role="img" aria-label="Observed wind shifts over elapsed race time">
      {[-range, 0, range].map(shift => <g key={shift}><line x1="40" y1={y(shift)} x2="730" y2={y(shift)} stroke="#d8e1e4" strokeDasharray={shift === 0 ? '4 4' : undefined} /><text x="30" y={y(shift) + 4} textAnchor="end">{shift > 0 ? '+' : ''}{shift}°</text></g>)}
      <polyline points={points} fill="none" stroke="#3b7b8b" strokeWidth="2.5" />
      <text x="40" y="128">0:00</text><text x="730" y="128" textAnchor="end">{formatTime(duration)}</text>
    </svg>
  </section>;
}
