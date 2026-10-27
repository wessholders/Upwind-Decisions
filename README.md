# Upwind Decisions

A vanilla HTML, CSS, and JavaScript sailing trainer with a deterministic, rendering-independent engine. Read moving organic puffs and light-air pockets, decide when to tack, and compare your upwind route with a hindsight reference using the same local wind and boat-speed response. No frameworks, package dependencies, transpilation, or build step.

## Run

Serve this folder with any static HTTP server. The included development server and tests use Node 22.12+ (verified with Node 24); **no `npm install` is needed**.

```sh
node scripts/serve.js
```

Open http://127.0.0.1:5173/. To use another port, set the `PORT` environment variable. Native JavaScript modules and module workers require HTTP serving; double-clicking `index.html` using `file://` is not supported. No application backend is required.

```sh
node --test tests/*.test.js
node scripts/check.js
```

Optional npm aliases: `npm run dev`, `npm test`, and `npm run check`. On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`.

To deploy, upload **`index.html`, `wind-sandbox.html` and the `src/` directory** together to a static host. Paths are relative, so deployment in a subdirectory is supported. There is no `dist/` build output. The host must serve `.js` with a JavaScript MIME type for native modules and the optimizer worker.

## Wind on the sailing course

The main trainer at `/` opens with **Puffs & pockets** selected. **Puffs** have darker water and dense, bold, fast trails (4× ambient core density); **pockets** have lighter water and sparse, finer, slower trails (0.4× density). Choose **Wind on water → Identify puffs / pockets** for explicit type labels and distinct outlines. Outside features, wind always comes directly from upwind: **0° relative to the course**. Steady, persistent and oscillating regimes control the direction within features and their travel, with smooth edges blending back to the fixed ambient direction. Choose a balanced, left-favored or right-favored course. Wind on water can also hide the display; the debug-vector checkbox is independent.

The boat, compass, live wind-strength instrument, wind history, finish gate, and hindsight optimizer sample the same authoritative field. Puffs increase boat speed and light air reduces it using the explicit training rule `base boat speed × (local wind / background wind)^response`. The default response is 0.5 (square root); set it to 0 to keep speed fixed. This is a simplified pressure response, not a calibrated polar. Tack penalties, legal headings, bear-away steering and finish rules are preserved.

Under **Advanced settings**, adjust the favored-side probability (default 65/35), feature frequency, nominal patch width in boatlengths, background wind, speed contrast, pressure response and maximum shift. Applying settings starts a fresh leg; **Retry same wind** preserves the exact seed and conditions. The earlier uniform and traveling-front modes remain available.

The optional [wind inspection lab](wind-sandbox.html) remains available for dragging a stationary probe around the field. It shares the wind modules with the main trainer; gameplay takes place in the main trainer. See [the integrated wind-field design and prototype audit](docs/WIND_FIELD.md) for implementation and validation details.

## Sailing

- A purple **live computer** starts alongside you, sailing through the same wind with the same boat model, tack costs and finish rules. It makes decisions every 2 s from current wind observations. Its one-minute prediction freezes the current map; it has no future wind schedule or hindsight optimizer.
- Start on starboard; the boat automatically follows the changing wind close-hauled.
- Use **Tack** (keyboard T) for a moving roll tack: the heading turns smoothly over 4.5 s, speed dips to about 80% in steady wind and recovers to the current wind target by 8 s. Repeated tacks are locked through recovery. The player and both computer boats share this maneuver. Space starts/pauses. See [tack behavior and tuning](docs/TACKS.md).
- **Bear away to mark** aims for the closest safe crossing beside the windward mark, leaving it to port on the starboard finish approach. It also accepts a small change such as 2°. The target is the mark end of the gate, with hull/buoy clearance—not the gate midpoint. Select it early to arm the approach; it holds close-hauled until a safe, legal course is available. It never tacks automatically. **Return close-hauled** cancels it, as does a tack. The status explains lockouts and distinguishes armed from active steering. See [mark approach geometry](docs/MARK_APPROACH.md).
- Cross the finite dark gate right to left on starboard. It extends upwind from the mark and rotates with the wind. Laylines are visual references, never boundaries.
- New wind creates a seed; retry preserves the exact scenario. Advanced settings apply when you reset the leg.
- The gold hindsight route and numerical decision comparisons appear after finishing. The search includes your completed route and any already-finished computer route as incumbents, so beam pruning cannot discard a faster known valid result.
- Open **Live computer decisions** to read its choices. If you finish first, it keeps racing; use Pause/Resume computer to control playback while your result stays fixed.
- After finishing, the gold reference's numbered tack cards show local wind, heading changes, pressure/progress tradeoffs and a 10 s delay comparison. Click **View wind at this tack**, or a numbered gold marker, to replay that exact decision's field and instruments. Return to the finish view to resume a still-racing computer.

## Traveling wind

Choose **Wind field → Traveling shifts** to see shifts move down the course and reach the boat at its actual position. **Uniform** preserves the original simultaneous-shift scenarios. **Wind on water** offers directional streaks, streaks with dashed shift-front guides, or hidden wind; these display options do not change physics.

For a quick demonstration, open **Advanced settings → Load 300 m traveling-shift demo**, then press **Start sailing**. At 8× playback, a +12° front enters from above the mark and moves toward the boat. Watch the streaks rotate in the approaching region while the compass holds its old heading, then changes as the boat reaches the front. Pause, retry the same wind, or switch display modes to inspect it. The demo sets a 3 m/s pattern speed, 30 m smooth transition, and 10 s entry start.

Advanced settings control pattern propagation speed (default **3 m/s**), transition width (default **60 m**), persistent angle and entry start. Traveling oscillations reuse seeded, bounded target directions and randomized holds, including multiple targets on the same side of the median. All fronts use the selected propagation speed. Persistent traveling shifts use the explicit angle rather than the uniform scenario's random magnitude. Transition widths are 1–500 m; transitions are smooth, not discontinuous steps.

This is a simplified training model. Horizontal fronts move along the down-course axis independently of boat speed or actual wind speed; streak orientation represents local wind direction and is independent of front orientation. The canvas samples the same field as the physics and draws below the boat and course references. Dashed front guides mark transition **centers**, not sharp edges. Wind history plots observed wind at the moving boat; laylines and finish-gate orientation use wind at the mark. The hindsight search samples the field separately at every candidate boat's position and time.

See [the spatial model](docs/SPATIAL_WIND.md) for equations, numerical limits and validation.

Trainer defaults: organic wind; 1000 m course; 5 kn base boat speed at 10 kn background wind; square-root pressure response; minimum 45° true wind angle outside tacks; 4.5 s moving tack with 80% minimum speed and recovery by 8 s; 5 m boatlength; 20-boatlength (100 m) finish gate; ±15° individual regime/feature shift bound. Regime and feature deviations can combine inside patches; ambient wind outside patches stays at 0° relative to the course. No current, waves, calibrated polar curve, or apparent-wind model. Legacy uniform/traveling modes retain fixed target speed with the same temporary tack loss.

## Architecture

```text
index.html               semantic HTML, controls, settings and instruments
src/styles.css           responsive layout using local font fallbacks
src/engine/
  config.js      units, defaults, validation, fixed timestep
  geometry.js    angles, vectors, tack legality, laylines
  wind.js        seeded scenario generation and time-indexed interpolation
  finish.js      finite rotating gate and crossing interpolation
  physics.js     single authoritative boat model and commands
  tack.js        shared smooth turn, speed envelope and recovery
  race.js        deterministic command replay
  optimizer.js   bounded beam search and tack counterfactuals
  scoring.js     route comparison and formatting
src/views/               course SVG, observed wind history, post-race analysis
  wind-canvas.js         deterministic streak/front geometry and canvas drawing
src/race-controller.js   rendering-free player lifecycle and fixed-step clock
src/main.js              native DOM bindings and animation/worker lifecycle
src/optimizer.worker.js  native module worker for hindsight calculation
scripts/serve.js          optional dependency-free local HTTP server
scripts/check.js          JavaScript syntax and module/asset checks
tests/                   Node test runner; physics, replay, controls, serving and workers
```

The view uses SVG's uniform `preserveAspectRatio="xMidYMid meet"` transform: equal horizontal and vertical meter scales in both camera modes. The organic wind layer uses the same projection, including SVG padding and camera changes. The hull is drawn to its configured meter length, with an enlarged location/heading marker. Baseline compass wind changes compass readings without rotating the course.

## Numerical limits

The integrator uses a maximum **0.25 s** outer step. Uniform wind retains midpoint time sampling; traveling and organic wind use predicted midpoint position/time sampling. Organic mode samples pressure-dependent boat speed at that same midpoint and shortens integration steps near small, fast patches; traveling mode shortens them near narrow fronts. Playback uses only fixed outer steps, independent of refresh rate. Tack penalties and finish times may end on a partial step. Finish detection evaluates the rotating gate and uses bisection within a linear movement substep. Movement and rotating-gate crossing therefore remain numerical approximations, not exact continuous-time solutions. Extremely fast externally supplied wind curves are outside the tested generator's range.

The benchmark uses a 4 s coarse search followed by a 2 s search with a 140-state beam and 2 m position cells. It includes hold, tack, mark-approach, and close-hauled actions. Mark approach finds the nearest clearance-safe, legal crossing beside the buoy; it does not enumerate every legal bearing-away angle. The same geometry and finish clearance apply to the player, live computer and reference. The ranking heuristic estimates travel using frozen current wind and is not an admissible bound under future shifts. Pruning, time/space discretization, a finite horizon, and the restricted steering set can all miss better routes. **Best route found numerically; global optimality is not certified.**

Tack feedback reconstructs each exact pre-tack state and shows local wind, recent encountered lift/header, initial/settled sailing headings, up-course speed components and controlled short projections through the evolving wind with/without the moving turn and speed recovery. Turning time is reported separately from elapsed time; the boat continues moving. For the first eight tacks, a fresh search first continues for ten seconds from the identical preceding route, then replans. It reports absolute elapsed finish times and flags ties, better delayed routes or failures to find a valid continuation. These are measured tradeoffs and search comparisons, not proof of a unique timing or isolated cause.

The live computer is a separate heuristic policy. Its input is a plain current-time observation grid, local wind, boat state, course geometry and public boat parameters; it receives no scenario seed, generator, future features or future-sampling API. Its forecast and choice functions cannot access the authoritative scenario. The physics adapter subsequently moves its boat through the actual field, just like the player. Computer command logs replay through the same engine. Neither opponent is advertised as mathematically optimal.

Wind knots are generated at scenario creation and queried by simulation time. Oscillations sample bounded independent targets, with randomized holds and smoothstep transitions, permitting several shifts on the same side of the median. Difficulty scales hold/transition times (easy 1.6×, medium 1×, hard 0.45×). Persistent scenarios randomize start, sign, magnitude and duration from the seed, then hold the final wind. Generated oscillations cover five hours; the final direction is held after that horizon.

The interface runs entirely in the browser. Fonts and assets use local resources; there are no CDN imports or remote font requests. The optional local server only serves static files. No account, database, analytics, deployment, or external data service is configured.

## Handoff status

The initial trainer was implemented from its written brief, before the original trainer HTML was available. The later wind-field increment inspected the supplied blob-shape demo and preserved the existing trainer. See [the original audit](docs/AUDIT.md) and [the current wind-field audit](docs/WIND_FIELD.md).
