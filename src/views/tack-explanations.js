import { formatTime } from '../engine/scoring.js';
import { escapeHtml } from './html.js';

const bearing = n => `${String(Math.round(n) % 360).padStart(3, '0')}°`;
function timingText(c) {
  if (!c.checked) return 'A full finish-time comparison was not run for this tack; the observations below still describe both options.';
  if (c.continuedTime === null) return `No finishing continuation was found after waiting ${c.delay} s within the search budget. That does not prove the tack was necessary.`;
  const delta = c.finishDifference;
  const result = c.outcome === 'near-tie' ? 'No clear timing advantage was found (within 0.5 s).'
    : delta > 0 ? `Waiting was ${delta.toFixed(1)} s slower in this comparison.`
      : `Waiting found a route ${(-delta).toFixed(1)} s faster. This check does not support this tack as the best timing.`;
  return `The reference finishes at ${formatTime(c.chosenTime)} (${c.chosenTime.toFixed(1)} s from the start). Continuing ${c.delay} s before replanning found a finish at ${formatTime(c.continuedTime)} (${c.continuedTime.toFixed(1)} s). ${result}`;
}
function headline(c) {
  if (c.outcome === 'alternative-faster') return 'A better timing was found in the comparison';
  if (c.outcome === 'near-tie') return 'Several tack timings perform similarly';
  if (c.finalTack && c.toTack === 'starboard') return 'Set up the final starboard approach';
  if (c.trend === 'header') return 'The previous tack has headed';
  if (c.tackNow.averageWindKnots - c.keepGoing.averageWindKnots > 0.4) return 'More pressure on the tack-now branch';
  if (c.newUpCourseKnots - c.oldUpCourseKnots > 0.15) return 'The new tack points farther up the course';
  return 'Position for the next part of the leg';
}
export function tackExplanationsView(comparisons, settings) {
  const cards = comparisons.map(c => {
    const direction = c.wind.compassDirection, right = c.boat.position.x >= 0;
    const trend = c.trend === 'header' || c.trend === 'lift'
      ? ` Over the previous ${c.observationSeconds.toFixed(0)} s, the wind encountered along the reference route changed ${Math.abs(c.observedWindChange).toFixed(1)}°, ${c.trend === 'header' ? 'heading' : 'lifting'} its previous tack.` : '';
    const final = c.finalTack && c.toTack === 'starboard'
      ? ' This is its final tack onto starboard, required for the right-to-left crossing of the finish gate.' : '';
    const branch = (name, b) => `<tr><th scope="row">${name}</th><td>${b.averageWindKnots?.toFixed(1) ?? '—'} kn</td><td>${b.upCourseMeters.toFixed(0)} m</td><td>${b.penaltySeconds.toFixed(1)} s</td><td>${b.gateDistance.toFixed(0)} m${b.finished ? ' · finished' : ''}</td></tr>`;
    return `<li class="tack-card" data-outcome="${escapeHtml(c.outcome)}">
      <div class="tack-card-top"><strong>Tack ${c.number} · ${formatTime(c.time)} (${c.time.toFixed(1)} s)</strong><button type="button" data-inspect-tack="${c.number}">View wind at this tack</button></div>
      <h3>${headline(c)}</h3>
      <p>From <strong>${escapeHtml(c.fromTack)}</strong> to <strong>${escapeHtml(c.toTack)}</strong>, ${Math.abs(c.boat.position.x).toFixed(0)} m ${right ? 'right' : 'left'} of center and ${c.boat.position.y.toFixed(0)} m up the course. Local wind: <strong>${bearing(direction)} at ${c.wind.speedKnots.toFixed(1)} kn</strong>.${trend}${final}</p>
      <p>The boat turns progressively from ${bearing(c.oldHeading)} toward ${bearing(c.newHeading)} while continuing to move. At the current wind and normal speed, the settled up-course component changes ${c.oldUpCourseKnots.toFixed(1)} → ${c.newUpCourseKnots.toFixed(1)} kn; temporary speed loss and recovery are included in the projection.</p>
      <div class="table-scroll"><table class="tack-options"><caption>Short projection through the actual evolving wind: up to ${c.projectionSeconds.toFixed(0)} s, with no further commands</caption><thead><tr><th>Option</th><th>Mean wind</th><th>Up-course gain</th><th>Turning</th><th>From gate</th></tr></thead><tbody>${branch('Tack now', c.tackNow)}${branch('Keep going', c.keepGoing)}</tbody></table></div>
      <p class="tack-timing">${timingText(c)}</p>
    </li>`;
  }).join('');
  return `<details class="tack-explanations" open><summary>Why the hindsight reference tacked</summary>
    <p>The numbered gold markers match the decisions below. View a tack to replay the wind at that exact time and position. Local observations and short projections describe the tradeoffs; the finish-time check also includes the later route and tack costs.</p>
    <ol>${cards}</ol>
    <p>Finish-time checks cover the first ${comparisons.filter(c => c.checked).length} tacks. A delayed continuation uses a narrower search than the reference, so these comparisons do not prove a unique best timing or isolate a single cause.</p>
    <details><summary>Search details</summary><p>4 s coarse + ${settings.interval} s fine decisions; final beam ${settings.width} states; ${settings.cell} m position cells. Global optimality is not certified.</p></details>
  </details>`;
}
