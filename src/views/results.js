import { compareRoutes, formatTime } from '../engine/scoring.js';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function resultsView(boat, benchmark, error) {
  const reference = benchmark?.route?.finish;
  const delta = reference ? compareRoutes(boat, reference) : null;
  const title = delta ? `${delta.time >= 0 ? '+' : '−'}${Math.abs(delta.time).toFixed(1)} seconds to the benchmark` : 'Your route is in.';
  const heading = `<div class="eyebrow">LEG COMPLETE</div><h2>${title}</h2>`;
  if (error) return `${heading}<p role="alert">Benchmark could not complete: ${escapeHtml(error)}. Your sailing result is preserved.</p>`;
  if (!benchmark) return `${heading}<p>Searching the same wind sequence in a background worker…</p>`;
  if (!reference) return `${heading}<p>No valid benchmark route found within this search budget.</p>`;
  const row = (name, color, result) => `<tr><th scope="row"><span class="legend-dot ${color}"></span>${name}</th><td>${formatTime(result.time)} <small>(${result.time.toFixed(1)} s)</small></td><td>${result.distance.toFixed(0)} m</td><td>${result.tacks}</td><td>${result.penaltyTime.toFixed(1)} s</td></tr>`;
  const comparisons = benchmark.comparisons.map(c => `<li>At <strong>${formatTime(c.time)}</strong>, tack now: finish in ${c.chosenTime.toFixed(1)} s. Continue for ${c.delay} s, then search again: ${c.continuedTime === null ? 'no valid continuation found in the search budget.' : `${c.continuedTime.toFixed(1)} s (${c.continuedTime - c.chosenTime >= 0 ? '+' : ''}${(c.continuedTime - c.chosenTime).toFixed(1)} s).`}</li>`).join('');
  return `${heading}
    <div class="table-scroll"><table><thead><tr><th scope="col">Route</th><th scope="col">Elapsed</th><th scope="col">Distance</th><th scope="col">Tacks</th><th scope="col">Tack time</th></tr></thead><tbody>${row('You', 'blue', boat)}${row('Reference', 'gold', reference)}</tbody></table></div>
    <p>Extra distance: <strong>${delta.distance >= 0 ? '+' : ''}${delta.distance.toFixed(0)} m</strong>. ${escapeHtml(benchmark.label)}. This reference knows the entire wind sequence.</p>
    <details><summary>Why the reference tacked</summary>
      <p>Each comparison holds the preceding route fixed, delays the tack by ${benchmark.settings.interval} seconds, then searches again. These are limited numerical searches; differences do not prove that a tack was necessary.</p>
      <ol>${comparisons}</ol>
      <p>Search: 4 s coarse + 2 s fine decisions; final beam ${benchmark.settings.width} states; ${benchmark.settings.cell} m position cells. ${benchmark.expanded.toLocaleString()} states evaluated. Physics step: 0.25 s. Global optimality is not certified.</p>
    </details>`;
}
