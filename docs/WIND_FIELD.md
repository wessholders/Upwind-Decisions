# Organic wind in the upwind decision trainer

## Integrated gameplay

The main application at `/` uses this wind model by default. Organic puffs, pockets, water shading and particles are drawn directly beneath the sailing boat, route, laylines and finish gate. The sailing controls, timing, live instruments, retry/new-wind actions, native optimizer worker, gold hindsight route and post-race feedback all remain in the decision tool. `wind-sandbox.html` is an optional inspection lab, not the primary deliverable.

`DEFAULT_TRAINER_CONFIG` selects `windField: 'organic'`; `DEFAULT_CONFIG` retains the legacy uniform engine default for old programmatic scenarios. `createScenario()` maps the trainer's course length, boat length, regime, difficulty, favored side, probability, frequency, nominal size, shift bound, background knots and contrast into a plain `organicWind` descriptor. The field spans the course and upstream gate area; larger course settings are supported. `RaceWindLayer` shares the SVG's exact projection and padding in full-course and follow-boat cameras. It draws wind only; course references and the sailing boat stay in the course view.

The camera's requested SVG viewBox can occupy only part of a wide or tall viewport because meter scales stay equal. Water fills the entire map canvas, and wind rendering clips to the full padded viewport, including the visible space around that viewBox. The coordinate transform is unchanged. This prevents a darker rectangular wind panel and missing trails beside a square follow-boat view. Outline labels and debug vectors use the same visible viewport bounds.

The trainer animates particles while ready and racing, freezes them when paused or both boats have finished, and keeps the physics clock independent of display animation. A separate world clock lets the live computer continue after the player's finish without changing the player's result. Hidden wind does not affect the field or either boat's decisions/results. The instruments show true direction, local knots, pressure category and actual sailing speed. Wind history records what the moving boat experienced, rather than substituting the background sequence. Small, fast patches trigger smaller boat-integration steps based on their shoulder width and maximum relative speed; a numerical convergence test compares against 0.0025 s integration. Field trajectories themselves retain their fixed 0.25 s history grid.

A shift local to the mark rotates the finish gate and the long mark-based layline guides. It does not replace wind samples elsewhere: the boat, instruments, particles and observation map each sample their own position. Clear water outside features remains 0°. In mark-approach mode, a rotating gate can move the target and change the boat's heading even while its local wind stays unchanged. Separate puff/pocket interiors do share the scenario's time-varying regime trend, so their directions can change together; that shared trend is not caused by the mark reading. Legacy uniform mode changes the whole course together, while traveling mode advects a shift front down-course.

Local wind strength and true wind angle feed the shared provisional [main + jib polar](POLAR.md), replacing the former square-root pressure multiplier in default races. The same performance calculation drives player physics, frozen-observation computer forecasts, hindsight trajectories and progress/VMG estimates. Normal actual speed approaches its target gradually, while the established tack envelope remains the sole tack penalty. The integrator samples heading and wind at the predicted midpoint position/time. The optimizer's ranking uses frozen local pressure and direction; its search remains approximate. Allowed headings are shared. The [mark-approach model](MARK_APPROACH.md) aims beside the buoy and requires actual crossing-segment clearance while retaining the finite starboard finish crossing.

Integration tests cover the trainer default, control-to-field mapping, puff/pocket speed effects, optional fixed wind response, moving tacks, pause/retry/frame-group replay, local wind history, a full 1 km organic reference route, projection/display independence and legacy modes. The shared [expert tack model](TACKS.md) replaces the stationary wait while preserving local wind sampling throughout the turn and recovery. Real Edge QA additionally completed an organic 100 m leg through actual Start/Tack controls, received a worker-generated reference, and displayed the comparison table and gold route. Desktop and mobile screenshots include the integrated trainer, not only the lab. See `tests/integrated-wind.test.js` and `scripts/browser-check.js`.

## Optional wind inspection lab

Open `/wind-sandbox.html` through the included static server for the optional stationary inspection tool. It has one 1,000 m course, a 5 m boat, and equal horizontal/vertical meter scales. Drag the marker or focus the canvas and use arrow keys (5 m, or 50 m with Shift). Tack changes the probe's close-hauled heading; it does not sail the boat.

## Reference audit

Inspected the supplied `upwind_wind_blob_shapes_demo.html` from Downloads and the existing repository trainer. The handoff is treated as the request; prototype code is reference material. `upwind_trainer_bear_away.html` was not supplied or found at the named location. The existing trainer and its tests supply the available sailing-rule reference.

The demo already had seeded blob geometry, local vector sampling, puff precedence, weighted compatible shifts, non-overlapping spawn attempts, a density grid, bounded screen-space trails, a draggable boat, and fixed simulation stepping. Its main problems were:

- Physics and particles consumed one RNG. Density changes could change future feature types, shapes and spawn times.
- Feature positions were mutable globals; sampling a different time did not reconstruct that time's positions. An optimizer could not independently query future/past wind.
- Background regimes used hard-coded periodic functions or a fixed positive persistent shift, rather than randomized scenarios.
- Physics used angular radial interpolation, outlines used a coarse polygon, and shading filled the entire patch at one opacity. These layers did not have matching smooth transitions.
- Failed placements redrew type and side, potentially distorting requested probabilities. Several globals also survived partial resets.
- Occupancy work allocated a Map each step and could scan all particles for each overpopulated cell. Density targets changed without adjusting independent birth deadlines.

The existing trainer's traveling mode remains available and still uses horizontal fronts. It is a separate earlier training model, not silently redefined as organic transport.

## Module responsibilities

| Module in `src/wind/` | Responsibility |
| --- | --- |
| `config.js`, `random.js` | Validated units/settings, independent seeded streams |
| `scenario.js` | Seeded persistent, steady and bounded oscillating trends inside features |
| `shape.js` | Analytic organic boundary, smooth influence, area, conservative overlap |
| `feature.js` | Internal wind, lifetime and position history |
| `spawn.js` | Exponentially spaced events, side/type odds, placement retries and statistics |
| `interactions.js` | Permanent removal and compatibility rules |
| `field.js` | Authoritative random-access field and worker-safe race adapter |
| `density.js` | Area-based targets on a 5 × 5 boatlength grid; independent birth hazards |
| `particles.js` | Pooled particles, independent lifetimes, flow, fading and bounded trails |
| `renderer.js` | Separate water layer, trails, optional boundaries/vectors, equal-scale camera |
| `probe.js`, `clock.js`, `controller.js` | Boat inspection, fixed playback clock, UI bindings |

Native JavaScript modules preserve the repository's dependency-free workflow. Adding TypeScript would require changing its existing no-build contract, so no compiler or framework was introduced.

## Wind contract and determinism

```js
import { WindField } from './src/wind/field.js';
const field = new WindField({ seed: 2941, regime: 'oscillating' });
const wind = field.sample(xMeters, yMeters, simulationSeconds);
// direction: wind-FROM degrees clockwise from course-up, normalized [0, 360)
// speedKnots; vx, vy: velocity TOWARD, in meters/second
// kind: background | puff | pocket; influence: [0, 1]
// backgroundDirection: always 0 (directly upwind, relative to the course)
```

World X increases right/east, Y increases up/north. Wind from 005° has a negative X and negative Y velocity: it travels toward 185°. Feature velocity uses its own internal speed and the scenario's feature-direction trend plus its signed shift. Ambient wind remains from 0°. Translation has a configurable multiplier, initially 1. Strong puffs generally travel faster than pockets.

Physics advances in integer 0.25 s ticks. The midpoint feature-direction trend determines each movement segment; positions interpolate between ticks. `WindField` lazily appends deterministic history and indexes features in ten-second buckets. Querying future wind first, retrying past samples, changing the probe position, resizing, changing display flags, and drawing different numbers of particles do not change existing answers. Particle, feature, schedule and regime RNG streams are separate. Supported sample times are 0–86,400 seconds. History is retained for replay, so memory grows with scenario duration.

Ambient wind outside puffs and pockets is fixed at 0° relative to the course in every organic regime and at every time. The scenario trend applies only inside features and to their translation; it does not rotate ambient wind. Oscillating feature trends use independently sampled bounded targets, randomized holds and smooth transitions. Consecutive targets can stay on the same side of the median. Persistent trends choose a seeded sign/magnitude/start/duration and then hold. Each feature's signed shift adds to that trend, so its core direction can exceed the configured individual maximum. Its smooth shoulder blends the internal vector back to the fixed 0° ambient vector, reaching ambient speed/direction at the boundary. A configured compass baseline is still an instrument offset; the upwind direction remains 0° in course coordinates. Legacy uniform/traveling-front modes retain their separate shift behavior.

The original boat and optimizer can consume this field through a plain descriptor:

```js
import { createScenario } from './src/engine/wind.js';
import { attachWindField } from './src/wind/field.js';
const scenario = attachWindField(createScenario({ seed: 2941 }), {
  favoredSide: 'right', probability: 0.65,
});
// Existing advance(), replay(), finish geometry and search() all query
// windAtPosition(), which delegates to this scenario's authoritative field.
// structuredClone(scenario) works for the native optimizer worker.
```

This adapter is tested in Node workers and an actual browser module worker. The trainer's normal scenario generator now attaches it automatically for the default organic mode; manual attachment is useful for programmatic scenarios. Pressure response is now integrated as described above. A calibrated boat polar remains future work.

## Geometry and interactions

Each boundary is an ellipse scaled by a positive three-harmonic radial function. Harmonics have moderate, bounded amplitudes and seeded phases. A positive radius with one point per polar angle makes the boundary smooth and star-shaped without self-intersections. The actual short dimension varies around its nominal 15–75 BL ellipse axis; the nominal long axis is 1.25 times the short axis.

Influence has a full-strength inner core and a cubic smoothstep shoulder falling to zero at the analytic boundary. Physics, density and water pixels evaluate that same function. Debug outlines sample it at 128 angles; the raster water mask uses roughly 5 m pixels with image smoothing. These drawing resolutions approximate the analytic boundary; they are not separate physical geometries.

Overlap uses projections of a provably enclosing ellipse, including maximum radial distortion. This is conservative: it may reject a near miss, but does not admit incompatible overlapping lobes. Spawns retry positions on the already selected type/side and skip crowded events. Spawn clearance is at least two boatlengths. Interaction clearance covers the maximum relative displacement through the next physics tick, including at extreme transport settings.

Puffs remove intersecting pockets permanently. For contradictory same-kind features, the older ID survives. Same-kind features with matching signed shifts may overlap. Sampled internal velocity vectors use influence-weighted interpolation, not summed angles. The strongest influence controls blending against background, avoiding a doubled fringe simply from overlapping compatible patches. Compatible patches remain separate shapes; there is no topological merge or atmospheric fluid solver.

## Particle and water model

The density grid is invisible and never confines movement. Each cell measures 25 × 25 m with a 5 m boat. Four samples per cell estimate local density. At nominal quality the ambient target is 0.0007 particles/m², with puff cores 4× and pocket cores 0.4× that target. Larger features occupy more cells rather than receiving a fixed particle count.

Targets refresh every 0.3 display seconds. Individual exponential birth clocks preserve their remaining hazard when pressure changes. Occupancy uses reusable per-cell linked lists; gentle birth corrections and faded retirement control drift. Deaths are independent, and initialization distributes equilibrium ages. Particles recycle from a pool with a 7,000-particle cap. Quality is selected from screen area on scenario reset, so a smaller viewport changes presentation workload, not physics. No adaptive frame-time quality controller is implemented yet.

Particle lifetimes are 1.8–2.4 **display seconds**, keeping playback readable at high simulation speeds. Local vectors move particles with a presentation-only multiplier of 3.2. Four stroke segments taper each tail in both opacity and width. Trails use only the current head and current sampled vector, bounded to 5–18 CSS pixels, so recycled particles cannot connect across the map. Tails approximate the local tangent rather than retaining a curved trajectory history.

Puffs use darker/heavier trails, pockets lighter/finer trails, all in the teal-gray family. The race map's ambient water is a muted blue-gray, giving lighter pocket shading room to stand out; the earlier nearly white ambient surface made pockets effectively invisible. Puff cores darken the surface, while pocket cores lighten it without turning white. Pocket trails remain finer than ambient but have enough opacity to show direction. Density targets remain 4× / 1× / 0.4× and particles remain the primary wind-strength cue. Water shading is secondary and uses the same smooth influence mask. Compatible shading uses maximum influence. **Identify puffs / pockets** adds solid puff outlines, dashed pocket outlines, and explicit type/current-core-knots labels. The default view has no type labels. Both views use identical physics. The legend shows water/trail samples and density targets. The boat hull is 5 m at the common meter scale; the larger gold circle is a location/drag marker.

Density ratios describe targets, not exact instantaneous particle counts. Random births, advection and fading cause fluctuations and transient lag at moving boundaries. At minimum feature size, a light-air pocket can contain only a few particles at mobile quality. More user evaluation is needed for direction readability in those conditions.

## Favored side

Pressure placement, pocket placement, directional bias and the puff/pocket mix are separate concepts. The frequency slider controls total attempted events; `puffProbability` (default 0.72) controls the type mix. The favored-side probability defaults to 0.65: puffs choose that side with this probability, pockets choose the opposite, and features on the favored side preferentially choose that side's shift sign. Locations remain randomized within each half. Balanced mode has no directional/side preference.

The UI reports accepted placements, not attempted draws. Crowding and conservative rejection can change realized percentages. Statistical tests aggregate 1,000 seeds per favored side with broad tolerance around the requested 65/35 odds. These establish spawning tendencies only. A finishing-time advantage has not been measured across racing strategies; no side is promised to win.

## Verification and limits

Run `node --test tests/*.test.js` and `node scripts/check.js`. The added tests cover random-access replay, render independence, movement, speed ordering, spawn separation, extreme-speed clearance, permanent removal, weighted blending, radial shape properties, geometry/influence agreement, regime behavior, side statistics, area scaling, density hierarchy, birth scheduling, population stability, bounded recycled trails, equal scaling and the existing boat/search/worker adapter. Constant-field population tests isolate density stationarity; they do not prove exact density ratios throughout an evolving field.

`scripts/browser-check.js` is optional QA using Node's built-in WebSocket and a separately launched headless Edge/Chromium with debugging port 9225. It needs the local static server and no browser automation packages. It verifies 1440 × 1100 and 390 × 844 layouts, pause/replay/shuffle, all regimes, tack, real pointer dragging, keyboard movement, boundaries, vectors, renderer independence and actual optimizer module-worker replay. Screenshots go to ignored `artifacts.local/`.

Desktop and mobile screenshots of both the integrated trainer and optional lab were inspected in Edge. A headless synthetic lab renderer run averaged approximately 9–10 ms for field sampling, particle updates and drawing with about 550 particles; this is a measurement on this machine, not a performance guarantee on physical phones or a whole-application benchmark. No on-device mobile, long-duration thermal, accessibility screen-reader or broad browser compatibility study was performed. The visual review confirms working animation, sailing, analysis and layout, not scientific atmospheric validation. Remaining model limits include conservative early removal, abrupt physical feature dissipation, simplified transport, finite tick/raster precision, a simplified pressure response in place of a calibrated polar and no calibrated favored-side racing advantage.
