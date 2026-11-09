# UPWIND DECISIONS — NPC PHASE 2 IMPLEMENTATION REPORT

## A. Implementation summary

Phase 2 adds opt-in `route-planner-v2`, policy version 1. It compares bounded
hold, immediate-tack, deferred-tack and upwind-steering plans, retains competitive
plans, and estimates legal finish time using vector current throughout.

Actual sailing and candidate forecasts both use `applyAction()` and `advance()`.
The real wind generator, physical equations, polar, maneuver envelope, current
model, live course rules and UI remain unchanged. Environment dispatch was
extracted so shared physics can consume a frozen observation-derived provider.

`legacy-reference`, version 1, remains the production default. Its policy,
forecast, thresholds and regression fixtures are unchanged. Added statistics
count evaluations without changing their scheduling or action selection.

## B. File inventory

Modified during Phase 2:

- `src/engine/physics.js`: provider dispatch and optional forecast-step counting;
  no changes to physical equations or live scenario behavior.
- `src/engine/course.js`: optional provider course snapshot; existing live
  geometry calculations remain the fallback.
- `src/engine/finish.js`: provider snapshot crossing/endpoint dispatch; existing
  evolving live-gate validation remains unchanged.
- `src/engine/npc-observation.js`: additional restricted route observation with
  complete own-boat state and whitelisted public physics configuration.
- `src/engine/npc-config.js`: new policy/version validation and serialized,
  bounded planning settings; legacy descriptors retain their prior shape.
- `src/engine/npc-policy.js`: dispatch to either versioned policy.
- `src/engine/live-computer.js`: route observation selection, deterministic
  statistics and planned-maneuver scheduling.
- `src/race-controller.js`: optional second NPC-configuration argument; reset
  preserves the selected policy. Existing one-argument callers remain legacy.

Created:

- `src/engine/environment-provider.js`: private provider ownership and live
  sampler fallback.
- `src/engine/npc-route-config.js`: provisional planning profiles and validation.
- `src/engine/npc-forecast.js`: bounded observation-provider/shared-physics
  forecasting and controlled command forecast API.
- `src/engine/npc-route-eta.js`: vector-current legal terminal approximation.
- `src/engine/npc-route-policy.js`: candidates, time comparison and memory.
- `tests/npc-route-planner.test.js`: 24 tests, including multiple parameterized
  physical and skill/course cases.
- `scripts/npc-benchmark.js`: repeatable performance/race comparison harness.
- `docs/NPC_PHASE_2.md`: this report.
- `docs/NPC_PHASE_2_BENCHMARK.json`: measured benchmark inputs and results.

Ignored generated artifacts: `artifacts.local/npc-phase2-benchmark.json` retains
all playback runs. Existing build tests regenerate `dist/`. The uncommitted
Phase 1 files were preserved; they are not newly implemented Phase 2 work.

## C. Planner architecture

```text
Explicit NPC configuration
  -> restricted present observation + own boat + public configuration
  -> policy generates bounded candidate plans
  -> private estimated provider from that observation
  -> shared applyAction/advance simulate each plan
  -> legal terminal ETA using vector ground velocities
  -> time-based comparison plus switching hysteresis
  -> action and independent updated planning memory
  -> shared applyAction/advance sail the real environment
```

Candidates include holding the existing mode, immediate tacking when legal,
tacking at selected future timestamps, and supported manual steering targets
between the close-hauled angle and 75 degrees TWA. An existing plan is included
as an incumbent. There is no recursive route tree or personality scoring.

Each forecast can combine an initial heading choice, one scheduled tack, and
mandatory course navigation. Navigation is reconsidered at the configured
decision cadence; physical integration and an armed approach still update at
the authoritative smaller steps. The terminal approximation considers a direct
approach or a two-leg continuation with the required final tack.

The primary score is estimated seconds to a legal finish: forecast elapsed time
plus remaining travel/maneuver time. No knot or distance bonus is mixed into that
score. If every bounded continuation is unresolved, a separate recovery fallback
chooses the best projected ground progress and reports **no finite ETA**.

Memory stores plan identity, original/intended tack, optional maneuver time,
heading target, creation time, expected remaining seconds, last substantial
change, reason and invalidation. A plan survives if alternatives do not improve
ETA by the configured threshold; the threshold doubles during its initial
commitment period. A substantially better or reachable alternative can replace
it immediately. A recent strategic tack also suppresses an immediate reversal
until the configured minimum plan interval. Mandatory navigation bypasses this.

At a scheduled tack, the plan is reevaluated against fresh permitted observations.
Actual recovery blocks impossible maneuvers. Overdue plans that age beyond one
decision interval are discarded and replanned, with an expiration marker;
changed-tack plans are invalidated. Navigation can clear any strategic plan.

`nextDecision` is shortened to a pending maneuver timestamp when necessary. No
wall-clock timer enters policy memory. Runtime statistics contain deterministic
counts only; timing instrumentation lives outside the simulation.

## D. Shared physics verification

`createObservedEnvironment()` builds an estimated environment capability from
plain observation data. Shared physics resolves its wind through a private
provider registry. A real scenario continues through the original wind sampler
and live course/finish implementation.

The new forecast has no boat integration formulas. It calls the same functions
that integrate the player, including actual speed state, exponential response,
manual/close/gate modes, tack progression/recovery, current displacement,
mark clearance and finite crossings. Frozen rounding crossings use the shared
finite-segment course validator; they do not predict actual future gate rotation.

Parity tests compare full resulting boat state within 1e-7 numerical tolerance
under equivalent constant inputs for uniform, traveling and organic adapters;
zero, favorable, adverse, cross and oblique current; acceleration and steering;
in-progress fractional-time tacks; attempted illegal repeat tacks; and all three
course finishes. Different actual future wind is intentionally not expected to
match a frozen forecast.

The original analytical, navigation, current, tack, field, replay, finish and
worker tests remain intact. Legacy fixture comparisons retain their original
1e-8 tolerance and exact action/reason/command checks.

## E. Current-aware planning

Every candidate integrates the configured uniform constant current vector
through shared physics. Through-water speed remains a polar quantity; ground
velocity is the heading vector times that speed **plus vector current**.

The terminal solver uses the terminal observed wind and tests finite gate targets:

1. A current-compensated direct approach on each legal final tack.
2. Two-leg approaches with nonnegative durations solving
   `destinationDisplacement = groundVelocityA * timeA + groundVelocityB * timeB`.
3. Required final tack, valid crossing direction, finite segment intersection
   and mark clearance checks.
4. Full shared tack-recovery duration for each required future tack, remaining
   current recovery, and a normal acceleration allowance.

This accounts for lateral drift, adverse/favorable current and terminal tack
requirements. No arbitrary positive progress denominator is used. Degenerate,
negative-duration or unsupported paths do not receive a finite ETA. The solver
also declines travel times beyond six hours instead of treating negligible
progress as a useful route.

This is a deliberately limited, maneuver-padded approximation under frozen
terminal wind, not an exact solver or a global conservative bound. It checks a
bounded target/heading set, assumes settled polar velocities between maneuvers,
and does not simulate the whole terminal route through changing pressure.
`reachable: false` means no supported legal continuation was found, not proof
that all possible sailing routes or future conditions are unreachable.

## F. Skill configuration

These values are provisional and independently configurable within validated
hard bounds. Named observation profiles remain the Phase 1 capped profiles.

| Parameter | Beginner | Intermediate | Advanced |
| --- | ---: | ---: | ---: |
| Decision interval, simulation seconds | 4 | 2 | 2 |
| Forecast horizon, simulation seconds | 20 | 40 | 60 |
| Maximum candidate routes | 5 | 8 | 10 |
| Maximum integration substeps per decision | 1,200 | 2,600 | 4,000 |
| Deferred tack delays, seconds | 8 | 8, 16 | 8, 16, 28 |
| Steering offsets above minimum TWA, degrees | 8 | 6, 12 | 4, 8, 12 |
| ETA switching threshold, seconds | 3 | 2 | 1.5 |
| Initial commitment/minimum reversal interval, seconds | 6 | 8 | 10 |

The configured hard ceiling is 12 candidates, 90 forecast seconds and 6,000
physical substeps per decision. The budget counts actual integration substeps,
including the smaller tack/recovery steps. It is shared across candidates.
Exhausted forecasts are explicitly unresolved and cannot win on a partial ETA.
No candidate track histories or authoritative environmental states are copied.

Advanced has the largest available search configuration, but benchmark results
do not establish it as a superior sailor. Skill/profile version 2 applies to
the new policy; the legacy skill descriptors and fixed planning remain version 1.

## G. Information isolation

New-policy configuration rejects `legacy-v1`, because that compatibility profile
retains the historical upstream source preview. All new-policy observations cap
sampling at wind entry. Lower visibility applies to exact sampling and indirect
mark-orientation/heading calculations, not just the grid rectangle.

Observations contain no scenarios, functions, seeds, generator metadata, spawn
schedules, future targets or hindsight routes. Own-boat state and public course,
polar, tack and constant-current configuration are whitelisted and immutable.

The provider is constructed from the permitted map inside the forecasting
module. It cannot obtain new information: out-of-range queries use map edges,
and future-time requests use the same present snapshot. The provider is not a
privileged callback passed into policy input. Tests replace the real sampler
with a throwing function after observation construction; forecasting/planning
still works. Worlds with identical observations and different actual futures
produce identical decisions.

`frozen-present-v1` is the only temporal model. The versioned forecast-model field
is an extension point for future observation-history estimates. No advection,
shift-cycle learning or temporal extrapolation is claimed in this phase.

## H. Performance results

Recorded on Intel(R) Core(TM) Ultra 9 285HX, Node v24.22.1, win32/x64.

| Workload | Policy/skill | Median observation ms | Median policy ms | Median total ms | p95 total ms | Candidates | Actual substeps |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| steady | Legacy | 0.130 | 0.462 | 0.580 | 1.037 | 2–2 | Not instrumented |
| steady | beginner | 0.051 | 0.945 | 1.008 | 1.252 | 4–4 | 576–576 |
| steady | intermediate | 0.081 | 1.818 | 1.908 | 2.237 | 6–6 | 1344–1344 |
| steady | advanced | 0.116 | 2.796 | 2.910 | 3.506 | 8–8 | 2432–2432 |
| puffs-cross | Legacy | 0.129 | 0.468 | 0.572 | 1.419 | 2–2 | Not instrumented |
| puffs-cross | beginner | 0.038 | 1.963 | 1.996 | 2.507 | 4–4 | 576–576 |
| puffs-cross | intermediate | 0.084 | 3.867 | 3.947 | 5.612 | 6–6 | 1344–1344 |
| puffs-cross | advanced | 0.092 | 5.865 | 5.996 | 6.341 | 8–8 | 2432–2432 |

Eight-NPC projected planning CPU **milliseconds per wall second**, spanning the two measured workloads:

| Configuration | 1x | 4x | 8x | 16x |
| --- | ---: | ---: | ---: | ---: |
| Legacy | 2.3–2.3 | 9.2–9.3 | 18.3–18.6 | 36.6–37.1 |
| beginner | 2.0–4.0 | 8.1–16.0 | 16.1–31.9 | 32.3–63.9 |
| intermediate | 7.6–15.8 | 30.5–63.2 | 61.1–126.3 | 122.1–252.6 |
| advanced | 11.6–24.0 | 46.6–95.9 | 93.1–191.9 | 186.2–383.8 |

Advanced median total decision cost is approximately 5.0x / 10.5x the legacy cost in steady / puffs-cross workloads. Intermediate/advanced imply 4/16/32/64 fleet evaluations per wall second; beginner implies 2/8/16/32.

Measured standard candidate counts are 4/6/8; incumbent/manual alternatives can raise them to the configured 5/8/10 caps.

Measurements are headless on the recorded CPU/runtime. They exclude browser
rendering. Pure decision measurements warm up three times and collect twenty
repetitions per workload, separating observation and policy time. Race timing
also includes controller/player integration. These are local measurements, not
portable frame-rate guarantees. Legacy forecast substeps are not instrumented;
the preserved standard hold/new-tack pair is approximately 608 steps analytically.

Eight-NPC values are extrapolated from per-decision costs and decision cadence.
No active fleet or eight-boat browser responsiveness has been validated.
Synchronized advanced decisions could create visible bursts; browser/mobile
profiling and later scheduling/rendering work remain necessary before fleet use.

## I. Legacy comparison

Run the complete comparison with a normal Node installation:

```sh
node scripts/npc-benchmark.js --output=artifacts.local/npc-phase2-benchmark.json
```

The default harness compares both policies over eighteen fixed course/weather
cases at 1x, 4x, 8x and 16x: 144 races. Rounding courses are 300 m; Finish Upwind
retains its fixed 1,000 m geometry. Each race uses identical physical settings,
realized wind/current, initial state and legal finish rules for both policies.

The six explicit weather cases cover uniform 6/10/18 kn wind, following/adverse
current, organic high-contrast puffs/pockets with strong cross-current, persistent
organic shifts with oblique current, and traveling oscillations. The harness
records finish time/success, tacks, distance, evaluation/candidate/substep counts,
CPU time, timeout reason, full realized configuration and replay fingerprint.

These compare operational configurations: original broad legacy observations
versus capped advanced route-planner observations. They do not isolate search
quality from visibility differences. No legacy settings are retuned for results.

Across eighteen distinct cases, the new policy outperformed in **2**, matched in **5**, and underperformed in **11**. Both policies finished every measured case at every speed: 100% success and 0% timeouts in this suite. There were no route-planner step-budget exhaustions.

| Course / weather | Legacy seconds | Route seconds | Route minus legacy | Outcome |
| --- | ---: | ---: | ---: | --- |
| round-port/steady | 183.011 | 185.353 | +2.343 | underperformed |
| round-port/light-following | 198.497 | 200.675 | +2.179 | underperformed |
| round-port/strong-adverse | 200.692 | 202.742 | +2.050 | underperformed |
| round-port/puffs-cross | 184.637 | 184.573 | -0.064 | matched |
| round-port/persistent-oblique | 199.361 | 201.656 | +2.295 | underperformed |
| round-port/traveling-cross | 178.598 | 180.292 | +1.694 | underperformed |
| round-starboard/steady | 183.074 | 184.716 | +1.643 | underperformed |
| round-starboard/light-following | 198.576 | 198.799 | +0.224 | matched |
| round-starboard/strong-adverse | 200.576 | 202.585 | +2.010 | underperformed |
| round-starboard/puffs-cross | 182.112 | 184.113 | +2.001 | underperformed |
| round-starboard/persistent-oblique | 208.086 | 199.045 | -9.041 | outperformed |
| round-starboard/traveling-cross | 197.528 | 195.409 | -2.119 | outperformed |
| finish-upwind/steady | 597.719 | 597.719 | +0.000 | matched |
| finish-upwind/light-following | 647.137 | 647.137 | +0.000 | matched |
| finish-upwind/strong-adverse | 659.590 | 659.534 | -0.056 | matched |
| finish-upwind/puffs-cross | 595.177 | 597.115 | +1.938 | underperformed |
| finish-upwind/persistent-oblique | 659.379 | 679.725 | +20.346 | underperformed |
| finish-upwind/traveling-cross | 613.441 | 618.736 | +5.295 | underperformed |

| Mean over eighteen cases at 1x | Legacy | Route |
| --- | ---: | ---: |
| Tacks | 2.17 | 2.44 |
| Distance, meters | 776.53 | 789.77 |
| Decisions | 169.61 | 170.50 |
| Headless full-race CPU, ms | 108.01 | 750.37 |

The largest measured gain was about 9.04 s in starboard rounding/persistent oblique conditions. The largest loss was about 20.35 s on Finish Upwind in those conditions. These results do **not** support promoting the new planner to elite/default. All unfavorable cases are retained in the JSON report.

A match means within 0.5 seconds. The harness time limit is 1,200 simulation
seconds and distinguishes its limit from the engine's own timeout. No failed
race is assigned a fabricated finish time. Unreachable/near-zero current cases
are additionally tested at the solver/decision level, not represented as successful
full-race benchmark cases.

## J. Tests

- 239 tests passed, zero failed/cancelled/skipped: the original 215 plus 24 new
  tests with additional parameterized cases.
- Syntax, native imports and entry assets checked for 88 JavaScript files.
- Existing build/static graph and native optimizer-worker tests passed.
- Eight pre-refactor legacy fixtures still pass.
- New tests cover physical parity, current directions/near-zero progress,
  finite approaches, candidate bounds, scheduled tack execution, commitment and
  invalidation, no impossible repeat maneuvers, information isolation, independent
  memory, JSON configuration, and playback/pause/reset consistency.
- The benchmark verifies matching full boat/command/memory fingerprints across
  all four playback multipliers for each of its cases.

No dependencies were installed. Validation used VS Code's installed headless
Node runtime. Browser interaction/rendering checks and an active eight-NPC
browser load test were not run; the UI is unchanged.

## K. Known limitations

- Frozen wind and edge extrapolation are estimates, not future facts.
- The terminal solver is bounded and approximate; unresolved is not proof of
  global impossibility, and a finite ETA is not a guarantee about future wind.
- One scheduled strategic tack plus navigation is not a general multi-leg search.
- There is no explicit uncertainty propagation or inferred feature motion yet.
- Planning costs are bounded but depend on current/navigation solver workloads;
  a substep cap is not a hard wall-clock deadline.
- The new policy does not establish a superior elite configuration.
- Legacy known approximations remain deliberately unchanged.
- No tactics, personality weights, side choice, varied current, or active fleet.
- Existing UI text/log formatting remains designed for the legacy NPC; use the
  engine API and comparison harness for opt-in evaluation during this phase.
- Complete fleet save/restore, hardware portability, performance optimization and
  fixed-seed evaluation over a larger distribution remain future work.

## L. Phase 3 readiness

Personality extensions can reuse bounded candidate generation, shared-physics
forecasts, current-aware time estimates, immutable observations, independent plan
memory and explicit policy versions. The preserved reference and reproducible
harness provide comparisons for each later change.

Before choosing the elite planner or exposing a fleet, expand evaluation and
address observed regressions. Future personality tradeoffs should be expressed
in interpretable time-equivalent terms or explicit constraints, while keeping
legal navigation and identical physics authoritative. Side Specialist still
needs its limited initialization signal and commitment rules; current/pressure/
shift specialists need actual distinct decision logic. None is operational yet.

Opt-in usage, without production UI changes:

```js
const trainer = createTrainer(environmentConfig, {
  id: 'route-test', policyId: 'route-planner-v2', skillId: 'advanced',
  // Optional bounded provisional overrides; included in serialized config.
  planning: { switchingThresholdSeconds: 2 },
});
```

One-argument `createTrainer(environmentConfig)` remains `legacy-reference`.
