# Uniform current: audit and implementation

## Audit before implementation

World coordinates are meters: X right of the original course, Y up-course. `geometry.direction` measures clockwise degrees from +Y, and SVG negates Y. `config.baseline` adds a compass bearing to course-relative headings; therefore a compass current flows toward `directionDegrees - baseline` in course coordinates. Knots convert with the existing `1852 / 3600` constant. Wind remains a FROM direction; current is TOWARD.

Actual player/NPC/replay/optimizer position updates occur in `physics.advance` (legacy uniform response) and `advanceThroughField` (polar, spatial wind and moving tacks). Both feed actual endpoints to existing finite finish detection. Polar speed and stored speed are through-water; distance accumulates traveled meters. The controller converts real elapsed time into fixed 0.25 s simulated steps, applying playback once. Keyboard steering independently uses real time.

The NPC's actual boat uses shared `advance`; its frozen observed-map forecast has a separate midpoint position update in `live-computer.js`. Its tactical choice algorithm must remain intact, while its forecast positions receive the same current vector. Navigation currently treats the direction toward a mark as a heading; active-current mark/finish aiming needs a through-water heading that produces the intended ground track. Existing zero-current geometric solvers remain authoritative for unchanged scenarios.

Rounding marks are fixed; their existing finish gates rotate with local wind only. Upwind finish pins are fixed in `scenario.course`. Rounding laylines use local mark wind and 500 m finite segments. Finish laylines use a read-only smoothed wind sample and 200 m segments. Add an optional ground-vector projection to those same endpoints, retaining Wind Only and all styles. The mode is a persisted display preference, outside scenario physics.

`scenario-config.js` already owns seeded launch-time variation, a separate editable draft and realized session configuration. Current was a disabled descriptor with a `directionToward` placeholder. Replace it with `enabled/speedKnots/directionDegrees`, a separate maximum of 1.5 kn, and an independent seeded stream. Manual values stay in the draft, generated values in `scenario.config.current`; restart uses the latter unchanged. No wind random-number sequence or visual renderer needs modification.

Replay and the optimizer already call the shared integrator. Tack projections report actual positions and ground distance; their existing settled up-course speed component is through-water and should be explicitly labeled, with a separate ground component where current is active. The optimizer's ranking and NPC's long-horizon estimate are heuristics, not proof of optimality.

## Configuration and generation

The editable draft contains:

```js
{
  seed: 314159,
  randomize: true, // the existing global toggle
  maxCurrentKnots: 1.5, // allowed range 0–3
  current: {
    enabled: false,
    speedKnots: 0, // retained manual input, 0–3 kn
    directionDegrees: 0 // retained manual input, 0–359°, flows TOWARD
  }
}
```

`scenarioCurrent` in `src/scenario-config.js` derives the realized current without changing the draft. Off produces zero effective speed and skips randomization. On/manual copies manual values. On/randomized uses the existing Mulberry32 PRNG with `seed ^ 0x63757272`, independently of the existing wind variation stream. Its first sample selects uniform speed in `[0, maximum)`; its second selects a uniform bearing in `[0, 360)`. A zero maximum gives zero speed. No rounding occurs in generation or physics.

`sessionConfig` stores that realized descriptor in `scenario.config.current` before engine creation. Restart/Race Again pass the existing realized configuration directly into the controller; they do not derive a new current or reapply wind variation. New seed changes generated values but cannot enable disabled current or overwrite manual values. Manual speed/bearing and maximum stay in the setup draft when changing cards, toggling current, or changing global randomization. No additional current-mode selector, account, or scenario persistence system was introduced.

## Shared integration

`src/engine/current.js:currentVelocity` converts compass current to a course-space velocity with the existing conversion constant:

```text
angle = directionDegrees - baseline
current.x = speedKnots × KNOT_TO_MPS × sin(angle)
current.y = speedKnots × KNOT_TO_MPS × cos(angle)
ground = direction(boatHeading) × STW × KNOT_TO_MPS + current
```

Both actual movement paths in `src/engine/physics.js` add `current × dt` to their final ground displacement: `advance` and `advanceThroughField`. The RK2 midpoint predictor also includes drift to sample wind at the boat's actual predicted location; this predictor is not another accumulated displacement. The adaptive wind-integration bound includes current speed so a drifting boat cannot skip a narrow feature. Finish detection uses the resulting actual endpoints, including partial-step finish interpolation. Ground distance sums ground-segment lengths; zero-current branches retain the original distance operations exactly.

All player/NPC/replay/hindsight boats call that same `advance`. The NPC's separate frozen observed-map forecast adds the public current vector to its own midpoint and final predicted positions. Its decision interval, hold/tack/approach choices, thresholds and tactical algorithm remain unchanged. Observations still exclude scenario seeds and future wind schedules. The optimizer's actual alternatives and tack counterfactuals use the recorded current, and its ranking includes projected current progress.

`navigationApproach` reuses the original finite gate geometry and hull-clearance solvers. With current it converts a desired ground track to a legal through-water heading using the **actual current STW**, so acceleration does not make an allegedly safe ray drift across the buoy. When STW has not yet been initialized, it uses the existing polar prediction with bounded root finding. It never changes tack automatically or bypasses the minimum/maximum sailing-angle limits. Zero current returns the original geometric result. No course feature is relocated or rotated by current; rounding gates retain their original wind-only orientation rule.

## Steering, telemetry and overlays

Manual commands retain their target local true-wind angle and tack. Tack heading interpolation, recovery envelopes, penalties, polar nodes, speed response and wind generation/renderers were not modified. Boat SVG rotation still uses `sailingHeading`; COG only appears as ground telemetry. Existing STW display semantics are retained and explicitly labeled. Enabled-current HUD shows actual current speed, compass TOWARD bearing, a course-oriented arrow, SOG and compass COG (undefined at zero ground speed). Finish telemetry is labeled as the finish snapshot.

`laylineMode` is a local player display preference: `wind-only` by default, or `wind-current`. It is selected under Display & navigation aids and saved in the existing preference storage. It is absent from scenario physics. Mode changes only rerender, without resetting clocks, positions, NPCs or current. Wind Only calls the existing layline function. Wind + Current uses the local close-hauled polar target plus current, normalizes the ground vector and projects the same finite distance backward from each mark/pin. All rounding styles and configurable lengths remain intact; all four finish-pin guides retain their 200 m length, smoothing, colors, opacity, gradients and clipping. Zero current produces identical geometry in both modes. A zero predicted ground velocity yields a collapsed ray rather than an invented approach direction.

Tack analysis keeps its original through-water up-course velocity components, now explicitly labeled, and adds ground-relative components when current is enabled. Projected up-course meters, gate-distance reduction and actual path lengths come from current-affected ground positions. Existing hindsight visibility defaults and opt-in tack inspection remain intact.

## Verification

- 193 Node tests pass: 180 prior regressions and 13 current tests. Existing speed curves, tacks, acceleration, wind features, geometry, NPC, worker and static packaging continue passing.
- Exact zero-current boat-state equivalence across uniform/traveling/organic wind and polar/legacy movement. Cardinal 1 kn currents add precisely the expected displacement, including the 8.2311 m drift over 16 simulated seconds, without changing heading, STW or tack cost. Following/opposing current change SOG; cross-current changes COG. A nonzero compass baseline is covered.
- Identical ground displacement after equal simulated time at 1×/4×/8×/16×; frame-grouping checks through organic wind; exact recorded-command replay. A real traveling shift preserves the manual 47° local-wind target with current.
- NPC actual movement and its separate frozen-map forecast include the same vector. The original NPC finishes/replays all three courses with moderate cross-current. Fixed marks/pins, ground-based finite crossings and compensated aiming are exercised on all three courses. The hindsight optimizer returns a valid current-affected route that exactly replays, includes ground-distance metrics and differs from replaying those commands without current.
- Generation checks cover repeatability, manual/shuffle/restart preservation, independent wind/current streams, disabled current, maximum bounds and 1,000 seeds with continuous unique speeds/directions and full-circle distribution. Wind descriptors and schedules remain identical when current is added.
- Both layline modes, zero-current equivalence, finite 200 m finish guides, unchanged styles, polar-based speed dependence, mode isolation from live state and persisted preference are checked.
- Real browser checks at 1440×1000 and 390×844 cover current setup/review/HUD, manual-value retention across cards and randomization toggles, seeded preview/New seed, actual session restart, live mode changes without movement/time changes, preference storage and mobile width. All three courses finish with 0.3 kn current and real NPC/hindsight worker results; tack replay and hidden-by-default hindsight still work. No runtime errors. Screenshots: `artifacts.local/game-current-*.png` and `game-results-*.png`.
- Syntax/import checks and the static production build pass. No dependencies, wind visual palette changes, current water overlays or external services were added.

## Limits

Current is uniform and constant. No tides, gradients, obstacles, apparent-wind coupling or wind-feature advection were added. Strong adverse current or very weak wind can make a finish unreachable; neither the existing NPC nor the bounded hindsight search guarantees a finish or optimal tactics. Forecasts beyond the NPC's explicitly integrated minute remain approximate; search horizons and pruning retain their prior limitations.

Current-aware approach guidance solves an instantaneous ground ray using current boat speed and a finite set of fallback gate targets. Acceleration, changing local wind and numerical integration mean it is not a globally optimal trajectory planner or an exact continuous-time collision proof. It respects the existing clearance envelope and heading limits and stays armed/close-hauled when no candidate is feasible. Display laylines predict settled close-hauled polar speed rather than transient tack/acceleration speed. This distinction is intentional.
