# Live computer and hindsight reference

Both boats use the player's authoritative wind field, pressure response, allowed headings, tack penalty, gate-aim steering and finish crossing. Their information and decision methods differ.

## Live computer (purple)

`src/engine/live-computer.js` separates a current observation adapter from the pure decision policy. Every adapter wind sample is explicitly at the computer's current time. It sends only a plain vector grid over the full-course observation area, exact local wind, current boat state, current gate and public boat settings. It sends no seed, wind knots/targets, future spawn records, feature lifetime, scenario object or function capable of querying future wind. Different future schedules with identical present observations produce identical policy decisions in tests.

Every two simulation seconds, the policy compares continuing with tacking using a one-minute projection through the **frozen current map**. It accounts for the tack stop and the subsequent estimated route to the finite gate. It also recognizes a starboard layline and legal gate aiming from current geometry. A small improvement threshold and time to settle after a tack limit indecisive reversals. This is a simple deterministic heuristic, not an optimal policy, and it does not yet learn a wind-shift cycle or predict actual feature advection. Its 17 × 21 observation grid may smooth small patches. The conceptual observation is the full-course wind picture, independent of the user's camera or hidden-wind display setting.

After making a decision, the independent physics adapter advances the computer through the real, changing field. The policy's frozen-map prediction can therefore be wrong. Public decision logs record the action, current conditions and stated estimate. Logged commands replay through the same engine as the player. The race clock, pause, hidden-tab behavior and retry are shared. When the player finishes first, only the computer continues; the player's finish remains fixed. A finite race limit reports failure to finish rather than inventing a finish time.

## Hindsight reference (gold)

The post-race search has access to the complete evolving seeded scenario. Each candidate samples wind at its own time and position, including future wind after a decision and, if needed, after the player's finish. It neither reuses the player's local wind observations everywhere nor optimizes against the final rendered screenshot. It remains a bounded numerical search: a frozen-current estimate ranks candidates, but actual trajectory integration always samples the evolving field. The player's finished route and an already-finished live-computer route are replayed as incumbents so the benchmark cannot discard a faster known valid finish. Its route is the best found within the search, not a certified global optimum.

`src/engine/tack-analysis.js` reconstructs each exact pre-command state, including fractional times and earlier commands at the same timestamp. Every reference tack receives:

- Its time, position, previous/next tack, local true wind and wind speed.
- Current headings and their up-course speed components (not wind-relative VMG).
- The recent wind encountered on the prior leg, classified as a header/lift only where the same tack persisted over the observation window.
- Two short physical projections, up to 30 s or the remaining reference race duration: tack now versus keep the existing steering mode, with no additional commands. These use actual evolving wind and report mean experienced wind, up-course gain, stopped time and distance to the finite gate. They include the stationary tack penalty; they are descriptive projections, not whole-route optimizations.
- For the first eight tacks, a fresh continuation search that holds for 10 s from the identical preceding state before replanning. The comparison reports total elapsed finish times, not ambiguously labeled remaining times. A hold that already finishes counts as a valid alternative.

The delayed continuation has a narrower beam than the original reference. A worse delayed result can reflect pruning, so it does not isolate a cause or prove a unique optimal tack time. Ties within 0.5 s are labeled as no clear timing advantage. If the delayed search discovers a faster route, the card says the comparison does not support the reference timing; it does not fabricate a justification. A failed search is not treated as proof that the tack was essential. Later tacks retain local/short-projection explanations without claiming an unperformed full finish comparison.

## Inspecting a tack

Each numbered gold marker matches a tack card. Clicking its marker or **View wind at this tack** temporarily pauses a still-racing computer and displays the exact decision time's wind, reference location, heading and local instruments. Density particles initialize at the selected historical field time, not at the final field state. The selected reference's past wind observations populate the history chart. The player's completed result and both boats' command logs remain unchanged. Returning restores the prior computer pause state and current race view.

Tests cover observation-only decisions, live finishes on steady/shifting/organic courses including 1 km, deterministic shared-clock playback, command replay, continuation after the player finishes, exact tack state reconstruction, same-time commands, pressure/penalty measurements, header/lift signs and honest tie/better-alternative/unresolved messages. Optional Edge QA covers real sailing controls, live competition, post-race analysis, historical tack inspection by button and keyboard marker, and return to a computer finish comparison.
