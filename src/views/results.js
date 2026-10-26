import { compareRoutes, formatTime } from '../engine/scoring.js';
import { tackExplanationsView } from './tack-explanations.js';
import { escapeHtml } from './html.js';

export { escapeHtml } from './html.js';

export function resultsView(boat, benchmark, error, computer = null) {
  const reference = benchmark?.route?.finish;
  const delta = reference ? compareRoutes(boat, reference) : null;
  const title = delta ? `${delta.time >= 0 ? '+' : '−'}${Math.abs(delta.time).toFixed(1)} seconds to the benchmark` : 'Your route is in.';
  const live = computer ? `<p class="live-result">Live computer: ${computer.boat.finished ? `finished in ${computer.boat.time.toFixed(1)} s (${computer.boat.time <= boat.time ? (boat.time - computer.boat.time).toFixed(1) + ' s ahead of you' : (computer.boat.time - boat.time).toFixed(1) + ' s behind you'}).` : computer.status === 'timed-out' ? 'did not finish within its race limit.' : `still racing at ${formatTime(computer.boat.time)}; you can watch or pause it.`} It makes decisions from current observations only.</p>` : '';
  const heading = `<div class="eyebrow">LEG COMPLETE</div><h2>${title}</h2>${live}`;
  if (error) return `${heading}<p role="alert">Benchmark could not complete: ${escapeHtml(error)}. Your sailing result is preserved.</p>`;
  if (!benchmark) return `${heading}<p>Searching the same wind sequence in a background worker…</p>`;
  if (!reference) return `${heading}<p>No valid benchmark route found within this search budget.</p>`;
  const row = (name, color, result) => `<tr><th scope="row"><span class="legend-dot ${color}"></span>${name}</th><td>${formatTime(result.time)} <small>(${result.time.toFixed(1)} s)</small></td><td>${result.distance.toFixed(0)} m</td><td>${result.tacks}</td><td>${result.penaltyTime.toFixed(1)} s</td></tr>`;
  return `${heading}
    <div class="table-scroll"><table><thead><tr><th scope="col">Route</th><th scope="col">Elapsed</th><th scope="col">Distance</th><th scope="col">Tacks</th><th scope="col">Tack time</th></tr></thead><tbody>${row('You', 'blue', boat)}${computer?.boat.finished ? row('Live computer', 'purple', computer.boat) : ''}${row('Hindsight reference', 'gold', reference)}</tbody></table></div>
    <p>Extra distance versus hindsight: <strong>${delta.distance >= 0 ? '+' : ''}${delta.distance.toFixed(0)} m</strong>. ${escapeHtml(benchmark.label)}.</p>
    <p>The hindsight reference samples the same evolving wind at every candidate position and time, including future conditions. It does not use a frozen screenshot. The course picture shows the displayed time; select a tack to see the wind when that decision was made.</p>
    ${tackExplanationsView(benchmark.comparisons, benchmark.settings)}`;
}
