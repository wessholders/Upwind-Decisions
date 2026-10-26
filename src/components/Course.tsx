import { gateEnd } from '../engine/finish';
import { direction, layline } from '../engine/geometry';
import { sailingHeading } from '../engine/physics';
import { windAt } from '../engine/wind';
import type { Boat, Scenario } from '../engine/types';
import type { Benchmark } from '../engine/optimizer';

interface Props { scenario: Scenario; boat: Boat; track: Boat[]; benchmark: Benchmark | null; follow: boolean }
const path = (points: Boat[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.position.x.toFixed(2)},${(-p.position.y).toFixed(2)}`).join(' ');

export function Course({ scenario, boat, track, benchmark, follow }: Props) {
  const { config } = scenario;
  const mark = { x: 0, y: config.courseLength };
  const wind = windAt(scenario, boat.time);
  const gate = gateEnd(scenario, boat.time);
  const starboard = layline(mark, wind, 'starboard', config.minAngle, config.boatLength * 100);
  const port = layline(mark, wind, 'port', config.minAngle, config.boatLength * 100);
  const all = [...track, ...(benchmark?.route?.points ?? [])];
  const margin = config.courseLength * 0.08;
  const xmin = Math.min(-config.courseLength * 0.58, ...all.map(p => p.position.x - margin));
  const xmax = Math.max(config.courseLength * 0.58, ...all.map(p => p.position.x + margin));
  const ymin = Math.min(-margin, ...all.map(p => p.position.y - margin));
  const ymax = Math.max(config.courseLength + config.boatLength * config.gateBoatLengths + margin, ...all.map(p => p.position.y + margin));
  const span = Math.min(550, config.courseLength * 0.7);
  const viewBox = follow
    ? `${boat.position.x - span / 2} ${-boat.position.y - span * 0.7} ${span} ${span}`
    : `${xmin} ${-ymax} ${xmax - xmin} ${ymax - ymin}`;
  const symbol = (follow ? span : Math.max(xmax - xmin, ymax - ymin)) * 0.014;
  const grid = config.courseLength / 10;
  const windVector = direction(wind);
  const tackPoints = benchmark?.route?.commands.filter(c => c.action === 'tack').map(c => benchmark.route!.points.find(p => p.time >= c.time)) ?? [];
  return <svg className="course-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Sailing course. Boat ${Math.round(boat.position.x)} meters east and ${Math.round(boat.position.y)} meters up course. Wind shift ${wind.toFixed(1)} degrees.`}>
    <defs>
      <pattern id="grid" width={grid} height={grid} patternUnits="userSpaceOnUse"><path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke="#c9dde0" strokeWidth="0.65" vectorEffect="non-scaling-stroke" /></pattern>
    </defs>
    <rect x={follow ? boat.position.x - span : xmin} y={follow ? -boat.position.y - span : -ymax} width={follow ? span * 2 : xmax - xmin} height={follow ? span * 2 : ymax - ymin} fill="url(#grid)" />
    <path d={`M0,0 L0,${-config.courseLength}`} stroke="#a7c2c9" strokeDasharray="3 7" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    <path d={`M0,${-mark.y} L${starboard.x},${-starboard.y}`} stroke="#33956b" className="layline" />
    <path d={`M0,${-mark.y} L${port.x},${-port.y}`} stroke="#d66b67" className="layline" />
    <path d={`M0,${-mark.y} L${gate.x},${-gate.y}`} stroke="#223e48" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    <circle cx={gate.x} cy={-gate.y} r={symbol * 0.22} fill="#223e48" />
    <circle cx="0" cy={-mark.y} r={symbol * 0.55} fill="#e8ac4e" stroke="#8b6429" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
    <text x={symbol * 1.4} y={-mark.y + symbol * 0.3} className="map-label" fontSize={symbol * 0.9}>WINDWARD MARK</text>
    <text x={symbol * 1.4} y={-mark.y + symbol * 1.5} className="map-small" fontSize={symbol * 0.8}>{config.courseLength.toLocaleString()} m</text>
    <path d={`M${-symbol * 3},0 H${symbol * 3}`} stroke="#748f96" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    <text x="0" y={symbol * 2.4} textAnchor="middle" className="map-small" fontSize={symbol}>START</text>
    <path d={path(track)} fill="none" stroke="#2678c6" strokeWidth="2.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    {benchmark?.route && <path d={path(benchmark.route.points)} fill="none" stroke="#b58a25" strokeWidth="2.6" strokeDasharray="7 6" vectorEffect="non-scaling-stroke" />}
    {tackPoints.map((p, i) => p && <circle key={i} cx={p.position.x} cy={-p.position.y} r={symbol * 0.45} fill="#d3a63f" stroke="#fff" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />)}
    <g transform={`translate(${boat.position.x},${-boat.position.y}) rotate(${sailingHeading(boat, scenario)})`}>
      <circle r={symbol * 1.4} fill="#fff" opacity="0.75" />
      <path d={`M0,${-symbol * 1.3} Q${symbol},${symbol * 0.15} ${symbol * 0.5},${symbol} L${-symbol * 0.5},${symbol} Q${-symbol},${symbol * 0.15} 0,${-symbol * 1.3}`} fill="#246caa" stroke="#fff" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <path d={`M0,${-symbol * 0.6} L0,${symbol * 0.6}`} stroke="#b5d7f1" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </g>
    {!follow && <g transform={`translate(${xmin + margin * 1.1},${-ymax + margin * 1.25})`}>
      <path d={`M0,0 l${-windVector.x * symbol * 4},${windVector.y * symbol * 4}`} stroke="#527780" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <text x={symbol * 1.1} y={symbol} fontSize={symbol * 0.9} className="map-small">TRUE WIND</text>
      <text x={symbol * 1.1} y={symbol * 2.25} fontSize={symbol * 0.85} className="map-small">{wind >= 0 ? '+' : ''}{wind.toFixed(1)}°</text>
    </g>}
  </svg>;
}
