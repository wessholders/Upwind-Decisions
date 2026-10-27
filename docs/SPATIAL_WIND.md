# Traveling wind: first model

The previous wind generator produces a deterministic sequence `W(t)` by sampling seeded target directions, holds and smoothstep transitions. Uniform mode keeps that sequence and its previous behavior. The new field wraps it with a position-dependent time delay rather than inventing a separate visual wind generator.

## Interface and geometry

```js
windAtPosition(scenario, x, y, simulationTime) // course-relative wind FROM angle
```

Let `H = courseLength + boatLength × gateBoatLengths` be the upwind entry boundary and `c` the pattern propagation speed in meters/second. In traveling mode:

```text
sourceTime = simulationTime - (H - y) / c
theta(x, y, simulationTime) = W(sourceTime)
```

Before its first event, `W` returns the initial wind. A source event at time `a` first reaches height `y` at `a + (H - y)/c`. For a transition from `a` to `b`, its down-course width is `c × (b - a)` and its midpoint front is `y = H - c × (t - (a+b)/2)`. The transition moves down-course at exactly `c` regardless of boat speed, playback or display frame rate.

This first field is homogeneous in X. Fronts are horizontal and move along negative course Y. A positive wind shift rotates the wind source clockwise relative to the baseline. Streaks align with `(sin(theta), cos(theta))` in world coordinates; the screen inverts Y, using the course's uniform scale. Lines are undirected axes of the local true wind; their orientation does not indicate front orientation or force a front to move diagonally. Pattern speed is not an air-speed model.

`windAt(scenario, time)` remains the source/uniform sequence sampler for compatibility. It is not used as a substitute for local wind in traveling physics. Existing configs without spatial fields receive uniform-mode defaults and retain their original seeded sequence.

## Scenarios

- **Uniform:** unchanged seeded persistent and oscillating sequences; spatial parameters do not alter them.
- **Traveling persistent:** explicit signed shift angle (default +12°), entry start (20 s), transition width (60 m) and propagation speed (3 m/s). The source's transition duration is width/speed. The final direction persists after the front has passed the whole course.
- **Traveling oscillating:** the same seeded target-selection and hold process, with each smooth transition set to width/speed. Targets can reverse without crossing the median. Regions follow one another at the same selected speed; fronts cannot overtake each other.

The maximum-range control applies to randomized target magnitudes; the traveling persistent angle is its own explicit control. Difficulty scales oscillating hold times; the explicit traveling transition width controls transition sharpness. Valid widths are 1–500 m; exact discontinuities and turbulent front shapes are outside this first model.

## Shared physics and benchmark

Boat headings sample the field at the boat. Traveling movement uses midpoint position/time (RK2), with adaptive internal subdivisions when a possible movement intersects a changing interval. The step bound uses `|d(sourceTime)/dt| <= 1 + boatSpeed/c`, allowing at least 16 samples per transition even for a boat moving toward a narrow front. Outside transitions, the normal 0.25 s step remains. Subdivisions end at the fixed outer-step boundary, preserving deterministic replay and frame grouping.

The mark is a separate field-sampling position: both laylines and gate orientation use wind at the mark. Finish intersection checks the finite, rotating gate, a valid starboard right-to-left crossing and the hull/buoy clearance of the crossing course. Near the gate, integration also accounts for sharp changes at the mark. Bearing-away legality uses wind at the boat; its target is now the nearest safe, legal crossing beside the mark, not the gate center. See [the mark-approach model](MARK_APPROACH.md). Stationary tack penalties and all tack rules are shared without alteration.

The optimizer calls the same movement engine for each candidate state. Its ranking heuristic now also samples candidate-local wind. Replaying its returned command log through the authoritative engine validates the finish. Spatial wind does not change the benchmark's known limits: finite beam width, coarse decisions, restricted bearing-away controls, and no certified optimality. It still has perfect future wind knowledge and is labeled a hindsight benchmark.

## Visualization

The canvas is positioned below the transparent course SVG and uses the same viewBox, padding, aspect-preserving projection and camera as the course. A regular, staggered streak lattice moves at the pattern speed using simulation time. Each streak samples the field at its own world position; its angle therefore stays consistent with the region moving past the boat. Near a steep gradient, strokes shorten so they do not span two conflicting wind directions. No rendering RNG or wall-clock evolution affects the wind or boat.

Optional dashed horizontal guides show transition centers. Hidden mode hides only the canvas. Wind history is sampled along the player's actual recorded route, including a current-position sample. It does not plot the upwind source sequence as if that were wind already experienced at the boat.

## Validation and demonstration

`node --test tests/*.test.js` includes checks for steady and shifted line orientation, propagation speed, stationary arrival times, moving-boat compass response, independent pattern/boat speed, seeded multi-region replay, mark-local finishing, rendering isolation, viewport scaling, and spatial reference routes. A one-meter front crossing is compared against an independent RK4 integration at a 0.0005 s step. The native optimizer worker is exercised with both uniform and traveling scenarios.

Run `node scripts/serve.js` and open the printed local URL. In Advanced settings, load the 300 m traveling-shift demo and start the boat. Try pausing before arrival, switching streak/front/hidden views, and retrying with a different tack. Change the mode to Oscillating for multiple regions. Browser screenshots, touch behavior and live visual smoothness require a connected browser; automated canvas-call and HTTP tests do not certify those aspects.

Future work: inclined or curved fronts, lateral field structure, per-region speed, field-aware camera cues, convergence studies over more scenarios, and post-race explanations of when each route encountered a region. Those are intentionally separate from this first one-dimensional advection model.
