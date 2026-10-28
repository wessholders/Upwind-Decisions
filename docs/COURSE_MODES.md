# Three course modes

Choose **Course mode** in the existing Advanced settings form, then **Apply settings & reset**. The default is **Round to Port**. Retry keeps the selected mode and seed; selecting another course clears the boats, command history, inspection, comparison, clock and previous course geometry when applied. Missing course-mode settings from older configurations use the default. There is no new settings panel or live tactical recommendation.

## Course rules and geometry

| Mode | Geometry | Valid completion |
| --- | --- | --- |
| Round to Port | Existing mark at `(0, courseLength)` and its wind-oriented finite gate | Right-to-left on starboard, leaving the mark to port with the existing hull/buoy clearance |
| Round to Starboard | Same mark, gate, wind and boat model | Left-to-right on port, leaving the mark to starboard with the same clearance |
| Finish Upwind | Fixed finish center 1,000 m upwind, width 100 m, 5 m boat | Downwind-to-upwind crossing of the finite segment on either tack; neither pin requires rounding |

Both rounding modes retain the configurable rounding-course dimensions, the original rotating-gate bisection/interpolation and the same contact envelope. Direction and final tack are mirrored; the boat still starts on starboard in both modes. Port rounding retains its existing rendering colors, long two-line guides and sailing behavior.

Finish Upwind locks the three geometry fields to 1,000 m, 5 m and 20 boatlengths. Its snapshot contains the center, initial upwind unit vector and endpoints; it is created with the scenario and travels through worker serialization and replay. With initial upwind vector `u` and right vector `r = (u.y, -u.x)`, the center is `start + 1000*u` and the pins are `center ± 50*r`. The code supports rotated initial world winds without assumptions about screen-left or angle sign. Under the trainer's established convention, the world background is course-relative 0°; **Baseline wind from** changes compass labels, not world coordinates. The snapshot uses original background direction, never a puff at the boat or finish. Later shifts cannot rotate, move or resize it.

The straight-course detector checks signed distances to the fixed line, interpolates the continuous crossing fraction and verifies that the crossing point lies between the endpoints. Wrong-way, stationary and extension crossings fail. A moving boat may finish during a tack if it crosses this line correctly; rounding modes retain their existing requirement to finish after the turn on the required tack. Physics supplies the fraction to the existing partial-step position, distance and finish clock calculation. No intermediate windward mark is created or rendered.

## Live laylines and line bias

The four guides use the existing close-hauled target angle (`minAngle`): one starboard and one port approach from each pin, each extending 200 m downwind. The polar still determines sailing speed; guide geometry does not invent a different steering/VMG angle. `FINISH_GUIDES` centralizes the length, 28% opacity, 1.5 px non-scaling stroke, fade beginning at 70% of length and smoothing settings. World-space gradients fade the final 30% to transparent. Clip geometry follows the same visible viewport projection as the water, including camera margins. Camera zoom never changes the 200 m geometric length.

Representative wind samples come from the two pins, finish center and points 25 m upwind/downwind of center. Their wind vectors are averaged through a six-second exponentially weighted window of seven actual field times. This softens localized boundaries and updates smoothly during a prevailing shift. It uses no boat-local heading as a substitute, no new wind generator and no frame-driven state. Pause, camera changes, historical inspection and query order cannot alter the authoritative boat/wind simulation or the wind value for a given display time.

The subtle guide colors reuse existing **wind-vector teal `#527780`** and **mark-ring bronze `#bc8b3f`**. Gate ink `#223e48` and buoy gold `#e8ac4e` provide the finish line and pins. `COURSE_THEME` centralizes these SVG colors. Pins remain visually equal; colors distinguish tack guides, not a favored finish end.

Bias is the projection difference `dot(end - start, currentPrevailingUpwind)`. Zero indicates a neutral line. The pin needing less upwind progress is recorded as the favored finish endpoint, using projections rather than screen positions or angle-sign rules. Opposite shifts reverse it, including when the initial world wind is rotated. Hindsight tack records include the representative finish-area wind and bias for future analysis. The live map and instruments show no bias value, favored-pin flag or recommendation.

## Shared simulation and files

The polar table, normal acceleration/deceleration, roll-tack state machine, speed-loss/recovery curves, organic wind generation and fixed simulation clock are unchanged. Mark/finish aiming uses the same existing control and no-go constraints. Finish Upwind labels it **Bear away to finish**; rounding modes retain **Bear away to mark**, including appropriate required-tack warnings. Neither control tacks automatically.

The live computer receives a current course-geometry snapshot alongside its existing current observations. Its finite-crossing forecast shares the course validator; its final-tack policy follows the rounding side or accepts either tack for a straight finish. Hindsight search uses the appropriate goal and required-tack cost, then replays through the authoritative physics. Both opponents continue using the same polar and maneuver model. Descriptions and historical tack inspection reflect the chosen course.

| Files | Purpose |
| --- | --- |
| `src/engine/course-config.js`, `config.js` | Named modes, defaults, geometry constraints and validation |
| `src/engine/course.js` | Course geometry, finite crossing, legal finish aiming, prevailing finish wind, four laylines and projection-based bias |
| `src/engine/wind.js`, `src/race-controller.js` | Create the immutable-in-time finish snapshot and normalize settings/reset state without changing wind generation |
| `src/engine/finish.js`, `physics.js` | Mirror rounding validation, dispatch straight crossings and use course geometry for existing aiming/integration |
| `src/engine/live-computer.js`, `optimizer.js`, `tack-analysis.js` | Course-aware current-observation decisions, forecasts, hindsight goals and analysis metadata |
| `src/views/finish-guides.js`, `course.js` | Shared palette, fade/clip definitions, fixed pins, course-specific render geometry and existing camera projection |
| `src/main.js`, `index.html`, `src/styles.css` | One selector in the existing settings form, fixed-field state, course-specific instructions and matching select styling |
| `src/views/bear-control.js`, `tack-explanations.js` | Correct steering labels and final-approach explanations for every mode |
| `tests/course-modes.test.js`, `scripts/browser-check.js` | Mode/geometry/physics/planner tests and real browser races, settings, retries, zoom and hindsight checks |

## Validation and limits

The course tests cover default compatibility, resets, unchanged rounding wind/tacks, both rounding directions, mark contact/finite gate rejection, fixed dimensions under shifts, arbitrary rotated initial wind geometry, both-tack finite crossings, no mark in the straight view, four exact-length guides, fading/clipping, finish-local smoothing, query-order isolation, mathematical bias, live races in steady/shifting/organic wind and authoritative hindsight/player replay. Browser QA exercises the actual selector and controls, completes both new courses, receives hindsight results, checks camera-independent guide lengths, retries each course and restores default rounding. Existing regression tests, static build and JavaScript/import checks remain required.

Limitations are inherited: the speed polar is provisional, the contact envelope is simplified, and the live forecast/beam search are heuristic rather than certified optimal. The laylines represent smoothed wind near the finish, not a prediction of every future puff or a guarantee that one tack reaches a pin. The hindsight result for a full 1 km course can take longer than the short practice course; it remains in the background worker. The optional stationary wind-inspection sandbox is separate from the sailing-course selector.
