# Moving expert roll tack

The player, live computer, hindsight search and deterministic replay use the same moving maneuver. The old stationary tack wait is replaced, not combined with the new loss.

## Default behavior and tuning

`EXPERT_TACK` in `src/engine/config.js` groups the initial tuning. Scenario settings can override `tackPenalty` (the existing key, now **turn duration**), `tackMinSpeedFraction` and `tackRecoverySeconds`. The existing Advanced setting is relabeled **Tack turn (s)**; there are no additional controls.

| Setting | Default |
| --- | --- |
| Heading-change duration | 4.5 s |
| Minimum speed fraction in unchanged wind | 0.80 |
| Full recovery from tack initiation | 8 s |
| Speed minimum | 80% of turn duration: 3.6 s |
| Maximum maneuver integration step | 0.05 s |

The recovery endpoint is at least the turn duration. Setting the turn duration to zero explicitly disables the maneuver and its speed loss, preserving the old zero-cost baseline option. A normal nonzero tack keeps moving throughout.

In steady wind, a 5 kn entry gives approximately 4.81 kn at 1 s, 4.42 at 2 s, 4.07 at 3 s, 4.00 at 3.6 s, 4.02 at 4 s, 4.24 at 5 s, 4.57 at 6 s, 4.87 at 7 s and 5.00 at 8 s.

## Integration with existing sailing

`src/engine/tack.js` contains pure maneuver functions and a plain serializable entry record. Entry speed, current target speed, wind-relative heading and start time are captured once. Quintic heading interpolation has zero turn rate and acceleration at each endpoint, and turns through the wind in the commanded tack direction, including from a bearing-away course. The current local wind continues to update that heading throughout the turn. During the turn the boat passes through the no-go angle; outside the maneuver, existing heading legality remains unchanged.

A smoothstep speed-loss envelope rises to a 20% reduction and then falls to zero. It is evaluated from elapsed simulation time, never compounded per frame. The entry reference responds to current local pressure. With the [main + jib polar](POLAR.md), instantaneous head-to-wind lookup is bypassed during the turn to avoid stacking a second loss; after the turn, the reference blends to the actual heading's current polar target by the existing recovery endpoint. Normal acceleration is not layered over this calibrated maneuver. There is no new absolute minimum speed or additional stopping penalty.

The engine now uses a provisional heading-dependent main + jib polar and a normal exponential speed response, while retaining automatic close-hauled steering. Its maneuver functions are unchanged. It does not claim measured 470 telemetry or add apparent-wind/crew/heel controls. The original constant-pressure-speed tack goldens remain available in explicit compatibility tests, alongside sample-for-sample polar-profile comparisons at the same 5 kn entry speed.

`physics.js` supplies the maneuver heading and speed to its existing midpoint position/time integration. The path remains continuous, and local wind is sampled at the moving midpoint. Substeps end at maneuver phase boundaries and outer fixed-step boundaries. A finish is eligible after the turn completes; crossing while still turning is not a finished starboard approach. Mark aiming can resume during speed recovery after the turn. Another tack remains locked until recovery ends, preventing command spam from resetting the loss or bypassing it.

The existing `penaltyRemaining` field now reports turn time remaining; `penaltyTime` reports cumulative time spent turning while moving. The instruments display actual maneuver speed. The results table and short tack projections label this statistic as turning time, never stopped time. Pause freezes the maneuver along with the rest of the race.

## Opponents and validation

The live opponent receives only its current maneuver state, heading/speed, current wind observations and public tuning. Its frozen-map forecast shares the pure heading/speed functions and integrates the moving turn; it cannot sample future wind. Hindsight search advances the authoritative engine, includes maneuver phase in its state grouping and prevents illegal command resets. Its ranking uses a speed-loss estimate rather than a stationary wait. The bounded search can retain an extra pair of cheap moving tacks in steady wind; it is still not a proof of an optimal route.

`tests/smooth-tack.test.js` covers continuous movement, progressive heading, duration, speed minimum, recovery, both directions, 30/60/144 Hz convergence, pressure changes, wind shifts, tuning, very low/zero speed, repeated commands, paused replay and a frozen-observation forecast matching the real steady-wind maneuver. Existing race/search/worker tests now check moving turn costs. The independent analytical straight-leg test retains an explicit zero-duration scenario; normal expert-tack cases use actual curved integration. Edge QA also measures the live speed, heading, moving positions and recovery lockout through the real Start/Tack controls, then completes the race and near-mark approaches.
