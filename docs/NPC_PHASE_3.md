# NPC Phase 3 — strategic personalities

Eight opt-in weighted configurations now share `route-planner-v2`. There are no
personality-specific route algorithms, physics models or privileged forecast
sources. Production still defaults to `legacy-reference`; no UI or active fleet
was added. Phase 1/2 compatibility configurations and fixtures remain intact.

## Configuration

| Preset ID | Pressure | Shifts | Tacks | Side | Current | Route |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `elite-all-rounder` | 17 | 17 | 12 | 6 | 18 | 30 |
| `all-rounder-2` | 20 | 17 | 12 | 6 | 15 | 30 |
| `all-rounder-3` | 17 | 20 | 12 | 6 | 15 | 30 |
| `puff-hunter` | 50 | 10 | 8 | 4 | 8 | 20 |
| `shift-hunter` | 10 | 50 | 8 | 4 | 8 | 20 |
| `tack-minimalist` | 10 | 10 | 45 | 5 | 10 | 20 |
| `side-specialist` | 10 | 10 | 8 | 45 | 7 | 20 |
| `current-strategist` | 10 | 10 | 8 | 4 | 48 | 20 |

```js
const npcConfig = createPersonalityConfiguration('puff-hunter', {
  skillId: 'intermediate',
  attributeWeights: { pressure: 55, route: 15 },
});
const trainer = createTrainer(environmentConfig, npcConfig);
```

Weights are finite nonnegative values normalized to percentages; an all-zero
vector and unknown attributes are rejected. Complete resolved weights and
versioned planning/observation settings serialize with each configuration.
Skills remain independent of personality. Specialists and variable All-Rounders
default to Intermediate, with all three skills available explicitly. The Elite
factory enforces its suite-validated default; low-level explicit configuration
supports experimental skill comparisons.

Weighted presets use `personalityVersion: 2` and `strategy.version: 1`. The old
six family identifiers with personality version 1 remain compatibility metadata;
select a preset explicitly to enable weighted behavior. All three All-Rounders
retain the `all_rounder` family and have distinct stable preset/NPC IDs.

## Common candidate generation and measurements

Every weighted personality receives the same candidates for the same skill,
observation and planning memory. A bounded common ray scan adds pressure,
directional and ground-track opportunities on either tack. Candidates can tack
and then steer toward a corridor after the turn, while normal speed recovery
remains active. No candidate teleports, ignores recovery, or receives a speed
bonus. Planned turn-completion events are scheduled in simulation time.

Shared-physics forecasts accumulate time-weighted pressure exposure, directional
lift/header exposure, current-related track alignment/drift, half-course
occupancy, and actual plus estimated remaining tack counts. No candidate track
history is retained. Skill candidate/horizon/substep budgets are unchanged.

## Comparable scores and avoiding duplicate ETA credit

All six scores lie in `[0,1]` before percentage weighting:

- **Route:** relative ETA regret within the allowed competitive route window.
- **Pressure:** additional pressure/pocket-avoidance quality beyond the fastest
  legal ETA candidate. Pressure exposure penalizes below-background wind and
  rewards above-background wind; stronger pockets receive an extra downside
  preference, without changing their physical speed effects.
- **Shifts:** additional average favorable tack-relative wind angle beyond that
  fastest candidate. The reference is the original course axis, not a hidden
  generator trend or an actual future shift.
- **Current:** additional ground-track alignment and drift robustness beyond
  that fastest candidate. No current produces a neutral raw observation and
  zero additional current credit.
- **Tacks:** fewer predicted maneuvers than the fastest route, as an explicit
  simplicity preference beyond the physical time loss already in ETA.
- **Side:** occupancy of the selected half, saturating at ten boat lengths
  from center. This is a positional preference, not an invented speed effect.

Normal wind/current/tack performance is counted in physical ETA once. The fastest
candidate receives no second pressure, shift or current bonus for the conditions
that already made it fastest. A slower candidate can receive credit for
*additional* strategic quality, giving specialists deliberate bounded tradeoffs.
Full environmental gain is a quarter of the normalized physical exposure scale;
full maneuver gain is two avoided tacks. These scales are common to all presets.

The shared competence filter excludes unresolved/exhausted routes and ordinarily
requires positive projected progress. Candidates must be within 8% of best
remaining ETA, capped at 30 s, with a 4 s minimum comparison window. This is a
per-decision guard, not a guaranteed whole-race percentage loss limit. Legal
navigation overrides preferences. Existing hysteresis is converted from seconds
to utility using the route-weight/ETA scale; small gains do not reset plans.

The initial validation exposed repeated roll-tack VMG harvesting, with up to
57 tacks in one race. The final common reversal guard requires observed pressure
or directional support, recovery from nonpositive ground progress, a necessary
return to a committed side, or a substantial ETA improvement after the first
strategic tack. This prevents repeated exploitation of the prescribed moving
turn envelope without changing shared physics. Mandatory course tacks remain
available. Tests retain the discovered regression.

## Side initialization and information access

Only Side Specialist receives `initialSideIndicator()` from the privileged
simulation initialization adapter. The adapter returns **one side and provenance**:

- An explicitly configured scenario side bias supplies that side.
- Balanced scenarios use the permitted initial present-wind observation.
- A neutral observation uses an ordinary course-setup tie break.

This is a statistical prior/present estimate, not the realized winning side.
The adapter rejects acquisition after time zero and receives no hindsight route.
No seed, feature history, future spawn, route score or sampler is sent to policy.
There is no new remote backend service in this static application.

The side is stored in independent commitment state and never reassessed. A
common locked-side constraint prefers routes staying in that half. Mandatory
navigation and final-quarter finish setup are exempt. If no route on the chosen
side satisfies the competence/reachability guard, ordinary navigation can leave
the half while retaining the original side commitment. It is not an impassable
physical boundary or a guarantee of spending every second on that side.

Other personalities derive only a soft initial side preference from their own
permitted observations. No personality can query actual future wind. Existing
upstream caps, indirect mark/heading visibility restrictions, immutable policy
inputs, independent memory and authoritative actual movement remain in force.

## Validation results

**432/432 races finished** within the test cap, with zero timeouts. Each named skill produced **8/8/8 distinct personality trace signatures** (Beginner/Intermediate/Advanced) across the eighteen cases. All eight presets passed 1x/4x/8x/16x state/command/memory/commitment clock checks.

Intermediate configurations, eighteen equally weighted cases each (same skill isolates weight differences):

| Personality | Mean finish seconds | Mean tacks | Mean experienced wind kn | Mean tack-relative lift degrees |
| --- | ---: | ---: | ---: | ---: |
| elite-all-rounder | 337.242 | 2.22 | 11.425 | 0.670 |
| all-rounder-2 | 337.590 | 2.11 | 11.420 | 0.658 |
| all-rounder-3 | 337.509 | 2.00 | 11.421 | 0.624 |
| puff-hunter | 339.064 | 2.22 | 11.409 | 0.546 |
| shift-hunter | 337.372 | 2.17 | 11.421 | 0.648 |
| tack-minimalist | 337.569 | 2.11 | 11.420 | 0.658 |
| side-specialist | 343.019 | 2.28 | 11.433 | 0.295 |
| current-strategist | 338.841 | 2.56 | 11.439 | 0.770 |

The final maximum was **9 tacks**, versus 57 in the rejected initial trial. 149 individual decisions exhausted their configured search budget across the 432 races; partial candidates were discarded, limits were never exceeded, and all boats finished.

Elite skill qualification, using the declared success-then-mean-time criterion:

| Skill | Finishes | Mean finish seconds | Mean tacks |
| --- | ---: | ---: | ---: |
| beginner | 18/18 | 337.199 | 2.11 |
| intermediate | 18/18 | 337.242 | 2.22 |
| advanced | 18/18 | 338.765 | 2.11 |

The factory therefore selects **beginner** for the initial Elite weights. Beginner and Intermediate were practically tied (about 0.043 s in the mean). This is a narrow suite-qualified choice, not evidence that the Beginner category is universally superior. It deliberately does not assume the longest horizon is strongest.

Measured on Intel(R) Core(TM) Ultra 9 285HX, Node v24.22.1. Advanced heavy-workload median pure policy cost was **7.28–7.45 ms**, versus **6.30 ms** for the unweighted Phase 2 planner (about 16–18% additional time).
The measured snapshot used 10 candidates / 2,912 physical substeps versus 8 / 2,432 unweighted. p95 weighted times ranged 7.43–10.94 ms. Timing uses three warmups and twenty samples, excluding observation construction; macro race times additionally include validation telemetry.

Eight Advanced boats at 16x would imply about 466–477 ms of planning work per wall second in this snapshot. That is an extrapolation; synchronized bursts, rendering and mobile performance are unvalidated.

**262 tests passed, zero failed/skipped**, including all 239 pre-Phase-3 tests. Native syntax/import/entry checks passed for 93 JavaScript files. Build/static graph and optimizer-worker checks passed. No dependencies were installed and no browser UI/load test was run.

Realized specialty outcomes vary: the table does not show every hunter winning its preferred environmental metric or Tack Minimalist always having the fewest actual tacks. Controlled tests establish meaningful pressure, directional and maneuver tradeoffs; full-race results honestly retain estimation error, competing objectives and unfavorable comparisons.

Run the repeatable suite with:

```sh
node scripts/npc-personality-benchmark.js --output=artifacts.local/npc-phase3-benchmark.json
```

The suite runs NPCs sequentially: eight presets x three skills x three courses
x six fixed weather/current configurations = 432 races. Weather uses the Phase 2
explicit uniform/organic/traveling scenarios, seeds 314159/42/73, 6/10/18 kn
background winds, pressure contrast, oscillating/persistent shifts, and
following/adverse/cross/oblique currents. Rounding courses are 300 m and the
fixed finish is 1,000 m. The cap is 1,200 simulation seconds. Additional clock
checks compare every preset at 1x/4x/8x/16x for equal simulated time.

Actual pressure/lift/pocket telemetry is collected by the offline harness and
never fed back into decisions. The first benchmark is retained locally at
`artifacts.local/npc-phase3-initial-benchmark.json`; the report records the final
guarded implementation. All unfavorable outcomes remain included.

Tests cover weights/serialization, all skill combinations, bounded strategic
tradeoffs, pocket scoring, real pressure/shift examples, shared post-tack physics,
the reversal regression, identical actual physics across presets, single-use
side indication, immutable commitment, no future/out-of-range queries, and
deterministic playback/reset. Existing tests were not weakened.

## Files changed

Created: `src/engine/npc-personalities.js`, `npc-strategy.js`,
`npc-side-indicator.js`, `tests/npc-personalities.test.js`,
`scripts/npc-personality-benchmark.js`, `docs/NPC_PHASE_3.md`, and
`docs/NPC_PHASE_3_BENCHMARK.json`.

Modified: `src/engine/npc-config.js`, `npc-policy.js`, `npc-route-policy.js`,
`npc-forecast.js`, and `live-computer.js`. Shared physical/environmental source,
legacy policy, legacy fixtures, HTML, CSS and production selection are unchanged.
Existing build tests refresh ignored `dist/` output.

## Fleet readiness and limits

Preset IDs, immutable tunable weights, skill/visibility independence, per-boat
planning memory, commitment and serializable configuration are ready for a fleet
controller. No eight-boat runtime/UI, standings, rendering, tactics, collisions
or wind shadows have been enabled.

The forecast still freezes permitted present wind, extrapolates map edges, and
uses the bounded Phase 2 terminal ETA approximation. A specialist's preferences
do not guarantee the best realized pressure, shifts, tack count or finish time
in every race. Advanced is not assumed stronger merely because it searches more.
Revalidate Elite skill selection after tuning weights or expanding the scenario
distribution. Eight simultaneous boats, synchronized decision bursts and mobile
browser performance require separate profiling before production fleet rollout.
