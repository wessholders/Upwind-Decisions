import { formatTime } from '../engine/scoring.js';
import { escapeHtml } from './html.js';

export function computerLogView(computer) {
  if (!computer.decisions.length) return '<p>The computer will log its choices as the race unfolds. It sees the current wind map, not the future schedule.</p>';
  return `<ol>${computer.decisions.map(d => `<li><strong>${formatTime(d.time)} · ${d.action === 'tack' ? `Tack to ${escapeHtml(d.toTack)}` : d.action === 'bear' ? 'Bear away beside the mark' : 'Return close-hauled'}</strong><p>${escapeHtml(d.reason)} Wind at the decision: ${d.wind.speedKnots.toFixed(1)} kn from ${Math.round(d.wind.direction)}° relative to the course.</p>${d.options.length === 2 ? `<p>Estimated time to finish from the current picture: continue ${d.options[0].estimatedSeconds.toFixed(1)} s; tack ${d.options[1].estimatedSeconds.toFixed(1)} s. These were predictions, not knowledge of the actual future wind.</p>` : ''}</li>`).join('')}</ol>
    <p>Decisions use current observations every 2 s. Its one-minute projection freezes the observed map; actual future puffs and shifts can change. This is a heuristic opponent, not a certified optimal sailor.</p>`;
}
