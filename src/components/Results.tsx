import type { Benchmark } from '../engine/optimizer';
import { compareRoutes, formatTime } from '../engine/scoring';
import type { Boat } from '../engine/types';

export function Results({ boat, benchmark, error }: { boat: Boat; benchmark: Benchmark | null; error: string | null }) {
  const reference = benchmark?.route?.finish;
  const delta = reference ? compareRoutes(boat, reference) : null;
  return <section className="results" aria-live="polite">
    <div className="eyebrow">LEG COMPLETE</div>
    <h2>{delta ? `${delta.time >= 0 ? '+' : '−'}${Math.abs(delta.time).toFixed(1)} seconds to the benchmark` : 'Your route is in.'}</h2>
    {error ? <p role="alert">Benchmark could not complete: {error}. Your sailing result is preserved.</p> : !benchmark ? <p>Searching the same wind sequence in a background worker…</p> : !reference ? <p>No valid benchmark route found within this search budget.</p> : <>
      <div className="table-scroll"><table><thead><tr><th scope="col">Route</th><th scope="col">Elapsed</th><th scope="col">Distance</th><th scope="col">Tacks</th><th scope="col">Tack time</th></tr></thead><tbody>
        <tr><th scope="row"><span className="legend-dot blue" />You</th><td>{formatTime(boat.time)} <small>({boat.time.toFixed(1)} s)</small></td><td>{boat.distance.toFixed(0)} m</td><td>{boat.tacks}</td><td>{boat.penaltyTime.toFixed(1)} s</td></tr>
        <tr><th scope="row"><span className="legend-dot gold" />Reference</th><td>{formatTime(reference.time)} <small>({reference.time.toFixed(1)} s)</small></td><td>{reference.distance.toFixed(0)} m</td><td>{reference.tacks}</td><td>{reference.penaltyTime.toFixed(1)} s</td></tr>
      </tbody></table></div>
      <p>Extra distance: <strong>{delta!.distance >= 0 ? '+' : ''}{delta!.distance.toFixed(0)} m</strong>. {benchmark.label}. This reference knows the entire wind sequence.</p>
      <details><summary>Why the reference tacked</summary>
        <p>Each comparison holds the preceding route fixed, delays the tack by {benchmark.settings.interval} seconds, then searches again. These are limited numerical searches; differences do not prove that a tack was necessary.</p>
        <ol>{benchmark.comparisons.map((c, i) => <li key={i}>At <strong>{formatTime(c.time)}</strong>, tack now: finish in {c.chosenTime.toFixed(1)} s. Continue for {c.delay} s, then search again: {c.continuedTime === null ? 'no valid continuation found in the search budget.' : `${c.continuedTime.toFixed(1)} s (${(c.continuedTime - c.chosenTime) >= 0 ? '+' : ''}${(c.continuedTime - c.chosenTime).toFixed(1)} s).`}</li>)}</ol>
        <p>Search: 4 s coarse + 2 s fine decisions; final beam {benchmark.settings.width} states; {benchmark.settings.cell} m position cells. {benchmark.expanded.toLocaleString()} states evaluated. Physics step: 0.25 s. Global optimality is not certified.</p>
      </details>
    </>}
  </section>;
}
